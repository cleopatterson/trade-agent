/**
 * Trade Agent using pi-agent-core.
 * Wraps the pi-agent Agent class with trade-specific configuration.
 */
import { Agent, ProviderTransport } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { CONFIG } from "./config.js";
import { createTools } from "./tools.js";
import { buildStableContext, buildDynamicContext } from "./bootstrap.js";

// Same system prompt as Python version
const TRADE_ASSISTANT_PROMPT_STATIC = `You are a trade assistant for ServiceSeeking, helping tradies win more jobs.

## Persona
If SOUL.md is present, embody its values and tone. If ASSISTANT.md is present, use that identity.
Avoid stiff, generic replies; follow their guidance.

## Tool Call Style
Default: do not narrate routine tool calls (just call the tool).
Narrate only when it helps: multi-step work, complex problems, or when explicitly asked.
Keep narration brief and value-dense; avoid repeating obvious steps.

## Memory Recall
Before answering anything about prior work, pricing decisions, preferences, or past jobs:
check MEMORY.md and learned skills first. If you checked and found nothing, say so.

## Silent Reply
When you genuinely have nothing to add (e.g., user says "thanks", "ok", "bye"):
respond with ONLY: [SILENT]
Rules: It must be your ENTIRE message. Never append it to an actual response.

## Skills (mandatory)
Before replying: scan available skills (quoting, contact templates, etc.).
If a skill clearly applies → use its learned patterns directly.
If corrected → update the skill with \`learn_quoting_pattern()\` or similar.

## Output Format
- One line per job in lists
- End messages with 2-4 action buttons: [[Button Text]]

## Context
Current State is in your context - DON'T call tools to read it. Use tools for ACTIONS only.

**If FIRST_SESSION.md exists** → you haven't met yet. Follow its guidance - show value through jobs, not feature lists.
**If no FIRST_SESSION.md** → returning user. You know each other. Check MEMORY.md for their preferences and how they like to work - respect what you've learned. Brief greeting, then straight to what matters.

## Ongoing Learning (Internal - Don't Announce This)

You're always learning about them, but silently. Never say "so I can learn" or "this helps me understand" - just do your job and pick things up along the way.

1. **Current capacity** - Are they busy or hungry for work right now?
   - Infer from reactions: passing on small jobs = comfortable; interested in distant jobs = needs work
   - A tradie will drive 90 mins for a $15k job but not for a $500 one. Unless they're desperate.
   - This changes week to week. Re-calibrate each session.

2. **Job preferences** - What's worth their time given their current state?
   - Notice what they pass on and what interests them
   - Save insights quietly with \`add_memory_note()\`

3. **Quoting patterns** - How do they price things?
   - Capture with \`learn_quoting_pattern()\` when you see how they quote
   - Check quoting skill before suggesting prices

4. **Tone of voice** - You'll message customers on their behalf.
   - Pick up their style: formal or casual? Emojis? How do they sign off?
   - Match their voice in customer communications

When they tell you how they want to work together, save it with \`add_memory_note()\`.

The learning is for YOU. To them, you're just helping find work.

## Jobs Pipeline
Leads → Quoting → Booked → Complete

Tools:
- \`get_jobs_by_status(status)\` - list jobs by stage
- \`review_job(job_id)\` - assess fit
- \`skip_job(job_id, reason)\` - pass on bad fits

## Quoting
No default rates - everything is learned. If you don't know their rate, ASK.

1. Check quoting skill for learned patterns
2. If patterns exist → use them directly
3. If NO patterns → ask how they'd price it
4. Learn from their answer → \`learn_quoting_pattern()\`

No jobs? Learn their pricing through conversation instead.

When corrected: \`learn_quoting_pattern(name, trigger, pattern, example)\`

Sending quotes:
- \`submit_quote(job_id, amount, message)\` - formal quote with price
- \`generate_quote_pdf(job_id, line_items)\` - professional PDF for jobs >$500
- \`send_message(job_id, message)\` - just talking, no price attached

Always confirm the price AND the message before sending.

## Contact
- Phone: 📞 [Call Name: number](tel:number)
- Message: \`send_message(job_id, message)\`

Before sending any message to a customer, show them the draft and get approval. Never assume what they want to say.

## Learning Tools
- \`add_memory_note(category, note)\` - capture insights
- \`remember_business_info(field, value)\` - save preferences
- \`record_outcome(job_id, outcome)\` - track win/loss`;

