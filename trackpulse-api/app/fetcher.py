import aiohttp, asyncio
from typing import NamedTuple
from enum import Enum
from datetime import datetime, timedelta
from sqlalchemy.orm import Session as ORMSession
from app.database import get_db
from app.schemas import Session

from rich import print


class FetcherConfig(NamedTuple):
    endpoint: str
    periodic: bool

class Endpoint(Enum):
    INTERVALS = FetcherConfig("/intervals", True)
    LAPS = FetcherConfig("/laps", True)
    POSITIONS = FetcherConfig("/positions", True)
    CAR_DATA = FetcherConfig("/car_data", True)
    LOCATIONS = FetcherConfig("/location", True)
    MEETINGS = FetcherConfig("/meetings", False)
    SESSIONS = FetcherConfig("/sessions", False)
    DRIVERS = FetcherConfig("/drivers", False)
    TEAM_RADIO = FetcherConfig("/team_radio", True)
    STINTS = FetcherConfig("/stints", True)
    PITS = FetcherConfig("/pits", True)
    WEATHER = FetcherConfig("/weather", True)
    RACE_CONTROL = FetcherConfig("/race_control", False)

async def fetch(endpoint: str, **params) -> list:
    base = 'https://api.openf1.org/v1'
    query = '&'.join(f'{k}={v}' for k,v in params.items() if "date" not in k)
    if "date_start" in params: query += f"&date>={params['date_start'].isoformat()}&date<={params['date_end'].isoformat()}"
    url = f'{base}{endpoint}?{query}'
    print(f"🚧 Fetching {url}")
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            data = await response.json()

    now = datetime.now()
    data = [dict(d, timestamp=now) for d in data]
    return data

async def periodic(endpoint: str, interval: float = 5.0, **params):
    while True:
        try:
            data = await fetch(endpoint, **params)
            window = (params["date_end"] - params["date_start"]).total_seconds()
            params["date_start"] = params["date_end"]
            params["date_end"] += timedelta(seconds=window)
            yield data
        except Exception as e: print(f'Error fetching data {endpoint}: {e}')
        await asyncio.sleep(interval)


async def main(interval: float = 5.0, window: float = 60.0, db: ORMSession = next(get_db())):
    # Fetch the latest sessions data
    kvobj = await fetch("/sessions", **{"meeting_key": "latest"})
    session = Session(**kvobj[-1])
    params = {
        "session_key": session.session_key,
        "date_start": session.date_start,
        "date_end": (session.date_start + timedelta(seconds=window))
    }
    for endpoint in Endpoint:
        async for data in periodic(endpoint.value.endpoint, interval, **params):
            print(len(data) if data else data)

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description='Fetch data from OpenF1 API')
    parser.add_argument('-i', '--interval', type=float, default=5.0, help='Polling interval in seconds (default: 5.0)')
    parser.add_argument('-w', '--window', type=float, default=60.0, help='Window size in seconds (default: 60.0)')
    args = parser.parse_args()
    
    asyncio.run(main(**vars(args)))