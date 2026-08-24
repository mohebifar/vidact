use vidact_compiler::{
    CompilationOptions, CompilerFeature, DiagnosticCode, OxcReactAnalysisAdapter,
    analysis::{ModuleInput, ReactAnalysisAdapter},
    compile_server_module, compile_surgical_module, compile_surgical_module_with_options,
};

#[test]
fn compiles_minified_automatic_runtime_output_by_import_identity() {
    let source = r#"import{jsx as a}from"react/jsx-runtime";import{useState as b}from"react";export function C(){let[c,d]=b(0);return a("button",{id:"count",onClick:()=>d(c+1),children:c})}"#;

    let output = compile_surgical_module(ModuleInput {
        filename: "dependency.mjs",
        source,
    })
    .expect("aliased automatic-runtime output should compile");

    assert!(output.contains("<button"), "{output}");
    assert!(output.contains("__vidactCreateState("), "{output}");
    assert!(!output.contains("react/jsx-runtime"), "{output}");
    assert!(!output.contains("a(\"button\""), "{output}");
}

#[test]
fn normalizes_jsxs_fragments_and_nested_factory_calls() {
    let source = r#"
        import { Fragment as F, jsx as h, jsxs as m } from "react/jsx-runtime";
        export function Card({ title }) {
            return m(F, { children: [
                h("h2", { children: title }),
                h("p", { "data-state": "ready", children: "Body" })
            ] });
        }
    "#;

    let output = compile_surgical_module(ModuleInput {
        filename: "card.js",
        source,
    })
    .expect("jsxs and Fragment should normalize recursively");

    assert!(output.contains("<h2"), "{output}");
    assert!(output.contains("<p"), "{output}");
    assert!(output.contains("data-state"), "{output}");
    assert!(!output.contains("react/jsx-runtime"), "{output}");
}

#[test]
fn normalizes_jsx_dev_runtime_output() {
    let source = r#"
        import { jsxDEV as d } from "react/jsx-dev-runtime";
        export function Badge() {
            return d("span", { className: "badge", children: "New" }, undefined, false, {}, this);
        }
    "#;

    let output = compile_surgical_module(ModuleInput {
        filename: "badge.js",
        source,
    })
    .expect("jsxDEV output should compile");

    assert!(output.contains("<span"), "{output}");
    assert!(!output.contains("react/jsx-dev-runtime"), "{output}");
}

#[test]
fn normalizes_automatic_runtime_namespace_members() {
    let output = compile_surgical_module(ModuleInput {
        filename: "namespace-runtime.mjs",
        source: r#"import*as J from"react/jsx-runtime";export function App(){return J.jsx("main",{children:"namespace"})}"#,
    })
    .expect("automatic-runtime namespace members should compile");

    assert!(output.contains("<main>"), "{output}");
    assert!(!output.contains("react/jsx-runtime"), "{output}");
}

#[test]
fn normalizes_forward_ref_and_plain_memo_component_wrappers() {
    let output = compile_surgical_module(ModuleInput {
        filename: "wrapped.js",
        source: r#"
            import React from "react";
            import { jsx as h } from "react/jsx-runtime";
            export const Button = React.memo(React.forwardRef(function Button(props, ref) {
                return h("button", { ...props, ref, children: props.children });
            }));
        "#,
    })
    .expect("forwardRef and memo wrappers should expose their component body");

    assert!(
        output.contains("export const Button = function Button"),
        "{output}"
    );
    assert!(!output.contains("forwardRef"), "{output}");
    assert!(!output.contains("React.memo"), "{output}");
    assert!(
        output.contains("forwardedRef as __vidactForwardedRef"),
        "{output}"
    );
    assert!(!output.contains("props, ref"), "{output}");
}

#[test]
fn normalizes_cloned_react_namespaces_before_hook_analysis() {
    let output = compile_surgical_module(ModuleInput {
        filename: "safe-react.tsx",
        source: r#"
            import * as React from 'react';
            const SafeReact = { ...React };
            function useStable() {
                return SafeReact.useRef(null);
            }
            export function App() {
                const stable = useStable();
                return <p ref={stable}>stable</p>;
            }
        "#,
    })
    .expect("a pure React namespace clone should retain import provenance");

    assert!(!output.contains("SafeReact"), "{output}");
    assert!(!output.contains("...React"), "{output}");
    assert!(output.contains("React.useRef(null)"), "{output}");
}

#[test]
fn normalizes_react_hook_compatibility_aliases_before_hook_analysis() {
    let output = compile_surgical_module_with_options(
        ModuleInput {
            filename: "safe-insertion-effect.tsx",
            source: r#"
            import * as React from 'react';
            const SafeReact = { ...React };
            const useInsertionEffect = SafeReact.useInsertionEffect;
            const useSafeInsertionEffect = useInsertionEffect &&
                useInsertionEffect !== SafeReact.useLayoutEffect
                ? useInsertionEffect
                : callback => callback();
            function useStable(callback) {
                useSafeInsertionEffect(callback);
            }
            export function App() {
                useStable(() => undefined);
                return <p>stable</p>;
            }
            "#,
        },
        &CompilationOptions::default().with_feature(CompilerFeature::CssInsertion),
    )
    .expect("a React hook alias with an inline compatibility fallback should canonicalize");

    assert!(!output.contains("SafeReact"), "{output}");
    assert!(!output.contains("useSafeInsertionEffect"), "{output}");
    assert!(!output.contains("const useInsertionEffect"), "{output}");
}

