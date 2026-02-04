/**
 * Bootstrap file management - reads AND writes the same MD files as the Python version.
 * Also handles job generation, trade filtering, and skills loading.
 */
import fs from "fs";
import path from "path";
import { CONFIG } from "./config.js";

// ============================================================================
// CONSTANTS
// ============================================================================

const STABLE_FILES = ["BUSINESS.md", "ASSISTANT.md", "SOUL.md", "JOB_HISTORY.md"];
const DYNAMIC_FILES = ["FIRST_SESSION.md", "MEMORY.md"];

export const VALID_FILENAMES = [
  "BUSINESS.md", "ASSISTANT.md", "SOUL.md", "MEMORY.md",
  "PRICING.md", "JOB_HISTORY.md", "FIRST_SESSION.md",
];

// ============================================================================
// TEMPLATE CONSTANTS (ported from trade_bootstrap.py)
// ============================================================================

export const BUSINESS_TEMPLATE = `# BUSINESS.md - About Your Business

*Your assistant learns about your business here. Update as things change.*

## Basics
- **Business Name:**
- **Owner Name:**
- **Phone:**
- **Email:**
- **Trade:** *(painting, plumbing, electrical, etc.)*
- **ABN:**
- **Years in Business:**
- **License Number:**

## Service Areas
- **Primary Suburbs:**
- **Secondary Suburbs:**
- **Max Travel Distance:** *(km)*
- **Travel Fee Outside Primary:** *($)*

## Services & Specialties
*(What do you specialize in? What won't you do?)*


## Pricing
- **Hourly Rate:** *($)*
- **Day Rate:** *($)*
- **Minimum Job Value:** *($)*

## Quoting Preferences
*(How you like to quote - learned over time)*
- **Quote Format:** *(message, PDF, depends on job size)*
- **PDF Threshold:** *($ amount above which you want formal PDF quotes)*
- **Estimate Style:** *(range, fixed, ballpark for small jobs)*
- **Include GST:** *(yes/no/itemize separately)*

## Availability
- **Working Days:** *(weekdays, weekends, both)*
- **Typical Hours:**
- **Busy Periods:**
- **Calendar Connected:** *(yes/no)*

## Job Preferences
- **Preferred Job Size:** *(small, medium, large)*
- **Jobs You Love:**
- **Jobs You Avoid:**
- **Red Flags You Watch For:**

## What Makes You Different
*(Why should customers choose you?)*

## Branding
- **Brand Color:** *(hex color e.g. #2563eb)*
- **Quote Style:** modern

---
*The more your assistant knows, the better it can help you win jobs.*
`;

export const ASSISTANT_TEMPLATE = `# ASSISTANT.md - Your Assistant's Identity

*Who I am. Change this anytime - I'll adapt.*

- **Name:** Baz
- **Vibe:** Straight-talking, gets stuff done, has your back
- **Emoji:** \u{1F527}
- **Response Length:** default

---

## Notes
*(Anything else about how you want me to come across)*


---
*This is mine to evolve. As I learn your style, I might suggest changes.*
`;

export const SOUL_TEMPLATE = `# SOUL.md - Who I Am

*Not a chatbot. Not a search engine. Someone who gives a damn.*

## Core Values

**Be genuinely helpful, not performatively helpful.**
Skip "Great question!" and "I'd be happy to help!" \u2014 just help. Actions over filler.

**Have opinions.**
I can disagree, prefer things, find stuff a waste of time. No personality = just a search engine with extra steps.

**Be resourceful before asking.**
Figure it out first. Check what I know. Read the files. Then ask if stuck. Answers, not questions.

**Earn trust through competence.**
You gave me access to your business. I won't make you regret it.

**Their voice, not yours.**
When you message customers, you're speaking for their business. That's a privilege. Don't assume - confirm.

**Remember everything.**
Every conversation teaches something. Save it. Use it next time.

## How I Work

**Don't interrogate. Just talk.**
One question at a time. Listen. Respond. Then the next.

**Be practical, not fancy.**
Skip corporate talk. Get to the point. Bottom line first, details if they want them.

**Protect your time.**
Don't waste it on jobs that won't convert. Spot the red flags.

**Help you win.**
Good quotes are specific. Fast responses win. But don't be desperate.

**Be honest.**
Job looks bad? Say so. Profile needs work? Tell you. No manufactured problems, but no hidden ones either.

---
*This is my soul. As I learn who you are, I'll evolve it.*
`;

export const MEMORY_TEMPLATE = `# MEMORY.md - What Your Assistant Has Learned

*Notes, patterns, and context from working together.*

## Profile Insights
*(What we've noticed about your profile)*


## Quoting Patterns
*(Jobs you win, jobs you lose, what works)*


## Preferences
*(Things you've mentioned - suburbs you like, job sizes, timing)*


## Recent Activity
*(Log of key interactions)*


---
*Your assistant updates this as it learns. You can edit it too.*
`;

export const PRICING_TEMPLATE = `# PRICING.md - Learned Pricing

*This file is populated as the assistant learns your pricing. No defaults - everything is learned from you.*

## Base Rates
*To be learned - tell me your hourly rate, day rate, minimum call-out*

## Job Type Pricing
*To be learned - as we quote jobs together, I'll capture your pricing for different job types*

## Quote History
*Quotes submitted - helps calibrate pricing*

<!-- Format: [date] Job Type (Size) - Location - $Amount - Status -->

## Pricing Notes
*Your specific adjustments and rules - captured as we work together*

---
*Your assistant uses this to suggest prices. Keep it updated!*
`;

export const JOB_HISTORY_TEMPLATE = `# JOB_HISTORY.md - Your Completed Jobs

*A summary of past jobs to help with quoting and customer conversations.*

## Stats
- **Total Jobs Completed:** 0
- **Total Revenue:** $0
- **Average Job Value:** $0
- **Average Rating:** N/A

## Recent Completed Jobs
*(Your completed jobs will appear here)*


## Job Types Summary
*(Breakdown by job type will appear here)*


---
*This updates automatically as you complete jobs.*
`;

