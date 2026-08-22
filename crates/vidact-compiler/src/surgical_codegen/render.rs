use std::collections::{BTreeMap, BTreeSet};

use oxc_allocator::{Allocator, CloneIn, GetAllocator};
use oxc_ast::{ast::*, builder::AstBuilder};
use oxc_ast_visit::{Visit, walk::walk_expression};
use oxc_semantic::Scoping;
use oxc_span::{GetSpan, SPAN};
use oxc_syntax::{operator::BinaryOperator, symbol::SymbolId};

use crate::{
    Diagnostic,
    analysis::{SourceId, SourceKind},
    ir::ComponentIr,
    render_flow::{RenderDecisionKind, RenderFlowNodeId, RenderFlowNodeKind},
};

use super::{
    BINDING, CHOOSE, DISPATCH, ITEM_SCOPE, SCOPE, arrow_expression, call_name, dependencies,
    dependency_mask, ident,
};

pub(super) fn lower_component_render<'a>(
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
    scoping: &Scoping,
    ir: &ComponentIr,
    body: &FunctionBody<'a>,
    source_symbols: &BTreeMap<SymbolId, SourceId>,
    item_source_symbols: &BTreeMap<SymbolId, SourceId>,
) -> Result<Expression<'a>, Diagnostic> {
    let entry = ir
        .render_flow
        .entry
        .ok_or_else(|| super::unsupported("compiled component has no normalized render entry"))?;
    let mut expressions = ExpressionCollector {
        allocator,
        expressions: BTreeMap::new(),
    };
    expressions.visit_function_body(body);
    RenderLowerer {
        ast,
        scoping,
        ir,
        expressions: expressions.expressions,
        source_symbols,
        item_source_symbols,
    }
    .lower_node(entry)
}

struct ExpressionCollector<'a> {
    allocator: &'a Allocator,
    expressions: BTreeMap<(u32, u32), Expression<'a>>,
}

impl<'old, 'a> Visit<'old> for ExpressionCollector<'a> {
    fn visit_expression(&mut self, expression: &Expression<'old>) {
        let span = expression.span();
        self.expressions
            .entry((span.start, span.end))
            .or_insert_with(|| expression.clone_in_with_semantic_ids(self.allocator));
        walk_expression(self, expression);
    }
}

struct RenderLowerer<'a, 's> {
    ast: &'s AstBuilder<'a>,
    scoping: &'s Scoping,
    ir: &'s ComponentIr,
    expressions: BTreeMap<(u32, u32), Expression<'a>>,
    source_symbols: &'s BTreeMap<SymbolId, SourceId>,
    item_source_symbols: &'s BTreeMap<SymbolId, SourceId>,
}

