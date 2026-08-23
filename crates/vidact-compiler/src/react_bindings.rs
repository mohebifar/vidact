use std::collections::{BTreeMap, BTreeSet};

use oxc_ast::ast::{
    CallExpression, Expression, ImportDeclarationSpecifier, JSXElementName,
    JSXMemberExpressionObject, ModuleExportName, Program, Statement,
};
use oxc_semantic::Scoping;
use oxc_syntax::symbol::SymbolId;

pub(crate) struct ReactBindings<'s> {
    scoping: &'s Scoping,
    named: BTreeMap<String, BTreeSet<SymbolId>>,
    namespaces: BTreeSet<SymbolId>,
    dom_named: BTreeMap<String, BTreeSet<SymbolId>>,
    dom_namespaces: BTreeSet<SymbolId>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum StateHook {
    State,
    Reducer,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum EffectHook {
    Insertion,
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ConcurrentHook {
    DeferredValue,
    Transition,
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

impl ConcurrentHook {
    pub(crate) const fn name(self) -> &'static str {
        match self {
            Self::DeferredValue => "useDeferredValue",
            Self::Transition => "useTransition",
        }
    }
}

impl<'s> ReactBindings<'s> {
    pub(crate) fn new(program: &Program<'_>, scoping: &'s Scoping) -> Self {
        let mut bindings = Self {
            scoping,
            named: BTreeMap::new(),
            namespaces: BTreeSet::new(),
            dom_named: BTreeMap::new(),
            dom_namespaces: BTreeSet::new(),
        };
        for statement in &program.body {
            let Statement::ImportDeclaration(import) = statement else {
                continue;
            };
            let (named, namespaces) = match import.source.value.as_str() {
                "react" => (&mut bindings.named, &mut bindings.namespaces),
                "react-dom" => (&mut bindings.dom_named, &mut bindings.dom_namespaces),
                _ => continue,
            };
            for specifier in import.specifiers.iter().flatten() {
                match specifier {
                    ImportDeclarationSpecifier::ImportSpecifier(specifier) => {
                        let ModuleExportName::IdentifierName(imported) = &specifier.imported else {
                            continue;
                        };
                        if let Some(symbol) = specifier.local.symbol_id.get() {
                            named
                                .entry(imported.name.to_string())
                                .or_default()
                                .insert(symbol);
                        }
                    }
                    ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) => {
                        if let Some(symbol) = specifier.local.symbol_id.get() {
                            namespaces.insert(symbol);
                        }
                    }
                    ImportDeclarationSpecifier::ImportDefaultSpecifier(specifier) => {
                        if let Some(symbol) = specifier.local.symbol_id.get() {
                            namespaces.insert(symbol);
                        }
                    }
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
        if self.is_named_call(call, "useInsertionEffect") {
            Some(EffectHook::Insertion)
        } else if self.is_named_call(call, "useLayoutEffect") {
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

    pub(crate) fn is_lazy_call(&self, call: &CallExpression<'_>) -> bool {
        self.is_named_call(call, "lazy")
    }

    pub(crate) fn concurrent_hook_call(&self, call: &CallExpression<'_>) -> Option<ConcurrentHook> {
        if self.is_named_call(call, "useTransition") {
            Some(ConcurrentHook::Transition)
        } else if self.is_named_call(call, "useDeferredValue") {
            Some(ConcurrentHook::DeferredValue)
        } else {
            None
        }
    }

    pub(crate) fn is_start_transition_call(&self, call: &CallExpression<'_>) -> bool {
        self.is_named_call(call, "startTransition")
    }

    pub(crate) fn is_flush_sync_call(&self, call: &CallExpression<'_>) -> bool {
        self.is_named_expression_from(
            &call.callee,
            "flushSync",
            &self.dom_named,
            &self.dom_namespaces,
        )
    }

    pub(crate) fn is_effect_event_call(&self, call: &CallExpression<'_>) -> bool {
        self.is_named_call(call, "useEffectEvent")
    }

    pub(crate) fn is_id_call(&self, call: &CallExpression<'_>) -> bool {
        self.is_named_call(call, "useId")
    }

    pub(crate) fn is_named_expression(&self, expression: &Expression<'_>, name: &str) -> bool {
        self.is_named_expression_from(expression, name, &self.named, &self.namespaces)
    }

    fn is_named_expression_from(
        &self,
        expression: &Expression<'_>,
        name: &str,
        named: &BTreeMap<String, BTreeSet<SymbolId>>,
        namespaces: &BTreeSet<SymbolId>,
    ) -> bool {
        match expression.without_parentheses() {
            Expression::Identifier(identifier) => reference_symbol(identifier, self.scoping)
                .is_some_and(|symbol| named.get(name).is_some_and(|set| set.contains(&symbol))),
            Expression::StaticMemberExpression(member) if member.property.name == name => member
                .object
                .without_parentheses()
                .get_identifier_reference()
                .and_then(|identifier| reference_symbol(identifier, self.scoping))
                .is_some_and(|symbol| namespaces.contains(&symbol)),
            _ => false,
        }
    }

    pub(crate) fn is_named_jsx_element(&self, element: &JSXElementName<'_>, name: &str) -> bool {
        match element {
            JSXElementName::IdentifierReference(identifier) => {
                reference_symbol(identifier, self.scoping).is_some_and(|symbol| {
                    self.named
                        .get(name)
                        .is_some_and(|set| set.contains(&symbol))
                })
            }
            JSXElementName::MemberExpression(member) if member.property.name == name => {
                let JSXMemberExpressionObject::IdentifierReference(identifier) = &member.object
                else {
                    return false;
                };
                reference_symbol(identifier, self.scoping)
                    .is_some_and(|symbol| self.namespaces.contains(&symbol))
            }
            _ => false,
        }
    }

    fn is_named_call(&self, call: &CallExpression<'_>, name: &str) -> bool {
        self.is_named_expression(&call.callee, name)
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
