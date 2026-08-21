use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

use oxc_allocator::{Allocator, CloneIn, GetAllocator};
use oxc_ast::{ast::*, builder::AstBuilder};
use oxc_ast_visit::{
    Visit, VisitMut,
    walk::walk_call_expression,
    walk_mut::{walk_expression as walk_expression_mut, walk_jsx_attribute},
};
use oxc_codegen::Codegen;
use oxc_parser::Parser;
use oxc_semantic::{Scoping, SemanticBuilder};
use oxc_span::{SPAN, SourceType};
use oxc_syntax::{operator::LogicalOperator, symbol::SymbolId};

use crate::{
    Diagnostic, DiagnosticCode,
    analysis::{ModuleInput, SourceId, SourceKind},
    ir::{ComponentIr, lower_component},
    oxc_react::analyze_program,
};

mod ast;

use ast::*;

const SCOPE: &str = "__vidactScope";
const BINDING: &str = "__vidactBinding";
const COMBINE_SOURCES: &str = "__vidactCombineSources";
const COMPILED_EVENT: &str = "__vidactEvent";
const COMPILED_ROOT: &str = "__vidactCompiledRoot";
const CREATE_SCOPE: &str = "__vidactCreateScope";
const CREATE_STATE: &str = "__vidactCreateState";
const KEYED: &str = "__vidactKeyed";
const ITEM_INDEX: &str = "__vidactItemIndex";
const ITEM_SCOPE: &str = "__vidactItemScope";
const SOURCE: &str = "__vidactSource";
const WHEN: &str = "__vidactWhen";

pub struct SurgicalCompilation {
    pub code: String,
    pub component: ComponentIr,
}

pub fn compile_surgical_module(input: ModuleInput<'_>) -> Result<String, Vec<Diagnostic>> {
    compile_surgical_module_with_ir(input).map(|compilation| compilation.code)
}

pub fn compile_surgical_module_with_ir(
    input: ModuleInput<'_>,
) -> Result<SurgicalCompilation, Vec<Diagnostic>> {
    let allocator = Allocator::default();
    let source_type =
        SourceType::from_path(Path::new(input.filename)).unwrap_or_else(|_| SourceType::tsx());
    let mut parsed = Parser::new(&allocator, input.source, source_type).parse();
    if !parsed.diagnostics.is_empty() {
        return Err(vec![analysis_error(format!(
            "OXC could not parse {} for surgical codegen: {:?}",
            input.filename, parsed.diagnostics
        ))]);
    }
    let semantic = SemanticBuilder::new()
        .with_build_nodes(true)
        .with_check_syntax_error(true)
        .build(&parsed.program);
    if !semantic.diagnostics.is_empty() {
        return Err(vec![analysis_error(format!(
            "OXC semantic analysis failed for {} during surgical codegen: {:?}",
            input.filename, semantic.diagnostics
        ))]);
    }

    let mut components = analyze_program(input, &parsed.program, &semantic.semantic, &allocator)?;
    let facts = components
        .pop()
        .ok_or_else(|| vec![unsupported("surgical codegen found no component")])?;
    let ir = lower_component(facts).map_err(|diagnostic| vec![diagnostic])?;
    if !input.source.contains("useState") {
        return Ok(SurgicalCompilation {
            code: input.source.to_string(),
            component: ir,
        });
    }
    let scoping = semantic.semantic.into_scoping();
    transform_program(&allocator, &scoping, &ir, &mut parsed.program)
        .map_err(|diagnostic| vec![diagnostic])?;
    Ok(SurgicalCompilation {
        code: Codegen::new().build(&parsed.program).code,
        component: ir,
    })
}

