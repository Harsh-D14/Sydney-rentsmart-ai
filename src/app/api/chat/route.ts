import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { DATA_SUMMARY, buildUserContext } from "@/lib/ai-context";

export const runtime = "edge";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are Sydney RentSmart AI Advisor, an expert on Sydney's rental market.
You have access to real NSW Government rental bond lodgement data (1.2 million bonds, 2021-2025) and ABS Census 2021 income statistics for 331 Greater Sydney postcodes.

CORE RULES:
- Always give specific suburb recommendations with actual median rent figures from the data below.
- Use the 30% rule: renters should spend no more than 30% of gross income on rent.
- Be friendly, concise, and practical. Keep answers under 250 words unless detail is requested.
- When recommending suburbs, always include the postcode and weekly rent figure.
- If asked about trends, cite the year-over-year figures from the data.
- If the user mentions their income, calculate their 30% threshold and find matching suburbs.
- Never make up rent figures — only use the data provided below.
- If you don't have data for a specific suburb, say so honestly.

KEY INSIGHTS:
- Western Sydney (Blacktown, Penrith, Liverpool, Campbelltown) offers the best affordability.
- Northern Beaches and Upper North Shore are the most expensive areas.
- Inner West and Eastern Suburbs have median rents $700-$1,000+/wk.
- Rent growth has been steepest in previously-cheap outer suburbs (30-80% over 3 years).
- Some suburbs are seeing rent drops in 2024→2025, particularly Badgerys Creek, Horsley Park, Mt Kuring-Gai.
- A household earning $100,000/yr ($1,923/wk) can comfortably afford up to $577/wk rent.
- Sydney-wide, rents have stabilised in many major suburbs through 2024-2025.

${DATA_SUMMARY}`;

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

interface ChatRequest {
  messages: { role: "user" | "assistant"; content: string }[];
  context?: {
    income?: number;
    bedrooms?: number;
    workplace?: string;
    sharing?: number;
    shareBedroom?: boolean;
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ChatRequest;
    const { messages, context } = body;

    if (!messages || messages.length === 0) {
      return new Response(JSON.stringify({ error: "No messages provided" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Build the full system prompt with optional user context
    let systemPrompt = SYSTEM_PROMPT;
    if (context?.income) {
      systemPrompt += "\n\n" + buildUserContext(context);
    }

    // Prepare messages for the API
    const apiMessages = messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const client = new Anthropic();

    const stream = client.messages.stream({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1024,
      system: systemPrompt,
      messages: apiMessages,
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
          controller.error(err);
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    console.error("POST /api/chat error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
