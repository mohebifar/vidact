use vidact_compiler::{
    DiagnosticCode, OxcReactAnalysisAdapter,
    analysis::{
        ControlFlowReturnVariant, ControlFlowTerminalKind, KeyPath, ModuleInput,
        ReactAnalysisAdapter, SourceKind, UpdaterKind,
    },
};

fn analyze(filename: &str, source: &str) -> vidact_compiler::analysis::ComponentFacts {
    let mut components = OxcReactAnalysisAdapter
        .analyze(ModuleInput { filename, source })
        .expect("fixture should be accepted by the React Compiler analysis pipeline");

    assert_eq!(components.len(), 1);
    components.remove(0)
}

#[test]
fn lowers_state_and_derived_dependencies() {
    let facts = analyze("counter.tsx", include_str!("fixtures/analysis/counter.tsx"));

    assert_eq!(facts.name, "Counter");
    assert!(
        facts
            .sources
            .iter()
            .any(|source| { source.name == "count" && source.kind == SourceKind::State })
    );
    assert!(
        facts
            .sources
            .iter()
            .any(|source| { source.name == "doubled" && source.kind == SourceKind::Derived })
    );
    assert!(facts.updaters.iter().any(|updater| {
        updater.kind == UpdaterKind::Derived
            && updater.reads.iter().any(|id| {
                facts
                    .sources
                    .iter()
                    .any(|source| source.id == *id && source.name == "count")
            })
            && updater.writes.iter().any(|id| {
                facts
                    .sources
                    .iter()
                    .any(|source| source.id == *id && source.name == "doubled")
            })
    }));
    assert!(
        facts
            .updaters
            .iter()
            .any(|updater| updater.kind == UpdaterKind::Text)
    );
}

#[test]
fn preserves_source_order_for_independent_derived_updaters() {
    let facts = analyze(
        "derived-order.tsx",
        r#"
            import { useState } from "react";
            export function Counter() {
                const [count] = useState(0);
                const zed = count + 1;
                const alpha = count + 2;
                return <p>{zed}{alpha}</p>;
            }
        "#,
    );

    let derived_writes = facts
        .updaters
        .iter()
        .filter(|updater| updater.kind == UpdaterKind::Derived)
        .map(|updater| {
            let write = updater.writes[0];
            facts
                .sources
                .iter()
                .find(|source| source.id == write)
                .expect("derived updater writes a known source")
                .name
                .as_str()
        })
        .collect::<Vec<_>>();

    assert_eq!(derived_writes, ["zed", "alpha"]);
}

#[test]
fn lowers_props_into_text_and_attribute_updaters() {
    let facts = analyze(
        "greeting.tsx",
        include_str!("fixtures/analysis/greeting.tsx"),
    );

    assert_eq!(facts.name, "Greeting");
    assert!(
        facts
            .sources
            .iter()
            .any(|source| { source.name == "name" && source.kind == SourceKind::Prop })
    );
    assert!(
        facts
            .updaters
            .iter()
            .any(|updater| updater.kind == UpdaterKind::Text)
    );
    assert!(facts.updaters.iter().any(|updater| {
        updater.kind
            == UpdaterKind::Attribute {
                name: "title".into(),
            }
    }));
}

#[test]
fn lowers_keyed_array_rendering_as_a_structural_updater() {
    let facts = analyze("todos.tsx", include_str!("fixtures/analysis/todos.tsx"));

    assert_eq!(facts.name, "Todos");
    assert!(
        facts
            .sources
            .iter()
            .any(|source| { source.name == "items" && source.kind == SourceKind::State })
    );
    assert!(facts.updaters.iter().any(|updater| {
        updater.kind
            == UpdaterKind::KeyedList {
                key: KeyPath::Property("id".into()),
            }
    }));
}

#[test]
fn does_not_classify_an_earlier_tuple_as_state() {
    let facts = analyze(
        "tuple-before-state.tsx",
        r#"
            import { useState } from "react";
            export function Counter() {
                const [left] = [1, 2];
                const [count] = useState(0);
                return <p>{count}</p>;
            }
        "#,
    );

    assert!(facts.sources.iter().any(|source| source.name == "count"));
    assert!(!facts.sources.iter().any(|source| source.name == "left"));
}

