import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Best-effort per-IP rate limiter
//
// Counters live in this server instance's memory, so on serverless hosting
// each instance counts separately and counters reset on cold start. This
// slows down a single abusive client; it is not a hard quota. A hard limit
// needs a shared store or the host's firewall rules.
// ---------------------------------------------------------------------------

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();
const MAX_TRACKED = 5000;

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

/**
 * Returns a 429 response when the caller has exceeded `limit` requests per
 * `windowMs` for this `bucket`, otherwise null.
 */
export function rateLimit(
  request: Request,
  bucket: string,
  limit: number,
  windowMs = 60_000,
): NextResponse | null {
  const now = Date.now();
  const key = `${bucket}:${clientIp(request)}`;
  const entry = windows.get(key);

  if (!entry || now >= entry.resetAt) {
    if (windows.size >= MAX_TRACKED) {
      for (const [k, w] of windows) if (now >= w.resetAt) windows.delete(k);
      if (windows.size >= MAX_TRACKED) windows.clear();
    }
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  entry.count += 1;
  if (entry.count <= limit) return null;

  return NextResponse.json(
    { error: "Too many requests. Please try again shortly." },
    {
      status: 429,
      headers: { "Retry-After": String(Math.ceil((entry.resetAt - now) / 1000)) },
    },
  );
}