export const FIRST_SESSION_TEMPLATE = `# FIRST_SESSION.md - You Haven't Met Yet

*First time working with this tradie. Get to know them through a quick guided chat, then get to work.*

## Your Job Right Now

Learn the 5 things that actually change how you work for them. Do this through a natural, guided conversation — NOT a form. Use button choices to make it fast, keep it warm.

## The Opening

Quick warm intro — who you are, what you do. Then straight into it:

"Hey, I'm [your name from ASSISTANT.md] — I help you find jobs, send quotes, and chase up customers. Before we dive into your leads, let me get a quick feel for how you work."

Then ask the first question with buttons. ALWAYS include a skip option as the last button.

## The 5 Questions That Matter

These 5 things directly change how you behave. Ask ONE AT A TIME in your own voice. Offer 3-4 button choices plus [[Skip - show me my leads]] on every question. React naturally to each answer before the next one.

**Don't announce how many questions. Don't number them. Just chat.**

After each answer, IMMEDIATELY call \`remember_business_info()\` with the exact field name shown below. Don't batch saves — save after every single answer.

### 1. How should I talk to you?
→ Field: \`communication_style\` → SOUL.md
This changes every message you send. Casual mate = short punchy texts. Professional = polished proposals. Match their energy.
Buttons: [[Casual - like a mate]] [[Professional]] [[Friendly but sharp]] [[Skip - show me my leads]]

### 2. How picky are you with leads?
→ Field: \`work_style\` → SOUL.md
This is the most important setting. It determines whether you show them everything or filter aggressively. "Show me everything" means never skip a lead. "Only premium" means you actively recommend skipping small or vague jobs.
Buttons: [[Show me everything]] [[Filter out the junk]] [[Only premium fits]] [[Skip - show me my leads]]

### 3. How do you price jobs?
→ Field: \`quote_style\` → BUSINESS.md (Quoting Preferences / Quote Format)
This shapes your entire quoting skill. Each answer means something different:
- "Set rates" = they have an hourly or day rate, you'll learn it and calculate from there
- "Fixed price" = they eyeball the scope and give a number, you learn their pricing instincts
- "Detailed rate card" = they want itemised quotes with specific products and quantities
- "Wing it" = they quote on feel, you just help them stay consistent
Buttons: [[I have set rates]] [[Fixed price per job]] [[Detailed rate card]] [[Wing it]] [[Skip - show me my leads]]

### 4. Do you include materials in your quotes?
→ Field: \`materials\` → BUSINESS.md (Quoting Preferences / Materials)
Critical for quoting accuracy. Labour-only tradies quote completely differently from supply-and-install tradies.
Buttons: [[Labour only]] [[Materials included]] [[Depends on the job]] [[Skip - show me my leads]]

### 5. How busy are you right now?
→ Field: \`current_workload\` → BUSINESS.md (Availability / Current Workload)
This changes how aggressively you chase leads. Flat out = be selective, don't waste their time. Quiet = be hungry, chase everything, respond fast.
Buttons: [[Flat out - booked for weeks]] [[Steady - few gaps to fill]] [[Pretty quiet - need work]] [[Skip - show me my leads]]

## The Skip / Escape Hatch

If at ANY point they click "Skip - show me my leads" or say anything like "just show me jobs", "skip", "let's go":

1. Save whatever you've learned so far
2. "No worries, let's get to work. I'll learn the rest as we go."
3. Call \`complete_first_session()\`
4. Show their jobs

## After The 5 Questions — Keep Going?

Once you've covered the 5 core questions, offer to keep going OR get to work:

"Nice, I've got the essentials. Want to keep teaching me or jump into your leads?"

Buttons: [[Show me my leads]] [[Keep going]]

### If They Keep Going — Bonus Topics

These are useful but not critical. Ask them naturally, same format. Save with the field names shown.

**Working schedule** → \`working_days\` (BUSINESS.md Availability)
"What days do you normally work?"
[[Mon-Fri]] [[Mon-Sat]] [[7 days if needed]] [[Skip - show me my leads]]

**Minimum job value** → \`minimum\` (BUSINESS.md Pricing)
"Is there a job size that's not worth your time?"
[[No minimum - take anything]] [[Under $500 not worth it]] [[Under $2k skip it]] [[Skip - show me my leads]]

**Specialties** → \`services\` (BUSINESS.md Services & Specialties)
"What's your bread and butter? What do you NOT do?"
Let them type this one — it's too specific for buttons.

**Red flags** → \`red_flags\` (BUSINESS.md Job Preferences)
"Anything that makes you instantly pass on a job?"
[[No budget listed]] [[Vague description]] [[Nothing - I'll sort it myself]] [[Skip - show me my leads]]

They can stop the bonus round any time with "show me my leads" or just by asking about something else.

## Future "Teach Me" Sessions

In later sessions, if BUSINESS.md still has empty fields (placeholder text like *($)* or *(weekdays, weekends, both)*), you can occasionally offer to fill gaps — but NEVER force it. Something like:

"Hey, I noticed I don't know your day rate yet. Want to set that up, or just keep rolling?"

One question at a time, only when there's a natural pause. Never batch these.

## Flow Rules

- ONE topic per message. Never batch.
- ALWAYS include skip button — never trap them.
- Use your personality from ASSISTANT.md — if you're "Davo" be casual, if you're "James" be polished.
- React to their answer naturally before the next question.
- If their answer covers a later topic, skip it.
- Adapt button text to sound natural — these are guides, not exact strings.
- Custom typed answers are fine — work with whatever they give you.
- SAVE IMMEDIATELY after each answer — don't wait until the end.

## What NOT to Do

- Don't announce question counts or number them
- Don't make it feel like a form or survey
- Don't trap them — always give a way out
- Don't dump multiple questions at once
- Don't be robotic — natural back-and-forth
- Don't skip the pricing question — it's the foundation of your quoting skill

---
*Get to know them fast, then get to work. Learn the rest over time.*
`;

const TEMPLATES: Record<string, string> = {
  "BUSINESS.md": BUSINESS_TEMPLATE,
  "ASSISTANT.md": ASSISTANT_TEMPLATE,
  "SOUL.md": SOUL_TEMPLATE,
  "MEMORY.md": MEMORY_TEMPLATE,
};

// ============================================================================
// BOOTSTRAP FILE I/O
// ============================================================================

function readBootstrapFile(businessId: string, filename: string): string | null {
  const filePath = path.join(CONFIG.bootstrapDir, businessId, filename);
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

export function writeBootstrapFile(businessId: string, filename: string, content: string): void {
  const dir = path.join(CONFIG.bootstrapDir, businessId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), content, "utf-8");
}

export function deleteBusinessDir(businessId: string): boolean {
  const dir = path.join(CONFIG.bootstrapDir, businessId);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

export function ensureBusinessBootstrap(businessId: string): void {
  const dir = path.join(CONFIG.bootstrapDir, businessId);
  const businessFile = path.join(dir, "BUSINESS.md");
  if (fs.existsSync(businessFile)) return;

  fs.mkdirSync(dir, { recursive: true });
  for (const [filename, template] of Object.entries(TEMPLATES)) {
    const filePath = path.join(dir, filename);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, template, "utf-8");
    }
  }
  // Create FIRST_SESSION.md for new businesses
  const firstSessionPath = path.join(dir, "FIRST_SESSION.md");
  if (!fs.existsSync(firstSessionPath)) {
    fs.writeFileSync(firstSessionPath, FIRST_SESSION_TEMPLATE, "utf-8");
  }
}

export function getBootstrapStatus(businessId: string): Record<string, unknown> {
  const dir = path.join(CONFIG.bootstrapDir, businessId);
  const exists = (f: string) => fs.existsSync(path.join(dir, f));
  return {
    business_id: businessId,
    initialized: exists("BUSINESS.md"),
    files: {
      "BUSINESS.md": exists("BUSINESS.md"),
      "ASSISTANT.md": exists("ASSISTANT.md"),
      "SOUL.md": exists("SOUL.md"),
      "MEMORY.md": exists("MEMORY.md"),
      "JOB_HISTORY.md": exists("JOB_HISTORY.md"),
      "FIRST_SESSION.md": exists("FIRST_SESSION.md"),
    },
  };
}

