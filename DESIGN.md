# LLM: Lets Loose Money: UI design rules ("Preprint", v18)

The lab's screens are typeset like the papers the lab keeps publishing. Warm paper, a LaTeX-ish serif (STIX Two),
§ sections with a double rule, numbered subsections, booktabs tables, figures in the matplotlib colours, hatched
monochrome bars, a **red pen** for what needs attention and a **highlighter** for what is selected. The tutorial is a
sticky note, the HUD is the paper's running header ("Lets Loose Labs et al."), and the screen tip is the Abstract.
Night print (dark) is the same paper under a desk lamp. Paper is the default.

The satire lives in the **content** (names, news, events, descriptions, advisor copy) and in the paper conventions.
The chrome is played straight, like a carefully typeset preprint about a deeply unserious company.

`scripts/lint-style.mjs` enforces the hard rules. `node scripts/lint-style.mjs --strict` must print `style lint: OK`.

## Hard rules (lint-enforced)
1. **No emoji** anywhere in UI source (`src/ui`, `src/office`, `src/scenes`). Simple glyphs such as `▲ ▼ ● › × § ✓`
   are fine. Icons are inline SVG line drawings. The sim's `icon` fields are never rendered.
2. **Colours, gradients and textures are tokens.** No raw hex in CSS outside `src/ui/theme.css` and no `gradient()`
   outside it. Every `box-shadow` references a token or a `var()` colour. Data-driven colours come in through `--c`.
3. **No glow or glass:** no `text-shadow`, `backdrop-filter`, blur or `drop-shadow`.
4. **Paper is square:** radii are `--r-sm` (2) or `--r-lg` (3), plus `--r-pill` for dots and switches. No slanted
   `clip-path` shapes.
5. **No uppercase.** Labels, tabs and tags use small caps (`font-variant: all-small-caps`, the `.caps` / `.smallcaps`
   classes). `text-transform: uppercase` is allowed only on pills, eyebrows, keys and chips, and even there small caps
   are preferred.
6. **House controls only:** checkboxes and switches are `components/Check` (a hand-drawn red tick), dropdowns are
   `components/Select`. Never a raw `<input type="checkbox">` or `<select>` outside `components/`.
7. **Motion** is short and functional. `prefers-reduced-motion` switches it off.
8. Inline styles in TSX follow the same rules.

## Emphasis
- **One inked button per view.** The primary button (`btn-primary`) is solid ink with paper text: the single thing to
  do here. Secondary buttons are boxed like hyperref links. Ghost buttons read as blue links.
- **Red pen** (`--pen`, `.pen` in the hand font) is for what needs the reader: urgent advisor items, the § mark, bad
  news, armed destructive buttons. Never decorative.
- **Highlighter** (`--tex-marker`, `.marker`) marks what is selected: the current tab, hub, your row in a table.
- **Status colours mean something:** green ink for good or money in, red pen for bad or money out, ochre for caution,
  plum and **bold** for best in the world (as in a results table), steel blue for info.
- **Depth** is a sheet on a desk: cards are flat paper with a hairline. Only dialogs and toasts lift with a shadow.
- **Destructive actions** are a dashed red-pen box until armed (`ConfirmButton`). Never repeat a red button down a
  list; put it in a row's overflow menu.

## Tokens (`src/ui/theme.css`)
| token | paper (default) | night print | use |
|---|---|---|---|
| `--bg` / `--bg-1..3` | desk #f1ece1, sheet #fffdf7 | #12100c up to #2d281f | page, cards, raised rows |
| `--fg` / `--hl` / `--on-hl` | ink #1c1915 / ink / paper | cream / cream / ink | text, primary button, bar fill |
| `--accent` | fountain-pen blue #1f47a0 | #93b2ff | links, focus, accent text |
| `--pen` | red pen #c0261c | #ff8a78 | attention, the § mark, urgent |
| `--marker`, `--tex-marker` | highlighter yellow | dim yellow | selection |
| `--note` | sticky-note yellow | dark yellow | tutorial card |
| `--mpl-1..6` | matplotlib tab10 | brightened | chart series (`SERIES_ORDER`) and hub tints |
| `--tex-hatch` | diagonal hatch | | laid over any solid bar fill |
| `--amber`, `--yellow` | legacy aliases | | resolve to the accent / warn; do not use in new code |

**Type:**
- `STIX Two Text` (`--font`, `--display`, `--figure`) for everything, with lining tabular figures.
- `Caveat` (`--hand`) for the red pen and the sticky note.
- `JetBrains Mono` (`--code`) for code and prompts.
- Base 15.5px, minimum 12.5px.

