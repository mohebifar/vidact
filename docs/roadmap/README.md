# Vidact roadmap

Updated: 2026-08-23

These documents separate the current executable vertical slice from the larger
React-shaped product contract:

- [React parity gap audit](react-parity-gap-audit.md) — the canonical React
  19.2 surface inventory, default/opt-in boundary, accepted differences, and
  release gates.
- [Current support-gap audit](current-support-gap-audit.md) — what works, what
  is only partially proven in the implementation and which edge cases can
  currently reject or silently misrender. This predates several 2026-08-23
  implementation slices; use the parity audit for the current product-level
  classification.
- [React feature roadmap](react-feature-roadmap.md) — a dependency-ordered path
  from the current updater runtime to a production React-shaped platform.

The roadmap is proposed direction, not an accepted architecture decision. When
an implementation phase settles a compiler, ownership, or runtime contract,
record that decision under `docs/architecture/`.