export function listBusinesses(): Array<{ id: string; name: string }> {
  const businesses: Array<{ id: string; name: string }> = [];
  try {
    const entries = fs.readdirSync(CONFIG.bootstrapDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("biz_")) continue;
      const businessFile = path.join(CONFIG.bootstrapDir, entry.name, "BUSINESS.md");
      let name = entry.name;
      try {
        const content = fs.readFileSync(businessFile, "utf-8");
        const match = content.match(/\*\*Business Name:\*\*\s*(.+?)(?:\n|$)/);
        if (match && match[1].trim()) name = match[1].trim();
      } catch { /* no file */ }
      businesses.push({ id: entry.name, name });
    }
  } catch { /* dir doesn't exist */ }
  businesses.sort((a, b) => a.name.localeCompare(b.name));
  return businesses;
}

export function getBusinessLogo(businessId: string): Record<string, unknown> {
  const logoFile = path.join(CONFIG.bootstrapDir, businessId, "logo.json");
  try {
    const data = JSON.parse(fs.readFileSync(logoFile, "utf-8"));
    return {
      success: true,
      business_id: businessId,
      logo_url: data.url,
      uploaded_at: data.uploaded_at,
      cdn: data.cdn,
    };
  } catch { /* no logo.json */ }

  // Fallback: check BUSINESS.md for legacy Logo URL field
  const content = readBootstrapFile(businessId, "BUSINESS.md") || "";
  const match = content.match(/\*\*Logo URL:\*\*\s*(\S+)/);
  if (match) {
    return { success: true, business_id: businessId, logo_url: match[1], legacy: true };
  }
  return { success: false, business_id: businessId, logo_url: null };
}

// ============================================================================
// CONTEXT BUILDING (used by agent.ts)
// ============================================================================

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
    const globalSkillPath = path.join(CONFIG.skillsDir, "quoting", "SKILL.md");
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

/** Response length presets — maps label to max tokens */
const RESPONSE_LENGTH_PRESETS: Record<string, number> = {
  "short": 200,
  "default": 300,
  "detailed": 600,
  "long": 1024,
};

/** Read per-profile settings from ASSISTANT.md */
export function getProfileSettings(businessId: string): { maxTokens: number | null } {
  const content = readBootstrapFile(businessId, "ASSISTANT.md");
  if (!content) return { maxTokens: null };

  const match = content.match(/\*\*Response Length:\*\*\s*(.+)/i);
  if (!match) return { maxTokens: null };

  const value = match[1].trim().toLowerCase();
  // Check presets first
  if (RESPONSE_LENGTH_PRESETS[value]) {
    return { maxTokens: RESPONSE_LENGTH_PRESETS[value] };
  }
  // Try parsing as a number
  const num = parseInt(value);
  if (!isNaN(num) && num > 0) {
    return { maxTokens: num };
  }
  return { maxTokens: null };
}

export function buildDynamicContext(businessId: string): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const timeStr = now.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true });
  const parts: string[] = [`## Session\nBusiness ID: ${businessId}\nDate: ${dateStr}\nTime: ${timeStr}`];

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
      const statusNote = job.status === "new" ? " \u26A1 NEW" : "";
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

// ============================================================================
// MOCK JOBS I/O
// ============================================================================

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
  budget_min?: number | null;
  budget_max?: number | null;
  budget_display?: string;
  timeline?: string;
  availability?: string;
  posted_ago?: string;
  posted_at?: string;
  customer?: {
    name?: string;
    first_name?: string;
    phone?: string;
    verified?: boolean;
    member_since?: string;
    jobs_posted?: number;
    rating?: number;
    contact_preference?: string;
  };
  attachments?: string[];
  lead_score?: number;
  urgency?: string;
  intent?: string;
  status?: string;
  our_response?: unknown;
  conversation?: unknown[];
  outcome?: unknown;
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

export function saveMockJobs(businessId: string, jobs: MockJob[]): void {
  fs.mkdirSync(CONFIG.mockDir, { recursive: true });
  const filePath = path.join(CONFIG.mockDir, `jobs_for_business_${businessId}.json`);
  const data = { success: true, jobs_count: jobs.length, jobs, business_id: businessId };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
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

// ============================================================================
// TRADE FILTERING (ported from trade_server.py)
// ============================================================================

export const TRADE_SUBCATEGORY_KEYWORDS: Record<string, string[]> = {
  fencing: ["fencing", "fence", "fencer", "pool fence", "colorbond", "timber paling", "gate"],
  painting: ["painting", "paint", "painter", "interior", "exterior", "cabinet", "deck stain", "house paint"],
  plumbing: ["plumbing", "plumber", "tap", "toilet", "pipe", "drain", "water heater", "hot water", "blocked", "gas fitting", "bathroom renovation"],
  electrical: ["electrical", "electrician", "wiring", "power point", "light", "switchboard"],
  carpentry: ["carpentry", "carpenter", "timber", "wood", "deck", "pergola"],
  landscaping: ["landscaping", "landscaper", "garden", "lawn", "paving", "retaining wall"],
  cleaning: ["cleaning", "cleaner", "carpet", "window", "pressure wash"],
  roofing: ["roofing", "roofer", "roof", "gutter", "gutters", "downpipe", "tiles", "metal roof", "ridge", "leak"],
  tiling: ["tiling", "tiler", "tile", "tiles", "bathroom tiles", "floor tiles"],
  gasfitting: ["gas", "gas fitting", "gas fitter", "gasfitter", "bbq", "cooktop", "heater"],
};

export function matchesTrade(job: MockJob, trade: string): boolean {
  if (!trade) return true;

  const trades = trade.split(",").map((t) => t.trim().toLowerCase());
  const allKeywords = new Set<string>();

  for (const t of trades) {
    for (const [tradeKey, keywords] of Object.entries(TRADE_SUBCATEGORY_KEYWORDS)) {
      if (t === tradeKey || keywords.includes(t)) {
        keywords.forEach((kw) => allKeywords.add(kw));
      }
      for (const kw of keywords) {
        if (t.includes(kw)) {
          keywords.forEach((k) => allKeywords.add(k));
          break;
        }
      }
    }
    allKeywords.add(t);
  }

  const jobSubcategory = (job.subcategory || "").toLowerCase();
  const jobName = (job.name || "").toLowerCase();

  for (const keyword of allKeywords) {
    if (jobSubcategory.includes(keyword) || jobName.includes(keyword)) return true;
  }
  return false;
}

export function parseBusinessField(content: string, field: string): string {
  const pattern = new RegExp(`\\*\\*${field}:\\*\\*\\s*(.+?)(?:\\n|$)`, "i");
  const match = content.match(pattern);
  if (match) {
    let value = match[1].trim();
    value = value.replace(/\*\([^)]+\)\*/g, "").trim();
    return value || "";
  }
  return "";
}

