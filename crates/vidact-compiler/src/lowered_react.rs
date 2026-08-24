use std::collections::{BTreeMap, BTreeSet};

use oxc_allocator::{Allocator, CloneIn, GetAllocator, TakeIn, Vec as ArenaVec};
use oxc_ast::{ast::*, builder::AstBuilder};
use oxc_ast_visit::{VisitMut, walk_mut::walk_expression};
use oxc_semantic::Scoping;
use oxc_span::Span;
use oxc_syntax::symbol::SymbolId;

use crate::{Diagnostic, DiagnosticCode, SourceSpan, react_bindings::reference_symbol};

pub(crate) fn may_contain_lowered_react(program: &Program<'_>) -> bool {
    program.body.iter().any(|statement| {
        let Statement::ImportDeclaration(import) = statement else {
            return false;
        };
        match import.source.value.as_str() {
            "react/jsx-runtime" | "react/jsx-dev-runtime" => true,
            "react" => import
                .specifiers
                .iter()
                .flatten()
                .any(|specifier| match specifier {
                    ImportDeclarationSpecifier::ImportSpecifier(specifier) => {
                        module_export_name(&specifier.imported) == "createElement"
                    }
                    ImportDeclarationSpecifier::ImportDefaultSpecifier(_)
                    | ImportDeclarationSpecifier::ImportNamespaceSpecifier(_) => true,
                }),
            _ => false,
        }
    })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum FactoryKind {
    Automatic,
    Development,
    Classic,
}

#[derive(Default)]
struct LoweredReactBindings {
    factories: BTreeMap<SymbolId, FactoryKind>,
    fragments: BTreeSet<SymbolId>,
    automatic_namespaces: BTreeSet<SymbolId>,
    react_namespaces: BTreeSet<SymbolId>,
    removable_named: BTreeSet<SymbolId>,
    removable_namespaces: BTreeSet<SymbolId>,
}

impl LoweredReactBindings {
    fn new(program: &Program<'_>) -> Self {
        let mut bindings = Self::default();
        for statement in &program.body {
            let Statement::ImportDeclaration(import) = statement else {
                continue;
            };
            let source = import.source.value.as_str();
            let is_runtime = matches!(source, "react/jsx-runtime" | "react/jsx-dev-runtime");
            let is_react = source == "react";
            if !is_runtime && !is_react {
                continue;
            }
            for specifier in import.specifiers.iter().flatten() {
                match specifier {
                    ImportDeclarationSpecifier::ImportSpecifier(specifier) => {
                        let Some(symbol) = specifier.local.symbol_id.get() else {
                            continue;
                        };
                        let imported = module_export_name(&specifier.imported);
                        let factory = match (source, imported) {
                            ("react/jsx-runtime", "jsx" | "jsxs") => Some(FactoryKind::Automatic),
                            ("react/jsx-dev-runtime", "jsxDEV") => Some(FactoryKind::Development),
                            ("react", "createElement") => Some(FactoryKind::Classic),
                            _ => None,
                        };
                        if let Some(factory) = factory {
                            bindings.factories.insert(symbol, factory);
                            bindings.removable_named.insert(symbol);
                        } else if imported == "Fragment" {
                            bindings.fragments.insert(symbol);
                            bindings.removable_named.insert(symbol);
                        }
                    }
                    ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) => {
                        let Some(symbol) = specifier.local.symbol_id.get() else {
                            continue;
                        };
                        if is_runtime {
                            bindings.automatic_namespaces.insert(symbol);
                        } else {
                            bindings.react_namespaces.insert(symbol);
                        }
                        bindings.removable_namespaces.insert(symbol);
                    }
                    ImportDeclarationSpecifier::ImportDefaultSpecifier(specifier) if is_react => {
                        if let Some(symbol) = specifier.local.symbol_id.get() {
                            bindings.react_namespaces.insert(symbol);
                            bindings.removable_namespaces.insert(symbol);
                        }
                    }
                    ImportDeclarationSpecifier::ImportDefaultSpecifier(_) => {}
                }
            }
        }
        bindings
    }

    fn factory_call(
        &self,
        call: &CallExpression<'_>,
        scoping: &Scoping,
    ) -> Option<(FactoryKind, SymbolId)> {
        match call.callee.without_parentheses() {
            Expression::Identifier(identifier) => {
                let symbol = reference_symbol(identifier, scoping)?;
                self.factories
                    .get(&symbol)
                    .copied()
                    .map(|kind| (kind, symbol))
            }
            Expression::StaticMemberExpression(member) => {
                let identifier = member
                    .object
                    .without_parentheses()
                    .get_identifier_reference()?;
                let symbol = reference_symbol(identifier, scoping)?;
                let property = member.property.name.as_str();
                if self.automatic_namespaces.contains(&symbol) {
                    match property {
                        "jsx" | "jsxs" => Some((FactoryKind::Automatic, symbol)),
                        "jsxDEV" => Some((FactoryKind::Development, symbol)),
                        _ => None,
                    }
                } else if self.react_namespaces.contains(&symbol) && property == "createElement" {
                    Some((FactoryKind::Classic, symbol))
                } else {
                    None
                }
            }
            _ => None,
        }
    }

    fn fragment_symbol(&self, expression: &Expression<'_>, scoping: &Scoping) -> Option<SymbolId> {
        match expression.without_parentheses() {
            Expression::Identifier(identifier) => {
                let symbol = reference_symbol(identifier, scoping)?;
                self.fragments.contains(&symbol).then_some(symbol)
            }
            Expression::StaticMemberExpression(member) if member.property.name == "Fragment" => {
                let identifier = member
                    .object
                    .without_parentheses()
                    .get_identifier_reference()?;
                let symbol = reference_symbol(identifier, scoping)?;
                (self.automatic_namespaces.contains(&symbol)
                    || self.react_namespaces.contains(&symbol))
                .then_some(symbol)
            }
            _ => None,
        }
    }
}

