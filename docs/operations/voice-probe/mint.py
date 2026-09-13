#!/usr/bin/env python3
"""Mint a LiveKit access token on the server, so no secret ever leaves it.

Slice 1 has no gateway yet — that is slice 2 — so the token is made here, by
hand, from the key pair in `livekit.env`. HS256 is a header, a payload and an
HMAC; there is no library on this host and adding one to answer a transport
question would be the wrong kind of thrift.

Usage: mint.py <identity> <room> [--create]
Prints the token and nothing else, so the caller can redirect it to a file.
"""
import base64
import hashlib
import hmac
import json
import sys
import time


def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def read_keys(path: str):
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            if line.startswith("LIVEKIT_KEYS="):
                value = line.split("=", 1)[1].strip()
                key, secret = value.split(":", 1)
                return key.strip(), secret.strip()
    raise SystemExit("no LIVEKIT_KEYS in the env file")


def mint(identity: str, room: str, create: bool) -> str:
    key, secret = read_keys("/srv/letscube/voice-probe/livekit.env")
    now = int(time.time())
    grants = {
        "room": room,
        "roomJoin": True,
        "canPublish": True,
        "canSubscribe": True,
    }
    if create:
        grants["roomCreate"] = True
        grants["roomAdmin"] = True
        grants["roomList"] = True
    payload = {
        "iss": key,
        "sub": identity,
        "name": identity,
        "nbf": now - 10,
        "exp": now + 3600,
        "video": grants,
    }
    header = {"alg": "HS256", "typ": "JWT"}
    signing_input = (
        b64(json.dumps(header, separators=(",", ":")).encode())
        + "."
        + b64(json.dumps(payload, separators=(",", ":")).encode())
    )
    signature = hmac.new(secret.encode(), signing_input.encode(), hashlib.sha256).digest()
    return signing_input + "." + b64(signature)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit("usage: mint.py <identity> <room> [--create]")
    print(mint(sys.argv[1], sys.argv[2], "--create" in sys.argv))