impl<'a> RenderLowerer<'a, '_> {
    fn lower_node(&self, id: RenderFlowNodeId) -> Result<Expression<'a>, Diagnostic> {
        let node = self
            .ir
            .render_flow
            .nodes
            .get(id.get())
            .ok_or_else(|| super::analysis_error("render flow references an unknown node"))?;
        match &node.kind {
            RenderFlowNodeKind::Value { expression, .. } => expression.map_or_else(
                || Ok(Expression::new_null_literal(SPAN, self.ast)),
                |span| {
                    let expression = self.expression(span.start, span.end)?;
                    self.lower_value(expression)
                },
            ),
            RenderFlowNodeKind::Decision {
                kind,
                test,
                consequent,
                alternate,
            } => {
                let test = self.expression(test.start, test.end)?;
                let consequent = self.lower_node(*consequent)?;
                let alternate = self.lower_node(*alternate)?;
                self.lower_decision(*kind, test, consequent, alternate)
            }
            RenderFlowNodeKind::Switch {
                discriminant,
                cases,
                fallback,
            } => {
                let discriminant = self.expression(discriminant.start, discriminant.end)?;
                let mut current = self.lower_node(*fallback)?;
                for case in cases.iter().rev() {
                    let Some(test_span) = case.test else {
                        continue;
                    };
                    let test = self.expression(test_span.start, test_span.end)?;
                    if !matches!(
                        test.without_parentheses(),
                        Expression::StringLiteral(_)
                            | Expression::NumericLiteral(_)
                            | Expression::BigIntLiteral(_)
                            | Expression::BooleanLiteral(_)
                            | Expression::NullLiteral(_)
                    ) {
                        return Err(super::unsupported(
                            "terminal render switch cases currently require literal tests",
                        ));
                    }
                    let equality = Expression::new_binary_expression(
                        SPAN,
                        discriminant.clone_in_with_semantic_ids(self.ast.allocator()),
                        BinaryOperator::StrictEquality,
                        test,
                        self.ast,
                    );
                    let consequent = self.lower_node(case.target)?;
                    current =
                        self.lower_decision(RenderDecisionKind::If, equality, consequent, current)?;
                }
                Ok(current)
            }
        }
    }

    fn lower_decision(
        &self,
        kind: RenderDecisionKind,
        test: Expression<'a>,
        consequent: Expression<'a>,
        alternate: Expression<'a>,
    ) -> Result<Expression<'a>, Diagnostic> {
        if let Some(aligned) = self.merge_aligned(
            &test,
            consequent.clone_in_with_semantic_ids(self.ast.allocator()),
            alternate.clone_in_with_semantic_ids(self.ast.allocator()),
        )? {
            return Ok(aligned);
        }
        let reads = dependencies(
            &test,
            self.scoping,
            self.source_symbols,
            self.item_source_symbols,
        );
        if !reads.item.is_empty() {
            return Err(super::unsupported(
                "render decisions inside keyed item regions are not implemented",
            ));
        }
        let mode = match kind {
            RenderDecisionKind::NullishCoalescing => "not-nullish",
            RenderDecisionKind::If
            | RenderDecisionKind::Ternary
            | RenderDecisionKind::LogicalAnd
            | RenderDecisionKind::LogicalOr => "truthy",
        };
        Ok(call_name(
            self.ast,
            CHOOSE,
            [
                ident(self.ast, SCOPE),
                dependency_mask(self.ast, &reads.parent),
                Expression::new_string_literal(SPAN, mode, None, self.ast),
                arrow_expression(self.ast, [], test),
                arrow_expression(self.ast, [], consequent),
                arrow_expression(self.ast, [], alternate),
            ],
        ))
    }

    fn lower_value(&self, expression: Expression<'a>) -> Result<Expression<'a>, Diagnostic> {
        match expression {
            Expression::JSXElement(element) => self.dispatch_dynamic_identity(element),
            Expression::JSXFragment(fragment) => Ok(Expression::JSXFragment(fragment)),
            expression => self.bind_dynamic_value(expression),
        }
    }

    fn bind_dynamic_value(&self, expression: Expression<'a>) -> Result<Expression<'a>, Diagnostic> {
        let reads = dependencies(
            &expression,
            self.scoping,
            self.source_symbols,
            self.item_source_symbols,
        );
        if reads.parent.is_empty() && reads.item.is_empty() {
            return Ok(expression);
        }
        let mut arguments = vec![
            ident(self.ast, SCOPE),
            dependency_mask(self.ast, &reads.parent),
            arrow_expression(self.ast, [], expression),
        ];
        if !reads.item.is_empty() {
            arguments.push(ident(self.ast, super::ITEM_SCOPE));
            arguments.push(dependency_mask(self.ast, &reads.item));
        }
        Ok(call_name(self.ast, BINDING, arguments))
    }

    fn dispatch_dynamic_identity(
        &self,
        element: oxc_allocator::Box<'a, JSXElement<'a>>,
    ) -> Result<Expression<'a>, Diagnostic> {
        let type_identity = self.type_identity(&element.opening_element.name)?;
        let key = element.opening_element.attributes.iter().find(|item| {
            let JSXAttributeItem::Attribute(attribute) = item else {
                return false;
            };
            matches!(&attribute.name, JSXAttributeName::Identifier(name) if name.name == "key")
        });
        let key_identity = self.attribute_expression(key)?;
        let mut reads = dependencies(
            &type_identity,
            self.scoping,
            self.source_symbols,
            self.item_source_symbols,
        );
        let key_reads = dependencies(
            &key_identity,
            self.scoping,
            self.source_symbols,
            self.item_source_symbols,
        );
        reads.parent.extend(key_reads.parent);
        reads.item.extend(key_reads.item);
        if reads.parent.is_empty() && reads.item.is_empty() {
            return Ok(Expression::JSXElement(element));
        }
        let mut arguments = vec![
            ident(self.ast, SCOPE),
            dependency_mask(self.ast, &reads.parent),
            arrow_expression(self.ast, [], type_identity),
            arrow_expression(self.ast, [], key_identity),
            arrow_expression(self.ast, [], Expression::JSXElement(element)),
        ];
        if !reads.item.is_empty() {
            arguments.push(ident(self.ast, ITEM_SCOPE));
            arguments.push(dependency_mask(self.ast, &reads.item));
        }
        Ok(call_name(self.ast, DISPATCH, arguments))
    }

    fn type_identity(&self, name: &JSXElementName<'a>) -> Result<Expression<'a>, Diagnostic> {
        let JSXElementName::IdentifierReference(identifier) = name else {
            let name = jsx_name(name).unwrap_or_else(|| "<unknown>".to_string());
            return Ok(Expression::new_string_literal(
                SPAN,
                self.ast.allocator().alloc_str(&name),
                None,
                self.ast,
            ));
        };
        let Some(reference) = identifier.reference_id.get() else {
            return Ok(Expression::new_string_literal(
                SPAN,
                identifier.name.as_str(),
                None,
                self.ast,
            ));
        };
        let Some(symbol) = self.scoping.get_reference(reference).symbol_id() else {
            return Ok(Expression::new_string_literal(
                SPAN,
                identifier.name.as_str(),
                None,
                self.ast,
            ));
        };
        let Some(source_id) = self.source_symbols.get(&symbol) else {
            return Ok(Expression::new_string_literal(
                SPAN,
                identifier.name.as_str(),
                None,
                self.ast,
            ));
        };
        let source = self
            .ir
            .sources
            .iter()
            .find(|source| source.id == *source_id)
            .ok_or_else(|| super::analysis_error("component type references an unknown source"))?;
        match source.kind {
            SourceKind::Derived => Ok(Expression::Identifier(
                identifier.clone_in_with_semantic_ids(self.ast.allocator()),
            )),
            SourceKind::Prop | SourceKind::State => Err(super::unsupported(
                "state- or prop-valued component types require callable slot lowering",
            )),
            SourceKind::Context | SourceKind::External => Err(super::unsupported(
                "context- or external-valued component types require an explicit reactive source",
            )),
        }
    }

    fn expression(&self, start: u32, end: u32) -> Result<Expression<'a>, Diagnostic> {
        self.expressions
            .get(&(start, end))
            .map(|expression| expression.clone_in_with_semantic_ids(self.ast.allocator()))
            .ok_or_else(|| {
                super::analysis_error(format!(
                    "render flow span {start}..{end} has no matching Oxc expression"
                ))
            })
    }

    fn merge_aligned(
        &self,
        test: &Expression<'a>,
        consequent: Expression<'a>,
        alternate: Expression<'a>,
    ) -> Result<Option<Expression<'a>>, Diagnostic> {
        let (Expression::JSXElement(mut consequent), Expression::JSXElement(alternate)) =
            (consequent, alternate)
        else {
            return Ok(None);
        };
        if jsx_name(&consequent.opening_element.name) != jsx_name(&alternate.opening_element.name)
            || !aligned_key(&consequent.opening_element, &alternate.opening_element)
        {
            return Ok(None);
        }
        self.merge_attributes(
            test,
            &mut consequent.opening_element,
            &alternate.opening_element,
        )?;
        if consequent.children.len() != alternate.children.len() {
            return Ok(None);
        }
        for (consequent, alternate) in consequent.children.iter_mut().zip(&alternate.children) {
            self.merge_child(test, consequent, alternate)?;
        }
        Ok(Some(Expression::JSXElement(consequent)))
    }

    fn merge_attributes(
        &self,
        test: &Expression<'a>,
        consequent: &mut JSXOpeningElement<'a>,
        alternate: &JSXOpeningElement<'a>,
    ) -> Result<(), Diagnostic> {
        let mut consequent_indexes = simple_attribute_indexes(consequent)?;
        let alternate_indexes = simple_attribute_indexes(alternate)?;
        let names = consequent_indexes
            .keys()
            .chain(alternate_indexes.keys())
            .cloned()
            .collect::<BTreeSet<_>>();
        for name in names {
            if name == "key" {
                continue;
            }
            if name == "ref" {
                return Err(super::unsupported(
                    "branch-varying ref identity is unsupported",
                ));
            }
            let left = consequent_indexes
                .get(&name)
                .map(|index| &consequent.attributes[*index]);
            let right = alternate_indexes
                .get(&name)
                .map(|index| &alternate.attributes[*index]);
            let left_value = self.attribute_expression(left)?;
            let right_value = self.attribute_expression(right)?;
            let conditional = Expression::new_conditional_expression(
                SPAN,
                test.clone_in_with_semantic_ids(self.ast.allocator()),
                left_value,
                right_value,
                self.ast,
            );
            let value = JSXAttributeValue::new_expression_container(
                SPAN,
                JSXExpression::from(conditional),
                self.ast,
            );
            if let Some(index) = consequent_indexes.get(&name).copied() {
                let JSXAttributeItem::Attribute(attribute) = &mut consequent.attributes[index]
                else {
                    unreachable!("simple attribute map contains only attributes")
                };
                attribute.value = Some(value);
            } else {
                let index = consequent.attributes.len();
                let Some(alternate_index) = alternate_indexes.get(&name).copied() else {
                    unreachable!("attribute name came from one of the alternatives")
                };
                let JSXAttributeItem::Attribute(attribute) = &alternate.attributes[alternate_index]
                else {
                    unreachable!("simple attribute map contains only attributes")
                };
                let mut attribute = attribute.clone_in_with_semantic_ids(self.ast.allocator());
                attribute.value = Some(value);
                consequent
                    .attributes
                    .push(JSXAttributeItem::Attribute(attribute));
                consequent_indexes.insert(name, index);
            }
        }
        Ok(())
    }

    fn attribute_expression(
        &self,
        item: Option<&JSXAttributeItem<'a>>,
    ) -> Result<Expression<'a>, Diagnostic> {
        let Some(JSXAttributeItem::Attribute(attribute)) = item else {
            return Ok(ident(self.ast, "undefined"));
        };
        match &attribute.value {
            None => Ok(Expression::new_boolean_literal(SPAN, true, self.ast)),
            Some(JSXAttributeValue::StringLiteral(value)) => Ok(Expression::StringLiteral(
                value.clone_in_with_semantic_ids(self.ast.allocator()),
            )),
            Some(JSXAttributeValue::ExpressionContainer(container)) => container
                .expression
                .as_expression()
                .map(|expression| expression.clone_in_with_semantic_ids(self.ast.allocator()))
                .ok_or_else(|| {
                    super::unsupported("empty JSX attribute expressions are unsupported")
                }),
            Some(JSXAttributeValue::Element(element)) => Ok(Expression::JSXElement(
                element.clone_in_with_semantic_ids(self.ast.allocator()),
            )),
            Some(JSXAttributeValue::Fragment(fragment)) => Ok(Expression::JSXFragment(
                fragment.clone_in_with_semantic_ids(self.ast.allocator()),
            )),
        }
    }

    fn merge_child(
        &self,
        test: &Expression<'a>,
        consequent: &mut JSXChild<'a>,
        alternate: &JSXChild<'a>,
    ) -> Result<(), Diagnostic> {
        match (consequent, alternate) {
            (JSXChild::Element(consequent), JSXChild::Element(alternate))
                if jsx_name(&consequent.opening_element.name)
                    == jsx_name(&alternate.opening_element.name)
                    && aligned_key(&consequent.opening_element, &alternate.opening_element) =>
            {
                self.merge_attributes(
                    test,
                    &mut consequent.opening_element,
                    &alternate.opening_element,
                )?;
                if consequent.children.len() != alternate.children.len() {
                    return Err(super::unsupported(
                        "aligned JSX children currently require equal child positions",
                    ));
                }
                for (consequent, alternate) in
                    consequent.children.iter_mut().zip(&alternate.children)
                {
                    self.merge_child(test, consequent, alternate)?;
                }
                Ok(())
            }
            (JSXChild::Text(left), JSXChild::Text(right)) if left.value == right.value => Ok(()),
            (consequent, alternate) => {
                let left = self.child_expression(consequent)?;
                let right = self.child_expression(alternate)?;
                let conditional = Expression::new_conditional_expression(
                    SPAN,
                    test.clone_in_with_semantic_ids(self.ast.allocator()),
                    left,
                    right,
                    self.ast,
                );
                *consequent = JSXChild::new_expression_container(
                    SPAN,
                    JSXExpression::from(conditional),
                    self.ast,
                );
                Ok(())
            }
        }
    }

    fn child_expression(&self, child: &JSXChild<'a>) -> Result<Expression<'a>, Diagnostic> {
        match child {
            JSXChild::Element(element) => Ok(Expression::JSXElement(
                element.clone_in_with_semantic_ids(self.ast.allocator()),
            )),
            JSXChild::Fragment(fragment) => Ok(Expression::JSXFragment(
                fragment.clone_in_with_semantic_ids(self.ast.allocator()),
            )),
            JSXChild::Text(text) => Ok(Expression::new_string_literal(
                SPAN,
                text.value.as_str(),
                None,
                self.ast,
            )),
            JSXChild::ExpressionContainer(container) => container
                .expression
                .as_expression()
                .map(|expression| expression.clone_in_with_semantic_ids(self.ast.allocator()))
                .ok_or_else(|| super::unsupported("empty JSX child expressions are unsupported")),
            JSXChild::Spread(_) => Err(super::unsupported(
                "spread JSX children are unsupported in aligned render alternatives",
            )),
        }
    }
}

