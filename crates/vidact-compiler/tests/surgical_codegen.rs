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
fn compiles_aliased_react_state_imports() {
    let output = compile_surgical_module(ModuleInput {
        filename: "AliasedState.tsx",
        source: r#"
            import { useState as state } from 'react';
            export function AliasedState(): Node {
                const [count, setCount] = state(0);
                return <button onClick={() => setCount(count + 1)}>{count}</button>;
            }
        "#,
    })
    .expect("React hook aliases must be resolved from their imported symbol");

    assert!(output.contains("__vidactCreateState("), "{output}");
    assert!(!output.contains("state(0)"), "{output}");
    assert!(output.contains("count.set(count.get() + 1)"), "{output}");
}

#[test]
fn compiles_namespace_react_state_imports() {
    let output = compile_surgical_module(ModuleInput {
        filename: "NamespaceState.tsx",
        source: r#"
            import * as React from 'react';
            export function NamespaceState(): Node {
                const [count, setCount] = React.useState(0);
                return <button onClick={() => setCount(count + 1)}>{count}</button>;
            }
        "#,
    })
    .expect("React namespace hooks must be resolved from their import symbol");

    assert!(output.contains("__vidactCreateState("), "{output}");
    assert!(!output.contains("React.useState(0)"), "{output}");
    assert!(output.contains("count.set(count.get() + 1)"), "{output}");
}

#[test]
fn compiles_multiple_components_in_one_module_by_span() {
    let output = compile_surgical_module(ModuleInput {
        filename: "ParentAndChild.tsx",
        source: r#"
            import { useState } from 'react';
            export function Child({ value }): Node {
                return <output data-child="yes">{value}</output>;
            }
            export function Parent(): Node {
                const [count, setCount] = useState(0);
                return <button onClick={() => setCount(count + 1)}><Child value={count} /></button>;
            }
        "#,
    })
    .expect("same-module components must compile against their own analysis snapshots");

    assert_eq!(
        output.matches("__vidactCompiledRoot(").count(),
        2,
        "{output}"
    );
    assert_eq!(
        output.matches("__vidactCreateScope()").count(),
        2,
        "{output}"
    );
    assert!(output.contains("function Child"), "{output}");
    assert!(output.contains("function Parent"), "{output}");
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

#[test]
fn rejects_keyed_maps_the_analysis_ir_cannot_represent() {
    for key in ["prefix + item.id", "item[idField]", "index"] {
        let source = format!(
            r#"
                import {{ useState }} from 'react';
                export function Items(): Node {{
                    const [items] = useState([{{ id: 1 }}]);
                    const prefix = 'todo';
                    const idField = 'id';
                    return <ul>{{items.map((item, index) => <li key={{{key}}}>{{item.id}}</li>)}}</ul>;
                }}
            "#
        );
        let diagnostics = compile_surgical_module(ModuleInput {
            filename: "UnsupportedKey.tsx",
            source: &source,
        })
        .expect_err("surgical codegen must be gated by the normalized key subset");

        assert_eq!(diagnostics[0].code, DiagnosticCode::AnalysisFailed);
        assert!(diagnostics[0].message.contains("keyed maps require"));
    }
}

#[test]
fn compiles_static_component_props_into_local_updater_slots() {
    let output = compile_surgical_module(ModuleInput {
        filename: "Greeting.tsx",
        source: r#"
            export function Greeting({ name = 'world' }): Node {
                return <p title={name}>Hello {name}</p>;
            }
        "#,
    })
    .expect("prop-only components need the compiled component ABI");

    assert!(
        output.contains("createCompiledProp as __vidactCreateProp"),
        "{output}"
    );
    assert!(output.contains("name = __vidactCreateProp("), "{output}");
    assert!(output.contains("() => \"world\""), "{output}");
    assert!(output.contains("() => name.get()"), "{output}");
    assert!(output.contains("__vidactCompiledRoot("), "{output}");
    assert!(output.contains("__vidactBinding("), "{output}");
}

#[test]
fn rejects_aliased_props_instead_of_emitting_mount_snapshots() {
    let diagnostics = compile_surgical_module(ModuleInput {
        filename: "AliasedProp.tsx",
        source: r#"
            export function AliasedProp({ name: label }): Node {
                return <p>{label}</p>;
            }
        "#,
    })
    .expect_err("unsupported prop aliases must not disappear from the source graph");

    assert!(
        diagnostics
            .iter()
            .any(|diagnostic| { diagnostic.message.contains("aliased prop destructuring") })
    );
}

#[test]
fn rejects_defaulted_prop_derivations_missing_from_data_flow_analysis() {
    let diagnostics = compile_surgical_module(ModuleInput {
        filename: "Greeting.tsx",
        source: r#"
            export function Greeting({ name = 'world' }): Node {
                const upper = name.toUpperCase();
                return <p>{upper}</p>;
            }
        "#,
    })
    .expect_err("untracked derived props would otherwise become mount-time snapshots");

    assert!(diagnostics.iter().any(|diagnostic| {
        diagnostic.code == DiagnosticCode::UnsupportedSyntax
            && diagnostic
                .message
                .contains("absent from compiler data-flow")
    }));
}

#[test]
fn rejects_component_returns_that_bypass_the_compiled_root() {
    let source = r#"
        import { useState } from 'react';
        export function Early(): Node {
            const [ready, setReady] = useState(false);
            if (!ready) return <button onClick={() => setReady(true)}>load</button>;
            return <p>ready</p>;
        }
    "#;
    let diagnostics = compile_surgical_module(ModuleInput {
        filename: "Early.tsx",
        source,
    })
    .expect_err("every accepted return path must pass through compiledRoot");

    let diagnostic = diagnostics
        .iter()
        .find(|diagnostic| diagnostic.code == DiagnosticCode::UnsupportedControlFlow)
        .expect("React Compiler CFG must identify the unsupported render return");
    let span = diagnostic
        .span
        .expect("unsupported render control flow must retain its source span");
    assert!(
        source[span.start as usize..span.end as usize]
            .contains("return <button onClick={() => setReady(true)}>load</button>")
    );
}

#[test]
fn rejects_reactive_jsx_spreads_instead_of_capturing_a_mount_snapshot() {
    let diagnostics = compile_surgical_module(ModuleInput {
        filename: "Spread.tsx",
        source: r#"
            import { useState } from 'react';
            export function Spread(): Node {
                const [attributes, setAttributes] = useState({ title: 'first' });
                return <div {...attributes}>value</div>;
            }
        "#,
    })
    .expect_err("reactive spreads need deletion-aware updater semantics");

    assert!(diagnostics.iter().any(|diagnostic| {
        diagnostic.code == DiagnosticCode::UnsupportedSyntax
            && diagnostic.message.contains("reactive JSX spreads")
    }));
}
