use vidact_compiler::{DiagnosticCode, analysis::ModuleInput, compile_spike_browser_module};

#[test]
fn emits_react_compiler_ordered_alias_updaters() {
    let output = compile_spike_browser_module(ModuleInput {
        filename: "alias-counter.tsx",
        source: include_str!("fixtures/analysis/alias-counter.tsx"),
    })
    .expect("the alias fixture belongs to the executable spike subset");

    let direct = output.find("trace.push(\"derived:direct\")").unwrap();
    let alias = output.find("trace.push(\"derived:alias\")").unwrap();
    let doubled = output.find("trace.push(\"derived:doubled\")").unwrap();
    let attribute = output.find("trace.push(\"attribute:data-count\")").unwrap();
    let text = output.find("trace.push(\"text\")").unwrap();

    assert!(direct < alias && alias < doubled && doubled < attribute && attribute < text);
    assert!(output.contains("direct = count.get()"));
    assert!(output.contains("alias = direct"));
    assert!(output.contains("doubled = alias * 2"));
    assert!(output.contains("element.setAttribute(\"data-count\", String(alias))"));
    assert!(output.contains("text.data = String(doubled)"));
}

#[test]
fn fails_closed_outside_the_executable_spike_subset() {
    let diagnostics = compile_spike_browser_module(ModuleInput {
        filename: "todos.tsx",
        source: include_str!("fixtures/analysis/todos.tsx"),
    })
    .expect_err("array codegen is not silently approximated by the alias spike emitter");

    assert_eq!(diagnostics[0].code, DiagnosticCode::UnsupportedSyntax);
}

#[test]
fn preserves_string_literals_while_rewriting_bound_identifiers() {
    let output = compile_spike_browser_module(ModuleInput {
        filename: "string-handler.tsx",
        source: r#"
            import { useState } from "react";
            export function StringHandler() {
                const [count, setCount] = useState(1);
                const doubled = count * "count".length;
                return <button onClick={() => setCount(previous => previous + 1)}>{doubled}</button>;
            }
        "#,
    })
    .expect("AST rewriting can distinguish bindings from string contents");

    assert!(output.contains("doubled = count.get() * \"count\".length"));
    assert!(output.contains("count.set("));
    assert!(output.contains("previous + 1"));
}

#[test]
fn resolves_aliased_state_hooks_in_the_spike_emitter() {
    let output = compile_spike_browser_module(ModuleInput {
        filename: "aliased-hook.tsx",
        source: r#"
            import { useState as state } from "react";
            export function AliasedHook() {
                const [count, setCount] = state(1);
                const doubled = count * 2;
                return <button onClick={() => setCount(2)}>{doubled}</button>;
            }
        "#,
    })
    .expect("the spike emitter must use the React import binding, not hook spelling");

    assert!(output.contains("count = createStateSlot"), "{output}");
    assert!(!output.contains("state(1)"), "{output}");
}

#[test]
fn resolves_namespace_state_hooks_in_the_spike_emitter() {
    let output = compile_spike_browser_module(ModuleInput {
        filename: "namespace-hook.tsx",
        source: r#"
            import * as React from "react";
            export function NamespaceHook() {
                const [count, setCount] = React.useState(1);
                const doubled = count * 2;
                return <button onClick={() => setCount(2)}>{doubled}</button>;
            }
        "#,
    })
    .expect("the spike emitter must resolve React namespace bindings semantically");

    assert!(output.contains("count = createStateSlot"), "{output}");
    assert!(!output.contains("React.useState(1)"), "{output}");
}

#[test]
fn rejects_non_numeric_state_before_emitting_number_types() {
    let diagnostics = compile_spike_browser_module(ModuleInput {
        filename: "string-state.tsx",
        source: r#"
            import { useState } from "react";
            export function StringState() {
                const [value, setValue] = useState("initial");
                const label = value;
                return <button onClick={() => setValue("next")}>{label}</button>;
            }
        "#,
    })
    .expect_err("the bounded emitter must not claim a numeric type for string state");

    assert_eq!(diagnostics[0].code, DiagnosticCode::UnsupportedSyntax);
}

#[test]
fn rejects_non_numeric_derivations_before_emitting_number_types() {
    let diagnostics = compile_spike_browser_module(ModuleInput {
        filename: "string-derivation.tsx",
        source: r#"
            import { useState } from "react";
            export function StringDerivation() {
                const [count, setCount] = useState(1);
                const label = String(count);
                return <button onClick={() => setCount(2)}>{label}</button>;
            }
        "#,
    })
    .expect_err("the bounded emitter must not claim a numeric type for string derivations");

    assert_eq!(diagnostics[0].code, DiagnosticCode::UnsupportedSyntax);
}

