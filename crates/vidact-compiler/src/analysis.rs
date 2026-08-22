use crate::{Diagnostic, SourceSpan, render_flow::RenderFlowGraph};

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct SourceId(u32);

impl SourceId {
    #[must_use]
    pub const fn new(value: u32) -> Self {
        Self(value)
    }

    #[must_use]
    pub const fn get(self) -> u32 {
        self.0
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct UpdaterId(u32);

impl UpdaterId {
    #[must_use]
    pub const fn new(value: u32) -> Self {
        Self(value)
    }

    #[must_use]
    pub const fn get(self) -> u32 {
        self.0
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SourceKind {
    Prop,
    State,
    Derived,
    Context,
    External,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceFact {
    pub id: SourceId,
    pub name: String,
    pub kind: SourceKind,
}

impl SourceFact {
    #[must_use]
    pub fn new(id: SourceId, name: impl Into<String>, kind: SourceKind) -> Self {
        Self {
            id,
            name: name.into(),
            kind,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum KeyPath {
    Identity,
    Property(String),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum UpdaterKind {
    Derived,
    Text,
    Attribute { name: String },
    Property { name: String },
    Branch,
    KeyedList { key: KeyPath },
    Effect,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpdaterFact {
    pub id: UpdaterId,
    pub kind: UpdaterKind,
    pub reads: Vec<SourceId>,
    pub writes: Vec<SourceId>,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct ControlFlowBlockId(usize);

impl ControlFlowBlockId {
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
pub enum ControlFlowBlockKind {
    Block,
    Value,
    Loop,
    Sequence,
    Catch,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ControlFlowReturnVariant {
    Void,
    Implicit,
    Explicit,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ControlFlowGotoVariant {
    Break,
    Continue,
    Try,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ControlFlowTerminalKind {
    Unreachable,
    Throw,
    Return(ControlFlowReturnVariant),
    Goto(ControlFlowGotoVariant),
    If,
    Branch,
    Switch,
    DoWhile,
    While,
    For,
    ForOf,
    ForIn,
    Logical,
    Ternary,
    Optional,
    Label,
    Sequence,
    MaybeThrow,
    Try,
    Scope,
    PrunedScope,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct ControlFlowValueId(usize);

impl ControlFlowValueId {
    #[must_use]
    pub const fn new(value: usize) -> Self {
        Self(value)
    }

    #[must_use]
    pub const fn get(self) -> usize {
        self.0
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct ControlFlowInstructionId(usize);

impl ControlFlowInstructionId {
    #[must_use]
    pub const fn new(value: usize) -> Self {
        Self(value)
    }

    #[must_use]
    pub const fn get(self) -> usize {
        self.0
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ControlFlowValueFact {
    pub id: ControlFlowValueId,
    pub declaration_id: ControlFlowValueId,
    pub name: Option<String>,
    pub span: Option<SourceSpan>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ControlFlowInstructionKind {
    LoadLocal,
    LoadContext,
    DeclareLocal,
    DeclareContext,
    StoreLocal,
    StoreContext,
    Destructure,
    Primitive,
    JsxText,
    BinaryExpression,
    NewExpression,
    CallExpression,
    MethodCall,
    UnaryExpression,
    TypeCastExpression,
    JsxExpression,
    ObjectExpression,
    ObjectMethod,
    ArrayExpression,
    JsxFragment,
    RegExpLiteral,
    MetaProperty,
    PropertyStore,
    PropertyLoad,
    PropertyDelete,
    ComputedStore,
    ComputedLoad,
    ComputedDelete,
    LoadGlobal,
    StoreGlobal,
    FunctionExpression,
    TaggedTemplateExpression,
    TemplateLiteral,
    Await,
    GetIterator,
    IteratorNext,
    NextPropertyOf,
    PrefixUpdate,
    PostfixUpdate,
    Debugger,
    StartMemoize,
    FinishMemoize,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ControlFlowInstructionFact {
    pub id: ControlFlowInstructionId,
    pub kind: ControlFlowInstructionKind,
    pub span: Option<SourceSpan>,
    pub lvalues: Vec<ControlFlowValueFact>,
    pub dependencies: Vec<ControlFlowValueFact>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ControlFlowWriteKind {
    Local,
    Context,
    Global,
    Destructure,
    Property,
    ComputedProperty,
    DeleteProperty,
    DeleteComputedProperty,
    PrefixUpdate,
    PostfixUpdate,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ControlFlowWriteFact {
    pub kind: ControlFlowWriteKind,
    pub span: Option<SourceSpan>,
    pub targets: Vec<ControlFlowValueFact>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ControlFlowTerminalFact {
    pub order: usize,
    pub kind: ControlFlowTerminalKind,
    pub span: Option<SourceSpan>,
    pub operands: Vec<ControlFlowValueFact>,
    pub successors: Vec<ControlFlowBlockId>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ControlFlowBlockFact {
    pub id: ControlFlowBlockId,
    pub kind: ControlFlowBlockKind,
    pub instructions: Vec<ControlFlowInstructionFact>,
    pub terminal: ControlFlowTerminalFact,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ControlFlowFacts {
    pub entry: Option<ControlFlowBlockId>,
    pub blocks: Vec<ControlFlowBlockFact>,
    pub render_writes: Vec<ControlFlowWriteFact>,
}

impl UpdaterFact {
    #[must_use]
    pub fn new(
        id: UpdaterId,
        kind: UpdaterKind,
        reads: Vec<SourceId>,
        writes: Vec<SourceId>,
    ) -> Self {
        Self {
            id,
            kind,
            reads,
            writes,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ComponentFacts {
    pub name: String,
    pub span: Option<SourceSpan>,
    pub control_flow: ControlFlowFacts,
    pub render_flow: RenderFlowGraph,
    pub sources: Vec<SourceFact>,
    pub updaters: Vec<UpdaterFact>,
}

impl ComponentFacts {
    #[must_use]
    pub fn new(
        name: impl Into<String>,
        sources: Vec<SourceFact>,
        updaters: Vec<UpdaterFact>,
    ) -> Self {
        Self {
            name: name.into(),
            span: None,
            control_flow: ControlFlowFacts::default(),
            render_flow: RenderFlowGraph::default(),
            sources,
            updaters,
        }
    }

    #[must_use]
    pub fn with_span(mut self, span: SourceSpan) -> Self {
        self.span = Some(span);
        self
    }

    #[must_use]
    pub fn with_control_flow(mut self, control_flow: ControlFlowFacts) -> Self {
        self.control_flow = control_flow;
        self
    }

    #[must_use]
    pub fn with_render_flow(mut self, render_flow: RenderFlowGraph) -> Self {
        self.render_flow = render_flow;
        self
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ModuleInput<'a> {
    pub filename: &'a str,
    pub source: &'a str,
}

/// The intentionally narrow seam around React Compiler's Rust analysis engine.
///
/// An integration converts React's Babel-like AST and scope information into
/// `ComponentFacts`. No React HIR type crosses into Vidact's stable IR.
pub trait ReactAnalysisAdapter {
    fn analyze(&self, input: ModuleInput<'_>) -> Result<Vec<ComponentFacts>, Vec<Diagnostic>>;
}
