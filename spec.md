# Bistro Builder — Game Design Document (running spec)

**Status:** shipped, running spec. Present tense describes the game as it behaves today; anything the design wants but the code does not do yet is confined to the final "Design intent not yet implemented" list.

## 1. Overview

**Pitch.** Run one miniature bistro for one service: guests queue at the glowing door and seat themselves, stoves cook dishes into a shared kitchen stock, and you (the waiter in the amber apron) carry plates to tables before patience rings turn red. Coins buy a bigger tray, helper waiters, extra stoves, and knocked-down walls that open more tables. Hit the day's earnings goal before the clock runs out.

| | |
|---|---|
| Genre | Real-time restaurant management / time-management puzzle |
| Players | 1; asynchronous score comparison on ranked content |
| Session | 90 s (Solo Sprint) to 5 min (Marathon); a Journey stage is 2–4 min; a Learn lesson under 1 min |
| Platforms | StarHermit engine 1.16.1 script game: natively in the StarHermit client and in desktop and mobile browsers (portrait and landscape) through the engine's web runtime |
| Rendering | `starhermit:scene` (the three.js model) diorama with fully procedural geometry, plus a `starhermit:ui` "station mirror" that is a complete playable text twin of the board |
| Simulation | Fixed 100 ms tick (every 6 of the runtime's 60 Hz fixed steps), seeded, deterministic, replay envelope recorded per run |

### File map

| Path | Role |
|---|---|
| `starhermit.txt` | Manifest: `engine.api=1`, `engine.entry=native/main.ts`, `engine.version=1.16.1`, `engine.minor=16`, capabilities `platform,storage,clipboard`, the 18 `control.*` actions with their `engine.gamepad.*` defaults and groups, `server=score-script.js`, `cover=cover.jpg` |
| `index.html`, `starhermit-files.json` | The engine's web loader and file index, written by `npm run package` (`starhermit package --web .`); never edited by hand |
| `native/main.ts` | Entry: session (fixed-step ticks, command dispatch + replay envelope, rewind, lessons, urgency cues, terminal → progression, achievements, local score comparison), screen state machine, input routing (actions, gamepad action picker, board taps), lifecycle |
| `native/screens.ts` | `starhermit:ui`: header chips, objective and station rails / drawers, action tray, banner, toast, caption line, every screen |
| `native/render.ts` | `starhermit:scene`: the room, figures, stations, camera framing into the playfield, plane-ray picking, look per graphics level |
| `native/quality.ts` | The browser build's presets and budgets keyed by the runtime's quality tier |
| `native/audio.ts` | Clips on the runtime's mixer, the rendered pad and clinks, the room-tone loop, captions |
| `native/platform.ts` | Engine save (progress), game settings, browser-save and legacy-settings migration, invite, names, score posting |
| `native/classic.ts` | Loads `js/*.js` as classic scripts (a `localStorage` shim over `starhermit:storage`), typed exports |
| `native/i18n.ts`, `native/style.ts` | Locale from the runtime's interface language; UI styles, theme and palette tokens |
| `js/rng.js` | mulberry32 PRNG, FNV-1a `hashString`, three derived streams (rules / decor / AV) |
| `js/rules.js` | Pure rules engine: `createGame`, `legalActions`, `applyCommand`, `step`, `hint`, `hashState`, `serialize` |
| `js/content.js` | 40 Journey stages, 5 lessons, 6 challenges, 3 practice paces, daily generator, 5 themes, validators, rival generator |
| `js/store.js` | Save document shape (settings defaults, progress), checksummed wrapper, `mergeDocs`, local leaderboard, achievement definitions |
| `js/migrate.js` | Engine save document `{ v: 1, progress }`, the browser build's cloud save and per-player settings as they carry over |
| `js/i18n.js` | Every player-facing string in the nine locales (account lines included) |
| `tools/ui-style.css` → `assets/ui-style.json` | The browser CSS rewritten class-based; converted with `npm run css` |
| `tools/plan.mjs`, `tools/package-web.mjs`, `tools/css.mjs`, `tools/browser-play.mjs` | Play-script service plans from the rules, packaging, CSS conversion, headless-Chrome play check |
| `score-script.js` | StarHermit platform script (`server=`): range-checks a finished run's total and posts it to the `high-score` board |
| `server.js`, `data/scores.json` | Local dev server (static files + replay-validating `/api/v1` routes, kept for its tests; not shipped) |
| `sfx/*.opus`, `sfx/manifest.*` | 20 authored clips and the event binding table |
| `assets/key-art.webp`, `assets/results-win.webp`, `assets/results-lose.webp` | Title key art and results illustrations |
| `tests/` | `run-tests.js` (rules/content/persistence/server), `migrate.test.js`, `i18n.test.js`, `native.mjs` + `native/*.play` |

## 2. Vision and design pillars

1. **One tray, many tables.** The whole game is the tension between a single carrier and several patience rings draining at different rates. Rules in: every upgrade changes *how many trips you need* (tray size, helpers, stoves, tables). Rules out: dish variety, recipes, menus, cooking minigames — one dish type keeps the decision about routing, not matching.
2. **The room is the interface.** Legal targets are literally the tables that glow; tapping a table *is* the serve command; tapping the stove *is* pickup. Rules in: highlights derived from `legalActions`, a 1–9 key per table, a text mirror of every station. Rules out: menus between the player and the floor, drag-and-drop, hidden cooldowns.
3. **Spend to breathe.** Coins earned still count toward the goal after they are spent, so buying is never a trade against winning — only against time. Rules in: expansion, hiring, stoves and tray in every non-lesson mode. Rules out: consumables, permanent meta-upgrades, purchases that carry between rounds.
4. **Same seed, same day.** Every guest arrival and patience value comes from one seeded stream stored in the state; a replay of the same command log reproduces every hash. Rules in: seeded dailies, replay-validated ranked scores, 2× fast-forward that provably lands on the same end state. Rules out: rubber-banding, hidden luck, client-trusted scores.
5. **Miniature, warm, readable.** A tilt-shift diorama in ember tones where guest mood is a coloured ring on the floor, not a face. Rules in: procedural capsule figures, one key light, amber door glow, a text twin for every 3D state. Rules out: post-processing that muddies ring colours, particle spectacle over a red ring, camera moves that break picking.

## 3. Player experience

**Target player.** Someone who enjoys short, tidy management puzzles (a "one more day" player) on a phone or during a desk break; comfortable with a 2–4 minute round, wants to see a score breakdown and a clear next step, does not want a 20-hour meta.

**First 60 seconds.** The title screen shows the key art, one dominant **Play** button, and — until all five lessons are done — the line "New here? Start with Learn — five one-minute lessons." Lesson 1 (`learn-serve`) starts you already carrying a dish with a guest seated at table 1; the left rail reads "Lesson: Serve a guest — Serve the waiting guest." and the hint line (from `BBRules.hint`) says "A guest is waiting at table 1." Tapping the table, pressing `1`, or pressing the mirror's **Serve** button walks the waiter over, the plate lands with a clink, "Guest served for N coins" is announced, the bell rings for the lesson step, and the results screen appears within ~3 s. Each following lesson adds exactly one rule: pickup, patience triage (amber first), buying a tray, hiring + expanding. Journey stage 1 then disables every upgrade so the first real day is pure serving.

**Session shape.** Pick a mode (one tap from title for Daily and Journey, two for anything else) → 3-2-1 countdown with a hand bell → 2–4 minutes of service in which the first 30 s are calm, upgrades come online around 40–60 coins, and the last 30 s are a red-clock rush → results table → **Play again** / **Next stage** / **Home**.

**Emotional beat.** The core beat is *the save*: a ring at 25 % and red, your tray has one plate left, and the walk resolves with two ticks to spare. Everything around it (bell on dish-ready, wood-block warning knock, door slam on a loss) exists to make that moment legible and earned.

## 4. Core loop and rules contract (`js/rules.js`)

### 4.1 Board and entities

- **Grid** `cfg.grid` (w×h, 9×7 up to 13×11). Row 0 is the kitchen wall. Tables are blocked tiles; everything else is walkable (`walkable`).
- **Tables** (`tableSpots`): the fixed two-row plan `x ∈ {2,4,…,≤w-2}`, `y ∈ {2,4,…,≤h-2}`, ids in that order. The first `cfg.openTables` are open; the next `cfg.closedTables` are walled off (`open:false`) until an expansion buys them.
- **Stoves** (`stoveSpots`): `(1,0), (3,0), …` along row 0; `cfg.stoves` exist at start, up to `cfg.maxStoves`.
- **Waiters**: waiter 0 is the player (home `(1, h-1)`, capacity `cfg.startCapacity`); helpers (`kind:'helper'`, capacity 2) spawn at `(min(1+n, w-1), h-1)`.
- **Guests**: `{status: queue|seated|eating, tableId, patience, maxPatience, eatTicks, seatTicks}`.
- **Stock**: shared kitchen dishes, capped at `stoves × 3` (`stockCap`).
- Timing constants: tick 100 ms; move 2 ticks per tile; interact 2 ticks; a stove cooks one dish in 40 ticks; seating walk 12 ticks; eating 30 ticks; first guest at tick 20.

### 4.2 Commands (`applyCommand`)

| Command | Legal when | Effect |
|---|---|---|
| `serve {table}` | table exists, open, has a seated (not eating) guest, and `stock + player.carrying > 0` | Player task `serve`: stage `deliver` if carrying, else `pickup` at the nearest stove first, then deliver. Re-issuing the same table is idempotent. |
| `pickup` | `stock > 0` and `carrying < capacity` | Walk to nearest stove, take `min(capacity−carrying, stock)`. |
| `goto {x,y}` | tile walkable | Walk there (floor tap); no other effect. |
| `buy {item}` | `cfg.mechanics[item]`, level below cap, `coins ≥ cost` (`buyInfo`) | `capacity`: +1 tray slot; `helper`: new autonomous waiter; `stove`: next slot, `stockCap += 3`; `expand`: open the next `cfg.expandSize` closed tables. |
| `resign` | any time | Terminal `resigned`, loss. |

Invalid reasons (`INVALID`): `game-ended`, `unknown-command`, `malformed-command`, `bad-table`, `table-not-open`, `no-waiting-guest`, `no-dishes-available`, `mechanic-not-available`, `cap-reached`, `insufficient-coins`, `tile-not-walkable`. `native/main.ts` maps each (`inv.<reason>`) to a player sentence in the red toast and a live-region announcement.

Costs (`content.js DEFAULT_COSTS`): tray 30/60/100, helper 50/90/140, stove 45/80, expand 40/90/150. "Frugal" and "Shoestring" override them.

### 4.3 Tick resolution order (`step`)

1. **Stoves** advance `progress`; at 40 a dish is added to stock (event `dish-ready`). A full stock resets progress to 0.
2. **Spawn**: `spawnTimer--`; at 0 draw the next interval from `spawn.lo..hi` (rules stream) and, if fewer than `cfg.maxQueue` guests are queued, push a guest with patience drawn from `patience.lo..hi` (event `spawn`).
3. **Seating**: for each free, open, unreserved table in id order, the earliest unassigned queued guest reserves it and starts a 12-tick walk.
4. **Guest lifecycle** (reverse order): walking guests count down and sit (event `seat`; patience only drains once seated — queued guests without a table drain too); `patience--` — at 0 the guest leaves (`leave-angry`, `score.lost++`); eating guests count down and leave (`leave-happy`), freeing the table.
5. **Helpers** with no task pick deterministically: carrying and a waiting table → deliver to `urgentTable` (lowest patience ratio, then lowest id); else stock available and room on tray → pickup; else walk home.
6. **Movement** for every waiter (2 ticks per tile via `cool`), then `interact` counts to 2 and `resolveTask` fires: pickup takes dishes; deliver serves if the table still has a seated guest, otherwise `fizzle`.
7. **Terminal**: `earned ≥ goal` (goal > 0) → `goal-reached` win; else `tick ≥ dayTicks` → `day-complete` win when `endless` or goal 0, otherwise `day-failed`.

All randomness is `RNG.derive(seed, STREAM_RULES)`; the stream state is stored in `state.rngState` so serialization is exact.

### 4.4 Scoring (`resolveTask`, `finish`, `recomputeTotal`)

- Serve pays `price + tip`, where `tip = round(tipMax × patience / maxPatience)` at the moment the plate lands. Both `coins` and `earned` increase by the full amount; `score.servePoints += price`, `score.tips += tip`.
- `timeBonus = floor((dayTicks − tick) / 10)` only on `goal-reached`.
- `total = servePoints + tips + timeBonus − 10 × lost`. Integers throughout; formatting happens in `ui.js#buildResults`.

**Worked example** (Journey 1, price 8, tipMax 6, 120 s day): 8 guests served → 64; tips at 100 %, 80 %, 75 %, 50 %, 40 %, 20 %, 100 %, 90 % of patience → 6+5+5+3+2+1+6+5 = 33; goal of 60 reached at tick 900 → bonus (1200−900)/10 = 30; one guest lost → −10. **Total 117.** Journey stars (`ui.js#starsFor`): 3 at `par.score` (90) or better, 2 at 75 % of par, 1 for any win — so 117 is three stars.

### 4.5 Terminal, ties, replay, undo, hints

- Terminal reasons: `goal-reached`, `day-complete`, `day-failed`, `resigned`; `terminal.score` is a frozen copy, `elapsedMs = tick × 100`.
- Leaderboard ties (`store.js#sortEntries`, mirrored in `server.js`): higher score, fewer invalid commands, lower `durationMs`, then `sessionId` string order.
- Replay envelope (`native/main.ts` `onTerminal`): `{v:1, build, contentVersion, cfgId, seed, initialHash, t0, commands[{tick,id,cmd}], hashes (every 50 ticks + terminal), terminal, sessionId, invalid, durationMs}`. Command ids `c<tick>-<seq>` are unique per session; duplicates are rejected client- and server-side.
- **Undo** (`native/main.ts` `undo`): available when `cfg.mechanics.undo` (Learn, Journey, Practice; never Daily or Challenges). A serialized snapshot is pushed before every accepted command (max 120); undo pops one, filters the command log to `tick ≤ restored tick`, and rebuilds the scene.
- **Hint** (`rules.js#hint`) reads only `legalActions`: urgent serve → any serve → pickup → "kitchen still cooking" → affordable upgrade → "wait for the next guest". The HUD hint line shows it continuously; the Hint button/`H` toasts it and highlights the table.

## 5. Modes and progression

| Mode | Entry | Content | Ranked | Undo | Notes |
|---|---|---|---|---|---|
| Learn | Play → Learn | 5 lessons (`LESSONS`): serve, pickup, patience, tray, hire+expand | no | no | Scripted `setup` states, spawn disabled (999 s), goal 0. Completion writes `tutorialDone[id]`. |
| Journey | Title → Journey | 40 stages `j01`–`j40`; every fifth is "Mastery" | no | yes | Stage N+1 unlocks when stage N has ≥1 star. Best stars and score stored per stage. |
| Daily | Title → Daily challenge | `dailyCfg(UTC date of the device)` | yes | no | Seed `hashString('bistro-daily-YYYY-MM-DD')`; 4–5 open tables + 2 closed, guests every 4–5 to 6–8 s, patience 18–22 (+8) s, 150 s, goal derived from expected guests. Replayable all day; best score kept; streak tracked. |
| Practice | Play → Practice | calm / normal / rush (`PRACTICE`) | no | yes | Endless 180 s day (goal 0 → `day-complete`), random seed per start, 11×7 room. |
| Challenge | Play → Challenge | Solo Sprint, One Tray, Tiny Room, Rush Hour, Frugal, Marathon | yes | no | Constrained rulesets; seeds are `hashString('bistro-challenge-<id>')`. |

**Difficulty curve (Journey).** j01–j05 introduce serving, tray, expansion and the first mastery (two rooms, 200 goal). j06–j10 add helpers, shorter patience, stoves and a 4-queue rush. j11–j20 widen the room (11×7, 11×9), cut price ("Thin Margins"), cut patience ("Fickle Foodies", 16–22 s) and start you in debt ("Expansion Debt": 20 coins, 4 walls). j21–j30 reach 13×7/13×9 rooms and 6-guest queues; j31–j40 push spawn to every 3–4 s, 7–8 tables, 8-deep queues and a 600-coin goal in "Mastery: Star Service". `validateCfg` rejects any stage whose goal exceeds 85 % of the theoretical ceiling `daySec/avgSpawn × (price+tipMax)`.

**Achievements** (`store.js ACHIEVEMENTS`, granted in `native/main.ts` `checkAchievements`, idempotent): `first-service` (any completed round, lessons included), `full-house` (win with 0 lost and ≥8 served), `century` (100 served lifetime), `crew-chief` (5 hires lifetime), `mastery-row` (a star on every mastery stage), `regular` (3 distinct daily dates).

**Cosmetics.** Five themes (Ember, Mint, Noir, Sunset, Frost) recolour floor, walls, tables, cloth, metal and door glow; they never touch rules or ring colours.

## 6. Controls and interaction

Actions are declared in `starhermit.txt`; players rebind keys and pads in the runtime's Options (F1), and the Help → Keyboard card lists the effective keys (`bindingLabel`).

| Action | Keys | Gamepad | Effect |
|---|---|---|---|
| `table1`–`table9` | `1`–`9`, `Numpad 1`–`9` | — | `serve {table}` |
| `pickup` | `K` | West (X) | `pickup` |
| `hint` | `H` | North (Y) | hint toast + table highlight |
| `undo` | `U` | Left shoulder | rewind (practice / Learn / Journey) |
| `speed` | `F` | Right shoulder | toggle 2× |
| `camera` | `C` | Right stick press | re-frame the room |
| `pause` | `P`, `Escape` | Start, East (B) | pause; on an in-round overlay (pause, settings, help) close it and resume; on a menu screen, back to the title |
| `prev_action` / `next_action` | `[` / `]` | D-pad left / right | cycle the legal actions with a toast ("Serve table 2", "Buy Bigger tray (30c)") |
| `commit` | `Space` | South (A) | do the chosen action |

Pointer and touch: tapping a table serves it, a stove picks up, a floor tile walks there (`goto`); a drag over 10 px or a hold over 600 ms commits nothing. Every HUD, rail and screen control is a `starhermit:ui` widget reachable by Tab/arrows + Enter and by gamepad navigation; after a tray click focus returns to the room so action keys play.

**Locking.** Commands are refused while paused, during the 3-2-1 countdown, and after terminal (`not-active`). Fast-forward runs a tick every 3 fixed steps instead of 6, never changing the rules. The sole non-interruptible phase is the 2-tick interact; a new serve command re-targets the walk.

**Feedback per input.** Accepted command → `order-noted` clip; buy → cash register, wall knock or apron cue; rejected → red toast with the reason, `error-buzz`, and "Not allowed: …" announced; hint → toast + sparkle + table ring scaled 1.18×; pause → the beds fade and the pause screen; rewind → swoosh + "Rewound" toast.

## 7. Screens and UI flow

```
title ─┬→ modes ─┬→ learn ──────┐
       │         ├→ journey ────┤
       │         ├→ practice ───┼→ [countdown] → service ⇄ paused ─┬→ settings / help → paused
       │         ├→ challenge ──┤                    │              └→ leave service ┐
       ├→ daily ─┴──────────────┘                    ↓ terminal (+0.9 s)            │
       ├→ journey (direct)                      results ─┬→ play again / next stage │
       ├→ profile / leaderboard / settings / help        └→ home → title ←──────────┘
```

Screens are full-window `starhermit:ui` sheets (max 720 px) that scroll when taller than the window; opening one focuses its first control once its layout settles (inside a scroll area focus may not take, so a tall screen is also driven by pointer). Settings/Help opened from Pause return to Pause; the header's Menu pauses during play.

**Layouts (`native/screens.ts`, by the window's logical size).**
- Wide (≥ 1024 px): header bar (title + sub, Coins / Earned / Clock / Served chips, Menu), 240 px left rail (objective, progress bar, hint, lesson step), 260 px right rail (station mirror, upgrade grid), the room framed in between above the action tray. Left-handed swaps the rails.
- Compact (< 1024 px): the rails are drawers opened by the header's Objective and Stations buttons; "Always show station panel" docks the right one. The chips wrap onto a second header row when they do not fit.
- Portrait phone (≤ 700 px wide): the tray's buttons three to a row across the bottom; the title's sub-heading is dropped.
- Short landscape (≤ 500 px tall): the tray is a column at the right of the playfield; the title drops its key art.
- The camera frames the room into the playfield the header, rails and tray leave (`render.frameRoom`).
- Toasts sit above the tray during play (one line, wrapping when long); over a screen they float at the window's bottom.
- The runtime's safe area insets every placement; its interface size and text size scale everything.

**Never cut off:** the four stat chips (they wrap), the tray, the results table and its buttons, and the station mirror's Serve buttons.

## 8. Art direction

**Palette (CSS tokens).** Background `#14100d`, panel `#211a15`, panel-2 `#2b221b`, ink `#f2e9dd`, dim ink `#b8a894`, accent `#e8a54b`, danger `#e0574d`, ok `#7fd08a`, focus `#ffd27a`. High contrast: `#000/#101010/#1c1c1c`, ink `#fff`, accent `#ffd27a`, focus `#00e0ff`. High-visibility palette: accent `#ffb340`, danger `#ff6f61`, ok `#4dd0e1`.

**Scene colours (`native/render.ts`).** Background `0x14100d`; key light `0xffeedd` @2.2/π from direction (6,12,4) aimed at the room centre with the engine's view-based soft shadow; hemisphere fill `0xd8ccbc`/`0x30231a` @0.9/π (0.55/π when reflections are on); ACES tone mapping at exposure 1.05, sRGB output. Player waiter `0xe8a54b`, helpers `0x7ec8e8`, skin `0xf0d8b8`, guest bodies cycle `0xc96f4a, 0x6f8fc9, 0x8fc96f, 0xc9c06f, 0xa06fc9`; patience ring lerps green `0x7fd08a` → amber `0xffb35c` → red `0xe0574d` at 50 % / 0 %; legal-target ring `0xffd27a`.

**Theme table (`content.js THEMES`).**

| Theme | accent | floor / alt | wall | table | wood | cloth | metal | glow |
|---|---|---|---|---|---|---|---|---|
| Ember | #e8a54b | 4a3527 / 54402f | 2e2018 | 8a5a34 | 6b452a | a33b2e | 8f9096 | ffb35c |
| Mint | #6fd6a8 | 2f4a42 / 38564d | 1e302b | 5f8a6e | 47705c | 2e6e5c | 9aa5a0 | a8f0cd |
| Noir | #9aa7ff | 2b2b33 / 34343d | 1a1a20 | 4d4d5c | 3d3d47 | 5c2e4d | 7d7d8a | bdc7ff |
| Sunset | #ff8a6b | 54343a / 613e44 | 33222a | 8a5a48 | 6e463c | b3503e | 96898a | ffb08a |
| Frost | #7ec8e8 | 36444f / 40505c | 232e36 | 5c7484 | 4a5e6c | 3e6e8a | 9aa5ad | bfe4f5 |

**Shape language.** Everything is a rounded primitive: capsule bodies with sphere heads, cylinder tables with a cloth disc, box stoves with a burner ring, a pan and translucent steam puffs, an instanced 0.98-tile checkerboard floor, 0.9-unit walls, a wooden counter along the kitchen row, six seeded wooden props outside the left wall (decor stream, cosmetic). Walled-off tables render at 35 % opacity behind a rotated grey barrier that is removed the tick the wall opens.

**Graphics.** Materials are PBR (`MeshStandardMaterial`; clearcoat `MeshPhysicalMaterial` on table tops, tray plates, the polished counter slab and, with surface detail, the floor tiles). Effects per graphics level: key-light shadows (1024²/2048²/4096²); image-based lighting from three.js's `RoomEnvironment` prefiltered with `PMREMGenerator.fromScene` (environment intensity 0.3 against the materials' 0.35–0.5); `renderer.ao` contact darkening; `renderer.bloom` limited to emissive sources (threshold 0.92: candle flames, festoon bulbs, lit burners, the door glow); `renderer.grade` (display space: gentle S-curve, +10 % saturation, warm highlights / cool shadows, vignette 0.24); FXAA, SMAA or MSAA. **Surface detail** adds procedural `starhermit:canvas` textures (speckled, bevel-edged floor tiles; wood grain; mottled plaster; the street pool of light), a dark wood cap rail on every wall, a stone counter slab, a candle per table, a festoon of warm bulbs on a cord of thin cylinders between two posts, and the street outside. **Steam** high gives each cooking stove rising, swelling, fading puffs (low: one bobbing puff). **Ambient animation** flickers candles, bulbs and burners and bobs the guests; reduced motion stops it, the steam, the marker pulse, interpolation and camera impulses, and shortens the countdown beat to 200 ms.

**Graphics level.** The runtime's Options › Graphics owns Auto and the ten levels, render scale and pixel-ratio cap, adaptive resolution, the frame-rate limit and readout. `native/quality.ts` maps the frame's quality tier to the browser build's presets (its 60 FPS-tuned table) and budgets; the steam puffs scale with the level above the tier's first (≤ 2×). A change that alters the budget rebuilds the room.

| Tier | Shadows | AO | Bloom | Grade | AA | Reflections | Steam | Detail | Animation | Materials | Segments | Textures | Puffs | Bloom res. |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| low | off | off | off | off | MSAA | off | low | plain | static | Lambert | ×0.5 | ×0.5 | 2 | ½ |
| balanced | 1024² | off | on | on | FXAA | on | low | detailed | animated | standard | ×0.75 | ×1 | 3 | ½ |
| high | 2048² | on | on | on | SMAA | on | high | detailed | animated | physical | ×1 | ×1 | 6 | ¾ |
| ultra | 4096² | high | on | on | MSAA | on | high | detailed | animated | physical | ×1.5 | ×2 | 10 | full |

**Hero.** The room itself, framed by a 38° perspective camera along the authored elevation/back ratio (11 : 8.5) at the distance that keeps every corner (plus the door queue and a margin) inside 90 % of the playfield, slid sideways to centre it there. The player waiter carries a pulsing amber ring.

**Typography.** The runtime's system UI face, 16 px base (the player's text size on top), the logo at 3.4 em (2 em on phones and short landscape). Descriptions and help wrap as paragraphs.

