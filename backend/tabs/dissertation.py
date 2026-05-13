from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlmodel import Field, Session, SQLModel, select

from db import engine


class DissertationTask(SQLModel, table=True):
    __tablename__ = "dissertation_tasks"

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


router = APIRouter(prefix="/api/dissertation", tags=["dissertation"])


@router.get("/tasks")
def list_tasks() -> list[DissertationTask]:
    with Session(engine) as session:
        stmt = select(DissertationTask).order_by(
            DissertationTask.done, DissertationTask.position
        )
        return list(session.exec(stmt))


@router.post("/tasks")
def create_task(payload: ItemCreate) -> DissertationTask:
    with Session(engine) as session:
        # Case-insensitive same-tab uniqueness on title. Frontend should
        # already block this; backend enforces it as the authoritative gate.
        existing = session.exec(
            select(DissertationTask).where(
                func.lower(DissertationTask.title) == payload.title.lower()
            )
        ).first()
        if existing:
            raise HTTPException(409, "Task with this title already exists in this tab")
        max_pos = session.exec(
            select(func.coalesce(func.max(DissertationTask.position), 0))
        ).one()
        task = DissertationTask(
            title=payload.title,
            notes=payload.notes,
            url=payload.url,
            done=payload.done,
            position=max_pos + 1,
        )
        session.add(task)
        session.commit()
        session.refresh(task)
        return task


@router.patch("/tasks/{task_id}")
def update_task(task_id: int, payload: ItemUpdate) -> DissertationTask:
    with Session(engine) as session:
        task = session.get(DissertationTask, task_id)
        if not task:
            raise HTTPException(404, "Task not found")
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(task, field, value)
        task.updated_at = datetime.now(timezone.utc)
        session.add(task)
        session.commit()
        session.refresh(task)
        return task


@router.delete("/tasks/{task_id}")
def delete_task(task_id: int) -> dict:
    with Session(engine) as session:
        task = session.get(DissertationTask, task_id)
        if not task:
            raise HTTPException(404, "Task not found")
        session.delete(task)
        session.commit()
    return {"ok": True}


@router.post("/tasks/reorder")
def reorder_tasks(payload: list[ReorderRequest]) -> dict:
    now = datetime.now(timezone.utc)
    with Session(engine) as session:
        for item in payload:
            task = session.get(DissertationTask, item.id)
            if task:
                task.position = item.position
                task.updated_at = now
                session.add(task)
        session.commit()
    return {"ok": True}
