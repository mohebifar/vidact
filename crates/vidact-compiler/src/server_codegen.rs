use std::{collections::BTreeSet, path::Path};

use oxc_allocator::{Allocator, Vec as ArenaVec};
use oxc_ast::{
    ast::{
        CallExpression, Class, JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXElement,
        JSXElementName, Program, Statement,
    },
    builder::AstBuilder,
};
use oxc_ast_visit::{
    Visit, VisitMut,
    walk::{walk_call_expression, walk_class, walk_jsx_element},
    walk_mut::{walk_expression, walk_jsx_element as walk_jsx_element_mut, walk_statements},
};
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_react_compiler::{CompileResult, CompilerOutputMode, PluginOptions, compile};
use oxc_semantic::SemanticBuilder;
use oxc_span::{GetSpan, SourceType};
use oxc_syntax::operator::{BinaryOperator, UnaryOperator};

use crate::{
    ComponentIr, Diagnostic, DiagnosticCode, SourceSpan,
    analysis::ModuleInput,
    ast_utils::{
        normalize_compiler_hook_inputs, normalize_expression_bodied_component_arrows,
        normalize_simple_logical_assignments, restore_anonymous_default_component_names,
    },
    custom_hooks::plan_local_custom_hooks,
    lower_component,
    lowered_react::{may_contain_lowered_react, normalize_lowered_react},
    options::{CompilationOptions, CompilerFeature, CompilerTarget},
    oxc_react::{analyze_program, lower_react_diagnostics},
    react_bindings::ReactBindings,
    server_renderable::lower_server_renderables,
    surgical_codegen::normalize_state_elisions,
};

#[derive(Debug)]
pub struct ServerCompilation {
    pub code: String,
    pub source_map: String,
    pub components: Vec<ComponentIr>,
}

struct ObjectMethodNormalizer;

impl<'a> VisitMut<'a> for ObjectMethodNormalizer {
    fn visit_object_property(&mut self, property: &mut oxc_ast::ast::ObjectProperty<'a>) {
        if property.kind == oxc_ast::ast::PropertyKind::Init {
            property.method = false;
        }
        oxc_ast_visit::walk_mut::walk_object_property(self, property);
    }
}

struct ServerEnvironmentNormalizer<'a> {
    ast: AstBuilder<'a>,
}

impl<'a> VisitMut<'a> for ServerEnvironmentNormalizer<'a> {
    fn visit_statements(&mut self, statements: &mut ArenaVec<'a, Statement<'a>>) {
        walk_statements(self, statements);
        statements.retain(|statement| {
            !matches!(
                statement,
                Statement::IfStatement(statement)
                    if statement.alternate.is_none()
                        && matches!(
                            statement.test.without_parentheses(),
                            oxc_ast::ast::Expression::BooleanLiteral(value) if !value.value
                        )
            )
        });
    }

    fn visit_expression(&mut self, expression: &mut oxc_ast::ast::Expression<'a>) {
        walk_expression(self, expression);
        let oxc_ast::ast::Expression::BinaryExpression(binary) = expression else {
            return;
        };
        let equality = match binary.operator {
            BinaryOperator::Equality | BinaryOperator::StrictEquality => Some(true),
            BinaryOperator::Inequality | BinaryOperator::StrictInequality => Some(false),
            _ => None,
        };
        let Some(value) = equality else {
            return;
        };
        if is_typeof_document(&binary.left, &binary.right)
            || is_typeof_document(&binary.right, &binary.left)
        {
            *expression =
                oxc_ast::ast::Expression::new_boolean_literal(binary.span, value, &self.ast);
        }
    }
}

fn is_typeof_document(
    left: &oxc_ast::ast::Expression<'_>,
    right: &oxc_ast::ast::Expression<'_>,
) -> bool {
    let oxc_ast::ast::Expression::UnaryExpression(unary) = left.without_parentheses() else {
        return false;
    };
    let oxc_ast::ast::Expression::Identifier(identifier) = unary.argument.without_parentheses()
    else {
        return false;
    };
    let oxc_ast::ast::Expression::StringLiteral(value) = right.without_parentheses() else {
        return false;
    };
    unary.operator == UnaryOperator::Typeof
        && identifier.name == "document"
        && value.value == "undefined"
}

pub fn compile_server_module(input: ModuleInput<'_>) -> Result<ServerCompilation, Vec<Diagnostic>> {
    compile_server_module_with_options(input, &CompilationOptions::new(CompilerTarget::Server))
}

