use std::collections::{BTreeMap, BTreeSet};

use oxc_allocator::{Allocator, CloneIn, GetAllocator};
use oxc_ast::{ast::*, builder::AstBuilder};
use oxc_ast_visit::{Visit, VisitMut, walk::walk_call_expression};
use oxc_semantic::Scoping;
use oxc_span::{GetSpan, SPAN, Span};
use oxc_syntax::{reference::ReferenceId, symbol::SymbolId};

use crate::{
    Diagnostic, DiagnosticCode, SourceSpan,
    react_bindings::{ReactBindings, reference_symbol},
};

const GENERATED_PREFIX: &str = "__vidactHook";
const MAX_EXPANSION_PASSES: usize = 100;

pub(crate) struct CustomHookPlan<'a> {
    allocator: &'a Allocator,
    hooks: BTreeMap<SymbolId, HookTemplate<'a>>,
    references: BTreeMap<ReferenceId, SymbolId>,
}

struct HookTemplate<'a> {
    name: String,
    params: Vec<HookParameter>,
    statements: Vec<Statement<'a>>,
    exported: bool,
    span: Span,
}

struct HookParameter {
    symbol: SymbolId,
}

#[derive(Default)]
struct HookCalls {
    primitive: bool,
    local: BTreeSet<SymbolId>,
}

pub(crate) fn plan_local_custom_hooks<'a>(
    allocator: &'a Allocator,
    program: &Program<'a>,
    scoping: &Scoping,
) -> Result<Option<CustomHookPlan<'a>>, Diagnostic> {
    let mut references = BTreeMap::new();
    let mut reference_collector = ReferenceCollector {
        scoping,
        references: &mut references,
        generated_conflict: None,
    };
    reference_collector.visit_program(program);
    let generated_conflict = reference_collector.generated_conflict;

    let candidates = collect_candidates(allocator, program)?;
    if candidates.is_empty() {
        return Ok(None);
    }
    let candidate_symbols = candidates.keys().copied().collect::<BTreeSet<_>>();
    let react = ReactBindings::new(program, scoping);
    let mut calls = BTreeMap::new();
    for (symbol, template) in &candidates {
        let mut finder = HookCallFinder {
            react: &react,
            scoping,
            candidates: &candidate_symbols,
            calls: HookCalls::default(),
        };
        for statement in &template.statements {
            finder.visit_statement(statement);
        }
        calls.insert(*symbol, finder.calls);
    }

    let mut active = calls
        .iter()
        .filter_map(|(symbol, calls)| calls.primitive.then_some(*symbol))
        .collect::<BTreeSet<_>>();
    loop {
        let previous = active.len();
        for (symbol, calls) in &calls {
            if calls.local.iter().any(|callee| active.contains(callee)) {
                active.insert(*symbol);
            }
        }
        if active.len() == previous {
            break;
        }
    }
    if active.is_empty() {
        return Ok(None);
    }
    if let Some(span) = generated_conflict {
        return Err(unsupported_at(
            format!(
                "bindings beginning with {GENERATED_PREFIX} are reserved for custom-hook lowering"
            ),
            span,
        ));
    }

    let hooks = candidates
        .into_iter()
        .filter(|(symbol, _)| active.contains(symbol))
        .collect::<BTreeMap<_, _>>();
    if let Some(template) = hooks.values().find(|template| template.exported) {
        return Err(unsupported_at(
            format!(
                "exported custom hook {} requires the cross-module hook ABI; keep it module-local until dependency-source compilation is enabled",
                template.name
            ),
            template.span,
        ));
    }

    Ok(Some(CustomHookPlan {
        allocator,
        hooks,
        references,
    }))
}

impl CustomHookPlan<'_> {
    pub(crate) fn apply<'a>(self, program: &mut Program<'a>) -> Result<(), Diagnostic>
    where
        Self: 'a,
    {
        let ast = AstBuilder::new(self.allocator);
        let mut invocation = 0_u32;
        for statement in &mut program.body {
            expand_top_level_components(
                &ast,
                statement,
                &self.hooks,
                &self.references,
                &mut invocation,
            )?;
        }
        remove_hook_definitions(program, self.hooks.keys().copied().collect());
        normalize_expanded_binding_spans(program)?;

        let mut residual = ResidualHookReference {
            hooks: &self.hooks,
            references: &self.references,
            span: None,
        };
        residual.visit_program(program);
        if let Some(span) = residual.span {
            return Err(unsupported_at(
                "custom hooks must be called directly and unconditionally in a component or custom-hook body",
                span,
            ));
        }
        Ok(())
    }
}

