/**
 * Express server for pi-agent Trade Assistant.
 * Runs on port 8002 - fully standalone, no Python server needed.
 */
import express from "express";
import path from "path";
import http from "http";
import https from "https";
import fs from "fs";
import multer from "multer";
import webpush from "web-push";
import { CONFIG, initDataDirs } from "./config.js";
import { createAgentSession, chat, chatStream, TRADE_ASSISTANT_PROMPT_STATIC, type AgentSession } from "./agent.js";
import {
  VALID_FILENAMES,
  listBusinesses,
  getBusinessLogo,
  getBootstrapStatus,
  ensureBusinessBootstrap,
  writeBootstrapFile,
  deleteBusinessDir,
  loadMockJobs,
  saveMockJobs,
  updateJobInFile,
  getJobById,
  matchesTrade,
  parseBusinessField,
  generateMockJob,
  generateFakeJobHistory,
  generateFakeMatchedJobs,
  updateJobHistoryMd,
  updateBusinessField,
  updateBusinessSection,
  updateMemory,
  addMessageToConversation,
  listSkills,
  getSkillContent,
} from "./bootstrap.js";
import { fetchSSProfileFromUrl } from "./import-profile.js";
import { reviewJobInBackground, type JobReview } from "./review.js";
import { randomUUID } from "crypto";
import sharp from "sharp";
import type { Response } from "express";

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

// Serve the trade dashboard - use import.meta.dirname for reliable path resolution
const webDir = path.resolve(import.meta.dirname, "../web");
app.use("/static", express.static(webDir));

// ────────── Session Store ──────────
const sessions = new Map<string, AgentSession>();
const businessActiveSessions = new Map<string, string>();

// ────────── Quote Store ──────────
export interface StoredQuote {
  id: string;
  businessId: string;
  businessName: string;
  businessPhone: string;
  businessEmail: string;
  businessAbn: string;
  businessLogo?: string;
  brandColor?: string;
  quoteTheme?: string; // "modern" | "classic" | "bold" | "minimal"
  customerName: string;
  jobName: string;
  jobDescription: string;
  suburb: string;
  lineItems: { description: string; quantity?: number; unit?: string; amount: number }[];
  subtotal: number;
  gst: number;
  total: number;
  includeGst: boolean;
  notes?: string;
  validDays: number;
  createdAt: string;
}
const quoteStore = new Map<string, StoredQuote>();

// ────────── SSE Client Store ──────────
interface SSEClient {
  id: string;
  res: Response;
}
const sseClients = new Map<string, SSEClient[]>();

function broadcastToBusinessSSE(businessId: string, event: string, data: unknown) {
  const clients = sseClients.get(businessId);
  if (!clients || clients.length === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.res.write(payload);
    } catch {
      // Client disconnected — will be cleaned up on close
    }
  }
}

// ────────── Web Push ──────────

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_EMAIL = process.env.VAPID_EMAIL || "mailto:push@example.com";

interface PushSubscriptionRecord {
  businessId: string;
  subscription: webpush.PushSubscription;
  createdAt: string;
}

const pushSubscriptionsFile = path.join(CONFIG.memoryDir, "push_subscriptions.json");

function loadPushSubscriptions(): PushSubscriptionRecord[] {
  try {
    return JSON.parse(fs.readFileSync(pushSubscriptionsFile, "utf-8"));
  } catch {
    return [];
  }
}

function savePushSubscriptions(subs: PushSubscriptionRecord[]): void {
  fs.mkdirSync(path.dirname(pushSubscriptionsFile), { recursive: true });
  fs.writeFileSync(pushSubscriptionsFile, JSON.stringify(subs, null, 2));
}

let pushReady = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    VAPID_EMAIL.startsWith("mailto:") ? VAPID_EMAIL : `mailto:${VAPID_EMAIL}`,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
  pushReady = true;
  console.log("[Push] VAPID configured — web push enabled");
} else {
  console.log("[Push] No VAPID keys — web push disabled (set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY)");
}

async function sendPushToBusinessDevices(
  businessId: string,
  payload: { title: string; body: string; data?: Record<string, unknown> }
): Promise<void> {
  if (!pushReady) return;

  const allSubs = loadPushSubscriptions();
  const businessSubs = allSubs.filter((s) => s.businessId === businessId);
  if (!businessSubs.length) return;

  const stale: string[] = [];

  await Promise.allSettled(
    businessSubs.map(async (record) => {
      try {
        await webpush.sendNotification(record.subscription, JSON.stringify(payload));
      } catch (err: any) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          // Subscription expired or invalid — mark for removal
          stale.push(record.subscription.endpoint);
          console.log(`  [Push] Removed stale subscription for ${businessId}`);
        } else {
          console.error(`  [Push] Failed to send to ${businessId}: ${err.message}`);
        }
      }
    })
  );

  // Clean up stale subscriptions
  if (stale.length) {
    const cleaned = allSubs.filter((s) => !stale.includes(s.subscription.endpoint));
    savePushSubscriptions(cleaned);
  }
}

