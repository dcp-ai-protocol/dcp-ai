"""MkDocs link routing and equivalent-page language selector (no plugin install)."""
import sys
from pathlib import Path

from markdown.extensions import Extension
from markdown.treeprocessors import Treeprocessor

sys.path.insert(0, str(Path(__file__).resolve().parent))
from docs_i18n import load_manifest, localized
from docs_site import html_language, language_selector, relative_site_links, rewrite_link, site_markdown

ROOT = Path(__file__).resolve().parents[1]
manifest = None
current_doc = None
locale = None


class LinkProcessor(Treeprocessor):
    def run(self, tree):
        for node in tree.iter():
            attr = "src" if node.tag == "img" else "href" if node.tag == "a" else None
            if attr and node.get(attr):
                node.set(attr, rewrite_link(ROOT, manifest, current_doc, locale, node.get(attr), image=node.tag == "img"))


class RepoLinks(Extension):
    def extendMarkdown(self, md):
        # Inline links have become elements (20); run before MkDocs relpath (0).
        md.treeprocessors.register(LinkProcessor(md), "dcp_repo_links", 1)


def on_config(config):
    global manifest, locale
    manifest = load_manifest(ROOT)
    locale = config["extra"]["docs_locale"]
    config["markdown_extensions"].append(RepoLinks())
    return config


def on_page_markdown(markdown, page, config, files):
    global current_doc
    current_doc = next(d for d in manifest["documents"] if d["site_path"] == page.file.src_uri)
    # Edit links must point to canonical source files, not the build staging tree.
    page.edit_url = config["repo_url"].rstrip("/") + "/edit/main/" + localized(current_doc["source"], locale)
    # The GitHub header uses a centered HTML div without Markdown's opt-in.
    # Enable only this presentation wrapper on the site, without editing sources.
    return site_markdown(markdown, current_doc["source"])


def on_page_content(html, page, config, files):
    return language_selector(locale, page.file.src_uri) + relative_site_links(html, locale, page.file.src_uri)


def on_post_page(output, page, config):
    return html_language(output, locale)


def on_post_template(output, template_name, config):
    return html_language(output, locale)
