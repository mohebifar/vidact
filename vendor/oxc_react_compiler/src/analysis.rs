//! Owned, pre-codegen analysis snapshots for compiler integrations.
//!
//! These types intentionally do not expose the arena-backed React Compiler HIR.
//! Scope facts are captured immediately before code generation. Def-use facts
//! are captured just before lvalue pruning, while source binding identities are
//! still available.

use crate::react_compiler_hir::{
    environment::Environment,
    visitors::{each_instruction_value_lvalue, each_instruction_value_operand},
    ReactiveFunction, ReactiveInstruction, ReactiveScopeBlock, ReactiveValue,
};
use crate::react_compiler_reactive_scopes::visitors::{
    visit_reactive_function, ReactiveFunctionVisitor,
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FunctionAnalysis {
    pub name: Option<String>,
    pub scopes: Vec<ScopeAnalysis>,
    pub instructions: Vec<InstructionAnalysis>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ScopeAnalysis {
    pub dependencies: Vec<DependencyAnalysis>,
    pub declarations: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DependencyAnalysis {
    pub name: String,
    pub path: Vec<String>,
    pub reactive: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InstructionAnalysis {
    pub lvalues: Vec<ValueAnalysis>,
    pub dependencies: Vec<ValueAnalysis>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValueAnalysis {
    pub id: usize,
    pub declaration_id: usize,
    pub name: Option<String>,
    pub span: Option<(u32, u32)>,
}

pub(crate) fn capture(
    function: &ReactiveFunction<'_>,
    environment: &Environment<'_>,
    instructions: Vec<InstructionAnalysis>,
) -> FunctionAnalysis {
    let visitor = ScopeSnapshotVisitor { environment };
    let mut state = SnapshotState::default();
    visit_reactive_function(function, &visitor, &mut state);

    FunctionAnalysis {
        name: function
            .id
            .or(function.name_hint)
            .map(|name| name.as_str().to_owned()),
        scopes: state.scopes,
        instructions,
    }
}

pub(crate) fn capture_instructions(
    function: &ReactiveFunction<'_>,
    environment: &Environment<'_>,
) -> Vec<InstructionAnalysis> {
    let visitor = ScopeSnapshotVisitor { environment };
    let mut state = SnapshotState::default();
    visit_reactive_function(function, &visitor, &mut state);
    state.instructions
}

#[derive(Default)]
struct SnapshotState {
    scopes: Vec<ScopeAnalysis>,
    instructions: Vec<InstructionAnalysis>,
}

struct ScopeSnapshotVisitor<'env, 'arena> {
    environment: &'env Environment<'arena>,
}

impl<'arena> ReactiveFunctionVisitor<'arena> for ScopeSnapshotVisitor<'_, 'arena> {
    type State = SnapshotState;

    fn env(&self) -> &Environment<'arena> {
        self.environment
    }

    fn visit_scope(&self, block: &ReactiveScopeBlock<'arena>, state: &mut Self::State) {
        let scope = &self.environment.scopes[block.scope];
        let dependencies = scope
            .dependencies
            .iter()
            .filter_map(|dependency| {
                let identifier = &self.environment.identifiers[dependency.identifier];
                let name = identifier.name?.value().to_owned();
                Some(DependencyAnalysis {
                    name,
                    path: dependency
                        .path
                        .iter()
                        .map(|entry| entry.property.to_string())
                        .collect(),
                    reactive: dependency.reactive,
                })
            })
            .collect();
        let declarations = scope
            .declarations
            .iter()
            .filter_map(|(_, declaration)| {
                self.environment.identifiers[declaration.identifier]
                    .name
                    .map(|name| name.value().to_owned())
            })
            .collect();

        state.scopes.push(ScopeAnalysis {
            dependencies,
            declarations,
        });
        self.traverse_scope(block, state);
    }

    fn visit_instruction(
        &self,
        instruction: &ReactiveInstruction<'arena>,
        state: &mut Self::State,
    ) {
        let mut lvalues = instruction
            .lvalue
            .into_iter()
            .map(|place| self.value_analysis(place.identifier))
            .collect::<Vec<_>>();
        if let ReactiveValue::Instruction(value) = &instruction.value {
            lvalues.extend(
                each_instruction_value_lvalue(value)
                    .into_iter()
                    .map(|place| self.value_analysis(place.identifier)),
            );
        }
        lvalues.sort_unstable_by_key(|value| value.id);
        lvalues.dedup_by_key(|value| value.id);
        let mut dependencies = Vec::new();
        self.collect_value_dependencies(&instruction.value, &mut dependencies);
        dependencies.sort_unstable_by_key(|value| value.id);
        dependencies.dedup_by_key(|value| value.id);
        state.instructions.push(InstructionAnalysis {
            lvalues,
            dependencies,
        });
        self.traverse_instruction(instruction, state);
    }
}

impl ScopeSnapshotVisitor<'_, '_> {
    fn value_analysis(&self, identifier: crate::react_compiler_hir::IdentifierId) -> ValueAnalysis {
        let identifier = &self.environment.identifiers[identifier];
        ValueAnalysis {
            id: identifier.id.index(),
            declaration_id: identifier.declaration_id.index(),
            name: identifier.name.map(|name| name.value().to_owned()),
            span: identifier.span.map(|span| (span.start, span.end)),
        }
    }

    fn collect_value_dependencies(
        &self,
        value: &ReactiveValue<'_>,
        dependencies: &mut Vec<ValueAnalysis>,
    ) {
        match value {
            ReactiveValue::Instruction(value) => dependencies.extend(
                each_instruction_value_operand(value, self.environment)
                    .into_iter()
                    .map(|place| self.value_analysis(place.identifier)),
            ),
            ReactiveValue::LogicalExpression { left, right, .. } => {
                self.collect_value_dependencies(left, dependencies);
                self.collect_value_dependencies(right, dependencies);
            }
            ReactiveValue::ConditionalExpression {
                test,
                consequent,
                alternate,
            } => {
                self.collect_value_dependencies(test, dependencies);
                self.collect_value_dependencies(consequent, dependencies);
                self.collect_value_dependencies(alternate, dependencies);
            }
            ReactiveValue::SequenceExpression {
                instructions,
                value,
                ..
            } => {
                for instruction in instructions {
                    self.collect_value_dependencies(&instruction.value, dependencies);
                }
                self.collect_value_dependencies(value, dependencies);
            }
            ReactiveValue::OptionalExpression { value, .. } => {
                self.collect_value_dependencies(value, dependencies);
            }
        }
    }
}
