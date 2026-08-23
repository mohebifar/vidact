use vidact_compiler::{
    CompilationOptions, CompilerFeature, Diagnostic, DiagnosticCode, analysis::ModuleInput,
    compile_surgical_module, compile_surgical_module_with_options,
};

fn compile_unsafe_html(input: ModuleInput<'_>) -> Result<String, Vec<Diagnostic>> {
    compile_surgical_module_with_options(
        input,
        &CompilationOptions::default().with_feature(CompilerFeature::UnsafeHtml),
    )
}

#[test]
fn turns_todomvc_into_one_time_construction_and_static_bindings() {
    let output = compile_surgical_module(ModuleInput {
        filename: "TodoApp.tsx",
        source: include_str!("../../../examples/todomvc/src/TodoApp.tsx"),
    })
    .expect("TodoMVC belongs to the surgical vertical slice");

    assert!(output.contains("__vidactCreateNarrowScope()"));
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
    assert!(!output.contains("useState as state"), "{output}");
    assert!(output.contains("count.set(count.get() + 1)"), "{output}");
}

#[test]
fn removes_lowered_state_imports_without_removing_live_react_imports() {
    let output = compile_surgical_module(ModuleInput {
        filename: "StateAndRef.tsx",
        source: r#"
            import { useRef, useState } from 'react';
            export function StateAndRef(): Node {
                const input = useRef(null);
                const [count, setCount] = useState(0);
                return <button ref={input} onClick={() => setCount(count + 1)}>{count}</button>;
            }
        "#,
    })
    .expect("lowered hooks must not leave a dependency on the replay runtime");

    assert!(
        output.contains("import { useRef } from \"react\";"),
        "{output}"
    );
    assert!(!output.contains("useState"), "{output}");
}

#[test]
fn preserves_type_only_state_imports() {
    let output = compile_surgical_module(ModuleInput {
        filename: "StateType.tsx",
        source: r#"
            import type { useState as ReactUseState } from 'react';
            type StateHook = typeof ReactUseState;
            export function StateType(): Node {
                return <p>static</p>;
            }
        "#,
    })
    .expect("type-only React imports do not require a runtime state fallback");

    assert!(
        output.contains("import type { useState as ReactUseState } from \"react\";"),
        "{output}"
    );
}

#[test]
fn preserves_mixed_type_state_and_live_ref_imports() {
    let output = compile_surgical_module(ModuleInput {
        filename: "MixedStateImports.tsx",
        source: r#"
            import { type useState as ReactUseState, useRef, useState } from 'react';
            type StateHook = typeof ReactUseState;
            export function MixedStateImports(): Node {
                const input = useRef(null);
                const [count, setCount] = useState(0);
                return <button ref={input} onClick={() => setCount(count + 1)}>{count}</button>;
            }
        "#,
    })
    .expect("type imports and live runtime imports must survive state lowering");

    assert!(
        output.contains("type useState as ReactUseState"),
        "{output}"
    );
    assert!(output.contains("useRef"), "{output}");
    assert!(!output.contains("useRef, useState }"), "{output}");
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
    assert!(!output.contains("from \"react\""), "{output}");
    assert!(output.contains("count.set(count.get() + 1)"), "{output}");
}

#[test]
fn rejects_state_calls_left_outside_compiled_components() {
    let diagnostics = compile_surgical_module(ModuleInput {
        filename: "ResidualState.tsx",
        source: r#"
            import { useState } from 'react';
            function unsupportedStateFactory() {
                return useState(0);
            }
            export function StaticComponent(): Node {
                return <p>static</p>;
            }
        "#,
    })
    .expect_err("the client runtime must not retain a replay-state fallback");

    assert!(diagnostics.iter().any(|diagnostic| {
        diagnostic.code == DiagnosticCode::UnsupportedSyntax
            && diagnostic.span.is_some()
            && diagnostic
                .message
                .contains("only supported in compiled component state declarations")
    }));
}

