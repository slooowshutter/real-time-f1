from enum import Enum
import requests
from typing import Dict, List, Optional
from datetime import datetime, timedelta, timezone
import time
from urllib.parse import quote

class EndpointType(Enum):
    CAR_DATA = ("car_data", {
        "params": ["meeting_key", "driver_number", "session_key", "speed", "rpm", "drs", "n_gear", "throttle", "brake"],
        "date_field": "date",
        "cadence": 1
    })
    DRIVERS = ("drivers", {
        "params": ["meeting_key", "driver_number", "session_key", "meeting_key", "team_name", "country_code"],
        "date_field": None,  # Drivers endpoint doesn't use date filtering
        "cadence": None  # No regular refresh needed
    })
    INTERVALS = ("intervals", {
        "params": ["meeting_key", "session_key", "driver_number", "interval", "gap_to_leader"],
        "date_field": "date",
        "cadence": 1
    })
    LAPS = ("laps", {
        "params": ["meeting_key", "session_key", "driver_number", "lap_number", "is_pit_out_lap"],
        "date_field": "date_start",
        "cadence": 5
    })
    LOCATION = ("location", {
        "params": ["meeting_key", "session_key", "driver_number", "x", "y", "z"],
        "date_field": "date",
        "cadence": 1
    })
    MEETINGS = ("meetings", {
        "params": ["meeting_key", "year", "country_name", "meeting_key", "circuit_key"],
        "date_field": "date_start",
        "cadence": None  # No regular refresh needed
    })
    PIT = ("pit", {
        "params": ["meeting_key", "session_key", "driver_number", "lap_number", "pit_duration"],
        "date_field": "date",
        "cadence": 5
    })
    POSITION = ("position", {
        "params": ["meeting_key", "session_key", "driver_number", "position"],
        "date_field": "date",
        "cadence": 2
    })
    RACE_CONTROL = ("race_control", {
        "params": ["meeting_key", "session_key", "driver_number", "category", "scope", "sector"],
        "date_field": "date",
        "cadence": 5
    })
    SESSIONS = ("sessions", {
        "params": ["meeting_key", "country_name", "session_name", "year", "session_key"],
        "date_field": "date_start",  # Sessions use date_start/date_end
        "cadence": None  # No regular refresh needed
    })
    STINTS = ("stints", {
        "params": ["meeting_key", "session_key", "driver_number", "compound", "tyre_age_at_start"],
        "date_field": None,  # Stints don't use date filtering
        "cadence": 5
    })
    TEAM_RADIO = ("team_radio", {
        "params": ["meeting_key", "session_key", "driver_number"],
        "date_field": "date",
        "cadence": 5
    })
    WEATHER = ("weather", {
        "params": ["meeting_key", "session_key", "wind_direction", "track_temperature", "air_temperature"],
        "date_field": "date",
        "cadence": 60
    })

    def __init__(self, endpoint: str, config: Dict):
        self.endpoint = endpoint
        self.config = config

class F1DataFetcher:
    def __init__(self, db, start_time: datetime, is_real_time: bool):
        self.base_url = "https://api.openf1.org/v1"
        self.session = requests.Session()
        self.db = db
        self.current_time = start_time
        self.is_real_time = is_real_time

    def _format_date_param(self, date: datetime) -> str:
        """Format datetime for API request"""
        return date.strftime("%Y-%m-%dT%H:%M:%S.000Z")

    def fetch(self, endpoint: EndpointType, params: Dict = None, 
             start_time: Optional[datetime] = None, 
             end_time: Optional[datetime] = None) -> List[Dict]:
        """
        Fetch data from the API with proper date handling
        """
        try:
            if params is None:
                params = {}

            # Build base URL
            url = f"{self.base_url}/{endpoint.endpoint}"
            
            # Start building query parameters
            query_params = []
            
            # Add base params
            endpoint_config = endpoint.config
            allowed_params = endpoint_config["params"]
            for k, v in params.items():
                if k in allowed_params:
                    query_params.append(f"{k}={v}")

            # Add date filtering if endpoint supports it and dates are provided
            date_field = endpoint_config["date_field"]
            if date_field and start_time and end_time:
                formatted_start = self._format_date_param(start_time)
                formatted_end = self._format_date_param(end_time)
                query_params.extend([
                    f"{date_field}%3E={formatted_start}",
                    f"{date_field}%3C={formatted_end}"
                ])

            # Combine all params into URL
            if query_params:
                url = f"{url}?{'&'.join(query_params)}"

            response = self.session.get(url, timeout=30)
            response.raise_for_status()
            data = response.json()
            meeting_str = f"M:{params.get('meeting_key', '-')}"
            session_str = f"S:{params.get('session_key', '-')}"
            time_info = f"{start_time.strftime('%H:%M:%S')} to {end_time.strftime('%H:%M:%S')}" if start_time and end_time else ""
            print(f"{len(data) if data else 0} records\t{endpoint.endpoint} ({meeting_str} {session_str})\t{time_info}")
            return data

        except requests.HTTPError as e:
            if e.response.status_code == 429:
                raise Exception("Too many requests. Please wait before trying again.")
            raise
        except requests.RequestException as e:
            raise
