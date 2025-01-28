from datetime import datetime, timedelta, timezone
import json
import time
from db.client import QuestDBClient
from data_fetcher.fetch import F1DataFetcher, EndpointType
import subprocess

subprocess.Popen('caffeinate')

# Base start time for fetching data
START_TIME = datetime.strptime("2024-12-01 16:10:00 UTC", "%Y-%m-%d %H:%M:%S %Z")
IS_REAL_TIME = False
DROP_ALL_TABLES_ON_START = False

def fetch_data_in_chunks(fetcher: F1DataFetcher, db: QuestDBClient, endpoint_type: EndpointType, 
                        params: dict, start_time: datetime, end_time: datetime):
    # Validate required keys
    session_key = params.get("session_key")
    meeting_key = params.get("meeting_key")
    
    # Validate keys based on endpoint requirements
    print('endpoint_type', endpoint_type, session_key, meeting_key)
    if endpoint_type == EndpointType.MEETINGS:
        session_key = meeting_key  # For meetings endpoint, use meeting_key as session_key
    elif "session_key" in endpoint_type.config["params"] and not session_key:
        print(f"Skipping {endpoint_type.endpoint}: missing session_key")
        return
    
    if "meeting_key" in endpoint_type.config["params"] and not meeting_key:
        print(f"Skipping {endpoint_type.endpoint}: missing meeting_key")
        return

    cadence = endpoint_type.config["cadence"]
    date_field = endpoint_type.config["date_field"]
    
    # For endpoints with no cadence, check if we already fetched this session
    if cadence is None:
        session_clause = f"AND session_key = {session_key}" if session_key is not None else ""
        progress = db.query(f"""
            SELECT * FROM fetch_progress 
            WHERE endpoint = '{endpoint_type.endpoint}' 
            AND meeting_key = {meeting_key}
            {session_clause}
            AND status = 'completed'
        """)
        
        if not progress.empty:
            print(f"Already fetched all {endpoint_type.endpoint} data for session {session_key}")
            return
            
        # For endpoints without cadence, fetch all at once without date filtering
        data = fetcher.fetch(endpoint_type, params)
        db.insert_dataframe([{
            "endpoint": endpoint_type.endpoint,
            "meeting_key": meeting_key,
            "session_key": session_key,
            "chunk_start": start_time,
            "chunk_end": end_time,
            "status": "completed",
            "created_at": datetime.now(timezone.utc)
        }], "fetch_progress")
        
        if data:
            db.insert_dataframe(data, endpoint_type.endpoint)
        return

    # Define base chunk size based on cadence
    base_chunk_minutes = 3 if cadence == 1 else 30
    current_multiplier = 1  # Track the current chunk size multiplier
    chunk_size = timedelta(minutes=base_chunk_minutes)
    
    # Round down start_time to nearest chunk_minutes
    chunk_start = start_time.replace(
        minute=start_time.minute - (start_time.minute % base_chunk_minutes),
        second=0,
        microsecond=0
    )
    
    while chunk_start < end_time:
        # Calculate dynamic chunk size
        current_chunk_size = chunk_size * current_multiplier
        chunk_end = min(chunk_start + current_chunk_size, end_time)
        
        try:
            # Check if any part of this chunk was already fetched
            progress = db.query(f"""
                SELECT * FROM fetch_progress 
                WHERE endpoint = '{endpoint_type.endpoint}'
                AND meeting_key = {meeting_key}
                AND session_key = {session_key}
                AND chunk_start >= '{chunk_start.isoformat()}'
                AND chunk_end <= '{chunk_end.isoformat()}'
                AND status = 'completed'
            """)
            
            if not progress.empty:
                chunk_start = chunk_end
                continue
            
            # Fetch data
            data = fetcher.fetch(
                endpoint_type, 
                params,
                start_time=chunk_start,
                end_time=chunk_end
            )
            
            
            # Adjust chunk size multiplier based on results
            if not data:
                current_multiplier = 3
            else:
                current_multiplier = 1
                
            # If we used a larger chunk size and got data, we need to mark all the sub-chunks as completed
            if current_multiplier > 1:
                sub_chunk_start = chunk_start
                while sub_chunk_start < chunk_end:
                    sub_chunk_end = min(sub_chunk_start + chunk_size, chunk_end)
                    db.insert_dataframe([{
                        "endpoint": endpoint_type.endpoint,
                        "meeting_key": meeting_key,
                        "session_key": session_key,
                        "chunk_start": sub_chunk_start,
                        "chunk_end": sub_chunk_end,
                        "status": "completed",
                        "created_at": datetime.now(timezone.utc)
                    }], "fetch_progress")
                    sub_chunk_start = sub_chunk_end
            else:
                # Mark the single chunk as completed
                db.insert_dataframe([{
                    "endpoint": endpoint_type.endpoint,
                    "meeting_key": meeting_key,
                    "session_key": session_key,
                    "chunk_start": chunk_start,
                    "chunk_end": chunk_end,
                    "status": "completed",
                    "created_at": datetime.now(timezone.utc)
                }], "fetch_progress")
            
            # Insert data if we got any
            if data: 
                db.insert_dataframe(data, endpoint_type.endpoint)
            
        except Exception as e:
            print(f"Error fetching chunk: {e}")
            db.insert_dataframe([{
                "endpoint": endpoint_type.endpoint,
                "meeting_key": meeting_key,
                "session_key": session_key,
                "chunk_start": chunk_start,
                "chunk_end": chunk_end,
                "status": "failed",
                "created_at": datetime.now(timezone.utc)
            }], "fetch_progress")
            time.sleep(2)
            current_multiplier = 1  # Reset multiplier on error
            
        chunk_start = chunk_end