// ============================================================================
// MOCK JOB GENERATION (ported from trade_server.py)
// ============================================================================

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomFloat(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

const SUBURBS = [
  { name: "Balgowlah", postcode: "2093", km: 2.3 },
  { name: "Manly", postcode: "2095", km: 4.1 },
  { name: "Mosman", postcode: "2088", km: 5.8 },
  { name: "Freshwater", postcode: "2096", km: 3.5 },
  { name: "Dee Why", postcode: "2099", km: 8.2 },
  { name: "Neutral Bay", postcode: "2089", km: 6.5 },
  { name: "Cremorne", postcode: "2090", km: 7.1 },
  { name: "Brookvale", postcode: "2100", km: 5.0 },
];

const CUSTOMER_DATA = [
  { name: "Sarah Mitchell", first: "Sarah", phone: "0412 345 678" },
  { name: "David Kowalski", first: "David", phone: "0423 987 654" },
  { name: "Emma Liu", first: "Emma", phone: "0434 567 890" },
  { name: "James Robertson", first: "James", phone: "0467 234 567" },
  { name: "Lisa Patel", first: "Lisa", phone: "0478 345 678" },
  { name: "Michael Chen", first: "Michael", phone: "0489 456 789" },
  { name: "Rachel Wong", first: "Rachel", phone: "0411 567 890" },
  { name: "Chris Brown", first: "Chris", phone: "0422 678 901" },
];

const TRADE_JOB_TEMPLATES: Record<string, Record<string, string[]>> = {
  fencing: {
    "Colorbond Fencing": [
      "Need {length}m of colorbond fencing installed along the back boundary. Old timber paling fence needs removal. Ground is relatively flat with good access from side gate.",
      "Looking for colorbond fence around pool area - approximately {length}m total. Must comply with pool safety regulations. Gates required on both ends.",
      "Replace existing damaged colorbond panels (about {length}m section). Storm damage - some posts may need replacing too. Colour is Woodland Grey.",
      "New colorbond fence for front yard - {length}m with sliding gate for driveway. Need to match neighbour's fence height (1.8m).",
      "Side boundary fence replacement - {length}m colorbond. Neighbour has agreed to split cost. Need quote for full job.",
    ],
    "Timber Paling Fence": [
      "Need {length}m timber paling fence built. Capped and stained. Have a slight slope on the block - maybe 500mm drop over the length.",
      "Replace rotted timber fence sections - about {length}m total. Would like hardwood palings this time. Keep existing good posts if possible.",
      "New timber fence for dog containment - {length}m around backyard. Needs to be 1.8m high, no gaps at bottom. Single gate near back door.",
      "Front fence - {length}m timber paling with pedestrian gate. Want a nice capped look with decorative posts.",
    ],
    "Fence Repairs": [
      "Few fence panels blown down in recent storm - about {length}m section. Posts seem ok, just need new palings and rails.",
      "Gate is sagging and won't close properly. Might need new hinges and to re-hang it. Also latch is broken.",
      "Dog has pushed through fence in corner - need about {length}m section repaired urgently.",
      "Termite damage to bottom rails - fence is leaning. About {length}m affected. Need assessment of what can be saved.",
    ],
  },
  painting: {
    "Interior House Painting": [
      "Need to repaint {rooms} rooms. Walls in good condition, just need a fresh coat. High ceilings in living area.",
      "Looking to change wall colors in {rooms} rooms. Currently cream, want modern grey tones. Some minor crack repairs needed.",
      "Full interior repaint for 3-bed house - all walls and ceilings. Feature wall in master bedroom. Tenant moving out so empty house.",
      "Living room and hallway repaint - about {sqm}sqm of walls. Want to brighten up the space with white.",
    ],
    "Exterior House Painting": [
      "Full exterior repaint needed. Two-storey weatherboard house, about {sqm}sqm. Some timber rot to address first.",
      "Need to repaint exterior trim, fascias and gutters. House is brick so just the woodwork. Access is good.",
      "Complete exterior job including prep work. Single storey, about {sqm}sqm. Some peeling paint on north side needs scraping.",
    ],
    "Cabinet Painting": [
      "Kitchen cabinet repaint. {doors} doors and {drawers} drawers, solid timber.",
      "Want to paint bathroom vanity and kitchen cabinets white.",
      "Cabinet refinishing - currently dark stain, want painted white.",
    ],
  },
  default: {
    "General Work": [
      "General repair work needed at residential property. Please contact for site inspection and quote.",
      "Home improvement project requiring experienced tradie. Flexible on timing, quality is priority.",
    ],
  },
};

const BUDGET_RANGES: Record<string, Record<string, [number, number]>> = {
  "Colorbond Fencing": { small: [1500, 3000], medium: [3000, 5500], large: [5500, 9000] },
  "Timber Paling Fence": { small: [1800, 3500], medium: [3500, 6500], large: [6500, 10000] },
  "Fence Repairs": { small: [300, 800], medium: [800, 1500], large: [1500, 2500] },
  "Interior House Painting": { small: [800, 1500], medium: [2000, 4500], large: [4500, 10000] },
  "Exterior House Painting": { small: [2000, 4000], medium: [4000, 8000], large: [8000, 15000] },
  "Cabinet Painting": { small: [800, 1500], medium: [1500, 2500], large: [2500, 4000] },
  "General Work": { small: [500, 1500], medium: [1500, 3000], large: [3000, 5000] },
};

export function generateMockJob(
  businessId: string,
  trade?: string,
  subcategory?: string,
  urgency?: string,
): MockJob {
  const suburb = randomChoice(SUBURBS);
  const customer = randomChoice(CUSTOMER_DATA);
  const verified = Math.random() > 0.3;

  const tradeKey = (trade || "painting").toLowerCase();

  let templates: Record<string, string[]>;
  if (tradeKey.includes("fenc")) templates = TRADE_JOB_TEMPLATES.fencing;
  else if (tradeKey.includes("paint")) templates = TRADE_JOB_TEMPLATES.painting;
  else templates = TRADE_JOB_TEMPLATES.default;

  const selectedSub = subcategory && templates[subcategory] ? subcategory : randomChoice(Object.keys(templates));

  const length = randomChoice([8, 12, 15, 20, 25, 30, 35, 40]);
  const rooms = randomInt(2, 5);
  const sqm = randomChoice([40, 60, 80, 120, 150, 200]);
  const doors = randomInt(10, 20);
  const drawers = randomInt(5, 12);

  const description = randomChoice(templates[selectedSub])
    .replace("{length}", String(length))
    .replace("{rooms}", String(rooms))
    .replace("{sqm}", String(sqm))
    .replace("{doors}", String(doors))
    .replace("{drawers}", String(drawers));

  let size: string;
  if (tradeKey.includes("fenc")) {
    size = length <= 15 ? "small" : length >= 30 ? "large" : "medium";
  } else {
    size = rooms <= 2 ? "small" : rooms >= 4 ? "large" : "medium";
  }

  const budgetRange = BUDGET_RANGES[selectedSub] || BUDGET_RANGES["General Work"];
  const sizeRange = budgetRange[size] || budgetRange.medium;

  let budget_min: number | null = null;
  let budget_max: number | null = null;
  if (Math.random() > 0.25) {
    budget_min = Math.round(sizeRange[0] * randomFloat(0.9, 1.1));
    budget_max = Math.round(sizeRange[1] * randomFloat(0.9, 1.1));
  }

  const intent = randomChoice(["ready_to_hire", "researching"]);
  const timeline = randomChoice(["ASAP", "This week", "Next 2 weeks", "Next month", "Flexible"]);

  let baseScore: number;
  if (intent === "ready_to_hire") baseScore = randomInt(80, 95);
  else baseScore = randomInt(55, 70);
  if (["ASAP", "This week"].includes(timeline)) baseScore = Math.min(99, baseScore + randomInt(3, 8));
  if (budget_min || budget_max) baseScore = Math.min(99, baseScore + randomInt(2, 5));

  return {
    job_id: String(randomInt(100000, 999999)),
    name: selectedSub,
    description,
    subcategory: selectedSub,
    size: randomChoice(["small", "medium", "large"]),
    suburb: suburb.name,
    state: "NSW",
    postcode: suburb.postcode,
    distance_km: suburb.km,
    budget_min,
    budget_max,
    budget_display: budget_min ? `$${budget_min.toLocaleString()} - $${budget_max!.toLocaleString()}` : "No budget set",
    timeline,
    availability: randomChoice(["Weekdays (Business hours)", "Weekends only", "Flexible", "Any time"]),
    posted_ago: randomChoice(["1 hour ago", "3 hours ago", "5 hours ago", "1 day ago"]),
    posted_at: new Date().toISOString(),
    customer: {
      name: customer.name,
      first_name: customer.first,
      phone: customer.phone,
      verified,
      member_since: String(randomInt(2019, 2025)),
      jobs_posted: randomInt(0, 15),
      rating: verified ? parseFloat(randomFloat(4.0, 5.0).toFixed(1)) : undefined,
      contact_preference: randomChoice(["phone", "message", "either"]),
    },
    attachments: [],
    lead_score: baseScore,
    urgency: urgency || randomChoice(["low", "normal", "urgent"]),
    intent,
    status: "new",
    our_response: null,
    conversation: [],
    outcome: null,
  };
}

// ============================================================================
// JOB HISTORY GENERATION (ported from trade_simulation.py)
// ============================================================================

export function generateFakeJobHistory(trade: string, location?: string, numJobs?: number): Array<Record<string, unknown>> {
  const jobTemplates: Record<string, Array<{ type: string; names: string[]; sizes: string[]; priceRange: [number, number] }>> = {
    painting: [
      { type: "Interior House Painting", names: ["3 Room Repaint", "Master Bedroom", "Living Room Refresh", "Whole House Interior", "Hallway & Stairs"], sizes: ["small", "medium", "large"], priceRange: [400, 5000] },
      { type: "Exterior House Painting", names: ["Weatherboard Repaint", "Brick House Exterior", "Full Exterior", "Trim & Fascias"], sizes: ["medium", "large"], priceRange: [2000, 8000] },
      { type: "Cabinet Painting", names: ["Kitchen Cabinets", "Bathroom Vanity", "Laundry Cabinets", "Built-in Wardrobes"], sizes: ["small", "medium"], priceRange: [800, 3000] },
      { type: "Deck Staining", names: ["Deck Restoration", "Timber Deck Oil", "Deck Sand & Stain"], sizes: ["small", "medium"], priceRange: [500, 1500] },
      { type: "Touch Up & Repairs", names: ["Move-out Touch Ups", "Wall Repairs", "Ceiling Patch & Paint"], sizes: ["small"], priceRange: [200, 500] },
    ],
    default: [
      { type: "General Work", names: ["Standard Job", "Medium Project", "Large Project"], sizes: ["small", "medium", "large"], priceRange: [300, 3000] },
    ],
  };

  const firstNames = ["Michael", "Sarah", "David", "Emma", "James", "Lisa", "Chris", "Rachel", "Tom", "Michelle", "Peter", "Rebecca", "Alex", "Nicole", "Ben", "Kate"];
  const lastNames = ["Smith", "Chen", "Wilson", "Patel", "Brown", "Wong", "Taylor", "Lee", "Martin", "Thompson", "Garcia", "Kim", "Anderson", "Clark", "White"];
  const suburbs = ["Balgowlah", "Manly", "Freshwater", "Dee Why", "Mosman", "Neutral Bay", "Cremorne", "Fairlight", "Manly Vale", "Brookvale", "Curl Curl", "Narrabeen"];

  const feedbackTemplates = [
    "Excellent work! Very professional and tidy.",
    "Really happy with the result. Would recommend.",
    "Great job, finished on time and cleaned up well.",
    "Very pleased with the quality. Thanks!",
    "Fantastic work. Will definitely use again.",
    "Professional service from start to finish.",
    "Did a great job, very neat and efficient.",
    "Highly recommend - excellent quality work.",
    "Very happy with how it turned out. Thanks!",
    "Top quality work, very impressed.",
  ];

  const tradeLower = (trade || "").toLowerCase();
  const templates = tradeLower.includes("paint") ? jobTemplates.painting : jobTemplates.default;

  const actualNum = Math.min(numJobs || randomInt(5, 10), 15);
  const history: Array<Record<string, unknown>> = [];

  for (let i = 0; i < actualNum; i++) {
    const template = randomChoice(templates);
    const size = randomChoice(template.sizes);
    const sizeMultiplier = { small: 0.4, medium: 0.7, large: 1.0 }[size] ?? 0.7;
    let price = Math.round(randomFloat(template.priceRange[0] * sizeMultiplier, template.priceRange[1] * sizeMultiplier));
    price = Math.round(price / 50) * 50;

    const daysAgo = randomInt(14, 180);
    const completedDate = new Date(Date.now() - daysAgo * 86400000);

    history.push({
      job_id: `hist_${String(i + 1).padStart(3, "0")}`,
      completed_at: completedDate.toISOString(),
      job_type: template.type,
      job_name: randomChoice(template.names),
      size,
      suburb: location ? location.split(",")[0].trim() : randomChoice(suburbs),
      customer_name: `${randomChoice(firstNames)} ${randomChoice(lastNames)}`,
      final_price: price,
      customer_feedback: randomChoice(feedbackTemplates),
      customer_rating: Math.random() < 0.8 ? 5 : 4,
      what_was_done: `${template.type} - ${size} job`,
      days_taken: { small: 1, medium: 2, large: 4 }[size] ?? 2,
      would_work_again: true,
    });
  }

  history.sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)));
  return history;
}