pub fn compile_server_module_with_options(
    input: ModuleInput<'_>,
    options: &CompilationOptions,
) -> Result<ServerCompilation, Vec<Diagnostic>> {
    let allocator = Allocator::default();
    let mut canonical_maps = Vec::new();
    let mut canonical_sources = vec![input.source.to_string()];
    let source_type =
        SourceType::from_path(Path::new(input.filename)).unwrap_or_else(|_| SourceType::tsx());
    let mut parsed = Parser::new(&allocator, input.source, source_type).parse();
    if !parsed.diagnostics.is_empty() {
        return Err(vec![Diagnostic::new(
            crate::DiagnosticCode::AnalysisFailed,
            format!(
                "OXC could not parse {} for server codegen: {:?}",
                input.filename, parsed.diagnostics
            ),
        )]);
    }
    crate::framework_directives::validate_framework_directives(&parsed.program, options)
        .map_err(|diagnostic| vec![diagnostic])?;
    if options.feature_enabled(CompilerFeature::DependencySource) {
        normalize_simple_logical_assignments(&allocator, &mut parsed.program);
        ServerEnvironmentNormalizer {
            ast: AstBuilder::new(&allocator),
        }
        .visit_program(&mut parsed.program);
    }
    let anonymous_defaults =
        normalize_expression_bodied_component_arrows(&allocator, &mut parsed.program);

    let semantic = SemanticBuilder::new()
        .with_build_nodes(true)
        .with_check_syntax_error(true)
        .build(&parsed.program);
    if !semantic.diagnostics.is_empty() {
        return Err(vec![Diagnostic::new(
            crate::DiagnosticCode::AnalysisFailed,
            format!(
                "OXC semantic analysis failed for {} during server codegen: {:?}",
                input.filename, semantic.diagnostics
            ),
        )]);
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
            return Err(vec![Diagnostic::new(
                crate::DiagnosticCode::AnalysisFailed,
                format!(
                    "OXC semantic analysis failed for {} after lowered React normalization: {:?}",
                    input.filename, semantic.diagnostics
                ),
            )]);
        }
        semantic
    } else {
        semantic
    };
    let custom_hooks =
        plan_local_custom_hooks(&allocator, &parsed.program, semantic.semantic.scoping())
            .map_err(|diagnostic| vec![diagnostic])?;
    drop(semantic);
    if let Some(custom_hooks) = custom_hooks {
        custom_hooks
            .apply(&mut parsed.program)
            .map_err(|diagnostic| vec![diagnostic])?;
    }
    if options.feature_enabled(CompilerFeature::DependencySource) {
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
            return Err(vec![Diagnostic::new(
                crate::DiagnosticCode::AnalysisFailed,
                format!(
                    "OXC could not parse {} after server custom-hook canonicalization: {:?}",
                    input.filename, parsed.diagnostics
                ),
            )]);
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

    let semantic = SemanticBuilder::new()
        .with_build_nodes(true)
        .with_check_syntax_error(true)
        .build(&parsed.program);
    if !semantic.diagnostics.is_empty() {
        return Err(vec![Diagnostic::new(
            crate::DiagnosticCode::AnalysisFailed,
            format!(
                "OXC semantic analysis failed for {} after server custom-hook expansion: {:?}",
                input.filename, semantic.diagnostics
            ),
        )]);
    }
    let scoping = semantic.semantic.into_scoping();
    normalize_compiler_hook_inputs(&allocator, &mut parsed.program, &scoping);
    let semantic = SemanticBuilder::new()
        .with_build_nodes(true)
        .with_check_syntax_error(true)
        .build(&parsed.program);
    if !semantic.diagnostics.is_empty() {
        return Err(vec![Diagnostic::new(
            crate::DiagnosticCode::AnalysisFailed,
            format!(
                "OXC semantic analysis failed for {} after frozen hook dependency normalization: {:?}",
                input.filename, semantic.diagnostics
            ),
        )]);
    }

    let react = ReactBindings::new(&parsed.program, semantic.semantic.scoping());
    let mut validator = ServerSourceValidator {
        react: &react,
        unsafe_html: options.feature_enabled(CompilerFeature::UnsafeHtml),
        async_enabled: options.feature_enabled(CompilerFeature::Async),
        concurrent_enabled: options.feature_enabled(CompilerFeature::Concurrent),
        actions_enabled: options.feature_enabled(CompilerFeature::Actions),
        profiling_enabled: options.feature_enabled(CompilerFeature::Profiling),
        framework_enabled: options.feature_enabled(CompilerFeature::Framework),
        suspense_spans: BTreeSet::new(),
        activity_spans: BTreeSet::new(),
        profiler_spans: BTreeSet::new(),
        diagnostic: None,
    };
    validator.visit_program(&parsed.program);
    if let Some(diagnostic) = validator.diagnostic {
        let mut diagnostics = vec![diagnostic];
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
    let suspense_spans = std::mem::take(&mut validator.suspense_spans);
    let activity_spans = std::mem::take(&mut validator.activity_spans);
    let profiler_spans = std::mem::take(&mut validator.profiler_spans);
    drop(validator);
    drop(react);
    let scoping = semantic.semantic.into_scoping();
    let react = ReactBindings::new(&parsed.program, &scoping);
    lower_server_renderables(&allocator, &mut parsed.program, &react).map_err(|diagnostic| {
        let mut diagnostics = vec![diagnostic];
        crate::source_maps::remap_diagnostics(
            &mut diagnostics,
            &canonical_sources,
            &canonical_maps,
        );
        diagnostics
    })?;
    drop(react);
    let mut async_transformer = ServerAsyncTransformer {
        ast: AstBuilder::new(&allocator),
        options,
        suspense_spans,
        activity_spans,
        profiler_spans,
        diagnostic: None,
    };
    async_transformer.visit_program(&mut parsed.program);
    if let Some(diagnostic) = async_transformer.diagnostic {
        let mut diagnostics = vec![diagnostic];
        crate::source_maps::remap_diagnostics(
            &mut diagnostics,
            &canonical_sources,
            &canonical_maps,
        );
        return Err(diagnostics);
    }
    if options.feature_enabled(CompilerFeature::DependencySource) {
        ObjectMethodNormalizer.visit_program(&mut parsed.program);
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
            return Err(vec![Diagnostic::new(
                DiagnosticCode::AnalysisFailed,
                format!(
                    "OXC could not parse {} after server capability canonicalization: {:?}",
                    input.filename, parsed.diagnostics
                ),
            )]);
        }
    }
    let semantic = SemanticBuilder::new()
        .with_build_nodes(true)
        .with_check_syntax_error(true)
        .build(&parsed.program);
    if !semantic.diagnostics.is_empty() {
        return Err(vec![Diagnostic::new(
            DiagnosticCode::AnalysisFailed,
            format!(
                "OXC semantic analysis failed after async server lowering for {}: {:?}",
                input.filename, semantic.diagnostics
            ),
        )]);
    }

    let mut react_options = PluginOptions {
        output_mode: Some(CompilerOutputMode::Ssr),
        ..PluginOptions::default()
    };
    if options.feature_enabled(CompilerFeature::DependencySource) {
        react_options.environment.validate_ref_access_during_render = false;
        react_options
            .environment
            .validate_exhaustive_memoization_dependencies = false;
        react_options.environment.validate_hooks_usage = false;
    }
    let result = compile(
        &parsed.program,
        &semantic.semantic,
        &allocator,
        react_options,
    );
    drop(semantic);
    match result {
        CompileResult::Success {
            output: Some(output),
            diagnostics,
        } if diagnostics.is_empty() => output.transform(&mut parsed.program),
        CompileResult::Success { diagnostics, .. } | CompileResult::Fatal { diagnostics } => {
            let mut diagnostics = lower_react_diagnostics(
                &diagnostics,
                format!(
                    "React Compiler rejected {} for server codegen",
                    input.filename
                ),
            );
            crate::source_maps::remap_diagnostics(
                &mut diagnostics,
                &canonical_sources,
                &canonical_maps,
            );
            return Err(diagnostics);
        }
    }
    restore_anonymous_default_component_names(&mut parsed.program, &anonymous_defaults);

    let generated = Codegen::new()
        .with_options(CodegenOptions {
            source_map_path: Some(Path::new(input.filename).to_path_buf()),
            ..CodegenOptions::default()
        })
        .build(&parsed.program);
    let source_map = generated
        .map
        .expect("source map is enabled for server compilation")
        .into_owned_sourcemap();
    let source_map =
        crate::source_maps::compose_chain(source_map, canonical_maps.into_iter()).to_json_string();
    Ok(ServerCompilation {
        code: generated.code,
        source_map,
        components,
    })
}

