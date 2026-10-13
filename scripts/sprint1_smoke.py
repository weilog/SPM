"""Real HTTP Sprint 1 walkthrough on a disposable SQLite database."""
import http.cookiejar
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Browser:
    def __init__(self, origin):
        self.origin = origin
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies), NoRedirect())

    def request(self, path, expected=200, data=None):
        headers = {}
        if data is not None:
            token = next((cookie.value for cookie in self.cookies if cookie.name == "csrftoken"), "")
            headers["X-CSRFToken"] = token
            data = urllib.parse.urlencode(data).encode()
        request = urllib.request.Request(self.origin + path, data=data, headers=headers)
        try:
            response = self.opener.open(request, timeout=5)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            if response.code != expected:
                raise AssertionError(f"{path}: expected {expected}, got {response.code}")
            body = response.read().decode("utf-8")
            location = response.headers.get("Location")
            print(f"{'POST' if data is not None else 'GET'} {path}: {response.code}")
            return body, location

    def login(self, username, password):
        self.request("/login/")
        self.request("/login/", 302, {"username": username, "password": password})


def ensure(condition, message):
    if not condition:
        raise AssertionError(message)


def main():
    # Server tracebacks include Chinese permission messages on Windows.
    os.environ["PYTHONUTF8"] = "1"
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    root = Path(__file__).resolve().parent.parent
    with tempfile.TemporaryDirectory(prefix="spm-sprint1-") as directory:
        os.environ["DJANGO_SETTINGS_MODULE"] = "config.settings"
        os.environ["DJANGO_DB_PATH"] = str(Path(directory) / "smoke.sqlite3")
        os.environ["DJANGO_SECRET_KEY"] = secrets.token_urlsafe(48)
        os.environ["DJANGO_DEBUG"] = "1"
        import django
        django.setup()
        from django.contrib.auth import get_user_model
        from django.contrib.auth.models import Group
        from django.db import connections
        from projects.models import Project, ProjectMembership
        from projects.services import create_project
        from tasks.models import Task

        subprocess.run([sys.executable, "manage.py", "migrate", "--noinput"], cwd=root, check=True)
        User = get_user_model()
        password = secrets.token_urlsafe(24)
        manager = User.objects.create_user("http-manager", password=password)
        manager.groups.add(Group.objects.get(name="项目经理"))
        member = User.objects.create_user("http-member", password=password)
        other = User.objects.create_user("http-other", password=password)
        other.groups.add(Group.objects.get(name="项目经理"))
        private = create_project(other, name="Other private project")
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        origin = f"http://127.0.0.1:{port}"
        with tempfile.TemporaryFile() as log:
            server = subprocess.Popen(
                [sys.executable, "manage.py", "runserver", f"127.0.0.1:{port}", "--noreload"],
                cwd=root, stdout=log, stderr=log,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
            try:
                for _ in range(50):
                    try:
                        with urllib.request.urlopen(origin + "/login/", timeout=1):
                            break
                    except (urllib.error.URLError, TimeoutError):
                        if server.poll() is not None:
                            raise RuntimeError("Server exited before startup")
                        time.sleep(.1)
                else:
                    raise RuntimeError("Server startup timed out")
                browser = Browser(origin)
                browser.login(manager.username, password)
                browser.request("/projects/new/")
                browser.request("/projects/new/", 302, {"name": "HTTP project", "description": "HTTP evidence"})
                project = Project.objects.get(name="HTTP project")
                detail = f"/projects/{project.pk}/"
                members = detail + "members/"
                browser.request(members)
                browser.request(members, 302, {"user": member.pk})
                browser.request(detail + "tasks/new/")
                browser.request(detail + "tasks/new/", 302, {"title": "HTTP task"})
                task = Task.objects.get(project=project)
                assignment = detail + f"tasks/{task.pk}/assign/"
                browser.request(assignment)
                browser.request(assignment, 302, {"assignee": member.pk})
                task.refresh_from_db()
                ensure(task.assignee_id == member.pk and task.status == "TODO", "Task assignment/default not persisted")
                browser.request(assignment, 200, {"assignee": other.pk})
                task.refresh_from_db()
                ensure(task.assignee_id == member.pk, "Invalid assignment changed data")
                ordinary = Browser(origin)
                ordinary.login(member.username, password)
                body, _ = ordinary.request("/projects/")
                ensure("HTTP project" in body and "Other private project" not in body, "Project list leaked contents")
                ordinary.request(detail)
                ordinary.request(f"/projects/{private.pk}/", 404)
                ordinary.request(members, 403)
                ordinary.request(assignment, 403)
                ordinary.request(assignment, 403, {"assignee": member.pk})
                membership = ProjectMembership.objects.get(project=project, user=member)
                browser.request(members + f"{membership.pk}/remove/", 302, {})
                task.refresh_from_db()
                ensure(task.assignee_id is None, "Removed member remained assigned")
                ordinary.request(detail, 404)
                browser.request("/logout/", 302, {})
                browser.request("/projects/", 302)
            finally:
                server.terminate()
                server.wait(timeout=10)
                connections.close_all()
                log.seek(0)
                print(log.read().decode("utf-8", errors="replace").rstrip())
            print("Sprint 1 real HTTP workflow with CSRF and isolated SQLite: PASS")


if __name__ == "__main__":
    main()
