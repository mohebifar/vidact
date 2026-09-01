use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

use oxc_allocator::{Allocator, CloneIn, GetAllocator, TakeIn};
use oxc_ast::{ast::*, builder::AstBuilder};
use oxc_ast_visit::{
    Visit, VisitMut,
    walk::{walk_call_expression, walk_class, walk_static_member_expression},
    walk_mut::{
        walk_call_expression as walk_call_expression_mut, walk_expression as walk_expression_mut,
        walk_jsx_attribute, walk_jsx_element, walk_jsx_spread_attribute,
    },
};
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_semantic::{Scoping, SemanticBuilder};
use oxc_span::{GetSpan, SPAN, SourceType, Span};
use oxc_syntax::{operator::LogicalOperator, scope::ScopeFlags, symbol::SymbolId};

use crate::{
    Diagnostic, DiagnosticCode, SourceSpan,
    analysis::{ModuleInput, SourceId, SourceKind},
    ast_utils::{
        OBJECT_REST, component_function_parts_mut, is_event_attribute,
        is_supported_react_event_attribute, normalize_compiler_hook_inputs,
        normalize_expression_bodied_component_arrows, normalize_identifier_object_destructuring,
        normalize_precomputed_provider_children, normalize_simple_logical_assignments,
        restore_anonymous_default_component_names,
    },
    custom_hooks::{normalize_dependency_class_hook_methods, plan_local_custom_hooks},
    ir::{ComponentIr, lower_component},
    lowered_react::{may_contain_lowered_react, normalize_lowered_react},
    options::{CompilationOptions, CompilerFeature},
    oxc_react::analyze_program,
    react_bindings::{
        ActionHook, ConcurrentHook, ContextHook, EffectHook, MemoHook, ReactBindings, StateHook,
    },
};

mod ast;
mod derived;
mod iterative;
mod namespace;
mod raw_html;
mod render;

use ast::*;

const SCOPE: &str = "__vidactScope";
const ACTION_FORM: &str = "__vidactActionForm";
const BINDING: &str = "__vidactBinding";
const COMBINE_SOURCES: &str = "__vidactCombineSources";
const COMPILED_EVENT: &str = "__vidactEvent";
const COMPILED_COMPONENT_SPREAD: &str = "__vidactComponentSpread";
const COMPILED_EFFECT: &str = "__vidactEffect";
const COMPILED_IMPERATIVE_HANDLE: &str = "__vidactImperativeHandle";
const COMPILED_INSERTION_EFFECT: &str = "__vidactInsertionEffect";
const COMPILED_LAYOUT_EFFECT: &str = "__vidactLayoutEffect";
const COMPILED_FORM_ACTION: &str = "__vidactFormAction";
const COMPILED_SPREAD: &str = "__vidactSpread";
const COMPILED_ROOT: &str = "__vidactCompiledRoot";
const CLONE_RENDERABLE: &str = "__vidactCloneRenderable";
const CLONE_RENDERABLE_COMPONENT: &str = "__vidactCloneRenderableComponent";
const CREATE_RENDERABLE: &str = "__vidactCreateRenderable";
const RUN_WITH_CONTEXT: &str = "__vidactRunWithContext";
const CHOOSE: &str = "__vidactChoose";
const CREATE_ASYNC: &str = "__vidactCreateAsync";
const CREATE_ACTION_STATE: &str = "__vidactCreateActionState";
const CREATE_CONTEXT: &str = "__vidactCreateContext";
const CREATE_DEFERRED: &str = "__vidactCreateDeferred";
const CREATE_EXTERNAL_STORE: &str = "__vidactCreateExternalStore";
const CREATE_FORM_STATUS: &str = "__vidactCreateFormStatus";
const CREATE_EFFECT_EVENT: &str = "__vidactCreateEffectEvent";
const CREATE_ID: &str = "__vidactCreateId";
const CREATE_PROP: &str = "__vidactCreateProp";
const CREATE_REST_PROP: &str = "__vidactCreateRestProp";
const CREATE_REDUCER: &str = "__vidactCreateReducer";
const CREATE_SCOPE: &str = "__vidactCreateScope";
const CREATE_NARROW_SCOPE: &str = "__vidactCreateNarrowScope";
const CREATE_STATE: &str = "__vidactCreateState";
const CREATE_TRANSITION: &str = "__vidactCreateTransition";
const CREATE_MEMO: &str = "__vidactCreateMemo";
const CREATE_OPTIMISTIC: &str = "__vidactCreateOptimistic";
const DEFERRED: &str = "__vidactDeferred";
const DISPATCH: &str = "__vidactDispatch";
const DYNAMIC_INTRINSIC_COMPONENT: &str = "__vidactDynamicIntrinsicComponent";
const KEYED_FRAGMENT_COMPONENT: &str = "__vidactKeyedFragmentComponent";
const ENABLE_FRAMEWORK_METADATA: &str = "__vidactEnableFrameworkMetadata";
const ENABLE_DOM_FORMS: &str = "__vidactEnableDomForms";
const ENABLE_DOM_NAMESPACE: &str = "__vidactEnableDomNamespace";
const ENABLE_DOM_STYLES: &str = "__vidactEnableDomStyles";
const FORWARDED_REF: &str = "__vidactForwardedRef";
const INDEXED: &str = "__vidactIndexed";
const KEYED: &str = "__vidactKeyed";
const ITEM_INDEX: &str = "__vidactItemIndex";
const ITEM_SCOPE: &str = "__vidactItemScope";
const ITEM_VALUE: &str = "__vidactItem";
const NARROW_SOURCE_BITS: u32 = 32;
const NESTED_PROP: &str = "__vidactNestedProp";
const PROPS: &str = "__vidactProps";
const RENDERABLE_CHILDREN: &str = "__vidactRenderableChildren";
const RENDERABLE_INPUT: &str = "__vidactRenderableInput";
const RENDERABLE_MARKER: &str = "__vidactRenderableMarker";
const RENDERABLE_PROPS: &str = "__vidactRenderableProps";
const RENDERABLE_REF: &str = "__vidactRenderableRef";
const RENDERABLE_TO_ARRAY: &str = "__vidactRenderableToArray";
const IS_RENDERABLE: &str = "__vidactIsRenderable";
const SOURCE: &str = "__vidactSource";
const WHEN: &str = "__vidactWhen";

#[derive(Debug)]
pub struct SurgicalCompilation {
    pub code: String,
    pub source_map: String,
    pub components: Vec<ComponentIr>,
}

pub fn compile_surgical_module(input: ModuleInput<'_>) -> Result<String, Vec<Diagnostic>> {
    compile_surgical_module_with_options(input, &CompilationOptions::default())
}

pub fn compile_surgical_module_with_options(
    input: ModuleInput<'_>,
    options: &CompilationOptions,
) -> Result<String, Vec<Diagnostic>> {
    compile_surgical_module_with_ir_and_options(input, options).map(|compilation| compilation.code)
}

pub fn compile_surgical_module_with_ir(
    input: ModuleInput<'_>,
) -> Result<SurgicalCompilation, Vec<Diagnostic>> {
    compile_surgical_module_with_ir_and_options(input, &CompilationOptions::default())
}

pub fn compile_surgical_module_with_ir_and_options(
    input: ModuleInput<'_>,
    options: &CompilationOptions,
) -> Result<SurgicalCompilation, Vec<Diagnostic>> {
    let allocator = Allocator::default();
    let mut canonical_maps = Vec::new();
    let mut canonical_sources = vec![input.source.to_string()];
    let source_type =
        SourceType::from_path(Path::new(input.filename)).unwrap_or_else(|_| SourceType::tsx());
    let mut parsed = Parser::new(&allocator, input.source, source_type).parse();
    if !parsed.diagnostics.is_empty() {
        return Err(vec![analysis_error(format!(
            "OXC could not parse {} for surgical codegen: {:?}",
            input.filename, parsed.diagnostics
        ))]);
    }
    crate::framework_directives::validate_framework_directives(&parsed.program, options)
        .map_err(|diagnostic| vec![diagnostic])?;
    if options.feature_enabled(CompilerFeature::DependencySource) {
        normalize_simple_logical_assignments(&allocator, &mut parsed.program);
        normalize_dependency_class_hook_methods(&allocator, &mut parsed.program);
    }
    let anonymous_defaults =
        normalize_expression_bodied_component_arrows(&allocator, &mut parsed.program);
    let semantic = SemanticBuilder::new()
        .with_build_nodes(true)
        .with_check_syntax_error(true)
        .build(&parsed.program);
    if !semantic.diagnostics.is_empty() {
        return Err(vec![analysis_error(format!(
            "OXC semantic analysis failed for {} during surgical codegen: {:?}",
            input.filename, semantic.diagnostics
        ))]);
    }

    let semantic = if may_contain_lowered_react(&parsed.program) {
        let scoping = semantic.semantic.into_scoping();
        normalize_lowered_react(&allocator, &mut parsed.program, &scoping)
            .map_err(|diagnostic| vec![diagnostic])?;
        let semantic = SemanticBuilder::new()
            .with_build_nodes(true)
            .with_check_syntax_error(true)
            .build(&parsed.program);
        if !semantic.diagnostics.is_empty() {
            return Err(vec![analysis_error(format!(
                "OXC semantic analysis failed for {} after lowered React normalization: {:?}",
                input.filename, semantic.diagnostics
            ))]);
        }
        semantic
    } else {
        semantic
    };

    let custom_hooks = plan_local_custom_hooks(
        &allocator,
        &parsed.program,
        semantic.semantic.scoping(),
        options.feature_enabled(CompilerFeature::DependencySource),
    )
    .map_err(|diagnostic| vec![diagnostic])?;
    drop(semantic);
    if let Some(custom_hooks) = custom_hooks {
        custom_hooks
            .apply(&mut parsed.program)
            .map_err(|diagnostic| vec![diagnostic])?;
    }
    if options.feature_enabled(CompilerFeature::DependencySource) {
        normalize_identifier_object_destructuring(&allocator, &mut parsed.program);
        let generated = Codegen::new()
            .with_options(CodegenOptions {
                source_map_path: Some(Path::new(input.filename).to_path_buf()),
                ..CodegenOptions::default()
            })
            .build(&parsed.program);
        canonical_maps.push(
            generated
                .map
                .expect("source map is enabled for dependency canonicalization")
                .into_owned_sourcemap(),
        );
        let normalized = generated.code;
        canonical_sources.push(normalized.clone());
        let normalized_source = allocator.alloc_str(&normalized);
        parsed = Parser::new(&allocator, normalized_source, source_type.with_jsx(true)).parse();
        if !parsed.diagnostics.is_empty() {
            return Err(vec![analysis_error(format!(
                "OXC could not parse {} after custom-hook canonicalization: {:?}",
                input.filename, parsed.diagnostics
            ))]);
        }
    }
    if let Err(mut diagnostics) = normalize_state_elisions(&allocator, &mut parsed.program) {
        crate::source_maps::remap_diagnostics(
            &mut diagnostics,
            &canonical_sources,
            &canonical_maps,
        );
        return Err(diagnostics);
    }
    if options.feature_enabled(CompilerFeature::DependencySource) {
        if let Err(mut diagnostics) =
            normalize_nested_primitive_hooks(&allocator, &mut parsed.program)
        {
            crate::source_maps::remap_diagnostics(
                &mut diagnostics,
                &canonical_sources,
                &canonical_maps,
            );
            return Err(diagnostics);
        }
    }
    let semantic = SemanticBuilder::new()
        .with_build_nodes(true)
        .with_check_syntax_error(true)
        .build(&parsed.program);
    if !semantic.diagnostics.is_empty() {
        return Err(vec![analysis_error(format!(
            "OXC semantic analysis failed for {} after custom-hook expansion: {:?}",
            input.filename, semantic.diagnostics
        ))]);
    }

    let scoping = semantic.semantic.into_scoping();
    normalize_compiler_hook_inputs(&allocator, &mut parsed.program, &scoping);
    let semantic = SemanticBuilder::new()
        .with_build_nodes(true)
        .with_check_syntax_error(true)
        .build(&parsed.program);
    if !semantic.diagnostics.is_empty() {
        return Err(vec![analysis_error(format!(
            "OXC semantic analysis failed for {} after frozen hook dependency normalization: {:?}",
            input.filename, semantic.diagnostics
        ))]);
    }

    let react = ReactBindings::new(&parsed.program, semantic.semantic.scoping());
    let mut class_component = ReactClassComponentFinder {
        react: &react,
        span: None,
    };
    class_component.visit_program(&parsed.program);
    if let Some(span) = class_component.span {
        let mut diagnostics = vec![unsupported(
            "React class components are unsupported; use a function component and Vidact errorBoundary",
        )
        .with_span(SourceSpan::new(span.start, span.end))];
        crate::source_maps::remap_diagnostics(
            &mut diagnostics,
            &canonical_sources,
            &canonical_maps,
        );
        return Err(diagnostics);
    }

    let components = analyze_program(
        input,
        &parsed.program,
        &semantic.semantic,
        &allocator,
        options,
    )
    .map_err(|mut diagnostics| {
        crate::source_maps::remap_diagnostics(
            &mut diagnostics,
            &canonical_sources,
            &canonical_maps,
        );
        diagnostics
    })?
    .into_iter()
    .map(lower_component)
    .collect::<Result<Vec<_>, _>>()
    .map_err(|diagnostic| {
        let mut diagnostics = vec![diagnostic];
        crate::source_maps::remap_diagnostics(
            &mut diagnostics,
            &canonical_sources,
            &canonical_maps,
        );
        diagnostics
    })?;
    if components.is_empty() {
        return Err(vec![unsupported("surgical codegen found no component")]);
    }
    drop(semantic);
    if options.feature_enabled(CompilerFeature::DependencySource) {
        normalize_precomputed_provider_children(&allocator, &mut parsed.program);
    }
    let semantic = SemanticBuilder::new()
        .with_build_nodes(true)
        .with_check_syntax_error(true)
        .build(&parsed.program);
    if !semantic.diagnostics.is_empty() {
        return Err(vec![analysis_error(format!(
            "OXC semantic analysis failed for {} after provider construction normalization: {:?}",
            input.filename, semantic.diagnostics
        ))]);
    }
    let scoping = semantic.semantic.into_scoping();
    transform_program(
        &allocator,
        &scoping,
        &components,
        options,
        &mut parsed.program,
    )
    .map_err(|diagnostic| {
        let mut diagnostics = vec![diagnostic];
        crate::source_maps::remap_diagnostics(
            &mut diagnostics,
            &canonical_sources,
            &canonical_maps,
        );
        diagnostics
    })?;
    restore_anonymous_default_component_names(&mut parsed.program, &anonymous_defaults);
    let generated = Codegen::new()
        .with_options(CodegenOptions {
            source_map_path: Some(Path::new(input.filename).to_path_buf()),
            ..CodegenOptions::default()
        })
        .build(&parsed.program);
    let source_map = generated
        .map
        .expect("source map is enabled for surgical compilation")
        .into_owned_sourcemap();
    let source_map =
        crate::source_maps::compose_chain(source_map, canonical_maps.into_iter()).to_json_string();
    Ok(SurgicalCompilation {
        code: generated.code,
        source_map,
        components,
    })
}

struct ReactClassComponentFinder<'r, 's> {
    react: &'r ReactBindings<'s>,
    span: Option<Span>,
}

pub(crate) fn normalize_state_elisions<'a>(
    allocator: &'a Allocator,
    program: &mut Program<'a>,
) -> Result<(), Vec<Diagnostic>> {
    let semantic = SemanticBuilder::new()
        .with_build_nodes(true)
        .with_check_syntax_error(true)
        .build(&*program);
    if !semantic.diagnostics.is_empty() {
        return Err(vec![analysis_error(format!(
            "OXC semantic analysis failed before state elision normalization: {:?}",
            semantic.diagnostics
        ))]);
    }
    let scoping = semantic.semantic.into_scoping();
    let react = ReactBindings::new(program, &scoping);
    StateElisionNormalizer {
        ast: AstBuilder::new(allocator),
        react: &react,
        ordinal: 0,
    }
    .visit_program(program);
    Ok(())
}

struct StateElisionNormalizer<'a, 'r, 's> {
    ast: AstBuilder<'a>,
    react: &'r ReactBindings<'s>,
    ordinal: u32,
}

fn normalize_nested_primitive_hooks<'a>(
    allocator: &'a Allocator,
    program: &mut Program<'a>,
) -> Result<(), Vec<Diagnostic>> {
    let semantic = SemanticBuilder::new()
        .with_build_nodes(true)
        .with_check_syntax_error(true)
        .build(&*program);
    if !semantic.diagnostics.is_empty() {
        return Err(vec![analysis_error(format!(
            "OXC semantic analysis failed before primitive-hook normalization: {:?}",
            semantic.diagnostics
        ))]);
    }
    let scoping = semantic.semantic.into_scoping();
    let react = ReactBindings::new(program, &scoping);
    PrimitiveHookBodyNormalizer {
        ast: AstBuilder::new(allocator),
        react: &react,
        ordinal: 0,
    }
    .visit_program(program);
    Ok(())
}

struct PrimitiveHookBodyNormalizer<'a, 'r, 's> {
    ast: AstBuilder<'a>,
    react: &'r ReactBindings<'s>,
    ordinal: u32,
}

impl<'a> PrimitiveHookBodyNormalizer<'a, '_, '_> {
    fn normalize_body(&mut self, body: &mut FunctionBody<'a>) {
        let mut next = oxc_allocator::Vec::new_in(&self.ast);
        for mut statement in body.statements.drain(..) {
            let mut hoister = NestedPrimitiveHookCallHoister {
                ast: &self.ast,
                react: self.react,
                ordinal: &mut self.ordinal,
                statements: Vec::new(),
            };
            hoister.visit_statement(&mut statement);
            next.extend(hoister.statements);
            next.push(statement);
        }
        body.statements = next;
    }
}

impl<'a> VisitMut<'a> for PrimitiveHookBodyNormalizer<'a, '_, '_> {
    fn visit_function(&mut self, function: &mut Function<'a>, flags: ScopeFlags) {
        if let Some(body) = &mut function.body {
            self.normalize_body(body);
        }
        oxc_ast_visit::walk_mut::walk_function(self, function, flags);
    }

    fn visit_arrow_function_expression(&mut self, function: &mut ArrowFunctionExpression<'a>) {
        if let Some(body) = function.body.as_function_body_mut() {
            self.normalize_body(body);
        }
        oxc_ast_visit::walk_mut::walk_arrow_function_expression(self, function);
    }
}

struct NestedPrimitiveHookCallHoister<'a, 'r, 's, 'o> {
    ast: &'r AstBuilder<'a>,
    react: &'r ReactBindings<'s>,
    ordinal: &'o mut u32,
    statements: Vec<Statement<'a>>,
}

impl<'a> VisitMut<'a> for NestedPrimitiveHookCallHoister<'a, '_, '_, '_> {
    fn visit_expression(&mut self, expression: &mut Expression<'a>) {
        if let Expression::CallExpression(call) = expression.without_parentheses()
            && (self.react.context_hook_call(call).is_some() || self.react.is_id_call(call))
        {
            let name = self
                .ast
                .allocator()
                .alloc_str(&format!("__vidactPrimitiveHook{}", *self.ordinal));
            *self.ordinal += 1;
            let initializer = expression.take_in(self.ast);
            self.statements.push(variable_statement(
                self.ast,
                VariableDeclarationKind::Const,
                name,
                initializer,
            ));
            *expression = ident(self.ast, name);
            return;
        }
        walk_expression_mut(self, expression);
    }

