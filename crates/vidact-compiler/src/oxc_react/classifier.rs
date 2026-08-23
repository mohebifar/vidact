use std::collections::{BTreeMap, BTreeSet};

use oxc_ast::ast::*;
use oxc_ast_visit::Visit;
use oxc_semantic::Scoping;
use oxc_span::GetSpan;
use oxc_syntax::symbol::SymbolId;

use crate::{
    Diagnostic, DiagnosticCode, SourceSpan,
    analysis::{
        ControlFlowFacts, KeyPath, SourceId, SourceKind, UpdaterFact, UpdaterId, UpdaterKind,
    },
    ast_utils::{component_function_parts, is_event_attribute},
    react_bindings::{ReactBindings, reference_symbol},
    render_flow::{RenderFlowGraph, lower_render_flow},
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
    pub(super) locals: BTreeMap<String, SourceSyntax>,
    pub(super) return_expressions: Vec<&'a Expression<'a>>,
    pub(super) render_flow: RenderFlowGraph,
    pub(super) body_span: SourceSpan,
}

pub(super) fn classify_component<'a>(
    program: &'a Program<'a>,
    scoping: &Scoping,
    component_name: &str,
    component_span: SourceSpan,
    control_flow: &ControlFlowFacts,
) -> Result<ComponentSyntax<'a>, Diagnostic> {
    let (params, body) =
        component_function_parts(program, component_name, Some(component_span)).ok_or_else(|| {
            Diagnostic::new(
                DiagnosticCode::UnsupportedComponentForm,
                format!(
                    "component {component_name} is not a supported named function or block-bodied arrow"
                ),
            )
            .with_span(component_span)
        })?;
    let react = ReactBindings::new(program, scoping);
    let mut sources = BTreeMap::new();

    for parameter in &params.items {
        let BindingPattern::ObjectPattern(pattern) = &parameter.pattern else {
            if let BindingPattern::BindingIdentifier(identifier) = &parameter.pattern {
                let symbol = identifier.symbol_id.get().ok_or_else(|| {
                    Diagnostic::new(
                        DiagnosticCode::AnalysisFailed,
                        "semantic analysis did not resolve the props object binding",
                    )
                    .with_span(SourceSpan::from_oxc(identifier.span))
                })?;
                sources.insert(
                    identifier.name.to_string(),
                    SourceSyntax {
                        kind: SourceKind::Prop,
                        symbol,
                        declaration_start: identifier.span.start,
                    },
                );
                continue;
            }
            return Err(unsupported_at(
                "compiled props require an identifier or object-destructured component parameter",
                parameter.pattern.span(),
            ));
        };
        if let Some(rest) = &pattern.rest {
            let BindingPattern::BindingIdentifier(identifier) = &rest.argument else {
                return Err(unsupported_at(
                    "nested rest prop patterns are unsupported",
                    rest.span,
                ));
            };
            let symbol = identifier.symbol_id.get().ok_or_else(|| {
                Diagnostic::new(
                    DiagnosticCode::AnalysisFailed,
                    "semantic analysis did not resolve the rest prop binding",
                )
                .with_span(SourceSpan::from_oxc(identifier.span))
            })?;
            sources.insert(
                identifier.name.to_string(),
                SourceSyntax {
                    kind: SourceKind::Prop,
                    symbol,
                    declaration_start: identifier.span.start,
                },
            );
        }
        for property in &pattern.properties {
            if property.computed {
                return Err(unsupported_at(
                    "computed prop destructuring is unsupported",
                    property.span,
                ));
            }
            let Some(prop_name) = property.key.static_name() else {
                return Err(unsupported_at(
                    "dynamic prop destructuring is unsupported",
                    property.span,
                ));
            };
            collect_prop_pattern_sources(&property.value, prop_name.as_ref(), &mut sources)?;
        }
    }

    let mut candidates = BTreeMap::new();
    let mut locals = BTreeMap::new();
    for statement in &body.statements {
        let Statement::VariableDeclaration(declaration) = statement else {
            continue;
        };
        for declarator in &declaration.declarations {
            if let Some((name, state)) = state_source(declarator, &react)? {
                sources.insert(name, state);
                continue;
            }
            let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                continue;
            };
            let Some(symbol) = identifier.symbol_id.get() else {
                continue;
            };
            let name = identifier.name.to_string();
            let source = SourceSyntax {
                kind: SourceKind::Derived,
                symbol,
                declaration_start: identifier.span.start,
            };
            locals.insert(name.clone(), source.clone());
            if declaration.kind == VariableDeclarationKind::Const && declarator.init.is_some() {
                candidates.insert(name, source);
            }
        }
    }

    let mut return_expressions = vec![];
    collect_component_return_expressions(&body.statements, &mut return_expressions);
    if return_expressions.is_empty() {
        return Err(unsupported_at(
            format!("component {component_name} has no render return"),
            body.span,
        ));
    }
    let render_flow = lower_render_flow(body, control_flow).map_err(|message| {
        Diagnostic::new(DiagnosticCode::UnsupportedControlFlow, message)
            .with_span(SourceSpan::from_oxc(body.span))
    })?;

    Ok(ComponentSyntax {
        sources,
        candidates,
        locals,
        return_expressions,
        render_flow,
        body_span: SourceSpan::new(body.span.start, body.span.end),
    })
}

