import OpenAI from "openai";
import { zodToJsonSchema } from "zod-to-json-schema";
import { extractPdfText } from "./pdfText.js";

const DEFAULT_MODEL = "llama-3.3-70b-versatile";
const DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";

export const groqProvider = {
  name: "groq",
  describe: () => `groq (${process.env.GROQ_MODEL || DEFAULT_MODEL}, text-extracted PDF)`,

  // Groq is OpenAI-compatible and text-only — no native PDF input. So the resume
  // is text-extracted first, then sent alongside the target JSON shape. The
  // output is validated against the same zod schema Claude uses, so both
  // providers give the same guarantee about profile.json's shape.
  async extractProfileFromPdf({ pdfPath, instructions, schema }) {
    if (!process.env.GROQ_API_KEY) {
      throw new Error("GROQ_API_KEY is not set.\n  → Copy .env.example to .env and fill it in.");
    }
    const model = process.env.GROQ_MODEL || DEFAULT_MODEL;
    const client = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: process.env.GROQ_BASE_URL || DEFAULT_BASE_URL,
    });

    const resumeText = await extractPdfText(pdfPath);
    const jsonSchema = zodToJsonSchema(schema, "profile");

    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `${instructions}\n\nReturn ONLY a JSON object that conforms to this JSON Schema:\n${JSON.stringify(jsonSchema)}`,
        },
        { role: "user", content: `Resume text:\n\n${resumeText}` },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("Groq returned an empty response.");

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Groq did not return valid JSON.");
    }
    // Enforce the locked schema — throws if the model drifted from the shape.
    return schema.parse(parsed);
  },
};