**Motion.** Waiters lerp between tick positions with the fixed-step alpha; serve gives a 0.03-amplitude 0.18 s camera impulse and win/lose 0.08/0.4 s, after which the framed pose returns.

**Visual assets the design calls for.** Title key art (miniature bistro diorama, 16:9), a win illustration (cleared table, full tip jar) and a loss illustration (closed room, empty jar) for results, and a platform cover derived from the key art. All four ship (see §15). Board geometry is deliberately procedural, so no 3D model asset is required.

## 9. Audio direction

**Mix.** The runtime's buses (Options › Audio owns volumes, mute and the voice limit): the one-shots and the ambience on `effects`, the countdown tap on `interface`, the pad on `music`; the browser build's default levels (effects 90 %, music 50 %, ambience 50 %) are folded into each sound's gain. One-shots are the authored Opus clips, loaded once the mixer runs (in browsers after the first press); the browser build's synthesized stand-ins while a clip loaded are not ported. Pitch variants (±6 %) on `cmd`, `spawn`, `pickup`, `serve` and `leave-happy` come from the seeded AV stream. Music is the low-passed triangle/sine pad walking C–Dm–G/B–Am every 4.8 s, each chord rendered once into a clip. Ambience is the authored `bistro-ambience` clip looped, with soft clinks (three rendered pitches) every 2.5–7.5 s. Pause fades the ambience and holds the pad.

