#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "beautifulsoup4>=4.12",
#     "httpx>=0.27",
#     "pikepdf>=9",
#     "playwright>=1.49",
#     "rich>=13",
#     "sh>=2.0",
#     "typer>=0.12",
# ]
# ///
"""Download Neovim's documentation and typeset it as one organized PDF.

Whitelisted Neovim reference pages and the legacy Vim user-manual chapters are
combined in one book, with separate parts and PDF outline levels. Help links
stay internal when their target is included; other links point to neovim.io.

Examples:

    ./neovim-manual-pdf.py check
    ./neovim-manual-pdf.py build                         # dry run
    ./neovim-manual-pdf.py build --no-dry-run
    ./neovim-manual-pdf.py build -o ~/Documents --no-dry-run
"""

from __future__ import annotations

import html
import logging
import os
import re
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx
import pikepdf
import sh  # House-style dependency for any future external-command integration.
import typer
from bs4 import BeautifulSoup, NavigableString, Tag
from rich.console import Console
from rich.logging import RichHandler
from rich.panel import Panel
from rich.table import Table
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import sync_playwright

BASE_URL = "https://neovim.io"
INDEX_URL = f"{BASE_URL}/doc/user/"
TOC_URL = f"{INDEX_URL}usr_toc/"
USER_DOC_PATH_RE = re.compile(r"^/doc/user(?:/([^/]+?)(?:\.html)?)?/?$")
DEFAULT_OUTPUT_DIR = Path(".")
COMBINED_MANUAL_NAME = "neovim-manual.pdf"
USER_AGENT = "neovim-manual-pdf/1.0 (+personal offline manual builder)"

# Deliberately limited to documents listed in Neovim's main help index. We do
# not recursively pull in filetype guides, legacy plugin manuals, or other
# incidental targets. Cross-references outside this set remain online links.
REFERENCE_WHITELIST = frozenset(
    {
        "help",
        "news", "nvim", "vim_diff", "faq", "tips", "intro", "support", "uganda",
        "helphelp", "quickref", "vimindex", "message",
        "starting", "editing", "motion", "scroll", "insert", "change", "undo",
        "repeat", "visual", "various", "recover",
        "cmdline", "options", "pattern", "map", "tagsrch", "windows", "tabpage",
        "spell", "diff", "fold", "terminal",
        "api", "api-ui-events", "lua-guide", "lua", "luaref", "luvref", "autocmd",
        "job_control", "channel", "vimscript", "vimfn", "remote_plugin", "health",
        "diagnostic", "filetype", "indent", "lsp", "quickfix", "syntax", "treesitter",
        "pack", "tui", "gui", "sign",
        "digraph", "mbyte", "mlang", "rileft", "l10n-arabic", "l10n-hebrew",
        "l10n-russian", "l10n-vietnamese",
        "provider", "if_perl", "if_pyth", "if_ruby",
        "deprecated", "vi_diff",
        "dev", "dev_arch", "dev_style", "dev_test", "dev_theme", "dev_tools",
        "dev_vimpatch", "plugins",
    }
)

log = logging.getLogger("neovim-manual-pdf")
console = Console()
app = typer.Typer(add_completion=False, help=__doc__, no_args_is_help=True)


@dataclass(frozen=True)
class Chapter:
    slug: str
    title: str
    group: str

    @property
    def url(self) -> str:
        if self.slug == "help":
            return INDEX_URL
        return f"{INDEX_URL}{self.slug}/"

    @property
    def number(self) -> str:
        return self.slug.removeprefix("usr_")

    @property
    def heading_label(self) -> str:
        if re.fullmatch(r"usr_\d+", self.slug):
            return f"Chapter {self.number}"
        if self.slug == "help":
            return "Reference index"
        if self.slug == "usr_toc":
            return "User manual contents"
        return f"Reference · {self.slug}"

    @property
    def destination(self) -> str:
        return f"chapter-{self.slug}"


@dataclass(frozen=True)
class ManualPart:
    slug: str
    label: str
    title: str
    subtitle: str
    chapters: tuple[Chapter, ...]

    @property
    def destination(self) -> str:
        return f"part-{self.slug}"


class ManualError(RuntimeError):
    """An expected, user-facing build failure."""


def _setup_logging(log_level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, log_level.upper(), logging.INFO),
        format="%(message)s",
        datefmt="[%H:%M:%S]",
        handlers=[
            RichHandler(
                rich_tracebacks=True,
                show_path=False,
                markup=False,
                keywords=[],
            )
        ],
        force=True,
    )
    logging.getLogger("sh").setLevel(logging.WARNING)
    logging.getLogger("fontTools").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)