#[test]
fn resolves_aliased_react_state_imports_by_symbol_identity() {
    let facts = analyze(
        "aliased-state.tsx",
        r#"
            import { useState as state } from "react";
            export function Counter() {
                const [count] = state(0);
                const doubled = count * 2;
                return <p>{doubled}</p>;
            }
        "#,
    );

    assert!(
        facts
            .sources
            .iter()
            .any(|source| { source.name == "count" && source.kind == SourceKind::State })
    );
    assert!(
        facts
            .sources
            .iter()
            .any(|source| { source.name == "doubled" && source.kind == SourceKind::Derived })
    );
    assert!(facts.updaters.iter().any(|updater| {
        updater.kind == UpdaterKind::Text
            && updater.reads.iter().any(|read| {
                facts
                    .sources
                    .iter()
                    .any(|source| source.id == *read && source.name == "doubled")
            })
    }));
}

#[test]
fn resolves_namespace_react_state_calls_by_symbol_identity() {
    let facts = analyze(
        "namespace-state.tsx",
        r#"
            import * as React from "react";
            export function Counter() {
                const [count] = React.useState(0);
                return <p>{count}</p>;
            }
        "#,
    );

    assert!(
        facts
            .sources
            .iter()
            .any(|source| { source.name == "count" && source.kind == SourceKind::State })
    );
    assert!(
        facts
            .updaters
            .iter()
            .any(|updater| updater.kind == UpdaterKind::Text)
    );
}

#[test]
fn rejects_foreign_namespace_hooks() {
    let diagnostics = OxcReactAnalysisAdapter
        .analyze(ModuleInput {
            filename: "foreign-namespace-state.tsx",
            source: r#"
                import * as React from "not-react";
                export function Counter() {
                    const [count] = React.useState(0);
                    return <p>{count}</p>;
                }
            "#,
        })
        .expect_err("a foreign namespace must never become Vidact state");

    assert_eq!(diagnostics[0].code, DiagnosticCode::AnalysisFailed);
    assert!(
        diagnostics[0]
            .message
            .contains("callee resolves to React useState")
    );
}

#[test]
fn lowers_identity_keyed_array_rendering() {
    let facts = analyze(
        "identity-key.tsx",
        r#"
            import { useState } from "react";
            export function Items() {
                const [items] = useState(["one"]);
                return <ul>{items.map(item => <li key={item}>{item}</li>)}</ul>;
            }
        "#,
    );

    let items = facts
        .sources
        .iter()
        .find(|source| source.name == "items")
        .expect("items must be a state source");
    assert!(facts.updaters.iter().any(|updater| {
        updater.kind
            == UpdaterKind::KeyedList {
                key: KeyPath::Identity,
            }
            && updater.reads.contains(&items.id)
    }));
}

#[test]
fn rejects_keyed_maps_outside_the_normalized_key_subset() {
    for (filename, key) in [
        ("parent-key.tsx", "prefix + item.id"),
        ("computed-key.tsx", "item[idField]"),
        ("index-key.tsx", "index"),
    ] {
        let source = format!(
            r#"
                import {{ useState }} from "react";
                export function Items() {{
                    const [items] = useState([{{ id: 1 }}]);
                    const prefix = "todo";
                    const idField = "id";
                    return <ul>{{items.map((item, index) => <li key={{{key}}}>{{item.id}}</li>)}}</ul>;
                }}
            "#
        );
        let diagnostics = OxcReactAnalysisAdapter
            .analyze(ModuleInput {
                filename,
                source: &source,
            })
            .expect_err("unsupported key expressions must not fall through as text updaters");

        assert_eq!(diagnostics[0].code, DiagnosticCode::AnalysisFailed);
        assert!(diagnostics[0].message.contains("keyed maps require"));
    }
}