fn transform_program<'a>(
    allocator: &'a Allocator,
    scoping: &Scoping,
    ir: &ComponentIr,
    program: &mut Program<'a>,
) -> Result<(), Diagnostic> {
    let ast = AstBuilder::new(allocator);
    for name in [
        SCOPE,
        BINDING,
        COMBINE_SOURCES,
        COMPILED_EVENT,
        COMPILED_ROOT,
        CREATE_SCOPE,
        CREATE_STATE,
        KEYED,
        ITEM_INDEX,
        ITEM_SCOPE,
        SOURCE,
        WHEN,
    ] {
        if scoping
            .iter_bindings()
            .any(|(_, bindings)| bindings.contains_key(name))
        {
            return Err(unsupported(format!(
                "source binding {name} conflicts with Vidact generated code"
            )));
        }
    }
    let function = component_function_mut(program, &ir.name)
        .ok_or_else(|| unsupported(format!("could not find component function {}", ir.name)))?;
    let body = function
        .body
        .as_deref_mut()
        .ok_or_else(|| unsupported("compiled component has no body"))?;

    let source_ids = ir
        .sources
        .iter()
        .map(|source| (source.name.as_str(), source.id))
        .collect::<BTreeMap<_, _>>();
    let mut source_symbols = BTreeMap::<SymbolId, SourceId>::new();
    let mut state_symbols = BTreeMap::<SymbolId, StateReference<'a>>::new();
    let (item_source_symbols, item_state_symbols) = item_parameters(body, &ast);
    state_symbols.extend(item_state_symbols);

    for statement in &body.statements {
        let Statement::VariableDeclaration(declaration) = statement else {
            continue;
        };
        for declarator in &declaration.declarations {
            if let Some((value, setter)) = state_binding_symbols(declarator, &source_ids)? {
                source_symbols.insert(value.symbol, value.source);
                state_symbols.insert(
                    value.symbol,
                    StateReference {
                        state_name: ast.allocator().alloc_str(value.name),
                        setter: false,
                    },
                );
                state_symbols.insert(
                    setter.symbol,
                    StateReference {
                        state_name: ast.allocator().alloc_str(value.name),
                        setter: true,
                    },
                );
            } else if let BindingPattern::BindingIdentifier(identifier) = &declarator.id
                && let Some(source) = source_ids.get(identifier.name.as_str())
                && let Some(symbol) = identifier.symbol_id.get()
            {
                source_symbols.insert(symbol, *source);
            }
        }
    }

    for statement in &mut body.statements {
        let Statement::VariableDeclaration(declaration) = statement else {
            continue;
        };
        let mut contains_derived = false;
        for declarator in &mut declaration.declarations {
            transform_state_declarator(&ast, declarator, &source_ids)?;
            if let BindingPattern::BindingIdentifier(identifier) = &declarator.id
                && ir.sources.iter().any(|source| {
                    source.kind == SourceKind::Derived && source.name == identifier.name.as_str()
                })
            {
                declarator.kind = VariableDeclarationKind::Let;
                contains_derived = true;
            }
        }
        if contains_derived {
            declaration.kind = VariableDeclarationKind::Let;
        }
    }

    let mut inserted = oxc_allocator::Vec::new_in(&ast);
    inserted.push(scope_statement(&ast));
    inserted.extend(body.statements.drain(..));
    body.statements = inserted;

    let derivations = derived_expressions(body, ir, allocator);
    let return_index = body
        .statements
        .iter()
        .position(|statement| matches!(statement, Statement::ReturnStatement(_)))
        .ok_or_else(|| unsupported("compiled component has no return statement"))?;
    let mut updater_statements = oxc_allocator::Vec::new_in(&ast);
    for updater in &ir.updaters {
        if updater.kind != crate::analysis::UpdaterKind::Derived {
            continue;
        }
        let [write] = updater.writes.as_slice() else {
            return Err(unsupported("derived updater must write exactly one source"));
        };
        let source = ir
            .sources
            .iter()
            .find(|source| source.id == *write)
            .ok_or_else(|| unsupported("derived updater writes an unknown source"))?;
        let expression = derivations.get(source.name.as_str()).ok_or_else(|| {
            unsupported(format!("missing derived expression for {}", source.name))
        })?;
        updater_statements.push(register_derived(
            &ast,
            source.name.as_str(),
            expression.clone_in_with_semantic_ids(allocator),
            &updater.reads,
            &updater.writes,
        ));
    }
    for (offset, statement) in updater_statements.into_iter().enumerate() {
        body.statements.insert(return_index + offset, statement);
    }

    wrap_return(&ast, body)?;
    let mut jsx_transformer = JsxBindingTransformer {
        ast: &ast,
        scoping,
        source_symbols: &source_symbols,
        item_source_symbols: &item_source_symbols,
        diagnostic: None,
    };
    jsx_transformer.visit_function_body(body);
    if let Some(diagnostic) = jsx_transformer.diagnostic {
        return Err(diagnostic);
    }
    MultiStateReferenceRewriter {
        ast: &ast,
        scoping,
        states: &state_symbols,
    }
    .visit_function_body(body);

    program.body.insert(0, runtime_import(&ast));
    Ok(())
}

