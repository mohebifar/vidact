use vidact_compiler::{DiagnosticCode, analysis::ModuleInput, compile_surgical_module};

#[test]
fn turns_todomvc_into_one_time_construction_and_static_bindings() {
    let output = compile_surgical_module(ModuleInput {
        filename: "TodoApp.tsx",
        source: include_str!("../../../examples/todomvc/src/TodoApp.tsx"),
    })
    .expect("TodoMVC belongs to the surgical vertical slice");

    assert!(output.contains("__vidactCreateScope()"));
    assert!(output.contains("__vidactCreateState("));
    assert!(output.contains("__vidactCompiledRoot("));
    assert!(output.contains("__vidactEvent("));
    assert!(output.contains("__vidactBinding("));
    assert!(output.contains("__vidactWhen("));
    assert!(output.contains("__vidactKeyed("));
    assert!(!output.contains("__vidactCompiledRoot(__vidactScope, async"));
    assert!(!output.contains("useState<Todo[]>") && !output.contains("useState<Filter>"));
}

#[test]
fn rejects_user_bindings_that_collide_with_generated_names() {
    let diagnostics = compile_surgical_module(ModuleInput {
        filename: "Collision.tsx",
        source: r#"
            import { useState } from 'react';
            export function Collision(): Node {
                const __vidactScope = 'mine';
                const [value, setValue] = useState(0);
                return <p>{value}{__vidactScope}</p>;
            }
        "#,
    })
    .expect_err("generated names must never shadow user code");

    assert!(diagnostics.iter().any(|diagnostic| {
        diagnostic.code == DiagnosticCode::UnsupportedSyntax
            && diagnostic
                .message
                .contains("conflicts with Vidact generated code")
    }));
}

#[test]
fn rejects_reactive_structures_that_do_not_have_surgical_range_semantics() {
    let diagnostics = compile_surgical_module(ModuleInput {
        filename: "Conditional.tsx",
        source: r#"
            import { useState } from 'react';
            export function Conditional(): Node {
                const [visible, setVisible] = useState(true);
                return <main>{visible ? <p>yes</p> : <p>no</p>}</main>;
            }
        "#,
    })
    .expect_err("unsupported structural JSX must not become a text binding");

    assert!(diagnostics.iter().any(|diagnostic| {
        diagnostic.code == DiagnosticCode::UnsupportedSyntax
            && diagnostic
                .message
                .contains("keyed map or an && conditional")
    }));
}

#[test]
fn compiles_keyed_item_and_parent_reads_into_separate_static_domains() {
    let output = compile_surgical_module(ModuleInput {
        filename: "Items.tsx",
        source: r#"
            import { useState } from 'react';
            export function Items(): Node {
                const [items, setItems] = useState([{ id: 1, label: 'one' }]);
                const [selected, setSelected] = useState(1);
                return <ul>{items.map((item, index) => (
                    <li
                        key={item.id}
                        className={selected === item.id ? 'selected' : ''}
                        onClick={() => setSelected(item.id)}
                    >{index}: {item.label}</li>
                ))}</ul>;
            }
        "#,
    })
    .expect("keyed item bindings belong to the supported surgical slice");

    assert!(output.contains("keyed as __vidactKeyed"), "{output}");
    assert!(
        output.contains("(item, index, __vidactItemScope)"),
        "{output}"
    );
    assert!(output.contains("(item, index) => item.id"), "{output}");
    assert!(output.contains("item.get().id"), "{output}");
    assert!(output.contains("index.get()"), "{output}");
    assert!(
        output.contains("__vidactItemScope, __vidactSource(0)"),
        "{output}"
    );
}
