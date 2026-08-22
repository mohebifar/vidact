use crate::analysis::{ControlFlowFacts, ControlFlowTerminalKind};

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum StructuredRegionKind {
    Switch,
    For,
    ForOf,
    ForIn,
    While,
    DoWhile,
    Label,
    Try,
}

pub(super) fn lower_structured_regions(
    control_flow: &ControlFlowFacts,
) -> Vec<StructuredRegionKind> {
    let mut regions = control_flow
        .blocks
        .iter()
        .filter_map(|block| match block.terminal.kind {
            ControlFlowTerminalKind::Switch => Some(StructuredRegionKind::Switch),
            ControlFlowTerminalKind::For => Some(StructuredRegionKind::For),
            ControlFlowTerminalKind::ForOf => Some(StructuredRegionKind::ForOf),
            ControlFlowTerminalKind::ForIn => Some(StructuredRegionKind::ForIn),
            ControlFlowTerminalKind::While => Some(StructuredRegionKind::While),
            ControlFlowTerminalKind::DoWhile => Some(StructuredRegionKind::DoWhile),
            ControlFlowTerminalKind::Label => Some(StructuredRegionKind::Label),
            ControlFlowTerminalKind::Try => Some(StructuredRegionKind::Try),
            _ => None,
        })
        .collect::<Vec<_>>();
    regions.sort_unstable();
    regions.dedup();
    regions
}
