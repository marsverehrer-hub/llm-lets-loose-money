# LLM: Lets Loose Money: UI design rules (terminal edition)

The UI is a **financial terminal**, a parody of the Bloomberg terminal. It should feel like a dense instrument that a trader stares at for 14 hours. It must not feel like a SaaS landing page. The jokes live in the *content*: names, news, events and descriptions. The chrome stays dead serious.

`scripts/lint-style.mjs` enforces the hard rules. Run `node scripts/lint-style.mjs`; it must print `style lint: OK`.

## Hard rules (lint-enforced)
1. **No emoji** anywhere in UI source. Arrows and box glyphs such as `▲ ▼ ■ ● ─ │ ›` are fine.
   - The sim data has `icon` fields (research, events, achievements). **Never render them.**
2. **No decoration**: no gradients, `box-shadow`, `text-shadow`, `drop-shadow`, `backdrop-filter` or blur.
   - `border-radius` must be at most 2px; use 0 by default.
   - The only gradients allowed are in `theme.css`, for functional slider fills.
3. **No raw hex colors in CSS** outside `theme.css`. Use the tokens. Data-driven colors such as lab colors may be passed inline through `--c`.
4. **No entrance animations** (fade-up, pop, slide). The only allowed motion is:
   - blinking cursor and status dots (`.blink`)
   - the news ticker scroll
   - a 100ms toast/row flash

## Tokens (in `src/ui/theme.css`)
| token | use |
|---|---|
| `--bg` #000 | app background |
| `--bg-1` #0a0a0a | window body |
| `--bg-2` #141414 | window title strips, table header, hover |
| `--bg-3` #1f1f1f | pressed, track backgrounds |
| `--line` #262626 / `--line-2` #3a3a3a | hairlines |
| `--fg` #e8e4dc | values and primary text |
| `--fg-2` #a9a49a | secondary text |
| `--fg-3` #6e6a63 | labels, captions |
| `--fg-4` #45423d | disabled |
| `--amber` #ffa630 | THE accent: labels, titles, active states, primary buttons |
| `--amber-2` #b8741a | dim amber (secondary labels) |
| `--up` #3fd47f / `--down` #ff5a4f | deltas, good/bad |
| `--blue` #5aa9ff | info, links, the player's own series |
| `--yellow` #ffe14d | milestones |

**Type:** `IBM Plex Mono` for everything, with tabular numbers. Base size 12.5px with line-height 1.4. Labels are UPPERCASE, 10.5–11px, letter-spacing 0.06em.

## Vocabulary
- **Window** (`<Card code="MDL" title="Models">`): a 1px `--line` box with a 22px title strip (`--bg-2`). The strip shows an amber UPPERCASE title, an optional dim function code on the left, and actions on the right. There is no subtitle prose in the strip; a terse dim note is allowed.
- **Panel header** (`<PanelHeader code="MDL" title="Models" sub="…" />`): one line, `MDL <GO>` code block, amber title, dim one-line sub, rule underneath.
- **Tables first.** Any list of 3 or more homogeneous things is a `.table`: right-aligned `td.num`, `tr.me` for the player, `tr.sel` for the selected row (amber background, black text), and row hover in `--bg-2`.
- **Readouts** (`<Stat>`): amber-dim label, off-white value, colored delta with ▲/▼.
- **Tags** (`<Pill>`): bracketed uppercase tags with a 1px currentColor border, e.g. `LIVE`, `RET`, `SECRET`.
- **Buttons**: rectangular and uppercase.
  - Default: hairline border, fg text; on hover, amber border and text.
  - Primary: solid amber with black text.
  - Danger: red.
  - Labels are short verbs: `TRAIN`, `RELEASE`, `LAUNCH`, `BUY 8`.
- **Bars**: flat 6px bars (`.progress`). No donuts, no gauges. Use horizontal bars and stacked bars.
- **Charts**: hairline dotted grid, 1.5px lines, no area fills, mono axis labels. Series colors in order: amber, fg, blue, up, down.
- **Empty states**: one dim uppercase line, e.g. `NO MODELS. ── TRAIN ONE IN MDL <GO>`, plus an optional button.
- **Density**: 8px gaps between windows, 6–10px padding inside them. Fill the space with information, not air.

## Copy
- Chrome copy is terse and functional:
  - `TRAINING  Loosey-2  37%  ETA 12D`, not "Your model is cooking! 🔥"
  - `RUNWAY 2.3Y`, not "You have plenty of time to vibe."
- Satire belongs to data: model names, news, event text, research and dataset descriptions, and lab taglines. Showing those in full is good.
- Dates use the form `14 MAR 2019` or `2019-03-14`. Money uses `formatMoney`.

## Panel function codes
| Code | Panel |
|---|---|
| HQ | dashboard |
| MDL | models |
| PRD | products |
| CMP | compute |
| DAT | data |
| RES | research |
| STF | staff |
| MKT | market |
| FIN | finance |
| TRO | achievements (trophies) |


