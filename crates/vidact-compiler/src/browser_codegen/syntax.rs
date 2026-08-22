use std::collections::{BTreeMap, BTreeSet};

use oxc_ast::ast::{
    BindingPattern, Expression, JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXChild,
    JSXElement, JSXElementName, Program, Statement,
};
use oxc_semantic::Scoping;
use oxc_span::GetSpan;
use oxc_syntax::symbol::SymbolId;

use crate::{
    Diagnostic, DiagnosticCode, SourceSpan, ast_utils::component_function,
    react_bindings::ReactBindings,
};

#[derive(Debug)]
pub(super) struct ComponentSyntax<'a> {
    pub state: StateSyntax<'a>,
    pub derivations: BTreeMap<String, &'a Expression<'a>>,
    pub root: RootSyntax<'a>,
}

impl ComponentSyntax<'_> {
    pub(super) fn is_numeric_derivation(&self, name: &str) -> bool {
        let mut visiting = BTreeSet::new();
        self.derivations
            .get(name)
            .is_some_and(|expression| self.is_numeric_expression(expression, &mut visiting))
    }

    fn is_numeric_expression(
        &self,
        expression: &Expression<'_>,
        visiting: &mut BTreeSet<String>,
    ) -> bool {
        match expression.without_parentheses() {
            Expression::NumericLiteral(_) => true,
            Expression::Identifier(identifier)
                if identifier.name.as_str() == self.state.value.as_str() =>
            {
                true
            }
            Expression::Identifier(identifier) => {
                let name = identifier.name.as_str();
                if !visiting.insert(name.to_string()) {
                    return false;
                }
                let is_numeric = self
                    .derivations
                    .get(name)
                    .is_some_and(|expression| self.is_numeric_expression(expression, visiting));
                visiting.remove(name);
                is_numeric
            }
            Expression::UnaryExpression(unary) if unary.operator.is_arithmetic() => {
                self.is_numeric_expression(&unary.argument, visiting)
            }
            Expression::BinaryExpression(binary) if binary.operator.is_arithmetic() => {
                self.is_numeric_expression(&binary.left, visiting)
                    && self.is_numeric_expression(&binary.right, visiting)
            }
            Expression::StaticMemberExpression(member)
                if member.property.name == "length"
                    && matches!(
                        member.object.without_parentheses(),
                        Expression::StringLiteral(_)
                    ) =>
            {
                true
            }
            _ => false,
        }
    }
}

#[derive(Debug)]
pub(super) struct StateSyntax<'a> {
    pub value: String,
    pub setter: String,
    pub initial: &'a Expression<'a>,
    pub value_symbol: SymbolId,
    pub setter_symbol: SymbolId,
}

#[derive(Debug)]
pub(super) struct RootSyntax<'a> {
    pub tag: String,
    pub attributes: BTreeMap<String, &'a Expression<'a>>,
    pub text: &'a Expression<'a>,
    pub click: Option<&'a Expression<'a>>,
}

pub(super) fn extract<'a>(
    program: &'a Program<'a>,
    scoping: &Scoping,
    component_name: &str,
    component_span: Option<SourceSpan>,
) -> Result<ComponentSyntax<'a>, Diagnostic> {
    let function =
        component_function(program, component_name, component_span).ok_or_else(|| {
            unsupported(format!(
                "could not find component function {component_name} in the parsed module"
            ))
        })?;
    let body = function
        .body
        .as_deref()
        .ok_or_else(|| unsupported("component function has no body"))?;

    let mut state = None;
    let mut derivations = BTreeMap::new();
    let mut root = None;
    let react = ReactBindings::new(program, scoping);

    for statement in &body.statements {
        match statement {
            Statement::VariableDeclaration(declaration) => {
                for declarator in &declaration.declarations {
                    if let Some(binding) =
                        state_binding(&declarator.id, declarator.init.as_ref(), &react)?
                    {
                        if state.replace(binding).is_some() {
                            return Err(unsupported(
                                "the browser spike currently supports exactly one state binding",
                            ));
                        }
                    } else if let BindingPattern::BindingIdentifier(identifier) = &declarator.id
                        && let Some(initializer) = declarator.init.as_ref()
                    {
                        derivations.insert(identifier.name.to_string(), initializer);
                    }
                }
            }
            Statement::ReturnStatement(return_statement) => {
                let Some(Expression::JSXElement(element)) = return_statement
                    .argument
                    .as_ref()
                    .map(Expression::without_parentheses)
                else {
                    continue;
                };
                root = Some(root_element(element)?);
            }
            _ => {}
        }
    }

    Ok(ComponentSyntax {
        state: state.ok_or_else(|| {
            unsupported(
                "the browser spike requires exactly one const [value, setter] = useState(...) binding",
            )
        })?,
        derivations,
        root: root.ok_or_else(|| {
            unsupported("component does not return an intrinsic JSX element")
        })?,
    })
}

