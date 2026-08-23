"""The failure record: the files the pipeline set aside because it could not read them.

A set-aside file leaves no other trace — it never reaches the manifest and it is
out of the inbox, so no later build rediscovers it. This is the only account of
what happened, and the only thing the site can report from.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Failure:
    """One file that could not be read, and what went wrong with it."""

    name: str
    reason: str

    def to_json(self) -> dict:
        return {"name": self.name, "reason": self.reason}

    @classmethod
    def from_json(cls, payload: dict) -> "Failure":
        return cls(name=payload["name"], reason=payload.get("reason", ""))


def reconcile(records: list[Failure], quarantine: Path) -> list[Failure]:
    """Drop records whose file is no longer set aside.

    Deleting the file from the repository is how the owner dismisses the report.
    """
    present = {path.name for path in quarantine.iterdir()} if quarantine.exists() else set()
    return [record for record in records if record.name in present]


def load(path: Path) -> list[Failure]:
    if not path.exists():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    return [Failure.from_json(item) for item in payload.get("failed", [])]


def save(path: Path, records: list[Failure]) -> None:
    """Write the record — or remove it, so a build with nothing wrong reports nothing."""
    if not records:
        path.unlink(missing_ok=True)
        return

    payload = {
        "generated": "by the Grace pipeline — delete the file from photos/failed/ to clear it",
        "failed": [record.to_json() for record in sorted(records, key=lambda r: r.name)],
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
