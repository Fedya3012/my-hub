# Podcast (module `podcasts`, 0.1.0)

Design notes for the Podcast app. Code: `js/modules/podcasts/`. Schema: `js/core/db.js`, version 6.

## Data
- `pcShows`: one row per show. Its `itemId` is `pc:<hash(feedUrl)>`, so two devices subscribing to the same feed share one row. The Library row is an `items` row with `type: 'podcast'`, `moduleId: 'podcasts'`.
- `pcEpisodes`: `ep:<hash(showId|guid)>`. Played / inbox / starred flags live on the row. Position uses `core/progress.js` with the episode id as the item id.
- `pcPlaylists`: the queue (`up-next`, kind `queue`), playlists (kind `list`) and smart filters (kind `smart`, `rules`).
- `pcBookmarks`, `pcTranscripts` (source `feed` or `ai`), `pcSearches`.
- `pcDownloads`: which episodes are downloaded on this device. The audio blob is in `blobs` under `pc-dl:<id>` and never syncs.

## Online sources
- Apple iTunes Search and charts need no key and allow CORS.
- Podcast Index needs a free key and secret (Cài đặt → Podcast). Each request is signed with SHA-1 per its API.
- RSS feeds: the Windows and Android apps fetch them through the shell. The browser uses `fetch` and, if set, the CORS proxy in Cài đặt. When the RSS is blocked and the show is on iTunes, episodes come from iTunes lookup (no chapters or transcripts).
- The RSS parser reads the iTunes tags, Podcasting 2.0 (`podcast:chapters`, `podcast:transcript`, `podcast:person`, `podcast:funding`) and Podlove chapters.

## Playback
- One `<audio>` element per episode. Speed 0.5–3× keeps the pitch.
- Voice Boost and Skip silence need Web Audio, which requires CORS on remote files. If a host refuses, the episode plays without effects.
- The Media Session (lock screen) is wired in `player.js`. Music and Podcast pause each other when one starts (`media:play` event).
- Sleep timer: a minutes timer that fades out in the last 8 seconds, plus "end of episode" and "end of chapter".

## Interfaces
- Library drawer block: `extend('library.drawer')`.
- Books reader "Nghe khi đọc": `extend('audio.sources')`, with `hasMedia`, `playing`, `title`, `play`, `pause` and `onChange`.
- Other apps can use `bus.emit('podcasts:play', { episodeId, at })` and `ctx.services.provide('podcasts')`.

## Open items
- English strings (`tools/i18n/extra.json`).
- Android Auto and widgets for podcasts.
- Podcast Index key UI is a plain text field; it stays on this device and does not sync.
