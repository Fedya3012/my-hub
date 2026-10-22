# Xưởng Viết / Writer Studio (module `fanfic`)

Write, upload and manage fanfic. Reading happens in **Sách** (Books).

## Data (db.version 5, see comments in `js/core/db.js`)
- `items` (type `fanfic`, moduleId `fanfic`): what the Library shows; freeform tags live in `items.tags`.
- `fanfics` (key itemId): origin (`mine` | `saved`), author, source URL, fandomIds, characterIds, relationshipIds,
  audience (AO3 rating g/t/m/e/nr), warnings, categories, status (draft/wip/complete/hiatus/abandoned), summary,
  notesStart/End, seriesId (+index, `collections` kind `fic-series`), plannedChapters, goal { total, deadline }, published.
- `ficChapters`: chapters and scenes (parentId), float `order` for drag and drop, Markdown `body`, synopsis, label,
  status, goal, chapter notes, published copy `pubTitle/pubBody/pubAt`.
- `fandoms` (`fd:<slug>`): kind, aliases, `bookIds` / `bookSeriesIds` = canon in Books (two-way link).
- `ficTags`: characters `ch:<fandom>:<slug>`, relationships `rl:<fandom>:<slug>` (`A/B` romantic, `A & B` platonic).
- `ficNotes`: character profiles, plot, research, world, ideas, todos (fanficId, tagId, chapterId, done).
- `ficVersions`: chapter snapshots (manual, auto before big deletions, publish).
- `ficWriting`: words per day / fanfic / device (`YYYY-MM-DD|fanficId|deviceId`) -> daily goal and streak.
All tables are in `SYNCED_TABLES`, so every storage mode (GitHub, Dropbox, OneDrive) and the JSON backup carry them.

## Books link
- "Xuất bản sang Sách" copies chapter text to `pub*`, creates/updates a `books` row (same key, `format: 'fanfic'`).
  Books lists it like a book; `books/lib/store.js` gives it a virtual main file; the reader asks
  `ctx.services.get('fanfic').book(id)` and renders it with `makeTextBook`. Reading progress is saved on the shared item
  id, so Xưởng Viết shows it too.
- Reader button (quill) and book page menu: "Sửa trong Xưởng Viết" -> `services.fanfic.edit(id, chapterIndex)`.
- "Gỡ khỏi Sách" (or deleting it in Books) only unpublishes; the work stays in Xưởng Viết.
- `library.drawer` block: on a fanfic (Library, Books page) shows fandom, rating, tags, edit link; on a canon book shows
  the fandom's fanfics and "Viết fanfic cho truyện này" (and suggests a link when a fandom name matches).

## UI
Tabs: Bàn viết, Tác phẩm, Fandom, Thêm & nhập (phone bottom bar). Works filters persist in `localStorage`
(`hub.fanfic.filters`). Long-press / right-click menus via `core/longpress.js`. Writer: binder, Markdown, autosave,
focus + typewriter, snapshots; Flex Mode = text above the crease, tools below. Cover screen card: today's words + "Viết tiếp".
Music: the Music `library.drawer` block ("Nhạc nền") shows on the work page.

## Phase 2
DOCX / EPUB import, plot grid, rich text toolbar, Todo app integration (notes kind `todo` are ready), writing stats page,
AO3 posting helper.
