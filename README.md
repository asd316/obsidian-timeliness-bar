# Timeliness Bar for Obsidian

Render inline timeliness bars as clean, clickable badges. The underlying data stays plain Markdown, so your notes remain readable even without the plugin.

## What it looks like

A single line in your note:

```markdown
> [!时效] (时效起:: 2026-09-01) (时效止:: 2026-09-30) (时效状态:: IN PROGRESS)
```

is rendered as:

🕓 2026-09-01 ~ 2026-09-30 | IN PROGRESS

Click the badge to edit dates and status in a calendar popup.

## Statuses

| Status | Meaning | Badge style |
|---|---|---|
| `NONE` | No state, e.g. resume items, past experience | Gray |
| `IN PROGRESS` | Active / current | Blue |
| `DONE` | Completed | Green |
| `DROPPED` | Abandoned | Gray + strikethrough |
| `EXPIRED` | Past end date | Yellow |

Legacy Chinese statuses (`现行`, `过期`, `失效`) are still rendered correctly.

## Keyboard workflow

Open the popup with the command **Shixiao Bar: Insert Timeliness Bar** or by clicking any existing badge.

- The popup focuses the **start date** field automatically.
- Press `Enter` to move: start date → end date → status dropdown → save.
- Press `Esc` to cancel.

No mouse required.

## Optional: overview with Dataview

Because the data is plain Markdown, you can query it with Dataview. Add a `dataviewjs` block to a note for an overview grouped by status:

```dataviewjs
const FIELD_RE = /\(\s*时效起\s*::\s*(\d{4}-\d{2}-\d{2})\s*\)\s*\(\s*时效止\s*::\s*(\d{4}-\d{2}-\d{2})\s*\)\s*\(\s*时效状态\s*::\s*([^)]*?)\s*\)/;
const rows = [];
for (const p of dv.pages()) {
  const text = await dv.io.load(p.file.path);
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(FIELD_RE);
    if (!m) continue;
    rows.push([p.file.link, i + 1, m[1], m[2], m[3].trim()]);
  }
}
dv.table(["Page", "Line", "Start", "End", "Status"], rows);
```

> This plugin does **not** require Dataview, QuickAdd, or Metadata Menu. They are only mentioned as optional companions.

## Install from Obsidian Community Plugins

1. Open **Settings → Community Plugins**.
2. Turn on **Safe mode** if needed, then browse.
3. Search for **Shixiao Bar**.
4. Install and enable.

## Manual install

1. Download the latest release.
2. Extract `main.js`, `manifest.json`, and `styles.css` to `.obsidian/plugins/shixiao/`.
3. Enable the plugin in Obsidian settings.

## License

MIT
