/**
 * 14 core tools ported to TypeScript.
 * Reads/writes the same files as the Python version.
 */
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-ai";
import {
  getJobById,
  loadMockJobs,
  updateJobInFile,
  getConversation as getConv,
  addMessageToConversation,
  updateMemory,
  updateBusinessField,
  type MockJob,
} from "./bootstrap.js";
import fs from "fs";
import path from "path";
import { CONFIG } from "./config.js";

// Helper to make tool results
function result(data: Record<string, unknown>) {
  const text = JSON.stringify(data, null, 2);
  return { content: [{ type: "text" as const, text }], details: data };
}

function errorResult(msg: string) {
  return result({ error: msg });
}

// ────────── TOOLS ──────────

export function createTools(businessId: string): AgentTool<any>[] {
  return [
    // 1. review_job
    {
      name: "review_job",
      label: "Review Job",
      description: "Get a job's full details with scoring and recommendation.",
      parameters: Type.Object({
        job_id: Type.String({ description: "The job ID to review" }),
      }),
      execute: async (_id: string, params: any) => {
        const job = getJobById(businessId, params.job_id);
        if (!job) return errorResult(`Job ${params.job_id} not found`);

        const customer = job.customer || {};
        const greenFlags: string[] = [];
        const redFlags: string[] = [...(job.red_flags || [])];
        let score = 5;

        if (customer.verified) { greenFlags.push("Verified customer"); score += 1; }
        if ((customer.jobs_posted || 0) >= 3) { greenFlags.push(`${customer.jobs_posted} previous jobs`); score += 1; }
        else if ((customer.jobs_posted || 0) === 0) { redFlags.push("first_time_customer"); score -= 1; }
        if (customer.rating && customer.rating >= 4.5) { greenFlags.push(`${customer.rating} rating`); score += 0.5; }

        if (job.budget_min && job.budget_max) { greenFlags.push(`Budget: ${job.budget_display}`); score += 1; }
        else { redFlags.push("no_budget"); score -= 0.5; }

        const desc = job.description || "";
        if (desc.length > 100) { greenFlags.push("Detailed description"); score += 1; }
        else if (desc.length < 30) { redFlags.push("vague_description"); score -= 1; }

        if (job.intent === "ready_to_hire") { greenFlags.push("Ready to hire"); score += 1; }
        else if (job.intent === "researching") { redFlags.push("researching_only"); score -= 1; }

        const distance = job.distance_km || 0;
        if (distance <= 5) { greenFlags.push(`Close: ${distance}km`); score += 0.5; }
        else if (distance > 10) { redFlags.push(`Far: ${distance}km`); score -= 1; }

        score = Math.max(1, Math.min(10, Math.round(score)));

        let recommendation = "ask";
        let recText = "Ask more questions before quoting";
        if (score >= 7) { recommendation = "quote"; recText = "Good opportunity - recommend quoting"; }
        else if (score < 5) { recommendation = "skip"; recText = "Consider skipping"; }

        const size = job.size || "medium";
        const sub = (job.subcategory || "").toLowerCase();
        let quoteRange = { min: 1500, max: 3000 };
        if (sub.includes("cabinet")) quoteRange = size === "medium" ? { min: 1500, max: 2500 } : { min: 1000, max: 1800 };
        else if (sub.includes("exterior")) quoteRange = size === "large" ? { min: 3500, max: 6000 } : { min: 2000, max: 3500 };
        else if (sub.includes("fence")) quoteRange = { min: 600, max: 1200 };
        else if (size === "small") quoteRange = { min: 400, max: 700 };
        else if (size === "large") quoteRange = { min: 3000, max: 5000 };

        const firstName = customer.first_name || (customer.name || "").split(" ")[0];

        return result({
          status_info: { status: job.status, already_contacted: ["quoting", "contacted", "booked"].includes(job.status || "") },
          job,
          contact: { name: customer.name, first_name: firstName, phone: customer.phone, preference: customer.contact_preference },
          analysis: { score, score_display: `${score}/10`, green_flags: greenFlags, red_flags: redFlags, recommendation, recommendation_text: recText, suggested_quote_range: quoteRange },
        });
      },
    },

    // 2. get_jobs_by_status
    {
      name: "get_jobs_by_status",
      label: "Get Jobs by Status",
      description: "Get jobs filtered by status.",
      parameters: Type.Object({
        status: Type.String({ description: "'leads', 'quoting', 'booked', 'complete', 'all'" }),
      }),
      execute: async (_id: string, params: any) => {
        const allJobs = loadMockJobs(businessId);
        const statusMap: Record<string, string[]> = {
          leads: ["new", "contacted"], new: ["new", "contacted"],
          quoting: ["quoting", "site_visit_scheduled"],
          booked: ["booked", "in_progress"],
          complete: ["complete"], all: [],
        };
        const filterStatuses = statusMap[params.status.toLowerCase()];
        const filtered = filterStatuses?.length
          ? allJobs.filter((j) => filterStatuses.includes(j.status || ""))
          : allJobs;

        return result({ success: true, filter: params.status, jobs: filtered, count: filtered.length });
      },
    },

    // 3. skip_job
    {
      name: "skip_job",
      label: "Skip Job",
      description: "Skip/discard a job lead.",
      parameters: Type.Object({
        job_id: Type.String({ description: "The job to skip" }),
        reason: Type.String({ description: "Why skipping" }),
      }),
      execute: async (_id: string, params: any) => {
        const job = getJobById(businessId, params.job_id);
        if (!job) return errorResult(`Job ${params.job_id} not found`);
        updateJobInFile(businessId, params.job_id, { status: "skipped", skip_reason: params.reason });
        updateMemory(businessId, "Skipped Job", `${job.name} in ${job.suburb} - ${params.reason}`);
        return result({ success: true, action: "skipped", job_id: params.job_id, job_name: job.name, reason: params.reason });
      },
    },

    // 4. send_message
    {
      name: "send_message",
      label: "Send Message",
      description: "Send a message to a customer about a job.",
      parameters: Type.Object({
        job_id: Type.String({ description: "The job to respond to" }),
        message: Type.String({ description: "Your message" }),
        message_type: Type.Optional(Type.String({ description: "'intro', 'credentials', 'question', 'follow_up', 'reply'" })),
      }),
      execute: async (_id: string, params: any) => {
        const job = getJobById(businessId, params.job_id);
        if (!job) return errorResult(`Job ${params.job_id} not found`);
        const msgType = params.message_type || "intro";
        const customer = job.customer || {};
        const firstName = customer.first_name || (customer.name || "").split(" ")[0];

        addMessageToConversation(businessId, params.job_id, "tradie", params.message, msgType);
        if (["new", "leads"].includes(job.status || "")) {
          updateJobInFile(businessId, params.job_id, { status: "quoting" });
        }
        updateMemory(businessId, `Message Sent (${msgType})`, `${job.name} in ${job.suburb} - to ${firstName}`);

        // Simulate a customer response (simplified)
        const simResponse = `Thanks for getting in touch! Can you give me a rough idea of pricing?`;
        addMessageToConversation(businessId, params.job_id, "customer", simResponse, "response");

        return result({
          success: true, action: "message_sent", job_id: params.job_id, job_name: job.name,
          customer_name: customer.name, message_type: msgType, message_sent: params.message,
          customer_response: { from: firstName, message: simResponse, received_at: "just now", expects: "quote" },
          note: `${firstName} has replied!`,
        });
      },
    },

    // 5. get_conversation
    {
      name: "get_conversation",
      label: "Get Conversation",
      description: "Get conversation history with a customer.",
      parameters: Type.Object({
        job_id: Type.String({ description: "The job ID" }),
      }),
      execute: async (_id: string, params: any) => {
        const job = getJobById(businessId, params.job_id);
        if (!job) return errorResult(`Job ${params.job_id} not found`);
        const conv = getConv(businessId, params.job_id);
        return result({ job_id: params.job_id, job_name: job.name, status: conv.status, messages: conv.messages, message_count: conv.messages.length });
      },
    },

    // 6. calculate_quote
    {
      name: "calculate_quote",
      label: "Calculate Quote",
      description: "Calculate a suggested quote for a job.",
      parameters: Type.Object({
        job_id: Type.String({ description: "The job to quote on" }),
        custom_amount: Type.Optional(Type.Number({ description: "Override amount" })),
      }),
      execute: async (_id: string, params: any) => {
        const job = getJobById(businessId, params.job_id);
        if (!job) return errorResult(`Job ${params.job_id} not found`);

        const size = (job.size || "medium").toLowerCase();
        const sizeHours: Record<string, number> = { small: 4, medium: 8, large: 16 };
        const hours = sizeHours[size] || 8;

        // Try to get hourly rate from BUSINESS.md
        let hourlyRate = 65;
        try {
          const bizPath = path.join(CONFIG.bootstrapDir, businessId, "BUSINESS.md");
          const content = fs.readFileSync(bizPath, "utf-8");
          const match = content.match(/\*\*Hourly Rate:\*\*\s*\$?(\d+)/i);
          if (match) hourlyRate = parseInt(match[1]);
        } catch { /* use default */ }

        const calculated = Math.max(hours * hourlyRate, 150);
        const finalAmount = params.custom_amount || calculated;
        const confidence = params.custom_amount ? "high" : "low";

        let budgetFit = "unknown";
        if (job.budget_min && job.budget_max) {
          if (finalAmount >= job.budget_min && finalAmount <= job.budget_max) budgetFit = "within_budget";
          else if (finalAmount < job.budget_min) budgetFit = "below_budget";
          else budgetFit = "above_budget";
        }

        return result({
          job_id: params.job_id, job_name: job.name, size,
          quote: { amount: finalAmount, breakdown: { estimated_hours: hours, hourly_rate: hourlyRate }, confidence, budget_fit: budgetFit },
          note: "Confirm price with tradie before sending",
        });
      },
    },

    // 7. submit_quote
    {
      name: "submit_quote",
      label: "Submit Quote",
      description: "Submit a quote for a job.",
      parameters: Type.Object({
        job_id: Type.String({ description: "The job to quote on" }),
        amount: Type.Number({ description: "Quote amount in dollars" }),
        message: Type.String({ description: "Message with the quote" }),
      }),
      execute: async (_id: string, params: any) => {
        const job = getJobById(businessId, params.job_id);
        if (!job) return errorResult(`Job ${params.job_id} not found`);
        if (["new", "leads"].includes(job.status || "")) {
          updateJobInFile(businessId, params.job_id, { status: "quoting" });
        }
        updateMemory(businessId, "Quote Submitted", `${job.name} (${job.suburb}) - $${params.amount} to ${job.customer?.name}`);
        return result({
          success: true, action: "quote_submitted", job_id: params.job_id, job_name: job.name,
          amount: params.amount, customer_name: job.customer?.name, message_sent: params.message,
          follow_up: `Is $${params.amount} your standard rate for ${job.subcategory} (${job.size} size)?`,
        });
      },
    },

    // 8. generate_quote_pdf (simplified - return data only)
    {
      name: "generate_quote_pdf",
      label: "Generate Quote PDF",
      description: "Generate a professional PDF quote (returns data, no actual PDF in TS version).",
      parameters: Type.Object({
        job_id: Type.String({ description: "The job to generate a quote for" }),
        line_items: Type.String({ description: "JSON string of line items" }),
        include_gst: Type.Optional(Type.Boolean({ description: "Whether to add GST" })),
      }),
      execute: async (_id: string, params: any) => {
        const job = getJobById(businessId, params.job_id);
        if (!job) return errorResult(`Job ${params.job_id} not found`);
        let items;
        try { items = JSON.parse(params.line_items); } catch { return errorResult("Invalid line_items JSON"); }

        const subtotal = items.reduce((sum: number, i: { amount: number }) => sum + (i.amount || 0), 0);
        const gst = (params.include_gst !== false) ? subtotal * 0.1 : 0;
        const total = subtotal + gst;

        return result({
          success: true, quote_number: `Q${Date.now()}`, total, subtotal, gst,
          line_items: items, message: `Quote generated: $${total} inc GST`,
          note: "PDF generation not available in TypeScript benchmark version",
        });
      },
    },

    // 9. add_memory_note
    {
      name: "add_memory_note",
      label: "Add Memory Note",
      description: "Add a note to memory.",
      parameters: Type.Object({
        category: Type.String({ description: "Category of the note" }),
        note: Type.String({ description: "The note to save" }),
      }),
      execute: async (_id: string, params: any) => {
        updateMemory(businessId, params.category, params.note);
        return result({ success: true, message: `Noted: ${params.note}`, category: params.category });
      },
    },

    // 10. learn_quoting_pattern
    {
      name: "learn_quoting_pattern",
      label: "Learn Quoting Pattern",
      description: "Capture a quoting pattern from the tradie's methodology.",
      parameters: Type.Object({
        pattern_name: Type.String({ description: "Short name for the pattern" }),
        trigger: Type.String({ description: "When this pattern applies" }),
        pattern_description: Type.String({ description: "The actual rule" }),
        example: Type.String({ description: "A concrete example" }),
        confidence: Type.Optional(Type.String({ description: "Low/Medium/High" })),
      }),
      execute: async (_id: string, params: any) => {
        // Append pattern to quoting skill file
        const skillDir = path.join(CONFIG.bootstrapDir, businessId, "skills", "quoting");
        fs.mkdirSync(skillDir, { recursive: true });
        const skillPath = path.join(skillDir, "SKILL.md");

        const timestamp = new Date().toISOString().split("T")[0];
        const entry = `\n### Pattern: ${params.pattern_name}\n**Observed**: ${timestamp}\n**Trigger**: ${params.trigger}\n**Pattern**: ${params.pattern_description}\n**Example**: ${params.example}\n**Confidence**: ${params.confidence || "Medium"}\n`;

        let content = "";
        try { content = fs.readFileSync(skillPath, "utf-8"); } catch {
          content = "---\nname: quoting\ndescription: Learns and applies pricing patterns\nemoji: 💰\nmetadata:\n  always: true\n---\n\n# Learned Patterns\n";
        }
        content += entry;
        fs.writeFileSync(skillPath, content);

        return result({ success: true, message: `Learned pattern '${params.pattern_name}'`, pattern: params });
      },
    },

    // 11. remember_business_info
    {
      name: "remember_business_info",
      label: "Remember Business Info",
      description: "Remember important info about the business.",
      parameters: Type.Object({
        field: Type.String({ description: "The type of information" }),
        value: Type.String({ description: "The value to remember" }),
      }),
      execute: async (_id: string, params: any) => {
        updateBusinessField(businessId, params.field, params.value);
        updateMemory(businessId, "Learned", `${params.field}: ${params.value}`);
        return result({ success: true, message: `Remembered: ${params.field} = ${params.value}` });
      },
    },

    // 12. get_business_context
    {
      name: "get_business_context",
      label: "Get Business Context",
      description: "Get all known context about the business.",
      parameters: Type.Object({}),
      execute: async () => {
        const files = ["BUSINESS.md", "ASSISTANT.md", "SOUL.md", "MEMORY.md", "PRICING.md", "JOB_HISTORY.md"];
        const context: Record<string, string | null> = {};
        for (const f of files) {
          try {
            context[f] = fs.readFileSync(path.join(CONFIG.bootstrapDir, businessId, f), "utf-8");
          } catch { context[f] = null; }
        }
        return result({ success: true, context });
      },
    },

    // 13. complete_first_session
    {
      name: "complete_first_session",
      label: "Complete First Session",
      description: "Mark the first session as complete.",
      parameters: Type.Object({}),
      execute: async () => {
        const firstSessionPath = path.join(CONFIG.bootstrapDir, businessId, "FIRST_SESSION.md");
        try {
          fs.unlinkSync(firstSessionPath);
          return result({ success: true, was_first_session: true, message: "First session complete!" });
        } catch {
          return result({ success: true, was_first_session: false, message: "Already met." });
        }
      },
    },

    // 14. record_outcome
    {
      name: "record_outcome",
      label: "Record Outcome",
      description: "Record whether a quoted job was won or lost.",
      parameters: Type.Object({
        job_id: Type.String({ description: "The job ID" }),
        outcome: Type.String({ description: "'won', 'lost', 'no_response', 'cancelled'" }),
      }),
      execute: async (_id: string, params: any) => {
        const job = getJobById(businessId, params.job_id);
        const jobName = job?.name || `Job ${params.job_id}`;
        updateMemory(businessId, `Job ${params.outcome.charAt(0).toUpperCase() + params.outcome.slice(1)}`, jobName);
        return result({ success: true, job_id: params.job_id, job_name: jobName, outcome: params.outcome });
      },
    },
  ];
}
