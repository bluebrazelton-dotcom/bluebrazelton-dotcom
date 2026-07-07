# ⏳ The Hourglass

A weekly time-blocking web app — plan a *typical week* in 30-minute blocks on a
7-day grid. Drag blocks around, color them by category, and the schedule reflows
around you (cascade-push). Import a week from Argo JSON, export it back out.

**This version is 100% client-side.** There is no server and no Python — it's
just static files (HTML + CSS + JavaScript). Each visitor's data is saved
privately in their own browser (via `localStorage`). That makes it deployable
anywhere that serves static files, including **Cloudflare Pages**.

## Run it locally

Just open **`index.html`** in a browser (double-click it; a `file://` URL works).

That's it — no install, no `pip`, no `python app.py`. The first time it runs it
seeds eight default categories and one empty week.

> Tip: some browsers are stricter about `localStorage` on `file://` pages. If a
> reload ever doesn't remember your week, run a tiny local web server in this
> folder instead and open the address it prints:
> `python -m http.server 8000` → then visit `http://localhost:8000`.

## Deploy to your website (Cloudflare Pages)

1. Put this folder in a GitHub repo (the included `.gitignore` keeps any
   personal `.db`/JSON data out of the repo).
2. In Cloudflare Pages, create a project from that repo.
3. Build settings: **no build command**, output directory = **`/`** (root).
   These are plain static files, so there's nothing to build.
4. Deploy. Visitors open the page and get their own private Hourglass.

## How your data works now

- Everything lives in the visitor's browser under one key
  (`hourglass.state.v1`). Nobody can see anyone else's data; there's no server.
- **It's per-browser / per-device.** Your laptop and your phone won't share a
  week, and clearing browser data wipes it. That's what **Export** is for.
- **Export** (top nav) downloads the current week as Argo-format JSON — your
  personal backup, and it re-imports cleanly.
- **Reset** (top nav) wipes this browser's data and returns to the fresh seed
  (with a confirm prompt).

## How to use

- **Make a block** — drag over empty cells, then name it and pick a category.
- **Move** — drag it; dropping on occupied time cascade-pushes later blocks down.
- **Resize** — drag a block's top/bottom edge (snaps to 30-minute steps).
- **Rename / recategorize / delete** — click a block; use the × to delete.
- **Categories / Weeks / Import / Export / Reset** — buttons in the top nav.

## Argo import format

A JSON array of block objects:

```json
[
  { "day": "Mon", "start": "09:00", "duration": 90, "name": "Paper 1 drafting", "category": "Slot 1" }
]
```

- `day` — `Mon`–`Sun`
- `start` — `HH:MM`, on the 30-minute grid, between `06:00` and `21:00`
- `duration` — minutes, a multiple of 30
- `name` — the block label
- `category` — matches an existing category name (or tick "auto-create unknown
  categories" in the import panel)

## Files

| File | What it is |
|---|---|
| `index.html` | The page. |
| `static/db.js` | The in-browser "database" (localStorage). Replaces the old server. |
| `static/app.js` | The grid, drag-and-drop, cascade-push, and all the panels. |
| `static/style.css` | Dark-mode styling and the locked color palette. |

*(The old Flask version — `app.py`, `hourglass.db`, `templates/` — has been
retired. Your previous real weeks were exported to
`../Hourglass-personal-backup/` and can be brought into this version via the
Import panel.)*