#[derive(Clone, Copy)]
struct StateBinding<'a> {
    name: &'a str,
    symbol: SymbolId,
    source: SourceId,
}

#[derive(Clone, Copy)]
struct StateReference<'a> {
    state_name: &'a str,
    setter: bool,
}

fn state_binding_symbols<'a>(
    declarator: &'a VariableDeclarator<'a>,
    sources: &BTreeMap<&str, SourceId>,
) -> Result<Option<(StateBinding<'a>, StateBinding<'a>)>, Diagnostic> {
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return Ok(None);
    };
    let Some(Expression::CallExpression(call)) = &declarator.init else {
        return Ok(None);
    };
    let Expression::Identifier(callee) = &call.callee else {
        return Ok(None);
    };
    if callee.name != "useState" {
        return Ok(None);
    }
    let [
        Some(BindingPattern::BindingIdentifier(value)),
        Some(BindingPattern::BindingIdentifier(setter)),
    ] = pattern.elements.as_slice()
    else {
        return Err(unsupported("useState must bind [value, setter]"));
    };
    let source = sources
        .get(value.name.as_str())
        .copied()
        .ok_or_else(|| unsupported(format!("state {} is absent from analysis", value.name)))?;
    let value_symbol = value
        .symbol_id
        .get()
        .ok_or_else(|| analysis_error(format!("state {} has no semantic symbol", value.name)))?;
    let setter_symbol = setter
        .symbol_id
        .get()
        .ok_or_else(|| analysis_error(format!("setter {} has no semantic symbol", setter.name)))?;
    Ok(Some((
        StateBinding {
            name: value.name.as_str(),
            symbol: value_symbol,
            source,
        },
        StateBinding {
            name: setter.name.as_str(),
            symbol: setter_symbol,
            source,
        },
    )))
}

fn transform_state_declarator<'a>(
    ast: &AstBuilder<'a>,
    declarator: &mut VariableDeclarator<'a>,
    sources: &BTreeMap<&str, SourceId>,
) -> Result<(), Diagnostic> {
    let Some((value, _)) = state_binding_symbols(declarator, sources)? else {
        return Ok(());
    };
    let value_name = atom(ast, value.name);
    let value_source = value.source;
    let Some(Expression::CallExpression(call)) = &declarator.init else {
        unreachable!();
    };
    let [initial] = call.arguments.as_slice() else {
        return Err(unsupported("useState requires exactly one initializer"));
    };
    let initial = initial
        .as_expression()
        .ok_or_else(|| unsupported("spread state initializers are unsupported"))?
        .clone_in_with_semantic_ids(ast.allocator());
    declarator.id = BindingPattern::new_binding_identifier(SPAN, value_name, ast);
    declarator.init = Some(call_name(
        ast,
        CREATE_STATE,
        [
            ident(ast, SCOPE),
            call_name(ast, SOURCE, [number(ast, value_source.get())]),
            initial,
        ],
    ));
    Ok(())
}

