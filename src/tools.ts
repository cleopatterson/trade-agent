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
  updateBusinessSection,
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

    // 7. submit_quote — send a previously generated quote to the customer
    {
      name: "submit_quote",
      label: "Send Quote",
      description: "Send a previously generated quote to the customer. Call generate_quote_pdf first to create and preview the quote, then call this to actually send it. The tradie must approve the quote before sending.",
      parameters: Type.Object({
        job_id: Type.String({ description: "The job the quote is for" }),
        quote_id: Type.String({ description: "The quote ID from generate_quote_pdf (e.g. Q-ML8HNZEN)" }),
        message: Type.Optional(Type.String({ description: "Personal message to send with the quote" })),
      }),
      execute: async (_id: string, params: any) => {
        const job = getJobById(businessId, params.job_id);
        if (!job) return errorResult(`Job ${params.job_id} not found`);

        // Look up the stored quote for the total
        const { getStoredQuote } = await import("./index.js");
        const storedQuote = getStoredQuote(params.quote_id);
        const total = storedQuote?.total || 0;
        const customer = job.customer || {};
        const firstName = customer.first_name || (customer.name || "Customer").split(" ")[0];

        // Read business name
        let bizName = "Business";
        try {
          const biz = fs.readFileSync(path.join(CONFIG.bootstrapDir, businessId, "BUSINESS.md"), "utf-8");
          bizName = biz.match(/\*\*Business Name:\*\*\s*(.+)/)?.[1]?.trim() || bizName;
        } catch { /* ok */ }

        const personalMsg = params.message || `Hi ${firstName}, here's my quote for ${job.name || 'your job'}. Let me know if you have any questions.`;
        const fullMessage = `${personalMsg}\n\nQuote #${params.quote_id}: $${total.toFixed(2)} inc GST`;
        addMessageToConversation(businessId, params.job_id, "tradie", fullMessage, "quote");

        updateJobInFile(businessId, params.job_id, {
          status: "quoted",
          our_response: { quote_id: params.quote_id, amount: total, sent_at: new Date().toISOString() },
        });

        updateMemory(businessId, "Quote Sent", `${job.name} (${job.suburb}) - $${total.toFixed(2)} to ${firstName} [${params.quote_id}]`);

        // Simulate customer acknowledgment
        const ack = `Thanks ${bizName.split(" ")[0]}! I'll take a look at the quote and get back to you.`;
        addMessageToConversation(businessId, params.job_id, "customer", ack, "response");

        return result({
          success: true,
          action: "quote_sent",
          quote_id: params.quote_id,
          job_id: params.job_id,
          job_name: job.name,
          total,
          customer_name: customer.name || firstName,
          message_sent: fullMessage,
          customer_response: { from: firstName, message: ack },
          message: `Quote ${params.quote_id} sent to ${firstName}: $${total.toFixed(2)} inc GST`,
        });
      },
    },

    // 8. generate_quote_pdf — preview only, does NOT send
    {
      name: "generate_quote_pdf",
      label: "Generate Quote",
      description: "Generate a professional quote for PREVIEW. Creates a branded, printable quote page with business logo and colors. Does NOT send it — show the quote URL to the tradie first so they can review it, then call submit_quote to send. Line items should each have: description, amount, and optionally quantity and unit.",
      parameters: Type.Object({
        job_id: Type.String({ description: "The job to generate a quote for" }),
        line_items: Type.String({ description: 'JSON array of items, e.g. [{"description":"Interior painting - 3 rooms","amount":1800},{"description":"Ceiling repairs","quantity":2,"unit":"sqm","amount":350}]' }),
        include_gst: Type.Optional(Type.Boolean({ description: "Whether to add 10% GST (default true)" })),
        notes: Type.Optional(Type.String({ description: "Notes shown ON the quote page (e.g. payment terms, inclusions, warranty)" })),
        valid_days: Type.Optional(Type.Number({ description: "Quote validity in days (default 14)" })),
      }),
      execute: async (_id: string, params: any) => {
        const job = getJobById(businessId, params.job_id);
        if (!job) return errorResult(`Job ${params.job_id} not found`);
        let items: { description: string; quantity?: number; unit?: string; amount: number }[];
        try { items = JSON.parse(params.line_items); } catch { return errorResult("Invalid line_items JSON"); }

        const subtotal = items.reduce((sum, i) => sum + (i.amount || 0), 0);
        const includeGst = params.include_gst !== false;
        const gst = includeGst ? subtotal * 0.1 : 0;
        const total = subtotal + gst;

        // Read business details from BUSINESS.md
        const bizPath = path.join(CONFIG.bootstrapDir, businessId, "BUSINESS.md");
        let bizName = "Business", bizPhone = "", bizEmail = "", bizAbn = "";
        let brandColor = "", quoteTheme = "modern", bizLogo = "";
        const parseMdField = (text: string, field: string): string => {
          const m = text.match(new RegExp(`\\*\\*${field}:\\*\\*\\s*(.+)`));
          const val = m?.[1]?.trim() || "";
          if (!val || val.startsWith("*") || val.startsWith("-")) return "";
          return val;
        };
        try {
          const biz = fs.readFileSync(bizPath, "utf-8");
          bizName = parseMdField(biz, "Business Name") || bizName;
          bizPhone = parseMdField(biz, "Phone");
          bizEmail = parseMdField(biz, "Email");
          bizAbn = parseMdField(biz, "ABN");
          brandColor = parseMdField(biz, "Brand Color");
          quoteTheme = parseMdField(biz, "Quote Style") || "modern";
        } catch { /* ok */ }

        // Read logo
        try {
          const logoPath = path.join(CONFIG.bootstrapDir, businessId, "logo.json");
          const logoData = JSON.parse(fs.readFileSync(logoPath, "utf-8"));
          bizLogo = logoData.url || "";
        } catch { /* ok */ }

        const customer = job.customer || {};
        const firstName = customer.first_name || (customer.name || "Customer").split(" ")[0];

        const quoteId = `Q-${Date.now().toString(36).toUpperCase()}`;
        const { storeQuote } = await import("./index.js");
        storeQuote({
          id: quoteId,
          businessId,
          businessName: bizName,
          businessPhone: bizPhone,
          businessEmail: bizEmail,
          businessAbn: bizAbn,
          businessLogo: bizLogo,
          brandColor: brandColor,
          quoteTheme: quoteTheme,
          customerName: customer.name || firstName,
          jobName: job.name || "Job",
          jobDescription: job.description || "",
          suburb: job.suburb || "",
          lineItems: items,
          subtotal, gst, total, includeGst: includeGst,
          notes: params.notes,
          validDays: params.valid_days || 14,
          createdAt: new Date().toISOString(),
        });

        const quoteUrl = `/quotes/${quoteId}`;

        return result({
          success: true,
          quote_id: quoteId,
          total,
          subtotal,
          gst,
          line_items: items,
          quote_url: quoteUrl,
          customer_name: customer.name || firstName,
          job_name: job.name,
          message: `Quote ${quoteId} ready for review: $${total.toFixed(2)}${includeGst ? ' inc GST' : ''} for ${firstName}. Preview at ${quoteUrl}`,
          next_step: "Show the quote to the tradie. If they approve, call submit_quote to send it.",
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
        // Append pattern to quoting skill file (deduplicate by name)
        const skillDir = path.join(CONFIG.bootstrapDir, businessId, "skills", "quoting");
        fs.mkdirSync(skillDir, { recursive: true });
        const skillPath = path.join(skillDir, "SKILL.md");

        const timestamp = new Date().toISOString().split("T")[0];
        const entry = `\n### Pattern: ${params.pattern_name}\n**Observed**: ${timestamp}\n**Trigger**: ${params.trigger}\n**Pattern**: ${params.pattern_description}\n**Example**: ${params.example}\n**Confidence**: ${params.confidence || "Medium"}\n`;

        let content = "";
        try { content = fs.readFileSync(skillPath, "utf-8"); } catch {
          content = "---\nname: quoting\ndescription: Learns and applies pricing patterns\nemoji: 💰\nmetadata:\n  always: true\n---\n\n# Learned Patterns\n";
        }

        // Remove existing pattern with the same name (case-insensitive) before adding updated one
        const patternHeader = `### Pattern: ${params.pattern_name}`;
        const headerRegex = new RegExp(`\\n### Pattern: ${params.pattern_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n[\\s\\S]*?(?=\\n### |$)`, "i");
        content = content.replace(headerRegex, "");

        content += entry;
        fs.writeFileSync(skillPath, content);

        return result({ success: true, message: `Learned pattern '${params.pattern_name}'`, pattern: params });
      },
    },

    // 11. remember_business_info
    {
      name: "remember_business_info",
      label: "Remember Business Info",
      description: "Remember important info about the business. Routes to the correct file: assistant personality goes to ASSISTANT.md, communication/work style goes to SOUL.md, everything else to BUSINESS.md (in the right section).",
      parameters: Type.Object({
        field: Type.String({ description: "The type of information. Use exact field names: communication_style, work_style, messaging_style (→ SOUL.md) | assistant_name, vibe (→ ASSISTANT.md) | quote_style, materials, include_gst, estimate_style (→ Quoting Preferences) | working_days, typical_hours, current_workload (→ Availability) | preferred_job_size, red_flags, jobs_love, jobs_avoid (→ Job Preferences) | services, specialties (→ Services) | minimum, hourly_rate, day_rate (→ Pricing) | service_area, primary_suburbs (→ Service Areas)" }),
        value: Type.String({ description: "The value to remember" }),
      }),
      execute: async (_id: string, params: any) => {
        const field = params.field.toLowerCase();
        const value = params.value;

        // ── Route to ASSISTANT.md ──
        const assistantFields: Record<string, string> = {
          assistant_name: "Name", assistant_emoji: "Emoji", vibe: "Vibe",
          assistant_vibe: "Vibe", assistant_personality: "Vibe",
          response_length: "Response Length",
        };
        if (assistantFields[field]) {
          const mdField = assistantFields[field];
          const filePath = path.join(CONFIG.bootstrapDir, businessId, "ASSISTANT.md");
          try {
            let content = fs.readFileSync(filePath, "utf-8");
            const pattern = new RegExp(`(- \\*\\*${mdField}:\\*\\*).*`, "i");
            if (pattern.test(content)) {
              content = content.replace(pattern, `$1 ${value}`);
            } else {
              // Insert after header
              content = content.replace(/(# ASSISTANT\.md[^\n]*\n[^\n]*\n)/, `$1\n- **${mdField}:** ${value}\n`);
            }
            fs.writeFileSync(filePath, content);
          } catch { /* file missing, skip */ }
          updateMemory(businessId, "Learned", `${params.field}: ${value}`);
          return result({ success: true, message: `Updated ASSISTANT.md: ${mdField} = ${value}`, file: "ASSISTANT.md" });
        }

        // ── Route to SOUL.md ──
        const soulFields = ["communication_style", "work_style", "personality", "soul", "how_to_work", "messaging_style", "lead_philosophy"];
        if (soulFields.includes(field)) {
          const filePath = path.join(CONFIG.bootstrapDir, businessId, "SOUL.md");
          try {
            let content = fs.readFileSync(filePath, "utf-8");
            const sectionHeader = "## Learned Style";
            const entry = `- **${params.field}:** ${value}\n`;

            // Check if this field already exists — replace it instead of duplicating
            const existingPattern = new RegExp(`- \\*\\*${params.field}:\\*\\*[^\\n]*\\n`, "i");
            if (existingPattern.test(content)) {
              content = content.replace(existingPattern, entry);
            } else if (content.includes(sectionHeader)) {
              const idx = content.indexOf(sectionHeader) + sectionHeader.length + 1;
              content = content.slice(0, idx) + entry + content.slice(idx);
            } else {
              // Insert before the closing ---
              const lastDash = content.lastIndexOf("---");
              if (lastDash > 0) {
                content = content.slice(0, lastDash) + `\n${sectionHeader}\n${entry}\n` + content.slice(lastDash);
              } else {
                content += `\n${sectionHeader}\n${entry}`;
              }
            }
            fs.writeFileSync(filePath, content);
          } catch { /* file missing, skip */ }
          updateMemory(businessId, params.field, value);
          return result({ success: true, message: `Updated SOUL.md: ${params.field}`, file: "SOUL.md" });
        }

        // ── Route to BUSINESS.md (correct section) ──
        const sectionRoutes: Record<string, { section: string; mdField: string }> = {
          // Pricing
          pricing: { section: "Pricing", mdField: "Pricing" },
          hourly_rate: { section: "Pricing", mdField: "Hourly Rate" },
          day_rate: { section: "Pricing", mdField: "Day Rate" },
          minimum: { section: "Pricing", mdField: "Minimum Job Value" },
          minimum_job: { section: "Pricing", mdField: "Minimum Job Value" },
          // Service Areas
          service_area: { section: "Service Areas", mdField: "Service Area" },
          max_travel: { section: "Service Areas", mdField: "Max Travel Distance" },
          travel_fee: { section: "Service Areas", mdField: "Travel Fee Outside Primary" },
          primary_suburbs: { section: "Service Areas", mdField: "Primary Suburbs" },
          // Services
          services: { section: "Services & Specialties", mdField: "Services" },
          specialties: { section: "Services & Specialties", mdField: "Specialties" },
          // Quoting
          quote_style: { section: "Quoting Preferences", mdField: "Quote Format" },
          quote_format: { section: "Quoting Preferences", mdField: "Quote Format" },
          materials: { section: "Quoting Preferences", mdField: "Materials" },
          materials_included: { section: "Quoting Preferences", mdField: "Materials" },
          include_gst: { section: "Quoting Preferences", mdField: "Include GST" },
          estimate_style: { section: "Quoting Preferences", mdField: "Estimate Style" },
          // Availability
          availability: { section: "Availability", mdField: "Working Days" },
          working_days: { section: "Availability", mdField: "Working Days" },
          typical_hours: { section: "Availability", mdField: "Typical Hours" },
          current_workload: { section: "Availability", mdField: "Current Workload" },
          busy_periods: { section: "Availability", mdField: "Busy Periods" },
          // Job Preferences
          job_preferences: { section: "Job Preferences", mdField: "Preferred Job Size" },
          preferred_job_size: { section: "Job Preferences", mdField: "Preferred Job Size" },
          jobs_love: { section: "Job Preferences", mdField: "Jobs You Love" },
          jobs_avoid: { section: "Job Preferences", mdField: "Jobs You Avoid" },
          red_flags: { section: "Job Preferences", mdField: "Red Flags You Watch For" },
          // Branding
          brand_color: { section: "Branding", mdField: "Brand Color" },
          quote_theme: { section: "Branding", mdField: "Quote Style" },
        };

        const route = sectionRoutes[field];
        if (route) {
          updateBusinessSection(businessId, route.section, route.mdField, value);
        } else {
          // Default: update in Basics
          updateBusinessField(businessId, params.field, value);
        }
        updateMemory(businessId, "Learned", `${params.field}: ${value}`);
        return result({ success: true, message: `Remembered: ${params.field} = ${value}`, file: "BUSINESS.md", section: route?.section || "Basics" });
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