fn normalize_expanded_binding_spans(program: &mut Program<'_>) -> Result<(), Diagnostic> {
    let mut occupied = BindingSpanCollector {
        starts: BTreeSet::new(),
    };
    occupied.visit_program(program);
    let positions = program
        .source_text
        .char_indices()
        .filter_map(|(start, character)| {
            let start = u32::try_from(start).ok()?;
            (!occupied.starts.contains(&start)).then_some((
                start,
                start
                    + u32::try_from(character.len_utf8()).expect("UTF-8 character width fits u32"),
            ))
        })
        .collect();
    let mut normalizer = BindingSpanNormalizer {
        positions,
        failed: None,
    };
    normalizer.visit_program(program);
    normalizer.failed.map_or(Ok(()), |span| {
        Err(Diagnostic::new(
            DiagnosticCode::AnalysisFailed,
            "custom-hook expansion exhausted source positions for unique declaration identities",
        )
        .with_span(SourceSpan::from_oxc(span)))
    })
}

fn collect_candidates<'a>(
    allocator: &'a Allocator,
    program: &Program<'a>,
) -> Result<BTreeMap<SymbolId, HookTemplate<'a>>, Diagnostic> {
    let mut candidates = BTreeMap::new();
    for statement in &program.body {
        match statement {
            Statement::FunctionDeclaration(function) => {
                collect_function_candidate(allocator, function, false, &mut candidates)?;
            }
            Statement::VariableDeclaration(declaration) => {
                collect_variable_candidates(allocator, declaration, false, &mut candidates)?;
            }
            Statement::ExportDeclaration(export) => match &export.declaration {
                Declaration::FunctionDeclaration(function) => {
                    collect_function_candidate(allocator, function, true, &mut candidates)?;
                }
                Declaration::VariableDeclaration(declaration) => {
                    collect_variable_candidates(allocator, declaration, true, &mut candidates)?;
                }
                _ => {}
            },
            _ => {}
        }
    }
    Ok(candidates)
}

fn collect_function_candidate<'a>(
    allocator: &'a Allocator,
    function: &Function<'a>,
    exported: bool,
    candidates: &mut BTreeMap<SymbolId, HookTemplate<'a>>,
) -> Result<(), Diagnostic> {
    let Some(identifier) = &function.id else {
        return Ok(());
    };
    if !is_hook_name(identifier.name.as_str()) {
        return Ok(());
    }
    let Some(symbol) = identifier.symbol_id.get() else {
        return Ok(());
    };
    let Some(body) = &function.body else {
        return Ok(());
    };
    candidates.insert(
        symbol,
        hook_template(
            allocator,
            identifier.name.as_str(),
            function.params.as_ref(),
            body.as_ref(),
            exported,
            function.span,
        )?,
    );
    Ok(())
}

fn collect_variable_candidates<'a>(
    allocator: &'a Allocator,
    declaration: &VariableDeclaration<'a>,
    exported: bool,
    candidates: &mut BTreeMap<SymbolId, HookTemplate<'a>>,
) -> Result<(), Diagnostic> {
    for declarator in &declaration.declarations {
        let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
            continue;
        };
        if !is_hook_name(identifier.name.as_str()) {
            continue;
        }
        let Some(symbol) = identifier.symbol_id.get() else {
            continue;
        };
        let Some(initializer) = &declarator.init else {
            continue;
        };
        let (params, body, span) = match initializer.without_parentheses() {
            Expression::ArrowFunctionExpression(function) => {
                let Some(body) = function.body.as_function_body() else {
                    return Err(unsupported_at(
                        "custom hook arrows require a block body",
                        function.span,
                    ));
                };
                (function.params.as_ref(), body, function.span)
            }
            Expression::FunctionExpression(function) => {
                let Some(body) = &function.body else {
                    continue;
                };
                (function.params.as_ref(), body.as_ref(), function.span)
            }
            _ => continue,
        };
        candidates.insert(
            symbol,
            hook_template(
                allocator,
                identifier.name.as_str(),
                params,
                body,
                exported,
                span,
            )?,
        );
    }
    Ok(())
}