const BREVITY_ADDENDUM = `

## CRITICAL OVERRIDE: Brevity Mode ON
This overrides ALL other formatting and length instructions above. You MUST:
- Keep EVERY response to 1-2 SHORT sentences maximum
- No bullet points, no lists, no paragraphs
- No elaboration, no options, no suggestions unless asked
- Talk like a quick text message, not an essay
- Action buttons are still fine: [[Button Text]]
Violating brevity mode is a critical error.`;

export interface AgentSession {
  agent: Agent;
  businessId: string;
  totalLlmTime: number;
  totalToolTime: number;
  lastLlmTime: number;
  lastToolTime: number;
  turnCount: number;
}

export function createAgentSession(businessId: string): AgentSession {
  const model = getModel("anthropic", CONFIG.model);
  const tools = createTools(businessId);

  // Build system prompt with context
  const stableContext = buildStableContext(businessId);
  const dynamicContext = buildDynamicContext(businessId);
  let systemPrompt = TRADE_ASSISTANT_PROMPT_STATIC;
  if (stableContext) systemPrompt += `\n\n---\n\n${stableContext}`;
  if (dynamicContext) systemPrompt += `\n\n---\n\n${dynamicContext}`;

  const transport = new ProviderTransport({
    getApiKey: (provider: string) => {
      if (provider === "anthropic") {
        return process.env.TRADE_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
      }
      return undefined;
    },
  });

  const agent = new Agent({
    transport,
    initialState: {
      systemPrompt,
      model,
    },
  });

  agent.setTools(tools);

  return {
    agent,
    businessId,
    totalLlmTime: 0,
    totalToolTime: 0,
    lastLlmTime: 0,
    lastToolTime: 0,
    turnCount: 0,
  };
}

export interface StreamEvent {
  type: string;
  [key: string]: any;
}

export async function chatStream(
  session: AgentSession,
  message: string,
  onEvent: (event: StreamEvent) => void,
): Promise<string> {
  const t0 = performance.now();

  // Refresh dynamic context each turn
  const dynamicContext = buildDynamicContext(session.businessId);
  const stableContext = buildStableContext(session.businessId);
  let systemPrompt = TRADE_ASSISTANT_PROMPT_STATIC;
  if (stableContext) systemPrompt += `\n\n---\n\n${stableContext}`;
  if (dynamicContext) systemPrompt += `\n\n---\n\n${dynamicContext}`;
  if (CONFIG.brevityMode) systemPrompt += BREVITY_ADDENDUM;
  session.agent.setSystemPrompt(systemPrompt);

  // Apply maxTokens to model each turn (supports runtime changes)
  const baseModel = getModel("anthropic", CONFIG.model);
  session.agent.setModel({ ...baseModel, maxTokens: CONFIG.maxTokens });

  console.log(`  [Timing] context refresh: ${((performance.now() - t0) / 1000).toFixed(2)}s`);

  const t1 = performance.now();

  return new Promise<string>((resolve) => {
    let responseText = "";

    const unsubscribe = session.agent.subscribe((event) => {
      if (event.type === "message_update") {
        const evt = (event as any).assistantMessageEvent;
        if (evt?.type === "text_delta" && evt?.delta) {
          responseText += evt.delta;
          onEvent({ type: "text_delta", delta: evt.delta });
        }
      } else if (event.type === "tool_execution_start") {
        const e = event as any;
        onEvent({ type: "tool_start", name: e.toolName });
      } else if (event.type === "tool_execution_end") {
        const e = event as any;
        onEvent({ type: "tool_end", name: e.toolName, result: String(e.result).substring(0, 200) });
      } else if (event.type === "agent_end") {
        const elapsed = (performance.now() - t1) / 1000;
        session.lastLlmTime = elapsed;
        session.totalLlmTime += elapsed;
        session.turnCount++;
        console.log(`  [Timing] agent turn: ${elapsed.toFixed(2)}s`);

        unsubscribe();

        // If we didn't get streaming text, extract from final messages
        if (!responseText && (event as any).messages) {
          for (let i = (event as any).messages.length - 1; i >= 0; i--) {
            const msg = (event as any).messages[i] as any;
            if (msg.role === "assistant") {
              if (typeof msg.content === "string") {
                responseText = msg.content;
                break;
              }
              if (Array.isArray(msg.content)) {
                const texts = msg.content
                  .filter((b: any) => b.type === "text")
                  .map((b: any) => b.text);
                if (texts.length) {
                  responseText = texts.join("");
                  break;
                }
              }
            }
          }
        }

        const finalText = responseText || "No response generated.";
        onEvent({
          type: "done",
          response: finalText,
          timing: {
            total: parseFloat(elapsed.toFixed(3)),
            llm: parseFloat(session.lastLlmTime.toFixed(3)),
          },
        });

        resolve(finalText);
      }
    });

    session.agent.prompt(message).catch((err) => {
      unsubscribe();
      console.error(`  [Error] agent prompt failed: ${err.message}`);
      const errText = `Error: ${err.message}`;
      onEvent({ type: "done", response: errText, error: err.message });
      resolve(errText);
    });
  });
}

