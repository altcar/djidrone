#!/usr/bin/env python3
"""Set or change the gallery password (password-only gate, no username).

Usage:
  python3 tools/set_password.py                 # prompts twice (hidden)
  GATE_PASSWORD='...' python3 tools/set_password.py   # non-interactive

Only a random salt + PBKDF2-SHA256 hash is written to auth.json. The password
itself is never stored.
"""
import getpass
import hashlib
import json
import os
import secrets
from pathlib import Path

ITERATIONS = 310_000
OUT = Path(__file__).resolve().parent.parent / "auth.json"

pw = os.environ.get("GATE_PASSWORD")
if pw is None:
    pw = getpass.getpass("New gallery password: ")
    again = getpass.getpass("Repeat password: ")
    if pw != again:
        raise SystemExit("Passwords do not match.")
if not pw:
    raise SystemExit("Password must not be empty.")

salt = secrets.token_bytes(16)
digest = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, ITERATIONS, dklen=32)
OUT.write_text(json.dumps({
    "salt": salt.hex(),
    "hash": digest.hex(),
    "iterations": ITERATIONS,
    "algorithm": "PBKDF2-SHA256",
}, indent=2) + "\n")
print(f"Updated {OUT} (salt + hash only; password not stored).")