def _run(cmd: sh.Command, args: list[str]) -> str:
    """Run an external command via sh and return its standard output."""
    try:
        return str(cmd(*args, _tty_out=False))
    except sh.CommandNotFound as exc:
        raise ManualError(f"Command not found: {cmd}") from exc
    except sh.ErrorReturnCode as exc:
        stderr = (exc.stderr or b"").decode(errors="replace").strip()
        raise ManualError(f"Command failed: {stderr or '(no stderr)'}") from exc


def _client(timeout: float) -> httpx.Client:
    transport = httpx.HTTPTransport(retries=3)
    return httpx.Client(
        follow_redirects=True,
        headers={"User-Agent": USER_AGENT},
        timeout=timeout,
        transport=transport,
    )


def _fetch(client: httpx.Client, url: str) -> str:
    try:
        response = client.get(url)
        response.raise_for_status()
        return response.text
    except httpx.HTTPError as exc:
        raise ManualError(f"Could not download {url}: {exc}") from exc


def _doc_slug(href: str, current_url: str) -> str | None:
    """Return the local help-page slug represented by a Neovim docs URL."""
    parsed = urlparse(urljoin(current_url, href))
    if parsed.netloc != urlparse(BASE_URL).netloc:
        return None
    match = USER_DOC_PATH_RE.match(parsed.path)
    if not match:
        return None
    return match.group(1) or "help"


def _following_title(link: Tag) -> str:
    """Read the prose after a usr_NN link in the overview table."""
    node = link.next_sibling
    while node is not None:
        if isinstance(node, NavigableString):
            for line in str(node).splitlines():
                if title := line.strip(" \t—–-"):
                    return title
        if isinstance(node, Tag) and node.name == "a":
            break
        node = node.next_sibling
    return ""


def _parse_chapters(toc_html: str) -> list[Chapter]:
    soup = BeautifulSoup(toc_html, "html.parser")
    chapters: list[Chapter] = []
    seen: set[str] = set()

    # The compact Overview at the start of usr_toc groups every user-manual
    # chapter under one of these headings.
    for group_heading in soup.select(".help-column_heading"):
        group = group_heading.get_text(" ", strip=True)
        parent = group_heading.parent
        if parent is None:
            continue
        for link in parent.find_all("a", href=True):
            slug = _doc_slug(str(link["href"]), TOC_URL)
            if (
                slug is None
                or not re.fullmatch(r"usr_\d+", slug)
                or slug in seen
            ):
                continue
            title = _following_title(link) or link.get_text(" ", strip=True)
            chapters.append(Chapter(slug=slug, title=title, group=group))
            seen.add(slug)

    if not chapters:
        raise ManualError("The Neovim table-of-contents format was not recognized.")
    return chapters


def _parse_reference_chapters(
    index_html: str, existing_slugs: set[str]
) -> list[Chapter]:
    """Read the categorized reference-page list from the main help index."""
    soup = BeautifulSoup(index_html, "html.parser")
    content = soup.select_one(".help-body .col-wide")
    if content is None:
        raise ManualError("The Neovim reference index format was not recognized.")

    chapters = [Chapter("help", "Nvim documentation", "Reference manual")]
    seen = set(existing_slugs) | {"help"}
    group = ""

    for block in content.find_all(recursive=False):
        heading = block.find("h3") if isinstance(block, Tag) else None
        column_heading = (
            block.select_one(".help-column_heading") if isinstance(block, Tag) else None
        )
        if heading is not None:
            direct_text = heading.find(string=True, recursive=False)
            group = (str(direct_text).strip() if direct_text else "") or heading.get_text(
                " ", strip=True
            )
        elif column_heading is not None:
            group = column_heading.get_text(" ", strip=True)

        if not isinstance(block, Tag) or not group:
            continue
        for link in block.find_all("a", href=True):
            slug = _doc_slug(str(link["href"]), INDEX_URL)
            if slug is None or slug in seen:
                continue
            link_text = link.get_text(" ", strip=True)
            parent_text = link.parent.get_text(" ", strip=True) if link.parent else ""
            title = parent_text
            if title.startswith(link_text):
                title = title[len(link_text) :].strip(" \t—–-")
            title = title or _following_title(link) or link_text or slug
            chapters.append(Chapter(slug, title, group))
            seen.add(slug)
    return chapters


def _page_title(page_html: str, slug: str) -> str:
    soup = BeautifulSoup(page_html, "html.parser")
    heading = soup.select_one(".help-body .col-wide h1")
    if heading is not None and (title := heading.get_text(" ", strip=True)):
        return title
    return slug.replace("_", " ").replace("-", " ").title()


