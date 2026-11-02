# LLM: Lets Loose Money: UI design rules ("Blueprint", v5)

The UI is the **lab's own drafting table**: the plans for a company that builds intelligence, drawn on blueprint paper
at night (dark) or graph paper by day (light). Sheets are crisp and crop-marked; headlines and money are set in a serif
like a financial broadsheet; every small label is a mono **drafting annotation**; what matters is **highlighted** in
marker yellow; status tags are **rubber stamps**; buttons are chunky and tactile, with a hard offset shadow you press
into. It must stay easy to read for hours and easy to learn: every screen says what it is for, the home screen says
what to do next, and jargon gets a plain-language tip.

The satire lives in the **content** (names, news, events, descriptions, advisor copy). The chrome is the joke's
straight man: a serious engineering drawing of a deeply unserious company.

`scripts/lint-style.mjs` enforces the hard rules. Run `node scripts/lint-style.mjs`; it must print `style lint: OK`.

## Hard rules (lint-enforced)
1. **No emoji** anywhere in UI source (`src/ui`, `src/office`, `src/scenes`). Simple glyphs such as `▲ ▼ ● › × §` are
   fine; icons are inline SVG line drawings (see `shell/hubs.tsx`). The sim's `icon` fields are never rendered.
2. **Colours, gradients and textures are tokens.** No raw hex in CSS outside `src/ui/theme.css`. No `gradient()`
   outside `theme.css`: the drafting textures are tokens there (`--tex-grid`, `--tex-hatch`, `--tex-ruler`,
   `--tex-marker`, `--tex-dash`). Every `box-shadow` references a token (`--shadow-hard/2/3`, `--ring`, or a `var()`
   colour). Data-driven colours (lab colours) come in through `--c`.
3. **No glow or glass:** no `text-shadow`, `backdrop-filter`, blur or `drop-shadow`. Depth is a hard offset shadow.
4. **Radii are small:** `--r-sm` (3), `--r-md` (5), `--r-lg` (6), `--r-xl` (10) or `--r-pill`. Literal radii up to 12px.
5. **Motion** is short and functional: hover lift (`translate(-1px,-1px)` plus the hard shadow), press
   (`translate(1px,1px)`, shadow gone), panel/modal/toast entrances (`--t-med`), the news crawl and the tutorial pulse.
   `prefers-reduced-motion` switches all of it off.
6. Inline styles in TSX follow the same rules.

## Tokens (`src/ui/theme.css`)
| token | dark (blueprint) | light (graph paper) | use |
|---|---|---|---|
| `--bg` / `--bg-1..3` | navy #0a1830 up to #1a345f | paper #f1ede2, sheets #fbf9f3 | paper, sheets, raised rows, tracks |
| `--grid` / `--grid-major` | cyan at 7% / 14% | blue at 7% / 14% | the 24px / 120px drafting grid behind everything |
| `--line` / `--line-2` | | | dashed rules and hairlines / control borders and crop marks |
| `--ink-shadow` | near-black navy | ink | the hard offset shadow colour |
| `--hl` / `--hl-soft` / `--on-hl` | marker yellow | marker yellow | primary buttons, active tabs, highlights, the selected row |
| `--accent` (`--amber` legacy) | yellow | blueprint blue | accent **text** (readable on its paper) |
| `--up` / `--down` / `--warn` / `--blue` | | | money in / out, caution, info |
| `--hub-*` | | | one index colour per binder section |

**Type:**
- `Instrument Serif` (`--display`) for screen titles, card titles, modal titles, the HUD readouts and every big figure.
  Screen titles carry the marker (`--tex-marker`): a stroke under the words in the dark, a broad highlight on paper.
- `JetBrains Mono` (`--code`) for annotations: eyebrows (prefixed `§`), stat and KPI labels, table headings, buttons,
  tabs, tags and the news wire. Always uppercase with 0.06–0.1em tracking, set by CSS.
- `Figtree` (`--font`) for reading: body copy, descriptions and advisor reasons. Base 15px, minimum 12px.
- Sentence case in JSX strings; CSS uppercases annotations.

## Navigation (information architecture)
The ~15 panels are grouped into five **hubs** (`src/ui/shell/hubs.tsx`). PanelId values never change, and
`navigate(id)` still opens any panel directly.

| Hub | Colour | Panels (tabs) |
|---|---|---|
| Headquarters | yellow | Overview (`dashboard`), Versus (`vs`, only during a match) |
| Lab | cyan | Models, Research, Data, Benchmarks |
| Infrastructure | orange | Compute, Staff |
| Business | mint | Products, Market, Marketing, Contracts, Finance |
| Company | violet | Level & perks (`lab`), Trophies (`achievements`) |