fn derived_expressions<'a>(
    body: &FunctionBody<'a>,
    ir: &ComponentIr,
    allocator: &'a Allocator,
) -> BTreeMap<&'a str, Expression<'a>> {
    let derived = ir
        .sources
        .iter()
        .filter(|source| source.kind == SourceKind::Derived)
        .map(|source| source.name.as_str())
        .collect::<Vec<_>>();
    let mut expressions = BTreeMap::new();
    for statement in &body.statements {
        let Statement::VariableDeclaration(declaration) = statement else {
            continue;
        };
        for declarator in &declaration.declarations {
            let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                continue;
            };
            if derived.contains(&identifier.name.as_str())
                && let Some(expression) = &declarator.init
            {
                expressions.insert(
                    allocator.alloc_str(identifier.name.as_str()),
                    expression.clone_in_with_semantic_ids(allocator),
                );
            }
        }
    }
    expressions
}

fn wrap_return<'a>(ast: &AstBuilder<'a>, body: &mut FunctionBody<'a>) -> Result<(), Diagnostic> {
    for statement in &mut body.statements {
        let Statement::ReturnStatement(return_statement) = statement else {
            continue;
        };
        let expression = return_statement
            .argument
            .as_ref()
            .ok_or_else(|| unsupported("compiled component returns no value"))?
            .clone_in_with_semantic_ids(ast.allocator());
        return_statement.argument = Some(call_name(
            ast,
            COMPILED_ROOT,
            [ident(ast, SCOPE), arrow_expression(ast, [], expression)],
        ));
        return Ok(());
    }
    Err(unsupported("compiled component has no return statement"))
}

struct JsxBindingTransformer<'a, 'b, 's> {
    ast: &'b AstBuilder<'a>,
    scoping: &'s Scoping,
    source_symbols: &'s BTreeMap<SymbolId, SourceId>,
    item_source_symbols: &'s BTreeMap<SymbolId, SourceId>,
    diagnostic: Option<Diagnostic>,
}

impl<'a> VisitMut<'a> for JsxBindingTransformer<'a, '_, '_> {
    fn visit_jsx_attribute(&mut self, attribute: &mut JSXAttribute<'a>) {
        let JSXAttributeName::Identifier(name) = &attribute.name else {
            walk_jsx_attribute(self, attribute);
            return;
        };
        if name.name == "key" {
            if let Some(JSXAttributeValue::ExpressionContainer(container)) = &mut attribute.value
                && let Some(expression) = container.expression.as_expression_mut()
            {
                self.visit_expression(expression);
            }
            return;
        }
        if is_event_attribute(name.name.as_str()) {
            if let Some(JSXAttributeValue::ExpressionContainer(container)) = &mut attribute.value
                && let Some(expression) = container.expression.as_expression_mut()
            {
                self.visit_expression(expression);
                let handler = expression.clone_in_with_semantic_ids(self.ast.allocator());
                *expression =
                    call_name(self.ast, COMPILED_EVENT, [ident(self.ast, SCOPE), handler]);
            }
            return;
        }
        walk_jsx_attribute(self, attribute);
    }

    fn visit_jsx_expression_container(&mut self, container: &mut JSXExpressionContainer<'a>) {
        let Some(expression) = container.expression.as_expression_mut() else {
            return;
        };

        if let Expression::LogicalExpression(logical) = expression
            && logical.operator == LogicalOperator::And
        {
            let reads = dependencies(
                &logical.left,
                self.scoping,
                self.source_symbols,
                self.item_source_symbols,
            );
            self.visit_expression(&mut logical.right);
            if reads.is_empty() {
                return;
            }
            let condition = logical
                .left
                .clone_in_with_semantic_ids(self.ast.allocator());
            let render = logical
                .right
                .clone_in_with_semantic_ids(self.ast.allocator());
            let mut arguments = vec![
                ident(self.ast, SCOPE),
                dependency_mask(self.ast, &reads.parent),
                arrow_expression(self.ast, [], condition),
                arrow_expression(self.ast, [], render),
            ];
            append_item_dependency(self.ast, &mut arguments, &reads);
            *expression = call_name(self.ast, WHEN, arguments);
            return;
        }

        if let Some((collection, key, mut render)) = keyed_map(expression, self.ast) {
            let reads = dependencies(
                &collection,
                self.scoping,
                self.source_symbols,
                self.item_source_symbols,
            );
            if !reads.item.is_empty() {
                self.diagnostic = Some(unsupported(
                    "nested keyed collections that depend on an outer item are unsupported",
                ));
                return;
            }
            self.visit_expression(&mut render);
            *expression = call_name(
                self.ast,
                KEYED,
                [
                    ident(self.ast, SCOPE),
                    dependency_mask(self.ast, &reads.parent),
                    arrow_expression(self.ast, [], collection),
                    key,
                    render,
                ],
            );
            return;
        }

        let reads = dependencies(
            expression,
            self.scoping,
            self.source_symbols,
            self.item_source_symbols,
        );
        let contains_reactive_jsx = contains_jsx(expression);
        self.visit_expression(expression);
        if reads.is_empty() {
            return;
        }
        if contains_reactive_jsx {
            self.diagnostic = Some(unsupported(
                "reactive JSX blocks must use a keyed map or an && conditional",
            ));
            return;
        }
        let evaluate = expression.clone_in_with_semantic_ids(self.ast.allocator());
        let mut arguments = vec![
            ident(self.ast, SCOPE),
            dependency_mask(self.ast, &reads.parent),
            arrow_expression(self.ast, [], evaluate),
        ];
        append_item_dependency(self.ast, &mut arguments, &reads);
        *expression = call_name(self.ast, BINDING, arguments);
    }
}

