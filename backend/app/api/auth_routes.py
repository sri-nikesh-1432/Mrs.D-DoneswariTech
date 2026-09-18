"""
Authentication API Routes for Doneswari AI Telecaller Platform.
Handles Signup, Login, Workspace setup, and Token Validation.
"""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Header, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.connection import get_database, AsyncSessionLocal
from app.database.models import User, Workspace, Institute
from app.auth.auth_service import hash_password, verify_password, create_access_token, decode_access_token
from app.logs.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    company_name: Optional[str] = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: int
    email: str
    full_name: str
    company_name: Optional[str] = None
    workspace_id: int
    workspace_name: str


# ── Auth Dependency ──────────────────────────────────────────────────────────

async def get_current_user_optional(
    authorization: Optional[str] = Header(None),
    session: AsyncSession = Depends(get_database),
) -> Optional[User]:
    """Extract authenticated user if Authorization header is provided."""
    if not authorization or not authorization.startswith("Bearer "):
        return None

    token = authorization.split(" ")[1]
    payload = decode_access_token(token)
    if not payload or "user_id" not in payload:
        return None

    user = await session.get(User, payload["user_id"])
    return user


async def get_current_user(
    authorization: Optional[str] = Header(None),
    session: AsyncSession = Depends(get_database),
) -> User:
    """Strictly require authentication."""
    user = await get_current_user_optional(authorization, session)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


async def get_or_create_default_workspace(user_id: int, session: AsyncSession, company_name: str = "My Organization") -> Workspace:
    """Ensure every user has at least one isolated workspace."""
    result = await session.execute(
        select(Workspace).where(Workspace.user_id == user_id).limit(1)
    )
    ws = result.scalar_one_or_none()
    if not ws:
        ws = Workspace(
            user_id=user_id,
            name=f"{company_name}'s Workspace"
        )
        session.add(ws)
        await session.commit()
        await session.refresh(ws)
    return ws


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/signup")
async def signup(body: SignupRequest, session: AsyncSession = Depends(get_database)):
    """Register a new user, create default workspace, and issue session token."""
    existing = await session.execute(select(User).where(User.email == body.email.lower()))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="User with this email already exists")

    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    new_user = User(
        email=body.email.lower().strip(),
        hashed_password=hash_password(body.password),
        full_name=body.full_name.strip(),
        company_name=body.company_name.strip() if body.company_name else "Doneswari Org",
    )
    session.add(new_user)
    await session.commit()
    await session.refresh(new_user)

    # Create isolated workspace
    workspace = await get_or_create_default_workspace(
        new_user.id, session, new_user.company_name or new_user.full_name
    )

    token = create_access_token({"user_id": new_user.id, "workspace_id": workspace.id, "email": new_user.email})

    return {
        "token": token,
        "user": {
            "id": new_user.id,
            "email": new_user.email,
            "full_name": new_user.full_name,
            "company_name": new_user.company_name,
        },
        "workspace": {
            "id": workspace.id,
            "name": workspace.name,
        }
    }


@router.post("/login")
async def login(body: LoginRequest, session: AsyncSession = Depends(get_database)):
    """Authenticate user with email & password, returning token and workspace."""
    result = await session.execute(select(User).where(User.email == body.email.lower().strip()))
    user = result.scalar_one_or_none()

    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    workspace = await get_or_create_default_workspace(
        user.id, session, user.company_name or user.full_name
    )

    token = create_access_token({"user_id": user.id, "workspace_id": workspace.id, "email": user.email})

    return {
        "token": token,
        "user": {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "company_name": user.company_name,
        },
        "workspace": {
            "id": workspace.id,
            "name": workspace.name,
        }
    }


@router.get("/me")
async def get_me(
    authorization: Optional[str] = Header(None),
    session: AsyncSession = Depends(get_database),
):
    """Get current user context. Defaults to demo account if unauthenticated."""
    user = await get_current_user_optional(authorization, session)
    if not user:
        # Provide demo context so public/unauthenticated UI preview still works gracefully
        return {
            "authenticated": False,
            "user": {
                "id": 1,
                "email": "demo@doneswari.ai",
                "full_name": "Demo User",
                "company_name": "Doneswari Technologies",
            },
            "workspace": {
                "id": 1,
                "name": "Doneswari AI Workspace",
            }
        }

    workspace = await get_or_create_default_workspace(
        user.id, session, user.company_name or user.full_name
    )

    return {
        "authenticated": True,
        "user": {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "company_name": user.company_name,
        },
        "workspace": {
            "id": workspace.id,
            "name": workspace.name,
        }
    }


@router.post("/logout")
async def logout():
    """Sign out user session."""
    return {"message": "Logged out successfully"}
