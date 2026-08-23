//! Compiler-neutral contracts for Vidact's React analysis adapter.
//!
//! React Compiler is responsible for JavaScript semantics, control flow, SSA,
//! and dependency inference. Vidact lowers only the resulting facts into its
//! static updater IR.

pub mod analysis;
mod ast_utils;
mod custom_hooks;
mod diagnostic;
pub mod ir;
mod options;
mod oxc_react;
mod react_bindings;
pub mod reactive_flow;
pub mod render_flow;
mod surgical_codegen;

pub use diagnostic::{Diagnostic, DiagnosticCode, SourceSpan};
pub use ir::{ComponentIr, IrSource, IrUpdater, lower_component};
pub use options::{CompilationOptions, CompilerFeature, CompilerTarget};
pub use oxc_react::OxcReactAnalysisAdapter;
pub use surgical_codegen::{
    SurgicalCompilation, compile_surgical_module, compile_surgical_module_with_ir,
    compile_surgical_module_with_ir_and_options, compile_surgical_module_with_options,
};
