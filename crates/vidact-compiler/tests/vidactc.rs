use std::{
    io::Write,
    process::{Command, Stdio},
};

fn analyze(source: &str) -> std::process::Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_vidactc"))
        .args(["analyze", "--filename", "fixture.tsx"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn vidactc");
    child
        .stdin
        .take()
        .expect("vidactc stdin")
        .write_all(source.as_bytes())
        .expect("write source");
    child.wait_with_output().expect("wait for vidactc")
}

#[test]
fn emits_versioned_analysis_json_for_supported_tsx() {
    let output = analyze(include_str!("fixtures/analysis/todos.tsx"));

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let json = String::from_utf8(output.stdout).expect("analysis JSON is UTF-8");
    assert!(json.contains(r#""protocol":"vidact-analysis-v1""#));
    assert!(json.contains(r#""name":"Todos""#));
    assert!(json.contains(r#""span":{"end":"#));
    assert!(json.contains(r#""kind":"keyed-list""#));
}

#[test]
fn exits_nonzero_and_reports_diagnostics_for_invalid_tsx() {
    let output = analyze("export function Broken( {");

    assert!(!output.status.success());
    let error = String::from_utf8(output.stderr).expect("diagnostic is UTF-8");
    assert!(error.contains("AnalysisFailed"));
    assert!(error.contains("fixture.tsx"));
}

#[test]
fn reports_original_source_location_for_unsupported_component_forms() {
    let output = analyze(include_str!(
        "fixtures/compatibility/rejected/arrow-component.tsx"
    ));

    assert!(!output.status.success());
    let error = String::from_utf8(output.stderr).expect("diagnostic is UTF-8");
    assert!(error.contains("fixture.tsx:3:29"), "{error}");
    assert!(error.contains("UnsupportedComponentForm"), "{error}");
    assert!(error.contains("ArrowCounter"), "{error}");
}