pub(crate) fn normalize_lowered_react<'a>(
    allocator: &'a Allocator,
    program: &mut Program<'a>,
    scoping: &Scoping,
) -> Result<bool, Diagnostic> {
    let bindings = LoweredReactBindings::new(program);
    if bindings.factories.is_empty()
        && bindings.automatic_namespaces.is_empty()
        && bindings.react_namespaces.is_empty()
    {
        return Ok(false);
    }

    let mut normalizer = LoweredReactNormalizer {
        ast: AstBuilder::new(allocator),
        bindings: &bindings,
        scoping,
        consumed: BTreeMap::new(),
        changed: false,
        diagnostic: None,
    };
    normalizer.visit_program(program);
    if let Some(diagnostic) = normalizer.diagnostic {
        return Err(diagnostic);
    }

    for symbol in &bindings.removable_named {
        let consumed = normalizer.consumed.get(symbol).copied().unwrap_or_default();
        let total = scoping.get_resolved_reference_ids(*symbol).len();
        if consumed != total {
            return Err(unsupported(
                "React element factory provenance was lost through an alias or value escape",
                None,
            ));
        }
    }
    if !normalizer.changed {
        return Ok(false);
    }

    remove_consumed_imports(program, &bindings, &normalizer.consumed, scoping);
    Ok(true)
}

struct LoweredReactNormalizer<'a, 'b> {
    ast: AstBuilder<'a>,
    bindings: &'b LoweredReactBindings,
    scoping: &'b Scoping,
    consumed: BTreeMap<SymbolId, usize>,
    changed: bool,
    diagnostic: Option<Diagnostic>,
}

impl<'a> VisitMut<'a> for LoweredReactNormalizer<'a, '_> {
    fn visit_expression(&mut self, expression: &mut Expression<'a>) {
        if self.diagnostic.is_some() {
            return;
        }
        walk_expression(self, expression);
        let Expression::CallExpression(call) = expression else {
            return;
        };
        let Some((kind, factory_symbol)) = self.bindings.factory_call(call, self.scoping) else {
            return;
        };
        let fragment_symbol = call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .and_then(|tag| self.bindings.fragment_symbol(tag, self.scoping));
        let span = call.span;
        let owned = expression.take_in(&self.ast);
        let Expression::CallExpression(call) = owned else {
            unreachable!();
        };
        match self.lower_call(call.unbox(), kind, fragment_symbol.is_some()) {
            Ok(lowered) => {
                *expression = lowered;
                *self.consumed.entry(factory_symbol).or_default() += 1;
                if let Some(symbol) = fragment_symbol {
                    *self.consumed.entry(symbol).or_default() += 1;
                }
                self.changed = true;
            }
            Err(message) => {
                self.diagnostic = Some(unsupported(message, Some(span)));
            }
        }
    }
}

