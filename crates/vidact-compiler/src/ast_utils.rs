use std::collections::{BTreeMap, BTreeSet};

use oxc_allocator::{Allocator, CloneIn, GetAllocator, TakeIn};
use oxc_ast::{
    ast::{
        Argument, ArrayExpressionElement, ArrowFunctionBody, ArrowFunctionExpression,
        AssignmentExpression, AssignmentTarget, BindingPattern, CallExpression, Declaration,
        ExportDefaultDeclarationKind, Expression, FormalParameterKind, FormalParameters, Function,
        FunctionBody, JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXChild, JSXElement,
        JSXElementName, JSXMemberExpressionObject, MemberExpression, Program, Statement,
        VariableDeclaration, VariableDeclarator,
    },
    builder::AstBuilder,
};
use oxc_ast_visit::{
    Visit, VisitMut,
    walk::{
        walk_assignment_expression as walk_assignment_expression_read,
        walk_statement as walk_statement_read,
        walk_variable_declarator as walk_variable_declarator_read,
    },
    walk_mut::{
        walk_arrow_function_expression, walk_assignment_expression, walk_call_expression,
        walk_function, walk_statement, walk_variable_declarator,
    },
};
use oxc_semantic::Scoping;
use oxc_span::{GetSpan, SPAN};
use oxc_syntax::{
    operator::{AssignmentOperator, BinaryOperator, UnaryOperator},
    scope::ScopeFlags,
    symbol::SymbolId,
};

use crate::{
    SourceSpan,
    react_bindings::{ReactBindings, reference_symbol},
};

const RUN_WITH_CONTEXT: &str = "__vidactRunWithContext";
pub(crate) const OBJECT_REST: &str = "__vidactObjectRest";

pub(crate) fn normalize_simple_logical_assignments<'a>(
    allocator: &'a Allocator,
    program: &mut Program<'a>,
) -> bool {
    let mut normalizer = SimpleLogicalAssignmentNormalizer {
        ast: AstBuilder::new(allocator),
        changed: false,
    };
    normalizer.visit_program(program);
    normalizer.changed
}

struct SimpleLogicalAssignmentNormalizer<'a> {
    ast: AstBuilder<'a>,
    changed: bool,
}

impl<'a> VisitMut<'a> for SimpleLogicalAssignmentNormalizer<'a> {
    fn visit_statement(&mut self, statement: &mut Statement<'a>) {
        let Statement::ExpressionStatement(expression_statement) = statement else {
            walk_statement(self, statement);
            return;
        };
        let Expression::AssignmentExpression(assignment) = &expression_statement.expression else {
            walk_statement(self, statement);
            return;
        };
        if assignment.operator != AssignmentOperator::LogicalOr {
            walk_statement(self, statement);
            return;
        }
        let AssignmentTarget::AssignmentTargetIdentifier(identifier) = &assignment.left else {
            walk_statement(self, statement);
            return;
        };
        let span = assignment.span;
        let name = self.ast.allocator().alloc_str(identifier.name.as_str());
        let owned = statement.take_in(&self.ast);
        let Statement::ExpressionStatement(expression_statement) = owned else {
            unreachable!();
        };
        let Expression::AssignmentExpression(assignment) = expression_statement.unbox().expression
        else {
            unreachable!();
        };
        let assignment = assignment.unbox();
        let test = Expression::new_unary_expression(
            span,
            UnaryOperator::LogicalNot,
            Expression::new_identifier(span, name, &self.ast),
            &self.ast,
        );
        let write = Expression::new_assignment_expression(
            span,
            AssignmentOperator::Assign,
            assignment.left,
            assignment.right,
            &self.ast,
        );
        *statement = Statement::new_if_statement(
            span,
            test,
            Statement::new_expression_statement(span, write, &self.ast),
            None,
            &self.ast,
        );
        self.changed = true;
    }
}

pub(crate) fn normalize_identifier_object_destructuring<'a>(
    allocator: &'a Allocator,
    program: &mut Program<'a>,
) -> bool {
    let mut normalizer = IdentifierObjectDestructuringNormalizer {
        ast: AstBuilder::new(allocator),
        changed: false,
    };
    normalizer.visit_program(program);
    normalizer.changed
}

struct IdentifierObjectDestructuringNormalizer<'a> {
    ast: AstBuilder<'a>,
    changed: bool,
}

impl<'a> IdentifierObjectDestructuringNormalizer<'a> {
    fn normalize_body(&mut self, parameters: &FormalParameters<'a>, body: &mut FunctionBody<'a>) {
        let parameter = parameters.items.first().and_then(|parameter| {
            let BindingPattern::BindingIdentifier(identifier) = &parameter.pattern else {
                return None;
            };
            Some(identifier.name.to_string())
        });
        let mut next = oxc_allocator::Vec::new_in(&self.ast);
        for statement in body.statements.drain(..) {
            let Some(flattened) =
                flatten_identifier_object_statement(&self.ast, &statement, parameter.as_deref())
            else {
                next.push(statement);
                continue;
            };
            next.extend(flattened);
            self.changed = true;
        }
        body.statements = next;
    }
}

impl<'a> VisitMut<'a> for IdentifierObjectDestructuringNormalizer<'a> {
    fn visit_function(&mut self, function: &mut Function<'a>, flags: ScopeFlags) {
        if let Some(body) = &mut function.body {
            self.normalize_body(&function.params, body);
        }
        walk_function(self, function, flags);
    }

    fn visit_arrow_function_expression(&mut self, function: &mut ArrowFunctionExpression<'a>) {
        if let Some(body) = function.body.as_function_body_mut() {
            self.normalize_body(&function.params, body);
        }
        walk_arrow_function_expression(self, function);
    }
}

