# LLM: Lets Loose Money (v19)

A satirical tycoon about running an AI lab, from a garage in 2017 to whatever comes after AGI. You:
- train models
- buy, crawl, refine or sell data
- ship products
- win benchmark crowns and contracts
- outlast six parody rival labs

## Play online
**https://marsverehrer-hub.github.io/llm-lets-loose-money/**

It works on phones too. To keep it as an app: on iPhone use Safari, Share, Add to Home Screen; on Android use Chrome's menu, then Install app. Every push to `main` redeploys it (`.github/workflows/pages.yml`). For multiplayer, both players open this same link, so they run the same version.

## Playing
- **On this PC:** double-click `start.bat`. It builds the game and opens it at `http://localhost:5380`.
- **For a friend who isn't on your tailnet:** double-click `start-public.bat`. It works like the tailnet launcher below but publishes the same link to the public internet with Tailscale Funnel. Funnel must be enabled once in the Tailscale admin console; the window prints the link if it isn't. `tailscale funnel --https=8443 off` makes it private again.
- **On your phone, or any device on your tailnet:**
  1. Double-click `start-tailnet.bat`.
  2. Open `https://<your-pc>.<your-tailnet>.ts.net:8443/`.
  3. To install it as an app on iPhone, use Safari: Share, then Add to Home Screen.

  The window must stay open while you play. `tailscale serve --https=8443 off` unpublishes it.
- **Dev server:** run `npm run dev` and open `http://localhost:5320`.

Saves live in the browser, so each device and address has its own game.

## Ways to play
- **Scenarios:**
  - Garage (2017)
  - Late to the party (2022)
  - Bootstrapped
  - Open-source collective
  - Sovereign AI
  - Big Tech spinout
  - Data broker
  - AGI speedrun
  - Neocloud (2020): sell GPU capacity instead of models

  Each scenario except Garage has goals and a victory screen.
- **Difficulty:** intern, founder, unicorn hunter or doomer. There is also a sandbox mode with no bankruptcy.
- **Lab focus:** frontier, efficient (small models), open weights, specialist, or enterprise.
  - Weight classes and efficiency benchmarks let small labs win crowns.
  - Contracts and buyer tiers let them make money.
- **Data:**
  - market purchases and licences
  - your own crawler
  - the refinery
  - selling to rivals
  - bounties
  - archive digitizing
  - rival API distillation (risky)
  - data startups
- **Lab levels and perks:** everything you do earns XP. Levels give perk points for a five-branch tree (Scale, Craft, Hype, Data, Trust), and you may own only one capstone.
- **Board goals:** three goals every quarter (easy, fair, stretch), each paid the day you hit it.
- **Run tempo:** push a live run (crunch), protect it (careful), or leave it at standard. Land runs at or above forecast to build a hot streak.
- **Training recipes and media models:** start a run in one click from a recipe (balanced, reasoning, coder, chatty, cheap), or open every knob: optimizer, precision (the formats your GPUs support), shape (deep or wide), mixture-of-experts top-k, tokenizer, context, post-training stages and data annealing. Every knob trades something off, and the memory wall caps model size. Image and video models are a cheaper side business with their own data, arena, rivals and products.
- **Decisions mid-run:** a long pretrain can pause for a call: stop or extend a checkpoint, handle a loss spike (and set a standing policy), decide when to decay the learning rate, or review the data mix. Doing nothing is always a valid choice.
- **Post-training side effects:** alignment stages leave hidden traits (sycophancy, reward hacking, over-refusal). They change how each market segment likes your model, and the training wizard shows them as risk arrows before you launch.
- **Research and the Inbox:** an idle lab banks research points for its next topic, and background news goes to the Inbox instead of popping up as toasts.
- **Model careers:** patch released models from user feedback, watch them gain mastery as they serve users, enter them in the Arena Cup every two months, route easy queries to a small model, and retire your best into a Hall of Fame that keeps paying.
- **Clouds and neoclouds:** seven parody cloud providers with quotas, reserved terms, spot capacity and crunches; or dedicate your own halls and sell capacity to rival labs, startups and enterprises.
- **Look:** the game is typeset as a research preprint (paper, small caps, booktabs tables, red pen for what needs you). Night print is the same paper under a desk lamp.
- **A living field (v19):** about 30 rival labs run real companies. They raise money, buy GPUs from the same scarce
  allocation as you, research, train, release closed or open weights, publish datasets, announce yearly plans, go
  bankrupt and buy each other. See them all on The Field.
- **Open hub:** download rivals' open models and datasets and build on them, license permitting.
- **Serving and families:** quantize to int8/int4, distil a nano/mini/pro family, continue pretraining to ship v2.
- **Safety cases and jailbreaks:** enterprise and government buyers read your safety case.
- **GPUs:** 56 cards from parody vendors, pre-orders, a used market, interconnect and site choices, and your own
  silicon. A tiny studio on 16 GPUs can win Garage Prodigy.
- **AGI endings:** six ways it ends, including someone else getting there first.
- **Multiplayer:** a 1v1 over the internet (Menu, then Multiplayer).

## Development
| Command | What it does |
|---|---|
| `npm run typecheck` | Type checks the project. |
| `npm test` | Runs the test suite (vitest). |
| `node scripts/lint-style.mjs` | Checks the design rules. |
| `npx tsx scripts/balance.ts --all --years=20 --seeds=1,2,3` | Runs the strategy bots and checks the design goals. |
| `npx tsx scripts/econ-probe.ts small 8 1` | Prints one bot's yearly revenue, costs, users and valuation (strategy, years, seed). |
| `npm run package` | Builds the shareable zip in `release/`. |

The design reference is `GAME_DESIGN.md`. Visual rules are in `DESIGN.md`.
