#!/usr/bin/env python3
"""
Cache-busting for eliarbogast.com.

Adds/updates a ?v=<hash> on every local stylesheet and script linked from the
site's HTML pages, based on each file's contents. When a file changes, its
version changes, so browsers fetch the new copy instead of a stale cached one
(GitHub Pages lets browsers cache files for 10 minutes).

    python3 _tools/stamp_assets.py          # update the HTML pages
    python3 _tools/stamp_assets.py --check  # exit 1 if any version is out of date

Run it before you commit/push. Standard library only.
"""

import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGES = ["index.html", "pinball/index.html"]

# href="..." or src="..." pointing at a local .css / .js file (optionally already versioned)
REF = re.compile(r'''((?:href|src)=")(?!https?:|//)([^"?#]+\.(?:css|js))(?:\?v=[0-9a-f]*)?(")''')


def file_hash(path):
    return hashlib.md5(path.read_bytes()).hexdigest()[:8]


def stamp(page):
    path = ROOT / page
    with open(path, encoding="utf-8", newline="") as f:
        src = f.read()

    def repl(m):
        target = (path.parent / m.group(2)).resolve()
        if not target.exists():
            return m.group(0)
        return "%s%s?v=%s%s" % (m.group(1), m.group(2), file_hash(target), m.group(3))

    return src, REF.sub(repl, src)


def main():
    check = "--check" in sys.argv
    stale = False
    for page in PAGES:
        old, new = stamp(page)
        if old == new:
            print("✓ %s up to date" % page)
            continue
        stale = True
        if check:
            print("✗ %s has out-of-date asset versions" % page)
        else:
            with open(ROOT / page, "w", encoding="utf-8", newline="") as f:
                f.write(new)
            print("✓ Updated asset versions in %s" % page)
    if check and stale:
        sys.exit(1)


if __name__ == "__main__":
    main()
