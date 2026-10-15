# Assignment and project scope

This section records the brief supplied by the maintainer and explains the
scope chosen for ResearchBench. The brief is reproduced below without edits;
the interpretation and feature mapping are project documentation, not additional
requirements from the assignment.

Documentation baseline: **2026-10-15**, repository revision
`45019c749b7b886cedd4edcf2ea6c3dd1cf809ff` (v0.1.0 preparation candidate).
Implementation claims in this section refer to that revision, not necessarily
the version running on the live demo.

## Original brief (German, verbatim)

> Baue einen NotebookLM-Klon (https://notebooklm.google.com).
>
> Umsetzung, Umfang und Struktur sind komplett Dir überlassen. Die Nutzung von AI-Tools ist ausdrücklich erwünscht.

## English translation

> Build a NotebookLM clone (https://notebooklm.google.com).
>
> The implementation, scope and structure are entirely up to you. The use of AI tools is expressly encouraged.

The brief names a reference product and leaves implementation, scope and
structure open. It does not prescribe a technology stack, feature checklist,
provider, deployment model or requirement for complete feature parity.

## Interpretation and objectives

ResearchBench implements a selected notebook workflow: collect documents, search
their contents, ask questions with navigable source references, and generate
study material or a two-host audio overview. The chosen objectives are:

- Keep document parsing, indexing, retrieval and persistence in the browser.
- Make the source passages behind generated material inspectable, while clearly
  stating that references do not prove factual support.
- Demonstrate a Rust/WASM processing core within a usable Svelte application.
- Make external generation an explicit user action using the user's own API key.

These are developer-chosen objectives. In-browser processing, Rust, Mistral,
OpenRouter, local embeddings and the available Studio outputs are implementation
decisions rather than terms of the original brief. This is a bounded prototype,
not a reproduction of Google's service or a security certification.

## Reading order

1. [Scope](scope.md): implemented boundaries, limits, exclusions and changes
   established by Git history.
2. [Reference feature mapping](feature-parity.md): implemented, partial, excluded
   and unverified capabilities against a dated reference baseline.
3. [Architecture](../../README.md#architecture) and
   [integration contracts](../../src/lib/contracts.md): components and data flow.
4. [Verification](../verification.md) and
   [capacity measurements](../source-capacity-phase-a.md): how behavior is tested
   and what the measurements establish.
5. [Security limitations](../security/README.md) and
   [privacy boundaries](../../README.md#privacy-and-gdpr-precise-boundaries):
   guarantees, residual risks and external dependencies.

## AI-assisted development and evidence boundaries

The assignment expressly permits and encourages AI tools. The committed
[audit and remediation records](../security/README.md#audit-and-remediation-history)
document model-assisted work and independent challenges for specific revisions.
They are evidence of those recorded activities, not a complete account of which
tools produced every file. This section makes no claim about the proportion of
AI-written code or unrecorded development steps. Implementation and tests remain
the basis for the capability claims below.

The brief's provenance here is the wording supplied by the maintainer; the
original correspondence is not included. Historical commits establish when
features were present, but do not by themselves establish the original intent
behind every decision. The comparison uses public reference documentation and
does not claim an authenticated, side-by-side product acceptance test.
