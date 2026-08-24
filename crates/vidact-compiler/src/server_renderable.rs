use std::collections::BTreeSet;

use oxc_allocator::{Allocator, CloneIn, GetAllocator, Vec as ArenaVec};
use oxc_ast::{ast::*, builder::AstBuilder};
use oxc_ast_visit::{
    Visit, VisitMut,
    walk_mut::{walk_call_expression, walk_expression, walk_jsx_attribute},
};
use oxc_span::SPAN;

use crate::{Diagnostic, DiagnosticCode, SourceSpan, react_bindings::ReactBindings};

const CLONE_RENDERABLE: &str = "__vidactCloneRenderable";
const CLONE_RENDERABLE_COMPONENT: &str = "__vidactCloneRenderableComponent";
const CREATE_RENDERABLE: &str = "__vidactCreateRenderable";
const DYNAMIC_INTRINSIC_COMPONENT: &str = "__vidactDynamicIntrinsicComponent";
const FORWARDED_REF: &str = "__vidactForwardedRef";
const IS_RENDERABLE: &str = "__vidactIsRenderable";
const RENDERABLE_CHILDREN: &str = "__vidactRenderableChildren";
const RENDERABLE_INPUT: &str = "__vidactRenderableInput";
const RENDERABLE_MARKER: &str = "__vidactRenderableMarker";
const RENDERABLE_PROPS: &str = "__vidactRenderableProps";
const RENDERABLE_REF: &str = "__vidactRenderableRef";
const RENDERABLE_TO_ARRAY: &str = "__vidactRenderableToArray";

pub(crate) fn lower_server_renderables<'a>(
    allocator: &'a Allocator,
    program: &mut Program<'a>,
    react: &ReactBindings<'_>,
) -> Result<(), Diagnostic> {
    let ast = AstBuilder::new(allocator);
    let mut transformer = ServerRenderableTransformer {
        ast: &ast,
        react,
        diagnostic: None,
    };
    transformer.visit_program(program);
    if let Some(diagnostic) = transformer.diagnostic {
        return Err(diagnostic);
    }

    let mut references = GeneratedReferenceFinder::default();
    references.visit_program(program);
    let names = [
        ("cloneRenderable", CLONE_RENDERABLE),
        ("cloneRenderableComponent", CLONE_RENDERABLE_COMPONENT),
        ("createRenderable", CREATE_RENDERABLE),
        ("dynamicIntrinsicComponent", DYNAMIC_INTRINSIC_COMPONENT),
        ("forwardedRef", FORWARDED_REF),
        ("isRenderable", IS_RENDERABLE),
        ("renderableChildren", RENDERABLE_CHILDREN),
        ("renderableMarker", RENDERABLE_MARKER),
        ("renderableProps", RENDERABLE_PROPS),
        ("renderableRef", RENDERABLE_REF),
        ("renderableToArray", RENDERABLE_TO_ARRAY),
    ];
    let specifiers = ArenaVec::from_iter_in(
        names
            .into_iter()
            .filter(|(_, local)| references.names.contains(*local))
            .map(|(imported, local)| {
                ImportDeclarationSpecifier::new_import_specifier(
                    SPAN,
                    ModuleExportName::new_identifier_name(SPAN, atom(&ast, imported), &ast),
                    BindingIdentifier::new(SPAN, atom(&ast, local), &ast),
                    ImportOrExportKind::Value,
                    &ast,
                )
            }),
        &ast,
    );
    if !specifiers.is_empty() {
        program.body.insert(
            0,
            Statement::new_import_declaration(
                SPAN,
                Some(specifiers),
                StringLiteral::new(SPAN, "@vidact/runtime/server", None, &ast),
                None,
                None,
                ImportOrExportKind::Value,
                &ast,
            ),
        );
    }
    Ok(())
}

struct ServerRenderableTransformer<'a, 'r, 's> {
    ast: &'r AstBuilder<'a>,
    react: &'r ReactBindings<'s>,
    diagnostic: Option<Diagnostic>,
}

impl<'a> ServerRenderableTransformer<'a, '_, '_> {
    fn lower_attribute_element(
        &mut self,
        mut element: oxc_allocator::Box<'a, JSXElement<'a>>,
    ) -> Result<Expression<'a>, Diagnostic> {
        self.visit_jsx_element(&mut element);
        let (input, constructor) = renderable_parts(self.ast, element)?;
        Ok(call_name(
            self.ast,
            CREATE_RENDERABLE,
            [
                input,
                arrow_expression(self.ast, RENDERABLE_INPUT, constructor),
            ],
        ))
    }
}

