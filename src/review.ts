/**
 * Background job review via direct Anthropic Haiku API call.
 * No pi-agent, no tool loops — just one fast structured response.
 */
import { buildStableContext } from "./bootstrap.js";
import type { MockJob } from "./bootstrap.js";

export interface JobReview {
  score: number; // Uses the job's existing lead_score (converted to 1-10)
  recommendation: "send" | "skip";
  reasoning: string;
  draft_message: string;
  notification_summary: string;
  green_flags: string[];
  red_flags: string[];
  suggested_price_range: { min: number; max: number } | null;
}

const REVIEW_SYSTEM_PROMPT = `You are a trade assistant reviewing a job lead for a tradie. You will be given:
1. Business context (who the tradie is, what they do, their preferences, their rates)
2. Job details including a pre-calculated lead_score (0-100) based on lead strength

The lead_score is already calculated. Your job is to:
- Analyze the fit for THIS specific tradie
- Write a personalized intro message that includes a natural price indication
- Write a short notification summary for the phone lock screen
- Identify green/red flags
- Suggest a price range if possible

Respond with ONLY valid JSON matching this schema:
{
  "recommendation": "send" | "skip",
  "reasoning": "<1-2 sentence explanation of why this is/isn't a good fit for this tradie>",
  "draft_message": "<2-3 sentence intro message to the customer, in first person as the tradie. If the tradie's rates are in the business context, include them naturally. If no rates are available, leave a placeholder like '[your rate]' so the tradie can fill it in before sending.>",
  "notification_summary": "<Single sentence for phone notification, e.g. 'Painting a 3-bed interior in Mosman, needs it done ASAP'>",
  "green_flags": ["<positive signals>"],
  "red_flags": ["<concerns>"],
  "suggested_price_range": { "min": <number>, "max": <number> } or null
}

Recommendation guide:
- "send" if lead_score >= 60 AND fits the tradie's trade/area/preferences
- "skip" if lead_score < 50 OR significant red flags OR poor fit

The draft_message should be warm, professional, and mention something specific about the job. If the tradie's rates are in the business context, weave them in naturally. If no rates are available, include a placeholder like '[your rate/hr]' so the tradie fills it in. Keep it concise — tradies don't write essays.

The notification_summary is what appears on the phone lock screen. Keep it to one short sentence that captures: what the job is, where, and urgency. No greeting, no fluff.

For price range, estimate based on the job description and size. If insufficient info, use null.`;

export async function reviewJobInBackground(
  businessId: string,
  job: MockJob,
): Promise<JobReview> {
  const apiKey =
    process.env.TRADE_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("No ANTHROPIC_API_KEY configured for background review");
  }

  const stableContext = buildStableContext(businessId);

  const leadScore = job.lead_score ?? 50;

  const jobSummary = [
    `Job ID: ${job.job_id}`,
    `Title: ${job.name || "Untitled"}`,
    `Subcategory: ${job.subcategory || "Unknown"}`,
    `Size: ${job.size || "Unknown"}`,
    `Description: ${job.description || "No description"}`,
    `Location: ${job.suburb || "Unknown"}, ${job.state || ""} ${job.postcode || ""}`,
    `Distance: ${job.distance_km ?? "Unknown"}km`,
    `Budget: ${job.budget_display || "Not specified"}`,
    `Timeline: ${job.timeline || "Flexible"}`,
    `Urgency: ${job.urgency || "normal"}`,
    `Intent: ${job.intent || "unknown"}`,
    `Lead Score: ${leadScore}/100 (pre-calculated based on lead strength)`,
    `Customer: ${job.customer?.name || "Unknown"}`,
    `Customer Verified: ${job.customer?.verified ? "Yes" : "No"}`,
    `Jobs Posted: ${job.customer?.jobs_posted ?? "Unknown"}`,
    `Customer Rating: ${job.customer?.rating ?? "N/A"}`,
    `Contact Preference: ${job.customer?.contact_preference || "any"}`,
    `Posted: ${job.posted_ago || "Unknown"}`,
  ].join("\n");

  const userMessage = `## Business Context\n${stableContext || "(No business context available)"}\n\n## Job to Review\n${jobSummary}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 512,
      system: REVIEW_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  const textBlock = data.content.find((b) => b.type === "text");
  if (!textBlock?.text) {
    throw new Error("No text in Anthropic response");
  }

  // Parse JSON from response (handle markdown code blocks)
  let jsonStr = textBlock.text.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  const parsed = JSON.parse(jsonStr) as Omit<JobReview, "score">;

  // Use existing lead_score converted to 1-10 scale
  const score = Math.max(1, Math.min(10, Math.round(leadScore / 10)));

  const review: JobReview = {
    score,
    recommendation: parsed.recommendation,
    reasoning: parsed.reasoning || "",
    draft_message: parsed.draft_message || "",
    notification_summary: parsed.notification_summary || "",
    green_flags: parsed.green_flags || [],
    red_flags: parsed.red_flags || [],
    suggested_price_range: parsed.suggested_price_range || null,
  };

  // Validate recommendation
  if (!["send", "skip"].includes(review.recommendation)) {
    review.recommendation = score >= 5 ? "send" : "skip";
  }

  return review;
}
