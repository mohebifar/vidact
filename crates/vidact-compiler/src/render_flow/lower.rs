use oxc_ast::ast::*;
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::LogicalOperator;

use crate::{
    SourceSpan,
    analysis::{ControlFlowFacts, ControlFlowReturnVariant, ControlFlowTerminalKind},
    render_flow::{
        RenderDecisionKind, RenderFlowGraph, RenderFlowNode, RenderFlowNodeId, RenderFlowNodeKind,
        RenderIdentity, RenderIdentityKey, RenderIdentityKind, RenderSwitchCase,
    },
};

pub(crate) fn lower_render_flow(
    body: &FunctionBody<'_>,
    control_flow: &ControlFlowFacts,
) -> Result<RenderFlowGraph, String> {
    let ast_returns = component_return_spans(body);
    if ast_returns.is_empty() {
        return Err("compiled component has no render return".to_string());
    }
    let mut cfg_returns = control_flow
        .blocks
        .iter()
        .filter_map(|block| {
            (block.terminal.kind
                == ControlFlowTerminalKind::Return(ControlFlowReturnVariant::Explicit))
            .then_some(block.terminal.span)
            .flatten()
        })
        .collect::<Vec<_>>();
    cfg_returns.sort_by_key(|span| (span.start, span.end));
    let mut ast_returns = ast_returns
        .into_iter()
        .map(SourceSpan::from_oxc)
        .collect::<Vec<_>>();
    ast_returns.sort_by_key(|span| (span.start, span.end));
    if ast_returns != cfg_returns {
        return Err(
            "React Compiler render returns do not match the component AST return sites".to_string(),
        );
    }

    let mut builder = Builder { nodes: vec![] };
    let empty = builder.push(RenderFlowNodeKind::Value {
        expression: None,
        identity: RenderIdentity::leaf(RenderIdentityKind::Empty),
    });
    let entry = builder.lower_statements(&body.statements, empty)?;
    Ok(prune_unreachable(RenderFlowGraph {
        entry: Some(entry),
        nodes: builder.nodes,
    }))
}

struct Builder {
    nodes: Vec<RenderFlowNode>,
}

impl Builder {
    fn push(&mut self, kind: RenderFlowNodeKind) -> RenderFlowNodeId {
        let id = RenderFlowNodeId::new(self.nodes.len());
        self.nodes.push(RenderFlowNode { id, kind });
        id
    }