impl<'a> VisitMut<'a> for ServerRenderableTransformer<'a, '_, '_> {
    fn visit_expression(&mut self, expression: &mut Expression<'a>) {
        walk_expression(self, expression);
        let Expression::ChainExpression(chain) = expression else {
            return;
        };
        let ChainElement::StaticMemberExpression(member) = &chain.expression else {
            return;
        };
        if member.property.name != "$$typeof" {
            return;
        }
        let value = member
            .object
            .clone_in_with_semantic_ids(self.ast.allocator());
        *expression = call_name(self.ast, RENDERABLE_MARKER, [value]);
    }

    fn visit_call_expression(&mut self, call: &mut CallExpression<'a>) {
        let replacement = if self.react.is_clone_element_call(call) {
            if !(1..=2).contains(&call.arguments.len())
                || call.arguments.iter().any(Argument::is_spread)
            {
                self.diagnostic = Some(unsupported_at(
                    "cloneElement requires a renderable and optional props object",
                    call.span,
                ));
                return;
            }
            Some(CLONE_RENDERABLE)
        } else if self.react.is_valid_element_call(call) {
            if call.arguments.len() != 1 || call.arguments[0].is_spread() {
                self.diagnostic = Some(unsupported_at(
                    "isValidElement requires one value",
                    call.span,
                ));
                return;
            }
            Some(IS_RENDERABLE)
        } else if self.react.is_children_to_array_call(call) {
            if call.arguments.len() != 1 || call.arguments[0].is_spread() {
                self.diagnostic = Some(unsupported_at(
                    "Children.toArray supports one renderable value",
                    call.span,
                ));
                return;
            }
            Some(RENDERABLE_TO_ARRAY)
        } else {
            None
        };
        walk_call_expression(self, call);
        if let Some(name) = replacement {
            call.callee = ident(self.ast, name);
            call.type_arguments = None;
        }
    }

    fn visit_jsx_attribute(&mut self, attribute: &mut JSXAttribute<'a>) {
        if matches!(
            &attribute.name,
            JSXAttributeName::Identifier(name) if name.name == "fallback"
        ) {
            walk_jsx_attribute(self, attribute);
            return;
        }
        if let Some(JSXAttributeValue::Element(_)) = &attribute.value {
            let Some(JSXAttributeValue::Element(element)) = attribute.value.take() else {
                unreachable!();
            };
            match self.lower_attribute_element(element) {
                Ok(expression) => {
                    attribute.value = Some(JSXAttributeValue::new_expression_container(
                        attribute.span,
                        expression.into(),
                        self.ast,
                    ));
                }
                Err(diagnostic) => self.diagnostic = Some(diagnostic),
            }
            return;
        }
        if let Some(JSXAttributeValue::ExpressionContainer(container)) = &mut attribute.value
            && let JSXExpression::JSXElement(element) = &container.expression
        {
            let element = element.clone_in_with_semantic_ids(self.ast.allocator());
            match self.lower_attribute_element(element) {
                Ok(expression) => container.expression = expression.into(),
                Err(diagnostic) => self.diagnostic = Some(diagnostic),
            }
            return;
        }
        walk_jsx_attribute(self, attribute);
    }
}

fn renderable_parts<'a>(
    ast: &AstBuilder<'a>,
    element: oxc_allocator::Box<'a, JSXElement<'a>>,
) -> Result<(Expression<'a>, Expression<'a>), Diagnostic> {
    let span = element.span;
    let mut properties = ArenaVec::new_in(ast);
    for item in &element.opening_element.attributes {
        match item {
            JSXAttributeItem::SpreadAttribute(spread) => {
                properties.push(ObjectPropertyKind::new_spread_property(
                    spread.span,
                    spread.argument.clone_in_with_semantic_ids(ast.allocator()),
                    ast,
                ))
            }
            JSXAttributeItem::Attribute(attribute) => {
                let JSXAttributeName::Identifier(name) = &attribute.name else {
                    return Err(unsupported_at(
                        "renderable capability attributes require ordinary prop names",
                        attribute.span,
                    ));
                };
                let value = match &attribute.value {
                    None => Expression::new_boolean_literal(attribute.span, true, ast),
                    Some(JSXAttributeValue::StringLiteral(value)) => {
                        Expression::StringLiteral(value.clone_in_with_semantic_ids(ast.allocator()))
                    }
                    Some(JSXAttributeValue::ExpressionContainer(container)) => container
                        .expression
                        .as_expression()
                        .ok_or_else(|| {
                            unsupported_at("renderable prop must have a value", container.span)
                        })?
                        .clone_in_with_semantic_ids(ast.allocator()),
                    Some(JSXAttributeValue::Element(value)) => {
                        Expression::JSXElement(value.clone_in_with_semantic_ids(ast.allocator()))
                    }
                    Some(JSXAttributeValue::Fragment(value)) => {
                        Expression::JSXFragment(value.clone_in_with_semantic_ids(ast.allocator()))
                    }
                };
                properties.push(ObjectPropertyKind::new_object_property(
                    attribute.span,
                    PropertyKind::Init,
                    PropertyKey::new_string_literal(name.span, name.name, None, ast),
                    value,
                    false,
                    false,
                    false,
                    ast,
                ));
            }
        }
    }
    if !element.children.is_empty() {
        properties.push(ObjectPropertyKind::new_object_property(
            span,
            PropertyKind::Init,
            PropertyKey::new_static_identifier(SPAN, "children", ast),
            children_expression(ast, &element.children)?,
            false,
            false,
            false,
            ast,
        ));
    }
    let input = Expression::new_object_expression(span, properties, ast);
    let name = element
        .opening_element
        .name
        .clone_in_with_semantic_ids(ast.allocator());
    let attributes = [
        JSXAttributeItem::new_spread_attribute(
            SPAN,
            call_name(ast, RENDERABLE_PROPS, [ident(ast, RENDERABLE_INPUT)]),
            ast,
        ),
        JSXAttributeItem::new_attribute(
            SPAN,
            JSXAttributeName::new_identifier(SPAN, "ref", ast),
            Some(JSXAttributeValue::new_expression_container(
                SPAN,
                call_name(ast, RENDERABLE_REF, [ident(ast, RENDERABLE_INPUT)]).into(),
                ast,
            )),
            ast,
        ),
    ];
    let child = JSXChild::new_expression_container(
        SPAN,
        call_name(ast, RENDERABLE_CHILDREN, [ident(ast, RENDERABLE_INPUT)]).into(),
        ast,
    );
    let opening =
        JSXOpeningElement::boxed(SPAN, name.clone_in(ast.allocator()), None, attributes, ast);
    let closing = JSXClosingElement::boxed(SPAN, name, ast);
    let constructor = Expression::new_jsx_element(SPAN, opening, [child], Some(closing), ast);
    Ok((input, constructor))
}

