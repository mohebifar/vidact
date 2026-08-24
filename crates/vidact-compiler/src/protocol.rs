use std::str::FromStr;

use serde_json::{Value, json};

use crate::{
    CompilationOptions, CompilerFeature, CompilerTarget, ComponentIr, Diagnostic,
    OxcReactAnalysisAdapter,
    analysis::{ModuleInput, ReactAnalysisAdapter, SourceKind, UpdaterKind},
    compile_server_module_with_options, compile_surgical_module_with_ir_and_options,
    lower_component,
};

pub const ANALYSIS_PROTOCOL: &str = "vidact-analysis-v1";
pub const COMPILE_PROTOCOL: &str = "vidact-compile-v2";
pub const RUNTIME_PROTOCOL: &str = "vidact-runtime-v1";

pub fn compile_module_json(
    input: ModuleInput<'_>,
    target: &str,
    features: &[String],
) -> Result<Value, String> {
    let (target, features, options) = normalize_configuration(target, features)?;
    let compilation = if options.target() == CompilerTarget::Server {
        let compilation =
            compile_server_module_with_options(input, &options).map_err(|diagnostics| {
                format_diagnostics(input.filename, input.source, &diagnostics)
            })?;
        (
            compilation.code,
            compilation.source_map,
            compilation.components,
        )
    } else {
        let compilation = compile_surgical_module_with_ir_and_options(input, &options).map_err(
            |diagnostics| format_diagnostics(input.filename, input.source, &diagnostics),
        )?;
        (
            compilation.code,
            compilation.source_map,
            compilation.components,
        )
    };

    compilation_json(
        target,
        features,
        compilation.0,
        compilation.1,
        compilation.2,
    )
}

pub fn analyze_module_json(input: ModuleInput<'_>) -> Result<Value, String> {
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

fn normalize_configuration(
    target: &str,
    features: &[String],
) -> Result<(String, Vec<String>, CompilationOptions), String> {
    let parsed_target = CompilerTarget::from_str(target)?;
    let mut normalized_features = features.to_vec();
    normalized_features.sort();
    normalized_features.dedup();
    let options = normalized_features.iter().try_fold(
        CompilationOptions::new(parsed_target),
        |options, feature| {
            Ok::<_, String>(options.with_feature(CompilerFeature::from_str(feature)?))
        },
    )?;
    Ok((target.to_string(), normalized_features, options))
}

fn compilation_json(
    target: String,
    features: Vec<String>,
    code: String,
    source_map: String,
    components: Vec<ComponentIr>,
) -> Result<Value, String> {
    Ok(json!({
        "protocol": COMPILE_PROTOCOL,
        "runtimeProtocol": RUNTIME_PROTOCOL,
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

fn analysis_json(components: impl IntoIterator<Item = ComponentIr>) -> Value {
    json!({
        "protocol": ANALYSIS_PROTOCOL,
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

fn reactive_value_json(value: &crate::reactive_flow::ReactiveFlowValue) -> Value {
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