#[test]
fn rejects_live_state_import_references_left_after_lowering() {
    let diagnostics = compile_surgical_module(ModuleInput {
        filename: "StateReference.tsx",
        source: r#"
            import { useState } from 'react';
            const stateFactory = useState;
            export function StaticComponent(): Node {
                return <p>{typeof stateFactory}</p>;
            }
        "#,
    })
    .expect_err("runtime state references cannot survive without the replay runtime");

    assert!(diagnostics.iter().any(|diagnostic| {
        diagnostic.code == DiagnosticCode::UnsupportedSyntax
            && diagnostic.span.is_some()
            && diagnostic
                .message
                .contains("remains after component lowering")
    }));
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
        output.matches("__vidactCreateNarrowScope()").count(),
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
fn compiles_static_and_reactive_raw_html_bindings() {
    let output = compile_unsafe_html(ModuleInput {
        filename: "RawHtml.tsx",
        source: r#"
            import { useState } from 'react';
            export function RawHtml(): Node {
                const [html, setHtml] = useState('<strong>one</strong>');
                return <main>
                    <button onClick={() => setHtml('<em>two</em>')}>change</button>
                    <section dangerouslySetInnerHTML={{ __html: html }} />
                    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: '{"ok":true}' }} />
                </main>;
            }
        "#,
    })
    .expect("raw HTML belongs to the React-shaped direct DOM subset");

    assert!(output.contains("dangerouslySetInnerHTML"), "{output}");
    assert!(output.contains("__vidactBinding"), "{output}");
}

#[test]
fn rejects_statically_provable_invalid_raw_html_contracts() {
    for (source, expected) in [
        (
            "export function Invalid(): Node { return <div dangerouslySetInnerHTML={{ __html: '<b>raw</b>' }}>child</div>; }",
            "only set one of",
        ),
        (
            "export function Invalid(): Node { return <img dangerouslySetInnerHTML={{ __html: 'raw' }} />; }",
            "void element",
        ),
        (
            "export function Invalid(): Node { return <textarea dangerouslySetInnerHTML={{ __html: 'raw' }} />; }",
            "does not make sense on <textarea>",
        ),
        (
            "export function Invalid(): Node { return <img dangerouslySetInnerHTML={{ __html: null }} />; }",
            "void element",
        ),
        (
            "export function Invalid(): Node { return <textarea dangerouslySetInnerHTML={{ __html: null }} />; }",
            "does not make sense on <textarea>",
        ),
        (
            "export function Invalid(): Node { return <div dangerouslySetInnerHTML={{ html: 'raw' }} />; }",
            "must be in the form",
        ),
        (
            "export function Invalid(): Node { return <script dangerouslySetInnerHTML={{ __html: 'alert(1)' }} />; }",
            "executable <script>",
        ),
    ] {
        let diagnostics = compile_unsafe_html(ModuleInput {
            filename: "InvalidRawHtml.tsx",
            source,
        })
        .expect_err("provably invalid raw HTML must fail compilation");

        assert!(
            diagnostics.iter().any(|diagnostic| {
                diagnostic.code == DiagnosticCode::UnsupportedSyntax
                    && diagnostic.span.is_some()
                    && diagnostic.message.contains(expected)
            }),
            "expected {expected:?}, got {diagnostics:#?}"
        );
    }
}

