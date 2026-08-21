use std::{env, io::Read, process::ExitCode};

use serde_json::{Value, json};
use vidact_compiler::{
    ComponentIr, Diagnostic, OxcReactAnalysisAdapter,
    analysis::{ModuleInput, ReactAnalysisAdapter, SourceKind, UpdaterKind},
    compile_surgical_module_with_ir, lower_component,
};

fn main() -> ExitCode {
    match run() {
        Ok(output) => {
            println!("{output}");
            ExitCode::SUCCESS
        }
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<Value, String> {
    let mut arguments = env::args().skip(1);
    let command = arguments.next();
    if !matches!(command.as_deref(), Some("analyze" | "compile"))
        || arguments.next().as_deref() != Some("--filename")
    {
        return Err("usage: vidactc <analyze|compile> --filename <path>".to_string());
    }
    let filename = arguments
        .next()
        .ok_or_else(|| "missing value for --filename".to_string())?;
    if arguments.next().is_some() {
        return Err("unexpected arguments after --filename <path>".to_string());
    }

    let mut source = String::new();
    std::io::stdin()
        .read_to_string(&mut source)
        .map_err(|error| format!("could not read source from stdin: {error}"))?;
    let input = ModuleInput {
        filename: &filename,
        source: &source,
    };
    if command.as_deref() == Some("compile") {
        let compilation = compile_surgical_module_with_ir(input)
            .map_err(|diagnostics| format_diagnostics(&filename, &diagnostics))?;
        return Ok(json!({
            "protocol": "vidact-compile-v1",
            "code": compilation.code,
            "analysis": analysis_json([compilation.component]),
        }));
    }

    analyze(input)
}

fn analyze(input: ModuleInput<'_>) -> Result<Value, String> {
    let facts = OxcReactAnalysisAdapter
        .analyze(input)
        .map_err(|diagnostics| format_diagnostics(input.filename, &diagnostics))?;
    let components = facts
        .into_iter()
        .map(lower_component)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|diagnostic| format_diagnostics(input.filename, &[diagnostic]))?;

    Ok(analysis_json(components))
}

fn analysis_json(components: impl IntoIterator<Item = ComponentIr>) -> Value {
    json!({
        "protocol": "vidact-analysis-v1",
        "components": components.into_iter().map(|component| json!({
            "name": component.name,
            "sources": component.sources.into_iter().map(|source| json!({
                "id": source.id.get(),
                "name": source.name,
                "kind": source_kind(source.kind),
            })).collect::<Vec<_>>(),
            "updaters": component.updaters.into_iter().map(|updater| json!({
                "id": updater.id.get(),
                "kind": updater_kind(&updater.kind),
                "reads": updater.reads.into_iter().map(|source| source.get()).collect::<Vec<_>>(),
                "writes": updater.writes.into_iter().map(|source| source.get()).collect::<Vec<_>>(),
            })).collect::<Vec<_>>(),
        })).collect::<Vec<_>>(),
    })
}

fn source_kind(kind: SourceKind) -> &'static str {
    match kind {
        SourceKind::Prop => "prop",
        SourceKind::State => "state",
        SourceKind::Derived => "derived",
        SourceKind::Context => "context",
        SourceKind::External => "external",
    }
}

fn updater_kind(kind: &UpdaterKind) -> &'static str {
    match kind {
        UpdaterKind::Derived => "derived",
        UpdaterKind::Text => "text",
        UpdaterKind::Attribute { .. } => "attribute",
        UpdaterKind::Property { .. } => "property",
        UpdaterKind::Branch => "branch",
        UpdaterKind::KeyedList { .. } => "keyed-list",
        UpdaterKind::Effect => "effect",
    }
}

fn format_diagnostics(filename: &str, diagnostics: &[Diagnostic]) -> String {
    diagnostics
        .iter()
        .map(|diagnostic| format!("{filename}: {:?}: {}", diagnostic.code, diagnostic.message))
        .collect::<Vec<_>>()
        .join("\n")
}
