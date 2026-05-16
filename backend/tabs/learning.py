from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlmodel import Field, Session, SQLModel, select

from db import engine


# ─────────────────────── table ───────────────────────


class LearningItem(SQLModel, table=True):
    __tablename__ = "learning_items"

    id: int | None = Field(default=None, primary_key=True)
    title: str
    url: str = ""
    # Open-ended (no CHECK constraint) — same pattern as thinkers.entry_type.
    # CATEGORY_META in LearningTab.tsx is the single source of truth for the
    # well-known categories (curated label + icon + colour); the user can type
    # anything and the UI falls back gracefully.
    category: str
    notes: str = ""
    done: bool = False
    position: float
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ─────────────────────── API models ───────────────────────


class ItemCreate(BaseModel):
    title: str
    category: str
    url: str = ""
    notes: str = ""
    done: bool = False


class ItemUpdate(BaseModel):
    title: str | None = None
    category: str | None = None
    url: str | None = None
    notes: str | None = None
    done: bool | None = None


class ReorderRequest(BaseModel):
    id: int
    position: float


router = APIRouter(prefix="/api/learning", tags=["learning"])


# ─────────────────────── helpers ───────────────────────


def _norm_category(c: str) -> str:
    """Categories are stored lowercase + stripped — the FE displays them via
    CATEGORY_META so the raw value never needs preserving for display."""
    return c.strip().lower()


# ─────────────────────── routes ───────────────────────


@router.get("/items")
def list_items() -> list[LearningItem]:
    with Session(engine) as session:
        stmt = select(LearningItem).order_by(
            LearningItem.done, LearningItem.position
        )
        return list(session.exec(stmt))


@router.post("/items")
def create_item(payload: ItemCreate) -> LearningItem:
    category = _norm_category(payload.category)
    if not category:
        raise HTTPException(400, "Category is required")
    with Session(engine) as session:
        # Per-CATEGORY uniqueness on title. Unlike the other tabs (which are
        # tab-wide unique), learning items are deliberately allowed to repeat
        # across categories — e.g. "Substack" can exist as both a Chill source
        # and a Finance source. Within one category, duplicates are noise.
        existing = session.exec(
            select(LearningItem).where(
                func.lower(LearningItem.title) == payload.title.lower(),
                LearningItem.category == category,
            )
        ).first()
        if existing:
            raise HTTPException(
                409,
                f'"{payload.title}" already exists in category "{category}"',
            )
        max_pos = session.exec(
            select(func.coalesce(func.max(LearningItem.position), 0))
        ).one()
        item = LearningItem(
            title=payload.title,
            url=payload.url,
            category=category,
            notes=payload.notes,
            done=payload.done,
            position=max_pos + 1,
        )
        session.add(item)
        session.commit()
        session.refresh(item)
        return item


@router.patch("/items/{item_id}")
def update_item(item_id: int, payload: ItemUpdate) -> LearningItem:
    with Session(engine) as session:
        item = session.get(LearningItem, item_id)
        if not item:
            raise HTTPException(404, "Item not found")
        # If title OR category is changing, re-check the (category, title)
        # uniqueness against the would-be final values.
        next_title = payload.title if payload.title is not None else item.title
        next_category = (
            _norm_category(payload.category)
            if payload.category is not None
            else item.category
        )
        changing_identity = (
            payload.title is not None
            and payload.title.lower() != item.title.lower()
        ) or (
            payload.category is not None
            and _norm_category(payload.category) != item.category
        )
        if changing_identity:
            conflict = session.exec(
                select(LearningItem).where(
                    func.lower(LearningItem.title) == next_title.lower(),
                    LearningItem.category == next_category,
                    LearningItem.id != item_id,
                )
            ).first()
            if conflict:
                raise HTTPException(
                    409,
                    f'"{next_title}" already exists in category "{next_category}"',
                )
        data = payload.model_dump(exclude_unset=True)
        if "category" in data:
            data["category"] = _norm_category(data["category"])
        for field, value in data.items():
            setattr(item, field, value)
        item.updated_at = datetime.now(timezone.utc)
        session.add(item)
        session.commit()
        session.refresh(item)
        return item


@router.delete("/items/{item_id}")
def delete_item(item_id: int) -> dict:
    with Session(engine) as session:
        item = session.get(LearningItem, item_id)
        if not item:
            raise HTTPException(404, "Item not found")
        session.delete(item)
        session.commit()
    return {"ok": True}


@router.post("/items/reorder")
def reorder_items(payload: list[ReorderRequest]) -> dict:
    now = datetime.now(timezone.utc)
    with Session(engine) as session:
        for entry in payload:
            item = session.get(LearningItem, entry.id)
            if item:
                item.position = entry.position
                item.updated_at = now
                session.add(item)
        session.commit()
    return {"ok": True}
