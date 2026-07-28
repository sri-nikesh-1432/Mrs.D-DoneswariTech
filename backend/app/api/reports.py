"""
Reports API endpoints — campaign analytics and PDF export.
"""

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from app.campaign.manager import campaign_manager
from app.utils.logger import get_logger

router = APIRouter()
logger = get_logger(__name__)


@router.get("/reports/campaign-summary")
async def get_campaign_summary(campaign_id: int = Query(...)):
    """Get campaign summary with analytics data."""
    stats = await campaign_manager.get_campaign_stats(campaign_id)
    if "error" in stats:
        raise HTTPException(status_code=404, detail=stats["error"])

    students = await campaign_manager.get_students(campaign_id)

    # Compute additional analytics
    sentiment_distribution = {"positive": 0, "neutral": 0, "negative": 0}
    interest_levels = {"high": 0, "medium": 0, "low": 0}
    course_distribution = {}

    for s in students:
        # Sentiment
        sent = s.get("sentiment", "unknown")
        if sent in sentiment_distribution:
            sentiment_distribution[sent] += 1

        # Interest
        interest = s.get("interest_score", 0)
        if interest >= 70:
            interest_levels["high"] += 1
        elif interest >= 40:
            interest_levels["medium"] += 1
        else:
            interest_levels["low"] += 1

        # Course distribution
        course = s.get("preferred_course", "Not specified")
        if course:
            course_distribution[course] = course_distribution.get(course, 0) + 1

    return {
        "success": True,
        "data": {
            "stats": stats,
            "students": students,
            "analytics": {
                "sentiment_distribution": sentiment_distribution,
                "interest_levels": interest_levels,
                "course_distribution": course_distribution,
                "total_students": len(students),
                "completion_rate": round(
                    stats.get("calls_completed", 0) / max(stats.get("total_students", 1), 1) * 100, 1
                ),
                "interest_rate": round(
                    stats.get("interested", 0) / max(stats.get("calls_completed", 1), 1) * 100, 1
                ),
            },
        },
    }


@router.get("/reports/export-pdf")
async def export_campaign_pdf(campaign_id: int = Query(...)):
    """Generate and download campaign PDF report."""
    try:
        from app.reports.pdf_generator import generate_campaign_pdf
        pdf_path = await generate_campaign_pdf(campaign_id)

        if not pdf_path:
            raise HTTPException(status_code=500, detail="Failed to generate PDF")

        return FileResponse(
            path=pdf_path,
            media_type="application/pdf",
            filename=f"campaign_report_{campaign_id}.pdf",
            headers={"Content-Disposition": f"attachment; filename=campaign_report_{campaign_id}.pdf"},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("PDF export failed: %s", e)
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(e)}")


@router.get("/reports/student-detail")
async def get_student_detail(student_id: int = Query(...)):
    """Get detailed information about a specific student's call."""
    # Get all campaigns and find the student
    # In a real app, this would query the database directly
    students = []
    # For now, this is a placeholder - the actual data comes from the campaign manager
    return {"success": True, "data": {"message": "Student details available through campaign data"}}
