import { anthropicProvider } from "./anthropic.js";
import { groqProvider } from "./groq.js";

// Register providers here. Each exposes the same interface:
//   name, describe(), extractProfileFromPdf({ pdfPath, instructions, schema })
const PROVIDERS = {
  anthropic: anthropicProvider,
  claude: anthropicProvider,
  groq: groqProvider,
};

// Pick the provider from LLM_PROVIDER (default: anthropic).
export function getProvider() {
  const name = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
  const provider = PROVIDERS[name];
  if (!provider) {
    const supported = [...new Set(Object.keys(PROVIDERS))].join(", ");
    throw new Error(`Unknown LLM_PROVIDER "${name}". Supported: ${supported}.`);
  }
  return provider;
}