    fn visit_function(&mut self, _function: &mut Function<'a>, _flags: ScopeFlags) {}

    fn visit_arrow_function_expression(&mut self, _function: &mut ArrowFunctionExpression<'a>) {}
}

impl<'a> VisitMut<'a> for StateElisionNormalizer<'a, '_, '_> {
    fn visit_variable_declarator(&mut self, declarator: &mut VariableDeclarator<'a>) {
        let Some(Expression::CallExpression(call)) = &declarator.init else {
            return;
        };
        if self.react.state_hook_call(call).is_none() {
            return;
        }
        let BindingPattern::ArrayPattern(pattern) = &mut declarator.id else {
            return;
        };
        let [value, Some(_)] = pattern.elements.as_mut_slice() else {
            return;
        };
        if value.is_some() {
            return;
        }
        let name = self
            .ast
            .allocator()
            .alloc_str(&format!("__vidactUnusedState{}", self.ordinal));
        self.ordinal += 1;
        *value = Some(BindingPattern::new_binding_identifier(
            declarator.span,
            name,
            &self.ast,
        ));
    }
}

impl<'a> Visit<'a> for ReactClassComponentFinder<'_, '_> {
    fn visit_class(&mut self, class: &Class<'a>) {
        if self.span.is_some() {
            return;
        }
        if let Some(super_class) = &class.super_class
            && (self.react.is_named_expression(super_class, "Component")
                || self.react.is_named_expression(super_class, "PureComponent"))
        {
            self.span = Some(super_class.span());
            return;
        }
        walk_class(self, class);
    }
}

#[derive(Clone, Copy, Default)]
enum MetadataNamespace {
    #[default]
    Html,
    MathMl,
    Svg,
}

#[derive(Default)]
struct FrameworkMetadataFinder {
    namespace: MetadataNamespace,
    found: bool,
}

impl<'a> Visit<'a> for FrameworkMetadataFinder {
    fn visit_jsx_element(&mut self, element: &JSXElement<'a>) {
        if self.found {
            return;
        }
        let previous = self.namespace;
        if let JSXElementName::Identifier(tag) = &element.opening_element.name {
            if matches!(self.namespace, MetadataNamespace::Html)
                && is_framework_metadata_element(tag.name.as_str(), element)
            {
                self.found = true;
                return;
            }
            self.namespace = match (self.namespace, tag.name.as_str()) {
                (_, "svg") => MetadataNamespace::Svg,
                (_, "math") => MetadataNamespace::MathMl,
                (MetadataNamespace::Svg, "foreignObject") => MetadataNamespace::Html,
                (namespace, _) => namespace,
            };
        }
        oxc_ast_visit::walk::walk_jsx_element(self, element);
        self.namespace = previous;
    }
}

fn has_framework_metadata(program: &Program<'_>) -> bool {
    let mut finder = FrameworkMetadataFinder::default();
    finder.visit_program(program);
    finder.found
}

#[derive(Default)]
struct DomCapabilityFinder {
    forms: bool,
    namespace: bool,
    styles: bool,
}

impl<'a> Visit<'a> for DomCapabilityFinder {
    fn visit_jsx_element(&mut self, element: &JSXElement<'a>) {
        let intrinsic_tag = match &element.opening_element.name {
            JSXElementName::Identifier(tag)
                if tag
                    .name
                    .as_str()
                    .bytes()
                    .next()
                    .is_some_and(|first| first.is_ascii_lowercase()) =>
            {
                Some(tag.name.as_str())
            }
            _ => None,
        };

        if matches!(
            intrinsic_tag,
            Some("input" | "option" | "select" | "textarea")
        ) {
            self.forms = true;
        }
        if matches!(intrinsic_tag, Some("math" | "svg")) {
            self.namespace = true;
        }
        for item in &element.opening_element.attributes {
            match item {
                JSXAttributeItem::SpreadAttribute(_) if intrinsic_tag.is_some() => {
                    self.forms = true;
                    self.styles = true;
                }
                JSXAttributeItem::SpreadAttribute(_) => {}
                JSXAttributeItem::Attribute(attribute) => {
                    let JSXAttributeName::Identifier(name) = &attribute.name else {
                        continue;
                    };
                    let name = name.name.as_str();
                    if name == "__vidactNamespace" {
                        self.namespace = true;
                    }
                    if intrinsic_tag.is_none() {
                        continue;
                    }
                    if name == "style" {
                        self.styles = true;
                    }
                    if matches!(
                        name,
                        "checked"
                            | "defaultChecked"
                            | "defaultValue"
                            | "multiple"
                            | "muted"
                            | "onChange"
                            | "onInput"
                            | "selected"
                            | "value"
                    ) || name.starts_with("__vidactSpread")
                    {
                        self.forms = true;
                        if name.starts_with("__vidactSpread") {
                            self.styles = true;
                        }
                    }
                }
            }
        }
        oxc_ast_visit::walk::walk_jsx_element(self, element);
    }
}

fn dom_capabilities(program: &Program<'_>) -> DomCapabilityFinder {
    let mut finder = DomCapabilityFinder::default();
    finder.visit_program(program);
    finder
}

fn is_framework_metadata_element(name: &str, element: &JSXElement<'_>) -> bool {
    let has_attribute = |expected: &str| {
        element.opening_element.attributes.iter().any(|item| {
            matches!(
                item,
                JSXAttributeItem::Attribute(attribute)
                    if matches!(&attribute.name, JSXAttributeName::Identifier(name) if name.name == expected)
                        && (expected == "async" || attribute.value.is_some())
            )
        })
    };
    if matches!(name, "title" | "meta") {
        return !has_attribute("itemProp");
    }
    if name == "link" {
        if ["itemProp", "onLoad", "onError", "disabled"]
            .into_iter()
            .any(has_attribute)
        {
            return false;
        }
        let is_static_stylesheet = element.opening_element.attributes.iter().any(|item| {
            matches!(
                item,
                JSXAttributeItem::Attribute(attribute)
                    if matches!(&attribute.name, JSXAttributeName::Identifier(name) if name.name == "rel")
                        && matches!(&attribute.value, Some(JSXAttributeValue::StringLiteral(value)) if value.value == "stylesheet")
            )
        });
        return !is_static_stylesheet || has_attribute("precedence");
    }
    (name == "style" && has_attribute("href") && has_attribute("precedence"))
        || (name == "script" && has_attribute("async") && has_attribute("src"))
}

fn transform_program<'a>(
    allocator: &'a Allocator,
    scoping: &Scoping,
    components: &[ComponentIr],
    options: &CompilationOptions,
    program: &mut Program<'a>,
) -> Result<(), Diagnostic> {
    let ast = AstBuilder::new(allocator);
    for name in [
        SCOPE,
        ACTION_FORM,
        BINDING,
        COMBINE_SOURCES,
        COMPILED_EVENT,
        COMPILED_COMPONENT_SPREAD,
        COMPILED_EFFECT,
        COMPILED_IMPERATIVE_HANDLE,
        COMPILED_INSERTION_EFFECT,
        COMPILED_LAYOUT_EFFECT,
        COMPILED_FORM_ACTION,
        COMPILED_SPREAD,
        COMPILED_ROOT,
        CHOOSE,
        CREATE_ASYNC,
        CREATE_ACTION_STATE,
        CREATE_CONTEXT,
        CREATE_DEFERRED,
        CREATE_EXTERNAL_STORE,
        CREATE_FORM_STATUS,
        CREATE_EFFECT_EVENT,
        CREATE_ID,
        CREATE_PROP,
        CREATE_REST_PROP,
        CREATE_REDUCER,
        CREATE_SCOPE,
        CREATE_NARROW_SCOPE,
        CREATE_STATE,
        CREATE_TRANSITION,
        CREATE_MEMO,
        CREATE_OPTIMISTIC,
        DEFERRED,
        DISPATCH,
        ENABLE_DOM_FORMS,
        ENABLE_DOM_NAMESPACE,
        ENABLE_DOM_STYLES,
        INDEXED,
        KEYED,
        ITEM_INDEX,
        ITEM_SCOPE,
        ITEM_VALUE,
        NESTED_PROP,
        PROPS,
        SOURCE,
        WHEN,
    ] {
        if scoping
            .iter_bindings()
            .any(|(_, bindings)| bindings.contains_key(name))
        {
            return Err(unsupported(format!(
                "source binding {name} conflicts with Vidact generated code"
            )));
        }
    }
    for component in components {
        transform_component(allocator, scoping, component, options, program)
            .map_err(|diagnostic| diagnostic.with_fallback_span(component.span))?;
    }
    remove_lowered_react_state_imports(scoping, options, program)?;
    if options.feature_enabled(CompilerFeature::Framework) && has_framework_metadata(program) {
        program.body.insert(
            0,
            Statement::new_expression_statement(
                SPAN,
                call_name(&ast, ENABLE_FRAMEWORK_METADATA, []),
                &ast,
            ),
        );
    }
    let capabilities = dom_capabilities(program);
    let mut prefix = runtime_imports(&ast, program, options);
    if capabilities.forms {
        prefix.push(capability_import(
            &ast,
            "enableDomForms",
            ENABLE_DOM_FORMS,
            "@vidact/runtime/dom/forms",
        ));
    }
    if capabilities.namespace {
        prefix.push(capability_import(
            &ast,
            "enableDomNamespace",
            ENABLE_DOM_NAMESPACE,
            "@vidact/runtime/dom/namespace",
        ));
    }
    if capabilities.styles {
        prefix.push(capability_import(
            &ast,
            "enableDomStyles",
            ENABLE_DOM_STYLES,
            "@vidact/runtime/dom/styles",
        ));
    }
    if capabilities.forms {
        prefix.push(Statement::new_expression_statement(
            SPAN,
            call_name(&ast, ENABLE_DOM_FORMS, []),
            &ast,
        ));
    }
    if capabilities.namespace {
        prefix.push(Statement::new_expression_statement(
            SPAN,
            call_name(&ast, ENABLE_DOM_NAMESPACE, []),
            &ast,
        ));
    }
    if capabilities.styles {
        prefix.push(Statement::new_expression_statement(
            SPAN,
            call_name(&ast, ENABLE_DOM_STYLES, []),
            &ast,
        ));
    }
    for (index, statement) in prefix.into_iter().enumerate() {
        program.body.insert(index, statement);
    }
    Ok(())
}

fn remove_lowered_react_state_imports(
    scoping: &Scoping,
    options: &CompilationOptions,
    program: &mut Program<'_>,
) -> Result<(), Diagnostic> {
    let react = ReactBindings::new(program, scoping);
    let mut usage = PostTransformReactUsage {
        react: &react,
        scoping,
        live_symbols: BTreeSet::new(),
        remaining_state_call: None,
        remaining_compiled_hook_call: None,
        allow_runtime_memos: options.feature_enabled(CompilerFeature::DependencySource),
        allow_runtime_ids: options.feature_enabled(CompilerFeature::DependencySource),
        async_enabled: options.feature_enabled(CompilerFeature::Async),
        concurrent_enabled: options.feature_enabled(CompilerFeature::Concurrent),
        remaining_concurrent_call: None,
        actions_enabled: options.feature_enabled(CompilerFeature::Actions),
        remaining_action_call: None,
        profiling_enabled: options.feature_enabled(CompilerFeature::Profiling),
        remaining_profiling_call: None,
        framework_enabled: options.feature_enabled(CompilerFeature::Framework),
        remaining_framework_call: None,
        remaining_server_framework_call: None,
        remaining_lazy_call: None,
    };
    usage.visit_program(program);
    if let Some(span) = usage.remaining_state_call {
        return Err(unsupported(
            "useState is only supported in compiled component state declarations",
        )
        .with_span(SourceSpan::new(span.start, span.end)));
    }
    if let Some((name, span)) = usage.remaining_compiled_hook_call {
        return Err(unsupported(format!(
            "{name} is only supported in direct compiled component declarations"
        ))
        .with_span(SourceSpan::new(span.start, span.end)));
    }
    if let Some(span) = usage.remaining_lazy_call {
        return Err(unsupported("lazy requires the `async` compiler feature")
            .with_span(SourceSpan::new(span.start, span.end)));
    }
    if let Some((name, span)) = usage.remaining_concurrent_call {
        return Err(
            unsupported(format!("{name} requires the `concurrent` compiler feature"))
                .with_span(SourceSpan::new(span.start, span.end)),
        );
    }
    if let Some((name, span)) = usage.remaining_action_call {
        return Err(
            unsupported(format!("{name} requires the `actions` compiler feature"))
                .with_span(SourceSpan::new(span.start, span.end)),
        );
    }
    if let Some((name, span)) = usage.remaining_profiling_call {
        return Err(
            unsupported(format!("{name} requires the `profiling` compiler feature"))
                .with_span(SourceSpan::new(span.start, span.end)),
        );
    }
    if let Some((name, span)) = usage.remaining_server_framework_call {
        return Err(unsupported(format!(
            "{name} is only supported by the server target with the `framework` compiler feature"
        ))
        .with_span(SourceSpan::new(span.start, span.end)));
    }
    if let Some((name, span)) = usage.remaining_framework_call {
        return Err(
            unsupported(format!("{name} requires the `framework` compiler feature"))
                .with_span(SourceSpan::new(span.start, span.end)),
        );
    }

    let mut empty_imports = Vec::new();
    for (index, statement) in program.body.iter_mut().enumerate() {
        let Statement::ImportDeclaration(import) = statement else {
            continue;
        };
        if import.source.value != "react" {
            continue;
        }
        if import.import_kind == ImportOrExportKind::Type {
            continue;
        }
        let Some(specifiers) = &mut import.specifiers else {
            continue;
        };
        let mut live_state_import = None;
        specifiers.retain(|specifier| match specifier {
            ImportDeclarationSpecifier::ImportSpecifier(specifier) => {
                if specifier.import_kind == ImportOrExportKind::Type {
                    return true;
                }
                let is_state_hook = matches!(
                    &specifier.imported,
                    ModuleExportName::IdentifierName(name)
                        if matches!(name.name.as_str(), "useState" | "useReducer")
                );
                if !is_state_hook {
                    return true;
                }
                let symbol = specifier.local.symbol_id.get();
                if symbol.is_some_and(|symbol| usage.live_symbols.contains(&symbol)) {
                    live_state_import = Some((specifier.local.name.to_string(), specifier.span));
                    return true;
                }
                false
            }
            ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) => specifier
                .local
                .symbol_id
                .get()
                .is_some_and(|symbol| usage.live_symbols.contains(&symbol)),
            ImportDeclarationSpecifier::ImportDefaultSpecifier(_) => true,
        });
        if let Some((name, span)) = live_state_import {
            return Err(unsupported(format!(
                "React state import {name} remains after component lowering; useState and useReducer are only supported in compiled component state declarations"
            ))
            .with_span(SourceSpan::new(span.start, span.end)));
        }
        if specifiers.is_empty() {
            empty_imports.push(index);
        }
    }
    for index in empty_imports.into_iter().rev() {
        program.body.remove(index);
    }
    Ok(())
}

struct PostTransformReactUsage<'r, 's> {
    react: &'r ReactBindings<'s>,
    scoping: &'s Scoping,
    live_symbols: BTreeSet<SymbolId>,
    remaining_state_call: Option<Span>,
    remaining_compiled_hook_call: Option<(&'static str, Span)>,
    allow_runtime_memos: bool,
    allow_runtime_ids: bool,
    async_enabled: bool,
    concurrent_enabled: bool,
    remaining_concurrent_call: Option<(&'static str, Span)>,
    actions_enabled: bool,
    remaining_action_call: Option<(&'static str, Span)>,
    profiling_enabled: bool,
    remaining_profiling_call: Option<(&'static str, Span)>,
    framework_enabled: bool,
    remaining_framework_call: Option<(&'static str, Span)>,
    remaining_server_framework_call: Option<(&'static str, Span)>,
    remaining_lazy_call: Option<Span>,
}

impl<'a> Visit<'a> for PostTransformReactUsage<'_, '_> {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if let Some(name) = self.react.framework_call_name(call) {
            if self.react.is_server_framework_call(call) {
                self.remaining_server_framework_call
                    .get_or_insert((name, call.span));
            } else if !self.framework_enabled {
                self.remaining_framework_call
                    .get_or_insert((name, call.span));
            } else {
                walk_call_expression(self, call);
            }
            return;
        }
        if self.react.is_lazy_call(call) && !self.async_enabled {
            self.remaining_lazy_call.get_or_insert(call.span);
            return;
        }
        let profiling_name = if self.react.is_debug_value_call(call) {
            Some("useDebugValue")
        } else if self.react.is_capture_owner_stack_call(call) {
            Some("captureOwnerStack")
        } else {
            None
        };
        if !self.profiling_enabled
            && let Some(name) = profiling_name
        {
            self.remaining_profiling_call
                .get_or_insert((name, call.span));
            return;
        }
        let action_hook = self
            .react
            .action_hook_call(call)
            .map(ActionHook::name)
            .or_else(|| {
                self.react
                    .is_form_status_call(call)
                    .then_some("useFormStatus")
            });
        if let Some(name) = action_hook {
            if self.actions_enabled {
                self.remaining_compiled_hook_call
                    .get_or_insert((name, call.span));
            } else {
                self.remaining_action_call.get_or_insert((name, call.span));
            }
            return;
        }
        if let Some(hook) = self.react.concurrent_hook_call(call) {
            if self.concurrent_enabled {
                self.remaining_compiled_hook_call
                    .get_or_insert((hook.name(), call.span));
            } else {
                self.remaining_concurrent_call
                    .get_or_insert((hook.name(), call.span));
            }
            return;
        }
        if self.react.is_start_transition_call(call) {
            if !self.concurrent_enabled {
                self.remaining_concurrent_call
                    .get_or_insert(("startTransition", call.span));
                return;
            }
            walk_call_expression(self, call);
            return;
        }
        if self.react.is_flush_sync_call(call) {
            if !self.concurrent_enabled {
                self.remaining_concurrent_call
                    .get_or_insert(("flushSync", call.span));
                return;
            }
            walk_call_expression(self, call);
            return;
        }
        if self.react.state_hook_call(call).is_some() {
            self.remaining_state_call.get_or_insert(call.span);
            return;
        }
        if let Some(hook) = self.react.memo_hook_call(call) {
            if self.allow_runtime_memos {
                walk_call_expression(self, call);
            } else {
                self.remaining_compiled_hook_call
                    .get_or_insert((hook.name(), call.span));
            }
            return;
        }
        if let Some(hook) = self.react.context_hook_call(call) {
            if hook == ContextHook::Use {
                walk_call_expression(self, call);
                return;
            }
            self.remaining_compiled_hook_call
                .get_or_insert((hook.name(), call.span));
            return;
        }
        if self.react.is_sync_external_store_call(call) {
            self.remaining_compiled_hook_call
                .get_or_insert(("useSyncExternalStore", call.span));
            return;
        }
        if self.react.is_effect_event_call(call) {
            self.remaining_compiled_hook_call
                .get_or_insert(("useEffectEvent", call.span));
            return;
        }
        if self.react.is_id_call(call) {
            if self.allow_runtime_ids {
                walk_call_expression(self, call);
            } else {
                self.remaining_compiled_hook_call
                    .get_or_insert(("useId", call.span));
            }
            return;
        }
        walk_call_expression(self, call);
    }

    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        if let Some(symbol) = crate::react_bindings::reference_symbol(identifier, self.scoping) {
            self.live_symbols.insert(symbol);
        }
    }
}

fn transform_component<'a>(
    allocator: &'a Allocator,
    scoping: &Scoping,
    ir: &ComponentIr,
    options: &CompilationOptions,
    program: &mut Program<'a>,
) -> Result<(), Diagnostic> {
    let ast = AstBuilder::new(allocator);
    let mut source_ids = ir
        .sources
        .iter()
        .map(|source| (allocator.alloc_str(&source.name), source.id))
        .collect::<BTreeMap<_, _>>();
    let prop_sources = ir
        .sources
        .iter()
        .filter(|source| source.kind == SourceKind::Prop)
        .map(|source| source.name.as_str())
        .collect::<BTreeSet<_>>();
    let react = ReactBindings::new(program, scoping);
    let (params, body) = component_function_parts_mut(program, &ir.name, ir.span)
        .ok_or_else(|| unsupported(format!("could not find component function {}", ir.name)))?;
    let mut next_source = ir
        .sources
        .iter()
        .map(|source| source.id.get())
        .max()
        .map_or(0, |source| source + 1);
    for statement in &body.statements {
        let Statement::VariableDeclaration(declaration) = statement else {
            continue;
        };
        for declarator in &declaration.declarations {
            if let BindingPattern::ArrayPattern(pattern) = &declarator.id
                && let Some(Expression::CallExpression(call)) = &declarator.init
            {
                let bindings: &[usize] = match (
                    react.concurrent_hook_call(call),
                    react.action_hook_call(call),
                ) {
                    (Some(ConcurrentHook::Transition), _) => &[0],
                    (_, Some(ActionHook::ActionState)) => &[0, 2],
                    (_, Some(ActionHook::Optimistic)) => &[0],
                    _ => &[],
                };
                for index in bindings {
                    let Some(Some(BindingPattern::BindingIdentifier(identifier))) =
                        pattern.elements.get(*index)
                    else {
                        continue;
                    };
                    if source_ids.contains_key(identifier.name.as_str()) {
                        continue;
                    }
                    source_ids.insert(
                        allocator.alloc_str(identifier.name.as_str()),
                        SourceId::new(next_source),
                    );
                    next_source += 1;
                }
                if !bindings.is_empty() {
                    continue;
                }
            }
            let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                continue;
            };
            let Some(Expression::CallExpression(call)) = &declarator.init else {
                continue;
            };
            if (react.context_hook_call(call).is_some()
                || react.is_sync_external_store_call(call)
                || react.concurrent_hook_call(call) == Some(ConcurrentHook::DeferredValue)
                || react.is_form_status_call(call))
                && !source_ids.contains_key(identifier.name.as_str())
            {
                source_ids.insert(
                    allocator.alloc_str(identifier.name.as_str()),
                    SourceId::new(next_source),
                );
                next_source += 1;
            }
        }
    }
    let prop_bindings = prop_binding_symbols(params, &source_ids, &prop_sources, allocator)?;
    let renderable_child_symbols = prop_bindings
        .iter()
        .filter(|binding| binding.public_name.as_deref() == Some("children"))
        .map(|binding| binding.symbol)
        .collect::<BTreeSet<_>>();
    rewrite_component_props_parameter(&ast, params, &prop_bindings);
    let mut render_start = render_suffix_start(body)?;
    let mut source_symbols = BTreeMap::<SymbolId, SourceId>::new();
    let mut state_symbols = BTreeMap::<SymbolId, StateReference<'a>>::new();
    let mut state_setter_sources = BTreeMap::<SymbolId, SourceId>::new();
    let mut state_value_sources = BTreeMap::<SymbolId, SourceId>::new();
    let mut context_sources = BTreeSet::<SourceId>::new();
    let mut external_sources = BTreeSet::<SourceId>::new();
    let mut effect_event_sources = BTreeSet::<SourceId>::new();
    let mut effect_event_symbols = BTreeSet::<SymbolId>::new();
    let mut id_sources = BTreeSet::<SourceId>::new();
    let mut memo_sources = BTreeSet::<SourceId>::new();
    let mut concurrent_sources = BTreeSet::<SourceId>::new();
    let mut action_sources = BTreeSet::<SourceId>::new();
    let iterative_plans = iterative::collect(&ast, body, scoping)?;
    let (mut item_source_symbols, mut item_state_symbols) = item_parameters(body, &ast);
    iterative::register_item_sources(
        &ast,
        &iterative_plans,
        &mut item_source_symbols,
        &mut item_state_symbols,
    );
    state_symbols.extend(item_state_symbols);
    for prop in &prop_bindings {
        source_symbols.insert(prop.symbol, prop.source);
        state_symbols.insert(
            prop.symbol,
            StateReference {
                state_name: ast.allocator().alloc_str(&prop.name),
                setter: false,
                path: Vec::new(),
            },
        );
    }

    for statement in &body.statements {
        let Statement::VariableDeclaration(declaration) = statement else {
            continue;
        };
        for declarator in &declaration.declarations {
            if let Some(Expression::CallExpression(call)) = &declarator.init
                && !options.feature_enabled(CompilerFeature::Actions)
                && let Some(name) = react
                    .action_hook_call(call)
                    .map(ActionHook::name)
                    .or_else(|| react.is_form_status_call(call).then_some("useFormStatus"))
            {
                return Err(
                    unsupported(format!("{name} requires the `actions` compiler feature"))
                        .with_span(SourceSpan::new(call.span.start, call.span.end)),
                );
            }
            if let Some((_, value, setter)) =
                state_binding_symbols(declarator, &source_ids, &react)?
            {
                source_symbols.insert(value.symbol, value.source);
                state_value_sources.insert(value.symbol, value.source);
                state_symbols.insert(
                    value.symbol,
                    StateReference {
                        state_name: ast.allocator().alloc_str(value.name),
                        setter: false,
                        path: Vec::new(),
                    },
                );
                state_symbols.insert(
                    setter.symbol,
                    StateReference {
                        state_name: ast.allocator().alloc_str(value.name),
                        setter: true,
                        path: Vec::new(),
                    },
                );
                state_setter_sources.insert(setter.symbol, value.source);
            } else if let Some((pending, starter)) =
                transition_binding_symbols(declarator, &source_ids, &react)?
            {
                concurrent_sources.insert(pending.source);
                source_symbols.insert(pending.symbol, pending.source);
                state_symbols.insert(
                    pending.symbol,
                    StateReference {
                        state_name: ast.allocator().alloc_str(pending.name),
                        setter: false,
                        path: Vec::new(),
                    },
                );
                state_symbols.insert(
                    starter.symbol,
                    StateReference {
                        state_name: ast.allocator().alloc_str(pending.name),
                        setter: true,
                        path: Vec::new(),
                    },
                );
            } else if let Some(value) = deferred_binding_symbol(declarator, &source_ids, &react)? {
                concurrent_sources.insert(value.source);
                source_symbols.insert(value.symbol, value.source);
                state_symbols.insert(
                    value.symbol,
                    StateReference {
                        state_name: ast.allocator().alloc_str(value.name),
                        setter: false,
                        path: Vec::new(),
                    },
                );
            } else if let Some(bindings) =
                action_state_binding_symbols(declarator, &source_ids, &react)?
            {
                action_sources.extend([bindings.state.source, bindings.pending.source]);
                source_symbols.insert(bindings.state.symbol, bindings.state.source);
                source_symbols.insert(bindings.pending.symbol, bindings.pending.source);
                state_symbols.insert(
                    bindings.state.symbol,
                    StateReference {
                        state_name: ast.allocator().alloc_str(bindings.state.name),
                        setter: false,
                        path: vec!["value".to_string()],
                    },
                );
                state_symbols.insert(
                    bindings.dispatch.symbol,
                    StateReference {
                        state_name: ast.allocator().alloc_str(bindings.state.name),
                        setter: true,
                        path: Vec::new(),
                    },
                );
                state_symbols.insert(
                    bindings.pending.symbol,
                    StateReference {
                        state_name: ast.allocator().alloc_str(bindings.state.name),
                        setter: false,
                        path: vec!["pending".to_string()],
                    },
                );
            } else if let Some((value, add)) =
                optimistic_binding_symbols(declarator, &source_ids, &react)?
            {
                action_sources.insert(value.source);
                source_symbols.insert(value.symbol, value.source);
                state_symbols.insert(
                    value.symbol,
                    StateReference {
                        state_name: ast.allocator().alloc_str(value.name),
                        setter: false,
                        path: Vec::new(),
                    },
                );
                state_symbols.insert(
                    add.symbol,
                    StateReference {
                        state_name: ast.allocator().alloc_str(value.name),
                        setter: true,
                        path: Vec::new(),
                    },
                );
            } else if let Some(value) = form_status_binding_symbol(declarator, &source_ids, &react)?
            {
                action_sources.insert(value.source);
                source_symbols.insert(value.symbol, value.source);
                state_symbols.insert(
                    value.symbol,
                    StateReference {
                        state_name: ast.allocator().alloc_str(value.name),
                        setter: false,
                        path: Vec::new(),
                    },
                );
            } else if let Some((_, value)) = memo_binding_symbol(declarator, &source_ids, &react)? {
                memo_sources.insert(value.source);
                source_symbols.insert(value.symbol, value.source);
                state_symbols.insert(
                    value.symbol,
                    StateReference {
                        state_name: ast.allocator().alloc_str(value.name),
                        setter: false,
                        path: Vec::new(),
                    },
                );
            } else if let Some((_, value)) =
                context_binding_symbol(declarator, &source_ids, &react)?
            {
                context_sources.insert(value.source);
                source_symbols.insert(value.symbol, value.source);
                state_symbols.insert(
                    value.symbol,
                    StateReference {
                        state_name: ast.allocator().alloc_str(value.name),
                        setter: false,
                        path: Vec::new(),
                    },
                );
            } else if let Some(value) =
                external_store_binding_symbol(declarator, &source_ids, &react)?
            {
                external_sources.insert(value.source);
                source_symbols.insert(value.symbol, value.source);
                state_symbols.insert(
                    value.symbol,
                    StateReference {
                        state_name: ast.allocator().alloc_str(value.name),
                        setter: false,
                        path: Vec::new(),
                    },
                );
            } else if let Some((symbol, source)) =
                effect_event_binding_symbol(declarator, &source_ids, &react)?
            {
                effect_event_symbols.insert(symbol);
                if let Some(source) = source {
                    effect_event_sources.insert(source);
                }
            } else if let Some(source) = id_binding_source(declarator, &source_ids, &react) {
                if let Some(source) = source {
                    id_sources.insert(source);
                }
            } else if let BindingPattern::BindingIdentifier(identifier) = &declarator.id
                && let Some(source) = source_ids.get(identifier.name.as_str()).copied()
                && let Some(symbol) = identifier.symbol_id.get()
            {
                source_symbols.insert(symbol, source);
            }
        }
    }

    validate_effect_event_uses(body, &react, scoping, &effect_event_symbols)?;

    propagate_direct_source_aliases(body, scoping, &mut source_symbols, &mut state_symbols);
    let synthetic_derivations = if options.feature_enabled(CompilerFeature::DependencySource) {
        collect_missing_derivations(
            allocator,
            body,
            scoping,
            &react,
            &mut next_source,
            &mut source_ids,
            &mut source_symbols,
            &mut state_symbols,
            &mut memo_sources,
            &item_source_symbols,
        )
    } else {
        Vec::new()
    };
    let synthetic_symbols = synthetic_derivations
        .iter()
        .map(|derivation| derivation.symbol)
        .collect::<BTreeSet<_>>();

    reject_untracked_derived_bindings(
        body,
        scoping,
        &react,
        &source_symbols,
        &item_source_symbols,
    )?;
    let mut render_expression = render::lower_component_render(
        &ast,
        allocator,
        scoping,
        ir,
        body,
        &source_symbols,
        &item_source_symbols,
    )?;
    iterative::lower(
        &ast,
        &mut render_expression,
        &iterative_plans,
        scoping,
        &source_symbols,
        &item_source_symbols,
    )?;

    let removed_statements = iterative::removed_statement_indexes(&iterative_plans);
    for index in removed_statements.iter().rev().copied() {
        body.statements.remove(index);
        if index < render_start {
            render_start -= 1;
        }
    }

    for statement in &mut body.statements {
        let Statement::VariableDeclaration(declaration) = statement else {
            continue;
        };
        let mut contains_derived = false;
        for declarator in &mut declaration.declarations {
            transform_state_declarator(&ast, declarator, &source_ids, &react)?;
            transform_transition_declarator(&ast, declarator, &source_ids, &react, options)?;
            transform_deferred_declarator(
                &ast,
                declarator,
                &source_ids,
                &react,
                options,
                scoping,
                &source_symbols,
                &item_source_symbols,
            )?;
            transform_action_state_declarator(&ast, declarator, &source_ids, &react, options)?;
            transform_optimistic_declarator(
                &ast,
                declarator,
                &source_ids,
                &react,
                options,
                scoping,
                &source_symbols,
                &item_source_symbols,
            )?;
            transform_form_status_declarator(&ast, declarator, &source_ids, &react, options)?;
            transform_memo_declarator(
                &ast,
                declarator,
                &source_ids,
                &react,
                scoping,
                &source_symbols,
                &item_source_symbols,
            )?;
            transform_context_declarator(
                &ast,
                declarator,
                &source_ids,
                &react,
                options,
                scoping,
                &source_symbols,
                &item_source_symbols,
            )?;
            transform_external_store_declarator(
                &ast,
                declarator,
                &source_ids,
                &react,
                scoping,
                &source_symbols,
                &item_source_symbols,
            )?;
            transform_effect_event_declarator(&ast, declarator, &react)?;
            transform_id_declarator(&ast, declarator, &react)?;
            if let BindingPattern::BindingIdentifier(identifier) = &declarator.id
                && (identifier
                    .symbol_id
                    .get()
                    .is_some_and(|symbol| synthetic_symbols.contains(&symbol))
                    || ir.sources.iter().any(|source| {
                        source.kind == SourceKind::Derived
                            && source.name == identifier.name.as_str()
                            && !memo_sources.contains(&source.id)
                            && !concurrent_sources.contains(&source.id)
                            && !action_sources.contains(&source.id)
                            && !context_sources.contains(&source.id)
                            && !external_sources.contains(&source.id)
                            && !effect_event_sources.contains(&source.id)
                            && !id_sources.contains(&source.id)
                    }))
            {
                declarator.kind = VariableDeclarationKind::Let;
                contains_derived = true;
            }
        }
        if contains_derived {
            declaration.kind = VariableDeclarationKind::Let;
        }
    }

    let mut inserted = oxc_allocator::Vec::new_in(&ast);
    inserted.push(scope_statement(
        &ast,
        source_ids
            .values()
            .all(|source| source.get() < NARROW_SOURCE_BITS),
    ));
    inserted.extend(prop_bindings.iter().map(|prop| {
        let mut input = if prop.rest {
            ident(&ast, PROPS)
        } else {
            Expression::from(MemberExpression::new_computed_member_expression(
                SPAN,
                ident(&ast, PROPS),
                Expression::new_string_literal(
                    SPAN,
                    ast.allocator().alloc_str(
                        prop.public_name
                            .as_deref()
                            .expect("direct prop bindings have a public name"),
                    ),
                    None,
                    &ast,
                ),
                false,
                &ast,
            ))
        };
        if !prop.path.is_empty() {
            let path = Expression::new_array_expression(
                SPAN,
                oxc_allocator::Vec::from_iter_in(
                    prop.path.iter().map(|name| {
                        ArrayExpressionElement::from(Expression::new_string_literal(
                            SPAN,
                            ast.allocator().alloc_str(name),
                            None,
                            &ast,
                        ))
                    }),
                    &ast,
                ),
                &ast,
            );
            let defaults = Expression::new_array_expression(
                SPAN,
                oxc_allocator::Vec::from_iter_in(
                    prop.container_defaults.iter().map(|fallback| {
                        ArrayExpressionElement::from(match fallback {
                            Some(fallback) => arrow_expression(
                                &ast,
                                [],
                                fallback.clone_in_with_semantic_ids(allocator),
                            ),
                            None => Expression::new_null_literal(SPAN, &ast),
                        })
                    }),
                    &ast,
                ),
                &ast,
            );
            input = call_name(&ast, NESTED_PROP, [input, path, defaults]);
        }
        let mut arguments = vec![ident(&ast, SCOPE), mask(&ast, &[prop.source]), input];
        if prop.rest {
            arguments.push(Expression::new_array_expression(
                SPAN,
                oxc_allocator::Vec::from_iter_in(
                    prop.rest_exclusions.iter().map(|name| {
                        ArrayExpressionElement::from(Expression::new_string_literal(
                            SPAN,
                            ast.allocator().alloc_str(name),
                            None,
                            &ast,
                        ))
                    }),
                    &ast,
                ),
                &ast,
            ));
        }
        if let Some(default) = &prop.default {
            arguments.push(arrow_expression(
                &ast,
                [],
                default.clone_in_with_semantic_ids(allocator),
            ));
        }
        variable_statement(
            &ast,
            VariableDeclarationKind::Const,
            &prop.name,
            call_name(
                &ast,
                if prop.rest {
                    CREATE_REST_PROP
                } else {
                    CREATE_PROP
                },
                arguments,
            ),
        )
    }));
    inserted.extend(body.statements.drain(..));
    body.statements = inserted;

    let derivations = derived_expressions(body, ir, allocator);
    let render_start = render_start + 1 + prop_bindings.len();
    let mut render_sync_updater_statements = oxc_allocator::Vec::new_in(&ast);
    for statement in &body.statements[..render_start] {
        if !matches!(statement, Statement::IfStatement(_)) {
            continue;
        }
        let writes = immediate_state_setter_writes(
            statement,
            scoping,
            &state_setter_sources,
            &state_value_sources,
        );
        if writes.is_empty() {
            continue;
        }
        let reads = statement_dependencies(
            std::slice::from_ref(statement),
            scoping,
            &source_symbols,
            &item_source_symbols,
        );
        if !reads.item.is_empty() {
            return Err(unsupported(
                "render-phase state synchronization cannot capture keyed item slots",
            ));
        }
        if reads.parent.is_empty() {
            continue;
        }
        render_sync_updater_statements.push(register_derived_statements(
            &ast,
            [statement.clone_in_with_semantic_ids(allocator)],
            &reads.parent.into_iter().collect::<Vec<_>>(),
            &writes.into_iter().collect::<Vec<_>>(),
        ));
    }
    let mut updater_statements = oxc_allocator::Vec::new_in(&ast);
    for updater in &ir.updaters {
        if updater.kind != crate::analysis::UpdaterKind::Derived {
            continue;
        }
        let [write] = updater.writes.as_slice() else {
            return Err(unsupported("derived updater must write exactly one source"));
        };
        if memo_sources.contains(write)
            || concurrent_sources.contains(write)
            || action_sources.contains(write)
            || context_sources.contains(write)
            || external_sources.contains(write)
            || effect_event_sources.contains(write)
            || id_sources.contains(write)
        {
            continue;
        }
        let source = ir
            .sources
            .iter()
            .find(|source| source.id == *write)
            .ok_or_else(|| unsupported("derived updater writes an unknown source"))?;
        let has_phi = ir.reactive_flow.blocks.iter().any(|block| {
            block
                .phis
                .iter()
                .any(|phi| phi.target.source == Some(source.id))
        });
        let computation = if has_phi {
            let symbol = source_symbols
                .iter()
                .find_map(|(symbol, id)| (*id == source.id).then_some(*symbol))
                .ok_or_else(|| {
                    unsupported(format!("missing derived binding for {}", source.name))
                })?;
            derived::computation(
                &ast,
                body,
                scoping,
                ir,
                source.id,
                symbol,
                source.name.as_str(),
            )?
            .ok_or_else(|| {
                unsupported(format!("missing derived computation for {}", source.name))
            })?
        } else if let Some(expression) = derivations.get(source.name.as_str()) {
            derived::DerivedComputation::Expression(
                expression.clone_in_with_semantic_ids(allocator),
            )
        } else {
            return Err(unsupported(format!(
                "missing derived expression for {}",
                source.name
            )));
        };
        let expression_reads = match &computation {
            derived::DerivedComputation::Expression(expression) => {
                dependencies(expression, scoping, &source_symbols, &item_source_symbols)
            }
            derived::DerivedComputation::Statements(statements) => {
                statement_dependencies(statements, scoping, &source_symbols, &item_source_symbols)
            }
        };
        if !expression_reads.item.is_empty() {
            return Err(unsupported(
                "component phi-derived values cannot depend on keyed item slots",
            ));
        }
        let mut reads = updater.reads.iter().copied().collect::<BTreeSet<_>>();
        reads.extend(expression_reads.parent);
        for write in &updater.writes {
            reads.remove(write);
        }
        let reads = reads.into_iter().collect::<Vec<_>>();
        updater_statements.push(match computation {
            derived::DerivedComputation::Expression(expression) => register_derived(
                &ast,
                source.name.as_str(),
                expression,
                &reads,
                &updater.writes,
            ),
            derived::DerivedComputation::Statements(statements) => {
                register_derived_statements(&ast, statements, &reads, &updater.writes)
            }
        });
    }
    let mut synthetic_updater_statements = oxc_allocator::Vec::new_in(&ast);
    synthetic_updater_statements.extend(render_sync_updater_statements);
    for derivation in &synthetic_derivations {
        let reads = dependencies(
            &derivation.expression,
            scoping,
            &source_symbols,
            &item_source_symbols,
        );
        if !reads.item.is_empty() {
            return Err(unsupported(
                "expanded custom-hook derivations cannot depend on keyed item slots",
            ));
        }
        let reads = reads
            .parent
            .into_iter()
            .filter(|source| *source != derivation.source)
            .collect::<Vec<_>>();
        synthetic_updater_statements.push(register_derived(
            &ast,
            derivation.name,
            derivation.expression.clone_in_with_semantic_ids(allocator),
            &reads,
            &[derivation.source],
        ));
    }
    synthetic_updater_statements.extend(updater_statements);
    let updater_statements = synthetic_updater_statements;
    let updater_count = updater_statements.len();
    for (offset, statement) in updater_statements.into_iter().enumerate() {
        body.statements.insert(render_start + offset, statement);
    }

    body.statements.truncate(render_start + updater_count);
    body.statements.push(Statement::new_return_statement(
        SPAN,
        Some(call_name(
            &ast,
            COMPILED_ROOT,
            [
                ident(&ast, SCOPE),
                arrow_expression(&ast, [], render_expression),
            ],
        )),
        &ast,
    ));
    let mut jsx_transformer = JsxBindingTransformer {
        ast: &ast,
        scoping,
        source_symbols: &source_symbols,
        item_source_symbols: &item_source_symbols,
        options,
        react: &react,
        renderable_depth: 0,
        reactive_spread_overrides: BTreeMap::new(),
        diagnostic: None,
    };
    jsx_transformer.visit_function_body(body);
    if let Some(diagnostic) = jsx_transformer.diagnostic {
        return Err(diagnostic);
    }
    namespace::annotate(&ast, body, scoping, &renderable_child_symbols)?;
    MultiStateReferenceRewriter {
        ast: &ast,
        scoping,
        states: &state_symbols,
    }
    .visit_function_body(body);

    Ok(())
}

#[derive(Clone, Copy)]
struct StateBinding<'a> {
    name: &'a str,
    symbol: SymbolId,
    source: SourceId,
}

struct ActionStateBindings<'a> {
    state: StateBinding<'a>,
    dispatch: StateBinding<'a>,
    pending: StateBinding<'a>,
}

