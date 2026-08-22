use std::collections::{BTreeMap, BTreeSet};

use oxc_react_compiler::{FunctionAnalysis, InstructionAnalysis};

use crate::analysis::SourceId;

pub(super) struct CompilerDefUse<'a> {
    producers: BTreeMap<usize, &'a InstructionAnalysis>,
    declarations_by_span: BTreeMap<u32, usize>,
    roots_by_declaration: BTreeMap<usize, Vec<usize>>,
}

impl<'a> CompilerDefUse<'a> {
    pub(super) fn new(analysis: &'a FunctionAnalysis) -> Self {
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
        let mut declarations_by_span = BTreeMap::new();
        let mut roots_by_declaration = BTreeMap::<usize, Vec<usize>>::new();
        for lvalue in analysis
            .instructions
            .iter()
            .flat_map(|instruction| &instruction.lvalues)
        {
            if let Some((start, _)) = lvalue.span {
                declarations_by_span
                    .entry(start)
                    .or_insert(lvalue.declaration_id);
            }
            roots_by_declaration
                .entry(lvalue.declaration_id)
                .or_default()
                .push(lvalue.id);
        }
        Self {
            producers,
            declarations_by_span,
            roots_by_declaration,
        }
    }

    pub(super) fn declaration_id(&self, declaration_start: u32) -> Option<usize> {
        self.declarations_by_span.get(&declaration_start).copied()
    }

    pub(super) fn reads_for(
        &self,
        root_declaration: usize,
        source_declarations: &BTreeMap<usize, SourceId>,
    ) -> Vec<SourceId> {
        let mut reads = BTreeSet::new();
        let mut visited = BTreeSet::new();
        for root in self
            .roots_by_declaration
            .get(&root_declaration)
            .into_iter()
            .flatten()
        {
            self.collect_reads(*root, source_declarations, &mut visited, &mut reads);
        }
        reads.into_iter().collect()
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
