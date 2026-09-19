import React, { useEffect, useRef, useState } from "react";
import { Languages } from "lucide-react";
import { useI18n, LANGUAGES } from "../i18n";

/**
 * Global page-language switcher (spec: every page has a language button).
 * Shows the current language in native script; opens a dropdown listing all
 * six supported languages with native labels. Persisted per-browser.
 */
export default function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const current = LANGUAGES.find((l) => l.code === lang)!;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Language / భాష / भाषा / ಭಾಷೆ / ഭാഷ / மொழி"
        className={`flex items-center gap-1.5 rounded-full border border-[var(--gray-200)] bg-white/90 hover:bg-[var(--sky-50)] hover:border-[var(--sky-200)] transition-colors font-medium text-[var(--gray-700)] ${
          compact ? "px-2.5 py-1.5 text-[12px]" : "px-3 py-2 text-[13px]"
        }`}
      >
        <Languages className="w-4 h-4 text-[var(--sky-600)]" />
        <span>{compact ? current.code.toUpperCase() : current.native}</span>
      </button>

      {open && (
        <div
          className="absolute right-0 mt-1.5 w-44 rounded-xl border border-[var(--gray-200)] bg-white shadow-[var(--shadow-lg)] py-1 z-50"
          role="menu"
        >
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              role="menuitem"
              onClick={() => { setLang(l.code); setOpen(false); }}
              className={`w-full flex items-center justify-between px-3.5 py-2 text-[13px] transition-colors ${
                l.code === lang
                  ? "bg-[var(--sky-50)] text-[var(--sky-700)] font-semibold"
                  : "text-[var(--gray-700)] hover:bg-[var(--gray-50)]"
              }`}
            >
              <span>{l.native}</span>
              {l.code === lang && <span className="text-[var(--sky-500)]">✓</span>}
              {l.code !== lang && <span className="text-[10px] text-[var(--gray-400)]">{l.label}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