struct PropBinding<'a> {
    name: String,
    public_name: Option<String>,
    symbol: SymbolId,
    source: SourceId,
    default: Option<Expression<'a>>,
    rest: bool,
    rest_exclusions: Vec<String>,
    path: Vec<String>,
    container_defaults: Vec<Option<Expression<'a>>>,
}

#[derive(Clone)]
struct StateReference<'a> {
    state_name: &'a str,
    setter: bool,
    path: Vec<String>,
}

fn lookup_source(sources: &BTreeMap<&str, SourceId>, name: &str) -> Option<SourceId> {
    sources.get(name).copied().or_else(|| {
        let generated = name.strip_prefix("__vidactHook")?;
        let (_, generated) = generated.split_once('_')?;
        let (_, original) = generated.split_once('_')?;
        sources.get(original).copied()
    })
}

fn state_binding_symbols<'a>(
    declarator: &'a VariableDeclarator<'a>,
    sources: &BTreeMap<&str, SourceId>,
    react: &ReactBindings<'_>,
) -> Result<Option<(StateHook, StateBinding<'a>, StateBinding<'a>)>, Diagnostic> {
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return Ok(None);
    };
    let Some(Expression::CallExpression(call)) = &declarator.init else {
        return Ok(None);
    };
    let Some(hook) = react.state_hook_call(call) else {
        return Ok(None);
    };
    let [
        Some(BindingPattern::BindingIdentifier(value)),
        Some(BindingPattern::BindingIdentifier(setter)),
    ] = pattern.elements.as_slice()
    else {
        return Err(unsupported(format!(
            "{} must bind [value, {}]",
            hook.name(),
            if hook == StateHook::State {
                "setter"
            } else {
                "dispatch"
            }
        ))
        .with_span(SourceSpan::new(pattern.span.start, pattern.span.end)));
    };
    let source = lookup_source(sources, value.name.as_str()).ok_or_else(|| {
        unsupported(format!("state {} is absent from analysis", value.name))
            .with_span(SourceSpan::new(value.span.start, value.span.end))
    })?;
    let value_symbol = value
        .symbol_id
        .get()
        .ok_or_else(|| analysis_error(format!("state {} has no semantic symbol", value.name)))?;
    let setter_symbol = setter
        .symbol_id
        .get()
        .ok_or_else(|| analysis_error(format!("setter {} has no semantic symbol", setter.name)))?;
    Ok(Some((
        hook,
        StateBinding {
            name: value.name.as_str(),
            symbol: value_symbol,
            source,
        },
        StateBinding {
            name: setter.name.as_str(),
            symbol: setter_symbol,
            source,
        },
    )))
}

fn transition_binding_symbols<'a>(
    declarator: &'a VariableDeclarator<'a>,
    sources: &BTreeMap<&str, SourceId>,
    react: &ReactBindings<'_>,
) -> Result<Option<(StateBinding<'a>, StateBinding<'a>)>, Diagnostic> {
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return Ok(None);
    };
    let Some(Expression::CallExpression(call)) = &declarator.init else {
        return Ok(None);
    };
    if react.concurrent_hook_call(call) != Some(ConcurrentHook::Transition) {
        return Ok(None);
    }
    let [
        Some(BindingPattern::BindingIdentifier(pending)),
        Some(BindingPattern::BindingIdentifier(starter)),
    ] = pattern.elements.as_slice()
    else {
        return Err(
            unsupported("useTransition must bind [isPending, startTransition]")
                .with_span(SourceSpan::new(pattern.span.start, pattern.span.end)),
        );
    };
    let source = lookup_source(sources, pending.name.as_str()).ok_or_else(|| {
        unsupported(format!(
            "transition state {} is absent from analysis",
            pending.name
        ))
        .with_span(SourceSpan::new(pending.span.start, pending.span.end))
    })?;
    let pending_symbol = pending.symbol_id.get().ok_or_else(|| {
        analysis_error(format!(
            "transition state {} has no semantic symbol",
            pending.name
        ))
    })?;
    let starter_symbol = starter.symbol_id.get().ok_or_else(|| {
        analysis_error(format!(
            "transition starter {} has no semantic symbol",
            starter.name
        ))
    })?;
    Ok(Some((
        StateBinding {
            name: pending.name.as_str(),
            symbol: pending_symbol,
            source,
        },
        StateBinding {
            name: starter.name.as_str(),
            symbol: starter_symbol,
            source,
        },
    )))
}

fn deferred_binding_symbol<'a>(
    declarator: &'a VariableDeclarator<'a>,
    sources: &BTreeMap<&str, SourceId>,
    react: &ReactBindings<'_>,
) -> Result<Option<StateBinding<'a>>, Diagnostic> {
    let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
        return Ok(None);
    };
    let Some(Expression::CallExpression(call)) = &declarator.init else {
        return Ok(None);
    };
    if react.concurrent_hook_call(call) != Some(ConcurrentHook::DeferredValue) {
        return Ok(None);
    }
    let source = sources
        .get(identifier.name.as_str())
        .copied()
        .ok_or_else(|| {
            unsupported(format!(
                "deferred value {} is absent from analysis",
                identifier.name
            ))
            .with_span(SourceSpan::new(identifier.span.start, identifier.span.end))
        })?;
    let symbol = identifier.symbol_id.get().ok_or_else(|| {
        analysis_error(format!(
            "deferred value {} has no semantic symbol",
            identifier.name
        ))
    })?;
    Ok(Some(StateBinding {
        name: identifier.name.as_str(),
        symbol,
        source,
    }))
}

fn action_state_binding_symbols<'a>(
    declarator: &'a VariableDeclarator<'a>,
    sources: &BTreeMap<&str, SourceId>,
    react: &ReactBindings<'_>,
) -> Result<Option<ActionStateBindings<'a>>, Diagnostic> {
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return Ok(None);
    };
    let Some(Expression::CallExpression(call)) = &declarator.init else {
        return Ok(None);
    };
    if react.action_hook_call(call) != Some(ActionHook::ActionState) {
        return Ok(None);
    }
    let [
        Some(BindingPattern::BindingIdentifier(state)),
        Some(BindingPattern::BindingIdentifier(dispatch)),
        Some(BindingPattern::BindingIdentifier(pending)),
    ] = pattern.elements.as_slice()
    else {
        return Err(
            unsupported("useActionState must bind [state, dispatch, isPending]")
                .with_span(SourceSpan::new(pattern.span.start, pattern.span.end)),
        );
    };
    let state_source = lookup_source(sources, state.name.as_str()).ok_or_else(|| {
        unsupported(format!(
            "action state {} is absent from analysis",
            state.name
        ))
        .with_span(SourceSpan::new(state.span.start, state.span.end))
    })?;
    let pending_source = lookup_source(sources, pending.name.as_str()).ok_or_else(|| {
        unsupported(format!(
            "action pending state {} is absent from analysis",
            pending.name
        ))
        .with_span(SourceSpan::new(pending.span.start, pending.span.end))
    })?;
    Ok(Some(ActionStateBindings {
        state: resolved_state_binding(state, state_source, "action state")?,
        dispatch: resolved_state_binding(dispatch, state_source, "action dispatch")?,
        pending: resolved_state_binding(pending, pending_source, "action pending state")?,
    }))
}

fn optimistic_binding_symbols<'a>(
    declarator: &'a VariableDeclarator<'a>,
    sources: &BTreeMap<&str, SourceId>,
    react: &ReactBindings<'_>,
) -> Result<Option<(StateBinding<'a>, StateBinding<'a>)>, Diagnostic> {
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return Ok(None);
    };
    let Some(Expression::CallExpression(call)) = &declarator.init else {
        return Ok(None);
    };
    if react.action_hook_call(call) != Some(ActionHook::Optimistic) {
        return Ok(None);
    }
    let [
        Some(BindingPattern::BindingIdentifier(value)),
        Some(BindingPattern::BindingIdentifier(add)),
    ] = pattern.elements.as_slice()
    else {
        return Err(
            unsupported("useOptimistic must bind [value, addOptimistic]")
                .with_span(SourceSpan::new(pattern.span.start, pattern.span.end)),
        );
    };
    let source = lookup_source(sources, value.name.as_str()).ok_or_else(|| {
        unsupported(format!(
            "optimistic value {} is absent from analysis",
            value.name
        ))
        .with_span(SourceSpan::new(value.span.start, value.span.end))
    })?;
    Ok(Some((
        resolved_state_binding(value, source, "optimistic value")?,
        resolved_state_binding(add, source, "optimistic dispatcher")?,
    )))
}

fn form_status_binding_symbol<'a>(
    declarator: &'a VariableDeclarator<'a>,
    sources: &BTreeMap<&str, SourceId>,
    react: &ReactBindings<'_>,
) -> Result<Option<StateBinding<'a>>, Diagnostic> {
    let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
        return Ok(None);
    };
    let Some(Expression::CallExpression(call)) = &declarator.init else {
        return Ok(None);
    };
    if !react.is_form_status_call(call) {
        return Ok(None);
    }
    let source = sources
        .get(identifier.name.as_str())
        .copied()
        .ok_or_else(|| {
            unsupported(format!(
                "form status {} is absent from analysis",
                identifier.name
            ))
            .with_span(SourceSpan::new(identifier.span.start, identifier.span.end))
        })?;
    Ok(Some(resolved_state_binding(
        identifier,
        source,
        "form status",
    )?))
}

fn resolved_state_binding<'a>(
    identifier: &'a BindingIdentifier<'a>,
    source: SourceId,
    kind: &str,
) -> Result<StateBinding<'a>, Diagnostic> {
    let symbol = identifier.symbol_id.get().ok_or_else(|| {
        analysis_error(format!("{kind} {} has no semantic symbol", identifier.name))
    })?;
    Ok(StateBinding {
        name: identifier.name.as_str(),
        symbol,
        source,
    })
}

fn memo_binding_symbol<'a>(
    declarator: &'a VariableDeclarator<'a>,
    sources: &BTreeMap<&str, SourceId>,
    react: &ReactBindings<'_>,
) -> Result<Option<(MemoHook, StateBinding<'a>)>, Diagnostic> {
    let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
        return Ok(None);
    };
    let Some(Expression::CallExpression(call)) = &declarator.init else {
        return Ok(None);
    };
    let Some(hook) = react.memo_hook_call(call) else {
        return Ok(None);
    };
    let Some(source) = lookup_source(sources, identifier.name.as_str()) else {
        return Ok(None);
    };
    let symbol = identifier.symbol_id.get().ok_or_else(|| {
        analysis_error(format!("memo {} has no semantic symbol", identifier.name))
    })?;
    Ok(Some((
        hook,
        StateBinding {
            name: identifier.name.as_str(),
            symbol,
            source,
        },
    )))
}

