"""Extract only the six approved reference pages to fixed workspace paths."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import sys
import zipfile

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if len(sys.argv) != 2:
    raise SystemExit("Usage: python scripts/extract-a-reference.py path/to/A+B.zip")
archive = Path(sys.argv[1]).resolve()
output = Path(__file__).resolve().parents[1] / ".runtime" / "a-reference"
output.mkdir(parents=True, exist_ok=True)
manifest = {"archive_sha256": hashlib.sha256(archive.read_bytes()).hexdigest(), "pages": {}}
with zipfile.ZipFile(archive) as package:
    members = [x for x in package.infolist() if not x.is_dir() and x.filename.lower().endswith(".html")]
    for key, fallback in [("A01", "登录.html"), ("A02", "我的项目.html"), ("A03", "项目概览.html"), ("A04", "项目计划.html"), ("A05", "项目文档.html"), ("A06", "成员与角色.html")]:
        matching = [x for x in members if PurePosixPath(x.filename).name.startswith(key)]
        if not matching:
            matching = [x for x in members if PurePosixPath(x.filename).name == fallback]
        if len(matching) != 1:
            raise SystemExit(f"Missing or ambiguous reference: {key} {fallback}")
        entry = matching[0]
        content = package.read(entry)
        text = content.decode("utf-8-sig").replace("\r\n", "\n")
        (output / f"{key}.html").write_text(text, encoding="utf-8", newline="\n")
        manifest["pages"][key] = {"source": entry.filename, "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}
        print(f"Read {key}: {entry.filename}")
(output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