fn is_event_attribute(name: &str) -> bool {
    name.strip_prefix("on")
        .and_then(|suffix| suffix.chars().next())
        .is_some_and(|first| first.is_ascii_uppercase())
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

fn contains_jsx(expression: &Expression<'_>) -> bool {
    let mut finder = JsxFinder::default();
    finder.visit_expression(expression);
    finder.found
}

fn keyed_map<'a>(
    expression: &Expression<'a>,
    ast: &AstBuilder<'a>,
) -> Option<(Expression<'a>, Expression<'a>, Expression<'a>)> {
    let Expression::CallExpression(call) = expression.without_parentheses() else {
        return None;
    };
    let Expression::StaticMemberExpression(member) = &call.callee else {
        return None;
    };
    if member.property.name != "map" {
        return None;
    }
    let [argument] = call.arguments.as_slice() else {
        return None;
    };
    let Expression::ArrowFunctionExpression(render) = argument.as_expression()? else {
        return None;
    };
    if !(1..=2).contains(&render.params.items.len()) {
        return None;
    }
    let key_expression = key_expression(render)?;
    let parameter_names = render
        .params
        .items
        .iter()
        .map(|parameter| match &parameter.pattern {
            BindingPattern::BindingIdentifier(identifier) => Some(identifier.name.as_str()),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()?;
    let key = arrow_expression(
        ast,
        parameter_names,
        key_expression.clone_in(ast.allocator()),
    );
    let mut render = render.clone_in_with_semantic_ids(ast.allocator());
    if render.params.items.len() == 1 {
        append_arrow_parameter(ast, &mut render, ITEM_INDEX);
    }
    append_arrow_parameter(ast, &mut render, ITEM_SCOPE);
    Some((
        member.object.clone_in_with_semantic_ids(ast.allocator()),
        key,
        Expression::ArrowFunctionExpression(render),
    ))
}

fn key_expression<'a>(render: &'a ArrowFunctionExpression<'a>) -> Option<&'a Expression<'a>> {
    let expression = render.body.as_expression()?;
    let Expression::JSXElement(element) = expression.without_parentheses() else {
        return None;
    };
    element.opening_element.attributes.iter().find_map(|item| {
        let JSXAttributeItem::Attribute(attribute) = item else {
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
        container.expression.as_expression()
    })
}

#[derive(Default)]
struct DependencyReads {
    parent: BTreeSet<SourceId>,
    item: BTreeSet<SourceId>,
}

impl DependencyReads {
    fn is_empty(&self) -> bool {
        self.parent.is_empty() && self.item.is_empty()
    }
}

struct DependencyFinder<'s> {
    scoping: &'s Scoping,
    source_symbols: &'s BTreeMap<SymbolId, SourceId>,
    item_source_symbols: &'s BTreeMap<SymbolId, SourceId>,
    reads: DependencyReads,
}

impl<'a> Visit<'a> for DependencyFinder<'_> {
    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        let Some(reference) = identifier.reference_id.get() else {
            return;
        };
        let Some(symbol) = self.scoping.get_reference(reference).symbol_id() else {
            return;
        };
        if let Some(source) = self.source_symbols.get(&symbol) {
            self.reads.parent.insert(*source);
        }
        if let Some(source) = self.item_source_symbols.get(&symbol) {
            self.reads.item.insert(*source);
        }
    }
}

