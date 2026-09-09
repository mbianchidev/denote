const PASSWORD_PDF_BASE64 =
  "JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgPGY3Y2YzMDE2YWVhMGEwZjE0MzllMjY4ZTA3YmYwYTMxZTFiOTc3NmVmZDc0ZGUyMThmMTBmNTE0MTQyNThiY2E+Cj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9UeXBlIC9QYWdlcwovQ291bnQgMQovS2lkcyBbIDQgMCBSIF0KPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDIgMCBSCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9UeXBlIC9QYWdlCi9SZXNvdXJjZXMgPDwKPj4KL01lZGlhQm94IFsgMC4wIDAuMCAxNDQgMTQ0IF0KL1BhcmVudCAyIDAgUgo+PgplbmRvYmoKNSAwIG9iago8PAovViA1Ci9SIDUKL0xlbmd0aCAyNTYKL1AgNDI5NDk2NzI5MgovRmlsdGVyIC9TdGFuZGFyZAovTyA8YmQ4OGE1NmUzNWI4MzBiMmU3ZWM2NDNkZTlmMjE1NTA5ZWRiYzMxYmM0YTI1M2RiN2EwODVkMzljZDBmZGQ1MmI2YmM5OGI1NjExNWZmY2JmZjlhZDVkYjQwODU0MmFkPgovVSA8ZWY0NTlhMTllMDU1OTEyZmUyYWIyOWQ4ZWM4NjExNjdiMjcyN2FiM2YwMjZhY2IyMmUwN2U0Zjk1MzNiMGUwMzAzZDc4MmFkZjc2NzlmYzZmM2NjM2FkYzQ2NzJlYTczPgovQ0YgPDwKL1N0ZENGIDw8Ci9BdXRoRXZlbnQgL0RvY09wZW4KL0NGTSAvQUVTVjMKL0xlbmd0aCAzMgo+Pgo+PgovU3RtRiAvU3RkQ0YKL1N0ckYgL1N0ZENGCi9PRSA8MDk2MzAzNjBiYTk5MzA0ZGJlMzQ2Y2ZiYzEzNDQ4ZDM4ZDlhNjliM2M4ZDdmZjcwNzk2N2NmMmI0M2Y3M2FiNz4KL1VFIDw3MGZjYzI1OTRjNzlhNzQ3OGYyZGZlNGUwNmEwM2IwMDA4YjA0ZDkwZmQ2NTg0MTk2Zjk3N2M3NmMzOGM4OTQ1PgovUGVybXMgPDA1MGY4MDcwMmYzZGZlZWNmMzE0M2ZjNTAwZWU5NzJlPgo+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE1IDAwMDAwIG4gCjAwMDAwMDAxMTMgMDAwMDAgbiAKMDAwMDAwMDE3MiAwMDAwMCBuIAowMDAwMDAwMjIxIDAwMDAwIG4gCjAwMDAwMDAzMTUgMDAwMDAgbiAKdHJhaWxlcgo8PAovU2l6ZSA2Ci9Sb290IDMgMCBSCi9JbmZvIDEgMCBSCi9JRCBbIDw2NTY2NjYzNTY0NjUzNjMwMzE2NTM1Mzk2NjM4MzYzMDM2NjMzNDYzMzkzMjM3MzI2NDM0MzI2NjM2MzgzNjMyPiA8NjU2NjY2MzU2NDY1MzYzMDMxNjUzNTM5NjYzODM2MzAzNjYzMzQ2MzM5MzIzNzMyNjQzNDMyNjYzNjM4MzYzMj4gXQovRW5jcnlwdCA1IDAgUgo+PgpzdGFydHhyZWYKODcwCiUlRU9GCg==";

interface PdfFixturePage {
  text?: string;
  lines?: readonly string[];
  rotation?: 0 | 90 | 180 | 270;
}

export function createPdfFixture(
  pages: PdfFixturePage[] = [{ text: "Synthetic PDF page" }],
  version = "1.7",
): Uint8Array {
  const pageObjectNumbers = pages.map((_, index) => 4 + index * 2);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${pages.length} /Kids [${pageObjectNumbers
      .map((number) => `${number} 0 R`)
      .join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  for (const [index, page] of pages.entries()) {
    const pageObject = pageObjectNumbers[index];
    const contentObject = pageObject + 1;
    const content = page.lines?.length
      ? pdfTextLines(page.lines)
      : page.text
        ? `BT /F1 16 Tf 36 96 Td (${escapePdfText(page.text)}) Tj ET`
        : "q 0.75 g 24 24 96 96 re f Q";
    const rotation = page.rotation ? ` /Rotate ${page.rotation}` : "";
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 144 144]${rotation} /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
  }

  let source = `%PDF-${version}\n%\u00e2\u00e3\u00cf\u00d3\n`;
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(new TextEncoder().encode(source).length);
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = new TextEncoder().encode(source).length;
  source += `xref\n0 ${objects.length + 1}\n`;
  source += "0000000000 65535 f \n";
  source += offsets
    .slice(1)
    .map((offset) => `${offset.toString().padStart(10, "0")} 00000 n \n`)
    .join("");
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  source += `startxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(source);
}

export function createLargePdfFixture(pageCount = 600): Uint8Array {
  return createPdfFixture(
    Array.from({ length: pageCount }, (_, index) => ({
      text: `Synthetic page ${index + 1}`,
      rotation: index === 1 ? 90 : 0,
    })),
  );
}

export function createImageOnlyPdfFixture(): Uint8Array {
  return createPdfFixture([{}]);
}

export function createCorruptPdfFixture(): Uint8Array {
  return new TextEncoder().encode("%PDF-1.7\n1 0 obj\ncorrupted");
}

export function createPasswordPdfFixture(): Uint8Array {
  return Uint8Array.from(atob(PASSWORD_PDF_BASE64), (character) =>
    character.charCodeAt(0),
  );
}

function escapePdfText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function pdfTextLines(lines: readonly string[]): string {
  const [heading = "", body = ""] = lines;
  return [
    "BT /F1 16 Tf 24 104 Td",
    `(${escapePdfText(heading)}) Tj`,
    "/F1 10 Tf 0 -24 Td",
    `(${escapePdfText(body)}) Tj ET`,
  ].join(" ");
}
