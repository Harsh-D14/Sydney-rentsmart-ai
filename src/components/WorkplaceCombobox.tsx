"use client";

import { useEffect, useId, useState } from "react";
import { Briefcase, MapPin, X } from "lucide-react";

// ---------------------------------------------------------------------------
// Workplace autocomplete: an ARIA combobox over GET /api/suburbs?search=
//
// The text is free-form. Picking a suggestion fills in "Name (postcode)", but
// anything typed is passed on as-is and resolved by the server.
// ---------------------------------------------------------------------------

interface SuburbOption {
  suburb_key: string;
  postcode: string;
  suburb_name: string;
}

interface SearchResults {
  term: string;
  items: SuburbOption[];
}

const MIN_QUERY_LENGTH = 2;
const MAX_OPTIONS = 8;
const DEBOUNCE_MS = 250;
const NO_RESULTS: SearchResults = { term: "", items: [] };

function parseOptions(body: unknown): SuburbOption[] {
  if (typeof body !== "object" || body === null) return [];
  const list = (body as { suburbs?: unknown }).suburbs;
  if (!Array.isArray(list)) return [];
  const options: SuburbOption[] = [];
  for (const item of list) {
    if (
      item &&
      typeof item.suburb_key === "string" &&
      typeof item.postcode === "string" &&
      typeof item.suburb_name === "string"
    ) {
      options.push({
        suburb_key: item.suburb_key,
        postcode: item.postcode,
        suburb_name: item.suburb_name,
      });
    }
  }
  return options.slice(0, MAX_OPTIONS);
}

export default function WorkplaceCombobox({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
}) {
  const listId = useId();
  // The text the user last typed. Empty after a pick or a clear, so those
  // never trigger a search of their own.
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<SearchResults>(NO_RESULTS);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const query = term.trim();

  useEffect(() => {
    if (query.length < MIN_QUERY_LENGTH) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/suburbs?search=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`search responded ${res.status}`);
        const items = parseOptions(await res.json());
        setResults({ term: query, items });
        setActiveIndex(-1);
      } catch {
        // Aborted by a newer keystroke: leave the newer request to answer
        if (!controller.signal.aborted) setResults({ term: query, items: [] });
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  // Suggestions only apply while the field still holds what was typed
  const options =
    query.length >= MIN_QUERY_LENGTH && value.trim() === query ? results.items : [];
  const expanded = open && options.length > 0;
  const optionId = (index: number) => `${listId}-option-${index}`;

  function pick(option: SuburbOption) {
    onChange(`${option.suburb_name} (${option.postcode})`);
    setTerm("");
    setResults(NO_RESULTS);
    setOpen(false);
    setActiveIndex(-1);
  }

  function clear() {
    onChange("");
    setTerm("");
    setResults(NO_RESULTS);
    setOpen(false);
    setActiveIndex(-1);
  }

  function moveTo(index: number) {
    setActiveIndex(index);
    document.getElementById(optionId(index))?.scrollIntoView({ block: "nearest" });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case "ArrowDown":
        if (options.length === 0) return;
        e.preventDefault();
        setOpen(true);
        moveTo(expanded ? (activeIndex + 1) % options.length : 0);
        break;
      case "ArrowUp":
        if (options.length === 0) return;
        e.preventDefault();
        setOpen(true);
        moveTo(
          expanded && activeIndex > 0 ? activeIndex - 1 : options.length - 1,
        );
        break;
      case "Enter":
        // With nothing highlighted, Enter submits the form as usual
        if (expanded && activeIndex >= 0 && activeIndex < options.length) {
          e.preventDefault();
          pick(options[activeIndex]);
        }
        break;
      case "Escape":
        if (expanded) {
          e.preventDefault();
          setOpen(false);
          setActiveIndex(-1);
        }
        break;
    }
  }

  return (
    <div className="relative">
      <Briefcase className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          expanded && activeIndex >= 0 ? optionId(activeIndex) : undefined
        }
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          const text = e.target.value;
          onChange(text);
          setTerm(text);
          setActiveIndex(-1);
          setOpen(true);
          if (text.trim().length < MIN_QUERY_LENGTH) setResults(NO_RESULTS);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setActiveIndex(-1);
        }}
        onKeyDown={handleKeyDown}
        className="h-12 w-full rounded-lg border border-slate-300 bg-slate-50 pl-10 pr-9 text-slate-900 placeholder:text-slate-400 transition-colors focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent/20 focus:outline-none"
        autoComplete="off"
        maxLength={100}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear workplace"
          onClick={clear}
          className="absolute right-3 top-1/2 z-10 -translate-y-1/2 text-slate-400 hover:text-slate-600"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
      <ul
        id={listId}
        role="listbox"
        aria-label="Suburb suggestions"
        hidden={!expanded}
        className="absolute top-full left-0 z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
      >
        {expanded &&
          options.map((option, index) => (
            <li
              key={option.suburb_key}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              // Keep focus in the input so the click is not lost to a blur
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(option)}
              onMouseEnter={() => setActiveIndex(index)}
              className={`flex w-full cursor-pointer items-center gap-2 px-4 py-2.5 text-left text-sm ${
                index === activeIndex
                  ? "bg-blue-50 text-primary"
                  : "text-slate-700"
              }`}
            >
              <MapPin className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              <span className="font-medium">{option.suburb_name}</span>
              <span className="text-slate-400">{option.postcode}</span>
            </li>
          ))}
      </ul>
      <span className="sr-only" role="status">
        {expanded
          ? `${options.length} suggestion${options.length === 1 ? "" : "s"} available`
          : ""}
      </span>
    </div>
  );
}
