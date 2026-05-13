from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlmodel import Field, Session, SQLModel, select

from db import engine


class JobApplication(SQLModel, table=True):
    __tablename__ = "jobs_applications"

    id: int | None = Field(default=None, primary_key=True)
    title: str
    notes: str = ""
    url: str = ""
    done: bool = False
    position: float
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ItemCreate(BaseModel):
    title: str
    notes: str = ""
    url: str = ""
    done: bool = False


class ItemUpdate(BaseModel):
    title: str | None = None
    notes: str | None = None
    url: str | None = None
    done: bool | None = None


class ReorderRequest(BaseModel):
    id: int
    position: float


router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.get("/applications")
def list_applications() -> list[JobApplication]:
    with Session(engine) as session:
        stmt = select(JobApplication).order_by(
            JobApplication.done, JobApplication.position
        )
        return list(session.exec(stmt))


@router.post("/applications")
def create_application(payload: ItemCreate) -> JobApplication:
    with Session(engine) as session:
        # Case-insensitive same-tab uniqueness on title. Frontend should
        # already block this; backend enforces it as the authoritative gate.
        existing = session.exec(
            select(JobApplication).where(
                func.lower(JobApplication.title) == payload.title.lower()
            )
        ).first()
        if existing:
            raise HTTPException(409, "Application with this title already exists in this tab")
        max_pos = session.exec(
            select(func.coalesce(func.max(JobApplication.position), 0))
        ).one()
        app = JobApplication(
            title=payload.title,
            notes=payload.notes,
            url=payload.url,
            done=payload.done,
            position=max_pos + 1,
        )
        session.add(app)
        session.commit()
        session.refresh(app)
        return app


@router.patch("/applications/{app_id}")
def update_application(app_id: int, payload: ItemUpdate) -> JobApplication:
    with Session(engine) as session:
        app = session.get(JobApplication, app_id)
        if not app:
            raise HTTPException(404, "Application not found")
        # Same case-insensitive uniqueness guard as create — except we also
        # have to exclude the current row from the conflict search.
        if (
            payload.title is not None
            and payload.title.lower() != app.title.lower()
        ):
            conflict = session.exec(
                select(JobApplication).where(
                    func.lower(JobApplication.title) == payload.title.lower(),
                    JobApplication.id != app_id,
                )
            ).first()
            if conflict:
                raise HTTPException(
                    409, "Application with this title already exists in this tab"
                )
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(app, field, value)
        app.updated_at = datetime.now(timezone.utc)
        session.add(app)
        session.commit()
        session.refresh(app)
        return app


@router.delete("/applications/{app_id}")
def delete_application(app_id: int) -> dict:
    with Session(engine) as session:
        app = session.get(JobApplication, app_id)
        if not app:
            raise HTTPException(404, "Application not found")
        session.delete(app)
        session.commit()
    return {"ok": True}


@router.post("/applications/reorder")
def reorder_applications(payload: list[ReorderRequest]) -> dict:
    now = datetime.now(timezone.utc)
    with Session(engine) as session:
        for item in payload:
            app = session.get(JobApplication, item.id)
            if app:
                app.position = item.position
                app.updated_at = now
                session.add(app)
        session.commit()
    return {"ok": True}