export async function chat(session: AgentSession, message: string): Promise<string> {
  const t0 = performance.now();

  // Refresh dynamic context each turn
  const dynamicContext = buildDynamicContext(session.businessId);
  const stableContext = buildStableContext(session.businessId);
  let systemPrompt = TRADE_ASSISTANT_PROMPT_STATIC;
  if (stableContext) systemPrompt += `\n\n---\n\n${stableContext}`;
  if (dynamicContext) systemPrompt += `\n\n---\n\n${dynamicContext}`;
  if (CONFIG.brevityMode) systemPrompt += BREVITY_ADDENDUM;
  session.agent.setSystemPrompt(systemPrompt);

  const baseModel = getModel("anthropic", CONFIG.model);
  session.agent.setModel({ ...baseModel, maxTokens: CONFIG.maxTokens });

  console.log(`  [Timing] context refresh: ${((performance.now() - t0) / 1000).toFixed(2)}s`);

  // Use event subscription to capture the final response text
  const t1 = performance.now();

  return new Promise<string>((resolve) => {
    let responseText = "";

    const unsubscribe = session.agent.subscribe((event) => {
      if (event.type === "message_update") {
        // Capture streaming text deltas
        const evt = event.assistantMessageEvent as any;
        if (evt?.type === "text_delta" && evt?.delta) {
          responseText += evt.delta;
        }
      } else if (event.type === "agent_end") {
        const elapsed = (performance.now() - t1) / 1000;
        session.lastLlmTime = elapsed;
        session.totalLlmTime += elapsed;
        session.turnCount++;
        console.log(`  [Timing] agent turn: ${elapsed.toFixed(2)}s`);

        unsubscribe();

        // If we didn't get streaming text, extract from final messages
        if (!responseText && event.messages) {
          for (let i = event.messages.length - 1; i >= 0; i--) {
            const msg = event.messages[i] as any;
            if (msg.role === "assistant") {
              if (typeof msg.content === "string") {
                responseText = msg.content;
                break;
              }
              if (Array.isArray(msg.content)) {
                const texts = msg.content
                  .filter((b: any) => b.type === "text")
                  .map((b: any) => b.text);
                if (texts.length) {
                  responseText = texts.join("");
                  break;
                }
              }
            }
          }
        }

        resolve(responseText || "No response generated.");
      }
    });

    // Fire and forget - events will resolve the promise
    session.agent.prompt(message).catch((err) => {
      unsubscribe();
      console.error(`  [Error] agent prompt failed: ${err.message}`);
      resolve(`Error: ${err.message}`);
    });
  });
}
