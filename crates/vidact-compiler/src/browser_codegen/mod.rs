mod emitter;
mod rewrite;
mod syntax;

use std::path::Path;

use oxc_allocator::Allocator;
use oxc_codegen::Codegen;
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType;

use crate::{
    Diagnostic, DiagnosticCode, analysis::ModuleInput, ir::lower_component,
    oxc_react::analyze_program,
};

/// Compiles the deliberately narrow executable module used by the browser spike.
///
/// React Compiler supplies dependency facts and updater order. OXC owns parsing,
/// semantic binding identity, AST construction, and final JavaScript printing.
/// Syntax outside the executable spike subset fails closed.
pub fn compile_spike_browser_module(input: ModuleInput<'_>) -> Result<String, Vec<Diagnostic>> {
    let allocator = Allocator::default();
    let source_type =
        SourceType::from_path(Path::new(input.filename)).unwrap_or_else(|_| SourceType::tsx());
    let parsed = Parser::new(&allocator, input.source, source_type).parse();
    if !parsed.diagnostics.is_empty() {
        return Err(vec![analysis_error(format!(
            "OXC could not parse {} for browser codegen: {:?}",
            input.filename, parsed.diagnostics
        ))]);
    }
    let semantic = SemanticBuilder::new()
        .with_build_nodes(true)
        .with_check_syntax_error(true)
        .build(&parsed.program);
    if !semantic.diagnostics.is_empty() {
        return Err(vec![analysis_error(format!(
            "OXC semantic analysis failed for {} during browser codegen: {:?}",
            input.filename, semantic.diagnostics
        ))]);
    }

    let components = analyze_program(input, &parsed.program, &semantic.semantic, &allocator)?;
    let [facts] = components.as_slice() else {
        return Err(vec![unsupported(format!(
            "the legacy browser spike requires exactly one component; found {}",
            components.len()
        ))]);
    };
    let ir = lower_component(facts.clone()).map_err(|diagnostic| vec![diagnostic])?;
    let syntax = syntax::extract(
        &parsed.program,
        semantic.semantic.scoping(),
        &ir.name,
        ir.span,
    )
    .map_err(|error| vec![error])?;
    let output = emitter::emit_program(&allocator, semantic.semantic.scoping(), &ir, &syntax)
        .map_err(|error| vec![error])?;
    Ok(Codegen::new().build(&output).code)
}

fn unsupported(message: impl Into<String>) -> Diagnostic {
    Diagnostic::new(DiagnosticCode::UnsupportedSyntax, message)
}

fn analysis_error(message: impl Into<String>) -> Diagnostic {
    Diagnostic::new(DiagnosticCode::AnalysisFailed, message)
}