fn dependencies(
    expression: &Expression<'_>,
    scoping: &Scoping,
    source_symbols: &BTreeMap<SymbolId, SourceId>,
    item_source_symbols: &BTreeMap<SymbolId, SourceId>,
) -> DependencyReads {
    let mut finder = DependencyFinder {
        scoping,
        source_symbols,
        item_source_symbols,
        reads: DependencyReads::default(),
    };
    finder.visit_expression(expression);
    finder.reads
}

fn append_item_dependency<'a>(
    ast: &AstBuilder<'a>,
    arguments: &mut Vec<Expression<'a>>,
    reads: &DependencyReads,
) {
    if reads.item.is_empty() {
        return;
    }
    arguments.push(ident(ast, ITEM_SCOPE));
    arguments.push(dependency_mask(ast, &reads.item));
}

fn dependency_mask<'a>(ast: &AstBuilder<'a>, sources: &BTreeSet<SourceId>) -> Expression<'a> {
    mask(ast, &sources.iter().copied().collect::<Vec<_>>())
}

fn item_parameters<'a>(
    body: &FunctionBody<'a>,
    ast: &AstBuilder<'a>,
) -> (
    BTreeMap<SymbolId, SourceId>,
    BTreeMap<SymbolId, StateReference<'a>>,
) {
    let mut collector = ItemParameterCollector {
        ast,
        sources: BTreeMap::new(),
        states: BTreeMap::new(),
    };
    collector.visit_function_body(body);
    (collector.sources, collector.states)
}

struct ItemParameterCollector<'a, 'b> {
    ast: &'b AstBuilder<'a>,
    sources: BTreeMap<SymbolId, SourceId>,
    states: BTreeMap<SymbolId, StateReference<'a>>,
}

impl<'a> Visit<'a> for ItemParameterCollector<'a, '_> {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        let is_map = matches!(
            &call.callee,
            Expression::StaticMemberExpression(member) if member.property.name == "map"
        );
        if is_map
            && let [argument] = call.arguments.as_slice()
            && let Some(Expression::ArrowFunctionExpression(render)) = argument.as_expression()
            && (1..=2).contains(&render.params.items.len())
            && key_expression(render).is_some()
        {
            for (index, parameter) in render.params.items.iter().take(2).enumerate() {
                let BindingPattern::BindingIdentifier(identifier) = &parameter.pattern else {
                    continue;
                };
                let Some(symbol) = identifier.symbol_id.get() else {
                    continue;
                };
                self.sources.insert(symbol, SourceId::new(index as u32));
                self.states.insert(
                    symbol,
                    StateReference {
                        state_name: self.ast.allocator().alloc_str(identifier.name.as_str()),
                        setter: false,
                    },
                );
            }
        }
        walk_call_expression(self, call);
    }
}

struct MultiStateReferenceRewriter<'a, 'b, 's> {
    ast: &'b AstBuilder<'a>,
    scoping: &'s Scoping,
    states: &'s BTreeMap<SymbolId, StateReference<'a>>,
}