// ============================================================================
// MATCHED JOBS GENERATION (ported from trade_simulation.py)
// ============================================================================

export function generateFakeMatchedJobs(trade: string, location?: string, numJobs?: number): { success: boolean; jobs_count: number; jobs: MockJob[] } {
  const firstNames = ["Michael", "Sarah", "David", "Emma", "James", "Lisa", "Chris", "Rachel", "Tom", "Michelle", "Peter", "Rebecca", "Alex", "Nicole", "Ben", "Kate", "John", "Amy", "Mark", "Jessica"];
  const lastNames = ["Smith", "Chen", "Wilson", "Patel", "Brown", "Wong", "Taylor", "Lee", "Martin", "Thompson", "Garcia", "Kim", "Anderson", "Clark", "White", "Harris", "Young", "King"];

  const defaultSuburbs = [
    { suburb: "Balgowlah", postcode: "2093", state: "NSW" },
    { suburb: "Manly", postcode: "2095", state: "NSW" },
    { suburb: "Freshwater", postcode: "2096", state: "NSW" },
    { suburb: "Dee Why", postcode: "2099", state: "NSW" },
    { suburb: "Mosman", postcode: "2088", state: "NSW" },
    { suburb: "Neutral Bay", postcode: "2089", state: "NSW" },
    { suburb: "Cremorne", postcode: "2090", state: "NSW" },
    { suburb: "Brookvale", postcode: "2100", state: "NSW" },
  ];

  let suburbs: Array<{ suburb: string; postcode: string; state: string; distance: [number, number] }>;
  if (location) {
    const parts = location.split(",");
    const baseSuburb = parts[0].trim();
    const baseState = parts[1]?.trim() || "NSW";
    suburbs = [{ suburb: baseSuburb, postcode: "2000", state: baseState, distance: [0.5, 3.0] }];
    for (let i = 0; i < Math.min(6, defaultSuburbs.length); i++) {
      suburbs.push({ ...defaultSuburbs[i], distance: [3.0 + i * 2, 8.0 + i * 3] });
    }
  } else {
    suburbs = defaultSuburbs.map((s) => ({ ...s, distance: [2.0, 15.0] as [number, number] }));
  }

  const tradeLower = (trade || "").toLowerCase();

  const tradeTemplates: Record<string, Array<{ subcategory: string; descriptions: string[]; sizes: string[]; budgetRange: [number, number] }>> = {
    fencing: [
      { subcategory: "Colorbond Fencing", descriptions: ["Need 25m of colorbond fencing installed along the back boundary. Old timber paling fence needs removal.", "Looking for colorbond fence around pool area - approximately 15m total. Must comply with pool safety regulations.", "Replace existing damaged colorbond panels (about 10m section). Storm damage.", "New colorbond fence for front yard - 18m with sliding gate for driveway."], sizes: ["small", "medium", "large"], budgetRange: [1500, 6000] },
      { subcategory: "Timber Paling Fence", descriptions: ["Need 20m timber paling fence built. Capped and stained. Slight slope on the block.", "Replace rotted timber fence sections - about 12m total. Would like hardwood palings.", "New timber fence for dog containment - 35m around backyard. Needs to be 1.8m high.", "Front fence - 8m timber paling with pedestrian gate."], sizes: ["small", "medium", "large"], budgetRange: [1800, 7000] },
      { subcategory: "Fence Repairs", descriptions: ["Few fence panels blown down in recent storm - about 6m section.", "Gate is sagging and won't close properly. Might need new hinges.", "Dog has pushed through fence in corner - need about 3m section repaired.", "Termite damage to bottom rails - fence is leaning. About 15m affected."], sizes: ["small", "medium"], budgetRange: [300, 1500] },
    ],
    painting: [
      { subcategory: "Interior House Painting", descriptions: ["Paint 3 bedrooms and hallway - walls and ceilings. Currently cream, want to go light grey.", "Living room and dining area repaint - high ceilings (3.2m). Feature wall.", "Full interior repaint - 4 bed house. Walls only, ceilings are fine.", "Kitchen and bathroom walls need repainting. Some prep work needed."], sizes: ["small", "medium", "large"], budgetRange: [800, 8000] },
      { subcategory: "Exterior House Painting", descriptions: ["Weatherboard house exterior needs full repaint. Two storey, about 250sqm.", "Brick house - paint render and all timber. Single storey. Currently cream, want charcoal.", "Just the front facade - brick render and front door. About 40sqm plus door.", "Repaint eaves, fascias and gutters only. House is 2 storey."], sizes: ["medium", "large"], budgetRange: [2000, 15000] },
    ],
    plumbing: [
      { subcategory: "General Plumbing", descriptions: ["Leaking tap in kitchen - been dripping for a week. Single mixer tap.", "Toilet is running constantly - think it's the cistern. Dual flush, about 5 years old.", "Blocked drain in bathroom - water draining very slowly from shower.", "Multiple small plumbing jobs - dripping tap, running toilet, slow drain."], sizes: ["small", "medium"], budgetRange: [150, 500] },
      { subcategory: "Hot Water Systems", descriptions: ["Hot water system not working - no hot water at all. Electric storage, about 10 years old.", "Want to upgrade to continuous flow hot water. Currently have old electric storage.", "Hot water system leaking from the base. Need assessment - repair or replace?"], sizes: ["medium", "large"], budgetRange: [800, 3000] },
    ],
    roofing: [
      { subcategory: "Roof Repairs", descriptions: ["Roof leak in bedroom - water coming in when it rains. Tile roof, about 30 years old.", "Few broken tiles from recent storm. Need 4-5 tiles replaced.", "Leaking around skylight - been getting worse over last few months.", "Ridge capping coming loose - can see daylight from inside roof space."], sizes: ["small", "medium"], budgetRange: [300, 1500] },
      { subcategory: "Gutter & Downpipes", descriptions: ["Gutters overflowing - need cleaned and checked. Single storey, Colorbond gutters.", "Downpipe disconnected from drain - water pooling near foundation.", "Gutters rusted through in sections - need about 10m replaced.", "Need leaf guard installed on all gutters. Single storey home."], sizes: ["small", "medium"], budgetRange: [200, 1000] },
    ],
    default: [
      { subcategory: "General Trade Work", descriptions: ["General repair work needed - please contact for details.", "Home improvement project - would like to discuss scope and get quote.", "Maintenance work required at residential property. Flexible on timing."], sizes: ["small", "medium"], budgetRange: [500, 3000] },
    ],
  };

  const timingMap: Record<string, string> = {
    asap_urgent: "ASAP", asap: "ASAP",
    next_couple_of_weeks: "Next 2 weeks", next_week: "Next week",
    this_month: "This month", flexible: "Flexible",
  };

  let templates: typeof tradeTemplates.default;
  if (tradeLower.includes("fenc")) templates = tradeTemplates.fencing;
  else if (tradeLower.includes("paint")) templates = tradeTemplates.painting;
  else if (tradeLower.includes("plumb") || tradeLower.includes("gas")) templates = tradeTemplates.plumbing;
  else if (tradeLower.includes("roof") || tradeLower.includes("gutter")) templates = tradeTemplates.roofing;
  else templates = tradeTemplates.default;

  // Weighted job count (most likely 1-2)
  const actualNum = numJobs || (() => {
    const weights = [30, 25, 20, 15, 7, 3];
    const total = weights.reduce((s, w) => s + w, 0);
    let r = Math.random() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return i + 1;
    }
    return 1;
  })();

  const jobs: MockJob[] = [];

  for (let i = 0; i < actualNum; i++) {
    const suburbInfo = randomChoice(suburbs);
    const template = randomChoice(templates);
    const description = randomChoice(template.descriptions);
    const subcategory = template.subcategory;
    const size = randomChoice(template.sizes);

    const intent = Math.random() < 0.3 ? "researching" : "ready_to_hire";
    let timing: string;
    let minBudget: number | null = null;
    let maxBudget: number | null = null;

    if (intent === "researching") {
      timing = "flexible";
      const sizeMultiplier = { small: 0.5, medium: 1.0, large: 1.8 }[size] ?? 1.0;
      minBudget = Math.round((template.budgetRange[0] * sizeMultiplier * randomFloat(0.9, 1.1)) / 50) * 50;
      maxBudget = Math.round((template.budgetRange[1] * sizeMultiplier * randomFloat(0.9, 1.1)) / 50) * 50;
    } else {
      timing = randomChoice(["asap", "asap", "next_couple_of_weeks", "next_week", "this_month"]);
    }

    let budgetDisplay: string;
    if (minBudget && maxBudget) budgetDisplay = `$${minBudget.toLocaleString()} - $${maxBudget.toLocaleString()}`;
    else if (maxBudget) budgetDisplay = `Up to $${maxBudget.toLocaleString()}`;
    else budgetDisplay = "No budget set";

    const hoursAgo = randomInt(1, 48);
    const postedAt = new Date(Date.now() - hoursAgo * 3600000);

    const firstName = randomChoice(firstNames);
    const contactPref = randomChoice(["phone", "message", "either"]);

    let baseScore: number;
    if (intent === "ready_to_hire") baseScore = randomInt(75, 95);
    else baseScore = randomInt(50, 70);
    if (["asap_urgent", "asap"].includes(timing)) baseScore = Math.min(99, baseScore + randomInt(5, 10));
    else if (["next_week", "next_couple_of_weeks"].includes(timing)) baseScore = Math.min(99, baseScore + randomInt(2, 5));

    const name = description.length > 50 ? description.substring(0, 50).replace(/\s+\S*$/, "...") : description;

    jobs.push({
      job_id: String(90000 + i),
      name,
      description,
      subcategory,
      size,
      suburb: suburbInfo.suburb,
      state: suburbInfo.state,
      postcode: suburbInfo.postcode,
      distance_km: parseFloat(randomFloat(suburbInfo.distance[0], suburbInfo.distance[1]).toFixed(1)),
      budget_min: minBudget ? Math.round(minBudget) : null,
      budget_max: maxBudget ? Math.round(maxBudget) : null,
      budget_display: budgetDisplay,
      timeline: timingMap[timing] || "Flexible",
      availability: randomChoice(["Weekdays", "Weekends", "Flexible", "Mornings", "Afternoons"]),
      posted_ago: hoursAgo < 24 ? `${hoursAgo} hours ago` : `${Math.floor(hoursAgo / 24)} days ago`,
      posted_at: postedAt.toISOString(),
      customer: {
        name: `${firstName} ${randomChoice(lastNames)}`,
        first_name: firstName,
        phone: `04${randomInt(10, 99)} ${randomInt(100, 999)} ${randomInt(100, 999)}`,
        verified: Math.random() > 0.2,
        member_since: String(randomInt(2018, 2025)),
        jobs_posted: randomInt(1, 15),
        contact_preference: contactPref,
      },
      attachments: [],
      lead_score: baseScore,
      urgency: ["asap_urgent", "asap"].includes(timing) ? "urgent" : "normal",
      intent,
      status: "new",
      our_response: null,
      conversation: [],
      outcome: null,
    });
  }

  jobs.sort((a, b) => (b.posted_at || "").localeCompare(a.posted_at || ""));
  return { success: true, jobs_count: jobs.length, jobs };
}

