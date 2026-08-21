use oxc_allocator::{Allocator, CloneIn};
use oxc_ast::{
    ast::{ArrowFunctionExpression, CallExpression, Expression, Function, IdentifierReference},
    builder::AstBuilder,
};
use oxc_ast_visit::{
    Visit, VisitMut,
    walk::{walk_arrow_function_expression, walk_call_expression, walk_function},
    walk_mut::walk_expression,
};
use oxc_semantic::Scoping;
use oxc_span::SPAN;
use oxc_syntax::{scope::ScopeFlags, symbol::SymbolId};

use super::syntax::StateSyntax;

pub(super) fn calls_symbol(
    expression: &Expression<'_>,
    symbol: SymbolId,
    scoping: &Scoping,
) -> bool {
    let mut finder = SymbolCallFinder {
        scoping,
        symbol,
        found: false,
        function_depth: 0,
    };
    finder.visit_expression(expression);
    finder.found
}

pub(super) fn clone_and_rewrite<'a>(
    expression: &Expression<'a>,
    state: &StateSyntax<'a>,
    scoping: &Scoping,
    allocator: &'a Allocator,
) -> Expression<'a> {
    let mut expression = expression.clone_in_with_semantic_ids(allocator);
    let state_name = allocator.alloc_str(&state.value);
    StateReferenceRewriter {
        ast: AstBuilder::new(allocator),
        scoping,
        state_name,
        state_symbol: state.value_symbol,
        setter_symbol: state.setter_symbol,
    }
    .visit_expression(&mut expression);
    expression
}

struct StateReferenceRewriter<'a, 's> {
    ast: AstBuilder<'a>,
    scoping: &'s Scoping,
    state_name: &'a str,
    state_symbol: SymbolId,
    setter_symbol: SymbolId,
}

impl<'a> VisitMut<'a> for StateReferenceRewriter<'a, '_> {
    fn visit_expression(&mut self, expression: &mut Expression<'a>) {
        let Expression::Identifier(identifier) = expression else {
            walk_expression(self, expression);
            return;
        };
        let Some(reference_id) = identifier.reference_id.get() else {
            return;
        };
        let Some(symbol_id) = self.scoping.get_reference(reference_id).symbol_id() else {
            return;
        };

        if symbol_id == self.state_symbol {
            let state = Expression::new_identifier(SPAN, self.state_name, &self.ast);
            let get = Expression::from(
                oxc_ast::ast::MemberExpression::new_static_member_expression(
                    SPAN,
                    state,
                    oxc_ast::ast::IdentifierName::new(SPAN, "get", &self.ast),
                    false,
                    &self.ast,
                ),
            );
            *expression = Expression::new_call_expression(SPAN, get, None, [], false, &self.ast);
        } else if symbol_id == self.setter_symbol {
            let state = Expression::new_identifier(SPAN, self.state_name, &self.ast);
            *expression = Expression::from(
                oxc_ast::ast::MemberExpression::new_static_member_expression(
                    SPAN,
                    state,
                    oxc_ast::ast::IdentifierName::new(SPAN, "set", &self.ast),
                    false,
                    &self.ast,
                ),
            );
        }
    }
}

struct SymbolCallFinder<'s> {
    scoping: &'s Scoping,
    symbol: SymbolId,
    found: bool,
    function_depth: u32,
}

impl<'a> Visit<'a> for SymbolCallFinder<'_> {
    fn visit_function(&mut self, function: &Function<'a>, flags: ScopeFlags) {
        if self.function_depth > 0 {
            return;
        }
        self.function_depth += 1;
        walk_function(self, function, flags);
        self.function_depth -= 1;
    }

    fn visit_arrow_function_expression(&mut self, function: &ArrowFunctionExpression<'a>) {
        if self.function_depth > 0 {
            return;
        }
        self.function_depth += 1;
        walk_arrow_function_expression(self, function);
        self.function_depth -= 1;
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if let Expression::Identifier(identifier) = call.callee.without_parentheses()
            && identifier_symbol(identifier, self.scoping) == Some(self.symbol)
        {
            self.found = true;
        }
        walk_call_expression(self, call);
    }
}

fn identifier_symbol(identifier: &IdentifierReference<'_>, scoping: &Scoping) -> Option<SymbolId> {
    identifier
        .reference_id
        .get()
        .and_then(|reference| scoping.get_reference(reference).symbol_id())
}
