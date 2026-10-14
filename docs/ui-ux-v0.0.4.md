# v0.0.4 UI/UX milestone — local candidate

Baseline: `8356e895f451e1b6c3f888824d795d84e824b5b9` (`v0.0.3`).
This records the UI implementation and local acceptance before final release authorization. The separately authorized final release labels the verified source commit; operational receipts remain outside the repository.

## Rendered baseline audit and priorities

The independent audit used the immutable v0.0.3 static artifact in fresh, owned browser contexts. PDF import, mocked Chat and every Studio generator, source references/viewer, EN/DE settings, and empty states were exercised at 320, 375, 430, 768, 1280 and 1920 CSS pixels. Mocked outputs are layout fixtures, not factual-accuracy evidence. Baseline captures and measurements: `.cache/ui-v004/baseline-audit/`; root corroboration: `.cache/ui-v004/before-*.png`.

| Priority | Finding | Evidence / correction |
| --- | --- | --- |
| P1 | 320px header overflows by 13px; mobile Settings loses its accessible name when its text is hidden | Rendered geometry and failed role lookup. Wrap/reflow header; permanent accessible name. |
| P1 | Secondary text and critical limitations are very small and insufficiently contrasted | Chat footnote 8px / 4.05:1; privacy text 9px / 3.82:1 on light surfaces. Increase readable type and semantic contrast tokens. |
| P1 | Keyboard focus on the question textarea is explicitly suppressed | Restore a visible input/composer indicator. |
| P1 | Modal titles are not programmatically associated; focus/return need explicit verification | Link titles/descriptions, verify native dialog lifecycle and safe confirmation focus. |
| P1 | Tablet stacking and fixed-height panes compress Studio; mobile content competes with the composer | Rendered 768px Podcast has little transcript space. Use one active pane on tablet/mobile, flowing content and reachable actions. |
| P2 | Small icon actions and source references are difficult touch targets | Standardize control heights and padding; wrap long references. |
| P2 | Active pane/content selections are visual only; file upload focus is invisible | Add button pressed states, focus-visible upload affordance, skip link and clearer landmarks. |
| P2 | Feedback resides only in Research, so other mobile panes hide operation/error states | Share visible operation feedback across panes. |
| P2 | Hardcoded pastel colors and native control styles have no dark-mode counterpart | Central semantic tokens and native color-scheme, including status/highlight/audio surfaces. |
| Cosmetic | Inconsistent typography, spacing and repeated color overrides | Consolidate the existing stylesheet while preserving the warm canvas/purple identity. |

No P0 was observed. Automated measurements supplement visual and keyboard review; they are not a WCAG conformance certification.

## Agreed implementation plan (before UI modifications)

1. Add an early same-origin synchronous theme initializer and small shared Svelte appearance store. Validate System/Light/Dark preference; tolerate blocked storage; support live OS and explicit changes without remounting application/audio. Use CSS for System color resolution.
2. Preserve all existing CSP directives. Recognize only the exact initializer path in the document artifact validator, with negative controls. Keep the CSP meta before active resources and verify first paint under delayed application bootstrap.
3. Consolidate colors into semantic CSS tokens, refine type/spacing/controls and light/dark parity. Retain native selects and escaped text rendering; no Markdown parser or design-system dependency.
4. Improve existing markup and interactions: appearance selector in Settings, named/titled controls/dialogs, keyboard focus/return, selection states, upload affordance, shared feedback and reduced-motion scrolling.
5. Adapt the existing pane navigation to tablet/mobile with flowing content, safe areas and comfortably sized controls. Test all six widths, long content, reduced height, text resizing and keyboard paths.
6. Add focused appearance/responsive/accessibility browser tests and automated a11y scanning. Run existing unit/type/build/Rust/browser/security gates, inspect screenshots, then obtain independent final review.

Ownership is split between theme/bootstrap, CSS, and page/component markup. Controller/provider/schema/generation behavior, README grounding explanation and nine semantic negative fixtures are frozen.

## Verification and final review

Implementation, rendered checks and independent review are completed below.

## Implemented candidate

The theme, markup and styling changes below were independently reviewed before release authorization. The authorized release updates application and Rust crate version metadata to 0.0.4 without changing generation behavior.

### Theme architecture

`static/theme-init.js` restores a validated `researchbench:theme` preference in a synchronous same-origin head script before application bootstrap. The script follows the generated early CSP meta. `src/lib/theme.ts` owns the preference store, validation, persistence and cross-tab synchronization; `+layout.svelte` initializes and cleans up the listener. System preference resolves through CSS `prefers-color-scheme`; explicit Light/Dark overrides it immediately without navigation, controller recreation or audio remounting. Storage failures retain an in-memory choice.

