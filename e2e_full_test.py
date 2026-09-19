"""
END-TO-END VERIFICATION (spec §82) — runs against a LIVE backend.

Verifies the real product flow with REAL data only:
  signup → create agent → upload knowledge → real ingestion (chunks/embeddings/
  index) → knowledge validation → save (READY gate) → publish → add student →
  dry-run (agent's REAL runtime, labelled) → analytics → latency dashboard →
  tenant isolation (second user cannot touch first user's agent).

Usage:
    python e2e_full_test.py [base_url]
    (default base_url: http://localhost:8000)

Exit code 0 = ALL PASSED. Any failed step prints FAIL and exits 1.
"""

import io
import sys
import time
import uuid
import requests

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"

PASSED = 0
FAILED = 0


def check(name: str, cond: bool, detail: str = ""):
    global PASSED, FAILED
    if cond:
        PASSED += 1
        print(f"  PASS  {name}" + (f" — {detail}" if detail else ""))
    else:
        FAILED += 1
        print(f"  FAIL  {name}" + (f" — {detail}" if detail else ""))


def main():
    run_id = uuid.uuid4().hex[:8]
    print(f"\n=== E2E FULL TEST against {BASE} (run {run_id}) ===\n")

    s1 = requests.Session()
    s2 = requests.Session()

    # 1. Health
    r = s1.get(f"{BASE}/health", timeout=15)
    check("Health endpoint", r.status_code == 200, f"status={r.status_code}")

    # 2. Signup user A
    email_a = f"e2e_{run_id}_a@example.com"
    r = s1.post(f"{BASE}/api/auth/signup", json={
        "email": email_a, "password": "e2epass123", "full_name": "E2E Tester A",
    }, timeout=15)
    check("Signup user A", r.status_code == 200, f"status={r.status_code}")
    tok_a = r.json().get("token")
    H_A = {"Authorization": f"Bearer {tok_a}"}

    # 3. Home list starts empty (no fake data)
    r = s1.get(f"{BASE}/api/agents", headers=H_A, timeout=15)
    check("Home agents list (empty, honest)", r.status_code == 200 and len(r.json()) == 0,
          f"count={len(r.json()) if r.status_code == 200 else '?'}")

    # 4. Create agent "Aira" (spec §82 step 7)
    r = s1.post(f"{BASE}/api/agents", headers=H_A, json={
        "name": "Aira", "company_name": "E2E Institute",
    }, timeout=15)
    check("Create agent Aira (DRAFT)", r.status_code == 200 and r.json().get("status") == "draft",
          f"status={r.json().get('status') if r.status_code == 200 else r.status_code}")
    agent_id = r.json()["id"]

    # 5. Upload REAL knowledge PDF
    pdf = _make_test_pdf()
    r = s1.post(f"{BASE}/api/agents/{agent_id}/documents", headers=H_A,
                files={"file": ("e2e_knowledge.pdf", pdf, "application/pdf")}, timeout=120)
    check("Upload knowledge — real ingestion", r.status_code == 200 and r.json().get("chunks_count", 0) > 0,
          f"chunks={r.json().get('chunks_count') if r.status_code == 200 else r.status_code}")
    chunks = r.json().get("chunks_count", 0) if r.status_code == 200 else 0

    # 6. Knowledge status = ready + indexed (spec §11)
    r = s1.get(f"{BASE}/api/agents/{agent_id}/knowledge/status", headers=H_A, timeout=15)
    ks = r.json()
    check("Knowledge status READY + indexed", r.status_code == 200 and ks.get("status") == "ready" and ks.get("indexed"),
          f"stage={ks.get('stage')} chunks={ks.get('chunks')}")

    # 7. Knowledge validation (spec §48)
    r = s1.post(f"{BASE}/api/agents/{agent_id}/validate-knowledge", headers=H_A, timeout=60)
    ok = r.status_code == 200
    check("Knowledge validation runs", ok, f"pass_rate={r.json().get('pass_rate') if ok else r.status_code}")

    # 8. Retrieval answers a knowledge question (spec §41 §47)
    r = s1.get(f"{BASE}/api/agents/{agent_id}/retrieval-debug",
               headers=H_A, params={"q": "What courses are offered?"}, timeout=30)
    check("Retrieval-debug returns real chunks", r.status_code == 200 and len(r.json().get("retrieved", [])) > 0,
          f"retrieved={len(r.json().get('retrieved', [])) if r.status_code == 200 else '?'}")

    # 9. Save gate → READY (spec §12 §15)
    r = s1.post(f"{BASE}/api/agents/{agent_id}/save", headers=H_A, timeout=30)
    check("Save validation gate → READY", r.status_code == 200 and r.json().get("status") == "ready",
          f"status={r.json().get('status') if r.status_code == 200 else r.status_code}")

    # 10. Publish (spec §15)
    r = s1.post(f"{BASE}/api/agents/{agent_id}/publish", headers=H_A, timeout=15)
    check("Publish agent", r.status_code == 200 and r.json().get("status") == "published",
          f"version={r.json().get('version') if r.status_code == 200 else r.status_code}")

    # 11. Add a student (spec §21)
    r = s1.post(f"{BASE}/api/agents/{agent_id}/students", headers=H_A, json={
        "name": "E2E Student", "phone": "+919876543210",
    }, timeout=15)
    check("Add student", r.status_code == 200, f"status={r.status_code}")
    student_id = r.json().get("id") if r.status_code == 200 else None

    # 12. Real-calls safety: campaign start WITHOUT telephony → clear 503, never fake (spec §22 §79)
    r = s1.post(f"{BASE}/api/agents/{agent_id}/campaign/start", headers=H_A, timeout=15)
    check("Campaign start without telephony → 503 (no fake calls)",
          r.status_code in (503, 400), f"status={r.status_code}")

    # 13. Dry-run through the agent's REAL runtime (labelled, spec §79)
    if student_id:
        r = s1.post(f"{BASE}/api/agents/{agent_id}/campaign/dry-run-call/{student_id}", headers=H_A, timeout=180)
        ok = r.status_code == 200
        check("Dry-run call (real RAG+LLM runtime)", ok,
              f"turns={r.json().get('turns') if ok else r.status_code}")
        if ok:
            check("Dry-run latency measured (not fabricated)",
                  r.json().get("latency_ms") is not None and r.json().get("latency_ms") > 0,
                  f"latency_ms={r.json().get('latency_ms')}")

    # 14. Analytics reflect the real call (spec §54 §56)
    r = s1.get(f"{BASE}/api/agents/{agent_id}/analytics", headers=H_A, timeout=30)
    a = r.json()
    check("Analytics has real data after call", r.status_code == 200 and a.get("has_data"),
          f"total_calls={a.get('cards', {}).get('total_calls')}")
    check("Analytics total_calls == 1 (no seeding)", a.get("cards", {}).get("total_calls") == 1,
          f"total_calls={a.get('cards', {}).get('total_calls')}")

    # 15. Latency dashboard (spec §60 + latency spec)
    r = s1.get(f"{BASE}/api/agents/{agent_id}/latency-dashboard", headers=H_A, timeout=15)
    check("Latency dashboard endpoint", r.status_code == 200, f"has_data={r.json().get('has_data')}")

    # 16. TENANT ISOLATION (spec §17 §82 steps 55-56): user B cannot touch A's agent
    email_b = f"e2e_{run_id}_b@example.com"
    r = s2.post(f"{BASE}/api/auth/signup", json={
        "email": email_b, "password": "e2epass123", "full_name": "E2E Tester B",
    }, timeout=15)
    tok_b = r.json().get("token")
    H_B = {"Authorization": f"Bearer {tok_b}"}
    for path in (f"/api/agents/{agent_id}", f"/api/agents/{agent_id}/analytics",
                 f"/api/agents/{agent_id}/students", f"/api/agents/{agent_id}/calls"):
        r = s2.get(f"{BASE}{path}", headers=H_B, timeout=15)
        check(f"Isolation: B GET {path.split('/')[-1]} → 404", r.status_code == 404, f"status={r.status_code}")

    # 17. B's analytics show zero A data
    r = s2.get(f"{BASE}/api/agents", headers=H_B, timeout=15)
    check("Isolation: B sees no agents", r.status_code == 200 and len(r.json()) == 0,
          f"count={len(r.json()) if r.status_code == 200 else '?'}")

    # Summary
    print(f"\n=== RESULT: {PASSED} passed, {FAILED} failed ===")
    sys.exit(1 if FAILED else 0)


def _make_test_pdf() -> bytes:
    """Build a small REAL PDF with knowledge content using reportlab."""
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas as pdf_canvas

    buf = io.BytesIO()
    c = pdf_canvas.Canvas(buf, pagesize=letter)
    lines = [
        "E2E Institute Knowledge Base",
        "",
        "Courses offered: MPC (Mathematics, Physics, Chemistry),",
        "BiPC (Biology, Physics, Chemistry), and MEC (Mathematics,",
        "Economics, Commerce).",
        "",
        "Fees: MPC and BiPC cost 45,000 rupees per year.",
        "MEC costs 38,000 rupees per year.",
        "",
        "Hostel facility is available for both boys and girls at",
        "60,000 rupees per year including food.",
        "",
        "Admission process: fill the enquiry form, attend a short",
        "counselling session, submit marks memo, and pay the first",
        "term fee. Admissions are open after class tenth.",
    ]
    y = 750
    c.setFont("Helvetica", 12)
    for ln in lines:
        c.drawString(72, y, ln)
        y -= 18
    c.save()
    return buf.getvalue()


if __name__ == "__main__":
    main()