fn context_binding_symbol<'a>(
    declarator: &'a VariableDeclarator<'a>,
    sources: &BTreeMap<&str, SourceId>,
    react: &ReactBindings<'_>,
) -> Result<Option<(ContextHook, StateBinding<'a>)>, Diagnostic> {
    let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
        return Ok(None);
    };
    let Some(Expression::CallExpression(call)) = &declarator.init else {
        return Ok(None);
    };
    let Some(hook) = react.context_hook_call(call) else {
        return Ok(None);
    };
    let source = lookup_source(sources, identifier.name.as_str()).ok_or_else(|| {
        unsupported(format!(
            "context {} is absent from analysis",
            identifier.name
        ))
        .with_span(SourceSpan::new(identifier.span.start, identifier.span.end))
    })?;
    let symbol = identifier.symbol_id.get().ok_or_else(|| {
        analysis_error(format!(
            "context {} has no semantic symbol",
            identifier.name
        ))
    })?;
    Ok(Some((
        hook,
        StateBinding {
            name: identifier.name.as_str(),
            symbol,
            source,
        },
    )))
}

fn external_store_binding_symbol<'a>(
    declarator: &'a VariableDeclarator<'a>,
    sources: &BTreeMap<&str, SourceId>,
    react: &ReactBindings<'_>,
) -> Result<Option<StateBinding<'a>>, Diagnostic> {
    let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
        return Ok(None);
    };
    let Some(Expression::CallExpression(call)) = &declarator.init else {
        return Ok(None);
    };
    if !react.is_sync_external_store_call(call) {
        return Ok(None);
    }
    let source = sources
        .get(identifier.name.as_str())
        .copied()
        .ok_or_else(|| {
            unsupported(format!(
                "external store {} is absent from analysis",
                identifier.name
            ))
            .with_span(SourceSpan::new(identifier.span.start, identifier.span.end))
        })?;
    let symbol = identifier.symbol_id.get().ok_or_else(|| {
        analysis_error(format!(
            "external store {} has no semantic symbol",
            identifier.name
        ))
    })?;
    Ok(Some(StateBinding {
        name: identifier.name.as_str(),
        symbol,
        source,
    }))
}

fn effect_event_binding_symbol(
    declarator: &VariableDeclarator<'_>,
    sources: &BTreeMap<&str, SourceId>,
    react: &ReactBindings<'_>,
) -> Result<Option<(SymbolId, Option<SourceId>)>, Diagnostic> {
    let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
        return Ok(None);
    };
    let Some(Expression::CallExpression(call)) = &declarator.init else {
        return Ok(None);
    };
    if !react.is_effect_event_call(call) {
        return Ok(None);
    }
    let symbol = identifier.symbol_id.get().ok_or_else(|| {
        analysis_error(format!(
            "effect event {} has no semantic symbol",
            identifier.name
        ))
    })?;
    Ok(Some((
        symbol,
        lookup_source(sources, identifier.name.as_str()),
    )))
}

fn id_binding_source(
    declarator: &VariableDeclarator<'_>,
    sources: &BTreeMap<&str, SourceId>,
    react: &ReactBindings<'_>,
) -> Option<Option<SourceId>> {
    let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
        return None;
    };
    let Some(Expression::CallExpression(call)) = &declarator.init else {
        return None;
    };
    react
        .is_id_call(call)
        .then(|| lookup_source(sources, identifier.name.as_str()))
}

fn transform_state_declarator<'a>(
    ast: &AstBuilder<'a>,
    declarator: &mut VariableDeclarator<'a>,
    sources: &BTreeMap<&str, SourceId>,
    react: &ReactBindings<'_>,
) -> Result<(), Diagnostic> {
    let Some((hook, value, _)) = state_binding_symbols(declarator, sources, react)? else {
        return Ok(());
    };
    let value_name = atom(ast, value.name);
    let value_source = value.source;
    let Some(Expression::CallExpression(call)) = &declarator.init else {
        unreachable!();
    };
    let mut arguments = call
        .arguments
        .iter()
        .map(|argument| {
            argument
                .as_expression()
                .ok_or_else(|| {
                    let span = argument.span();
                    unsupported("spread state hook arguments are unsupported")
                        .with_span(SourceSpan::new(span.start, span.end))
                })
                .map(|expression| expression.clone_in_with_semantic_ids(ast.allocator()))
        })
        .collect::<Result<Vec<_>, _>>()?;
    match (hook, arguments.len()) {
        (StateHook::State, 0 | 1) | (StateHook::Reducer, 2 | 3) => {}
        (StateHook::State, _) => {
            return Err(unsupported("useState requires exactly one initializer")
                .with_span(SourceSpan::new(call.span.start, call.span.end)));
        }
        (StateHook::Reducer, _) => {
            return Err(unsupported(
                "useReducer requires a reducer, initial argument, and optional initializer",
            )
            .with_span(SourceSpan::new(call.span.start, call.span.end)));
        }
    }
    if hook == StateHook::State && arguments.is_empty() {
        arguments.push(ident(ast, "undefined"));
    }
    declarator.id = BindingPattern::new_binding_identifier(SPAN, value_name, ast);
    let mut runtime_arguments = vec![ident(ast, SCOPE), mask(ast, &[value_source])];
    runtime_arguments.extend(arguments);
    declarator.init = Some(call_name(
        ast,
        if hook == StateHook::State {
            CREATE_STATE
        } else {
            CREATE_REDUCER
        },
        runtime_arguments,
    ));
    Ok(())
}

fn transform_transition_declarator<'a>(
    ast: &AstBuilder<'a>,
    declarator: &mut VariableDeclarator<'a>,
    sources: &BTreeMap<&str, SourceId>,
    react: &ReactBindings<'_>,
    options: &CompilationOptions,
) -> Result<(), Diagnostic> {
    let Some((pending, _)) = transition_binding_symbols(declarator, sources, react)? else {
        return Ok(());
    };
    let Some(Expression::CallExpression(call)) = &declarator.init else {
        unreachable!();
    };
    if !options.feature_enabled(CompilerFeature::Concurrent) {
        return Err(
            unsupported("useTransition requires the `concurrent` compiler feature")
                .with_span(SourceSpan::new(call.span.start, call.span.end)),
        );
    }
    if !call.arguments.is_empty() {
        return Err(unsupported("useTransition does not accept arguments")
            .with_span(SourceSpan::new(call.span.start, call.span.end)));
    }
    let pending_name = atom(ast, pending.name);
    let pending_source = pending.source;
    declarator.id = BindingPattern::new_binding_identifier(SPAN, pending_name, ast);
    declarator.init = Some(call_name(
        ast,
        CREATE_TRANSITION,
        [ident(ast, SCOPE), mask(ast, &[pending_source])],
    ));
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn transform_deferred_declarator<'a>(
    ast: &AstBuilder<'a>,
    declarator: &mut VariableDeclarator<'a>,
    sources: &BTreeMap<&str, SourceId>,
    react: &ReactBindings<'_>,
    options: &CompilationOptions,
    scoping: &Scoping,
    source_symbols: &BTreeMap<SymbolId, SourceId>,
    item_source_symbols: &BTreeMap<SymbolId, SourceId>,
) -> Result<(), Diagnostic> {
    let Some(value) = deferred_binding_symbol(declarator, sources, react)? else {
        return Ok(());
    };
    let Some(Expression::CallExpression(call)) = &declarator.init else {
        unreachable!();
    };
    if !options.feature_enabled(CompilerFeature::Concurrent) {
        return Err(
            unsupported("useDeferredValue requires the `concurrent` compiler feature")
                .with_span(SourceSpan::new(call.span.start, call.span.end)),
        );
    }
    if !matches!(call.arguments.len(), 1 | 2) || call.arguments.iter().any(Argument::is_spread) {
        return Err(
            unsupported("useDeferredValue requires a value and optional initial value")
                .with_span(SourceSpan::new(call.span.start, call.span.end)),
        );
    }
    let input = call.arguments[0]
        .as_expression()
        .expect("spread arguments were rejected");
    let reads = dependencies(input, scoping, source_symbols, item_source_symbols);
    if !reads.item.is_empty() {
        return Err(
            unsupported("component deferred values cannot capture keyed item slots")
                .with_span(SourceSpan::from_oxc(input.span())),
        );
    }
    let mut arguments = vec![
        ident(ast, SCOPE),
        dependency_mask(ast, &reads.parent),
        mask(ast, &[value.source]),
        arrow_expression(ast, [], input.clone_in_with_semantic_ids(ast.allocator())),
    ];
    if let Some(initial) = call.arguments.get(1) {
        arguments.push(
            initial
                .as_expression()
                .expect("spread arguments were rejected")
                .clone_in_with_semantic_ids(ast.allocator()),
        );
    }
    declarator.init = Some(call_name(ast, CREATE_DEFERRED, arguments));
    Ok(())
}

fn transform_action_state_declarator<'a>(
    ast: &AstBuilder<'a>,
    declarator: &mut VariableDeclarator<'a>,
    sources: &BTreeMap<&str, SourceId>,
    react: &ReactBindings<'_>,
    options: &CompilationOptions,
) -> Result<(), Diagnostic> {
    let Some(bindings) = action_state_binding_symbols(declarator, sources, react)? else {
        return Ok(());
    };
    let Some(Expression::CallExpression(call)) = &declarator.init else {
        unreachable!();
    };
    if !options.feature_enabled(CompilerFeature::Actions) {
        return Err(
            unsupported("useActionState requires the `actions` compiler feature")
                .with_span(SourceSpan::new(call.span.start, call.span.end)),
        );
    }
    if !matches!(call.arguments.len(), 2 | 3) || call.arguments.iter().any(Argument::is_spread) {
        return Err(unsupported(
            "useActionState requires an action, initial state, and optional permalink",
        )
        .with_span(SourceSpan::new(call.span.start, call.span.end)));
    }
    let arguments = call
        .arguments
        .iter()
        .map(|argument| {
            argument
                .as_expression()
                .expect("spread arguments were rejected")
                .clone_in_with_semantic_ids(ast.allocator())
        })
        .collect::<Vec<_>>();
    let state_name = bindings.state.name.to_string();
    let state_source = bindings.state.source;
    let pending_source = bindings.pending.source;
    declarator.id = BindingPattern::new_binding_identifier(SPAN, atom(ast, &state_name), ast);
    let mut runtime_arguments = vec![
        ident(ast, SCOPE),
        mask(ast, &[state_source]),
        mask(ast, &[pending_source]),
    ];
    runtime_arguments.extend(arguments);
    declarator.init = Some(call_name(ast, CREATE_ACTION_STATE, runtime_arguments));
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn transform_optimistic_declarator<'a>(
    ast: &AstBuilder<'a>,
    declarator: &mut VariableDeclarator<'a>,
    sources: &BTreeMap<&str, SourceId>,
    react: &ReactBindings<'_>,
    options: &CompilationOptions,
    scoping: &Scoping,
    source_symbols: &BTreeMap<SymbolId, SourceId>,
    item_source_symbols: &BTreeMap<SymbolId, SourceId>,
) -> Result<(), Diagnostic> {
    let Some((value, _)) = optimistic_binding_symbols(declarator, sources, react)? else {
        return Ok(());
    };
    let Some(Expression::CallExpression(call)) = &declarator.init else {
        unreachable!();
    };
    if !options.feature_enabled(CompilerFeature::Actions) {
        return Err(
            unsupported("useOptimistic requires the `actions` compiler feature")
                .with_span(SourceSpan::new(call.span.start, call.span.end)),
        );
    }
    if !matches!(call.arguments.len(), 1 | 2) || call.arguments.iter().any(Argument::is_spread) {
        return Err(
            unsupported("useOptimistic requires a passthrough value and optional reducer")
                .with_span(SourceSpan::new(call.span.start, call.span.end)),
        );
    }
    let input = call.arguments[0]
        .as_expression()
        .expect("spread arguments were rejected");
    let reads = dependencies(input, scoping, source_symbols, item_source_symbols);
    if !reads.item.is_empty() {
        return Err(
            unsupported("component optimistic values cannot capture keyed item slots")
                .with_span(SourceSpan::from_oxc(input.span())),
        );
    }
    let mut arguments = vec![
        ident(ast, SCOPE),
        dependency_mask(ast, &reads.parent),
        mask(ast, &[value.source]),
        arrow_expression(ast, [], input.clone_in_with_semantic_ids(ast.allocator())),
    ];
    if let Some(reducer) = call.arguments.get(1) {
        arguments.push(
            reducer
                .as_expression()
                .expect("spread arguments were rejected")
                .clone_in_with_semantic_ids(ast.allocator()),
        );
    }
    declarator.id = BindingPattern::new_binding_identifier(SPAN, atom(ast, value.name), ast);
    declarator.init = Some(call_name(ast, CREATE_OPTIMISTIC, arguments));
    Ok(())
}

fn transform_form_status_declarator<'a>(
    ast: &AstBuilder<'a>,
    declarator: &mut VariableDeclarator<'a>,
    sources: &BTreeMap<&str, SourceId>,
    react: &ReactBindings<'_>,
    options: &CompilationOptions,
) -> Result<(), Diagnostic> {
    let Some(value) = form_status_binding_symbol(declarator, sources, react)? else {
        return Ok(());
    };
    let Some(Expression::CallExpression(call)) = &declarator.init else {
        unreachable!();
    };
    if !options.feature_enabled(CompilerFeature::Actions) {
        return Err(
            unsupported("useFormStatus requires the `actions` compiler feature")
                .with_span(SourceSpan::new(call.span.start, call.span.end)),
        );
    }
    if !call.arguments.is_empty() {
        return Err(unsupported("useFormStatus does not accept arguments")
            .with_span(SourceSpan::new(call.span.start, call.span.end)));
    }
    let value_name = value.name.to_string();
    let value_source = value.source;
    declarator.id = BindingPattern::new_binding_identifier(SPAN, atom(ast, &value_name), ast);
    declarator.init = Some(call_name(
        ast,
        CREATE_FORM_STATUS,
        [ident(ast, SCOPE), mask(ast, &[value_source])],
    ));
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn transform_memo_declarator<'a>(
    ast: &AstBuilder<'a>,
    declarator: &mut VariableDeclarator<'a>,
    sources: &BTreeMap<&str, SourceId>,
    react: &ReactBindings<'_>,
    scoping: &Scoping,
    source_symbols: &BTreeMap<SymbolId, SourceId>,
    item_source_symbols: &BTreeMap<SymbolId, SourceId>,
) -> Result<(), Diagnostic> {
    let Some((hook, value)) = memo_binding_symbol(declarator, sources, react)? else {
        return Ok(());
    };
    let Some(Expression::CallExpression(hook_call)) = &declarator.init else {
        unreachable!();
    };
    if hook_call.arguments.len() != 2 || hook_call.arguments.iter().any(Argument::is_spread) {
        return Err(unsupported(
            "useMemo and useCallback require a value factory and inline dependency array",
        )
        .with_span(SourceSpan::new(hook_call.span.start, hook_call.span.end)));
    }
    let factory = hook_call.arguments[0]
        .as_expression()
        .expect("spread arguments were rejected");
    let dependency_expression = hook_call.arguments[1]
        .as_expression()
        .expect("spread arguments were rejected");
    let Expression::ArrayExpression(dependency_array) = dependency_expression.without_parentheses()
    else {
        return Err(unsupported("memo dependencies must be an inline array")
            .with_span(SourceSpan::from_oxc(dependency_expression.span())));
    };
    if dependency_array.elements.iter().any(|element| {
        matches!(
            element,
            ArrayExpressionElement::SpreadElement(_) | ArrayExpressionElement::Elision(_)
        )
    }) {
        return Err(unsupported("memo dependencies must have a static length")
            .with_span(SourceSpan::from_oxc(dependency_expression.span())));
    }
    let reads = dependencies(
        dependency_expression,
        scoping,
        source_symbols,
        item_source_symbols,
    );
    if !reads.item.is_empty() {
        return Err(
            unsupported("component memo values cannot capture keyed item slots")
                .with_span(SourceSpan::new(hook_call.span.start, hook_call.span.end)),
        );
    }
    let snapshot = snapshot_effect_create(ast, factory, scoping, source_symbols);
    let evaluate = arrow_expression(
        ast,
        [],
        match hook {
            MemoHook::Callback => snapshot,
            MemoHook::Memo => call(ast, snapshot, []),
        },
    );
    let read_dependencies = arrow_expression(
        ast,
        [],
        dependency_expression.clone_in_with_semantic_ids(ast.allocator()),
    );
    declarator.init = Some(call_name(
        ast,
        CREATE_MEMO,
        [
            ident(ast, SCOPE),
            dependency_mask(ast, &reads.parent),
            mask(ast, &[value.source]),
            evaluate,
            read_dependencies,
        ],
    ));
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn transform_context_declarator<'a>(
    ast: &AstBuilder<'a>,
    declarator: &mut VariableDeclarator<'a>,
    sources: &BTreeMap<&str, SourceId>,
    react: &ReactBindings<'_>,
    options: &CompilationOptions,
    scoping: &Scoping,
    source_symbols: &BTreeMap<SymbolId, SourceId>,
    item_source_symbols: &BTreeMap<SymbolId, SourceId>,
) -> Result<(), Diagnostic> {
    let Some((hook, value)) = context_binding_symbol(declarator, sources, react)? else {
        return Ok(());
    };
    let Some(Expression::CallExpression(hook_call)) = &declarator.init else {
        unreachable!();
    };
    if hook_call.arguments.len() != 1 || hook_call.arguments[0].is_spread() {
        return Err(
            unsupported("useContext and use require exactly one context argument")
                .with_span(SourceSpan::new(hook_call.span.start, hook_call.span.end)),
        );
    }
    let context = hook_call.arguments[0]
        .as_expression()
        .expect("spread arguments were rejected");
    if hook == ContextHook::Use
        && !options.feature_enabled(CompilerFeature::Async)
        && is_obvious_promise_expression(&context)
    {
        return Err(
            unsupported("use(promise) requires the `async` compiler feature")
                .with_span(SourceSpan::new(hook_call.span.start, hook_call.span.end)),
        );
    }
    if hook == ContextHook::Use && options.feature_enabled(CompilerFeature::Async) {
        let reads = dependencies(context, scoping, source_symbols, item_source_symbols);
        if !reads.item.is_empty() {
            return Err(
                unsupported("component async values cannot capture keyed item slots")
                    .with_span(SourceSpan::from_oxc(context.span())),
            );
        }
        declarator.init = Some(call_name(
            ast,
            CREATE_ASYNC,
            [
                ident(ast, SCOPE),
                dependency_mask(ast, &reads.parent),
                mask(ast, &[value.source]),
                arrow_expression(ast, [], context.clone_in_with_semantic_ids(ast.allocator())),
            ],
        ));
    } else {
        declarator.init = Some(call_name(
            ast,
            CREATE_CONTEXT,
            [
                ident(ast, SCOPE),
                mask(ast, &[value.source]),
                context.clone_in_with_semantic_ids(ast.allocator()),
            ],
        ));
    }
    Ok(())
}

pub(super) fn is_obvious_promise_expression(expression: &Expression<'_>) -> bool {
    match expression.without_parentheses() {
        Expression::NewExpression(expression) => expression
            .callee
            .get_identifier_reference()
            .is_some_and(|identifier| identifier.name == "Promise"),
        Expression::CallExpression(expression) => {
            let Expression::StaticMemberExpression(member) =
                expression.callee.without_parentheses()
            else {
                return false;
            };
            member
                .object
                .without_parentheses()
                .get_identifier_reference()
                .is_some_and(|identifier| identifier.name == "Promise")
                && matches!(
                    member.property.name.as_str(),
                    "resolve" | "reject" | "all" | "allSettled" | "any" | "race"
                )
        }
        _ => false,
    }
}

#[allow(clippy::too_many_arguments)]
fn transform_external_store_declarator<'a>(
    ast: &AstBuilder<'a>,
    declarator: &mut VariableDeclarator<'a>,
    sources: &BTreeMap<&str, SourceId>,
    react: &ReactBindings<'_>,
    scoping: &Scoping,
    source_symbols: &BTreeMap<SymbolId, SourceId>,
    item_source_symbols: &BTreeMap<SymbolId, SourceId>,
) -> Result<(), Diagnostic> {
    let Some(value) = external_store_binding_symbol(declarator, sources, react)? else {
        return Ok(());
    };
    let Some(Expression::CallExpression(hook_call)) = &declarator.init else {
        unreachable!();
    };
    if !matches!(hook_call.arguments.len(), 2 | 3)
        || hook_call.arguments.iter().any(Argument::is_spread)
    {
        return Err(unsupported(
            "useSyncExternalStore requires subscribe, getSnapshot, and an optional getServerSnapshot",
        )
        .with_span(SourceSpan::new(hook_call.span.start, hook_call.span.end)));
    }
    let mut reactive_reads = DependencyReads::default();
    for argument in &hook_call.arguments {
        let expression = argument
            .as_expression()
            .expect("spread arguments were rejected");
        let reads = dependencies(expression, scoping, source_symbols, item_source_symbols);
        reactive_reads.parent.extend(reads.parent);
        reactive_reads.item.extend(reads.item);
    }
    let mut arguments = vec![ident(ast, SCOPE), mask(ast, &[value.source])];
    if reactive_reads.is_empty() {
        arguments.extend(hook_call.arguments.iter().map(|argument| {
            argument
                .as_expression()
                .expect("spread arguments were rejected")
                .clone_in_with_semantic_ids(ast.allocator())
        }));
    } else {
        let store_arguments = oxc_allocator::Vec::from_iter_in(
            hook_call.arguments.iter().map(|argument| {
                ArrayExpressionElement::from(
                    argument
                        .as_expression()
                        .expect("spread arguments were rejected")
                        .clone_in_with_semantic_ids(ast.allocator()),
                )
            }),
            ast,
        );
        let evaluate = Expression::new_array_expression(hook_call.span, store_arguments, ast);
        let mut binding_arguments = vec![
            ident(ast, SCOPE),
            dependency_mask(ast, &reactive_reads.parent),
            arrow_expression(ast, [], evaluate),
        ];
        append_item_dependency(ast, &mut binding_arguments, &reactive_reads);
        arguments.push(call_name(ast, BINDING, binding_arguments));
    }
    declarator.init = Some(call_name(ast, CREATE_EXTERNAL_STORE, arguments));
    Ok(())
}

fn transform_effect_event_declarator<'a>(
    ast: &AstBuilder<'a>,
    declarator: &mut VariableDeclarator<'a>,
    react: &ReactBindings<'_>,
) -> Result<(), Diagnostic> {
    let Some(Expression::CallExpression(hook_call)) = &declarator.init else {
        return Ok(());
    };
    if !react.is_effect_event_call(hook_call) {
        return Ok(());
    }
    if hook_call.arguments.len() != 1 || hook_call.arguments[0].is_spread() {
        return Err(unsupported("useEffectEvent requires exactly one callback")
            .with_span(SourceSpan::new(hook_call.span.start, hook_call.span.end)));
    }
    let callback = hook_call.arguments[0]
        .as_expression()
        .expect("spread arguments were rejected")
        .clone_in_with_semantic_ids(ast.allocator());
    declarator.init = Some(call_name(
        ast,
        CREATE_EFFECT_EVENT,
        [ident(ast, SCOPE), callback],
    ));
    Ok(())
}

fn transform_id_declarator<'a>(
    ast: &AstBuilder<'a>,
    declarator: &mut VariableDeclarator<'a>,
    react: &ReactBindings<'_>,
) -> Result<(), Diagnostic> {
    let Some(Expression::CallExpression(hook_call)) = &declarator.init else {
        return Ok(());
    };
    if !react.is_id_call(hook_call) {
        return Ok(());
    }
    if !hook_call.arguments.is_empty() {
        return Err(unsupported("useId does not accept arguments")
            .with_span(SourceSpan::new(hook_call.span.start, hook_call.span.end)));
    }
    declarator.init = Some(call_name(ast, CREATE_ID, [ident(ast, SCOPE)]));
    Ok(())
}