fn flatten_identifier_object_statement<'a>(
    ast: &AstBuilder<'a>,
    statement: &Statement<'a>,
    object_parameter: Option<&str>,
) -> Option<Vec<Statement<'a>>> {
    let Statement::VariableDeclaration(declaration) = statement else {
        return None;
    };
    let [declarator] = declaration.declarations.as_slice() else {
        return None;
    };
    let BindingPattern::ObjectPattern(pattern) = &declarator.id else {
        return None;
    };
    let Expression::Identifier(initializer) = declarator.init.as_ref()?.without_parentheses()
    else {
        return None;
    };
    let input_name = initializer.name.to_string();
    if object_parameter != Some(input_name.as_str()) {
        return None;
    }

    let mut excluded = Vec::with_capacity(pattern.properties.len());
    let mut statements =
        Vec::with_capacity(pattern.properties.len() + usize::from(pattern.rest.is_some()));
    for (property_index, property) in pattern.properties.iter().enumerate() {
        if property.computed {
            return None;
        }
        let name = property.key.static_name()?.to_string();
        let value = Expression::from(MemberExpression::new_computed_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, ast.allocator().alloc_str(&input_name), ast),
            Expression::new_string_literal(SPAN, ast.allocator().alloc_str(&name), None, ast),
            false,
            ast,
        ));
        let (binding, value) = match &property.value {
            BindingPattern::BindingIdentifier(identifier) => (
                BindingPattern::BindingIdentifier(
                    identifier.clone_in_with_semantic_ids(ast.allocator()),
                ),
                value,
            ),
            BindingPattern::AssignmentPattern(assignment) => {
                let BindingPattern::BindingIdentifier(identifier) = &assignment.left else {
                    return None;
                };
                let temporary_name = format!(
                    "__vidactDestructured{}_{property_index}",
                    declarator.span.start
                );
                let temporary_name = ast.allocator().alloc_str(&temporary_name);
                statements.push(direct_parameter_variable_statement(
                    ast,
                    BindingPattern::new_binding_identifier(SPAN, temporary_name, ast),
                    value,
                    declarator.span,
                ));
                let value = Expression::new_identifier(SPAN, temporary_name, ast);
                let test = Expression::new_binary_expression(
                    SPAN,
                    value.clone_in_with_semantic_ids(ast.allocator()),
                    BinaryOperator::StrictEquality,
                    Expression::new_identifier(SPAN, "undefined", ast),
                    ast,
                );
                (
                    BindingPattern::BindingIdentifier(
                        identifier.clone_in_with_semantic_ids(ast.allocator()),
                    ),
                    Expression::new_conditional_expression(
                        SPAN,
                        test,
                        assignment.right.clone_in_with_semantic_ids(ast.allocator()),
                        value,
                        ast,
                    ),
                )
            }
            _ => return None,
        };
        excluded.push(name);
        statements.push(direct_parameter_variable_statement(
            ast,
            binding,
            value,
            declarator.span,
        ));
    }

    if let Some(rest) = &pattern.rest {
        let BindingPattern::BindingIdentifier(identifier) = &rest.argument else {
            return None;
        };
        let exclusions = Expression::new_array_expression(
            SPAN,
            oxc_allocator::Vec::from_iter_in(
                excluded.into_iter().map(|name| {
                    ArrayExpressionElement::from(Expression::new_string_literal(
                        SPAN,
                        ast.allocator().alloc_str(&name),
                        None,
                        ast,
                    ))
                }),
                ast,
            ),
            ast,
        );
        let value = Expression::new_call_expression(
            SPAN,
            Expression::new_identifier(SPAN, OBJECT_REST, ast),
            None,
            oxc_allocator::Vec::from_array_in(
                [
                    Argument::from(Expression::new_identifier(
                        SPAN,
                        ast.allocator().alloc_str(&input_name),
                        ast,
                    )),
                    Argument::from(exclusions),
                ],
                ast,
            ),
            false,
            ast,
        );
        statements.push(direct_parameter_variable_statement(
            ast,
            BindingPattern::BindingIdentifier(
                identifier.clone_in_with_semantic_ids(ast.allocator()),
            ),
            value,
            declarator.span,
        ));
    }

    Some(statements)
}

fn direct_parameter_variable_statement<'a>(
    ast: &AstBuilder<'a>,
    pattern: BindingPattern<'a>,
    initializer: Expression<'a>,
    span: oxc_span::Span,
) -> Statement<'a> {
    let declarator = VariableDeclarator::new(
        span,
        oxc_ast::ast::VariableDeclarationKind::Let,
        pattern,
        None,
        Some(initializer),
        false,
        ast,
    );
    Statement::from(Declaration::new_variable_declaration(
        span,
        oxc_ast::ast::VariableDeclarationKind::Let,
        oxc_allocator::Vec::from_array_in([declarator], ast),
        false,
        ast,
    ))
}

pub(crate) fn normalize_precomputed_provider_children<'a>(
    allocator: &'a Allocator,
    program: &mut Program<'a>,
) -> bool {
    let mut normalizer = PrecomputedProviderChildNormalizer {
        ast: AstBuilder::new(allocator),
        changed: false,
    };
    normalizer.visit_program(program);
    normalizer.changed
}

struct PrecomputedProviderChildNormalizer<'a> {
    ast: AstBuilder<'a>,
    changed: bool,
}