def _download_chapters(
    client: httpx.Client,
    chapters: list[Chapter],
    workers: int,
    strict: bool = True,
) -> dict[str, str]:
    pages: dict[str, str] = {}
    failures: list[str] = []
    log.info("Downloading %d documents with %d workers", len(chapters), workers)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_fetch, client, chapter.url): chapter for chapter in chapters}
        for future in as_completed(futures):
            chapter = futures[future]
            try:
                pages[chapter.slug] = future.result()
                log.debug("Downloaded %s", chapter.url)
            except ManualError as exc:
                failures.append(str(exc))
                (log.error if strict else log.warning)("%s", exc)

    if failures and strict:
        raise ManualError(f"Failed to download {len(failures)} chapter(s).")
    if failures:
        log.warning("Skipping %d unavailable cross-reference page(s)", len(failures))
    return pages


def _download_complete_manual(
    client: httpx.Client,
    initial_chapters: list[Chapter],
    workers: int,
    max_pages: int = 400,
) -> tuple[list[Chapter], dict[str, str]]:
    """Download the manual and follow every cross-reference to another help page."""
    chapters = list(initial_chapters)
    known = {chapter.slug for chapter in chapters}
    pages: dict[str, str] = {}
    pending = list(chapters)

    while pending:
        batch_pages = _download_chapters(
            client, pending, workers, strict=not pages
        )
        pages.update(batch_pages)
        unavailable = {chapter.slug for chapter in pending} - set(batch_pages)
        if unavailable:
            chapters = [chapter for chapter in chapters if chapter.slug not in unavailable]
        downloaded = [chapter for chapter in pending if chapter.slug in batch_pages]
        discovered: list[Chapter] = []

        for chapter in downloaded:
            soup = BeautifulSoup(batch_pages[chapter.slug], "html.parser")
            for link in soup.select(".help-body .col-wide a[href]"):
                slug = _doc_slug(str(link["href"]), chapter.url)
                if slug is None or slug in known:
                    continue
                if len(known) >= max_pages:
                    raise ManualError(
                        f"Stopped after discovering {max_pages} help pages; "
                        "the site may contain a crawl loop."
                    )
                known.add(slug)
                discovered.append(
                    Chapter(
                        slug=slug,
                        title=slug.replace("_", " ").replace("-", " ").title(),
                        group="Additional reference",
                    )
                )

        # Resolve generated page headings before adding newly found documents to
        # the final order and table of contents.
        if discovered:
            log.info("Discovered %d additional cross-reference pages", len(discovered))
        chapters.extend(discovered)
        pending = discovered

    # Main-index descriptions are preferable; only crawled pages need titles
    # inferred from their generated heading.
    initial_count = len(initial_chapters)
    chapters = chapters[:initial_count] + [
        Chapter(chapter.slug, _page_title(pages[chapter.slug], chapter.slug), chapter.group)
        for chapter in chapters[initial_count:]
    ]
    return chapters, pages


def _rewrite_url(
    href: str, current_url: str, included_slugs: set[str]
) -> str:
    absolute = urljoin(current_url, href)
    parsed = urlparse(absolute)
    slug = _doc_slug(href, current_url)

    if slug in included_slugs:
        if parsed.fragment:
            return f"#{slug}--{parsed.fragment}"
        return f"#chapter-{slug}"
    return absolute


def _hide_repeated_tag_headers(content: Tag) -> int:
    """Hide tag-only metadata lines that repeat the definition below them.

    Vim help displays `*tag*` metadata on a line above many option definitions.
    The generated HTML turns those tags into ordinary visible links, making the
    option name look duplicated. IDs remain as zero-height anchors so help links
    still land at the definition.
    """
    changed = 0
    for paragraph in content.select(".old-help-para"):
        children = list(paragraph.contents)
        leading_tags: list[Tag] = []
        whitespace_nodes: list[NavigableString] = []
        boundary_index: int | None = None
        boundary_tail = ""

        for index, node in enumerate(children):
            if isinstance(node, NavigableString):
                text = str(node)
                if "\n" in text:
                    before, boundary_tail = text.split("\n", 1)
                    if before.strip():
                        leading_tags = []
                    boundary_index = index
                    break
                if text.strip():
                    leading_tags = []
                    break
                whitespace_nodes.append(node)
                continue
            if isinstance(node, Tag) and "help-tag" in node.get("class", []):
                leading_tags.append(node)
                continue
            leading_tags = []
            break

        if not leading_tags or boundary_index is None:
            continue

        next_line_parts = [boundary_tail]
        for node in children[boundary_index + 1 :]:
            text = node.get_text("", strip=False) if isinstance(node, Tag) else str(node)
            if "\n" in text:
                next_line_parts.append(text.split("\n", 1)[0])
                break
            next_line_parts.append(text)
        next_line = "".join(next_line_parts)
        tag_names = [tag.get_text(" ", strip=True) for tag in leading_tags]
        if not any(len(name) >= 3 and name in next_line for name in tag_names):
            continue

        for tag in leading_tags:
            tag.clear()
            tag["class"] = ["help-alias"]
        for node in whitespace_nodes:
            node.extract()
        boundary = children[boundary_index]
        if boundary_tail:
            boundary.replace_with(NavigableString(boundary_tail))
        else:
            boundary.extract()
        changed += 1
    return changed