#[test]
fn normalizes_classic_create_element_named_namespace_and_default_imports() {
    for (filename, source) in [
        (
            "named.js",
            r#"import{createElement as h}from"react";export function Named(){return h("main",null,"named")}"#,
        ),
        (
            "namespace.js",
            r#"import*as R from"react";export function Namespace(){return R.createElement("main",null,"namespace")}"#,
        ),
        (
            "default.js",
            r#"import R from"react";export function Default(){return R.createElement("main",null,"default")}"#,
        ),
    ] {
        let output = compile_surgical_module(ModuleInput { filename, source })
            .unwrap_or_else(|diagnostics| panic!("{filename} should compile: {diagnostics:?}"));
        assert!(output.contains("<main"), "{output}");
        assert!(!output.contains("createElement(\"main\""), "{output}");
    }
}

#[test]
fn lowers_dynamic_string_create_element_to_the_direct_intrinsic_path() {
    let output = compile_surgical_module(ModuleInput {
        filename: "dynamic-intrinsic.mjs",
        source: r#"
            import React from 'react';
            export function DynamicIntrinsic({ Tag, props }) {
                return React.createElement(Tag, props);
            }
        "#,
    })
    .expect("dynamic string tags should lower to the guarded direct intrinsic component");

    assert!(
        output.contains("dynamicIntrinsicComponent as __vidactDynamicIntrinsicComponent"),
        "{output}"
    );
    assert!(!output.contains("React.createElement"), "{output}");
}

#[test]
fn coalesces_classic_factory_props_before_a_reactive_spread() {
    let output = compile_surgical_module(ModuleInput {
        filename: "factory-spread.tsx",
        source: r#"
            import React from 'react';
            export function FactorySpread({ props }) {
                return React.createElement('button', {
                    type: 'button',
                    ...props,
                    key: props.key,
                });
            }
        "#,
    })
    .expect("classic factory property order should lower through one merged spread");

    assert!(output.contains("<button"), "{output}");
    assert!(output.contains("type: \"button\""), "{output}");
    assert!(!output.contains("React.createElement"), "{output}");
}

#[test]
fn preserves_spreads_refs_keys_and_component_tags() {
    let source = r#"
        import { jsx as h } from "react/jsx-runtime";
        import { Button } from "./button.js";
        export function App({ props, buttonRef }) {
            return h(Button, { ...props, ref: buttonRef, children: "Open" }, "trigger");
        }
    "#;

    let output = compile_surgical_module(ModuleInput {
        filename: "app.js",
        source,
    })
    .expect("component tags, spreads, refs, and keys should normalize");

    assert!(output.contains("__vidactComponentSpread"), "{output}");
    assert!(output.contains("buttonRef"), "{output}");
    assert!(output.contains("trigger"), "{output}");
}

#[test]
fn analyze_only_and_server_paths_share_lowered_react_normalization() {
    let input = ModuleInput {
        filename: "shared.mjs",
        source: r#"import{jsx as h}from"react/jsx-runtime";export function Shared({name}){return h("p",{children:name})}"#,
    };

    let facts = OxcReactAnalysisAdapter
        .analyze(input)
        .expect("analysis path should normalize lowered React");
    assert_eq!(facts.len(), 1);

    let server = compile_server_module(input).expect("server path should normalize lowered React");
    assert!(server.code.contains("<p>"), "{}", server.code);
    assert!(
        !server.code.contains("react/jsx-runtime"),
        "{}",
        server.code
    );
}

#[test]
fn fails_closed_for_lookalikes_shadowing_and_lost_provenance() {
    for (filename, source) in [
        (
            "lookalike.js",
            r#"function jsx(type,props){return{type,props}}export function App(){return jsx("main",{children:"no"})}"#,
        ),
        (
            "shadowed.js",
            r#"import{jsx as h}from"react/jsx-runtime";export function App(){const h=(type,props)=>({type,props});return h("main",{children:"no"})}"#,
        ),
        (
            "lost-provenance.js",
            r#"import{jsx}from"react/jsx-runtime";const h=jsx;export function App(){return h("main",{children:"no"})}"#,
        ),
        (
            "computed.js",
            r#"import*as J from"react/jsx-runtime";export function App(){return J["jsx"]("main",{children:"no"})}"#,
        ),
    ] {
        let diagnostics = compile_surgical_module(ModuleInput { filename, source })
            .expect_err("unproven factory calls must not be normalized");
        assert!(
            diagnostics.iter().any(|diagnostic| matches!(
                diagnostic.code,
                DiagnosticCode::AnalysisFailed | DiagnosticCode::UnsupportedSyntax
            )),
            "{filename}: {diagnostics:?}"
        );
    }
}
