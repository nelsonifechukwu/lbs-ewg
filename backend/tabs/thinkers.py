import json
import sqlite3
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from db import DB_PATH


# ─────────────────────── schema ───────────────────────
# Plain sqlite3 throughout — this tab departs from the SQLModel pattern used by
# dissertation and jobs because the schema is richer (JSON-encoded links,
# nullable image_url, nullable last_visited_at, async image fetch). Inline SQL
# keeps the file readable top-to-bottom.

CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS thinkers_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_type TEXT NOT NULL,
    name TEXT NOT NULL,
    blurb TEXT NOT NULL DEFAULT '',
    why TEXT NOT NULL DEFAULT '',
    primary_url TEXT NOT NULL,
    image_url TEXT,
    tags TEXT NOT NULL DEFAULT '',
    links TEXT NOT NULL DEFAULT '[]',
    last_visited_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
)
"""


def init_table():
    """Called once from main.py's lifespan after SQLModel.metadata.create_all
    runs for the other tabs."""
    conn = _conn()
    try:
        conn.execute(CREATE_TABLE)
        conn.commit()
    finally:
        conn.close()


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


# ─────────────────────── API models ───────────────────────


class Entry(BaseModel):
    id: int
    entry_type: str
    name: str
    blurb: str
    why: str
    primary_url: str
    image_url: Optional[str]
    tags: str
    links: list[str]
    last_visited_at: Optional[str]
    created_at: str
    updated_at: str


class EntryCreate(BaseModel):
    entry_type: str
    name: str
    primary_url: str
    blurb: str = ""
    why: str = ""
    tags: str = ""
    links: list[str] = Field(default_factory=list)


class EntryUpdate(BaseModel):
    entry_type: Optional[str] = None
    name: Optional[str] = None
    blurb: Optional[str] = None
    why: Optional[str] = None
    primary_url: Optional[str] = None
    tags: Optional[str] = None
    links: Optional[list[str]] = None


# ─────────────────────── image fetcher ───────────────────────

_YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}


async def fetch_image_url(primary_url: str) -> Optional[str]:
    """Best-effort fetch of a representative image for the given URL.

    YouTube URLs go through the public oembed endpoint to get the thumbnail.
    Other URLs are scraped for a <meta property="og:image"> tag.

    Returns None on ANY failure (timeout, non-200, parse error, missing tag,
    bad URL). Image is optional everywhere downstream.
    """
    try:
        host = (urlparse(primary_url).hostname or "").lower()
        if host in _YOUTUBE_HOSTS:
            async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as client:
                r = await client.get(
                    "https://www.youtube.com/oembed",
                    params={"url": primary_url, "format": "json"},
                )
                r.raise_for_status()
                return r.json().get("thumbnail_url")
        async with httpx.AsyncClient(
            timeout=5.0,
            follow_redirects=True,
            headers={"User-Agent": "LBS/1.0"},
        ) as client:
            r = await client.get(primary_url)
            r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        tag = soup.find("meta", property="og:image")
        if tag is None:
            return None
        content = tag.get("content")
        if not content:
            return None
        # Many sites publish og:image as a path relative to the page
        # (e.g. "/static/og.png", "../assets/x.jpg"). Resolve it against the
        # final response URL so we always store an absolute URL — otherwise
        # the browser fetches it from the FE origin and the request 404s
        # (or trips Vite's /public/ warning).
        return urljoin(str(r.url), str(content))
    except Exception:
        return None


# ─────────────────────── helpers ───────────────────────


def _row_to_entry(row: sqlite3.Row) -> Entry:
    return Entry(
        id=row["id"],
        entry_type=row["entry_type"],
        name=row["name"],
        blurb=row["blurb"],
        why=row["why"],
        primary_url=row["primary_url"],
        image_url=row["image_url"],
        tags=row["tags"],
        links=json.loads(row["links"]),
        last_visited_at=row["last_visited_at"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─────────────────────── routes ───────────────────────


router = APIRouter(prefix="/api/thinkers", tags=["thinkers"])


@router.get("/entries")
def list_entries() -> list[Entry]:
    conn = _conn()
    try:
        rows = conn.execute(
            "SELECT * FROM thinkers_entries ORDER BY created_at DESC"
        ).fetchall()
        return [_row_to_entry(r) for r in rows]
    finally:
        conn.close()


@router.post("/entries")
async def create_entry(payload: EntryCreate) -> Entry:
    image_url = await fetch_image_url(payload.primary_url)
    now = _now()
    conn = _conn()
    try:
        cur = conn.execute(
            """
            INSERT INTO thinkers_entries (
                entry_type, name, blurb, why, primary_url, image_url,
                tags, links, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.entry_type,
                payload.name,
                payload.blurb,
                payload.why,
                payload.primary_url,
                image_url,
                payload.tags,
                json.dumps(payload.links),
                now,
                now,
            ),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM thinkers_entries WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
        return _row_to_entry(row)
    finally:
        conn.close()


