# LLM: Lets Loose Money (v1.0)

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
- **Multiplayer:** a 1v1 over the internet (Menu, then Multiplayer).

## Development
| Command | What it does |
|---|---|
| `npm run typecheck` | Type checks the project. |
| `npm test` | Runs the test suite (vitest). |
| `node scripts/lint-style.mjs` | Checks the design rules. |
| `npx tsx scripts/balance.ts --all --years=20 --seeds=1,2,3` | Runs the strategy bots and checks the design goals. |
| `npm run package` | Builds the shareable zip in `release/`. |

The design reference is `GAME_DESIGN.md`. Visual rules are in `DESIGN.md`.
