import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Phone,
  Mail,
  MapPin,
  GraduationCap,
  Clock,
  MessageSquare,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  FileText
} from "lucide-react";
import { getStudent, getStudentSummary } from "../services/api";
import type { Student } from "../types";

interface Props {
  studentId: number | null;
  onClose: () => void;
}

export default function StudentModal({ studentId, onClose }: Props) {
  const [student, setStudent] = useState<Student | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (studentId) {
      loadData();
    }
  }, [studentId]);

  const loadData = async () => {
    if (!studentId) return;
    setLoading(true);
    try {
      const [studentRes, summaryRes] = await Promise.all([
        getStudent(studentId),
        getStudentSummary(studentId),
      ]);
      if (studentRes) setStudent(studentRes);
      if (summaryRes) setSummary(summaryRes);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (!studentId) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="glass rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="sticky top-0 glass border-b border-white/10 p-6 flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-white">Student Details</h2>
              <p className="text-sm text-dark-400">Call information and summary</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-white/10 transition-colors"
            >
              <X className="w-5 h-5 text-white" />
            </button>
          </div>

          {loading ? (
            <div className="p-8 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-400"></div>
            </div>
          ) : error ? (
            <div className="p-8 text-center">
              <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
              <p className="text-red-400">{error}</p>
            </div>
          ) : student ? (
            <div className="p-6 space-y-6">
              {/* Student Info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="glass rounded-xl p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <GraduationCap className="w-5 h-5 text-primary-400" />
                    <span className="text-sm text-dark-400">Name</span>
                  </div>
                  <p className="text-white font-medium">{student.name}</p>
                </div>
                <div className="glass rounded-xl p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <Phone className="w-5 h-5 text-primary-400" />
                    <span className="text-sm text-dark-400">Phone</span>
                  </div>
                  <p className="text-white font-medium">{student.phone}</p>
                </div>
                <div className="glass rounded-xl p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <Mail className="w-5 h-5 text-primary-400" />
                    <span className="text-sm text-dark-400">Email</span>
                  </div>
                  <p className="text-white font-medium">{student.email || "N/A"}</p>
                </div>
                <div className="glass rounded-xl p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <MapPin className="w-5 h-5 text-primary-400" />
                    <span className="text-sm text-dark-400">Location</span>
                  </div>
                  <p className="text-white font-medium">{student.city || "N/A"}</p>
                </div>
              </div>

              {/* Call Statistics */}
              <div className="glass rounded-xl p-4">
                <h3 className="text-lg font-semibold text-white mb-4">Call Statistics</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <Clock className="w-6 h-6 text-cyan-400 mx-auto mb-2" />
                    <p className="text-2xl font-bold text-white">{student.call_duration}s</p>
                    <p className="text-xs text-dark-400">Duration</p>
                  </div>
                  <div className="text-center">
                    <TrendingUp className="w-6 h-6 text-purple-400 mx-auto mb-2" />
                    <p className="text-2xl font-bold text-white">{student.interest_score}%</p>
                    <p className="text-xs text-dark-400">Interest</p>
                  </div>
                  <div className="text-center">
                    <MessageSquare className="w-6 h-6 text-green-400 mx-auto mb-2" />
                    <p className="text-2xl font-bold text-white capitalize">{student.sentiment}</p>
                    <p className="text-xs text-dark-400">Sentiment</p>
                  </div>
                </div>
              </div>

              {/* Summary */}
              {summary && (
                <div className="glass rounded-xl p-4">
                  <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                    <FileText className="w-5 h-5" />
                    Call Summary
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm text-dark-400 mb-1">Summary</p>
                      <p className="text-white">{summary.summary || "No summary available"}</p>
                    </div>
                    
                    {summary.questions_asked && summary.questions_asked.length > 0 && (
                      <div>
                        <p className="text-sm text-dark-400 mb-2">Questions Asked</p>
                        <ul className="space-y-1">
                          {summary.questions_asked.map((q: string, i: number) => (
                            <li key={i} className="text-white text-sm flex items-start gap-2">
                              <span className="text-primary-400">•</span>
                              <span>{q}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {summary.objections && summary.objections.length > 0 && (
                      <div>
                        <p className="text-sm text-dark-400 mb-2">Objections Raised</p>
                        <ul className="space-y-1">
                          {summary.objections.map((obj: string, i: number) => (
                            <li key={i} className="text-white text-sm flex items-start gap-2">
                              <AlertCircle className="w-4 h-4 text-yellow-400 mt-0.5" />
                              <span>{obj}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {summary.follow_up_required && (
                      <div className="flex items-center gap-2 p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
                        <AlertCircle className="w-5 h-5 text-yellow-400" />
                        <div>
                          <p className="text-yellow-400 font-medium">Follow-up Required</p>
                          <p className="text-sm text-dark-300">{summary.follow_up_notes}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Preferred Course */}
              {student.preferred_course && (
                <div className="glass rounded-xl p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <GraduationCap className="w-5 h-5 text-primary-400" />
                    <span className="text-sm text-dark-400">Preferred Course</span>
                  </div>
                  <p className="text-white font-medium">{student.preferred_course}</p>
                </div>
              )}
            </div>
          ) : null}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
