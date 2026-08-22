use std::collections::BTreeSet;

use oxc_ast::ast::{
    CallExpression, Expression, ImportDeclarationSpecifier, ModuleExportName, Program, Statement,
};
use oxc_semantic::Scoping;
use oxc_syntax::symbol::SymbolId;

pub(crate) struct ReactBindings<'s> {
    scoping: &'s Scoping,
    use_state: BTreeSet<SymbolId>,
    namespaces: BTreeSet<SymbolId>,
}

impl<'s> ReactBindings<'s> {
    pub(crate) fn new(program: &Program<'_>, scoping: &'s Scoping) -> Self {
        let mut bindings = Self {
            scoping,
            use_state: BTreeSet::new(),
            namespaces: BTreeSet::new(),
        };
        for statement in &program.body {
            let Statement::ImportDeclaration(import) = statement else {
                continue;
            };
            if import.source.value != "react" {
                continue;
            }
            for specifier in import.specifiers.iter().flatten() {
                match specifier {
                    ImportDeclarationSpecifier::ImportSpecifier(specifier)
                        if matches!(
                            &specifier.imported,
                            ModuleExportName::IdentifierName(name) if name.name == "useState"
                        ) =>
                    {
                        if let Some(symbol) = specifier.local.symbol_id.get() {
                            bindings.use_state.insert(symbol);
                        }
                    }
                    ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) => {
                        if let Some(symbol) = specifier.local.symbol_id.get() {
                            bindings.namespaces.insert(symbol);
                        }
                    }
                    _ => {}
                }
            }
        }
        bindings
    }

    pub(crate) fn is_use_state_call(&self, call: &CallExpression<'_>) -> bool {
        match call.callee.without_parentheses() {
            Expression::Identifier(identifier) => reference_symbol(identifier, self.scoping)
                .is_some_and(|symbol| self.use_state.contains(&symbol)),
            Expression::StaticMemberExpression(member) if member.property.name == "useState" => {
                member
                    .object
                    .without_parentheses()
                    .get_identifier_reference()
                    .and_then(|identifier| reference_symbol(identifier, self.scoping))
                    .is_some_and(|symbol| self.namespaces.contains(&symbol))
            }
            _ => false,
        }
    }
}

pub(crate) fn reference_symbol(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    scoping: &Scoping,
) -> Option<SymbolId> {
    identifier
        .reference_id
        .get()
        .and_then(|reference| scoping.get_reference(reference).symbol_id())
}
