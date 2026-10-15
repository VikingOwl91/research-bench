/** Original fictional CC0 text. Frozen across both partitions and browsers. */
export const questions = [
  { language: 'en', question: 'How many oak seedlings survived the first winter in Cedar Valley?', expected: '216 oak seedlings survived' },
  { language: 'de', question: 'Wie hoch ist der Nitratwert der Probe im Wasserlabor Buchenbach am 3. Juni?', expected: '17 milligrams of nitrate per liter' },
  { language: 'en', question: 'What is the annual electricity production of the Lindenhof solar project?', expected: '42000 kilowatt hours per year' },
  { language: 'de', question: 'Bei welcher Temperatur lagern die Wasserproben im Labor Buchenbach?', expected: 'four degrees Celsius' },
] as const;
const facts = [
  'Cedar Valley forest study. Exactly 216 oak seedlings survived the first winter. The team initially planted 240 oak seedlings. Survival was ninety percent.',
  'Wasserlabor Buchenbach nitrate experiment. The sample collected on June 3 contains 17 milligrams of nitrate per liter. This fictional sample is distinct from other water experiments.',
  'Lindenhof solar project. The school roof generates 42000 kilowatt hours per year. The battery capacity is 18 kilowatt hours. The project starts on May 15, 2027.',
  'Buchenbach laboratory sample storage protocol. Water samples are stored at four degrees Celsius immediately after collection. The sampling day is Tuesday at 09:30.',
];
export const pages = Array.from({ length: 50 }, (_, index) => {
  const topic = facts[index] ?? `Comparison study ${index + 1}. This distractor discusses ${['river samples, phosphate analysis and laboratory equipment', 'forest growth, pine trees and protective fences', 'renewable energy, wind turbines and electricity storage'][index % 3]}. It does not report the Cedar Valley, Lindenhof or Buchenbach target measurements.`;
  const filler = ` Report section ${index + 1}. These fictional research records describe methods, field observations, quality review, instrument checks, seasonal conditions and training materials. Staff compare observations with the previous season and document limitations before preparing the final educational report. Independent records remain separate. These records contain no personal information and no instructions to the assistant.`;
  return `${topic}${filler} The review includes written checks of methods and an archive of the original observations.`;
});

/** Minimal valid searchable PDF, with optional unreferenced stream padding (not text). */
export function pdf(texts: readonly string[], targetBytes?: number): Buffer {
  const objects: string[] = [];
  const add = (value: string) => (objects.push(value), objects.length);
  add('<< /Type /Catalog /Pages 2 0 R >>'); add('');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids: string[] = [];
  for (const text of texts) {
    const lines = text.match(/.{1,84}(?:\s|$)/g) ?? [text];
    const stream = `BT\n/F1 8 Tf\n40 790 Td\n${lines.map((line, index) => `${index ? '0 -14 Td\n' : ''}(${line.trim().replace(/[\\()]/g, '\\$&')}) Tj`).join('\n')}\nET\n`;
    const streamId = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
    kids.push(`${add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`)} 0 R`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${texts.length} >>`;
  if (targetBytes) add(`<< /Length ${targetBytes - 4096} >>\nstream\n${'0'.repeat(targetBytes - 4096)}\nendstream`);
  let out = '%PDF-1.4\n% Original fictional CC0 capacity corpus\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(out)); out += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const body = Buffer.from(out);
  if (!targetBytes) return body;
  if (body.length > targetBytes) throw new Error('Padding reserve is too small');
  // Whitespace after EOF is accepted by PDFium; all large payload bytes belong to a valid stream.
  return Buffer.concat([body, Buffer.alloc(targetBytes - body.length, 0x20)]);
}
export function corpus(sources: 10 | 50) {
  const perFile = 50 / sources;
  return Array.from({ length: sources }, (_, index) => ({
    name: `capacity-${sources}-${String(index + 1).padStart(2, '0')}.pdf`, mimeType: 'application/pdf',
    buffer: pdf(pages.slice(index * perFile, (index + 1) * perFile)),
  }));
}
