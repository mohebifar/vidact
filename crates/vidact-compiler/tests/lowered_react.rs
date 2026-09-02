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
fn exposes_the_same_react_version_as_the_vite_compatibility_facade() {
    let output = compile_surgical_module_with_options(
        ModuleInput {
            filename: "react-version.jsx",
            source: r#"
                import * as React from "react";
                export function Version() {
                    return <output>{React.version}</output>;
                }
            "#,
        },
        &CompilationOptions::default().with_feature(CompilerFeature::DependencySource),
    )
    .expect("React.version should lower to the compatibility target");

    assert!(output.contains("19.2.0"), "{output}");
    assert!(!output.contains("React.version"), "{output}");
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
fn lowers_factory_fragments_with_keys_to_owned_fragment_components() {
    let output = compile_surgical_module_with_options(
        ModuleInput {
            filename: "published-keyed-fragment.mjs",
            source: r#"
                import * as React from "react";
                import { jsx } from "react/jsx-runtime";
                export function Label({ value, keyValue }) {
                    return jsx(React.Fragment, {
                        children: value,
                    }, keyValue);
                }
            "#,
        },
        &CompilationOptions::default().with_feature(CompilerFeature::DependencySource),
    )
    .expect("factory fragments with keys should lower into Vidact-owned keyed fragments");

    assert!(
        output.contains("keyedFragmentComponent as __vidactKeyedFragmentComponent"),
        "{output}"
    );
    assert!(!output.contains("React.Fragment"), "{output}");
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
fn binds_forward_ref_component_analysis_to_the_exported_variable_name() {
    let output = compile_surgical_module(ModuleInput {
        filename: "renamed-forward-ref.mjs",
        source: r#"
            import React from "react";
            import { jsx as h } from "react/jsx-runtime";
            export const Separator = React.forwardRef(function SeparatorComponent(props, ref) {
                return h("div", { ...props, ref });
            });
        "#,
    })
    .expect("the exported binding should identify a differently named forwardRef function");

    assert!(
        output.contains("export const Separator = function SeparatorComponent"),
        "{output}"
    );
    assert!(!output.contains("forwardRef"), "{output}");
}

#[test]
fn normalizes_expression_bodied_forward_ref_arrows_from_published_output() {
    let output = compile_surgical_module_with_options(
        ModuleInput {
            filename: "published-icon.mjs",
            source: r#"
                import * as React from "react";
                function IconBase(props) {
                    return React.createElement("svg", { ...props });
                }
                export const CaretRightIcon = React.forwardRef((props, ref) =>
                    React.createElement(IconBase, { ref, ...props })
                );
            "#,
        },
        &CompilationOptions::default().with_feature(CompilerFeature::DependencySource),
    )
    .expect("published expression-bodied forwardRef arrows should become component bodies");

    assert!(
        output.contains("export const CaretRightIcon = (__vidactProps) =>"),
        "{output}"
    );
    assert!(!output.contains("forwardRef"), "{output}");
    assert!(
        output.contains("forwardedRef as __vidactForwardedRef"),
        "{output}"
    );
}

#[test]
fn unwraps_transpiler_named_forward_ref_functions() {
    let output = compile_surgical_module(ModuleInput {
        filename: "transpiled-forward-ref.mjs",
        source: r#"
            import * as React from "react";
            import { jsx } from "react/jsx-runtime";
            const __defProp = Object.defineProperty;
            const __name = (target, value) => __defProp(target, "name", { value, configurable: true });
            export const Layer = React.forwardRef(
                __name(function LayerImpl(props, forwardedRef) {
                    return jsx("div", { ...props, ref: forwardedRef });
                }, "LayerImpl"),
            );
        "#,
    })
    .expect("a standard transpiler name helper should not hide an inline forwardRef component");

    assert!(
        output.contains("export const Layer = function LayerImpl"),
        "{output}"
    );
    assert!(!output.contains("forwardRef"), "{output}");
    assert!(!output.contains("__name(function"), "{output}");
}

#[test]
fn erases_transpiler_name_metadata_on_custom_hook_bindings() {
    let output = compile_surgical_module_with_options(
        ModuleInput {
            filename: "named-hook.mjs",
            source: r#"
                import * as React from "react";
                const __defProp = Object.defineProperty;
                const __name = (target, value) => __defProp(target, "name", { value, configurable: true });
                function useValue() {
                    const [value, setValue] = React.useState("ready");
                    return { value, setValue };
                }
                __name(useValue, "useValue");
                export function NamedHook() {
                    const { value } = useValue();
                    return React.createElement("output", null, value);
                }
            "#,
        },
        &CompilationOptions::default().with_feature(CompilerFeature::DependencySource),
    )
    .expect("verified transpiler name metadata must not keep a hook binding reachable");

    assert!(!output.contains("__name(useValue"), "{output}");
    assert!(!output.contains("useValue"), "{output}");
}

#[test]
fn rejects_user_defined_name_helpers_around_forward_ref_functions() {
    let diagnostics = compile_surgical_module(ModuleInput {
        filename: "opaque-forward-ref-helper.mjs",
        source: r#"
            import * as React from "react";
            import { jsx } from "react/jsx-runtime";
            const Object = {
                defineProperty(target) {
                    globalThis.forwardRefHelperCalls += 1;
                    return target;
                },
            };
            const __name = (target, value) => Object.defineProperty(target, "name", { value });
            export const Layer = React.forwardRef(__name(function LayerImpl(props) {
                return jsx("div", props);
            }, "LayerImpl"));
        "#,
    })
    .expect_err("an opaque user helper must not be erased as transpiler name metadata");

    assert!(
        diagnostics.iter().any(|diagnostic| diagnostic
            .message
            .contains("forwardRef requires one inline component function")),
        "{diagnostics:?}"
    );
}

#[test]
fn rejects_effectful_name_descriptors_around_forward_ref_functions() {
    let diagnostics = compile_surgical_module(ModuleInput {
        filename: "effectful-forward-ref-helper.mjs",
        source: r#"
            import * as React from "react";
            import { jsx } from "react/jsx-runtime";
            const __name = (target, value) => Object.defineProperty(target, "name", {
                value,
                configurable: globalThis.recordForwardRefName(),
            });
            export const Layer = React.forwardRef(__name(function LayerImpl(props) {
                return jsx("div", props);
            }, "LayerImpl"));
        "#,
    })
    .expect_err("an effectful name descriptor must not be erased as transpiler metadata");

    assert!(
        diagnostics.iter().any(|diagnostic| diagnostic
            .message
            .contains("forwardRef requires one inline component function")),
        "{diagnostics:?}"
    );
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
fn normalizes_react_hook_compatibility_aliases_with_named_fallbacks() {
    let output = compile_surgical_module(ModuleInput {
        filename: "iso-layout-effect.tsx",
        source: r#"
            import * as React from 'react';
            const noop = () => {};
            const useIsoLayoutEffect = typeof document !== 'undefined'
                ? React.useLayoutEffect
                : noop;
            export function App() {
                useIsoLayoutEffect(() => undefined, []);
                return <p>stable</p>;
            }
        "#,
    })
    .expect("a React hook alias with a named inline fallback should canonicalize");

    assert!(!output.contains("useIsoLayoutEffect"), "{output}");
    assert!(output.contains("__vidactLayoutEffect"), "{output}");
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
fn lowers_one_dynamic_intrinsic_child_into_the_direct_intrinsic_path() {
    let output = compile_surgical_module(ModuleInput {
        filename: "dynamic-intrinsic-child.mjs",
        source: r#"
            import React from 'react';
            export function DynamicIntrinsic({ Tag, props, children }) {
                return React.createElement(Tag, props, children);
            }
        "#,
    })
    .expect("one explicit dynamic intrinsic child should stay under direct DOM ownership");

    assert!(
        output.contains("dynamicIntrinsicComponent as __vidactDynamicIntrinsicComponent"),
        "{output}"
    );
    assert!(output.contains("childrenOverride"), "{output}");
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
fn coalesces_classic_factory_props_before_a_final_children_property() {
    let output = compile_surgical_module(ModuleInput {
        filename: "factory-spread-children.tsx",
        source: r#"
            import React from 'react';
            export function FactorySpreadChildren({ props, label }) {
                return React.createElement('button', {
                    type: 'button',
                    ...props,
                    children: React.createElement('span', null, label),
                });
            }
        "#,
    })
    .expect("a final children property should remain a child after ordered prop coalescing");

    assert!(output.contains("<button"), "{output}");
    assert!(output.contains("<span"), "{output}");
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
