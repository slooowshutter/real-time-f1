from fastapi import APIRouter, Query
from app.database import SessionDeps
from app.schemas import Driver
from app.fetcher import fetch

router = APIRouter()

@router.get("/drivers/{driver_number}", response_model=Driver)
async def get_driver(
    driver_number: int, 
    db: SessionDeps, 
    meeting_key: int | str = Query("latest"), 
    session_key: int | str = Query("latest")
) -> Driver | None:
    params = {'driver_number': driver_number, 'meeting_key': meeting_key, 'session_key': session_key}
    data = await fetch("/drivers", **params)
    if not data: return None
    return Driver(**data[0])
