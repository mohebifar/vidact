use std::{env, io::Read, process::ExitCode, str::FromStr};

use serde_json::{Value, json};
use vidact_compiler::{
    CompilationOptions, CompilerFeature, CompilerTarget, ComponentIr, Diagnostic,
    OxcReactAnalysisAdapter,
    analysis::{ModuleInput, ReactAnalysisAdapter, SourceKind, UpdaterKind},
    compile_server_module_with_options, compile_surgical_module_with_ir_and_options,
    lower_component,
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
    let mut target = "client".to_string();
    let mut features = Vec::new();
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--target" => {
                target = arguments
                    .next()
                    .ok_or_else(|| "missing value for --target".to_string())?;
                CompilerTarget::from_str(&target)?;
            }
            "--feature" => {
                let feature = arguments
                    .next()
                    .ok_or_else(|| "missing value for --feature".to_string())?;
                CompilerFeature::from_str(&feature)?;
                if !features.contains(&feature) {
                    features.push(feature);
                }
            }
            _ => return Err(format!("unexpected argument {argument}")),
        }
    }
    features.sort();

    let mut source = String::new();
    std::io::stdin()
        .read_to_string(&mut source)
        .map_err(|error| format!("could not read source from stdin: {error}"))?;
    let input = ModuleInput {
        filename: &filename,
        source: &source,
    };
    let options = features.iter().try_fold(
        CompilationOptions::new(CompilerTarget::from_str(&target)?),
        |options, feature| {
            Ok::<_, String>(options.with_feature(CompilerFeature::from_str(feature)?))
        },
    )?;
    if command.as_deref() == Some("compile") {
        if options.target() == CompilerTarget::Server {
            let compilation = compile_server_module_with_options(input, &options)
                .map_err(|diagnostics| format_diagnostics(&filename, &source, &diagnostics))?;
            return compilation_json(
                target,
                features,
                compilation.code,
                compilation.source_map,
                compilation.components,
            );
        }
        let compilation = compile_surgical_module_with_ir_and_options(input, &options)
            .map_err(|diagnostics| format_diagnostics(&filename, &source, &diagnostics))?;
        return compilation_json(
            target,
            features,
            compilation.code,
            compilation.source_map,
            compilation.components,
        );
    }

    analyze(input)
}

fn compilation_json(
    target: String,
    features: Vec<String>,
    code: String,
    source_map: String,
    components: Vec<ComponentIr>,
) -> Result<Value, String> {
    Ok(json!({
        "protocol": "vidact-compile-v2",
        "runtimeProtocol": "vidact-runtime-v1",
        "configuration": {
            "target": target,
            "features": features,
        },
        "code": code,
        "sourceMap": serde_json::from_str::<Value>(&source_map)
            .map_err(|error| format!("could not serialize compiler source map: {error}"))?,
        "analysis": analysis_json(components),
    }))
}

fn analyze(input: ModuleInput<'_>) -> Result<Value, String> {
    let facts = OxcReactAnalysisAdapter
        .analyze(input)
        .map_err(|diagnostics| format_diagnostics(input.filename, input.source, &diagnostics))?;
    let components = facts
        .into_iter()
        .map(lower_component)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|diagnostic| format_diagnostics(input.filename, input.source, &[diagnostic]))?;

    Ok(analysis_json(components))
}

fn analysis_json(components: impl IntoIterator<Item = ComponentIr>) -> Value {
    json!({
        "protocol": "vidact-analysis-v1",
        "components": components.into_iter().map(|component| json!({
            "name": component.name,
            "span": component.span.map(|span| json!({
                "start": span.start,
                "end": span.end,
            })),
            "reactiveFlow": component.reactive_flow.blocks.iter().map(|block| json!({
                "id": block.id.get(),
                "predecessors": block.predecessors.iter().map(|id| id.get()).collect::<Vec<_>>(),
                "phis": block.phis.iter().map(|phi| json!({
                    "target": reactive_value_json(&phi.target),
                    "operands": phi.operands.iter().map(|operand| json!({
                        "predecessor": operand.predecessor.get(),
                        "value": reactive_value_json(&operand.value),
                    })).collect::<Vec<_>>(),
                })).collect::<Vec<_>>(),
            })).collect::<Vec<_>>(),
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

fn reactive_value_json(value: &vidact_compiler::reactive_flow::ReactiveFlowValue) -> Value {
    json!({
        "id": value.id.get(),
        "declarationId": value.declaration_id.get(),
        "source": value.source.map(|source| source.get()),
        "name": value.name,
        "span": value.span.map(|span| json!({
            "start": span.start,
            "end": span.end,
        })),
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
        UpdaterKind::IndexedList => "indexed-list",
        UpdaterKind::Effect => "effect",
    }
}

fn format_diagnostics(filename: &str, source: &str, diagnostics: &[Diagnostic]) -> String {
    diagnostics
        .iter()
        .map(|diagnostic| {
            let location = diagnostic.span.map_or_else(
                || filename.to_string(),
                |span| {
                    let (line, column) = line_column(source, span.start);
                    format!("{filename}:{line}:{column}")
                },
            );
            format!("{location}: {:?}: {}", diagnostic.code, diagnostic.message)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn line_column(source: &str, offset: u32) -> (usize, usize) {
    let prefix = &source[..usize::try_from(offset)
        .unwrap_or(usize::MAX)
        .min(source.len())];
    let line = prefix.bytes().filter(|byte| *byte == b'\n').count() + 1;
    let column = prefix
        .rsplit_once('\n')
        .map_or(prefix, |(_, tail)| tail)
        .chars()
        .count()
        + 1;
    (line, column)
}
