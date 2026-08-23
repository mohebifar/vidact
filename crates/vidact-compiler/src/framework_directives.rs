use oxc_ast::ast::{Directive, FunctionBody, Program};
use oxc_ast_visit::{
    Visit,
    walk::{walk_function_body, walk_program},
};

use crate::{
    Diagnostic, DiagnosticCode, SourceSpan,
    options::{CompilationOptions, CompilerFeature, CompilerTarget},
};

pub(crate) fn validate_framework_directives(
    program: &Program<'_>,
    options: &CompilationOptions,
) -> Result<(), Diagnostic> {
    let mut validator = FrameworkDirectiveValidator {
        options,
        in_function: false,
        module_boundary: None,
        diagnostic: None,
    };
    validator.visit_program(program);
    validator.diagnostic.map_or(Ok(()), Err)
}

struct FrameworkDirectiveValidator<'o> {
    options: &'o CompilationOptions,
    in_function: bool,
    module_boundary: Option<(&'static str, SourceSpan)>,
    diagnostic: Option<Diagnostic>,
}

impl FrameworkDirectiveValidator<'_> {
    fn validate(&mut self, directive: &Directive<'_>) {
        if self.diagnostic.is_some() {
            return;
        }
        let name = directive.directive.as_str();
        if !matches!(name, "use client" | "use server") {
            return;
        }
        let span = SourceSpan::new(directive.span.start, directive.span.end);
        if !self.options.feature_enabled(CompilerFeature::Framework) {
            self.diagnostic = Some(
                Diagnostic::new(
                    DiagnosticCode::UnsupportedSyntax,
                    format!("\"{name}\" requires the `framework` compiler feature"),
                )
                .with_span(span),
            );
            return;
        }
        if name == "use client" && self.in_function {
            self.diagnostic = Some(
                Diagnostic::new(
                    DiagnosticCode::UnsupportedSyntax,
                    "\"use client\" is only valid as a module directive",
                )
                .with_span(span),
            );
            return;
        }
        if name == "use server" && self.options.target() != CompilerTarget::Server {
            self.diagnostic = Some(
                Diagnostic::new(
                    DiagnosticCode::UnsupportedSyntax,
                    "\"use server\" requires the server compiler target",
                )
                .with_span(span),
            );
            return;
        }
        if !self.in_function {
            if let Some((previous, _)) = self.module_boundary
                && previous != name
            {
                self.diagnostic = Some(
                    Diagnostic::new(
                        DiagnosticCode::UnsupportedSyntax,
                        "a framework module cannot declare both \"use client\" and \"use server\"",
                    )
                    .with_span(span),
                );
                return;
            }
            self.module_boundary = Some((
                if name == "use client" {
                    "use client"
                } else {
                    "use server"
                },
                span,
            ));
        }
    }
}

impl<'a> Visit<'a> for FrameworkDirectiveValidator<'_> {
    fn visit_program(&mut self, program: &Program<'a>) {
        for directive in &program.directives {
            self.validate(directive);
        }
        if self.diagnostic.is_none() {
            walk_program(self, program);
        }
    }

    fn visit_function_body(&mut self, body: &FunctionBody<'a>) {
        let previous = self.in_function;
        self.in_function = true;
        for directive in &body.directives {
            self.validate(directive);
        }
        if self.diagnostic.is_none() {
            walk_function_body(self, body);
        }
        self.in_function = previous;
    }
}