impl<'a> PrecomputedProviderChildNormalizer<'a> {
    fn normalize_body(&mut self, body: &mut FunctionBody<'a>) {
        let Some((child_name, context, mut value)) = provider_child(&self.ast, body) else {
            return;
        };
        let source_name = declarator_initializer_identifier(body, &child_name);
        if !matches!(value.without_parentheses(), Expression::Identifier(_)) {
            let value_name = format!("__vidactProviderValue{}", value.span().start);
            let write_name = source_name.as_deref().unwrap_or(&child_name);
            let Some(write_index) = provider_child_write_index(body, write_name) else {
                return;
            };
            if !replace_provider_value(&self.ast, body, &value_name) {
                return;
            }
            let span = value.span();
            body.statements.insert(
                write_index,
                direct_parameter_variable_statement(
                    &self.ast,
                    BindingPattern::new_binding_identifier(
                        SPAN,
                        self.ast.allocator().alloc_str(&value_name),
                        &self.ast,
                    ),
                    value,
                    span,
                ),
            );
            value = Expression::new_identifier(
                SPAN,
                self.ast.allocator().alloc_str(&value_name),
                &self.ast,
            );
        }
        if let Some(source_name) = source_name {
            let mut wrapper = NamedProviderChildWriteWrapper {
                ast: &self.ast,
                name: &source_name,
                context: &context,
                value: &value,
                changed: false,
            };
            for statement in &mut body.statements {
                wrapper.visit_statement(statement);
            }
            if wrapper.changed {
                self.changed = true;
                return;
            }
        }
        for statement in &mut body.statements {
            let Statement::VariableDeclaration(declaration) = statement else {
                continue;
            };
            for declarator in &mut declaration.declarations {
                let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                    continue;
                };
                if identifier.name.as_str() != child_name {
                    continue;
                }
                let Some(initializer) = &mut declarator.init else {
                    continue;
                };
                if matches!(
                    initializer.without_parentheses(),
                    Expression::CallExpression(call)
                        if call.callee.get_identifier_reference().is_some_and(|callee| callee.name == RUN_WITH_CONTEXT)
                ) {
                    return;
                }
                contextualize_expression(&self.ast, initializer, &context, &value);
                self.changed = true;
                return;
            }
        }
    }
}

fn declarator_initializer_identifier(body: &FunctionBody<'_>, name: &str) -> Option<String> {
    body.statements.iter().find_map(|statement| {
        let Statement::VariableDeclaration(declaration) = statement else {
            return None;
        };
        declaration.declarations.iter().find_map(|declarator| {
            let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                return None;
            };
            if identifier.name.as_str() != name {
                return None;
            }
            let Expression::Identifier(source) = declarator.init.as_ref()?.without_parentheses()
            else {
                return None;
            };
            Some(source.name.to_string())
        })
    })
}

fn provider_child_write_index(body: &FunctionBody<'_>, name: &str) -> Option<usize> {
    body.statements.iter().position(|statement| {
        let mut finder = NamedProviderChildWriteFinder { name, found: false };
        finder.visit_statement(statement);
        finder.found
    })
}

struct NamedProviderChildWriteFinder<'n> {
    name: &'n str,
    found: bool,
}

impl<'a> Visit<'a> for NamedProviderChildWriteFinder<'_> {
    fn visit_variable_declarator(&mut self, declarator: &VariableDeclarator<'a>) {
        if matches!(
            &declarator.id,
            BindingPattern::BindingIdentifier(identifier)
                if identifier.name.as_str() == self.name && declarator.init.is_some()
        ) {
            self.found = true;
            return;
        }
        walk_variable_declarator_read(self, declarator);
    }

    fn visit_assignment_expression(&mut self, assignment: &AssignmentExpression<'a>) {
        if matches!(
            &assignment.left,
            AssignmentTarget::AssignmentTargetIdentifier(identifier)
                if identifier.name.as_str() == self.name
        ) {
            self.found = true;
            return;
        }
        walk_assignment_expression_read(self, assignment);
    }

    fn visit_function(&mut self, _function: &Function<'a>, _flags: ScopeFlags) {}

    fn visit_arrow_function_expression(&mut self, _function: &ArrowFunctionExpression<'a>) {}

    fn visit_statement(&mut self, statement: &Statement<'a>) {
        if !self.found {
            walk_statement_read(self, statement);
        }
    }
}

struct NamedProviderChildWriteWrapper<'a, 'b> {
    ast: &'b AstBuilder<'a>,
    name: &'b str,
    context: &'b Expression<'a>,
    value: &'b Expression<'a>,
    changed: bool,
}

impl<'a> VisitMut<'a> for NamedProviderChildWriteWrapper<'a, '_> {
    fn visit_variable_declarator(&mut self, declarator: &mut VariableDeclarator<'a>) {
        if let BindingPattern::BindingIdentifier(identifier) = &declarator.id
            && identifier.name.as_str() == self.name
            && let Some(initializer) = &mut declarator.init
        {
            contextualize_expression(self.ast, initializer, self.context, self.value);
            self.changed = true;
            return;
        }
        walk_variable_declarator(self, declarator);
    }

    fn visit_assignment_expression(&mut self, assignment: &mut AssignmentExpression<'a>) {
        if let AssignmentTarget::AssignmentTargetIdentifier(identifier) = &assignment.left
            && identifier.name.as_str() == self.name
        {
            contextualize_expression(self.ast, &mut assignment.right, self.context, self.value);
            self.changed = true;
            return;
        }
        walk_assignment_expression(self, assignment);
    }

    fn visit_function(&mut self, _function: &mut Function<'a>, _flags: ScopeFlags) {}

    fn visit_arrow_function_expression(&mut self, _function: &mut ArrowFunctionExpression<'a>) {}
}

fn contextualize_expression<'a>(
    ast: &AstBuilder<'a>,
    expression: &mut Expression<'a>,
    context: &Expression<'a>,
    value: &Expression<'a>,
) {
    if matches!(
        expression.without_parentheses(),
        Expression::CallExpression(call)
            if call.callee.get_identifier_reference().is_some_and(|callee| callee.name == RUN_WITH_CONTEXT)
    ) {
        return;
    }
    let render = Expression::new_arrow_function_expression(
        SPAN,
        false,
        None,
        FormalParameters::boxed(
            SPAN,
            FormalParameterKind::ArrowFormalParameters,
            oxc_allocator::Vec::new_in(ast),
            None,
            ast,
        ),
        None,
        ArrowFunctionBody::from(expression.take_in(ast)),
        ast,
    );
    *expression = Expression::new_call_expression(
        SPAN,
        Expression::new_identifier(SPAN, RUN_WITH_CONTEXT, ast),
        None,
        oxc_allocator::Vec::from_array_in(
            [
                Argument::from(context.clone_in_with_semantic_ids(ast.allocator())),
                Argument::from(value.clone_in_with_semantic_ids(ast.allocator())),
                Argument::from(render),
            ],
            ast,
        ),
        false,
        ast,
    );
}

impl<'a> VisitMut<'a> for PrecomputedProviderChildNormalizer<'a> {
    fn visit_function(&mut self, function: &mut Function<'a>, flags: ScopeFlags) {
        if let Some(body) = &mut function.body {
            self.normalize_body(body);
        }
        walk_function(self, function, flags);
    }

    fn visit_arrow_function_expression(&mut self, function: &mut ArrowFunctionExpression<'a>) {
        if let Some(body) = function.body.as_function_body_mut() {
            self.normalize_body(body);
        }
        walk_arrow_function_expression(self, function);
    }
}

fn provider_child<'a>(
    ast: &AstBuilder<'a>,
    body: &FunctionBody<'a>,
) -> Option<(String, Expression<'a>, Expression<'a>)> {
    let returned = body.statements.iter().rev().find_map(|statement| {
        let Statement::ReturnStatement(statement) = statement else {
            return None;
        };
        statement.argument.as_ref()
    })?;
    let Expression::JSXElement(element) = returned.without_parentheses() else {
        return None;
    };
    let context = provider_context(ast, element)?;
    let value = provider_value(ast, element)?;
    let mut child = None;
    for item in &element.children {
        match item {
            JSXChild::Text(text) if text.value.trim().is_empty() => {}
            JSXChild::ExpressionContainer(container) => {
                let expression = container.expression.as_expression()?;
                let Expression::Identifier(identifier) = expression.without_parentheses() else {
                    return None;
                };
                if child.is_some() {
                    return None;
                }
                child = Some(identifier.name.to_string());
            }
            _ => return None,
        }
    }
    Some((child?, context, value))
}

