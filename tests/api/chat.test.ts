import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

function chatRequest() {
  return new NextRequest("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "Where can I afford?" }] }),
  });
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.resetModules();
    // Any outbound request would be a test bug
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network call attempted in a test"))),
    );
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["false", "false"],
    ["TRUE (the flag is case-sensitive)", "TRUE"],
    ["1", "1"],
  ])("503 'Chat is disabled' when CHAT_ENABLED is %s, with no API key needed", async (_l, value) => {
    vi.stubEnv("CHAT_ENABLED", value as string);
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const { POST } = await import("@/app/api/chat/route");

    const res = await POST(chatRequest());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Chat is disabled" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("503 when enabled but ANTHROPIC_API_KEY is missing", async () => {
    vi.stubEnv("CHAT_ENABLED", "true");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("@/app/api/chat/route");

    const res = await POST(chatRequest());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Chat is unavailable right now." });
    expect(fetch).not.toHaveBeenCalled();
  });
});
