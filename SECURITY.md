# Security policy

ResearchBench is an early-stage browser application. Its regression suites and
point-in-time audits are evidence about particular revisions, not security or
privacy certification. Only the current maintained source is evaluated for fixes;
historical tags do not have a promised maintenance window.

## Reporting a vulnerability

Do not disclose an exploit, user documents, credentials or raw provider traffic
in a public issue. Reports should use fictional data and include the affected
commit/build identity, browser/version, minimal steps, expected/actual behavior
and impact. Never include API keys or personal data.

**Before public publication, the maintainer must enable and verify GitHub private
vulnerability reporting**, or publish a verified private security contact. The
private-repository API check during v0.1.0 preparation did not establish that
private reporting is available. This document does not claim an operational
private reporting channel yet. Once enabled, use the repository's **Security →
Report a vulnerability** action. If that action is unavailable, do not post
sensitive details publicly; request a private reporting channel from the
maintainer without disclosing the vulnerability.

No response-time or remediation SLA is promised for this prototype.

## Trust boundaries and known limitations

- Documents, embeddings and indices remain in the browser. Generation sends
  selected text, the question/instructions, bounded history and the user's
  authorization key to the explicitly selected provider. Podcasts additionally
  send spoken script turns to speech synthesis. See [privacy boundaries](README.md#privacy-and-gdpr-precise-boundaries).
- Session keys are readable by scripts on the origin. Browser session recovery
  can restore sessionStorage. Removing the key in Settings explicitly clears it;
  it cannot revoke requests already sent to a provider.
- Generated text is escaped, schema-bounded and checked for citation-ID membership.
  Source instruction filtering and numeric/quotation matching are lexical
  heuristics: they can miss unsupported claims and can remove supported wording.
  They do not prove entailment, factual truth or injection immunity.
- PDF rendering-property annotations cannot establish complete visibility. Text
  hidden by clipping, backgrounds, overlays or alignment fallback can remain
  unmarked. Extracted text can omit diagram text or overlapping runs.
- Browser storage, native audio, quotas and processing resources vary. The import
  controller checks the 10 MiB per-file limit; the internal storage API lacks its
  own original-byte check. No shipped chooser/drop bypass was identified. See
  [the recorded hardening gap](docs/source-capacity-phase-a.md#pre-existing-storage-byte-limit-gap).
- There is no application authentication boundary or encryption-at-rest feature;
  browser-profile access can expose locally stored documents and audio.

See the [audit index](docs/security/README.md) for historical findings,
remediation, verification scope and remaining limitations. Preserve those
records when assessing a new revision. Do not use real sensitive data in an
unapproved audit or spend provider credits without authorization.