fn hook_template<'a>(
    allocator: &'a Allocator,
    name: &str,
    params: &FormalParameters<'a>,
    body: &FunctionBody<'a>,
    exported: bool,
    span: Span,
) -> Result<HookTemplate<'a>, Diagnostic> {
    if params.rest.is_some() {
        return Err(unsupported_at(
            "custom hook rest parameters are unsupported",
            params.span,
        ));
    }
    let mut parameters = Vec::with_capacity(params.items.len());
    for parameter in &params.items {
        let BindingPattern::BindingIdentifier(identifier) = &parameter.pattern else {
            return Err(unsupported_at(
                "custom hook parameters must be identifiers",
                parameter.pattern.span(),
            ));
        };
        if parameter.initializer.is_some() || parameter.optional {
            return Err(unsupported_at(
                "custom hook default and optional parameters are not yet supported",
                parameter.span,
            ));
        }
        let symbol = identifier.symbol_id.get().ok_or_else(|| {
            Diagnostic::new(
                DiagnosticCode::AnalysisFailed,
                format!(
                    "custom hook parameter {} has no semantic symbol",
                    identifier.name
                ),
            )
            .with_span(SourceSpan::from_oxc(identifier.span))
        })?;
        parameters.push(HookParameter { symbol });
    }
    Ok(HookTemplate {
        name: name.to_string(),
        params: parameters,
        statements: body
            .statements
            .iter()
            .map(|statement| statement.clone_in_with_semantic_ids(allocator))
            .collect(),
        exported,
        span,
    })
}

fn expand_body<'a>(
    ast: &AstBuilder<'a>,
    body: &mut FunctionBody<'a>,
    hooks: &BTreeMap<SymbolId, HookTemplate<'a>>,
    references: &BTreeMap<ReferenceId, SymbolId>,
    invocation: &mut u32,
) -> Result<(), Diagnostic> {
    for pass in 0..MAX_EXPANSION_PASSES {
        let mut changed = false;
        let mut next = oxc_allocator::Vec::new_in(ast);
        for statement in body.statements.drain(..) {
            if let Some(expansion) =
                expand_statement(ast, &statement, hooks, references, invocation)?
            {
                next.extend(expansion);
                changed = true;
            } else {
                next.push(statement);
            }
        }
        body.statements = next;
        if !changed {
            return Ok(());
        }
        if pass + 1 == MAX_EXPANSION_PASSES {
            let span = body.span;
            return Err(unsupported_at(
                "recursive custom hooks are unsupported",
                span,
            ));
        }
    }
    unreachable!()
}