fn validate_effect_event_uses(
    body: &FunctionBody<'_>,
    react: &ReactBindings<'_>,
    scoping: &Scoping,
    symbols: &BTreeSet<SymbolId>,
) -> Result<(), Diagnostic> {
    if symbols.is_empty() {
        return Ok(());
    }
    let mut callbacks = EffectCallbackSpanCollector {
        react,
        spans: Vec::new(),
    };
    callbacks.visit_function_body(body);
    let mut validator = EffectEventReferenceValidator {
        scoping,
        symbols,
        callback_spans: &callbacks.spans,
        invalid: None,
    };
    validator.visit_function_body(body);
    validator.invalid.map_or(Ok(()), |span| {
        Err(
            unsupported("effect events may only be referenced inside an effect callback")
                .with_span(SourceSpan::new(span.start, span.end)),
        )
    })
}

struct EffectCallbackSpanCollector<'r, 's> {
    react: &'r ReactBindings<'s>,
    spans: Vec<Span>,
}

impl<'a> Visit<'a> for EffectCallbackSpanCollector<'_, '_> {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if self.react.effect_hook_call(call).is_some()
            && let Some(callback) = call.arguments.first().and_then(Argument::as_expression)
        {
            self.spans.push(callback.span());
        }
        walk_call_expression(self, call);
    }
}

struct EffectEventReferenceValidator<'s> {
    scoping: &'s Scoping,
    symbols: &'s BTreeSet<SymbolId>,
    callback_spans: &'s [Span],
    invalid: Option<Span>,
}

impl<'a> Visit<'a> for EffectEventReferenceValidator<'_> {
    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        if self.invalid.is_some() {
            return;
        }
        let Some(symbol) = crate::react_bindings::reference_symbol(identifier, self.scoping) else {
            return;
        };
        if !self.symbols.contains(&symbol) {
            return;
        }
        let span = identifier.span;
        if !self
            .callback_spans
            .iter()
            .any(|callback| callback.start <= span.start && span.end <= callback.end)
        {
            self.invalid = Some(span);
        }
    }
}

fn derived_expressions<'a>(
    body: &FunctionBody<'a>,
    ir: &ComponentIr,
    allocator: &'a Allocator,
) -> BTreeMap<&'a str, Expression<'a>> {
    let derived = ir
        .sources
        .iter()
        .filter(|source| source.kind == SourceKind::Derived)
        .map(|source| source.name.as_str())
        .collect::<Vec<_>>();
    let mut expressions = BTreeMap::new();
    for statement in &body.statements {
        let Statement::VariableDeclaration(declaration) = statement else {
            continue;
        };
        for declarator in &declaration.declarations {
            let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                continue;
            };
            if derived.contains(&identifier.name.as_str())
                && let Some(expression) = &declarator.init
            {
                expressions.insert(
                    allocator.alloc_str(identifier.name.as_str()),
                    expression.clone_in_with_semantic_ids(allocator),
                );
            }
        }
    }
    expressions
}

struct JsxBindingTransformer<'a, 'b, 's> {
    ast: &'b AstBuilder<'a>,
    scoping: &'s Scoping,
    source_symbols: &'s BTreeMap<SymbolId, SourceId>,
    item_source_symbols: &'s BTreeMap<SymbolId, SourceId>,
    options: &'s CompilationOptions,
    react: &'s ReactBindings<'s>,
    renderable_depth: usize,
    reactive_spread_overrides: BTreeMap<u32, (ReactiveSpreadKind, Vec<String>)>,
    diagnostic: Option<Diagnostic>,
}

#[derive(Clone, Copy)]
enum ReactiveSpreadKind {
    Component,
    Intrinsic,
}

fn coalesce_props_before_reactive_spread<'a>(
    ast: &AstBuilder<'a>,
    element: &mut JSXElement<'a>,
    spread_index: usize,
    scoping: &Scoping,
    source_symbols: &BTreeMap<SymbolId, SourceId>,
    item_source_symbols: &BTreeMap<SymbolId, SourceId>,
) -> Result<(), Diagnostic> {
    let JSXAttributeItem::SpreadAttribute(reactive_spread) =
        &element.opening_element.attributes[spread_index]
    else {
        unreachable!("reactive spread index must point at a spread attribute");
    };
    let spread_span = reactive_spread.span;
    let mut properties = oxc_allocator::Vec::new_in(ast);

    for (index, item) in element.opening_element.attributes[..=spread_index]
        .iter()
        .enumerate()
    {
        match item {
            JSXAttributeItem::SpreadAttribute(spread) => {
                if index < spread_index
                    && dependencies(
                        &spread.argument,
                        scoping,
                        source_symbols,
                        item_source_symbols,
                    )
                    .is_empty()
                {
                    return Err(unsupported(
                        "a non-reactive spread before a reactive JSX spread requires a cached ownership layer",
                    )
                    .with_span(SourceSpan::new(spread.span.start, spread.span.end)));
                }
                properties.push(ObjectPropertyKind::new_spread_property(
                    spread.span,
                    spread.argument.clone_in_with_semantic_ids(ast.allocator()),
                    ast,
                ));
            }
            JSXAttributeItem::Attribute(attribute) => {
                let JSXAttributeName::Identifier(name) = &attribute.name else {
                    return Err(unsupported(
                        "ordered reactive JSX spreads require ordinary prop names",
                    )
                    .with_span(SourceSpan::new(attribute.span.start, attribute.span.end)));
                };
                if matches!(
                    name.name.as_str(),
                    "key" | "children" | "dangerouslySetInnerHTML"
                ) {
                    return Err(unsupported(format!(
                        "{name} before a reactive JSX spread requires dedicated ownership semantics",
                    ))
                    .with_span(SourceSpan::new(attribute.span.start, attribute.span.end)));
                }
                let value = match &attribute.value {
                    None => Expression::new_boolean_literal(attribute.span, true, ast),
                    Some(JSXAttributeValue::StringLiteral(value)) => {
                        Expression::StringLiteral(value.clone_in_with_semantic_ids(ast.allocator()))
                    }
                    Some(JSXAttributeValue::ExpressionContainer(container)) => {
                        let expression = container.expression.as_expression().ok_or_else(|| {
                            unsupported("ordered reactive JSX spread prop must have a value")
                                .with_span(SourceSpan::new(
                                    container.span.start,
                                    container.span.end,
                                ))
                        })?;
                        let replay_safe =
                            !dependencies(expression, scoping, source_symbols, item_source_symbols)
                                .is_empty()
                                || matches!(
                                    expression.without_parentheses(),
                                    Expression::Identifier(_)
                                        | Expression::BooleanLiteral(_)
                                        | Expression::NullLiteral(_)
                                        | Expression::NumericLiteral(_)
                                        | Expression::BigIntLiteral(_)
                                        | Expression::StringLiteral(_)
                                );
                        if !replay_safe {
                            return Err(unsupported(
                                "a non-reactive expression before a reactive JSX spread would be re-evaluated during updates",
                            )
                            .with_span(SourceSpan::new(container.span.start, container.span.end)));
                        }
                        expression.clone_in_with_semantic_ids(ast.allocator())
                    }
                    Some(JSXAttributeValue::Element(_) | JSXAttributeValue::Fragment(_)) => {
                        return Err(unsupported(
                            "element-valued props before a reactive JSX spread are unsupported",
                        )
                        .with_span(SourceSpan::new(attribute.span.start, attribute.span.end)));
                    }
                };
                properties.push(ObjectPropertyKind::new_object_property(
                    attribute.span,
                    PropertyKind::Init,
                    PropertyKey::new_string_literal(name.span, name.name, None, ast),
                    value,
                    false,
                    false,
                    false,
                    ast,
                ));
            }
        }
    }

    let merged = Expression::new_object_expression(element.span, properties, ast);
    let mut attributes = oxc_allocator::Vec::new_in(ast);
    attributes.push(JSXAttributeItem::new_spread_attribute(
        spread_span,
        merged,
        ast,
    ));
    attributes.extend(
        element.opening_element.attributes[spread_index + 1..]
            .iter()
            .map(|item| item.clone_in_with_semantic_ids(ast.allocator())),
    );
    element.opening_element.attributes = attributes;
    Ok(())
}

impl<'a> JsxBindingTransformer<'a, '_, '_> {
    fn lower_renderable_attribute(
        &mut self,
        mut element: oxc_allocator::Box<'a, JSXElement<'a>>,
    ) -> Result<Expression<'a>, Diagnostic> {
        self.renderable_depth += 1;
        self.visit_jsx_element(&mut element);
        self.renderable_depth -= 1;
        if let Some(diagnostic) = self.diagnostic.take() {
            return Err(diagnostic);
        }
        let (input, constructor) = renderable_parts(self.ast, element)?;
        Ok(call_name(
            self.ast,
            CREATE_RENDERABLE,
            [
                input,
                arrow_expression(self.ast, [RENDERABLE_INPUT], constructor),
            ],
        ))
    }

    fn lower_choice_branch(&mut self, expression: &mut Expression<'a>) {
        if self.lower_structural_conditional(expression) {
            return;
        }
        if matches!(
            expression.without_parentheses(),
            Expression::JSXElement(_) | Expression::JSXFragment(_)
        ) {
            self.visit_expression(expression);
            return;
        }
        if contains_jsx(expression) {
            let span = expression.span();
            self.diagnostic = Some(
                unsupported(
                    "ternary branches containing JSX must be a direct JSX value or supported conditional",
                )
                .with_span(SourceSpan::new(span.start, span.end)),
            );
            return;
        }
        let reads = dependencies(
            expression,
            self.scoping,
            self.source_symbols,
            self.item_source_symbols,
        );
        self.visit_expression(expression);
        if reads.is_empty() {
            return;
        }
        let evaluate = expression.clone_in_with_semantic_ids(self.ast.allocator());
        let mut arguments = vec![
            ident(self.ast, SCOPE),
            dependency_mask(self.ast, &reads.parent),
            arrow_expression(self.ast, [], evaluate),
        ];
        append_item_dependency(self.ast, &mut arguments, &reads);
        *expression = call_name(self.ast, BINDING, arguments);
    }

    fn lower_structural_conditional(&mut self, expression: &mut Expression<'a>) -> bool {
        let expression = expression.without_parentheses_mut();
        let Expression::ConditionalExpression(conditional) = expression else {
            return false;
        };
        if !contains_jsx(&conditional.consequent) && !contains_jsx(&conditional.alternate) {
            return false;
        }
        let reads = dependencies(
            &conditional.test,
            self.scoping,
            self.source_symbols,
            self.item_source_symbols,
        );
        if reads.is_empty() {
            self.visit_expression(&mut conditional.test);
            self.lower_choice_branch(&mut conditional.consequent);
            self.lower_choice_branch(&mut conditional.alternate);
            return true;
        }
        match render::align_render_alternatives(
            self.ast,
            &conditional.test,
            &conditional.consequent,
            &conditional.alternate,
        ) {
            Ok(Some(aligned)) => {
                *expression = aligned;
                self.visit_expression(expression);
            }
            Ok(None) => {
                self.visit_expression(&mut conditional.test);
                self.lower_choice_branch(&mut conditional.consequent);
                self.lower_choice_branch(&mut conditional.alternate);
                let test = conditional
                    .test
                    .clone_in_with_semantic_ids(self.ast.allocator());
                let consequent = conditional
                    .consequent
                    .clone_in_with_semantic_ids(self.ast.allocator());
                let alternate = conditional
                    .alternate
                    .clone_in_with_semantic_ids(self.ast.allocator());
                let mut arguments = vec![
                    ident(self.ast, SCOPE),
                    dependency_mask(self.ast, &reads.parent),
                    Expression::new_string_literal(SPAN, "truthy", None, self.ast),
                    arrow_expression(self.ast, [], test),
                    arrow_expression(self.ast, [], consequent),
                    arrow_expression(self.ast, [], alternate),
                ];
                append_item_dependency(self.ast, &mut arguments, &reads);
                *expression = call_name(self.ast, CHOOSE, arguments);
            }
            Err(diagnostic) => self.diagnostic = Some(diagnostic),
        }
        true
    }
}

pub(super) fn prepare_suspense_element<'a>(
    ast: &AstBuilder<'a>,
    react: &ReactBindings<'_>,
    options: &CompilationOptions,
    element: &mut JSXElement<'a>,
) -> Result<(), Diagnostic> {
    if !react.is_named_jsx_element(&element.opening_element.name, "Suspense") {
        return Ok(());
    }
    prepare_known_suspense_element(ast, options, element)
}

pub(super) fn prepare_activity_element<'a>(
    ast: &AstBuilder<'a>,
    react: &ReactBindings<'_>,
    options: &CompilationOptions,
    element: &mut JSXElement<'a>,
) -> Result<(), Diagnostic> {
    if !react.is_named_jsx_element(&element.opening_element.name, "Activity") {
        return Ok(());
    }
    prepare_known_activity_element(ast, options, element)
}

pub(super) fn prepare_profiler_element<'a>(
    ast: &AstBuilder<'a>,
    react: &ReactBindings<'_>,
    options: &CompilationOptions,
    element: &mut JSXElement<'a>,
) -> Result<(), Diagnostic> {
    if !react.is_named_jsx_element(&element.opening_element.name, "Profiler") {
        return Ok(());
    }
    prepare_known_profiler_element(ast, options, element)
}

pub(super) fn prepare_known_profiler_element<'a>(
    ast: &AstBuilder<'a>,
    options: &CompilationOptions,
    element: &mut JSXElement<'a>,
) -> Result<(), Diagnostic> {
    if !options.feature_enabled(CompilerFeature::Profiling) {
        return Err(
            unsupported("Profiler requires the `profiling` compiler feature")
                .with_span(SourceSpan::new(element.span.start, element.span.end)),
        );
    }
    for required in ["id", "onRender"] {
        let present = element.opening_element.attributes.iter().any(|item| {
            matches!(
                item,
                JSXAttributeItem::Attribute(attribute)
                    if matches!(&attribute.name, JSXAttributeName::Identifier(name) if name.name == required)
                        && attribute.value.is_some()
            )
        });
        if !present {
            return Err(
                unsupported(format!("Profiler requires an {required} prop")).with_span(
                    SourceSpan::new(
                        element.opening_element.span.start,
                        element.opening_element.span.end,
                    ),
                ),
            );
        }
    }

    let children = element.children.clone_in_with_semantic_ids(ast.allocator());
    let fragment = Expression::JSXFragment(JSXFragment::boxed(
        SPAN,
        JSXOpeningFragment::new(SPAN, ast),
        children,
        JSXClosingFragment::new(SPAN, ast),
        ast,
    ));
    element.children.clear();
    element.children.push(JSXChild::ExpressionContainer(
        JSXExpressionContainer::boxed(
            SPAN,
            JSXExpression::from(arrow_expression(ast, [], fragment)),
            ast,
        ),
    ));
    Ok(())
}

pub(super) fn prepare_known_activity_element<'a>(
    ast: &AstBuilder<'a>,
    options: &CompilationOptions,
    element: &mut JSXElement<'a>,
) -> Result<(), Diagnostic> {
    if !options.feature_enabled(CompilerFeature::RetainedUi) {
        return Err(
            unsupported("Activity requires the `retained-ui` compiler feature")
                .with_span(SourceSpan::new(element.span.start, element.span.end)),
        );
    }
    let has_mode = element.opening_element.attributes.iter().any(|item| {
        matches!(
            item,
            JSXAttributeItem::Attribute(attribute)
                if matches!(&attribute.name, JSXAttributeName::Identifier(name) if name.name == "mode")
                    && attribute.value.is_some()
        )
    });
    if !has_mode {
        return Err(
            unsupported("Activity requires a mode prop").with_span(SourceSpan::new(
                element.opening_element.span.start,
                element.opening_element.span.end,
            )),
        );
    }

    let children = element.children.clone_in_with_semantic_ids(ast.allocator());
    let fragment = Expression::JSXFragment(JSXFragment::boxed(
        SPAN,
        JSXOpeningFragment::new(SPAN, ast),
        children,
        JSXClosingFragment::new(SPAN, ast),
        ast,
    ));
    element.children.clear();
    element.children.push(JSXChild::ExpressionContainer(
        JSXExpressionContainer::boxed(
            SPAN,
            JSXExpression::from(arrow_expression(ast, [], fragment)),
            ast,
        ),
    ));
    Ok(())
}

pub(super) fn prepare_known_suspense_element<'a>(
    ast: &AstBuilder<'a>,
    options: &CompilationOptions,
    element: &mut JSXElement<'a>,
) -> Result<(), Diagnostic> {
    if !options.feature_enabled(CompilerFeature::Async) {
        return Err(
            unsupported("Suspense requires the `async` compiler feature")
                .with_span(SourceSpan::new(element.span.start, element.span.end)),
        );
    }
    let Some(fallback) = element
        .opening_element
        .attributes
        .iter_mut()
        .find_map(|item| {
            let JSXAttributeItem::Attribute(attribute) = item else {
                return None;
            };
            matches!(
                &attribute.name,
                JSXAttributeName::Identifier(name) if name.name == "fallback"
            )
            .then_some(attribute)
        })
    else {
        return Err(
            unsupported("Suspense requires a fallback prop").with_span(SourceSpan::new(
                element.opening_element.span.start,
                element.opening_element.span.end,
            )),
        );
    };
    let Some(fallback_value) = fallback.value.as_ref() else {
        return Err(unsupported("Suspense fallback must have a value")
            .with_span(SourceSpan::new(fallback.span.start, fallback.span.end)));
    };
    let fallback_expression = match fallback_value {
        JSXAttributeValue::StringLiteral(value) => {
            Expression::StringLiteral(value.clone_in_with_semantic_ids(ast.allocator()))
        }
        JSXAttributeValue::ExpressionContainer(container) => {
            let Some(expression) = container.expression.as_expression() else {
                return Err(unsupported("Suspense fallback must have a value")
                    .with_span(SourceSpan::new(container.span.start, container.span.end)));
            };
            expression.clone_in_with_semantic_ids(ast.allocator())
        }
        JSXAttributeValue::Element(value) => {
            Expression::JSXElement(value.clone_in_with_semantic_ids(ast.allocator()))
        }
        JSXAttributeValue::Fragment(value) => {
            Expression::JSXFragment(value.clone_in_with_semantic_ids(ast.allocator()))
        }
    };
    fallback.value = Some(JSXAttributeValue::ExpressionContainer(
        JSXExpressionContainer::boxed(
            SPAN,
            JSXExpression::from(arrow_expression(ast, [], fallback_expression)),
            ast,
        ),
    ));

    let children = element.children.clone_in_with_semantic_ids(ast.allocator());
    let fragment = Expression::JSXFragment(JSXFragment::boxed(
        SPAN,
        JSXOpeningFragment::new(SPAN, ast),
        children,
        JSXClosingFragment::new(SPAN, ast),
        ast,
    ));
    element.children.clear();
    element.children.push(JSXChild::ExpressionContainer(
        JSXExpressionContainer::boxed(
            SPAN,
            JSXExpression::from(arrow_expression(ast, [], fragment)),
            ast,
        ),
    ));
    Ok(())
}

