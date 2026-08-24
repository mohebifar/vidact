use std::collections::BTreeSet;

use oxc_allocator::{CloneIn, GetAllocator};
use oxc_ast::{ast::*, builder::AstBuilder};
use oxc_ast_visit::{
    VisitMut,
    walk_mut::{walk_call_expression, walk_jsx_element},
};
use oxc_semantic::Scoping;
use oxc_span::{GetSpan, SPAN};
use oxc_syntax::symbol::SymbolId;

use crate::{Diagnostic, SourceSpan};

use super::ast::{arrow_expression, call_name};

const NAMESPACE_PROP: &str = "__vidactNamespace";

#[derive(Clone, Copy, PartialEq, Eq)]
enum NamespaceContext {
    Inherit,
    Html,
    Svg,
    MathMl,
}

pub(super) fn annotate<'a>(
    ast: &AstBuilder<'a>,
    body: &mut FunctionBody<'a>,
    scoping: &Scoping,
    renderable_child_symbols: &BTreeSet<SymbolId>,
) -> Result<(), Diagnostic> {
    let mut transformer = NamespaceTransformer {
        ast,
        scoping,
        renderable_child_symbols,
        context: NamespaceContext::Inherit,
        diagnostic: None,
    };
    transformer.visit_function_body(body);
    transformer.diagnostic.map_or(Ok(()), Err)
}

struct NamespaceTransformer<'a, 'b> {
    ast: &'b AstBuilder<'a>,
    scoping: &'b Scoping,
    renderable_child_symbols: &'b BTreeSet<SymbolId>,
    context: NamespaceContext,
    diagnostic: Option<Diagnostic>,
}

impl<'a> VisitMut<'a> for NamespaceTransformer<'a, '_> {
    fn visit_call_expression(&mut self, call: &mut CallExpression<'a>) {
        let deferred = call
            .callee
            .get_identifier_reference()
            .is_some_and(|identifier| {
                matches!(
                    identifier.name.as_str(),
                    super::DEFERRED | super::CREATE_RENDERABLE
                )
            });
        let previous = self.context;
        if deferred {
            self.context = NamespaceContext::Inherit;
        }
        walk_call_expression(self, call);
        self.context = previous;
    }

    fn visit_jsx_element(&mut self, element: &mut JSXElement<'a>) {
        if self.diagnostic.is_some() {
            return;
        }
        if let Some(attribute) = element.opening_element.attributes.iter().find_map(|item| {
            let JSXAttributeItem::Attribute(attribute) = item else {
                return None;
            };
            attribute.is_identifier(NAMESPACE_PROP).then_some(attribute)
        }) {
            self.diagnostic = Some(
                super::unsupported(format!(
                    "{NAMESPACE_PROP} is reserved for namespace-aware JSX lowering"
                ))
                .with_span(SourceSpan::new(attribute.span.start, attribute.span.end)),
            );
            return;
        }

        let tag = super::raw_html::intrinsic_jsx_name(&element.opening_element.name)
            .filter(|name| name.chars().next().is_some_and(char::is_lowercase));
        let is_component = tag.is_none();
        if is_component && !is_compiler_staged_boundary(element) {
            for child in &mut element.children {
                defer_child(self.ast, self.scoping, self.renderable_child_symbols, child);
            }
        }
        let element_context = element_context(self.context, tag);
        let children_context = child_context(element_context, tag);
        let has_spread = element
            .opening_element
            .attributes
            .iter()
            .any(|item| matches!(item, JSXAttributeItem::SpreadAttribute(_)));
        if let Some(namespace) = explicit_namespace(element_context, has_spread) {
            element
                .opening_element
                .attributes
                .push(JSXAttributeItem::new_attribute(
                    SPAN,
                    JSXAttributeName::new_identifier(SPAN, NAMESPACE_PROP, self.ast),
                    Some(JSXAttributeValue::new_string_literal(
                        SPAN, namespace, None, self.ast,
                    )),
                    self.ast,
                ));
        }

        let previous = self.context;
        self.context = children_context;
        walk_jsx_element(self, element);
        self.context = previous;
    }
}

