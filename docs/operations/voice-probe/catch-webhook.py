#!/usr/bin/env python3
"""Catch one LiveKit webhook and report its shape, never its secrets.

The gateway's webhook verification was written from the documentation. This
listens for a real delivery and answers the three questions that verification
depends on: how the token is carried, which claims it has, and whether the
`sha256` claim really is the hash of the body — and in which encoding.
"""
import base64
import hashlib
import http.server
import json
import sys

PORT = 9099
seen = 0


def b64pad(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


class Catch(http.server.BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802
        global seen
        length = int(self.headers.get("content-length", "0"))
        body = self.rfile.read(length)
        auth = self.headers.get("authorization", "")
        report = {
            "content_type": self.headers.get("content-type"),
            "auth_scheme": auth.split(" ", 1)[0] if " " in auth else ("raw-token" if auth else None),
            "body_bytes": len(body),
        }
        token = auth.split(" ", 1)[1] if " " in auth else auth
        if token.count(".") == 2:
            head, payload, _ = token.split(".")
            claims = json.loads(b64pad(payload))
            report["jwt_alg"] = json.loads(b64pad(head)).get("alg")
            report["claim_names"] = sorted(claims.keys())
            digest = hashlib.sha256(body).digest()
            report["sha256_matches_standard_b64"] = claims.get("sha256") == base64.b64encode(digest).decode()
            report["sha256_matches_urlsafe_b64"] = claims.get("sha256") == base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
            report["sha256_matches_hex"] = claims.get("sha256") == digest.hex()
        try:
            event = json.loads(body)
            report["event"] = event.get("event")
            report["event_id"] = str(event.get("id"))[:3] + "…" if event.get("id") else None
            report["top_level_keys"] = sorted(event.keys())
            if isinstance(event.get("room"), dict):
                report["room_keys"] = sorted(event["room"].keys())
            if isinstance(event.get("participant"), dict):
                report["participant_keys"] = sorted(event["participant"].keys())
                report["joined_at_type"] = type(event["participant"].get("joinedAt", event["participant"].get("joined_at"))).__name__
        except Exception as err:  # noqa: BLE001
            report["body_parse_error"] = str(err)

        print(json.dumps(report), flush=True)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")
        seen += 1
        if seen >= 4:
            sys.exit(0)

    def log_message(self, *_args):
        return


# 0.0.0.0, because the deliverer is a container and the host is a
# different address to it — 127.0.0.1 here catches nothing at all.
http.server.HTTPServer(("0.0.0.0", PORT), Catch).serve_forever()