**Captions.** When "Captions for sound cues" is on, each event prints its caption (`cap.<event>`, prefixed ♪) in the caption line above the tray for 1.8 s.

**SFX event table** (source of `sfx/manifest.txt`):

| Event id | File | Sound | Usage |
|---|---|---|---|
| `ui` | ui-tap.opus | soft wooden button tap | countdown "3, 2, 1" |
| `cmd` | order-noted.opus | pencil tick on a notepad | every accepted serve / pickup / goto |
| `spawn` | guest-arrive.opus | door bell jingle | guest joins the queue |
| `seat` | chair-scrape.opus | chair scrape + sit | guest sits down |
| `dish-ready` | dish-ready-bell.opus | kitchen pass bell | stove finishes a dish; lesson step advance |
| `pickup` | tray-pickup.opus | plates onto a tray | waiter loads dishes |
| `serve` | plate-serve.opus | plate set down, cutlery clink | dish delivered, coins paid |
| `leave-angry` | door-slam.opus | cafe door slam | patience expired |
| `leave-happy` | guest-thanks.opus | coin purse jingle + hum | guest finishes eating |
| `buy` | cash-register.opus | mechanical cha-ching | tray/stove purchase, resign |
| `invalid` | error-buzz.opus | muted buzzer | rejected command |
| `win` | day-complete-fanfare.opus | brass fanfare, glasses | goal reached / day complete |
| `lose` | day-missed.opus | descending horn | day failed / resigned |
| `undo` | rewind-swoosh.opus | pages flipping back | rewind |
| `hint` | hint-sparkle.opus | tiny bell glissando | hint shown |
| `service-start` | service-open-bell.opus | hand bell rung twice | "Service begins!" ends the countdown |
| `expand` | wall-knock.opus | mallet through lath and plaster | expansion bought |
| `urgent` | patience-tick.opus | two wood-block knocks | a guest first drops under 30 % patience (once per guest) |
| `hire` | helper-hired.opus | apron snap + two claps | helper bought |
| `ambience` | bistro-ambience.opus | cafe room tone, chatter, cutlery | 10 s loop on the ambience bus during play |

