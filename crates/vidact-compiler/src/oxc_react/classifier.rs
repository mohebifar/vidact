use std::collections::{BTreeMap, BTreeSet};

use oxc_ast::ast::*;
use oxc_ast_visit::Visit;
use oxc_semantic::Scoping;
use oxc_syntax::symbol::SymbolId;

use crate::{
    SourceSpan,
    analysis::{KeyPath, SourceId, SourceKind, UpdaterFact, UpdaterId, UpdaterKind},
    ast_utils::{component_function, is_event_attribute},
    react_bindings::{ReactBindings, reference_symbol},
};

#[derive(Clone)]
pub(super) struct SourceSyntax {
    pub(super) kind: SourceKind,
    pub(super) symbol: SymbolId,
    pub(super) declaration_start: u32,
}

pub(super) struct ComponentSyntax<'a> {
    pub(super) sources: BTreeMap<String, SourceSyntax>,
    pub(super) candidates: BTreeMap<String, SourceSyntax>,
    pub(super) return_expression: &'a Expression<'a>,
}

pub(super) fn classify_component<'a>(
    program: &'a Program<'a>,
    scoping: &Scoping,
    component_name: &str,
    component_span: SourceSpan,
) -> Result<ComponentSyntax<'a>, String> {
    let function =
        component_function(program, component_name, Some(component_span)).ok_or_else(|| {
            format!("component {component_name} is not a supported named function declaration")
        })?;
    let body = function
        .body
        .as_deref()
        .ok_or_else(|| format!("component {component_name} has no body"))?;
    let react = ReactBindings::new(program, scoping);
    let mut sources = BTreeMap::new();

    for parameter in &function.params.items {
        let BindingPattern::ObjectPattern(pattern) = &parameter.pattern else {
            return Err(
                "compiled props require direct object destructuring in the component parameter"
                    .to_string(),
            );
        };
        if pattern.rest.is_some() {
            return Err("rest props are unsupported until prop deletion is modeled".to_string());
        }
        for property in &pattern.properties {
            if property.computed {
                return Err("computed prop destructuring is unsupported".to_string());
            }
            let Some(prop_name) = property.key.static_name() else {
                return Err("dynamic prop destructuring is unsupported".to_string());
            };
            let identifier = match &property.value {
                BindingPattern::BindingIdentifier(identifier) => identifier.as_ref(),
                BindingPattern::AssignmentPattern(assignment) => {
                    let BindingPattern::BindingIdentifier(identifier) = &assignment.left else {
                        return Err("nested prop defaults are unsupported".to_string());
                    };
                    identifier.as_ref()
                }
                _ => return Err("nested prop destructuring is unsupported".to_string()),
            };
            if identifier.name.as_str() != prop_name.as_ref() {
                return Err("aliased prop destructuring is unsupported".to_string());
            }
            let symbol = identifier
                .symbol_id
                .get()
                .ok_or_else(|| format!("semantic analysis did not resolve prop {prop_name}"))?;
            let name = identifier.name.to_string();
            sources.insert(
                name,
                SourceSyntax {
                    kind: SourceKind::Prop,
                    symbol,
                    declaration_start: identifier.span.start,
                },
            );
        }
    }

    let mut candidates = BTreeMap::new();
    for statement in &body.statements {
        let Statement::VariableDeclaration(declaration) = statement else {
            continue;
        };
        for declarator in &declaration.declarations {
            if let Some((name, state)) = state_source(declarator, &react)? {
                sources.insert(name, state);
                continue;
            }
            if declaration.kind != VariableDeclarationKind::Const || declarator.init.is_none() {
                continue;
            }
            let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                continue;
            };
            let Some(symbol) = identifier.symbol_id.get() else {
                continue;
            };
            let name = identifier.name.to_string();
            candidates.insert(
                name,
                SourceSyntax {
                    kind: SourceKind::Derived,
                    symbol,
                    declaration_start: identifier.span.start,
                },
            );
        }
    }

    let returns = body
        .statements
        .iter()
        .filter_map(|statement| {
            let Statement::ReturnStatement(statement) = statement else {
                return None;
            };
            statement.argument.as_ref()
        })
        .collect::<Vec<_>>();
    let [return_expression] = returns.as_slice() else {
        return Err(format!(
            "component {component_name} must have exactly one top-level return"
        ));
    };

    Ok(ComponentSyntax {
        sources,
        candidates,
        return_expression,
    })
}

