use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    path::Path,
};

use oxc_allocator::Allocator;
use oxc_ast::ast::Program;
use oxc_parser::Parser;
use oxc_react_compiler::{
    BlockKindAnalysis, CompileResult, ControlFlowAnalysis, FunctionAnalysis, GotoVariantAnalysis,
    PluginOptions, ReturnVariantAnalysis, TerminalKindAnalysis, compile,
};
use oxc_semantic::{Semantic, SemanticBuilder};
use oxc_span::SourceType;
use oxc_syntax::symbol::SymbolId;

use crate::{
    Diagnostic, DiagnosticCode, SourceSpan,
    analysis::{
        ComponentFacts, ControlFlowBlockFact, ControlFlowBlockId, ControlFlowBlockKind,
        ControlFlowFacts, ControlFlowGotoVariant, ControlFlowReturnVariant,
        ControlFlowTerminalFact, ControlFlowTerminalKind, ModuleInput, ReactAnalysisAdapter,
        SourceFact, SourceId, UpdaterFact, UpdaterId, UpdaterKind,
    },
};

mod classifier;
mod def_use;

use crate::ast_utils::component_name_for_span;
use classifier::{classify_component, render_updaters};
use def_use::CompilerDefUse;

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
    let mut analyses = run_react_analysis(input, program, semantic, allocator)?;
    if analyses.is_empty() {
        return Err(vec![analysis_error(format!(
            "React Compiler found no components in {}",
            input.filename,
        ))]);
    }
    analyses.sort_by_key(|analysis| analysis.span.map_or(u32::MAX, |span| span.0));

    let mut components = Vec::with_capacity(analyses.len());
    let mut diagnostics = Vec::new();
    for analysis in &analyses {
        match lower_snapshot(program, semantic, analysis) {
            Ok(component) => components.push(component),
            Err(diagnostic) => diagnostics.push(diagnostic),
        }
    }
    if diagnostics.is_empty() {
        Ok(components)
    } else {
        Err(diagnostics)
    }
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

