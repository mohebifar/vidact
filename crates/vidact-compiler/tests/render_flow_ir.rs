use vidact_compiler::{
    OxcReactAnalysisAdapter,
    analysis::{ModuleInput, ReactAnalysisAdapter},
    render_flow::{
        RenderAlignmentKind, RenderDecisionKind, RenderFlowNodeKind, RenderIdentityKey,
        RenderIdentityKind, align_render_identities,
    },
};

fn analyze(source: &str) -> vidact_compiler::analysis::ComponentFacts {
    OxcReactAnalysisAdapter
        .analyze(ModuleInput {
            filename: "render-flow.tsx",
            source,
        })
        .expect("render flow must lower through React Compiler analysis")
        .into_iter()
        .next()
        .expect("fixture has one component")
}

#[test]
fn normalizes_early_returns_as_a_shared_decision_graph() {
    let source = r#"
        import { useState } from "react";
        export function Nested() {
            const [ready] = useState(false);
            const [admin] = useState(false);
            if (!ready) return <button>Load</button>;
            if (admin) return <Dashboard />;
            return <main>Home</main>;
        }
    "#;
    let facts = analyze(source);
    let entry = facts.render_flow.entry.expect("graph entry");
    let RenderFlowNodeKind::Decision {
        kind,
        test,
        consequent,
        alternate,
        ..
    } = facts.render_flow.nodes[entry.get()].kind
    else {
        panic!("outer early return must be a decision")
    };
    assert_eq!(kind, RenderDecisionKind::If);
    assert_eq!(&source[test.start as usize..test.end as usize], "!ready");
    assert!(matches!(
        facts.render_flow.nodes[consequent.get()].kind,
        RenderFlowNodeKind::Value { .. }
    ));
    assert!(matches!(
        facts.render_flow.nodes[alternate.get()].kind,
        RenderFlowNodeKind::Decision { .. }
    ));
    assert_eq!(facts.render_flow.nodes.len(), 5);
}

#[test]
fn aligns_static_type_key_and_position_without_guessing_dynamic_identity() {
    let source = r#"
        export function Identity({ ready, dynamicKey }) {
            if (ready) return <section key="same"><Child /><span>A</span></section>;
            return <section key="same"><Child /><strong key={dynamicKey}>B</strong></section>;
        }
    "#;
    let facts = analyze(source);
    let values = facts
        .render_flow
        .nodes
        .iter()
        .filter_map(|node| match &node.kind {
            RenderFlowNodeKind::Value { identity, .. } => Some(identity),
            _ => None,
        })
        .collect::<Vec<_>>();
    let alignment = align_render_identities(values[0], values[1]);
    assert_eq!(alignment.kind, RenderAlignmentKind::Preserve);
    assert_eq!(alignment.children[0].kind, RenderAlignmentKind::Preserve);
    assert_eq!(alignment.children[1].kind, RenderAlignmentKind::Dispatch);

    let changed_key = analyze(
        r#"
            export function Changed({ ready }) {
                if (ready) return <Child key="a" />;
                return <Child key="b" />;
            }
        "#,
    );
    let values = changed_key
        .render_flow
        .nodes
        .iter()
        .filter_map(|node| match &node.kind {
            RenderFlowNodeKind::Value { identity, .. } => Some(identity),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        align_render_identities(values[0], values[1]).kind,
        RenderAlignmentKind::Replace
    );
}

#[test]
fn preserves_ternary_and_logical_operator_value_semantics() {
    let cases = [
        ("flag ? <A /> : <B />", RenderDecisionKind::Ternary),
        ("flag && <A />", RenderDecisionKind::LogicalAnd),
        ("flag || <A />", RenderDecisionKind::LogicalOr),
        ("flag ?? <A />", RenderDecisionKind::NullishCoalescing),
    ];
    for (expression, expected) in cases {
        let source = format!("export function Choice({{ flag }}) {{ return {expression}; }}");
        let facts = analyze(&source);
        let entry = facts.render_flow.entry.expect("graph entry");
        let RenderFlowNodeKind::Decision {
            kind,
            consequent,
            alternate,
            ..
        } = facts.render_flow.nodes[entry.get()].kind
        else {
            panic!("{expression} must normalize to a decision")
        };
        assert_eq!(kind, expected, "{expression}");
        if expected != RenderDecisionKind::Ternary {
            let fallback = if expected == RenderDecisionKind::LogicalAnd {
                alternate
            } else {
                consequent
            };
            let RenderFlowNodeKind::Value {
                expression: span, ..
            } = facts.render_flow.nodes[fallback.get()].kind
            else {
                panic!("logical fallback must preserve the left JavaScript value")
            };
            let span = span.expect("logical fallback expression span");
            assert_eq!(&source[span.start as usize..span.end as usize], "flag");
        }
    }
}

#[test]
fn records_static_type_key_and_child_identity() {
    let source = r#"
        export function Identity({ ready }) {
            if (ready) return <section key="stable"><Child /><span>text</span></section>;
            return <section key="stable"><Child /><span>other</span></section>;
        }
    "#;
    let facts = analyze(source);
    let identities = facts
        .render_flow
        .nodes
        .iter()
        .filter_map(|node| match &node.kind {
            RenderFlowNodeKind::Value { identity, .. }
                if matches!(identity.kind, RenderIdentityKind::Host(_)) =>
            {
                Some(identity)
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(identities.len(), 2);
    for identity in identities {
        assert_eq!(
            identity.kind,
            RenderIdentityKind::Host("section".to_string())
        );
        assert_eq!(
            identity.key,
            RenderIdentityKey::Static("stable".to_string())
        );
        assert_eq!(identity.children.len(), 2);
        assert_eq!(
            identity.children[0].kind,
            RenderIdentityKind::Component("Child".to_string())
        );
        assert_eq!(
            identity.children[1].kind,
            RenderIdentityKind::Host("span".to_string())
        );
    }
}

#[test]
fn normalizes_terminal_switch_cases_without_enabling_fallthrough() {
    let source = r#"
        export function Switcher({ mode }) {
            switch (mode) {
                case "a": return <A />;
                case "b": return <B />;
                default: return null;
            }
        }
    "#;
    let facts = analyze(source);
    let entry = facts.render_flow.entry.expect("graph entry");
    let RenderFlowNodeKind::Switch {
        cases, fallback, ..
    } = &facts.render_flow.nodes[entry.get()].kind
    else {
        panic!("terminal switch must remain explicit in render flow")
    };
    assert_eq!(cases.len(), 3);
    assert_eq!(cases.iter().filter(|case| case.test.is_none()).count(), 1);
    assert!(matches!(
        facts.render_flow.nodes[fallback.get()].kind,
        RenderFlowNodeKind::Value { .. }
    ));

    let fallthrough = r#"
        export function Fallthrough({ mode }) {
            switch (mode) {
                case "a":
                case "b": return <B />;
                default: return null;
            }
        }
    "#;
    let diagnostics = OxcReactAnalysisAdapter
        .analyze(ModuleInput {
            filename: "fallthrough.tsx",
            source: fallthrough,
        })
        .expect_err("switch fallthrough remains deferred to phase 3");
    assert!(
        diagnostics[0]
            .message
            .contains("switch cases must terminate")
    );
}