#[test]
fn rejects_foreign_hooks_instead_of_classifying_by_name() {
    let diagnostics = OxcReactAnalysisAdapter
        .analyze(ModuleInput {
            filename: "foreign-state.tsx",
            source: r#"
                import { useState } from "not-react";
                export function Counter() {
                    const [count] = useState(0);
                    return <p>{count}</p>;
                }
            "#,
        })
        .expect_err("a foreign function named useState must never become Vidact state");

    assert_eq!(diagnostics[0].code, DiagnosticCode::AnalysisFailed);
    assert!(
        diagnostics[0]
            .message
            .contains("callee resolves to React useState")
    );
}

#[test]
fn ignores_return_and_jsx_lookalikes_outside_the_render_ast() {
    let facts = analyze(
        "source-lookalikes.tsx",
        r#"
            import { useState } from "react";
            export function Counter() {
                const note = "return <p title={wrong}>{wrong.map(item => <i key={item.id} />)}</p>";
                const [count] = useState(0);
                const doubled = count * 2;
                return <p data-note={note}>{doubled}</p>;
            }
        "#,
    );

    assert!(!facts.sources.iter().any(|source| source.name == "note"));
    assert!(
        !facts
            .updaters
            .iter()
            .any(|updater| { matches!(updater.kind, UpdaterKind::KeyedList { .. }) })
    );
    assert!(facts.updaters.iter().any(|updater| {
        updater.kind == UpdaterKind::Text
            && updater.reads.iter().any(|read| {
                facts
                    .sources
                    .iter()
                    .any(|source| source.id == *read && source.name == "doubled")
            })
    }));
}

#[test]
fn reports_multiple_render_returns_at_the_exact_cfg_return_site() {
    let source = r#"
        import { useState } from "react";
        export function Early() {
            const [ready] = useState(false);
            if (!ready) return <button>Load</button>;
            return <p>Ready</p>;
        }
    "#;
    let diagnostics = OxcReactAnalysisAdapter
        .analyze(ModuleInput {
            filename: "early-return.tsx",
            source,
        })
        .expect_err("multi-return render flow must fail closed until it is lowered");

    assert_eq!(diagnostics[0].code, DiagnosticCode::UnsupportedControlFlow);
    let span = diagnostics[0]
        .span
        .expect("React Compiler return terminals retain original spans");
    assert!(
        source[span.start as usize..span.end as usize].contains("return <button>Load</button>")
    );
}

#[test]
fn nested_callback_returns_do_not_trigger_component_control_flow_rejection() {
    let facts = analyze(
        "callback-return.tsx",
        r#"
            export function Counter({ label }) {
                const handleClick = () => {
                    if (label) return;
                };
                return <button onClick={handleClick}>{label}</button>;
            }
        "#,
    );

    let explicit_returns = facts
        .control_flow
        .blocks
        .iter()
        .filter(|block| {
            block.terminal.kind
                == ControlFlowTerminalKind::Return(ControlFlowReturnVariant::Explicit)
        })
        .count();
    assert_eq!(explicit_returns, 1);
    assert!(!facts.control_flow.blocks.iter().any(|block| {
        matches!(
            block.terminal.kind,
            ControlFlowTerminalKind::If | ControlFlowTerminalKind::Branch
        )
    }));
}

#[test]
fn expression_control_flow_is_retained_without_becoming_an_early_return() {
    let facts = analyze(
        "expression-branch.tsx",
        r#"
            export function Greeting({ ready }) {
                const label = ready ? "Ready" : "Waiting";
                return <p>{label}</p>;
            }
        "#,
    );

    assert!(facts.control_flow.blocks.iter().any(|block| {
        matches!(
            block.terminal.kind,
            ControlFlowTerminalKind::Ternary | ControlFlowTerminalKind::Branch
        )
    }));
    let block_ids = facts
        .control_flow
        .blocks
        .iter()
        .map(|block| block.id)
        .collect::<std::collections::BTreeSet<_>>();
    assert!(facts.control_flow.blocks.iter().all(|block| {
        block
            .terminal
            .successors
            .iter()
            .all(|successor| block_ids.contains(successor))
    }));
    let ir = vidact_compiler::lower_component(facts.clone())
        .expect("typed control flow must cross the stable IR boundary");
    assert_eq!(ir.control_flow, facts.control_flow);
}

