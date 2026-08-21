use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

use oxc_allocator::Allocator;
use oxc_ast::ast::Program;
use oxc_parser::Parser;
use oxc_react_compiler::{CompileResult, FunctionAnalysis, PluginOptions, compile};
use oxc_semantic::{Semantic, SemanticBuilder};
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

        analyze_program(input, &parsed.program, &semantic.semantic, &allocator)
    }
}

pub(crate) fn analyze_program(
    input: ModuleInput<'_>,
    program: &Program<'_>,
    semantic: &Semantic<'_>,
    allocator: &Allocator,
) -> Result<Vec<ComponentFacts>, Vec<Diagnostic>> {
    let analyses = run_react_analysis(input, program, semantic, allocator)?;
    let [analysis] = analyses.as_slice() else {
        return Err(vec![analysis_error(format!(
            "the analysis spike supports exactly one component per module; React Compiler found {} in {}",
            analyses.len(),
            input.filename
        ))]);
    };

    Ok(vec![lower_snapshot(input.source, analysis)])
}

fn run_react_analysis(
    input: ModuleInput<'_>,
    program: &Program<'_>,
    semantic: &Semantic<'_>,
    allocator: &Allocator,
) -> Result<Vec<FunctionAnalysis>, Vec<Diagnostic>> {
    match compile(program, semantic, allocator, PluginOptions::default()) {
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
    let def_use = CompilerDefUse::new(source, analysis);
    let mut sources = BTreeMap::<String, SourceKind>::new();

    for prop in destructured_props(source) {
        sources.insert(prop, SourceKind::Prop);
    }
    for state in state_bindings(source) {
        sources.insert(state, SourceKind::State);
    }

    let candidates = simple_const_bindings(source);
    let mut provisional_names = sources.keys().map(String::as_str).collect::<BTreeSet<_>>();
    provisional_names.extend(candidates.iter().map(|(name, _)| name.as_str()));
    let provisional_ids = provisional_names
        .into_iter()
        .enumerate()
        .map(|(index, name)| (name, SourceId::new(index as u32)))
        .collect::<BTreeMap<_, _>>();
    let candidate_reads = candidates
        .iter()
        .map(|(name, _)| (name.as_str(), def_use.reads_for(name, &provisional_ids)))
        .collect::<Vec<_>>();
    let mut reachable = sources
        .keys()
        .filter_map(|name| provisional_ids.get(name.as_str()).copied())
        .collect::<BTreeSet<_>>();
    let mut derived_names = BTreeSet::new();
    loop {
        let mut changed = false;
        for (name, reads) in &candidate_reads {
            if !derived_names.contains(*name) && reads.iter().any(|read| reachable.contains(read)) {
                derived_names.insert(*name);
                reachable.insert(provisional_ids[name]);
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    let derived = candidates
        .iter()
        .filter_map(|(name, _)| {
            derived_names
                .contains(name.as_str())
                .then_some(name.clone())
        })
        .collect::<Vec<_>>();
    for name in &derived {
        sources.insert(name.clone(), SourceKind::Derived);
    }

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
        let reads = def_use.reads_for(&name, &source_ids);
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
        let reads: Vec<SourceId> = jsx_child_expressions(jsx)
            .into_iter()
            .flat_map(|expression| names_read_by(expression, &source_ids))
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
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

pub(crate) fn simple_const_bindings(source: &str) -> Vec<(String, &str)> {
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
            Some((name, expression.trim()))
        })
        .collect()
}

struct CompilerDefUse<'a> {
    source: &'a str,
    analysis: &'a FunctionAnalysis,
    producers: BTreeMap<usize, &'a oxc_react_compiler::InstructionAnalysis>,
}

impl<'a> CompilerDefUse<'a> {
    fn new(source: &'a str, analysis: &'a FunctionAnalysis) -> Self {
        let producers = analysis
            .instructions
            .iter()
            .flat_map(|instruction| {
                instruction
                    .lvalues
                    .iter()
                    .map(move |lvalue| (lvalue.id, instruction))
            })
            .collect();
        Self {
            source,
            analysis,
            producers,
        }
    }

    fn reads_for(&self, declaration: &str, source_ids: &BTreeMap<&str, SourceId>) -> Vec<SourceId> {
        let source_declarations = source_ids
            .iter()
            .filter_map(|(name, source)| {
                self.declaration_id(name)
                    .map(|declaration| (declaration, *source))
            })
            .collect::<BTreeMap<_, _>>();
        let Some(root_declaration) = self.declaration_id(declaration) else {
            return Vec::new();
        };
        let roots = self
            .analysis
            .instructions
            .iter()
            .flat_map(|instruction| &instruction.lvalues)
            .filter(|lvalue| lvalue.declaration_id == root_declaration);
        let mut reads = BTreeSet::new();
        let mut visited = BTreeSet::new();

        for root in roots {
            self.collect_reads(root.id, &source_declarations, &mut visited, &mut reads);
        }
        reads.into_iter().collect()
    }

    fn declaration_id(&self, name: &str) -> Option<usize> {
        let offset = declaration_offset(self.source, name)?;
        self.analysis
            .instructions
            .iter()
            .flat_map(|instruction| &instruction.lvalues)
            .find(|value| value.span.is_some_and(|span| span.0 == offset))
            .map(|value| value.declaration_id)
    }

    fn collect_reads(
        &self,
        value: usize,
        source_declarations: &BTreeMap<usize, SourceId>,
        visited: &mut BTreeSet<usize>,
        reads: &mut BTreeSet<SourceId>,
    ) {
        if !visited.insert(value) {
            return;
        }
        let Some(instruction) = self.producers.get(&value) else {
            return;
        };
        for dependency in &instruction.dependencies {
            if let Some(source) = source_declarations.get(&dependency.declaration_id) {
                reads.insert(*source);
            } else {
                self.collect_reads(dependency.id, source_declarations, visited, reads);
            }
        }
    }
}

fn declaration_offset(source: &str, name: &str) -> Option<u32> {
    for (start, _) in source.match_indices("const ") {
        let binding_start = start + "const ".len();
        let tail = &source[binding_start..];
        if let Some(bindings) = tail.strip_prefix('[') {
            let (bindings, remainder) = bindings.split_once(']')?;
            let initializer = remainder.split(';').next().unwrap_or(remainder);
            if initializer.contains("useState")
                && let Some(relative) = identifier_offset(bindings, name)
            {
                return u32::try_from(binding_start + 1 + relative).ok();
            }
        } else if identifier(tail) == Some(name) {
            let whitespace = tail.len() - tail.trim_start().len();
            return u32::try_from(binding_start + whitespace).ok();
        }
    }

    let function = source.find("function ")?;
    let signature_end = function + source[function..].find(')')?;
    let signature = &source[function..signature_end];
    let destructuring = signature.find('{')?;
    let props = &signature[destructuring + 1..signature.find('}')?];
    identifier_offset(props, name)
        .and_then(|relative| u32::try_from(function + destructuring + 1 + relative).ok())
}

fn identifier_offset(source: &str, name: &str) -> Option<usize> {
    source.match_indices(name).find_map(|(start, _)| {
        let before = source[..start].chars().next_back();
        let after = source[start + name.len()..].chars().next();
        (!before.is_some_and(is_identifier_continue) && !after.is_some_and(is_identifier_continue))
            .then_some(start)
    })
}

fn jsx_attributes(jsx: &str) -> Vec<(String, &str)> {
    let mut attributes = Vec::new();
    let mut remainder = jsx;
    while let Some(open) = remainder.find("={") {
        let before = &remainder[..open];
        let name = before
            .rsplit(|character: char| character.is_whitespace() || character == '<')
            .next()
            .and_then(jsx_attribute_name);
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

pub(crate) fn jsx_attribute_name(value: &str) -> Option<&str> {
    let value = value.trim();
    (!value.is_empty()
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '_' | '$' | '-' | ':')
        }))
    .then_some(value)
}

fn jsx_child_expressions(jsx: &str) -> Vec<&str> {
    let Some(opening_tag_end) = jsx_opening_tag_end(jsx) else {
        return Vec::new();
    };
    let children = &jsx[opening_tag_end + 1..];
    let children = children
        .find("</")
        .map_or(children, |closing_tag| &children[..closing_tag]);
    let mut expressions = Vec::new();
    let mut remainder = children;
    while let Some(open) = remainder.find('{') {
        let expression = &remainder[open + 1..];
        let Some(close) = expression.find('}') else {
            break;
        };
        expressions.push(&expression[..close]);
        remainder = &expression[close + 1..];
    }
    expressions
}

pub(crate) fn jsx_opening_tag_end(source: &str) -> Option<usize> {
    let mut depth = 0_u32;
    for (index, character) in source.char_indices() {
        match character {
            '{' => depth += 1,
            '}' => depth = depth.checked_sub(1)?,
            '>' if depth == 0 => return Some(index),
            _ => {}
        }
    }
    None
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

pub(crate) fn identifier(value: &str) -> Option<&str> {
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

pub(crate) fn is_identifier_continue(character: char) -> bool {
    character.is_ascii_alphanumeric() || character == '_' || character == '$'
}
