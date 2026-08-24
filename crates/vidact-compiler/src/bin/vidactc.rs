use std::{env, io::Read, process::ExitCode};

use serde_json::Value;
use vidact_compiler::{
    analysis::ModuleInput,
    protocol::{analyze_module_json, compile_module_json},
};

fn main() -> ExitCode {
    match run() {
        Ok(output) => {
            println!("{output}");
            ExitCode::SUCCESS
        }
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<Value, String> {
    let mut arguments = env::args().skip(1);
    let command = arguments.next();
    if !matches!(command.as_deref(), Some("analyze" | "compile"))
        || arguments.next().as_deref() != Some("--filename")
    {
        return Err("usage: vidactc <analyze|compile> --filename <path>".to_string());
    }
    let filename = arguments
        .next()
        .ok_or_else(|| "missing value for --filename".to_string())?;
    let mut target = "client".to_string();
    let mut features = Vec::new();
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--target" => {
                target = arguments
                    .next()
                    .ok_or_else(|| "missing value for --target".to_string())?;
            }
            "--feature" => {
                features.push(
                    arguments
                        .next()
                        .ok_or_else(|| "missing value for --feature".to_string())?,
                );
            }
            _ => return Err(format!("unexpected argument {argument}")),
        }
    }

    let mut source = String::new();
    std::io::stdin()
        .read_to_string(&mut source)
        .map_err(|error| format!("could not read source from stdin: {error}"))?;
    let input = ModuleInput {
        filename: &filename,
        source: &source,
    };

    if command.as_deref() == Some("compile") {
        compile_module_json(input, &target, &features)
    } else {
        analyze_module_json(input)
    }
}
