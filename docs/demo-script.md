# ResearchBench demo: OBS Studio and unlisted YouTube

Record in English. Target 6–8 minutes; ten minutes is the hard limit. Everlast
has approved this video format. Loom is not required.

## Before recording

Use a dedicated browser profile and the two real public NIST inputs from
[public-demo](public-demo/README.md). Keep key settings, private documents,
terminals, notification previews and other workspaces out of the capture.
The owner enters the funded Mistral key in the UI; never copy it into logs.

Check the exact frozen production build on the existing domain first. Keep
GitHub private and v0.0.3 untagged until the owner explicitly authorizes
publication and tagging. Functional and security/privacy live acceptance remain
required. Semantic grounding is a documented, accepted prototype limitation.
Use the
[reference questions](public-demo/reference.json) for extraction/retrieval and
the absent-information check. Generate and audit a chat answer, Summary, FAQ,
Study Guide and complete English podcast before starting OBS. Listen to both
voices and their transitions; check transcript seeking, citations and the
downloaded MP3. Prepare all five outputs for playback without a new API call.

Record at 1920×1080, 30 fps using OBS Studio on Arch Linux/Hyprland. Capture the
dedicated browser workspace through PipeWire. Use a microphone, system audio
and headphones. Record a 30-second probe to check readable text, both audio
channels, clipping and echo. Record to MKV and remux to MP4 without re-encoding.
No OBS plugins or system configuration changes are needed unless the capture
probe demonstrates an actual problem.

## 0:00–0:45: problem and privacy boundary

“ResearchBench turns your own sources into a research workspace. Persistence
and indexing stay in your browser. Generation sends the selected source text
and your request to the chosen API, using your own key. A small notebook can
fit entirely into that selected context.”

Show the three panes, direct Mistral default and explicit OpenRouter alternative.
Regional inference, retention and training controls are separate choices; local
storage is not an automatic GDPR compliance guarantee.

## 0:45–2:00: sources and local search

Show the two original NIST inputs in the notebook: a two-page AI RMF excerpt
and the January 2023 launch article. Explain the excerpt's original page numbers.
Show a German and an English semantic search and open the source passage.
Import, embedding and search work without a generation key. The public local
model/runtime files are downloaded once subject to browser caching.

## 2:00–3:15: chat and citations

Show the prepared, manually checked answer and click its citation to reveal
the exact source text. Ask how the four functions relate, or use the checked question
about the consultation process. Identify prepared content as prepared.

One live chat request is optional. After 15 seconds, or immediately on an error,
cancel it and say: “I’ll show the answer I prepared and checked earlier.” Switch
to that answer without retrying. Never present it as the completed live request.

## 3:15–4:00: prepared learning material

Switch between the manually checked Summary, FAQ and Study Guide. Show their
citations and coverage label. These were generated before recording. Do not press
Regenerate during the recording.

## 4:00–5:30: prepared podcast

Play a 20–30 second English exchange, then pause. Show contribution-level
transcript seeking, a citation and MP3 download. Explain that the spoken dialog
goes to the speech API while audio assembly and persistence stay local.
English is the default; German speech remains experimental because these
British presets do not provide native German pronunciation. Playback speed
does not change the exported MP3. No new speech request is needed for this demo.

## 5:30–7:00: engineering

Show Rust/WASM parsing, Unicode source spans, fixed-size overlap and cosine
retrieval; explain local multilingual E5 embeddings and IndexedDB. Describe the
shared schema and citation membership checks, local encoder Worker and atomic
final audio publication. Explain that citation validity proves a source span
exists, not that every generated claim is semantically supported. Say explicitly:
“Citations link to source passages. ResearchBench does not automatically verify
factual support, and generated content can include unsupported claims.”

Show only gate results actually run for the final SHA. Distinguish mocked API
security/browser tests from owner-operated real generation and listening tests.
The source archive and license in the footer match the deployed commit.

## 7:00–7:30: limits and close

Text PDFs only, no OCR or external fact-checking. Generated answers must be
checked against the provided sources. Browser storage can be evicted; a warm
open app can use local data offline, but offline cold start is not guaranteed.
Show the repository and live demo links.

## Acceptance and submission

Manually review the prepared chat, Summary, FAQ, Study Guide and podcast selected
for the recording, including names, numbers, qualifiers and attribution. Show
checked statements, or identify unsupported statements and limitations explicitly;
do not present citations as automatic proof. Preserve unsuccessful trials in the
private evidence record. The nine negative grounding cases remain FAIL, accepted
as a disclosed v0.0.3 prototype limitation rather than a blocker for recording.
Functional and security/privacy failures still block acceptance.

The owner publishes the accepted recording as an unlisted YouTube video. Use a
ResearchBench title and the repository/live URLs in the description. Review the
whole upload for duration, legibility, audio, factual claims and exposed private
information. From an unauthenticated external browser profile, check GitHub,
the live entry/import flow and the YouTube video (1080p, audio and seeking).
The owner replies in the existing Everlast invitation thread with all three
links. Keep test receipts and operational details outside this repository.
