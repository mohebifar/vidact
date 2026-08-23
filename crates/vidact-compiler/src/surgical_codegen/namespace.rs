use oxc_ast::{ast::*, builder::AstBuilder};
use oxc_ast_visit::{VisitMut, walk_mut::walk_jsx_element};
use oxc_span::SPAN;

use crate::Diagnostic;

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
) -> Result<(), Diagnostic> {
    let mut transformer = NamespaceTransformer {
        ast,
        context: NamespaceContext::Inherit,
        diagnostic: None,
    };
    transformer.visit_function_body(body);
    transformer.diagnostic.map_or(Ok(()), Err)
}

struct NamespaceTransformer<'a, 'b> {
    ast: &'b AstBuilder<'a>,
    context: NamespaceContext,
    diagnostic: Option<Diagnostic>,
}

impl<'a> VisitMut<'a> for NamespaceTransformer<'a, '_> {
    fn visit_jsx_element(&mut self, element: &mut JSXElement<'a>) {
        if self.diagnostic.is_some() {
            return;
        }
        if element.opening_element.attributes.iter().any(|item| {
            matches!(item, JSXAttributeItem::Attribute(attribute) if attribute.is_identifier(NAMESPACE_PROP))
        }) {
            self.diagnostic = Some(super::unsupported(format!(
                "{NAMESPACE_PROP} is reserved for namespace-aware JSX lowering"
            )));
            return;
        }

        let tag = super::raw_html::intrinsic_jsx_name(&element.opening_element.name)
            .filter(|name| name.chars().next().is_some_and(char::is_lowercase));
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