fn provider_context<'a>(ast: &AstBuilder<'a>, element: &JSXElement<'a>) -> Option<Expression<'a>> {
    let JSXElementName::MemberExpression(member) = &element.opening_element.name else {
        return None;
    };
    if member.property.name != "Provider" {
        return None;
    }
    let JSXMemberExpressionObject::IdentifierReference(identifier) = &member.object else {
        return None;
    };
    Some(Expression::Identifier(
        identifier.clone_in_with_semantic_ids(ast.allocator()),
    ))
}

fn provider_value<'a>(ast: &AstBuilder<'a>, element: &JSXElement<'a>) -> Option<Expression<'a>> {
    element.opening_element.attributes.iter().find_map(|item| {
        let JSXAttributeItem::Attribute(attribute) = item else {
            return None;
        };
        let JSXAttributeName::Identifier(name) = &attribute.name else {
            return None;
        };
        if name.name != "value" {
            return None;
        }
        let JSXAttributeValue::ExpressionContainer(container) = attribute.value.as_ref()? else {
            return None;
        };
        Some(
            container
                .expression
                .as_expression()?
                .clone_in_with_semantic_ids(ast.allocator()),
        )
    })
}

fn replace_provider_value<'a>(
    ast: &AstBuilder<'a>,
    body: &mut FunctionBody<'a>,
    name: &str,
) -> bool {
    let Some(returned) = body.statements.iter_mut().rev().find_map(|statement| {
        let Statement::ReturnStatement(statement) = statement else {
            return None;
        };
        statement.argument.as_mut()
    }) else {
        return false;
    };
    let Expression::JSXElement(element) = returned.without_parentheses_mut() else {
        return false;
    };
    for item in &mut element.opening_element.attributes {
        let JSXAttributeItem::Attribute(attribute) = item else {
            continue;
        };
        let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
            continue;
        };
        if attribute_name.name != "value" {
            continue;
        }
        let Some(JSXAttributeValue::ExpressionContainer(container)) = &mut attribute.value else {
            return false;
        };
        let Some(expression) = container.expression.as_expression_mut() else {
            return false;
        };
        *expression = Expression::new_identifier(SPAN, ast.allocator().alloc_str(name), ast);
        return true;
    }
    false
}

pub(crate) fn normalize_compiler_hook_inputs<'a>(
    allocator: &'a Allocator,
    program: &mut Program<'a>,
    scoping: &Scoping,
) -> bool {
    let frozen_empty_arrays = frozen_empty_array_symbols(program, scoping);
    let custom_hook_rest_arrays = custom_hook_rest_array_symbols(allocator, program, scoping);
    let callback_factories = callback_factory_symbols(program, scoping);
    if frozen_empty_arrays.is_empty()
        && custom_hook_rest_arrays.is_empty()
        && callback_factories.is_empty()
    {
        return false;
    }
    let react = ReactBindings::new(program, scoping);
    let mut normalizer = FrozenEmptyHookDependencyNormalizer {
        ast: AstBuilder::new(allocator),
        react: &react,
        scoping,
        frozen_empty_arrays: &frozen_empty_arrays,
        custom_hook_rest_arrays: &custom_hook_rest_arrays,
        callback_factories: &callback_factories,
        changed: false,
    };
    normalizer.visit_program(program);
    normalizer.changed
}

fn callback_factory_symbols(program: &Program<'_>, scoping: &Scoping) -> BTreeSet<SymbolId> {
    let mut symbols = BTreeSet::new();
    for statement in &program.body {
        let Statement::FunctionDeclaration(function) = statement else {
            continue;
        };
        let Some(identifier) = &function.id else {
            continue;
        };
        let Some(symbol) = identifier.symbol_id.get() else {
            continue;
        };
        let Some(body) = &function.body else {
            continue;
        };
        let [Statement::ReturnStatement(return_statement)] = body.statements.as_slice() else {
            continue;
        };
        if return_statement.argument.as_ref().is_some_and(|argument| {
            matches!(
                argument.without_parentheses(),
                Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
            )
        }) && scoping
            .get_resolved_reference_ids(symbol)
            .iter()
            .all(|reference| !scoping.get_reference(*reference).flags().is_write())
        {
            symbols.insert(symbol);
        }
    }
    symbols
}