- **Desktop:** a sidebar of five hub buttons (a binder divider: thick edge and stamped icon in the hub colour, serif name,
  mono blurb, a diamond when something inside needs attention). Under 1100px it folds to an icon rail. The hub's panels are tabs pinned at the top of
  the main area (`HubTabs`); a hub reopens on the panel last visited there.
- **Phones (<= 760px):** the same five hubs as a bottom tab bar; the same hub tabs at the top.
- Locked panels (progressive disclosure, `ui/unlocks.ts`) are simply absent from their hub's tabs until they open.
- The tutorial highlight (`tutorialTarget`) pulses the hub and the tab of the panel it points at.

## The frame
- **HUD** (top bar): company mark and name (click to rename), date and a status pill (Paused, Decision pending),
  readout tiles for cash (with today's net), runway, revenue, valuation and AI hype, then the speed control, Inbox,
  sound and Menu. Tiles drop out right-to-left as the window narrows; phones keep cash only.
- **Run dock:** rounded chips for the training run, research, lab level, the Arena Cup and the board quarter. An idle
  slot is an accent-tinted call to action.
- **News ticker:** a quiet strip at the bottom with a coloured dot per headline.
- **Toasts** stack bottom-right with a coloured edge; dialogs are centred cards on desktop and full-screen sheets on phones.

## Headquarters (home)
It answers "what is going on, and what should I do next":
1. **Your next moves** (`panels/hq/nextStep.ts`): every applicable suggestion derived from game state, ranked Urgent
   (cash, outages, losing products), Next (the core loop: train, release, launch, research, capacity) and Idea
   (perks, board goals, the Cup, contracts, hiring, data). Each has a plain reason and a button that goes there.
2. **Goals:** this quarter's board goals and the scenario goals.
3. **Key numbers** (`KpiStrip`): cash, profit per day, runway, revenue, users, valuation, each with a 6-month trend,
   a four-week change, a HelpTip, and a link to the screen where you change it.
4. The live run with its tempo, the lab level, money flows, products, the rival race, the office camera and charts.

## Components (the Blueprint layer at the end of `theme.css`)
- **Sheet** (`Card`): `--bg-1` at 94% over the grid, 1px `--line`, `--r-sm`, crop marks top-left and bottom-right
  (`::before` / `::after`), a dashed rule under the header. `hot` turns the border and crop marks yellow and lifts it
  on the hard shadow. Clickable cards lift on hover.
- **Panel header:** `§ HUB` eyebrow in the hub colour, a 46px serif title with the marker, one line of context.
- **Button:** mono uppercase, 1.5px border, `--r-sm`. Hover lifts onto `--shadow-hard`; press sinks. Primary is marker
  yellow with ink text and an ink border, always on the hard shadow.
- **Pill:** a rubber stamp: mono uppercase, 1.5px currentColor border, rotated -2deg.
- **Stat / KPI:** mono annotation label, serif figure.
- **Tabs:** binder index tabs (top-rounded, the active one joins the sheet with a top bar in the hub colour). Hub tabs
  and segmented switches fill the active choice with marker yellow.
- **Tables:** a ledger: mono headings over a heavy rule, dashed row rules, `tr.sel` and `tr.me` highlighted.
- **Progress:** a ruler (tick every 10%) filled with hatched marker.
- **Modal:** a drawing with a yellow title block, `--shadow-3`.
- **PanelIntro:** a sticky note with a yellow edge and a dashed border.
- **Sidebar:** binder dividers with a thick left edge in the hub colour; the active one pulls out to the right.
- **HUD:** a title block: a stamped seal for the company, serif readouts split by dashed rules, cash underlined.
- **Toasts:** notes pinned to the sheet (hard shadow); milestones get a yellow border.
- **Charts:** 1.5–2px lines, series colours in `SERIES_ORDER`. Camera feeds keep their own art in a ruled frame.

## Copy
- Plain and friendly in the chrome: "Runway 3.1 years", "Start training", "Your next moves".
- The advisor speaks like a sharp chief of staff: an imperative, then one sentence of why.
- Satire belongs to data: model names, news, events, research and dataset descriptions, lab taglines.
- Dates read `14 Mar 2019`. Money uses `formatMoney`.

## Visuals per screen (still in force from v3)
Every panel opens with a picture of its subject (camera feed, server room, office floor, token map, share bars,
capability shapes, research timeline, finance waterfall). Visuals are interactive: hover shows exact numbers, click
selects or drills in, and nothing important lives only in a hover. They must work at phone width and in both themes.
Secondary controls go behind a `Popover` or a `Sheet`; lists of owned things are cards first, tables behind a toggle.
