from __future__ import annotations

import json
from pathlib import Path
from typing import Any


DEFAULT_PROFILE: dict[str, Any] = {
    "sheet": "Timesheet",
    "data_start_row": 8,
    "style_source_row": 8,
    "columns": {
        "date": "A",
        "project": "B",
        "description": "C",
        "start": "D",
        "end": "E",
        "duration": "F"
    },
    "metadata": {
        "employee_name": "B2",
        "project_name": "B3",
        "period": "B4",
        "total_hours": "F5"
    },
    "formats": {
        "date": "dd-mmm-yyyy",
        "time": "h:mm AM/PM",
        "duration": "[h]:mm"
    }
}


def load_profile(path: str | Path | None = None) -> dict[str, Any]:
    if not path:
        return DEFAULT_PROFILE.copy()
    with open(path, "r", encoding="utf-8") as handle:
        profile = json.load(handle)
    return profile
