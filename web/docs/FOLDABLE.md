# Foldables (Galaxy Z Flip) and one-handed use

Full design notes (Vietnamese): https://claude.ai/artifact/FxEG6YRNYq1hfqVs8tTkoz

## Posture
`js/core/posture.js` writes `<body data-posture="open|flex|cover">`, `body.tall`, and CSS vars `--fold-y` / `--fold-h`;
emits bus `posture:change { posture, prev, fold }`. Sources: native `Posture` plugin
(`android/.../PosturePlugin.java`, Jetpack WindowManager), web Viewport Segments / Device Posture, then window size
(short side <= 480 px and ratio <= 1.35 = cover). Settings: `ui.foldAuto`, `ui.foldPreview` (test without a foldable).

## Rules for every app
- **Flex Mode:** wrap the page in `<div class="fold-top">` (to look at) and `<div class="fold-bottom">` (controls,
  lists). Normal postures ignore the wrappers (`display: contents`). Nothing interactive within 24 px of the crease.
- **Cover screen:** the shell is replaced by Quick View (`js/core/cover.js`). Add cards from the app's `service.js`:
  `extend('cover.cards', async (ctx) => ({ id, app, icon, title, sub, percent, order, actions: [{ label, icon, primary, run }] }))`.
  Max 3 actions, title 2 lines. Call `bus.emit('cover:refresh')` when data changes; never refresh on a timer.
- **One-handed (phones):** the core bottom bar (`#tabbar`) serves apps without their own tabs. Apps with their own
  phone tabs (Music, Books; list `OWN_TABS` in app.js) add `<… data-open-nav>` "Ứng dụng" to open the drawer.
  A page's `.page-head .btn.primary` becomes a round button above the bar.
- Use official full app names everywhere, including tab labels.
