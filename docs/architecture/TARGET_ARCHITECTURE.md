# Target Architecture

FormuLab as an evidence-aware, local-first formulation R&D operating system for
Kenya-focused FMCG product development.

## The governing principle

The language model does not hold the truth. It researches, extracts, drafts,
explains and compares. Everything the system *asserts* — totals, costs,
constraint satisfaction, regulatory status, compatibility, approval — is
computed deterministically and can be recomputed from stored data without any
model call.

Practically this means:

- A formulation is a **structured record**, not a Markdown document. Markdown is
  an export.
- A run completes because a **typed event** says so, not because a heading
  matched a regex.
- No model output can set an approval status. Approval is a human workflow with
  an audit trail.

## Layers

```
UI                 React panes, formula builder, comparison, lab, DOE
Application        orchestration, run lifecycle, workflow state
Domain             ProductFamily, PackagingSku, Formulation, Version, Material
Engines            Formulation · Evidence · Regulatory · Compatibility ·
                   Safety · Cost · Lab/DOE
Persistence        versioned JSON documents + migrations
Agent Runtime      typed event stream over the Python bridge
Import/Export      CSV/Excel/PDF/Word/ERP, deterministic
Integration        ERP contract (schema-only in this phase)
```

Engines are pure and deterministic: same inputs, same findings. That is what
makes them testable and what makes their output safe to display as fact.

## Schema strategy

One source of truth per concept, in `packages/shared/schemas/`, expressed as
TypeScript types plus Zod validators. Python mirrors the same shapes with
explicit validation at the bridge boundary. Every document carries
`schemaVersion`.

Rust deliberately stays schema-light: it moves opaque JSON between the webview
and Python and enforces path/permission boundaries. Adding a third
hand-maintained copy of every type would be a liability, not a safeguard.

## Product model

Packaging size must not fork the chemistry. A 250 ml bottle and an 8 ml sachet
of the same shampoo share one formulation family and may share an approved
formula version, while remaining distinct packaging SKUs with distinct costs.

```
ProductFamily  ──< PackagingSku
      │
      └──< Formulation ──< FormulationVersion ──< FormulationLine
                                  │
                                  ├── ManufacturingMethod
                                  ├── LaboratoryTrial
                                  └── ApprovalRecord
```

Identity is a stable `code`, never a display name.

## Precision policy

Percentages, quantities and money use decimal arithmetic — `Decimal` in Python,
a decimal-string representation in TypeScript. Binary floats are acceptable for
scoring and heuristics, never for a number a factory or an invoice depends on.
Money renders with thousands separators and fixed decimals; a batch total must
never appear as `1.447e+04`.

## Evidence model

Every number carries where it came from:

```
reported_exact · reported_range · patent_example · supplier_recommendation ·
regulatory_limit · industry_reference · model_estimate · chemist_override ·
laboratory_result
```

and what a source actually supports (existence, function, range, exact value,
compatibility, performance, safety, regulatory status) — never one undifferentiated
"citation". A model-estimated percentage must never be displayed as reported.

## Status and approval

```
concept → literature_candidate → chemist_review → lab_candidate →
stability_testing → pilot_candidate → pilot_approved → production_approved
```

`pilot_approved` and `production_approved` are reachable only through a human
approval record. This is enforced in the domain layer, not by UI convention, and
tested.

## Unknowns

Where authoritative data is unavailable the system returns `unknown`,
`not_verified`, `insufficient_evidence` or `human_review_required`. It does not
manufacture certainty. Regulatory rules in particular ship as clearly-labelled
unverified placeholders until a human imports verified ones.
