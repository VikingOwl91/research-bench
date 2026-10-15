/** Original deterministic CC0 PDF content for paint-mode and scale regressions. */
export function provenancePdf(pages) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids = [];
  for (const { stream, resources = '' } of pages) {
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    const streamId = objects.length;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> ${resources} >> /Contents ${streamId} 0 R >>`);
    kids.push(`${objects.length} 0 R`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
  let output = '%PDF-1.4\n% Original ResearchBench CC0 fixture\n';
  const offsets = [];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}

export const paintModePages = [
  { text: 'VISIBLE BLACK OUTLINE', marked: false, stream: 'BT /F1 18 Tf 1 Tr 1 1 1 rg 0 0 0 RG 72 720 Td (VISIBLE BLACK OUTLINE) Tj ET' },
  { text: 'VISIBLE FILLED BLACK OUTLINE', marked: false, stream: 'BT /F1 18 Tf 2 Tr 1 1 1 rg 0 0 0 RG 72 720 Td (VISIBLE FILLED BLACK OUTLINE) Tj ET' },
  { text: 'NONPAINTING CLIP TEXT', marked: true, stream: 'BT /F1 18 Tf 7 Tr 72 720 Td (NONPAINTING CLIP TEXT) Tj ET' },
  { text: 'TRANSPARENT FILL TEXT', marked: true, stream: 'q /GS1 gs BT /F1 18 Tf 0 Tr 72 720 Td (TRANSPARENT FILL TEXT) Tj ET Q', resources: '/ExtGState << /GS1 << /Type /ExtGState /ca 0 /CA 0 >> >>' },
  { text: 'VISIBLE WHITE ON BLACK', marked: true, stream: '0 0 0 rg 0 0 595 842 re f BT /F1 18 Tf 1 1 1 rg 72 720 Td (VISIBLE WHITE ON BLACK) Tj ET' },
  { text: 'TRANSPARENT STROKE TEXT', marked: true, stream: 'q /GS1 gs BT /F1 18 Tf 1 Tr 72 720 Td (TRANSPARENT STROKE TEXT) Tj ET Q', resources: '/ExtGState << /GS1 << /Type /ExtGState /ca 1 /CA 0 >> >>' },
  { text: 'VISIBLE STROKE TRANSPARENT FILL', marked: false, stream: 'q /GS1 gs BT /F1 18 Tf 2 Tr 72 720 Td (VISIBLE STROKE TRANSPARENT FILL) Tj ET Q', resources: '/ExtGState << /GS1 << /Type /ExtGState /ca 0 /CA 1 >> >>' },
  { text: 'VISIBLE FILL TRANSPARENT STROKE', marked: false, stream: 'q /GS1 gs BT /F1 18 Tf 2 Tr 72 720 Td (VISIBLE FILL TRANSPARENT STROKE) Tj ET Q', resources: '/ExtGState << /GS1 << /Type /ExtGState /ca 1 /CA 0 >> >>' },
  { text: 'VISIBLE FILLED CLIPPING', marked: false, stream: 'BT /F1 18 Tf 4 Tr 72 720 Td (VISIBLE FILLED CLIPPING) Tj ET' },
  { text: 'VISIBLE STROKED CLIPPING', marked: false, stream: 'BT /F1 18 Tf 5 Tr 1 1 1 rg 0 0 0 RG 72 720 Td (VISIBLE STROKED CLIPPING) Tj ET' },
  { text: 'VISIBLE FILLED STROKED CLIPPING', marked: false, stream: 'BT /F1 18 Tf 6 Tr 1 1 1 rg 0 0 0 RG 72 720 Td (VISIBLE FILLED STROKED CLIPPING) Tj ET' },
  { text: 'TRANSPARENT FILL AND STROKE', marked: true, stream: 'q /GS1 gs BT /F1 18 Tf 2 Tr 72 720 Td (TRANSPARENT FILL AND STROKE) Tj ET Q', resources: '/ExtGState << /GS1 << /Type /ExtGState /ca 0 /CA 0 >> >>' },
  { text: 'NONPAINTING NORMAL TEXT', marked: true, stream: 'BT /F1 18 Tf 3 Tr 72 720 Td (NONPAINTING NORMAL TEXT) Tj ET' },
];

// Generates 1.2MB, 100k-character valid parser input only when requested by tests;
// no large binary fixture is committed. Each alternate glyph is non-painting.
export function alternatingPaintPdf(spanCount = 50_000) {
  if (spanCount !== 5_000 && spanCount !== 50_000) throw new RangeError('Unsupported fixture size');
  const lines = spanCount === 5_000 ? 50 : 100;
  const columns = spanCount === 5_000 ? 200 : 1000;
  return provenancePdf([{ stream: Array.from({ length: lines }, (_, line) =>
    `BT /F1 0.5 Tf 5 ${820 - line * 7} Td ` + Array.from({ length: columns }, (_, index) => `${index % 2 ? 0 : 3} Tr (x) Tj`).join(' ') + ' ET').join('\n') }]);
}
