import React, { useEffect, useRef, useState } from "react";
import { Globe, Check } from "lucide-react";
import {
  SUPPORTED_LANGUAGES,
  LANGUAGE_NATIVE_NAMES,
  useTranslation,
} from "../i18n";

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
        className={`flex items-center gap-2 bg-[#8f4426]/[0.05] border border-[#8f4426]/[0.15] rounded-xl hover:bg-[#8f4426]/[0.1] transition-colors text-[#43301f] ${
          compact ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"
        }`}
        title="Translate page"
      >
        <Globe className="w-4 h-4 text-[#8a7157]" />
        <span>{LANGUAGE_NATIVE_NAMES[lang]}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-44 rounded-2xl bg-[#faf4e8]/95 backdrop-blur-xl border border-[#8f4426]/[0.15] shadow-2xl overflow-hidden z-50">
          {SUPPORTED_LANGUAGES.map((l) => (
            <button
              key={l}
              onClick={() => {
                changeLanguage(l);
                setOpen(false);
              }}
              className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors ${
                l === lang
                  ? "text-[#a85a32] bg-[#a85a32]/10"
                  : "text-[#5c4632] hover:bg-[#8f4426]/[0.05] hover:text-[#43301f]"
              }`}
            >
              <span>{LANGUAGE_NATIVE_NAMES[l]}</span>
              {l === lang && <Check className="w-4 h-4 text-[#a85a32]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}