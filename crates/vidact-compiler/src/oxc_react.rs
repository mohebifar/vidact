use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_react_compiler::{CompileResult, FunctionAnalysis, PluginOptions, compile};
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType;

use crate::{
    Diagnostic, DiagnosticCode,
    analysis::{
        ComponentFacts, KeyPath, ModuleInput, ReactAnalysisAdapter, SourceFact, SourceId,
        SourceKind, UpdaterFact, UpdaterId, UpdaterKind,
    },
};

/// Spike adapter backed by OXC's Rust port of React Compiler.
///
/// React Compiler owns parsing semantics, SSA, and reactive-scope dependency
/// inference. This adapter adds Vidact-specific source and DOM classifications
/// while lowering the compiler's owned pre-codegen snapshots into `ComponentFacts`.
#[derive(Clone, Copy, Debug, Default)]
pub struct OxcReactAnalysisAdapter;

impl ReactAnalysisAdapter for OxcReactAnalysisAdapter {
    fn analyze(&self, input: ModuleInput<'_>) -> Result<Vec<ComponentFacts>, Vec<Diagnostic>> {
        let analyses = run_react_analysis(input)?;
        let [analysis] = analyses.as_slice() else {
            return Err(vec![analysis_error(format!(
                "the analysis spike supports exactly one component per module; React Compiler found {} in {}",
                analyses.len(),
                input.filename
            ))]);
        };

        Ok(vec![lower_snapshot(input.source, analysis)])
    }
}

fn run_react_analysis(input: ModuleInput<'_>) -> Result<Vec<FunctionAnalysis>, Vec<Diagnostic>> {
    let allocator = Allocator::default();
    let source_type =
        SourceType::from_path(Path::new(input.filename)).unwrap_or_else(|_| SourceType::tsx());
    let parsed = Parser::new(&allocator, input.source, source_type).parse();
    if !parsed.diagnostics.is_empty() {
        return Err(vec![analysis_error(format!(
            "OXC could not parse {}: {:?}",
            input.filename, parsed.diagnostics
        ))]);
    }

    let semantic = SemanticBuilder::new()
        .with_build_nodes(true)
        .with_check_syntax_error(true)
        .build(&parsed.program);
    if !semantic.diagnostics.is_empty() {
        return Err(vec![analysis_error(format!(
            "OXC semantic analysis failed for {}: {:?}",
            input.filename, semantic.diagnostics
        ))]);
    }

    match compile(
        &parsed.program,
        &semantic.semantic,
        &allocator,
        PluginOptions::default(),
    ) {
        CompileResult::Success {
            output: Some(output),
            diagnostics,
        } => {
            if diagnostics.is_empty() {
                Ok(output.analyses().to_vec())
            } else {
                Err(vec![analysis_error(format!(
                    "React Compiler rejected {}: {diagnostics:?}",
                    input.filename
                ))])
            }
        }
        CompileResult::Success {
            output: None,
            diagnostics,
        } => Err(vec![analysis_error(format!(
            "React Compiler produced no component analysis for {}: {diagnostics:?}",
            input.filename
        ))]),
        CompileResult::Fatal { diagnostics } => Err(vec![analysis_error(format!(
            "React Compiler aborted analysis for {}: {diagnostics:?}",
            input.filename
        ))]),
    }
}

fn analysis_error(message: impl Into<String>) -> Diagnostic {
    Diagnostic::new(DiagnosticCode::AnalysisFailed, message)
}

