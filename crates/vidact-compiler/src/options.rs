use std::{collections::BTreeSet, str::FromStr};

#[derive(Clone, Copy, Debug, Default, Eq, Ord, PartialEq, PartialOrd)]
pub enum CompilerTarget {
    #[default]
    Client,
    Hydrate,
    Server,
}

impl FromStr for CompilerTarget {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "client" => Ok(Self::Client),
            "hydrate" => Ok(Self::Hydrate),
            "server" => Ok(Self::Server),
            _ => Err(format!("unsupported Vidact target {value}")),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum CompilerFeature {
    UnsafeHtml,
    Async,
    Concurrent,
    Actions,
    CssInsertion,
    RetainedUi,
    Profiling,
    Framework,
}

impl FromStr for CompilerFeature {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "unsafe-html" => Ok(Self::UnsafeHtml),
            "async" => Ok(Self::Async),
            "concurrent" => Ok(Self::Concurrent),
            "actions" => Ok(Self::Actions),
            "css-insertion" => Ok(Self::CssInsertion),
            "retained-ui" => Ok(Self::RetainedUi),
            "profiling" => Ok(Self::Profiling),
            "framework" => Ok(Self::Framework),
            _ => Err(format!("unsupported Vidact feature {value}")),
        }
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct CompilationOptions {
    target: CompilerTarget,
    features: BTreeSet<CompilerFeature>,
}

impl CompilationOptions {
    #[must_use]
    pub fn new(target: CompilerTarget) -> Self {
        Self {
            target,
            features: BTreeSet::new(),
        }
    }

    #[must_use]
    pub fn with_feature(mut self, feature: CompilerFeature) -> Self {
        self.features.insert(feature);
        self
    }

    #[must_use]
    pub fn target(&self) -> CompilerTarget {
        self.target
    }

    #[must_use]
    pub fn feature_enabled(&self, feature: CompilerFeature) -> bool {
        self.features.contains(&feature)
    }
}