fn expand_statement<'a>(
    ast: &AstBuilder<'a>,
    statement: &Statement<'a>,
    hooks: &BTreeMap<SymbolId, HookTemplate<'a>>,
    references: &BTreeMap<ReferenceId, SymbolId>,
    invocation: &mut u32,
) -> Result<Option<Vec<Statement<'a>>>, Diagnostic> {
    let (binding, call) = match statement {
        Statement::VariableDeclaration(declaration) => {
            let [declarator] = declaration.declarations.as_slice() else {
                return Ok(None);
            };
            let Some(Expression::CallExpression(call)) = &declarator.init else {
                return Ok(None);
            };
            (Some(&declarator.id), call.as_ref())
        }
        Statement::ExpressionStatement(expression) => {
            let Expression::CallExpression(call) = expression.expression.without_parentheses()
            else {
                return Ok(None);
            };
            (None, call.as_ref())
        }
        _ => return Ok(None),
    };
    let Some(symbol) = direct_callee_symbol(call, references) else {
        return Ok(None);
    };
    let Some(template) = hooks.get(&symbol) else {
        return Ok(None);
    };
    if call.arguments.iter().any(Argument::is_spread) {
        return Err(unsupported_at(
            "custom hook calls do not support spread arguments",
            call.span,
        ));
    }
    if call.arguments.len() != template.params.len() {
        return Err(unsupported_at(
            format!(
                "custom hook {} expects {} arguments, received {}",
                template.name,
                template.params.len(),
                call.arguments.len()
            ),
            call.span,
        ));
    }

    let id = *invocation;
    *invocation += 1;
    let mut names = BTreeMap::<SymbolId, &'a str>::new();
    let mut collector = BindingCollector {
        symbols: Vec::new(),
    };
    for statement in &template.statements {
        collector.visit_statement(statement);
    }
    for (ordinal, (symbol, name, _)) in collector.symbols.into_iter().enumerate() {
        names.entry(symbol).or_insert_with(|| {
            ast.allocator()
                .alloc_str(&format!("{GENERATED_PREFIX}{id}_{ordinal}_{name}"))
        });
    }

    let mut substitutions = BTreeMap::<SymbolId, Expression<'a>>::new();
    for (parameter, argument) in template.params.iter().zip(&call.arguments) {
        let expression = argument
            .as_expression()
            .expect("spread arguments were rejected")
            .clone_in_with_semantic_ids(ast.allocator());
        if !is_supported_hook_argument(&expression) {
            return Err(unsupported_at(
                "custom hook arguments must be identifiers or primitive literals so reactive inputs remain live without duplicating side effects",
                expression.span(),
            ));
        }
        substitutions.insert(parameter.symbol, expression);
    }

    let mut expanded = Vec::new();
    let mut statements = template
        .statements
        .iter()
        .map(|statement| statement.clone_in_with_semantic_ids(ast.allocator()))
        .collect::<Vec<_>>();
    let return_expression = take_final_return(&mut statements, binding.is_some(), template.span)?;
    let mut rewriter = HygieneRewriter {
        ast,
        names: &names,
        substitutions: &substitutions,
        references,
        expansion_span: call.span,
    };
    for statement in &mut statements {
        rewriter.visit_statement(statement);
    }
    let return_expression = return_expression.map(|mut expression| {
        rewriter.visit_expression(&mut expression);
        expression
    });
    expanded.extend(statements);

    match (binding, return_expression) {
        (Some(binding), Some(expression)) => {
            expand_return_binding(ast, binding, expression, id, &mut expanded)?;
        }
        (Some(_), None) => {
            return Err(unsupported_at(
                format!(
                    "custom hook {} must return a value at this call site",
                    template.name
                ),
                call.span,
            ));
        }
        (None, Some(expression)) => {
            expanded.push(Statement::new_expression_statement(SPAN, expression, ast));
        }
        (None, None) => {}
    }
    Ok(Some(expanded))
}

fn take_final_return<'a>(
    statements: &mut Vec<Statement<'a>>,
    required: bool,
    hook_span: Span,
) -> Result<Option<Expression<'a>>, Diagnostic> {
    let mut returns = ReturnCollector { spans: Vec::new() };
    for statement in statements.iter() {
        returns.visit_statement(statement);
    }
    if returns.spans.is_empty() {
        return Ok(None);
    }
    let Some(Statement::ReturnStatement(statement)) = statements.last() else {
        return Err(unsupported_at(
            "custom hooks must use one final top-level return",
            returns.spans[0],
        ));
    };
    if returns.spans.len() != 1 {
        return Err(unsupported_at(
            "custom hooks must use one final top-level return",
            returns.spans[0],
        ));
    }
    if required && statement.argument.is_none() {
        return Err(unsupported_at(
            "a value-producing custom hook cannot use a bare return",
            hook_span,
        ));
    }
    let Some(Statement::ReturnStatement(mut statement)) = statements.pop() else {
        unreachable!();
    };
    Ok(statement.argument.take())
}

