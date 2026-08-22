//! Compiler-neutral contracts for Vidact's React analysis adapter.
//!
//! React Compiler is responsible for JavaScript semantics, control flow, SSA,
//! and dependency inference. Vidact lowers only the resulting facts into its
//! static updater IR.

pub mod analysis;
mod ast_utils;
mod browser_codegen;
mod diagnostic;
pub mod ir;
mod oxc_react;
mod react_bindings;
mod surgical_codegen;

pub use browser_codegen::compile_spike_browser_module;
pub use diagnostic::{Diagnostic, DiagnosticCode, SourceSpan};
pub use ir::{ComponentIr, IrSource, IrUpdater, lower_component};
pub use oxc_react::OxcReactAnalysisAdapter;
pub use surgical_codegen::{
    SurgicalCompilation, compile_surgical_module, compile_surgical_module_with_ir,
};
