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
