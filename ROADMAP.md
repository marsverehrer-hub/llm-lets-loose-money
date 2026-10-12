# Roadmap: what would make the game better

This is a prioritised list of ideas, not promises. Each item notes why it matters and roughly how big it is (S/M/L).

## Now: polish what is there
1. **Balance pass (M).** Three checks in `scripts/balance.ts` still miss their targets:
   - The frontier strategy turns a profit about half a year early.
   - An idle lab goes bankrupt too fast (1.9 years against a 2–3 year target).
   - $1T arrives around 2030 against a 2032–36 target.
   - Separately, the scripted bot also beats the frontier strategy in 2017–19.
   Fixing these makes the early game tenser and the late game less of a runaway.
2. **"Why did this happen?" (M).** Tap any big number to get a short waterfall of what moved it this month: revenue, cash, valuation, market share, Elo. Most confusion comes from numbers changing without a visible cause.
3. **Short guided scenarios per system (M).** These would replace the long first-run tutorial with five 3-minute missions:
   - First training run.
   - First product.
   - Buy compute.
   - Raise a round.
   - Win a contract.
   Each teaches one screen.
4. **Save export / import (S).** A text code or file that moves a save between devices. Saves on the GitHub link are separate from the PC and the tunnel, so this lets you carry a game over.
5. **Phone screenshot tests (S).** A Playwright script that opens every screen at 375×812 and 1440×900 and fails on horizontal scroll or console errors. It stops layout regressions.

## Next: multiplayer that people keep coming back to
6. **Invite links (S).** `…/?join=ABCDEF` opens the multiplayer screen with the code filled in. One tap from a chat message.
7. **Chat panel and reactions (S).** The VS screen has a feed; give it a proper input, quick reactions and a phone-friendly layout.
8. **TURN fallback (S/M).** Some strict networks (mobile carriers, school or office Wi-Fi) block direct WebRTC. A free or cheap TURN server makes joining reliable.
9. **Async "turn-based" mode (L).** Each player plays a month whenever they like and the match advances when both have. This fits phone play much better than real time.
10. **3–4 player matches (L).** The sim already treats a rival as a competitor entry. It needs more snapshot slots and a lobby with seats.
11. **Spectate and replays (M).** Watch a friend's match, or replay the valuation race as a chart animation afterwards.

## Later: depth
12. **Rival labs with visible strategies (M).** Each AI lab announces a yearly plan ("going all-in on agents"). Players can counter it, and the lab reacts if they do.
13. **Acquisitions (M).** Buy a small lab for its staff, data or a model line, or get acquisition offers yourself.
14. **Open-weights community (M).** Release weights to get community forks that boost brand and data, but rivals can distil you.
15. **Regulation and geopolitics arcs (L).** Multi-year storylines: export controls on GPUs, an AI act, compute caps. Each has choices that change the rules for everyone.
16. **AGI endgames (L).** Several distinct endings (safe launch, race, regulation, merger) instead of the sandbox carrying on forever.
17. **Hardware R&D (L).** Design your own inference chip late game, the "make your own GPU" fantasy.

## Juice and feel
18. **Launch-day scene (M).** A short animated moment when a model ships: the office cheers, the arena board flips, and the camera scenes celebrate.
19. **Scenes react to hype and time of day (S).** Darker and busier at night, confetti or rain with hype swings.
20. **Sound pass (S).** Distinct sounds for releases, crowns, events and money milestones, with a volume slider.
21. **Achievements with art (S).** Small pixel badges, shown in the Achievements screen and in multiplayer results.

## Tech
22. **Code-splitting (S).** The main bundle is over 500 kB. Splitting scenes and rarely used screens makes the first load on a phone noticeably faster.
23. **Error reporting (S).** A tiny "something broke, copy this" box with the stack and save version, so friends can report bugs.
24. **Determinism checks (M).** Run host and guest sims side by side in tests to catch multiplayer drift early, like the arena drift just fixed.