#[test]
fn defers_nullable_raw_html_contracts_to_runtime_without_false_positives() {
    let output = compile_unsafe_html(ModuleInput {
        filename: "NullableRawHtml.tsx",
        source: r#"
            export function NullableRawHtml({ raw }): Node {
                return <div dangerouslySetInnerHTML={raw}>fallback</div>;
            }
        "#,
    })
    .expect("analysis cannot prove that an unknown raw HTML value is non-null");

    assert!(output.contains("dangerouslySetInnerHTML"), "{output}");

    compile_unsafe_html(ModuleInput {
        filename: "StaticNullRawHtml.tsx",
        source: r#"
            export function StaticNullRawHtml(): Node {
                return <div dangerouslySetInnerHTML={{ __html: null }}>fallback</div>;
            }
        "#,
    })
    .expect("React permits children when the statically known __html payload is nullish");

    compile_unsafe_html(ModuleInput {
        filename: "TypedRawHtml.tsx",
        source: r#"
            export function TypedRawHtml({ raw }): Node {
                return <div dangerouslySetInnerHTML={raw as { __html: string }} />;
            }
            export function TypedPayload({ html }): Node {
                return <div dangerouslySetInnerHTML={{ __html: html as string }} />;
            }
        "#,
    })
    .expect("TypeScript-only wrappers must not create raw HTML false positives");

    compile_unsafe_html(ModuleInput {
        filename: "ConservativeRawHtml.tsx",
        source: r#"
            function Wrapper({ dangerouslySetInnerHTML }): Node {
                return <div>{dangerouslySetInnerHTML}</div>;
            }
            export function CustomProp(): Node {
                return <Wrapper dangerouslySetInnerHTML="component metadata" />;
            }
            export function LaterSpread(): Node {
                const overrides = { dangerouslySetInnerHTML: null };
                return <div dangerouslySetInnerHTML={{ __html: '<b>raw</b>' }} {...overrides}>fallback</div>;
            }
            export function ComputedOverride({ key }): Node {
                return <div dangerouslySetInnerHTML={{ __html: '<b>raw</b>', [key]: null }}>fallback</div>;
            }
        "#,
    })
    .expect("component props and ordered overrides are not statically provable host errors");
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
    assert!(output.contains("__vidactItemScope, 1"), "{output}");
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

        assert_eq!(diagnostics[0].code, DiagnosticCode::UnsupportedSyntax);
        assert!(diagnostics[0].span.is_some());
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
fn compiles_named_block_bodied_arrow_components() {
    let output = compile_surgical_module(ModuleInput {
        filename: "ArrowCounter.tsx",
        source: r#"
            import { useState } from 'react';
            export const ArrowCounter = () => {
                const [count, setCount] = useState(0);
                return <button onClick={() => setCount(count + 1)}>{count}</button>;
            };
        "#,
    })
    .expect("named block-bodied arrow components should preserve their binding identity");

    assert!(output.contains("const ArrowCounter = () =>"), "{output}");
    assert!(
        output.contains("createCompiledState as __vidactCreateState"),
        "{output}"
    );
    assert!(output.contains("return __vidactCompiledRoot"), "{output}");
}

#[test]
fn compiles_function_expressions_and_default_exports_by_span() {
    for (filename, source, expected_form) in [
        (
            "FunctionExpression.tsx",
            r#"
                const FunctionExpression = function ({ label }) {
                    return <p>{label}</p>;
                };
                export { FunctionExpression };
            "#,
            "const FunctionExpression = function({ label })",
        ),
        (
            "DefaultFunction.tsx",
            r#"
                export default function DefaultFunction({ label }) {
                    return <p>{label}</p>;
                }
            "#,
            "export default function DefaultFunction({ label })",
        ),
        (
            "DefaultArrow.tsx",
            r#"
                const DefaultArrow = ({ label }) => {
                    return <p>{label}</p>;
                };
                export default DefaultArrow;
            "#,
            "const DefaultArrow = ({ label }) =>",
        ),
    ] {
        let output = compile_surgical_module(ModuleInput { filename, source })
            .unwrap_or_else(|diagnostics| panic!("{filename} must compile: {diagnostics:#?}"));

        assert!(output.contains(expected_form), "{output}");
        assert!(output.contains("__vidactCreateProp"), "{output}");
        assert!(output.contains("return __vidactCompiledRoot"), "{output}");
    }
}

#[test]
fn compiles_use_reducer_into_the_state_slot_abi() {
    let output = compile_surgical_module(ModuleInput {
        filename: "ReducerCounter.tsx",
        source: r#"
            import { useReducer as useCounterReducer } from 'react';
            export function ReducerCounter(): Node {
                const [count, dispatch] = useCounterReducer(
                    (value, action) => value + action,
                    '1',
                    Number,
                );
                return <button onClick={() => dispatch(2)}>{count}</button>;
            }
        "#,
    })
    .expect("useReducer should lower through semantic import identity");

    assert!(
        output.contains("createCompiledReducer as __vidactCreateReducer"),
        "{output}"
    );
    assert!(
        output.contains("const count = __vidactCreateReducer("),
        "{output}"
    );
    assert!(output.contains("count.set(2)"), "{output}");
    assert!(!output.contains("useCounterReducer"), "{output}");
}

#[test]
fn compiles_aliased_props_into_local_updater_slots() {
    let output = compile_surgical_module(ModuleInput {
        filename: "AliasedProp.tsx",
        source: r#"
            export function AliasedProp({ name: label }): Node {
                return <p>{label}</p>;
            }
        "#,
    })
    .expect("the local alias has a semantic symbol and can own the compiled prop slot");

    assert!(
        output.contains("label = __vidactCreateProp(__vidactScope, 1, label)"),
        "{output}"
    );
    assert!(output.contains("() => label.get()"), "{output}");
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
    assert!(output.contains("__vidactChoose(__vidactScope, 1"));
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
        output.contains("__vidactDispatch(__vidactScope, 1"),
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
    assert!(!output.contains("writes:"), "{output}");
    assert!(output.contains("__vidactScope[0](7,"), "{output}");
    assert!(output.contains("() => selected"), "{output}");
    assert!(
        !output.contains("alternate.get() ? selected : selected"),
        "{output}"
    );
}

#[test]
fn retains_wide_source_masks_for_components_with_more_than_32_sources() {
    let declarations = (0..33)
        .map(|index| format!("const [value{index}, setValue{index}] = useState({index});"))
        .collect::<Vec<_>>()
        .join("\n");
    let source = format!(
        "import {{ useState }} from 'react'; export function Wide() {{ {declarations} return <p>{{value0 + value32}}</p>; }}"
    );
    let output = compile_surgical_module(ModuleInput {
        filename: "Wide.tsx",
        source: &source,
    })
    .expect("wide components must retain the multi-word source-mask fallback");

    assert!(output.contains("source as __vidactSource"), "{output}");
    assert!(output.contains("__vidactCreateScope()"), "{output}");
    assert!(output.contains("__vidactSource(32)"), "{output}");
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
fn preserves_try_catch_inside_derived_updaters() {
    let output = compile_surgical_module(ModuleInput {
        filename: "TryFlow.tsx",
        source: r#"
            import { useState } from 'react';
            function readMode(mode) {
                if (mode === 'caught') throw new Error('caught');
                return mode;
            }
            export function TryFlow(): Node {
                const [mode, setMode] = useState('normal');
                let label = '';
                try {
                    label = readMode(mode);
                } catch (error) {
                    label = error instanceof Error ? error.message : 'unknown';
                }
                return <p>{label}</p>;
            }
        "#,
    })
    .expect("try/catch should remain native JavaScript in a derived updater");

    assert!(output.contains("try {"), "{output}");
    assert!(output.contains("catch (error)"), "{output}");
}

#[test]
fn compiles_branch_varying_refs_as_reactive_ref_bindings() {
    let output = compile_surgical_module(ModuleInput {
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
    .expect("branch-varying refs should retain the host and transition ref ownership");

    assert_eq!(output.matches("<input").count(), 1, "{output}");
    assert!(output.contains("ref={__vidactBinding("), "{output}");
    assert!(output.contains("ready.get() ? first : second"), "{output}");
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

#[test]
fn rejects_intrinsic_component_children_until_construction_can_be_deferred() {
    let diagnostics = compile_surgical_module(ModuleInput {
        filename: "NamespaceChildren.tsx",
        source: r#"
            function ForeignObject({ children }) {
                return <foreignObject>{children}</foreignObject>;
            }
            export function NamespaceChildren() {
                return <svg><ForeignObject><div /></ForeignObject></svg>;
            }
        "#,
    })
    .expect_err("eager component children can be constructed in the wrong DOM namespace");

    assert!(diagnostics.iter().any(|diagnostic| {
        diagnostic.code == DiagnosticCode::UnsupportedSyntax
            && diagnostic
                .message
                .contains("deferred namespace-aware construction")
    }));
}