pub(super) fn render_updaters(
    expression: &Expression<'_>,
    scoping: &Scoping,
    source_symbols: &BTreeMap<SymbolId, SourceId>,
    first_updater_id: usize,
) -> Result<Vec<UpdaterFact>, String> {
    let mut collector = RenderUpdaterCollector {
        scoping,
        source_symbols,
        updaters: Vec::new(),
        next_id: first_updater_id,
        diagnostic: None,
    };
    collector.visit_expression(expression);
    if let Some(diagnostic) = collector.diagnostic {
        Err(diagnostic)
    } else {
        Ok(collector.updaters)
    }
}

fn state_source(
    declarator: &VariableDeclarator<'_>,
    react: &ReactBindings<'_>,
) -> Result<Option<(String, SourceSyntax)>, String> {
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return Ok(None);
    };
    let Some(Expression::CallExpression(call)) = &declarator.init else {
        return Ok(None);
    };
    if !react.is_use_state_call(call) {
        return Err(
            "array-destructured calls are unsupported unless the callee resolves to React useState"
                .to_string(),
        );
    }
    let Some(Some(BindingPattern::BindingIdentifier(identifier))) = pattern.elements.first() else {
        return Err("useState must bind a value identifier".to_string());
    };
    let Some(symbol) = identifier.symbol_id.get() else {
        return Err(format!(
            "semantic analysis did not resolve state binding {}",
            identifier.name
        ));
    };
    Ok(Some((
        identifier.name.to_string(),
        SourceSyntax {
            kind: SourceKind::State,
            symbol,
            declaration_start: identifier.span.start,
        },
    )))
}

struct RenderUpdaterCollector<'s> {
    scoping: &'s Scoping,
    source_symbols: &'s BTreeMap<SymbolId, SourceId>,
    updaters: Vec<UpdaterFact>,
    next_id: usize,
    diagnostic: Option<String>,
}

impl RenderUpdaterCollector<'_> {
    fn push(&mut self, kind: UpdaterKind, reads: Vec<SourceId>) {
        if reads.is_empty() {
            return;
        }
        self.updaters.push(UpdaterFact::new(
            UpdaterId::new(self.next_id as u32),
            kind,
            reads,
            vec![],
        ));
        self.next_id += 1;
    }
}

impl<'a> Visit<'a> for RenderUpdaterCollector<'_> {
    fn visit_jsx_attribute(&mut self, attribute: &JSXAttribute<'a>) {
        let JSXAttributeName::Identifier(name) = &attribute.name else {
            return;
        };
        if name.name == "key" || name.name == "ref" || is_event_attribute(name.name.as_str()) {
            return;
        }
        let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
            return;
        };
        let Some(expression) = container.expression.as_expression() else {
            return;
        };
        self.push(
            UpdaterKind::Attribute {
                name: name.name.to_string(),
            },
            semantic_reads(expression, self.scoping, self.source_symbols),
        );
    }

    fn visit_jsx_expression_container(&mut self, container: &JSXExpressionContainer<'a>) {
        let Some(expression) = container.expression.as_expression() else {
            return;
        };
        if let Some((collection, key)) = keyed_map(expression, self.scoping) {
            self.push(
                UpdaterKind::KeyedList { key },
                semantic_reads(collection, self.scoping, self.source_symbols),
            );
            return;
        }
        if is_jsx_rendering_map(expression) {
            self.diagnostic = Some(
                "keyed maps require key={item} or key={item.property}; other key expressions are unsupported"
                    .to_string(),
            );
            return;
        }
        self.push(
            UpdaterKind::Text,
            semantic_reads(expression, self.scoping, self.source_symbols),
        );
    }
}

