"""
PDF Report Generator — Generates professional campaign reports with charts and summaries.
"""

import os
import io
from datetime import datetime, timezone
from typing import Dict, List, Optional

from app.config import settings
from app.logs.logger import get_logger
from app.campaign.manager import campaign_manager

logger = get_logger(__name__)

try:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm, cm
    from reportlab.lib.colors import HexColor
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
        PageBreak, Image, KeepTogether
    )
    from reportlab.lib import colors
    REPORTLAB_AVAILABLE = True
except ImportError:
    REPORTLAB_AVAILABLE = False
    logger.warning("ReportLab not installed. PDF generation disabled.")

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    MATPLOTLIB_AVAILABLE = True
except ImportError:
    MATPLOTLIB_AVAILABLE = False
    logger.warning("Matplotlib not installed. Chart generation disabled.")


async def generate_campaign_pdf(campaign_id: int) -> Optional[str]:
    """Generate a professional PDF report for a campaign."""
    if not REPORTLAB_AVAILABLE:
        logger.error("ReportLab not available")
        return None

    stats = await campaign_manager.get_campaign_stats(campaign_id)
    if "error" in stats:
        logger.error("Campaign stats error: %s", stats["error"])
        return None

    students = await campaign_manager.get_students(campaign_id)

    os.makedirs(settings.REPORTS_DIR, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    pdf_path = os.path.join(settings.REPORTS_DIR, f"campaign_{campaign_id}_{timestamp}.pdf")

    doc = SimpleDocTemplate(
        pdf_path,
        pagesize=A4,
        topMargin=2*cm,
        bottomMargin=2*cm,
        leftMargin=2*cm,
        rightMargin=2*cm,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "CustomTitle", parent=styles["Title"],
        fontSize=24, spaceAfter=6,
        textColor=HexColor("#4F46E5"),
    )
    heading_style = ParagraphStyle(
        "CustomHeading", parent=styles["Heading2"],
        fontSize=14, spaceAfter=8, spaceBefore=16,
        textColor=HexColor("#1E293B"),
    )
    normal_style = ParagraphStyle(
        "CustomNormal", parent=styles["Normal"],
        fontSize=10, spaceAfter=4,
    )

    elements = []

    # Title
    elements.append(Paragraph(f"Mrs. D — Campaign Report", title_style))
    elements.append(Paragraph(f"<b>{stats.get('campaign_name', 'Unknown')}</b>", heading_style))
    elements.append(Paragraph(f"Institute: {stats.get('institute_name', 'Unknown')}", normal_style))
    elements.append(Paragraph(f"Generated: {datetime.now().strftime('%B %d, %Y %H:%M')}", normal_style))
    elements.append(Spacer(1, 12))

    # Campaign Summary
    elements.append(Paragraph("Campaign Summary", heading_style))
    summary_data = [
        ["Metric", "Value"],
        ["Status", stats.get("status", "N/A").upper()],
        ["Total Students", str(stats.get("total_students", 0))],
        ["Calls Completed", str(stats.get("calls_completed", 0))],
        ["Calls Failed", str(stats.get("calls_failed", 0))],
        ["Interested", str(stats.get("interested", 0))],
        ["Follow-up Required", str(stats.get("follow_up_required", 0))],
        ["Average Duration", f"{stats.get('average_duration', 0)}s"],
        ["Progress", f"{stats.get('progress', 0)}%"],
    ]
    t = Table(summary_data, colWidths=[200, 200])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HexColor("#4F46E5")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("GRID", (0, 0), (-1, -1), 1, HexColor("#E2E8F0")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, HexColor("#F8FAFC")]),
    ]))
    elements.append(t)
    elements.append(Spacer(1, 16))

    # Student Reports
    elements.append(Paragraph("Student Reports", heading_style))

    for student in students:
        status_color = {
            "completed": "#10B981", "failed": "#EF4444",
            "calling": "#3B82F6", "not_called": "#9CA3AF",
            "retry": "#F59E0B",
        }.get(student.get("status", "not_called"), "#9CA3AF")

        student_html = (
            f"<b>{student.get('name', 'Unknown')}</b> | "
            f"Phone: {student.get('phone', 'N/A')} | "
            f"Course: {student.get('preferred_course', 'N/A')} | "
            f"Status: {student.get('status', 'N/A')} | "
            f"Interest: {student.get('interest_score', 0)}%"
        )
        elements.append(Paragraph(student_html, normal_style))

        if student.get("summary"):
            elements.append(Paragraph(f"<i>Summary: {student['summary'][:300]}</i>", normal_style))

        elements.append(Spacer(1, 8))

    # Build PDF
    doc.build(elements)
    logger.info("PDF report generated: %s", pdf_path)
    return pdf_path
