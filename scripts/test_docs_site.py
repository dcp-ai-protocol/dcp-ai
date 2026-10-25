"""Routing and rendered-site negative controls; no deployment or network."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

import docs_i18n as gate
import docs_site as site


class RoutingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.manifest = {"documents": [
            {"source": "docs/A.md", "site_path": "guides/A.md", "class": "current"},
            {"source": "sdks/go/README.md", "site_path": "reference/sdks/go/README.md", "class": "current"},
            {"source": "scripts/docs-index.md", "site_path": "index.md", "class": "current", "link_base": "site"},
        ], "copies": []}
        for doc in self.manifest["documents"]:
            for lang in gate.LANGUAGES:
                path = self.root / gate.localized(doc["source"], lang)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("# Test\n")
        self.doc = self.manifest["documents"][0]

    def rewrite(self, href, locale="es", image=False):
        return site.rewrite_link(self.root, self.manifest, self.doc, locale, href, image=image)

    def test_cross_reference_uses_current_language(self):
        self.assertEqual(self.rewrite("../sdks/go/README.md#installation"), "../reference/sdks/go/README.md#installation")

    def test_english_source_notice_stays_english(self):
        self.assertEqual(self.rewrite("A.md"), site.SITE + "guides/A/")

    def test_explicit_other_language_stays_explicit(self):
        self.assertEqual(self.rewrite("../sdks/go/README.ja.md"), site.SITE + "ja/reference/sdks/go/")

    def test_external_and_fragment_untouched(self):
        for value in ("#here", "https://example.org/a?b=c#d", "mailto:person@example.org"):
            self.assertEqual(self.rewrite(value), value)

    def test_site_relative_landing_uses_manifest(self):
        doc = self.manifest["documents"][2]
        self.assertEqual(site.rewrite_link(self.root, self.manifest, doc, "es", "guides/A.md"), "guides/A.md")

    def test_directory_readme_resolves_to_site(self):
        self.assertEqual(self.rewrite("../sdks/go/"), "../reference/sdks/go/README.md")

    def test_source_file_uses_github_with_query_fragment(self):
        (self.root / "code.py").write_text("pass\n")
        self.assertEqual(self.rewrite("../code.py?raw=1#L1"), site.REPO + "blob/main/code.py?raw=1#L1")

    def test_image_stays_image(self):
        (self.root / "diagram.png").write_bytes(b"fixture")
        self.assertEqual(self.rewrite("../diagram.png", image=True), "../_assets/diagram.png")

    def test_unknown_target_does_not_silently_become_github_link(self):
        with self.assertRaises(ValueError):
            self.rewrite("../missing.md")

    def test_selector_readme_and_root_routes(self):
        self.assertEqual(site.route_url("reference/sdks/go/README.md"), "reference/sdks/go/")
        selector = site.SitePage(site.language_selector("ja", "reference/sdks/go/README.md"))
        self.assertEqual(dict(selector.alternates)["en"], "../../../../reference/sdks/go/")
        root = site.SitePage(site.language_selector("en", "index.md"))
        self.assertEqual(dict(root.alternates)["es"], "es/")

    def test_cross_locale_content_links_stay_on_preview_host(self):
        content = '<a href="https://docs.dcp-ai.org/ja/reference/sdks/go/?x=1#install">日本語</a>'
        self.assertEqual(site.relative_site_links(content, "en", "reference/sdks/go/README.md"),
                         '<a href="../../../ja/reference/sdks/go/?x=1#install">日本語</a>')
        self.assertEqual(site.relative_site_links('<a href="https://docs.dcp-ai.org/playground/">Try</a>', "es", "index.md"),
                         '<a href="../playground/">Try</a>')

    def test_site_banner_deduplication_preserves_examples(self):
        banner = '<sub>**English** · [中文](README.zh-CN.md) · [日本語](README.ja.md)</sub>\n\n'
        body = '# Title\n\n```html\n<div align="center">\n```\n'
        self.assertEqual(site.site_markdown(banner + body, "sdks/go/README.md"), body)
        chinese_banner = '<sub>[English](README.md) · **中文** · [日本語](README.ja.md)</sub>\n\n'
        self.assertEqual(site.site_markdown(chinese_banner + body, "sdks/go/README.md"), body)
        self.assertEqual(site.site_markdown('<sub>Unrelated content</sub>\n' + body, "other.md"), '<sub>Unrelated content</sub>\n' + body)

    def test_missing_locale_cannot_prepare_fallback(self):
        (self.root / "docs/A.es.md").unlink()
        with self.assertRaisesRegex(ValueError, "missing document"):
            site.prepare(self.root, self.manifest, "es")
        self.assertFalse((self.root / "docs-site").exists())


class RenderedTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.manifest = {"documents": [{"source": "README.md", "site_path": "index.md"}]}
        for lang in gate.LANGUAGES:
            p = self.root / ("" if lang == "en" else lang) / "index.html"
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(f'<html lang="{lang}"><body>' + site.language_selector(lang, "index.md") + '<h1 id="title">Title</h1></body></html>')

    def result(self):
        return site.validate_site(self.root, self.manifest)

    def test_complete_equivalent_pages(self):
        self.assertTrue(self.result()["passed"], self.result())

    def test_removed_locale(self):
        (self.root / "es/index.html").unlink()
        self.assertFalse(self.result()["passed"])

    def test_wrong_selector_page(self):
        p = self.root / "index.html"
        p.write_text(p.read_text().replace('href="es/"', 'href="ja/"'))
        self.assertFalse(self.result()["passed"])

    def test_missing_anchor(self):
        p = self.root / "index.html"
        p.write_text(p.read_text() + '<a href="es/#absent">Missing</a>')
        self.assertFalse(self.result()["passed"])

    def test_wrong_html_language(self):
        p = self.root / "ja/index.html"
        p.write_text(p.read_text().replace('lang="ja"', 'lang="en"', 1))
        self.assertFalse(self.result()["passed"])

    def test_missing_script_asset(self):
        p = self.root / "index.html"
        p.write_text(p.read_text() + '<script src="missing.js"></script>')
        self.assertFalse(self.result()["passed"])


class BuildIntegrationTests(unittest.TestCase):
    def test_real_five_locale_build_and_missing_output_control(self):
        """Exercise MkDocs/Material and hooks, not just their helper functions."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "scripts").mkdir()
            source_root = Path(__file__).resolve().parents[1]
            for name in ("docs_i18n.py", "docs_site.py", "docs_site_hooks.py"):
                shutil.copyfile(source_root / "scripts" / name, root / "scripts" / name)
            shutil.copyfile(source_root / "mkdocs.yml", root / "mkdocs.yml")
            manifest = {"version": 1, "languages": list(gate.LANGUAGES), "documents": [
                {"source": "README.md", "site_path": "index.md", "class": "current"},
                {"source": "CHANGELOG.md", "site_path": "CHANGELOG.md", "class": "mixed-historical"},
            ], "copies": [], "excluded": []}
            (root / "scripts/docs-i18n.json").write_text(json.dumps(manifest))
            status = {"version": 1, "reviews": {}}
            notices = {"es": "Traducción informativa", "pt-BR": "Tradução informativa",
                       "ja": "参考訳", "zh-CN": "参考译文"}
            titles = {"en": "Example", "es": "Ejemplo", "pt-BR": "Exemplo", "ja": "例", "zh-CN": "示例"}
            paths = []
            for doc in manifest["documents"]:
                src = doc["source"]
                for lang in gate.LANGUAGES:
                    name = gate.localized(src, lang)
                    paths.append(name)
                    notice = "" if lang == "en" else f'> {notices[lang]} [English]({src}), 2026-10-25.\n\n'
                    alias = '' if lang == 'en' else '<a id="example"></a>\n\n'
                    body = f'{notice}{alias}# {titles[lang]}\n\n[Log](CHANGELOG.md#example)\n\n```text\nunchanged\n```\n'
                    (root / name).write_text(body, encoding="utf-8")
                gate.record_review(root, manifest, status, src)
            (root / "scripts/docs-i18n-status.json").write_text(json.dumps(status))
            (root / "playground").mkdir()
            (root / "playground/index.html").write_text('<html lang="en"><link rel="icon" href="/favicon.svg"><h1>Fixture</h1></html>')
            paths.append("playground/index.html")
            subprocess.run(["git", "init", "--quiet"], cwd=root, check=True, capture_output=True)
            subprocess.run(["git", "add", "--", *paths], cwd=root, check=True, capture_output=True)
            build = subprocess.run([sys.executable, "scripts/docs_site.py", "build"], cwd=root,
                                   capture_output=True, text=True, timeout=90)
            self.assertEqual(build.returncode, 0, build.stdout + build.stderr)
            result = site.validate_site(root / "site", manifest)
            self.assertTrue(result["passed"], result)
            self.assertEqual(result["html_pages"], 16)  # 2 docs + 404 per locale, and playground.
            (root / "site/ja/CHANGELOG/index.html").unlink()
            self.assertFalse(site.validate_site(root / "site", manifest)["passed"])


if __name__ == "__main__":
    unittest.main()
