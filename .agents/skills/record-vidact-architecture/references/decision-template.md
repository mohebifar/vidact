# Vidact Architecture Decision Template

Use only sections that carry real information, but retain Context, Decision, Invariants, Consequences, and Verification.

```markdown
# Decision title

- Decision state: Proposed | Accepted | Superseded
- Decided: YYYY-MM-DD
- Supersedes: [title](relative-link), when applicable
- Superseded by: [title](relative-link), when applicable

## Context

Describe the concrete problem and the previous behavior.

## Decision

State the chosen contract. Separate analysis inputs, compiler output, runtime behavior, and public compatibility boundaries.

## Compiler and runtime contract

Describe the generated ABI and ownership handoff at the level needed to preserve compatibility.

## Invariants

- List properties that must always hold and should be tested.

## Alternatives considered

- **Alternative:** Explain why it was rejected for Vidact.

## Consequences

Name benefits, costs, limits, and follow-up pressure.

## Verification

Link repo-relative tests and name commands that establish the contract.
```
