import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimit } from "@/lib/rate-limit";

function requestFrom(ip: string | null, header = "x-forwarded-for"): Request {
  return new Request("http://localhost/api/test", {
    headers: ip === null ? {} : { [header]: ip },
  });
}

// The limiter keeps module-level state, so every test uses its own bucket name.
let bucketId = 0;
const freshBucket = () => `test-bucket-${++bucketId}`;

describe("rateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests up to the limit, then answers 429 with Retry-After", async () => {
    const bucket = freshBucket();
    for (let i = 0; i < 3; i++) {
      expect(rateLimit(requestFrom("203.0.113.1"), bucket, 3)).toBeNull();
    }

    vi.advanceTimersByTime(15_000);
    const blocked = rateLimit(requestFrom("203.0.113.1"), bucket, 3);
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
    expect(blocked!.headers.get("Retry-After")).toBe("45"); // 60 s window, 15 s used
    expect(await blocked!.json()).toEqual({
      error: "Too many requests. Please try again shortly.",
    });

    // Still blocked on the next call
    expect(rateLimit(requestFrom("203.0.113.1"), bucket, 3)?.status).toBe(429);
  });

  it("counts each bucket separately", () => {
    const a = freshBucket();
    const b = freshBucket();
    expect(rateLimit(requestFrom("203.0.113.2"), a, 1)).toBeNull();
    expect(rateLimit(requestFrom("203.0.113.2"), a, 1)?.status).toBe(429);
    expect(rateLimit(requestFrom("203.0.113.2"), b, 1)).toBeNull();
  });

  it("counts each IP separately", () => {
    const bucket = freshBucket();
    expect(rateLimit(requestFrom("203.0.113.3"), bucket, 1)).toBeNull();
    expect(rateLimit(requestFrom("203.0.113.3"), bucket, 1)?.status).toBe(429);
    expect(rateLimit(requestFrom("203.0.113.4"), bucket, 1)).toBeNull();
  });

  it("uses the first address in x-forwarded-for", () => {
    const bucket = freshBucket();
    expect(rateLimit(requestFrom("203.0.113.5, 10.0.0.1"), bucket, 1)).toBeNull();
    expect(rateLimit(requestFrom("203.0.113.5, 10.0.0.2"), bucket, 1)?.status).toBe(429);
    expect(rateLimit(requestFrom("203.0.113.6, 10.0.0.1"), bucket, 1)).toBeNull();
  });

  it("falls back to x-real-ip, then to one shared bucket for unidentified callers", () => {
    const bucket = freshBucket();
    expect(rateLimit(requestFrom("203.0.113.7", "x-real-ip"), bucket, 1)).toBeNull();
    expect(rateLimit(requestFrom("203.0.113.7", "x-real-ip"), bucket, 1)?.status).toBe(429);

    expect(rateLimit(requestFrom(null), bucket, 1)).toBeNull();
    expect(rateLimit(requestFrom(null), bucket, 1)?.status).toBe(429);
  });

  it("resets when the window has passed", () => {
    const bucket = freshBucket();
    const windowMs = 10_000;
    expect(rateLimit(requestFrom("203.0.113.8"), bucket, 1, windowMs)).toBeNull();
    expect(rateLimit(requestFrom("203.0.113.8"), bucket, 1, windowMs)?.status).toBe(429);

    vi.advanceTimersByTime(windowMs - 1);
    expect(rateLimit(requestFrom("203.0.113.8"), bucket, 1, windowMs)?.status).toBe(429);

    vi.advanceTimersByTime(1);
    expect(rateLimit(requestFrom("203.0.113.8"), bucket, 1, windowMs)).toBeNull();
    expect(rateLimit(requestFrom("203.0.113.8"), bucket, 1, windowMs)?.status).toBe(429);
  });
});
