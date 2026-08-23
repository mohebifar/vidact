use oxc_ast::{ast::*, builder::AstBuilder};
use oxc_ast_visit::{VisitMut, walk_mut::walk_jsx_element};
use oxc_span::SPAN;

use crate::{Diagnostic, SourceSpan};

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
        inside_component_children: false,
        diagnostic: None,
    };
    transformer.visit_function_body(body);
    transformer.diagnostic.map_or(Ok(()), Err)
}

struct NamespaceTransformer<'a, 'b> {
    ast: &'b AstBuilder<'a>,
    context: NamespaceContext,
    inside_component_children: bool,
    diagnostic: Option<Diagnostic>,
}

impl<'a> VisitMut<'a> for NamespaceTransformer<'a, '_> {
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
        if self.inside_component_children && tag.is_some() {
            self.diagnostic = Some(
                super::unsupported(
                    "JSX intrinsic children passed to a component require deferred namespace-aware construction",
                )
                .with_span(SourceSpan::new(element.span.start, element.span.end)),
            );
            return;
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
        let previous_inside_component_children = self.inside_component_children;
        self.context = children_context;
        self.inside_component_children |= is_component && !element.children.is_empty();
        walk_jsx_element(self, element);
        self.context = previous;
        self.inside_component_children = previous_inside_component_children;
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
