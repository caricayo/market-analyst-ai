"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { TickerInfo } from "@/lib/types";

interface TickerInputProps {
  tickers: TickerInfo[];
  disabled: boolean;
  onSubmit: (ticker: string) => void;
  onCancel: () => void;
  isRunning: boolean;
}

export default function TickerInput({
  tickers,
  disabled,
  onSubmit,
  onCancel,
  isRunning,
}: TickerInputProps) {
  const [value, setValue] = useState("");
  const [suggestions, setSuggestions] = useState<TickerInfo[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [warning, setWarning] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const fuseRef = useRef<import("fuse.js").default<TickerInfo> | null>(null);

  // Initialize fuse.js
  useEffect(() => {
    if (tickers.length === 0) return;
    import("fuse.js").then((Fuse) => {
      fuseRef.current = new Fuse.default(tickers, {
        keys: ["ticker", "name"],
        threshold: 0.4,
      });
    });
  }, [tickers]);

  const search = useCallback(
    (query: string) => {
      if (!query.trim() || !fuseRef.current) {
        setSuggestions([]);
        setShowDropdown(false);
        return;
      }
      const results = fuseRef.current.search(query).map((r) => r.item);
      setSuggestions(results.slice(0, 8));
      setShowDropdown(results.length > 0);
      setSelectedIdx(-1);
    },
    []
  );

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setValue(v);
    setWarning("");
    search(v);
  }

  function handleSelect(ticker: TickerInfo) {
    setValue(ticker.ticker);
    setShowDropdown(false);
    setWarning("");
    inputRef.current?.focus();
  }

  function handleSubmit() {
    if (!value.trim() || disabled) return;
    const upper = value.trim().toUpperCase();
    const isKnown = tickers.some(
      (t) => t.ticker === upper || t.name.toLowerCase() === value.trim().toLowerCase()
    );
    if (!isKnown) {
      // Check for fuzzy matches to suggest
      const fuzzy = fuseRef.current?.search(value.trim()).slice(0, 3) || [];
      if (fuzzy.length > 0 && !warning) {
        setWarning(
          `"${value.trim()}" not found. Did you mean: ${fuzzy
            .map((r) => r.item.ticker)
            .join(", ")}? Press Enter again to proceed anyway.`
        );
        return;
      }
    }
    setShowDropdown(false);
    setWarning("");
    onSubmit(value.trim());
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      if (showDropdown && selectedIdx >= 0) {
        handleSelect(suggestions[selectedIdx]);
      } else {
        handleSubmit();
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Escape") {
      setShowDropdown(false);
    }
  }

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="w-full max-w-lg mx-auto">
      <div className="relative">
        <div className="flex border border-t-border bg-t-dark">
          <span className="px-3 py-2 text-t-green font-bold select-none">$</span>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder="Enter ticker or company name..."
            className="flex-1 bg-transparent text-t-green py-2 pr-3 outline-none placeholder:text-t-dim disabled:opacity-50 disabled:cursor-not-allowed"
            autoFocus
            spellCheck={false}
            aria-label="Ticker symbol or company name"
            aria-autocomplete="list"
          />
          {isRunning ? (
            <button
              onClick={onCancel}
              className="px-4 py-2 text-t-red border-l border-t-border hover:bg-t-red/10 transition-colors"
              aria-label="Cancel analysis"
            >
              CANCEL
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={disabled || !value.trim()}
              className="px-4 py-2 text-t-green border-l border-t-border hover:bg-t-green/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Start analysis"
            >
              ANALYZE
            </button>
          )}
        </div>

        {/* Autocomplete dropdown */}
        {showDropdown && suggestions.length > 0 && (
          <div
            ref={dropdownRef}
            className="absolute z-50 w-full border border-t-border border-t-0 bg-t-dark max-h-64 overflow-y-auto"
            role="listbox"
          >
            {suggestions.map((s, i) => (
              <button
                key={s.ticker}
                className={`w-full text-left px-3 py-1.5 flex justify-between items-center hover:bg-t-green/10 ${
                  i === selectedIdx ? "bg-t-green/10" : ""
                }`}
                onClick={() => handleSelect(s)}
                role="option"
                aria-selected={i === selectedIdx}
              >
                <span className="text-t-green font-bold">{s.ticker}</span>
                <span className="text-t-dim text-xs truncate ml-2">{s.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Warning for unrecognized tickers */}
      {warning && (
        <div className="mt-2 px-3 py-2 border border-t-amber/40 bg-t-amber/5 text-t-amber text-xs">
          {warning}
        </div>
      )}
    </div>
  );
}
