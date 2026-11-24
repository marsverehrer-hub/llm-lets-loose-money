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

## The raider layer

- You own 60% of your lab and have a personal account. The **rich list** ranks personal net worth, and decides the final standings after ten game years.
- On the **Street** you can buy and sell any company's shares (big orders move the price; trades in the lab you run fill a week later), have your lab **bid for all of a rival** and absorb its models, data, techniques and customers, or **bid personally for control** and take its helm.
- In **Empire** the lab can sell new shares, borrow, pay dividends into your account or buy shares back.
- Sell too many shares and let the price sag, and a tycoon will bid for your lab. Lose, and you are out with your cash and can buy your way back in somewhere else.

## The supply chain

- Power feeds fabs, fabs make chips, chips fill clouds, clouds rent to labs. Each is a listed company with real books.
- The tightest layer decides how much compute exists and collects most of the scarcity premium. Fabs take 48 weeks to build, so crunches last.
- A run keeps the compute price it starts at, so timing matters. A year-long contract caps what you pay for serving and future runs.
- Control a supplier (51%) and you set its prices, its building and who it refuses to serve. Buy a cloud outright with your lab and you get its capacity at cost.

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
  stock.ts      holdings, trading, dividends,      deals.ts   tender offers, mergers, raids
                tycoons                            supply.ts  the chain behind the compute price
  ai.ts         rival CEOs                         goals.ts   yearly races, final standings
  view.ts       read-only selectors for the UI; never exposes a run's hidden truth
  content/      segments, data, techniques, calls, rival labs, jokes
src/ui/         Preact UI: kit.tsx (cards, procedural portraits, charts), 5 screens, full-screen moments
scripts/        bot.ts, balance.ts, smoke.mjs, probe.ts
```

## Roadmap

- **Now:** the model loop against seven rival labs (language, image and, from year three, video models); the raider layer (personal account, trading, dividends, buybacks, debt, tender offers, tycoons who trade and raid, rival labs that consolidate); and the supply chain (three clouds, two chip designers, a fab and two power companies with their own books, a compute price set by the tightest layer, year-long compute contracts, and suppliers you can control or buy outright).
- **Next:** counter-bids and bankruptcy auctions, more endings than the rich list, a regulator that watches suspicious trade timing, more late-game techniques and races.
- **Later:** running hardware companies in depth (a chip-design loop that mirrors the model loop); shorting, options, LBOs, spin-offs.