// ============================================================================
// JOB HISTORY MD GENERATION (ported from trade_bootstrap.py)
// ============================================================================

export function updateJobHistoryMd(businessId: string, jobs: Array<Record<string, unknown>>): void {
  if (!jobs.length) return;

  const totalJobs = jobs.length;
  const totalRevenue = jobs.reduce((sum, j) => sum + (Number(j.final_price) || 0), 0);
  const avgValue = totalJobs > 0 ? Math.floor(totalRevenue / totalJobs) : 0;

  const ratings = jobs.map((j) => j.customer_rating).filter((r): r is number => typeof r === "number" && r > 0);
  const avgRating = ratings.length ? (ratings.reduce((s, r) => s + r, 0) / ratings.length).toFixed(1) : "N/A";

  const jobTypes: Record<string, { count: number; revenue: number }> = {};
  for (const job of jobs) {
    const jt = String(job.job_type || "Other");
    if (!jobTypes[jt]) jobTypes[jt] = { count: 0, revenue: 0 };
    jobTypes[jt].count++;
    jobTypes[jt].revenue += Number(job.final_price) || 0;
  }

  const lines = [
    "# JOB_HISTORY.md - Your Completed Jobs",
    "",
    "*A summary of past jobs to help with quoting and customer conversations.*",
    "",
    "## Stats",
    `- **Total Jobs Completed:** ${totalJobs}`,
    `- **Total Revenue:** $${totalRevenue.toLocaleString()}`,
    `- **Average Job Value:** $${avgValue.toLocaleString()}`,
    avgRating !== "N/A" ? `- **Average Rating:** ${avgRating}/5` : "- **Average Rating:** N/A",
    "",
    "## Recent Completed Jobs",
  ];

  for (const job of jobs.slice(0, 10)) {
    const suburb = String(job.suburb || "Unknown");
    const price = Number(job.final_price) || 0;
    const rating = job.customer_rating;
    const feedback = String(job.customer_feedback || "");
    const jobType = String(job.job_type || job.job_name || "Job");

    const ratingStr = rating ? ` \u2B50${rating}` : "";
    const feedbackStr = feedback
      ? feedback.length > 50
        ? ` - "${feedback.substring(0, 50)}..."`
        : ` - "${feedback}"`
      : "";
    lines.push(`- **${jobType}** in ${suburb} - $${price.toLocaleString()}${ratingStr}${feedbackStr}`);
  }

  lines.push("");
  lines.push("## Job Types Summary");

  const sortedTypes = Object.entries(jobTypes).sort((a, b) => b[1].count - a[1].count);
  for (const [jt, data] of sortedTypes) {
    const avg = data.count > 0 ? Math.floor(data.revenue / data.count) : 0;
    lines.push(`- **${jt}:** ${data.count} jobs, $${data.revenue.toLocaleString()} total (avg $${avg.toLocaleString()})`);
  }

  lines.push("");
  lines.push("---");
  lines.push("*This updates automatically as you complete jobs.*");

  writeBootstrapFile(businessId, "JOB_HISTORY.md", lines.join("\n"));
}