struct ServerAsyncTransformer<'a, 's> {
    ast: AstBuilder<'a>,
    options: &'s CompilationOptions,
    suspense_spans: BTreeSet<u32>,
    activity_spans: BTreeSet<u32>,
    profiler_spans: BTreeSet<u32>,
    diagnostic: Option<Diagnostic>,
}

impl<'a> VisitMut<'a> for ServerAsyncTransformer<'a, '_> {
    fn visit_program(&mut self, program: &mut Program<'a>) {
        oxc_ast_visit::walk_mut::walk_program(self, program);
    }

    fn visit_jsx_element(&mut self, element: &mut JSXElement<'a>) {
        if self.diagnostic.is_some() {
            return;
        }
        if self.suspense_spans.contains(&element.span.start)
            && let Err(diagnostic) = crate::surgical_codegen::prepare_known_suspense_element(
                &self.ast,
                self.options,
                element,
            )
        {
            self.diagnostic = Some(diagnostic);
            return;
        }
        if self.activity_spans.contains(&element.span.start)
            && let Err(diagnostic) = crate::surgical_codegen::prepare_known_activity_element(
                &self.ast,
                self.options,
                element,
            )
        {
            self.diagnostic = Some(diagnostic);
            return;
        }
        if self.profiler_spans.contains(&element.span.start)
            && let Err(diagnostic) = crate::surgical_codegen::prepare_known_profiler_element(
                &self.ast,
                self.options,
                element,
            )
        {
            self.diagnostic = Some(diagnostic);
            return;
        }
        walk_jsx_element_mut(self, element);
    }
}

