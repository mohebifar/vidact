use std::collections::BTreeSet;

use crate::{
    Diagnostic, DiagnosticCode, SourceSpan,
    analysis::{
        ControlFlowBlockId, ControlFlowFacts, ControlFlowValueFact, ControlFlowValueId, SourceId,
    },
};

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ReactiveFlowGraph {
    pub blocks: Vec<ReactiveFlowBlock>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReactiveFlowBlock {
    pub id: ControlFlowBlockId,
    pub predecessors: Vec<ControlFlowBlockId>,
    pub phis: Vec<ReactiveFlowPhi>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReactiveFlowPhi {
    pub target: ReactiveFlowValue,
    pub operands: Vec<ReactiveFlowPhiOperand>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReactiveFlowPhiOperand {
    pub predecessor: ControlFlowBlockId,
    pub value: ReactiveFlowValue,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReactiveFlowValue {
    pub id: ControlFlowValueId,
    pub declaration_id: ControlFlowValueId,
    pub source: Option<SourceId>,
    pub name: Option<String>,
    pub span: Option<SourceSpan>,
}

pub fn lower_reactive_flow(
    control_flow: &ControlFlowFacts,
) -> Result<ReactiveFlowGraph, Diagnostic> {
    let block_ids = control_flow
        .blocks
        .iter()
        .map(|block| block.id)
        .collect::<BTreeSet<_>>();
    let mut targets = BTreeSet::new();
    let mut blocks = Vec::with_capacity(control_flow.blocks.len());

    for block in &control_flow.blocks {
        if block.predecessors.iter().any(|id| !block_ids.contains(id)) {
            return Err(invalid_ssa(format!(
                "block {} references an unknown predecessor",
                block.id.get()
            )));
        }
        let predecessors = block.predecessors.iter().copied().collect::<BTreeSet<_>>();
        let mut phis = Vec::with_capacity(block.phis.len());
        for phi in &block.phis {
            if !targets.insert(phi.target.id) {
                return Err(invalid_ssa(format!(
                    "SSA value {} is the target of more than one phi",
                    phi.target.id.get()
                )));
            }
            let mut incoming = BTreeSet::new();
            let mut operands = Vec::with_capacity(phi.operands.len());
            for operand in &phi.operands {
                if !predecessors.contains(&operand.predecessor) {
                    return Err(invalid_ssa(format!(
                        "phi {} references non-predecessor block {}",
                        phi.target.id.get(),
                        operand.predecessor.get()
                    )));
                }
                if !incoming.insert(operand.predecessor) {
                    return Err(invalid_ssa(format!(
                        "phi {} has duplicate operand for predecessor {}",
                        phi.target.id.get(),
                        operand.predecessor.get()
                    )));
                }
                if operand.value.declaration_id != phi.target.declaration_id {
                    return Err(invalid_ssa(format!(
                        "phi {} joins values from different declarations",
                        phi.target.id.get()
                    )));
                }
                operands.push(ReactiveFlowPhiOperand {
                    predecessor: operand.predecessor,
                    value: lower_value(&operand.value),
                });
            }
            if incoming != predecessors {
                return Err(invalid_ssa(format!(
                    "phi {} does not define exactly one operand per predecessor",
                    phi.target.id.get()
                )));
            }
            phis.push(ReactiveFlowPhi {
                target: lower_value(&phi.target),
                operands,
            });
        }
        blocks.push(ReactiveFlowBlock {
            id: block.id,
            predecessors: block.predecessors.clone(),
            phis,
        });
    }

    Ok(ReactiveFlowGraph { blocks })
}

fn lower_value(value: &ControlFlowValueFact) -> ReactiveFlowValue {
    ReactiveFlowValue {
        id: value.id,
        declaration_id: value.declaration_id,
        source: value.source,
        name: value.name.clone(),
        span: value.span,
    }
}

fn invalid_ssa(message: impl Into<String>) -> Diagnostic {
    Diagnostic::new(DiagnosticCode::AnalysisFailed, message)
}