fn collect_prop_pattern_sources(
    pattern: &BindingPattern<'_>,
    public_path: &str,
    sources: &mut BTreeMap<String, SourceSyntax>,
) -> Result<(), Diagnostic> {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => {
            let symbol = identifier.symbol_id.get().ok_or_else(|| {
                Diagnostic::new(
                    DiagnosticCode::AnalysisFailed,
                    format!("semantic analysis did not resolve prop {public_path}"),
                )
                .with_span(SourceSpan::from_oxc(identifier.span))
            })?;
            sources.insert(
                identifier.name.to_string(),
                SourceSyntax {
                    kind: SourceKind::Prop,
                    symbol,
                    declaration_start: identifier.span.start,
                },
            );
            Ok(())
        }
        BindingPattern::AssignmentPattern(assignment) => {
            collect_prop_pattern_sources(&assignment.left, public_path, sources)
        }
        BindingPattern::ObjectPattern(object) => {
            if let Some(rest) = &object.rest {
                return Err(unsupported_at(
                    "nested rest prop patterns are unsupported",
                    rest.span,
                ));
            }
            for property in &object.properties {
                if property.computed {
                    return Err(unsupported_at(
                        "computed nested prop destructuring is unsupported",
                        property.span,
                    ));
                }
                let Some(name) = property.key.static_name() else {
                    return Err(unsupported_at(
                        "dynamic nested prop destructuring is unsupported",
                        property.span,
                    ));
                };
                let nested_path = format!("{public_path}.{name}");
                collect_prop_pattern_sources(&property.value, &nested_path, sources)?;
            }
            Ok(())
        }
        _ => Err(unsupported_at(
            "array and nested rest prop patterns are unsupported",
            pattern.span(),
        )),
    }
}

fn collect_component_return_expressions<'a>(
    statements: &'a [Statement<'a>],
    expressions: &mut Vec<&'a Expression<'a>>,
) {
    for statement in statements {
        match statement {
            Statement::ReturnStatement(statement) => {
                if let Some(expression) = &statement.argument {
                    expressions.push(expression);
                }
            }
            Statement::BlockStatement(block) => {
                collect_component_return_expressions(&block.body, expressions);
            }
            Statement::IfStatement(statement) => {
                collect_statement_return_expressions(&statement.consequent, expressions);
                if let Some(alternate) = &statement.alternate {
                    collect_statement_return_expressions(alternate, expressions);
                }
            }
            Statement::SwitchStatement(statement) => {
                for case in &statement.cases {
                    collect_component_return_expressions(&case.consequent, expressions);
                }
            }
            Statement::ForStatement(statement) => {
                collect_statement_return_expressions(&statement.body, expressions);
            }
            Statement::ForInStatement(statement) => {
                collect_statement_return_expressions(&statement.body, expressions);
            }
            Statement::ForOfStatement(statement) => {
                collect_statement_return_expressions(&statement.body, expressions);
            }
            Statement::WhileStatement(statement) => {
                collect_statement_return_expressions(&statement.body, expressions);
            }
            Statement::DoWhileStatement(statement) => {
                collect_statement_return_expressions(&statement.body, expressions);
            }
            Statement::LabeledStatement(statement) => {
                collect_statement_return_expressions(&statement.body, expressions);
            }
            Statement::TryStatement(statement) => {
                collect_component_return_expressions(&statement.block.body, expressions);
                if let Some(handler) = &statement.handler {
                    collect_component_return_expressions(&handler.body.body, expressions);
                }
                if let Some(finalizer) = &statement.finalizer {
                    collect_component_return_expressions(&finalizer.body, expressions);
                }
            }
            _ => {}
        }
    }
}