// ============================================================================
// BUSINESS FIELD UPDATE HELPERS
// ============================================================================

export function updateBusinessField(businessId: string, field: string, value: string): void {
  const filePath = path.join(CONFIG.bootstrapDir, businessId, "BUSINESS.md");
  try {
    let content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const fieldPattern = `**${field}:**`;
    let updated = false;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(fieldPattern)) {
        if (lines[i].trim().startsWith("-")) {
          lines[i] = `- **${field}:** ${value}`;
        } else {
          lines[i] = `**${field}:** ${value}`;
        }
        updated = true;
        break;
      }
    }

    if (!updated) {
      // Add to Basics section
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === "## Basics") {
          let insertPos = i + 1;
          while (insertPos < lines.length && !lines[insertPos].startsWith("##")) {
            if (lines[insertPos].trim().startsWith("- **")) insertPos++;
            else if (lines[insertPos].trim() === "") break;
            else insertPos++;
          }
          lines.splice(insertPos, 0, `- **${field}:** ${value}`);
          updated = true;
          break;
        }
      }
    }

    if (updated) {
      fs.writeFileSync(filePath, lines.join("\n"), "utf-8");
    }
  } catch (e) {
    console.error(`Failed to update business field: ${e}`);
  }
}

export function updateBusinessSection(businessId: string, sectionName: string, fieldOrContent: string, fieldValue?: string): void {
  const filePath = path.join(CONFIG.bootstrapDir, businessId, "BUSINESS.md");
  try {
    let business = fs.readFileSync(filePath, "utf-8");
    const sectionPattern = `## ${sectionName}`;
    if (!business.includes(sectionPattern)) return;

    // If fieldValue is provided, update a specific field within the section
    if (fieldValue !== undefined) {
      const lines = business.split("\n");
      const fieldPattern = `**${fieldOrContent}:**`;
      let inSection = false;
      let fieldUpdated = false;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === sectionPattern) {
          inSection = true;
          continue;
        }
        if (inSection && (lines[i].startsWith("## ") || lines[i].startsWith("---"))) {
          // End of section — field not found, insert before this line
          if (!fieldUpdated) {
            lines.splice(i, 0, `- **${fieldOrContent}:** ${fieldValue}`);
            fieldUpdated = true;
          }
          break;
        }
        if (inSection && lines[i].includes(fieldPattern)) {
          lines[i] = `- **${fieldOrContent}:** ${fieldValue}`;
          fieldUpdated = true;
          break;
        }
      }
      // If we reached end of file without finding the section end
      if (inSection && !fieldUpdated) {
        // Find section start and append
        const sIdx = lines.findIndex(l => l.trim() === sectionPattern);
        if (sIdx >= 0) {
          let insertPos = sIdx + 1;
          while (insertPos < lines.length && !lines[insertPos].startsWith("## ") && !lines[insertPos].startsWith("---")) {
            insertPos++;
          }
          lines.splice(insertPos, 0, `- **${fieldOrContent}:** ${fieldValue}`);
        }
      }
      fs.writeFileSync(filePath, lines.join("\n"), "utf-8");
      return;
    }

    // Otherwise replace the entire section content
    const lines = business.split("\n");
    const newLines: string[] = [];
    let inSection = false;
    let sectionReplaced = false;

    for (const line of lines) {
      if (line.trim() === sectionPattern) {
        newLines.push(line);
        newLines.push(fieldOrContent);
        newLines.push("");
        inSection = true;
        sectionReplaced = true;
      } else if (inSection) {
        if (line.startsWith("## ") || line.startsWith("---")) {
          inSection = false;
          newLines.push(line);
        }
        // skip old content
      } else {
        newLines.push(line);
      }
    }

    if (sectionReplaced) {
      fs.writeFileSync(filePath, newLines.join("\n"), "utf-8");
    }
  } catch (e) {
    console.error(`Failed to update business section: ${e}`);
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

// ============================================================================
// SKILLS (ported from skill_loader.py)
// ============================================================================

export interface SkillInfo {
  name: string;
  emoji: string;
  description: string;
  user_invocable: boolean;
  always_load: boolean;
  file_path: string | null;
}

export interface SkillDetail extends SkillInfo {
  content: string;
  is_customized: boolean;
}

function parseYamlFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  if (!content.startsWith("---")) return { frontmatter: {}, body: content };

  const endMatch = content.substring(3).match(/\n---\n/);
  if (!endMatch || endMatch.index === undefined) return { frontmatter: {}, body: content };

  const fmText = content.substring(3, endMatch.index + 3);
  const body = content.substring(endMatch.index + 3 + 4 + 1);

  // Simple YAML parsing for our frontmatter (name, description, metadata, user-invocable)
  const fm: Record<string, unknown> = {};
  for (const line of fmText.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const key = line.substring(0, colonIdx).trim();
    let val: string | boolean | Record<string, unknown> = line.substring(colonIdx + 1).trim();
    if (val === "true") val = true;
    else if (val === "false") val = false;
    // Handle JSON metadata
    if (key === "metadata" && typeof val === "string" && val.startsWith("{")) {
      try { val = JSON.parse(val); } catch { /* keep as string */ }
    }
    fm[key] = val;
  }
  return { frontmatter: fm, body };
}

