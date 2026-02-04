import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Load .env file
function loadEnv(filePath: string) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.substring(0, eqIdx).trim();
      let val = trimmed.substring(eqIdx + 1).trim();
      // Remove surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch {
    // File doesn't exist, skip
  }
}

loadEnv(path.resolve(ROOT, ".env"));

export const CONFIG: {
  port: number;
  model: "claude-sonnet-4-5-20250929";
  temperature: number;
  maxTokens: number;
  maxIterations: number;
  brevityMode: boolean;
  tradeAgentDir: string;
  bootstrapDir: string;
  memoryDir: string;
  mockDir: string;
} = {
  port: parseInt(process.env.PORT || process.env.TRADE_TS_PORT || "8002"),
  model: "claude-sonnet-4-5-20250929" as const,
  temperature: 0.2,
  maxTokens: parseInt(process.env.MAX_TOKENS || "1024"),
  maxIterations: 10,
  brevityMode: process.env.BREVITY_MODE === 'true',

  tradeAgentDir: ROOT,
  bootstrapDir: path.resolve(ROOT, "bootstrap"),
  memoryDir: path.resolve(ROOT, "memory"),
  mockDir: path.resolve(ROOT, "mock"),
};