fn is_compiler_staged_boundary(element: &JSXElement<'_>) -> bool {
    let has_mode = element.opening_element.attributes.iter().any(|item| {
        matches!(
            item,
            JSXAttributeItem::Attribute(attribute) if attribute.is_identifier("mode")
        )
    });
    let has_fallback_factory = element.opening_element.attributes.iter().any(|item| {
        let JSXAttributeItem::Attribute(attribute) = item else {
            return false;
        };
        attribute.is_identifier("fallback")
            && matches!(
                attribute.value.as_ref(),
                Some(JSXAttributeValue::ExpressionContainer(container))
                    if matches!(
                        container.expression.as_expression(),
                        Some(Expression::ArrowFunctionExpression(_))
                    )
            )
    });
    let has_profiler_contract = ["id", "onRender"].into_iter().all(|required| {
        element.opening_element.attributes.iter().any(|item| {
            matches!(
                item,
                JSXAttributeItem::Attribute(attribute) if attribute.is_identifier(required)
            )
        })
    });
    (has_fallback_factory || has_mode || has_profiler_contract)
        && matches!(
            element.children.as_slice(),
            [JSXChild::ExpressionContainer(container)]
                if matches!(
                    container.expression.as_expression(),
                    Some(Expression::ArrowFunctionExpression(_))
                )
        )
}

fn defer_child<'a>(
    ast: &AstBuilder<'a>,
    scoping: &Scoping,
    renderable_child_symbols: &BTreeSet<SymbolId>,
    child: &mut JSXChild<'a>,
) {
    let expression = match child {
        JSXChild::Element(element) => {
            Expression::JSXElement(element.clone_in_with_semantic_ids(ast.allocator()))
        }
        JSXChild::Fragment(fragment) => {
            Expression::JSXFragment(fragment.clone_in_with_semantic_ids(ast.allocator()))
        }
        JSXChild::ExpressionContainer(container) => {
            let Some(expression) = container.expression.as_expression() else {
                return;
            };
            expression.clone_in_with_semantic_ids(ast.allocator())
        }
        JSXChild::Spread(spread) => spread
            .expression
            .clone_in_with_semantic_ids(ast.allocator()),
        JSXChild::Text(_) => return,
    };
    if expression
        .get_identifier_reference()
        .and_then(|identifier| crate::react_bindings::reference_symbol(identifier, scoping))
        .is_some_and(|symbol| renderable_child_symbols.contains(&symbol))
    {
        return;
    }
    if matches!(
        expression.without_parentheses(),
        Expression::CallExpression(call)
            if call.callee.get_identifier_reference().is_some_and(|identifier| {
                matches!(identifier.name.as_str(), super::BINDING | super::CREATE_RENDERABLE)
            })
    ) {
        return;
    }
    *child = JSXChild::new_expression_container(
        child.span(),
        JSXExpression::from(call_name(
            ast,
            super::DEFERRED,
            [arrow_expression(ast, [], expression)],
        )),
        ast,
    );
}

fn element_context(parent: NamespaceContext, intrinsic: Option<&str>) -> NamespaceContext {
    let Some(tag) = intrinsic else {
        return parent;
    };
    match parent {
        NamespaceContext::Inherit => NamespaceContext::Inherit,
        NamespaceContext::Html if tag == "svg" => NamespaceContext::Svg,
        NamespaceContext::Html if tag == "math" => NamespaceContext::MathMl,
        context => context,
    }
}

fn child_context(element: NamespaceContext, intrinsic: Option<&str>) -> NamespaceContext {
    match (element, intrinsic) {
        (NamespaceContext::Inherit, Some("svg")) => NamespaceContext::Svg,
        (NamespaceContext::Inherit, Some("math")) => NamespaceContext::MathMl,
        (NamespaceContext::Svg | NamespaceContext::Inherit, Some("foreignObject")) => {
            NamespaceContext::Html
        }
        (context, _) => context,
    }
}

fn explicit_namespace(context: NamespaceContext, has_spread: bool) -> Option<&'static str> {
    match context {
        NamespaceContext::Inherit if has_spread => Some("inherit"),
        NamespaceContext::Inherit => None,
        NamespaceContext::Html => Some("html"),
        NamespaceContext::Svg => Some("svg"),
        NamespaceContext::MathMl => Some("mathml"),
    }
}
