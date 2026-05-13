import sqlite3
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from db import get_conn


CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS dissertation_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    done INTEGER NOT NULL DEFAULT 0,
    position REAL NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
)
"""


class Item(BaseModel):
    id: int
    title: str
    notes: str
    done: bool
    position: float
    created_at: str
    updated_at: str


class ItemCreate(BaseModel):
    title: str = Field(min_length=1)
    notes: str = ""


class ItemUpdate(BaseModel):
    title: str | None = None
    notes: str | None = None
    done: bool | None = None


class ReorderRequest(BaseModel):
    id: int
    position: float


router = APIRouter(prefix="/api/dissertation", tags=["dissertation"])


def _row_to_item(row: sqlite3.Row) -> Item:
    return Item(
        id=row["id"],
        title=row["title"],
        notes=row["notes"],
        done=bool(row["done"]),
        position=row["position"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.get("/tasks")
def list_tasks() -> list[Item]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM dissertation_tasks ORDER BY done ASC, position ASC"
        ).fetchall()
    return [_row_to_item(r) for r in rows]


@router.post("/tasks")
def create_task(payload: ItemCreate) -> Item:
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        max_pos = conn.execute(
            "SELECT COALESCE(MAX(position), 0) FROM dissertation_tasks"
        ).fetchone()[0]
        cur = conn.execute(
            """INSERT INTO dissertation_tasks
               (title, notes, done, position, created_at, updated_at)
               VALUES (?, ?, 0, ?, ?, ?)""",
            (payload.title, payload.notes, max_pos + 1, now, now),
        )
        row = conn.execute(
            "SELECT * FROM dissertation_tasks WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
    return _row_to_item(row)


@router.patch("/tasks/{task_id}")
def update_task(task_id: int, payload: ItemUpdate) -> Item:
    sets: list[str] = []
    values: list = []
    if payload.title is not None:
        sets.append("title = ?")
        values.append(payload.title)
    if payload.notes is not None:
        sets.append("notes = ?")
        values.append(payload.notes)
    if payload.done is not None:
        sets.append("done = ?")
        values.append(1 if payload.done else 0)

    with get_conn() as conn:
        if sets:
            sets.append("updated_at = ?")
            values.append(datetime.now(timezone.utc).isoformat())
            values.append(task_id)
            cur = conn.execute(
                f"UPDATE dissertation_tasks SET {', '.join(sets)} WHERE id = ?",
                values,
            )
            if cur.rowcount == 0:
                raise HTTPException(404, "Task not found")
        row = conn.execute(
            "SELECT * FROM dissertation_tasks WHERE id = ?", (task_id,)
        ).fetchone()
        if row is None:
            raise HTTPException(404, "Task not found")
    return _row_to_item(row)


@router.delete("/tasks/{task_id}")
def delete_task(task_id: int) -> dict:
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM dissertation_tasks WHERE id = ?", (task_id,)
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "Task not found")
    return {"ok": True}


@router.post("/tasks/reorder")
def reorder_tasks(payload: list[ReorderRequest]) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        for item in payload:
            conn.execute(
                "UPDATE dissertation_tasks SET position = ?, updated_at = ? WHERE id = ?",
                (item.position, now, item.id),
            )
    return {"ok": True}
