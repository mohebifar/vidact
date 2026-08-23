use oxc_ast::ast::{
    BindingPattern, Declaration, Expression, Function, Program, Statement, VariableDeclaration,
};

use crate::SourceSpan;

pub(crate) fn component_function<'a>(
    program: &'a Program<'a>,
    name: &str,
    span: Option<SourceSpan>,
) -> Option<&'a Function<'a>> {
    program.body.iter().find_map(|statement| match statement {
        Statement::FunctionDeclaration(function)
            if function.id.as_ref().is_some_and(|id| id.name == name)
                && span.is_none_or(|span| {
                    function.span.start == span.start && function.span.end == span.end
                }) =>
        {
            Some(function.as_ref())
        }
        Statement::ExportDeclaration(export) => match &export.declaration {
            Declaration::FunctionDeclaration(function)
                if function.id.as_ref().is_some_and(|id| id.name == name)
                    && span.is_none_or(|span| {
                        function.span.start == span.start && function.span.end == span.end
                    }) =>
            {
                Some(function.as_ref())
            }
            _ => None,
        },
        _ => None,
    })
}

pub(crate) fn component_name_for_span<'a>(
    program: &'a Program<'a>,
    span: SourceSpan,
) -> Option<&'a str> {
    program.body.iter().find_map(|statement| match statement {
        Statement::VariableDeclaration(declaration) => variable_name_for_span(declaration, span),
        Statement::ExportDeclaration(export) => match &export.declaration {
            Declaration::VariableDeclaration(declaration) => {
                variable_name_for_span(declaration, span)
            }
            _ => None,
        },
        _ => None,
    })
}

fn variable_name_for_span<'a>(
    declaration: &'a VariableDeclaration<'a>,
    span: SourceSpan,
) -> Option<&'a str> {
    declaration.declarations.iter().find_map(|declarator| {
        let Expression::ArrowFunctionExpression(function) = declarator.init.as_ref()? else {
            return None;
        };
        if function.span.start != span.start || function.span.end != span.end {
            return None;
        }
        let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
            return None;
        };
        Some(identifier.name.as_str())
    })
}

pub(crate) fn is_event_attribute(name: &str) -> bool {
    name.strip_prefix("on")
        .and_then(|suffix| suffix.chars().next())
        .is_some_and(|first| first.is_ascii_uppercase())
}

pub(crate) fn is_supported_react_event_attribute(name: &str) -> bool {
    let Some(event_name) = name.strip_prefix("on") else {
        return false;
    };
    is_supported_react_event_name(event_name)
        || event_name
            .strip_suffix("Capture")
            .is_some_and(is_supported_react_event_name)
}

fn is_supported_react_event_name(name: &str) -> bool {
    matches!(
        name,
        "Abort"
            | "AnimationEnd"
            | "AnimationIteration"
            | "AnimationStart"
            | "AuxClick"
            | "BeforeInput"
            | "BeforeToggle"
            | "Blur"
            | "CanPlay"
            | "CanPlayThrough"
            | "Cancel"
            | "Change"
            | "Click"
            | "Close"
            | "CompositionEnd"
            | "CompositionStart"
            | "CompositionUpdate"
            | "ContextMenu"
            | "Copy"
            | "Cut"
            | "DoubleClick"
            | "Drag"
            | "DragEnd"
            | "DragEnter"
            | "DragExit"
            | "DragLeave"
            | "DragOver"
            | "DragStart"
            | "Drop"
            | "DurationChange"
            | "Emptied"
            | "Encrypted"
            | "Ended"
            | "Error"
            | "Focus"
            | "GotPointerCapture"
            | "Input"
            | "Invalid"
            | "KeyDown"
            | "KeyPress"
            | "KeyUp"
            | "Load"
            | "LoadedData"
            | "LoadedMetadata"
            | "LoadStart"
            | "LostPointerCapture"
            | "MouseDown"
            | "MouseEnter"
            | "MouseLeave"
            | "MouseMove"
            | "MouseOut"
            | "MouseOver"
            | "MouseUp"
            | "Paste"
            | "Pause"
            | "Play"
            | "Playing"
            | "PointerCancel"
            | "PointerDown"
            | "PointerEnter"
            | "PointerLeave"
            | "PointerMove"
            | "PointerOut"
            | "PointerOver"
            | "PointerUp"
            | "Progress"
            | "RateChange"
            | "Reset"
            | "Resize"
            | "Scroll"
            | "ScrollEnd"
            | "Seeked"
            | "Seeking"
            | "Select"
            | "Stalled"
            | "Submit"
            | "Suspend"
            | "TimeUpdate"
            | "Toggle"
            | "TouchCancel"
            | "TouchEnd"
            | "TouchMove"
            | "TouchStart"
            | "TransitionCancel"
            | "TransitionEnd"
            | "TransitionRun"
            | "TransitionStart"
            | "VolumeChange"
            | "Waiting"
            | "Wheel"
    )
}
