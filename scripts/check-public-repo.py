#!/usr/bin/env python3
"""Fast tracked-tree guard, not a substitute for a full Git history/asset audit."""
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
paths = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT).decode().split("\0")
tracked = {p for p in paths if p}
failures = []
secret_patterns = [
    re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(rb"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}|AKIA[0-9A-Z]{16}|xox[baprs]-[0-9A-Za-z-]{20,})\b"),
]
local_dirs = (".local/", "docs/qa/", "design/qa/", "apps/web/qa/", "services/api/data/", "services/api/backups/")
private_files = re.compile(r"(?i)(?:^handoff(?:-.*)?\.md$|^\.env(?:\..*)?$|\.(?:jks|keystore|pem|key|sqlite(?:3)?(?:-wal|-shm)?|db(?:-wal|-shm)?|apk|aab)$|login\.txt$)")
link_pattern = re.compile(r"!?\[[^\]]*\]\(([^)]+)\)|<img\b[^>]*\bsrc=[\"']([^\"']+)")
for name in sorted(tracked):
    path = ROOT / name
    template = path.name.endswith((".example", ".template"))
    if name.startswith(local_dirs) or (private_files.search(path.name) and not template):
        failures.append(f"private/local artifact: {name}")
    if not path.is_file():
        failures.append(f"missing tracked file: {name}")
        continue
    data = path.read_bytes()
    if b"\0" in data:
        continue
    if any(pattern.search(data) for pattern in secret_patterns):
        failures.append(f"potential credential: {name} (content redacted)")
    if path.suffix != ".md":
        continue
    text = data.decode("utf-8")
    for match in link_pattern.finditer(text):
        target = (match[1] or match[2]).strip().strip("<>")
        if re.match(r"^[a-z][a-z0-9+.-]*:", target, re.I) or target.startswith("#"):
            continue
        target = unquote(target.split("#", 1)[0])
        if not target:
            continue
        resolved = (path.parent / target).resolve()
        try:
            relative = resolved.relative_to(ROOT).as_posix()
        except ValueError:
            failures.append(f"external local link: {name}")
            continue
        if relative not in tracked and not any(p.startswith(relative.rstrip("/") + "/") for p in tracked):
            failures.append(f"untracked/broken link: {name} -> {target}")
if failures:
    print("\n".join(failures))
    sys.exit(1)
print(f"Public-tree checks passed ({len(tracked)} tracked files); history and images require separate review.")
