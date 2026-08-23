use vidact_compiler::{
    CompilationOptions, CompilerFeature, CompilerTarget, DiagnosticCode, analysis::ModuleInput,
    compile_server_module, compile_server_module_with_options,
};

#[test]
fn emits_react_compiler_ssr_output_without_client_hook_replay() {
    let compilation = compile_server_module(ModuleInput {
        filename: "ServerGreeting.tsx",
        source: r#"
            import { useEffect, useMemo, useState } from 'react';

            export function ServerGreeting({ name }): JSX.Element {
                const [count] = useState(() => 2);
                const greeting = useMemo(() => `${name}:${count}`, [name, count]);
                useEffect(() => console.log(greeting), [greeting]);
                return <p title={greeting}>{greeting}</p>;
            }
        "#,
    })
    .expect("supported client components should have deterministic SSR codegen");

    assert!(compilation.code.contains("<p title={greeting}>"));
    assert!(compilation.code.contains("useState(_temp)"));
    assert!(!compilation.code.contains("useEffect("));
    assert!(!compilation.code.contains("useMemo("));
    assert!(compilation.source_map.contains("ServerGreeting.tsx"));
    assert_eq!(compilation.components.len(), 1);
}

#[test]
fn unsafe_html_requires_the_server_feature_at_the_attribute() {
    let input = ModuleInput {
        filename: "Raw.tsx",
        source: "export function Raw() { return <main dangerouslySetInnerHTML={{ __html: '<b>x</b>' }} />; }",
    };
    let diagnostics = compile_server_module(input).expect_err("raw HTML is opt-in on the server");
    assert_eq!(diagnostics[0].code, DiagnosticCode::UnsupportedSyntax);
    assert!(diagnostics[0].message.contains("unsafe-html"));
    assert!(diagnostics[0].span.is_some());

    compile_server_module_with_options(
        input,
        &CompilationOptions::new(CompilerTarget::Server).with_feature(CompilerFeature::UnsafeHtml),
    )
    .expect("the explicit server feature permits raw HTML");
}

#[test]
fn stages_async_server_boundaries_only_when_enabled() {
    let input = ModuleInput {
        filename: "ServerAsync.tsx",
        source: r#"
            import { Suspense, use } from 'react';
            const value = Promise.resolve('ready');
            function Message() {
                return <strong>{use(value)}</strong>;
            }
            export function ServerAsync() {
                return <Suspense fallback={<p>loading</p>}><Message /></Suspense>;
            }
        "#,
    };
    let diagnostics =
        compile_server_module(input).expect_err("server Suspense must remain feature-gated");
    assert!(diagnostics.iter().any(|diagnostic| {
        diagnostic.code == DiagnosticCode::UnsupportedSyntax
            && diagnostic.message.contains("`async`")
            && diagnostic.span.is_some()
    }));

    let compilation = compile_server_module_with_options(
        input,
        &CompilationOptions::new(CompilerTarget::Server).with_feature(CompilerFeature::Async),
    )
    .expect("the async server target should preserve staged boundary factories");
    assert!(
        compilation
            .code
            .contains("<Suspense fallback={_temp}>{_temp2}</Suspense>"),
        "{}",
        compilation.code
    );
    assert!(
        compilation.code.contains("function _temp2()")
            && compilation.code.contains("return <><Message /></>;")
            && compilation.code.contains("function _temp()")
            && compilation.code.contains("return <p>loading</p>;"),
        "{}",
        compilation.code
    );
}

#[test]
fn stages_server_activity_only_when_retained_ui_is_enabled() {
    let input = ModuleInput {
        filename: "ServerActivity.tsx",
        source: r#"
            import { Activity } from 'react';
            export function ServerActivity() {
                return <Activity mode="hidden"><p>retained</p></Activity>;
            }
        "#,
    };
    let diagnostics =
        compile_server_module(input).expect_err("server Activity must remain feature-gated");
    assert!(diagnostics.iter().any(|diagnostic| {
        diagnostic.code == DiagnosticCode::UnsupportedSyntax
            && diagnostic.message.contains("`retained-ui`")
            && diagnostic.span.is_some()
    }));

    let compilation = compile_server_module_with_options(
        input,
        &CompilationOptions::new(CompilerTarget::Server).with_feature(CompilerFeature::RetainedUi),
    )
    .expect("the retained-ui server target should preserve a staged child factory");
    assert!(compilation.code.contains("<Activity mode=\"hidden\">"));
    assert!(
        compilation.code.contains("function _temp()")
            && compilation.code.contains("return <><p>retained</p></>;"),
        "{}",
        compilation.code
    );
}

#[test]
fn gates_concurrent_server_hooks_at_their_calls() {
    let input = ModuleInput {
        filename: "ServerConcurrent.tsx",
        source: r#"
            import { useDeferredValue, useTransition } from 'react';
            export function ServerConcurrent({ value }) {
                const [isPending] = useTransition();
                const deferred = useDeferredValue(value);
                return <p>{isPending ? 'pending' : deferred}</p>;
            }
        "#,
    };
    let diagnostics =
        compile_server_module(input).expect_err("server concurrent hooks must remain gated");
    assert!(diagnostics.iter().any(|diagnostic| {
        diagnostic.code == DiagnosticCode::UnsupportedSyntax
            && diagnostic.message.contains("`concurrent`")
            && diagnostic.span.is_some()
    }));

    compile_server_module_with_options(
        input,
        &CompilationOptions::new(CompilerTarget::Server).with_feature(CompilerFeature::Concurrent),
    )
    .expect("the concurrent server target should preserve deterministic hook values");
}

#[test]
fn gates_actions_server_hooks_and_function_form_actions() {
    let input = ModuleInput {
        filename: "ServerActions.tsx",
        source: r#"
            import { useActionState, useOptimistic } from 'react';
            import { useFormStatus } from 'react-dom';
            function Status() {
                const status = useFormStatus();
                return <span>{status.pending ? 'saving' : 'ready'}</span>;
            }
            export function ServerActions() {
                const [value, submit, pending] = useActionState(async () => 'next', 'initial', '/save');
                const [optimistic] = useOptimistic(value);
                return <form action={submit}><button>{pending ? optimistic : value}</button><Status /></form>;
            }
        "#,
    };
    let diagnostics =
        compile_server_module(input).expect_err("server Actions APIs must remain gated");
    assert!(diagnostics.iter().any(|diagnostic| {
        diagnostic.code == DiagnosticCode::UnsupportedSyntax
            && diagnostic.message.contains("`actions`")
            && diagnostic.span.is_some()
    }));

    let compilation = compile_server_module_with_options(
        input,
        &CompilationOptions::new(CompilerTarget::Server).with_feature(CompilerFeature::Actions),
    )
    .expect("the Actions server target should preserve deterministic hook and form output");
    assert!(
        compilation.code.contains("useActionState("),
        "{}",
        compilation.code
    );
    assert!(
        compilation.code.contains("action={submit}"),
        "{}",
        compilation.code
    );

    let diagnostics = compile_server_module_with_options(
        ModuleInput {
            filename: "InvalidServerAction.tsx",
            source: "export function Invalid() { return <form action />; }",
        },
        &CompilationOptions::new(CompilerTarget::Server).with_feature(CompilerFeature::Actions),
    )
    .expect_err("invalid server Action props must fail at their attributes");
    assert!(
        diagnostics[0].message.contains("must have a value"),
        "{diagnostics:?}"
    );
    assert!(diagnostics[0].span.is_some());
}