## 10. Localization

Nine locales ship for all player-facing text: **en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT**.

- **Strings**: `js/i18n.js` holds the header, rails, HUD, objective, hints (from the structured `{key, vars}` of `rules.hint`), refusal reasons, toasts, announcements, captions, every screen, the station panel and upgrades, results, pause and gamepad prompts, the StarHermit account lines (`acct.*`) and the content names (40 stages, 6 challenges, 3 paces, 5 lessons with every step, 5 themes, 6 achievements). `content.js`/`store.js` keep English data; names come by id.
- **Language**: the runtime's interface language (`preferences().language`: Options › Language, else the account's preferred language, else the device's) maps to the nearest shipped locale (`es-MX → es-419`, `en-AU → en-GB`, `fr → fr-FR`, `pt-PT → pt-BR`); a change applies on the next frame to every screen and the running service (the UI is rebuilt every frame). The game has no language menu of its own.
- Colour emoji icons in the tables (🍽 💡 ⏪ ⏩ ⏸ ⏱ 🏆 🏅) are dropped where drawn (`tx`): the runtime's fonts have no colour emoji.
- Layout tolerates expansion: chips wrap, long labels become paragraphs, upgrade labels wrap inside their buttons.

## 11. Accessibility

- **Keyboard and gamepad:** every control is a `starhermit:ui` widget (Tab/arrows + Enter; D-pad + South); number keys serve tables; the gamepad's action picker plays the whole service; Escape / B closes in-round overlays.
- **Screen reader:** `ui.announce` reports round start, lesson steps, each serve with its payout, angry departures, urgency warnings and every rejected command; the station mirror is a complete text twin of the room.
- **Captions** for every sound event (§9); no information is audio-only.
- **Contrast and colour:** the runtime's high contrast swaps the palette tokens to black/white with a cyan focus ring; the game's "Color-vision-safe palette" (high visibility) swaps accent/danger/ok to orange/cyan. Patience is ring colour *and* the mirror's "Waiting · Ns" with urgent styling.
- **Reduced motion, interface size and text size** come from the runtime's Accessibility options; Left-handed rails, Haptics (stored; nothing vibrates yet), Always-show station panel and Fast-forward speed are the game's Settings.
- **Targets:** buttons are ≥ 44 px tall (36 px for the in-list small buttons).

