use std::collections::{BTreeSet, HashMap, HashSet};

use crate::{
    Diagnostic, DiagnosticCode,
    analysis::{ComponentFacts, SourceId, SourceKind, UpdaterFact, UpdaterId, UpdaterKind},
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IrSource {
    pub id: SourceId,
    pub name: String,
    pub kind: SourceKind,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IrUpdater {
    pub id: UpdaterId,
    pub kind: UpdaterKind,
    pub reads: Vec<SourceId>,
    pub writes: Vec<SourceId>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ComponentIr {
    pub name: String,
    pub sources: Vec<IrSource>,
    /// Compiler execution order. The runtime must not rediscover this graph.
    pub updaters: Vec<IrUpdater>,
}

pub fn lower_component(facts: ComponentFacts) -> Result<ComponentIr, Diagnostic> {
    if facts.name.trim().is_empty() {
        return Err(Diagnostic::new(
            DiagnosticCode::EmptyComponentName,
            "component name cannot be empty",
        ));
    }

    let mut source_ids = HashSet::with_capacity(facts.sources.len());
    for source in &facts.sources {
        if !source_ids.insert(source.id) {
            return Err(Diagnostic::new(
                DiagnosticCode::DuplicateSource,
                format!("source id {} is declared more than once", source.id.get()),
            ));
        }
    }

    let mut updater_ids = HashSet::with_capacity(facts.updaters.len());
    for updater in &facts.updaters {
        if !updater_ids.insert(updater.id) {
            return Err(Diagnostic::new(
                DiagnosticCode::DuplicateUpdater,
                format!("updater id {} is declared more than once", updater.id.get()),
            ));
        }

        for source in updater.reads.iter().chain(&updater.writes) {
            if !source_ids.contains(source) {
                return Err(Diagnostic::new(
                    DiagnosticCode::UnknownSource,
                    format!(
                        "updater {} references unknown source {}",
                        updater.id.get(),
                        source.get()
                    ),
                ));
            }
        }
    }

    let updater_order = topological_updater_order(&facts.updaters)?;

    Ok(ComponentIr {
        name: facts.name,
        sources: facts
            .sources
            .into_iter()
            .map(|source| IrSource {
                id: source.id,
                name: source.name,
                kind: source.kind,
            })
            .collect(),
        updaters: updater_order
            .into_iter()
            .map(|index| {
                let updater = &facts.updaters[index];
                IrUpdater {
                    id: updater.id,
                    kind: updater.kind.clone(),
                    reads: updater.reads.clone(),
                    writes: updater.writes.clone(),
                }
            })
            .collect(),
    })
}

fn topological_updater_order(updaters: &[UpdaterFact]) -> Result<Vec<usize>, Diagnostic> {
    let mut writer_by_source = HashMap::<SourceId, usize>::new();
    for (index, updater) in updaters.iter().enumerate() {
        for source in &updater.writes {
            if let Some(previous) = writer_by_source.insert(*source, index)
                && previous != index
            {
                return Err(Diagnostic::new(
                    DiagnosticCode::MultipleSourceWriters,
                    format!(
                        "source {} is written by updaters {} and {}",
                        source.get(),
                        updaters[previous].id.get(),
                        updater.id.get()
                    ),
                ));
            }
        }
    }

    let mut edges = vec![Vec::<usize>::new(); updaters.len()];
    let mut indegrees = vec![0_usize; updaters.len()];
    let mut seen_edges = HashSet::new();
    for (reader_index, updater) in updaters.iter().enumerate() {
        for source in &updater.reads {
            let Some(&writer_index) = writer_by_source.get(source) else {
                continue;
            };
            if seen_edges.insert((writer_index, reader_index)) {
                edges[writer_index].push(reader_index);
                indegrees[reader_index] += 1;
            }
        }
    }

    let mut ready = indegrees
        .iter()
        .enumerate()
        .filter_map(|(index, &indegree)| (indegree == 0).then_some(index))
        .collect::<BTreeSet<_>>();
    let mut order = Vec::with_capacity(updaters.len());
    while let Some(index) = ready.pop_first() {
        order.push(index);
        for &reader in &edges[index] {
            indegrees[reader] -= 1;
            if indegrees[reader] == 0 {
                ready.insert(reader);
            }
        }
    }

    if order.len() != updaters.len() {
        let cycle = indegrees
            .iter()
            .enumerate()
            .filter_map(|(index, &indegree)| (indegree > 0).then_some(updaters[index].id.get()))
            .map(|id| id.to_string())
            .collect::<Vec<_>>()
            .join(", ");
        return Err(Diagnostic::new(
            DiagnosticCode::CyclicUpdaterGraph,
            format!("updater dependency graph contains a cycle involving: {cycle}"),
        ));
    }

    Ok(order)
}
