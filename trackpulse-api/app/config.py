from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

# Load environment variables
class Settings(BaseSettings):
  qdb_client_conf: str
  qdb_database_url: str
  model_config = SettingsConfigDict(env_file=".env")

# Cache settings
@lru_cache()
def get_settings() -> Settings:
  return Settings()
settings = get_settings()