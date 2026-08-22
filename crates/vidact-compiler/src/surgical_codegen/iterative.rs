use std::collections::{BTreeMap, BTreeSet};

use oxc_allocator::{CloneIn, GetAllocator};
use oxc_ast::{ast::*, builder::AstBuilder};
use oxc_ast_visit::{VisitMut, walk_mut::walk_expression};
use oxc_semantic::Scoping;
use oxc_syntax::symbol::SymbolId;

use crate::{Diagnostic, analysis::SourceId};

use super::{
    INDEXED, ITEM_INDEX, ITEM_SCOPE, KEYED, SCOPE, StateReference, append_arrow_parameter,
    arrow_expression, call_name, dependencies, dependency_mask, ident, unsupported,
};

pub(super) struct IterativeJsxPlan<'a> {
    pub(super) accumulator: SymbolId,
    pub(super) item: SymbolId,
    pub(super) item_name: &'a str,
    pub(super) collection: Expression<'a>,
    pub(super) key: Option<Expression<'a>>,
    pub(super) render: Expression<'a>,
    pub(super) statement_indexes: [usize; 2],
}

pub(super) fn collect<'a>(
    ast: &AstBuilder<'a>,
    body: &FunctionBody<'a>,
    scoping: &Scoping,
) -> Result<Vec<IterativeJsxPlan<'a>>, Diagnostic> {
    let empty_arrays = body
        .statements
        .iter()
        .enumerate()
        .filter_map(|(index, statement)| {
            let Statement::VariableDeclaration(declaration) = statement else {
                return None;
            };
            let [declarator] = declaration.declarations.as_slice() else {
                return None;
            };
            let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                return None;
            };
            let Some(Expression::ArrayExpression(array)) = &declarator.init else {
                return None;
            };
            (array.elements.is_empty())
                .then(|| identifier.symbol_id.get().map(|symbol| (symbol, index)))?
        })
        .collect::<BTreeMap<_, _>>();

    let mut plans = Vec::new();
    for (loop_index, statement) in body.statements.iter().enumerate() {
        let Statement::ForOfStatement(statement) = statement else {
            continue;
        };
        if statement.r#await {
            continue;
        }
        let Some((item, item_name)) = for_of_item(&statement.left) else {
            continue;
        };
        let item_name = ast.allocator().alloc_str(&item_name);
        let Some((accumulator, rendered)) = pushed_jsx(&statement.body, scoping) else {
            continue;
        };
        let Some(declaration_index) = empty_arrays.get(&accumulator).copied() else {
            continue;
        };
        if declaration_index >= loop_index {
            continue;
        }

        let key = list_key(ast, rendered, item, scoping)?;
        let mut render = arrow_expression(
            ast,
            [item_name],
            rendered.clone_in_with_semantic_ids(ast.allocator()),
        );
        let Expression::ArrowFunctionExpression(render_arrow) = &mut render else {
            unreachable!("arrow_expression always creates an arrow")
        };
        append_arrow_parameter(ast, render_arrow, ITEM_INDEX);
        append_arrow_parameter(ast, render_arrow, ITEM_SCOPE);
        plans.push(IterativeJsxPlan {
            accumulator,
            item,
            item_name,
            collection: statement.right.clone_in_with_semantic_ids(ast.allocator()),
            key,
            render,
            statement_indexes: [declaration_index, loop_index],
        });
    }
    Ok(plans)
}

pub(super) fn register_item_sources<'a>(
    ast: &AstBuilder<'a>,
    plans: &[IterativeJsxPlan<'a>],
    sources: &mut BTreeMap<SymbolId, SourceId>,
    states: &mut BTreeMap<SymbolId, StateReference<'a>>,
) {
    for plan in plans {
        sources.insert(plan.item, SourceId::new(0));
        states.insert(
            plan.item,
            StateReference {
                state_name: ast.allocator().alloc_str(plan.item_name),
                setter: false,
            },
        );
    }
}

pub(super) fn lower<'a>(
    ast: &AstBuilder<'a>,
    expression: &mut Expression<'a>,
    plans: &[IterativeJsxPlan<'a>],
    scoping: &Scoping,
    source_symbols: &BTreeMap<SymbolId, SourceId>,
    item_source_symbols: &BTreeMap<SymbolId, SourceId>,
) -> Result<(), Diagnostic> {
    let plans = plans
        .iter()
        .map(|plan| (plan.accumulator, plan))
        .collect::<BTreeMap<_, _>>();
    let mut transformer = IterativeJsxTransformer {
        ast,
        plans,
        scoping,
        source_symbols,
        item_source_symbols,
        diagnostic: None,
    };
    transformer.visit_expression(expression);
    transformer.diagnostic.map_or(Ok(()), Err)
}

pub(super) fn removed_statement_indexes(plans: &[IterativeJsxPlan<'_>]) -> BTreeSet<usize> {
    plans
        .iter()
        .flat_map(|plan| plan.statement_indexes)
        .collect()
}

fn for_of_item(left: &ForStatementLeft<'_>) -> Option<(SymbolId, String)> {
    let ForStatementLeft::VariableDeclaration(declaration) = left else {
        return None;
    };
    let [declarator] = declaration.declarations.as_slice() else {
        return None;
    };
    let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
        return None;
    };
    Some((identifier.symbol_id.get()?, identifier.name.to_string()))
}

