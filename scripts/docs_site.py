#!/usr/bin/env python3
"""Build the five documentation sites with existing MkDocs dependencies.

`build` requires a passing i18n gate and builds every locale. `preview --locale
en` is a local review aid: it does not imply full coverage or a reviewed release.
Canonical sources are copied verbatim; a MkDocs hook resolves their links using
the manifest. Existing English routes stay at the site root.
"""
from __future__ import annotations

import argparse
import html
from html.parser import HTMLParser
import json
import posixpath
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
from urllib.parse import quote, unquote, urljoin, urlsplit, urlunsplit

import yaml
from mkdocs.structure.files import File

from docs_i18n import ROOT, LANGUAGES, check, load_manifest, localized, local_target

SITE = "https://docs.dcp-ai.org/"
REPO = "https://github.com/dcp-ai-protocol/dcp-ai/"
NAMES = {"en": "English", "es": "Español", "pt-BR": "Português (Brasil)", "ja": "日本語", "zh-CN": "简体中文"}
GROUPS = {
    "en": ["Home", "Quick start", "Specifications", "Architecture", "Guides", "Community", "Reference", "Changelog", "Language"],
    "es": ["Inicio", "Inicio rápido", "Especificaciones", "Arquitectura", "Guías", "Comunidad", "Referencia", "Historial de cambios", "Idioma"],
    "pt-BR": ["Início", "Início rápido", "Especificações", "Arquitetura", "Guias", "Comunidade", "Referência", "Histórico de alterações", "Idioma"],
    "ja": ["ホーム", "クイックスタート", "仕様", "アーキテクチャ", "ガイド", "コミュニティ", "リファレンス", "変更履歴", "言語"],
    "zh-CN": ["首页", "快速入门", "规范", "架构", "指南", "社区", "参考资料", "更新日志", "语言"],
}


def route_url(route: str) -> str:
    return File(route, "/unused", "/unused-output", use_directory_urls=True).url


def locale_url(locale: str, route: str) -> str:
    return ("" if locale == "en" else locale + "/") + route_url(route)


def language_selector(locale: str, route: str) -> str:
    current = locale_url(locale, route)
    # MkDocs uses directory URLs; index.md is the empty root URL.
    base = current.rstrip("/") or "."
    links = []
    for lang in LANGUAGES:
        target = locale_url(lang, route)
        url = posixpath.relpath(target.rstrip("/") or ".", base)
        url = "./" if url == "." else url.rstrip("/") + "/"
        attrs = ' aria-current="page"' if lang == locale else ""
        links.append(f'<a href="{html.escape(url, quote=True)}" hreflang="{lang}" lang="{lang}"{attrs}>{NAMES[lang]}</a>')
    return f'<nav class="dcp-languages" aria-label="{GROUPS[locale][8]}">' + " · ".join(links) + "</nav>\n"


def relative_site_links(content: str, locale: str, route: str) -> str:
    """Keep equivalent-page and playground links on the current preview host."""
    base = locale_url(locale, route).rstrip("/") or "."

    def replace(match):
        target = urlsplit(match.group(2))
        path = posixpath.relpath(target.path.rstrip("/") or ".", base)
        if target.path.endswith("/") or not target.path:
            path = "./" if path == "." else path + "/"
        return match.group(1) + '="' + urlunsplit(("", "", path, target.query, target.fragment)) + '"'

    return re.sub(r'(href|src)="' + re.escape(SITE) + r'([^"<>]*)"', replace, content)


def site_markdown(text: str, source: str) -> str:
    # MkDocs already removed YAML metadata. Replace only the initial GitHub
    # language banner, leaving arbitrary <sub> content and fenced examples alone.
    banner = re.match(r"\A\s*<sub>([^\n]+)</sub>\s*\n", text)
    if (banner and all(token in banner.group(1) for token in ("English", "日本語"))
            and re.search(r"\.(?:es|pt-BR|ja|zh-CN)\.md", banner.group(1))):
        text = text[banner.end():]
    if source == "README.md":
        text = text.replace('<div align="center">', '<div align="center" markdown="1">', 1)
    return text


def html_language(content: str, locale: str) -> str:
    # Material's pt-BR/zh translations emit generic pt/zh language tags. Keep
    # the exact content locale for assistive technology and language detection.
    return re.sub(r'(<html\b[^>]*\blang=")[^"]*(")',
                  lambda match: match.group(1) + locale + match.group(2), content, count=1)