#[test]
fn rejects_props_that_the_mount_signature_cannot_supply() {
    let diagnostics = compile_spike_browser_module(ModuleInput {
        filename: "prop-counter.tsx",
        source: r#"
            import { useState } from "react";
            export function PropCounter({ step }) {
                const [count, setCount] = useState(1);
                return <button onClick={() => setCount(count + 1)}>{step}</button>;
            }
        "#,
    })
    .expect_err("the host-only mount signature cannot silently emit free prop references");

    assert_eq!(diagnostics[0].code, DiagnosticCode::UnsupportedSyntax);
}

#[test]
fn rejects_click_handlers_outside_the_setter_subset() {
    let diagnostics = compile_spike_browser_module(ModuleInput {
        filename: "unrelated-handler.tsx",
        source: r#"
            import { useState } from "react";
            export function UnrelatedHandler() {
                const [count, setCount] = useState(1);
                const doubled = count * 2;
                return <button onClick={() => console.log(doubled)}>{doubled}</button>;
            }
        "#,
    })
    .expect_err("the bounded emitter must not silently broaden event support");

    assert_eq!(diagnostics[0].code, DiagnosticCode::UnsupportedSyntax);
}

#[test]
fn rejects_click_handlers_that_reference_but_do_not_call_the_setter() {
    let diagnostics = compile_spike_browser_module(ModuleInput {
        filename: "setter-reference-handler.tsx",
        source: r#"
            import { useState } from "react";
            export function SetterReferenceHandler() {
                const [count, setCount] = useState(1);
                const doubled = count * 2;
                return <button onClick={() => setCount}>{doubled}</button>;
            }
        "#,
    })
    .expect_err("the bounded emitter requires the click handler to invoke its setter");

    assert_eq!(diagnostics[0].code, DiagnosticCode::UnsupportedSyntax);
}

#[test]
fn rejects_setter_calls_hidden_in_uninvoked_nested_functions() {
    let diagnostics = compile_spike_browser_module(ModuleInput {
        filename: "nested-setter-handler.tsx",
        source: r#"
            import { useState } from "react";
            export function NestedSetterHandler() {
                const [count, setCount] = useState(1);
                const doubled = count * 2;
                return <button onClick={() => () => setCount(2)}>{doubled}</button>;
            }
        "#,
    })
    .expect_err("returning a function that calls the setter does not update on click");

    assert_eq!(diagnostics[0].code, DiagnosticCode::UnsupportedSyntax);
}

#[test]
fn rejects_non_function_click_expressions() {
    let diagnostics = compile_spike_browser_module(ModuleInput {
        filename: "eager-click.tsx",
        source: r#"
            import { useState } from "react";
            export function EagerClick() {
                const [count, setCount] = useState(1);
                const doubled = count * 2;
                return <button onClick={setCount}>{doubled}</button>;
            }
        "#,
    })
    .expect_err("a state setter cannot directly become an event listener");

    assert_eq!(diagnostics[0].code, DiagnosticCode::UnsupportedSyntax);
}

#[test]
fn rejects_static_markup_that_the_spike_cannot_preserve() {
    let diagnostics = compile_spike_browser_module(ModuleInput {
        filename: "static-text.tsx",
        source: r#"
            import { useState } from "react";
            export function StaticText() {
                const [count, setCount] = useState(1);
                const doubled = count * 2;
                return <button className="counter" onClick={() => setCount(2)}>Value: {doubled}</button>;
            }
        "#,
    })
    .expect_err("the emitter must not silently omit static attributes or child text");

    assert_eq!(diagnostics[0].code, DiagnosticCode::UnsupportedSyntax);
}

#[test]
fn rejects_static_child_expressions_without_reactive_updaters() {
    let diagnostics = compile_spike_browser_module(ModuleInput {
        filename: "static-expression.tsx",
        source: r#"
            import { useState } from "react";
            export function StaticExpression() {
                const [count, setCount] = useState(1);
                return <button onClick={() => setCount(count + 1)}>{42}</button>;
            }
        "#,
    })
    .expect_err("static expressions cannot be silently omitted from the emitted DOM");

    assert_eq!(diagnostics[0].code, DiagnosticCode::UnsupportedSyntax);
}

#[test]
fn rejects_static_attribute_expressions_without_reactive_updaters() {
    let diagnostics = compile_spike_browser_module(ModuleInput {
        filename: "static-attribute-expression.tsx",
        source: r#"
            import { useState } from "react";
            export function StaticAttributeExpression() {
                const [count, setCount] = useState(1);
                return <button data-count={42} onClick={() => setCount(count + 1)}>{count}</button>;
            }
        "#,
    })
    .expect_err("static attribute expressions cannot be silently omitted from the emitted DOM");

    assert_eq!(diagnostics[0].code, DiagnosticCode::UnsupportedSyntax);
}
