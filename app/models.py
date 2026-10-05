from datetime import datetime
from pydantic import BaseModel, Field


class NormalizedTimeEntry(BaseModel):
    id: str = ""
    user_name: str = ""
    project_name: str = ""
    task_name: str = ""
    description: str = ""
    start: datetime
    end: datetime
    duration_seconds: int = Field(ge=0)


class ValidationResult(BaseModel):
    valid: bool
    source_seconds: int
    generated_seconds: int
    difference_seconds: int
    entry_count: int
