use vidact_compiler::{
    DiagnosticCode, OxcReactAnalysisAdapter,
    analysis::{KeyPath, ModuleInput, ReactAnalysisAdapter, SourceKind, UpdaterKind},
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
fn rejects_multiple_components_until_classification_is_span_scoped() {
    let diagnostics = OxcReactAnalysisAdapter
        .analyze(ModuleInput {
            filename: "two-components.tsx",
            source: r#"
                export function First({ first }) {
                    return <p>{first}</p>;
                }
                export function Second({ second }) {
                    return <p>{second}</p>;
                }
            "#,
        })
        .expect_err("the lexical spike must fail closed instead of mixing component facts");

    assert_eq!(diagnostics[0].code, DiagnosticCode::AnalysisFailed);
    assert!(diagnostics[0].message.contains("exactly one component"));
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