@router.patch("/entries/{entry_id}")
def update_entry(entry_id: int, payload: EntryUpdate) -> Entry:
    sets: list[str] = []
    values: list[Any] = []
    if payload.entry_type is not None:
        sets.append("entry_type = ?")
        values.append(payload.entry_type)
    if payload.name is not None:
        sets.append("name = ?")
        values.append(payload.name)
    if payload.blurb is not None:
        sets.append("blurb = ?")
        values.append(payload.blurb)
    if payload.why is not None:
        sets.append("why = ?")
        values.append(payload.why)
    if payload.primary_url is not None:
        sets.append("primary_url = ?")
        values.append(payload.primary_url)
    if payload.tags is not None:
        sets.append("tags = ?")
        values.append(payload.tags)
    if payload.links is not None:
        sets.append("links = ?")
        values.append(json.dumps(payload.links))

    conn = _conn()
    try:
        if sets:
            sets.append("updated_at = ?")
            values.append(_now())
            values.append(entry_id)
            cur = conn.execute(
                f"UPDATE thinkers_entries SET {', '.join(sets)} WHERE id = ?",
                values,
            )
            if cur.rowcount == 0:
                raise HTTPException(404, "Entry not found")
            conn.commit()
        row = conn.execute(
            "SELECT * FROM thinkers_entries WHERE id = ?", (entry_id,)
        ).fetchone()
        if row is None:
            raise HTTPException(404, "Entry not found")
        return _row_to_entry(row)
    finally:
        conn.close()


@router.delete("/entries/{entry_id}")
def delete_entry(entry_id: int) -> dict:
    conn = _conn()
    try:
        cur = conn.execute(
            "DELETE FROM thinkers_entries WHERE id = ?", (entry_id,)
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "Entry not found")
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@router.post("/entries/{entry_id}/visit", status_code=204)
def visit_entry(entry_id: int) -> None:
    conn = _conn()
    try:
        cur = conn.execute(
            "UPDATE thinkers_entries SET last_visited_at = ? WHERE id = ?",
            (_now(), entry_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "Entry not found")
        conn.commit()
    finally:
        conn.close()


@router.post("/entries/{entry_id}/refetch-image")
async def refetch_image(entry_id: int) -> Entry:
    conn = _conn()
    try:
        row = conn.execute(
            "SELECT primary_url FROM thinkers_entries WHERE id = ?", (entry_id,)
        ).fetchone()
        if row is None:
            raise HTTPException(404, "Entry not found")
        primary_url = row["primary_url"]
    finally:
        conn.close()
    image_url = await fetch_image_url(primary_url)
    conn = _conn()
    try:
        conn.execute(
            "UPDATE thinkers_entries SET image_url = ?, updated_at = ? WHERE id = ?",
            (image_url, _now(), entry_id),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM thinkers_entries WHERE id = ?", (entry_id,)
        ).fetchone()
        return _row_to_entry(row)
    finally:
        conn.close()
