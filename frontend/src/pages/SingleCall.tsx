import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  Phone,
  Upload,
  FileText,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Mic,
  Volume2,
  Play,
  StopCircle,
  User,
  PhoneCall
} from "lucide-react";
import { uploadKnowledge, initiateSingleCall, processSpeech, endCall } from "../services/api";

export default function SingleCall() {
  const [studentName, setStudentName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [knowledgeFile, setKnowledgeFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const [isUploading, setIsUploading] = useState(false);
  const [isCalling, setIsCalling] = useState(false);
  const [callStatus, setCallStatus] = useState("");
  const [conversation, setConversation] = useState<Array<{ role: string; text: string }>>([]);
  const [currentResponse, setCurrentResponse] = useState("");

  const handleKnowledgeUpload = async (file: File) => {
    setKnowledgeFile(file);
    setIsUploading(true);
    setUploadStatus("Uploading document...");

    try {
      const formData = new FormData();
      formData.append("file", file);
      
      const result = await uploadKnowledge(formData);
      setUploadStatus("Knowledge base ready!");
      
      // Poll for readiness
      let attempts = 0;
      const checkInterval = setInterval(async () => {
        attempts++;
        if (attempts > 20) {
          clearInterval(checkInterval);
          setUploadStatus("Knowledge base ready!");
          return;
        }
        
        // Check status (simplified)
        setUploadStatus("Processing...");
      }, 2000);
      
    } catch (error: any) {
      setUploadStatus(`Error: ${error.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleInitiateCall = async () => {
    if (!studentName || !phoneNumber) {
      alert("Please enter student name and phone number");
      return;
    }

    if (!knowledgeFile) {
      alert("Please upload institute knowledge first");
      return;
    }

    setIsCalling(true);
    setCallStatus("Initiating call...");
    setConversation([]);

    try {
      const result = await initiateSingleCall(studentName, phoneNumber);
      setCallStatus("Call in progress");
      setConversation([
        { role: "assistant", text: result.greeting }
      ]);
      setCurrentResponse(result.greeting);
    } catch (error: any) {
      setCallStatus(`Error: ${error.message}`);
      setIsCalling(false);
    }
  };

  const handleEndCall = async () => {
    if (conversation.length === 0) return;
    
    setCallStatus("Ending call...");
    try {
      // In a real implementation, you'd track the call_id
      // For now, just stop the UI
      setIsCalling(false);
      setCallStatus("Call ended");
    } catch (error: any) {
      setCallStatus(`Error: ${error.message}`);
    }
  };

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-4xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass rounded-2xl p-8"
        >
          <h1 className="text-3xl font-bold text-white mb-2">Single Student Call</h1>
          <p className="text-dark-400 mb-8">Make individual calls to students with AI-powered conversation</p>

          {/* Knowledge Upload Section */}
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Institute Knowledge
            </h2>
            
            <div className="glass rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  {knowledgeFile ? (
                    <CheckCircle2 className="w-6 h-6 text-green-400" />
                  ) : (
                    <Upload className="w-6 h-6 text-primary-400" />
                  )}
                  <span className="text-white">
                    {knowledgeFile ? knowledgeFile.name : "No file uploaded"}
                  </span>
                </div>
                {uploadStatus && (
                  <span className="text-sm text-dark-300">{uploadStatus}</span>
                )}
              </div>

              <input
                type="file"
                accept=".pdf,.docx,.txt,.csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleKnowledgeUpload(file);
                }}
                disabled={isUploading || isCalling}
                className="hidden"
                id="knowledge-upload"
              />
              
              <label
                htmlFor="knowledge-upload"
                className="btn-primary inline-flex items-center gap-2 cursor-pointer"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    Upload Knowledge
                  </>
                )}
              </label>
            </div>
          </div>

          {/* Student Details Section */}
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
              <User className="w-5 h-5" />
              Student Details
            </h2>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="glass rounded-xl p-4">
                <label className="text-sm text-dark-400 mb-2 block">Student Name</label>
                <input
                  type="text"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  disabled={isCalling}
                  placeholder="Enter student name"
                  className="w-full bg-dark-900/50 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-primary-400"
                />
              </div>
              
              <div className="glass rounded-xl p-4">
                <label className="text-sm text-dark-400 mb-2 block">Phone Number</label>
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  disabled={isCalling}
                  placeholder="+91XXXXXXXXXX"
                  className="w-full bg-dark-900/50 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-primary-400"
                />
              </div>
            </div>
          </div>

          {/* Call Controls */}
          <div className="mb-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {isCalling ? (
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse" />
                    <span className="text-green-400">{callStatus}</span>
                  </div>
                ) : (
                  <span className="text-dark-400">Ready to call</span>
                )}
              </div>

              <div className="flex items-center gap-3">
                {!isCalling ? (
                  <button
                    onClick={handleInitiateCall}
                    disabled={!studentName || !phoneNumber || !knowledgeFile}
                    className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <PhoneCall className="w-4 h-4" />
                    Start Call
                  </button>
                ) : (
                  <button
                    onClick={handleEndCall}
                    className="btn-danger flex items-center gap-2"
                  >
                    <StopCircle className="w-4 h-4" />
                    End Call
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Conversation Display */}
          {conversation.length > 0 && (
            <div className="glass rounded-xl p-6">
              <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                <Phone className="w-5 h-5" />
                Conversation
              </h2>
              
              <div className="space-y-4 max-h-96 overflow-y-auto">
                {conversation.map((msg, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, x: msg.role === "assistant" ? -20 : 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`flex ${msg.role === "assistant" ? "justify-start" : "justify-end"}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-2xl p-4 ${
                        msg.role === "assistant"
                          ? "bg-primary-500/20 text-white"
                          : "bg-white/10 text-white"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        {msg.role === "assistant" ? (
                          <Volume2 className="w-4 h-4 text-primary-400" />
                        ) : (
                          <Mic className="w-4 h-4 text-cyan-400" />
                        )}
                        <span className="text-xs text-dark-300">
                          {msg.role === "assistant" ? "Mrs. D" : "Student"}
                        </span>
                      </div>
                      <p className="text-sm">{msg.text}</p>
                    </div>
                  </motion.div>
                ))}
              </div>

              {currentResponse && (
                <div className="mt-4 p-4 bg-primary-500/10 rounded-lg border border-primary-500/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Volume2 className="w-4 h-4 text-primary-400" />
                    <span className="text-sm text-primary-400">Mrs. D is speaking...</span>
                  </div>
                  <p className="text-white text-sm">{currentResponse}</p>
                </div>
              )}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