def _hide_repeated_link_columns(content: Tag) -> int:
    """Collapse source rows such as `|c|  c  change` to linked `c  change`.

    In terminal help the first value is a highlighted cross-reference and the
    second is the literal command column. In a PDF they look like an accidental
    duplicate when both values are identical.
    """
    changed = 0
    for link in content.select(".old-help-para > a[href]"):
        token = link.get_text("", strip=True)
        if not token or not isinstance(link.next_sibling, NavigableString):
            continue

        line_prefix = ""
        for previous in link.previous_siblings:
            text = (
                previous.get_text("", strip=False)
                if isinstance(previous, Tag)
                else str(previous)
            )
            if "\n" in text:
                line_prefix = text.rsplit("\n", 1)[1] + line_prefix
                break
            line_prefix = text + line_prefix
        if line_prefix.strip():
            continue

        following = str(link.next_sibling)
        pattern = rf"^[ \t]+{re.escape(token)}(?=[ \t]+)"
        collapsed, replacements = re.subn(pattern, "", following, count=1)
        if replacements:
            link.next_sibling.replace_with(NavigableString(collapsed))
            changed += 1
    return changed


def _chapter_body(
    chapter: Chapter, page_html: str, included_slugs: set[str]
) -> str:
    soup = BeautifulSoup(page_html, "html.parser")
    content = soup.select_one(".help-body .col-wide")
    if content is None:
        raise ManualError(f"Could not find manual content in {chapter.url}")

    # Discard the website's generated title/source preamble. The original help
    # text begins immediately after this direct-child horizontal rule.
    separator = content.find("hr", recursive=False)
    if separator is not None:
        aliases: list[str] = []
        for child in list(content.contents):
            if isinstance(child, Tag):
                elements = [child, *child.find_all(True)]
                for element in elements:
                    for attribute in ("id", "name"):
                        if element.has_attr(attribute):
                            value = str(element[attribute])
                            if value not in aliases:
                                aliases.append(value)
            child.extract()
            if child is separator:
                break
        # Generated page titles carry important primary help tags (for example
        # `options.txt` and the first usr_NN section). Keep those destinations
        # even though the website title/source boilerplate itself is omitted.
        for alias in reversed(aliases):
            anchor = soup.new_tag("span")
            anchor["id"] = alias
            anchor["class"] = "help-alias"
            content.insert(0, anchor)

    prefix = f"{chapter.slug}--"
    used_ids: dict[str, int] = {}
    for element in content.find_all(True):
        if element.has_attr("id"):
            base_id = prefix + str(element["id"])
            used_ids[base_id] = used_ids.get(base_id, 0) + 1
            element["id"] = (
                base_id
                if used_ids[base_id] == 1
                else f"{base_id}--duplicate-{used_ids[base_id]}"
            )
        if element.has_attr("name"):
            original_name = str(element["name"])
            element["name"] = prefix + original_name
            if not element.has_attr("id"):
                base_id = prefix + original_name
                used_ids[base_id] = used_ids.get(base_id, 0) + 1
                element["id"] = (
                    base_id
                    if used_ids[base_id] == 1
                    else f"{base_id}--duplicate-{used_ids[base_id]}"
                )
        if element.has_attr("href"):
            element["href"] = _rewrite_url(
                str(element["href"]), chapter.url, included_slugs
            )
        if element.has_attr("src"):
            element["src"] = urljoin(chapter.url, str(element["src"]))

    hidden_tag_headers = _hide_repeated_tag_headers(content)
    collapsed_link_columns = _hide_repeated_link_columns(content)
    if hidden_tag_headers or collapsed_link_columns:
        log.debug(
            "Collapsed %d tag headers and %d duplicate link columns in %s",
            hidden_tag_headers,
            collapsed_link_columns,
            chapter.slug,
        )

    # The online renderer doubles source newlines inside <pre>, which inserts a
    # blank row between every line of terminal screenshots and ASCII diagrams.
    # One collapse pass restores source line spacing while retaining deliberate
    # blank lines (four generated newlines become two).
    for preformatted in content.find_all("pre"):
        for text_node in list(preformatted.find_all(string=True)):
            normalized = str(text_node).replace("\r\n", "\n").replace("\n\n", "\n")
            if normalized != str(text_node):
                text_node.replace_with(NavigableString(normalized))

    # Reserve h1 for parts and h2 for document titles. Source sections begin at
    # h3, producing a useful Part > document > section hierarchy in PDF readers.
    for heading in content.find_all(re.compile(r"^h[2-5]$")):
        level = int(heading.name[1])
        heading.name = f"h{level + 1}"

    return content.decode_contents()