fn expand_return_binding<'a>(
    ast: &AstBuilder<'a>,
    pattern: &BindingPattern<'a>,
    expression: Expression<'a>,
    invocation: u32,
    statements: &mut Vec<Statement<'a>>,
) -> Result<(), Diagnostic> {
    if let BindingPattern::BindingIdentifier(identifier) = pattern {
        statements.push(variable_statement(
            ast,
            identifier.name.as_str(),
            identifier.span,
            expression,
        ));
        return Ok(());
    }
    let result_name = ast
        .allocator()
        .alloc_str(&format!("{GENERATED_PREFIX}{invocation}Result"));
    statements.push(generated_variable_statement(
        ast,
        result_name,
        expression,
        pattern.span(),
    ));
    let mut leaves = Vec::new();
    collect_binding_paths(pattern, Vec::new(), &mut leaves)?;
    for (identifier, span, path) in leaves {
        let value =
            path.into_iter()
                .fold(identifier_expression(ast, result_name), |object, key| {
                    Expression::from(MemberExpression::new_computed_member_expression(
                        SPAN,
                        object,
                        match key {
                            BindingKey::Index(index) => Expression::new_numeric_literal(
                                SPAN,
                                index as f64,
                                None,
                                NumberBase::Decimal,
                                ast,
                            ),
                            BindingKey::Property(name) => Expression::new_string_literal(
                                SPAN,
                                ast.allocator().alloc_str(&name),
                                None,
                                ast,
                            ),
                        },
                        false,
                        ast,
                    ))
                });
        statements.push(variable_statement(ast, &identifier, span, value));
    }
    Ok(())
}

enum BindingKey {
    Index(usize),
    Property(String),
}

fn collect_binding_paths<'a>(
    pattern: &BindingPattern<'a>,
    path: Vec<BindingKey>,
    leaves: &mut Vec<(String, Span, Vec<BindingKey>)>,
) -> Result<(), Diagnostic> {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => {
            leaves.push((identifier.name.to_string(), identifier.span, path));
            Ok(())
        }
        BindingPattern::ArrayPattern(array) => {
            if array.rest.is_some() {
                return Err(unsupported_at(
                    "custom hook result rest bindings are unsupported",
                    array.span,
                ));
            }
            for (index, element) in array.elements.iter().enumerate() {
                if let Some(element) = element {
                    let mut nested = clone_path(&path);
                    nested.push(BindingKey::Index(index));
                    collect_binding_paths(element, nested, leaves)?;
                }
            }
            Ok(())
        }
        BindingPattern::ObjectPattern(object) => {
            if object.rest.is_some() {
                return Err(unsupported_at(
                    "custom hook result rest bindings are unsupported",
                    object.span,
                ));
            }
            for property in &object.properties {
                if property.computed {
                    return Err(unsupported_at(
                        "computed custom hook result bindings are unsupported",
                        property.span,
                    ));
                }
                let Some(name) = property.key.static_name() else {
                    return Err(unsupported_at(
                        "dynamic custom hook result bindings are unsupported",
                        property.span,
                    ));
                };
                let mut nested = clone_path(&path);
                nested.push(BindingKey::Property(name.to_string()));
                collect_binding_paths(&property.value, nested, leaves)?;
            }
            Ok(())
        }
        BindingPattern::AssignmentPattern(assignment) => Err(unsupported_at(
            "custom hook result defaults are unsupported",
            assignment.span,
        )),
    }
}

fn clone_path(path: &[BindingKey]) -> Vec<BindingKey> {
    path.iter()
        .map(|key| match key {
            BindingKey::Index(index) => BindingKey::Index(*index),
            BindingKey::Property(name) => BindingKey::Property(name.clone()),
        })
        .collect()
}

fn variable_statement<'a>(
    ast: &AstBuilder<'a>,
    name: &str,
    span: Span,
    initializer: Expression<'a>,
) -> Statement<'a> {
    generated_variable_statement(ast, name, initializer, span)
}

fn generated_variable_statement<'a>(
    ast: &AstBuilder<'a>,
    name: &str,
    initializer: Expression<'a>,
    span: Span,
) -> Statement<'a> {
    let declarator = VariableDeclarator::new(
        span,
        VariableDeclarationKind::Const,
        BindingPattern::new_binding_identifier(span, ast.allocator().alloc_str(name), ast),
        None,
        Some(initializer),
        false,
        ast,
    );
    Statement::from(Declaration::new_variable_declaration(
        span,
        VariableDeclarationKind::Const,
        oxc_allocator::Vec::from_array_in([declarator], ast),
        false,
        ast,
    ))
}

