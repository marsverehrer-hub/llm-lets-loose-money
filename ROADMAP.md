# Roadmap: what would make the game better

This is a prioritised list of ideas, not promises. Each item notes why it matters and roughly how big it is (S/M/L).
Done items are removed; GAME_DESIGN.md §33 lists what v21 shipped.

## Now: polish what is there
1. **Balance pass (M).** On a 2-seed run of the v20 build, every check in `scripts/balance.ts` passed
   except one: an idle lab went bankrupt in 1.9 years against a 2–3 year target. The rival field also sat at its cap
   of 16 labs in both 2025 and 2030, so eras felt alike. Rerun `--all` after the v21 features.
2. **"Why did this happen?" for the rest (M).** Valuation and users now open a breakdown. Revenue, Elo and market share
   still change without a visible cause.
3. **Follow-ups from v21 (S each).**
   - A star you let go should join the lab that poached them.
   - Buying a lab should also transfer its published datasets and research.
   - Board-goal cash rewards count as revenue for earnings guidance and the profitable-year plan; give guidance its
     own revenue counter.
   - Trophy titles show only as a tooltip, so phone players never see them.
   - The sim chunk (`store`) is still ~900 kB; split the static data (events, GPUs, research) out of it.

## Next: multiplayer that people keep coming back to
4. **Chat panel and reactions (S).** The VS screen has a feed; give it a proper input, quick reactions and a
   phone-friendly layout.
5. **Truly async play (L).** Month-by-month mode still needs both players online. Storing the match on a relay would let
   each player take their month whenever they like.
6. **3–4 player matches (L).** The sim already treats a rival as a competitor entry. It needs more snapshot slots and a
   lobby with seats.
7. **Spectate and replays (M).** Watch a friend's match, or replay the valuation race as a chart animation afterwards.

## Later: depth
8. **Regulation and geopolitics arcs (L).** Multi-year storylines: export controls on GPUs, an AI act, compute caps.
   Each has choices that change the rules for everyone.

## Juice and feel
9. **Scenes react to hype and time of day (S).** Darker and busier at night, confetti or rain with hype swings.
10. **Achievements with art (S).** Small pixel badges, shown in the Achievements screen and in multiplayer results.

## Tech
11. **Determinism checks (M).** Run host and guest sims side by side over a full match in tests to catch multiplayer
    drift early (the month-by-month test already runs two sims over a loopback link).
