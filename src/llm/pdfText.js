import fs from "node:fs";
import { PDFParse } from "pdf-parse";

// Text-extract a PDF. Used only by text-only providers (e.g. Groq) — the
// Anthropic provider reads the PDF natively and never calls this.
export async function extractPdfText(pdfPath) {
  const data = fs.readFileSync(pdfPath);
  const parser = new PDFParse({ data });
  try {
    // pageJoiner: "" suppresses the default "-- page N of M --" boundary markers.
    const { text } = await parser.getText({ pageJoiner: "" });
    const trimmed = (text || "").trim();
    if (!trimmed) {
      throw new Error(
        `Could not extract text from ${pdfPath}.\n  → If it's a scanned/image PDF, use LLM_PROVIDER=anthropic (native PDF reading).`
      );
    }
    return trimmed;
  } finally {
    await parser.destroy();
  }
}
