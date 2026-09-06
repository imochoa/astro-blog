# AGENTS.md

## Scope

This file applies to the Neovim manual builder in this directory.

- Source: `neovim-manual-pdf.py`
- Generated HTML: `neovim-manual.html`
- Generated PDF: `neovim-manual.pdf`
- Compatibility symlink: `../neovim-manual-pdf.py`

Edit the script here, not the parent-directory symlink. The HTML and PDF are build artifacts and must not be edited by hand.

## What this project does

`neovim-manual-pdf.py` is a standalone PEP 723 uv script. It downloads Neovim's generated online help, combines selected documents into one PDF, preserves help-tag links, and creates a navigable PDF outline.

The book has two explicit parts:

1. **Part I: Neovim reference manual**
   - Documents listed by Neovim's main online help index.
   - Limited by `REFERENCE_WHITELIST`.
   - Recursive crawling is intentionally disabled.
2. **Part II: legacy Vim user manual**
   - The `usr_NN` chapters listed by `usr_toc`.
   - Kept because Neovim ships these task-oriented editing chapters.
   - Separated from Part I by its own title page, table-of-contents section, and PDF outline level.

"Neovim reference" means the reference set published and indexed by the Neovim project. Some core editing documents originated in Vim; the separate Part II label specifically distinguishes the old `usr_NN` tutorial chapters.

The current source indexes normally yield 81 whitelisted reference documents and 31 user-manual chapters. Treat those numbers as a sanity check, not a permanent assertion.

## Commands

Run commands from this directory so the default output lands here.

```bash
./neovim-manual-pdf.py                 # command help
./neovim-manual-pdf.py check
./neovim-manual-pdf.py check --show-chapters
./neovim-manual-pdf.py build           # dry run, writes nothing
./neovim-manual-pdf.py build --no-dry-run
./neovim-manual-pdf.py build --keep-html --no-dry-run
./neovim-manual-pdf.py install-browser
```

The build is deliberately dry-run by default. A real build downloads the selected pages, renders the PDF with Playwright Chromium, then rewrites the PDF with pikepdf.

Dependencies are declared in the script's PEP 723 header. Do not add a virtualenv, `requirements.txt`, or separate package project unless the project is intentionally being redesigned.

## Why the implementation looks like this

This started as a small user-manual downloader. Several issues only became obvious after printing the generated HTML:

- A user-manual-only build left most help links pointing at the website.
- Recursively crawling every help link produced a 1,997-page book containing unrelated filetype, plugin, and legacy reference pages.
- Combining the old `usr_NN` chapters with reference documents made it hard to tell which material was Neovim-specific.
- Vim help uses visible tag metadata and repeated table columns that make sense in a terminal but look like accidental duplication in print.
- Neovim's HTML generator doubles newlines in many `<pre>` blocks, which breaks ASCII screenshots.
- Chromium's tagged PDF output contained about 248,000 small objects and initially occupied roughly 41 MiB.

The current design is the compromise that worked:

- Use the main Neovim index plus an explicit whitelist instead of crawling.
- Include the legacy user manual, but put it in a separate part.
- Build from Neovim's generated HTML rather than writing a complete Vim help parser.
- Keep semantic headings, PDF tags, bookmarks, and clickable links.
- Post-process Chromium's PDF into compressed object streams.

## Pipeline and architecture

### 1. Discover documents

`_parse_chapters()` reads `https://neovim.io/doc/user/usr_toc/` and returns the `usr_NN` chapters in source order.

`_parse_reference_chapters()` reads `https://neovim.io/doc/user/` and assigns indexed documents to the site's categories, such as API, UI, and Advanced editing.

The build filters those indexed references through `REFERENCE_WHITELIST`. To add or remove a reference document, change that constant. Do not restore recursive discovery unless the user explicitly asks for a much larger book.

### 2. Download source pages

`_download_chapters()` downloads pages concurrently with a small thread pool. HTTP requests use `httpx` with redirects, retries, a timeout, and a descriptive user agent.

Download failures are fatal for selected documents. This is preferable to silently generating a book with a missing whitelisted chapter.

### 3. Extract and normalize each page

`_chapter_body()` selects `.help-body .col-wide`, removes the website title/source boilerplate, and retains the actual help body.

The removed preamble contains important primary tags on some pages. Before discarding it, the script copies its IDs and names into zero-height `.help-alias` anchors. Without this step, links such as `usr_02.txt`, `02.1`, and primary `*.txt` tags have no destination.

