"""Start a real local development server, check HTTP routes, then stop it."""
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    root = Path(__file__).resolve().parent.parent
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    origin = f"http://127.0.0.1:{port}"
    opener = urllib.request.build_opener(NoRedirect)
    with tempfile.TemporaryFile() as log:
        server = subprocess.Popen(
            [sys.executable, "manage.py", "runserver", f"127.0.0.1:{port}", "--noreload"],
            cwd=root, stdout=log, stderr=log,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        try:
            for _ in range(50):
                try:
                    with opener.open(origin + "/login/", timeout=1):
                        break
                except (urllib.error.URLError, TimeoutError):
                    if server.poll() is not None:
                        raise RuntimeError("Server exited before startup")
                    time.sleep(.1)
            else:
                raise RuntimeError("Server startup timed out")
            for path, expected in [("/", 302), ("/login/", 200), ("/admin/", 302), ("/static/css/site.css", 200), ("/logout/", 405)]:
                try:
                    response = opener.open(origin + path, timeout=3)
                except urllib.error.HTTPError as error:
                    response = error
                with response:
                    status = response.code
                    body = response.read().decode("utf-8")
                    if status != expected:
                        raise AssertionError(f"{path}: expected {expected}, got {status}")
                    if path == "/login/" and ("csrfmiddlewaretoken" not in body or "登录爱管理" not in body):
                        raise AssertionError("Login template or CSRF token missing")
                    print(f"GET {path}: {status} (expected {expected})")
            print("Real runserver HTTP smoke: PASS")
        finally:
            server.terminate()
            server.wait(timeout=10)
            log.seek(0)
            print(log.read().decode("utf-8", errors="replace").rstrip())


if __name__ == "__main__":
    main()