fn identifier_expression<'a>(ast: &AstBuilder<'a>, name: &str) -> Expression<'a> {
    Expression::new_identifier(SPAN, ast.allocator().alloc_str(name), ast)
}

fn direct_callee_symbol(
    call: &CallExpression<'_>,
    references: &BTreeMap<ReferenceId, SymbolId>,
) -> Option<SymbolId> {
    let Expression::Identifier(identifier) = call.callee.without_parentheses() else {
        return None;
    };
    identifier
        .reference_id
        .get()
        .and_then(|reference| references.get(&reference).copied())
}

fn is_supported_hook_argument(expression: &Expression<'_>) -> bool {
    matches!(
        expression.without_parentheses(),
        Expression::Identifier(_)
            | Expression::BooleanLiteral(_)
            | Expression::NullLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::BigIntLiteral(_)
            | Expression::StringLiteral(_)
    )
}

fn expand_top_level_components<'a>(
    ast: &AstBuilder<'a>,
    statement: &mut Statement<'a>,
    hooks: &BTreeMap<SymbolId, HookTemplate<'a>>,
    references: &BTreeMap<ReferenceId, SymbolId>,
    invocation: &mut u32,
) -> Result<(), Diagnostic> {
    match statement {
        Statement::FunctionDeclaration(function) => {
            expand_function_component(ast, function, hooks, references, invocation)?;
        }
        Statement::VariableDeclaration(declaration) => {
            expand_variable_components(ast, declaration, hooks, references, invocation)?;
        }
        Statement::ExportDeclaration(export) => match &mut export.declaration {
            Declaration::FunctionDeclaration(function) => {
                expand_function_component(ast, function, hooks, references, invocation)?;
            }
            Declaration::VariableDeclaration(declaration) => {
                expand_variable_components(ast, declaration, hooks, references, invocation)?;
            }
            _ => {}
        },
        Statement::ExportDefaultDeclaration(export) => match &mut export.declaration {
            ExportDefaultDeclarationKind::FunctionDeclaration(function) => {
                expand_function_component(ast, function, hooks, references, invocation)?;
            }
            ExportDefaultDeclarationKind::ArrowFunctionExpression(function) => {
                if let Some(body) = function.body.as_function_body_mut() {
                    expand_body(ast, body, hooks, references, invocation)?;
                }
            }
            ExportDefaultDeclarationKind::FunctionExpression(function) => {
                if let Some(body) = function.body.as_deref_mut() {
                    expand_body(ast, body, hooks, references, invocation)?;
                }
            }
            _ => {}
        },
        _ => {}
    }
    Ok(())
}

fn expand_function_component<'a>(
    ast: &AstBuilder<'a>,
    function: &mut Function<'a>,
    hooks: &BTreeMap<SymbolId, HookTemplate<'a>>,
    references: &BTreeMap<ReferenceId, SymbolId>,
    invocation: &mut u32,
) -> Result<(), Diagnostic> {
    if function
        .id
        .as_ref()
        .is_some_and(|identifier| is_component_name(identifier.name.as_str()))
        && let Some(body) = function.body.as_deref_mut()
    {
        expand_body(ast, body, hooks, references, invocation)?;
    }
    Ok(())
}

fn expand_variable_components<'a>(
    ast: &AstBuilder<'a>,
    declaration: &mut VariableDeclaration<'a>,
    hooks: &BTreeMap<SymbolId, HookTemplate<'a>>,
    references: &BTreeMap<ReferenceId, SymbolId>,
    invocation: &mut u32,
) -> Result<(), Diagnostic> {
    for declarator in &mut declaration.declarations {
        let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
            continue;
        };
        if !is_component_name(identifier.name.as_str()) {
            continue;
        }
        let Some(initializer) = declarator.init.as_mut() else {
            continue;
        };
        let body = match initializer.without_parentheses_mut() {
            Expression::ArrowFunctionExpression(function) => function.body.as_function_body_mut(),
            Expression::FunctionExpression(function) => function.body.as_deref_mut(),
            _ => None,
        };
        if let Some(body) = body {
            expand_body(ast, body, hooks, references, invocation)?;
        }
    }
    Ok(())
}

