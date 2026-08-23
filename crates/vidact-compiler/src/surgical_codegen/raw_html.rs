use oxc_ast::ast::*;

use crate::{Diagnostic, SourceSpan};

use super::unsupported;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RawHtmlProof {
    InvalidShape,
    PropNullish,
    PayloadNullish,
    PayloadNonNull,
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Nullability {
    Nullish,
    NonNull,
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ScriptTypeProof {
    Executable,
    NonExecutable,
    Unknown,
}

enum EffectiveAttribute<'a> {
    Absent,
    Known(&'a JSXAttribute<'a>),
    Unknown,
}

pub(super) fn validate(element: &JSXElement<'_>) -> Option<Diagnostic> {
    let tag = intrinsic_jsx_name(&element.opening_element.name)?;
    let EffectiveAttribute::Known(attribute) =
        effective_attribute(&element.opening_element, "dangerouslySetInnerHTML")
    else {
        return None;
    };
    let span = SourceSpan::new(attribute.span.start, attribute.span.end);
    let proof = raw_html_attribute_proof(attribute);
    if proof == RawHtmlProof::InvalidShape {
        return Some(
            unsupported("`props.dangerouslySetInnerHTML` must be in the form `{__html: ...}`")
                .with_span(span),
        );
    }
    if proof == RawHtmlProof::PropNullish {
        return None;
    }
    if proof != RawHtmlProof::Unknown && is_void_html_element(tag) {
        return Some(
            unsupported(format!(
                "{tag} is a void element tag and must neither have `children` nor use `dangerouslySetInnerHTML`"
            ))
            .with_span(span),
        );
    }
    if proof != RawHtmlProof::Unknown && tag == "textarea" {
        return Some(
            unsupported("`dangerouslySetInnerHTML` does not make sense on <textarea>")
                .with_span(span),
        );
    }
    if proof != RawHtmlProof::PayloadNonNull {
        return None;
    }
    if element.children.iter().any(jsx_child_is_non_null) {
        return Some(
            unsupported("Can only set one of `children` or `props.dangerouslySetInnerHTML`")
                .with_span(span),
        );
    }
    if tag == "script" && script_type_proof(&element.opening_element) == ScriptTypeProof::Executable
    {
        return Some(
            unsupported(
                "dangerouslySetInnerHTML on an executable <script> is unsupported by direct DOM construction",
            )
            .with_span(span),
        );
    }
    None
}

fn raw_html_attribute_proof(attribute: &JSXAttribute<'_>) -> RawHtmlProof {
    let Some(value) = &attribute.value else {
        return RawHtmlProof::InvalidShape;
    };
    let JSXAttributeValue::ExpressionContainer(container) = value else {
        return RawHtmlProof::InvalidShape;
    };
    let Some(expression) = container.expression.as_expression() else {
        return RawHtmlProof::InvalidShape;
    };
    raw_html_value_proof(expression)
}

fn raw_html_value_proof(expression: &Expression<'_>) -> RawHtmlProof {
    match expression.get_inner_expression() {
        Expression::NullLiteral(_) => RawHtmlProof::PropNullish,
        Expression::UnaryExpression(unary) if unary.operator.is_void() => RawHtmlProof::PropNullish,
        Expression::ObjectExpression(object) => raw_html_object_proof(object),
        Expression::BooleanLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::RegExpLiteral(_)
        | Expression::StringLiteral(_)
        | Expression::TemplateLiteral(_)
        | Expression::FunctionExpression(_)
        | Expression::ArrowFunctionExpression(_)
        | Expression::ClassExpression(_) => RawHtmlProof::InvalidShape,
        _ => RawHtmlProof::Unknown,
    }
}

fn raw_html_object_proof(object: &ObjectExpression<'_>) -> RawHtmlProof {
    let mut proof = RawHtmlProof::InvalidShape;
    for property in &object.properties {
        match property {
            ObjectPropertyKind::SpreadProperty(_) => proof = RawHtmlProof::Unknown,
            ObjectPropertyKind::ObjectProperty(property)
                if property.key.static_name().as_deref() == Some("__html") =>
            {
                proof = if property.kind == PropertyKind::Init {
                    match expression_nullability(&property.value) {
                        Nullability::Nullish => RawHtmlProof::PayloadNullish,
                        Nullability::NonNull => RawHtmlProof::PayloadNonNull,
                        Nullability::Unknown => RawHtmlProof::Unknown,
                    }
                } else {
                    RawHtmlProof::Unknown
                };
            }
            ObjectPropertyKind::ObjectProperty(property)
                if property.computed && property.key.static_name().is_none() =>
            {
                proof = RawHtmlProof::Unknown;
            }
            ObjectPropertyKind::ObjectProperty(_) => {}
        }
    }
    proof
}

fn expression_nullability(expression: &Expression<'_>) -> Nullability {
    match expression.get_inner_expression() {
        Expression::NullLiteral(_) => Nullability::Nullish,
        Expression::UnaryExpression(unary) if unary.operator.is_void() => Nullability::Nullish,
        Expression::Identifier(_)
        | Expression::ConditionalExpression(_)
        | Expression::LogicalExpression(_)
        | Expression::CallExpression(_)
        | Expression::ChainExpression(_)
        | Expression::StaticMemberExpression(_)
        | Expression::ComputedMemberExpression(_)
        | Expression::PrivateFieldExpression(_)
        | Expression::ThisExpression(_)
        | Expression::AwaitExpression(_)
        | Expression::AssignmentExpression(_)
        | Expression::SequenceExpression(_)
        | Expression::YieldExpression(_)
        | Expression::TaggedTemplateExpression(_) => Nullability::Unknown,
        _ => Nullability::NonNull,
    }
}

fn jsx_child_is_non_null(child: &JSXChild<'_>) -> bool {
    match child {
        JSXChild::Text(text) => text
            .value
            .chars()
            .any(|character| !character.is_whitespace()),
        JSXChild::ExpressionContainer(container) => container
            .expression
            .as_expression()
            .is_some_and(|expression| expression_nullability(expression) != Nullability::Nullish),
        JSXChild::Element(_) | JSXChild::Fragment(_) | JSXChild::Spread(_) => true,
    }
}

pub(super) fn intrinsic_jsx_name<'a>(name: &'a JSXElementName<'a>) -> Option<&'a str> {
    let JSXElementName::Identifier(identifier) = name else {
        return None;
    };
    Some(identifier.name.as_str())
}

fn is_void_html_element(tag: &str) -> bool {
    matches!(
        tag,
        "area"
            | "base"
            | "br"
            | "col"
            | "embed"
            | "hr"
            | "img"
            | "input"
            | "keygen"
            | "link"
            | "menuitem"
            | "meta"
            | "param"
            | "source"
            | "track"
            | "wbr"
    )
}

fn effective_attribute<'a>(
    opening: &'a JSXOpeningElement<'a>,
    target: &str,
) -> EffectiveAttribute<'a> {
    let mut effective = EffectiveAttribute::Absent;
    for item in &opening.attributes {
        match item {
            JSXAttributeItem::Attribute(attribute) if matches!(&attribute.name, JSXAttributeName::Identifier(name) if name.name == target) =>
            {
                effective = EffectiveAttribute::Known(attribute);
            }
            JSXAttributeItem::SpreadAttribute(_) => effective = EffectiveAttribute::Unknown,
            JSXAttributeItem::Attribute(_) => {}
        }
    }
    effective
}

