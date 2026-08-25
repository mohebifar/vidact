use oxc_allocator::{CloneIn, GetAllocator};
use oxc_ast::{ast::*, builder::AstBuilder};
use oxc_ast_visit::{Visit, walk::walk_statement};
use oxc_semantic::Scoping;
use oxc_syntax::{operator::AssignmentOperator, symbol::SymbolId};

use crate::{Diagnostic, analysis::SourceId, ir::ComponentIr, reactive_flow::StructuredRegionKind};

use super::{assignment_statement, ident};

pub(super) enum DerivedComputation<'a> {
    Expression(Expression<'a>),
    Statements(Vec<Statement<'a>>),
}

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

    Ok(body
        .statements
        .iter()
        .find_map(|statement| match statement {
            Statement::IfStatement(statement) => {
                conditional_assignment(ast, statement, scoping, symbol)
            }
            _ => None,
        }))
}

pub(super) fn computation<'a>(
    ast: &AstBuilder<'a>,
    body: &FunctionBody<'a>,
    scoping: &Scoping,
    ir: &ComponentIr,
    source: SourceId,
    symbol: SymbolId,
    name: &str,
) -> Result<Option<DerivedComputation<'a>>, Diagnostic> {
    if let Some(expression) = branch_expression(ast, body, scoping, ir, source, symbol)? {
        return Ok(Some(DerivedComputation::Expression(expression)));
    }
    if !ir.reactive_flow.blocks.iter().any(|block| {
        block
            .phis
            .iter()
            .any(|phi| phi.target.source == Some(source))
    }) {
        return Ok(None);
    }

    let initial = initial_value(ast, body, symbol);
    if let Some(region) = body.statements.iter().find(|statement| {
        matches!(statement, Statement::IfStatement(_))
            && statement_references_symbol(statement, scoping, symbol)
    }) {
        return Ok(Some(DerivedComputation::Statements(vec![
            assignment_statement(ast, name, initial),
            region.clone_in_with_semantic_ids(ast.allocator()),
        ])));
    }

    let region = body.statements.iter().find(|statement| {
        structured_region_kind(statement).is_some_and(|kind| {
            ir.reactive_flow.structured_regions.contains(&kind)
                && statement_references_symbol(statement, scoping, symbol)
        })
    });
    let Some(region) = region else {
        return Err(super::unsupported(
            "SSA derived values currently require an if/else or one structured switch/loop region",
        ));
    };
    Ok(Some(DerivedComputation::Statements(vec![
        assignment_statement(ast, name, initial),
        region.clone_in_with_semantic_ids(ast.allocator()),
    ])))
}

fn initial_value<'a>(
    ast: &AstBuilder<'a>,
    body: &FunctionBody<'a>,
    symbol: SymbolId,
) -> Expression<'a> {
    body.statements
        .iter()
        .filter_map(|statement| match statement {
            Statement::VariableDeclaration(declaration) => Some(declaration),
            _ => None,
        })
        .flat_map(|declaration| &declaration.declarations)
        .find_map(|declarator| {
            let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                return None;
            };
            (identifier.symbol_id.get() == Some(symbol))
                .then_some(declarator.init.as_ref())
                .flatten()
        })
        .map_or_else(
            || ident(ast, "undefined"),
            |expression| expression.clone_in_with_semantic_ids(ast.allocator()),
        )
}

fn structured_region_kind(statement: &Statement<'_>) -> Option<StructuredRegionKind> {
    match statement {
        Statement::SwitchStatement(_) => Some(StructuredRegionKind::Switch),
        Statement::ForStatement(_) => Some(StructuredRegionKind::For),
        Statement::ForOfStatement(_) => Some(StructuredRegionKind::ForOf),
        Statement::ForInStatement(_) => Some(StructuredRegionKind::ForIn),
        Statement::WhileStatement(_) => Some(StructuredRegionKind::While),
        Statement::DoWhileStatement(_) => Some(StructuredRegionKind::DoWhile),
        Statement::LabeledStatement(statement) => {
            structured_region_kind(&statement.body).or(Some(StructuredRegionKind::Label))
        }
        Statement::TryStatement(_) => Some(StructuredRegionKind::Try),
        _ => None,
    }
}

fn statement_references_symbol(
    statement: &Statement<'_>,
    scoping: &Scoping,
    symbol: SymbolId,
) -> bool {
    let mut finder = SymbolReferenceFinder {
        scoping,
        symbol,
        found: false,
    };
    finder.visit_statement(statement);
    finder.found
}

struct SymbolReferenceFinder<'s> {
    scoping: &'s Scoping,
    symbol: SymbolId,
    found: bool,
}

impl<'a> Visit<'a> for SymbolReferenceFinder<'_> {
    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        self.found |= identifier
            .reference_id
            .get()
            .and_then(|reference| self.scoping.get_reference(reference).symbol_id())
            == Some(self.symbol);
    }

    fn visit_statement(&mut self, statement: &Statement<'a>) {
        if !self.found {
            walk_statement(self, statement);
        }
    }

    fn visit_function(&mut self, _function: &Function<'a>, _flags: oxc_semantic::ScopeFlags) {}

    fn visit_arrow_function_expression(&mut self, _function: &ArrowFunctionExpression<'a>) {}
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
