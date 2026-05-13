# Cross-tab title search. Lives here, not inside any tab file, because it
# necessarily knows about every tab. Adding a new tab means appending one
# entry to TABS below.

from fastapi import APIRouter
from pydantic import BaseModel
from sqlmodel import Session, select

from db import engine
from tabs.dissertation import DissertationTask
from tabs.jobs import JobApplication


router = APIRouter(prefix="/api", tags=["search"])


class SearchResult(BaseModel):
    title: str
    done: bool
    tab: str
    tab_label: str


# (id, label, model) — id matches what the frontend tab components pass as
# their own TAB_ID, so they can filter out same-tab matches.
TABS = [
    ("dissertation", "Dissertation", DissertationTask),
    ("jobs", "Jobs", JobApplication),
]


@router.get("/search")
def search(q: str) -> list[SearchResult]:
    q = q.strip()
    if not q:
        return []
    pattern = f"%{q}%"
    results: list[SearchResult] = []
    with Session(engine) as session:
        for tab_id, tab_label, model in TABS:
            for row in session.exec(select(model).where(model.title.ilike(pattern))):
                results.append(
                    SearchResult(
                        title=row.title,
                        done=row.done,
                        tab=tab_id,
                        tab_label=tab_label,
                    )
                )
    return results