impl<'a> VisitMut<'a> for JsxBindingTransformer<'a, '_, '_> {
    fn visit_expression(&mut self, expression: &mut Expression<'a>) {
        walk_expression_mut(self, expression);
        let Expression::ChainExpression(chain) = expression else {
            return;
        };
        let ChainElement::StaticMemberExpression(member) = &chain.expression else {
            return;
        };
        if member.property.name != "$$typeof" {
            return;
        }
        let value = member
            .object
            .clone_in_with_semantic_ids(self.ast.allocator());
        *expression = call_name(self.ast, RENDERABLE_MARKER, [value]);
    }

    fn visit_call_expression(&mut self, call: &mut CallExpression<'a>) {
        if self.react.is_clone_element_call(call) {
            if !(1..=3).contains(&call.arguments.len())
                || call.arguments.iter().any(Argument::is_spread)
            {
                self.diagnostic = Some(
                    unsupported(
                        "cloneElement supports a renderable, optional props object, and one replacement child",
                    )
                    .with_span(SourceSpan::new(call.span.start, call.span.end)),
                );
                return;
            }
            walk_call_expression_mut(self, call);
            for index in 1..call.arguments.len() {
                let expression = call.arguments[index]
                    .as_expression_mut()
                    .expect("spread arguments were rejected");
                let reads = dependencies(
                    expression,
                    self.scoping,
                    self.source_symbols,
                    self.item_source_symbols,
                );
                if !reads.is_empty() {
                    let evaluate = expression.clone_in_with_semantic_ids(self.ast.allocator());
                    let mut arguments = vec![
                        ident(self.ast, SCOPE),
                        dependency_mask(self.ast, &reads.parent),
                        arrow_expression(self.ast, [], evaluate),
                    ];
                    append_item_dependency(self.ast, &mut arguments, &reads);
                    *expression = call_name(self.ast, BINDING, arguments);
                }
            }
            call.callee = ident(self.ast, CLONE_RENDERABLE);
            call.type_arguments = None;
            return;
        }
        if self.react.is_valid_element_call(call) {
            if call.arguments.len() != 1 || call.arguments[0].is_spread() {
                self.diagnostic = Some(
                    unsupported("isValidElement requires one value")
                        .with_span(SourceSpan::new(call.span.start, call.span.end)),
                );
                return;
            }
            walk_call_expression_mut(self, call);
            call.callee = ident(self.ast, IS_RENDERABLE);
            call.type_arguments = None;
            return;
        }
        if self.react.is_children_to_array_call(call) {
            if call.arguments.len() != 1 || call.arguments[0].is_spread() {
                self.diagnostic = Some(
                    unsupported("Children.toArray supports one renderable value")
                        .with_span(SourceSpan::new(call.span.start, call.span.end)),
                );
                return;
            }
            walk_call_expression_mut(self, call);
            call.callee = ident(self.ast, RENDERABLE_TO_ARRAY);
            call.type_arguments = None;
            return;
        }
        if let Some(name) = self.react.framework_call_name(call) {
            let message = if self.react.is_server_framework_call(call) {
                Some(format!(
                    "{name} is only supported by the server target with the `framework` compiler feature"
                ))
            } else if !self.options.feature_enabled(CompilerFeature::Framework) {
                Some(format!("{name} requires the `framework` compiler feature"))
            } else {
                None
            };
            if let Some(message) = message {
                self.diagnostic = Some(
                    unsupported(message).with_span(SourceSpan::new(call.span.start, call.span.end)),
                );
                return;
            }
        }
        if !self.options.feature_enabled(CompilerFeature::Profiling) {
            let name = if self.react.is_debug_value_call(call) {
                Some("useDebugValue")
            } else if self.react.is_capture_owner_stack_call(call) {
                Some("captureOwnerStack")
            } else {
                None
            };
            if let Some(name) = name {
                self.diagnostic = Some(
                    unsupported(format!("{name} requires the `profiling` compiler feature"))
                        .with_span(SourceSpan::new(call.span.start, call.span.end)),
                );
                return;
            }
        }
        if self.react.is_debug_value_call(call) {
            if !(1..=2).contains(&call.arguments.len())
                || call.arguments.iter().any(Argument::is_spread)
            {
                self.diagnostic = Some(
                    unsupported("useDebugValue requires a value and optional formatter")
                        .with_span(SourceSpan::new(call.span.start, call.span.end)),
                );
                return;
            }
            let value = call.arguments[0]
                .as_expression()
                .expect("spread arguments were rejected");
            let mut reads = dependencies(
                value,
                self.scoping,
                self.source_symbols,
                self.item_source_symbols,
            );
            if let Some(formatter) = call.arguments.get(1).and_then(Argument::as_expression) {
                let formatter_reads = dependencies(
                    formatter,
                    self.scoping,
                    self.source_symbols,
                    self.item_source_symbols,
                );
                reads.parent.extend(formatter_reads.parent);
                reads.item.extend(formatter_reads.item);
            }
            walk_call_expression_mut(self, call);
            if !reads.is_empty() {
                let value = call.arguments[0]
                    .as_expression()
                    .expect("spread arguments were rejected")
                    .clone_in_with_semantic_ids(self.ast.allocator());
                let mut arguments = vec![
                    ident(self.ast, SCOPE),
                    dependency_mask(self.ast, &reads.parent),
                    arrow_expression(self.ast, [], value),
                ];
                append_item_dependency(self.ast, &mut arguments, &reads);
                call.arguments[0] = Argument::from(call_name(self.ast, BINDING, arguments));
            }
            return;
        }
        if self.react.is_lazy_call(call) && !self.options.feature_enabled(CompilerFeature::Async) {
            self.diagnostic = Some(
                unsupported("lazy requires the `async` compiler feature")
                    .with_span(SourceSpan::new(call.span.start, call.span.end)),
            );
            return;
        }
        if let Some(effect) = self.react.effect_hook_call(call) {
            if effect == EffectHook::Insertion
                && !self.options.feature_enabled(CompilerFeature::CssInsertion)
            {
                self.diagnostic = Some(
                    unsupported("useInsertionEffect requires the `css-insertion` compiler feature")
                        .with_span(SourceSpan::new(call.span.start, call.span.end)),
                );
                return;
            }
            if !(1..=2).contains(&call.arguments.len())
                || call.arguments.iter().any(Argument::is_spread)
            {
                self.diagnostic = Some(
                    unsupported("effects require a callback and optional inline dependency array")
                        .with_span(SourceSpan::new(call.span.start, call.span.end)),
                );
                return;
            }
            if let Some(dependencies) = call.arguments.get(1) {
                let dependencies = dependencies
                    .as_expression()
                    .expect("spread arguments were rejected");
                let Expression::ArrayExpression(array) = dependencies.without_parentheses() else {
                    self.diagnostic = Some(
                        unsupported("effect dependencies must be an inline array")
                            .with_span(SourceSpan::from_oxc(dependencies.span())),
                    );
                    return;
                };
                if array
                    .elements
                    .iter()
                    .any(|element| matches!(element, ArrayExpressionElement::Elision(_)))
                {
                    self.diagnostic = Some(
                        unsupported("effect dependencies cannot contain elisions")
                            .with_span(SourceSpan::from_oxc(dependencies.span())),
                    );
                    return;
                }
            }
            let reads = call.arguments.get(1).map_or_else(
                || DependencyReads {
                    parent: self.source_symbols.values().copied().collect(),
                    item: BTreeSet::new(),
                },
                |dependencies_argument| {
                    dependencies(
                        dependencies_argument
                            .as_expression()
                            .expect("spread arguments were rejected"),
                        self.scoping,
                        self.source_symbols,
                        self.item_source_symbols,
                    )
                },
            );
            if !reads.item.is_empty() {
                self.diagnostic = Some(
                    unsupported("effects cannot capture keyed item slots")
                        .with_span(SourceSpan::new(call.span.start, call.span.end)),
                );
                return;
            }
            walk_call_expression_mut(self, call);
            let create_expression = call.arguments[0]
                .as_expression()
                .expect("spread arguments were rejected");
            let create = arrow_expression(
                self.ast,
                [],
                snapshot_effect_create(
                    self.ast,
                    create_expression,
                    self.scoping,
                    self.source_symbols,
                ),
            );
            let mut arguments = vec![
                ident(self.ast, SCOPE),
                dependency_mask(self.ast, &reads.parent),
                create,
            ];
            if let Some(dependencies) = call.arguments.get(1) {
                arguments.push(arrow_expression(
                    self.ast,
                    [],
                    dependencies
                        .as_expression()
                        .expect("spread arguments were rejected")
                        .clone_in_with_semantic_ids(self.ast.allocator()),
                ));
            }
            call.callee = ident(
                self.ast,
                match effect {
                    EffectHook::Insertion => COMPILED_INSERTION_EFFECT,
                    EffectHook::Layout => COMPILED_LAYOUT_EFFECT,
                    EffectHook::Passive => COMPILED_EFFECT,
                },
            );
            call.type_arguments = None;
            call.arguments = oxc_allocator::Vec::from_iter_in(
                arguments.into_iter().map(Argument::from),
                self.ast,
            );
            return;
        }
        if !self.react.is_imperative_handle_call(call) {
            walk_call_expression_mut(self, call);
            return;
        }
        if !(2..=3).contains(&call.arguments.len())
            || call.arguments.iter().any(Argument::is_spread)
        {
            self.diagnostic = Some(
                unsupported("useImperativeHandle requires a ref, handle factory, and optional dependency array")
                    .with_span(SourceSpan::new(call.span.start, call.span.end)),
            );
            return;
        }
        let ref_expression = call.arguments[0]
            .as_expression()
            .expect("spread arguments were rejected");
        if let Some(dependencies) = call.arguments.get(2) {
            let dependencies = dependencies
                .as_expression()
                .expect("spread arguments were rejected");
            let Expression::ArrayExpression(array) = dependencies.without_parentheses() else {
                self.diagnostic = Some(
                    unsupported("useImperativeHandle dependencies must be an inline array")
                        .with_span(SourceSpan::from_oxc(dependencies.span())),
                );
                return;
            };
            if array.elements.iter().any(|element| {
                matches!(
                    element,
                    ArrayExpressionElement::SpreadElement(_) | ArrayExpressionElement::Elision(_)
                )
            }) {
                self.diagnostic = Some(
                    unsupported("useImperativeHandle dependencies must have a static length")
                        .with_span(SourceSpan::from_oxc(dependencies.span())),
                );
                return;
            }
        }
        let mut reads = dependencies(
            ref_expression,
            self.scoping,
            self.source_symbols,
            self.item_source_symbols,
        );
        let lifecycle_reads = call.arguments.get(2).map_or_else(
            || DependencyReads {
                parent: self.source_symbols.values().copied().collect(),
                item: BTreeSet::new(),
            },
            |dependencies_argument| {
                dependencies(
                    dependencies_argument
                        .as_expression()
                        .expect("spread arguments were rejected"),
                    self.scoping,
                    self.source_symbols,
                    self.item_source_symbols,
                )
            },
        );
        reads.parent.extend(lifecycle_reads.parent);
        reads.item.extend(lifecycle_reads.item);
        if !reads.item.is_empty() {
            self.diagnostic = Some(
                unsupported("useImperativeHandle cannot capture keyed item slots")
                    .with_span(SourceSpan::new(call.span.start, call.span.end)),
            );
            return;
        }

        walk_call_expression_mut(self, call);
        let ref_expression = call.arguments[0]
            .as_expression()
            .expect("spread arguments were rejected")
            .clone_in_with_semantic_ids(self.ast.allocator());
        let create_expression = call.arguments[1]
            .as_expression()
            .expect("spread arguments were rejected")
            .clone_in_with_semantic_ids(self.ast.allocator());
        let dependencies_expression = call.arguments.get(2).map(|argument| {
            argument
                .as_expression()
                .expect("spread arguments were rejected")
                .clone_in_with_semantic_ids(self.ast.allocator())
        });
        let mut arguments = vec![
            ident(self.ast, SCOPE),
            dependency_mask(self.ast, &reads.parent),
            arrow_expression(self.ast, [], ref_expression),
            create_expression,
        ];
        if let Some(dependencies_expression) = dependencies_expression {
            arguments.push(arrow_expression(self.ast, [], dependencies_expression));
        }
        call.callee = ident(self.ast, COMPILED_IMPERATIVE_HANDLE);
        call.type_arguments = None;
        call.arguments =
            oxc_allocator::Vec::from_iter_in(arguments.into_iter().map(Argument::from), self.ast);
    }

    fn visit_jsx_element(&mut self, element: &mut JSXElement<'a>) {
        if let Err(diagnostic) =
            prepare_profiler_element(self.ast, self.react, self.options, element)
        {
            self.diagnostic = Some(diagnostic);
            return;
        }
        if let Err(diagnostic) =
            prepare_activity_element(self.ast, self.react, self.options, element)
        {
            self.diagnostic = Some(diagnostic);
            return;
        }
        if let Err(diagnostic) =
            prepare_suspense_element(self.ast, self.react, self.options, element)
        {
            self.diagnostic = Some(diagnostic);
            return;
        }
        if !self.options.feature_enabled(CompilerFeature::UnsafeHtml)
            && let Some(span) = raw_html::attribute_span(element)
        {
            self.diagnostic = Some(
                unsupported("dangerouslySetInnerHTML requires the `unsafe-html` compiler feature")
                    .with_span(span),
            );
            return;
        }
        if let Some(diagnostic) = raw_html::validate(element) {
            self.diagnostic = Some(diagnostic);
            return;
        }
        let intrinsic = raw_html::intrinsic_jsx_name(&element.opening_element.name).is_some();
        if !intrinsic || self.renderable_depth > 0 {
            for child in &mut element.children {
                let nested = match child {
                    JSXChild::Element(value) => {
                        Some(value.clone_in_with_semantic_ids(self.ast.allocator()))
                    }
                    JSXChild::ExpressionContainer(container) => match &container.expression {
                        JSXExpression::JSXElement(value) => {
                            Some(value.clone_in_with_semantic_ids(self.ast.allocator()))
                        }
                        _ => None,
                    },
                    _ => None,
                };
                let Some(nested) = nested else { continue };
                match self.lower_renderable_attribute(nested) {
                    Ok(expression) => {
                        *child = JSXChild::new_expression_container(
                            child.span(),
                            JSXExpression::from(expression),
                            self.ast,
                        );
                    }
                    Err(diagnostic) => {
                        self.diagnostic = Some(diagnostic);
                        return;
                    }
                }
            }
        }
        if intrinsic {
            for item in &element.opening_element.attributes {
                let JSXAttributeItem::Attribute(attribute) = item else {
                    continue;
                };
                let JSXAttributeName::Identifier(name) = &attribute.name else {
                    continue;
                };
                if is_event_attribute(name.name.as_str())
                    && !is_supported_react_event_attribute(name.name.as_str())
                {
                    self.diagnostic = Some(
                        unsupported(format!(
                            "unsupported React event prop {}; use a supported React 19 event name",
                            name.name
                        ))
                        .with_span(SourceSpan::new(name.span.start, name.span.end)),
                    );
                    return;
                }
            }
        }
        if let Err(diagnostic) = prepare_action_element(self.ast, self.options, element) {
            self.diagnostic = Some(diagnostic);
            return;
        }
        let mut reactive_spreads = element
            .opening_element
            .attributes
            .iter()
            .enumerate()
            .filter_map(|(index, item)| {
                let JSXAttributeItem::SpreadAttribute(spread) = item else {
                    return None;
                };
                (!dependencies(
                    &spread.argument,
                    self.scoping,
                    self.source_symbols,
                    self.item_source_symbols,
                )
                .is_empty())
                .then_some((index, spread.span.start))
            })
            .collect::<Vec<_>>();
        if !reactive_spreads.is_empty() {
            let (spread_index, spread_start) = *reactive_spreads
                .last()
                .expect("a non-empty reactive spread list has a final spread");
            let has_preceding_prop = element.opening_element.attributes[..spread_index]
                .iter()
                .any(|item| match item {
                    JSXAttributeItem::SpreadAttribute(_) => true,
                    JSXAttributeItem::Attribute(attribute) => !attribute.is_identifier("key"),
                });
            let has_following_spread = element.opening_element.attributes[spread_index + 1..]
                .iter()
                .any(|item| matches!(item, JSXAttributeItem::SpreadAttribute(_)));
            if has_preceding_prop && !has_following_spread {
                if let Err(diagnostic) = coalesce_props_before_reactive_spread(
                    self.ast,
                    element,
                    spread_index,
                    self.scoping,
                    self.source_symbols,
                    self.item_source_symbols,
                ) {
                    self.diagnostic = Some(diagnostic);
                    return;
                }
                reactive_spreads = vec![(0, spread_start)];
            }
        }
        if !reactive_spreads.is_empty() {
            if reactive_spreads.len() != 1 {
                self.diagnostic = Some(
                    unsupported("a JSX element currently accepts one reactive spread")
                        .with_span(SourceSpan::new(element.span.start, element.span.end)),
                );
                return;
            }
            let (spread_index, spread_start) = reactive_spreads[0];
            let has_preceding_prop = element.opening_element.attributes[..spread_index]
                .iter()
                .any(|item| match item {
                    JSXAttributeItem::SpreadAttribute(_) => true,
                    JSXAttributeItem::Attribute(attribute) => !attribute.is_identifier("key"),
                });
            let has_following_spread = element.opening_element.attributes[spread_index + 1..]
                .iter()
                .any(|item| matches!(item, JSXAttributeItem::SpreadAttribute(_)));
            if has_preceding_prop || has_following_spread {
                self.diagnostic = Some(
                    unsupported(
                        "reactive JSX spreads must precede explicit props and cannot be combined with another spread",
                    )
                    .with_span(SourceSpan::new(element.span.start, element.span.end)),
                );
                return;
            }
            let mut overrides = element.opening_element.attributes[spread_index + 1..]
                .iter()
                .filter_map(|item| {
                    let JSXAttributeItem::Attribute(attribute) = item else {
                        return None;
                    };
                    let JSXAttributeName::Identifier(name) = &attribute.name else {
                        return None;
                    };
                    Some(name.name.to_string())
                })
                .collect::<Vec<_>>();
            if !element.children.is_empty() {
                overrides.push("children".to_string());
            }
            self.reactive_spread_overrides.insert(
                spread_start,
                (
                    if intrinsic {
                        ReactiveSpreadKind::Intrinsic
                    } else {
                        ReactiveSpreadKind::Component
                    },
                    overrides,
                ),
            );
        }
        walk_jsx_element(self, element);
    }

    fn visit_jsx_attribute(&mut self, attribute: &mut JSXAttribute<'a>) {
        if let Some(JSXAttributeValue::Element(_)) = &attribute.value {
            let Some(JSXAttributeValue::Element(element)) = attribute.value.take() else {
                unreachable!();
            };
            match self.lower_renderable_attribute(element) {
                Ok(expression) => {
                    attribute.value = Some(JSXAttributeValue::new_expression_container(
                        attribute.span,
                        expression.into(),
                        self.ast,
                    ));
                }
                Err(diagnostic) => self.diagnostic = Some(diagnostic),
            }
            return;
        }
        if let Some(JSXAttributeValue::ExpressionContainer(container)) = &mut attribute.value
            && let JSXExpression::JSXElement(element) = &container.expression
        {
            let element = element.clone_in_with_semantic_ids(self.ast.allocator());
            match self.lower_renderable_attribute(element) {
                Ok(expression) => container.expression = expression.into(),
                Err(diagnostic) => self.diagnostic = Some(diagnostic),
            }
            return;
        }
        let JSXAttributeName::Identifier(name) = &attribute.name else {
            walk_jsx_attribute(self, attribute);
            return;
        };
        if name.name == "key" {
            if let Some(JSXAttributeValue::ExpressionContainer(container)) = &mut attribute.value
                && let Some(expression) = container.expression.as_expression_mut()
            {
                self.visit_expression(expression);
            }
            return;
        }
        if is_event_attribute(name.name.as_str()) {
            if let Some(JSXAttributeValue::ExpressionContainer(container)) = &mut attribute.value
                && let Some(expression) = container.expression.as_expression_mut()
            {
                let reads = dependencies(
                    expression,
                    self.scoping,
                    self.source_symbols,
                    self.item_source_symbols,
                );
                self.visit_expression(expression);
                let inline_handler = matches!(
                    expression.without_parentheses(),
                    Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                );
                let handler = expression.clone_in_with_semantic_ids(self.ast.allocator());
                if reads.is_empty() || inline_handler {
                    *expression =
                        call_name(self.ast, COMPILED_EVENT, [ident(self.ast, SCOPE), handler]);
                } else {
                    let mut arguments = vec![
                        ident(self.ast, SCOPE),
                        dependency_mask(self.ast, &reads.parent),
                        arrow_expression(self.ast, [], handler),
                    ];
                    append_item_dependency(self.ast, &mut arguments, &reads);
                    *expression = call_name(
                        self.ast,
                        COMPILED_EVENT,
                        [
                            ident(self.ast, SCOPE),
                            call_name(self.ast, BINDING, arguments),
                        ],
                    );
                }
            }
            return;
        }
        walk_jsx_attribute(self, attribute);
    }

    fn visit_jsx_spread_attribute(&mut self, attribute: &mut JSXSpreadAttribute<'a>) {
        let reads = dependencies(
            &attribute.argument,
            self.scoping,
            self.source_symbols,
            self.item_source_symbols,
        );
        if reads.is_empty() {
            walk_jsx_spread_attribute(self, attribute);
            return;
        }
        let Some((kind, overrides)) = self
            .reactive_spread_overrides
            .get(&attribute.span.start)
            .cloned()
        else {
            return;
        };
        self.visit_expression(&mut attribute.argument);
        let evaluate = attribute
            .argument
            .clone_in_with_semantic_ids(self.ast.allocator());
        let mut binding_arguments = vec![
            ident(self.ast, SCOPE),
            dependency_mask(self.ast, &reads.parent),
            arrow_expression(self.ast, [], evaluate),
        ];
        append_item_dependency(self.ast, &mut binding_arguments, &reads);
        let overrides = Expression::new_array_expression(
            SPAN,
            oxc_allocator::Vec::from_iter_in(
                overrides.into_iter().map(|name| {
                    ArrayExpressionElement::from(Expression::new_string_literal(
                        SPAN,
                        self.ast.allocator().alloc_str(&name),
                        None,
                        self.ast,
                    ))
                }),
                self.ast,
            ),
            self.ast,
        );
        attribute.argument = call_name(
            self.ast,
            match kind {
                ReactiveSpreadKind::Component => COMPILED_COMPONENT_SPREAD,
                ReactiveSpreadKind::Intrinsic => COMPILED_SPREAD,
            },
            [call_name(self.ast, BINDING, binding_arguments), overrides],
        );
    }

    fn visit_jsx_expression_container(&mut self, container: &mut JSXExpressionContainer<'a>) {
        let Some(expression) = container.expression.as_expression_mut() else {
            return;
        };

        if matches!(
            expression.without_parentheses(),
            Expression::CallExpression(call)
                if call.callee.get_identifier_reference().is_some_and(|identifier| identifier.name == CREATE_RENDERABLE)
        ) {
            return;
        }

        if is_generated_render_thunk(expression) {
            walk_expression_mut(self, expression);
            return;
        }

        if is_generated_list_call(expression) {
            walk_expression_mut(self, expression);
            return;
        }

        if self.lower_structural_conditional(expression) {
            return;
        }

        if let Expression::LogicalExpression(logical) = expression
            && logical.operator == LogicalOperator::And
            && is_syntactically_boolean(&logical.left)
        {
            let reads = dependencies(
                &logical.left,
                self.scoping,
                self.source_symbols,
                self.item_source_symbols,
            );
            self.visit_expression(&mut logical.left);
            self.visit_expression(&mut logical.right);
            if reads.is_empty() {
                return;
            }
            let condition = logical
                .left
                .clone_in_with_semantic_ids(self.ast.allocator());
            let render = logical
                .right
                .clone_in_with_semantic_ids(self.ast.allocator());
            let mut arguments = vec![
                ident(self.ast, SCOPE),
                dependency_mask(self.ast, &reads.parent),
                arrow_expression(self.ast, [], condition),
                arrow_expression(self.ast, [], render),
            ];
            append_item_dependency(self.ast, &mut arguments, &reads);
            *expression = call_name(self.ast, WHEN, arguments);
            return;
        }

        if let Expression::LogicalExpression(logical) = expression {
            let reads = dependencies(
                &logical.left,
                self.scoping,
                self.source_symbols,
                self.item_source_symbols,
            );
            self.visit_expression(&mut logical.left);
            self.visit_expression(&mut logical.right);
            let select = logical
                .left
                .clone_in_with_semantic_ids(self.ast.allocator());
            let left = logical
                .left
                .clone_in_with_semantic_ids(self.ast.allocator());
            let right = logical
                .right
                .clone_in_with_semantic_ids(self.ast.allocator());
            let left = if reads.is_empty() {
                left
            } else {
                let mut arguments = vec![
                    ident(self.ast, SCOPE),
                    dependency_mask(self.ast, &reads.parent),
                    arrow_expression(self.ast, [], left),
                ];
                append_item_dependency(self.ast, &mut arguments, &reads);
                call_name(self.ast, BINDING, arguments)
            };
            let (mode, consequent, alternate) = match logical.operator {
                LogicalOperator::And => ("truthy", right, left),
                LogicalOperator::Or => ("truthy", left, right),
                LogicalOperator::Coalesce => ("not-nullish", left, right),
            };
            let mut arguments = vec![
                ident(self.ast, SCOPE),
                dependency_mask(self.ast, &reads.parent),
                Expression::new_string_literal(SPAN, mode, None, self.ast),
                arrow_expression(self.ast, [], select),
                arrow_expression(self.ast, [], consequent),
                arrow_expression(self.ast, [], alternate),
            ];
            append_item_dependency(self.ast, &mut arguments, &reads);
            *expression = call_name(self.ast, CHOOSE, arguments);
            return;
        }

        if let Some((collection, key, mut render)) = jsx_map(expression, self.ast, self.scoping) {
            let reads = dependencies(
                &collection,
                self.scoping,
                self.source_symbols,
                self.item_source_symbols,
            );
            if let Some(span) =
                outer_item_reference(&render, self.scoping, self.item_source_symbols)
            {
                self.diagnostic = Some(
                    unsupported(
                        "nested list render bodies cannot capture an outer row yet; derive the value in the nested collection",
                    )
                    .with_span(span),
                );
                return;
            }
            self.visit_expression(&mut render);
            let mut arguments = vec![
                ident(self.ast, SCOPE),
                dependency_mask(self.ast, &reads.parent),
                arrow_expression(self.ast, [], collection),
            ];
            if let Some(key) = key {
                arguments.push(key);
                arguments.push(render);
                append_item_dependency(self.ast, &mut arguments, &reads);
                *expression = call_name(self.ast, KEYED, arguments);
            } else {
                arguments.push(render);
                append_item_dependency(self.ast, &mut arguments, &reads);
                *expression = call_name(self.ast, INDEXED, arguments);
            }
            return;
        }

        let reads = dependencies(
            expression,
            self.scoping,
            self.source_symbols,
            self.item_source_symbols,
        );
        let contains_reactive_jsx = contains_jsx(expression);
        self.visit_expression(expression);
        if reads.is_empty() {
            return;
        }
        if contains_reactive_jsx {
            let span = expression.span();
            self.diagnostic = Some(
                unsupported(
                    "reactive JSX blocks must use a supported list or conditional expression",
                )
                .with_span(SourceSpan::new(span.start, span.end)),
            );
            return;
        }
        let evaluate = expression.clone_in_with_semantic_ids(self.ast.allocator());
        let mut arguments = vec![
            ident(self.ast, SCOPE),
            dependency_mask(self.ast, &reads.parent),
            arrow_expression(self.ast, [], evaluate),
        ];
        append_item_dependency(self.ast, &mut arguments, &reads);
        *expression = call_name(self.ast, BINDING, arguments);
    }
}