fn remove_hook_definitions(program: &mut Program<'_>, hooks: BTreeSet<SymbolId>) {
    program.body.retain_mut(|statement| match statement {
        Statement::FunctionDeclaration(function) => function
            .id
            .as_ref()
            .and_then(|identifier| identifier.symbol_id.get())
            .is_none_or(|symbol| !hooks.contains(&symbol)),
        Statement::VariableDeclaration(declaration) => {
            retain_non_hook_declarators(declaration, &hooks);
            !declaration.declarations.is_empty()
        }
        Statement::ExportDeclaration(export) => match &mut export.declaration {
            Declaration::FunctionDeclaration(function) => function
                .id
                .as_ref()
                .and_then(|identifier| identifier.symbol_id.get())
                .is_none_or(|symbol| !hooks.contains(&symbol)),
            Declaration::VariableDeclaration(declaration) => {
                retain_non_hook_declarators(declaration, &hooks);
                !declaration.declarations.is_empty()
            }
            _ => true,
        },
        _ => true,
    });
}

fn retain_non_hook_declarators(
    declaration: &mut VariableDeclaration<'_>,
    hooks: &BTreeSet<SymbolId>,
) {
    declaration.declarations.retain(|declarator| {
        let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
            return true;
        };
        identifier
            .symbol_id
            .get()
            .is_none_or(|symbol| !hooks.contains(&symbol))
    });
}

fn is_hook_name(name: &str) -> bool {
    name.strip_prefix("use")
        .and_then(|suffix| suffix.chars().next())
        .is_some_and(|character| character.is_ascii_uppercase() || character.is_ascii_digit())
}

fn is_component_name(name: &str) -> bool {
    name.chars().next().is_some_and(char::is_uppercase)
}

fn unsupported_at(message: impl Into<String>, span: Span) -> Diagnostic {
    Diagnostic::new(DiagnosticCode::UnsupportedSyntax, message)
        .with_span(SourceSpan::from_oxc(span))
}

struct ReferenceCollector<'s, 'r> {
    scoping: &'s Scoping,
    references: &'r mut BTreeMap<ReferenceId, SymbolId>,
    generated_conflict: Option<Span>,
}

struct BindingSpanCollector {
    starts: BTreeSet<u32>,
}

impl<'a> Visit<'a> for BindingSpanCollector {
    fn visit_binding_identifier(&mut self, identifier: &BindingIdentifier<'a>) {
        if identifier.span.end > identifier.span.start
            && !identifier.name.starts_with(GENERATED_PREFIX)
        {
            self.starts.insert(identifier.span.start);
        }
    }
}

struct BindingSpanNormalizer {
    positions: Vec<(u32, u32)>,
    failed: Option<Span>,
}

impl<'a> VisitMut<'a> for BindingSpanNormalizer {
    fn visit_binding_identifier(&mut self, identifier: &mut BindingIdentifier<'a>) {
        if self.failed.is_some()
            || (identifier.span.end > identifier.span.start
                && !identifier.name.starts_with(GENERATED_PREFIX))
        {
            return;
        }
        if self.positions.is_empty() {
            self.failed = Some(identifier.span);
            return;
        }
        let preferred = identifier.span.start;
        let index = self
            .positions
            .partition_point(|(start, _)| *start < preferred)
            .min(self.positions.len() - 1);
        let (start, end) = self.positions.remove(index);
        identifier.span = Span::new(start, end);
    }
}

impl<'a> Visit<'a> for ReferenceCollector<'_, '_> {
    fn visit_binding_identifier(&mut self, identifier: &BindingIdentifier<'a>) {
        if self.generated_conflict.is_none() && identifier.name.starts_with(GENERATED_PREFIX) {
            self.generated_conflict = Some(identifier.span);
        }
    }

    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        if let Some(reference) = identifier.reference_id.get()
            && let Some(symbol) = self.scoping.get_reference(reference).symbol_id()
        {
            self.references.insert(reference, symbol);
        }
    }
}

struct HookCallFinder<'r, 's> {
    react: &'r ReactBindings<'s>,
    scoping: &'s Scoping,
    candidates: &'r BTreeSet<SymbolId>,
    calls: HookCalls,
}

