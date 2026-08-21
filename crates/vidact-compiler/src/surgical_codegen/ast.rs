use oxc_allocator::GetAllocator;
use oxc_ast::{ast::*, builder::AstBuilder};
use oxc_span::SPAN;

use crate::analysis::SourceId;

use super::{COMBINE_SOURCES, SOURCE};

pub(super) fn mask<'a>(ast: &AstBuilder<'a>, sources: &[SourceId]) -> Expression<'a> {
    let mut masks = sources
        .iter()
        .map(|source| call_name(ast, SOURCE, [number(ast, source.get())]));
    let first = masks.next().unwrap_or_else(|| number(ast, 0));
    match masks.next() {
        None => first,
        Some(second) => call_name(
            ast,
            COMBINE_SOURCES,
            std::iter::once(first)
                .chain(std::iter::once(second))
                .chain(masks),
        ),
    }
}

pub(super) fn ident<'a>(ast: &AstBuilder<'a>, name: &str) -> Expression<'a> {
    Expression::new_identifier(SPAN, atom(ast, name), ast)
}

pub(super) fn number<'a>(ast: &AstBuilder<'a>, value: u32) -> Expression<'a> {
    Expression::new_numeric_literal(SPAN, f64::from(value), None, NumberBase::Decimal, ast)
}

pub(super) fn call_name<'a>(
    ast: &AstBuilder<'a>,
    name: &str,
    arguments: impl IntoIterator<Item = Expression<'a>>,
) -> Expression<'a> {
    call(ast, ident(ast, name), arguments)
}

pub(super) fn call_member<'a>(
    ast: &AstBuilder<'a>,
    object: Expression<'a>,
    property: &str,
    arguments: impl IntoIterator<Item = Expression<'a>>,
) -> Expression<'a> {
    let member = Expression::from(MemberExpression::new_static_member_expression(
        SPAN,
        object,
        IdentifierName::new(SPAN, atom(ast, property), ast),
        false,
        ast,
    ));
    call(ast, member, arguments)
}

pub(super) fn call<'a>(
    ast: &AstBuilder<'a>,
    callee: Expression<'a>,
    arguments: impl IntoIterator<Item = Expression<'a>>,
) -> Expression<'a> {
    let arguments =
        oxc_allocator::Vec::from_iter_in(arguments.into_iter().map(Argument::from), ast);
    Expression::new_call_expression(SPAN, callee, None, arguments, false, ast)
}

pub(super) fn arrow_expression<'a>(
    ast: &AstBuilder<'a>,
    params: impl IntoIterator<Item = &'a str>,
    body: Expression<'a>,
) -> Expression<'a> {
    Expression::new_arrow_function_expression(
        SPAN,
        false,
        None,
        parameters(ast, params),
        None,
        ArrowFunctionBody::from(body),
        ast,
    )
}

pub(super) fn arrow_block<'a>(
    ast: &AstBuilder<'a>,
    params: impl IntoIterator<Item = &'a str>,
    statements: impl IntoIterator<Item = Statement<'a>>,
) -> Expression<'a> {
    Expression::new_arrow_function_expression(
        SPAN,
        false,
        None,
        parameters(ast, params),
        None,
        ArrowFunctionBody::new_function_body(
            SPAN,
            [],
            oxc_allocator::Vec::from_iter_in(statements, ast),
            ast,
        ),
        ast,
    )
}

fn parameters<'a>(
    ast: &AstBuilder<'a>,
    names: impl IntoIterator<Item = &'a str>,
) -> oxc_allocator::Box<'a, FormalParameters<'a>> {
    let items = oxc_allocator::Vec::from_iter_in(
        names.into_iter().map(|name| {
            FormalParameter::new(
                SPAN,
                [],
                BindingPattern::new_binding_identifier(SPAN, atom(ast, name), ast),
                None,
                None,
                false,
                None,
                false,
                false,
                ast,
            )
        }),
        ast,
    );
    FormalParameters::boxed(
        SPAN,
        FormalParameterKind::ArrowFormalParameters,
        items,
        None,
        ast,
    )
}

pub(super) fn object<'a, 'n>(
    ast: &AstBuilder<'a>,
    properties: impl IntoIterator<Item = (&'n str, Expression<'a>)>,
) -> Expression<'a> {
    let properties = oxc_allocator::Vec::from_iter_in(
        properties.into_iter().map(|(name, value)| {
            ObjectPropertyKind::new_object_property(
                SPAN,
                PropertyKind::Init,
                PropertyKey::new_static_identifier(SPAN, atom(ast, name), ast),
                value,
                false,
                false,
                false,
                ast,
            )
        }),
        ast,
    );
    Expression::new_object_expression(SPAN, properties, ast)
}

pub(super) fn variable_statement<'a>(
    ast: &AstBuilder<'a>,
    kind: VariableDeclarationKind,
    name: &str,
    initializer: Expression<'a>,
) -> Statement<'a> {
    let declarator = VariableDeclarator::new(
        SPAN,
        kind,
        BindingPattern::new_binding_identifier(SPAN, atom(ast, name), ast),
        None,
        Some(initializer),
        false,
        ast,
    );
    Statement::from(Declaration::new_variable_declaration(
        SPAN,
        kind,
        oxc_allocator::Vec::from_array_in([declarator], ast),
        false,
        ast,
    ))
}

pub(super) fn atom<'a>(ast: &AstBuilder<'a>, value: &str) -> &'a str {
    ast.allocator().alloc_str(value)
}
