# LLM: Lets Loose Money: UI design rules ("Executive Suite", v22)

The lab is run from a 1970s executive suite: a hi-fi console set into a leather desk. The frame (top bar and sidebar) is
stitched oxblood leather. Readouts that move (cash, runway, valuation, the run dock, the news ticker) sit behind dark
glass in amber display digits. Panels are bevelled, buttons are physical keys, the one main action is a brass key,
meters are LED segments and runway is a fuel gauge. Labels are engraved in a condensed face. Light is saddle-tan
leather around an ivory desk; the glass displays stay dark, like real hardware. Dark is the default.

The satire lives in the **content** (names, news, events, advisor copy). The chrome is played straight: expensive,
analogue and slightly too serious, like the furniture of a company that has not shipped yet.

Layout and sizing follow shadcn/ui v4 (34px controls, 8px grid). Status colours start from Radix Colors (step 9/11 for
ink, step 3 for tints). The chart series order is Tremor's. 21st.dev was looked at for component patterns, but its
pages ship no usable source, so nothing is copied from it.

`scripts/lint-style.mjs` enforces the hard rules. `node scripts/lint-style.mjs` must print `style lint: OK`.

## Hard rules (lint-enforced)
1. **No emoji** anywhere in UI source (`src/ui`, `src/office`, `src/scenes`). Simple glyphs such as `▲ ▼ ● › ×` are
   fine. Icons are inline SVG line drawings. The sim's `icon` fields are never rendered.
2. **Colours, gradients, textures and depth are tokens.** No raw hex and no `gradient()` outside `src/ui/theme.css`.
   Every `box-shadow` and `text-shadow` references a token or a `var()` colour (`--shadow-*`, `--bevel`, `--emboss`,
   `--deboss`, `--vfd-glow`). Data-driven colours come in through `--c`.
3. **No blur or frosted glass:** no `backdrop-filter`, `filter: blur` or `drop-shadow`. Glass here is dark and solid.
4. **Radii are tokens** above 16px (`--r-sm` 5, `--r-md` 7, `--r-lg` 9, `--r-xl` 12, `--r-pill`). No slanted
   `clip-path` shapes.
5. **House controls only:** checkboxes and switches are `components/Check` (a lamp key and a metal toggle), dropdowns
   are `components/Select`. Never a raw `<input type="checkbox">` or `<select>` outside `components/`.
6. **Motion** is short and mechanical (a key presses 1px, a needle swings). `prefers-reduced-motion` switches it off.
7. Inline styles in TSX follow the same rules.

## Materials
| material | where | tokens |
|---|---|---|
| **Leather** with a dashed cream stitch | top bar, sidebar, phone dock strip, dialog headers | `--tex-leather`, `--leather`, `--leather-2`, `--stitch`, `--frame-fg*` |
| **Desk** with a faint grain | the page behind the panels | `--tex-app`, `--bg` |
| **Panel**: matte, bevelled, dark edge | cards, KPI tiles, rows | `--bg-1..3`, `--edge`, `--shadow-1`, `--bevel` |
| **Key**: raised, presses 1px | `.btn`, segmented options, speed keys | `--tex-key`, `--shadow-key`, `--shadow-key-down` |
| **Brass**: the one main action | `.btn-primary`, the brand mark, ticked checkboxes, the ticker label | `--tex-brass`, `--brass-edge` |
| **Glass**: recessed, amber digits | cash, runway, valuation, run dock, news ticker | `--tex-glass`, `--shadow-glass`, `--vfd`, `--vfd-dim`, `--vfd-glow` |
| **Well**: recessed track | progress bars, meters, inputs, switch tracks | `--tex-well`, `--shadow-well` |
| **LED segments** | every progress bar and dock bar | `--tex-led` (a mask) |
| **Lamps** | sidebar row indicators, speed keys, badges | `--vfd`, `--lamp-off`, `--shadow-lamp-off` |

## Emphasis
- **One brass key per view.** `btn-primary` is the single thing to do here. Other buttons are plain keys; ghost
  buttons are flat text.
- **Indicators are brass** (`--accent`): the active tab's underline, the current row's left edge, focus rings, links.
- **Status colours mean something:** green for good or money in, red for bad or money out, amber for caution, violet
  for best in the world, blue for info. On glass they are lit display colours (`--vfd-good`, `--vfd-bad`).
- **Labels are engraved:** Barlow Semi Condensed, 12px, tracked uppercase, `--fg-3`, `--emboss`. Headings and buttons
  stay sentence case. Card titles are engraved plates (uppercase, 15px).
- **Destructive actions** are a red-edged key and confirm with `ConfirmButton`. Never repeat a red button down a list;
  put it in a row's overflow menu.

