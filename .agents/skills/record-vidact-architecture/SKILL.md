---
name: record-vidact-architecture
description: Document durable Vidact compiler, runtime, reactivity, ownership, language-subset, or packaging decisions under docs/architecture. Use when an implementation settles or changes an architectural contract, when alternatives need a lasting rationale, or when an existing decision is superseded.
---

# Record Vidact Architecture

Turn a settled technical choice into an evidence-backed ADR and keep the architecture index accurate.

## Workflow

1. Read `docs/architecture/README.md` when it exists, then read ADRs whose titles or links overlap the decision. Inspect the relevant implementation and tests; do not document chat claims that the code does not support.
2. Decide whether the work creates a new decision, clarifies an existing one without changing it, or supersedes one. Never silently rewrite historical rationale after its contract changes.
3. Read [references/decision-template.md](references/decision-template.md) and create or update the smallest fitting document in `docs/architecture/`. Use a descriptive lowercase-hyphen filename. Keep code paths repo-relative.
4. State the boundary precisely: what analysis knows, what generated code guarantees, what the runtime owns, and what remains unsupported. Distinguish current behavior from future intent.
5. Link implementation and verification evidence. Name concrete tests or commands only when they exist in the repository.
6. Update `docs/architecture/README.md` with the document, one-sentence decision summary, and any supersession relationship. Preserve unrelated entries.
7. Check that every local link resolves and that the ADR agrees with the current diff. If implementation is incomplete, mark the document as proposed rather than accepted.

## Rules

- Record decisions and invariants, not a chronological work log.
- Prefer one cohesive ADR over several documents that repeat the same boundary.
- Include rejected alternatives with the actual tradeoff that ruled them out.
- Treat React Compiler analysis, Vidact compiler lowering, generated ABI, and browser runtime as separate layers.
- Call a value a signal only if the runtime performs dynamic dependency tracking. Vidact's statically registered updater slots are not signals.
- For arrays, document key identity, DOM range ownership, item update behavior, disposal, and whether a value may cross a prop boundary.
- Reject unsupported behavior explicitly; do not imply arbitrary React compatibility.
- Supersede an accepted ADR with a new ADR and reciprocal links when its decision changes materially.