`src/app.css` centralizes canvas/surface/text/accent/status/highlight/focus/control-boundary tokens. Native `color-scheme` styles selects/options and audio controls. All existing CSP directives and Worker permissions are unchanged; artifact validation additionally recognizes only the exact `/theme-init.js` URL and rejects hostile variants.

### Component and interaction changes

- Shared button, icon-button, input/select, panel, citation and status styles now use the same palette, spacing and state patterns. Important disclosures use readable type and contrast; controls generally provide 44px hit areas.
- Native language/notebook/appearance/podcast selects and provider radios retain their browser keyboard behavior. Content/pane switches are named button groups with pressed states and associated region IDs, rather than incomplete custom ARIA tab/listbox implementations.
- Settings and confirmation dialogs have associated titles/descriptions, bounded keyboard traversal, safe initial confirmation focus, native Escape/return behavior, and tested backdrop dismissal. The shared helper leaves `showModal()` responsible for modal inertness.
- Skip-to-workspace navigation, named sidebar landmarks, notebook-name focus, source-viewer focus/return, visible composer/scroll-region focus and reduced-motion scrolling improve keyboard use.
- Global operation/error feedback stays available across pane selections. Podcast seek names include their visible speaker/time labels and their contribution purpose.
- Tablet/mobile use one selected pane and normal document scrolling. Header/footer, long filenames/citations/output, modal sizing and safe-area CSS adapt to narrow or reduced-height viewports. Desktop Studio has a usable minimum content area.
- Rendering remains escaped plain text. No Markdown parser, HTML sink, new generator, semantic validator or product feature was introduced. Existing source highlights and generic pre/code styles use the theme tokens.

### Confirmed defects corrected during verification

Initial automated scans found duplicate unnamed complementary landmarks and an empty scroll region without keyboard focus. Both were fixed. Generated Podcast scans found a visible-label/accessibility-name mismatch; names and the corresponding exact-purpose test selectors were corrected without changing seek/time assertions. Independent rendering then demonstrated Chromium blank-page overflow from absolutely positioned hidden seek labels; positioning their button parent removed the overflow. A desktop page-height regression assertion now covers the filled Studio states. Four narrowly explained Svelte annotations permit keyboard focus on named scrolling regions; their behavior is verified rather than replaced with misleading interactive roles.

## Responsive and accessibility verification matrix

Both Chromium and Firefox were exercised locally with owned profiles and synthetic provider responses. Actual PDFium/Rust/WASM and local embeddings were used; no real key or paid generation was required.

| CSS viewport | Layout / checks | Evidence |
| --- | --- | --- |
| 320×844 | Narrow header reflow; Sources/Research/Studio navigation; named Settings; all Studio tabs; modal and long-content wrapping; Light/Dark; no horizontal overflow | `after/*-320-*.png`, `workflow-evidence/*-320-*.png`, `states/*-320-*.png` |
| 375×844 | Standard mobile controls, dialogs and every Studio tab; Light/Dark; no overflow | `after/*-375-*.png` |
| 430×844 | Large mobile; same controls and states; Light/Dark; no overflow | `after/*-430-*.png` |
| 768×1000 | Tablet single-pane navigation and flowing generated content; native controls/dialogs; Light/Dark; no overflow | `after/*-768-*.png`, `workflow-evidence/*-768-*.png` |
| 1280×1000 | Three panes; all generated outputs/source viewer; usable Studio scroll region; Light/Dark; no horizontal or phantom blank-page overflow | `after/*-1280-*.png`, `workflow-evidence/*-1280-*.png` |
| 1920×1000 | Wide desktop hierarchy and spacing; native controls/dialogs; Light/Dark; no overflow | `after/*-1920-*.png` |
| 640×500 | Reflow equivalent to 1280px desktop at 200% zoom; dialog bounds and keyboard paths | `appearance.spec.ts` |
| 320–1920, 200% root text | Separate text-resizing stress test; header actions do not overlap; settings stay within viewport | `after/*-text200-*.png` |

Evidence paths above are relative to the local ignored `.cache/ui-v004/` directory. They contain fictional fixture content. Baseline captures precede implementation; no dark baseline existed. Final Light/Dark captures cover the redesigned interface. Supplemental loading and controlled 429 captures confirm feedback in all mobile pane selections and Light/Dark at 320/768/1280, with zero page errors or horizontal overflow.

