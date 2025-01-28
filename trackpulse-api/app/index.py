from functools import lru_cache
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


from app.api import drivers

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(drivers.router)
