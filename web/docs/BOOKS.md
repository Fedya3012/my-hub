# Module Sách (Books) 0.1.0

Library manager + reader + reading tracker. Code: `web/js/modules/books/`.

## Data (db.version(4), synced through GitHub)
- `items` (type `book`, moduleId `books`) holds title, tags, favourite, status for the central Library.
- `books` (keyed by itemId): authors, series + index, status (want / reading / finished / dnf / onhold),
  half-star rating, review, private notes, moods, pace, content warnings, genres, shelves, ISBN,
  pages, words, dates, reads history, DNF reason, custom columns, `physical` for paper books.
- `authors`, `series`: ids derived from slugs, so two devices create the same row.
- `annotations`: highlight / underline / note / bookmark; `loc` = EPUB CFI or `pdf:<page>` (+ normalised rects).
- `readingSessions`: start, seconds, from/to %, pages, words (WPM), source reader / timer / manual.
- `readingGoals`: yearly/monthly goals and challenges (optional query).
- Shelves live in `collections` (kind `book-shelf`, `book-smart` with a query, `book-library` = virtual library).
- Reading position: core `progress` (unit percent or page, `loc` stored on the row), so it syncs live.

## Formats
| Engine | Formats |
|---|---|
| foliate-js (`web/vendor/foliate`, MIT) | EPUB, MOBI, AZW/AZW3/KF8, FB2/FBZ, CBZ (fixed layout, RTL option) |
| pdf.js 4.10 (`web/vendor/pdfjs`, Apache-2.0) | PDF: scroll, page (spread on wide screens), reflow (text → foliate) |
| text-book.js | TXT (chapter detection, Windows-1258 fallback), MD, HTML |
| phase 2 | CBR, CB7, DjVu, DOCX (importable and trackable, not readable yet) |

## Pages
`#books` home · `library[/query]` · `book/<id>` · `read/<id>` · `shelves` · `shelf/<id>` · `authors` ·
`author/<id>` · `series` · `series/<id>` · `stats` · `goals` · `tools`.
Search syntax: see `QUERY_HELP` in `lib/query.js` (`author:`, `tag:`, `rating:>=4`, `status:`, `-x`, `has:`, `is:` …).

## Integration
- Opening a book emits `item:open`, so Music plays the playlist linked to the book (Library drawer block).
- `manifest.openRoute(item)` makes the central Library open books straight in the reader.
- Service `books`: `open(id)`, `show(id)`, `snapshot()`, `stats()` for other modules and future widgets.
- Parameters namespace `books` (Settings → Parameters → Sách & trình đọc).

## Sync note
Google Drive was removed in app 0.8.0.0. Metadata, progress, notes and sessions sync through GitHub;
book files stay on each device and are matched by name + size when added on another device.

## Phase 2
Social features, format conversion, OPDS catalogs, EPUB editor, news-to-ebook, CBR/CB7/DjVu/DOCX
reading, cloud file sync, offline dictionary and translation, Comic Vine metadata, Android widgets.