fn lower_snapshot(source: &str, analysis: &FunctionAnalysis) -> ComponentFacts {
    eprintln!("{analysis:#?}");
    let mut sources = BTreeMap::<String, SourceKind>::new();

    for prop in destructured_props(source) {
        sources.insert(prop, SourceKind::Prop);
    }
    for state in state_bindings(source) {
        sources.insert(state, SourceKind::State);
    }

    let derived = derived_bindings(source, sources.keys().map(String::as_str));
    for name in &derived {
        sources.insert(name.clone(), SourceKind::Derived);
    }

    // Keep only named facts which survive React Compiler's optimized reactive
    // scopes, plus explicit props/state roots needed by the Vidact runtime.
    let compiler_names = analysis
        .scopes
        .iter()
        .flat_map(|scope| {
            scope
                .dependencies
                .iter()
                .map(|dependency| dependency.name.as_str())
                .chain(scope.declarations.iter().map(String::as_str))
        })
        .collect::<BTreeSet<_>>();
    sources.retain(|name, kind| {
        matches!(kind, SourceKind::Prop | SourceKind::State)
            || compiler_names.contains(name.as_str())
    });

    let source_facts = sources
        .into_iter()
        .enumerate()
        .map(|(index, (name, kind))| SourceFact::new(SourceId::new(index as u32), name, kind))
        .collect::<Vec<_>>();
    let source_ids = source_facts
        .iter()
        .map(|source| (source.name.as_str(), source.id))
        .collect::<BTreeMap<_, _>>();
    let mut updaters = Vec::new();

    for name in derived {
        let Some(&write) = source_ids.get(name.as_str()) else {
            continue;
        };
        let reads = compiler_reads_for_declaration(analysis, &name, &source_ids);
        push_updater(&mut updaters, UpdaterKind::Derived, reads, vec![write]);
    }

    let jsx = source.split_once("return").map_or("", |(_, jsx)| jsx);
    for (attribute, expression) in jsx_attributes(jsx) {
        let reads = names_read_by(expression, &source_ids);
        if !reads.is_empty() {
            push_updater(
                &mut updaters,
                UpdaterKind::Attribute { name: attribute },
                reads,
                vec![],
            );
        }
    }

    if let Some((collection, key)) = keyed_map(jsx) {
        if let Some(&read) = source_ids.get(collection.as_str()) {
            push_updater(
                &mut updaters,
                UpdaterKind::KeyedList {
                    key: KeyPath::Property(key),
                },
                vec![read],
                vec![],
            );
        }
    } else {
        let reads = names_read_by(jsx, &source_ids);
        if !reads.is_empty() {
            push_updater(&mut updaters, UpdaterKind::Text, reads, vec![]);
        }
    }

    ComponentFacts::new(
        analysis.name.as_deref().unwrap_or("AnonymousComponent"),
        source_facts,
        updaters,
    )
}

fn push_updater(
    updaters: &mut Vec<UpdaterFact>,
    kind: UpdaterKind,
    reads: Vec<SourceId>,
    writes: Vec<SourceId>,
) {
    updaters.push(UpdaterFact::new(
        UpdaterId::new(updaters.len() as u32),
        kind,
        reads,
        writes,
    ));
}

fn destructured_props(source: &str) -> Vec<String> {
    let Some(function) = source.find("function ") else {
        return Vec::new();
    };
    let signature = &source[function
        ..source[function..]
            .find(')')
            .map_or(source.len(), |i| function + i)];
    let Some((_, destructured)) = signature.split_once('{') else {
        return Vec::new();
    };
    let Some((props, _)) = destructured.split_once('}') else {
        return Vec::new();
    };
    props
        .split(',')
        .filter_map(|prop| identifier(prop.split(':').next().unwrap_or(prop)))
        .map(str::to_owned)
        .collect()
}

fn state_bindings(source: &str) -> Vec<String> {
    source
        .split("const [")
        .skip(1)
        .filter_map(|tail| {
            let (bindings, remainder) = tail.split_once(']')?;
            let initializer = remainder.split(';').next().unwrap_or(remainder);
            initializer.contains("useState").then(|| {
                identifier(bindings.split(',').next().unwrap_or(bindings)).map(str::to_owned)
            })?
        })
        .collect()
}

fn derived_bindings<'a>(source: &str, roots: impl Iterator<Item = &'a str>) -> Vec<String> {
    let roots = roots.map(str::to_owned).collect::<Vec<_>>();
    source
        .split("const ")
        .skip(1)
        .filter_map(|tail| {
            if tail.starts_with('[') {
                return None;
            }
            let (name, expression) = tail.split_once('=')?;
            let name = identifier(name)?.to_owned();
            let expression = expression.split(';').next().unwrap_or(expression);
            roots
                .iter()
                .any(|root| contains_identifier(expression, root))
                .then_some(name)
        })
        .collect()
}

