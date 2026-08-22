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
fn compiles_unkeyed_jsx_maps_into_explicit_indexed_owners() {
    let output = compile_surgical_module(ModuleInput {
        filename: "IndexedItems.tsx",
        source: r#"
            import { useState } from 'react';
            export function IndexedItems(): Node {
                const [items, setItems] = useState([{ label: 'one' }]);
                return <ul>{items.map((item, index) => (
                    <li data-index={index}>{item.label}</li>
                ))}</ul>;
            }
        "#,
    })
    .expect("unkeyed JSX maps should compile with explicit index identity");

    assert!(output.contains("indexed as __vidactIndexed"), "{output}");
    assert!(!output.contains("keyed as __vidactKeyed"), "{output}");
    assert!(
        output.contains("(item, index, __vidactItemScope)"),
        "{output}"
    );
    assert!(output.contains("item.get().label"), "{output}");
    assert!(output.contains("index.get()"), "{output}");
}

#[test]
fn compiles_for_of_jsx_accumulators_into_record_owners() {
    let keyed = compile_surgical_module(ModuleInput {
        filename: "KeyedLoop.tsx",
        source: r#"
            import { useState } from 'react';
            export function KeyedLoop(): Node {
                const [items, setItems] = useState([{ id: 'one', label: 'One' }]);
                const rows = [];
                for (const item of items) {
                    rows.push(<li key={item.id}>{item.label}</li>);
                }
                return <ul>{rows}</ul>;
            }
        "#,
    })
    .expect("a keyed for-of JSX accumulator should become a keyed record factory");

    assert!(keyed.contains("keyed as __vidactKeyed"), "{keyed}");
    assert!(keyed.contains("() => items.get()"), "{keyed}");
    assert!(
        keyed.contains("(item, __vidactItemIndex) => item.id"),
        "{keyed}"
    );
    assert!(!keyed.contains("rows.push"), "{keyed}");

    let indexed = compile_surgical_module(ModuleInput {
        filename: "IndexedLoop.tsx",
        source: r#"
            import { useState } from 'react';
            export function IndexedLoop(): Node {
                const [items, setItems] = useState([{ label: 'One' }]);
                const rows = [];
                for (const item of items) {
                    rows.push(<li>{item.label}</li>);
                }
                return <ul>{rows}</ul>;
            }
        "#,
    })
    .expect("an unkeyed for-of JSX accumulator should become an indexed record factory");

    assert!(indexed.contains("indexed as __vidactIndexed"), "{indexed}");
    assert!(!indexed.contains("rows.push"), "{indexed}");
}

