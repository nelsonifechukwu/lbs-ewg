from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from db import init_db
from tabs import dissertation, jobs, learning, thinkers  # noqa: F401  (import registers SQLModel tables)
import search


UPLOADS_DIR = Path(__file__).resolve().parent / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(dissertation.router)
app.include_router(jobs.router)
app.include_router(thinkers.router)
app.include_router(learning.router)
app.include_router(search.router)

# User-uploaded images live under backend/uploads/ and are served read-only
# at /uploads/. The thinkers tab writes to backend/uploads/thinkers/.
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")
