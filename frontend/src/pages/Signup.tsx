import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Mail, Lock, User, Building, ArrowRight, Loader2 } from "lucide-react";
import { signup } from "../services/api";
import { useI18n } from "../i18n";
import LanguageSwitcher from "../components/LanguageSwitcher";

export default function Signup() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [form, setForm] = useState({ fullName: "", email: "", company: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (form.password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    setLoading(true);
    try {
      await signup(form.email, form.password, form.fullName, form.company || undefined);
      navigate("/agents");
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || "Signup failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-sky-gradient flex items-center justify-center px-4 relative">
      {/* Page language switcher — top-right of every page */}
      <div className="absolute top-4 right-4">
        <LanguageSwitcher compact />
      </div>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="w-full max-w-md"
      >
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[var(--sky-400)] to-[var(--sky-600)] flex items-center justify-center text-white font-bold text-xl mx-auto mb-4 shadow-[var(--shadow-lg)]">
            D
          </div>
          <h1 className="text-2xl font-bold text-[var(--gray-800)]">{t("auth.workspace")}</h1>
          <p className="text-[var(--gray-500)] text-sm mt-1.5">{t("landing.badge")}</p>
        </div>

        <div className="glass rounded-[var(--radius-lg)] shadow-[var(--shadow-lg)] p-7">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[13px] font-medium text-[var(--gray-700)] mb-1.5">{t("auth.fullName")}</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--gray-400)]" />
                <input
                  type="text"
                  required
                  value={form.fullName}
                  onChange={set("fullName")}
                  placeholder="Priya Sharma"
                  className="w-full bg-white border border-[var(--gray-200)] rounded-lg pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sky-400)]"
                />
              </div>
            </div>

            <div>
              <label className="block text-[13px] font-medium text-[var(--gray-700)] mb-1.5">{t("auth.email")}</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--gray-400)]" />
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={set("email")}
                  placeholder="you@company.com"
                  className="w-full bg-white border border-[var(--gray-200)] rounded-lg pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sky-400)]"
                />
              </div>
            </div>

            <div>
              <label className="block text-[13px] font-medium text-[var(--gray-700)] mb-1.5">{t("auth.workspace")}</label>
              <div className="relative">
                <Building className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--gray-400)]" />
                <input
                  type="text"
                  value={form.company}
                  onChange={set("company")}
                  placeholder="Doneswari Technologies"
                  className="w-full bg-white border border-[var(--gray-200)] rounded-lg pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sky-400)]"
                />
              </div>
            </div>

            <div>
              <label className="block text-[13px] font-medium text-[var(--gray-700)] mb-1.5">{t("auth.password")}</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--gray-400)]" />
                <input
                  type="password"
                  required
                  value={form.password}
                  onChange={set("password")}
                  placeholder="At least 6 characters"
                  className="w-full bg-white border border-[var(--gray-200)] rounded-lg pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sky-400)]"
                />
              </div>
            </div>

            {error && (
              <div className="text-[13px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-[var(--sky-500)] hover:bg-[var(--sky-600)] text-white font-semibold text-sm rounded-lg py-2.5 transition-colors disabled:opacity-60"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              {t("auth.signup")}
            </button>
          </form>

          <p className="text-center text-[13px] text-[var(--gray-500)] mt-5">
            {t("auth.haveAccount")}{" "}
            <Link to="/login" className="text-[var(--sky-600)] font-semibold hover:underline">
              {t("auth.signin")}
            </Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
