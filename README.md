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

## Every week

- **Offers** land on the Desk most weeks and expire after two: an enterprise account that pays for a year if you hit a score by a deadline, an app picking its default model, an exclusive data deal, a rival's researcher, a rival wanting to license your old model, a cloud offering a discount for commitment. Saying yes to everything is not the best play.
- **Side projects** run beside your main training run: fine-tune a shipped model toward one market, or distill a cheaper copy.

## Ten years

- A **research budget** buys techniques before they go public; shipping with one shows everyone how, and it goes public 26 weeks later.
- New techniques and architectures arrive through year ten; **Agents** open in year five and **AI scientists** in year seven.
- When everyone aces a benchmark it is replaced by a harder one that rewards something else, so the best model for a market can change overnight.
- Each year has its own **race**. The first language model past the AGI line ends that race; controlling a company in every layer of the stack is its own ending; the rich list decides year ten. The game goes on after each.

## The supply chain

- Power feeds fabs, fabs make chips, chips fill clouds, clouds rent to labs. Each is a listed company with real books.
- The tightest layer decides how much compute exists and collects most of the scarcity premium. Fabs take 48 weeks to build, so crunches last.
- A run keeps the compute price it starts at, so timing matters. A year-long contract caps what you pay for serving and future runs.
- Control a supplier (51%) and you set its prices, its building and who it refuses to serve. Buy a cloud outright with your lab and you get its capacity at cost.

## Hardware

- Control a chip designer and you can **design a chip** by hand: process node, die size, memory, serving or training focus, budget and schedule. The team sees a band on performance and yield that narrows over 8–12 weekly turns of tape-out calls, then first silicon reveals the truth.
- A chip better than the market leader grows its company's capacity. A lab you run gets your chips at cost, which cuts its serving or training bills.
- Fabs are a queue: when they are the bottleneck and you own none, your tape-out slot can slip. Rival chip designers ship a new generation every year, so the bar keeps rising.
- **Build your own datacenter** from Empire: after 8 weeks your lab gets that capacity at cost.

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
  ai.ts         rival CEOs                         goals.ts   yearly races, AGI and endings
  offers.ts     offers, agreements, apps, side     research.ts research, leaks, new markets,
                projects                                       benchmark rollover
  chips.ts      chip design, first silicon, datacenters
  view.ts       read-only selectors for the UI; never exposes a run's hidden truth
  content/      segments, data, techniques, calls, rival labs, jokes
src/ui/         Preact UI: kit.tsx (cards, procedural portraits, charts), 5 screens, full-screen moments
scripts/        bot.ts, balance.ts, smoke.mjs, probe.ts
```

## Roadmap

- **Now:**
  - the model loop against seven rival labs (language, image and, from year three, video);
  - deal flow on the Desk (enterprise contracts, app distribution deals, data deals, poaching, licensing, cloud commitments) and side projects (fine-tunes and distills);
  - a ten-year progression: a research budget, techniques and architectures arriving through year ten, two new markets, benchmarks that saturate and get replaced, ten different yearly races, and four endings (you built AGI, a rival did, vertical monopoly, the final rich list);
  - the raider layer and the supply chain;
  - running a chip company by hand, and building your own datacenters.
- **Next:** counter-bids and bankruptcy auctions; shorting, options, LBOs, spin-offs.
