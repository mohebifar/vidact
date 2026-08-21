//! Compiler-neutral contracts for Vidact's React analysis adapter.
//!
//! React Compiler is responsible for JavaScript semantics, control flow, SSA,
//! and dependency inference. Vidact lowers only the resulting facts into its
//! static updater IR.

pub mod analysis;
mod diagnostic;
pub mod ir;

pub use diagnostic::{Diagnostic, DiagnosticCode};
pub use ir::{ComponentIr, IrSource, IrUpdater, lower_component};
