"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { MessageCircle, X, Send, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** A local error notice, shown in the thread but never sent to the API. */
  error?: boolean;
}

/** Mirrors the `context` field accepted by POST /api/chat. */
interface ChatContext {
  /** Weekly dollars: income in "income" mode, max weekly rent in "budget" mode. */
  weeklyIncome?: number;
  mode?: "income" | "budget";
  bedrooms?: number;
  workplace?: string;
  sharing?: number;
  shareBedroom?: boolean;
}

// Limits enforced by POST /api/chat
const MAX_HISTORY = 20;
const MAX_USER_CHARS = 2000;
const MAX_WORKPLACE_CHARS = 60;

function intInRange(value: string | null, min: number, max: number): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}

// ---------------------------------------------------------------------------
// Suggestion chips
// ---------------------------------------------------------------------------

const SUGGESTIONS = [
  "Where can I live near CBD for under $500/week?",
  "Best suburbs for families?",
  "Where are rents dropping?",
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ChatBot() {
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Extract user search context from URL params (set by the search form).
  // `weekly` is always the weekly amount; `income` is in whatever period the
  // user typed, so it is never sent. Invalid values are dropped, not sent.
  const userContext = useMemo(() => {
    const ctx: ChatContext = {};

    const weekly = Number(searchParams.get("weekly"));
    if (Number.isFinite(weekly) && weekly > 0 && weekly <= 100_000) {
      ctx.weeklyIncome = weekly;
      ctx.mode = searchParams.get("mode") === "budget" ? "budget" : "income";
    }

    const bedrooms = intInRange(searchParams.get("bedrooms"), 1, 5);
    if (bedrooms) ctx.bedrooms = bedrooms;

    const sharing = intInRange(searchParams.get("sharing"), 1, 4);
    if (sharing) ctx.sharing = sharing;

    const workplace = searchParams.get("workplace")?.trim();
    if (workplace && workplace.length <= MAX_WORKPLACE_CHARS) ctx.workplace = workplace;

    if (searchParams.get("share_bedroom") === "1") ctx.shareBedroom = true;

    return Object.keys(ctx).length > 0 ? ctx : undefined;
  }, [searchParams]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [open]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim().slice(0, MAX_USER_CHARS);
      if (!trimmed || streaming) return;

      const userMsg: Message = {
        id: `u-${Date.now()}`,
        role: "user",
        content: trimmed,
      };

      const assistantMsg: Message = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: "",
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setInput("");
      setStreaming(true);

      try {
        // Build message history for the API. Empty assistant turns (a reply
        // that never arrived) and local error notices are left out: an empty
        // turn makes the API reject every later request.
        let history = [...messages, userMsg]
          .filter((m) => !m.error && m.content.trim().length > 0)
          .slice(-MAX_HISTORY)
          .map((m) => ({ role: m.role, content: m.content }));
        // The window must open on a user turn
        const firstUser = history.findIndex((m) => m.role === "user");
        history = history.slice(firstUser);

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history, context: userContext }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Request failed" }));
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id
                ? { ...m, error: true, content: `Sorry, something went wrong: ${err.error ?? "Unknown error"}` }
                : m,
            ),
          );
          return;
        }

        // Stream the response
        const reader = res.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) throw new Error("No reader");

        let accumulated = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          const current = accumulated;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id ? { ...m, content: current } : m,
            ),
          );
        }
        // A stream that ends with no text is a failed reply, not a blank one
        if (!accumulated.trim()) throw new Error("Empty reply");
      } catch {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, error: true, content: "Sorry, I couldn't connect. Please try again." }
              : m,
          ),
        );
      } finally {
        setStreaming(false);
      }
    },
    [messages, streaming, userContext],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <>
      {/* ---------------------------------------------------------------- */}
      {/* Floating button */}
      {/* ---------------------------------------------------------------- */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed right-5 bottom-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-lg shadow-primary/30 transition-transform hover:scale-105 active:scale-95"
          aria-label="Open chat"
        >
          <MessageCircle className="h-6 w-6" />
        </button>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Chat panel */}
      {/* ---------------------------------------------------------------- */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-end sm:inset-auto sm:right-5 sm:bottom-5">
          {/* Backdrop on mobile */}
          <div
            className="absolute inset-0 bg-black/20 sm:hidden"
            onClick={() => setOpen(false)}
          />

          <div className="relative flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl sm:h-[600px] sm:w-[420px] sm:rounded-2xl sm:border sm:border-slate-200">
            {/* Header */}
            <div className="flex shrink-0 items-center gap-3 bg-gradient-to-r from-primary to-primary-light px-4 py-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-white">
                  RentSmart AI Advisor
                </p>
                <p className="text-xs text-blue-100/80">
                  Ask me about Sydney rentals
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
                aria-label="Close chat"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4">
              {messages.length === 0 && (
                <div className="space-y-4">
                  <div className="rounded-xl bg-slate-50 p-4">
                    <p className="text-sm text-slate-600">
                      Hi! I&apos;m your Sydney rental market advisor. I can help
                      with suburb recommendations, affordability calculations, and
                      market trends based on real NSW Government data.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-medium text-slate-400">
                      Try asking:
                    </p>
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => sendMessage(s)}
                        className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-slate-600 transition-colors hover:border-accent hover:bg-orange-50 hover:text-accent-dark"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`mb-3 flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      m.role === "user"
                        ? "rounded-br-md bg-primary text-white"
                        : "rounded-bl-md bg-slate-100 text-slate-700"
                    }`}
                  >
                    {m.content ? (
                      m.role === "assistant" ? (
                        <ReactMarkdown
                          components={{
                            p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
                            strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                            ul: ({ children }) => <ul className="mb-1.5 space-y-0.5 last:mb-0">{children}</ul>,
                            ol: ({ children }) => <ol className="mb-1.5 list-decimal space-y-0.5 pl-4 last:mb-0">{children}</ol>,
                            li: ({ children }) => <li className="ml-4 list-disc">{children}</li>,
                            h3: ({ children }) => <h3 className="mb-1 mt-2.5 font-bold first:mt-0">{children}</h3>,
                            h4: ({ children }) => <h4 className="mb-1 mt-2 font-semibold first:mt-0">{children}</h4>,
                          }}
                        >
                          {m.content}
                        </ReactMarkdown>
                      ) : (
                        m.content.split("\n").map((line, i, arr) => (
                          <span key={i}>
                            {line}
                            {i < arr.length - 1 && <br />}
                          </span>
                        ))
                      )
                    ) : (
                      streaming && (
                        <span className="inline-flex gap-1">
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:0ms]" />
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:150ms]" />
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:300ms]" />
                        </span>
                      )
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="shrink-0 border-t border-slate-100 bg-white p-3">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about Sydney rentals..."
                  rows={1}
                  maxLength={MAX_USER_CHARS}
                  className="max-h-24 min-h-[44px] flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary focus:bg-white focus:ring-1 focus:ring-primary/20 focus:outline-none"
                />
                <button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim() || streaming}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-white transition-colors hover:bg-accent-dark disabled:opacity-40"
                  aria-label="Send message"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