fn pushed_jsx<'a, 'b>(
    body: &'b Statement<'a>,
    scoping: &Scoping,
) -> Option<(SymbolId, &'b Expression<'a>)> {
    let Statement::BlockStatement(block) = body else {
        return None;
    };
    let [Statement::ExpressionStatement(statement)] = block.body.as_slice() else {
        return None;
    };
    let Expression::CallExpression(call) = statement.expression.without_parentheses() else {
        return None;
    };
    let Expression::StaticMemberExpression(member) = call.callee.without_parentheses() else {
        return None;
    };
    if member.property.name != "push" {
        return None;
    }
    let accumulator = member.object.get_identifier_reference()?;
    let reference = accumulator.reference_id.get()?;
    let accumulator = scoping.get_reference(reference).symbol_id()?;
    let [argument] = call.arguments.as_slice() else {
        return None;
    };
    let rendered = argument.as_expression()?.without_parentheses();
    matches!(
        rendered,
        Expression::JSXElement(_) | Expression::JSXFragment(_)
    )
    .then_some((accumulator, rendered))
}

fn list_key<'a>(
    ast: &AstBuilder<'a>,
    rendered: &Expression<'a>,
    item: SymbolId,
    scoping: &Scoping,
) -> Result<Option<Expression<'a>>, Diagnostic> {
    let Expression::JSXElement(element) = rendered else {
        return Ok(None);
    };
    let key = element
        .opening_element
        .attributes
        .iter()
        .find_map(|attribute| {
            let JSXAttributeItem::Attribute(attribute) = attribute else {
                return None;
            };
            matches!(&attribute.name, JSXAttributeName::Identifier(name) if name.name == "key")
                .then_some(attribute)
        });
    let Some(key) = key else {
        return Ok(None);
    };
    let Some(JSXAttributeValue::ExpressionContainer(container)) = &key.value else {
        return Err(unsupported(
            "iterative JSX keys require key={item} or key={item.property}",
        ));
    };
    let Some(expression) = container.expression.as_expression() else {
        return Err(unsupported(
            "iterative JSX keys require key={item} or key={item.property}",
        ));
    };
    let valid = match expression.without_parentheses() {
        Expression::Identifier(identifier) => reference_symbol(identifier, scoping) == Some(item),
        Expression::StaticMemberExpression(member) => {
            member
                .object
                .get_identifier_reference()
                .and_then(|identifier| reference_symbol(identifier, scoping))
                == Some(item)
        }
        _ => false,
    };
    valid
        .then(|| expression.clone_in(ast.allocator()))
        .ok_or_else(|| unsupported("iterative JSX keys require key={item} or key={item.property}"))
        .map(Some)
}

fn reference_symbol(identifier: &IdentifierReference<'_>, scoping: &Scoping) -> Option<SymbolId> {
    identifier
        .reference_id
        .get()
        .and_then(|reference| scoping.get_reference(reference).symbol_id())
}

struct IterativeJsxTransformer<'a, 'b, 's> {
    ast: &'b AstBuilder<'a>,
    plans: BTreeMap<SymbolId, &'b IterativeJsxPlan<'a>>,
    scoping: &'s Scoping,
    source_symbols: &'s BTreeMap<SymbolId, SourceId>,
    item_source_symbols: &'s BTreeMap<SymbolId, SourceId>,
    diagnostic: Option<Diagnostic>,
}

impl<'a> VisitMut<'a> for IterativeJsxTransformer<'a, '_, '_> {
    fn visit_expression(&mut self, expression: &mut Expression<'a>) {
        let Expression::Identifier(identifier) = expression else {
            walk_expression(self, expression);
            return;
        };
        let Some(symbol) = reference_symbol(identifier, self.scoping) else {
            return;
        };
        let Some(plan) = self.plans.get(&symbol) else {
            return;
        };
        let reads = dependencies(
            &plan.collection,
            self.scoping,
            self.source_symbols,
            self.item_source_symbols,
        );
        if !reads.item.is_empty() {
            self.diagnostic = Some(unsupported(
                "iterative JSX collections cannot depend on an outer row",
            ));
            return;
        }
        let mut arguments = vec![
            ident(self.ast, SCOPE),
            dependency_mask(self.ast, &reads.parent),
            arrow_expression(
                self.ast,
                [],
                plan.collection
                    .clone_in_with_semantic_ids(self.ast.allocator()),
            ),
        ];
        if let Some(key) = &plan.key {
            arguments.push(arrow_expression(
                self.ast,
                [plan.item_name, ITEM_INDEX],
                key.clone_in(self.ast.allocator()),
            ));
            arguments.push(plan.render.clone_in_with_semantic_ids(self.ast.allocator()));
            *expression = call_name(self.ast, KEYED, arguments);
        } else {
            arguments.push(plan.render.clone_in_with_semantic_ids(self.ast.allocator()));
            *expression = call_name(self.ast, INDEXED, arguments);
        }
    }
}