## 12. StarHermit integration

- **Package:** `starhermit.txt` (§1 file map); `.starhermitignore` leaves out `tests/`, `tools/`, `server.js`, `data/`. `npm run package` writes the web loader and file index after every change.
- **Player:** `player()` from `starhermit:platform`; the title's account line reads "Playing as <name> · progress synced / saving… / cloud sync unavailable", or "Offline — progress is stored on this device." for a guest, or the signed-out notice after `onSessionEnded`. Signing in is the runtime's: the title's **Sign in with StarHermit** calls `requestSignIn()`. **Invite a friend** (signed in) copies the prefetched `inviteLink()` with `clipboard.writeText`.
- **Save:** progress is the game's save (`saves`, `{ v: 1, progress }`, schema 1): on the device and in the account's slot; a conflict merges both (`mergeDocs`: more Journey stars, better bests, finished lessons, larger lifetime stats, latest `lastDaily`, every achievement at its earliest unlock); a newer account copy loaded later is merged in. The browser build's cloud save (slot `game:<slug>`, the SDK's checksummed `{ sum, payload }` document) shows as foreign: its progress is merged in, its game settings kept where the account has none, and it is replaced once (`replaceForeign`). Old browser `localStorage` progress of guests cannot migrate.
- **Settings:** the game's own options (`captions`, `theme`, `colorPalette`, `leftHanded`, `haptics`, `boardMirror`, `speed`) are `settings` (game.<key>, synced with the account). The browser build's per-player keys are read once through `settings.legacyKeys()`: the game's own carried over unless set since, the rest (volumes, mute, graphics, reduced motion, contrast, text size, `ui.language`) dropped — the runtime's Options own them — and all removed.
- **Leaderboard:** signed in, every finished run except lessons posts its total through `score-script.js` (a practice session whose socket carries `{ type: 'result', scores: { 'high-score': total } }`); the results card shows "Leaderboard rank: #N" (or posted / not posted). Guests post nothing.
- **Local boards:** ranked rulesets (daily, challenges) keep a per-ruleset comparison on the device (`storage` key `bistrobuilder.leaderboards.v1`, top 100, ties by score, fewer invalid commands, shorter duration, session id) with the seeded house regulars; names of rows carrying a player id resolve through `profile()`.
- **Daily date:** the device's UTC date (the engine has no server-time call; the browser build's `/api/v1/time` sync is gone).
- **Lifecycle:** a hidden window pauses the service (`onSuspend`) and flushes the save; coming back shows "Service paused while you were away".

