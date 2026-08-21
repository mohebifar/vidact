use std::{fs, path::PathBuf};

use vidact_compiler::{analysis::ModuleInput, compile_spike_browser_module};

const ALIAS_COUNTER: &str = include_str!("../tests/fixtures/analysis/alias-counter.tsx");

fn main() {
    let output = compile_spike_browser_module(ModuleInput {
        filename: "alias-counter.tsx",
        source: ALIAS_COUNTER,
    })
    .unwrap_or_else(|diagnostics| panic!("browser corpus codegen failed: {diagnostics:#?}"));
    let destination = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/browser/generated/alias-counter.ts");
    fs::create_dir_all(destination.parent().expect("generated file has a parent"))
        .expect("create browser generated directory");
    fs::write(&destination, output).expect("write generated browser corpus module");
    println!("generated {}", destination.display());
}