fn custom_hook_rest_array_symbols<'a>(
    allocator: &'a Allocator,
    program: &Program<'a>,
    scoping: &Scoping,
) -> BTreeMap<SymbolId, Expression<'a>> {
    let mut collector = CustomHookRestArrayCollector {
        allocator,
        scoping,
        arrays: BTreeMap::new(),
    };
    collector.visit_program(program);
    collector.arrays
}

struct CustomHookRestArrayCollector<'a, 's> {
    allocator: &'a Allocator,
    scoping: &'s Scoping,
    arrays: BTreeMap<SymbolId, Expression<'a>>,
}

impl<'a> Visit<'a> for CustomHookRestArrayCollector<'a, '_> {
    fn visit_variable_declarator(&mut self, declarator: &VariableDeclarator<'a>) {
        let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
            walk_variable_declarator_read(self, declarator);
            return;
        };
        let Some(symbol) = identifier.symbol_id.get() else {
            walk_variable_declarator_read(self, declarator);
            return;
        };
        if identifier.name.starts_with("__vidactHook")
            && identifier.name.ends_with("Rest")
            && declarator.init.as_ref().is_some_and(|initializer| {
                matches!(initializer, Expression::ArrayExpression(array) if array.elements.iter().all(|element| {
                    element
                        .as_expression()
                        .is_some_and(is_replay_safe_rest_value)
                }))
            })
            && self
                .scoping
                .get_resolved_reference_ids(symbol)
                .iter()
                .all(|reference| !self.scoping.get_reference(*reference).flags().is_write())
        {
            self.arrays.insert(
                symbol,
                declarator
                    .init
                    .as_ref()
                    .expect("the initializer was matched")
                    .clone_in_with_semantic_ids(self.allocator),
            );
        }
        walk_variable_declarator_read(self, declarator);
    }
}

fn is_replay_safe_rest_value(expression: &Expression<'_>) -> bool {
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

fn frozen_empty_array_symbols(program: &Program<'_>, scoping: &Scoping) -> BTreeSet<SymbolId> {
    let mut symbols = BTreeSet::new();
    for statement in &program.body {
        let declaration = match statement {
            Statement::VariableDeclaration(declaration) => Some(declaration.as_ref()),
            Statement::ExportDeclaration(export) => match &export.declaration {
                Declaration::VariableDeclaration(declaration) => Some(declaration.as_ref()),
                _ => None,
            },
            _ => None,
        };
        let Some(declaration) = declaration else {
            continue;
        };
        for declarator in &declaration.declarations {
            let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                continue;
            };
            let Some(symbol) = identifier.symbol_id.get() else {
                continue;
            };
            if declarator
                .init
                .as_ref()
                .is_some_and(|initializer| is_frozen_empty_array(initializer, scoping))
                && scoping
                    .get_resolved_reference_ids(symbol)
                    .iter()
                    .all(|reference| !scoping.get_reference(*reference).flags().is_write())
            {
                symbols.insert(symbol);
            }
        }
    }
    symbols
}

fn is_frozen_empty_array(expression: &Expression<'_>, scoping: &Scoping) -> bool {
    let Expression::CallExpression(call) = expression.without_parentheses() else {
        return false;
    };
    let Expression::StaticMemberExpression(member) = call.callee.without_parentheses() else {
        return false;
    };
    if member.property.name != "freeze" {
        return false;
    }
    let Some(object) = member
        .object
        .without_parentheses()
        .get_identifier_reference()
    else {
        return false;
    };
    if object.name != "Object" || reference_symbol(object, scoping).is_some() {
        return false;
    }
    let [argument] = call.arguments.as_slice() else {
        return false;
    };
    matches!(
        argument.as_expression().map(Expression::without_parentheses),
        Some(Expression::ArrayExpression(array)) if array.elements.is_empty()
    )
}

struct FrozenEmptyHookDependencyNormalizer<'a, 'r, 's> {
    ast: AstBuilder<'a>,
    react: &'r ReactBindings<'s>,
    scoping: &'s Scoping,
    frozen_empty_arrays: &'r BTreeSet<SymbolId>,
    custom_hook_rest_arrays: &'r BTreeMap<SymbolId, Expression<'a>>,
    callback_factories: &'r BTreeSet<SymbolId>,
    changed: bool,
}