// ────────── Core Endpoints ──────────

app.get("/", (_req, res) => {
  res.json({
    service: "Trade Assistant TS API",
    version: "2.0.0",
    description: "pi-agent TypeScript version (standalone)",
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

// ────────── Push Notification Endpoints ──────────

app.get("/push/vapid-key", (_req, res) => {
  if (!pushReady) {
    return res.status(503).json({ error: "Push not configured — VAPID keys missing" });
  }
  res.json({ key: VAPID_PUBLIC_KEY });
});

app.post("/push/subscribe", (req, res) => {
  const { business_id, subscription } = req.body;
  if (!business_id || !subscription?.endpoint) {
    return res.status(400).json({ error: "business_id and subscription are required" });
  }

  const allSubs = loadPushSubscriptions();

  // Dedupe by endpoint — same device re-subscribing
  const filtered = allSubs.filter((s) => s.subscription.endpoint !== subscription.endpoint);
  filtered.push({
    businessId: business_id,
    subscription,
    createdAt: new Date().toISOString(),
  });
  savePushSubscriptions(filtered);

  console.log(`  [Push] Subscribed device for ${business_id} (${filtered.filter((s) => s.businessId === business_id).length} total)`);
  res.json({ success: true, message: "Push subscription registered" });
});

app.post("/push/unsubscribe", (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) {
    return res.status(400).json({ error: "endpoint is required" });
  }

  const allSubs = loadPushSubscriptions();
  const filtered = allSubs.filter((s) => s.subscription.endpoint !== endpoint);
  savePushSubscriptions(filtered);

  console.log(`  [Push] Unsubscribed device (${allSubs.length - filtered.length} removed)`);
  res.json({ success: true, message: "Push subscription removed" });
});

// ────────── Whisper Transcription ──────────
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

// ────────── ElevenLabs TTS Proxy ──────────
const TTS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "IKne3meq5aSn9XLyUdCD"; // Charlie - Australian male
const TTS_MODEL = "eleven_multilingual_v2";

app.post("/tts", async (req, res) => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ELEVENLABS_API_KEY not configured" });

  const { text, voice_id, model_id, voice_settings } = req.body;
  if (!text) return res.status(400).json({ error: "text is required" });

  try {
    const resp = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice_id || TTS_VOICE_ID}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          model_id: model_id || TTS_MODEL,
          voice_settings: voice_settings || { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1.0 },
        }),
      }
    );

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`  [TTS] ElevenLabs error: ${resp.status} ${errText}`);
      return res.status(resp.status).json({ error: errText });
    }

    const arrayBuffer = await resp.arrayBuffer();
    console.log(`  [TTS] ${text.substring(0, 50)}... (${arrayBuffer.byteLength} bytes)`);
    res.set("Content-Type", "audio/mpeg");
    res.send(Buffer.from(arrayBuffer));
  } catch (e: any) {
    console.error(`  [TTS] error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// ────────── Assistant Session Endpoints ──────────

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

  // ── Non-streaming path ──
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

// ────────── Bootstrap Endpoints (native) ──────────

app.get("/bootstrap/list", (_req, res) => {
  const businesses = listBusinesses();
  res.json({ businesses, count: businesses.length });
});

app.post("/bootstrap/reset-all", (_req, res) => {
  const deleted: string[] = [];
  const errors: string[] = [];

  try {
    const entries = fs.readdirSync(CONFIG.bootstrapDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith("biz_")) {
        try {
          fs.rmSync(path.join(CONFIG.bootstrapDir, entry.name), { recursive: true, force: true });
          deleted.push(entry.name);
        } catch (e: any) {
          errors.push(`${entry.name}: ${e.message}`);
        }
      }
    }
  } catch { /* dir doesn't exist */ }

  // Clear sessions
  sessions.clear();
  businessActiveSessions.clear();

  res.json({
    success: errors.length === 0,
    deleted_businesses: deleted,
    deleted_count: deleted.length,
    sessions_cleared: true,
    errors: errors.length ? errors : null,
    message: `Reset complete. Deleted ${deleted.length} businesses.`,
  });
});

// Logo must come before /:bid/:filename
app.get("/bootstrap/:bid/logo", (req, res) => {
  res.json(getBusinessLogo(req.params.bid));
});

app.get("/bootstrap/:bid/:filename", (req, res) => {
  const { bid, filename } = req.params;
  if (!VALID_FILENAMES.includes(filename)) {
    return res.status(400).json({ error: `Invalid filename. Must be one of: ${VALID_FILENAMES.join(", ")}` });
  }

  ensureBusinessBootstrap(bid);
  const filePath = path.join(CONFIG.bootstrapDir, bid, filename);
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    res.json({ success: true, filename, business_id: bid, content });
  } catch {
    res.json({ success: false, error: "File not found", filename, business_id: bid });
  }
});

app.put("/bootstrap/:bid/:filename", (req, res) => {
  const { bid, filename } = req.params;
  if (!VALID_FILENAMES.includes(filename)) {
    return res.status(400).json({ error: `Invalid filename. Must be one of: ${VALID_FILENAMES.join(", ")}` });
  }

  try {
    ensureBusinessBootstrap(bid);
    writeBootstrapFile(bid, filename, req.body.content);
    res.json({ success: true, filename, business_id: bid, message: `Updated ${filename}` });
  } catch (e: any) {
    res.json({ success: false, error: e.message, filename, business_id: bid });
  }
});

app.get("/bootstrap/:bid", (req, res) => {
  res.json(getBootstrapStatus(req.params.bid));
});

app.delete("/bootstrap/:bid", (req, res) => {
  const bid = req.params.bid;
  if (!bid.startsWith("biz_")) {
    return res.status(400).json({ error: "Invalid business ID" });
  }

  if (deleteBusinessDir(bid)) {
    // Also clean up mock jobs
    const mockFile = path.join(CONFIG.mockDir, `jobs_for_business_${bid}.json`);
    try { fs.unlinkSync(mockFile); } catch { /* ok */ }

    res.json({ success: true, message: `Business ${bid} deleted`, business_id: bid });
  } else {
    res.status(404).json({ error: `Business ${bid} not found` });
  }
});

// ────────── Jobs Endpoints (native) ──────────

app.get("/jobs/:businessId", (req, res) => {
  const { businessId } = req.params;
  try {
    const businessContent = (() => {
      const filePath = path.join(CONFIG.bootstrapDir, businessId, "BUSINESS.md");
      try { return fs.readFileSync(filePath, "utf-8"); } catch { return ""; }
    })();

    const trade = parseBusinessField(businessContent, "Trade") || "";
    const baseSuburb = parseBusinessField(businessContent, "Base Suburb") || parseBusinessField(businessContent, "Primary Suburbs");
    const location = baseSuburb ? baseSuburb.split(",")[0].trim() + ", NSW" : "Sydney, NSW";

    let jobs = loadMockJobs(businessId);

    if (jobs.length === 0 && trade) {
      // Auto-generate jobs
      const result = generateFakeMatchedJobs(trade, location);
      if (result.success) {
        saveMockJobs(businessId, result.jobs);
        jobs = result.jobs;
      }
    } else if (trade) {
      // Filter by trade
      jobs = jobs.filter((j) => matchesTrade(j, trade));
    }

    res.json({
      success: true,
      business_id: businessId,
      jobs,
      jobs_count: jobs.length,
      trade_filter: trade || "none",
    });
  } catch (e: any) {
    res.json({ success: false, error: e.message, business_id: businessId, jobs: [] });
  }
});

app.put("/jobs/:jobId/status", (req, res) => {
  const { jobId } = req.params;
  const { status, reason } = req.body;
  // Find which business has this job and update
  // For now just acknowledge (matches Python behavior)
  res.json({
    success: true,
    job_id: jobId,
    status,
    reason: reason || null,
    message: `Job ${jobId} status updated to ${status}`,
  });
});

app.post("/jobs/:businessId/generate", (req, res) => {
  const { businessId } = req.params;
  const trade = req.body?.trade || undefined;
  const subcategory = req.body?.subcategory || undefined;
  const urgency = req.body?.urgency || undefined;

  const job = generateMockJob(businessId, trade, subcategory, urgency);

  // Append to existing jobs file
  const existingJobs = loadMockJobs(businessId);
  existingJobs.push(job);
  saveMockJobs(businessId, existingJobs);

  res.json({ success: true, business_id: businessId, job, message: "Mock job generated" });
});

app.post("/jobs/:businessId/refresh", (req, res) => {
  const { businessId } = req.params;
  try {
    const businessContent = (() => {
      const filePath = path.join(CONFIG.bootstrapDir, businessId, "BUSINESS.md");
      try { return fs.readFileSync(filePath, "utf-8"); } catch { return ""; }
    })();

    const tradeRaw = parseBusinessField(businessContent, "Trade") || "painting";
    const trades = tradeRaw.split(",").map((t) => t.trim().toLowerCase());
    const trade = trades.find((t) => t.includes("paint")) || trades[0] || "painting";

    const baseSuburb = parseBusinessField(businessContent, "Base Suburb") || parseBusinessField(businessContent, "Primary Suburbs");
    const location = baseSuburb ? baseSuburb.split(",")[0].trim() + ", NSW" : "Sydney, NSW";

    const existingJobs = loadMockJobs(businessId);
    const result = generateFakeMatchedJobs(trade, location);

    if (result.success) {
      const allJobs = [...existingJobs, ...result.jobs];
      saveMockJobs(businessId, allJobs);

      res.json({
        success: true,
        business_id: businessId,
        kept_jobs: existingJobs.length,
        new_jobs_count: result.jobs.length,
        total_jobs: allJobs.length,
        message: `Added ${result.jobs.length} new leads, kept ${existingJobs.length} in-progress jobs`,
      });
    } else {
      res.json({ success: false, error: "Failed to generate jobs" });
    }
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// ────────── Brand Color Extraction ──────────

async function extractDominantColor(imageUrl: string): Promise<string | null> {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());

    // Resize to tiny image for fast color sampling, ignore alpha
    const { data, info } = await sharp(buffer)
      .resize(50, 50, { fit: "cover" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Count pixel colors, bucketing into 16-value bins to cluster similar colors
    const buckets = new Map<string, { r: number; g: number; b: number; count: number }>();
    for (let i = 0; i < data.length; i += 3) {
      const r = data[i], g = data[i + 1], b = data[i + 2];

      // Skip near-white, near-black, and very grey pixels (backgrounds/text)
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const saturation = max === 0 ? 0 : (max - min) / max;
      if (max > 230 && min > 200) continue; // white-ish
      if (max < 30) continue; // black-ish
      if (saturation < 0.15 && max > 60) continue; // grey-ish

      // Bucket to nearest 16
      const key = `${r >> 4},${g >> 4},${b >> 4}`;
      const existing = buckets.get(key);
      if (existing) {
        existing.r += r; existing.g += g; existing.b += b; existing.count++;
      } else {
        buckets.set(key, { r, g, b, count: 1 });
      }
    }

    if (buckets.size === 0) return null;

    // Find the most common color bucket
    let best = { r: 37, g: 99, b: 235, count: 0 }; // fallback blue
    for (const b of buckets.values()) {
      if (b.count > best.count) best = b;
    }

    // Average the colors in the winning bucket
    const avgR = Math.round(best.r / best.count);
    const avgG = Math.round(best.g / best.count);
    const avgB = Math.round(best.b / best.count);

    return `#${avgR.toString(16).padStart(2, "0")}${avgG.toString(16).padStart(2, "0")}${avgB.toString(16).padStart(2, "0")}`;
  } catch (err) {
    console.log(`  [Brand] Color extraction failed: ${err}`);
    return null;
  }
}