Every page gets an ID namespace based on its slug:

```text
options + 'swapfile' -> options--'swapfile'
usr_02 + 02.2        -> usr_02--02.2
```

This avoids collisions when independent HTML pages are merged. Duplicate IDs within an upstream page get a deterministic `--duplicate-N` suffix.

### 4. Rewrite links

`_rewrite_url()` resolves every link against its source page.

- A target included in the combined book becomes an internal `#slug--tag` link.
- An included page without a fragment points to `#chapter-slug`.
- A target outside the whitelist remains an absolute `https://neovim.io/...` URL.
- Non-Neovim links remain external.

After all articles are assembled, `_document()` checks for internal fragment links that lack an upstream anchor. It inserts a fallback destination at the start of the appropriate document. This is a safety net for omissions in Neovim's generated HTML, not a substitute for preserving real tag locations.

Never remove the final missing-target pass without replacing it with an equivalent validation strategy.

### 5. Fix terminal-help artifacts

The script has a few narrow transformations for Vim help syntax. They should remain conservative.

#### Repeated tag headers

Vim option definitions often look like this in the source:

```text
                        *'swapfile'* *'swf'* *'noswapfile'* *'noswf'*
'swapfile' 'swf'        boolean (default on)
```

The first line is tag metadata. Terminal highlighting distinguishes it from the definition, but generated HTML makes both lines look like ordinary text. `_hide_repeated_tag_headers()` hides the repeated first line while retaining each ID as a zero-height anchor.

#### Repeated linked table columns

Some source tables use a help link followed by the literal command:

```text
|c|    c    change
```

That is useful in `:help`, where the first `c` is visibly a link. In print it looks like `c c change`. `_hide_repeated_link_columns()` collapses identical link/command columns to one linked value.

Do not apply general text deduplication. Repeated words are often meaningful in command syntax. These functions only act on known DOM structures at the start of source rows.

#### Doubled preformatted newlines

Neovim's generated HTML often turns each source newline in `<pre>` into two newlines. An ASCII screen drawing therefore gets a blank row between every real row. `_chapter_body()` performs one newline-collapse pass on text nodes inside `<pre>`:

- Two generated newlines become one source newline.
- Four generated newlines become two, preserving an intentional blank row.

The print CSS then uses a compact monospace font, disables ligatures, preserves tabs, and uses a line height close to 1.0.

### 6. Build the book structure

`ManualPart` describes the two top-level parts. `_document()` creates:

- A cover.
- A linked table of contents grouped first by part, then by source category.
- A divider page for each part.
- A title page boundary for every source document.
- Namespaced help anchors and rewritten links.

Heading levels are structural:

- `h1`: part title.
- `h2`: source-document title.
- `h3` and below: sections from the source help page.

`_chapter_body()` demotes source headings by one level so PDF readers show a useful Part > document > section outline. Chromium does not reliably honor CSS `bookmark-level`; the HTML heading levels matter.

Part I comes first. Part II is labeled "Legacy Vim" in both the table of contents and its divider page.

### 7. Render with Chromium

`_render_pdf()` writes temporary HTML and opens it with Playwright Chromium.

It waits for `article.chapter:last-of-type` rather than the full `load` event. A full-load wait can stall on a document this large even when the DOM is ready.

The PDF call uses:

- `outline=True` for bookmarks.
- `tagged=True` for the accessibility structure and reliable Chromium outlines.
- `prefer_css_page_size=True` so A4 or Letter comes from the generated CSS.
- `print_background=True` for print colors.

Page numbers and running headers come from CSS `@page` margin boxes. Do not also enable Playwright's `display_header_footer`; doing both prints the page number twice.

### 8. Compress the PDF

The document is text-heavy, but it contains tens of thousands of links plus a tagged accessibility tree. Chromium writes those as hundreds of thousands of small PDF objects. The unoptimized combined book was much larger than its stream data justified.

After rendering, pikepdf saves the document with compressed streams and generated object streams. This preserves:

- Clickable internal and external links.
- PDF bookmarks.
- Tagged accessibility data.
- Metadata and page layout.

At the time of writing, the combined book is about 1,464 pages and 13 MiB. Counts and size will move as upstream documentation changes.

## Formatting rules worth preserving

The current print styles are tuned for terminal documentation:

- `.old-help-para` is monospace with `tab-size: 8`.
- Ligatures are disabled so command sequences and ASCII diagrams stay literal.
- `<pre>` has a line height near 1.0 and avoids page breaks where possible.
- Long preformatted lines may wrap rather than run outside the printable area.
- Help tags use green; links use blue.
- Part and document titles use sans-serif headings.

