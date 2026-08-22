mod graph;
mod identity;
mod lower;

pub use graph::{
    RenderDecisionKind, RenderFlowGraph, RenderFlowNode, RenderFlowNodeId, RenderFlowNodeKind,
    RenderSwitchCase,
};
pub use identity::{
    RenderAlignment, RenderAlignmentKind, RenderIdentity, RenderIdentityKey, RenderIdentityKind,
    align_render_identities,
};

pub(crate) use lower::lower_render_flow;
