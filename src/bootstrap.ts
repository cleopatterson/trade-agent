/**
 * Bootstrap file reader - reads the same MD files as the Python version.
 * No writing - just reads for system prompt construction.
 */
import fs from "fs";
import path from "path";
import { CONFIG } from "./config.js";

const STABLE_FILES = ["BUSINESS.md", "ASSISTANT.md", "SOUL.md", "JOB_HISTORY.md"];
const DYNAMIC_FILES = ["FIRST_SESSION.md", "MEMORY.md"];

function readBootstrapFile(businessId: string, filename: string): string | null {
  const filePath = path.join(CONFIG.bootstrapDir, businessId, filename);
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

export function buildStableContext(businessId: string): string {
  const parts: string[] = [];
  for (const file of STABLE_FILES) {
    const content = readBootstrapFile(businessId, file);
    if (content) {
      parts.push(`## ${file}\n${content}`);
    }
  }

  // Read quoting skill if it exists
  const skillPath = path.join(CONFIG.bootstrapDir, businessId, "skills", "quoting", "SKILL.md");
  try {
    const skillContent = fs.readFileSync(skillPath, "utf-8");
    if (skillContent) {
      parts.push(`## Quoting Skill\n${skillContent}`);
    }
  } catch {
    // Also try global skill
    const globalSkillPath = path.join(CONFIG.tradeAgentDir, "skills", "quoting", "SKILL.md");
    try {
      const globalSkill = fs.readFileSync(globalSkillPath, "utf-8");
      if (globalSkill) {
        parts.push(`## Quoting Skill\n${globalSkill}`);
      }
    } catch {
      // No skill available
    }
  }

  return parts.join("\n\n");
}

export function buildDynamicContext(businessId: string): string {
  const parts: string[] = [`## Session\nBusiness ID: ${businessId}`];

  for (const file of DYNAMIC_FILES) {
    const content = readBootstrapFile(businessId, file);
    if (content) {
      parts.push(`## ${file}\n${content}`);
    }
  }

  // Build current state summary from mock jobs
  const stateSummary = buildCurrentStateSummary(businessId);
  if (stateSummary) {
    parts.push(stateSummary);
  }

  return parts.join("\n\n");
}

function buildCurrentStateSummary(businessId: string): string {
  const lines: string[] = ["## Current State"];

  const jobs = loadMockJobs(businessId);
  if (!jobs.length) {
    lines.push("\nNo jobs loaded.");
    return lines.join("\n");
  }

  const leads = jobs.filter((j) => ["new", "contacted"].includes(j.status || ""));
  const quoting = jobs.filter((j) => ["quoting", "site_visit_scheduled"].includes(j.status || ""));
  const booked = jobs.filter((j) => ["booked", "in_progress"].includes(j.status || ""));

  lines.push(`\n**Pipeline:** ${leads.length} leads | ${quoting.length} quoting | ${booked.length} booked`);

  if (leads.length) {
    lines.push(`\n**New Leads (${leads.length}):**`);
    for (const job of leads.slice(0, 5)) {
      const statusNote = job.status === "new" ? " ⚡ NEW" : "";
      lines.push(
        `- [${job.job_id}] ${job.name || ""} (${job.suburb || ""}) ${job.budget_display || ""}${statusNote}`
      );
    }
    if (leads.length > 5) lines.push(`  ...and ${leads.length - 5} more`);
  }

  if (!leads.length && !quoting.length && !booked.length) {
    lines.push("\nNo active jobs. Good time to review profile or pricing.");
  }

  return lines.join("\n");
}

export interface MockJob {
  job_id: string;
  name?: string;
  description?: string;
  subcategory?: string;
  size?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  distance_km?: number;
  budget_min?: number;
  budget_max?: number;
  budget_display?: string;
  timeline?: string;
  posted_ago?: string;
  customer?: {
    name?: string;
    first_name?: string;
    phone?: string;
    verified?: boolean;
    jobs_posted?: number;
    rating?: number;
    contact_preference?: string;
  };
  attachments?: string[];
  lead_score?: number;
  intent?: string;
  status?: string;
  skip_reason?: string;
  red_flags?: string[];
  [key: string]: unknown;
}

export function loadMockJobs(businessId: string): MockJob[] {
  const filePath = path.join(CONFIG.mockDir, `jobs_for_business_${businessId}.json`);
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return data.jobs || [];
  } catch {
    return [];
  }
}

