from typing import Dict, Any, List


class ConversationMemory:
    def __init__(self):
        self.data: Dict[str, Any] = {
            "caller_name": "",
            "student_name": "",
            "course_interest": "",
            "language": "English",
            "concern": "",
            "hostel_needed": False,
            "fee_concern": False,
            "scholarship_interest": False,
            "lead_signals": [],
            "topics_discussed": [],
        }
        self.message_history: List[Dict[str, str]] = []

    def update_from_message(self, role: str, content: str):
        self.message_history.append({"role": role, "content": content})
        if len(self.message_history) > 20:
            self.message_history = self.message_history[-20:]

        if role != "user":
            return

        content_lower = content.lower()

        # Language detection
        if any(w in content_lower for w in ["telugu lo", "telugulo", "telugu cheppandi"]):
            self.data["language"] = "Telugu"
        elif any(w in content_lower for w in ["hindi mein", "hindi me"]):
            self.data["language"] = "Hindi"
        elif "english" in content_lower:
            self.data["language"] = "English"

        # Concern signals
        if any(w in content_lower for w in ["fee", "fees", "cost", "expensive", "money", "afford"]):
            self.data["fee_concern"] = True
            if not self.data["concern"]:
                self.data["concern"] = "fees"
        if any(w in content_lower for w in ["hostel", "accommodation", "stay", "boarding"]):
            self.data["hostel_needed"] = True
        if any(w in content_lower for w in ["scholarship", "financial aid", "discount"]):
            self.data["scholarship_interest"] = True

        # Hot lead signals
        hot_signals = [
            "how to apply", "when is last date", "deadline",
            "application form", "want to join", "how do i enroll",
        ]
        for sig in hot_signals:
            if sig in content_lower and sig not in self.data["lead_signals"]:
                self.data["lead_signals"].append(sig)

    def get_context_str(self) -> str:
        ctx = []
        if self.data["student_name"]:
            ctx.append(f"Student: {self.data['student_name']}")
        if self.data["course_interest"]:
            ctx.append(f"Interested in: {self.data['course_interest']}")
        if self.data["concern"]:
            ctx.append(f"Main concern: {self.data['concern']}")
        if self.data["hostel_needed"]:
            ctx.append("Needs hostel information")
        if self.data["language"] != "English":
            ctx.append(f"Preferred language: {self.data['language']}")
        return "; ".join(ctx) if ctx else ""

    def to_dict(self) -> Dict[str, Any]:
        return self.data

    def get_history_for_llm(self) -> List[Dict[str, str]]:
        return self.message_history[-10:]
