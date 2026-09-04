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

fn compile_async(input: ModuleInput<'_>) -> Result<String, Vec<Diagnostic>> {
    compile_surgical_module_with_options(
        input,
        &CompilationOptions::default().with_feature(CompilerFeature::Async),
    )
}

fn compile_concurrent(input: ModuleInput<'_>) -> Result<String, Vec<Diagnostic>> {
    compile_surgical_module_with_options(
        input,
        &CompilationOptions::default().with_feature(CompilerFeature::Concurrent),
    )
}

fn compile_actions(input: ModuleInput<'_>) -> Result<String, Vec<Diagnostic>> {
    compile_surgical_module_with_options(
        input,
        &CompilationOptions::default().with_feature(CompilerFeature::Actions),
    )
}

fn compile_retained_ui(input: ModuleInput<'_>) -> Result<String, Vec<Diagnostic>> {
    compile_surgical_module_with_options(
        input,
        &CompilationOptions::default().with_feature(CompilerFeature::RetainedUi),
    )
}

fn compile_profiling(input: ModuleInput<'_>) -> Result<String, Vec<Diagnostic>> {
    compile_surgical_module_with_options(
        input,
        &CompilationOptions::default().with_feature(CompilerFeature::Profiling),
    )
}

fn compile_framework(input: ModuleInput<'_>) -> Result<String, Vec<Diagnostic>> {
    compile_surgical_module_with_options(
        input,
        &CompilationOptions::default().with_feature(CompilerFeature::Framework),
    )
}

#[test]
fn imports_only_dom_capabilities_reached_by_intrinsic_jsx() {
    let counter = compile_surgical_module(ModuleInput {
        filename: "Counter.tsx",
        source: r#"
            import { useState } from 'react';
            export function Counter() {
                const [count, setCount] = useState(0);
                return <button onClick={() => setCount(count + 1)}>{count}</button>;
            }
        "#,
    })
    .expect("counter should compile");
    assert!(counter.contains("onClick={__vidactEvent"), "{counter}");
    assert!(!counter.contains("onClick={__vidactBinding"), "{counter}");
    assert!(!counter.contains("@vidact/runtime/dom/forms"), "{counter}");
    assert!(
        !counter.contains("@vidact/runtime/dom/namespace"),
        "{counter}"
    );
    assert!(!counter.contains("@vidact/runtime/dom/styles"), "{counter}");

    let capabilities = compile_surgical_module(ModuleInput {
        filename: "Capabilities.tsx",
        source: r#"
            export function Capabilities() {
                return <input value="ready" style={{ color: 'red' }} />;
            }
        "#,
    })
    .expect("form and style capabilities should compile");
    assert!(
        capabilities.contains("@vidact/runtime/dom/forms"),
        "{capabilities}"
    );
    assert!(
        capabilities.contains("__vidactEnableDomForms()"),
        "{capabilities}"
    );
    assert!(
        capabilities.contains("@vidact/runtime/dom/styles"),
        "{capabilities}"
    );
    assert!(
        capabilities.contains("__vidactEnableDomStyles()"),
        "{capabilities}"
    );

    let namespace = compile_surgical_module(ModuleInput {
        filename: "Namespace.tsx",
        source: r#"
            export function Namespace() {
                return <svg><circle cx="1" /></svg>;
            }
        "#,
    })
    .expect("namespace capability should compile");
    assert!(
        namespace.contains("@vidact/runtime/dom/namespace"),
        "{namespace}"
    );
    assert!(
        namespace.contains("__vidactEnableDomNamespace()"),
        "{namespace}"
    );
}

#[test]
fn constructs_reactive_event_expressions_once() {
    let output = compile_surgical_module(ModuleInput {
        filename: "StableEventExpression.tsx",
        source: r#"
            import { useState } from 'react';
            export function StableEventExpression({ primary, secondary }) {
                const [active, setActive] = useState(false);
                return <button onClick={active ? primary : secondary} onDoubleClick={setActive} />;
            }
        "#,
    })
    .expect("reactive event expressions should dispatch through one stable compiled event");

    assert!(
        output.contains("onClick={__vidactEvent(__vidactScope, __vidactBinding"),
        "{output}"
    );
    assert!(!output.contains("onClick={__vidactBinding"), "{output}");
}

#[test]
fn gates_framework_resource_hints_and_server_only_cache_apis() {
    let hints = ModuleInput {
        filename: "FrameworkHints.tsx",
        source: r#"
            import { preconnect, preload } from 'react-dom';
            export function App() {
                preconnect('https://cdn.example.test');
                preload('/app.css', { as: 'style' });
                return <main>framework</main>;
            }
        "#,
    };
    let diagnostics = compile_surgical_module(hints)
        .expect_err("framework resource hints must remain feature-gated");
    assert!(diagnostics.iter().any(|diagnostic| {
        diagnostic.code == DiagnosticCode::UnsupportedSyntax
            && diagnostic.message.contains("`framework`")
            && diagnostic.span.is_some()
    }));
    let output = compile_framework(hints).expect("framework resource hints should remain callable");
    assert!(
        output.contains("preconnect(\"https://cdn.example.test\")"),
        "{output}"
    );
    assert!(output.contains("preload(\"/app.css\""), "{output}");

    let cache = ModuleInput {
        filename: "ClientCache.tsx",
        source: r#"
            import { cache } from 'react';
            const read = cache(() => 'value');
            export function App() { return <main>{read()}</main>; }
        "#,
    };
    let diagnostics =
        compile_framework(cache).expect_err("React cache must remain a server-only framework API");
    assert!(diagnostics.iter().any(|diagnostic| {
        diagnostic.message.contains("server target") && diagnostic.span.is_some()
    }));
}

#[test]
fn gates_framework_module_directives_at_their_source_span() {
    let client = ModuleInput {
        filename: "ClientBoundary.tsx",
        source: r#"
            "use client";
            export function ClientBoundary() { return <button>client</button>; }
        "#,
    };
    let diagnostics = compile_surgical_module(client)
        .expect_err("client boundaries must require the framework feature");
    assert!(diagnostics.iter().any(|diagnostic| {
        diagnostic.message.contains("use client") && diagnostic.span.is_some()
    }));
    let output = compile_framework(client).expect("framework client boundaries should compile");
    assert!(output.starts_with("\"use client\";"), "{output}");

    let server = ModuleInput {
        filename: "ServerFunction.tsx",
        source: r#"
            export function ServerFunction() {
                "use server";
                return <p>server</p>;
            }
        "#,
    };
    let diagnostics =
        compile_framework(server).expect_err("use server must require the server compiler target");
    assert!(diagnostics.iter().any(|diagnostic| {
        diagnostic.message.contains("server compiler target") && diagnostic.span.is_some()
    }));
}

#[test]
fn activates_framework_metadata_only_for_html_head_elements() {
    let output = compile_framework(ModuleInput {
        filename: "FrameworkMetadata.tsx",
        source: r#"
            export function FrameworkMetadata({ title }) {
                return <><title>{title}</title><meta name="description" content={title} /><svg><title>icon</title></svg></>;
            }
        "#,
    })
    .expect("framework metadata should compile");
    assert!(
        output.contains("enableFrameworkMetadata as __vidactEnableFrameworkMetadata"),
        "{output}"
    );
    assert!(
        output.contains("from \"@vidact/runtime/framework\""),
        "{output}"
    );
    assert!(
        output.contains("__vidactEnableFrameworkMetadata();"),
        "{output}"
    );

    let output = compile_framework(ModuleInput {
        filename: "FrameworkWithoutMetadata.tsx",
        source: r#"
            export function App() {
                return <>
                    <svg><title>icon</title></svg>
                    <title itemProp="name">item</title>
                    <meta itemProp="description" content="item" />
                    <link itemProp="author" href="/author" />
                    <link rel="stylesheet" href="/manual.css" />
                    <link rel="icon" href="/managed.ico" onLoad={() => undefined} />
                </>;
            }
        "#,
    })
    .expect("item metadata and manually managed resources are not document metadata");
    assert!(!output.contains("enableFrameworkMetadata"), "{output}");
}