When adjusting fonts, inspect an ASCII UI drawing, an options page, a Lua code block, and a dense command table. A change that improves prose can easily break column alignment.

## Validation checklist

Run a real build after changes that affect parsing, links, headings, CSS, or PDF output:

```bash
./neovim-manual-pdf.py check --show-chapters
./neovim-manual-pdf.py build --keep-html --no-dry-run
```

Check these invariants:

- The build selects the expected user and reference counts.
- `neovim-manual.html` has two `.part-divider` elements.
- Part I is Neovim reference material; Part II is legacy Vim material.
- There are no duplicate HTML IDs.
- Every internal `href="#..."` has a matching ID.
- Cross-references outside `REFERENCE_WHITELIST` are absolute online URLs.
- PDF page numbers appear once, not twice.
- The PDF has an outline and `/StructTreeRoot`.
- Links still exist after pikepdf optimization.
- The `swapfile` option header is not printed twice.
- The operator table prints `c change`, not `c c change`.
- The UI drawing in `usr_02` has no blank line between every row.

A quick HTML integrity check can be run with:

```bash
uv run --with beautifulsoup4 python - <<'PY'
from bs4 import BeautifulSoup
from pathlib import Path

soup = BeautifulSoup(Path("neovim-manual.html").read_text(), "html.parser")
ids = [node["id"] for node in soup.select("[id]")]
known = set(ids)
missing = [
    link["href"]
    for link in soup.select('a[href^="#"]')
    if link["href"][1:] and link["href"][1:] not in known
]
print("parts:", len(soup.select(".part-divider")))
print("documents:", len(soup.select("article.chapter")))
print("duplicate IDs:", len(ids) - len(known))
print("missing internal targets:", len(missing))
PY
```

A quick PDF structure check can be run with:

```bash
uv run --with pikepdf python - <<'PY'
import os
import pikepdf

path = "neovim-manual.pdf"
with pikepdf.open(path) as pdf:
    links = sum(len(page.get("/Annots", [])) for page in pdf.pages)
    print("size MiB:", round(os.path.getsize(path) / 2**20, 2))
    print("pages:", len(pdf.pages))
    print("outline:", "/Outlines" in pdf.Root)
    print("tagged:", "/StructTreeRoot" in pdf.Root)
    print("annotations:", links)
PY
```

Do not hard-code the page count or file size in tests.

## Known upstream quirks

- The HTML structure depends on Neovim's `gen_help_html.lua` output. Recheck selectors if `.help-body .col-wide` or the generated preamble changes.
- A help link can exist even when the website does not publish its target page. Targets outside the whitelist remain online by design.
- Some upstream pages contain duplicate heading IDs. The script namespaces and deduplicates them.
- Some tags referenced by source links are absent from generated HTML. Fallback aliases keep those links inside the correct document.
- Generated timestamps and revisions come from neovim.io and may not match a locally installed Neovim version.

## Safe ways to change the project

### Add a reference page

1. Confirm that neovim.io publishes `/doc/user/<slug>/`.
2. Add `<slug>` to `REFERENCE_WHITELIST`.
3. Run `check --show-chapters` and make sure it appears under the expected category.
4. Rebuild and run the link validation.

### Change the part ordering or labels

Edit the `ManualPart` declarations in `build()`. Keep machine-safe `slug` values because they become HTML IDs.

### Change link behavior

Start with `_doc_slug()` and `_rewrite_url()`. Test both fragment links and links to whole pages. Preserve the rule that only included documents become internal links.

### Change source cleanup

Make structural DOM changes in `_chapter_body()` or one of its narrowly named helpers. Avoid broad regular expressions over the final HTML. Always retain source IDs before deleting or hiding visible text.

### Change PDF rendering

Keep rendering atomic: write to a temporary path and replace the destination only after Chromium and pikepdf finish. A failed build should not leave a partial PDF at the final path.

## House style

- Keep this as a single executable uv script.
- Keep Typer help-on-no-args behavior.
- Use stdlib logging through `RichHandler`.
- Use `sh` for external commands.
- Keep network and rendering errors user-facing through `ManualError` and `typer.Exit`.
- Keep side-effecting builds dry-run by default.
- Do not add secrets or authenticated endpoints.
- Do not edit generated HTML or PDF to fix a rendering issue; fix the transformation or CSS and rebuild.
