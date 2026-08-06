import React, { useEffect, useRef, useState } from "react";
import { Globe, Check } from "lucide-react";
import { SUPPORTED_LANGUAGES, useTranslation } from "../i18n";

/**
 * LanguageSwitcher — dropdown to switch the entire UI language.
 * Instantly translates every labelled element (no page reload).
 * The choice is remembered in localStorage.
 */
export default function LanguageSwitcher({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { lang, changeLanguage } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-colors ${
          compact ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"
        }`}
        title="Translate page"
      >
        <Globe className="w-4 h-4 text-slate-400" />
        <span className="text-slate-300">{lang}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-44 rounded-2xl bg-slate-900/95 backdrop-blur-xl border border-white/10 shadow-2xl overflow-hidden z-50">
          {SUPPORTED_LANGUAGES.map((l) => (
            <button
              key={l}
              onClick={() => {
                changeLanguage(l);
                setOpen(false);
              }}
              className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors ${
                l === lang
                  ? "text-purple-300 bg-purple-500/10"
                  : "text-slate-300 hover:bg-white/5 hover:text-white"
              }`}
            >
              <span>{l}</span>
              {l === lang && <Check className="w-4 h-4 text-purple-400" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
