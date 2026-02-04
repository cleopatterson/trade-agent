/**
 * Express server for pi-agent Trade Assistant.
 * Runs on port 8002 for latency benchmarking.
 */
import express from "express";
import path from "path";
import http from "http";
import https from "https";
import fs from "fs";
import multer from "multer";
import { CONFIG } from "./config.js";
import { createAgentSession, chat, chatStream, type AgentSession } from "./agent.js";
import { randomUUID } from "crypto";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const app = express();
app.use(express.json());

// CORS
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (_req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Serve the trade dashboard from the Python trade_agent/web directory
const webDir = path.resolve(CONFIG.tradeAgentDir, "web");
app.use("/static", express.static(webDir));

// ────────── Session Store ──────────
const sessions = new Map<string, AgentSession>();
const businessActiveSessions = new Map<string, string>();

// ────────── Endpoints ──────────

app.get("/", (_req, res) => {
  res.json({
    service: "Trade Assistant TS API",
    version: "1.0.0",
    description: "pi-agent TypeScript version",
    framework: "pi-agent",
    port: CONFIG.port,
  });
});

app.get("/health", (_req, res) => {
  res.json({
    status: "healthy",
    service: "trade-assistant-ts",
    framework: "pi-agent",
    brevityMode: CONFIG.brevityMode,
  });
});

app.post("/config/brevity", (req, res) => {
  const enabled = req.body.enabled;
  if (typeof enabled !== "boolean") {
    return res.status(400).json({ error: "enabled must be a boolean" });
  }
  CONFIG.brevityMode = enabled;
  console.log(`  [Config] brevityMode = ${enabled}`);
  res.json({ brevityMode: CONFIG.brevityMode });
});

app.post("/config/max-tokens", (req, res) => {
  const value = req.body.value;
  if (typeof value !== "number" || value < 100 || value > 8192) {
    return res.status(400).json({ error: "value must be a number between 100 and 8192" });
  }
  CONFIG.maxTokens = value;
  console.log(`  [Config] maxTokens = ${value}`);
  res.json({ maxTokens: CONFIG.maxTokens });
});

app.get("/config", (_req, res) => {
  res.json({ brevityMode: CONFIG.brevityMode, maxTokens: CONFIG.maxTokens });
});

// Whisper transcription proxy (so mobile clients don't need OpenAI key)
app.post("/transcribe", upload.single("file"), async (req, res) => {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(500).json({ error: "OPENAI_API_KEY not configured" });
  if (!req.file) return res.status(400).json({ error: "No audio file" });

  try {
    const formData = new FormData();
    formData.append("file", new Blob([new Uint8Array(req.file.buffer)], { type: req.file.mimetype }), req.file.originalname || "audio.webm");
    formData.append("model", "whisper-1");
    formData.append("language", "en");

    const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: formData,
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`  [Whisper] error: ${resp.status} ${errText}`);
      return res.status(resp.status).json({ error: errText });
    }

    const data = await resp.json();
    console.log(`  [Whisper] transcribed: "${(data as any).text?.substring(0, 50)}..."`);
    res.json(data);
  } catch (e: any) {
    console.error(`  [Whisper] error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.post("/assistant/start", (req, res) => {
  const businessId = req.body.business_id || "demo";

  // Close previous session
  const prevSessionId = businessActiveSessions.get(businessId);
  if (prevSessionId) sessions.delete(prevSessionId);

  const sessionId = randomUUID();
  const session = createAgentSession(businessId);
  sessions.set(sessionId, session);
  businessActiveSessions.set(businessId, sessionId);

  res.json({
    session_id: sessionId,
    business_id: businessId,
    framework: "pi-agent",
    message: "Session started (pi-agent)",
  });
});

app.post("/assistant/message", async (req, res) => {
  const { session_id, message, stream } = req.body;

  if (!session_id || !sessions.has(session_id)) {
    return res.status(404).json({ error: "Session not found" });
  }

  const session = sessions.get(session_id)!;
  const turnStart = performance.now();

  // ── SSE streaming path ──
  if (stream) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    // Keep connection alive
    const keepAlive = setInterval(() => res.write(":\n\n"), 15000);

    try {
      await chatStream(session, message, (event) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      });
    } catch (err: any) {
      res.write(`data: ${JSON.stringify({ type: "done", response: `Error: ${err.message}`, error: err.message })}\n\n`);
    } finally {
      clearInterval(keepAlive);
      res.end();
    }
    return;
  }

  // ── Non-streaming path (unchanged for benchmark compatibility) ──
  try {
    const response = await chat(session, message);
    const turnTime = (performance.now() - turnStart) / 1000;

    console.log(`  [Turn] ${turnTime.toFixed(2)}s`);

    res.json({
      session_id,
      response,
      turn_time: parseFloat(turnTime.toFixed(2)),
      timing: {
        total: parseFloat(turnTime.toFixed(3)),
        llm: parseFloat(session.lastLlmTime.toFixed(3)),
      },
      framework: "pi-agent",
    });
  } catch (err: any) {
    res.json({
      session_id,
      response: `Sorry, something went wrong: ${err.message}`,
      error: err.message,
      framework: "pi-agent",
    });
  }
});

app.delete("/assistant/session/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  if (sessions.has(sessionId)) {
    sessions.delete(sessionId);
    for (const [biz, sess] of businessActiveSessions) {
      if (sess === sessionId) { businessActiveSessions.delete(biz); break; }
    }
    res.json({ success: true, message: "Session ended" });
  } else {
    res.json({ success: false, message: "Session not found" });
  }
});

app.get("/assistant/sessions", (_req, res) => {
  const list = [...sessions.entries()].map(([id, s]) => ({
    session_id: id,
    business_id: s.businessId,
  }));
  res.json({ sessions: list, count: list.length });
});

// ────────── Proxy non-chat endpoints to LangChain server (8001) ──────────
const PROXY_TARGET = "http://localhost:8001";
const PROXY_PATHS = ["/bootstrap", "/jobs", "/skills", "/system-prompt", "/import-profile"];

function proxyRequest(req: express.Request, res: express.Response) {
  const url = new URL(req.originalUrl, PROXY_TARGET);
  const options: http.RequestOptions = {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname + url.search,
    method: req.method,
    headers: { ...req.headers, host: url.host },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", () => {
    res.status(502).json({ error: "LangChain server (8001) not available for this endpoint" });
  });

  if (req.method !== "GET" && req.method !== "HEAD") {
    const body = JSON.stringify(req.body);
    proxyReq.setHeader("Content-Type", "application/json");
    proxyReq.setHeader("Content-Length", Buffer.byteLength(body));
    proxyReq.write(body);
  }

  proxyReq.end();
}

for (const p of PROXY_PATHS) {
  app.all(`${p}*`, proxyRequest);
}

// ────────── Start ──────────
app.listen(CONFIG.port, () => {
  console.log(`Trade Assistant TS (pi-agent) running on port ${CONFIG.port}`);
  console.log(`Dashboard: http://localhost:${CONFIG.port}/static/trade-dashboard.html`);
  console.log(`Non-chat endpoints proxied to ${PROXY_TARGET}`);
});

// Optional HTTPS for mobile mic access
const certPath = path.resolve(import.meta.dirname, "../localhost-cert.pem");
const keyPath = path.resolve(import.meta.dirname, "../localhost-key.pem");
if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  const httpsPort = CONFIG.port + 1; // 8003
  https.createServer({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }, app).listen(httpsPort, () => {
    console.log(`HTTPS Dashboard: https://192.168.0.99:${httpsPort}/static/trade-dashboard.html`);
  });
}
