#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DiagnosticCode {
    AnalysisFailed,
    CyclicUpdaterGraph,
    DuplicateSource,
    DuplicateUpdater,
    EmptyComponentName,
    MultipleSourceWriters,
    UnknownSource,
    UnsupportedSyntax,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Diagnostic {
    pub code: DiagnosticCode,
    pub message: String,
}

impl Diagnostic {
    pub(crate) fn new(code: DiagnosticCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}