impl<'a> VisitMut<'a> for FrozenEmptyHookDependencyNormalizer<'a, '_, '_> {
    fn visit_call_expression(&mut self, call: &mut CallExpression<'a>) {
        walk_call_expression(self, call);
        if self.react.memo_hook_call(call) == Some(crate::react_bindings::MemoHook::Callback)
            && matches!(call.callee, Expression::StaticMemberExpression(_))
            && call.arguments.first().is_some_and(|argument| {
                let Some(Expression::CallExpression(factory)) = argument.as_expression() else {
                    return false;
                };
                factory
                    .callee
                    .get_identifier_reference()
                    .and_then(|identifier| reference_symbol(identifier, self.scoping))
                    .is_some_and(|symbol| self.callback_factories.contains(&symbol))
                    && factory.arguments.iter().any(|argument| {
                        let Argument::SpreadElement(spread) = argument else {
                            return false;
                        };
                        let Expression::Identifier(identifier) =
                            spread.argument.without_parentheses()
                        else {
                            return false;
                        };
                        reference_symbol(identifier, self.scoping).is_some_and(|symbol| {
                            self.custom_hook_rest_arrays.contains_key(&symbol)
                        })
                    })
            })
        {
            if let Some(Expression::CallExpression(factory)) = call
                .arguments
                .first_mut()
                .and_then(Argument::as_expression_mut)
            {
                for argument in &mut factory.arguments {
                    let Argument::SpreadElement(spread) = argument else {
                        continue;
                    };
                    let Expression::Identifier(identifier) = spread.argument.without_parentheses()
                    else {
                        continue;
                    };
                    let Some(array) = reference_symbol(identifier, self.scoping)
                        .and_then(|symbol| self.custom_hook_rest_arrays.get(&symbol))
                    else {
                        continue;
                    };
                    spread.argument = array.clone_in_with_semantic_ids(self.ast.allocator());
                }
            }
            let argument = call
                .arguments
                .first_mut()
                .and_then(Argument::as_expression_mut)
                .expect("the callback factory argument was matched")
                .take_in(&self.ast);
            *call
                .arguments
                .first_mut()
                .expect("the callback factory argument was matched") =
                Argument::from(Expression::new_arrow_function_expression(
                    call.span,
                    false,
                    None,
                    FormalParameters::boxed(
                        call.span,
                        FormalParameterKind::ArrowFormalParameters,
                        oxc_allocator::Vec::new_in(&self.ast),
                        None,
                        &self.ast,
                    ),
                    None,
                    ArrowFunctionBody::from(argument),
                    &self.ast,
                ));
            let Expression::StaticMemberExpression(member) = &mut call.callee else {
                unreachable!("the namespace callback call was matched")
            };
            member.property.name = self.ast.allocator().alloc_str("useMemo").into();
            self.changed = true;
        }
        let dependency_index = if self.react.effect_hook_call(call).is_some()
            || self.react.memo_hook_call(call).is_some()
        {
            1
        } else if self.react.is_imperative_handle_call(call) {
            2
        } else {
            return;
        };
        let Some(argument) = call.arguments.get_mut(dependency_index) else {
            return;
        };
        let Some(expression) = argument.as_expression_mut() else {
            return;
        };
        let Expression::Identifier(identifier) = expression.without_parentheses() else {
            return;
        };
        let span = identifier.span;
        let Some(symbol) = reference_symbol(identifier, self.scoping) else {
            return;
        };
        if self.frozen_empty_arrays.contains(&symbol) {
            *expression = Expression::new_array_expression(
                span,
                oxc_allocator::Vec::new_in(&self.ast),
                &self.ast,
            );
        } else if let Some(array) = self.custom_hook_rest_arrays.get(&symbol) {
            *expression = reactive_hook_dependencies(&self.ast, array, self.scoping);
        } else {
            return;
        }
        self.changed = true;
    }
}

fn reactive_hook_dependencies<'a>(
    ast: &AstBuilder<'a>,
    expression: &Expression<'a>,
    scoping: &Scoping,
) -> Expression<'a> {
    let Expression::ArrayExpression(array) = expression.without_parentheses() else {
        return expression.clone_in_with_semantic_ids(ast.allocator());
    };
    let mut elements = oxc_allocator::Vec::new_in(ast);
    for element in &array.elements {
        if element
            .as_expression()
            .is_some_and(|expression| is_static_hook_dependency(expression, scoping))
        {
            continue;
        }
        elements.push(element.clone_in_with_semantic_ids(ast.allocator()));
    }
    Expression::new_array_expression(array.span, elements, ast)
}

fn is_static_hook_dependency(expression: &Expression<'_>, scoping: &Scoping) -> bool {
    match expression.without_parentheses() {
        Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::StringLiteral(_) => true,
        Expression::Identifier(identifier) => {
            reference_symbol(identifier, scoping).is_some_and(|symbol| {
                scoping.symbol_scope_id(symbol) == scoping.root_scope_id()
                    && scoping
                        .get_resolved_reference_ids(symbol)
                        .iter()
                        .all(|reference| !scoping.get_reference(*reference).flags().is_write())
            })
        }
        _ => false,
    }
}

pub(crate) fn normalize_expression_bodied_component_arrows<'a>(
    allocator: &'a Allocator,
    program: &mut Program<'a>,
) -> Vec<SourceSpan> {
    let ast = AstBuilder::new(allocator);
    let mut anonymous_defaults = Vec::new();
    for statement in &mut program.body {
        match statement {
            Statement::VariableDeclaration(declaration) => {
                normalize_variable_arrows(&ast, declaration)
            }
            Statement::ExportDeclaration(export) => {
                if let Declaration::VariableDeclaration(declaration) = &mut export.declaration {
                    normalize_variable_arrows(&ast, declaration);
                }
            }
            Statement::ExportDefaultDeclaration(export) => {
                if let ExportDefaultDeclarationKind::FunctionDeclaration(function) =
                    &mut export.declaration
                    && function.id.is_none()
                {
                    let span = SourceSpan::from_oxc(function.span);
                    let name = allocator
                        .alloc_str(&format!("VidactDefaultComponent{}", function.span.start));
                    function.id = Some(oxc_ast::ast::BindingIdentifier::new(
                        oxc_span::SPAN,
                        name,
                        &ast,
                    ));
                    anonymous_defaults.push(span);
                }
            }
            _ => {}
        }
    }
    anonymous_defaults
}

pub(crate) fn restore_anonymous_default_component_names(
    program: &mut Program<'_>,
    spans: &[SourceSpan],
) {
    for statement in &mut program.body {
        let Statement::ExportDefaultDeclaration(export) = statement else {
            continue;
        };
        let ExportDefaultDeclarationKind::FunctionDeclaration(function) = &mut export.declaration
        else {
            continue;
        };
        if spans.contains(&SourceSpan::from_oxc(function.span)) {
            function.id = None;
        }
    }
}

