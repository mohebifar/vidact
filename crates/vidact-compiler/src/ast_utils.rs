use oxc_ast::ast::{
    ArrowFunctionExpression, BindingPattern, Declaration, Expression, FormalParameters, Function,
    FunctionBody, Program, Statement, VariableDeclaration,
};

use crate::SourceSpan;

pub(crate) fn component_function_parts<'a>(
    program: &'a Program<'a>,
    name: &str,
    span: Option<SourceSpan>,
) -> Option<(&'a FormalParameters<'a>, &'a FunctionBody<'a>)> {
    program.body.iter().find_map(|statement| match statement {
        Statement::FunctionDeclaration(function)
            if function.id.as_ref().is_some_and(|id| id.name == name)
                && span.is_none_or(|span| {
                    function.span.start == span.start && function.span.end == span.end
                }) =>
        {
            Some((function.params.as_ref(), function.body.as_deref()?))
        }
        Statement::ExportDeclaration(export) => match &export.declaration {
            Declaration::FunctionDeclaration(function)
                if function.id.as_ref().is_some_and(|id| id.name == name)
                    && span.is_none_or(|span| {
                        function.span.start == span.start && function.span.end == span.end
                    }) =>
            {
                Some((function.params.as_ref(), function.body.as_deref()?))
            }
            Declaration::VariableDeclaration(declaration) => {
                variable_parts(declaration, name, span)
            }
            _ => None,
        },
        Statement::VariableDeclaration(declaration) => variable_parts(declaration, name, span),
        _ => None,
    })
}

pub(crate) fn component_function_parts_mut<'p, 'a>(
    program: &'p mut Program<'a>,
    name: &str,
    span: Option<SourceSpan>,
) -> Option<(&'p mut FormalParameters<'a>, &'p mut FunctionBody<'a>)> {
    program
        .body
        .iter_mut()
        .find_map(|statement| match statement {
            Statement::FunctionDeclaration(function)
                if function.id.as_ref().is_some_and(|id| id.name == name)
                    && span.is_none_or(|span| {
                        function.span.start == span.start && function.span.end == span.end
                    }) =>
            {
                let Function { params, body, .. } = function.as_mut();
                Some((params.as_mut(), body.as_deref_mut()?))
            }
            Statement::ExportDeclaration(export) => match &mut export.declaration {
                Declaration::FunctionDeclaration(function)
                    if function.id.as_ref().is_some_and(|id| id.name == name)
                        && span.is_none_or(|span| {
                            function.span.start == span.start && function.span.end == span.end
                        }) =>
                {
                    let Function { params, body, .. } = function.as_mut();
                    Some((params.as_mut(), body.as_deref_mut()?))
                }
                Declaration::VariableDeclaration(declaration) => {
                    variable_parts_mut(declaration, name, span)
                }
                _ => None,
            },
            Statement::VariableDeclaration(declaration) => {
                variable_parts_mut(declaration, name, span)
            }
            _ => None,
        })
}

fn variable_parts<'a>(
    declaration: &'a VariableDeclaration<'a>,
    name: &str,
    span: Option<SourceSpan>,
) -> Option<(&'a FormalParameters<'a>, &'a FunctionBody<'a>)> {
    declaration.declarations.iter().find_map(|declarator| {
        let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
            return None;
        };
        let Expression::ArrowFunctionExpression(function) = declarator.init.as_ref()? else {
            return None;
        };
        if identifier.name != name
            || span.is_some_and(|span| {
                function.span.start != span.start || function.span.end != span.end
            })
        {
            return None;
        }
        Some((function.params.as_ref(), function.body.as_function_body()?))
    })
}

fn variable_parts_mut<'p, 'a>(
    declaration: &'p mut VariableDeclaration<'a>,
    name: &str,
    span: Option<SourceSpan>,
) -> Option<(&'p mut FormalParameters<'a>, &'p mut FunctionBody<'a>)> {
    declaration.declarations.iter_mut().find_map(|declarator| {
        let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
            return None;
        };
        let Expression::ArrowFunctionExpression(function) = declarator.init.as_mut()? else {
            return None;
        };
        if identifier.name != name
            || span.is_some_and(|span| {
                function.span.start != span.start || function.span.end != span.end
            })
        {
            return None;
        }
        let ArrowFunctionExpression { params, body, .. } = function.as_mut();
        Some((params.as_mut(), body.as_function_body_mut()?))
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