fn children_expression<'a>(
    ast: &AstBuilder<'a>,
    children: &[JSXChild<'a>],
) -> Result<Expression<'a>, Diagnostic> {
    let mut values = ArenaVec::new_in(ast);
    for child in children {
        let value = match child {
            JSXChild::Text(text) => {
                Expression::new_string_literal(text.span, text.value, None, ast)
            }
            JSXChild::ExpressionContainer(container) => container
                .expression
                .as_expression()
                .ok_or_else(|| {
                    unsupported_at(
                        "renderable child expression must have a value",
                        container.span,
                    )
                })?
                .clone_in_with_semantic_ids(ast.allocator()),
            JSXChild::Element(element) => {
                Expression::JSXElement(element.clone_in_with_semantic_ids(ast.allocator()))
            }
            JSXChild::Fragment(fragment) => {
                Expression::JSXFragment(fragment.clone_in_with_semantic_ids(ast.allocator()))
            }
            JSXChild::Spread(spread) => {
                return Err(unsupported_at(
                    "spread renderable children are unsupported",
                    spread.span,
                ));
            }
        };
        values.push(ArrayExpressionElement::from(value));
    }
    if values.len() == 1 {
        return Ok(values.pop().expect("one child").into_expression());
    }
    Ok(Expression::new_array_expression(SPAN, values, ast))
}

fn ident<'a>(ast: &AstBuilder<'a>, name: &str) -> Expression<'a> {
    Expression::new_identifier(SPAN, atom(ast, name), ast)
}

fn call_name<'a>(
    ast: &AstBuilder<'a>,
    name: &str,
    arguments: impl IntoIterator<Item = Expression<'a>>,
) -> Expression<'a> {
    Expression::new_call_expression(
        SPAN,
        ident(ast, name),
        None,
        ArenaVec::from_iter_in(arguments.into_iter().map(Argument::from), ast),
        false,
        ast,
    )
}

fn arrow_expression<'a>(
    ast: &AstBuilder<'a>,
    parameter: &'a str,
    body: Expression<'a>,
) -> Expression<'a> {
    let parameter = FormalParameter::new(
        SPAN,
        [],
        BindingPattern::new_binding_identifier(SPAN, atom(ast, parameter), ast),
        None,
        None,
        false,
        None,
        false,
        false,
        ast,
    );
    Expression::new_arrow_function_expression(
        SPAN,
        false,
        None,
        FormalParameters::boxed(
            SPAN,
            FormalParameterKind::ArrowFormalParameters,
            [parameter],
            None,
            ast,
        ),
        None,
        ArrowFunctionBody::from(body),
        ast,
    )
}

fn atom<'a>(ast: &AstBuilder<'a>, value: &str) -> &'a str {
    ast.allocator().alloc_str(value)
}

fn unsupported_at(message: &'static str, span: oxc_span::Span) -> Diagnostic {
    Diagnostic::new(DiagnosticCode::UnsupportedSyntax, message)
        .with_span(SourceSpan::new(span.start, span.end))
}

#[derive(Default)]
struct GeneratedReferenceFinder {
    names: BTreeSet<String>,
}

impl<'a> Visit<'a> for GeneratedReferenceFinder {
    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        if identifier.name.starts_with("__vidact") {
            self.names.insert(identifier.name.to_string());
        }
    }
}
