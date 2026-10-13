"""
mitmproxy addon for CDP frame ID correlation + live HAR streaming.

Extracts CDP frame ID from request headers injected by the browser,
adds it to HAR entries as _cdp_frame_id, and streams each completed
entry to a JSONL file for live consumption by the State Engine.
"""
import json
import os
from mitmproxy import http, ctx


class FrameIDCorrelator:
    def __init__(self):
        self.stream_path = os.environ.get("MITM_STREAM_PATH", "")
        self._f = None

    def _ensure_stream(self):
        if self.stream_path and self._f is None:
            try:
                self._f = open(self.stream_path, "a", buffering=1)
            except OSError:
                self._f = None

    def _emit(self, flow: http.HTTPFlow, event: str):
        self._ensure_stream()
        if not self._f:
            return
        entry = {
            "event": event,
            "request": {
                "method": flow.request.method,
                "url": flow.request.url,
                "headers": dict(flow.request.headers),
                "bodySize": len(flow.request.content) if flow.request.content else 0,
            },
            "_cdp_frame_id": flow.metadata.get("_cdp_frame_id"),
            "timestamp": flow.request.timestamp_start,
        }
        if flow.response:
            entry["response"] = {
                "status_code": flow.response.status_code,
                "bodySize": len(flow.response.content) if flow.response.content else 0,
            }
        try:
            self._f.write(json.dumps(entry) + "\n")
        except OSError:
            pass

    def request(self, flow: http.HTTPFlow) -> None:
        # Look for X-CDP-Frame-ID header (injected by our CDP injection script)
        frame_id = flow.request.headers.get("X-CDP-Frame-ID")
        if frame_id:
            flow.metadata["_cdp_frame_id"] = frame_id

    def response(self, flow: http.HTTPFlow) -> None:
        # Emit completed entry to live stream
        self._emit(flow, "response")


addons = [FrameIDCorrelator()]
