// ---------------------------------------------------------------------------
// POST /api/chat — streaming rental advisor (off unless CHAT_ENABLED=true)
//
// Request body (JSON)
//   {
//     messages: Array<{ role: "user" | "assistant", content: string }>,
//       // 1-20 items; first and last must be "user"; content non-empty;
//       // user content <= 2000 chars, assistant content <= 8000 chars
//     context?: {
//       weeklyIncome?: number,        // weekly $, > 0 and <= 100000. The
//                                     // results URL's `weekly` param.
//       mode?: "income" | "budget",   // budget: weeklyIncome is the max
//                                     // weekly rent, not income
//       bedrooms?: number,            // integer 1-5
//       workplace?: string,           // <= 60 chars; suburb name, postcode or "CBD"
//       sharing?: number,             // integer 1-4
//       shareBedroom?: boolean,
//     }
//   }
//
// 200: text/plain stream of the reply. Errors: JSON { error } with 400
// (invalid body), 429 (rate limited), 503 (disabled or not configured), 500.
// ---------------------------------------------------------------------------

import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { API_CONFIG } from "@/config/apis";
import {
  DATA_SUMMARY,
  DATASET_TOTALS,
  buildUserContext,
  type UserContextOptions,
} from "@/lib/ai-context";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const MAX_MESSAGES = 20;
const MAX_USER_CHARS = 2000;
// Replies are capped by MAX_TOKENS, so anything longer was not written by us.
const MAX_ASSISTANT_CHARS = 8000;
const MAX_WORKPLACE_CHARS = 60;
const MAX_WEEKLY_AMOUNT = 100_000;
const MAX_TOKENS = 1024;
const REQUESTS_PER_MINUTE = 10;

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const bondsInMillions = (DATASET_TOTALS.totalBonds / 1_000_000).toFixed(1);

const SYSTEM_PROMPT = `You are Sydney RentSmart AI Advisor, an expert on Sydney's rental market.
You have access to real NSW Government rental bond lodgement data (${bondsInMillions} million bonds, ${DATASET_TOTALS.firstYear}-${DATASET_TOTALS.lastYear}) and ABS Census 2021 income statistics for ${DATASET_TOTALS.postcodeCount} Greater Sydney postcodes.

CORE RULES:
- Always give specific suburb recommendations with actual median rent figures from the data below.
- Use the 30% rule: renters should spend no more than 30% of gross income on rent.
- Be friendly, concise, and practical. Keep answers under 250 words unless detail is requested.
- When recommending suburbs, always include the postcode and weekly rent figure.
- Rent figures are measured per postcode. Suburbs that share a postcode share the same figures, so never present two suburbs from one postcode as separate options.
- If asked about trends, cite the year-over-year figures from the data.
- If the user mentions their income, calculate their 30% threshold and find matching suburbs.
- Never make up rent figures — only use the data provided below.
- If you don't have data for a specific suburb, say so honestly.
- Medians describe bonds lodged in the past; they are not current listings or a guarantee of availability.

GENERAL PATTERNS (use the data below for any specific figure):
- Western and south-western Sydney are generally the most affordable.
- The harbourside, eastern and northern beaches areas are generally the most expensive.
- A household earning $100,000/yr ($1,923/wk) can afford up to $577/wk rent under the 30% rule.

${DATA_SUMMARY}`;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

type ChatMessage = { role: "user" | "assistant"; content: string };

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMessages(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_MESSAGES) return null;

  const messages: ChatMessage[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const { role, content } = item;
    if (role !== "user" && role !== "assistant") return null;
    if (typeof content !== "string" || content.trim().length === 0) return null;
    if (content.length > (role === "user" ? MAX_USER_CHARS : MAX_ASSISTANT_CHARS)) return null;
    messages.push({ role, content });
  }

  if (messages[0].role !== "user" || messages[messages.length - 1].role !== "user") return null;
  return messages;
}

function isIntegerIn(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/** Returns the validated context, undefined when absent, or null when invalid. */
function parseContext(value: unknown): UserContextOptions | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) return null;

  const { weeklyIncome, mode, bedrooms, workplace, sharing, shareBedroom } = value;
  const ctx: UserContextOptions = {};

  if (weeklyIncome !== undefined) {
    if (
      typeof weeklyIncome !== "number" ||
      !Number.isFinite(weeklyIncome) ||
      weeklyIncome <= 0 ||
      weeklyIncome > MAX_WEEKLY_AMOUNT
    ) {
      return null;
    }
    ctx.weeklyIncome = weeklyIncome;
  }
  if (mode !== undefined) {
    if (mode !== "income" && mode !== "budget") return null;
    ctx.mode = mode;
  }
  if (bedrooms !== undefined) {
    if (!isIntegerIn(bedrooms, 1, 5)) return null;
    ctx.bedrooms = bedrooms;
  }
  if (sharing !== undefined) {
    if (!isIntegerIn(sharing, 1, 4)) return null;
    ctx.sharing = sharing;
  }
  if (workplace !== undefined) {
    if (typeof workplace !== "string" || workplace.length > MAX_WORKPLACE_CHARS) return null;
    ctx.workplace = workplace;
  }
  if (shareBedroom !== undefined) {
    if (typeof shareBedroom !== "boolean") return null;
    ctx.shareBedroom = shareBedroom;
  }

  return ctx;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // Chat is switched off unless CHAT_ENABLED=true is set in the environment.
  if (process.env.CHAT_ENABLED !== "true") {
    return json({ error: "Chat is disabled" }, 503);
  }

  const limited = rateLimit(request, "chat", REQUESTS_PER_MINUTE);
  if (limited) return limited;

  if (!API_CONFIG.anthropic.apiKey) {
    console.error("POST /api/chat: ANTHROPIC_API_KEY is not set");
    return json({ error: "Chat is unavailable right now." }, 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Request body must be JSON" }, 400);
  }
  if (!isRecord(body)) return json({ error: "Invalid request" }, 400);

  const messages = parseMessages(body.messages);
  if (!messages) return json({ error: "Invalid messages" }, 400);

  const context = parseContext(body.context);
  if (context === null) return json({ error: "Invalid context" }, 400);

  try {
    // Build the full system prompt with optional user context
    let systemPrompt = SYSTEM_PROMPT;
    const userContext = context ? buildUserContext(context) : "";
    if (userContext) systemPrompt += "\n\n" + userContext;

    const client = new Anthropic({ apiKey: API_CONFIG.anthropic.apiKey });

    const stream = client.messages.stream({
      model: API_CONFIG.anthropic.model,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages,
    });

    // Convert the SDK stream to a ReadableStream of text chunks
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }
          controller.close();
        } catch (err) {
          // Details stay in the server log; the client just sees the stream end.
          console.error("POST /api/chat stream error:", err);
          controller.error(new Error("Chat stream failed"));
        }
      },
      cancel() {
        // Client went away: stop paying for tokens nobody will read.
        stream.abort();
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("POST /api/chat error:", error);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
}
