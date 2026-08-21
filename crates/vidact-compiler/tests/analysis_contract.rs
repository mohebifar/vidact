use vidact_compiler::{
    DiagnosticCode,
    analysis::{
        ComponentFacts, KeyPath, SourceFact, SourceId, SourceKind, UpdaterFact, UpdaterId,
        UpdaterKind,
    },
    lower_component,
};

#[test]
fn lowers_static_dependency_edges_in_execution_order() {
    let count = SourceId::new(0);
    let doubled = SourceId::new(1);
    let facts = ComponentFacts::new(
        "Counter",
        vec![
            SourceFact::new(count, "count", SourceKind::State),
            SourceFact::new(doubled, "doubled", SourceKind::Derived),
        ],
        vec![
            UpdaterFact::new(
                UpdaterId::new(0),
                UpdaterKind::Derived,
                vec![count],
                vec![doubled],
            ),
            UpdaterFact::new(UpdaterId::new(1), UpdaterKind::Text, vec![doubled], vec![]),
        ],
    );

    let ir = lower_component(facts).expect("valid analysis should lower");

    assert_eq!(ir.name, "Counter");
    assert_eq!(ir.updaters[0].reads, vec![count]);
    assert_eq!(ir.updaters[0].writes, vec![doubled]);
    assert_eq!(ir.updaters[1].reads, vec![doubled]);
}

#[test]
fn represents_keyed_array_updates_as_structural_updaters() {
    let items = SourceId::new(0);
    let facts = ComponentFacts::new(
        "Todos",
        vec![SourceFact::new(items, "items", SourceKind::State)],
        vec![UpdaterFact::new(
            UpdaterId::new(0),
            UpdaterKind::KeyedList {
                key: KeyPath::Property("id".into()),
            },
            vec![items],
            vec![],
        )],
    );

    let ir = lower_component(facts).expect("keyed arrays are supported");

    assert_eq!(
        ir.updaters[0].kind,
        UpdaterKind::KeyedList {
            key: KeyPath::Property("id".into())
        }
    );
}

#[test]
fn rejects_analysis_that_references_an_unknown_source() {
    let facts = ComponentFacts::new(
        "Broken",
        vec![],
        vec![UpdaterFact::new(
            UpdaterId::new(0),
            UpdaterKind::Text,
            vec![SourceId::new(99)],
            vec![],
        )],
    );

    let diagnostic = lower_component(facts).expect_err("invalid facts must not reach codegen");

    assert_eq!(diagnostic.code, DiagnosticCode::UnknownSource);
    assert!(diagnostic.message.contains("99"));
}

#[test]
fn topologically_orders_updaters_from_their_read_write_edges() {
    let count = SourceId::new(0);
    let doubled = SourceId::new(1);
    let text = UpdaterId::new(0);
    let derive = UpdaterId::new(1);
    let facts = ComponentFacts::new(
        "Counter",
        vec![
            SourceFact::new(count, "count", SourceKind::State),
            SourceFact::new(doubled, "doubled", SourceKind::Derived),
        ],
        vec![
            UpdaterFact::new(text, UpdaterKind::Text, vec![doubled], vec![]),
            UpdaterFact::new(derive, UpdaterKind::Derived, vec![count], vec![doubled]),
        ],
    );

    let ir = lower_component(facts).expect("valid facts should be ordered for execution");

    assert_eq!(
        ir.updaters
            .iter()
            .map(|updater| updater.id)
            .collect::<Vec<_>>(),
        vec![derive, text]
    );
}

#[test]
fn rejects_cycles_in_the_updater_graph() {
    let left = SourceId::new(0);
    let right = SourceId::new(1);
    let facts = ComponentFacts::new(
        "Cycle",
        vec![
            SourceFact::new(left, "left", SourceKind::Derived),
            SourceFact::new(right, "right", SourceKind::Derived),
        ],
        vec![
            UpdaterFact::new(
                UpdaterId::new(0),
                UpdaterKind::Derived,
                vec![right],
                vec![left],
            ),
            UpdaterFact::new(
                UpdaterId::new(1),
                UpdaterKind::Derived,
                vec![left],
                vec![right],
            ),
        ],
    );

    let diagnostic = lower_component(facts).expect_err("cycles must fail before codegen");

    assert_eq!(diagnostic.code, DiagnosticCode::CyclicUpdaterGraph);
}

#[test]
fn rejects_multiple_updaters_that_write_the_same_source() {
    let value = SourceId::new(0);
    let facts = ComponentFacts::new(
        "Ambiguous",
        vec![SourceFact::new(value, "value", SourceKind::Derived)],
        vec![
            UpdaterFact::new(UpdaterId::new(0), UpdaterKind::Derived, vec![], vec![value]),
            UpdaterFact::new(UpdaterId::new(1), UpdaterKind::Derived, vec![], vec![value]),
        ],
    );

    let diagnostic = lower_component(facts).expect_err("a derived source must have one writer");

    assert_eq!(diagnostic.code, DiagnosticCode::MultipleSourceWriters);
}
