# LLM: Lets Loose Money: UI design rules ("Pit Wall", v6)

The UI is a **team principal's screens**, in the spirit of motorsport management games: graphite panels with a
brushed-silver sheen and header strips, silver-white type, racing yellow (the team colour) on every edge, big condensed figures, slanted buttons and tags, tables that
read like a timing tower, and the timing-screen colours for meaning. It must stay easy to read for hours and easy to
learn: every screen says what it is for, the home screen says what to do next, and jargon gets a plain-language tip.

The satire lives in the **content** (names, news, events, descriptions, advisor copy). The chrome is played straight,
like a broadcast graphics package for a deeply unserious sport.

`scripts/lint-style.mjs` enforces the hard rules. Run `node scripts/lint-style.mjs`; it must print `style lint: OK`.

## Hard rules (lint-enforced)
1. **No emoji** anywhere in UI source (`src/ui`, `src/office`, `src/scenes`). Simple glyphs such as `▲ ▼ ● › ×` are
   fine; icons are inline SVG line drawings (see `shell/hubs.tsx`). The sim's `icon` fields are never rendered.
2. **Colours, gradients and textures are tokens.** No raw hex in CSS outside `src/ui/theme.css`. No `gradient()`
   outside `theme.css`: surfaces are tokens there (`--tex-app`, `--tex-panel`, `--tex-head`, `--tex-hatch` for
   segmented bars, `--tex-stripe` for table rows). Every `box-shadow` references a token or a `var()` colour (accent
   edges are `inset 4px 0 0 var(--accent)`). Data-driven colours (lab colours) come in through `--c`.
3. **No glow or glass:** no `text-shadow`, `backdrop-filter`, blur or `drop-shadow`.
4. **Radii are near zero:** `--r-sm` (2), `--r-md` (3), `--r-lg` (4), `--r-xl` (6), `--r-pill` for dots. Shapes get
   their character from the slant (`clip-path` parallelograms, `--slant` 9px), not from rounding.
5. **Motion** is short and functional: hover colour changes, a 1px press, panel/modal/toast entrances, the news crawl,
   the tutorial pulse. `prefers-reduced-motion` switches it off.
6. Inline styles in TSX follow the same rules.

## Tokens (`src/ui/theme.css`)
| token | dark | light | use |
|---|---|---|---|
| `--bg` / `--bg-1..3` | graphite #0b0b0c up to #27272b | silver #e7e8eb, panels near-white | app, panels, raised rows, buttons |
| `--hl` / `--on-hl` | racing yellow #ffd000 / near-black | same | fills: primary buttons, active switches, bars, the team badge |
| `--accent` (`--amber` alias) | yellow | dark gold #8a6d00 | accent text and edges (readable on its background) |
| `--sota` | purple | | best in the world (milestones, records), as on a timing screen |
| `--up` / `--warn` / `--down` | green / yellow / red | | improved / caution / bad, money in / out |
| `--blue` | steel silver | slate grey | info, attention arcs (no blue in the chrome) |
| `--hub-*` | yellow, silver, amber, pale gold, steel | | each department's livery: nav underline, eyebrow, panel edges |

**Type:**
- `Titillium Web` (`--display`): titles (900 italic caps), card and panel headers (700 caps, 0.06em), labels and tabs
  (600–700 caps, 0.08–0.1em), buttons.
- `Barlow Condensed` (`--figure`): every number: stats, KPIs, the HUD, table figures. Tabular numerals.
- `Barlow` (`--font`): reading text. Base 15px, minimum 12px.
- Sentence case in JSX strings; CSS uppercases titles and labels.

## Navigation (information architecture)
The ~15 panels are grouped into five **hubs** (`src/ui/shell/hubs.tsx`). PanelId values never change, and
`navigate(id)` still opens any panel directly.

| Hub | Colour | Panels (tabs) |
|---|---|---|
| Headquarters | yellow | Overview (`dashboard`), Versus (`vs`, only during a match) |
| Lab | silver | Models, Research, Data, Benchmarks |
| Infrastructure | amber | Compute, Staff |
| Business | pale gold | Products, Market, Marketing, Contracts, Finance |
| Company | steel | Level & perks (`lab`), Trophies (`achievements`) |

- **Desktop:** the five hubs are the main nav bar across the top, under the HUD (livery icon, caps label, an underline
  when active, a diamond when something inside needs attention). The hub's panels are tabs pinned at the top of
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

## Components (the Pit Wall layer at the end of `theme.css`)
- **Panel** (`Card`): `--bg-1` with a soft top sheen, a header strip (`--tex-head`) with a 3px bar in the department
  colour on its left edge, uppercase title, small caps subtitle. `hot` adds an accent top edge.
- **Panel header:** a slanted dash and the department in its colour, a 40px heavy italic caps title, one line of context.
- **Button:** slanted parallelogram (`clip-path`), solid fill, caps. Default `--bg-3`; primary racing yellow with dark
  text; danger and success tinted. Ghost and icon buttons are square.
- **Pill:** a solid slanted chip in its tone (18% fill, full-colour text). Milestones are purple.
- **Stat / KPI:** small caps label, big condensed figure, coloured delta.
- **Tabs:** caps text with a 3px underline in the department colour. Segmented switches fill the active choice.
- **Tables:** a timing tower: striped rows, caps headings, `tr.me` / `tr.sel` tinted with a 4px accent edge.
- **Bars:** square, segmented like a gauge (`--tex-hatch`).
- **Modal:** slate panel, header strip with an accent edge, 900 italic caps title.
- **Main nav:** the five departments across the top under the HUD (icon in livery colour, caps label, underline when
  active). Phones keep the bottom tab bar.
- **HUD:** a slanted team badge, the company in italic caps, the date, then readouts split by hairlines.
- **Run dock:** telemetry cells with an accent edge. **News:** a broadcast ticker with a slanted NEWS block.
- **Toasts:** team radio: dark panels with a coloured edge (accent, green, red, purple for milestones).
- **Charts:** 1.5–2px lines, series colours in `SERIES_ORDER`. Camera feeds keep their own art in a hairline frame.

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

### Model anatomy (`components/NetView.tsx`, `components/netSpec.ts`)
Every model can be seen as the network it is: on the model page (Anatomy), in the new-model quick start (it redraws as
the recipe and time budget change the size), on the live training run, and for image and video models in the studio.
- **Proportions are real:** layers and width come from the parameter count (params ≈ 12 · layers · width², width ≈
  128 · layers), so 175B draws ~96 layers × 12,288 wide. Up to ~20 blocks are drawn; the rest is a `// +N` break.
- **Shape follows the architecture:** transformer blocks (cyan attention column, MLP column), MoE (experts boxed behind a
  router, two light up per token), LSTM loops, SSM hybrids (square state cells), recurrent-depth and diffusion-LM loops,
  a diffusion U-Net (encoder narrows, decoder widens, skip arcs, noise in, a picture out), a GAN (generator, picture,
  discriminator verdict), transformer denoisers on patches.
- **It runs:** marker-yellow signals cross the net in ~2.5 s, attention arcs reach back to input tokens, the output
  distribution picks a token or the picture denoises. While training, layers past the progress mark are a dashed
  wireframe and signals stop at the frontier.
- **Size ruler:** a log scale from 100M to 10T with parody landmarks (GPTee-2, GPTee-3, Llamaish 405B; image and video
  have their own) and this model marked in marker yellow.
- Canvas, token colours, paused off-screen, a still frame under `prefers-reduced-motion`.
