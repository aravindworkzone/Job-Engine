import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

// Haiku 4.5 — cheapest tier, enough for extraction. Override via ANTHROPIC_MODEL.
// Do NOT add output_config.effort — the effort parameter errors on Haiku.
const DEFAULT_MODEL = "claude-haiku-4-5";

export const anthropicProvider = {
  name: "anthropic",
  describe: () => `anthropic (${process.env.ANTHROPIC_MODEL || DEFAULT_MODEL}, native PDF)`,

  // Claude reads the PDF natively (base64 document block — no text extraction)
  // and enforces the schema via structured outputs.
  async extractProfileFromPdf({ pdfPath, instructions, schema }) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set.\n  → Copy .env.example to .env and fill it in.");
    }
    const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
    const client = new Anthropic();
    const pdfBase64 = fs.readFileSync(pdfPath).toString("base64");

    const response = await client.messages.parse({
      model,
      max_tokens: 16000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: pdfBase64 },
            },
            { type: "text", text: instructions },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(schema) },
    });

    if (!response.parsed_output) {
      throw new Error("Claude did not return a profile matching the schema. Try re-running.");
    }
    return response.parsed_output;
  },
};