#[test]
fn classifies_multiple_components_by_function_span() {
    let source = r#"
                export function First({ first }) {
                    return <p>{first}</p>;
                }
                export function Second({ second }) {
                    return <p>{second}</p>;
                }
            "#;
    let facts = OxcReactAnalysisAdapter
        .analyze(ModuleInput {
            filename: "two-components.tsx",
            source,
        })
        .expect("each component must be joined to its own React Compiler snapshot");

    assert_eq!(facts.len(), 2);
    assert_eq!(facts[0].name, "First");
    assert_eq!(facts[1].name, "Second");
    assert!(facts[0].sources.iter().any(|source| source.name == "first"));
    assert!(
        !facts[0]
            .sources
            .iter()
            .any(|source| source.name == "second")
    );
    assert!(
        facts[1]
            .sources
            .iter()
            .any(|source| source.name == "second")
    );
    assert!(!facts[1].sources.iter().any(|source| source.name == "first"));
    for component in &facts {
        let span = component
            .span
            .expect("compiler analyses must carry source spans");
        let text = &source[span.start as usize..span.end as usize];
        assert!(
            text.contains(&format!("function {}", component.name)),
            "{text}"
        );
    }
}

#[test]
fn follows_aliases_through_react_compiler_def_use_edges() {
    let facts = analyze(
        "alias-counter.tsx",
        include_str!("fixtures/analysis/alias-counter.tsx"),
    );

    let source = |name: &str| {
        facts
            .sources
            .iter()
            .find(|source| source.name == name)
            .unwrap_or_else(|| panic!("missing source {name}"))
            .id
    };
    let derived = |write| {
        facts
            .updaters
            .iter()
            .find(|updater| updater.kind == UpdaterKind::Derived && updater.writes == vec![write])
            .unwrap_or_else(|| panic!("missing derived updater for source {}", write.get()))
    };

    assert_eq!(derived(source("direct")).reads, vec![source("count")]);
    assert_eq!(derived(source("alias")).reads, vec![source("direct")]);
    assert_eq!(derived(source("doubled")).reads, vec![source("alias")]);
    assert!(facts.updaters.iter().any(|updater| {
        updater.kind
            == UpdaterKind::Attribute {
                name: "data-count".into(),
            }
            && updater.reads == vec![source("alias")]
    }));
    assert!(facts.updaters.iter().any(|updater| {
        updater.kind == UpdaterKind::Text && updater.reads == vec![source("doubled")]
    }));
}

#[test]
fn distinguishes_shadowed_identifiers_by_compiler_declaration_identity() {
    let facts = analyze(
        "shadowed.tsx",
        r#"
            import { useState } from "react";
            export function Shadowed() {
                const constant = ((count) => count)(7);
                const [count] = useState(0);
                const doubled = count * 2;
                return <p>{doubled}</p>;
            }
        "#,
    );

    assert!(facts.sources.iter().any(|source| source.name == "count"));
    assert!(!facts.sources.iter().any(|source| source.name == "constant"));
    assert!(facts.sources.iter().any(|source| source.name == "doubled"));
    assert!(
        facts
            .updaters
            .iter()
            .any(|updater| updater.kind == UpdaterKind::Text)
    );
}

#[test]
fn excludes_block_event_expressions_from_text_dependencies() {
    let facts = analyze(
        "event-block.tsx",
        r#"
            import { useState } from "react";
            export function EventBlock() {
                const [count] = useState(1);
                const doubled = count * 2;
                return <button onClick={() => { count; }}>{doubled}</button>;
            }
        "#,
    );
    let doubled = facts
        .sources
        .iter()
        .find(|source| source.name == "doubled")
        .expect("doubled source")
        .id;
    let text = facts
        .updaters
        .iter()
        .find(|updater| updater.kind == UpdaterKind::Text)
        .expect("text updater");

    assert_eq!(text.reads, vec![doubled]);
}