fn renderable_parts<'a>(
    ast: &AstBuilder<'a>,
    element: oxc_allocator::Box<'a, JSXElement<'a>>,
) -> Result<(Expression<'a>, Expression<'a>), Diagnostic> {
    let span = element.span;
    let mut properties = oxc_allocator::Vec::new_in(ast);
    for item in &element.opening_element.attributes {
        match item {
            JSXAttributeItem::SpreadAttribute(spread) => {
                properties.push(ObjectPropertyKind::new_spread_property(
                    spread.span,
                    spread.argument.clone_in_with_semantic_ids(ast.allocator()),
                    ast,
                ));
            }
            JSXAttributeItem::Attribute(attribute) => {
                let JSXAttributeName::Identifier(name) = &attribute.name else {
                    return Err(unsupported(
                        "renderable capability attributes require ordinary prop names",
                    )
                    .with_span(SourceSpan::new(attribute.span.start, attribute.span.end)));
                };
                let value = match &attribute.value {
                    None => Expression::new_boolean_literal(attribute.span, true, ast),
                    Some(JSXAttributeValue::StringLiteral(value)) => {
                        Expression::StringLiteral(value.clone_in_with_semantic_ids(ast.allocator()))
                    }
                    Some(JSXAttributeValue::ExpressionContainer(container)) => container
                        .expression
                        .as_expression()
                        .ok_or_else(|| unsupported("renderable prop must have a value"))?
                        .clone_in_with_semantic_ids(ast.allocator()),
                    Some(JSXAttributeValue::Element(value)) => {
                        Expression::JSXElement(value.clone_in_with_semantic_ids(ast.allocator()))
                    }
                    Some(JSXAttributeValue::Fragment(value)) => {
                        Expression::JSXFragment(value.clone_in_with_semantic_ids(ast.allocator()))
                    }
                };
                properties.push(ObjectPropertyKind::new_object_property(
                    attribute.span,
                    PropertyKind::Init,
                    PropertyKey::new_string_literal(name.span, name.name, None, ast),
                    value,
                    false,
                    false,
                    false,
                    ast,
                ));
            }
        }
    }
    if !element.children.is_empty() {
        let children = renderable_children_expression(ast, &element.children)?;
        properties.push(ObjectPropertyKind::new_object_property(
            span,
            PropertyKind::Init,
            PropertyKey::new_static_identifier(SPAN, "children", ast),
            children,
            false,
            false,
            false,
            ast,
        ));
    }
    let input = Expression::new_object_expression(span, properties, ast);

    let name = element
        .opening_element
        .name
        .clone_in_with_semantic_ids(ast.allocator());
    let attributes = [
        JSXAttributeItem::new_spread_attribute(
            SPAN,
            call_name(ast, RENDERABLE_PROPS, [ident(ast, RENDERABLE_INPUT)]),
            ast,
        ),
        JSXAttributeItem::new_attribute(
            SPAN,
            JSXAttributeName::new_identifier(SPAN, "ref", ast),
            Some(JSXAttributeValue::new_expression_container(
                SPAN,
                call_name(ast, RENDERABLE_REF, [ident(ast, RENDERABLE_INPUT)]).into(),
                ast,
            )),
            ast,
        ),
    ];
    let child = JSXChild::new_expression_container(
        SPAN,
        call_name(ast, RENDERABLE_CHILDREN, [ident(ast, RENDERABLE_INPUT)]).into(),
        ast,
    );
    let opening =
        JSXOpeningElement::boxed(SPAN, name.clone_in(ast.allocator()), None, attributes, ast);
    let closing = JSXClosingElement::boxed(SPAN, name, ast);
    let constructor = Expression::new_jsx_element(SPAN, opening, [child], Some(closing), ast);
    Ok((input, constructor))
}

fn renderable_children_expression<'a>(
    ast: &AstBuilder<'a>,
    children: &[JSXChild<'a>],
) -> Result<Expression<'a>, Diagnostic> {
    let mut values = oxc_allocator::Vec::new_in(ast);
    for child in children {
        let expression = match child {
            JSXChild::Text(text) => {
                Expression::new_string_literal(text.span, text.value, None, ast)
            }
            JSXChild::Element(element) => {
                Expression::JSXElement(element.clone_in_with_semantic_ids(ast.allocator()))
            }
            JSXChild::Fragment(fragment) => {
                Expression::JSXFragment(fragment.clone_in_with_semantic_ids(ast.allocator()))
            }
            JSXChild::ExpressionContainer(container) => container
                .expression
                .as_expression()
                .ok_or_else(|| unsupported("renderable child expression must have a value"))?
                .clone_in_with_semantic_ids(ast.allocator()),
            JSXChild::Spread(spread) => spread
                .expression
                .clone_in_with_semantic_ids(ast.allocator()),
        };
        values.push(ArrayExpressionElement::from(expression));
    }
    if values.len() == 1 {
        Ok(Expression::try_from(values.pop().unwrap()).unwrap())
    } else {
        Ok(Expression::new_array_expression(SPAN, values, ast))
    }
}

fn prepare_action_element<'a>(
    ast: &AstBuilder<'a>,
    options: &CompilationOptions,
    element: &mut JSXElement<'a>,
) -> Result<(), Diagnostic> {
    let Some(tag) = raw_html::intrinsic_jsx_name(&element.opening_element.name) else {
        return Ok(());
    };
    let tag = tag.to_string();
    for item in &mut element.opening_element.attributes {
        let JSXAttributeItem::Attribute(attribute) = item else {
            if options.feature_enabled(CompilerFeature::Actions)
                && matches!(tag.as_str(), "form" | "button" | "input")
                && let JSXAttributeItem::SpreadAttribute(spread) = item
            {
                spread.argument = call_name(
                    ast,
                    COMPILED_FORM_ACTION,
                    [spread.argument.clone_in_with_semantic_ids(ast.allocator())],
                );
            }
            continue;
        };
        let JSXAttributeName::Identifier(name) = &attribute.name else {
            continue;
        };
        let prop = name.name.as_str();
        if !matches!(prop, "action" | "formAction") {
            continue;
        }
        let valid_host = (prop == "action" && tag == "form")
            || (prop == "formAction" && matches!(tag.as_str(), "button" | "input"));
        let Some(value) = &mut attribute.value else {
            return Err(unsupported(format!("{prop} must have a value"))
                .with_span(SourceSpan::new(attribute.span.start, attribute.span.end)));
        };
        if matches!(value, JSXAttributeValue::StringLiteral(_)) {
            continue;
        }
        if !valid_host {
            return Err(unsupported(format!(
                "function {prop} is only supported on {}",
                if prop == "action" {
                    "<form>"
                } else {
                    "<button> and <input>"
                }
            ))
            .with_span(SourceSpan::new(attribute.span.start, attribute.span.end)));
        }
        if !options.feature_enabled(CompilerFeature::Actions) {
            return Err(unsupported(format!(
                "function {prop} requires the `actions` compiler feature"
            ))
            .with_span(SourceSpan::new(attribute.span.start, attribute.span.end)));
        }
        let JSXAttributeValue::ExpressionContainer(container) = value else {
            return Err(
                unsupported(format!("function {prop} must be an expression"))
                    .with_span(SourceSpan::new(attribute.span.start, attribute.span.end)),
            );
        };
        let Some(expression) = container.expression.as_expression() else {
            return Err(unsupported(format!("function {prop} must have a value"))
                .with_span(SourceSpan::new(container.span.start, container.span.end)));
        };
        container.expression = JSXExpression::from(call_name(
            ast,
            COMPILED_FORM_ACTION,
            [expression.clone_in_with_semantic_ids(ast.allocator())],
        ));
    }
    if options.feature_enabled(CompilerFeature::Actions) && tag == "form" {
        element.opening_element.name =
            JSXElementName::new_identifier_reference(SPAN, ACTION_FORM, ast);
        if let Some(closing) = &mut element.closing_element {
            closing.name = JSXElementName::new_identifier_reference(SPAN, ACTION_FORM, ast);
        }
    }
    Ok(())
}

fn is_generated_list_call(expression: &Expression<'_>) -> bool {
    let Expression::CallExpression(call) = expression.without_parentheses() else {
        return false;
    };
    call.callee
        .get_identifier_reference()
        .is_some_and(|identifier| identifier.name == KEYED || identifier.name == INDEXED)
}

fn is_generated_render_thunk(expression: &Expression<'_>) -> bool {
    matches!(
        expression.without_parentheses(),
        Expression::ArrowFunctionExpression(render) if render.span == SPAN
    ) && contains_jsx(expression)
}

fn is_syntactically_boolean(expression: &Expression<'_>) -> bool {
    match expression.without_parentheses() {
        Expression::BooleanLiteral(_) | Expression::PrivateInExpression(_) => true,
        Expression::BinaryExpression(binary) => {
            binary.operator.is_equality()
                || binary.operator.is_compare()
                || binary.operator.is_relational()
        }
        Expression::UnaryExpression(unary) => {
            unary.operator == oxc_syntax::operator::UnaryOperator::LogicalNot
        }
        _ => false,
    }
}

fn prop_binding_symbols<'a>(
    params: &FormalParameters<'a>,
    sources: &BTreeMap<&str, SourceId>,
    prop_sources: &BTreeSet<&str>,
    allocator: &'a Allocator,
) -> Result<Vec<PropBinding<'a>>, Diagnostic> {
    let mut bindings = Vec::new();
    for parameter in &params.items {
        let BindingPattern::ObjectPattern(pattern) = &parameter.pattern else {
            if let BindingPattern::BindingIdentifier(identifier) = &parameter.pattern
                && prop_sources.contains(identifier.name.as_str())
            {
                let source = sources
                    .get(identifier.name.as_str())
                    .copied()
                    .ok_or_else(|| {
                        analysis_error(format!(
                            "props object binding {} is absent from analysis",
                            identifier.name
                        ))
                    })?;
                let symbol = identifier.symbol_id.get().ok_or_else(|| {
                    analysis_error(format!(
                        "props object {} has no semantic symbol",
                        identifier.name
                    ))
                })?;
                bindings.push(PropBinding {
                    name: identifier.name.to_string(),
                    public_name: None,
                    symbol,
                    source,
                    default: None,
                    rest: true,
                    rest_exclusions: Vec::new(),
                    path: Vec::new(),
                    container_defaults: Vec::new(),
                });
            }
            continue;
        };
        let mut rest_exclusions = Vec::with_capacity(pattern.properties.len());
        for property in &pattern.properties {
            if property.computed {
                return Err(unsupported("computed prop destructuring is unsupported")
                    .with_span(SourceSpan::new(property.span.start, property.span.end)));
            }
            let Some(prop_name) = property.key.static_name() else {
                return Err(unsupported("dynamic prop destructuring is unsupported")
                    .with_span(SourceSpan::new(property.span.start, property.span.end)));
            };
            rest_exclusions.push(prop_name.to_string());
            collect_prop_bindings(
                &property.value,
                prop_name.as_ref(),
                Vec::new(),
                Vec::new(),
                None,
                sources,
                prop_sources,
                allocator,
                &mut bindings,
            )?;
        }
        if let Some(rest) = &pattern.rest {
            let BindingPattern::BindingIdentifier(identifier) = &rest.argument else {
                return Err(unsupported("nested rest prop patterns are unsupported")
                    .with_span(SourceSpan::new(rest.span.start, rest.span.end)));
            };
            if prop_sources.contains(identifier.name.as_str()) {
                let source = sources
                    .get(identifier.name.as_str())
                    .copied()
                    .ok_or_else(|| {
                        analysis_error(format!(
                            "rest prop binding {} is absent from analysis",
                            identifier.name
                        ))
                    })?;
                let symbol = identifier.symbol_id.get().ok_or_else(|| {
                    analysis_error(format!(
                        "rest prop {} has no semantic symbol",
                        identifier.name
                    ))
                })?;
                bindings.push(PropBinding {
                    name: identifier.name.to_string(),
                    public_name: None,
                    symbol,
                    source,
                    default: None,
                    rest: true,
                    rest_exclusions,
                    path: Vec::new(),
                    container_defaults: Vec::new(),
                });
            }
        }
    }
    if bindings.len() != prop_sources.len() {
        return Err(unsupported(
            "compiled props currently require direct object destructuring in the component parameter",
        ));
    }
    Ok(bindings)
}

#[allow(clippy::too_many_arguments)]
fn collect_prop_bindings<'a>(
    pattern: &BindingPattern<'a>,
    public_name: &str,
    path: Vec<String>,
    container_defaults: Vec<Option<Expression<'a>>>,
    current_container_default: Option<Expression<'a>>,
    sources: &BTreeMap<&str, SourceId>,
    prop_sources: &BTreeSet<&str>,
    allocator: &'a Allocator,
    bindings: &mut Vec<PropBinding<'a>>,
) -> Result<(), Diagnostic> {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => push_prop_binding(
            identifier,
            public_name,
            path,
            container_defaults,
            None,
            sources,
            prop_sources,
            bindings,
        ),
        BindingPattern::AssignmentPattern(assignment) => {
            if let BindingPattern::BindingIdentifier(identifier) = &assignment.left {
                return push_prop_binding(
                    identifier,
                    public_name,
                    path,
                    container_defaults,
                    Some(assignment.right.clone_in_with_semantic_ids(allocator)),
                    sources,
                    prop_sources,
                    bindings,
                );
            }
            collect_prop_bindings(
                &assignment.left,
                public_name,
                path,
                container_defaults,
                Some(assignment.right.clone_in_with_semantic_ids(allocator)),
                sources,
                prop_sources,
                allocator,
                bindings,
            )
        }
        BindingPattern::ObjectPattern(object) => {
            if let Some(rest) = &object.rest {
                return Err(unsupported("nested rest prop patterns are unsupported")
                    .with_span(SourceSpan::new(rest.span.start, rest.span.end)));
            }
            for property in &object.properties {
                if property.computed {
                    return Err(
                        unsupported("computed nested prop destructuring is unsupported")
                            .with_span(SourceSpan::new(property.span.start, property.span.end)),
                    );
                }
                let Some(name) = property.key.static_name() else {
                    return Err(
                        unsupported("dynamic nested prop destructuring is unsupported")
                            .with_span(SourceSpan::new(property.span.start, property.span.end)),
                    );
                };
                let mut nested_path = path.clone();
                nested_path.push(name.to_string());
                let mut nested_defaults = container_defaults
                    .iter()
                    .map(|fallback| {
                        fallback
                            .as_ref()
                            .map(|fallback| fallback.clone_in_with_semantic_ids(allocator))
                    })
                    .collect::<Vec<_>>();
                nested_defaults.push(
                    current_container_default
                        .as_ref()
                        .map(|fallback| fallback.clone_in_with_semantic_ids(allocator)),
                );
                collect_prop_bindings(
                    &property.value,
                    public_name,
                    nested_path,
                    nested_defaults,
                    None,
                    sources,
                    prop_sources,
                    allocator,
                    bindings,
                )?;
            }
            Ok(())
        }
        _ => {
            let span = pattern.span();
            Err(
                unsupported("array and nested rest prop patterns are unsupported")
                    .with_span(SourceSpan::new(span.start, span.end)),
            )
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn push_prop_binding<'a>(
    identifier: &BindingIdentifier<'a>,
    public_name: &str,
    path: Vec<String>,
    container_defaults: Vec<Option<Expression<'a>>>,
    default: Option<Expression<'a>>,
    sources: &BTreeMap<&str, SourceId>,
    prop_sources: &BTreeSet<&str>,
    bindings: &mut Vec<PropBinding<'a>>,
) -> Result<(), Diagnostic> {
    if !prop_sources.contains(identifier.name.as_str()) {
        return Ok(());
    }
    let source = sources
        .get(identifier.name.as_str())
        .copied()
        .ok_or_else(|| {
            analysis_error(format!(
                "prop binding {} for {public_name} is absent from analysis",
                identifier.name
            ))
        })?;
    let symbol = identifier
        .symbol_id
        .get()
        .ok_or_else(|| analysis_error(format!("prop {public_name} has no semantic symbol")))?;
    bindings.push(PropBinding {
        name: identifier.name.to_string(),
        public_name: Some(public_name.to_string()),
        symbol,
        source,
        default,
        rest: false,
        rest_exclusions: Vec::new(),
        path,
        container_defaults,
    });
    Ok(())
}

fn rewrite_component_props_parameter<'a>(
    ast: &AstBuilder<'a>,
    params: &mut FormalParameters<'a>,
    prop_bindings: &[PropBinding<'_>],
) {
    if prop_bindings.is_empty() {
        return;
    }
    for parameter in &mut params.items {
        if matches!(
            parameter.pattern,
            BindingPattern::BindingIdentifier(_) | BindingPattern::ObjectPattern(_)
        ) {
            parameter.pattern = BindingPattern::new_binding_identifier(SPAN, atom(ast, PROPS), ast);
            return;
        }
    }
}

fn render_suffix_start(body: &FunctionBody<'_>) -> Result<usize, Diagnostic> {
    let Some(start) = body.statements.iter().position(contains_component_return) else {
        return Err(unsupported("compiled component has no return statement"));
    };
    let unsupported_statement = body.statements[start..].iter().find(|statement| {
        !matches!(
            statement,
            Statement::ReturnStatement(_)
                | Statement::IfStatement(_)
                | Statement::SwitchStatement(_)
                | Statement::EmptyStatement(_)
        )
    });
    if let Some(statement) = unsupported_statement {
        let span = statement.span();
        return Err(Diagnostic::new(
            DiagnosticCode::UnsupportedControlFlow,
            "statements between render-selecting branches are deferred to synchronous-region lowering",
        )
        .with_span(SourceSpan::new(span.start, span.end)));
    }
    Ok(start)
}

fn contains_component_return(statement: &Statement<'_>) -> bool {
    if matches!(statement, Statement::ReturnStatement(_)) {
        return true;
    }
    let mut nested = NestedReturnFinder::default();
    nested.visit_statement(statement);
    nested.found
}

struct SyntheticDerivation<'a> {
    name: &'a str,
    symbol: SymbolId,
    source: SourceId,
    expression: Expression<'a>,
}

#[allow(clippy::too_many_arguments)]
fn collect_missing_derivations<'a>(
    allocator: &'a Allocator,
    body: &FunctionBody<'a>,
    scoping: &Scoping,
    react: &ReactBindings<'_>,
    next_source: &mut u32,
    source_ids: &mut BTreeMap<&'a str, SourceId>,
    source_symbols: &mut BTreeMap<SymbolId, SourceId>,
    state_symbols: &mut BTreeMap<SymbolId, StateReference<'a>>,
    memo_sources: &mut BTreeSet<SourceId>,
    item_source_symbols: &BTreeMap<SymbolId, SourceId>,
) -> Vec<SyntheticDerivation<'a>> {
    let mut derivations = Vec::new();
    loop {
        let previous = source_symbols.len();
        for statement in &body.statements {
            let Statement::VariableDeclaration(declaration) = statement else {
                continue;
            };
            for declarator in &declaration.declarations {
                let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                    continue;
                };
                let Some(symbol) = identifier.symbol_id.get() else {
                    continue;
                };
                if source_symbols.contains_key(&symbol) {
                    continue;
                }
                let Some(initializer) = &declarator.init else {
                    continue;
                };
                if let Expression::CallExpression(call) = initializer
                    && react.memo_hook_call(call).is_some()
                {
                    let Some(dependency_expression) =
                        call.arguments.get(1).and_then(Argument::as_expression)
                    else {
                        continue;
                    };
                    let reads = dependencies(
                        dependency_expression,
                        scoping,
                        source_symbols,
                        item_source_symbols,
                    );
                    if reads.parent.is_empty() || !reads.item.is_empty() {
                        continue;
                    }
                    let source = SourceId::new(*next_source);
                    *next_source += 1;
                    let name = allocator.alloc_str(identifier.name.as_str());
                    source_ids.insert(name, source);
                    source_symbols.insert(symbol, source);
                    state_symbols.insert(
                        symbol,
                        StateReference {
                            state_name: name,
                            setter: false,
                            path: Vec::new(),
                        },
                    );
                    memo_sources.insert(source);
                    continue;
                }
                if matches!(initializer, Expression::CallExpression(call) if react.state_hook_call(call).is_some()
                    || react.context_hook_call(call).is_some()
                    || react.effect_hook_call(call).is_some()
                    || react.is_sync_external_store_call(call))
                {
                    continue;
                }
                let reads = immediate_dependencies(
                    initializer,
                    scoping,
                    source_symbols,
                    item_source_symbols,
                );
                if reads.is_empty() || !reads.item.is_empty() {
                    continue;
                }
                let source = SourceId::new(*next_source);
                *next_source += 1;
                let name = allocator.alloc_str(identifier.name.as_str());
                source_ids.insert(name, source);
                source_symbols.insert(symbol, source);
                derivations.push(SyntheticDerivation {
                    name,
                    symbol,
                    source,
                    expression: initializer.clone_in_with_semantic_ids(allocator),
                });
            }
        }
        if source_symbols.len() == previous {
            break;
        }
    }
    derivations
}

fn propagate_direct_source_aliases<'a>(
    body: &FunctionBody<'a>,
    scoping: &Scoping,
    source_symbols: &mut BTreeMap<SymbolId, SourceId>,
    state_symbols: &mut BTreeMap<SymbolId, StateReference<'a>>,
) {
    loop {
        let previous = source_symbols.len();
        for statement in &body.statements {
            let Statement::VariableDeclaration(declaration) = statement else {
                continue;
            };
            for declarator in &declaration.declarations {
                let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                    continue;
                };
                let Some(symbol) = identifier.symbol_id.get() else {
                    continue;
                };
                if source_symbols.contains_key(&symbol) {
                    continue;
                }
                let Some(Expression::Identifier(initializer)) = &declarator.init else {
                    continue;
                };
                let Some(source_symbol) =
                    crate::react_bindings::reference_symbol(initializer, scoping)
                else {
                    continue;
                };
                let Some(source) = source_symbols.get(&source_symbol).copied() else {
                    continue;
                };
                source_symbols.insert(symbol, source);
                if let Some(state) = state_symbols.get(&source_symbol).cloned() {
                    state_symbols.insert(symbol, state);
                }
            }
        }
        if source_symbols.len() == previous {
            break;
        }
    }
}

fn reject_untracked_derived_bindings(
    body: &FunctionBody<'_>,
    scoping: &Scoping,
    react: &ReactBindings<'_>,
    source_symbols: &BTreeMap<SymbolId, SourceId>,
    item_source_symbols: &BTreeMap<SymbolId, SourceId>,
) -> Result<(), Diagnostic> {
    for statement in &body.statements {
        let Statement::VariableDeclaration(declaration) = statement else {
            continue;
        };
        for declarator in &declaration.declarations {
            let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                continue;
            };
            let Some(symbol) = identifier.symbol_id.get() else {
                continue;
            };
            if source_symbols.contains_key(&symbol) {
                continue;
            }
            let Some(initializer) = &declarator.init else {
                continue;
            };
            if matches!(initializer, Expression::CallExpression(call) if react.memo_hook_call(call).is_some())
            {
                continue;
            }
            let reads =
                immediate_dependencies(initializer, scoping, source_symbols, item_source_symbols);
            if !reads.is_empty() {
                let span = initializer.span();
                return Err(unsupported(format!(
                    "reactive local {} is absent from compiler data-flow analysis",
                    identifier.name
                ))
                .with_span(SourceSpan::new(span.start, span.end)));
            }
        }
    }
    Ok(())
}

#[derive(Default)]
struct NestedReturnFinder {
    found: bool,
}

impl<'a> Visit<'a> for NestedReturnFinder {
    fn visit_return_statement(&mut self, _statement: &ReturnStatement<'a>) {
        self.found = true;
    }