fn simple_attribute_indexes(
    element: &JSXOpeningElement<'_>,
) -> Result<BTreeMap<String, usize>, Diagnostic> {
    let mut indexes = BTreeMap::new();
    for (index, item) in element.attributes.iter().enumerate() {
        let JSXAttributeItem::Attribute(attribute) = item else {
            return Err(super::unsupported(
                "JSX spreads cannot be aligned across render alternatives",
            ));
        };
        let JSXAttributeName::Identifier(name) = &attribute.name else {
            return Err(super::unsupported(
                "namespaced JSX attributes cannot be aligned",
            ));
        };
        indexes.insert(name.name.to_string(), index);
    }
    Ok(indexes)
}

fn jsx_name(name: &JSXElementName<'_>) -> Option<String> {
    match name {
        JSXElementName::Identifier(identifier) => Some(identifier.name.to_string()),
        JSXElementName::IdentifierReference(identifier) => Some(identifier.name.to_string()),
        JSXElementName::MemberExpression(member) => Some(format!("{member:?}")),
        JSXElementName::NamespacedName(name) => {
            Some(format!("{}:{}", name.namespace.name, name.name.name))
        }
        JSXElementName::ThisExpression(_) => Some("this".to_string()),
    }
}

#[derive(PartialEq)]
enum StaticKey {
    Absent,
    Value(String),
    Dynamic,
}

