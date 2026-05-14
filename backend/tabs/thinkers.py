from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import JSON, Column
from sqlmodel import Field, Session, SQLModel, select

from db import engine


# ─────────────────────── table ───────────────────────


class ThinkerEntry(SQLModel, table=True):
    __tablename__ = "thinkers_entries"

    id: int | None = Field(default=None, primary_key=True)
    entry_type: str
    name: str
    blurb: str = ""
    why: str = ""
    primary_url: str
    image_url: str | None = None
    # tags is still in the schema for backward compat; the FE no longer
    # surfaces it (see CLAUDE.md). Kept as a plain string column.
    tags: str = ""
    # JSON-encoded under the hood (SQLite stores as TEXT), exposed as
    # list[str] to Python and to the API response.
    links: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    last_visited_at: datetime | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ─────────────────────── API models ───────────────────────


class EntryCreate(BaseModel):
    entry_type: str
    name: str
    primary_url: str
    blurb: str = ""
    why: str = ""
    # If provided on create, the server uses it verbatim and skips the
    # og:image fetch. If omitted/empty, the server scrapes the primary_url.
    image_url: Optional[str] = None
    tags: str = ""
    links: list[str] = []


class EntryUpdate(BaseModel):
    entry_type: Optional[str] = None
    name: Optional[str] = None
    blurb: Optional[str] = None
    why: Optional[str] = None
    primary_url: Optional[str] = None
    # Pass a URL to override, "" to clear (renders as monogram).
    image_url: Optional[str] = None
    tags: Optional[str] = None
    links: Optional[list[str]] = None


# ─────────────────────── image fetcher ───────────────────────

_YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}


async def fetch_image_url(primary_url: str) -> str | None:
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
        # final response URL so we always store an absolute URL.
        return urljoin(str(r.url), str(content))
    except Exception:
        return None


# ─────────────────────── routes ───────────────────────


router = APIRouter(prefix="/api/thinkers", tags=["thinkers"])


@router.get("/entries")
def list_entries() -> list[ThinkerEntry]:
    with Session(engine) as session:
        stmt = select(ThinkerEntry).order_by(ThinkerEntry.created_at.desc())  # type: ignore[attr-defined]
        return list(session.exec(stmt))


@router.post("/entries")
async def create_entry(payload: EntryCreate) -> ThinkerEntry:
    # If the caller pasted a specific image URL, respect it and skip the
    # scrape. Empty string is treated the same as not provided.
    image_url = payload.image_url or await fetch_image_url(payload.primary_url)
    with Session(engine) as session:
        entry = ThinkerEntry(
            entry_type=payload.entry_type,
            name=payload.name,
            blurb=payload.blurb,
            why=payload.why,
            primary_url=payload.primary_url,
            image_url=image_url,
            tags=payload.tags,
            links=payload.links,
        )
        session.add(entry)
        session.commit()
        session.refresh(entry)
        return entry


@router.patch("/entries/{entry_id}")
def update_entry(entry_id: int, payload: EntryUpdate) -> ThinkerEntry:
    with Session(engine) as session:
        entry = session.get(ThinkerEntry, entry_id)
        if not entry:
            raise HTTPException(404, "Entry not found")
        data = payload.model_dump(exclude_unset=True)
        # Empty image_url means "clear it" → NULL in DB → monogram on FE.
        if "image_url" in data and data["image_url"] == "":
            data["image_url"] = None
        for field, value in data.items():
            setattr(entry, field, value)
        entry.updated_at = datetime.now(timezone.utc)
        session.add(entry)
        session.commit()
        session.refresh(entry)
        return entry


@router.delete("/entries/{entry_id}")
def delete_entry(entry_id: int) -> dict:
    with Session(engine) as session:
        entry = session.get(ThinkerEntry, entry_id)
        if not entry:
            raise HTTPException(404, "Entry not found")
        session.delete(entry)
        session.commit()
    return {"ok": True}


@router.post("/entries/{entry_id}/visit", status_code=204)
def visit_entry(entry_id: int) -> None:
    with Session(engine) as session:
        entry = session.get(ThinkerEntry, entry_id)
        if not entry:
            raise HTTPException(404, "Entry not found")
        entry.last_visited_at = datetime.now(timezone.utc)
        session.add(entry)
        session.commit()


@router.post("/entries/{entry_id}/refetch-image")
async def refetch_image(entry_id: int) -> ThinkerEntry:
    # Pull primary_url, scrape outside any open session, then re-open for the
    # update — keeps the network round-trip off the open DB connection.
    with Session(engine) as session:
        entry = session.get(ThinkerEntry, entry_id)
        if not entry:
            raise HTTPException(404, "Entry not found")
        primary_url = entry.primary_url
    image_url = await fetch_image_url(primary_url)
    with Session(engine) as session:
        entry = session.get(ThinkerEntry, entry_id)
        if not entry:
            raise HTTPException(404, "Entry not found")
        entry.image_url = image_url
        entry.updated_at = datetime.now(timezone.utc)
        session.add(entry)
        session.commit()
        session.refresh(entry)
        return entry
