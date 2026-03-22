#!/usr/bin/env python3
"""Fetch Sowel logs via API."""
import urllib.request
import json
import sys

import os

BASE = os.environ.get("SOWEL_URL", "http://localhost:3000")
PASSWORD = os.environ.get("SOWEL_PASSWORD", "")
if not PASSWORD:
    PASSWORD = input("Password: ")

# Login
data = json.dumps({"username": "admin", "password": PASSWORD}).encode()
req = urllib.request.Request(f"{BASE}/api/v1/auth/login", data=data, headers={"Content-Type": "application/json"})
resp = urllib.request.urlopen(req)
token = json.loads(resp.read())["accessToken"]

# Get logs
module = sys.argv[1] if len(sys.argv) > 1 else "netatmo-poller"
level = sys.argv[2] if len(sys.argv) > 2 else "debug"
limit = sys.argv[3] if len(sys.argv) > 3 else "50"

url = f"{BASE}/api/v1/logs?module={module}&limit={limit}&level={level}"
req2 = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
resp2 = urllib.request.urlopen(req2)
result = json.loads(resp2.read())

entries = result.get("entries", result) if isinstance(result, dict) else result
if isinstance(entries, list):
    for entry in entries:
        if isinstance(entry, dict):
            ts = entry.get("time", "")
            msg = entry.get("msg", "")
            extra = {k: v for k, v in entry.items() if k not in ("msg", "time", "level", "module", "pid", "hostname", "v", "name")}
            extra_str = f"  {json.dumps(extra)}" if extra else ""
            print(f"{ts}  {msg}{extra_str}")
else:
    print(json.dumps(result, indent=2))