#[test]
fn rejects_unstable_for_of_jsx_keys() {
    let diagnostics = compile_surgical_module(ModuleInput {
        filename: "InvalidLoopKey.tsx",
        source: r#"
            import { useState } from 'react';
            export function InvalidLoopKey(): Node {
                const [items, setItems] = useState([{ id: 'one' }]);
                const rows = [];
                for (const item of items) {
                    rows.push(<li key={Math.random()}>{item.id}</li>);
                }
                return <ul>{rows}</ul>;
            }
        "#,
    })
    .expect_err("an unstable explicit key must not silently select index mode");

    assert_eq!(diagnostics[0].code, DiagnosticCode::UnsupportedSyntax);
    assert!(diagnostics[0].message.contains("iterative JSX keys"));
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
fn compiles_early_returns_into_one_owned_choice() {
    let source = r#"
        import { useState } from 'react';
        export function Early(): Node {
            const [ready, setReady] = useState(false);
            if (!ready) return <button onClick={() => setReady(true)}>load</button>;
            return <p>ready</p>;
        }
    "#;
    let output = compile_surgical_module(ModuleInput {
        filename: "Early.tsx",
        source,
    })
    .expect("every render path now exits through one compiled component range");

    assert!(output.contains("return __vidactCompiledRoot"));
    assert!(output.contains("__vidactChoose(__vidactScope, __vidactSource(0)"));
    assert!(!output.contains("if (!ready"));
    assert_eq!(output.matches("return ").count(), 1);
}

#[test]
fn aligns_equal_host_and_component_alternatives_before_codegen() {
    let output = compile_surgical_module(ModuleInput {
        filename: "Aligned.tsx",
        source: r#"
            import { useState } from 'react';
            function Child({ label }) {
                const [count, setCount] = useState(0);
                return <button data-label={label}>{label}:{count}</button>;
            }
            export function Aligned() {
                const [first, setFirst] = useState(true);
                return first
                    ? <section data-mode="first"><Child label="first" /></section>
                    : <section data-mode="second"><Child label="second" /></section>;
            }
        "#,
    })
    .expect("equal type/key positions must compile as retained nodes");

    assert_eq!(output.matches("<section").count(), 1);
    assert_eq!(output.matches("<Child").count(), 1);
    assert!(output.contains("first.get() ? \"first\" : \"second\""));
    assert!(!output.contains("__vidactChoose(__vidactScope"));
    assert!(!output.contains("choose as __vidactChoose"));
}

#[test]
fn dispatches_dynamic_component_keys_without_remounting_stable_identity() {
    let output = compile_surgical_module(ModuleInput {
        filename: "DynamicKey.tsx",
        source: r#"
            import { useState } from 'react';
            function Child() { return <p>child</p>; }
            export function DynamicKey() {
                const [key, setKey] = useState('a');
                return <Child key={key} />;
            }
        "#,
    })
    .expect("a reactive key must be represented by an identity dispatcher");

    assert!(output.contains("dispatch as __vidactDispatch"), "{output}");
    assert!(
        output.contains("__vidactDispatch(__vidactScope, __vidactSource(0)"),
        "{output}"
    );
    assert!(output.contains("() => key.get()"), "{output}");
}

#[test]
fn rejects_slot_valued_component_types_until_call_site_lowering_exists() {
    let diagnostics = compile_surgical_module(ModuleInput {
        filename: "PropType.tsx",
        source: r#"
            export function PropType({ Type }) {
                return <Type />;
            }
        "#,
    })
    .expect_err("a slot-valued JSX callee cannot be emitted as a plain identifier");

    assert!(diagnostics.iter().any(|diagnostic| {
        diagnostic.code == DiagnosticCode::UnsupportedSyntax
            && diagnostic.message.contains("callable slot lowering")
    }));
}

#[test]
fn compiles_terminal_switches_into_owned_choices() {
    let output = compile_surgical_module(ModuleInput {
        filename: "Switch.tsx",
        source: r#"
            export function Switch({ mode }) {
                switch (mode) {
                    case 'a': return <p>A</p>;
                    case 'b': return <output>B</output>;
                    default: return null;
                }
            }
        "#,
    })
    .expect("terminal literal switches belong to structural render flow");

    assert!(output.contains("mode.get() === \"a\""));
    assert!(output.contains("mode.get() === \"b\""));
    assert_eq!(output.matches("return ").count(), 1);
    assert!(output.contains("choose as __vidactChoose"));
}

#[test]
fn compiles_phi_derived_values_into_ordered_static_updaters() {
    let output = compile_surgical_module(ModuleInput {
        filename: "BranchDerived.tsx",
        source: r#"
            import { useState } from 'react';
            export function BranchDerived({ first, second }) {
                const [alternate, setAlternate] = useState(false);
                let selected;
                if (alternate) {
                    selected = first;
                } else {
                    selected = second;
                }
                return <button title={selected} onClick={() => setAlternate(value => !value)}>{selected}</button>;
            }
        "#,
    })
    .expect("a React Compiler phi must lower to one derived updater");

    assert!(output.contains("let selected"), "{output}");
    assert!(
        output.contains("selected = alternate.get() ? first.get() : second.get()"),
        "{output}"
    );
    assert!(output.contains("writes:"), "{output}");
    assert!(
        output.contains(
            "reads: __vidactCombineSources(__vidactSource(0), __vidactSource(1), __vidactSource(2))"
        ),
        "{output}"
    );
    assert!(output.contains("() => selected"), "{output}");
    assert!(
        !output.contains("alternate.get() ? selected : selected"),
        "{output}"
    );
}

#[test]
fn compiles_nested_phi_regions_and_dispatches_the_derived_component_type() {
    let output = compile_surgical_module(ModuleInput {
        filename: "DerivedType.tsx",
        source: r#"
            import { useState } from 'react';
            function First() { return <p>first</p>; }
            function Second() { return <p>second</p>; }
            export function DerivedType() {
                const [alternate, setAlternate] = useState(false);
                let Type;
                if (alternate) {
                    Type = Second;
                } else {
                    Type = First;
                }
                return <Type />;
            }
        "#,
    })
    .expect("a phi-derived JSX callee must use the narrow identity dispatcher");

    assert!(output.contains("dispatch as __vidactDispatch"), "{output}");
    assert!(
        output.contains("Type = alternate.get() ? Second : First"),
        "{output}"
    );
    assert!(output.contains("() => Type"), "{output}");
}

#[test]
fn preserves_switch_fallthrough_and_loop_syntax_inside_derived_updaters() {
    let output = compile_surgical_module(ModuleInput {
        filename: "SynchronousRegions.tsx",
        source: r#"
            import { useState } from 'react';
            export function Fallthrough() {
                const [mode, setMode] = useState('a');
                let label = '';
                switch (mode) {
                    case 'a': label += 'a';
                    case 'b': label += 'b'; break;
                    default: label = 'other';
                }
                return <button onClick={() => setMode('b')}>{label}</button>;
            }
            export function Sum({ values }) {
                let total = 0;
                for (const value of values) {
                    if (value < 0) continue;
                    total += value;
                }
                return <output>{total}</output>;
            }
        "#,
    })
    .expect("structured synchronous regions must remain JavaScript in updater closures");

    assert!(output.contains("switch (mode.get())"), "{output}");
    assert!(output.contains("case \"a\":"), "{output}");
    assert!(output.contains("label += \"a\""), "{output}");
    assert!(
        output.contains("for (const value of values.get())"),
        "{output}"
    );
    assert!(output.contains("continue;"), "{output}");
    assert!(output.contains("total = 0"), "{output}");
}

#[test]
fn rejects_branch_varying_refs_at_the_component_site() {
    let diagnostics = compile_surgical_module(ModuleInput {
        filename: "Refs.tsx",
        source: r#"
            import { useRef, useState } from 'react';
            export function Refs() {
                const first = useRef(null);
                const second = useRef(null);
                const [ready, setReady] = useState(false);
                return ready ? <input ref={first} /> : <input ref={second} />;
            }
        "#,
    })
    .expect_err("reactive ref identity needs a dedicated lifecycle");

    assert!(diagnostics.iter().any(|diagnostic| {
        diagnostic.code == DiagnosticCode::UnsupportedSyntax
            && diagnostic.message.contains("branch-varying ref identity")
    }));
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
