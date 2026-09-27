# Dossier

A personal workspace panel inside SillyTavern for organizing scattered worldbuilding material — voice memos, reference images, notes (Canon / Headcanon / Alt Verse / Samples) and reference links — per character, or standalone.

Nothing is injected into lorebooks or prompts. It's purely a staging and reference space, and everything is stored as plain files on your own machine.

## Features

- **Floating, draggable panel**, opened from the **Dossier** entry in the wand / extensions menu.
- **Auto-binds to the open character.** Click the title to switch dossiers, or use **+ New** for a standalone one.
- **Sound:** import audio files and voice memos (no live recording — record elsewhere, import here).
- **Visual:** reference images with a lightbox.
- **Text:** notes in four categories, plus **Import Text File** (`.txt`, `.md`, etc.) — each file becomes a note in the open category.
- **Links:** save reference URLs.

## Interface

- **Resize:** drag the grip in the bottom-right corner (mouse or touch). The panel grows and slides back on screen if it would run off the edge.
- **Large view (⤢):** expands the panel to most of the window. Click again to go back.
- **Text size (A− / A+):** scales all text in the panel.
- **Switch dossiers:** click the ▾ next to the dossier's name (or the name itself). The one you're in is highlighted, and a filter box appears once you have more than six.
- **Move:** drag the top bar. Size, position, text size and view are remembered per device.
- **Text tab:** when the panel is wide enough, notes are listed on the left and the editor fills the right, with a tall text box for drafting. Selecting another note warns you before discarding unsaved changes.
- **Visual tab:** larger thumbnails, and a button to show whole images instead of cropped squares. Click an image for a big view; browse with the ‹ › buttons, the arrow keys or a swipe.
- **Phone:** the panel fills the screen.

## Search

Type in the search box at the top of the panel. It looks through note titles and text, image labels and file names, link labels and addresses, and audio names. Several words must all appear (any order); case and accents don't matter; matches are highlighted.

A toggle next to the box chooses the scope: **This dossier** (instant, the default) or **All dossiers** (searched by the server, so it stays fast with a big backlog; results are labelled with their dossier). Click a result to jump straight to that note, image, link or recording, switching dossier if needed. The scope you pick is remembered per device.

> Searching all dossiers needs the updated server plugin: copy `dossier-server/` over the old one and restart SillyTavern.

## Install

Dossier has two parts, and both are required.

### 1. Server plugin

Copy `dossier-server/` into `SillyTavern/plugins/`, so you end up with `SillyTavern/plugins/dossier-server/index.js`.

Then enable server plugins in SillyTavern's `config.yaml` and restart SillyTavern:

```yaml
enableServerPlugins: true
```

No `npm install` is needed — the plugin has no dependencies.

### 2. Extension

Copy `dossier-extension/` into your user extensions folder:

```
SillyTavern/data/<your-user>/extensions/dossier-extension/
```

(On older versions of SillyTavern: `public/scripts/extensions/third-party/`.)

Reload SillyTavern, then open **Dossier** from the wand menu.

## Where your data lives

Everything is kept inside the plugin's own folder, deliberately independent of SillyTavern's internal user-data layout so it survives version changes:

```
dossier-server/storage/<dossier-key>/
├── meta.json     notes, links and metadata
├── sounds/       audio files
└── images/       images
```

Back up or move your dossiers by copying `dossier-server/storage/`. It is git-ignored in this repo.

## Notes for developers

SillyTavern mounts a global `multer(...).single('avatar')` on every request before plugin routers run, and it rejects any other multipart field name with `Unexpected field`. That's why the extension uploads files under the field name `avatar` and the plugin reads the already-saved `req.file` instead of running its own multer.

## License

[WTFPL](LICENSE) — do what the fuck you want to. Made as a thank-you to the SillyTavern community.
