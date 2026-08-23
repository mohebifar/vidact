use std::{collections::BTreeSet, path::Path};

use oxc_allocator::Allocator;
use oxc_ast::{
    ast::{CallExpression, Class, JSXAttributeItem, JSXAttributeName, JSXElement, Program},
    builder::AstBuilder,
};
use oxc_ast_visit::{
    Visit, VisitMut,
    walk::{walk_call_expression, walk_class, walk_jsx_element},
    walk_mut::walk_jsx_element as walk_jsx_element_mut,
};
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_react_compiler::{CompileResult, CompilerOutputMode, PluginOptions, compile};
use oxc_semantic::SemanticBuilder;
use oxc_span::{GetSpan, SourceType};

use crate::{
    ComponentIr, Diagnostic, DiagnosticCode, SourceSpan,
    analysis::ModuleInput,
    ast_utils::{
        normalize_expression_bodied_component_arrows, restore_anonymous_default_component_names,
    },
    custom_hooks::plan_local_custom_hooks,
    lower_component,
    options::{CompilationOptions, CompilerFeature, CompilerTarget},
    oxc_react::{analyze_program, lower_react_diagnostics},
    react_bindings::ReactBindings,
};

#[derive(Debug)]
pub struct ServerCompilation {
    pub code: String,
    pub source_map: String,
    pub components: Vec<ComponentIr>,
}

pub fn compile_server_module(input: ModuleInput<'_>) -> Result<ServerCompilation, Vec<Diagnostic>> {
    compile_server_module_with_options(input, &CompilationOptions::new(CompilerTarget::Server))
}

pub fn compile_server_module_with_options(
    input: ModuleInput<'_>,
    options: &CompilationOptions,
) -> Result<ServerCompilation, Vec<Diagnostic>> {
    let allocator = Allocator::default();
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
    let custom_hooks =
        plan_local_custom_hooks(&allocator, &parsed.program, semantic.semantic.scoping())
            .map_err(|diagnostic| vec![diagnostic])?;
    drop(semantic);
    if let Some(custom_hooks) = custom_hooks {
        custom_hooks
            .apply(&mut parsed.program)
            .map_err(|diagnostic| vec![diagnostic])?;
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
    let react = ReactBindings::new(&parsed.program, semantic.semantic.scoping());
    let mut validator = ServerSourceValidator {
        react: &react,
        unsafe_html: options.feature_enabled(CompilerFeature::UnsafeHtml),
        async_enabled: options.feature_enabled(CompilerFeature::Async),
        concurrent_enabled: options.feature_enabled(CompilerFeature::Concurrent),
        suspense_spans: BTreeSet::new(),
        diagnostic: None,
    };
    validator.visit_program(&parsed.program);
    if let Some(diagnostic) = validator.diagnostic {
        return Err(vec![diagnostic]);
    }
    let components = analyze_program(input, &parsed.program, &semantic.semantic, &allocator)?
        .into_iter()
        .map(lower_component)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|diagnostic| vec![diagnostic])?;
    let suspense_spans = std::mem::take(&mut validator.suspense_spans);
    drop(validator);
    drop(react);
    drop(semantic);
    let mut async_transformer = ServerAsyncTransformer {
        ast: AstBuilder::new(&allocator),
        options,
        suspense_spans,
        diagnostic: None,
    };
    async_transformer.visit_program(&mut parsed.program);
    if let Some(diagnostic) = async_transformer.diagnostic {
        return Err(vec![diagnostic]);
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

    let options = PluginOptions {
        output_mode: Some(CompilerOutputMode::Ssr),
        ..PluginOptions::default()
    };
    let result = compile(&parsed.program, &semantic.semantic, &allocator, options);
    drop(semantic);
    match result {
        CompileResult::Success {
            output: Some(output),
            diagnostics,
        } if diagnostics.is_empty() => output.transform(&mut parsed.program),
        CompileResult::Success { diagnostics, .. } | CompileResult::Fatal { diagnostics } => {
            return Err(lower_react_diagnostics(
                &diagnostics,
                format!(
                    "React Compiler rejected {} for server codegen",
                    input.filename
                ),
            ));
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
        .to_json_string();
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
        walk_jsx_element_mut(self, element);
    }
}

struct ServerSourceValidator<'r, 's> {
    react: &'r ReactBindings<'s>,
    unsafe_html: bool,
    async_enabled: bool,
    concurrent_enabled: bool,
    suspense_spans: BTreeSet<u32>,
    diagnostic: Option<Diagnostic>,
}

impl<'a> Visit<'a> for ServerSourceValidator<'_, '_> {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if self.diagnostic.is_some() {
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
