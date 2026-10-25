"""Regression controls for the docs gate; all fixtures are temporary."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

import docs_i18n as gate


class GateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "scripts").mkdir()
        self.manifest = {
            "version": 1, "languages": list(gate.LANGUAGES),
            "documents": [{"source": "README.md", "class": "current", "site_path": "index.md"}],
            "copies": [], "excluded": [],
        }
        self.status = {"version": 1, "reviews": {}}
        self.tracked = [gate.localized("README.md", lang) for lang in gate.LANGUAGES]
        self.put("README.md", '# Example\n\n[Section](#section)\n\n## Section\n\n`api()`\n\n```js\napi();\n```\n\n| X | Y |\n|---|---|\n| A | B |\n')
        phrases = {"es": "Traducción informativa", "pt-BR": "Tradução informativa",
                   "ja": "参考訳", "zh-CN": "参考译文"}
        for lang in gate.LANGUAGES[1:]:
            self.put(gate.localized("README.md", lang),
                     f'> {phrases[lang]} [English](README.md), 2026-10-25.\n\n' + self.read("README.md"))
        self.record()

    def put(self, name, text):
        (self.root / name).write_text(text, encoding="utf-8")

    def read(self, name):
        return (self.root / name).read_text(encoding="utf-8")

    def record(self):
        gate.record_review(self.root, self.manifest, self.status, "README.md")

    def result(self):
        return gate.check(self.root, self.manifest, self.status["reviews"], self.tracked)

    def assert_issue(self, code):
        result = self.result()
        self.assertFalse(result["passed"])
        self.assertIn(code, {e["code"] for e in result["errors"]}, result)

    def test_positive_complete_reviewed_set(self):
        self.assertTrue(self.result()["passed"], self.result())
        self.assertEqual(self.result()["present"], {lang: 1 for lang in gate.LANGUAGES})

    def test_missing_translation(self):
        (self.root / "README.es.md").unlink()
        self.assert_issue("missing-translation")
        with self.assertRaisesRegex(ValueError, "incomplete"):
            self.record()

    def test_source_change_invalidates_all_translations(self):
        self.put("README.md", self.read("README.md") + "\nNew rule.\n")
        self.assert_issue("source-review-missing-or-stale")
        errors = [e for e in self.result()["errors"] if e["code"] == "translation-review-missing-or-stale"]
        self.assertEqual(len(errors), 4)

    def test_translation_change_invalidates_review(self):
        self.put("README.es.md", self.read("README.es.md") + "\nNew prose.\n")
        self.assert_issue("translation-review-missing-or-stale")

    def test_missing_notice_even_after_hash_refresh(self):
        self.put("README.es.md", self.read("README.md"))
        self.record()
        self.assert_issue("missing-translation-notice")

    def test_missing_notice_date(self):
        self.put("README.es.md", self.read("README.es.md").replace("2026-10-25", ""))
        self.record()
        self.assert_issue("missing-translation-notice")

    def test_normative_translation_requires_english_precedence(self):
        self.manifest["documents"][0]["class"] = "normative"
        self.assert_issue("missing-english-precedence-notice")
        wording = {"es": "prevalece el original inglés", "pt-BR": "prevalece o original em inglês",
                   "ja": "英語の原文が優先されます", "zh-CN": "以英文原文为准"}
        for lang, sentence in wording.items():
            path = gate.localized("README.md", lang)
            self.put(path, self.read(path).replace("2026-10-25.", "2026-10-25. " + sentence))
        self.record()
        self.assertTrue(self.result()["passed"], self.result())

    def test_broken_local_link(self):
        self.put("README.es.md", self.read("README.es.md") + "\n[Missing](missing.md)\n")
        self.record()
        self.assert_issue("broken-local-link")

    def test_broken_anchor(self):
        self.put("README.es.md", self.read("README.es.md") + "\n[Missing](README.md#absent)\n")
        self.record()
        self.assert_issue("broken-local-anchor")

    def test_encoded_path_and_anchor(self):
        self.put("space name.md", '# Special heading\n')
        self.put("README.es.md", self.read("README.es.md") + "\n[Good](space%20name.md#special%2Dheading)\n")
        self.record()
        self.assertTrue(self.result()["passed"], self.result())

    def test_new_public_document_requires_classification(self):
        self.tracked.append("NEW.md")
        self.assert_issue("unclassified-document")

    def test_missing_heading_and_english_anchor(self):
        self.put("README.es.md", self.read("README.es.md").replace("## Section", "Section"))
        self.record()
        self.assert_issue("heading-structure-mismatch")
        self.assert_issue("missing-english-anchor")

    def test_translated_heading_with_alias_is_valid(self):
        self.put("README.es.md", self.read("README.es.md").replace("## Section", '<a id="section"></a>\n\n## Sección'))
        self.record()
        self.assertTrue(self.result()["passed"], self.result())

    def test_duplicate_ids(self):
        self.put("README.es.md", self.read("README.es.md") + '\n<a id="section"></a>\n')
        self.record()
        self.assert_issue("duplicate-anchor")

    def test_code_mutation_not_hidden_by_review_hash(self):
        self.put("README.es.md", self.read("README.es.md").replace("api();", "bad();"))
        self.record()
        self.assert_issue("fenced-code-mismatch")
        self.assert_issue("missing-code-elements")

    def test_fence_info_string_must_match(self):
        self.put("README.es.md", self.read("README.es.md").replace("```js", "```python"))
        self.record()
        self.assert_issue("fenced-code-mismatch")

    def test_unclosed_fence(self):
        self.put("README.es.md", self.read("README.es.md") + "\n```\n")
        self.record()
        self.assert_issue("invalid-fence")

    def test_table_omission(self):
        self.put("README.es.md", self.read("README.es.md").replace("| A | B |\n", ""))
        self.record()
        self.assert_issue("table-structure-mismatch")

    def test_scaffold_drift(self):
        self.manifest["copies"].append({"source": "copy.md", "canonical": "README.md"})
        self.put("copy.md", self.read("README.md"))
        self.assertTrue(self.result()["passed"], self.result())
        self.put("copy.md", "changed\n")
        self.assert_issue("scaffold-copy-drift")

    def test_unreviewed_source_and_unknown_review(self):
        self.status["reviews"]["unknown.md"] = self.status["reviews"].pop("README.md")
        self.assert_issue("source-review-missing-or-stale")
        self.assert_issue("unknown-review")

    def test_manifest_duplicate_path_or_route_and_traversal(self):
        for field, value in (("source", "../escape.md"), ("site_path", "/escape.md"),
                             ("site_path", "es/index.md"), ("class", "anything")):
            with self.subTest(field=field, value=value):
                manifest = copy.deepcopy(self.manifest)
                manifest["documents"][0][field] = value
                self.put("scripts/docs-i18n.json", json.dumps(manifest))
                with self.assertRaises(ValueError):
                    gate.load_manifest(self.root)
        manifest = copy.deepcopy(self.manifest)
        manifest["documents"].append(dict(manifest["documents"][0]))
        self.put("scripts/docs-i18n.json", json.dumps(manifest))
        with self.assertRaises(ValueError):
            gate.load_manifest(self.root)

    def test_language_omission_cannot_make_gate_pass(self):
        self.manifest["languages"].remove("ja")
        self.put("scripts/docs-i18n.json", json.dumps(self.manifest))
        with self.assertRaises(ValueError):
            gate.load_manifest(self.root)


if __name__ == "__main__":
    unittest.main()