fn state_binding<'a>(
    pattern: &'a BindingPattern<'a>,
    initializer: Option<&'a Expression<'a>>,
    react: &ReactBindings<'_>,
) -> Result<Option<StateSyntax<'a>>, Diagnostic> {
    let BindingPattern::ArrayPattern(pattern) = pattern else {
        return Ok(None);
    };
    let Some(Expression::CallExpression(call)) = initializer else {
        return Ok(None);
    };
    if !react.is_use_state_call(call) {
        return Ok(None);
    }

    let [
        Some(BindingPattern::BindingIdentifier(value)),
        Some(BindingPattern::BindingIdentifier(setter)),
    ] = pattern.elements.as_slice()
    else {
        return Err(unsupported(
            "useState must bind a [value, setter] identifier tuple",
        ));
    };
    let [initial] = call.arguments.as_slice() else {
        return Err(unsupported(
            "the browser spike requires one useState initializer",
        ));
    };
    let initial = initial
        .as_expression()
        .ok_or_else(|| unsupported("spread useState initializers are unsupported"))?;
    if !is_numeric_initializer(initial) {
        return Err(unsupported(
            "the browser spike currently requires a numeric useState initializer",
        ));
    }
    let value_symbol = value.symbol_id.get().ok_or_else(|| {
        analysis_error(format!(
            "semantic analysis did not resolve state binding {} at {:?}",
            value.name,
            value.span()
        ))
    })?;
    let setter_symbol = setter.symbol_id.get().ok_or_else(|| {
        analysis_error(format!(
            "semantic analysis did not resolve setter binding {} at {:?}",
            setter.name,
            setter.span()
        ))
    })?;

    Ok(Some(StateSyntax {
        value: value.name.to_string(),
        setter: setter.name.to_string(),
        initial,
        value_symbol,
        setter_symbol,
    }))
}

fn is_numeric_initializer(expression: &Expression<'_>) -> bool {
    match expression.without_parentheses() {
        Expression::NumericLiteral(_) => true,
        Expression::UnaryExpression(unary) if unary.operator.is_arithmetic() => {
            matches!(
                unary.argument.without_parentheses(),
                Expression::NumericLiteral(_)
            )
        }
        _ => false,
    }
}

fn root_element<'a>(element: &'a JSXElement<'a>) -> Result<RootSyntax<'a>, Diagnostic> {
    let JSXElementName::Identifier(tag) = &element.opening_element.name else {
        return Err(unsupported(
            "the browser spike does not emit component JSX elements",
        ));
    };
    if tag.name.chars().next().is_some_and(char::is_uppercase) {
        return Err(unsupported(
            "the browser spike does not emit component JSX elements",
        ));
    }

    let mut attributes = BTreeMap::new();
    let mut click = None;
    for item in &element.opening_element.attributes {
        let JSXAttributeItem::Attribute(attribute) = item else {
            return Err(unsupported("JSX spread attributes are unsupported"));
        };
        let JSXAttributeName::Identifier(name) = &attribute.name else {
            return Err(unsupported("namespaced JSX attributes are unsupported"));
        };
        let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
            return Err(unsupported(format!(
                "the browser spike requires expression syntax for attribute {}",
                name.name
            )));
        };
        let expression = container.expression.as_expression().ok_or_else(|| {
            unsupported(format!("empty JSX expression for attribute {}", name.name))
        })?;
        if name.name == "onClick" {
            if !matches!(
                expression.without_parentheses(),
                Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
            ) {
                return Err(unsupported(
                    "the browser spike requires an inline function for onClick",
                ));
            }
            click = Some(expression);
        } else {
            attributes.insert(name.name.to_string(), expression);
        }
    }

    let children = element
        .children
        .iter()
        .filter(|child| !matches!(child, JSXChild::Text(text) if text.value.trim().is_empty()))
        .collect::<Vec<_>>();
    let [JSXChild::ExpressionContainer(container)] = children.as_slice() else {
        return Err(unsupported(
            "the browser spike requires exactly one JSX child expression and no static text",
        ));
    };
    let text = container
        .expression
        .as_expression()
        .ok_or_else(|| unsupported("empty JSX child expression"))?;

    Ok(RootSyntax {
        tag: tag.name.to_string(),
        attributes,
        text,
        click,
    })
}

fn unsupported(message: impl Into<String>) -> Diagnostic {
    Diagnostic::new(DiagnosticCode::UnsupportedSyntax, message)
}

fn analysis_error(message: impl Into<String>) -> Diagnostic {
    Diagnostic::new(DiagnosticCode::AnalysisFailed, message)
}
