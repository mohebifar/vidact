use vidact_compiler::{
    OxcReactAnalysisAdapter,
    analysis::{ModuleInput, ReactAnalysisAdapter},
    lower_component,
};

fn analyze(source: &str) -> vidact_compiler::ComponentIr {
    let [facts] = OxcReactAnalysisAdapter
        .analyze(ModuleInput {
            filename: "data-flow.tsx",
            source,
        })
        .expect("fixture should pass React Compiler analysis")
        .try_into()
        .expect("fixture should contain one component");
    lower_component(facts).expect("stable SSA facts should lower")
}

#[test]
fn lowers_branch_join_predecessors_and_phi_operands() {
    let component = analyze(
        r#"
            import { useState } from 'react';
            export function BranchJoin({ first, second }) {
                const [alternate] = useState(false);
                let selected;
                if (alternate) {
                    selected = first;
                } else {
                    selected = second;
                }
                return <p title={selected}>{selected}</p>;
            }
        "#,
    );

    let phi = component
        .reactive_flow
        .blocks
        .iter()
        .flat_map(|block| &block.phis)
        .find(|phi| phi.target.name.as_deref() == Some("selected"))
        .expect("the branch-dependent local needs an explicit phi");
    assert_eq!(phi.operands.len(), 2);
    assert!(
        phi.operands
            .iter()
            .all(|operand| operand.value.declaration_id == phi.target.declaration_id)
    );
    let block = component
        .reactive_flow
        .blocks
        .iter()
        .find(|block| {
            block
                .phis
                .iter()
                .any(|candidate| candidate.target.id == phi.target.id)
        })
        .expect("phi belongs to a lowered block");
    assert_eq!(
        phi.operands
            .iter()
            .map(|operand| operand.predecessor)
            .collect::<Vec<_>>(),
        block.predecessors
    );
}

#[test]
fn preserves_nested_join_order_and_public_source_identity() {
    let component = analyze(
        r#"
            import { useState } from 'react';
            export function NestedJoin({ first, second, third }) {
                const [mode] = useState(0);
                let selected;
                if (mode === 0) {
                    selected = first;
                } else if (mode === 1) {
                    selected = second;
                } else {
                    selected = third;
                }
                return <p>{selected}</p>;
            }
        "#,
    );

    let joins = component
        .reactive_flow
        .blocks
        .iter()
        .flat_map(|block| &block.phis)
        .filter(|phi| phi.target.name.as_deref() == Some("selected"))
        .collect::<Vec<_>>();
    assert!(!joins.is_empty());
    for phi in joins {
        let mut predecessors = phi
            .operands
            .iter()
            .map(|operand| operand.predecessor)
            .collect::<Vec<_>>();
        predecessors.sort_unstable();
        predecessors.dedup();
        assert_eq!(predecessors.len(), phi.operands.len());
    }

    for expected in ["first", "second", "third", "mode"] {
        let source = component
            .sources
            .iter()
            .find(|source| source.name == expected)
            .expect("public source is classified");
        assert!(component.control_flow.blocks.iter().any(|block| {
            block.instructions.iter().any(|instruction| {
                instruction.dependencies.iter().any(|value| {
                    value.name.as_deref() == Some(expected) && value.source == Some(source.id)
                })
            })
        }));
    }
}

#[test]
fn sequential_reassignment_does_not_invent_a_phi_cycle() {
    let component = analyze(
        r#"
            export function Sequential({ first, second }) {
                let selected = first;
                selected = second;
                return <p>{selected}</p>;
            }
        "#,
    );

    let targets = component
        .reactive_flow
        .blocks
        .iter()
        .flat_map(|block| &block.phis)
        .map(|phi| phi.target.id)
        .collect::<Vec<_>>();
    assert_eq!(
        targets
            .iter()
            .copied()
            .collect::<std::collections::BTreeSet<_>>()
            .len(),
        targets.len()
    );
}

#[test]
fn callback_local_and_shadowed_values_do_not_join_the_component_binding() {
    let component = analyze(
        r#"
            export function Shadowed({ first, second }) {
                let selected = first;
                [second].forEach((value) => {
                    let selected = value;
                    if (selected) selected = value;
                });
                return <p>{selected}</p>;
            }
        "#,
    );

    let component_declarations = component
        .control_flow
        .blocks
        .iter()
        .flat_map(|block| &block.instructions)
        .flat_map(|instruction| instruction.lvalues.iter().chain(&instruction.dependencies))
        .filter(|value| value.name.as_deref() == Some("selected"))
        .map(|value| value.declaration_id)
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(component_declarations.len(), 1);
}