fn is_jsx_rendering_map(expression: &Expression<'_>) -> bool {
    let Expression::CallExpression(call) = expression.without_parentheses() else {
        return false;
    };
    let Expression::StaticMemberExpression(member) = call.callee.without_parentheses() else {
        return false;
    };
    member.property.name == "map"
        && call.arguments.iter().any(|argument| {
            argument
                .as_expression()
                .is_some_and(expression_contains_jsx)
        })
}

fn expression_contains_jsx(expression: &Expression<'_>) -> bool {
    let mut finder = JsxFinder::default();
    finder.visit_expression(expression);
    finder.found
}

#[derive(Default)]
struct JsxFinder {
    found: bool,
}

impl<'a> Visit<'a> for JsxFinder {
    fn visit_jsx_element(&mut self, _element: &JSXElement<'a>) {
        self.found = true;
    }

    fn visit_jsx_fragment(&mut self, _fragment: &JSXFragment<'a>) {
        self.found = true;
    }
}

fn keyed_map<'a>(
    expression: &'a Expression<'a>,
    scoping: &Scoping,
) -> Option<(&'a Expression<'a>, KeyPath)> {
    let Expression::CallExpression(call) = expression.without_parentheses() else {
        return None;
    };
    let Expression::StaticMemberExpression(member) = call.callee.without_parentheses() else {
        return None;
    };
    if member.property.name != "map" {
        return None;
    }
    let [argument] = call.arguments.as_slice() else {
        return None;
    };
    let Expression::ArrowFunctionExpression(render) =
        argument.as_expression()?.without_parentheses()
    else {
        return None;
    };
    let parameter = render.params.items.first()?;
    let BindingPattern::BindingIdentifier(item) = &parameter.pattern else {
        return None;
    };
    let item_symbol = item.symbol_id.get()?;
    let Expression::JSXElement(element) = render.body.as_expression()?.without_parentheses() else {
        return None;
    };
    let key = element
        .opening_element
        .attributes
        .iter()
        .find_map(|attribute| {
            let JSXAttributeItem::Attribute(attribute) = attribute else {
                return None;
            };
            let JSXAttributeName::Identifier(name) = &attribute.name else {
                return None;
            };
            if name.name != "key" {
                return None;
            }
            let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
                return None;
            };
            let expression = container.expression.as_expression()?.without_parentheses();
            match expression {
                Expression::Identifier(identifier)
                    if reference_symbol(identifier, scoping) == Some(item_symbol) =>
                {
                    Some(KeyPath::Identity)
                }
                Expression::StaticMemberExpression(key)
                    if key
                        .object
                        .without_parentheses()
                        .get_identifier_reference()
                        .and_then(|identifier| reference_symbol(identifier, scoping))
                        == Some(item_symbol) =>
                {
                    Some(KeyPath::Property(key.property.name.to_string()))
                }
                _ => None,
            }
        })?;
    Some((&member.object, key))
}

fn semantic_reads(
    expression: &Expression<'_>,
    scoping: &Scoping,
    source_symbols: &BTreeMap<SymbolId, SourceId>,
) -> Vec<SourceId> {
    let mut finder = SourceReadFinder {
        scoping,
        source_symbols,
        reads: BTreeSet::new(),
    };
    finder.visit_expression(expression);
    finder.reads.into_iter().collect()
}

struct SourceReadFinder<'s> {
    scoping: &'s Scoping,
    source_symbols: &'s BTreeMap<SymbolId, SourceId>,
    reads: BTreeSet<SourceId>,
}

impl<'a> Visit<'a> for SourceReadFinder<'_> {
    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        let Some(symbol) = reference_symbol(identifier, self.scoping) else {
            return;
        };
        if let Some(source) = self.source_symbols.get(&symbol) {
            self.reads.insert(*source);
        }
    }
}
