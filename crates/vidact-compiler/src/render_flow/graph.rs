use crate::{SourceSpan, render_flow::RenderIdentity};

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct RenderFlowNodeId(usize);

impl RenderFlowNodeId {
    #[must_use]
    pub const fn new(value: usize) -> Self {
        Self(value)
    }

    #[must_use]
    pub const fn get(self) -> usize {
        self.0
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RenderDecisionKind {
    If,
    Ternary,
    LogicalAnd,
    LogicalOr,
    NullishCoalescing,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RenderSwitchCase {
    pub test: Option<SourceSpan>,
    pub target: RenderFlowNodeId,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RenderFlowNodeKind {
    Value {
        expression: Option<SourceSpan>,
        identity: RenderIdentity,
    },
    Decision {
        kind: RenderDecisionKind,
        test: SourceSpan,
        consequent: RenderFlowNodeId,
        alternate: RenderFlowNodeId,
    },
    Switch {
        discriminant: SourceSpan,
        cases: Vec<RenderSwitchCase>,
        fallback: RenderFlowNodeId,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RenderFlowNode {
    pub id: RenderFlowNodeId,
    pub kind: RenderFlowNodeKind,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct RenderFlowGraph {
    pub entry: Option<RenderFlowNodeId>,
    pub nodes: Vec<RenderFlowNode>,
}
