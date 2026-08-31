#!/usr/bin/env python3
"""Fail-closed helpers for the isolated Supabase restore rehearsal."""

from __future__ import annotations

import os
import re
import sys
import tarfile
from pathlib import Path, PurePosixPath


ROLE_NAME = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")
CREATE_ROLE = re.compile(r"^CREATE ROLE ([a-z_][a-z0-9_]{0,62});$")
PASSWORD_MATERIAL = re.compile(r"password|scram-sha|md5[0-9a-f]{20,}", re.IGNORECASE)


class SafetyError(Exception):
    pass


def _private_write(path: Path, content: str) -> None:
    if path.exists():
        raise SafetyError
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as output:
            output.write(content)
    except Exception:
        path.unlink(missing_ok=True)
        raise


def _safe_member_name(value: str) -> str:
    if not value or "\\" in value or "\x00" in value:
        raise SafetyError
    trimmed = value[:-1] if value.endswith("/") else value
    if not trimmed or trimmed.startswith("/"):
        raise SafetyError
    raw_parts = trimmed.split("/")
    if any(part in ("", ".", "..") for part in raw_parts):
        raise SafetyError
    parsed = PurePosixPath(trimmed)
    if parsed.is_absolute() or tuple(parsed.parts) != tuple(raw_parts):
        raise SafetyError
    if raw_parts[0] != "storage":
        raise SafetyError
    return "/".join(raw_parts)


def extract_storage(archive_path: Path, destination: Path) -> None:
    if not archive_path.is_file() or not destination.is_dir():
        raise SafetyError

    destination_entries = list(destination.iterdir())
    if destination_entries:
        if len(destination_entries) != 1:
            raise SafetyError
        storage_root = destination_entries[0]
        if storage_root.name != "storage" or not storage_root.is_dir():
            raise SafetyError
        if any(storage_root.iterdir()):
            raise SafetyError

    with tarfile.open(archive_path, mode="r:gz") as archive:
        members = archive.getmembers()
        if not members:
            raise SafetyError

        normalized: dict[str, tarfile.TarInfo] = {}
        root_entries = 0
        for member in members:
            name = _safe_member_name(member.name)
            if name in normalized:
                raise SafetyError
            normalized[name] = member
            if name == "storage":
                root_entries += 1
                if not member.isdir():
                    raise SafetyError
            elif not (member.isdir() or member.isfile() or member.islnk()):
                raise SafetyError

        if root_entries != 1:
            raise SafetyError

        for name, member in normalized.items():
            if not member.islnk():
                continue
            target = _safe_member_name(member.linkname)
            if target == "storage" or target == name or target not in normalized:
                raise SafetyError
            if normalized[target].isdir():
                raise SafetyError

        archive.extractall(path=destination, members=members, filter="data")


def filter_roles(source: Path, existing_path: Path, output: Path) -> None:
    source_text = source.read_text(encoding="utf-8")
    if PASSWORD_MATERIAL.search(source_text):
        raise SafetyError

    existing = {
        line.strip()
        for line in existing_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    }
    if any(not ROLE_NAME.fullmatch(role) for role in existing):
        raise SafetyError

    source_roles: set[str] = set()
    output_lines: list[str] = []
    for line in source_text.splitlines(keepends=True):
        plain_line = line.rstrip("\r\n")
        if plain_line.startswith("CREATE ROLE "):
            match = CREATE_ROLE.fullmatch(plain_line)
            if not match or match.group(1) in source_roles:
                raise SafetyError
            role = match.group(1)
            source_roles.add(role)
            if role in existing:
                continue
        output_lines.append(line.replace("\r\n", "\n"))

    if not source_roles or not existing.issubset(source_roles):
        raise SafetyError
    _private_write(output, "".join(output_lines))


def canonicalize_roles(source: Path, output: Path) -> None:
    source_text = source.read_text(encoding="utf-8")
    if PASSWORD_MATERIAL.search(source_text):
        raise SafetyError

    retained: list[str] = []
    for line in source_text.splitlines():
        if not line or line.startswith("--"):
            continue
        if line.startswith("\\restrict ") or line.startswith("\\unrestrict "):
            continue
        retained.append(line)
    if not retained:
        raise SafetyError
    _private_write(output, "\n".join(retained) + "\n")


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        raise SafetyError
    command = argv[1]
    if command == "extract-storage" and len(argv) == 4:
        extract_storage(Path(argv[2]), Path(argv[3]))
    elif command == "filter-roles" and len(argv) == 5:
        filter_roles(Path(argv[2]), Path(argv[3]), Path(argv[4]))
    elif command == "canonicalize-roles" and len(argv) == 4:
        canonicalize_roles(Path(argv[2]), Path(argv[3]))
    else:
        raise SafetyError
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv))
    except (OSError, SafetyError, tarfile.TarError, UnicodeError, ValueError):
        print("restore safety check failed", file=sys.stderr)
        raise SystemExit(1)
