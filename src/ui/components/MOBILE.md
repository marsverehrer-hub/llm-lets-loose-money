# Mobile primitives

Phones are 375 to 430px wide (portrait first). The breakpoint is **760px**: at 760px and below the phone layer applies.
The rules live in `src/ui/mobile.css`, which is imported last in `App.tsx`. Desktop (above 760px) is unchanged.

Rules every panel follows on a phone:

- Every interactive element is at least **40px tall**. The global `.btn`, `.input`, `.seg`, `.tab` and `.menu-item` rules already do this.
- Inputs are **16px**, which stops iOS zooming on focus. Global, no action needed.
- No hover-only information. Tooltips open on tap (see `Tooltip`).
- Never let the page scroll sideways. Wide content goes in a `.table-wrap` (scrolls inside its card) or `DataTable mobile="scroll"`.
- Overlays are full screen. Any `.modal` is a sheet on phones with a pinned header and a pinned footer. Use `Sheet` for new overlays.

## useIsMobile()

```tsx
import { useIsMobile } from '../components';

const isPhone = useIsMobile(); // true at <= 760px, updates when the breakpoint is crossed
```

Use it to **switch markup** (a list instead of a graph, a stepper instead of a slider). Use CSS for spacing and sizes.

## Sheet

A dialog that is centred on desktop and a full-screen sheet on phones. The header (title plus close button) and the footer (primary action) are pinned; the body scrolls between them.

```tsx
import { Button, Sheet } from '../components';

<Sheet
  open={open}
  title="Train a model"
  subtitle="Step 2 of 5"
  onClose={() => setOpen(false)}
  footer={<Button variant="primary" block onClick={next}>Next</Button>}
>
  ...body...
</Sheet>
```

`Modal` works the same way (the phone rules apply to every `.modal`); use `Sheet` in new code so the intent is clear.

## DataTable

One component for a list of records. On desktop it is the normal `.table`.

```tsx
import { DataTable } from '../components';

<DataTable
  label="Models"
  rows={models}
  rowKey={(m) => String(m.id)}
  rowClass={(m) => (m.id === selectedId ? 'sel' : '')}
  mobile="stack"            // or "scroll" for dense tables (sticky first column)
  columns={[
    { key: 'name', label: 'Model', primary: true, cell: (m) => m.name },
    { key: 'elo', label: 'Elo', num: true, cell: (m) => Math.round(m.elo) },
    { key: 'price', label: 'Price', num: true, cell: (m) => formatMoney(m.price) },
  ]}
  empty={<EmptyState title="No models yet" />}
/>
```

- `mobile="stack"` (default): on a phone each row is a card. The `primary` column is the heading, the others are label and value lines.
- `mobile="scroll"`: on a phone it stays a table inside its card, scrolls sideways, and the first column stays pinned.

### Existing tables without DataTable

- Wrap a wide table in `.table-wrap` (already overflows inside its card), and add class `table-scroll` for the pinned first column and a 520px minimum width on phones.
- Or stack it: add class `table-stack` to the table and `data-label="..."` to every `<td>`. The header row hides and each cell shows its label.

```tsx
<div class="table-wrap table-stack">
  <table class="table">
    <thead>...</thead>
    <tbody>
      <tr><td data-label="Model">Loosey-2</td><td data-label="Elo" class="num">1412</td></tr>
    </tbody>
  </table>
</div>
```

## Stacked cards for list rows

`.stack-cards` (a `ul`) with `.stack-card` items (`.sel` or `.is-selected` for the selected row, `.me` for the player's own row). Used by `DataTable`, and available for hand-written lists:

```tsx
<ul class="stack-cards">
  <li class="stack-card me">
    <div class="stack-card-head">Your lab</div>
    <dl class="stack-card-body">
      <div class="stack-kv"><dt>Elo</dt><dd class="num">1480</dd></div>
    </dl>
  </li>
</ul>
```

## Slider with step buttons

`Slider` renders the range input with − and + buttons. The buttons appear only on phones, so a finger can nudge the value. Keep `min`, `max` and `step` the same as the plain slider.

```tsx
import { Slider } from '../components';

<Slider label="Learning rate" value={lr} min={0.0001} max={0.01} step={0.0001} onChange={setLr} />
```

Existing `<input class="slider">` markup still works, but on a phone it has no step buttons. Move to `Slider` when you touch a panel.

## Tooltips on tap

`Tooltip` opens on hover (mouse), on focus, and on **tap** (touch and pen). Tapping again or tapping anywhere else closes it. It is placed with fixed coordinates, flips below its anchor when there is no room above, and stays on screen. Nothing else to do.

## Rules in CSS

Use these class names so the phone rules apply without extra code:

| Class | Where | Effect on a phone |
|---|---|---|
| `.modal` | any dialog | full screen, pinned header and footer |
| `.table-wrap.table-scroll` | a wide table | sideways scroll, pinned first column |
| `.table-stack` + `data-label` | a table | stacked cards |
| `.stack-cards` / `.stack-card` | a list | stacked cards |
| `.tb-desk` | top-bar items | hidden (moved into the MENU) |

Tokens only. No raw colours, no gradients, no shadows, no radius over 2px (see `scripts/lint-style.mjs`).

## Store helpers (src/ui/store.ts)

- `useGame()`: subscribes to every tick. Use it in a panel, or in an overlay body that is open.
- `useGameSelect(select, eq?)`: subscribes to one derived value and re-renders only when it changes. Use it in anything that is closed most of the time, such as an overlay wrapper.
  The component that calls `useGameSelect` must **not** also call `useGame()`, or it re-renders every tick anyway.
- `sameItems`, `sameRecord`: equality helpers for arrays and small records.

```tsx
const pending = useGameSelect((s) => s.events.pending ?? null);
return pending ? <EventBody /> : null; // EventBody calls useGame() itself
```