**Not used:** platform achievements (local in the save document), presence, rooms, matchmaking, chat, voice, replays, the `server.js` routes.

## 13. Technical architecture

- **`rules.js`** is pure: no DOM, no `Date`, no `Math.random`; state is plain JSON with a `v` field; `hashState` uses a stable key-sorted stringify. The same file runs in Node for tests and the server, and in the engine as a classic script.
- **`native/main.ts`** owns the session `{state, cfg, mode, lesson, commands, hashes, cmdIds, undoStack, over, paused, prev, speed, sub, countdown, …}`: `onFixedUpdate` (60 Hz) counts the countdown beats (38 steps, 12 with reduced motion), advances a rules tick every 6 steps (3 at 2×), drains events to audio/announcements/lessons, hashes every 50 ticks and opens results 0.9 s after terminal; `onRender` syncs the room with the interpolation alpha and draws the UI.
- **`native/render.ts`** consumes snapshots (`sync(state, prev, alpha)`), never mutates them, and rebuilds the room on a new round, undo, theme or budget change. Picking casts the pointer ray onto the table-top and floor planes (tables: radius 0.5 around their tile; stoves: their box), since the engine's raycaster hits only visible meshes.
- **Determinism:** rules stream (`0x9e3779b9`), decor stream (`0x85ebca6b`) for props and rival scores, AV stream (`0xc2b2ae35`) for pitch variants; cosmetic streams never feed rules.