// ────────── Import Profile Endpoint (native) ──────────

app.post("/import-profile", async (req, res) => {
  try {
    const { business_id, url } = req.body;
    if (!business_id || !url) {
      return res.status(400).json({ error: "business_id and url are required" });
    }

    // Step 1: Scrape the profile
    const profile = await fetchSSProfileFromUrl(url);
    if (!profile.success) {
      return res.status(400).json({ success: false, error: profile.error || "Failed to fetch profile" });
    }

    const businessName = profile.name || "Unknown Business";

    // Step 2: Create bootstrap files
    ensureBusinessBootstrap(business_id);

    // Step 3: Save profile data
    if (profile.name) updateBusinessField(business_id, "Business Name", profile.name);
    if (profile.owner_name) updateBusinessField(business_id, "Owner Name", profile.owner_name);
    if (profile.phone) updateBusinessField(business_id, "Phone", profile.phone);
    if (profile.email) updateBusinessField(business_id, "Email", profile.email);
    if (profile.description) updateBusinessSection(business_id, "What Makes You Different", profile.description);
    if (profile.location) updateBusinessField(business_id, "Base Suburb", profile.location);
    if (profile.abn) updateBusinessField(business_id, "ABN", profile.abn);
    if (profile.license) updateBusinessField(business_id, "License Number", profile.license);
    if (profile.member_since) updateBusinessField(business_id, "Years in Business", `Member since ${profile.member_since}`);

    // Filter services to get trade and populate services section
    const services = profile.services || [];
    const filteredServices = services.filter((s) => !["IDENTITY", "LICENCED", "ABN", "AWARD", "VERIFIED"].includes(s.toUpperCase()));
    if (filteredServices.length) {
      // Detect category from subcategories
      const servicesLower = filteredServices.map(s => s.toLowerCase()).join(" ");
      let category = "Trade";
      if (servicesLower.includes("paint")) category = "Painting";
      else if (servicesLower.includes("plumb")) category = "Plumbing";
      else if (servicesLower.includes("electric")) category = "Electrical";
      else if (servicesLower.includes("carpent") || servicesLower.includes("cabinet")) category = "Carpentry";
      else if (servicesLower.includes("roof")) category = "Roofing";
      else if (servicesLower.includes("floor") || servicesLower.includes("tile")) category = "Flooring";
      else if (servicesLower.includes("clean")) category = "Cleaning";
      else if (servicesLower.includes("landscape") || servicesLower.includes("garden")) category = "Landscaping";
      else if (servicesLower.includes("build") || servicesLower.includes("renovate")) category = "Building";

      // Trade field: the category
      updateBusinessField(business_id, "Trade", category);
      // Services & Specialties: ALL subcategories
      updateBusinessSection(business_id, "Services & Specialties", "Services", filteredServices.join(", "));
    }

    // Default 20km service radius
    updateBusinessField(business_id, "Service Radius", "20km");

    // Save logo and extract brand color
    if (profile.logo_url) {
      const logoDir = path.join(CONFIG.bootstrapDir, business_id);
      fs.mkdirSync(logoDir, { recursive: true });
      fs.writeFileSync(path.join(logoDir, "logo.json"), JSON.stringify({
        url: profile.logo_url,
        source: "scraped",
        uploaded_at: new Date().toISOString(),
      }, null, 2));

      // Extract dominant color from logo for branding
      const brandColor = await extractDominantColor(profile.logo_url);
      if (brandColor) {
        updateBusinessSection(business_id, "Branding", "Brand Color", brandColor);
        console.log(`  [Brand] Extracted color ${brandColor} from logo`);
      }
    }

    // Save stats to memory
    if (profile.rating) updateMemory(business_id, "Profile Rating", `${profile.rating}/5 stars`);
    if (profile.review_count) updateMemory(business_id, "Review Count", `${profile.review_count} reviews`);
    if (profile.times_hired) updateMemory(business_id, "Times Hired", `${profile.times_hired} times`);
    if (profile.response_time) updateMemory(business_id, "Response Time", profile.response_time);
    if (profile.awards?.length) updateMemory(business_id, "Awards", profile.awards.join("; "));
    updateMemory(business_id, "Profile URL", url);

    // Step 4: Generate job history
    const trade = filteredServices[0] || "painting";
    const location = profile.location || "";
    const timesHired = profile.times_hired || 8;

    const history = generateFakeJobHistory(trade, location, Math.min(timesHired, 15));
    if (history.length) {
      // Save raw history JSON
      const historyDir = path.join(CONFIG.memoryDir, business_id);
      fs.mkdirSync(historyDir, { recursive: true });
      fs.writeFileSync(path.join(historyDir, "job_history.json"), JSON.stringify(history, null, 2));
      // Generate JOB_HISTORY.md
      updateJobHistoryMd(business_id, history);
    }

    // Step 5: Generate matched jobs
    const matchedResult = generateFakeMatchedJobs(trade, location);
    if (matchedResult.success) {
      saveMockJobs(business_id, matchedResult.jobs);
    }

    res.json({
      success: true,
      business_id,
      business_name: businessName,
      profile_imported: true,
      times_hired: profile.times_hired,
      job_history_count: history.length,
      matched_jobs_count: matchedResult.jobs?.length || 0,
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ────────── Skills Endpoints (native) ──────────

app.get("/skills/:businessId", (req, res) => {
  const { businessId } = req.params;
  const skills = listSkills(businessId);
  res.json({
    success: true,
    business_id: businessId,
    skills,
    count: skills.length,
  });
});

app.get("/skills/:businessId/:skillName", (req, res) => {
  const { businessId, skillName } = req.params;
  const skill = getSkillContent(businessId, skillName);

  if (!skill) {
    return res.status(404).json({ error: `Skill '${skillName}' not found` });
  }

  // Parse learned patterns from content
  const patterns: Array<Record<string, string>> = [];
  const patternRegex = /### Pattern: (.+?)\n\*\*Observed\*\*: (.+?)\n\*\*Trigger\*\*: (.+?)\n\*\*Pattern\*\*: (.+?)\n\*\*Example\*\*: (.+?)\n\*\*Confidence\*\*: (.+?)(?=\n\n|\n###|$)/gs;
  let m;
  while ((m = patternRegex.exec(skill.content)) !== null) {
    patterns.push({
      name: m[1].trim(),
      observed: m[2].trim(),
      trigger: m[3].trim(),
      pattern: m[4].trim(),
      example: m[5].trim(),
      confidence: m[6].trim(),
    });
  }

  res.json({
    success: true,
    business_id: businessId,
    skill: {
      name: skill.name,
      emoji: skill.emoji,
      description: skill.description,
      content: skill.content,
      file_path: skill.file_path,
      is_customized: skill.is_customized,
    },
    learned_patterns: patterns,
    pattern_count: patterns.length,
  });
});

// ────────── Quote HTML Page ──────────

// Store a quote (called from tools.ts)
export function storeQuote(quote: StoredQuote): void {
  quoteStore.set(quote.id, quote);
}

export function getStoredQuote(id: string): StoredQuote | undefined {
  return quoteStore.get(id);
}

app.get("/quotes/:id", (req, res) => {
  const quote = quoteStore.get(req.params.id);
  if (!quote) return res.status(404).send("Quote not found or expired.");

  const created = new Date(quote.createdAt);
  const validUntil = new Date(created.getTime() + quote.validDays * 86400000);
  const isEmbed = req.query.embed === "1";
  const fmtDate = (d: Date) => d.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

  // Brand color — default blue if not set
  const c = quote.brandColor && /^#[0-9a-fA-F]{3,8}$/.test(quote.brandColor) ? quote.brandColor : "#2563eb";
  const theme = (quote.quoteTheme || "modern").toLowerCase();

  // Theme-specific overrides
  const themes: Record<string, { font: string; headerBorder: string; headerBg: string; tableBorder: string; totalStyle: string; bodyBg: string; radius: string }> = {
    modern: {
      font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      headerBorder: `3px solid ${c}`,
      headerBg: "transparent",
      tableBorder: "1px solid #f0f0f0",
      totalStyle: `border-top: 2px solid ${c}`,
      bodyBg: "#f5f5f5",
      radius: "8px",
    },
    classic: {
      font: "Georgia, 'Times New Roman', serif",
      headerBorder: `1px solid #ccc`,
      headerBg: "transparent",
      tableBorder: "1px solid #ddd",
      totalStyle: "border-top: 2px double #333",
      bodyBg: "#faf9f6",
      radius: "0",
    },
    bold: {
      font: "'Helvetica Neue', Arial, sans-serif",
      headerBorder: "none",
      headerBg: c,
      tableBorder: "none",
      totalStyle: `border-top: 3px solid ${c}`,
      bodyBg: "#f0f0f0",
      radius: "12px",
    },
    minimal: {
      font: "'Inter', -apple-system, sans-serif",
      headerBorder: "1px solid #e5e5e5",
      headerBg: "transparent",
      tableBorder: "none",
      totalStyle: "border-top: 1px solid #e5e5e5",
      bodyBg: "#fff",
      radius: "0",
    },
  };
  const t = themes[theme] || themes.modern;
  const isBoldHeader = theme === "bold";

  const logoHtml = quote.businessLogo
    ? `<img src="${quote.businessLogo}" alt="${escHtml(quote.businessName)}" style="max-height: 60px; max-width: 180px; margin-bottom: 8px; border-radius: 4px;">`
    : '';

  const itemRows = quote.lineItems.map(item => `
    <tr>
      <td>${escHtml(item.description)}</td>
      <td class="right">${item.quantity ? item.quantity + (item.unit ? ' ' + escHtml(item.unit) : '') : ''}</td>
      <td class="right">$${item.amount.toFixed(2)}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Quote ${quote.id} — ${escHtml(quote.businessName)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: ${t.font}; color: #1a1a1a; background: ${isEmbed ? '#fff' : t.bodyBg}; }
    .page { max-width: 800px; margin: ${isEmbed ? '0' : '20px'} auto; background: #fff; padding: ${isEmbed ? '24px' : '48px'}; box-shadow: ${isEmbed ? 'none' : '0 1px 3px rgba(0,0,0,0.1)'}; border-radius: ${isEmbed ? '0' : t.radius}; }
    @media print { body { background: #fff; } .page { margin: 0; padding: 24px; box-shadow: none; } .no-print { display: none; } }

    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; padding-bottom: ${isBoldHeader ? '0' : '24px'}; padding: ${isBoldHeader ? '24px' : '0 0 24px 0'}; border-bottom: ${isBoldHeader ? 'none' : t.headerBorder}; background: ${t.headerBg}; border-radius: ${isBoldHeader ? t.radius + ' ' + t.radius + ' 0 0' : '0'}; ${isBoldHeader ? 'margin: -48px -48px 32px -48px; padding: 32px 48px;' : ''} }
    .brand h1 { font-size: 24px; color: ${isBoldHeader ? '#fff' : c}; margin-bottom: 4px; }
    .brand p { font-size: 13px; color: ${isBoldHeader ? 'rgba(255,255,255,0.8)' : '#666'}; }
    .brand img { ${isBoldHeader ? 'filter: brightness(0) invert(1); opacity: 0.9;' : ''} }
    .quote-meta { text-align: right; }
    .quote-meta h2 { font-size: ${theme === 'classic' ? '22px' : '28px'}; color: ${isBoldHeader ? '#fff' : c}; text-transform: uppercase; letter-spacing: ${theme === 'classic' ? '4px' : '2px'}; }
    .quote-meta p { font-size: 13px; color: ${isBoldHeader ? 'rgba(255,255,255,0.8)' : '#666'}; margin-top: 4px; }

    .parties { display: flex; justify-content: space-between; margin-bottom: 32px; }
    .party { flex: 1; }
    .party h3 { font-size: 11px; text-transform: uppercase; color: #999; letter-spacing: 1px; margin-bottom: 8px; }
    .party p { font-size: 14px; line-height: 1.6; }

    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    thead th { text-align: left; font-size: 11px; text-transform: uppercase; color: ${theme === 'bold' ? '#fff' : '#999'}; letter-spacing: 1px; padding: 10px 12px; ${theme === 'bold' ? `background: ${c}; color: #fff;` : `border-bottom: 2px solid #e5e5e5;`} }
    thead th.right { text-align: right; }
    tbody td { padding: 12px; border-bottom: ${t.tableBorder}; font-size: 14px; }
    tbody td.right { text-align: right; }
    ${theme === 'bold' ? 'tbody tr:nth-child(even) { background: #f8f9fa; }' : ''}

    .totals { display: flex; justify-content: flex-end; margin-bottom: 32px; }
    .totals-table { width: 280px; }
    .totals-table .row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; color: #666; }
    .totals-table .row.total { ${t.totalStyle}; padding-top: 12px; margin-top: 8px; font-size: 20px; font-weight: 700; color: ${c}; }

    .notes { background: #f8f9fa; padding: 16px; border-radius: ${t.radius || '6px'}; margin-bottom: 24px; ${theme === 'bold' ? `border-left: 4px solid ${c};` : ''} }
    .notes h3 { font-size: 12px; text-transform: uppercase; color: #999; margin-bottom: 8px; }
    .notes p { font-size: 13px; color: #555; line-height: 1.5; }

    .footer { text-align: center; padding-top: 24px; border-top: 1px solid #e5e5e5; font-size: 12px; color: #999; }
    .print-btn { display: block; margin: 20px auto; padding: 12px 32px; background: ${c}; color: #fff; border: none; border-radius: ${t.radius || '6px'}; font-size: 15px; cursor: pointer; }
    .print-btn:hover { opacity: 0.9; }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="brand">
        ${logoHtml}
        <h1>${escHtml(quote.businessName)}</h1>
        ${quote.businessAbn ? `<p>ABN: ${escHtml(quote.businessAbn)}</p>` : ''}
        ${quote.businessPhone ? `<p>${escHtml(quote.businessPhone)}</p>` : ''}
        ${quote.businessEmail ? `<p>${escHtml(quote.businessEmail)}</p>` : ''}
      </div>
      <div class="quote-meta">
        <h2>Quote</h2>
        <p>#${escHtml(quote.id)}</p>
        <p>${fmtDate(created)}</p>
      </div>
    </div>

    <div class="parties">
      <div class="party">
        <h3>Prepared For</h3>
        <p><strong>${escHtml(quote.customerName)}</strong></p>
        <p>${escHtml(quote.suburb)}</p>
      </div>
      <div class="party">
        <h3>Job</h3>
        <p><strong>${escHtml(quote.jobName)}</strong></p>
      </div>
    </div>

    <table>
      <thead>
        <tr><th>Description</th><th class="right">Qty</th><th class="right">Amount</th></tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>

    <div class="totals">
      <div class="totals-table">
        <div class="row"><span>Subtotal</span><span>$${quote.subtotal.toFixed(2)}</span></div>
        ${quote.includeGst ? `<div class="row"><span>GST (10%)</span><span>$${quote.gst.toFixed(2)}</span></div>` : ''}
        <div class="row total"><span>Total${quote.includeGst ? ' (inc GST)' : ''}</span><span>$${quote.total.toFixed(2)}</span></div>
      </div>
    </div>

    ${quote.notes ? `<div class="notes"><h3>Notes</h3><p>${escHtml(quote.notes)}</p></div>` : ''}

    <div class="footer">
      <p>Valid until ${fmtDate(validUntil)} &middot; ${escHtml(quote.businessName)}</p>
    </div>
  </div>
  ${isEmbed ? '' : `<button class="print-btn no-print" onclick="window.print()">Print / Save as PDF</button>`}
</body>
</html>`;

  res.type("html").send(html);
});

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ────────── SSE Events Endpoint ──────────

app.get("/events/:businessId", (req, res) => {
  const { businessId } = req.params;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const clientId = randomUUID();
  const client: SSEClient = { id: clientId, res };

  if (!sseClients.has(businessId)) {
    sseClients.set(businessId, []);
  }
  sseClients.get(businessId)!.push(client);
  console.log(`  [SSE] Client ${clientId.slice(0, 8)} connected for ${businessId} (${sseClients.get(businessId)!.length} total)`);

  // Send connected event
  res.write(`event: connected\ndata: ${JSON.stringify({ clientId, businessId })}\n\n`);

  // Keepalive every 30s
  const keepAlive = setInterval(() => {
    try { res.write(":\n\n"); } catch { /* client gone */ }
  }, 30000);

  // Clean up on disconnect
  req.on("close", () => {
    clearInterval(keepAlive);
    const clients = sseClients.get(businessId);
    if (clients) {
      const idx = clients.findIndex((c) => c.id === clientId);
      if (idx >= 0) clients.splice(idx, 1);
      if (clients.length === 0) sseClients.delete(businessId);
    }
    console.log(`  [SSE] Client ${clientId.slice(0, 8)} disconnected from ${businessId}`);
  });
});

// ────────── Incoming Job + Background Review ──────────

app.post("/jobs/:businessId/incoming", (req, res) => {
  const { businessId } = req.params;
  const trade = req.body?.trade || undefined;

  const job = generateMockJob(businessId, trade);

  // Save to jobs file
  const existingJobs = loadMockJobs(businessId);
  existingJobs.push(job);
  saveMockJobs(businessId, existingJobs);

  // Broadcast new_job immediately
  broadcastToBusinessSSE(businessId, "new_job", {
    job_id: job.job_id,
    name: job.name,
    suburb: job.suburb,
    customer_name: job.customer?.name,
  });

  // Return HTTP response immediately
  res.json({
    success: true,
    business_id: businessId,
    job_id: job.job_id,
    message: "Job received, reviewing in background",
  });

  // Fire-and-forget: background review, then push notification
  reviewJobInBackground(businessId, job)
    .then((review) => {
      // Save agent_review on the job
      updateJobInFile(businessId, job.job_id, { agent_review: review });

      // Push notification AFTER review — uses AI-generated summary
      const pushBody = review.notification_summary
        || `${job.name || "New job"} in ${job.suburb || "your area"}`;
      sendPushToBusinessDevices(businessId, {
        title: "New Lead",
        body: pushBody,
        data: { job_id: job.job_id, business_id: businessId },
      });

      // Broadcast review complete
      broadcastToBusinessSSE(businessId, "job_reviewed", {
        job_id: job.job_id,
        job,
        review,
      });
      console.log(`  [Review] Job ${job.job_id}: score=${review.score} rec=${review.recommendation}`);
    })
    .catch((err) => {
      console.error(`  [Review] Failed for job ${job.job_id}: ${err.message}`);

      // Still send a basic push even if review fails
      sendPushToBusinessDevices(businessId, {
        title: "New Lead",
        body: `${job.name || "New job"} in ${job.suburb || "your area"}`,
        data: { job_id: job.job_id, business_id: businessId },
      });

      broadcastToBusinessSSE(businessId, "review_failed", {
        job_id: job.job_id,
        error: err.message,
      });
    });
});

// ────────── Approve & Skip Endpoints ──────────

app.post("/jobs/:businessId/:jobId/approve", (req, res) => {
  const { businessId, jobId } = req.params;
  const { draft_message } = req.body;

  const job = getJobById(businessId, jobId);
  if (!job) return res.status(404).json({ error: `Job ${jobId} not found` });

  const customer = job.customer || {};
  const firstName = customer.first_name || (customer.name || "").split(" ")[0];
  const message = draft_message || `Hi ${firstName}, I'd love to help with your ${job.name || "job"}. When would be a good time to discuss?`;

  // Log the sent message
  addMessageToConversation(businessId, jobId, "tradie", message, "intro");

  // Update job status to contacted
  updateJobInFile(businessId, jobId, { status: "contacted" });

  // Log to memory
  updateMemory(businessId, "Quick Approve", `${job.name} in ${job.suburb} — sent intro to ${firstName}`);

  // Simulate a customer reply
  const simResponse = `Thanks for getting in touch! Can you give me a rough idea of pricing?`;
  addMessageToConversation(businessId, jobId, "customer", simResponse, "response");

  // Broadcast update
  broadcastToBusinessSSE(businessId, "job_updated", {
    job_id: jobId,
    status: "contacted",
    action: "approved",
  });

  res.json({
    success: true,
    job_id: jobId,
    status: "contacted",
    message_sent: message,
    customer_response: simResponse,
  });
});

app.post("/jobs/:businessId/:jobId/skip", (req, res) => {
  const { businessId, jobId } = req.params;
  const { reason } = req.body;

  const job = getJobById(businessId, jobId);
  if (!job) return res.status(404).json({ error: `Job ${jobId} not found` });

  // Update job status to skipped
  updateJobInFile(businessId, jobId, { status: "skipped", skip_reason: reason || "Skipped from notification" });

  // Log to memory
  updateMemory(businessId, "Quick Skip", `${job.name} in ${job.suburb} — ${reason || "no reason"}`);

  // Broadcast update
  broadcastToBusinessSSE(businessId, "job_updated", {
    job_id: jobId,
    status: "skipped",
    action: "skipped",
  });

  res.json({
    success: true,
    job_id: jobId,
    status: "skipped",
    reason: reason || "Skipped from notification",
  });
});

// ────────── System Prompt Endpoint (native) ──────────

app.get("/system-prompt", (_req, res) => {
  res.json({
    success: true,
    prompt: TRADE_ASSISTANT_PROMPT_STATIC,
  });
});

// ────────── Start ──────────
initDataDirs(); // Create data directories on Railway if needed

app.listen(CONFIG.port, () => {
  console.log(`Trade Assistant TS (pi-agent) running on port ${CONFIG.port}`);
  console.log(`Web directory: ${webDir}`);
  console.log(`Dashboard: http://localhost:${CONFIG.port}/static/trade-dashboard.html`);
  console.log(`All endpoints native (no Python proxy)`);
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