    fn lower_statements(
        &mut self,
        statements: &[Statement<'_>],
        continuation: RenderFlowNodeId,
    ) -> Result<RenderFlowNodeId, String> {
        let mut current = continuation;
        for statement in statements.iter().rev() {
            current = self.lower_statement(statement, current)?;
        }
        Ok(current)
    }

    fn lower_statement(
        &mut self,
        statement: &Statement<'_>,
        continuation: RenderFlowNodeId,
    ) -> Result<RenderFlowNodeId, String> {
        let contains_return = contains_component_return(statement);
        match statement {
            Statement::ReturnStatement(statement) => match &statement.argument {
                Some(expression) => self.lower_expression(expression),
                None => Ok(self.push(RenderFlowNodeKind::Value {
                    expression: None,
                    identity: RenderIdentity::leaf(RenderIdentityKind::Empty),
                })),
            },
            Statement::BlockStatement(block) => {
                self.lower_statements(&block.body, continuation)
            }
            Statement::IfStatement(statement) if contains_return => {
                let consequent = self.lower_statement(&statement.consequent, continuation)?;
                let alternate = statement.alternate.as_ref().map_or(Ok(continuation), |alternate| {
                    self.lower_statement(alternate, continuation)
                })?;
                Ok(self.push(RenderFlowNodeKind::Decision {
                    kind: RenderDecisionKind::If,
                    test: SourceSpan::from_oxc(statement.test.span()),
                    consequent,
                    alternate,
                }))
            }
            Statement::SwitchStatement(statement) if contains_return => {
                self.lower_switch(statement, continuation)
            }
            Statement::ForStatement(_)
            | Statement::ForInStatement(_)
            | Statement::ForOfStatement(_)
            | Statement::WhileStatement(_)
            | Statement::DoWhileStatement(_)
            | Statement::TryStatement(_)
            | Statement::LabeledStatement(_)
                if contains_component_return(statement) => Err(
                    "render returns inside loops, labels, or exception regions are deferred to synchronous-region lowering"
                        .to_string(),
                ),
            _ => Ok(continuation),
        }
    }

    fn lower_switch(
        &mut self,
        statement: &SwitchStatement<'_>,
        continuation: RenderFlowNodeId,
    ) -> Result<RenderFlowNodeId, String> {
        let mut cases = Vec::with_capacity(statement.cases.len());
        let mut fallback = continuation;
        for case in &statement.cases {
            if !matches!(case.consequent.last(), Some(Statement::ReturnStatement(_))) {
                return Err(
                    "render-selecting switch cases must terminate with a direct return until fallthrough lowering lands"
                        .to_string(),
                );
            }
            let target = self.lower_statements(&case.consequent, continuation)?;
            let test = case
                .test
                .as_ref()
                .map(|test| SourceSpan::from_oxc(test.span()));
            if test.is_none() {
                fallback = target;
            }
            cases.push(RenderSwitchCase { test, target });
        }
        Ok(self.push(RenderFlowNodeKind::Switch {
            discriminant: SourceSpan::from_oxc(statement.discriminant.span()),
            cases,
            fallback,
        }))
    }

    fn lower_expression(
        &mut self,
        expression: &Expression<'_>,
    ) -> Result<RenderFlowNodeId, String> {
        match expression.without_parentheses() {
            Expression::ConditionalExpression(expression) => {
                let consequent = self.lower_expression(&expression.consequent)?;
                let alternate = self.lower_expression(&expression.alternate)?;
                Ok(self.push(RenderFlowNodeKind::Decision {
                    kind: RenderDecisionKind::Ternary,
                    test: SourceSpan::from_oxc(expression.test.span()),
                    consequent,
                    alternate,
                }))
            }
            Expression::LogicalExpression(expression) => {
                let left = self.value(&expression.left);
                let right = self.lower_expression(&expression.right)?;
                let (kind, consequent, alternate) = match expression.operator {
                    LogicalOperator::And => (RenderDecisionKind::LogicalAnd, right, left),
                    LogicalOperator::Or => (RenderDecisionKind::LogicalOr, left, right),
                    LogicalOperator::Coalesce => {
                        (RenderDecisionKind::NullishCoalescing, left, right)
                    }
                };
                Ok(self.push(RenderFlowNodeKind::Decision {
                    kind,
                    test: SourceSpan::from_oxc(expression.left.span()),
                    consequent,
                    alternate,
                }))
            }
            expression => Ok(self.value(expression)),
        }
    }

    fn value(&mut self, expression: &Expression<'_>) -> RenderFlowNodeId {
        self.push(RenderFlowNodeKind::Value {
            expression: Some(SourceSpan::from_oxc(expression.span())),
            identity: render_identity(expression),
        })
    }
}

fn render_identity(expression: &Expression<'_>) -> RenderIdentity {
    match expression.without_parentheses() {
        Expression::JSXElement(element) => jsx_element_identity(element),
        Expression::JSXFragment(fragment) => RenderIdentity {
            kind: RenderIdentityKind::Fragment,
            key: RenderIdentityKey::Absent,
            children: fragment
                .children
                .iter()
                .filter_map(jsx_child_identity)
                .collect(),
        },
        Expression::ArrayExpression(array) => RenderIdentity {
            kind: RenderIdentityKind::Array,
            key: RenderIdentityKey::Absent,
            children: array
                .elements
                .iter()
                .map(|element| match element {
                    ArrayExpressionElement::SpreadElement(_) => {
                        RenderIdentity::leaf(RenderIdentityKind::Dynamic)
                    }
                    ArrayExpressionElement::Elision(_) => {
                        RenderIdentity::leaf(RenderIdentityKind::Empty)
                    }
                    element => element.as_expression().map_or_else(
                        || RenderIdentity::leaf(RenderIdentityKind::Dynamic),
                        render_identity,
                    ),
                })
                .collect(),
        },
        Expression::NullLiteral(_) | Expression::BooleanLiteral(_) => {
            RenderIdentity::leaf(RenderIdentityKind::Empty)
        }
        Expression::StringLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::TemplateLiteral(_) => RenderIdentity::leaf(RenderIdentityKind::Scalar),
        _ => RenderIdentity::leaf(RenderIdentityKind::Dynamic),
    }
}

fn jsx_element_identity(element: &JSXElement<'_>) -> RenderIdentity {
    let name = jsx_element_name(&element.opening_element.name);
    let kind = name.as_ref().map_or(RenderIdentityKind::Dynamic, |name| {
        if name.chars().next().is_some_and(char::is_lowercase) {
            RenderIdentityKind::Host(name.clone())
        } else {
            RenderIdentityKind::Component(name.clone())
        }
    });
    RenderIdentity {
        kind,
        key: jsx_key(&element.opening_element),
        children: element
            .children
            .iter()
            .filter_map(jsx_child_identity)
            .collect(),
    }
}

fn jsx_child_identity(child: &JSXChild<'_>) -> Option<RenderIdentity> {
    match child {
        JSXChild::Element(element) => Some(jsx_element_identity(element)),
        JSXChild::Fragment(fragment) => Some(RenderIdentity {
            kind: RenderIdentityKind::Fragment,
            key: RenderIdentityKey::Absent,
            children: fragment
                .children
                .iter()
                .filter_map(jsx_child_identity)
                .collect(),
        }),
        JSXChild::Text(text) if text.value.trim().is_empty() => None,
        JSXChild::Text(_) => Some(RenderIdentity::leaf(RenderIdentityKind::Scalar)),
        JSXChild::ExpressionContainer(container) => {
            container.expression.as_expression().map(render_identity)
        }
        JSXChild::Spread(_) => Some(RenderIdentity::leaf(RenderIdentityKind::Dynamic)),
    }
}

fn jsx_element_name(name: &JSXElementName<'_>) -> Option<String> {
    match name {
        JSXElementName::Identifier(identifier) => Some(identifier.name.to_string()),
        JSXElementName::IdentifierReference(identifier) => Some(identifier.name.to_string()),
        JSXElementName::NamespacedName(name) => {
            Some(format!("{}:{}", name.namespace.name, name.name.name))
        }
        JSXElementName::MemberExpression(expression) => Some(jsx_member_name(expression)),
        JSXElementName::ThisExpression(_) => Some("this".to_string()),
    }
}

fn jsx_member_name(expression: &JSXMemberExpression<'_>) -> String {
    let object = match &expression.object {
        JSXMemberExpressionObject::IdentifierReference(identifier) => identifier.name.to_string(),
        JSXMemberExpressionObject::MemberExpression(member) => jsx_member_name(member),
        JSXMemberExpressionObject::ThisExpression(_) => "this".to_string(),
    };
    format!("{object}.{}", expression.property.name)
}

fn jsx_key(element: &JSXOpeningElement<'_>) -> RenderIdentityKey {
    let Some(attribute) = element.attributes.iter().find_map(|attribute| {
        let JSXAttributeItem::Attribute(attribute) = attribute else {
            return None;
        };
        matches!(&attribute.name, JSXAttributeName::Identifier(name) if name.name == "key")
            .then_some(attribute)
    }) else {
        return RenderIdentityKey::Absent;
    };
    match &attribute.value {
        Some(JSXAttributeValue::StringLiteral(value)) => {
            RenderIdentityKey::Static(value.value.to_string())
        }
        Some(JSXAttributeValue::ExpressionContainer(container)) => {
            let Some(expression) = container.expression.as_expression() else {
                return RenderIdentityKey::Absent;
            };
            match expression.without_parentheses() {
                Expression::StringLiteral(value) => {
                    RenderIdentityKey::Static(value.value.to_string())
                }
                Expression::NumericLiteral(value) => {
                    RenderIdentityKey::Static(value.value.to_string())
                }
                Expression::BigIntLiteral(value) => {
                    RenderIdentityKey::Static(value.value.to_string())
                }
                _ => RenderIdentityKey::Dynamic(SourceSpan::from_oxc(expression.span())),
            }
        }
        Some(value) => RenderIdentityKey::Dynamic(SourceSpan::from_oxc(value.span())),
        None => RenderIdentityKey::Absent,
    }
}

fn component_return_spans(body: &FunctionBody<'_>) -> Vec<Span> {
    let mut returns = vec![];
    collect_returns(&body.statements, &mut returns);
    returns
}

fn collect_returns(statements: &[Statement<'_>], returns: &mut Vec<Span>) {
    for statement in statements {
        match statement {
            Statement::ReturnStatement(statement) => returns.push(statement.span),
            Statement::BlockStatement(block) => collect_returns(&block.body, returns),
            Statement::IfStatement(statement) => {
                collect_statement_returns(&statement.consequent, returns);
                if let Some(alternate) = &statement.alternate {
                    collect_statement_returns(alternate, returns);
                }
            }
            Statement::SwitchStatement(statement) => {
                for case in &statement.cases {
                    collect_returns(&case.consequent, returns);
                }
            }
            Statement::ForStatement(statement) => {
                collect_statement_returns(&statement.body, returns)
            }
            Statement::ForInStatement(statement) => {
                collect_statement_returns(&statement.body, returns)
            }
            Statement::ForOfStatement(statement) => {
                collect_statement_returns(&statement.body, returns)
            }
            Statement::WhileStatement(statement) => {
                collect_statement_returns(&statement.body, returns)
            }
            Statement::DoWhileStatement(statement) => {
                collect_statement_returns(&statement.body, returns)
            }
            Statement::LabeledStatement(statement) => {
                collect_statement_returns(&statement.body, returns)
            }
            Statement::TryStatement(statement) => {
                collect_returns(&statement.block.body, returns);
                if let Some(handler) = &statement.handler {
                    collect_returns(&handler.body.body, returns);
                }
                if let Some(finalizer) = &statement.finalizer {
                    collect_returns(&finalizer.body, returns);
                }
            }
            _ => {}
        }
    }
}

fn collect_statement_returns(statement: &Statement<'_>, returns: &mut Vec<Span>) {
    collect_returns(std::slice::from_ref(statement), returns);
}

fn contains_component_return(statement: &Statement<'_>) -> bool {
    let mut returns = vec![];
    collect_statement_returns(statement, &mut returns);
    !returns.is_empty()
}

fn prune_unreachable(graph: RenderFlowGraph) -> RenderFlowGraph {
    let Some(entry) = graph.entry else {
        return graph;
    };
    let mut reachable = vec![false; graph.nodes.len()];
    let mut pending = vec![entry];
    while let Some(id) = pending.pop() {
        if reachable[id.get()] {
            continue;
        }
        reachable[id.get()] = true;
        match &graph.nodes[id.get()].kind {
            RenderFlowNodeKind::Value { .. } => {}
            RenderFlowNodeKind::Decision {
                consequent,
                alternate,
                ..
            } => {
                pending.push(*consequent);
                pending.push(*alternate);
            }
            RenderFlowNodeKind::Switch {
                cases, fallback, ..
            } => {
                pending.extend(cases.iter().map(|case| case.target));
                pending.push(*fallback);
            }
        }
    }

    let mut remap = vec![None; graph.nodes.len()];
    let mut next = 0;
    for (index, is_reachable) in reachable.iter().copied().enumerate() {
        if is_reachable {
            remap[index] = Some(RenderFlowNodeId::new(next));
            next += 1;
        }
    }
    let nodes = graph
        .nodes
        .into_iter()
        .filter(|node| reachable[node.id.get()])
        .map(|node| {
            let id = remap[node.id.get()].expect("reachable render node has a remapped id");
            let kind = match node.kind {
                RenderFlowNodeKind::Value {
                    expression,
                    identity,
                } => RenderFlowNodeKind::Value {
                    expression,
                    identity,
                },
                RenderFlowNodeKind::Decision {
                    kind,
                    test,
                    consequent,
                    alternate,
                } => RenderFlowNodeKind::Decision {
                    kind,
                    test,
                    consequent: remap[consequent.get()]
                        .expect("reachable decision target has a remapped id"),
                    alternate: remap[alternate.get()]
                        .expect("reachable decision target has a remapped id"),
                },
                RenderFlowNodeKind::Switch {
                    discriminant,
                    cases,
                    fallback,
                } => RenderFlowNodeKind::Switch {
                    discriminant,
                    cases: cases
                        .into_iter()
                        .map(|case| RenderSwitchCase {
                            test: case.test,
                            target: remap[case.target.get()]
                                .expect("reachable switch target has a remapped id"),
                        })
                        .collect(),
                    fallback: remap[fallback.get()]
                        .expect("reachable switch fallback has a remapped id"),
                },
            };
            RenderFlowNode { id, kind }
        })
        .collect();
    RenderFlowGraph {
        entry: remap[entry.get()],
        nodes,
    }
}