#[test]
fn gates_and_stages_profiling_apis() {
    let source = r#"
        import { Profiler, captureOwnerStack, useDebugValue, useState } from 'react';
        function Child({ prefix }) {
            const [count, setCount] = useState(0);
            useDebugValue(count, value => `${prefix}:${value}`);
            return <button onClick={() => setCount(count + 1)} data-stack={captureOwnerStack()}>{count}</button>;
        }
        export function App() {
            return <Profiler id="app" onRender={() => undefined}><Child prefix="count" /></Profiler>;
        }
    "#;
    let diagnostics = compile_surgical_module(ModuleInput {
        filename: "ProfilingDisabled.tsx",
        source,
    })
    .expect_err("profiling APIs must remain opt-in");
    assert!(diagnostics.iter().any(|diagnostic| {
        diagnostic.code == DiagnosticCode::UnsupportedSyntax
            && diagnostic.message.contains("`profiling`")
            && diagnostic.span.is_some()
    }));

    let output = compile_profiling(ModuleInput {
        filename: "Profiling.tsx",
        source,
    })
    .expect("profiling should stage Profiler children and preserve development APIs");
    assert!(
        output.contains("<Profiler id=\"app\" onRender="),
        "{output}"
    );
    assert!(
        output.contains(">{() => <><Child prefix=\"count\" /></>}</Profiler>"),
        "{output}"
    );
    assert!(
        output.contains("useDebugValue(__vidactBinding(__vidactScope, 3, () => count.get())"),
        "{output}"
    );
    assert!(output.contains("captureOwnerStack()"), "{output}");
}

#[test]
fn gates_activity_and_stages_its_children() {
    let source = r#"
        import { Activity, useState } from 'react';
        function Panel() { return <p>retained</p>; }
        export function App() {
            const [mode, setMode] = useState<'visible' | 'hidden'>('visible');
            return <><button onClick={() => setMode('hidden')}>hide</button><Activity mode={mode}><Panel /></Activity></>;
        }
    "#;
    let diagnostics = compile_surgical_module(ModuleInput {
        filename: "ActivityDisabled.tsx",
        source,
    })
    .expect_err("Activity must remain opt-in");
    assert!(diagnostics.iter().any(|diagnostic| {
        diagnostic.code == DiagnosticCode::UnsupportedSyntax
            && diagnostic.message.contains("`retained-ui`")
            && diagnostic.span.is_some()
    }));

    let output = compile_retained_ui(ModuleInput {
        filename: "Activity.tsx",
        source,
    })
    .expect("retained-ui should stage Activity children and lower its reactive mode");
    assert!(
        output.contains("<Activity mode={__vidactBinding("),
        "{output}"
    );
    assert!(
        output.contains(">{() => <><Panel /></>}</Activity>"),
        "{output}"
    );
    assert!(!output.contains("__vidactDeferred(() => () =>"), "{output}");
}

#[test]
fn gates_and_lowers_actions_at_their_source_spans() {
    let source = r#"
        import { useActionState, useOptimistic } from 'react';
        import { useFormStatus } from 'react-dom';
        function SubmitStatus(): Node {
            const status = useFormStatus();
            return <output>{status.pending ? 'saving' : 'ready'}</output>;
        }
        function ForwardedSubmitter({ submitterProps }): Node {
            return <button {...submitterProps}>forwarded</button>;
        }
        export function Actions(): Node {
            const [state, dispatch, pending] = useActionState(
                async (previous, value: FormData) => previous + String(value.get('title')),
                '',
                '/actions',
            );
            const [optimistic, addOptimistic] = useOptimistic(
                state,
                (current, value: string) => current + value,
            );
            return <form action={dispatch}>
                <input name="title" />
                <button onClick={() => addOptimistic('pending')}>{pending ? 'pending' : optimistic}</button>
                <ForwardedSubmitter submitterProps={{ formAction: dispatch }} />
                <SubmitStatus />
            </form>;
        }
    "#;
    let diagnostics = compile_surgical_module(ModuleInput {
        filename: "ActionsDisabled.tsx",
        source,
    })
    .expect_err("Actions hooks must be gated");
    assert!(
        diagnostics.iter().any(|diagnostic| {
            diagnostic.span.is_some() && diagnostic.message.contains("`actions` compiler feature")
        }),
        "{diagnostics:?}"
    );

    let output = compile_actions(ModuleInput {
        filename: "Actions.tsx",
        source,
    })
    .expect("Actions hooks and form actions should lower to runtime-owned slots");
    assert!(
        output.contains("from \"@vidact/runtime/actions\""),
        "{output}"
    );
    assert!(output.contains("__vidactCreateActionState("), "{output}");
    assert!(output.contains("__vidactCreateOptimistic("), "{output}");
    assert!(output.contains("__vidactCreateFormStatus("), "{output}");
    assert!(output.contains("<__vidactActionForm"), "{output}");
    assert!(output.contains("__vidactFormAction(state.set)"), "{output}");
    assert!(
        output.contains("__vidactFormAction(submitterProps.get())"),
        "{output}"
    );
    assert!(output.contains("state.get()[\"value\"]"), "{output}");
    assert!(output.contains("state.get()[\"pending\"]"), "{output}");
    assert!(output.contains("optimistic.set(\"pending\")"), "{output}");
}

#[test]
fn compiles_actions_inside_module_local_custom_hooks() {
    let output = compile_actions(ModuleInput {
        filename: "CustomActionHook.tsx",
        source: r#"
            import { useActionState } from 'react';

            function useQueue(initial) {
                const [value, dispatch, pending] = useActionState(
                    async (previous, increment: number) => previous + increment,
                    initial,
                );
                return { value, dispatch, pending };
            }

            export function CustomActionHook(): Node {
                const queue = useQueue(1);
                return <button onClick={() => queue.dispatch(2)}>
                    {queue.pending ? 'pending' : queue.value}
                </button>;
            }
        "#,
    })
    .expect("Actions primitives should expand inside a module-local custom hook");

    assert!(!output.contains("function useQueue"), "{output}");
    assert!(!output.contains("useQueue("), "{output}");
    assert!(output.contains("__vidactCreateActionState("), "{output}");
    assert!(output.contains("dispatch: __vidactHook"), "{output}");
    assert!(output.contains("_value.set"), "{output}");
}