## Tokens (`src/ui/theme.css`)
Token names are stable: the canvas scenes (office, finance, models) and charts read `--bg*`, `--line*`, `--fg*`,
`--hl`, `--accent`, `--up`, `--down`, `--warn`, `--sota`, `--blue` and `--mpl-1..6` at draw time.

| token | dark (default) | light | use |
|---|---|---|---|
| `--bg` / `--bg-1..3` | espresso #14100d up to #342b24 | ivory #e8e1d5, panels #f7f2e9 | desk, panels, raised rows |
| `--fg..--fg-4` | cream #f0e7d8 down to #66594b | ink #261d16 down to #a59684 | text |
| `--accent` | brass #e9b453 | dark brass #9a6416 | links, indicators, focus |
| `--hl` / `--on-hl` | brass #e3a940 / dark | same | fills: the primary key, meters |
| `--vfd` | amber #ffb84d | same (glass stays dark) | display digits |
| `--leather` / `--leather-2` | oxblood #4a271b / #3b1f16 | saddle #8a5a35 / #6e4426 | the frame |
| `--up` `--down` `--warn` `--sota` `--blue` | lit LED colours | darker inks | status |
| `--mpl-1..6` | blue, amber, green, red, violet, teal | same hues, darker | chart series (`SERIES_ORDER`) |
| `--tex-hatch`, `--tex-marker` | flat (legacy names) | | kept so older panel CSS still resolves |

**Type:**
- `Geist` (`--font`) for reading, 14px base, 12px minimum.
- `Barlow Semi Condensed` (`--display`, `--label`) for screen titles, card titles, tabs and engraved labels.
- `Geist Mono` (`--mono`, `--figure`, `--code`) for figures (tabular), display digits, code and prompts.

## Navigation (information architecture)
About 15 screens are grouped into five areas (`src/ui/shell/hubs.tsx`). `PanelId` values never change, and
`navigate(id, intent)` still opens any screen directly.

| Area | Screens |
|---|---|
| Headquarters | Overview (`dashboard`), Versus (`vs`, only during a match) |
| Lab | Models, Products, Research, Data, Benchmarks |
| Infrastructure | Compute, Staff |
| Business | Market, The field, Marketing, Contracts, Finance |
| Company | Level & perks (`lab`), Trophies (`achievements`) |

- **Desktop:** the sidebar lists **every visible screen** under its area heading, so any screen is one click away.
  Each row has an indicator lamp; the current screen's is lit. There are no hub tabs on desktop.
- **Phones (≤ 760px):** a bottom tab bar with one tab per area, and the area's screens as tabs at the top of the main
  area (`HubTabs`).
- Locked screens (`ui/unlocks.ts`) are absent until they open. A batch of unlocks is one notice.

## The frame
- **Top bar (leather):** brass mark, company name and date, status tag; then three glass displays: Cash (with today's
  net), Runway (a fuel gauge, E = broke, F = two years or profitable) and Valuation (opens its breakdown); a "More"
  popover, the speed keys (a lamp lights on the pressed one), Inbox and Menu.
- **Sidebar (leather):** the screen list, then the **run dock** at its foot: Training (with tempo), Research and Lab
  (level, Cup and board quarter in a popover) as glass displays with LED bars. On phones the dock is a strip under the
  top bar.
- **News ticker:** an amber glass strip at the bottom.
- **Toasts:** bottom-right, at most two (one on phones), two lines of text at most; the Inbox has the rest.

## Headquarters
It answers "how are we doing, and what should I do next" with **one voice**:
1. Key numbers with trends (on phones they come after the advisor).
2. **Advisor** (`panels/hq/nextStep.ts`) beside the live column: the chapter goal and its progress, then the top moves
   ranked Urgent, Next and Idea, each with a plain reason and one button. Nothing else on the screen gives orders. The
   live column is the training run (with tempo) over research.
3. Money, products and the rival race.
4. The office camera, collapsible.

## Screens
- **Header:** the title in Barlow Semi Condensed with one line of context under it, readouts or actions on the right.
- **Actions first:** the card or list the player acts on comes first. Camera scenes go into a collapsible "Camera"
  card.
- **Short screens:** secondary sections go behind tabs or disclosures. Targets at 1440×900: HQ ≤ 1,400px, Research
  and Data ≤ 1,800px, everything else ≤ 1,500px (`npm run screens` checks them).
- **Master-detail for collections:** Models shows its list on the left and the selected model on the right (a sheet
  on phones).
- **Tips:** `PanelIntro` shows one line on the first visit to a screen and then is gone (Menu brings them back).
- **Alerts:** `Banner` from `panels/panelKit.tsx` (a tinted strip with a coloured rule on the left).

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