fn static_key(element: &JSXOpeningElement<'_>) -> StaticKey {
    element
        .attributes
        .iter()
        .find_map(|item| {
            let JSXAttributeItem::Attribute(attribute) = item else {
                return None;
            };
            let JSXAttributeName::Identifier(name) = &attribute.name else {
                return None;
            };
            if name.name != "key" {
                return None;
            }
            Some(match &attribute.value {
                Some(JSXAttributeValue::StringLiteral(value)) => {
                    StaticKey::Value(value.value.to_string())
                }
                Some(JSXAttributeValue::ExpressionContainer(container)) => container
                    .expression
                    .as_expression()
                    .map_or(StaticKey::Dynamic, |expression| {
                        match expression.without_parentheses() {
                            Expression::StringLiteral(value) => {
                                StaticKey::Value(value.value.to_string())
                            }
                            Expression::NumericLiteral(value) => {
                                StaticKey::Value(value.value.to_string())
                            }
                            Expression::BigIntLiteral(value) => {
                                StaticKey::Value(value.value.to_string())
                            }
                            _ => StaticKey::Dynamic,
                        }
                    }),
                _ => StaticKey::Dynamic,
            })
        })
        .unwrap_or(StaticKey::Absent)
}

fn aligned_key(left: &JSXOpeningElement<'_>, right: &JSXOpeningElement<'_>) -> bool {
    match (static_key(left), static_key(right)) {
        (StaticKey::Absent, StaticKey::Absent) => true,
        (StaticKey::Value(left), StaticKey::Value(right)) => left == right,
        (StaticKey::Dynamic, _)
        | (_, StaticKey::Dynamic)
        | (StaticKey::Absent, StaticKey::Value(_))
        | (StaticKey::Value(_), StaticKey::Absent) => false,
    }
}