fn lower_snapshot(
    program: &Program<'_>,
    semantic: &Semantic<'_>,
    analysis: &FunctionAnalysis,
) -> Result<ComponentFacts, Diagnostic> {
    let component_span = analysis
        .span
        .map(|(start, end)| SourceSpan::new(start, end))
        .ok_or_else(|| {
            analysis_error("React Compiler did not provide a source span for a component")
        })?;
    let component_name = analysis
        .name
        .as_deref()
        .or_else(|| component_name_for_span(program, component_span))
        .unwrap_or("AnonymousComponent");
    let control_flow = lower_control_flow(&analysis.control_flow);
    validate_supported_control_flow(&control_flow, component_name, component_span)?;
    let mut syntax =
        classify_component(program, semantic.scoping(), component_name, component_span).map_err(
            |message| {
                let code = if message.contains("not a supported named function declaration") {
                    DiagnosticCode::UnsupportedComponentForm
                } else {
                    DiagnosticCode::AnalysisFailed
                };
                Diagnostic::new(code, message).with_span(component_span)
            },
        )?;
    let def_use = CompilerDefUse::new(analysis);

    let provisional = syntax
        .sources
        .iter()
        .chain(syntax.candidates.iter())
        .enumerate()
        .map(|(index, (name, _))| (name.as_str(), SourceId::new(index as u32)))
        .collect::<BTreeMap<_, _>>();
    let source_declarations = syntax
        .sources
        .iter()
        .chain(syntax.candidates.iter())
        .filter_map(|(name, source)| {
            let id = provisional.get(name.as_str()).copied()?;
            def_use
                .declaration_id(source.declaration_start)
                .map(|declaration| (declaration, id))
        })
        .collect::<BTreeMap<_, _>>();
    let candidate_reads = syntax
        .candidates
        .iter()
        .filter_map(|(name, source)| {
            let declaration = def_use.declaration_id(source.declaration_start)?;
            Some((
                name.clone(),
                def_use.reads_for(declaration, &source_declarations),
            ))
        })
        .collect::<Vec<_>>();
    let mut reachable = syntax
        .sources
        .keys()
        .filter_map(|name| provisional.get(name.as_str()).copied())
        .collect::<BTreeSet<_>>();
    let dependents = candidate_reads
        .iter()
        .flat_map(|(name, reads)| reads.iter().map(move |read| (*read, name.clone())))
        .fold(
            BTreeMap::<SourceId, BTreeSet<String>>::new(),
            |mut dependents, (read, name)| {
                dependents.entry(read).or_default().insert(name);
                dependents
            },
        );
    let mut pending = reachable.iter().copied().collect::<VecDeque<_>>();
    let mut derived_names = BTreeSet::new();
    while let Some(read) = pending.pop_front() {
        let Some(names) = dependents.get(&read) else {
            continue;
        };
        for name in names {
            if derived_names.insert(name.clone())
                && let Some(source) = provisional.get(name.as_str())
                && reachable.insert(*source)
            {
                pending.push_back(*source);
            }
        }
    }
    let mut ordered_derived_names = derived_names.into_iter().collect::<Vec<_>>();
    ordered_derived_names.sort_by_key(|name| {
        syntax
            .candidates
            .get(name)
            .map_or(u32::MAX, |source| source.declaration_start)
    });
    for name in &ordered_derived_names {
        if let Some(source) = syntax.candidates.remove(name) {
            syntax.sources.insert(name.clone(), source);
        }
    }

    let source_facts = syntax
        .sources
        .iter()
        .enumerate()
        .map(|(index, (name, source))| {
            SourceFact::new(SourceId::new(index as u32), name, source.kind)
        })
        .collect::<Vec<_>>();
    let source_ids = source_facts
        .iter()
        .map(|source| (source.name.as_str(), source.id))
        .collect::<BTreeMap<_, _>>();
    let source_symbols = syntax
        .sources
        .iter()
        .filter_map(|(name, source)| {
            source_ids
                .get(name.as_str())
                .copied()
                .map(|id| (source.symbol, id))
        })
        .collect::<BTreeMap<SymbolId, SourceId>>();
    let final_declarations = syntax
        .sources
        .iter()
        .filter_map(|(name, source)| {
            let id = source_ids.get(name.as_str()).copied()?;
            def_use
                .declaration_id(source.declaration_start)
                .map(|declaration| (declaration, id))
        })
        .collect::<BTreeMap<_, _>>();
    let mut updaters = Vec::new();

    for name in ordered_derived_names {
        let Some(source) = syntax.sources.get(&name) else {
            continue;
        };
        let Some(&write) = source_ids.get(name.as_str()) else {
            continue;
        };
        let Some(declaration) = def_use.declaration_id(source.declaration_start) else {
            continue;
        };
        let reads = def_use.reads_for(declaration, &final_declarations);
        push_updater(&mut updaters, UpdaterKind::Derived, reads, vec![write]);
    }

    updaters.extend(
        render_updaters(
            syntax.return_expression,
            semantic.scoping(),
            &source_symbols,
            updaters.len(),
        )
        .map_err(|message| analysis_error(message).with_span(component_span))?,
    );

    Ok(ComponentFacts::new(component_name, source_facts, updaters)
        .with_span(component_span)
        .with_control_flow(control_flow))
}

