use vidact_compiler::{DiagnosticCode, analysis::ModuleInput, compile_spike_browser_module};

#[test]
fn emits_react_compiler_ordered_alias_updaters() {
    let output = compile_spike_browser_module(ModuleInput {
        filename: "alias-counter.tsx",
        source: include_str!("fixtures/analysis/alias-counter.tsx"),
    })
    .expect("the alias fixture belongs to the executable spike subset");

    let direct = output.find("trace.push('derived:direct')").unwrap();
    let alias = output.find("trace.push('derived:alias')").unwrap();
    let doubled = output.find("trace.push('derived:doubled')").unwrap();
    let attribute = output.find("trace.push('attribute:data-count')").unwrap();
    let text = output.find("trace.push('text')").unwrap();

    assert!(direct < alias && alias < doubled && doubled < attribute && attribute < text);
    assert!(output.contains("direct = count.get()"));
    assert!(output.contains("alias = direct"));
    assert!(output.contains("doubled = alias * 2"));
    assert!(output.contains("element.setAttribute('data-count', String(alias))"));
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
fn rejects_string_bearing_expressions_instead_of_textually_rewriting_them() {
    let diagnostics = compile_spike_browser_module(ModuleInput {
        filename: "string-handler.tsx",
        source: r#"
            import { useState } from "react";
            export function StringHandler() {
                const [count, setCount] = useState(1);
                const doubled = count * 2;
                return <button onClick={() => setCount("count")}>{doubled}</button>;
            }
        "#,
    })
    .expect_err("textual codegen must not rewrite identifiers inside strings");

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