impl<'a> VisitMut<'a> for MultiStateReferenceRewriter<'a, '_, '_> {
    fn visit_expression(&mut self, expression: &mut Expression<'a>) {
        let Expression::Identifier(identifier) = expression else {
            walk_expression_mut(self, expression);
            return;
        };
        let Some(reference) = identifier.reference_id.get() else {
            return;
        };
        let Some(symbol) = self.scoping.get_reference(reference).symbol_id() else {
            return;
        };
        let Some(state) = self.states.get(&symbol) else {
            return;
        };
        let member = Expression::from(MemberExpression::new_static_member_expression(
            SPAN,
            ident(self.ast, state.state_name),
            IdentifierName::new(SPAN, if state.setter { "set" } else { "get" }, self.ast),
            false,
            self.ast,
        ));
        *expression = if state.setter {
            member
        } else {
            call(self.ast, member, [])
        };
    }
}

fn register_derived<'a>(
    ast: &AstBuilder<'a>,
    name: &str,
    expression: Expression<'a>,
    reads: &[SourceId],
    writes: &[SourceId],
) -> Statement<'a> {
    let assignment = Statement::new_expression_statement(
        SPAN,
        Expression::new_assignment_expression(
            SPAN,
            oxc_syntax::operator::AssignmentOperator::Assign,
            AssignmentTarget::new_assignment_target_identifier(SPAN, atom(ast, name), ast),
            expression,
            ast,
        ),
        ast,
    );
    let run = arrow_block(ast, [], [assignment]);
    let updater = object(
        ast,
        [
            ("reads", mask(ast, reads)),
            ("writes", mask(ast, writes)),
            ("run", run),
        ],
    );
    Statement::new_expression_statement(
        SPAN,
        call_member(ast, ident(ast, SCOPE), "add", [updater]),
        ast,
    )
}

fn scope_statement<'a>(ast: &AstBuilder<'a>) -> Statement<'a> {
    variable_statement(
        ast,
        VariableDeclarationKind::Const,
        SCOPE,
        call_name(ast, CREATE_SCOPE, []),
    )
}

fn runtime_import<'a>(ast: &AstBuilder<'a>) -> Statement<'a> {
    let names = [
        ("binding", BINDING),
        ("combineSources", COMBINE_SOURCES),
        ("compiledEvent", COMPILED_EVENT),
        ("compiledRoot", COMPILED_ROOT),
        ("createCompiledScope", CREATE_SCOPE),
        ("createCompiledState", CREATE_STATE),
        ("keyed", KEYED),
        ("source", SOURCE),
        ("when", WHEN),
    ];
    let specifiers = oxc_allocator::Vec::from_iter_in(
        names.into_iter().map(|(imported, local)| {
            ImportDeclarationSpecifier::new_import_specifier(
                SPAN,
                ModuleExportName::new_identifier_name(SPAN, atom(ast, imported), ast),
                BindingIdentifier::new(SPAN, atom(ast, local), ast),
                ImportOrExportKind::Value,
                ast,
            )
        }),
        ast,
    );
    Statement::new_import_declaration(
        SPAN,
        Some(specifiers),
        StringLiteral::new(SPAN, "@vidact/runtime", None, ast),
        None,
        None,
        ImportOrExportKind::Value,
        ast,
    )
}

fn component_function_mut<'p, 'a>(
    program: &'p mut Program<'a>,
    name: &str,
) -> Option<&'p mut Function<'a>> {
    program
        .body
        .iter_mut()
        .find_map(|statement| match statement {
            Statement::FunctionDeclaration(function)
                if function.id.as_ref().is_some_and(|id| id.name == name) =>
            {
                Some(function.as_mut())
            }
            Statement::ExportDeclaration(export) => match &mut export.declaration {
                Declaration::FunctionDeclaration(function)
                    if function.id.as_ref().is_some_and(|id| id.name == name) =>
                {
                    Some(function.as_mut())
                }
                _ => None,
            },
            _ => None,
        })
}

fn unsupported(message: impl Into<String>) -> Diagnostic {
    Diagnostic::new(DiagnosticCode::UnsupportedSyntax, message)
}

fn analysis_error(message: impl Into<String>) -> Diagnostic {
    Diagnostic::new(DiagnosticCode::AnalysisFailed, message)
}