fn normalize_variable_arrows<'a>(ast: &AstBuilder<'a>, declaration: &mut VariableDeclaration<'a>) {
    for declarator in &mut declaration.declarations {
        let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
            continue;
        };
        let name = identifier.name.as_str();
        let is_component = name.chars().next().is_some_and(char::is_uppercase);
        let is_hook = name
            .strip_prefix("use")
            .and_then(|suffix| suffix.chars().next())
            .is_some_and(char::is_uppercase);
        if !is_component && !is_hook {
            continue;
        }
        let Some(Expression::ArrowFunctionExpression(function)) = &mut declarator.init else {
            continue;
        };
        let Some(expression) = function.body.as_expression() else {
            continue;
        };
        let span = expression.span();
        let expression = expression.clone_in_with_semantic_ids(ast.allocator());
        function.body = oxc_ast::ast::ArrowFunctionBody::new_function_body(
            span,
            [],
            oxc_allocator::Vec::from_iter_in(
                [Statement::new_return_statement(span, Some(expression), ast)],
                ast,
            ),
            ast,
        );
    }
}

pub(crate) fn component_function_parts<'a>(
    program: &'a Program<'a>,
    name: &str,
    span: Option<SourceSpan>,
) -> Option<(&'a FormalParameters<'a>, &'a FunctionBody<'a>)> {
    program.body.iter().find_map(|statement| match statement {
        Statement::FunctionDeclaration(function)
            if function.id.as_ref().is_some_and(|id| id.name == name)
                && span.is_none_or(|span| {
                    function.span.start == span.start && function.span.end == span.end
                }) =>
        {
            Some((function.params.as_ref(), function.body.as_deref()?))
        }
        Statement::ExportDeclaration(export) => match &export.declaration {
            Declaration::FunctionDeclaration(function)
                if function.id.as_ref().is_some_and(|id| id.name == name)
                    && span.is_none_or(|span| {
                        function.span.start == span.start && function.span.end == span.end
                    }) =>
            {
                Some((function.params.as_ref(), function.body.as_deref()?))
            }
            Declaration::VariableDeclaration(declaration) => {
                variable_parts(declaration, name, span)
            }
            _ => None,
        },
        Statement::VariableDeclaration(declaration) => variable_parts(declaration, name, span),
        Statement::ExportDefaultDeclaration(export) => {
            default_export_parts(&export.declaration, name, span)
        }
        _ => None,
    })
}

pub(crate) fn component_function_parts_mut<'p, 'a>(
    program: &'p mut Program<'a>,
    name: &str,
    span: Option<SourceSpan>,
) -> Option<(&'p mut FormalParameters<'a>, &'p mut FunctionBody<'a>)> {
    program
        .body
        .iter_mut()
        .find_map(|statement| match statement {
            Statement::FunctionDeclaration(function)
                if function.id.as_ref().is_some_and(|id| id.name == name)
                    && span.is_none_or(|span| {
                        function.span.start == span.start && function.span.end == span.end
                    }) =>
            {
                let Function { params, body, .. } = function.as_mut();
                Some((params.as_mut(), body.as_deref_mut()?))
            }
            Statement::ExportDeclaration(export) => match &mut export.declaration {
                Declaration::FunctionDeclaration(function)
                    if function.id.as_ref().is_some_and(|id| id.name == name)
                        && span.is_none_or(|span| {
                            function.span.start == span.start && function.span.end == span.end
                        }) =>
                {
                    let Function { params, body, .. } = function.as_mut();
                    Some((params.as_mut(), body.as_deref_mut()?))
                }
                Declaration::VariableDeclaration(declaration) => {
                    variable_parts_mut(declaration, name, span)
                }
                _ => None,
            },
            Statement::VariableDeclaration(declaration) => {
                variable_parts_mut(declaration, name, span)
            }
            Statement::ExportDefaultDeclaration(export) => {
                default_export_parts_mut(&mut export.declaration, name, span)
            }
            _ => None,
        })
}

fn default_export_parts<'a>(
    declaration: &'a ExportDefaultDeclarationKind<'a>,
    name: &str,
    span: Option<SourceSpan>,
) -> Option<(&'a FormalParameters<'a>, &'a FunctionBody<'a>)> {
    match declaration {
        ExportDefaultDeclarationKind::FunctionDeclaration(function)
            if function.id.as_ref().is_none_or(|id| id.name == name)
                && matches_span(function.span, span) =>
        {
            Some((function.params.as_ref(), function.body.as_deref()?))
        }
        ExportDefaultDeclarationKind::ArrowFunctionExpression(function)
            if matches_span(function.span, span) =>
        {
            Some((function.params.as_ref(), function.body.as_function_body()?))
        }
        ExportDefaultDeclarationKind::FunctionExpression(function)
            if matches_span(function.span, span) =>
        {
            Some((function.params.as_ref(), function.body.as_deref()?))
        }
        _ => None,
    }
}

fn default_export_parts_mut<'p, 'a>(
    declaration: &'p mut ExportDefaultDeclarationKind<'a>,
    name: &str,
    span: Option<SourceSpan>,
) -> Option<(&'p mut FormalParameters<'a>, &'p mut FunctionBody<'a>)> {
    match declaration {
        ExportDefaultDeclarationKind::FunctionDeclaration(function)
            if function.id.as_ref().is_none_or(|id| id.name == name)
                && matches_span(function.span, span) =>
        {
            let Function { params, body, .. } = function.as_mut();
            Some((params.as_mut(), body.as_deref_mut()?))
        }
        ExportDefaultDeclarationKind::ArrowFunctionExpression(function)
            if matches_span(function.span, span) =>
        {
            let ArrowFunctionExpression { params, body, .. } = function.as_mut();
            Some((params.as_mut(), body.as_function_body_mut()?))
        }
        ExportDefaultDeclarationKind::FunctionExpression(function)
            if matches_span(function.span, span) =>
        {
            let Function { params, body, .. } = function.as_mut();
            Some((params.as_mut(), body.as_deref_mut()?))
        }
        _ => None,
    }
}

