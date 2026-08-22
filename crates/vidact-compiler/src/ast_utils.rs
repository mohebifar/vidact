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
