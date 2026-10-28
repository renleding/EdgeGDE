#!/usr/bin/env python3
"""IDD-016 resolver transport adapter — serves the REAL OrcaResolver.

Replicates apps/state-engine/main.py's HTTP semantics around the OrcaResolver
class (work/orca-resolver-fastpath @ f3513f4):

  POST /mcp                        — MCP streamable frame: JSON-RPC tools/call
                                     with mcp_resolve_element; the contract
                                     envelope rides content[0].text (§5.1)
  POST /api/v1/resolver/resolve    — byte-identical direct call; requires
                                     X-Orca-Bridge-Version: 1.0.0 (§5.2);
                                     HTTP status from the 9-code registry
  GET  /healthz                    — readiness probe

Why an adapter: the full StateEngineMCP process (main.py) boots
mitmproxy/evidence/observer daemons and imports mcp.server.mcpserver, which
is broken in this environment. The resolver CLASS is the contract-relevant
half (fast path confidence 1.0, structural fallback, known-bug flags,
idempotency, error registry) — this adapter serves exactly that.

Target pinning (§6.1): OrcaResolver._ensure_attached probes Target.getTargets
over its CDP connection. The caller (demo harness) creates the tab and vouches
for it; --pin-target pre-seeds the pin set so the advisory check passes
without depending on browser-level Target commands from a page-level ws.

Usage:
  python3 resolver_transport_adapter.py --port 9110 \
      --page-ws ws://127.0.0.1:9333/devtools/page/... \
      --state-engine-dir /path/to/apps/state-engine [--pin-target <id>]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path

logger = logging.getLogger("orca.resolver-adapter")

# error-codes.json HTTP status mapping (IDD-016 §10.1)
HTTP_STATUS = {
    "STALE_NODE": 409,
    "ELEMENT_NOT_RESOLVABLE": 422,
    "RESOLVER_TIMEOUT": 504,
    "ACTION_REJECTED": 422,
    "INVALID_REQUEST": 400,
    "UNSUPPORTED_SCHEMA_VERSION": 400,
    "TARGET_NOT_ATTACHED": 409,
    "INTERNAL_ERROR": 500,
}

UNSUPPORTED_VERSION_ENVELOPE = {
    "schema_version": "1.0.0",
    "request_id": "unknown",
    "resolved_at": "",
    "error": {
        "code": "UNSUPPORTED_SCHEMA_VERSION",
        "message": "X-Orca-Bridge-Version header must be 1.0.0",
        "retryable": False,
        "retry_policy": "none",
        "details": {},
        "known_bug_flags": [],
    },
    "warnings": [],
}


def make_app(resolver, extra_log=None):
    """Build the raw-ASGI app around a live OrcaResolver instance."""

    async def read_body(receive) -> bytes:
        body = b""
        while True:
            msg = await receive()
            body += msg.get("body", b"")
            if not msg.get("more_body"):
                break
        return body

    async def resolve_envelope(request: dict) -> tuple[dict, int]:
        response = await resolver.resolve(request)
        envelope = json.loads(response.to_json())
        err = envelope.get("error")
        status = HTTP_STATUS.get(err.get("code"), 500) if err else 200
        return envelope, status

    async def respond(send, status: int, payload: dict):
        data = json.dumps(payload).encode("utf-8")
        await send({
            "type": "http.response.start",
            "status": status,
            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(data)).encode())],
        })
        await send({"type": "http.response.body", "body": data})

    async def app(scope, receive, send):
        if scope["type"] != "http":
            return
        path = scope.get("path", "")
        method = scope.get("method", "GET")
        body = await read_body(receive)

        if path == "/healthz":
            await respond(send, 200, {"ok": True, "resolver": "orca"})
            return

        if path == "/api/v1/resolver/resolve" and method == "POST":
            headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
            if headers.get("x-orca-bridge-version") != "1.0.0":
                await respond(send, 400, UNSUPPORTED_VERSION_ENVELOPE)
                return
            try:
                request = json.loads(body)
            except json.JSONDecodeError:
                await respond(send, 400, {"error": "INVALID_REQUEST_BODY"})
                return
            envelope, status = await resolve_envelope(request)
            if extra_log:
                extra_log("http_fallback", request, envelope)
            await respond(send, status, envelope)
            return

        if path == "/mcp" and method == "POST":
            try:
                frame = json.loads(body)
                request = frame["params"]["arguments"]
                request_id = frame.get("id", 1)
            except (json.JSONDecodeError, KeyError, TypeError):
                await respond(send, 400, {"error": "INVALID_JSON_RPC_FRAME"})
                return
            envelope, _status = await resolve_envelope(request)
            if extra_log:
                extra_log("mcp", request, envelope)
            result_frame = {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {"content": [{"type": "text", "text": json.dumps(envelope)}]},
            }
            await respond(send, 200, result_frame)
            return

        await respond(send, 404, {"error": "NOT_FOUND"})

    return app


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="IDD-016 resolver transport adapter (real OrcaResolver)")
    p.add_argument("--port", type=int, default=9110)
    p.add_argument("--page-ws", required=True, help="Page-level CDP ws URL of the pinned tab")
    p.add_argument("--state-engine-dir", required=True, help="apps/state-engine dir exporting OrcaResolver (fastpath worktree)")
    p.add_argument("--pin-target", default="", help="Target id to pre-seed into the resolver's pin set")
    p.add_argument("--host", default="127.0.0.1")
    args = p.parse_args(argv)

    se = Path(args.state_engine_dir).resolve()
    if str(se) not in sys.path:
        sys.path.insert(0, str(se))

    from cdp_connection import CdpConnection  # noqa: E402
    from resolver import OrcaResolver  # noqa: E402

    import uvicorn

    async def start():
        cdp = CdpConnection(args.page_ws)
        await cdp.connect()
        resolver = OrcaResolver(cdp)
        if args.pin_target:
            resolver._attached_targets.add(args.pin_target)
            logger.info("target %s pre-pinned (caller vouches for the tab it created)", args.pin_target)

        def _log(transport, request, envelope):
            err = envelope.get("error")
            logger.info(
                "resolve transport=%s request_id=%s confidence=%s code=%s",
                transport,
                request.get("request_id"),
                (envelope.get("resolution") or {}).get("confidence"),
                (err or {}).get("code", "none"),
            )

        config = uvicorn.Config(make_app(resolver, extra_log=_log), host=args.host, port=args.port, log_level="warning")
        server = uvicorn.Server(config)
        await server.serve()

    logging.basicConfig(level=logging.INFO)
    logger.info("resolver transport adapter on http://%s:%d (page-ws %s)", args.host, args.port, args.page_ws[:60])
    asyncio.run(start())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
