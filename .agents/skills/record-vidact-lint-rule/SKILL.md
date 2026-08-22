---
name: record-vidact-lint-rule
description: Record a proposed Vidact lint rule under docs/lint-rules when compiler or runtime work exposes a non-destructive render hazard, a hard-to-detect compatibility boundary, or an unavoidable React semantic difference that developers should see before the future Vidact Oxlint plugin exists. Use during implementation or design when the issue should be disclosed but is not a compiler error or an ordinary feature-roadmap gap.
---

# Record a Vidact lint rule

Capture one actionable compatibility hazard per document without implying that a
lint plugin already exists.

## Workflow

1. Inspect the relevant compiler/runtime behavior, tests, architecture decisions,
   and existing files in `docs/lint-rules/`.
2. Classify the finding before writing:
   - Make directly provable destructive render behavior a compiler diagnostic,
     not merely a lint rule.
   - Keep missing features in the roadmap unless a source pattern is hazardous
     even after the feature boundary is understood.
   - Record non-destructive stale-data, duplicate-effect, portability, or opaque-
     dependency hazards as proposed lint rules.
3. Search for an existing rule with the same semantic purpose. Extend that file
   instead of creating overlapping rules.
4. Read [references/rule-template.md](references/rule-template.md), then write one
   rule to `docs/lint-rules/<lowercase-hyphen-rule-name>.md`.
5. Show minimal incorrect and preferred examples. State the current Vidact
   behavior, the future check, known false positives, and escape-hatch needs.
6. Link concrete repository evidence when it exists. Distinguish implemented
   diagnostics from proposed lint behavior.

## Rules

- Keep exactly one lint rule in each rule file.
- Prefer a `no-*` name for a prohibited pattern and a `require-*` name for a
  required contract.
- Describe semantic risk, not code style preference.
- Do not claim arbitrary call purity, getter purity, or complete effect detection.
- Do not turn valid but unsupported React features into lint violations merely to
  shrink Vidact's implementation scope.
- Mark rules `Proposed` until the future lint plugin enforces them.