fn script_type_proof(opening: &JSXOpeningElement<'_>) -> ScriptTypeProof {
    let attribute = match effective_attribute(opening, "type") {
        EffectiveAttribute::Absent => return ScriptTypeProof::Executable,
        EffectiveAttribute::Known(attribute) => attribute,
        EffectiveAttribute::Unknown => return ScriptTypeProof::Unknown,
    };
    let Some(value) = &attribute.value else {
        return ScriptTypeProof::Executable;
    };
    let value = match value {
        JSXAttributeValue::StringLiteral(value) => Some(value.value.as_str()),
        JSXAttributeValue::ExpressionContainer(container) => {
            match container
                .expression
                .as_expression()
                .map(Expression::get_inner_expression)
            {
                Some(Expression::StringLiteral(value)) => Some(value.value.as_str()),
                Some(Expression::NullLiteral(_)) => Some(""),
                _ => None,
            }
        }
        JSXAttributeValue::Element(_) | JSXAttributeValue::Fragment(_) => None,
    };
    value.map_or(ScriptTypeProof::Unknown, |value| {
        if is_executable_script_type(value) {
            ScriptTypeProof::Executable
        } else {
            ScriptTypeProof::NonExecutable
        }
    })
}

fn is_executable_script_type(value: &str) -> bool {
    let essence = value
        .split_once(';')
        .map_or(value, |(essence, _)| essence)
        .trim()
        .to_ascii_lowercase();
    if matches!(
        essence.as_str(),
        "" | "module" | "importmap" | "speculationrules"
    ) {
        return true;
    }
    matches!(essence.as_str(), "text/jscript" | "text/livescript")
        || essence
            .strip_prefix("application/")
            .or_else(|| essence.strip_prefix("text/"))
            .is_some_and(|subtype| {
                let subtype = subtype.strip_prefix("x-").unwrap_or(subtype);
                matches!(
                    subtype,
                    "javascript"
                        | "ecmascript"
                        | "javascript1.0"
                        | "javascript1.1"
                        | "javascript1.2"
                        | "javascript1.3"
                        | "javascript1.4"
                        | "javascript1.5"
                        | "ecmascript1.0"
                        | "ecmascript1.1"
                        | "ecmascript1.2"
                        | "ecmascript1.3"
                        | "ecmascript1.4"
                        | "ecmascript1.5"
                )
            })
}