impl<'a> LoweredReactNormalizer<'a, '_> {
    fn lower_call(
        &self,
        call: CallExpression<'a>,
        kind: FactoryKind,
        fragment: bool,
    ) -> Result<Expression<'a>, &'static str> {
        let span = call.span;
        let mut arguments = call.arguments.into_iter();
        let tag =
            argument_expression(arguments.next(), "React element factory is missing its tag")?;
        let props = argument_expression(
            arguments.next(),
            "React element factory is missing its props argument",
        )?;
        let (mut attributes, mut children) = self.lower_props(props)?;

        if matches!(kind, FactoryKind::Automatic | FactoryKind::Development)
            && let Some(key) = arguments.next()
        {
            if !key.is_expression() {
                return Err("spread keys in React element factories are unsupported");
            }
            let key = key.into_expression();
            if !is_nullish_key(&key) {
                attributes.push(attribute("key", key, span, &self.ast));
            }
        }

        if kind == FactoryKind::Classic {
            for argument in arguments {
                if !argument.is_expression() {
                    return Err("spread children in React.createElement are unsupported");
                }
                children.push(lower_child(argument.into_expression(), span, &self.ast));
            }
        }
        self.finish_element(span, tag, attributes, children, fragment)
    }

    fn finish_element(
        &self,
        span: Span,
        tag: Expression<'a>,
        attributes: ArenaVec<'a, JSXAttributeItem<'a>>,
        children: ArenaVec<'a, JSXChild<'a>>,
        fragment: bool,
    ) -> Result<Expression<'a>, &'static str> {
        if fragment {
            if !attributes.is_empty() {
                return Err("React.Fragment props other than children are unsupported");
            }
            return Ok(Expression::new_jsx_fragment(
                span,
                JSXOpeningFragment::new(span, &self.ast),
                children,
                JSXClosingFragment::new(span, &self.ast),
                &self.ast,
            ));
        }
        let name = lower_element_name(&tag, &self.ast)?;
        let closing = (!children.is_empty()).then(|| {
            JSXClosingElement::boxed(span, name.clone_in(self.ast.allocator()), &self.ast)
        });
        let opening = JSXOpeningElement::boxed(span, name, None, attributes, &self.ast);
        Ok(Expression::new_jsx_element(
            span, opening, children, closing, &self.ast,
        ))
    }

    fn lower_props(
        &self,
        props: Expression<'a>,
    ) -> Result<
        (
            ArenaVec<'a, JSXAttributeItem<'a>>,
            ArenaVec<'a, JSXChild<'a>>,
        ),
        &'static str,
    > {
        if matches!(props.without_parentheses(), Expression::NullLiteral(_)) {
            return Ok((ArenaVec::new_in(&self.ast), ArenaVec::new_in(&self.ast)));
        }
        let Expression::ObjectExpression(object) = props.without_parentheses() else {
            return Err("React element factory props must be an object literal or null");
        };
        let mut attributes = ArenaVec::new_in(&self.ast);
        let mut children = ArenaVec::new_in(&self.ast);
        let mut saw_children = false;
        for property in &object.properties {
            match property {
                ObjectPropertyKind::SpreadProperty(spread) => {
                    if saw_children {
                        return Err(
                            "React factory props after children would change evaluation order",
                        );
                    }
                    attributes.push(JSXAttributeItem::new_spread_attribute(
                        spread.span,
                        spread.argument.clone_in(self.ast.allocator()),
                        &self.ast,
                    ));
                }
                ObjectPropertyKind::ObjectProperty(property) => {
                    if property.computed || property.kind != PropertyKind::Init || property.method {
                        return Err(
                            "computed, getter, setter, and method React factory props are unsupported",
                        );
                    }
                    let Some(name) = property.key.static_name() else {
                        return Err("React factory prop name must be statically known");
                    };
                    if name == "children" {
                        saw_children = true;
                        append_children(&property.value, property.span, &mut children, &self.ast);
                    } else {
                        if saw_children {
                            return Err(
                                "React factory props after children would change evaluation order",
                            );
                        }
                        attributes.push(attribute(
                            name.as_ref(),
                            property.value.clone_in(self.ast.allocator()),
                            property.span,
                            &self.ast,
                        ));
                    }
                }
            }
        }
        Ok((attributes, children))
    }
}

fn argument_expression<'a>(
    argument: Option<Argument<'a>>,
    message: &'static str,
) -> Result<Expression<'a>, &'static str> {
    let argument = argument.ok_or(message)?;
    if !argument.is_expression() {
        return Err("spread arguments in React element factories are unsupported");
    }
    Ok(argument.into_expression())
}

fn append_children<'a>(
    value: &Expression<'a>,
    span: Span,
    children: &mut ArenaVec<'a, JSXChild<'a>>,
    ast: &AstBuilder<'a>,
) {
    if let Expression::ArrayExpression(array) = value.without_parentheses() {
        for element in &array.elements {
            if let Some(expression) = element.as_expression() {
                children.push(lower_child(expression.clone_in(ast.allocator()), span, ast));
            }
        }
    } else {
        children.push(lower_child(value.clone_in(ast.allocator()), span, ast));
    }
}

fn lower_child<'a>(expression: Expression<'a>, span: Span, ast: &AstBuilder<'a>) -> JSXChild<'a> {
    match expression {
        Expression::JSXElement(element) => JSXChild::Element(element),
        Expression::JSXFragment(fragment) => JSXChild::Fragment(fragment),
        expression => JSXChild::new_expression_container(span, expression.into(), ast),
    }
}