def _toc_markup(parts: list[ManualPart]) -> str:
    part_sections: list[str] = []
    for part in parts:
        groups: dict[str, list[Chapter]] = {}
        for chapter in part.chapters:
            groups.setdefault(chapter.group, []).append(chapter)

        sections: list[str] = []
        for group, entries in groups.items():
            items = "\n".join(
                '<li><a href="#{destination}"><span class="toc-number">{number}</span>'
                '<span class="toc-title">{title}</span></a></li>'.format(
                    destination=html.escape(chapter.destination, quote=True),
                    number=html.escape(chapter.number),
                    title=html.escape(chapter.title),
                )
                for chapter in entries
            )
            sections.append(
                f'<section class="toc-group"><h3>{html.escape(group)}</h3>'
                f"<ol>{items}</ol></section>"
            )
        part_sections.append(
            f'<section class="toc-part"><h2><a href="#{part.destination}">'
            f'<span class="toc-part-label">{html.escape(part.label)}</span>'
            f'{html.escape(part.title)}</a></h2>{"".join(sections)}</section>'
        )
    return "\n".join(part_sections)


def _document(
    parts: list[ManualPart],
    pages: dict[str, str],
    source_url: str,
    title: str,
    subtitle: str,
) -> str:
    chapters = [chapter for part in parts for chapter in part.chapters]
    included_slugs = {chapter.slug for chapter in chapters}
    article_markup: list[str] = []
    for part in parts:
        article_markup.append(
            f'<section class="part-divider" id="{part.destination}">'
            f'<div class="part-label">{html.escape(part.label)}</div>'
            f'<h1>{html.escape(part.title)}</h1>'
            f'<p>{html.escape(part.subtitle)}</p></section>'
        )
        for chapter in part.chapters:
            body = _chapter_body(chapter, pages[chapter.slug], included_slugs)
            article_markup.append(
                f'<article class="chapter" id="{chapter.destination}">'
                f'<div class="chapter-number">{html.escape(chapter.heading_label)}</div>'
                f'<h2 class="chapter-title">{html.escape(chapter.title)}</h2>'
                f'{body}</article>'
            )

    assembled_articles = "".join(article_markup)
    known_ids = {
        html.unescape(value)
        for value in re.findall(r'\bid="([^"]+)"', assembled_articles)
    }
    link_targets = {
        html.unescape(value)
        for value in re.findall(r'\bhref="#([^"]+)"', assembled_articles)
    }
    missing_targets = link_targets - known_ids
    for chapter in chapters:
        prefix = f"{chapter.slug}--"
        aliases = sorted(target for target in missing_targets if target.startswith(prefix))
        if not aliases:
            continue
        opening = f'<article class="chapter" id="{chapter.destination}">'
        fallback_anchors = "".join(
            f'<span class="help-alias" id="{html.escape(alias, quote=True)}"></span>'
            for alias in aliases
        )
        assembled_articles = assembled_articles.replace(
            opening, opening + fallback_anchors, 1
        )
    if missing_targets:
        log.debug(
            "Added %d fallback destinations for upstream help links without anchors",
            len(missing_targets),
        )

    generated = datetime.now(UTC).strftime("%Y-%m-%d")
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="author" content="Neovim contributors and Bram Moolenaar">
<meta name="description" content="{html.escape(subtitle, quote=True)}">
<title>{html.escape(title)}</title>
<style>
@page {{
  size: A4;
  margin: 16mm 15mm 17mm;
  @top-left {{ content: string(chapter); color: #53606b; font-size: 8pt; }}
  @top-right {{ content: "{html.escape(title)}"; color: #53606b; font-size: 8pt; }}
  @bottom-center {{ content: counter(page); color: #53606b; font-size: 8pt; }}
}}
@page cover {{
  margin: 20mm;
  @top-left {{ content: none; }} @top-right {{ content: none; }}
  @bottom-center {{ content: none; }}
}}
@page contents {{
  @top-left {{ content: "Contents"; }}
}}
:root {{ --green: #3f7d20; --blue: #245b84; --ink: #17212b; }}
* {{ box-sizing: border-box; }}
html {{ color: var(--ink); font: 9pt/1.34 sans-serif; }}
body {{ margin: 0; }}
a {{ color: var(--blue); text-decoration: none; }}
a:hover {{ text-decoration: underline; }}
.cover {{ page: cover; height: 245mm; display: flex; flex-direction: column;
          justify-content: center; text-align: center; break-after: page; }}
.cover h1 {{ color: var(--green); font-size: 34pt; margin: 0 0 8mm; bookmark-level: none; }}
.cover .subtitle {{ font-size: 16pt; color: #53606b; }}
.cover .source {{ margin-top: 35mm; font-size: 8.5pt; }}
.contents {{ page: contents; break-after: page; }}
.contents > h1 {{ color: var(--green); font-size: 25pt; bookmark-level: 1;
                  bookmark-label: "Table of contents"; }}
.toc-part > h2 {{ color: var(--green); font-size: 15pt; margin: 7mm 0 2mm; }}
.toc-part > h2 a {{ color: inherit; }}
.toc-part-label {{ display: block; color: #687680; font-size: 8pt;
                   letter-spacing: 0.08em; text-transform: uppercase; }}
.toc-group {{ break-inside: avoid; margin: 0 0 5mm 5mm; }}
.toc-group h3 {{ border: 0; color: var(--blue); font-size: 11pt; margin: 4mm 0 1mm; }}
.toc-group ol {{ list-style: none; margin: 0; padding: 0; }}
.toc-group li {{ margin: 0.6mm 0; }}
.toc-group a {{ display: block; color: var(--ink); }}
.toc-group a {{ border-bottom: 0.5pt dotted #b8c0c7; }}
.toc-number {{ display: inline-block; width: 34mm; color: var(--blue);
               font: 7.5pt ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }}
.toc-title {{ padding-right: 2mm; }}
.part-divider {{ break-before: page; break-after: page; min-height: 240mm;
                 display: flex; flex-direction: column; justify-content: center; }}
.part-divider .part-label {{ color: #687680; font-size: 10pt; letter-spacing: 0.12em;
                            text-transform: uppercase; }}
.part-divider h1 {{ color: var(--green); font-size: 30pt; line-height: 1.08;
                    margin: 3mm 0 5mm; }}
.part-divider p {{ color: #53606b; font-size: 13pt; max-width: 130mm; }}
.chapter {{ break-before: page; }}
.chapter > h2.chapter-title {{ string-set: chapter content(); color: var(--green);
                 font-size: 22pt; line-height: 1.08; margin: 0 0 8mm;
                 border-bottom: 1.2pt solid var(--green); padding-bottom: 3mm; }}
.chapter-number {{ color: #687680; font-size: 9pt; font-weight: normal;
                   letter-spacing: 0.08em; margin-bottom: 1.5mm; text-transform: uppercase; }}
h2, h3, h4, h5, h6 {{ font-family: sans-serif; break-after: avoid; }}
h3 {{ color: var(--green); font-size: 14pt; line-height: 1.18;
      border-bottom: 0.5pt solid #9bb58d; margin: 7mm 0 2.5mm; padding-bottom: 1mm; }}
h4 {{ color: var(--blue); font-size: 11.5pt; margin: 5mm 0 2mm; }}
h5, h6 {{ font-size: 10pt; margin: 4mm 0 1.5mm; }}
.old-help-para {{ padding: 1.1mm 0; tab-size: 8; white-space: pre-wrap;
                  font: 8.1pt/1.16 "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
                  font-variant-ligatures: none; overflow-wrap: anywhere;
                  counter-reset: manual-list; }}
.help-para {{ padding: 1.3mm 0; counter-reset: manual-list; }}
.help-li {{ display: list-item; margin-left: 6mm; white-space: normal; }}
.help-li-num {{ display: list-item; list-style: none; margin-left: 6mm; white-space: normal; }}
.help-li-num::before {{ margin-left: -4mm; counter-increment: manual-list;
                        content: counter(manual-list) ". "; }}
.help-heading {{ display: flex; flex-flow: row wrap; justify-content: space-between; gap: 0 4mm;
                 white-space: normal; }}
.help-heading-tags {{ font-size: 8pt; font-weight: normal; }}
.help-alias {{ display: block; height: 0; overflow: hidden; }}
.help-tag, .help-tag-right {{ color: var(--green); }}
.help-tag-right {{ display: block; float: right; margin-left: auto; }}
code, pre {{ font-family: "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
             font-variant-ligatures: none; }}
code {{ color: #165b51; font-size: 8.1pt; }}
pre, .old-help-para pre {{ white-space: pre-wrap; overflow-wrap: anywhere; font-size: 7.6pt;
                           line-height: 1.04; margin: 1.5mm 0; tab-size: 8;
                           break-inside: avoid; letter-spacing: 0; word-spacing: 0; }}
img, svg {{ max-width: 100%; }}
p, pre, .old-help-para, .help-para {{ orphans: 3; widows: 3; }}
</style>
</head>
<body>
<section class="cover">
  <h1>{html.escape(title)}</h1>
  <div class="subtitle">{html.escape(subtitle)}</div>
  <div class="source">Built {generated} from<br><a href="{html.escape(source_url, quote=True)}">{html.escape(source_url)}</a></div>
</section>
<nav class="contents" id="toc">
  <h1>Contents</h1>
  {_toc_markup(parts)}
</nav>
{assembled_articles}
</body>
</html>
"""


def _set_paper(document: str, paper: str) -> tuple[str, str]:
    normalized = {"a4": "A4", "letter": "Letter"}.get(paper.lower())
    if normalized is None:
        raise ManualError("--paper must be either 'A4' or 'Letter'.")
    return document.replace("size: A4;", f"size: {normalized};", 1), normalized


def _render_pdf(
    document: str,
    destination: Path,
    paper: str,
    install_browser: bool,
) -> None:
    """Render HTML with Chromium, preserving links and creating PDF bookmarks."""
    with tempfile.TemporaryDirectory(prefix="neovim-manual-render-") as temp_dir:
        html_path = Path(temp_dir) / "manual.html"
        html_path.write_text(document, encoding="utf-8")

        with sync_playwright() as playwright:
            try:
                browser = playwright.chromium.launch(headless=True)
            except PlaywrightError as first_error:
                if not install_browser or "Executable doesn't exist" not in str(first_error):
                    raise ManualError(
                        "Chromium is not installed for Playwright. Run "
                        "'./neovim-manual-pdf.py install-browser'."
                    ) from first_error
                log.info("Chromium is not installed; downloading it now")
                _run(sh.playwright, ["install", "chromium"])
                try:
                    browser = playwright.chromium.launch(headless=True)
                except PlaywrightError as exc:
                    raise ManualError(f"Could not launch Chromium: {exc}") from exc

            try:
                page = browser.new_page()
                # Waiting for the full load event can stall on a very large
                # document. The final article is a reliable DOM-complete marker.
                page.goto(html_path.as_uri(), wait_until="commit", timeout=30_000)
                page.wait_for_selector(
                    "article.chapter:last-of-type",
                    state="attached",
                    timeout=180_000,
                )
                page.emulate_media(media="print")
                page.pdf(
                    path=str(destination),
                    format=paper,
                    print_background=True,
                    prefer_css_page_size=True,
                    outline=True,
                    tagged=True,
                )
            except PlaywrightError as exc:
                raise ManualError(f"Chromium could not render the PDF: {exc}") from exc
            finally:
                browser.close()

        # Chromium emits hundreds of thousands of tiny, uncompressed PDF
        # objects for the accessibility tree, bookmarks, and link annotations.
        # Packing them into object streams preserves those features while
        # substantially reducing the file size.
        optimized = destination.with_name(f"{destination.stem}.optimized.pdf")
        try:
            with pikepdf.open(destination) as pdf:
                pdf.save(
                    optimized,
                    compress_streams=True,
                    recompress_flate=True,
                    object_stream_mode=pikepdf.ObjectStreamMode.generate,
                )
            os.replace(optimized, destination)
        finally:
            optimized.unlink(missing_ok=True)


def _summary(
    user_count: int,
    reference_count: int,
    outputs: list[Path],
    dry_run: bool,
) -> None:
    lines = [
        f"Vim user-manual chapters: {user_count}",
        f"Whitelisted Neovim references: {reference_count}",
    ]
    for output in outputs:
        detail = f"PDF: {output}"
        if not dry_run and output.exists():
            detail += f" ({output.stat().st_size / (1024 * 1024):.1f} MiB)"
        lines.append(detail)
    lines.append("Result: dry run; no files written" if dry_run else "Result: complete")
    console.print(Panel.fit("\n".join(lines), title="Neovim manual"))


@app.command()
def check(
    show_chapters: bool = typer.Option(
        False, "--show-chapters", help="Print the discovered document list."
    ),
    timeout: float = typer.Option(30.0, min=1.0, help="HTTP timeout in seconds."),
    log_level: str = typer.Option("INFO", help="Python logging level."),
) -> None:
    """Check the online indexes and report documents explicitly listed there."""
    _setup_logging(log_level)
    try:
        with _client(timeout) as client:
            user_chapters = _parse_chapters(_fetch(client, TOC_URL))
            indexed_references = _parse_reference_chapters(
                _fetch(client, INDEX_URL), {chapter.slug for chapter in user_chapters}
            )
            reference_chapters = [
                chapter
                for chapter in indexed_references
                if chapter.slug in REFERENCE_WHITELIST
            ]
            chapters = user_chapters + reference_chapters
    except ManualError as exc:
        log.error("%s", exc)
        raise typer.Exit(code=1) from exc

    log.info(
        "Found %d Vim user chapters and %d whitelisted Neovim references",
        len(user_chapters),
        len(reference_chapters),
    )
    if show_chapters:
        table = Table("Document", "Section", "Title", box=None)
        for chapter in chapters:
            table.add_row(chapter.number, chapter.group, chapter.title)
        console.print(table)


@app.command("install-browser")
def install_browser(
    log_level: str = typer.Option("INFO", help="Python logging level."),
) -> None:
    """Install the headless Chromium used to render PDFs."""
    _setup_logging(log_level)
    log.info("Installing Playwright Chromium")
    try:
        _run(sh.playwright, ["install", "chromium"])
    except ManualError as exc:
        log.error("%s", exc)
        raise typer.Exit(code=1) from exc
    log.info("Chromium is ready")


@app.command()
def build(
    output_dir: Path = typer.Option(
        DEFAULT_OUTPUT_DIR,
        "--output-dir",
        "-o",
        help="Directory for the generated PDF.",
    ),
    paper: str = typer.Option("A4", help="Paper size: A4 or Letter."),
    workers: int = typer.Option(8, min=1, max=16, help="Parallel download count."),
    timeout: float = typer.Option(30.0, min=1.0, help="HTTP timeout in seconds."),
    keep_html: bool = typer.Option(
        False, "--keep-html", help="Also save the assembled HTML document."
    ),
    install_browser: bool = typer.Option(
        True,
        "--install-browser/--no-install-browser",
        help="Download Playwright Chromium if it is missing. Default: on.",
    ),
    dry_run: bool = typer.Option(
        True,
        "--dry-run/--no-dry-run",
        help="Preview without downloading chapters or writing files. Default: on.",
    ),
    log_level: str = typer.Option("INFO", help="Python logging level."),
) -> None:
    """Build one manual with separate Neovim and legacy Vim parts."""
    _setup_logging(log_level)
    output_dir = output_dir.expanduser().resolve()
    output = output_dir / COMBINED_MANUAL_NAME
    outputs = [output]

    try:
        with _client(timeout) as client:
            user_chapters = _parse_chapters(_fetch(client, TOC_URL))
            indexed_references = _parse_reference_chapters(
                _fetch(client, INDEX_URL), {chapter.slug for chapter in user_chapters}
            )
            reference_chapters = [
                chapter
                for chapter in indexed_references
                if chapter.slug in REFERENCE_WHITELIST
            ]
            found_references = {chapter.slug for chapter in reference_chapters}
            missing_whitelist = REFERENCE_WHITELIST - found_references
            if missing_whitelist:
                log.warning(
                    "Whitelisted references absent from the online index: %s",
                    ", ".join(sorted(missing_whitelist)),
                )

            log.info(
                "Selected %d Vim user chapters and %d Neovim references",
                len(user_chapters),
                len(reference_chapters),
            )
            if dry_run:
                log.info("WOULD write %s", output)
                if keep_html:
                    log.info("WOULD also write %s", output.with_suffix(".html"))
                _summary(
                    len(user_chapters),
                    len(reference_chapters),
                    outputs,
                    dry_run=True,
                )
                return

            pages = _download_chapters(
                client, user_chapters + reference_chapters, workers
            )

        log.info("Assembling Neovim and legacy Vim parts")
        parts = [
            ManualPart(
                slug="neovim-reference",
                label="Part I — Neovim",
                title="Neovim Reference Manual",
                subtitle="Whitelisted reference pages maintained by the Neovim project.",
                chapters=tuple(reference_chapters),
            ),
            ManualPart(
                slug="vim-user-manual",
                label="Part II — Legacy Vim",
                title="Vim User Manual",
                subtitle=(
                    "Legacy task-oriented Vim chapters shipped with Neovim. "
                    "This part is retained for editing fundamentals and is clearly "
                    "separated from Neovim-native reference material."
                ),
                chapters=tuple(user_chapters),
            ),
        ]
        document, normalized_paper = _set_paper(
            _document(
                parts,
                pages,
                INDEX_URL,
                "Neovim Manual",
                "Neovim reference documentation with the legacy Vim user manual as a separate part",
            ),
            paper,
        )
        output_dir.mkdir(parents=True, exist_ok=True)

        if keep_html:
            html_output = output.with_suffix(".html")
            html_output.write_text(document, encoding="utf-8")
            log.info("Wrote %s", html_output)

        log.info("Rendering %s", output.name)
        with tempfile.TemporaryDirectory(prefix="neovim-manual-") as temp_dir:
            temporary_pdf = Path(temp_dir) / output.name
            _render_pdf(
                document,
                temporary_pdf,
                normalized_paper,
                install_browser,
            )
            os.replace(temporary_pdf, output)
        log.info("Wrote %s", output)

        _summary(
            len(user_chapters),
            len(reference_chapters),
            outputs,
            dry_run=False,
        )
    except (ManualError, OSError) as exc:
        log.error("%s", exc)
        raise typer.Exit(code=1) from exc
    except Exception as exc:
        log.error("PDF rendering failed: %s", exc)
        log.debug("Rendering traceback", exc_info=True)
        raise typer.Exit(code=1) from exc


if __name__ == "__main__":
    app()