fn lower_control_flow(control_flow: &ControlFlowAnalysis) -> ControlFlowFacts {
    ControlFlowFacts {
        entry: Some(ControlFlowBlockId::new(control_flow.entry)),
        blocks: control_flow
            .blocks
            .iter()
            .map(|block| ControlFlowBlockFact {
                id: ControlFlowBlockId::new(block.id),
                kind: match block.kind {
                    BlockKindAnalysis::Block => ControlFlowBlockKind::Block,
                    BlockKindAnalysis::Value => ControlFlowBlockKind::Value,
                    BlockKindAnalysis::Loop => ControlFlowBlockKind::Loop,
                    BlockKindAnalysis::Sequence => ControlFlowBlockKind::Sequence,
                    BlockKindAnalysis::Catch => ControlFlowBlockKind::Catch,
                },
                terminal: ControlFlowTerminalFact {
                    order: block.terminal.id,
                    kind: match block.terminal.kind {
                        TerminalKindAnalysis::Unreachable => ControlFlowTerminalKind::Unreachable,
                        TerminalKindAnalysis::Throw => ControlFlowTerminalKind::Throw,
                        TerminalKindAnalysis::Return(variant) => {
                            ControlFlowTerminalKind::Return(match variant {
                                ReturnVariantAnalysis::Void => ControlFlowReturnVariant::Void,
                                ReturnVariantAnalysis::Implicit => {
                                    ControlFlowReturnVariant::Implicit
                                }
                                ReturnVariantAnalysis::Explicit => {
                                    ControlFlowReturnVariant::Explicit
                                }
                            })
                        }
                        TerminalKindAnalysis::Goto(variant) => {
                            ControlFlowTerminalKind::Goto(match variant {
                                GotoVariantAnalysis::Break => ControlFlowGotoVariant::Break,
                                GotoVariantAnalysis::Continue => ControlFlowGotoVariant::Continue,
                                GotoVariantAnalysis::Try => ControlFlowGotoVariant::Try,
                            })
                        }
                        TerminalKindAnalysis::If => ControlFlowTerminalKind::If,
                        TerminalKindAnalysis::Branch => ControlFlowTerminalKind::Branch,
                        TerminalKindAnalysis::Switch => ControlFlowTerminalKind::Switch,
                        TerminalKindAnalysis::DoWhile => ControlFlowTerminalKind::DoWhile,
                        TerminalKindAnalysis::While => ControlFlowTerminalKind::While,
                        TerminalKindAnalysis::For => ControlFlowTerminalKind::For,
                        TerminalKindAnalysis::ForOf => ControlFlowTerminalKind::ForOf,
                        TerminalKindAnalysis::ForIn => ControlFlowTerminalKind::ForIn,
                        TerminalKindAnalysis::Logical => ControlFlowTerminalKind::Logical,
                        TerminalKindAnalysis::Ternary => ControlFlowTerminalKind::Ternary,
                        TerminalKindAnalysis::Optional => ControlFlowTerminalKind::Optional,
                        TerminalKindAnalysis::Label => ControlFlowTerminalKind::Label,
                        TerminalKindAnalysis::Sequence => ControlFlowTerminalKind::Sequence,
                        TerminalKindAnalysis::MaybeThrow => ControlFlowTerminalKind::MaybeThrow,
                        TerminalKindAnalysis::Try => ControlFlowTerminalKind::Try,
                        TerminalKindAnalysis::Scope => ControlFlowTerminalKind::Scope,
                        TerminalKindAnalysis::PrunedScope => ControlFlowTerminalKind::PrunedScope,
                    },
                    span: block
                        .terminal
                        .span
                        .map(|(start, end)| SourceSpan::new(start, end)),
                    successors: block
                        .terminal
                        .successors
                        .iter()
                        .copied()
                        .map(ControlFlowBlockId::new)
                        .collect(),
                },
            })
            .collect(),
    }
}

fn validate_supported_control_flow(
    control_flow: &ControlFlowFacts,
    component_name: &str,
    component_span: SourceSpan,
) -> Result<(), Diagnostic> {
    let explicit_returns = control_flow
        .blocks
        .iter()
        .filter(|block| {
            block.terminal.kind
                == ControlFlowTerminalKind::Return(ControlFlowReturnVariant::Explicit)
        })
        .collect::<Vec<_>>();
    if explicit_returns.len() <= 1 {
        return Ok(());
    }

    let span = explicit_returns
        .iter()
        .filter_map(|block| block.terminal.span)
        .min_by_key(|span| span.start)
        .unwrap_or(component_span);
    Err(Diagnostic::new(
        DiagnosticCode::UnsupportedControlFlow,
        format!(
            "component {component_name} has multiple render returns; typed multi-return lowering is not implemented"
        ),
    )
    .with_span(span))
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