#[test]
fn gates_and_lowers_concurrent_hooks_at_their_source_spans() {
    let source = r#"
        import { useDeferredValue, useState, useTransition } from 'react';
        export function Search(): Node {
            const [query, setQuery] = useState('');
            const [isPending, startTransition] = useTransition();
            const deferredQuery = useDeferredValue(query, 'initial');
            return <button onClick={() => startTransition(() => setQuery('next'))}>
                {isPending ? 'pending' : deferredQuery}
            </button>;
        }
    "#;
    let diagnostics = compile_surgical_module(ModuleInput {
        filename: "ConcurrentDisabled.tsx",
        source,
    })
    .expect_err("concurrent hooks must be gated");
    assert!(
        diagnostics.iter().any(|diagnostic| {
            diagnostic.span.is_some()
                && diagnostic.message.contains("`concurrent` compiler feature")
        }),
        "{diagnostics:?}"
    );

    let output = compile_concurrent(ModuleInput {
        filename: "Concurrent.tsx",
        source,
    })
    .expect("concurrent hooks should lower to scheduler-owned slots");
    assert!(
        output.contains("from \"@vidact/runtime/concurrent\""),
        "{output}"
    );
    assert!(output.contains("__vidactCreateTransition("), "{output}");
    assert!(output.contains("__vidactCreateDeferred("), "{output}");
    assert!(
        output.contains("isPending.set(()=>query.set(\"next\"))")
            || output.contains("isPending.set(() => query.set(\"next\"))"),
        "{output}"
    );
    assert!(output.contains("deferredQuery.get()"), "{output}");
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
fn compiles_nested_divergent_ternaries_into_one_owned_choice() {
    let output = compile_surgical_module(ModuleInput {
        filename: "Conditional.tsx",
        source: r#"
            import { useState } from 'react';
            export function Conditional(): Node {
                const [visible, setVisible] = useState(true);
                return <main>{visible ? <div>yes</div> : <ul><li>no</li></ul>}</main>;
            }
        "#,
    })
    .expect("divergent nested JSX alternatives should use an owned choice");

    assert_eq!(
        output.matches("__vidactChoose(__vidactScope").count(),
        1,
        "{output}"
    );
    assert!(!output.contains("__vidactWhen"), "{output}");
    assert_eq!(output.matches("<div>").count(), 1, "{output}");
    assert_eq!(output.matches("<ul>").count(), 1, "{output}");
}

#[test]
fn keeps_reactive_scalar_ternary_branches_live() {
    let output = compile_surgical_module(ModuleInput {
        filename: "Conditional.tsx",
        source: r#"
            import { useState } from 'react';
            export function Conditional({ label }): Node {
                const [visible, setVisible] = useState(true);
                return <main>{visible ? <p>yes</p> : label}</main>;
            }
        "#,
    })
    .expect("a selected scalar branch should retain its own reactive binding");

    assert!(
        output.contains("__vidactChoose(__vidactScope, 2"),
        "{output}"
    );
    assert!(
        output.contains("() => __vidactBinding(__vidactScope, 1, () => label.get())"),
        "{output}"
    );
}

#[test]
fn recursively_lowers_nested_structural_ternaries() {
    let output = compile_surgical_module(ModuleInput {
        filename: "Conditional.tsx",
        source: r#"
            import { useState } from 'react';
            export function Conditional(): Node {
                const [primary, setPrimary] = useState(true);
                const [secondary, setSecondary] = useState(false);
                return <main>{primary ? <p>primary</p> : (
                    secondary ? <div>secondary</div> : <ul><li>fallback</li></ul>
                )}</main>;
            }
        "#,
    })
    .expect("nested structural ternaries should each own a reactive choice");

    assert_eq!(
        output.matches("__vidactChoose(__vidactScope").count(),
        2,
        "{output}"
    );
}

#[test]
fn rejects_unmodeled_jsx_expressions_inside_ternary_branches() {
    let diagnostics = compile_surgical_module(ModuleInput {
        filename: "Conditional.tsx",
        source: r#"
            import { useState } from 'react';
            function render(value, child) { return value ? child : null; }
            export function Conditional({ label }): Node {
                const [visible, setVisible] = useState(true);
                return <main>{visible ? <p>yes</p> : render(label, <span>no</span>)}</main>;
            }
        "#,
    })
    .expect_err("unsupported JSX-producing calls must not hide inside ternary branches");

    assert!(diagnostics.iter().any(|diagnostic| {
        diagnostic.code == DiagnosticCode::UnsupportedSyntax
            && diagnostic
                .message
                .contains("ternary branches containing JSX")
    }));
}

#[test]
fn rejects_reactive_keys_in_nested_ternaries_until_identity_dispatch_is_available() {
    let diagnostics = compile_surgical_module(ModuleInput {
        filename: "Conditional.tsx",
        source: r#"
            import { useState } from 'react';
            function Child() { return <p>child</p>; }
            export function Conditional({ itemKey }): Node {
                const [visible, setVisible] = useState(true);
                return <main>{visible
                    ? <Child key={itemKey} />
                    : <Child key={itemKey} />
                }</main>;
            }
        "#,
    })
    .expect_err("nested dynamic keys require identity-aware dispatch");

    assert!(diagnostics.iter().any(|diagnostic| {
        diagnostic.code == DiagnosticCode::UnsupportedSyntax
            && diagnostic.message.contains("nested identity dispatch")
    }));
}

#[test]
fn aligns_nested_ternaries_with_matching_type_and_key() {
    let output = compile_surgical_module(ModuleInput {
        filename: "Conditional.tsx",
        source: r#"
            import { useState } from 'react';
            function Child({ label }) {
                const [count, setCount] = useState(0);
                return <button>{label}:{count}</button>;
            }
            export function Conditional(): Node {
                const [visible, setVisible] = useState(true);
                return <main>{visible ? (
                    <section key="stable" data-mode="yes"><Child label="yes" /></section>
                ) : (
                    <section key="stable" data-mode="no"><Child label="no" /></section>
                )}</main>;
            }
        "#,
    })
    .expect("matching nested JSX alternatives should retain their shared identity");

    assert_eq!(output.matches("<section").count(), 1, "{output}");
    assert_eq!(output.matches("<Child").count(), 1, "{output}");
    assert!(
        output.contains("visible.get() ? \"yes\" : \"no\""),
        "{output}"
    );
}

#[test]
fn rejects_unmodeled_reactive_jsx_expressions() {
    let diagnostics = compile_surgical_module(ModuleInput {
        filename: "Conditional.tsx",
        source: r#"
            import { useState } from 'react';
            function render(value, child) { return value ? child : null; }
            export function Conditional(): Node {
                const [visible, setVisible] = useState(true);
                return <main>{render(visible, <p>yes</p>)}</main>;
            }
        "#,
    })
    .expect_err("unmodeled reactive JSX expressions must continue to fail closed");

    assert!(diagnostics.iter().any(|diagnostic| {
        diagnostic.code == DiagnosticCode::UnsupportedSyntax
            && diagnostic
                .message
                .contains("supported list or conditional expression")
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
fn accepts_module_frozen_empty_hook_dependency_arrays() {
    let output = compile_surgical_module(ModuleInput {
        filename: "FrozenHookDependencies.tsx",
        source: r#"
            import { useEffect } from 'react';

            const EMPTY_ARRAY = Object.freeze([]);

            export function FrozenHookDependencies({ onMount }): Node {
                useEffect(onMount, EMPTY_ARRAY);
                return <output>stable</output>;
            }
        "#,
    })
    .expect("a module-frozen empty array has immutable identity and static length");

    assert!(output.contains("__vidactEffect"), "{output}");
    assert!(output.contains("() => []"), "{output}");
}

#[test]
fn accepts_inline_effect_dependency_spreads() {
    let output = compile_surgical_module(ModuleInput {
        filename: "EffectDependencySpread.tsx",
        source: r#"
            import { useLayoutEffect, useState } from 'react';

            export function EffectDependencySpread({ values }): Node {
                const [runs, setRuns] = useState(0);
                const dependencies = Object.values(values);
                useLayoutEffect(() => setRuns((count) => count + 1), [values, ...dependencies]);
                return <output>{runs}</output>;
            }
        "#,
    })
    .expect("an inline dependency array may spread a reactively derived array");

    assert!(output.contains("__vidactLayoutEffect"), "{output}");
    assert!(output.contains("...dependencies"), "{output}");
}

#[test]
fn rejects_mutable_named_hook_dependency_arrays() {
    let diagnostics = compile_surgical_module(ModuleInput {
        filename: "MutableHookDependencies.tsx",
        source: r#"
            import { useEffect } from 'react';

            const dependencies = [];

            export function MutableHookDependencies(): Node {
                useEffect(() => undefined, dependencies);
                return <output>mutable</output>;
            }
        "#,
    })
    .expect_err("a const binding does not make its mutable array value static");

    assert!(diagnostics.iter().any(|diagnostic| {
        diagnostic.code == DiagnosticCode::UnsupportedSyntax
            && diagnostic
                .message
                .contains("dependencies must be an inline array")
    }));
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
fn compiles_custom_hook_default_and_optional_parameters() {
    let output = compile_surgical_module(ModuleInput {
        filename: "OptionalHook.tsx",
        source: r#"
            import { useState } from 'react';
            function useLabel(enabled = false, prefix?: string) {
                const [label, setLabel] = useState('Save');
                void enabled;
                void prefix;
                return [label, setLabel];
            }
            export function OptionalHook() {
                const [label, setLabel] = useLabel();
                return <button onClick={() => setLabel('Saved')}>{label}</button>;
            }
        "#,
    })
    .expect("custom hook defaults and omitted optional values should expand at the call site");

    assert!(output.contains("__vidactCreateState"), "{output}");
    assert!(!output.contains("useLabel("), "{output}");
    assert!(!output.contains("useState("), "{output}");
}

#[test]
fn rejects_destructured_custom_hook_rest_parameters() {
    let diagnostics = compile_surgical_module(ModuleInput {
        filename: "DestructuredRestHook.tsx",
        source: r#"
            import { useRef } from 'react';
            function useFirst(...[first]) {
                return useRef(first);
            }
            export function DestructuredRestHook({ value }) {
                const ref = useFirst(value);
                return <output>{ref.current}</output>;
            }
        "#,
    })
    .expect_err("a custom-hook rest parameter must keep one statically owned array binding");

    assert!(diagnostics.iter().any(|diagnostic| {
        diagnostic.code == DiagnosticCode::UnsupportedSyntax
            && diagnostic
                .message
                .contains("custom hook rest parameters must bind to an identifier")
    }));
}

/// A rest argument that carries side effects is bound once and shared by the
/// spread and the dependency list, so expanding the hook cannot evaluate it
/// twice.
#[test]
fn binds_effectful_rest_arguments_once_for_callback_factory_dependencies() {
    let output = compile_surgical_module_with_options(
        ModuleInput {
            filename: "EffectfulComposedRefsHook.tsx",
            source: r#"
                import * as React from 'react';

                function composeRefs(...refs) {
                    return (node) => refs.forEach((ref) => ref?.(node));
                }

                function useComposedRefs(...refs) {
                    return React.useCallback(composeRefs(...refs), refs);
                }

                function createRef() {
                    return () => undefined;
                }

                export function EffectfulComposedRefsHook() {
                    const ref = useComposedRefs(createRef());
                    return <input ref={ref} />;
                }
            "#,
        },
        &CompilationOptions::default().with_feature(CompilerFeature::DependencySource),
    )
    .expect("an effectful rest argument should expand into one shared binding");

    assert!(!output.contains("useComposedRefs("), "{output}");
    // The effectful argument is evaluated in exactly one place, and both the
    // spread and the dependency list read that binding.
    assert_eq!(output.matches("[createRef()]").count(), 1, "{output}");
    assert!(
        output.contains("composeRefs(...__vidactHook0Rest), __vidactHook0Rest)"),
        "{output}"
    );
}

#[test]
fn compiles_destructured_custom_hook_parameters() {
    let output = compile_surgical_module(ModuleInput {
        filename: "ControlledHook.tsx",
        source: r#"
            import { useState } from 'react';
            function useControlled({ controlled, default: defaultValue, state = 'value' }) {
                const [value, setValue] = useState(defaultValue);
                void state;
                return [controlled ?? value, setValue];
            }
            export function ControlledHook({ value }) {
                const [current, setCurrent] = useControlled({ controlled: value, default: '' });
                return <button onClick={() => setCurrent('next')}>{current}</button>;
            }
        "#,
    })
    .expect("destructured custom-hook parameters should bind from one evaluated argument");

    assert!(output.contains("__vidactHook0Arg0"), "{output}");
    assert!(output.contains("__vidactCreateState"), "{output}");
    assert!(!output.contains("useControlled("), "{output}");
}

#[test]
fn updates_destructured_custom_hook_parameters_with_reactive_arguments() {
    let output = compile_surgical_module_with_options(
        ModuleInput {
            filename: "ReactiveDestructuredHookParameter.tsx",
            source: r#"
                import { useRef } from 'react';
                function useButton(options) {
                    const { open } = options;
                    useRef(null);
                    return <button aria-expanded={open} />;
                }
                export function ReactiveDestructuredHookParameter({ open }) {
                    return useButton({ open });
                }
            "#,
        },
        &CompilationOptions::default().with_feature(CompilerFeature::DependencySource),
    )
    .expect("destructured custom-hook parameters should remain reactive");

    assert!(output.contains("let __vidactHook1_1_open ="), "{output}");
    assert!(
        output.matches("__vidactHook1_1_open =").count() >= 2,
        "the destructured parameter needs an updater: {output}"
    );
}

#[test]
fn dependency_source_updates_props_destructured_inside_a_component_body() {
    let output = compile_surgical_module_with_options(
        ModuleInput {
            filename: "DirectProps.tsx",
            source: r#"
                export function DirectProps(componentProps) {
                    const { open = false, label: text, ...elementProps } = componentProps;
                    return <button aria-expanded={open} {...elementProps}>{text}</button>;
                }
            "#,
        },
        &CompilationOptions::default().with_feature(CompilerFeature::DependencySource),
    )
    .expect("direct parameter destructuring should retain reactive component-prop edges");

    assert!(
        output.contains("objectRest as __vidactObjectRest"),
        "{output}"
    );
    assert!(output.matches("open =").count() >= 2, "{output}");
    assert!(output.matches("text =").count() >= 2, "{output}");
    assert!(output.matches("elementProps =").count() >= 2, "{output}");
}

#[test]
fn compiles_setter_only_state_inside_custom_hooks() {
    let output = compile_surgical_module(ModuleInput {
        filename: "ForcedUpdate.tsx",
        source: r#"
            import { useState } from 'react';
            function useForceUpdate() {
                const [, setValue] = useState({});
                return () => setValue({});
            }
            export function ForcedUpdate() {
                const update = useForceUpdate();
                return <button onClick={update}>Update</button>;
            }
        "#,
    })
    .expect("setter-only state destructuring should receive an internal value binding");

    assert!(output.contains("__vidactCreateState"), "{output}");
    assert!(!output.contains("useForceUpdate("), "{output}");
}

#[test]
fn hoists_unconditional_nested_custom_hook_results_before_expansion() {
    let output = compile_surgical_module(ModuleInput {
        filename: "NestedHookResult.tsx",
        source: r#"
            import { useEffect } from 'react';
            function useStable(callback) {
                useEffect(() => undefined, []);
                return callback;
            }
            function useButton(callback) {
                return { handler: useStable(callback) };
            }
            export function NestedHookResult() {
                const button = useButton(() => undefined);
                return <button onClick={button.handler}>Save</button>;
            }
        "#,
    })
    .expect("an unconditional hook result nested in an object should hoist and expand");

    assert!(output.contains("__vidactEffect"), "{output}");
    assert!(!output.contains("useStable("), "{output}");
    assert!(!output.contains("useButton("), "{output}");
}

#[test]
fn keeps_branch_only_custom_hook_arguments_inside_their_guard() {
    let output = compile_surgical_module_with_options(
        ModuleInput {
            filename: "ConditionalHookArgument.tsx",
            source: r#"
            import { useRef } from 'react';

            function useStableItems(items) {
                useRef(items);
                return items;
            }

            function useConditionalItems(items) {
                let merged = null;
                if (typeof document !== 'undefined') {
                    if (!items) void useStableItems(null);
                    else if (Array.isArray(items)) merged = useStableItems([...items]);
                    else merged = useStableItems(Object.values(items));
                }
                return merged;
            }

            export function ConditionalHookArgument({ items }) {
                const merged = useConditionalItems(items);
                return <output>{String(merged)}</output>;
            }
            "#,
        },
        &CompilationOptions::default().with_feature(CompilerFeature::DependencySource),
    )
    .expect("branch-local hook arguments should compile without eager evaluation");

    let guard = output
        .find("Array.isArray")
        .expect("the source branch should remain in the compiled output");
    let spread = output
        .find("...items")
        .expect("the branch-local spread should remain in the compiled output");
    assert!(spread > guard, "branch-only argument was hoisted: {output}");
}

#[test]
fn normalizes_a_custom_hook_guard_return_to_one_result() {
    let output = compile_surgical_module(ModuleInput {
        filename: "GuardedHook.tsx",
        source: r#"
            import { useEffect } from 'react';
            function useValue(enabled) {
                useEffect(() => undefined, []);
                if (!enabled) {
                    return null;
                }
                const result = 'ready!';
                return result;
            }
            export function GuardedHook({ enabled }) {
                return <p>{useValue(enabled)}</p>;
            }
        "#,
    })
    .expect("a top-level custom-hook guard return should normalize to one inline result");

    assert!(output.contains("__vidactEffect"), "{output}");
    assert!(!output.contains("useValue("), "{output}");
    assert!(output.contains("if (!enabled.get())"), "{output}");
}

#[test]
fn dependency_source_mode_accepts_one_time_ref_initialization() {
    let source = r#"
        import { useRef } from 'react';
        const UNINITIALIZED = {};
        function useRefWithInit(init, argument) {
            const ref = useRef(UNINITIALIZED);
            if (ref.current === UNINITIALIZED) {
                ref.current = init(argument);
            }
            return ref;
        }
        export function DependencyButton() {
            const stable = useRefWithInit(() => ({ ready: true })).current;
            return <button data-ready={stable.ready}>Save</button>;
        }
    "#;
    let diagnostics = compile_surgical_module(ModuleInput {
        filename: "DependencyButton.tsx",
        source,
    })
    .expect_err("application source should retain React Compiler's ref validation");
    assert!(
        diagnostics
            .iter()
            .any(|diagnostic| diagnostic.message.contains("Cannot access refs"))
    );

    let output = compile_surgical_module_with_options(
        ModuleInput {
            filename: "DependencyButton.tsx",
            source,
        },
        &CompilationOptions::default().with_feature(CompilerFeature::DependencySource),
    )
    .expect("dependency source should preserve the published one-time ref initialization pattern");
    assert!(output.contains("ref.current"), "{output}");
    assert!(!output.contains("useRefWithInit("), "{output}");
}

#[test]
fn dependency_source_mode_analyzes_memos_expanded_from_custom_hooks() {
    let output = compile_surgical_module_with_options(
        ModuleInput {
            filename: "DependencyMemo.tsx",
            source: r#"
                import { useCallback, useLayoutEffect, useRef } from 'react';
                function useButton(disabled) {
                    const elementRef = useRef(null);
                    const updateDisabled = useCallback(() => {
                        if (elementRef.current && disabled) elementRef.current.disabled = false;
                    }, [disabled]);
                    useLayoutEffect(updateDisabled, [updateDisabled]);
                    return { elementRef, updateDisabled };
                }
                export function DependencyMemo({ disabled }) {
                    const state = useButton(disabled);
                    return <button ref={state.elementRef} onClick={state.updateDisabled}>Save</button>;
                }
            "#,
        },
        &CompilationOptions::default().with_feature(CompilerFeature::DependencySource),
    )
    .expect("custom-hook memo bindings should remain present in dependency analysis");

    assert!(output.contains("__vidactCreateMemo"), "{output}");
    assert!(!output.contains("useButton("), "{output}");
}

#[test]
fn dependency_source_prunes_an_unreferenced_class_hook_forwarder() {
    let output = compile_surgical_module_with_options(
        ModuleInput {
            filename: "StoreStatus.tsx",
            source: r#"
                import { useSyncExternalStore } from 'react';

                function useStore(store, selector) {
                    return useSyncExternalStore(
                        store.subscribe,
                        () => selector(store.getSnapshot()),
                        () => selector(store.getSnapshot()),
                    );
                }

                const Store = class {
                    constructor(state) {
                        this.state = state;
                        this.listeners = new Set();
                    }
                    subscribe = (listener) => {
                        this.listeners.add(listener);
                        return () => this.listeners.delete(listener);
                    };
                    getSnapshot = () => this.state;
                    use(selector) {
                        return useStore(this, selector);
                    }
                };

                const store = new Store({ value: 1 });
                export function StoreStatus() {
                    const value = useStore(store, (state) => state.value);
                    return <output>{value}</output>;
                }
            "#,
        },
        &CompilationOptions::default().with_feature(CompilerFeature::DependencySource),
    )
    .expect("an unused class hook forwarder should not retain an otherwise compiled hook");

    assert!(!output.contains("use(selector)"), "{output}");
    assert!(!output.contains("function useStore"), "{output}");
    assert!(
        output.contains("createCompiledExternalStore as __vidactCreateExternalStore"),
        "{output}"
    );
}

#[test]
fn dependency_source_normalizes_a_unique_hook_shaped_method_call() {
    let output = compile_surgical_module_with_options(
        ModuleInput {
            filename: "ReactStoreStatus.tsx",
            source: r#"
                import { useSyncExternalStore } from 'react';
                function useStore(store, selector) {
                    return useSyncExternalStore(
                        store.subscribe,
                        () => selector(store.getSnapshot()),
                        () => selector(store.getSnapshot()),
                    );
                }
                const ReactStore = class {
                    constructor(state) {
                        this.state = state;
                    }
                    subscribe = () => () => {};
                    getSnapshot = () => this.state;
                    useState(selector) {
                        return useStore(this, selector);
                    }
                };
                const store = new ReactStore({ value: 1 });
                export function StoreStatus() {
                    const value = store.useState((state) => state.value);
                    return <output>{value}</output>;
                }
            "#,
        },
        &CompilationOptions::default().with_feature(CompilerFeature::DependencySource),
    )
    .expect("a unique hook-shaped method should lower through the local hook ABI");

    assert!(!output.contains(".useState("), "{output}");
    assert!(!output.contains("useVidactClassMethod"), "{output}");
    assert!(
        output.contains("createCompiledExternalStore as __vidactCreateExternalStore"),
        "{output}"
    );
}

#[test]
fn dependency_source_keeps_a_referenced_class_hook_forwarder_diagnosed() {
    let diagnostics = compile_surgical_module_with_options(
        ModuleInput {
            filename: "StoreStatus.tsx",
            source: r#"
                import { useSyncExternalStore } from 'react';
                function useStore(store, selector) {
                    return useSyncExternalStore(
                        store.subscribe,
                        () => selector(store.getSnapshot()),
                        () => selector(store.getSnapshot()),
                    );
                }
                const Store = class {
                    use(selector) {
                        return useStore(this, selector);
                    }
                };
                const store = new Store();
                export function StoreStatus() {
                    const value = store.use((state) => state.value);
                    return <output>{value}</output>;
                }
            "#,
        },
        &CompilationOptions::default().with_feature(CompilerFeature::DependencySource),
    )
    .expect_err("a live class-instance hook call remains outside Vidact's hook ABI");

    assert!(diagnostics.iter().any(|diagnostic| {
        diagnostic.code == DiagnosticCode::UnsupportedSyntax
            && diagnostic
                .message
                .contains("custom hook useStore must be called directly")
    }));
}

#[test]
fn dependency_source_mode_keeps_guarded_use_id_on_the_runtime_facade() {
    let output = compile_surgical_module_with_options(
        ModuleInput {
            filename: "DependencyId.tsx",
            source: r#"
                import * as React from 'react';
                const maybeUseId = React.useId;
                function useCompatibleId() {
                    if (maybeUseId !== undefined) return maybeUseId();
                    return 'legacy-id';
                }
                export function DependencyId() {
                    return <label htmlFor={useCompatibleId()}>Name</label>;
                }
            "#,
        },
        &CompilationOptions::default().with_feature(CompilerFeature::DependencySource),
    )
    .expect("dependency source may retain an invariant guarded useId call");

    assert!(output.contains("useId"), "{output}");
    assert!(!output.contains("useCompatibleId("), "{output}");
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
fn dependency_source_constructs_precomputed_provider_children_under_the_provider() {
    let output = compile_surgical_module_with_options(
        ModuleInput {
            filename: "PrecomputedProviderChild.tsx",
            source: r#"
                import { createContext, useContext, useRef } from 'react';
                const RootContext = createContext(undefined);

                function useRenderElement(props) {
                    useRef(null);
                    return <span>{props.children}</span>;
                }

                function Part() {
                    const value = useContext(RootContext);
                    return <b>{value.label}</b>;
                }

                export function Root(props) {
                    const element = useRenderElement(props);
                    const contextValue = { label: 'ready' };
                    return <RootContext.Provider value={contextValue}>{element}</RootContext.Provider>;
                }

                export function App() {
                    return <Root><Part /></Root>;
                }
            "#,
        },
        &CompilationOptions::default().with_feature(CompilerFeature::DependencySource),
    )
    .expect("a statically paired provider value and precomputed child should compile");

    assert!(
        output.contains("runWithCompiledContext as __vidactRunWithContext"),
        "{output}"
    );
    assert!(
        output.contains("__vidactRunWithContext(RootContext, contextValue, () =>"),
        "{output}"
    );
    assert!(
        output.find("const contextValue").unwrap()
            < output
                .find("__vidactRunWithContext(RootContext, contextValue")
                .unwrap(),
        "{output}"
    );
}

#[test]
fn dependency_source_constructs_precomputed_jsx_inputs_under_the_provider() {
    let output = compile_surgical_module_with_options(
        ModuleInput {
            filename: "PrecomputedProviderInput.tsx",
            source: r#"
                import { createContext, useContext, useRef } from 'react';
                const RootContext = createContext(undefined);

                function useRenderElement(props, options) {
                    useRef(null);
                    return <div {...options.props[0]} />;
                }

                function Part() {
                    const value = useContext(RootContext);
                    return <b>{value.label}</b>;
                }

                export function Root({ children }) {
                    const contextValue = { label: 'ready' };
                    const defaultProps = { children: <>{children}<span>sentinel</span></> };
                    const element = useRenderElement({}, { props: [defaultProps] });
                    return <RootContext.Provider value={contextValue}>{element}</RootContext.Provider>;
                }

                export function App() {
                    return <Root><Part /></Root>;
                }
            "#,
        },
        &CompilationOptions::default().with_feature(CompilerFeature::DependencySource),
    )
    .expect("precomputed JSX inputs should compile under their provider context");

    assert!(
        output.contains("defaultProps = __vidactRunWithContext(RootContext, contextValue, () =>"),
        "{output}"
    );
    assert!(
        output.find("const contextValue").unwrap()
            < output
                .find("defaultProps = __vidactRunWithContext")
                .unwrap(),
        "{output}"
    );
}

#[test]
fn dependency_source_evaluates_provider_values_and_defaulted_props_once() {
    let output = compile_surgical_module_with_options(
        ModuleInput {
            filename: "ProviderEvaluation.tsx",
            source: r#"
                import { createContext, useRef } from 'react';
                const RootContext = createContext(undefined);

                function useRenderElement(props) {
                    useRef(null);
                    return <span>{props.children}</span>;
                }

                function createValue(label) {
                    return { label };
                }

                export function Root(props) {
                    const { label = 'ready' } = props;
                    const element = useRenderElement(props);
                    return <RootContext.Provider value={createValue(label)}>{element}</RootContext.Provider>;
                }
            "#,
        },
        &CompilationOptions::default().with_feature(CompilerFeature::DependencySource),
    )
    .expect("provider values and defaulted props should retain single-evaluation semantics");

    assert!(!output.contains("value={createValue(label)}"), "{output}");
    assert!(
        output.contains("value={__vidactBinding") && output.contains("() => __vidactProviderValue"),
        "{output}"
    );
    assert!(
        !output
            .contains("props.get()[\"label\"] === undefined ? \"ready\" : props.get()[\"label\"]"),
        "{output}"
    );
    assert!(output.contains("__vidactProviderValue"), "{output}");
    assert!(output.contains("__vidactDestructured"), "{output}");
}

#[test]
fn dependency_source_tracks_namespace_memo_provider_values() {
    let output = compile_surgical_module_with_options(
        ModuleInput {
            filename: "MemoProvider.tsx",
            source: r#"
                import * as React from 'react';
                import { SwitchContext } from './SwitchContext.mjs';

                function useRenderElement(componentProps, parameters) {
                    React.useRef(null);
                    const renderedState = React.useMemo(
                        () => parameters.state,
                        [parameters.state],
                    );
                    return <span data-checked={renderedState.checked || undefined} {...componentProps} />;
                }

                function useControlled() {
                    const [value, setValue] = React.useState(true);
                    return [value, setValue];
                }

                export const Root = React.forwardRef(function Root(componentProps, forwardedRef) {
                    const [checked, setChecked] = useControlled();
                    const state = React.useMemo(() => ({ checked }), [checked]);
                    const element = useRenderElement(componentProps, { state });
                    return (
                        <SwitchContext.Provider value={state}>
                            <button ref={forwardedRef} onClick={() => setChecked(!checked)} />
                            {element}
                        </SwitchContext.Provider>
                    );
                });
            "#,
        },
        &CompilationOptions::default().with_feature(CompilerFeature::DependencySource),
    )
    .expect("a namespace memo used as a provider value should compile reactively");

    assert!(
        output.contains("createCompiledMemo as __vidactCreateMemo"),
        "{output}"
    );
    assert!(
        output.contains("value={__vidactBinding") && output.contains("() => state.get()"),
        "{output}"
    );
}

#[test]
fn dependency_source_does_not_eagerly_contextualize_forwarded_children() {
    let output = compile_surgical_module_with_options(
        ModuleInput {
            filename: "ForwardedProviderChildren.tsx",
            source: r#"
                import * as React from 'react';
                const ListContext = React.createContext(undefined);

                export function CompositeList(props) {
                    const { children, register } = props;
                    const contextValue = React.useMemo(() => ({ register }), [register]);
                    return <ListContext.Provider value={contextValue}>{children}</ListContext.Provider>;
                }
            "#,
        },
        &CompilationOptions::default().with_feature(CompilerFeature::DependencySource),
    )
    .expect("forwarded children should remain deferred under their provider");

    assert!(
        !output.contains("__vidactRunWithContext(ListContext, contextValue"),
        "{output}"
    );
}

#[test]
fn gates_and_lowers_suspense_and_promise_use_as_staged_async_work() {
    let source = r#"
        import { Suspense, use } from 'react';
        const message = Promise.resolve('ready');
        function Message(): Node {
            const value = use(message);
            return <strong>{value}</strong>;
        }
        export function AsyncApp(): Node {
            return <Suspense fallback={<p>loading</p>}><Message /></Suspense>;
        }
    "#;
    let diagnostics = compile_surgical_module(ModuleInput {
        filename: "AsyncApp.tsx",
        source,
    })
    .expect_err("Suspense is disabled without the async feature");
    assert!(diagnostics.iter().any(|diagnostic| {
        diagnostic.code == DiagnosticCode::UnsupportedSyntax
            && diagnostic.message.contains("`async`")
            && diagnostic.span.is_some()
    }));

    let output = compile_async(ModuleInput {
        filename: "AsyncApp.tsx",
        source,
    })
    .expect("the async feature should stage Suspense children and lower promise reads");
    assert!(
        output.contains("from \"@vidact/runtime/async\""),
        "{output}"
    );
    assert!(
        output.contains("createCompiledAsync as __vidactCreateAsync"),
        "{output}"
    );
    assert!(
        output.contains("fallback={() => <p>loading</p>"),
        "{output}"
    );
    assert!(output.contains("{() => <><Message /></>}"), "{output}");
}

#[test]
fn lowers_reactive_component_props_inside_suspense_children() {
    let output = compile_async(ModuleInput {
        filename: "ReactiveSuspenseApp.tsx",
        source: r#"
            import { Suspense, useState } from 'react';
            function Results({ request, search, onAdd }): Node {
                return <section data-search={search}>{request.label}<button onClick={onAdd}>add</button></section>;
            }
            export function App({ initialRequest, onAdd }): Node {
                const [request, setRequest] = useState(initialRequest);
                const [search, setSearch] = useState('');
                return (
                    <Suspense fallback={<p>loading</p>}>
                        <Results request={request} search={search} onAdd={onAdd} />
                    </Suspense>
                );
            }
        "#,
    })
    .expect("compiler-generated Suspense render thunks should allow reactive child props");

    assert!(
        output.contains("request={__vidactBinding(__vidactScope, 4, () => request.get())}"),
        "{output}"
    );
    assert!(
        output.contains("search={__vidactBinding(__vidactScope, 8, () => search.get())}"),
        "{output}"
    );
    assert!(
        output.contains("onAdd={__vidactEvent(__vidactScope, __vidactBinding(__vidactScope, 2"),
        "{output}"
    );
}

#[test]
fn subscribes_reactive_promise_reads_inside_suspense_children() {
    let output = compile_async(ModuleInput {
        filename: "ReactivePromiseSuspenseApp.tsx",
        source: r#"
            import { Suspense, use, useState } from 'react';
            function Results({ productsPromise }): Node {
                const products = use(productsPromise);
                return <p>{products.length} products</p>;
            }
            export function App({ initialRequest }): Node {
                const [request, setRequest] = useState(initialRequest);
                return (
                    <Suspense fallback={<p>loading</p>}>
                        <Results productsPromise={request} />
                    </Suspense>
                );
            }
        "#,
    })
    .expect("reactive promises inside Suspense children should compile as async subscriptions");

    assert!(
        output.contains("createCompiledAsync as __vidactCreateAsync"),
        "{output}"
    );
    assert!(
        output.contains("() => productsPromise.get()"),
        "async reads must retain an evaluator for later prop updates: {output}"
    );
}

#[test]
fn gates_lazy_at_its_call_site() {
    let source = r#"
        import { lazy } from 'react';
        const Deferred = lazy(() => import('./Deferred'));
        export function App(): Node { return <Deferred />; }
    "#;
    let diagnostics = compile_surgical_module(ModuleInput {
        filename: "LazyApp.tsx",
        source,
    })
    .expect_err("lazy is disabled without the async feature");
    assert!(diagnostics.iter().any(|diagnostic| {
        diagnostic.code == DiagnosticCode::UnsupportedSyntax
            && diagnostic.message.contains("`async`")
            && diagnostic.span.is_some()
    }));
    compile_async(ModuleInput {
        filename: "LazyApp.tsx",
        source,
    })
    .expect("the async feature enables lazy module factories");
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
fn compiles_reactive_external_store_inputs_for_resubscription() {
    let output = compile_surgical_module(ModuleInput {
        filename: "ReactiveStoreStatus.tsx",
        source: r#"
            import { useSyncExternalStore } from 'react';
            export function ReactiveStoreStatus({ store }): Node {
                const snapshot = useSyncExternalStore(
                    store.subscribe,
                    store.getSnapshot,
                    store.getServerSnapshot,
                );
                return <output>{snapshot}</output>;
            }
        "#,
    })
    .expect("reactive external-store inputs should lower to one resubscription binding");

    assert!(
        output.contains("const snapshot = __vidactCreateExternalStore("),
        "{output}"
    );
    assert!(output.contains("__vidactBinding("), "{output}");
    assert!(output.contains("store.get().subscribe"), "{output}");
    assert!(output.contains("store.get().getSnapshot"), "{output}");
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
fn compiles_use_state_without_an_explicit_initializer() {
    let output = compile_surgical_module(ModuleInput {
        filename: "OptionalState.tsx",
        source: r#"
            import { useState } from 'react';
            export function OptionalState() {
                const [value, setValue] = useState();
                return <button onClick={() => setValue('ready')}>{value ?? 'empty'}</button>;
            }
        "#,
    })
    .expect("useState() should initialize the compiled slot with undefined");

    assert!(
        output.contains("__vidactCreateState(__vidactScope"),
        "{output}"
    );
    assert!(output.contains("undefined"), "{output}");
}

#[test]
fn normalizes_expression_bodied_custom_hook_arrows() {
    let output = compile_surgical_module(ModuleInput {
        filename: "ExpressionHook.tsx",
        source: r#"
            import { createContext, useContext } from 'react';
            const CountContext = createContext(0);
            const useCount = () => useContext(CountContext);
            export function ExpressionHook() {
                const count = useCount();
                return <output>{count}</output>;
            }
        "#,
    })
    .expect("expression-bodied custom hooks should normalize before hook expansion");

    assert!(
        output.contains("__vidactCreateContext(__vidactScope"),
        "{output}"
    );
    assert!(!output.contains("useCount"), "{output}");
}

#[test]
fn dependency_source_keeps_expanded_hook_object_destructuring_reactive() {
    let output = compile_surgical_module_with_options(
        ModuleInput {
            filename: "ExpandedHookDestructuring.tsx",
            source: r#"
                import { createContext, useContext, useState } from 'react';
                const OpenContext = createContext({ open: false });

                function useControlled({ controlled }) {
                    const [uncontrolled, setUncontrolled] = useState(false);
                    return controlled === undefined ? uncontrolled : controlled;
                }

                export function Trigger() {
                    const context = useContext(OpenContext);
                    const open = useControlled({ controlled: context.open });
                    return <button aria-expanded={open} />;
                }
            "#,
        },
        &CompilationOptions::default().with_feature(CompilerFeature::DependencySource),
    )
    .expect("expanded custom-hook object fields should remain reactive");

    assert!(output.contains("aria-expanded"), "{output}");
    assert!(
        output.matches("controlled = __vidactHook").count() >= 2,
        "controlled field should have an initial assignment and a reactive updater:\n{output}"
    );
}

#[test]
fn expands_unconditional_custom_hook_at_optional_chain_base() {
    let output = compile_surgical_module_with_options(
        ModuleInput {
            filename: "OptionalChainHook.tsx",
            source: r#"
                import { createContext, useContext } from 'react';
                const PortalContext = createContext(null);
                const usePortalContext = () => useContext(PortalContext);
                function usePortalNode() {
                    const parentNode = usePortalContext()?.context.portalNode;
                    const active = usePortalContext()?.active ?? false;
                    return { active, parentNode };
                }
                export function Portal() {
                    const portal = usePortalNode();
                    return <output data-active={portal.active}>{portal.parentNode?.id}</output>;
                }
            "#,
        },
        &CompilationOptions::default().with_feature(CompilerFeature::DependencySource),
    )
    .expect("a hook at an optional-chain base is still called unconditionally");

    assert!(!output.contains("usePortalContext"), "{output}");
    assert!(!output.contains("usePortalNode"), "{output}");
}

#[test]
fn selects_react_19_hook_implementation_aliases() {
    let output = compile_surgical_module_with_options(
        ModuleInput {
            filename: "ReactVersionHook.tsx",
            source: r#"
                import * as React from 'react';
                const majorVersion = parseInt(React.version, 10);
                function isReactVersionAtLeast(version) {
                    return majorVersion >= version;
                }
                const useImplementation = isReactVersionAtLeast(19) ? useModern : useLegacy;
                function useModern(initial) {
                    const [value, setValue] = React.useState(initial);
                    return [value, setValue];
                }
                function useLegacy(initial) {
                    const [value, setValue] = React.useReducer((state) => state, initial);
                    return [value, setValue];
                }
                function useValue(initial) {
                    return useImplementation(initial);
                }
                export function VersionedHook() {
                    const [value, setValue] = useValue('ready');
                    return <button onClick={() => setValue('updated')}>{value}</button>;
                }
            "#,
        },
        &CompilationOptions::default().with_feature(CompilerFeature::DependencySource),
    )
    .expect("the React 19 compile target should select its immutable hook implementation");

    assert!(output.contains("__vidactCreateState"), "{output}");
    assert!(!output.contains("__vidactCreateReducer"), "{output}");
    assert!(!output.contains("useImplementation"), "{output}");
}

#[test]
fn dependency_source_uses_vidact_memo_semantics_without_upstream_preservation_bailouts() {
    let output = compile_surgical_module_with_options(
        ModuleInput {
            filename: "PublishedMemo.tsx",
            source: r#"
                import * as React from 'react';
                function useCollapsible() {
                    const [mounted, setMounted] = React.useState(false);
                    return { mounted, setMounted };
                }
                export function PublishedMemo({ rootState, open }) {
                    const collapsible = useCollapsible();
                    const state = React.useMemo(() => ({
                        ...rootState,
                        hidden: !open && !collapsible.mounted,
                    }), [collapsible.mounted, open, rootState]);
                    const context = React.useMemo(() => ({
                        ...collapsible,
                        state,
                    }), [collapsible, state]);
                    return <output>{context.state.hidden ? 'hidden' : 'visible'}</output>;
                }
            "#,
        },
        &CompilationOptions::default().with_feature(CompilerFeature::DependencySource),
    )
    .expect("Vidact owns dependency-source memo identity after analysis");

    assert!(output.contains("__vidactCreateMemo"), "{output}");
}

#[test]
fn lowers_conditional_render_phase_state_synchronization_into_an_owner_updater() {
    let output = compile_surgical_module(ModuleInput {
        filename: "RenderPhaseStateSync.tsx",
        source: r#"
            import { useState } from 'react';

            export function RenderPhaseStateSync({ open }): Node {
                const [status, setStatus] = useState('closed');
                const [mounted, setMounted] = useState(open);
                if (open && !mounted) {
                    setMounted(true);
                    setStatus('opening');
                }
                if (!open && mounted && status !== 'closing') {
                    setStatus('closing');
                }
                return <output data-mounted={mounted}>{status}</output>;
            }
        "#,
    })
    .expect("top-level conditional state synchronization should rerun from reactive sources");

    assert!(output.contains("__vidactScope[0]("), "{output}");
    assert!(output.matches("mounted.set(true)").count() >= 2, "{output}");
    assert!(
        output.matches("status.set(\"opening\")").count() >= 2,
        "{output}"
    );
}

#[test]
fn dependency_source_normalizes_simple_logical_assignments() {
    let output = compile_surgical_module_with_options(
        ModuleInput {
            filename: "PublishedLogicalAssignment.tsx",
            source: r#"
                export function PublishedLogicalAssignment({ authored }) {
                    let value = authored;
                    value ||= 'fallback';
                    return <output>{value}</output>;
                }
            "#,
        },
        &CompilationOptions::default().with_feature(CompilerFeature::DependencySource),
    )
    .expect("simple logical assignment should normalize before upstream analysis");

    assert!(!output.contains("||="), "{output}");
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
fn coalesces_props_before_reactive_jsx_spreads_in_source_order() {
    let output = compile_surgical_module(ModuleInput {
        filename: "OrderedSpread.tsx",
        source: r#"
            export function OrderedSpread({ props, className }) {
                return (
                    <button
                        data-slot="trigger"
                        className={className}
                        {...props}
                    >
                        Open
                    </button>
                );
            }
        "#,
    })
    .expect("leading JSX props should coalesce with a later reactive spread");

    assert!(
        output.contains("compiledSpread as __vidactSpread"),
        "{output}"
    );
    assert!(output.contains("\"data-slot\": \"trigger\""), "{output}");
    assert!(output.contains("...props"), "{output}");
}

#[test]
fn coalesces_multiple_reactive_jsx_spreads_in_source_order() {
    let output = compile_surgical_module(ModuleInput {
        filename: "MultipleOrderedSpreads.tsx",
        source: r#"
            export function MultipleOrderedSpreads({ props, ref, role, restProps }) {
                return (
                    <span
                        {...props}
                        ref={ref}
                        role={role}
                        {...restProps}
                        data-slot="focus-guard"
                    />
                );
            }
        "#,
    })
    .expect("ordered reactive spreads should merge into one owned spread descriptor");

    assert_eq!(output.matches("__vidactSpread(").count(), 1, "{output}");
    assert!(output.contains("...props"), "{output}");
    assert!(output.contains("...restProps"), "{output}");
    assert!(output.contains("data-slot=\"focus-guard\""), "{output}");
}

#[test]
fn rejects_non_reactive_allocations_before_reactive_jsx_spreads() {
    let error = compile_surgical_module(ModuleInput {
        filename: "OrderedSpreadIdentity.tsx",
        source: r#"
            export function OrderedSpreadIdentity({ props }) {
                return <button onClick={() => undefined} {...props}>Open</button>;
            }
        "#,
    })
    .expect_err("a leading handler must not be reallocated when only the spread changes");

    let message = format!("{error:?}");
    assert!(
        message.contains(
            "a non-reactive expression before a reactive JSX spread would be re-evaluated during updates"
        ),
        "{message}"
    );
}

#[test]
fn compiles_element_valued_props_into_opaque_renderable_capabilities() {
    let output = compile_surgical_module(ModuleInput {
        filename: "Renderable.tsx",
        source: r#"
            import * as React from 'react';
            import { useState } from 'react';
            function Slot({ render, disabled }) {
                const merged = {
                    ...render.props,
                    'data-disabled': disabled,
                    children: disabled ? 'Disabled' : render.props.children,
                };
                return React.cloneElement(render, merged);
            }
            export function App() {
                const [disabled, setDisabled] = useState(false);
                const [href, setHref] = useState('/first');
                return <Slot disabled={disabled} render={<a href={href}>Open</a>} />;
            }
        "#,
    })
    .expect("element-valued render props should compile as capabilities");

    assert!(
        output.contains("createRenderable as __vidactCreateRenderable"),
        "{output}"
    );
    assert!(
        output.contains("cloneRenderableComponent as __vidactCloneRenderableComponent"),
        "{output}"
    );
    assert!(
        output.contains("renderableProps as __vidactRenderableProps"),
        "{output}"
    );
    assert!(!output.contains("React.cloneElement"), "{output}");
    assert!(!output.contains("$$typeof"), "{output}");
}

#[test]
fn lowers_clone_element_child_replacement_into_the_renderable_capability() {
    let output = compile_surgical_module(ModuleInput {
        filename: "RenderableChildren.tsx",
        source: r#"
            import * as React from 'react';
            import { useState } from 'react';
            function Slot({ render, label }) {
                return React.cloneElement(
                    render,
                    { 'data-label': label },
                    <span data-cloned-label>{label}</span>,
                );
            }
            export function App() {
                const [label, setLabel] = useState('Open');
                return <Slot label={label} render={<a href="/docs">Authored</a>} />;
            }
        "#,
    })
    .expect("a single explicit child replacement should stay within the renderable capability");

    assert!(
        output.contains("cloneRenderableComponent as __vidactCloneRenderableComponent"),
        "{output}"
    );
    assert!(output.contains("data-cloned-label"), "{output}");
    assert!(!output.contains("React.cloneElement"), "{output}");
}

#[test]
fn lowers_base_ui_renderable_validation_and_lazy_sentinel_workaround() {
    let output = compile_surgical_module(ModuleInput {
        filename: "BaseUiRenderable.tsx",
        source: r#"
            import * as React from 'react';
            const REACT_LAZY_TYPE = Symbol.for('react.lazy');
            function Slot({ render, disabled }) {
                const merged = { ...render.props, 'data-disabled': disabled };
                let newElement = render;
                if (newElement?.$$typeof === REACT_LAZY_TYPE) {
                    const children = React.Children.toArray(render);
                    newElement = children[0];
                }
                if (!React.isValidElement(newElement)) {
                    throw new Error('invalid render');
                }
                return React.cloneElement(newElement, merged);
            }
            export function App() {
                return <Slot disabled={false} render={<button>Open</button>} />;
            }
        "#,
    })
    .expect("Base UI render validation should lower to the bounded capability ABI");

    assert!(
        output.contains("isRenderable as __vidactIsRenderable"),
        "{output}"
    );
    assert!(!output.contains("renderableMarker"), "{output}");
    assert!(!output.contains("renderableToArray"), "{output}");
    assert!(!output.contains("React.Children"), "{output}");
    assert!(!output.contains("React.isValidElement"), "{output}");
    assert!(!output.contains("React.cloneElement"), "{output}");
    assert!(!output.contains("$$typeof"), "{output}");
}

#[test]
fn lowers_single_renderable_children_to_array_without_tree_traversal() {
    let output = compile_surgical_module(ModuleInput {
        filename: "RenderableToArray.tsx",
        source: r#"
            import * as React from 'react';
            function Slot({ render }) {
                const element = React.Children.toArray(render)[0];
                return React.cloneElement(element, { title: 'merged' });
            }
            export function App() {
                return <Slot render={<button>Open</button>} />;
            }
        "#,
    })
    .expect("one renderable Children.toArray call should use the bounded capability helper");

    assert!(
        output.contains("renderableToArray as __vidactRenderableToArray"),
        "{output}"
    );
    assert!(!output.contains("React.Children"), "{output}");
    assert!(!output.contains("React.cloneElement"), "{output}");
}

#[test]
fn preserves_callback_and_element_render_paths_without_component_replay() {
    let output = compile_surgical_module(ModuleInput {
        filename: "RenderPaths.tsx",
        source: r#"
            import * as React from 'react';
            function Slot({ render, label }) {
                const props = { title: label, children: label };
                if (typeof render === 'function') {
                    return render(props, { label });
                }
                return React.cloneElement(render, { ...render.props, ...props });
            }
            export function App() {
                return <main>
                    <Slot label="callback" render={(props) => <button {...props} />} />
                    <Slot label="element" render={<a href="/docs">authored</a>} />
                </main>;
            }
        "#,
    })
    .expect("callback and element render paths should compile under one component owner");

    assert!(output.contains("render.get()(props"), "{output}");
    assert!(
        output.contains("createRenderable as __vidactCreateRenderable"),
        "{output}"
    );
    assert!(
        output.contains("cloneRenderableComponent as __vidactCloneRenderableComponent"),
        "{output}"
    );
    assert!(!output.contains("React.cloneElement"), "{output}");
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
fn defers_component_element_children_until_the_child_namespace_is_active() {
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

    assert!(
        output.contains("createRenderable as __vidactCreateRenderable"),
        "{output}"
    );
    assert!(output.contains("__vidactCreateRenderable({},"), "{output}");
    assert!(
        !output.contains("<div __vidactNamespace=\"svg\""),
        "{output}"
    );
}

#[test]
fn forwards_scalar_component_child_bindings_without_structural_slots() {
    let output = compile_surgical_module(ModuleInput {
        filename: "ScalarComponentChild.tsx",
        source: r#"
            function Frame({ children }) {
                return <section>{children}</section>;
            }
            export function ScalarComponentChild({ label }) {
                return <Frame>{label.toUpperCase()}</Frame>;
            }
        "#,
    })
    .expect("scalar component children should remain text bindings across wrappers");

    assert!(output.contains("<Frame>{__vidactBinding("), "{output}");
    assert!(
        !output.contains("__vidactDeferred(() => __vidactBinding("),
        "{output}"
    );
}

#[test]
fn forwards_received_children_as_live_render_value_bindings() {
    let output = compile_surgical_module(ModuleInput {
        filename: "ForwardedChildren.tsx",
        source: r#"
            function Frame({ children }) {
                return <Layout>{children}</Layout>;
            }
            export function ForwardedChildren({ label }) {
                return <Frame><strong>{label}</strong></Frame>;
            }
        "#,
    })
    .expect("received component children may carry deferred structural render values");

    assert!(output.contains("<Layout>{__vidactBinding("), "{output}");
    assert!(output.contains("() => children.get()"), "{output}");
    assert!(
        !output.contains("__vidactDeferred(() => __vidactBinding("),
        "{output}"
    );
}

#[test]
fn dependency_diagnostics_map_through_custom_hook_canonicalization() {
    let source = r#"
        import React, { useState } from 'react';
        function usePublishedState() {
            const [value] = useState('published');
            return value;
        }
        export function PublishedFunction() {
            const value = usePublishedState();
            return <p>{value}</p>;
        }
        export class UnsupportedPublishedClass extends React.Component {
            render() { return <p>unsupported</p>; }
        }
    "#;
    let diagnostics = compile_surgical_module_with_options(
        ModuleInput {
            filename: "PublishedDependency.tsx",
            source,
        },
        &CompilationOptions::default().with_feature(CompilerFeature::DependencySource),
    )
    .expect_err("published class components must fail dependency compilation");
    let span = diagnostics[0]
        .span
        .expect("dependency diagnostic should have a span");

    assert_eq!(
        &source[span.start as usize..span.end as usize],
        "React.Component"
    );
}
