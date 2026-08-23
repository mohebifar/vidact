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
fn compiles_destructured_unkeyed_map_parameters_into_path_reads() {
    let output = compile_surgical_module(ModuleInput {
        filename: "DestructuredItems.tsx",
        source: r#"
            import { useState } from 'react';
            export function DestructuredItems(): Node {
                const [items, setItems] = useState([
                    { label: 'one', meta: { rank: 1 } }
                ]);
                return <ul>{items.map(({ label, meta: { rank } }) => (
                    <li>{label}:{rank}</li>
                ))}</ul>;
            }
        "#,
    })
    .expect("destructured indexed rows should retain live path reads");

    assert!(output.contains("indexed as __vidactIndexed"), "{output}");
    assert!(
        output.contains("(__vidactItem, __vidactItemIndex, __vidactItemScope)"),
        "{output}"
    );
    assert!(output.contains("__vidactItem.get()[\"label\"]"), "{output}");
    assert!(
        output.contains("__vidactItem.get()[\"meta\"][\"rank\"]"),
        "{output}"
    );
}

#[test]
fn compiles_top_level_destructured_keys_against_raw_rows() {
    let output = compile_surgical_module(ModuleInput {
        filename: "DestructuredKey.tsx",
        source: r#"
            import { useState } from 'react';
            export function DestructuredKey(): Node {
                const [items, setItems] = useState([{ id: 1, label: 'one' }]);
                return <ul>{items.map(({ id, label }) => (
                    <li key={id}>{label}</li>
                ))}</ul>;
            }
        "#,
    })
    .expect("a destructured top-level key should remain a raw-row selector");

    assert!(output.contains("keyed as __vidactKeyed"), "{output}");
    assert!(
        output.contains("(__vidactItem) => __vidactItem[\"id\"]"),
        "{output}"
    );
    assert!(output.contains("__vidactItem.get()[\"label\"]"), "{output}");
}

#[test]
fn compiles_nested_keyed_maps_that_read_an_outer_item_collection() {
    let output = compile_surgical_module(ModuleInput {
        filename: "NestedItems.tsx",
        source: r#"
            import { useState } from 'react';
            export function NestedItems(): Node {
                const [groups, setGroups] = useState([
                    { id: 'a', items: [{ id: 1, label: 'one' }] }
                ]);
                return <main>{groups.map((group) => (
                    <section key={group.id}>
                        {group.items.map((item) => (
                            <span key={item.id}>{item.label}</span>
                        ))}
                    </section>
                ))}</main>;
            }
        "#,
    })
    .expect("nested list collections should subscribe to their outer item slot");

    assert_eq!(output.matches("__vidactKeyed(").count(), 2, "{output}");
    assert!(output.contains("() => group.get().items"), "{output}");
    assert!(output.contains("__vidactItemScope, 1"), "{output}");
}

