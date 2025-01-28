from typing import Annotated
from fastapi import Depends
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.ext.declarative import declarative_base

from app.config import settings

# Create SQLAlchemy engine using environment variable
engine = create_engine(
  settings.qdb_database_url, echo=True, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db() -> Session:
  """Dependency function that yields database sessions"""
  db = SessionLocal()
  try: yield db
  finally: db.close()

SessionDeps = Annotated[Session, Depends(get_db)]