    fn visit_function(&mut self, _function: &Function<'a>, _flags: ScopeFlags) {}

    fn visit_arrow_function_expression(&mut self, _function: &ArrowFunctionExpression<'a>) {}
}

#[derive(Default)]
struct JsxFinder {
    found: bool,
}

impl<'a> Visit<'a> for JsxFinder {
    fn visit_jsx_element(&mut self, _element: &JSXElement<'a>) {
        self.found = true;
    }

    fn visit_jsx_fragment(&mut self, _fragment: &JSXFragment<'a>) {
        self.found = true;
    }
}

fn contains_jsx(expression: &Expression<'_>) -> bool {
    let mut finder = JsxFinder::default();
    finder.visit_expression(expression);
    finder.found
}

fn jsx_map<'a>(
    expression: &Expression<'a>,
    ast: &AstBuilder<'a>,
    scoping: &Scoping,
) -> Option<(Expression<'a>, Option<Expression<'a>>, Expression<'a>)> {
    let Expression::CallExpression(call) = expression.without_parentheses() else {
        return None;
    };
    let Expression::StaticMemberExpression(member) = &call.callee else {
        return None;
    };
    if member.property.name != "map" {
        return None;
    }
    let [argument] = call.arguments.as_slice() else {
        return None;
    };
    let Expression::ArrowFunctionExpression(render) = argument.as_expression()? else {
        return None;
    };
    if !(1..=2).contains(&render.params.items.len()) {
        return None;
    }
    if !matches!(
        render.body.as_expression()?.without_parentheses(),
        Expression::JSXElement(_) | Expression::JSXFragment(_)
    ) {
        return None;
    }
    let key_expression = key_expression(render);
    let destructured = match &render.params.items[0].pattern {
        BindingPattern::BindingIdentifier(_) => None,
        pattern @ BindingPattern::ObjectPattern(_) => Some(item_pattern_bindings(pattern)?),
        _ => return None,
    };
    let first_name = match &render.params.items[0].pattern {
        BindingPattern::BindingIdentifier(identifier) => identifier.name.as_str(),
        BindingPattern::ObjectPattern(_) => ITEM_VALUE,
        _ => unreachable!(),
    };
    let mut parameter_names = vec![first_name];
    if let Some(parameter) = render.params.items.get(1) {
        let BindingPattern::BindingIdentifier(identifier) = &parameter.pattern else {
            return None;
        };
        parameter_names.push(identifier.name.as_str());
    }
    let key = match (key_expression, destructured.as_ref()) {
        (Some(Expression::Identifier(identifier)), Some(bindings)) => {
            let reference = identifier.reference_id.get()?;
            let symbol = scoping.get_reference(reference).symbol_id()?;
            let (_, path) = bindings
                .iter()
                .find(|(candidate, _)| *candidate == symbol)?;
            let key = path.iter().fold(ident(ast, ITEM_VALUE), |object, name| {
                Expression::from(MemberExpression::new_computed_member_expression(
                    SPAN,
                    object,
                    Expression::new_string_literal(
                        SPAN,
                        ast.allocator().alloc_str(name),
                        None,
                        ast,
                    ),
                    false,
                    ast,
                ))
            });
            Some(arrow_expression(ast, parameter_names, key))
        }
        (Some(_), Some(_)) => return None,
        (Some(key_expression), None) => Some(arrow_expression(
            ast,
            parameter_names,
            key_expression.clone_in(ast.allocator()),
        )),
        (None, _) => None,
    };
    let mut render = render.clone_in_with_semantic_ids(ast.allocator());
    if matches!(
        render.params.items[0].pattern,
        BindingPattern::ObjectPattern(_)
    ) {
        render.params.items[0].pattern =
            BindingPattern::new_binding_identifier(SPAN, atom(ast, ITEM_VALUE), ast);
    }
    if render.params.items.len() == 1 {
        append_arrow_parameter(ast, &mut render, ITEM_INDEX);
    }
    append_arrow_parameter(ast, &mut render, ITEM_SCOPE);
    Some((
        member.object.clone_in_with_semantic_ids(ast.allocator()),
        key,
        Expression::ArrowFunctionExpression(render),
    ))
}

fn item_pattern_bindings(pattern: &BindingPattern<'_>) -> Option<Vec<(SymbolId, Vec<String>)>> {
    fn collect(
        pattern: &BindingPattern<'_>,
        path: Vec<String>,
        bindings: &mut Vec<(SymbolId, Vec<String>)>,
    ) -> Option<()> {
        match pattern {
            BindingPattern::BindingIdentifier(identifier) => {
                bindings.push((identifier.symbol_id.get()?, path));
                Some(())
            }
            BindingPattern::ObjectPattern(object) if object.rest.is_none() => {
                for property in &object.properties {
                    if property.computed {
                        return None;
                    }
                    let name = property.key.static_name()?;
                    let mut nested = path.clone();
                    nested.push(name.to_string());
                    collect(&property.value, nested, bindings)?;
                }
                Some(())
            }
            _ => None,
        }
    }

    let mut bindings = Vec::new();
    collect(pattern, Vec::new(), &mut bindings)?;
    Some(bindings)
}

fn key_expression<'a>(render: &'a ArrowFunctionExpression<'a>) -> Option<&'a Expression<'a>> {
    let expression = render.body.as_expression()?;
    let Expression::JSXElement(element) = expression.without_parentheses() else {
        return None;
    };
    element.opening_element.attributes.iter().find_map(|item| {
        let JSXAttributeItem::Attribute(attribute) = item else {
            return None;
        };
        let JSXAttributeName::Identifier(name) = &attribute.name else {
            return None;
        };
        if name.name != "key" {
            return None;
        }
        let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
            return None;
        };
        container.expression.as_expression()
    })
}

#[derive(Default)]
struct DependencyReads {
    parent: BTreeSet<SourceId>,
    item: BTreeSet<SourceId>,
}

impl DependencyReads {
    fn is_empty(&self) -> bool {
        self.parent.is_empty() && self.item.is_empty()
    }
}

struct DependencyFinder<'s> {
    scoping: &'s Scoping,
    source_symbols: &'s BTreeMap<SymbolId, SourceId>,
    item_source_symbols: &'s BTreeMap<SymbolId, SourceId>,
    reads: DependencyReads,
}

struct ImmediateDependencyFinder<'s> {
    scoping: &'s Scoping,
    source_symbols: &'s BTreeMap<SymbolId, SourceId>,
    item_source_symbols: &'s BTreeMap<SymbolId, SourceId>,
    reads: DependencyReads,
}

struct ImmediateStateSetterWriteFinder<'s> {
    scoping: &'s Scoping,
    setter_sources: &'s BTreeMap<SymbolId, SourceId>,
    state_value_sources: &'s BTreeMap<SymbolId, SourceId>,
    writes: BTreeSet<SourceId>,
}

impl<'a> Visit<'a> for DependencyFinder<'_> {
    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        let Some(reference) = identifier.reference_id.get() else {
            return;
        };
        let Some(symbol) = self.scoping.get_reference(reference).symbol_id() else {
            return;
        };
        if let Some(source) = self.source_symbols.get(&symbol) {
            self.reads.parent.insert(*source);
        }
        if let Some(source) = self.item_source_symbols.get(&symbol) {
            self.reads.item.insert(*source);
        }
    }
}

impl<'a> Visit<'a> for ImmediateDependencyFinder<'_> {
    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        let Some(reference) = identifier.reference_id.get() else {
            return;
        };
        let Some(symbol) = self.scoping.get_reference(reference).symbol_id() else {
            return;
        };
        if let Some(source) = self.source_symbols.get(&symbol) {
            self.reads.parent.insert(*source);
        }
        if let Some(source) = self.item_source_symbols.get(&symbol) {
            self.reads.item.insert(*source);
        }
    }

    fn visit_function(&mut self, _function: &Function<'a>, _flags: ScopeFlags) {}

    fn visit_arrow_function_expression(&mut self, _function: &ArrowFunctionExpression<'a>) {}
}

impl<'a> Visit<'a> for ImmediateStateSetterWriteFinder<'_> {
    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        let Some(reference) = identifier.reference_id.get() else {
            return;
        };
        let Some(symbol) = self.scoping.get_reference(reference).symbol_id() else {
            return;
        };
        if let Some(source) = self.setter_sources.get(&symbol) {
            self.writes.insert(*source);
        }
    }

    fn visit_static_member_expression(&mut self, member: &StaticMemberExpression<'a>) {
        if member.property.name == "set"
            && let Expression::Identifier(identifier) = &member.object
            && let Some(reference) = identifier.reference_id.get()
            && let Some(symbol) = self.scoping.get_reference(reference).symbol_id()
            && let Some(source) = self.state_value_sources.get(&symbol)
        {
            self.writes.insert(*source);
        }
        walk_static_member_expression(self, member);
    }

    fn visit_function(&mut self, _function: &Function<'a>, _flags: ScopeFlags) {}

    fn visit_arrow_function_expression(&mut self, _function: &ArrowFunctionExpression<'a>) {}
}

fn immediate_state_setter_writes(
    statement: &Statement<'_>,
    scoping: &Scoping,
    setter_sources: &BTreeMap<SymbolId, SourceId>,
    state_value_sources: &BTreeMap<SymbolId, SourceId>,
) -> BTreeSet<SourceId> {
    let mut finder = ImmediateStateSetterWriteFinder {
        scoping,
        setter_sources,
        state_value_sources,
        writes: BTreeSet::new(),
    };
    finder.visit_statement(statement);
    finder.writes
}

fn dependencies(
    expression: &Expression<'_>,
    scoping: &Scoping,
    source_symbols: &BTreeMap<SymbolId, SourceId>,
    item_source_symbols: &BTreeMap<SymbolId, SourceId>,
) -> DependencyReads {
    let mut finder = DependencyFinder {
        scoping,
        source_symbols,
        item_source_symbols,
        reads: DependencyReads::default(),
    };
    finder.visit_expression(expression);
    finder.reads
}

fn statement_dependencies(
    statements: &[Statement<'_>],
    scoping: &Scoping,
    source_symbols: &BTreeMap<SymbolId, SourceId>,
    item_source_symbols: &BTreeMap<SymbolId, SourceId>,
) -> DependencyReads {
    let mut finder = ImmediateDependencyFinder {
        scoping,
        source_symbols,
        item_source_symbols,
        reads: DependencyReads::default(),
    };
    for statement in statements {
        finder.visit_statement(statement);
    }
    finder.reads
}

fn immediate_dependencies(
    expression: &Expression<'_>,
    scoping: &Scoping,
    source_symbols: &BTreeMap<SymbolId, SourceId>,
    item_source_symbols: &BTreeMap<SymbolId, SourceId>,
) -> DependencyReads {
    let mut finder = ImmediateDependencyFinder {
        scoping,
        source_symbols,
        item_source_symbols,
        reads: DependencyReads::default(),
    };
    finder.visit_expression(expression);
    finder.reads
}

fn snapshot_effect_create<'a>(
    ast: &AstBuilder<'a>,
    expression: &Expression<'a>,
    scoping: &Scoping,
    source_symbols: &BTreeMap<SymbolId, SourceId>,
) -> Expression<'a> {
    let mut create = expression.clone_in_with_semantic_ids(ast.allocator());
    let mut rewriter = EffectSnapshotRewriter {
        ast,
        scoping,
        source_symbols,
        captures: BTreeMap::new(),
    };
    rewriter.visit_expression(&mut create);
    if rewriter.captures.is_empty() {
        return create;
    }
    let parameters = rewriter
        .captures
        .values()
        .map(|(name, _)| ast.allocator().alloc_str(name))
        .collect::<Vec<_>>();
    let arguments = rewriter
        .captures
        .into_values()
        .map(|(_, expression)| expression);
    call(ast, arrow_expression(ast, parameters, create), arguments)
}

struct EffectSnapshotRewriter<'a, 'b, 's> {
    ast: &'b AstBuilder<'a>,
    scoping: &'s Scoping,
    source_symbols: &'s BTreeMap<SymbolId, SourceId>,
    captures: BTreeMap<SymbolId, (String, Expression<'a>)>,
}

impl<'a> VisitMut<'a> for EffectSnapshotRewriter<'a, '_, '_> {
    fn visit_expression(&mut self, expression: &mut Expression<'a>) {
        let Expression::Identifier(identifier) = expression else {
            walk_expression_mut(self, expression);
            return;
        };
        let Some(reference) = identifier.reference_id.get() else {
            return;
        };
        let Some(symbol) = self.scoping.get_reference(reference).symbol_id() else {
            return;
        };
        let Some(source) = self.source_symbols.get(&symbol) else {
            return;
        };
        let name = format!("__vidactSnapshot{}", source.get());
        self.captures.entry(symbol).or_insert_with(|| {
            (
                name.clone(),
                Expression::Identifier(identifier.clone_in_with_semantic_ids(self.ast.allocator())),
            )
        });
        *expression = ident(self.ast, &name);
    }
}

fn outer_item_reference(
    render: &Expression<'_>,
    scoping: &Scoping,
    item_source_symbols: &BTreeMap<SymbolId, SourceId>,
) -> Option<SourceSpan> {
    let render_span = render.span();
    let mut finder = OuterItemReferenceFinder {
        render_span,
        scoping,
        item_source_symbols,
        span: None,
    };
    finder.visit_expression(render);
    finder.span
}

struct OuterItemReferenceFinder<'s> {
    render_span: Span,
    scoping: &'s Scoping,
    item_source_symbols: &'s BTreeMap<SymbolId, SourceId>,
    span: Option<SourceSpan>,
}

impl<'a> Visit<'a> for OuterItemReferenceFinder<'_> {
    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        if self.span.is_some() {
            return;
        }
        let Some(reference) = identifier.reference_id.get() else {
            return;
        };
        let Some(symbol) = self.scoping.get_reference(reference).symbol_id() else {
            return;
        };
        if !self.item_source_symbols.contains_key(&symbol) {
            return;
        }
        let declaration = self.scoping.symbol_span(symbol);
        if declaration.start < self.render_span.start || declaration.end > self.render_span.end {
            self.span = Some(SourceSpan::new(identifier.span.start, identifier.span.end));
        }
    }
}

fn append_item_dependency<'a>(
    ast: &AstBuilder<'a>,
    arguments: &mut Vec<Expression<'a>>,
    reads: &DependencyReads,
) {
    if reads.item.is_empty() {
        return;
    }
    arguments.push(ident(ast, ITEM_SCOPE));
    arguments.push(dependency_mask(ast, &reads.item));
}

fn dependency_mask<'a>(ast: &AstBuilder<'a>, sources: &BTreeSet<SourceId>) -> Expression<'a> {
    mask(ast, &sources.iter().copied().collect::<Vec<_>>())
}

fn item_parameters<'a>(
    body: &FunctionBody<'a>,
    ast: &AstBuilder<'a>,
) -> (
    BTreeMap<SymbolId, SourceId>,
    BTreeMap<SymbolId, StateReference<'a>>,
) {
    let mut collector = ItemParameterCollector {
        ast,
        sources: BTreeMap::new(),
        states: BTreeMap::new(),
    };
    collector.visit_function_body(body);
    (collector.sources, collector.states)
}

struct ItemParameterCollector<'a, 'b> {
    ast: &'b AstBuilder<'a>,
    sources: BTreeMap<SymbolId, SourceId>,
    states: BTreeMap<SymbolId, StateReference<'a>>,
}

impl<'a> Visit<'a> for ItemParameterCollector<'a, '_> {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        let is_map = matches!(
            &call.callee,
            Expression::StaticMemberExpression(member) if member.property.name == "map"
        );
        if is_map
            && let [argument] = call.arguments.as_slice()
            && let Some(Expression::ArrowFunctionExpression(render)) = argument.as_expression()
            && (1..=2).contains(&render.params.items.len())
            && render.body.as_expression().is_some_and(|expression| {
                matches!(
                    expression.without_parentheses(),
                    Expression::JSXElement(_) | Expression::JSXFragment(_)
                )
            })
        {
            for (index, parameter) in render.params.items.iter().take(2).enumerate() {
                let Some(bindings) = item_pattern_bindings(&parameter.pattern) else {
                    continue;
                };
                let state_name = match &parameter.pattern {
                    BindingPattern::BindingIdentifier(identifier) => identifier.name.as_str(),
                    BindingPattern::ObjectPattern(_) if index == 0 => ITEM_VALUE,
                    _ => continue,
                };
                for (symbol, path) in bindings {
                    self.sources.insert(symbol, SourceId::new(index as u32));
                    self.states.insert(
                        symbol,
                        StateReference {
                            state_name: self.ast.allocator().alloc_str(state_name),
                            setter: false,
                            path,
                        },
                    );
                }
            }
        }
        walk_call_expression(self, call);
    }
}

struct MultiStateReferenceRewriter<'a, 'b, 's> {
    ast: &'b AstBuilder<'a>,
    scoping: &'s Scoping,
    states: &'s BTreeMap<SymbolId, StateReference<'a>>,
}

impl<'a> VisitMut<'a> for MultiStateReferenceRewriter<'a, '_, '_> {
    fn visit_expression(&mut self, expression: &mut Expression<'a>) {
        let Expression::Identifier(identifier) = expression else {
            walk_expression_mut(self, expression);
            return;
        };
        let Some(reference) = identifier.reference_id.get() else {
            return;
        };
        let Some(symbol) = self.scoping.get_reference(reference).symbol_id() else {
            return;
        };
        let Some(state) = self.states.get(&symbol) else {
            return;
        };
        let member = Expression::from(MemberExpression::new_static_member_expression(
            SPAN,
            ident(self.ast, state.state_name),
            IdentifierName::new(SPAN, if state.setter { "set" } else { "get" }, self.ast),
            false,
            self.ast,
        ));
        *expression = if state.setter {
            member
        } else {
            state
                .path
                .iter()
                .fold(call(self.ast, member, []), |object, name| {
                    Expression::from(MemberExpression::new_computed_member_expression(
                        SPAN,
                        object,
                        Expression::new_string_literal(
                            SPAN,
                            self.ast.allocator().alloc_str(name),
                            None,
                            self.ast,
                        ),
                        false,
                        self.ast,
                    ))
                })
        };
    }
}

fn register_derived<'a>(
    ast: &AstBuilder<'a>,
    name: &str,
    expression: Expression<'a>,
    reads: &[SourceId],
    writes: &[SourceId],
) -> Statement<'a> {
    let assignment = Statement::new_expression_statement(
        SPAN,
        Expression::new_assignment_expression(
            SPAN,
            oxc_syntax::operator::AssignmentOperator::Assign,
            AssignmentTarget::new_assignment_target_identifier(SPAN, atom(ast, name), ast),
            expression,
            ast,
        ),
        ast,
    );
    Statement::new_expression_statement(
        SPAN,
        call_index(
            ast,
            ident(ast, SCOPE),
            0,
            [
                mask(ast, reads),
                arrow_block(ast, [], [assignment]),
                mask(ast, writes),
            ],
        ),
        ast,
    )
}

fn register_derived_statements<'a>(
    ast: &AstBuilder<'a>,
    statements: impl IntoIterator<Item = Statement<'a>>,
    reads: &[SourceId],
    writes: &[SourceId],
) -> Statement<'a> {
    Statement::new_expression_statement(
        SPAN,
        call_index(
            ast,
            ident(ast, SCOPE),
            0,
            [
                mask(ast, reads),
                arrow_block(ast, [], statements),
                mask(ast, writes),
            ],
        ),
        ast,
    )
}

fn scope_statement<'a>(ast: &AstBuilder<'a>, narrow: bool) -> Statement<'a> {
    variable_statement(
        ast,
        VariableDeclarationKind::Const,
        SCOPE,
        call_name(
            ast,
            if narrow {
                CREATE_NARROW_SCOPE
            } else {
                CREATE_SCOPE
            },
            [],
        ),
    )
}

fn runtime_imports<'a>(
    ast: &AstBuilder<'a>,
    program: &Program<'a>,
    options: &CompilationOptions,
) -> Vec<Statement<'a>> {
    let names = [
        ("ActionForm", ACTION_FORM),
        ("binding", BINDING),
        ("cloneRenderable", CLONE_RENDERABLE),
        ("cloneRenderableComponent", CLONE_RENDERABLE_COMPONENT),
        ("combineSources", COMBINE_SOURCES),
        ("compiledComponentSpread", COMPILED_COMPONENT_SPREAD),
        ("compiledEffect", COMPILED_EFFECT),
        ("compiledEvent", COMPILED_EVENT),
        ("compiledImperativeHandle", COMPILED_IMPERATIVE_HANDLE),
        ("compiledInsertionEffect", COMPILED_INSERTION_EFFECT),
        ("compiledLayoutEffect", COMPILED_LAYOUT_EFFECT),
        ("compiledFormAction", COMPILED_FORM_ACTION),
        ("compiledSpread", COMPILED_SPREAD),
        ("compiledRoot", COMPILED_ROOT),
        ("choose", CHOOSE),
        ("createCompiledAsync", CREATE_ASYNC),
        ("createCompiledActionState", CREATE_ACTION_STATE),
        ("createCompiledContext", CREATE_CONTEXT),
        ("createCompiledDeferred", CREATE_DEFERRED),
        ("createCompiledExternalStore", CREATE_EXTERNAL_STORE),
        ("createCompiledFormStatus", CREATE_FORM_STATUS),
        ("createCompiledEffectEvent", CREATE_EFFECT_EVENT),
        ("createCompiledId", CREATE_ID),
        ("createCompiledMemo", CREATE_MEMO),
        ("createCompiledOptimistic", CREATE_OPTIMISTIC),
        ("createCompiledProp", CREATE_PROP),
        ("createCompiledRestProp", CREATE_REST_PROP),
        ("createCompiledReducer", CREATE_REDUCER),
        ("createCompiledScope", CREATE_SCOPE),
        ("createNarrowCompiledScope", CREATE_NARROW_SCOPE),
        ("createCompiledState", CREATE_STATE),
        ("createCompiledTransition", CREATE_TRANSITION),
        ("createRenderable", CREATE_RENDERABLE),
        ("runWithCompiledContext", RUN_WITH_CONTEXT),
        ("deferred", DEFERRED),
        ("dispatch", DISPATCH),
        ("dynamicIntrinsicComponent", DYNAMIC_INTRINSIC_COMPONENT),
        ("keyedFragmentComponent", KEYED_FRAGMENT_COMPONENT),
        ("enableFrameworkMetadata", ENABLE_FRAMEWORK_METADATA),
        ("forwardedRef", FORWARDED_REF),
        ("indexed", INDEXED),
        ("keyed", KEYED),
        ("nestedProp", NESTED_PROP),
        ("objectRest", OBJECT_REST),
        ("isRenderable", IS_RENDERABLE),
        ("renderableChildren", RENDERABLE_CHILDREN),
        ("renderableMarker", RENDERABLE_MARKER),
        ("renderableProps", RENDERABLE_PROPS),
        ("renderableRef", RENDERABLE_REF),
        ("renderableToArray", RENDERABLE_TO_ARRAY),
        ("source", SOURCE),
        ("when", WHEN),
    ];
    let mut references = GeneratedReferenceFinder::default();
    references.visit_program(program);
    let mut imports = Vec::new();
    if options.target() == crate::CompilerTarget::Hydrate {
        imports.push(Statement::new_import_declaration(
            SPAN,
            None,
            StringLiteral::new(SPAN, "@vidact/runtime/hydrate", None, ast),
            None,
            None,
            ImportOrExportKind::Value,
            ast,
        ));
    }
    for source in [
        "@vidact/runtime",
        "@vidact/runtime/async",
        "@vidact/runtime/concurrent",
        "@vidact/runtime/actions",
        "@vidact/runtime/framework",
    ] {
        let specifiers = oxc_allocator::Vec::from_iter_in(
            names
                .iter()
                .copied()
                .filter(|(_, local)| {
                    references.names.contains(*local) && runtime_source(local) == source
                })
                .map(|(imported, local)| {
                    ImportDeclarationSpecifier::new_import_specifier(
                        SPAN,
                        ModuleExportName::new_identifier_name(SPAN, atom(ast, imported), ast),
                        BindingIdentifier::new(SPAN, atom(ast, local), ast),
                        ImportOrExportKind::Value,
                        ast,
                    )
                }),
            ast,
        );
        if specifiers.is_empty() {
            continue;
        }
        imports.push(Statement::new_import_declaration(
            SPAN,
            Some(specifiers),
            StringLiteral::new(SPAN, atom(ast, source), None, ast),
            None,
            None,
            ImportOrExportKind::Value,
            ast,
        ));
    }
    imports
}

fn runtime_source(local: &str) -> &'static str {
    match local {
        CREATE_ASYNC => "@vidact/runtime/async",
        CREATE_DEFERRED | CREATE_TRANSITION => "@vidact/runtime/concurrent",
        ACTION_FORM | COMPILED_FORM_ACTION | CREATE_ACTION_STATE | CREATE_FORM_STATUS
        | CREATE_OPTIMISTIC => "@vidact/runtime/actions",
        ENABLE_FRAMEWORK_METADATA => "@vidact/runtime/framework",
        _ => "@vidact/runtime",
    }
}

fn capability_import<'a>(
    ast: &AstBuilder<'a>,
    imported: &str,
    local: &str,
    source: &str,
) -> Statement<'a> {
    let specifiers = oxc_allocator::Vec::from_iter_in(
        [ImportDeclarationSpecifier::new_import_specifier(
            SPAN,
            ModuleExportName::new_identifier_name(SPAN, atom(ast, imported), ast),
            BindingIdentifier::new(SPAN, atom(ast, local), ast),
            ImportOrExportKind::Value,
            ast,
        )],
        ast,
    );
    Statement::new_import_declaration(
        SPAN,
        Some(specifiers),
        StringLiteral::new(SPAN, atom(ast, source), None, ast),
        None,
        None,
        ImportOrExportKind::Value,
        ast,
    )
}

#[derive(Default)]
struct GeneratedReferenceFinder {
    names: BTreeSet<String>,
}

impl<'a> Visit<'a> for GeneratedReferenceFinder {
    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        if identifier.name.starts_with("__vidact") {
            self.names.insert(identifier.name.to_string());
        }
    }
}

fn unsupported(message: impl Into<String>) -> Diagnostic {
    Diagnostic::new(DiagnosticCode::UnsupportedSyntax, message)
}

fn analysis_error(message: impl Into<String>) -> Diagnostic {
    Diagnostic::new(DiagnosticCode::AnalysisFailed, message)
}