## 14. Testing and acceptance criteria

`npm test` runs:
- `tests/run-tests.js` (18 tests): rules (legality, every invalid reason, payout and total, buys, expansion, hiring, terminals, lost-guest penalty, serialize, deterministic replay, fuzzed commands), content validators, 40 stages, daily determinism, golden bot sessions, save migration, tie order, achievement keys, and the dev server (time, static files, replay-validated scores, cheats rejected).
- `tests/migrate.test.js`: the browser build's cloud save read back, corrupt/future saves refused, the engine save document, the two-device merge, which settings carry over.
- `tests/i18n.test.js`: every key the client names or builds, and every US English key, in all nine locales with matching placeholders; content names; translations present.
- `tests/native.mjs`: the web index matches the files (`npm run package` ran last), `tsc` over the host API declarations, `starhermit check .` with no warnings, and the play scripts as `--render-check --guest` runs: `journey-stage.play` (title → Journey grid → stage 1 played to "Goal reached!" with the keys `tools/plan.mjs j01` times from the rules → Next stage → pause → Leave service → Home), `learn-lesson.play` (lesson 1 by the table key with the Objective drawer, results, lesson 2 through the Stations drawer's Pick up and Serve), `practice-actions.play` (Serve and Bigger tray from the drawer, Hint, Speed, Rewind, camera, pause → Settings captions → Help → Leave service).

`npm run test:browser` (`tools/browser-play.mjs`) serves the packaged folder on loopback and plays it in headless Chrome at 1366×768 (keys into lesson 1, the table key, the results card), 390×844 touch (into lesson 1, a board tap, K, Escape) and 844×390 touch (menus by taps, a board tap), failing on console errors or warnings or the runtime's error screen.

**QA bar:** every feature is reachable by visible controls at desktop and phone sizes; no console errors or warnings; no text or control clipped (chips wrap, sheets scroll, the tray fits).

## 15. Asset inventory

| Path | Purpose | Source | Status |
|---|---|---|---|
| `assets/key-art.webp` (1200×672, 42 KB) | Title hero image above the logo | FLUX.2 klein, seed 5801, 30 steps | generated in this pass, wired |
| `assets/results-win.webp` (640×400, 15 KB) | Results illustration on a win / lesson complete | FLUX.2 klein, seed 5802, 30 steps | generated in this pass, wired |
| `assets/results-lose.webp` (640×400, 15 KB) | Results illustration on goal missed / resign | FLUX.2 klein, seed 5803, 30 steps | generated in this pass, wired |
| `coverart.png` (1200×675, 256-colour) | Platform cover (`cover=` in starhermit.txt) | Derived from key-art seed 5801 | replaced the generic placeholder in this pass |
| `icon.png`, `cover.jpg` | Platform icon / cover | authored earlier | shipped |
| `sfx/*.opus` × 15 (ui-tap … hint-sparkle) | Event one-shots (§9) | MOSS-SoundEffect v2.0, 100 steps | shipped |
| `sfx/service-open-bell.opus`, `wall-knock.opus`, `patience-tick.opus`, `helper-hired.opus` | New event one-shots | MOSS-SoundEffect v2.0, 100 steps, seeds from the tool's name hash | generated in this pass, wired |
| `sfx/bistro-ambience.opus` (10 s) | Ambience-bus loop | MOSS-SoundEffect v2.0, 100 steps | generated in this pass, wired |
| `sfx/manifest.txt` | Canonical clip → event → description → context table | hand-authored | generated in this pass |
| 3D models / character animation | — | — | none required: geometry is procedural and figures are capsules (no rig) |

## 16. Known limitations

- Presence and platform-side achievements are not called; the per-ruleset score comparison is local to the device, and "house regulars" are seeded rivals, not real players.
- The "Rewind" toast says "one second" but a snapshot is taken after every accepted command; a rewind returns to just after your last command.
- Queued guests who have no table drain patience at the door, so an over-full queue can lose guests you never had a chance to serve.
- Helper waiters share the Frost theme's accent colour; under Frost they are less distinct from the door glow.
- `goto` (walk somewhere) exists only as a board tap; it is never required to win.
- The haptics setting is stored but nothing vibrates; there is no voice content.
- The daily follows the device's UTC date (no server time on the engine).
- The room-tone clip loops whole (its encoded fades give a soft dip every 10 s); the synthesized stand-ins the browser build played while clips loaded are gone.
- Guests' browser `localStorage` progress cannot migrate (cloud saves do).
- Focus does not always take inside a scrolling screen (engine 1.16.1), so tall screens on short windows may open without a focused control; pointer and Tab still work.

## Design intent not yet implemented

- Presence, platform achievements, and per-ruleset platform boards with friends filtering (identity, the cloud save, the global `high-score` board and board nicknames are done; per-ruleset boards are device-local).
- A per-second undo snapshot cadence to match the "Rewound one second" wording, or reword the toast.
- Item-specific synth/clip cues for tray and stove purchases (currently the generic cash register).
- Voice-bus content (a short greeter line on service start) and haptic pulses on `urgent` and `serve` on devices that support them.
