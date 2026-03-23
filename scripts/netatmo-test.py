#!/usr/bin/env python3
"""Test Netatmo Security API — list all homes and modules."""

import urllib.request
import urllib.parse
import json

CLIENT_ID = "69becd39a70204a9e90cdd25"
CLIENT_SECRET = "hnztWoYmxOk1C3AcpLAAzErTLyg482zyGBH2n3k"
REFRESH_TOKEN = "65dc92820d3a4f29b00e1cbb|ea8d62187a5b316ba31fd873723c202d"

# Get fresh access token
data = urllib.parse.urlencode({
    "grant_type": "refresh_token",
    "client_id": CLIENT_ID,
    "client_secret": CLIENT_SECRET,
    "refresh_token": REFRESH_TOKEN,
}).encode()
req = urllib.request.Request("https://api.netatmo.com/oauth2/token", data=data)
with urllib.request.urlopen(req) as r:
    tok = json.loads(r.read())
access = tok["access_token"]

# Get home status
home_id = "6630b5147c26bd193f042524"
status_data = urllib.parse.urlencode({"home_id": home_id}).encode()
req2 = urllib.request.Request(
    "https://api.netatmo.com/api/homestatus",
    data=status_data,
    headers={"Authorization": f"Bearer {access}"},
)
with urllib.request.urlopen(req2) as r:
    d = json.loads(r.read())

print(json.dumps(d, indent=2, ensure_ascii=False))