export function listSkills(businessId: string): SkillInfo[] {
  const skills: SkillInfo[] = [];
  const seen = new Set<string>();

  // Load global skills
  const globalDir = CONFIG.skillsDir;
  try {
    for (const entry of fs.readdirSync(globalDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
      const skillFile = path.join(globalDir, entry.name, "SKILL.md");
      if (!fs.existsSync(skillFile)) continue;

      const content = fs.readFileSync(skillFile, "utf-8");
      const { frontmatter } = parseYamlFrontmatter(content);
      const name = String(frontmatter.name || entry.name);
      const metadata = (typeof frontmatter.metadata === "object" ? frontmatter.metadata : {}) as Record<string, unknown>;

      seen.add(name);
      skills.push({
        name,
        emoji: String(metadata.emoji || "\u{1F4CB}"),
        description: String(frontmatter.description || ""),
        user_invocable: frontmatter["user-invocable"] !== false,
        always_load: !!metadata.always,
        file_path: skillFile,
      });
    }
  } catch { /* dir doesn't exist */ }

  // Load business-specific overrides
  const bizSkillsDir = path.join(CONFIG.bootstrapDir, businessId, "skills");
  try {
    for (const entry of fs.readdirSync(bizSkillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
      const skillFile = path.join(bizSkillsDir, entry.name, "SKILL.md");
      if (!fs.existsSync(skillFile)) continue;

      const content = fs.readFileSync(skillFile, "utf-8");
      const { frontmatter } = parseYamlFrontmatter(content);
      const name = String(frontmatter.name || entry.name);
      const metadata = (typeof frontmatter.metadata === "object" ? frontmatter.metadata : {}) as Record<string, unknown>;

      // Override or add
      const existingIdx = skills.findIndex((s) => s.name === name);
      const skill: SkillInfo = {
        name,
        emoji: String(metadata.emoji || "\u{1F4CB}"),
        description: String(frontmatter.description || ""),
        user_invocable: frontmatter["user-invocable"] !== false,
        always_load: !!metadata.always,
        file_path: skillFile,
      };

      if (existingIdx >= 0) skills[existingIdx] = skill;
      else skills.push(skill);
    }
  } catch { /* dir doesn't exist */ }

  return skills;
}

export function getSkillContent(businessId: string, skillName: string): SkillDetail | null {
  // Check business-specific first
  const bizSkillFile = path.join(CONFIG.bootstrapDir, businessId, "skills", skillName, "SKILL.md");
  let skillFile: string | null = null;
  let isCustomized = false;

  if (fs.existsSync(bizSkillFile)) {
    skillFile = bizSkillFile;
    isCustomized = true;
  } else {
    const globalSkillFile = path.join(CONFIG.skillsDir, skillName, "SKILL.md");
    if (fs.existsSync(globalSkillFile)) {
      skillFile = globalSkillFile;
    }
  }

  if (!skillFile) return null;

  const content = fs.readFileSync(skillFile, "utf-8");
  const { frontmatter, body } = parseYamlFrontmatter(content);
  const metadata = (typeof frontmatter.metadata === "object" ? frontmatter.metadata : {}) as Record<string, unknown>;

  return {
    name: String(frontmatter.name || skillName),
    emoji: String(metadata.emoji || "\u{1F4CB}"),
    description: String(frontmatter.description || ""),
    user_invocable: frontmatter["user-invocable"] !== false,
    always_load: !!metadata.always,
    file_path: skillFile,
    content: body.trim(),
    is_customized: isCustomized,
  };
}