def fetch_all_historical_data(fetcher: F1DataFetcher, db: QuestDBClient):
    # 1. Fetch all meetings
    meetings = fetcher.fetch(EndpointType.MEETINGS)
    print(f"Found {len(meetings)} meetings")
    
    for meeting in meetings:
        meeting_key = meeting["meeting_key"]
        print(f"\nProcessing meeting: {meeting['country_name']} {meeting['year']}")
        
        # 2. Fetch all sessions for this meeting
        sessions = fetcher.fetch(EndpointType.SESSIONS, {
            "meeting_key": meeting_key
        })
        print(f"Found {len(sessions)} sessions for this meeting")
        
        for session in sessions:
            session_key = session["session_key"]
            date_start = datetime.fromisoformat(session["date_start"].replace('Z', '+00:00'))
            date_end = datetime.fromisoformat(session["date_end"].replace('Z', '+00:00'))
            print(f"\nProcessing session: {session['session_name']} from {date_start} to {date_end}")
            
            # 3. Fetch data for each endpoint for this session
            for endpoint_type in EndpointType:
                print(f"\nFetching {endpoint_type.endpoint} data...")
                
                # Prepare parameters
                params = {}
                if "session_key" in endpoint_type.config["params"]:
                    params["session_key"] = session_key
                if "meeting_key" in endpoint_type.config["params"]:
                    params["meeting_key"] = meeting_key
                
                try:
                    # print(params.get('session_key'), params.get('meeting_key'))
                    # continue
                    fetch_data_in_chunks(
                        fetcher,
                        db,
                        endpoint_type,
                        params,
                        date_start,
                        date_end
                    )
                except Exception as e:
                    print(f"Error processing {endpoint_type.endpoint}: {e}")
                    continue

def main():
    db = QuestDBClient()
    fetcher = F1DataFetcher(db, START_TIME, IS_REAL_TIME)
    
    if DROP_ALL_TABLES_ON_START:
        if input("Are you sure you want to delete all data? (y/n): ") == "y":
            db.delete_data(recreate_schema=True)
    
    try:
        fetch_all_historical_data(fetcher, db)
    except Exception as e:
        print(f"Fatal error: {e}")

if __name__ == "__main__":
    main()