Automated checks use the pinned test-only `axe-core` dependency and its [documented rendered-content API](https://github.com/dequelabs/axe-core/blob/develop/doc/API.md). WCAG A/AA through 2.2 and best-practice scans include empty/Settings/Podcast surfaces at all six widths, EN/DE settings, and filled Chat/all Studio/source-viewer states at 320/768/1280. Scans report zero violations in those tested states; incomplete/manual rules are not treated as a conformance proof.

### Remaining limitations and advisory

- No full WCAG conformance claim. A real screen-reader session, physical mobile keyboard/notch behavior, Safari, and platform-native popup appearance remain outside the verified coverage. Reduced viewport and text-resizing tests supplement these manual checks.
- Empty desktop Research at 1280×900 needs a short internal scroll to see all onboarding content; it remains keyboard accessible. Independent review classifies this as a low advisory.
- Generated-content factual support is still not semantically verified. README and generation contracts are unchanged; the nine semantic negative fixtures remain unchanged.

## Gate results

All required local gates completed.

| Gate | Final result | Local evidence |
| --- | --- | --- |
| `pnpm verify` | PASS: 326 unit tests / 21 files; 6 native Rust tests; typecheck 0 errors, 0 warnings; production build successful | `.cache/ui-v004/verify-final.log` |
| `pnpm test:e2e` | PASS: 64 cases, Chromium and Firefox; 7.2 minutes | `.cache/ui-v004/e2e-final.log` |
| `pnpm test:security` | PASS: 28 existing mocked/CSP/runtime cases, both engines; 1.7 minutes | `.cache/ui-v004/security-final.log` |
| `pnpm assets:prepare -- --verify` | PASS: 27 pinned self-hosted files, 220 MiB | `.cache/ui-v004/assets.log` |
| `pnpm wasm:build` | PASS | `.cache/ui-v004/wasm.log` |
| Final rebuilt bytes vs full E2E-tested build | PASS: 54 files, zero byte differences after comment-only accessibility annotations | `.cache/ui-v004/final-build-byte-comparison.json` |
| Diff scope/whitespace | PASS; README, controller/providers/storage/schema/grounding prompts unchanged | `git diff --check`, scoped `git diff --exit-code` |
| Immutable semantic negative fixture | Unchanged SHA-256 `f50046bb8d050a06d2b29262e55b5a1947e89e3a5d5ebb6866715e1f4f22a506`; no new semantic acceptance claim | Existing private investigation fixture |
| Independent review | READY: no remaining blocker/high/medium finding; one low visual advisory | `.cache/ui-v004/final-review/review.md` |

The review independently exercised 36 focused unit checks, 232 visual captures across both engines/themes/six widths, 12 dialog keyboard checks, and the corrected Chromium Podcast page-height mechanism. It read the final full-gate logs and closed the review afterward. Root additionally inspected representative before/after and loading/error screenshots. These are actual rendered checks, not inferred polish from test totals.

Earlier failed/interrupted attempts are retained separately. The last security failure came from an old fixture mutating the first script, which is now the external initializer; its body is ignored by browsers. The test now explicitly finds and tampers the inline SvelteKit bootstrap, verifies it exists, and still requires rejection. Independent reproduction confirmed the mechanism and correction. Production policies were not relaxed. The interrupted E2E attempt used obsolete exact seek labels; final contribution selection and all original timeline assertions pass.

### Reproduce local gates

```sh
mkdir -p /dev/shm/researchbench-ui-v004
TMPDIR=/dev/shm/researchbench-ui-v004 pnpm verify
TMPDIR=/dev/shm/researchbench-ui-v004 pnpm test:e2e
TMPDIR=/dev/shm/researchbench-ui-v004 pnpm test:security
pnpm assets:prepare -- --verify
pnpm wasm:build
git diff --check
```

The owned temporary directory avoids a quota problem in the shared system temporary filesystem. Browser binaries use the project's established Playwright cache configuration. During implementation, CI-equivalent local checks ran without a remote CI run because commit/push had not yet been authorized. Commit-bound source offers and release/deployment acceptance remain part of the later authorized release procedure.

### Representative screenshot pairs

- Desktop before: `.cache/ui-v004/baseline-audit/chromium-1280-empty.png`; Light after: `.cache/ui-v004/after/chromium-light-1280-chat.png`; Dark after: `.cache/ui-v004/after/chromium-dark-1280-chat.png`.
- Mobile before: `.cache/ui-v004/baseline-audit/chromium-375-empty.png`; Light after: `.cache/ui-v004/after/chromium-light-375-chat.png`; Dark after: `.cache/ui-v004/after/chromium-dark-375-chat.png`.
- Filled source/Studio/Podcast: `.cache/ui-v004/workflow-evidence/`; independent review captures: `.cache/ui-v004/final-review/`.

## Decision

Local UI/theme milestone **READY**. No confirmed P0/P1 defect remains. Full WCAG certification and real-device acceptance are not claimed. GitHub visibility was checked as PRIVATE; HEAD and `v0.0.3` still resolve to the baseline. At completion of the implementation review, no commit, push, new tag, publication or deployment had been performed and production v0.0.3 was unchanged. The subsequent final release is separately authorized; preserve its signed v0.0.3 tag and rollback artifact.
