# LLM: Lets Loose Money: UI design rules ("Signal", v18)

The UI is a **calm lab console**: blue-black surfaces stepped by lightness, one violet accent for the thing you should
do next, status colours used only for meaning, sentence case, soft corners and tabular figures. It must stay easy to read
for hours and easy to learn. Every screen says what it is for, the home screen gives one answer to "what next", and
jargon gets a plain-language tip.

The satire lives in the **content** (names, news, events, descriptions, advisor copy). The chrome is played straight.

`scripts/lint-style.mjs` enforces the hard rules. `node scripts/lint-style.mjs --strict` must print `style lint: OK`.

## Hard rules (lint-enforced)
1. **No emoji** anywhere in UI source (`src/ui`, `src/office`, `src/scenes`). Simple glyphs such as `▲ ▼ ● › ×` are
   fine. Icons are inline SVG line drawings (see `shell/hubs.tsx`). The sim's `icon` fields are never rendered.
2. **Colours, gradients and textures are tokens.** No raw hex in CSS outside `src/ui/theme.css` and no `gradient()`
   outside it. Every `box-shadow` references a token or a `var()` colour. Data-driven colours (lab colours) come in
   through `--c`.
3. **No glow or glass:** no `text-shadow`, `backdrop-filter`, blur or `drop-shadow`.
4. **Radii are tokens:** `--r-sm` (6), `--r-md` (8), `--r-lg` (10), `--r-xl` (12), `--r-pill` for dots and chips. No slanted
   `clip-path` shapes.
5. **Sentence case.** `text-transform: uppercase` only on pills, eyebrows, keys and chips.
6. **House controls only:** checkboxes and switches are `components/Check`, dropdowns are `components/Select`. Never a raw
   `<input type="checkbox">` or `<select>` outside `components/`.
7. **Motion** is short and functional: hover colour changes, a 1px press, panel/modal/toast entrances, the news crawl,
   the tutorial ring. `prefers-reduced-motion` switches it off.
8. Inline styles in TSX follow the same rules.

## Emphasis
- **One accent per view.** The primary button (`btn-primary`, violet) is the single thing to do here. Everything else
  is a secondary button (surface plus hairline) or a ghost.
- **Status colours mean something:** green for good or money in, red for bad or money out, amber for caution, gold for
  best in the world, sky for info. Never decorative.
- **Depth** comes from surface steps (`--bg` up to `--bg-3`) and 1px hairlines (`--line`, `--line-2`), not coloured
  edges or glows.
- **Destructive actions** are quiet until armed: `ConfirmButton` rests as an outlined danger button and only fills red
  when armed. Never repeat a red button down a list; put it in a row's overflow menu.

## Tokens (`src/ui/theme.css`)
| token | dark | light | use |
|---|---|---|---|
| `--bg` / `--bg-1..3` | #0d0f14 up to #242a37 | paper #f6f5f1, white cards | app, cards, raised rows, buttons |
| `--accent` / `--hl` / `--on-hl` | violet #9d90ff / #8b7cff / white | #5b4ee0 | primary action, selection, focus, progress |
| `--sota` | gold | dark gold | best in the world |
| `--up` / `--down` / `--warn` / `--info` | green / red / amber / sky | darker versions | meaning only |
| `--hub-*` | quiet tints | | the hub icon only |
| `--amber`, `--yellow` | legacy aliases | | resolve to the accent / warn; do not use in new code |

**Type:**
- `Inter` (`--font`) for reading text and labels (12–14.5px, weights 400–600).
- `Space Grotesk` (`--display`, `--figure`) for page titles, card figures and KPIs.
- `JetBrains Mono` (`--code`) for table figures.
- Base 14.5px, minimum 12px.

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

- **Desktop:** the hubs run across the top under the HUD, with a 2px accent underline on the active one. The hub's
  panels are tabs at the top of the main area.
- **Phones (≤ 760px):** a bottom tab bar.
- Locked panels (`ui/unlocks.ts`) are absent until they open. A batch of unlocks is one notice.

## The frame
- **HUD:** company mark and name, date, status pill, then Cash (with today's net), Runway and Valuation, a "More"
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
- **Compact header:** a 22px title with a short line of context on the same row, and actions on the right.
- **Actions first:** the card or list the player acts on comes first. Camera scenes go into a collapsible "View" card.
- **Short screens:** secondary sections go behind tabs or disclosures. Targets at 1440×900: HQ ≤ 1,400px, Research
  and Data ≤ 1,800px, everything else ≤ 1,500px.
- **Master-detail for collections:** Models shows its list on the left and the selected model on the right (a sheet
  on phones).
- **Tips:** `PanelIntro` is one quiet line, shown on the first visit only.
- **Alerts:** `Banner` from `panels/panelKit.tsx` (tinted strip with a status dot).

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
