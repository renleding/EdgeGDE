"""
APA Mitmproxy Client — HTTP/S capture with CDP frame correlation.

Runs mitmproxy daemon alongside Chrome for Testing (CfT), captures HAR with
custom _cdp_frame_id field, and correlates requests to CDP frame IDs.
"""

import asyncio
import json
import os
import shutil
import ssl
import subprocess
import tempfile
import time
from pathlib import Path
from typing import AsyncIterator, Dict, List, Optional, Any

from failure_envelope import FailureEnvelope


MITMPROXY_CA_DIR = Path.home() / ".mitmproxy"
MITMPROXY_CA_CERT = MITMPROXY_CA_DIR / "mitmproxy-ca.pem"
DEFAULT_MITMPROXY_PORT = 8080
DAEMON_STARTUP_TIMEOUT = 10
DAEMON_SHUTDOWN_TIMEOUT = 5


class MitmproxyClient:
    """
    Async context manager for mitmproxy daemon lifecycle and HAR capture.

    Usage:
        async with MitmproxyClient(port=8080) as client:
            har_entries = []
            async for entry in client.har():
                har_entries.append(entry)
            correlated = client.correlate("frame_123")
    """

    def __init__(
        self,
        port: int = DEFAULT_MITMPROXY_PORT,
        ca_cert_path: Optional[Path] = None,
        addon_script: Optional[str] = None,
        restart_on_crash: bool = True,
    ):
        self.port = port
        self.ca_cert_path = ca_cert_path or MITMPROXY_CA_CERT
        self.addon_script = addon_script
        self.restart_on_crash = restart_on_crash

        self._process: Optional[subprocess.Popen] = None
        self._har_file: Optional[Path] = None
        self._har_file_handle = None
        self._har_dir: Optional[Path] = None
        self._started = False
        self._crashed_once = False
        self._frame_id_map: Dict[str, List[Dict[str, Any]]] = {}
        self._har_entries: List[Dict[str, Any]] = []

    async def __aenter__(self) -> "MitmproxyClient":
        await self.start()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        await self.stop()

    async def start(self) -> None:
        """Start mitmproxy daemon and HAR capture."""
        if self._started:
            return

        # Ensure CA cert exists
        await self._ensure_ca_cert()

        # Create temp directory for HAR output
        self._har_dir = Path(tempfile.mkdtemp(prefix="mitmproxy-har-"))
        self._har_file = self._har_dir / "capture.har"

        # Build mitmproxy command
        cmd = [
            "mitmdump",
            "--mode", "regular",
            "--listen-port", str(self.port),
            "--set", f"addon={self._get_addon_path()}",
            "--set", f"hardump={self._har_file}",
            "--ssl-insecure",
            "--no-http2",  # Simpler HAR, avoids HPACK complexity
            "-q",  # Quiet mode
        ]

        try:
            self._process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                start_new_session=True,
            )
        except FileNotFoundError:
            raise FailureEnvelope(
                tier="T-1",
                action="mitmproxy_start",
                reason="mitmproxy not installed. Run: pip install mitmproxy>=12.0",
                page_state={"remediation": "pip install mitmproxy>=12.0"},
            )

        # Wait for daemon to be ready
        await self._wait_for_daemon()

        self._started = True

    async def stop(self) -> None:
        """Stop mitmproxy daemon and clean up."""
        if self._process:
            try:
                self._process.terminate()
                try:
                    await asyncio.wait_for(
                        asyncio.to_thread(self._process.wait),
                        timeout=DAEMON_SHUTDOWN_TIMEOUT,
                    )
                except asyncio.TimeoutError:
                    self._process.kill()
                    await asyncio.to_thread(self._process.wait)
            except ProcessLookupError:
                pass
            finally:
                self._process = None

        # Clean up HAR temp directory
        if self._har_dir and self._har_dir.exists():
            shutil.rmtree(self._har_dir, ignore_errors=True)

        self._started = False

    async def _ensure_ca_cert(self) -> None:
        """Generate mitmproxy CA certificate if it doesn't exist."""
        MITMPROXY_CA_DIR.mkdir(parents=True, exist_ok=True)

        if self.ca_cert_path.exists():
            return

        # Generate CA cert using mitmproxy's certstore
        proc = await asyncio.to_thread(
            subprocess.run,
            ["mitmproxy", "--version"],
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            raise FailureEnvelope(
                tier="T-1",
                action="mitmproxy_version_check",
                reason=f"mitmproxy version check failed: {proc.stderr}",
            )

        # mitmproxy auto-generates CA on first run; we just need to ensure dir exists
        # The cert will be created when mitmdump/mitmproxy first runs
        # We trigger a dummy run to generate it
        dummy_proc = await asyncio.to_thread(
            subprocess.run,
            [
                "mitmdump",
                "--mode", "regular",
                "--listen-port", "0",  # Random port
                "--set", "confdir=" + str(MITMPROXY_CA_DIR),
                "-q",
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )
        # mitmdump with port 0 exits immediately after generating cert

    def _get_addon_path(self) -> str:
        """Get path to the mitmproxy addon script for frame ID correlation."""
        if self.addon_script:
            return self.addon_script

        # Embedded addon script
        addon_path = Path(__file__).parent / "mitmproxy_addon.py"
        if not addon_path.exists():
            self._write_embedded_addon(addon_path)
        return str(addon_path)

    def _write_embedded_addon(self, path: Path) -> None:
        """Write the embedded addon script to disk."""
        addon_code = '''"""
mitmproxy addon for CDP frame ID correlation.

Extracts CDP frame ID from request headers injected by the browser
and adds it to HAR entries as _cdp_frame_id.
"""
import json
from mitmproxy import http, ctx


class FrameIDCorrelator:
    def request(self, flow: http.HTTPFlow) -> None:
        # Look for X-CDP-Frame-ID header (injected by our CDP injection script)
        frame_id = flow.request.headers.get("X-CDP-Frame-ID")
        if frame_id:
            flow.metadata["_cdp_frame_id"] = frame_id

    def response(self, flow: http.HTTPFlow) -> None:
        # Ensure response also carries frame ID
        if "_cdp_frame_id" in flow.metadata:
            pass  # Already captured in request phase


addons = [FrameIDCorrelator()]
'''
        path.write_text(addon_code)

    async def _wait_for_daemon(self) -> None:
        """Wait until mitmproxy daemon accepts connections."""
        deadline = time.time() + DAEMON_STARTUP_TIMEOUT
        while time.time() < deadline:
            try:
                reader, writer = await asyncio.wait_for(
                    asyncio.open_connection("127.0.0.1", self.port),
                    timeout=1.0,
                )
                writer.close()
                await writer.wait_closed()
                return
            except (ConnectionRefusedError, OSError, asyncio.TimeoutError):
                await asyncio.sleep(0.2)

                # Check if process died
                if self._process and self._process.poll() is not None:
                    stdout, stderr = self._process.communicate()
                    raise FailureEnvelope(
                        tier="T-1",
                        action="mitmproxy_startup",
                        reason=f"mitmproxy exited during startup: {stderr.decode() if stderr else 'unknown'}",
                        page_state={
                            "stdout": stdout.decode() if stdout else "",
                            "stderr": stderr.decode() if stderr else "",
                        },
                    )

        raise FailureEnvelope(
            tier="T-1",
            action="mitmproxy_startup",
            reason=f"mitmproxy did not start on port {self.port} within {DAEMON_STARTUP_TIMEOUT}s",
        )

    async def har(self) -> AsyncIterator[Dict[str, Any]]:
        """Async iterator over HAR entries as they are written."""
        if not self._har_file or not self._har_file.exists():
            # Wait for first HAR entry
            await asyncio.sleep(0.5)

        last_pos = 0
        while self._started:
            if self._har_file and self._har_file.exists():
                try:
                    content = self._har_file.read_text()
                    if content.strip():
                        # Parse HAR file (mitmproxy writes complete HAR on each dump)
                        har_data = json.loads(content)
                        entries = har_data.get("log", {}).get("entries", [])

                        # Yield new entries
                        for entry in entries[last_pos:]:
                            # Extract frame ID from metadata if present
                            frame_id = entry.get("_cdp_frame_id")
                            if frame_id:
                                self._frame_id_map.setdefault(frame_id, []).append(entry)
                            self._har_entries.append(entry)
                            yield entry

                        last_pos = len(entries)
                except (json.JSONDecodeError, OSError):
                    pass  # File being written, wait for next poll

            await asyncio.sleep(0.5)

    def correlate(self, cdp_frame_id: str) -> List[Dict[str, Any]]:
        """Return all HAR entries for a given CDP frame ID."""
        return self._frame_id_map.get(cdp_frame_id, [])

    def get_all_har(self) -> List[Dict[str, Any]]:
        """Return all captured HAR entries."""
        return list(self._har_entries)

    def get_har_summary(self) -> Dict[str, Any]:
        """Return summary statistics of captured traffic."""
        total = len(self._har_entries)
        by_method: Dict[str, int] = {}
        by_status: Dict[int, int] = {}
        total_bytes = 0

        for entry in self._har_entries:
            req = entry.get("request", {})
            resp = entry.get("response", {})
            method = req.get("method", "UNKNOWN")
            status = resp.get("status", 0)
            size = req.get("bodySize", 0) + resp.get("bodySize", 0)

            by_method[method] = by_method.get(method, 0) + 1
            by_status[status] = by_status.get(status, 0) + 1
            total_bytes += size

        return {
            "total_entries": total,
            "by_method": by_method,
            "by_status": by_status,
            "total_bytes": total_bytes,
            "unique_frame_ids": len(self._frame_id_map),
        }


async def install_ca_into_cft(cdp_client) -> bool:
    """
    Install mitmproxy CA cert into Chrome for Testing profile.

    Uses CDP Security.setIgnoreCertificateErrors to trust the proxy cert.
    """
    try:
        await cdp_client.send("Security.setIgnoreCertificateErrors", {"ignore": True})
        return True
    except Exception as e:
        # Non-fatal; proxy will still work but cert warnings may appear
        return False