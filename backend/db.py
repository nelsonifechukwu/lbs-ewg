from pathlib import Path

from sqlalchemy import text
from sqlmodel import SQLModel, create_engine

DB_PATH = Path(__file__).parent / "lbs.db"

engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False},
)


def init_db():
    SQLModel.metadata.create_all(engine)
    _migrate()


def _migrate():
    # Idempotent column additions for tables that pre-date a new field.
    # SQLite's ALTER TABLE ADD COLUMN is non-destructive: existing rows take
    # the default value, no data is touched.
    columns_to_add = {
        "url": "TEXT NOT NULL DEFAULT ''",
    }
    with engine.begin() as conn:
        for table in ("dissertation_tasks", "jobs_applications"):
            existing = {
                row[1]
                for row in conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
            }
            for col, decl in columns_to_add.items():
                if col not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {decl}"))
