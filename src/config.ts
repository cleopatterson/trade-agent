import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env files (same as Python config.py)
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

// Load .env from trade_agent_ts dir first, then parent .env
loadEnv(path.resolve(__dirname, "../.env"));
loadEnv(path.resolve(__dirname, "../../.env"));

// All data dirs now live under trade_agent_ts/ (sibling to src/)
// On Railway, paths resolve relative to cwd
const isRailway = !!process.env.RAILWAY_ENVIRONMENT;

function resolvePath(localPath: string, railwayPath: string): string {
  if (!isRailway) return path.resolve(__dirname, localPath);
  return path.resolve(process.cwd(), railwayPath);
}

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
  skillsDir: string;
} = {
  port: parseInt(process.env.PORT || process.env.TRADE_TS_PORT || "8002"),
  model: "claude-sonnet-4-5-20250929" as const,
  temperature: 0.2,
  maxTokens: parseInt(process.env.MAX_TOKENS || "300"),
  maxIterations: 10,
  brevityMode: process.env.BREVITY_MODE !== 'false',

  tradeAgentDir: resolvePath("..", "."),
  bootstrapDir: resolvePath("../bootstrap", "./bootstrap"),
  memoryDir: resolvePath("../memory", "./memory"),
  mockDir: resolvePath("../../resources/mock", "./mock"),
  skillsDir: resolvePath("../skills", "./skills"),
};