impl<'a> Visit<'a> for HookCallFinder<'_, '_> {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if self.react.state_hook_call(call).is_some()
            || self.react.effect_hook_call(call).is_some()
            || self.react.memo_hook_call(call).is_some()
            || self.react.context_hook_call(call).is_some()
            || self.react.is_sync_external_store_call(call)
            || self.react.is_effect_event_call(call)
            || self.react.is_id_call(call)
            || self.react.is_imperative_handle_call(call)
            || self.react.is_named_expression(&call.callee, "useRef")
        {
            self.calls.primitive = true;
        } else if let Expression::Identifier(identifier) = call.callee.without_parentheses()
            && let Some(symbol) = reference_symbol(identifier, self.scoping)
            && self.candidates.contains(&symbol)
        {
            self.calls.local.insert(symbol);
        }
        walk_call_expression(self, call);
    }
}

struct BindingCollector {
    symbols: Vec<(SymbolId, String, Span)>,
}

impl<'a> Visit<'a> for BindingCollector {
    fn visit_binding_identifier(&mut self, identifier: &BindingIdentifier<'a>) {
        if let Some(symbol) = identifier.symbol_id.get() {
            self.symbols
                .push((symbol, identifier.name.to_string(), identifier.span));
        }
    }
}

struct HygieneRewriter<'a, 'r> {
    ast: &'r AstBuilder<'a>,
    names: &'r BTreeMap<SymbolId, &'a str>,
    substitutions: &'r BTreeMap<SymbolId, Expression<'a>>,
    references: &'r BTreeMap<ReferenceId, SymbolId>,
    expansion_span: Span,
}

impl<'a> VisitMut<'a> for HygieneRewriter<'a, '_> {
    fn visit_expression(&mut self, expression: &mut Expression<'a>) {
        let Expression::Identifier(identifier) = expression else {
            oxc_ast_visit::walk_mut::walk_expression(self, expression);
            return;
        };
        let Some(symbol) = identifier
            .reference_id
            .get()
            .and_then(|reference| self.references.get(&reference))
        else {
            return;
        };
        if let Some(replacement) = self.substitutions.get(symbol) {
            *expression = replacement.clone_in_with_semantic_ids(self.ast.allocator());
        } else if let Some(name) = self.names.get(symbol) {
            identifier.name = self.ast.allocator().alloc_str(name).into();
        }
    }

    fn visit_binding_identifier(&mut self, identifier: &mut BindingIdentifier<'a>) {
        let Some(symbol) = identifier.symbol_id.get() else {
            return;
        };
        if let Some(name) = self.names.get(&symbol) {
            identifier.name = self.ast.allocator().alloc_str(name).into();
            identifier.span = self.expansion_span;
        }
    }

    fn visit_identifier_reference(&mut self, identifier: &mut IdentifierReference<'a>) {
        let Some(symbol) = identifier
            .reference_id
            .get()
            .and_then(|reference| self.references.get(&reference))
        else {
            return;
        };
        if let Some(name) = self.names.get(symbol) {
            identifier.name = self.ast.allocator().alloc_str(name).into();
        }
    }
}

struct ReturnCollector {
    spans: Vec<Span>,
}

impl<'a> Visit<'a> for ReturnCollector {
    fn visit_return_statement(&mut self, statement: &ReturnStatement<'a>) {
        self.spans.push(statement.span);
    }

    fn visit_function(&mut self, _function: &Function<'a>, _flags: oxc_syntax::scope::ScopeFlags) {}

    fn visit_arrow_function_expression(&mut self, _function: &ArrowFunctionExpression<'a>) {}
}

struct ResidualHookReference<'h, 'r, 'a> {
    hooks: &'h BTreeMap<SymbolId, HookTemplate<'a>>,
    references: &'r BTreeMap<ReferenceId, SymbolId>,
    span: Option<Span>,
}

impl<'a> Visit<'a> for ResidualHookReference<'_, '_, 'a> {
    fn visit_identifier_reference(&mut self, identifier: &IdentifierReference<'a>) {
        if self.span.is_some() {
            return;
        }
        if identifier
            .reference_id
            .get()
            .and_then(|reference| self.references.get(&reference))
            .is_some_and(|symbol| self.hooks.contains_key(symbol))
        {
            self.span = Some(identifier.span);
        }
    }
}
