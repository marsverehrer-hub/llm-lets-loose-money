# LLM: Lets Loose Money: UI design rules ("Night Shift", v4)

The UI is a **tycoon game's control room**, not a terminal and not a SaaS dashboard. Think of the screens a lab
founder would keep open on the night shift: layered ink surfaces, chunky rounded cards, one lavender accent,
a colour per area of the company, big friendly numbers. It must be easy to read for hours and easy to learn: every
screen says what it is for, the home screen says what to do next, and jargon gets a plain-language tip.

The satire lives in the **content** (names, news, events, descriptions, advisor copy). The chrome is calm and clean.

`scripts/lint-style.mjs` enforces the hard rules. Run `node scripts/lint-style.mjs`; it must print `style lint: OK`.

## Hard rules (lint-enforced)
1. **No emoji** anywhere in UI source (`src/ui`, `src/office`, `src/scenes`). Simple glyphs such as `▲ ▼ ● › ×` are
   fine; icons are inline SVG line drawings (see `shell/hubs.tsx`). The sim's `icon` fields are never rendered.
2. **Colours, gradients and depth are tokens.** No raw hex in CSS outside `src/ui/theme.css`. No `gradient()` outside
   `theme.css` (add a token, e.g. `--fade-x`). Every `box-shadow` references a token (`--shadow-1/2/3`, `--ring`, or a
   `var()` colour for inset accent bars). Data-driven colours (lab colours) come in through `--c`.
3. **No glow or glass:** no `text-shadow`, `backdrop-filter`, blur or `drop-shadow`.
4. **Radii:** shapes use `--r-sm` (8), `--r-md` (12), `--r-lg` (16), `--r-xl` (22) or `--r-pill`. Literal radii are
   allowed up to 12px for small parts (keys, swatches, cells).
5. **Motion** is short and functional: hover transitions (`--t-fast` 120ms), panel/modal/toast entrances
   (`--t-med` 200ms, a few px of travel), the news crawl, and the tutorial pulse. No bouncing, wobbling or glowing.
   `prefers-reduced-motion` switches all of it off (global rule in `theme.css`).
6. Inline styles in TSX follow the same rules.

## Tokens (`src/ui/theme.css`)
| token | dark | use |
|---|---|---|
| `--bg` | #0f0d18 | app background (ink) |
| `--bg-1` | #191626 | cards, HUD, sheets |
| `--bg-2` | #221e33 | raised rows, inputs' neighbours, hover |
| `--bg-3` | #2d2842 | tracks, pressed, chips |
| `--line` / `--line-2` | | dividers / control borders |
| `--fg` `--fg-2` `--fg-3` | | primary / secondary / labels. `--fg-4` is for disabled only |
| `--accent` (`--amber` is its legacy alias) | #a796ff | THE accent: primary buttons, active states, focus, progress |
| `--accent-3` | | accent tint for selected rows and soft highlights |
| `--on-accent` | | text on accent fills |
| `--up` / `--down` | mint / coral | good / bad, money in / out |
| `--warn` | amber | caution (runway getting short, pending) |
| `--blue` | sky | info, research, intros |
| `--yellow` | gold | milestones |
| `--hub-*` | | one colour per hub (see Navigation) |
| `--shadow-1/2/3`, `--ring` | | resting cards / popovers / dialogs, focus ring |

The light theme (`html[data-theme='light']`) is lavender paper with white cards; every token has a light value.
Canvas charts read tokens at draw time. The camera feeds (office and scenes) keep their own art and stay dark, framed
in a rounded card.

**Type:**
- `Figtree` (`--font`) for text. Base 15px, small 13.5px, minimum 12px. Line-height 1.5 (1.6 in prose).
- `Bricolage Grotesque` (`--display`) for screen titles, card titles, modal titles and big moments.
- `--mono` is the **figures** face: Figtree with tabular numerals, used by `.num`, `td.num`, stat values.
  `--code` (JetBrains Mono) is for `kbd` and canvas labels only.
- Sentence case everywhere. UPPERCASE only for eyebrows, table headings, dock labels and `Pill` tags, all set by CSS
  (never write caps in JSX strings).

## Navigation (information architecture)
The ~15 panels are grouped into five **hubs** (`src/ui/shell/hubs.tsx`). PanelId values never change, and
`navigate(id)` still opens any panel directly.

| Hub | Colour | Panels (tabs) |
|---|---|---|
| Headquarters | accent | Overview (`dashboard`), Versus (`vs`, only during a match) |
| Lab | teal | Models, Research, Data, Benchmarks |
| Infrastructure | orange | Compute, Staff |
| Business | mint | Products, Market, Marketing, Contracts, Finance |
| Company | gold | Level & perks (`lab`), Trophies (`achievements`) |

- **Desktop:** a sidebar of five hub buttons (icon chip in the hub colour, name, one-line blurb, a dot when something
  inside needs attention). Under 1100px it folds to an icon rail. The hub's panels are pill tabs pinned at the top of
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

## Components
- **Card** (`<Card title subtitle actions>`): `--bg-1`, 1px `--line`, `--r-lg`, `--shadow-1`. Title in the display
  face; the header has no strip. `flush` removes the body padding and clips children to the corners. `hot` adds an
  accent ring.
- **Panel header** (`<PanelHeader title subtitle actions>`): the hub as a coloured eyebrow, a 30px display title, one
  line of context. It always renders first in a panel. The legacy `code` prop is accepted and not shown.
- **Button:** 36px (30 small, 44 large), `--r-sm`. Default is a raised `--bg-2` button; primary is solid accent;
  danger and success are tinted. Labels are short verbs in sentence case.
- **Pill:** a tinted capsule in its tone's colour (`color-mix` of currentColor), uppercase 12px.
- **Stat:** label in `--fg-3`, a big tabular value, coloured delta with ▲/▼.
- **Tabs:** pill tabs in a `--bg-2` tray; the active tab is a raised `--bg-1` chip. Segmented controls fill the active
  segment with the accent.
- **Tables:** uppercase 12px headings, 10px row padding, row hover `--bg-2`, `tr.sel` is an accent tint with an accent
  edge, `tr.me` is accent text. On phones use `table-stack` or `table-scroll`.
- **Progress and bars:** 8px rounded tracks in `--bg-3`, rounded fills.
- **Charts:** 1.5–2px lines, soft area fills allowed (14% opacity), series colours in `SERIES_ORDER`
  (accent, fg, blue, up, down, yellow). Tooltips are small raised cards.
- **Modal / Sheet:** `--r-xl`, `--shadow-3`, a display-face title, footer on a `--bg-2` band. `tone="danger"` adds a
  red top edge and a red title.
- **Tooltip / HelpTip:** raised `--bg-2` cards with `--r-md`. A HelpTip is a small round `?` next to any jargon; it
  explains what the thing is and what to do about it in one or two plain sentences.
- **PanelIntro:** a blue-tinted note card under the header, dismissible per screen.
- **Empty states:** a display-face title, one plain sentence, and the button that fixes it.

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
