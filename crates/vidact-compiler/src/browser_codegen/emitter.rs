use oxc_allocator::{Allocator, GetAllocator};
use oxc_ast::{ast::*, builder::AstBuilder};
use oxc_semantic::Scoping;
use oxc_span::{SPAN, SourceType};

use crate::{
    Diagnostic, DiagnosticCode,
    analysis::{SourceId, SourceKind, UpdaterKind},
    ir::{ComponentIr, IrUpdater},
};

use super::{
    rewrite::{calls_symbol, clone_and_rewrite},
    syntax::ComponentSyntax,
};

pub(super) fn emit_program<'a>(
    allocator: &'a Allocator,
    scoping: &Scoping,
    ir: &ComponentIr,
    syntax: &ComponentSyntax<'a>,
) -> Result<Program<'a>, Diagnostic> {
    Emitter {
        ast: AstBuilder::new(allocator),
        scoping,
        ir,
        syntax,
    }
    .program()
}

struct Emitter<'a, 's> {
    ast: AstBuilder<'a>,
    scoping: &'s Scoping,
    ir: &'s ComponentIr,
    syntax: &'s ComponentSyntax<'a>,
}

impl<'a> Emitter<'a, '_> {
    fn program(&self) -> Result<Program<'a>, Diagnostic> {
        self.validate_reactive_coverage()?;
        let imports = if self
            .ir
            .updaters
            .iter()
            .any(|updater| updater.reads.len() != 1 || updater.writes.len() > 1)
        {
            vec![
                "combineSources",
                "createStateSlot",
                "createUpdaterScope",
                "source",
            ]
        } else {
            vec!["createStateSlot", "createUpdaterScope", "source"]
        };
        let mount = self.mount_function()?;
        Ok(Program::new(
            SPAN,
            SourceType::ts(),
            "",
            [],
            None,
            [],
            [self.import_declaration(&imports), mount],
            &self.ast,
        ))
    }

    fn validate_reactive_coverage(&self) -> Result<(), Diagnostic> {
        if self
            .ir
            .sources
            .iter()
            .any(|source| !matches!(source.kind, SourceKind::State | SourceKind::Derived))
        {
            return Err(unsupported(
                "the browser spike currently emits only state and derived sources",
            ));
        }
        if !self
            .ir
            .updaters
            .iter()
            .any(|updater| updater.kind == UpdaterKind::Text)
        {
            return Err(unsupported(
                "the browser spike requires its JSX child expression to be reactive",
            ));
        }
        for name in self.syntax.root.attributes.keys() {
            if !self.ir.updaters.iter().any(
                |updater| matches!(&updater.kind, UpdaterKind::Attribute { name: updater_name } if updater_name == name),
            ) {
                return Err(unsupported(format!(
                    "attribute {name} is not covered by a reactive updater"
                )));
            }
        }
        Ok(())
    }

    fn import_declaration(&self, names: &[&str]) -> Statement<'a> {
        let specifiers = oxc_allocator::Vec::from_iter_in(
            names
                .iter()
                .map(|name| {
                    ImportDeclarationSpecifier::new_import_specifier(
                        SPAN,
                        ModuleExportName::new_identifier_name(SPAN, self.atom(name), &self.ast),
                        BindingIdentifier::new(SPAN, self.atom(name), &self.ast),
                        ImportOrExportKind::Value,
                        &self.ast,
                    )
                })
                .chain(std::iter::once(
                    ImportDeclarationSpecifier::new_import_specifier(
                        SPAN,
                        ModuleExportName::new_identifier_name(SPAN, "StateSlot", &self.ast),
                        BindingIdentifier::new(SPAN, "StateSlot", &self.ast),
                        ImportOrExportKind::Type,
                        &self.ast,
                    ),
                )),
            &self.ast,
        );
        Statement::new_import_declaration(
            SPAN,
            Some(specifiers),
            StringLiteral::new(SPAN, "@vidact/runtime", None, &self.ast),
            None,
            None,
            ImportOrExportKind::Value,
            &self.ast,
        )
    }

    fn mount_function(&self) -> Result<Statement<'a>, Diagnostic> {
        let mut statements = oxc_allocator::Vec::new_in(&self.ast);
        statements.push(self.const_statement(
            "element",
            self.call_member(
                self.ident("document"),
                "createElement",
                [self.string(&self.syntax.root.tag)],
            ),
        ));
        statements.push(self.const_statement(
            "text",
            self.call_member(self.ident("document"), "createTextNode", [self.string("")]),
        ));
        statements.push(self.expression_statement(self.call_member(
            self.ident("element"),
            "append",
            [self.ident("text")],
        )));
        statements.push(self.typed_const_statement(
            "trace",
            self.array([]),
            TSType::new_ts_array_type(
                SPAN,
                TSType::new_ts_string_keyword(SPAN, &self.ast),
                &self.ast,
            ),
        ));
        statements.push(self.typed_let_statement(
            &self.syntax.state.value,
            self.named_type(
                "StateSlot",
                [TSType::new_ts_number_keyword(SPAN, &self.ast)],
            ),
        ));
        for source in self
            .ir
            .sources
            .iter()
            .filter(|source| source.kind == SourceKind::Derived)
        {
            statements.push(
                self.typed_let_statement(
                    &source.name,
                    TSType::new_ts_number_keyword(SPAN, &self.ast),
                ),
            );
        }

        let updaters = self
            .ir
            .updaters
            .iter()
            .map(|updater| self.updater(updater))
            .collect::<Result<Vec<_>, _>>()?;
        statements.push(self.const_statement("updaters", self.array(updaters)));
        statements.push(self.const_statement(
            "scope",
            self.call_name("createUpdaterScope", [self.ident("updaters")]),
        ));

        let state_source = self
            .ir
            .sources
            .iter()
            .find(|source| {
                source.kind == SourceKind::State && source.name == self.syntax.state.value
            })
            .ok_or_else(|| {
                unsupported("the emitted state binding is absent from analysis facts")
            })?;
        statements.push(self.assignment_statement(
            AssignmentTarget::new_assignment_target_identifier(
                SPAN,
                self.atom(&self.syntax.state.value),
                &self.ast,
            ),
            self.call_name(
                "createStateSlot",
                [
                    self.ident("scope"),
                    self.call_name("source", [self.number(state_source.id.get())]),
                    self.rewrite(self.syntax.state.initial),
                ],
            ),
        ));

        let run_updater = self.arrow_expression(
            ["updater"],
            ArrowFunctionBody::from(self.call_member(
                self.ident("updater"),
                "run",
                std::iter::empty::<Expression<'a>>(),
            )),
        );
        statements.push(self.expression_statement(self.call_member(
            self.ident("updaters"),
            "forEach",
            [run_updater],
        )));
        statements.push(self.assignment_statement(
            AssignmentTarget::new_static_member_expression(
                SPAN,
                self.ident("trace"),
                IdentifierName::new(SPAN, "length", &self.ast),
                false,
                &self.ast,
            ),
            self.number(0),
        ));

        if let Some(handler) = self.syntax.root.click {
            if !calls_symbol(handler, self.syntax.state.setter_symbol, self.scoping) {
                return Err(unsupported(
                    "the browser spike click handler must call its state setter",
                ));
            }
            statements.push(self.const_statement("handleClick", self.rewrite(handler)));
            statements.push(self.expression_statement(self.call_member(
                self.ident("element"),
                "addEventListener",
                [self.string("click"), self.ident("handleClick")],
            )));
            let dispose_body = [
                self.expression_statement(self.call_member(
                    self.ident("element"),
                    "removeEventListener",
                    [self.string("click"), self.ident("handleClick")],
                )),
                self.expression_statement(self.call_member(
                    self.ident("scope"),
                    "dispose",
                    std::iter::empty::<Expression<'a>>(),
                )),
            ];
            statements.push(self.const_statement(
                "dispose",
                self.arrow_block(std::iter::empty::<&str>(), dispose_body),
            ));
        } else {
            statements
                .push(self.const_statement("dispose", self.member(self.ident("scope"), "dispose")));
        }

        statements.push(self.expression_statement(self.call_member(
            self.ident("host"),
            "append",
            [self.ident("element")],
        )));
        statements.push(Statement::new_return_statement(
            SPAN,
            Some(self.object([
                ("element", self.ident("element")),
                (
                    self.syntax.state.setter.as_str(),
                    self.member(self.ident(&self.syntax.state.value), "set"),
                ),
                ("batch", self.member(self.ident("scope"), "batch")),
                ("trace", self.ident("trace")),
                ("dispose", self.ident("dispose")),
            ])),
            &self.ast,
        ));

        let mount_name = format!("mount{}", self.ir.name);
        let declaration = Declaration::new_function_declaration(
            SPAN,
            FunctionType::FunctionDeclaration,
            Some(BindingIdentifier::new(
                SPAN,
                self.atom(&mount_name),
                &self.ast,
            )),
            false,
            false,
            false,
            None,
            None,
            self.typed_parameters(
                FormalParameterKind::FormalParameter,
                [("host", self.named_type("ParentNode", []))],
            ),
            None,
            Some(FunctionBody::boxed(SPAN, [], statements, &self.ast)),
            &self.ast,
        );
        Ok(Statement::new_export_declaration(
            SPAN,
            declaration,
            &self.ast,
        ))
    }

    fn updater(&self, updater: &IrUpdater) -> Result<Expression<'a>, Diagnostic> {
        let reads = self.mask(&updater.reads);
        let writes = (!updater.writes.is_empty()).then(|| self.mask(&updater.writes));
        let (label, operation) = match &updater.kind {
            UpdaterKind::Derived => {
                let [write] = updater.writes.as_slice() else {
                    return Err(unsupported(
                        "a derived updater must write exactly one source",
                    ));
                };
                let name = self.source_name(*write)?;
                let expression = self.syntax.derivations.get(name).ok_or_else(|| {
                    unsupported(format!(
                        "missing source expression for derived binding {name}"
                    ))
                })?;
                if !self.syntax.is_numeric_derivation(name) {
                    return Err(unsupported(format!(
                        "derived binding {name} is outside the numeric browser spike subset"
                    )));
                }
                (
                    format!("derived:{name}"),
                    self.assignment_statement(
                        AssignmentTarget::new_assignment_target_identifier(
                            SPAN,
                            self.atom(name),
                            &self.ast,
                        ),
                        self.rewrite(expression),
                    ),
                )
            }
            UpdaterKind::Attribute { name } => {
                let expression = self.syntax.root.attributes.get(name).ok_or_else(|| {
                    unsupported(format!("missing JSX expression for attribute {name}"))
                })?;
                (
                    format!("attribute:{name}"),
                    self.expression_statement(self.call_member(
                        self.ident("element"),
                        "setAttribute",
                        [
                            self.string(name),
                            self.call_name("String", [self.rewrite(expression)]),
                        ],
                    )),
                )
            }
            UpdaterKind::Text => (
                "text".to_string(),
                self.assignment_statement(
                    AssignmentTarget::new_static_member_expression(
                        SPAN,
                        self.ident("text"),
                        IdentifierName::new(SPAN, "data", &self.ast),
                        false,
                        &self.ast,
                    ),
                    self.call_name("String", [self.rewrite(self.syntax.root.text)]),
                ),
            ),
            kind => {
                return Err(unsupported(format!(
                    "the browser spike cannot emit updater kind {kind:?}"
                )));
            }
        };

        let run = self.arrow_block(
            std::iter::empty::<&str>(),
            [
                self.expression_statement(self.call_member(
                    self.ident("trace"),
                    "push",
                    [self.string(&label)],
                )),
                operation,
            ],
        );
        let mut properties = vec![("reads", reads)];
        if let Some(writes) = writes {
            properties.push(("writes", writes));
        }
        properties.push(("run", run));
        Ok(self.object(properties))
    }

    fn source_name(&self, id: SourceId) -> Result<&str, Diagnostic> {
        self.ir
            .sources
            .iter()
            .find(|source| source.id == id)
            .map(|source| source.name.as_str())
            .ok_or_else(|| unsupported(format!("updater references unknown source {}", id.get())))
    }

    fn mask(&self, ids: &[SourceId]) -> Expression<'a> {
        let mut sources = ids
            .iter()
            .map(|id| self.call_name("source", [self.number(id.get())]));
        let first = sources.next().expect("updater masks are never empty");
        match sources.next() {
            None => first,
            Some(second) => self.call_name(
                "combineSources",
                std::iter::once(first)
                    .chain(std::iter::once(second))
                    .chain(sources),
            ),
        }
    }

    fn rewrite(&self, expression: &Expression<'a>) -> Expression<'a> {
        clone_and_rewrite(
            expression,
            &self.syntax.state,
            self.scoping,
            self.ast.allocator(),
        )
    }

    fn ident(&self, name: &str) -> Expression<'a> {
        Expression::new_identifier(SPAN, self.atom(name), &self.ast)
    }

    fn string(&self, value: &str) -> Expression<'a> {
        Expression::new_string_literal(SPAN, self.atom(value), None, &self.ast)
    }

    fn number(&self, value: u32) -> Expression<'a> {
        Expression::new_numeric_literal(
            SPAN,
            f64::from(value),
            None,
            NumberBase::Decimal,
            &self.ast,
        )
    }

    fn member(&self, object: Expression<'a>, property: &str) -> Expression<'a> {
        Expression::from(MemberExpression::new_static_member_expression(
            SPAN,
            object,
            IdentifierName::new(SPAN, self.atom(property), &self.ast),
            false,
            &self.ast,
        ))
    }

    fn call_name(
        &self,
        name: &str,
        arguments: impl IntoIterator<Item = Expression<'a>>,
    ) -> Expression<'a> {
        self.call(self.ident(name), arguments)
    }

    fn call_member(
        &self,
        object: Expression<'a>,
        property: &str,
        arguments: impl IntoIterator<Item = Expression<'a>>,
    ) -> Expression<'a> {
        self.call(self.member(object, property), arguments)
    }

    fn call(
        &self,
        callee: Expression<'a>,
        arguments: impl IntoIterator<Item = Expression<'a>>,
    ) -> Expression<'a> {
        let arguments =
            oxc_allocator::Vec::from_iter_in(arguments.into_iter().map(Argument::from), &self.ast);
        Expression::new_call_expression(SPAN, callee, None, arguments, false, &self.ast)
    }

    fn array(&self, elements: impl IntoIterator<Item = Expression<'a>>) -> Expression<'a> {
        let elements = oxc_allocator::Vec::from_iter_in(
            elements.into_iter().map(ArrayExpressionElement::from),
            &self.ast,
        );
        Expression::new_array_expression(SPAN, elements, &self.ast)
    }

    fn object<'n>(
        &self,
        properties: impl IntoIterator<Item = (&'n str, Expression<'a>)>,
    ) -> Expression<'a> {
        let properties = oxc_allocator::Vec::from_iter_in(
            properties.into_iter().map(|(name, value)| {
                ObjectPropertyKind::new_object_property(
                    SPAN,
                    PropertyKind::Init,
                    PropertyKey::new_static_identifier(SPAN, self.atom(name), &self.ast),
                    value,
                    false,
                    false,
                    false,
                    &self.ast,
                )
            }),
            &self.ast,
        );
        Expression::new_object_expression(SPAN, properties, &self.ast)
    }

    fn parameters(
        &self,
        kind: FormalParameterKind,
        names: impl IntoIterator<Item = &'a str>,
    ) -> oxc_allocator::Box<'a, FormalParameters<'a>> {
        let items = oxc_allocator::Vec::from_iter_in(
            names.into_iter().map(|name| {
                FormalParameter::new(
                    SPAN,
                    [],
                    BindingPattern::new_binding_identifier(SPAN, self.atom(name), &self.ast),
                    None,
                    None,
                    false,
                    None,
                    false,
                    false,
                    &self.ast,
                )
            }),
            &self.ast,
        );
        FormalParameters::boxed(SPAN, kind, items, None, &self.ast)
    }

    fn arrow_expression(
        &self,
        params: impl IntoIterator<Item = &'a str>,
        body: ArrowFunctionBody<'a>,
    ) -> Expression<'a> {
        Expression::new_arrow_function_expression(
            SPAN,
            false,
            None,
            self.parameters(FormalParameterKind::ArrowFormalParameters, params),
            None,
            body,
            &self.ast,
        )
    }

    fn arrow_block(
        &self,
        params: impl IntoIterator<Item = &'a str>,
        statements: impl IntoIterator<Item = Statement<'a>>,
    ) -> Expression<'a> {
        let statements = oxc_allocator::Vec::from_iter_in(statements, &self.ast);
        self.arrow_expression(
            params,
            ArrowFunctionBody::new_function_body(SPAN, [], statements, &self.ast),
        )
    }

    fn const_statement(&self, name: &str, initializer: Expression<'a>) -> Statement<'a> {
        self.variable_statement(
            VariableDeclarationKind::Const,
            name,
            Some(initializer),
            None,
        )
    }

    fn typed_const_statement(
        &self,
        name: &str,
        initializer: Expression<'a>,
        type_annotation: TSType<'a>,
    ) -> Statement<'a> {
        self.variable_statement(
            VariableDeclarationKind::Const,
            name,
            Some(initializer),
            Some(type_annotation),
        )
    }

    fn typed_let_statement(&self, name: &str, type_annotation: TSType<'a>) -> Statement<'a> {
        self.variable_statement(
            VariableDeclarationKind::Let,
            name,
            None,
            Some(type_annotation),
        )
    }

    fn variable_statement(
        &self,
        kind: VariableDeclarationKind,
        name: &str,
        initializer: Option<Expression<'a>>,
        type_annotation: Option<TSType<'a>>,
    ) -> Statement<'a> {
        Statement::new_variable_declaration(
            SPAN,
            kind,
            [VariableDeclarator::new(
                SPAN,
                kind,
                BindingPattern::new_binding_identifier(SPAN, self.atom(name), &self.ast),
                type_annotation
                    .map(|annotation| TSTypeAnnotation::boxed(SPAN, annotation, &self.ast)),
                initializer,
                false,
                &self.ast,
            )],
            false,
            &self.ast,
        )
    }

    fn assignment_statement(
        &self,
        target: AssignmentTarget<'a>,
        value: Expression<'a>,
    ) -> Statement<'a> {
        self.expression_statement(Expression::new_assignment_expression(
            SPAN,
            AssignmentOperator::Assign,
            target,
            value,
            &self.ast,
        ))
    }

    fn expression_statement(&self, expression: Expression<'a>) -> Statement<'a> {
        Statement::new_expression_statement(SPAN, expression, &self.ast)
    }

    fn typed_parameters<'n>(
        &self,
        kind: FormalParameterKind,
        parameters: impl IntoIterator<Item = (&'n str, TSType<'a>)>,
    ) -> oxc_allocator::Box<'a, FormalParameters<'a>> {
        let items = oxc_allocator::Vec::from_iter_in(
            parameters.into_iter().map(|(name, annotation)| {
                FormalParameter::new(
                    SPAN,
                    [],
                    BindingPattern::new_binding_identifier(SPAN, self.atom(name), &self.ast),
                    Some(TSTypeAnnotation::boxed(SPAN, annotation, &self.ast)),
                    None,
                    false,
                    None,
                    false,
                    false,
                    &self.ast,
                )
            }),
            &self.ast,
        );
        FormalParameters::boxed(SPAN, kind, items, None, &self.ast)
    }

    fn named_type(
        &self,
        name: &str,
        arguments: impl IntoIterator<Item = TSType<'a>>,
    ) -> TSType<'a> {
        let arguments = oxc_allocator::Vec::from_iter_in(arguments, &self.ast);
        let arguments = (!arguments.is_empty())
            .then(|| TSTypeParameterInstantiation::boxed(SPAN, arguments, &self.ast));
        TSType::new_ts_type_reference(
            SPAN,
            TSTypeName::new_identifier_reference(SPAN, self.atom(name), &self.ast),
            arguments,
            &self.ast,
        )
    }

    fn atom(&self, value: &str) -> &'a str {
        self.ast.allocator().alloc_str(value)
    }
}

fn unsupported(message: impl Into<String>) -> Diagnostic {
    Diagnostic::new(DiagnosticCode::UnsupportedSyntax, message)
}
