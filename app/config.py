from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    clockify_api_key: str = ""
    clockify_api_base: str = "https://api.clockify.me/api/v1"
    clockify_reports_base: str = "https://reports.api.clockify.me/v1"
    default_timezone: str = "Asia/Karachi"
    output_dir: str = "./output"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def output_path(self) -> Path:
        path = Path(self.output_dir)
        path.mkdir(parents=True, exist_ok=True)
        return path


settings = Settings()