def rewrite_link(root: Path, manifest: dict, doc: dict, locale: str, href: str, *, image=False) -> str:
    """Resolve only links, never text/code; unknown local targets are errors."""
    url = urlsplit(href)
    if url.scheme or url.netloc or not url.path:
        return href
    source = localized(doc["source"], locale)
    target = local_target(root, source, href, doc, manifest)
    if not target.is_relative_to(root.resolve()) or not target.exists():
        raise ValueError(f"Unresolved local link in {source}: {href}")
    relative = target.relative_to(root.resolve()).as_posix()
    by_path = {localized(d["source"], lang): (d, lang) for d in manifest["documents"] for lang in LANGUAGES}
    if target.is_dir() and relative + "/README.md" in by_path and relative != "playground":
        relative += "/README.md"
    for copy in manifest["copies"]:
        if relative == copy["source"]:
            relative = copy["canonical"]
            break
    if relative in by_path:
        destination, target_lang = by_path[relative]
        if target_lang == "en" and not (locale != "en" and destination["source"] == doc["source"]):
            target_lang = locale
        if target_lang == locale:
            new_path = posixpath.relpath(destination["site_path"], posixpath.dirname(doc["site_path"]) or ".")
        else:
            new_path = SITE + locale_url(target_lang, destination["site_path"])
        return urlunsplit(("", "", new_path, url.query, url.fragment))
    if relative == "playground" or relative == "playground/index.html":
        return SITE + "playground/" + ("#" + url.fragment if url.fragment else "")
    if image:
        # Images remain rendered images, not GitHub's HTML blob pages. Only
        # repository-tracked assets may be copied by prepare().
        new_path = posixpath.relpath("_assets/" + relative, posixpath.dirname(doc["site_path"]) or ".")
        return urlunsplit(("", "", quote(new_path, safe="/"), url.query, url.fragment))
    kind = "tree" if target.is_dir() else "blob"
    return (REPO + kind + "/main/" + quote(relative, safe="/")
            + ("?" + url.query if url.query else "") + ("#" + url.fragment if url.fragment else ""))


def nav_title(text: str, fallback: str) -> str:
    match = re.search(r"^# +(.+)$", text, re.M)
    if not match:
        raise ValueError(f"Document has no level-one title: {fallback}")
    title = re.sub(r"\[([^]]+)\]\([^)]*\)", r"\1", match.group(1))
    return re.sub(r"[`*_]", "", title).strip()


def prepare(root: Path, manifest: dict, locale: str) -> Path:
    from docs_i18n import Page
    stage = root / "docs-site" / locale
    source_dir = stage / "docs"
    # Check completeness before touching build artifacts. Never substitute EN.
    missing = [localized(d["source"], locale) for d in manifest["documents"]
               if not (root / localized(d["source"], locale)).is_file()]
    if missing:
        raise ValueError(f"{locale}: {len(missing)} missing document(s), first: {missing[0]}")
    if stage.exists():
        shutil.rmtree(stage)
    source_dir.mkdir(parents=True)
    groups = {key: [] for key in ("quickstart", "specs", "architecture", "guides", "community", "reference")}
    nav = [{GROUPS[locale][0]: "index.md"}]
    tracked = set(subprocess.check_output(["git", "ls-files", "-z"], cwd=root).decode().split("\0"))
    public_docs = {localized(d["source"], lang) for d in manifest["documents"] for lang in LANGUAGES}
    for doc in manifest["documents"]:
        source = root / localized(doc["source"], locale)
        destination = source_dir / doc["site_path"]
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
        text = source.read_text(encoding="utf-8")
        route = doc["site_path"]
        if route not in ("index.md", "CHANGELOG.md"):
            groups[route.split("/")[0]].append({nav_title(text, str(source)): route})
        for link in Page(text).links:
            u = urlsplit(link)
            if u.scheme or u.netloc or not u.path:
                continue
            asset = local_target(root, str(source.relative_to(root)), link, doc, manifest)
            if not asset.is_relative_to(root):
                raise ValueError(f"Link outside repository in {source}: {link}")
            rel = asset.relative_to(root).as_posix()
            if asset.is_file() and rel not in tracked and rel not in public_docs:
                raise ValueError(f"Refusing link to untracked non-document file: {rel}")
            if asset.is_file() and asset.suffix.lower() in (".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico"):
                if rel not in tracked:
                    raise ValueError(f"Refusing untracked documentation asset: {rel}")
                out = source_dir / "_assets" / rel
                out.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(asset, out)
    for i, name in enumerate(groups, start=1):
        if groups[name]:
            nav.append({GROUPS[locale][i]: groups[name]})
    nav.append({GROUPS[locale][7]: "CHANGELOG.md"})
    if locale == "en":
        for rel in sorted(tracked):
            if rel.startswith("playground/") and not rel.endswith(".md"):
                out = source_dir / rel
                out.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(root / rel, out)
        # The product HTML refers to a nonexistent root favicon.svg. Use the
        # theme's bundled icon in the site copy only; product sources stay intact.
        playground = source_dir / "playground/index.html"
        playground.write_text(playground.read_text().replace('href="/favicon.svg"', 'href="../assets/images/favicon.png"'))
    config = {
        "INHERIT": str(root / "mkdocs.yml"),
        "docs_dir": str(source_dir),
        "site_dir": str(root / "site" / ("" if locale == "en" else locale)),
        "site_url": SITE + ("" if locale == "en" else locale + "/"),
        "theme": {"language": {"pt-BR": "pt-BR", "zh-CN": "zh"}.get(locale, locale)},
        "hooks": [str(root / "scripts/docs_site_hooks.py")],
        "nav": nav,
        "extra": {"docs_locale": locale},
    }
    config_path = stage / "mkdocs.yml"
    config_path.write_text(yaml.safe_dump(config, sort_keys=False, allow_unicode=True))
    return config_path


