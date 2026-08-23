use std::{collections::BTreeSet, fs, path::Path};

use serde_json::Value;
use vidact_compiler::{
    CompilationOptions, CompilerFeature, Diagnostic, SourceSpan, analysis::ModuleInput,
    compile_surgical_module_with_ir_and_options,
};

#[test]
fn compatibility_manifest_matches_the_compiler_contract() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/compatibility");
    let manifest: Value = serde_json::from_str(
        &fs::read_to_string(root.join("manifest.json")).expect("read compatibility manifest"),
    )
    .expect("parse compatibility manifest");
    assert_eq!(manifest["contract"], "vidact-react-subset-v1");

    let fixtures = manifest["fixtures"]
        .as_array()
        .expect("manifest fixtures must be an array");
    for fixture in fixtures {
        verify_fixture(&root, fixture);
    }

    let listed = fixtures
        .iter()
        .map(|fixture| fixture["path"].as_str().expect("fixture path").to_string())
        .collect::<BTreeSet<_>>();
    let mut discovered = BTreeSet::new();
    collect_tsx_fixtures(&root, &root, &mut discovered);
    assert_eq!(
        listed, discovered,
        "every compatibility fixture must be manifested"
    );
}

fn verify_fixture(root: &Path, fixture: &Value) {
    let relative = fixture["path"].as_str().expect("fixture path");
    let path = root.join(relative);
    let source = fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!(
            "could not read compatibility fixture {}: {error}",
            path.display()
        )
    });
    let input = ModuleInput {
        filename: relative,
        source: &source,
    };
    let options = fixture["features"].as_array().into_iter().flatten().fold(
        CompilationOptions::default(),
        |options, feature| {
            let feature = match feature.as_str().expect("feature name") {
                "unsafe-html" => CompilerFeature::UnsafeHtml,
                "css-insertion" => CompilerFeature::CssInsertion,
                "async" => CompilerFeature::Async,
                "concurrent" => CompilerFeature::Concurrent,
                feature => panic!("unknown compatibility fixture feature {feature}"),
            };
            options.with_feature(feature)
        },
    );

    match fixture["expectation"]
        .as_str()
        .expect("fixture expectation")
    {
        "accepted" | "different" => {
            let compilation = compile_surgical_module_with_ir_and_options(input, &options)
                .unwrap_or_else(|diagnostics| panic!("{relative} must compile: {diagnostics:#?}"));
            let actual = compilation
                .components
                .iter()
                .map(|component| component.name.as_str())
                .collect::<Vec<_>>();
            let expected = fixture["components"]
                .as_array()
                .expect("accepted fixtures need component names")
                .iter()
                .map(|name| name.as_str().expect("component name"))
                .collect::<Vec<_>>();
            assert_eq!(actual, expected, "{relative}");
            if fixture["expectation"] == "different" {
                assert!(
                    fixture["difference"]
                        .as_str()
                        .is_some_and(|reason| !reason.trim().is_empty()),
                    "different fixtures must document their intentional divergence"
                );
            }
        }
        "rejected" => {
            let diagnostics = compile_surgical_module_with_ir_and_options(input, &options)
                .expect_err("rejected compatibility fixture must fail");
            verify_rejection(relative, &source, fixture, &diagnostics);
        }
        expectation => panic!("unknown compatibility expectation {expectation}"),
    }
}

fn verify_rejection(relative: &str, source: &str, fixture: &Value, diagnostics: &[Diagnostic]) {
    let expected_code = fixture["code"].as_str().expect("rejected fixture code");
    let diagnostic = diagnostics
        .iter()
        .find(|diagnostic| format!("{:?}", diagnostic.code) == expected_code)
        .unwrap_or_else(|| {
            panic!("{relative} did not emit {expected_code}; diagnostics: {diagnostics:#?}")
        });
    let span = diagnostic
        .span
        .unwrap_or_else(|| panic!("{relative} rejection must have a source span"));
    let selected = source_for_span(source, span);
    let expected_text = fixture["spanContains"]
        .as_str()
        .expect("rejected fixture spanContains");
    assert!(
        selected.contains(expected_text),
        "{relative} span {span:?} selected {selected:?}, expected {expected_text:?}"
    );
}

fn source_for_span(source: &str, span: SourceSpan) -> &str {
    &source[span.start as usize..span.end as usize]
}

fn collect_tsx_fixtures(root: &Path, directory: &Path, fixtures: &mut BTreeSet<String>) {
    for entry in fs::read_dir(directory).expect("read compatibility fixture directory") {
        let path = entry.expect("read compatibility fixture entry").path();
        if path.is_dir() {
            collect_tsx_fixtures(root, &path, fixtures);
        } else if path.extension().is_some_and(|extension| extension == "tsx") {
            fixtures.insert(
                path.strip_prefix(root)
                    .expect("fixture is below corpus root")
                    .to_string_lossy()
                    .replace('\\', "/"),
            );
        }
    }
}
