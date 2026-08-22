use oxc_allocator::{CloneIn, GetAllocator};
use oxc_ast::{ast::*, builder::AstBuilder};
use oxc_semantic::Scoping;
use oxc_syntax::{operator::AssignmentOperator, symbol::SymbolId};

use crate::{Diagnostic, analysis::SourceId, ir::ComponentIr};

pub(super) fn branch_expression<'a>(
    ast: &AstBuilder<'a>,
    body: &FunctionBody<'a>,
    scoping: &Scoping,
    ir: &ComponentIr,
    source: SourceId,
    symbol: SymbolId,
) -> Result<Option<Expression<'a>>, Diagnostic> {
    if !ir.reactive_flow.blocks.iter().any(|block| {
        block
            .phis
            .iter()
            .any(|phi| phi.target.source == Some(source))
    }) {
        return Ok(None);
    }

    body.statements
        .iter()
        .find_map(|statement| match statement {
            Statement::IfStatement(statement) => {
                conditional_assignment(ast, statement, scoping, symbol)
            }
            _ => None,
        })
        .map(Some)
        .ok_or_else(|| {
            super::unsupported(
                "SSA branch-derived values currently require a side-effect-free if/else assignment region",
            )
        })
}

fn conditional_assignment<'a>(
    ast: &AstBuilder<'a>,
    statement: &IfStatement<'a>,
    scoping: &Scoping,
    symbol: SymbolId,
) -> Option<Expression<'a>> {
    let consequent = assigned_value(ast, &statement.consequent, scoping, symbol)?;
    let alternate = assigned_value(ast, statement.alternate.as_ref()?, scoping, symbol)?;
    Some(Expression::new_conditional_expression(
        statement.span,
        statement.test.clone_in_with_semantic_ids(ast.allocator()),
        consequent,
        alternate,
        ast,
    ))
}

fn assigned_value<'a>(
    ast: &AstBuilder<'a>,
    statement: &Statement<'a>,
    scoping: &Scoping,
    symbol: SymbolId,
) -> Option<Expression<'a>> {
    match statement {
        Statement::BlockStatement(block) => {
            let [statement] = block.body.as_slice() else {
                return None;
            };
            assigned_value(ast, statement, scoping, symbol)
        }
        Statement::IfStatement(statement) => {
            conditional_assignment(ast, statement, scoping, symbol)
        }
        Statement::ExpressionStatement(statement) => {
            let Expression::AssignmentExpression(assignment) = &statement.expression else {
                return None;
            };
            if assignment.operator != AssignmentOperator::Assign {
                return None;
            }
            let AssignmentTarget::AssignmentTargetIdentifier(identifier) = &assignment.left else {
                return None;
            };
            let reference = identifier.reference_id.get()?;
            if scoping.get_reference(reference).symbol_id()? != symbol {
                return None;
            }
            Some(assignment.right.clone_in_with_semantic_ids(ast.allocator()))
        }
        _ => None,
    }
}