#[test]
fn rejects_nested_list_render_captures_until_item_scopes_are_depth_aware() {
    let diagnostics = compile_surgical_module(ModuleInput {
        filename: "NestedCapture.tsx",
        source: r#"
            import { useState } from 'react';
            export function NestedCapture(): Node {
                const [groups, setGroups] = useState([
                    { id: 'a', label: 'A', items: [{ id: 1 }] }
                ]);
                return <main>{groups.map((group) => (
                    <section key={group.id}>
                        {group.items.map((item) => (
                            <span key={item.id}>{group.label}</span>
                        ))}
                    </section>
                ))}</main>;
            }
        "#,
    })
    .expect_err("outer row captures need a distinct generated item-scope identity");

    assert_eq!(diagnostics[0].code, DiagnosticCode::UnsupportedSyntax);
    assert!(
        diagnostics[0]
            .message
            .contains("cannot capture an outer row"),
        "{diagnostics:#?}"
    );
    assert!(diagnostics[0].span.is_some());
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
    assert!(
        output.contains("const name = __vidactCreateProp("),
        "{output}"
    );
    assert!(output.contains("__vidactProps[\"name\"]"), "{output}");
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
            "const FunctionExpression = function(__vidactProps)",
        ),
        (
            "DefaultFunction.tsx",
            r#"
                export default function DefaultFunction({ label }) {
                    return <p>{label}</p>;
                }
            "#,
            "export default function DefaultFunction(__vidactProps)",
        ),
        (
            "AnonymousDefaultFunction.tsx",
            r#"
                export default function ({ label }) {
                    return <p>{label}</p>;
                }
            "#,
            "export default function(__vidactProps)",
        ),
        (
            "DefaultArrow.tsx",
            r#"
                const DefaultArrow = ({ label }) => {
                    return <p>{label}</p>;
                };
                export default DefaultArrow;
            "#,
            "const DefaultArrow = (__vidactProps) =>",
        ),
        (
            "ExpressionArrow.tsx",
            r#"
                export const ExpressionArrow = ({ label }) => <p>{label}</p>;
            "#,
            "const ExpressionArrow = (__vidactProps) => {",
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
fn compiles_imperative_handle_dependencies_into_commit_resources() {
    let output = compile_surgical_module(ModuleInput {
        filename: "ImperativeCounter.tsx",
        source: r#"
            import { useImperativeHandle as useHandle, useState } from 'react';
            export function ImperativeCounter({ ref }): Node {
                const [count, setCount] = useState(0);
                useHandle(ref, () => ({ count, increment: () => setCount(count + 1) }), [count]);
                return <output>{count}</output>;
            }
        "#,
    })
    .expect("imperative handles should lower through semantic import identity");

    assert!(
        output.contains("compiledImperativeHandle as __vidactImperativeHandle"),
        "{output}"
    );
    assert!(
        output.contains("__vidactImperativeHandle(__vidactScope, 3, () => ref.get()"),
        "{output}"
    );
    assert!(output.contains("() => [count.get()]"), "{output}");
}

#[test]
fn compiles_layout_and_passive_effect_dependencies_into_owner_resources() {
    let output = compile_surgical_module(ModuleInput {
        filename: "Effects.tsx",
        source: r#"
            import * as React from 'react';
            import { useEffect as usePassive, useState } from 'react';
            export function Effects(): Node {
                const [count, setCount] = useState(0);
                React.useLayoutEffect(() => () => console.log(count), [count]);
                usePassive(() => console.log(count));
                return <button onClick={() => setCount(count + 1)}>{count}</button>;
            }
        "#,
    })
    .expect("layout and passive effects should lower through semantic React imports");

    assert!(
        output.contains("compiledLayoutEffect as __vidactLayoutEffect"),
        "{output}"
    );
    assert!(
        output.contains("compiledEffect as __vidactEffect"),
        "{output}"
    );
    assert!(
        output.contains("__vidactLayoutEffect(__vidactScope, 1"),
        "{output}"
    );
    assert!(output.contains("() => [count.get()]"), "{output}");
    assert!(
        output.contains("__vidactEffect(__vidactScope, 1"),
        "{output}"
    );
}

#[test]
fn compiles_module_local_custom_hooks_under_the_callers_scope() {
    let output = compile_surgical_module(ModuleInput {
        filename: "CustomHookCounter.tsx",
        source: r#"
            import { useEffect, useState } from 'react';

            function useCounter(initial, label) {
                const [count, setCount] = useState(initial);
                useEffect(() => () => console.log(label, count), [label, count]);
                return { count, setCount };
            }

            export function CustomHookCounter({ initial, label }): Node {
                const { count, setCount } = useCounter(initial, label);
                return <button onClick={() => setCount(count + 1)}>{count}</button>;
            }
        "#,
    })
    .expect("module-local custom hooks should expand into the caller's compiled scope");

    assert!(!output.contains("function useCounter"), "{output}");
    assert!(!output.contains("useCounter("), "{output}");
    assert!(!output.contains("useState("), "{output}");
    assert!(output.contains("__vidactCreateState"), "{output}");
    assert!(output.contains("__vidactEffect"), "{output}");
}

#[test]
fn compiles_nested_and_repeated_custom_hook_invocations_hygienically() {
    let output = compile_surgical_module(ModuleInput {
        filename: "NestedCustomHooks.tsx",
        source: r#"
            import { useMemo, useState } from 'react';

            function useValue(initial) {
                const [value, setValue] = useState(initial);
                return [value, setValue];
            }

            const useDoubled = (initial) => {
                const [value, setValue] = useValue(initial);
                const doubled = useMemo(() => value * 2, [value]);
                return { doubled, setValue };
            };

            export function NestedCustomHooks(): Node {
                const first = useDoubled(1);
                const second = useDoubled(10);
                return <>
                    <button onClick={() => first.setValue(first.doubled + 1)}>{first.doubled}</button>
                    <button onClick={() => second.setValue(second.doubled + 1)}>{second.doubled}</button>
                </>;
            }
        "#,
    })
    .expect("nested and repeated custom hooks should receive distinct compiled bindings");

    assert!(!output.contains("useValue("), "{output}");
    assert!(!output.contains("useDoubled("), "{output}");
    assert_eq!(
        output.matches("__vidactCreateState(").count(),
        2,
        "{output}"
    );
    assert_eq!(output.matches("__vidactCreateMemo(").count(), 2, "{output}");
}

#[test]
fn gates_and_compiles_insertion_effects() {
    let source = r#"
        import { useInsertionEffect, useState } from 'react';
        export function InsertionEffect(): Node {
            const [theme, setTheme] = useState('red');
            useInsertionEffect(() => console.log(theme), [theme]);
            return <button onClick={() => setTheme('blue')}>{theme}</button>;
        }
    "#;
    let diagnostics = compile_surgical_module(ModuleInput {
        filename: "InsertionEffect.tsx",
        source,
    })
    .expect_err("insertion effects are opt-in");
    assert!(diagnostics.iter().any(|diagnostic| {
        diagnostic.code == DiagnosticCode::UnsupportedSyntax
            && diagnostic.message.contains("`css-insertion`")
            && diagnostic.span.is_some()
    }));

    let output = compile_surgical_module_with_options(
        ModuleInput {
            filename: "InsertionEffect.tsx",
            source,
        },
        &CompilationOptions::default().with_feature(CompilerFeature::CssInsertion),
    )
    .expect("css-insertion enables compiler-owned insertion effects");
    assert!(
        output.contains("compiledInsertionEffect as __vidactInsertionEffect"),
        "{output}"
    );
    assert!(
        output.contains("__vidactInsertionEffect(__vidactScope, 1"),
        "{output}"
    );
}

#[test]
fn compiles_memo_and_callback_dependencies_into_cached_slots() {
    let output = compile_surgical_module(ModuleInput {
        filename: "MemoCounter.tsx",
        source: r#"
            import { useCallback, useMemo, useState } from 'react';
            export function MemoCounter(): Node {
                const [count, setCount] = useState(0);
                const doubled = useMemo(() => count * 2, [count]);
                const increment = useCallback(() => setCount(count + 1), [count]);
                return <button onClick={increment}>{doubled}</button>;
            }
        "#,
    })
    .expect("memoized values and callbacks should lower through semantic React imports");

    assert_eq!(output.matches("__vidactCreateMemo(").count(), 2, "{output}");
    assert!(
        output.contains("createCompiledMemo as __vidactCreateMemo"),
        "{output}"
    );
    assert!(output.contains("() => [count.get()]"), "{output}");
    assert!(output.contains("() => doubled.get()"), "{output}");
    assert!(output.contains("increment.get()"), "{output}");
    assert!(output.contains("count.set(__vidactSnapshot"), "{output}");
    assert!(!output.contains("__vidactSnapshot0.set("), "{output}");
    assert!(!output.contains("useMemo("), "{output}");
    assert!(!output.contains("useCallback("), "{output}");
}

#[test]
fn compiles_context_reads_into_owner_scoped_slots() {
    let output = compile_surgical_module(ModuleInput {
        filename: "ContextApp.tsx",
        source: r#"
            import * as React from 'react';
            import { createContext, useContext as useTheme, useState } from 'react';
            const Theme = createContext('light');
            function Label(): Node {
                const theme = useTheme(Theme);
                return <span>{theme}</span>;
            }
            function UseLabel(): Node {
                const theme = React.use(Theme);
                return <strong>{theme}</strong>;
            }
            export function ContextApp(): Node {
                const [theme, setTheme] = useState('dark');
                return <Theme value={theme}><Label /><UseLabel /></Theme>;
            }
        "#,
    })
    .expect("context reads should lower through named, aliased, and namespace React imports");

    assert_eq!(
        output.matches("__vidactCreateContext(").count(),
        2,
        "{output}"
    );
    assert!(
        output.contains("createCompiledContext as __vidactCreateContext"),
        "{output}"
    );
    assert!(output.contains("() => theme.get()"), "{output}");
    assert!(!output.contains("useTheme("), "{output}");
    assert!(!output.contains("React.use("), "{output}");
}

#[test]
fn compiles_external_store_snapshots_into_owned_slots() {
    let output = compile_surgical_module(ModuleInput {
        filename: "StoreStatus.tsx",
        source: r#"
            import { useSyncExternalStore as useStore } from 'react';
            const listeners = new Set();
            let value = 0;
            const subscribe = (listener) => {
                listeners.add(listener);
                return () => listeners.delete(listener);
            };
            const getSnapshot = () => value;
            export function StoreStatus(): Node {
                const snapshot = useStore(subscribe, getSnapshot, () => -1);
                return <output>{snapshot}</output>;
            }
        "#,
    })
    .expect("external stores should lower through semantic React imports");

    assert!(
        output.contains("createCompiledExternalStore as __vidactCreateExternalStore"),
        "{output}"
    );
    assert!(
        output.contains("const snapshot = __vidactCreateExternalStore("),
        "{output}"
    );
    assert!(output.contains("() => snapshot.get()"), "{output}");
    assert!(!output.contains("useStore("), "{output}");
}

#[test]
fn compiles_effect_events_as_stable_live_callbacks() {
    let output = compile_surgical_module(ModuleInput {
        filename: "EffectEvent.tsx",
        source: r#"
            import { useEffect, useEffectEvent, useState } from 'react';
            const subscribe = (listener) => () => listener;
            export function EffectEvent(): Node {
                const [count, setCount] = useState(0);
                const onTick = useEffectEvent((label) => console.log(label, count));
                useEffect(() => subscribe(onTick), []);
                return <button onClick={() => setCount(count + 1)}>{count}</button>;
            }
        "#,
    })
    .expect("effect events should lower to stable callbacks with live slot reads");

    assert!(
        output.contains("createCompiledEffectEvent as __vidactCreateEffectEvent"),
        "{output}"
    );
    assert!(
        output.contains("console.log(label, count.get())"),
        "{output}"
    );
    assert!(output.contains("subscribe(onTick)"), "{output}");
    assert!(!output.contains("useEffectEvent("), "{output}");
}

#[test]
fn rejects_effect_event_references_outside_effect_callbacks() {
    let diagnostics = compile_surgical_module(ModuleInput {
        filename: "InvalidEffectEvent.tsx",
        source: r#"
            import { useEffectEvent } from 'react';
            export function InvalidEffectEvent(): Node {
                const onClick = useEffectEvent(() => undefined);
                return <button onClick={onClick}>invalid</button>;
            }
        "#,
    })
    .expect_err("effect events cannot escape into render event props");

    assert!(diagnostics.iter().any(|diagnostic| {
        diagnostic.code == DiagnosticCode::UnsupportedSyntax
            && diagnostic
                .message
                .contains("only be referenced inside an effect")
            && diagnostic.span.is_some()
    }));
}

#[test]
fn compiles_ids_against_the_logical_root_generator() {
    let output = compile_surgical_module(ModuleInput {
        filename: "IdentifiedField.tsx",
        source: r#"
            import { useId as useStableId } from 'react';
            export function IdentifiedField(): Node {
                const inputId = useStableId();
                const hintId = useStableId();
                return <><label htmlFor={inputId}>Name</label><input id={inputId} aria-describedby={hintId} /><small id={hintId}>Required</small></>;
            }
        "#,
    })
    .expect("useId should lower to the logical root generator");

    assert!(
        output.contains("createCompiledId as __vidactCreateId"),
        "{output}"
    );
    assert_eq!(output.matches("__vidactCreateId(__vidactScope)").count(), 2);
    assert!(!output.contains("useStableId("), "{output}");
    assert!(!output.contains("inputId.get()"), "{output}");
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
        output.contains(
            "const label = __vidactCreateProp(__vidactScope, 1, __vidactProps[\"name\"])"
        ),
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
fn compiles_slot_valued_component_types_through_identity_dispatch() {
    let output = compile_surgical_module(ModuleInput {
        filename: "PropType.tsx",
        source: r#"
            export function PropType({ Type }) {
                return <Type />;
            }
        "#,
    })
    .expect("a slot-valued JSX callee should evaluate inside the identity dispatcher");

    assert!(output.contains("dispatch as __vidactDispatch"), "{output}");
    assert!(output.contains("() => Type.get()"), "{output}");
    assert!(output.contains("(VidactType) => <VidactType"), "{output}");
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
fn compiles_reactive_jsx_spreads_with_deletion_aware_property_ownership() {
    let output = compile_surgical_module(ModuleInput {
        filename: "Spread.tsx",
        source: r#"
            import { useState } from 'react';
            export function Spread(): Node {
                const [attributes, setAttributes] = useState({ title: 'first' });
                return <div {...attributes}>value</div>;
            }
        "#,
    })
    .expect("reactive spreads should lower to the owned spread descriptor");

    assert!(
        output.contains("compiledSpread as __vidactSpread"),
        "{output}"
    );
    assert!(
        output.contains("__vidactSpread(__vidactBinding("),
        "{output}"
    );
}

#[test]
fn compiles_reactive_component_spreads_into_mutable_prop_stores() {
    let output = compile_surgical_module(ModuleInput {
        filename: "ComponentSpread.tsx",
        source: r#"
            import { useState } from 'react';
            function Child({ label = 'missing', ...rest }): Node {
                return <output {...rest}>{label}</output>;
            }
            export function ComponentSpread(): Node {
                const [props, setProps] = useState({ label: 'first', title: 'present' });
                return <Child {...props} title="explicit" />;
            }
        "#,
    })
    .expect("reactive component spreads should lower to the mutable prop-store descriptor");

    assert!(
        output.contains("compiledComponentSpread as __vidactComponentSpread"),
        "{output}"
    );
    assert!(
        output.contains("__vidactComponentSpread(__vidactBinding("),
        "{output}"
    );
    assert!(output.contains("[\"title\"]"), "{output}");
}

#[test]
fn compiles_rest_props_into_a_resolved_object_slot() {
    let output = compile_surgical_module(ModuleInput {
        filename: "RestProps.tsx",
        source: r#"
            export function RestProps({ title, ...rest }): Node {
                return <section {...rest}>{title}</section>;
            }
        "#,
    })
    .expect("rest props should resolve upstream bindings and drive a reactive spread");

    assert!(
        output.contains("createCompiledRestProp as __vidactCreateRestProp"),
        "{output}"
    );
    assert!(
        output.contains("const rest = __vidactCreateRestProp("),
        "{output}"
    );
    assert!(output.contains("__vidactProps, [\"title\"]"), "{output}");
    assert!(output.contains("() => rest.get()"), "{output}");
}

#[test]
fn compiles_props_object_reads_and_forwarding_into_a_live_object_slot() {
    let output = compile_surgical_module(ModuleInput {
        filename: "PropsObject.tsx",
        source: r#"
            export function PropsObject(props): Node {
                const key = 'title';
                return <section {...props}>{props.label}:{props[key]}</section>;
            }
        "#,
    })
    .expect("whole props objects should remain live without component reinvocation");

    assert!(
        output.contains("function PropsObject(__vidactProps)"),
        "{output}"
    );
    assert!(
        output
            .contains("const props = __vidactCreateRestProp(__vidactScope, 1, __vidactProps, [])"),
        "{output}"
    );
    assert!(output.contains("props.get().label"), "{output}");
    assert!(output.contains("props.get()[key]"), "{output}");
    assert!(
        output.contains("__vidactSpread(__vidactBinding("),
        "{output}"
    );
}

#[test]
fn compiles_nested_prop_paths_with_container_and_leaf_defaults() {
    let output = compile_surgical_module(ModuleInput {
        filename: "NestedProps.tsx",
        source: r#"
            export function NestedProps({
                account: { profile: { name: label = 'anonymous' } = {} } = {}
            }): Node {
                return <p>{label}</p>;
            }
        "#,
    })
    .expect("nested object prop patterns should flatten into reactive leaf slots");

    assert!(
        output.contains("nestedProp as __vidactNestedProp"),
        "{output}"
    );
    assert!(
        output.contains("__vidactProps[\"account\"], [\"profile\", \"name\"]"),
        "{output}"
    );
    assert!(output.contains("() => ({})"), "{output}");
    assert!(output.contains("() => \"anonymous\""), "{output}");
    assert!(output.contains("() => label.get()"), "{output}");
}

#[test]
fn defers_component_children_until_the_child_namespace_is_active() {
    let output = compile_surgical_module(ModuleInput {
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
    .expect("component children should defer construction to their insertion namespace");

    assert!(output.contains("deferred as __vidactDeferred"), "{output}");
    assert!(output.contains("__vidactDeferred(() => <div"), "{output}");
}
