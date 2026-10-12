# Loom outline — maximum 10 minutes

## 0:00–1:00 — Problem and approach

„ResearchBench macht aus eigenen Quellen einen Recherche-Arbeitsplatz. Persistenz
und Indexierung bleiben vollständig im Browser. Nur die für eine Generierung
ausgewählten Textauszüge und der Gesprächskontext werden mit Ihrem eigenen
API-Key an die gewählte API übertragen.“

Show the three panes, direct Mistral default and local-search capability. Name the
provider boundary honestly: regional inference and account retention controls
are separate from local persistence.

## 1:00–5:00 — Product demo

1. Start a fresh notebook. Import the three original fixture PDFs.
2. Search in German and English without a key. Explain local model download once.
3. With a funded key entered beforehand, ask the water-lab question that only
   document 2 answers. Click its citation and show page/exact highlighted text.
4. Generate summary, FAQ and Study Guide; make the Study Guide the highlight.
5. Reload to show persistence. Add/remove a source and show stale-content labels.

Keep the key settings closed during the recording. Use fictional/public documents.

## 5:00–8:00 — Engineering

Show the Mermaid data flow and Rust crate: UTF-16 provenance, fixed-size overlap,
local normalized E5 vectors, cosine retrieval, atomic IndexedDB commits and
shared structured citation contract. Explain the two API adapters and absence
of automatic provider fallback.

Mention actual tests that passed, then distinguish mocked API tests from the
manual live demonstration. Show CI commands, not secret-bearing logs.

## 8:00–9:30 — Trade-offs and close

Text PDFs only; no OCR. Coverage limits are explicit. Explain why local storage
supports privacy without promising automatic GDPR compliance. Show the confirmed
data wipe and link the repository/deployed demo. Keep the final video under ten minutes.
