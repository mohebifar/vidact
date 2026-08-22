//! Vidact-owned reactive value-flow IR.
//!
//! React Compiler determines CFG, SSA, declaration identity, and phi operands.
//! This module validates and lowers those generic facts before DOM codegen adds
//! updater or publication policy.

mod regions;
mod ssa;

pub use regions::StructuredRegionKind;
pub use ssa::{
    ReactiveFlowBlock, ReactiveFlowGraph, ReactiveFlowPhi, ReactiveFlowPhiOperand,
    ReactiveFlowValue, lower_reactive_flow,
};
