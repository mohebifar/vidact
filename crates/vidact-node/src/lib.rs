use napi::{ScopedTask, bindgen_prelude::AsyncTask, bindgen_prelude::Unknown};
use napi_derive::napi;
use serde_json::Value;
use vidact_compiler::{
    analysis::ModuleInput,
    protocol::{analyze_module_json, compile_module_json},
};

#[derive(Default)]
#[napi(object)]
pub struct CompilerOptions {
    pub filename: String,
    #[napi(ts_type = "'client' | 'hydrate' | 'server' | undefined")]
    pub target: Option<String>,
    pub features: Option<Vec<String>>,
}

#[napi(object)]
pub struct AnalysisOptions {
    pub filename: String,
}

impl CompilerOptions {
    fn into_parts(self) -> (String, String, Vec<String>) {
        (
            self.filename,
            self.target.unwrap_or_else(|| "client".to_string()),
            self.features.unwrap_or_default(),
        )
    }
}

fn compile_json(
    source: &str,
    filename: &str,
    target: &str,
    features: &[String],
) -> napi::Result<Value> {
    compile_module_json(ModuleInput { filename, source }, target, features)
        .map_err(napi::Error::from_reason)
}

fn analyze_json(source: &str, filename: &str) -> napi::Result<Value> {
    analyze_module_json(ModuleInput { filename, source }).map_err(napi::Error::from_reason)
}

#[napi]
pub fn compile_sync(source: String, options: CompilerOptions) -> napi::Result<Value> {
    let (filename, target, features) = options.into_parts();
    compile_json(&source, &filename, &target, &features)
}

#[napi]
pub fn analyze_sync(source: String, options: AnalysisOptions) -> napi::Result<Value> {
    analyze_json(&source, &options.filename)
}

pub struct CompileTask {
    source: String,
    filename: String,
    target: String,
    features: Vec<String>,
}

#[napi]
impl<'task> ScopedTask<'task> for CompileTask {
    type Output = Value;
    type JsValue = Unknown<'task>;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        compile_json(&self.source, &self.filename, &self.target, &self.features)
    }

    fn resolve(
        &mut self,
        env: &'task napi::Env,
        output: Self::Output,
    ) -> napi::Result<Self::JsValue> {
        env.to_js_value(&output)
    }
}

#[napi]
pub fn compile(source: String, options: CompilerOptions) -> AsyncTask<CompileTask> {
    let (filename, target, features) = options.into_parts();
    AsyncTask::new(CompileTask {
        source,
        filename,
        target,
        features,
    })
}

pub struct AnalyzeTask {
    source: String,
    filename: String,
}

#[napi]
impl<'task> ScopedTask<'task> for AnalyzeTask {
    type Output = Value;
    type JsValue = Unknown<'task>;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        analyze_json(&self.source, &self.filename)
    }

    fn resolve(
        &mut self,
        env: &'task napi::Env,
        output: Self::Output,
    ) -> napi::Result<Self::JsValue> {
        env.to_js_value(&output)
    }
}

#[napi]
pub fn analyze(source: String, options: AnalysisOptions) -> AsyncTask<AnalyzeTask> {
    AsyncTask::new(AnalyzeTask {
        source,
        filename: options.filename,
    })
}
