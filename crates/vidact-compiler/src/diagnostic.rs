#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DiagnosticCode {
    AnalysisFailed,
    CyclicUpdaterGraph,
    DestructiveRenderMutation,
    DuplicateSource,
    DuplicateUpdater,
    EmptyComponentName,
    MultipleSourceWriters,
    UnsupportedComponentForm,
    UnsupportedControlFlow,
    UnknownSource,
    UnsupportedSyntax,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SourceSpan {
    pub start: u32,
    pub end: u32,
}

impl SourceSpan {
    #[must_use]
    pub const fn new(start: u32, end: u32) -> Self {
        Self { start, end }
    }

    #[must_use]
    pub(crate) const fn from_oxc(span: oxc_span::Span) -> Self {
        Self::new(span.start, span.end)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Diagnostic {
    pub code: DiagnosticCode,
    pub message: String,
    pub span: Option<SourceSpan>,
}

impl Diagnostic {
    pub(crate) fn new(code: DiagnosticCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            span: None,
        }
    }

    pub(crate) fn with_span(mut self, span: SourceSpan) -> Self {
        self.span = Some(span);
        self
    }

    pub(crate) fn with_fallback_span(mut self, span: Option<SourceSpan>) -> Self {
        if self.span.is_none() {
            self.span = span;
        }
        self
    }
}