class SitePage(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.ids, self.links, self.alternates = set(), [], []
        self.lang = None
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "html":
            self.lang = attrs.get("lang")
        if attrs.get("id"):
            self.ids.add(attrs["id"])
        if tag == "a" and attrs.get("name"):
            self.ids.add(attrs["name"])
        attr = "href" if tag in ("a", "link") else "src" if tag in ("img", "script", "iframe", "source") else None
        if attr and attrs.get(attr):
            self.links.append(attrs[attr])
        if tag == "a" and attrs.get("hreflang"):
            self.alternates.append((attrs["hreflang"], attrs.get("href", "")))


def validate_site(site: Path, manifest: dict) -> dict:
    """Validate actual HTML, including cross-locale selectors and all href/src."""
    pages = {p.relative_to(site).as_posix(): SitePage(p.read_text(encoding="utf-8")) for p in site.rglob("*.html")}
    errors, checked = [], 0
    for source, page in pages.items():
        for href in page.links:
            url = urlsplit(urljoin(SITE + source, href))
            if url.scheme not in ("http", "https") or url.netloc != urlsplit(SITE).netloc:
                continue
            checked += 1
            target = site / unquote(url.path).lstrip("/")
            if not target.resolve().is_relative_to(site.resolve()):
                errors.append(f"{source}: link escapes site: {href}")
                continue
            if target.is_dir() or url.path.endswith("/"):
                target /= "index.html"
            if not target.is_file():
                errors.append(f"{source}: missing link target: {href}")
                continue
            key = target.relative_to(site).as_posix()
            if url.fragment and key in pages and unquote(url.fragment) not in pages[key].ids:
                errors.append(f"{source}: missing anchor: {href}")
    for doc in manifest["documents"]:
        for locale in LANGUAGES:
            base = locale_url(locale, doc["site_path"])
            url = urljoin(SITE, base)
            path = urlsplit(url).path.lstrip("/") + "index.html"
            if path not in pages:
                errors.append(f"Missing rendered document: {locale} {doc['source']} ({path})")
                continue
            page = pages[path]
            expected_lang = locale
            if page.lang != expected_lang:
                errors.append(f"{path}: HTML lang={page.lang}, expected {expected_lang}")
            expected = {(lang, urljoin(SITE, locale_url(lang, doc["site_path"]))) for lang in LANGUAGES}
            actual = [(lang, urljoin(url, href)) for lang, href in page.alternates]
            if len(actual) != len(expected) or set(actual) != expected:
                errors.append(f"{path}: language selector does not cover all equivalent pages")
    return {"passed": not errors, "html_pages": len(pages), "checked_links": checked, "errors": errors}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("build", help="Validate and build all five languages")
    sub.add_parser("validate", help="Validate a completed multilingual HTML build")
    preview = sub.add_parser("preview", help="Local single-language review; NOT a complete build")
    preview.add_argument("--locale", choices=LANGUAGES, required=True)
    args = parser.parse_args(argv)
    root = ROOT.resolve()
    try:
        manifest = load_manifest(root)
        if args.command == "validate":
            result = validate_site(root / "site", manifest)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 0 if result["passed"] else 1
        if args.command == "build":
            status = json.loads((root / "scripts/docs-i18n-status.json").read_text())
            tracked = subprocess.check_output(["git", "ls-files", "-z"], cwd=root).decode().split("\0")
            result = check(root, manifest, status["reviews"], tracked)
            if not result["passed"]:
                raise ValueError(f"Documentation gate has {len(result['errors'])} issue(s). Run scripts/docs_i18n.py check.")
            languages = LANGUAGES
        else:
            languages = [args.locale]
            print(f"LOCAL PREVIEW ({args.locale}); does not assert reviewed multilingual coverage.", flush=True)
        for locale in languages:
            config = prepare(root, manifest, locale)
            subprocess.run([sys.executable, "-m", "mkdocs", "build", "--strict", "--clean", "--config-file", str(config)], cwd=root, check=True)
        if args.command == "build":
            result = validate_site(root / "site", manifest)
            if not result["passed"]:
                print(json.dumps(result, ensure_ascii=False, indent=2))
                return 1
            print(f"Validated {result['html_pages']} HTML pages and {result['checked_links']} local links.")
        return 0
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as exc:
        print(f"Documentation build failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
