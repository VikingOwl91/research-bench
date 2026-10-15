# Security audits

This directory records independent security and robustness audits of
ResearchBench. Each audit is a point-in-time assessment of one exact
repository revision; it is not a certification of the project, and it does
not carry forward to later revisions.

## Audit history

| Audit | Baseline | Status | Report |
|---|---|---|---|
| 2026-10 Mistral red-team | `4fd379dbfd2d0b25881bc219f18c0d66178ad8b3` (v0.0.4) | Complete; remediation pending | [audits/2026-10-mistral-red-team](audits/2026-10-mistral-red-team/README.md) |

## Scope and limitations of an audit entry

Each audit covers the attack surfaces listed in its own report (prompt
injection and instruction hierarchy, source and citation integrity, document
ingestion, browser security and local data, workflow and state integrity,
Studio output integrity, and the provider integrations). Audits use a mix of
local deterministic probes, the repository's own test suites, and — where
authorized — controlled live testing against the configured LLM providers
with synthetic fictional fixtures only.

An audit entry is evidence about the audited revision. It:

- does not certify that ResearchBench is secure, in general or at the
  audited revision;
- does not apply to any other commit, tag, or deployed build;
- does not replace the project's own verification gates
  (`pnpm verify`, `pnpm test:e2e`, `pnpm test:security`), which remain the
  primary regression protection;
- distinguishes demonstrated findings from hypothetical concerns, and
  separates newly discovered defects from limitations the project already
  documents.

## Audited versions versus current versions

Every audit names the exact commit SHA it tested. Findings are attributed to
that revision only. If the repository has moved on, an audit entry must be
read as a historical record: a finding may already be fixed, and new code may
introduce issues no audit has seen. When in doubt, re-audit the current
revision.

## Reporting

If you believe you have found a security issue in ResearchBench, prefer the
repository's published security contact or private vulnerability reporting
channel over public issues, and include a minimal reproduction with
synthetic data only.
