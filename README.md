# LLM: Lets Loose Money

A satirical strategy game about the AI industry, in the spirit of Wall Street Raider. You take an AI lab public on a slide deck, build models hands-on, and use the money to out-ship and eventually buy out everyone else.

Weekly turns. Phone-first. No backend: the game runs in the browser and saves to local storage.

## Play

```
npm install
npm run dev        # http://localhost:5320
```

On Windows, `start.bat` builds and serves the game without typing anything.

## How a turn works

1. **Desk** shows what needs you: a call on your training run, the year's race, the news.
2. Act on any tab: design a model in the **Lab**, read customers in the **Market**, watch rivals on the **Street**, manage money in **Empire**.
3. Press **End week**. Fast-forward skips quiet weeks and stops when something needs you.

## The model loop

- A **blueprint** spends one currency, compute-weeks, across scale, experiments and post-training. Three technique slots; every technique has a downside; some pairs click or clash, and you only learn which by trying.
- A model is four capability scores plus cost, speed and trust. Each customer segment weighs them differently, so there is no single best model.
- A **run** takes 4 to 8 weeks. Every week brings a report and one call where every option costs something.
- The **forecast band** is what your lab believes. Launch day reveals the truth, benchmark by benchmark.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Typecheck and bundle to `dist/` |
| `npm test` | Sim unit tests (vitest) |
| `npm run balance` | Bots play full games and assert the design holds (no dominant blueprint, calibrated forecasts, skill beats luck) |
| `npm run smoke` | Plays new game to first launch in Chromium at phone and desktop size; fails on console errors, horizontal scroll or small tap targets |

## Code map

```
src/sim/        the game, as pure functions over plain-JSON state
  endWeek.ts    the turn, in ordered phases        apply.ts   every player action
  resolve.ts    blueprint physics (truth | belief) run.ts     weekly runs, calls, launch
  demand.ts     who buys from whom                 books.ts   compute price, P&L, share prices
  ai.ts         rival CEOs                         goals.ts   yearly races, final standings
  view.ts       read-only selectors for the UI; never exposes a run's hidden truth
  content/      segments, data, techniques, calls, rival labs, jokes
src/ui/         Preact UI: kit.tsx (cards, procedural portraits, charts), 5 screens, full-screen moments
scripts/        bot.ts, balance.ts, smoke.mjs, probe.ts
```

## Roadmap

- **Now:** the model loop as a full game against seven rival labs, language and image models, three game years.
- **Next:** real books for every company, a stock market you can trade, share issues and debt, tender offers for rival labs, a rich list.
- **Then:** the supply chain (clouds, chips, fabs, power), contracts, vertical takeovers, antitrust, endings, video models.
- **Later:** running hardware companies in depth; shorting, options, LBOs, spin-offs.