fn compiler_reads_for_declaration(
    analysis: &FunctionAnalysis,
    declaration: &str,
    source_ids: &BTreeMap<&str, SourceId>,
) -> Vec<SourceId> {
    let producers = analysis
        .instructions
        .iter()
        .flat_map(|instruction| {
            instruction
                .lvalues
                .iter()
                .map(move |lvalue| (lvalue.id, instruction))
        })
        .collect::<BTreeMap<_, _>>();
    let roots = analysis
        .instructions
        .iter()
        .flat_map(|instruction| &instruction.lvalues)
        .filter(|lvalue| lvalue.name.as_deref() == Some(declaration));
    let mut reads = BTreeSet::new();
    let mut visited = BTreeSet::new();

    for root in roots {
        collect_compiler_reads(root.id, &producers, source_ids, &mut visited, &mut reads);
    }

    reads.into_iter().collect()
}

fn collect_compiler_reads(
    value: usize,
    producers: &BTreeMap<usize, &oxc_react_compiler::InstructionAnalysis>,
    source_ids: &BTreeMap<&str, SourceId>,
    visited: &mut BTreeSet<usize>,
    reads: &mut BTreeSet<SourceId>,
) {
    if !visited.insert(value) {
        return;
    }
    let Some(instruction) = producers.get(&value) else {
        return;
    };
    for dependency in &instruction.dependencies {
        if let Some(name) = dependency.name.as_deref()
            && let Some(source) = source_ids.get(name)
        {
            reads.insert(*source);
        } else {
            collect_compiler_reads(dependency.id, producers, source_ids, visited, reads);
        }
    }
}

fn jsx_attributes(jsx: &str) -> Vec<(String, &str)> {
    let mut attributes = Vec::new();
    let mut remainder = jsx;
    while let Some(open) = remainder.find("={") {
        let before = &remainder[..open];
        let name = before
            .rsplit(|character: char| character.is_whitespace() || character == '<')
            .next()
            .and_then(identifier);
        let expression = &remainder[open + 2..];
        let Some(close) = expression.find('}') else {
            break;
        };
        if let Some(name) = name
            && name != "key"
            && !name.starts_with("on")
        {
            attributes.push((name.to_owned(), &expression[..close]));
        }
        remainder = &expression[close + 1..];
    }
    attributes
}

fn keyed_map(jsx: &str) -> Option<(String, String)> {
    let map = jsx.find(".map(")?;
    let collection = jsx[..map]
        .rsplit(|character: char| !character.is_ascii_alphanumeric() && character != '_')
        .next()
        .and_then(identifier)?
        .to_owned();
    let key = jsx[map..].split("key={").nth(1)?.split('}').next()?;
    let property = key.rsplit_once('.')?.1;
    Some((collection, identifier(property)?.to_owned()))
}

fn names_read_by(expression: &str, source_ids: &BTreeMap<&str, SourceId>) -> Vec<SourceId> {
    source_ids
        .iter()
        .filter_map(|(name, id)| contains_identifier(expression, name).then_some(*id))
        .collect()
}

fn identifier(value: &str) -> Option<&str> {
    let value = value.trim();
    let end = value
        .find(|character: char| {
            !character.is_ascii_alphanumeric() && character != '_' && character != '$'
        })
        .unwrap_or(value.len());
    let value = &value[..end];
    (!value.is_empty()
        && value.chars().next().is_some_and(|character| {
            character.is_ascii_alphabetic() || character == '_' || character == '$'
        }))
    .then_some(value)
}

fn contains_identifier(haystack: &str, needle: &str) -> bool {
    haystack.match_indices(needle).any(|(start, _)| {
        let before = haystack[..start].chars().next_back();
        let after = haystack[start + needle.len()..].chars().next();
        !before.is_some_and(is_identifier_continue) && !after.is_some_and(is_identifier_continue)
    })
}

fn is_identifier_continue(character: char) -> bool {
    character.is_ascii_alphanumeric() || character == '_' || character == '$'
}