struct ServerSourceValidator<'r, 's> {
    react: &'r ReactBindings<'s>,
    unsafe_html: bool,
    async_enabled: bool,
    concurrent_enabled: bool,
    actions_enabled: bool,
    profiling_enabled: bool,
    framework_enabled: bool,
    suspense_spans: BTreeSet<u32>,
    activity_spans: BTreeSet<u32>,
    profiler_spans: BTreeSet<u32>,
    diagnostic: Option<Diagnostic>,
}

impl<'a> Visit<'a> for ServerSourceValidator<'_, '_> {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if self.diagnostic.is_some() {
            return;
        }
        if !self.framework_enabled
            && let Some(name) = self.react.framework_call_name(call)
        {
            self.diagnostic = Some(
                Diagnostic::new(
                    DiagnosticCode::UnsupportedSyntax,
                    format!("{name} requires the `framework` compiler feature"),
                )
                .with_span(SourceSpan::new(call.span.start, call.span.end)),
            );
            return;
        }
        if self.react.is_lazy_call(call) && !self.async_enabled {
            self.diagnostic = Some(
                Diagnostic::new(
                    DiagnosticCode::UnsupportedSyntax,
                    "lazy requires the `async` compiler feature",
                )
                .with_span(SourceSpan::new(call.span.start, call.span.end)),
            );
            return;
        }
        if !self.profiling_enabled {
            let name = if self.react.is_debug_value_call(call) {
                Some("useDebugValue")
            } else if self.react.is_capture_owner_stack_call(call) {
                Some("captureOwnerStack")
            } else {
                None
            };
            if let Some(name) = name {
                self.diagnostic = Some(
                    Diagnostic::new(
                        DiagnosticCode::UnsupportedSyntax,
                        format!("{name} requires the `profiling` compiler feature"),
                    )
                    .with_span(SourceSpan::new(call.span.start, call.span.end)),
                );
                return;
            }
        }
        let action_name = self
            .react
            .action_hook_call(call)
            .map(crate::react_bindings::ActionHook::name)
            .or_else(|| {
                self.react
                    .is_form_status_call(call)
                    .then_some("useFormStatus")
            });
        if !self.actions_enabled
            && let Some(name) = action_name
        {
            self.diagnostic = Some(
                Diagnostic::new(
                    DiagnosticCode::UnsupportedSyntax,
                    format!("{name} requires the `actions` compiler feature"),
                )
                .with_span(SourceSpan::new(call.span.start, call.span.end)),
            );
            return;
        }
        let concurrent_name = self
            .react
            .concurrent_hook_call(call)
            .map(crate::react_bindings::ConcurrentHook::name)
            .or_else(|| {
                self.react
                    .is_start_transition_call(call)
                    .then_some("startTransition")
            })
            .or_else(|| self.react.is_flush_sync_call(call).then_some("flushSync"));
        if !self.concurrent_enabled
            && let Some(name) = concurrent_name
        {
            self.diagnostic = Some(
                Diagnostic::new(
                    DiagnosticCode::UnsupportedSyntax,
                    format!("{name} requires the `concurrent` compiler feature"),
                )
                .with_span(SourceSpan::new(call.span.start, call.span.end)),
            );
            return;
        }
        if !self.async_enabled
            && self.react.context_hook_call(call) == Some(crate::react_bindings::ContextHook::Use)
            && call.arguments.len() == 1
            && let Some(argument) = call.arguments[0].as_expression()
            && crate::surgical_codegen::is_obvious_promise_expression(argument)
        {
            self.diagnostic = Some(
                Diagnostic::new(
                    DiagnosticCode::UnsupportedSyntax,
                    "use(promise) requires the `async` compiler feature",
                )
                .with_span(SourceSpan::new(call.span.start, call.span.end)),
            );
            return;
        }
        walk_call_expression(self, call);
    }

    fn visit_class(&mut self, class: &Class<'a>) {
        if self.diagnostic.is_some() {
            return;
        }
        if let Some(super_class) = &class.super_class
            && (self.react.is_named_expression(super_class, "Component")
                || self.react.is_named_expression(super_class, "PureComponent"))
        {
            let span = super_class.span();
            self.diagnostic = Some(
                Diagnostic::new(
                    DiagnosticCode::UnsupportedSyntax,
                    "React class components are unsupported; use a function component and Vidact errorBoundary",
                )
                .with_span(SourceSpan::new(span.start, span.end)),
            );
            return;
        }
        walk_class(self, class);
    }

    fn visit_jsx_element(&mut self, element: &JSXElement<'a>) {
        if self.diagnostic.is_some() {
            return;
        }
        if self
            .react
            .is_named_jsx_element(&element.opening_element.name, "Suspense")
        {
            self.suspense_spans.insert(element.span.start);
        }
        if self
            .react
            .is_named_jsx_element(&element.opening_element.name, "Activity")
        {
            self.activity_spans.insert(element.span.start);
        }
        if self
            .react
            .is_named_jsx_element(&element.opening_element.name, "Profiler")
        {
            self.profiler_spans.insert(element.span.start);
        }
        if let JSXElementName::Identifier(tag) = &element.opening_element.name {
            for item in &element.opening_element.attributes {
                let JSXAttributeItem::Attribute(attribute) = item else {
                    continue;
                };
                let JSXAttributeName::Identifier(name) = &attribute.name else {
                    continue;
                };
                let prop = name.name.as_str();
                if !matches!(prop, "action" | "formAction") {
                    continue;
                }
                let Some(value) = &attribute.value else {
                    self.diagnostic = Some(
                        Diagnostic::new(
                            DiagnosticCode::UnsupportedSyntax,
                            format!("{prop} must have a value"),
                        )
                        .with_span(SourceSpan::new(attribute.span.start, attribute.span.end)),
                    );
                    return;
                };
                if matches!(value, JSXAttributeValue::StringLiteral(_)) {
                    continue;
                }
                if matches!(
                    value,
                    JSXAttributeValue::ExpressionContainer(container)
                        if container.expression.as_expression().is_none()
                ) {
                    self.diagnostic = Some(
                        Diagnostic::new(
                            DiagnosticCode::UnsupportedSyntax,
                            format!("function {prop} must have a value"),
                        )
                        .with_span(SourceSpan::new(attribute.span.start, attribute.span.end)),
                    );
                    return;
                }
                let valid_host = (prop == "action" && tag.name == "form")
                    || (prop == "formAction" && matches!(tag.name.as_str(), "button" | "input"));
                let message = if !valid_host {
                    format!(
                        "function {prop} is only supported on {}",
                        if prop == "action" {
                            "<form>"
                        } else {
                            "<button> and <input>"
                        }
                    )
                } else if !self.actions_enabled {
                    format!("function {prop} requires the `actions` compiler feature")
                } else {
                    continue;
                };
                self.diagnostic = Some(
                    Diagnostic::new(DiagnosticCode::UnsupportedSyntax, message)
                        .with_span(SourceSpan::new(attribute.span.start, attribute.span.end)),
                );
                return;
            }
        }
        if !self.unsafe_html
            && let Some(attribute) = element.opening_element.attributes.iter().find_map(|item| {
                let JSXAttributeItem::Attribute(attribute) = item else {
                    return None;
                };
                matches!(
                    &attribute.name,
                    JSXAttributeName::Identifier(name)
                        if name.name == "dangerouslySetInnerHTML"
                )
                .then_some(attribute)
            })
        {
            self.diagnostic = Some(
                Diagnostic::new(
                    DiagnosticCode::UnsupportedSyntax,
                    "dangerouslySetInnerHTML requires the unsafe-html compiler feature",
                )
                .with_span(SourceSpan::new(attribute.span.start, attribute.span.end)),
            );
            return;
        }
        walk_jsx_element(self, element);
    }
}