fn variable_parts<'a>(
    declaration: &'a VariableDeclaration<'a>,
    name: &str,
    span: Option<SourceSpan>,
) -> Option<(&'a FormalParameters<'a>, &'a FunctionBody<'a>)> {
    declaration.declarations.iter().find_map(|declarator| {
        let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
            return None;
        };
        if identifier.name != name {
            return None;
        }
        match declarator.init.as_ref()? {
            Expression::ArrowFunctionExpression(function) if matches_span(function.span, span) => {
                Some((function.params.as_ref(), function.body.as_function_body()?))
            }
            Expression::FunctionExpression(function) if matches_span(function.span, span) => {
                Some((function.params.as_ref(), function.body.as_deref()?))
            }
            _ => None,
        }
    })
}

fn variable_parts_mut<'p, 'a>(
    declaration: &'p mut VariableDeclaration<'a>,
    name: &str,
    span: Option<SourceSpan>,
) -> Option<(&'p mut FormalParameters<'a>, &'p mut FunctionBody<'a>)> {
    declaration.declarations.iter_mut().find_map(|declarator| {
        let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
            return None;
        };
        if identifier.name != name {
            return None;
        }
        match declarator.init.as_mut()? {
            Expression::ArrowFunctionExpression(function) if matches_span(function.span, span) => {
                let ArrowFunctionExpression { params, body, .. } = function.as_mut();
                Some((params.as_mut(), body.as_function_body_mut()?))
            }
            Expression::FunctionExpression(function) if matches_span(function.span, span) => {
                let Function { params, body, .. } = function.as_mut();
                Some((params.as_mut(), body.as_deref_mut()?))
            }
            _ => None,
        }
    })
}

fn matches_span(candidate: oxc_span::Span, expected: Option<SourceSpan>) -> bool {
    expected.is_none_or(|span| candidate.start == span.start && candidate.end == span.end)
}

pub(crate) fn component_name_for_span<'a>(
    program: &'a Program<'a>,
    span: SourceSpan,
) -> Option<&'a str> {
    program.body.iter().find_map(|statement| match statement {
        Statement::VariableDeclaration(declaration) => variable_name_for_span(declaration, span),
        Statement::ExportDeclaration(export) => match &export.declaration {
            Declaration::VariableDeclaration(declaration) => {
                variable_name_for_span(declaration, span)
            }
            _ => None,
        },
        _ => None,
    })
}

fn variable_name_for_span<'a>(
    declaration: &'a VariableDeclaration<'a>,
    span: SourceSpan,
) -> Option<&'a str> {
    declaration.declarations.iter().find_map(|declarator| {
        let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
            return None;
        };
        match declarator.init.as_ref()? {
            Expression::ArrowFunctionExpression(function)
                if matches_span(function.span, Some(span)) =>
            {
                Some(identifier.name.as_str())
            }
            Expression::FunctionExpression(function) if matches_span(function.span, Some(span)) => {
                Some(identifier.name.as_str())
            }
            _ => None,
        }
    })
}

pub(crate) fn is_event_attribute(name: &str) -> bool {
    name.strip_prefix("on")
        .and_then(|suffix| suffix.chars().next())
        .is_some_and(|first| first.is_ascii_uppercase())
}

pub(crate) fn is_supported_react_event_attribute(name: &str) -> bool {
    let Some(event_name) = name.strip_prefix("on") else {
        return false;
    };
    is_supported_react_event_name(event_name)
        || event_name
            .strip_suffix("Capture")
            .is_some_and(is_supported_react_event_name)
}

fn is_supported_react_event_name(name: &str) -> bool {
    matches!(
        name,
        "Abort"
            | "AnimationEnd"
            | "AnimationIteration"
            | "AnimationStart"
            | "AuxClick"
            | "BeforeInput"
            | "BeforeToggle"
            | "Blur"
            | "CanPlay"
            | "CanPlayThrough"
            | "Cancel"
            | "Change"
            | "Click"
            | "Close"
            | "CompositionEnd"
            | "CompositionStart"
            | "CompositionUpdate"
            | "ContextMenu"
            | "Copy"
            | "Cut"
            | "DoubleClick"
            | "Drag"
            | "DragEnd"
            | "DragEnter"
            | "DragExit"
            | "DragLeave"
            | "DragOver"
            | "DragStart"
            | "Drop"
            | "DurationChange"
            | "Emptied"
            | "Encrypted"
            | "Ended"
            | "Error"
            | "Focus"
            | "GotPointerCapture"
            | "Input"
            | "Invalid"
            | "KeyDown"
            | "KeyPress"
            | "KeyUp"
            | "Load"
            | "LoadedData"
            | "LoadedMetadata"
            | "LoadStart"
            | "LostPointerCapture"
            | "MouseDown"
            | "MouseEnter"
            | "MouseLeave"
            | "MouseMove"
            | "MouseOut"
            | "MouseOver"
            | "MouseUp"
            | "Paste"
            | "Pause"
            | "Play"
            | "Playing"
            | "PointerCancel"
            | "PointerDown"
            | "PointerEnter"
            | "PointerLeave"
            | "PointerMove"
            | "PointerOut"
            | "PointerOver"
            | "PointerUp"
            | "Progress"
            | "RateChange"
            | "Reset"
            | "Resize"
            | "Scroll"
            | "ScrollEnd"
            | "Seeked"
            | "Seeking"
            | "Select"
            | "Stalled"
            | "Submit"
            | "Suspend"
            | "TimeUpdate"
            | "Toggle"
            | "TouchCancel"
            | "TouchEnd"
            | "TouchMove"
            | "TouchStart"
            | "TransitionCancel"
            | "TransitionEnd"
            | "TransitionRun"
            | "TransitionStart"
            | "VolumeChange"
            | "Waiting"
            | "Wheel"
    )
}