## Paper conventions
- **Screen title:** `§ Title`, italic subtitle on the same line, a double rule under it.
- **Subsections:** card titles are numbered 1, 2, 3 per screen (a CSS counter), like 3.1, 3.2 in a paper.
- **Abstract:** the one-time screen tip (`PanelIntro`) starts with a small-caps "Abstract.".
- **Tables:** booktabs (heavy top and bottom rules, a thin rule under the head, no zebra, no verticals).
- **Figures:** charts use the matplotlib cycle; camera scenes are framed plates.
- **Table of contents:** the hub nav is numbered 1–5.

## Navigation (information architecture)
About 15 panels are grouped into five **hubs** (`src/ui/shell/hubs.tsx`). `PanelId` values never change, and
`navigate(id, intent)` still opens any panel directly.

| Hub | Panels (tabs) |
|---|---|
| Headquarters | Overview (`dashboard`), Versus (`vs`, only during a match) |
| Lab | Models, Products, Research, Data, Benchmarks |
| Infrastructure | Compute, Staff |
| Business | Market, Marketing, Contracts, Finance |
| Company | Level & perks (`lab`), Trophies (`achievements`) |

- **Desktop:** the hubs run across the top under the HUD as a numbered table of contents; the active one is
  highlighted. The hub's panels are small-caps tabs at the top of the main area.
- **Phones (≤ 760px):** a bottom tab bar.
- Locked panels (`ui/unlocks.ts`) are absent until they open. A batch of unlocks is one notice.

## The frame
- **HUD (running header):** company mark and "Name et al.", date in italics, status pill, then Cash (with today's net), Runway and Valuation, a "More"
  popover, the speed control, Inbox and Menu.
- **Run dock:** three chips: Training, Research and Lab (level, Cup and board quarter in a popover).
- **News ticker:** a quiet strip at the bottom.
- **Toasts:** at most two, solid, bottom-left, never over the main column's controls. Background news goes to the Inbox
  instead of a toast.

## Headquarters
It answers "what is going on, and what should I do next" with **one voice**:
1. **Advisor** (`panels/hq/nextStep.ts`): the current chapter goal and its progress at the top, then the top moves
   ranked Urgent, Next and Idea, each with a plain reason and one button. Nothing else on the screen gives orders.
2. The live strip: training run and research.
3. Key numbers with trends.
4. Money, products and the rival race.
5. The office camera, collapsible.

## Screens
- **Compact header:** `§ Title` with an italic line of context on the same row, actions on the right, a double rule under it.
- **Actions first:** the card or list the player acts on comes first. Camera scenes go into a collapsible "View" card.
- **Short screens:** secondary sections go behind tabs or disclosures. Targets at 1440×900: HQ ≤ 1,400px, Research
  and Data ≤ 1,800px, everything else ≤ 1,500px.
- **Master-detail for collections:** Models shows its list on the left and the selected model on the right (a sheet
  on phones).
- **Tips:** `PanelIntro` is the Abstract: one italic line, shown on the first visit only.
- **Alerts:** `Banner` from `panels/panelKit.tsx` (a margin annotation: tinted strip with a coloured rule on the left).

## Copy
- Plain and friendly: "Runway 3.1 years", "Start training", "Your next moves".
- Point at screens by their names ("Data", "Models", "Fleet priority in Compute").
- One word per action: `deprecateModel` is "Take off sale", `retireModel` is "Retire to Hall of Fame".
- **One confirm rule:** anything irreversible or costing a large share of cash is a `ConfirmButton`.
- The advisor speaks like a sharp chief of staff: an imperative, then one sentence of why.
- Dates read `14 Mar 2019`. Money uses `formatMoney`.
- **Truthful numbers:** never show a reassuring state (Profitable, Out of memory, 0%) that the data does not support.
  Before there is history, show "—".

## Visuals per screen
Every panel has a picture of its subject (camera feed, server room, office floor, token map, share bars, capability
shapes, research timeline, finance waterfall). Visuals are interactive: hover shows exact numbers, click selects or
drills in, and nothing important lives only in a hover. They must work at phone width and in both themes.

### Model anatomy (`components/NetView.tsx`, `components/netSpec.ts`)
Every model can be seen as the network it is: on the model page, in the new-model quick start, on the live training
run, and in the media studio.
- **Proportions are real:** layers and width come from the parameter count and the run's shape (deep or wide).
- **Shape follows the architecture:** dense, MoE (experts behind a router, top-k light up per token), LSTM, SSM hybrid,
  recurrent depth, diffusion LM, U-Net, GAN, transformer denoisers.
- **It runs:** signals cross the net, attention arcs reach back to input tokens, the output picks a token. While
  training, layers past the progress mark are a dashed wireframe.
- **Size ruler:** a log scale from 100M to 10T with parody landmarks.
- Canvas, token colours, paused off-screen, a still frame under `prefers-reduced-motion`.
