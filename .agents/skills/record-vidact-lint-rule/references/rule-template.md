# Lint rule template

````markdown
# rule-name

- Status: Proposed
- Future package: Vidact Oxlint plugin
- Recommended severity: Warning | Error

## Why

Describe the observable Vidact failure or compatibility risk.

## Incorrect

```tsx
// Minimal hazardous example.
```

## Preferred

```tsx
// Minimal alternative with explicit reactive ownership.
```

## Proposed check

Define the source pattern and the boundary of the future rule.

## False positives and configuration

Name legitimate patterns that may require configuration or an escape hatch.

## Compiler boundary

Explain why this is a lint concern instead of a guaranteed compiler error.

## Evidence

Link relevant architecture, implementation, or tests when available.
````
