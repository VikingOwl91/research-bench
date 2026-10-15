//! ResearchBench's local core. Canonical text is immutable after parsing; offsets
//! exposed to JavaScript are half-open UTF-16 offsets, never UTF-8 byte offsets.

use serde::{Deserialize, Serialize};

pub const MAX_FILE_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_CHARACTERS: usize = 500_000;
pub const MAX_PAGES: usize = 2_000;

/// A UTF-16 span of a page's canonical text that is not visible in the
/// original PDF rendering (invisible render mode or near-white fill color).
/// Offsets are half-open UTF-16 offsets into `text`, matching the citation
/// contract. Absent for text sources and for PDFs without hidden text.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HiddenSpan {
    pub start: u32,
    pub end: u32,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PageText {
    pub page: u32,
    pub text: String,
    #[serde(default, rename = "hiddenSpans", skip_serializing_if = "Option::is_none")]
    pub hidden_spans: Option<Vec<HiddenSpan>>,
}

/// Per-character visibility derived from Pdfium render mode and fill color.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CharVisibility {
    Visible,
    Invisible,
    White,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TextChunk {
    pub page: u32,
    pub start: u32,
    pub end: u32,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SearchResult {
    pub index: usize,
    pub score: f64,
}

/// Normalize once, before chunk offsets are calculated. Do not collapse spaces:
/// preserve prose, Markdown indentation and the original page layout as text.
pub fn canonicalize(text: &str) -> String {
    canonicalize_with_visibility(text, &[]).0
}

/// Canonicalize like [`canonicalize`] while carrying per-character visibility
/// flags through the exact same transformations, so hidden spans are reported
/// in the coordinates of the canonical text. `visibility[i]` describes the
/// i-th char of `text`; missing flags are treated as visible.
pub fn canonicalize_with_visibility(
    text: &str,
    visibility: &[CharVisibility],
) -> (String, Option<Vec<HiddenSpan>>) {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut spans: Vec<(u32, u32, u8)> = Vec::new(); // (start, end, kind: 1 invisible, 2 white)
    let mut utf16 = 0u32;
    let mut run: Option<(u32, u8)> = None;
    let mut started = false;
    let mut index = 0usize;
    let close_run = |spans: &mut Vec<(u32, u32, u8)>, run: &mut Option<(u32, u8)>, end: u32| {
        if let Some((start, kind)) = run.take() {
            if end > start {
                spans.push((start, end, kind));
            }
        }
    };
    while index < chars.len() {
        let current = chars[index];
        let vis = visibility.get(index).copied().unwrap_or(CharVisibility::Visible);
        if !started && current == '\u{feff}' {
            index += 1;
            continue;
        }
        started = true;
        if current == '\0' {
            index += 1;
            continue;
        }
        let emitted = if current == '\r' {
            if index + 1 < chars.len() && chars[index + 1] == '\n' {
                index += 1;
            }
            '\n'
        } else {
            current
        };
        match vis {
            CharVisibility::Visible => close_run(&mut spans, &mut run, utf16),
            CharVisibility::Invisible | CharVisibility::White => {
                let kind = if vis == CharVisibility::Invisible { 1 } else { 2 };
                match &mut run {
                    Some((_, existing)) => {
                        if kind == 1 {
                            *existing = 1;
                        }
                    }
                    None => run = Some((utf16, kind)),
                }
            }
        }
        out.push(emitted);
        utf16 += emitted.len_utf16() as u32;
        index += 1;
    }
    close_run(&mut spans, &mut run, utf16);
    let hidden_spans = if spans.is_empty() {
        None
    } else {
        Some(
            spans
                .into_iter()
                .map(|(start, end, kind)| HiddenSpan {
                    start,
                    end,
                    kind: if kind == 1 { "invisible" } else { "white" }.to_string(),
                })
                .collect(),
        )
    };
    (out, hidden_spans)
}

pub fn parse_text_bytes(bytes: &[u8]) -> Result<Vec<PageText>, String> {
    validate_file_size(bytes)?;
    let raw = std::str::from_utf8(bytes)
        .map_err(|_| "Die Textdatei ist nicht gültig als UTF-8 kodiert.".to_string())?;
    if raw.contains('\0') {
        return Err("Die Datei enthält Binärdaten; bitte UTF-8-Text verwenden.".into());
    }
    let text = canonicalize(raw);
    if text.chars().count() > MAX_CHARACTERS {
        return Err("Die Quelle überschreitet 500.000 extrahierte Zeichen.".into());
    }
    if text.trim().is_empty() {
        return Err("Die Quelle enthält keinen durchsuchbaren Text.".into());
    }
    Ok(vec![PageText { page: 1, text, hidden_spans: None }])
}

fn validate_file_size(bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() {
        return Err("Die Datei ist leer.".into());
    }
    if bytes.len() > MAX_FILE_BYTES {
        return Err("Die Datei überschreitet die Grenze von 10 MiB.".into());
    }
    Ok(())
}

/// Fixed Unicode-scalar windows, bounded to each page. A boundary table makes
/// UTF-8 slicing and JavaScript UTF-16 offsets refer to the exact same passage.
pub fn split_pages(
    pages: &[PageText],
    size: usize,
    overlap: usize,
) -> Result<Vec<TextChunk>, String> {
    if size == 0 || overlap >= size {
        return Err("Chunk-Größe muss positiv und Überlappung kleiner als die Größe sein.".into());
    }
    if pages.len() > MAX_PAGES || pages.iter().any(|p| p.page == 0) {
        return Err("Ungültige oder zu viele Quellseiten.".into());
    }
    let mut total = 0;
    let mut chunks = Vec::new();
    for page in pages {
        let mut boundaries = Vec::new();
        let mut utf16 = 0u32;
        for (byte, character) in page.text.char_indices() {
            boundaries.push((byte, utf16));
            utf16 += character.len_utf16() as u32;
        }
        let count = boundaries.len();
        total += count;
        if total > MAX_CHARACTERS {
            return Err("Die Quelle überschreitet 500.000 extrahierte Zeichen.".into());
        }
        boundaries.push((page.text.len(), utf16));
        if page.text.trim().is_empty() {
            continue;
        }
        let mut start = 0;
        while start < count {
            let end = start.saturating_add(size).min(count);
            let (start_byte, start_utf16) = boundaries[start];
            let (end_byte, end_utf16) = boundaries[end];
            chunks.push(TextChunk {
                page: page.page,
                start: start_utf16,
                end: end_utf16,
                text: page.text[start_byte..end_byte].into(),
            });
            if end == count {
                break;
            }
            start = end - overlap;
        }
    }
    Ok(chunks)
}

/// Flat row-major vectors. f64 accumulation avoids overflow/underflow for valid
/// finite Float32 values. Zero rows have no cosine and are omitted; ties sort by
/// their source index for reproducible retrieval.
pub fn search_vectors(
    matrix: &[f32],
    query: &[f32],
    k: usize,
) -> Result<Vec<SearchResult>, String> {
    if query.is_empty() || !matrix.len().is_multiple_of(query.len()) {
        return Err("Ungültige Vektor-Dimensionen.".into());
    }
    if !query.iter().chain(matrix.iter()).all(|v| v.is_finite()) {
        return Err("Vektoren enthalten nicht-endliche Werte.".into());
    }
    let query_norm: f64 = query.iter().map(|&v| (v as f64).powi(2)).sum();
    if query_norm == 0.0 {
        return Err("Der Suchvektor ist leer; bitte erneut indexieren.".into());
    }
    let mut results = Vec::new();
    for (index, row) in matrix.chunks_exact(query.len()).enumerate() {
        let norm: f64 = row.iter().map(|&v| (v as f64).powi(2)).sum();
        if norm == 0.0 {
            continue;
        }
        let dot: f64 = row
            .iter()
            .zip(query)
            .map(|(&a, &b)| a as f64 * b as f64)
            .sum();
        results.push(SearchResult {
            index,
            score: (dot / (norm.sqrt() * query_norm.sqrt())).clamp(-1.0, 1.0),
        });
    }
    results.sort_unstable_by(|a, b| b.score.total_cmp(&a.score).then(a.index.cmp(&b.index)));
    results.truncate(k);
    Ok(results)
}

#[cfg(target_arch = "wasm32")]
mod browser {
    use super::*;
    use pdfium_render::prelude::*;
    use std::cell::RefCell;
    use wasm_bindgen::prelude::*;

    // The application Worker serializes messages; a single Pdfium binding is
    // reused. Documents/pages/text handles are dropped after each byte import.
    thread_local! { static PDFIUM: RefCell<Option<Pdfium>> = const { RefCell::new(None) }; }

    fn js_error(message: String) -> JsValue {
        JsValue::from_str(&message)
    }
    fn serialize<T: Serialize>(value: &T) -> Result<JsValue, JsValue> {
        serde_wasm_bindgen::to_value(value)
            .map_err(|_| js_error("WASM-Ergebnis konnte nicht übertragen werden.".into()))
    }

    #[wasm_bindgen]
    pub fn parse_text(bytes: &[u8]) -> Result<JsValue, JsValue> {
        serialize(&parse_text_bytes(bytes).map_err(js_error)?)
    }

    #[wasm_bindgen]
    pub fn chunk_pages(pages: JsValue, size: usize, overlap: usize) -> Result<JsValue, JsValue> {
        let pages: Vec<PageText> = serde_wasm_bindgen::from_value(pages)
            .map_err(|_| js_error("Ungültiges Seitenformat.".into()))?;
        serialize(&split_pages(&pages, size, overlap).map_err(js_error)?)
    }

    #[wasm_bindgen]
    pub fn cosine_search(matrix: &[f32], query: &[f32], k: usize) -> Result<JsValue, JsValue> {
        serialize(&search_vectors(matrix, query, k).map_err(js_error)?)
    }

    fn pdf_error(error: PdfiumError) -> String {
        match error {
            PdfiumError::PdfiumLibraryInternalError(PdfiumInternalError::PasswordError | PdfiumInternalError::SecurityError) =>
                "Die PDF ist verschlüsselt oder passwortgeschützt. Bitte eine ungeschützte Datei verwenden.".into(),
            PdfiumError::PdfiumWasmModuleNotInitialized => "Pdfium wurde noch nicht initialisiert.".into(),
            _ => "Die PDF ist beschädigt oder kann nicht gelesen werden.".into(),
        }
    }

    #[wasm_bindgen]
    pub fn parse_pdf(bytes: &[u8]) -> Result<JsValue, JsValue> {
        validate_file_size(bytes).map_err(js_error)?;
        PDFIUM.with(|cell| {
            let mut instance = cell.borrow_mut();
            if instance.is_none() {
                let bindings = Pdfium::bind_to_system_library().map_err(|e| js_error(pdf_error(e)))?;
                *instance = Some(Pdfium::new(bindings));
            }
            let pdfium = instance.as_ref().ok_or_else(|| js_error("Pdfium ist nicht verfügbar.".into()))?;
            let document = pdfium.load_pdf_from_byte_slice(bytes, None).map_err(|e| js_error(pdf_error(e)))?;
            if document.pages().len() as usize > MAX_PAGES {
                return Err(js_error("Die PDF überschreitet die Grenze von 2.000 Seiten.".into()));
            }
            let mut total = 0usize;
            let mut pages = Vec::new();
            let mut has_text = false;
            for (index, page) in document.pages().iter().enumerate() {
                let extracted = page.text().map_err(|e| js_error(pdf_error(e)))?;
                // Check Pdfium's count before allocating its full page text.
                if extracted.len() < 0 || extracted.len() as usize > MAX_CHARACTERS - total {
                    return Err(js_error("Die Quelle überschreitet 500.000 extrahierte Zeichen.".into()));
                }
                let all = extracted.all();
                // Per-character visibility from render mode and fill color. Only
                // characters whose origin lies on the page are considered,
                // mirroring the bounded extraction used for the page text. The
                // flags are used only when the aligned char sequence matches the
                // extracted text exactly, so extraction itself never changes.
                let page_rect = page.page_size();
                let (page_left, page_right) = (page_rect.left().value as f64, page_rect.right().value as f64);
                let (page_bottom, page_top) = (page_rect.bottom().value as f64, page_rect.top().value as f64);
                let mut visibility: Option<Vec<CharVisibility>> = None;
                let mut raw = String::with_capacity(all.len());
                let mut flags: Vec<CharVisibility> = Vec::new();
                let mut aligned = true;
                for character in extracted.chars().iter() {
                    let (x, y) = match character.origin() {
                        Ok(origin) => origin,
                        Err(_) => { aligned = false; break; }
                    };
                    let (x, y) = (x.value as f64, y.value as f64);
                    if !(page_left <= x && x <= page_right && page_bottom <= y && y <= page_top) {
                        continue;
                    }
                    let flag = match character.render_mode() {
                        Ok(PdfPageTextRenderMode::Invisible) => CharVisibility::Invisible,
                        _ => match character.fill_color() {
                            Ok(color) if color.alpha() > 0
                                && color.red() >= 240
                                && color.green() >= 240
                                && color.blue() >= 240 =>
                            {
                                CharVisibility::White
                            }
                            _ => CharVisibility::Visible,
                        },
                    };
                    match character.unicode_string() {
                        Some(unit) => {
                            for c in unit.chars() {
                                raw.push(c);
                                flags.push(flag);
                            }
                        }
                        None => { aligned = false; break; }
                    }
                }
                if aligned && raw == all {
                    visibility = Some(flags);
                }
                let (text, hidden_spans) = match &visibility {
                    Some(flags) => canonicalize_with_visibility(&all, flags),
                    None => (canonicalize(&all), None),
                };
                total += text.chars().count();
                if total > MAX_CHARACTERS {
                    return Err(js_error("Die Quelle überschreitet 500.000 extrahierte Zeichen.".into()));
                }
                has_text |= !text.trim().is_empty();
                pages.push(PageText { page: index as u32 + 1, text, hidden_spans });
            }
            if !has_text {
                return Err(js_error("Die PDF enthält keinen extrahierbaren Text. Gescannte PDFs benötigen OCR, die hier nicht enthalten ist.".into()));
            }
            serialize(&pages)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn page(page: u32, text: &str) -> PageText {
        PageText {
            page,
            text: text.into(),
            hidden_spans: None,
        }
    }

    #[test]
    fn canonicalize_with_visibility_matches_canonicalize_without_flags() {
        let cases = [
            "",
            "plain text",
            "\u{feff}\u{feff}BOM twice",
            "a\r\nb\rc\0d",
            "mixed \u{feff}mid\0 and\r\nendings\r",
            "😀 emoji and ümläuts",
        ];
        for case in cases {
            let (text, spans) = canonicalize_with_visibility(case, &[]);
            assert_eq!(text, canonicalize(case), "case: {case:?}");
            assert_eq!(spans, None, "case: {case:?}");
        }
    }

    #[test]
    fn canonicalize_with_visibility_reports_hidden_spans_in_utf16_offsets() {
        // "ab😀cd": UTF-16 offsets 0..6; the astral char occupies 2..4.
        // Flags are per char: a, b, 😀, c, d.
        let text = "ab😀cd";
        let flags = [
            CharVisibility::Visible,
            CharVisibility::Visible,
            CharVisibility::Invisible,
            CharVisibility::White,
            CharVisibility::Visible,
        ];
        let (canonical, spans) = canonicalize_with_visibility(text, &flags);
        assert_eq!(canonical, text);
        let spans = spans.expect("hidden spans");
        // The invisible run absorbs the adjacent white char (invisible has priority).
        assert_eq!(spans.len(), 1);
        assert_eq!((spans[0].start, spans[0].end, spans[0].kind.as_str()), (2, 5, "invisible"));
        // Offsets slice the canonical text exactly.
        let utf16: Vec<u16> = canonical.encode_utf16().collect();
        for span in &spans {
            assert!(span.end <= utf16.len() as u32);
            assert!(span.start < span.end);
        }
        assert_eq!(String::from_utf16(&utf16[2..5]).unwrap(), "😀c");
    }

    #[test]
    fn canonicalize_with_visibility_merges_runs_and_tracks_transformations() {
        // CRLF collapses to one LF; the hidden run spans the merged newline.
        let text = "a\r\nb";
        let flags = [
            CharVisibility::Visible,
            CharVisibility::Invisible,
            CharVisibility::Invisible,
            CharVisibility::Visible,
        ];
        let (canonical, spans) = canonicalize_with_visibility(text, &flags);
        assert_eq!(canonical, "a\nb");
        let spans = spans.expect("hidden spans");
        assert_eq!(spans.len(), 1);
        assert_eq!((spans[0].start, spans[0].end), (1, 2));
        // NUL bytes are dropped and do not break span coordinates.
        let text = "x\0y";
        let flags = [
            CharVisibility::Visible,
            CharVisibility::Invisible,
            CharVisibility::White,
        ];
        let (canonical, spans) = canonicalize_with_visibility(text, &flags);
        assert_eq!(canonical, "xy");
        let spans = spans.expect("hidden spans");
        assert_eq!(spans.len(), 1);
        assert_eq!((spans[0].start, spans[0].end, spans[0].kind.as_str()), (1, 2, "white"));
    }

    #[test]
    fn normalizes_before_offsets_and_rejects_non_utf8() {
        assert_eq!(
            parse_text_bytes("\u{feff}Grüße\r\nWelt\rEnde".as_bytes()).unwrap()[0].text,
            "Grüße\nWelt\nEnde"
        );
        assert!(parse_text_bytes(&[0xff]).is_err());
        assert!(parse_text_bytes(b"hello\0world").is_err());
        assert!(parse_text_bytes(b" \n").is_err());
    }

    #[test]
    fn unicode_spans_match_javascript_slices() {
        let text = "ä😀b𐐀c";
        let chunks = split_pages(&[page(1, text)], 3, 1).unwrap();
        assert_eq!(
            chunks,
            vec![
                TextChunk {
                    page: 1,
                    start: 0,
                    end: 4,
                    text: "ä😀b".into()
                },
                TextChunk {
                    page: 1,
                    start: 3,
                    end: 7,
                    text: "b𐐀c".into()
                },
            ]
        );
        let utf16: Vec<_> = text.encode_utf16().collect();
        for chunk in chunks {
            assert_eq!(
                String::from_utf16(&utf16[chunk.start as usize..chunk.end as usize]).unwrap(),
                chunk.text
            );
        }
    }

    #[test]
    fn covers_full_pages_with_exact_overlap_and_no_cross_page_chunks() {
        let text: String = (0..2200)
            .map(|n| char::from_u32(0x4e00 + n).unwrap())
            .collect();
        let chunks = split_pages(&[page(1, &text), page(2, "zweite Seite")], 1000, 200).unwrap();
        assert_eq!(
            chunks
                .iter()
                .map(|c| (c.page, c.start, c.end))
                .collect::<Vec<_>>(),
            vec![(1, 0, 1000), (1, 800, 1800), (1, 1600, 2200), (2, 0, 12)]
        );
        let mut rebuilt = chunks[0].text.clone();
        for chunk in &chunks[1..3] {
            rebuilt.extend(chunk.text.chars().skip(200));
        }
        assert_eq!(rebuilt, text);
    }

    #[test]
    fn chunk_validation_and_empty_pages() {
        assert!(split_pages(&[page(1, "a")], 0, 0).is_err());
        assert!(split_pages(&[page(1, "a")], 4, 4).is_err());
        assert!(split_pages(&[page(0, "a")], 4, 1).is_err());
        assert!(split_pages(
            &[page(1, "a".repeat(MAX_CHARACTERS + 1).as_str())],
            1000,
            200
        )
        .is_err());
        assert!(split_pages(&[page(1, ""), page(2, " \n")], 1000, 200)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn cosine_ranks_and_skips_zero_rows_with_stable_ties() {
        let results =
            search_vectors(&[1., 0., 0., 1., 2., 0., 0., 0., -1., 0.], &[1., 0.], 9).unwrap();
        assert_eq!(
            results.iter().map(|r| r.index).collect::<Vec<_>>(),
            [0, 2, 1, 4]
        );
        assert_eq!(
            results.iter().map(|r| r.score).collect::<Vec<_>>(),
            [1., 1., 0., -1.]
        );
        assert!(search_vectors(&[1., 0.], &[1., 0.], 0).unwrap().is_empty());
        assert!(search_vectors(&[], &[1.], 4).unwrap().is_empty());
    }

    #[test]
    fn invalid_vector_input_is_rejected() {
        assert!(search_vectors(&[1.], &[], 2).is_err());
        assert!(search_vectors(&[1.], &[1., 2.], 2).is_err());
        assert!(search_vectors(&[1.], &[0.], 2).is_err());
        assert!(search_vectors(&[f32::NAN], &[1.], 2).is_err());
        assert!(search_vectors(&[1.], &[f32::INFINITY], 2).is_err());
        assert_eq!(
            search_vectors(&[f32::MAX, f32::MAX], &[f32::MAX, f32::MAX], 1).unwrap()[0].score,
            1.
        );
    }
}
