use std::collections::BTreeSet;

use oxc_ast::ast::{
    CallExpression, Expression, ImportDeclarationSpecifier, ModuleExportName, Program, Statement,
};
use oxc_semantic::Scoping;
use oxc_syntax::symbol::SymbolId;

pub(crate) struct ReactBindings<'s> {
    scoping: &'s Scoping,
    use_state: BTreeSet<SymbolId>,
    use_reducer: BTreeSet<SymbolId>,
    namespaces: BTreeSet<SymbolId>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum StateHook {
    State,
    Reducer,
}

impl StateHook {
    pub(crate) const fn name(self) -> &'static str {
        match self {
            Self::State => "useState",
            Self::Reducer => "useReducer",
        }
    }
}

impl<'s> ReactBindings<'s> {
    pub(crate) fn new(program: &Program<'_>, scoping: &'s Scoping) -> Self {
        let mut bindings = Self {
            scoping,
            use_state: BTreeSet::new(),
            use_reducer: BTreeSet::new(),
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
                    ImportDeclarationSpecifier::ImportSpecifier(specifier)
                        if matches!(
                            &specifier.imported,
                            ModuleExportName::IdentifierName(name) if name.name == "useReducer"
                        ) =>
                    {
                        if let Some(symbol) = specifier.local.symbol_id.get() {
                            bindings.use_reducer.insert(symbol);
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

    pub(crate) fn state_hook_call(&self, call: &CallExpression<'_>) -> Option<StateHook> {
        match call.callee.without_parentheses() {
            Expression::Identifier(identifier) => {
                let symbol = reference_symbol(identifier, self.scoping)?;
                if self.use_state.contains(&symbol) {
                    Some(StateHook::State)
                } else if self.use_reducer.contains(&symbol) {
                    Some(StateHook::Reducer)
                } else {
                    None
                }
            }
            Expression::StaticMemberExpression(member)
                if matches!(member.property.name.as_str(), "useState" | "useReducer") =>
            {
                let symbol = member
                    .object
                    .without_parentheses()
                    .get_identifier_reference()
                    .and_then(|identifier| reference_symbol(identifier, self.scoping))?;
                if !self.namespaces.contains(&symbol) {
                    return None;
                }
                Some(if member.property.name == "useState" {
                    StateHook::State
                } else {
                    StateHook::Reducer
                })
            }
            _ => None,
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
