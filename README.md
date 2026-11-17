# dsh-wardrobe

A standalone [DSH](https://github.com/deepseek-ai) plugin that gives a character a wardrobe. One garment is four fields and nothing else.

| Field | Purpose |
|---|---|
| `title` | Name of the garment |
| `description` | Plain text the model reads — how it understands this piece |
| `prompt` | Prompt fragment for an image model |
| `image` | One picture |

Plus an internal `id` for referencing and `createdAt` / `updatedAt` for ordering. There are deliberately no tags, no categories, no outfit combinations, no ratings and no image generation entry point. Adding any of those is a separate decision, not a default.

## Why a separate plugin

A wardrobe is not memory. Storing garments in the persona card or the memory store puts them in every prompt, gets them compressed by the summarizer, and leaves copies in session logs and archives. Keeping them in a plugin means the model asks for a garment by name when it actually needs one, and the bytes never travel through the context window.

It also keeps the host clean: this plugin owns its own SQLite file and image directory, and depends on nothing but Node built-ins.

## Install

```bash
dsh plugin --profile web add link:/path/to/dsh-wardrobe
systemctl --user restart dsh-web
```

DSH picks the plugin up from the profile's `package.json`. The plugin needs no configuration; both the database and the image directory default to `~/.dsh/wardrobe/`.

Requires Node 24 or newer for `node:sqlite`.

## Tools

| Tool | Arguments | What it does |
|---|---|---|
| `wardrobe_list_all` | — | List every garment |
| `wardrobe_list_type` | `type` | List by type |
| `wardrobe_list_body` | `body` | List by body part |
| `wardrobe_get_cloth` | `id` or `title` | Full record for one garment |
| `wardrobe_wear` | `id` list | Put garments on |
| `wardrobe_unwear` | `id` list | Take garments off |

Wearing does not draw anything. It records the current state so a later image request can read it through `her_garment.json`, which is what the wardrobe hands to the generation side.

## Where it lives

```
~/.dsh/wardrobe/wardrobe.sqlite      one row per garment, mode 0600
~/.dsh/wardrobe/images/<24 chars>.<ext>   image files, mode 0600
```

The database stores file names only; binary never enters SQLite. The extension is decided by reading the file header (PNG / JPG / WEBP / GIF) rather than trusting the `content-type` supplied at upload. Filenames must match `<24 alphanumeric>.<ext>`, which closes path traversal.

## Settings UI

Open DSH settings and pick "衣柜" (Wardrobe). Add a garment in the top right by filling the four fields; cards support edit and delete, and an uploaded image previews immediately.

The same data is reachable over HTTP (same-origin, DSH session auth):

```
GET  /dsh-wardrobe/api            -> { ok, pluginVersion, items: [...] }
POST /dsh-wardrobe/api            -> { action: create|update|delete, ... }
POST /dsh-wardrobe/image          -> raw bytes, returns { image: filename }
GET  /dsh-wardrobe/image?name=... -> image bytes
```

## Test

```bash
node --test test/wardrobe.test.js
```

Five cases: field contract, required and length limits, image magic numbers and traversal, API auth plus create/update/delete, and an image round trip.

## Design notes

- Zero npm dependencies. Only `node:sqlite`, `node:fs`, `node:crypto`.
- The four-field schema is enforced, not merely documented: the UI and the API reject anything outside it.
- Images are separate files so a wardrobe backup is `tar` over one directory and a database backup stays small.

## Star History

<a href="https://www.star-history.com/?type=date&repos=iiishop%2Fdsh-wardrobe">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=iiishop/dsh-wardrobe&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=iiishop/dsh-wardrobe&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=iiishop/dsh-wardrobe&type=date&legend=top-left" />
 </picture>
</a>