fn collect_statement_return_expressions<'a>(
    statement: &'a Statement<'a>,
    expressions: &mut Vec<&'a Expression<'a>>,
) {
    collect_component_return_expressions(std::slice::from_ref(statement), expressions);
}

pub(super) fn render_updaters(
    expression: &Expression<'_>,
    scoping: &Scoping,
    source_symbols: &BTreeMap<SymbolId, SourceId>,
    first_updater_id: usize,
) -> Result<Vec<UpdaterFact>, Diagnostic> {
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
) -> Result<Option<(String, SourceSyntax)>, Diagnostic> {
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return Ok(None);
    };
    let Some(Expression::CallExpression(call)) = &declarator.init else {
        return Ok(None);
    };
    let Some(hook) = react.state_hook_call(call) else {
        return Err(unsupported_at(
            "array-destructured calls are unsupported unless the callee resolves to React useState or useReducer",
            call.span,
        ));
    };
    let Some(Some(BindingPattern::BindingIdentifier(identifier))) = pattern.elements.first() else {
        return Err(unsupported_at(
            format!("{} must bind a value identifier", hook.name()),
            pattern.span,
        ));
    };
    let Some(symbol) = identifier.symbol_id.get() else {
        return Err(Diagnostic::new(
            DiagnosticCode::AnalysisFailed,
            format!(
                "semantic analysis did not resolve state binding {}",
                identifier.name
            ),
        )
        .with_span(SourceSpan::from_oxc(identifier.span)));
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
    diagnostic: Option<Diagnostic>,
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
        if let Some((collection, identity)) = jsx_map(expression, self.scoping) {
            match identity {
                ListIdentity::Keyed(key) => self.push(
                    UpdaterKind::KeyedList { key },
                    semantic_reads(collection, self.scoping, self.source_symbols),
                ),
                ListIdentity::Indexed => self.push(
                    UpdaterKind::IndexedList,
                    semantic_reads(collection, self.scoping, self.source_symbols),
                ),
                ListIdentity::InvalidKey => {
                    self.diagnostic = Some(unsupported_at(
                        "keyed maps require key={item} or key={item.property}; other key expressions are unsupported"
                            .to_string(),
                        expression.span(),
                    ));
                }
            }
            return;
        }
        if is_jsx_rendering_map(expression) {
            self.diagnostic = Some(unsupported_at(
                "keyed maps require key={item} or key={item.property}; other key expressions are unsupported"
                    .to_string(),
                expression.span(),
            ));
            return;
        }
        self.push(
            UpdaterKind::Text,
            semantic_reads(expression, self.scoping, self.source_symbols),
        );
    }
}

fn unsupported_at(message: impl Into<String>, span: oxc_span::Span) -> Diagnostic {
    Diagnostic::new(DiagnosticCode::UnsupportedSyntax, message)
        .with_span(SourceSpan::from_oxc(span))
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

enum ListIdentity {
    Keyed(KeyPath),
    Indexed,
    InvalidKey,
}

fn jsx_map<'a>(
    expression: &'a Expression<'a>,
    scoping: &Scoping,
) -> Option<(&'a Expression<'a>, ListIdentity)> {
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
    let rendered = render.body.as_expression()?.without_parentheses();
    let Expression::JSXElement(element) = rendered else {
        return matches!(rendered, Expression::JSXFragment(_))
            .then_some((&member.object, ListIdentity::Indexed));
    };
    let key_attribute = element
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
            Some(attribute)
        });
    let Some(key_attribute) = key_attribute else {
        return Some((&member.object, ListIdentity::Indexed));
    };
    let Some(JSXAttributeValue::ExpressionContainer(container)) = &key_attribute.value else {
        return Some((&member.object, ListIdentity::InvalidKey));
    };
    let Some(expression) = container.expression.as_expression() else {
        return Some((&member.object, ListIdentity::InvalidKey));
    };
    let key = match expression.without_parentheses() {
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
    };
    Some((
        &member.object,
        key.map_or(ListIdentity::InvalidKey, ListIdentity::Keyed),
    ))
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
