#!/usr/bin/env python3
"""Documentation coverage and translation freshness gate.

Requires Markdown (already installed with MkDocs). No network or translation API.
`check` is read-only. `record SOURCE --reviewed` records bytes only AFTER a
maintainer has reviewed the complete translations; it does not certify language
quality. A changed source or translation invalidates that recorded review.
The manifest covers public tracked Markdown, including explicit runtime-file
exclusions and scaffold copies. Private untracked research is not published.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
from urllib.parse import unquote, urlsplit

import markdown

ROOT = Path(__file__).resolve().parents[1]
LANGUAGES = ("en", "es", "pt-BR", "ja", "zh-CN")
CLASSES = {"current", "contributor", "historical", "mixed-historical", "normative", "proposal"}
NOTICES = {
    "es": r"Traducción informativa",
    "pt-BR": r"Tradução informativa",
    "ja": r"参考訳",
    "zh-CN": r"参考译文",
}
PRECEDENCE = {"es": r"prevalece", "pt-BR": r"prevalece", "ja": r"優先", "zh-CN": r"为准"}
DATE = re.compile(r"(?:\d{2}/\d{2}/\d{4}|\d{4}[-年]\d{1,2}[-月]\d{1,2}日?)")


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def localized(source: str, locale: str) -> str:
    p = PurePosixPath(source)
    return source if locale == "en" else str(p.with_name(f"{p.stem}.{locale}.md"))


def safe_path(value: object) -> bool:
    return (isinstance(value, str) and bool(value) and "\\" not in value
            and not PurePosixPath(value).is_absolute()
            and all(x not in (".", "..") for x in value.split("/"))
            and str(PurePosixPath(value)) == value)


def load_manifest(root: Path) -> dict:
    data = json.loads((root / "scripts/docs-i18n.json").read_text())
    if data.get("version") != 1 or data.get("languages") != list(LANGUAGES):
        raise ValueError("Unsupported manifest version or language set")
    seen, routes = set(), set()
    for item in data["documents"]:
        src, route = item["source"], item["site_path"]
        if not safe_path(src) or not src.endswith(".md") or src in seen:
            raise ValueError(f"Invalid/duplicate source: {src}")
        if not safe_path(route) or not route.endswith(".md") or route in routes:
            raise ValueError(f"Invalid/duplicate site path: {route}")
        if route.split("/")[0] in LANGUAGES[1:]:
            raise ValueError(f"Site path collides with language prefix: {route}")
        if item["class"] not in CLASSES:
            raise ValueError(f"Unknown document class: {src}")
        if item.get("link_base", "source") not in ("source", "site"):
            raise ValueError(f"Unknown link base: {src}")
        seen.add(src)
        routes.add(route)
    for item in data["copies"] + data["excluded"]:
        src = item["source"]
        if not safe_path(src) or src in seen:
            raise ValueError(f"Invalid/duplicate classification: {src}")
        seen.add(src)
        if "canonical" in item and item["canonical"] not in {d["source"] for d in data["documents"]}:
            raise ValueError(f"Copy has no canonical document: {src}")
        if "canonical" not in item and not item.get("reason", "").strip():
            raise ValueError(f"Exclusion needs a reason: {src}")
    return data


class Page(HTMLParser):
    """Rendered shape; deliberately does not infer semantic equivalence."""
    def __init__(self, text: str):
        super().__init__()
        self.ids, self.links, self.headings, self.tables, self.codes = [], [], [], [], []
        self._code = None
        self._cell = False
        self.feed(markdown.markdown(text, extensions=["toc", "tables", "attr_list", "md_in_html",
                                                      "admonition", "pymdownx.superfences", "pymdownx.tabbed"]))

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get("id"):
            self.ids.append(attrs["id"])
        if tag in ("a", "img"):
            link = attrs.get("href" if tag == "a" else "src")
            if link:
                self.links.append(link)
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self.headings.append(tag)
        if tag == "table":
            self.tables.append([])
        if tag == "tr" and self.tables:
            self.tables[-1].append([])
        if tag in ("td", "th") and self.tables and self.tables[-1]:
            self.tables[-1][-1].append(False)
            self._cell = True
        if tag == "img" and self._cell:
            self.tables[-1][-1][-1] = True
        if tag == "code":
            self._code = ""

    def handle_data(self, data):
        if self._code is not None:
            self._code += data
        if self._cell and data.strip():
            self.tables[-1][-1][-1] = True

    def handle_endtag(self, tag):
        if tag == "code" and self._code is not None:
            self.codes.append(self._code)
            self._code = None
        if tag in ("td", "th"):
            self._cell = False


def fenced_blocks(text: str) -> list[str]:
    """Keep bytes/order/info strings, including code comments and indentation."""
    blocks, block, marker, indent = [], [], None, None
    for line in text.splitlines(keepends=True):
        if marker is None:
            match = re.match(r"^(\s*)(`{3,}|~{3,})(.*)$", line.rstrip("\n"))
            if match:
                indent, marker = match.group(1), match.group(2)
                block = [line]
        else:
            block.append(line)
            if re.fullmatch(re.escape(indent) + re.escape(marker[0]) + "{" + str(len(marker)) + r",}\s*", line.rstrip("\n")):
                blocks.append("".join(block))
                marker = None
    if marker is not None:
        raise ValueError("Unclosed fenced code block")
    return blocks


def local_target(root: Path, path: str, href: str, doc: dict, manifest: dict) -> Path:
    """Resolve repo links, plus the explicitly site-relative landing page."""
    url = urlsplit(href)
    if not url.path:
        return (root / path).resolve()
    value = unquote(url.path)
    if doc.get("link_base") == "site":
        routes = {d["site_path"]: d["source"] for d in manifest["documents"]}
        route = str(PurePosixPath(doc["site_path"]).parent / value)
        if route in routes:
            return (root / routes[route]).resolve()
        if route == "playground":
            return (root / "playground").resolve()
    return (root / path).parent.joinpath(value).resolve()


def check(root: Path, manifest: dict, reviews: dict, tracked: list[str]) -> dict:
    errors = []
    counts = Counter()
    cache = {}

    def issue(path, code, detail=""):
        errors.append({"path": path, "code": code, "detail": detail})

    def page(path):
        if path not in cache:
            cache[path] = Page((root / path).read_text(encoding="utf-8"))
        return cache[path]

    known = {localized(d["source"], lang) for d in manifest["documents"] for lang in LANGUAGES}
    known.update(d["source"] for d in manifest["copies"] + manifest["excluded"])
    for path in tracked:
        if path.lower().endswith(".md") and path not in known:
            issue(path, "unclassified-document")
    expected_reviews = {d["source"] for d in manifest["documents"]}
    for source in reviews.keys() - expected_reviews:
        issue(source, "unknown-review")
    for item in manifest["copies"]:
        a, b = root / item["source"], root / item["canonical"]
        if not a.is_file() or not b.is_file() or a.read_bytes() != b.read_bytes():
            issue(item["source"], "scaffold-copy-drift", item["canonical"])
    for item in manifest["excluded"]:
        if not (root / item["source"]).is_file():
            issue(item["source"], "missing-excluded-source")
    for doc in manifest["documents"]:
        src = doc["source"]
        if not (root / src).is_file():
            issue(src, "missing-source")
            continue
        source_text = (root / src).read_text(encoding="utf-8")
        en, source_hash = page(src), digest(root / src)
        try:
            source_blocks = fenced_blocks(source_text)
        except ValueError as exc:
            issue(src, "invalid-fence", str(exc))
            source_blocks = None
        record = reviews.get(src, {})
        if record.get("source_sha256") != source_hash:
            issue(src, "source-review-missing-or-stale")
        for locale in LANGUAGES:
            path = localized(src, locale)
            target = root / path
            if not target.is_file():
                issue(path, "missing-translation")
                continue
            counts[locale] += 1
            text = target.read_text(encoding="utf-8")
            rendered = page(path)
            duplicates = [x for x, n in Counter(rendered.ids).items() if n > 1]
            if duplicates:
                issue(path, "duplicate-anchor", ", ".join(duplicates))
            for link in rendered.links:
                url = urlsplit(link)
                if url.scheme or url.netloc:
                    continue
                resolved = local_target(root, path, link, doc, manifest)
                if not resolved.is_relative_to(root.resolve()):
                    issue(path, "link-outside-repository", link)
                elif not resolved.exists():
                    issue(path, "broken-local-link", link)
                elif url.fragment and resolved.suffix == ".md" and resolved.is_file():
                    if unquote(url.fragment) not in page(str(resolved.relative_to(root.resolve()))).ids:
                        issue(path, "broken-local-anchor", link)
            if locale == "en":
                continue
            # Require a visible notice near the beginning, not a hidden marker in code.
            notices = [line for line in text[:2500].splitlines() if line.startswith(">")]
            notice = "\n".join(notices)
            if not re.search(NOTICES[locale], notice) or not DATE.search(notice) or PurePosixPath(src).name not in notice:
                issue(path, "missing-translation-notice")
            if doc["class"] == "normative" and not re.search(PRECEDENCE[locale], notice):
                issue(path, "missing-english-precedence-notice")
            entry = record.get("translations", {}).get(locale, {})
            if entry.get("source_sha256") != source_hash or entry.get("sha256") != digest(target):
                issue(path, "translation-review-missing-or-stale")
            if rendered.headings != en.headings:
                issue(path, "heading-structure-mismatch")
            if rendered.tables != en.tables:
                issue(path, "table-structure-mismatch")
            missing_ids = sorted(set(en.ids) - set(rendered.ids))
            if missing_ids:
                issue(path, "missing-english-anchor", ", ".join(missing_ids))
            try:
                if source_blocks is not None and fenced_blocks(text) != source_blocks:
                    issue(path, "fenced-code-mismatch")
            except ValueError as exc:
                issue(path, "invalid-fence", str(exc))
            missing_codes = list((Counter(en.codes) - Counter(rendered.codes)).elements())
            if missing_codes:
                issue(path, "missing-code-elements", repr(missing_codes[:10]))
            # Extra code formatting is harmless (e.g. a formerly plain API name);
            # omissions and changed existing code are rejected above. Prose still
            # requires full semantic review before recording hashes.
    return {"passed": not errors, "documents": len(manifest["documents"]),
            "present": {lang: counts[lang] for lang in LANGUAGES}, "errors": errors,
            "scope": "Coverage, reviewed-byte freshness, code/structure, notices, anchors and local links; not linguistic certification or runtime validation."}


def record_review(root: Path, manifest: dict, status: dict, source: str) -> None:
    if source not in {d["source"] for d in manifest["documents"]}:
        raise ValueError(f"Source is not in manifest: {source}")
    paths = {lang: root / localized(source, lang) for lang in LANGUAGES}
    if not all(p.is_file() for p in paths.values()):
        raise ValueError("Cannot record an incomplete translation set")
    source_hash = digest(paths["en"])
    status["reviews"][source] = {
        "source_sha256": source_hash,
        "translations": {lang: {"source_sha256": source_hash, "sha256": digest(paths[lang])}
                         for lang in LANGUAGES[1:]},
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    sub = parser.add_subparsers(dest="command", required=True)
    check_args = sub.add_parser("check", help="Read-only full documentation gate")
    check_args.add_argument("--json", action="store_true")
    record_args = sub.add_parser("record", help="Record hashes AFTER complete semantic review")
    record_args.add_argument("source")
    record_args.add_argument("--reviewed", required=True, action="store_true",
                             help="Attest that the complete source and all translations were reviewed")
    args = parser.parse_args(argv)
    try:
        root = args.root.resolve()
        manifest = load_manifest(root)
        status_path = root / "scripts/docs-i18n-status.json"
        status = json.loads(status_path.read_text())
        if status.get("version") != 1 or not isinstance(status.get("reviews"), dict):
            raise ValueError("Invalid review registry")
        if args.command == "record":
            record_review(root, manifest, status, args.source)
            status_path.write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n")
            print(f"Recorded reviewed bytes: {args.source}. Run check before committing.")
            return 0
        tracked = subprocess.check_output(["git", "ls-files", "-z"], cwd=root).decode().split("\0")
        result = check(root, manifest, status["reviews"], tracked)
        if args.json:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            print(f"Documentation: {result['present']} / {result['documents']} per language")
            for error in result["errors"]:
                print(f"{error['path']}: {error['code']} {error['detail']}")
            print(f"{'PASS' if result['passed'] else 'FAIL'}: {len(result['errors'])} issue(s)")
        return 0 if result["passed"] else 1
    except (ValueError, KeyError, TypeError, OSError, subprocess.CalledProcessError) as exc:
        print(f"Documentation infrastructure error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
