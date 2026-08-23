use std::collections::{BTreeMap, BTreeSet};

use oxc_ast::ast::{
    CallExpression, Expression, ImportDeclarationSpecifier, ModuleExportName, Program, Statement,
};
use oxc_semantic::Scoping;
use oxc_syntax::symbol::SymbolId;

pub(crate) struct ReactBindings<'s> {
    scoping: &'s Scoping,
    named: BTreeMap<String, BTreeSet<SymbolId>>,
    namespaces: BTreeSet<SymbolId>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum StateHook {
    State,
    Reducer,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum EffectHook {
    Layout,
    Passive,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum MemoHook {
    Callback,
    Memo,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ContextHook {
    Context,
    Use,
}

impl StateHook {
    pub(crate) const fn name(self) -> &'static str {
        match self {
            Self::State => "useState",
            Self::Reducer => "useReducer",
        }
    }
}

impl MemoHook {
    pub(crate) const fn name(self) -> &'static str {
        match self {
            Self::Callback => "useCallback",
            Self::Memo => "useMemo",
        }
    }
}

impl ContextHook {
    pub(crate) const fn name(self) -> &'static str {
        match self {
            Self::Context => "useContext",
            Self::Use => "use",
        }
    }
}

impl<'s> ReactBindings<'s> {
    pub(crate) fn new(program: &Program<'_>, scoping: &'s Scoping) -> Self {
        let mut bindings = Self {
            scoping,
            named: BTreeMap::new(),
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
                    ImportDeclarationSpecifier::ImportSpecifier(specifier) => {
                        let ModuleExportName::IdentifierName(imported) = &specifier.imported else {
                            continue;
                        };
                        if let Some(symbol) = specifier.local.symbol_id.get() {
                            bindings
                                .named
                                .entry(imported.name.to_string())
                                .or_default()
                                .insert(symbol);
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
        if self.is_named_call(call, "useState") {
            Some(StateHook::State)
        } else if self.is_named_call(call, "useReducer") {
            Some(StateHook::Reducer)
        } else {
            None
        }
    }

    pub(crate) fn is_imperative_handle_call(&self, call: &CallExpression<'_>) -> bool {
        self.is_named_call(call, "useImperativeHandle")
    }

    pub(crate) fn effect_hook_call(&self, call: &CallExpression<'_>) -> Option<EffectHook> {
        if self.is_named_call(call, "useLayoutEffect") {
            Some(EffectHook::Layout)
        } else if self.is_named_call(call, "useEffect") {
            Some(EffectHook::Passive)
        } else {
            None
        }
    }

    pub(crate) fn memo_hook_call(&self, call: &CallExpression<'_>) -> Option<MemoHook> {
        if self.is_named_call(call, "useMemo") {
            Some(MemoHook::Memo)
        } else if self.is_named_call(call, "useCallback") {
            Some(MemoHook::Callback)
        } else {
            None
        }
    }

    pub(crate) fn context_hook_call(&self, call: &CallExpression<'_>) -> Option<ContextHook> {
        if self.is_named_call(call, "useContext") {
            Some(ContextHook::Context)
        } else if self.is_named_call(call, "use") {
            Some(ContextHook::Use)
        } else {
            None
        }
    }

    pub(crate) fn is_sync_external_store_call(&self, call: &CallExpression<'_>) -> bool {
        self.is_named_call(call, "useSyncExternalStore")
    }

    pub(crate) fn is_effect_event_call(&self, call: &CallExpression<'_>) -> bool {
        self.is_named_call(call, "useEffectEvent")
    }

    fn is_named_call(&self, call: &CallExpression<'_>, name: &str) -> bool {
        match call.callee.without_parentheses() {
            Expression::Identifier(identifier) => reference_symbol(identifier, self.scoping)
                .is_some_and(|symbol| {
                    self.named
                        .get(name)
                        .is_some_and(|set| set.contains(&symbol))
                }),
            Expression::StaticMemberExpression(member) if member.property.name == name => member
                .object
                .without_parentheses()
                .get_identifier_reference()
                .and_then(|identifier| reference_symbol(identifier, self.scoping))
                .is_some_and(|symbol| self.namespaces.contains(&symbol)),
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
