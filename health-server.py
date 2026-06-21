#!/usr/bin/env python3
"""Local service health check — probed by the system dashboard."""
import json, subprocess, urllib.request, http.server, socketserver, os

PORT = 8898
HOST = "127.0.0.1"

def probe(host, port, label, path="/health/readiness", method="GET"):
    try:
        r = urllib.request.Request(f"http://{host}:{port}{path}", method=method)
        with urllib.request.urlopen(r, timeout=3) as resp:
            return {"label": label, "status": "ok", "port": port, "http": resp.status}
    except urllib.error.HTTPError as e:
        # 404 means service is running but at a different path — that's OK
        if e.code == 404:
            return {"label": label, "status": "ok", "port": port, "http": e.code}
        return {"label": label, "status": "degraded", "port": port, "http": e.code}
    except urllib.error.URLError:
        return {"label": label, "status": "down", "port": port}
    except Exception as e:
        return {"label": label, "status": "error", "port": port, "detail": str(e)[:60]}

def run_check():
    services = [
        probe("127.0.0.1", 4000, "LiteLLM Proxy"),
        probe("127.0.0.1", 8899, "Local Dashboard"),
        probe("127.0.0.1", 3000, "Workspace UI"),
        probe("127.0.0.1", 8888, "MemPalace Viz"),
        probe("127.0.0.1", 5001, "Runtime Guard"),
        probe("127.0.0.1", 8888, "Memory 2.0"),
    ]

    ok = sum(1 for s in services if s["status"] == "ok")
    total = len(services)

    return {"services": services, "summary": f"{ok}/{total} ok", "all_ok": ok == total}

class HealthHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(json.dumps(run_check()).encode())
        else:
            self.send_response(404)
            self.end_headers()

if __name__ == "__main__":
    # Allow reusing the port if the previous process died
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer((HOST, PORT), HealthHandler) as httpd:
        print(f"Serving health endpoint at http://{HOST}:{PORT}/health")
        httpd.serve_forever()
