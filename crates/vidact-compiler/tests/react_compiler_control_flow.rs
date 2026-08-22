use std::path::Path;

use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_react_compiler::{
    CompileResult, FunctionAnalysis, InstructionKindAnalysis, PluginOptions, ReturnVariantAnalysis,
    TerminalKindAnalysis, WriteKindAnalysis, compile,
};
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType;

fn analyze_component(source: &str, name: &str) -> FunctionAnalysis {
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(Path::new("fixture.tsx")).expect("TSX source type");
    let parsed = Parser::new(&allocator, source, source_type).parse();
    assert!(parsed.diagnostics.is_empty(), "{:#?}", parsed.diagnostics);
    let semantic = SemanticBuilder::new()
        .with_build_nodes(true)
        .with_check_syntax_error(true)
        .build(&parsed.program);
    assert!(
        semantic.diagnostics.is_empty(),
        "{:#?}",
        semantic.diagnostics
    );

    let CompileResult::Success {
        output: Some(output),
        diagnostics,
    } = compile(
        &parsed.program,
        &semantic.semantic,
        &allocator,
        PluginOptions::default(),
    )
    else {
        panic!("React Compiler must return an analysis snapshot")
    };
    assert!(diagnostics.is_empty(), "{diagnostics:#?}");
    output
        .analyses()
        .iter()
        .find(|analysis| analysis.name.as_deref() == Some(name))
        .unwrap_or_else(|| panic!("missing analysis for {name}"))
        .clone()
}

fn explicit_returns(analysis: &FunctionAnalysis) -> Vec<(u32, u32)> {
    analysis
        .control_flow
        .blocks
        .iter()
        .filter_map(|block| {
            matches!(
                block.terminal.kind,
                TerminalKindAnalysis::Return(ReturnVariantAnalysis::Explicit)
            )
            .then_some(block.terminal.span)
            .flatten()
        })
        .collect()
}

#[test]
fn captures_component_early_returns_with_original_spans() {
    let source = r#"
        import { useState } from "react";
        export function Early() {
            const [ready] = useState(false);
            if (!ready) return <button>Load</button>;
            return <p>Ready</p>;
        }
    "#;
    let analysis = analyze_component(source, "Early");
    let returns = explicit_returns(&analysis);

    assert_eq!(returns.len(), 2);
    let selected = returns
        .iter()
        .map(|(start, end)| &source[*start as usize..*end as usize])
        .collect::<Vec<_>>();
    assert!(selected.iter().any(|text| text.contains("return <button>")));
    assert!(selected.iter().any(|text| text.contains("return <p>")));

    let branch = analysis
        .control_flow
        .blocks
        .iter()
        .find(|block| {
            matches!(
                block.terminal.kind,
                TerminalKindAnalysis::If | TerminalKindAnalysis::Branch
            )
        })
        .expect("the early return condition must remain in the CFG");
    assert_eq!(branch.terminal.successors.len(), 3);
    assert!(branch.terminal.span.is_some());
}

#[test]
fn nested_callback_returns_and_source_lookalikes_do_not_pollute_component_flow() {
    let source = r#"
        export function Counter({ label }) {
            const note = "if (wrong) return <Wrong />";
            const render = () => {
                if (label) return <span>{label}</span>;
                return null;
            };
            return (
                <button onClick={() => {
                    if (label) return;
                }} data-note={note}>
                    {render()}
                </button>
            );
        }
    "#;
    let analysis = analyze_component(source, "Counter");

    assert_eq!(explicit_returns(&analysis).len(), 1);
    assert!(!analysis.control_flow.blocks.iter().any(|block| {
        matches!(
            block.terminal.kind,
            TerminalKindAnalysis::If | TerminalKindAnalysis::Branch
        )
    }));
    assert!(analysis.control_flow.blocks.iter().any(|block| {
        block.instructions.iter().any(|instruction| {
            instruction.kind == InstructionKindAnalysis::FunctionExpression
                && instruction.span.is_some()
        })
    }));
}

#[test]
fn expression_branches_do_not_create_false_early_returns() {
    let source = r#"
        export function Greeting({ ready }) {
            const label = ready ? "Ready" : "Waiting";
            return <p>{label}</p>;
        }
    "#;
    let analysis = analyze_component(source, "Greeting");

    assert_eq!(explicit_returns(&analysis).len(), 1);
    assert!(analysis.control_flow.blocks.iter().any(|block| {
        matches!(
            block.terminal.kind,
            TerminalKindAnalysis::Ternary | TerminalKindAnalysis::Branch
        )
    }));
    let jsx_sites = analysis
        .control_flow
        .blocks
        .iter()
        .flat_map(|block| &block.instructions)
        .filter(|instruction| instruction.kind == InstructionKindAnalysis::JsxExpression)
        .filter_map(|instruction| instruction.span)
        .collect::<Vec<_>>();
    assert!(
        jsx_sites
            .iter()
            .any(|(start, end)| source[*start as usize..*end as usize].contains("<p>{label}</p>"))
    );
}

#[test]
fn captures_render_writes_before_dead_code_elimination() {
    let source = r#"
        export function Mutate({ label }) {
            label = "changed";
            return <p>{label}</p>;
        }
    "#;
    let analysis = analyze_component(source, "Mutate");
    let write = analysis
        .render_writes
        .iter()
        .find(|write| write.kind == WriteKindAnalysis::Local)
        .expect("the prop assignment must survive as an owned write fact");

    assert_eq!(write.targets.len(), 1);
    let span = write.span.expect("the write retains its source span");
    assert!(source[span.0 as usize..span.1 as usize].contains("label"));
}

#[test]
fn captures_structured_switch_loop_and_label_terminals() {
    let analysis = analyze_component(
        r#"
            export function Regions({ mode, values }) {
                let result = '';
                switch (mode) {
                    case 'a': result += 'a';
                    default: result += 'd';
                }
                outer: for (const value of values) {
                    if (value < 0) continue;
                    if (value > 10) break outer;
                    result += value;
                }
                do { result += '!'; } while (result.length < 2);
                return <p>{result}</p>;
            }
        "#,
        "Regions",
    );
    let kinds = analysis
        .control_flow
        .blocks
        .iter()
        .map(|block| block.terminal.kind)
        .collect::<Vec<_>>();

    assert!(kinds.contains(&TerminalKindAnalysis::Switch));
    assert!(kinds.contains(&TerminalKindAnalysis::ForOf));
    assert!(kinds.contains(&TerminalKindAnalysis::DoWhile));
    assert!(kinds.iter().any(|kind| {
        matches!(
            kind,
            TerminalKindAnalysis::Goto(
                oxc_react_compiler::GotoVariantAnalysis::Break
                    | oxc_react_compiler::GotoVariantAnalysis::Continue
            )
        )
    }));
}