## v2 amendments: readability (these OVERRIDE the rules above where they conflict)
The user found v1 hard on the eyes: pure black, amber text everywhere, all-caps 10.5px mono. v2 keeps the terminal identity (dense windows, tables, function codes, hairlines, no decoration) but has to be comfortable for hours.

- **Colours:**
  - Soft charcoal background (`--bg` #121417), not pure black.
  - Text is `--fg` #dfe1e5, not pure white.
  - Amber is an **accent only**: the active nav item, primary buttons, the selected row, focus, `ph-code` blocks and key highlights.
  - Never use amber for body text, labels or window titles. Window titles are `--fg` and semibold.
  - Labels use `--fg-3`.
- **Type:**
  - `IBM Plex Sans` (`--font`) for all text.
  - `IBM Plex Mono` (`--mono`) only for numbers, codes, kbd and tabular data. `.num` and `td.num` already switch to mono.
  - Base size is 14px. Small text is 13px; the minimum is 12px. Nothing smaller.
  - Line-height is 1.5, or 1.6 in prose.
- **Case:**
  - Sentence case for labels, buttons, headers and table headings ("Revenue / day", "Train", "Release").
  - UPPERCASE only for status tags (`Pill`), function codes (`HQ`, `MDL`) and kbd.
  - Never write labels in caps in JSX source strings. Write sentence case and let tags uppercase themselves.
- **Space:**
  - 12px gaps between windows, 12–14px padding inside them.
  - Table rows have 6px vertical padding.
  - Buttons are 30px tall (24px small); title strips are 32px.
  - Density comes from tables, not from cramming.
- **Contrast:** secondary text `--fg-2`, tertiary `--fg-3`. Don't use `--fg-4` for anything the player has to read; it's for disabled states only.
- **Themes:** dark is the default.
  - `html[data-theme='light']` gives a warm paper theme. The toggle lives in the top-bar menu and persists to localStorage key `llm-lets-loose-money/theme`.
  - Everything must use tokens so both themes work. Canvas charts read tokens at draw time. The office canvas stays dark (it's a camera feed).
- **Text on accent fills** uses `--on-accent`, never #000.


## v3 amendments: show, don't list (v10). These OVERRIDE the rules above where they conflict.
The player feedback was blunt: too much text thrown at you, too many numbers that change nothing, no overview. The terminal
identity stays (flat, hairlines, tokens, mono numbers, no decoration), but every screen must **lead with a picture of the
thing**, and push the detail behind a click.

**Every panel opens with a visual of its subject**, drawn in SVG or canvas with flat token colours:
| Panel | The picture |
|---|---|
| Compute | A server room: each datacenter and the cloud as a block of GPU cells (one cell = N GPUs), coloured by what they do right now: training, serving (per product), idle, cloud burst. Hover a cell group for numbers, click to manage. |
| Staff | An office floor: one small person glyph per employee (or per N), grouped by team in team colours, empty seats as hollow cells. Click a team to see who they are and what they do. |
| Data | A map of your tokens: a treemap of owned data by domain (area = tokens, shade = quality). |
| Marketing | Brand and hype over time (line chart), running campaigns as timeline bars, and the funnel from awareness to users. |
| Market | Share bars per segment in lab colours, plus a tier matrix (heat cells instead of a percentage table). |
| Models | A capability shape (radar or bar fan) per model, comparable against the best rival. |
| Research | A timeline of what unlocks when, and per-branch progress. |
| Finance | A waterfall from revenue to profit, and charts you can hover. |

**Rules for visuals:**
- Allowed now: SVG and canvas illustrations, unit grids, treemaps, radar shapes, timelines, heat cells, simple
  person and rack glyphs built from rects and circles, hover highlight and click selection, and width/opacity
  transitions up to 150ms. Donuts are allowed where a share-of-whole is the point.
- Still forbidden: gradients (except functional slider fills in theme.css), shadows, glows, blur, emoji, rounded
  corners above 2px, raw hex outside theme.css, entrance animations, neon or glassy looks. Colours come from tokens;
  lab colours come from data via `--c`.
- Every visual is **interactive**: hovering shows the exact numbers (Tooltip or an inline detail line), and clicking
  selects or drills in. Nothing important lives only in a hover; the selected thing's details show beside or below.
- Visuals must work at phone width (they scale down or switch to a simpler stacked form) and in the light theme.

**Less text:**
- One `PanelIntro` (what this screen is for, in plain words) per panel, dismissible.
- A `HelpTip` (?) instead of explanatory paragraphs next to jargon.
- Secondary controls (filters, sort, advanced options, rarely used actions) go behind a `Popover` or a `Sheet`.
- A stat earns its place only if the player can act on it or it decides something. Everything else goes behind
  "Details" or is removed.
- Lists of things the player owns are cards or visual rows first; full tables are a "Table" toggle or a sheet.
