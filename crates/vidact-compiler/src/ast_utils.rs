use oxc_ast::ast::{Declaration, Function, Program, Statement};

pub(crate) fn component_function<'a>(
    program: &'a Program<'a>,
    name: &str,
) -> Option<&'a Function<'a>> {
    program.body.iter().find_map(|statement| match statement {
        Statement::FunctionDeclaration(function)
            if function.id.as_ref().is_some_and(|id| id.name == name) =>
        {
            Some(function.as_ref())
        }
        Statement::ExportDeclaration(export) => match &export.declaration {
            Declaration::FunctionDeclaration(function)
                if function.id.as_ref().is_some_and(|id| id.name == name) =>
            {
                Some(function.as_ref())
            }
            _ => None,
        },
        _ => None,
    })
}

pub(crate) fn is_event_attribute(name: &str) -> bool {
    name.strip_prefix("on")
        .and_then(|suffix| suffix.chars().next())
        .is_some_and(|first| first.is_ascii_uppercase())
}