fn attribute<'a>(
    name: &str,
    value: Expression<'a>,
    span: Span,
    ast: &AstBuilder<'a>,
) -> JSXAttributeItem<'a> {
    JSXAttributeItem::new_attribute(
        span,
        JSXAttributeName::new_identifier(span, ast.allocator().alloc_str(name), ast),
        Some(JSXAttributeValue::new_expression_container(
            span,
            value.into(),
            ast,
        )),
        ast,
    )
}

fn lower_element_name<'a>(
    expression: &Expression<'a>,
    ast: &AstBuilder<'a>,
) -> Result<JSXElementName<'a>, &'static str> {
    match expression.without_parentheses() {
        Expression::StringLiteral(literal) => Ok(JSXElementName::new_identifier(
            literal.span,
            literal.value,
            ast,
        )),
        Expression::Identifier(identifier) => Ok(JSXElementName::IdentifierReference(
            identifier.clone_in(ast.allocator()),
        )),
        Expression::StaticMemberExpression(member) => Ok(JSXElementName::new_member_expression(
            member.span,
            lower_member_object(&member.object, ast)?,
            JSXIdentifier::new(member.property.span, member.property.name, ast),
            ast,
        )),
        _ => Err("dynamic React element factory tags are unsupported"),
    }
}

fn lower_member_object<'a>(
    expression: &Expression<'a>,
    ast: &AstBuilder<'a>,
) -> Result<JSXMemberExpressionObject<'a>, &'static str> {
    match expression.without_parentheses() {
        Expression::Identifier(identifier) => Ok(JSXMemberExpressionObject::IdentifierReference(
            identifier.clone_in(ast.allocator()),
        )),
        Expression::StaticMemberExpression(member) => {
            Ok(JSXMemberExpressionObject::new_member_expression(
                member.span,
                lower_member_object(&member.object, ast)?,
                JSXIdentifier::new(member.property.span, member.property.name, ast),
                ast,
            ))
        }
        Expression::ThisExpression(this) => Ok(JSXMemberExpressionObject::ThisExpression(
            this.clone_in(ast.allocator()),
        )),
        _ => Err("computed React component member tags are unsupported"),
    }
}

fn is_nullish_key(expression: &Expression<'_>) -> bool {
    matches!(expression.without_parentheses(), Expression::NullLiteral(_))
        || expression
            .without_parentheses()
            .get_identifier_reference()
            .is_some_and(|identifier| identifier.name == "undefined")
}

fn remove_consumed_imports(
    program: &mut Program<'_>,
    bindings: &LoweredReactBindings,
    consumed: &BTreeMap<SymbolId, usize>,
    scoping: &Scoping,
) {
    program.body.retain_mut(|statement| {
        let Statement::ImportDeclaration(import) = statement else {
            return true;
        };
        if !matches!(
            import.source.value.as_str(),
            "react" | "react/jsx-runtime" | "react/jsx-dev-runtime"
        ) {
            return true;
        }
        let Some(specifiers) = &mut import.specifiers else {
            return true;
        };
        specifiers.retain(|specifier| {
            let symbol = match specifier {
                ImportDeclarationSpecifier::ImportSpecifier(specifier) => {
                    specifier.local.symbol_id.get()
                }
                ImportDeclarationSpecifier::ImportDefaultSpecifier(specifier) => {
                    specifier.local.symbol_id.get()
                }
                ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) => {
                    specifier.local.symbol_id.get()
                }
            };
            let Some(symbol) = symbol else {
                return true;
            };
            let removable = bindings.removable_named.contains(&symbol)
                || bindings.removable_namespaces.contains(&symbol);
            let all_consumed = consumed.get(&symbol).copied().unwrap_or_default()
                == scoping.get_resolved_reference_ids(symbol).len();
            !(removable && all_consumed)
        });
        !specifiers.is_empty()
    });
}

fn module_export_name<'a>(name: &'a ModuleExportName<'a>) -> &'a str {
    match name {
        ModuleExportName::IdentifierName(identifier) => identifier.name.as_str(),
        ModuleExportName::IdentifierReference(identifier) => identifier.name.as_str(),
        ModuleExportName::StringLiteral(literal) => literal.value.as_str(),
    }
}

fn unsupported(message: impl Into<String>, span: Option<Span>) -> Diagnostic {
    let diagnostic = Diagnostic::new(DiagnosticCode::UnsupportedSyntax, message);
    match span {
        Some(span) => diagnostic.with_span(SourceSpan::new(span.start, span.end)),
        None => diagnostic,
    }
}