export function getJobById(businessId: string, jobId: string): MockJob | null {
  const jobs = loadMockJobs(businessId);
  return jobs.find((j) => j.job_id === jobId) || null;
}

export function updateJobInFile(businessId: string, jobId: string, updates: Record<string, unknown>): boolean {
  const filePath = path.join(CONFIG.mockDir, `jobs_for_business_${businessId}.json`);
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const jobs: MockJob[] = data.jobs || [];
    const job = jobs.find((j) => j.job_id === jobId);
    if (!job) return false;
    Object.assign(job, updates);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch {
    return false;
  }
}

// Conversation state management (mirrors Python version)
interface ConversationState {
  job_id: string;
  status: string;
  messages: Array<{
    sender: string;
    message: string;
    type: string;
    timestamp: string;
  }>;
  site_visit: unknown;
  our_quote: unknown;
  customer_decision: unknown;
}

const conversationCache: Record<string, Record<string, ConversationState>> = {};

function getConversationsFile(businessId: string): string {
  const dir = path.join(CONFIG.memoryDir, businessId);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "conversations.json");
}

function loadConversations(businessId: string): Record<string, ConversationState> {
  if (conversationCache[businessId]) return conversationCache[businessId];
  const file = getConversationsFile(businessId);
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    conversationCache[businessId] = data;
    return data;
  } catch {
    conversationCache[businessId] = {};
    return {};
  }
}

function saveConversations(businessId: string) {
  const file = getConversationsFile(businessId);
  fs.writeFileSync(file, JSON.stringify(conversationCache[businessId] || {}, null, 2));
}

export function getConversation(businessId: string, jobId: string): ConversationState {
  const convs = loadConversations(businessId);
  if (!convs[jobId]) {
    convs[jobId] = {
      job_id: jobId,
      status: "new",
      messages: [],
      site_visit: null,
      our_quote: null,
      customer_decision: null,
    };
    saveConversations(businessId);
  }
  return convs[jobId];
}

export function addMessageToConversation(
  businessId: string,
  jobId: string,
  sender: string,
  message: string,
  msgType: string
) {
  const conv = getConversation(businessId, jobId);
  conv.messages.push({
    sender,
    message,
    type: msgType,
    timestamp: new Date().toISOString(),
  });
  if (sender === "tradie" && conv.status === "new") conv.status = "contacted";
  else if (sender === "customer" && conv.status === "contacted") conv.status = "in_conversation";
  saveConversations(businessId);
}

// Memory update helper
export function updateMemory(businessId: string, key: string, value: string) {
  const filePath = path.join(CONFIG.bootstrapDir, businessId, "MEMORY.md");
  try {
    let content = "";
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      content = "# Memory\n\n## Recent Activity\n";
    }

    const timestamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const entry = `- [${timestamp}] **${key}:** ${value}\n`;

    const activityIdx = content.indexOf("## Recent Activity");
    if (activityIdx >= 0) {
      const insertPos = activityIdx + "## Recent Activity\n".length;
      content = content.slice(0, insertPos) + entry + content.slice(insertPos);
    } else {
      content += `\n## Recent Activity\n${entry}`;
    }

    fs.writeFileSync(filePath, content);
  } catch (e) {
    console.error(`Failed to update memory: ${e}`);
  }
}

// Business field update helper
export function updateBusinessField(businessId: string, field: string, value: string) {
  const filePath = path.join(CONFIG.bootstrapDir, businessId, "BUSINESS.md");
  try {
    let content = fs.readFileSync(filePath, "utf-8");
    const pattern = new RegExp(`(\\*\\*${field}:\\*\\*\\s*)(.+?)(?=\\n|$)`, "i");
    const match = content.match(pattern);
    if (match) {
      content = content.replace(pattern, `$1${value}`);
    } else {
      content += `\n**${field}:** ${value}`;
    }
    fs.writeFileSync(filePath, content);
  } catch (e) {
    console.error(`Failed to update business field: ${e}`);
  }
}
