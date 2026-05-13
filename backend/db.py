from pathlib import Path

from sqlmodel import SQLModel, create_engine

DB_PATH = Path(__file__).parent / "lbs.db"

engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False},
)


def init_db():
    SQLModel.metadata.create_all(engine)
