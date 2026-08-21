use crate::Diagnostic;

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
            sources,
            updaters,
        }
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
