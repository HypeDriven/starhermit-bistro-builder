# Bistro Builder — Game Design Document (running spec)

**Status:** shipped, running spec. Present tense describes the game as it behaves today; anything the design wants but the code does not do yet is confined to the final "Design intent not yet implemented" list.

## 1. Overview

**Pitch.** Run one miniature bistro for one service: guests queue at the glowing door and seat themselves, stoves cook dishes into a shared kitchen stock, and you (the waiter in the amber apron) carry plates to tables before patience rings turn red. Coins buy a bigger tray, helper waiters, extra stoves, and knocked-down walls that open more tables. Hit the day's earnings goal before the clock runs out.

| | |
|---|---|
| Genre | Real-time restaurant management / time-management puzzle |
| Players | 1; asynchronous score comparison on ranked content |
| Session | 90 s (Solo Sprint) to 5 min (Marathon); a Journey stage is 2–4 min; a Learn lesson under 1 min |
| Platforms | Desktop and mobile browsers (portrait and landscape); WebGL optional |
| Rendering | Three.js r-module (`vendor/three.module.min.js`) diorama with fully procedural geometry, plus a semantic HTML "station mirror" that is a complete playable text twin of the board |
| Simulation | Fixed 100 ms tick, seeded, deterministic, replay-validated on the server |

### File map

| Path | Role |
|---|---|
| `index.html` | Entry; loads `rng`, `rules`, `content`, `store`, `audio`, `ui` as globals, then `main.js` as a module |
| `js/rng.js` | mulberry32 PRNG, FNV-1a `hashString`, three derived streams (rules / decor / AV) |
| `js/rules.js` | Pure rules engine: `createGame`, `legalActions`, `applyCommand`, `step`, `hint`, `hashState`, `serialize` |
| `js/content.js` | 40 Journey stages, 5 lessons, 6 challenges, 3 practice paces, daily generator, 5 themes, validators, rival generator |
| `js/store.js` | Versioned, checksummed localStorage save; settings defaults; local leaderboard; achievement definitions |
| `js/audio.js` | WebAudio buses, authored Opus clips with synth fallbacks, room-tone loop, generative pad, captions |
| `js/ui.js` | DOM builders: mode list, journey grid, setup bodies, settings form, help, profile, leaderboard, station mirror, upgrade panel, results table |
| `js/render.js` | Three.js scene: instanced floor, walls, counter, tables, stoves, waiters, guests, pick layer, camera, quality tiers |
| `js/main.js` | Bootstrap, screen state machine, fixed-step loop, command dispatch + replay envelope, undo, lessons, HUD, input, persistence, host API |
| `css/game.css` | Layout tokens, rails/drawers, HUD, screens, responsive and accessibility modes |
| `server.js` | StarHermit `server=` script: static host + `/api/v1/{time,scores,events}` with deterministic replay validation |
| `data/scores.json` | Server-side leaderboard store (never served) |
| `sfx/*.opus`, `sfx/manifest.txt` | 20 authored clips and the canonical event binding table (`manifest.json` feeds the generator, `manifest.md` is generated) |
| `assets/key-art.webp`, `assets/results-win.webp`, `assets/results-lose.webp` | Title key art and results illustrations |
| `coverart.png`, `icon.png`, `favicon.svg`, `starhermit.txt` | Platform packaging |
| `tests/run-tests.js`, `tests/e2e.mjs` | Offline rules/content/server suite (`npm test`) and real-browser playthrough (`npm run test:e2e`) |

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

Invalid reasons (`INVALID`): `game-ended`, `unknown-command`, `malformed-command`, `bad-table`, `table-not-open`, `no-waiting-guest`, `no-dishes-available`, `mechanic-not-available`, `cap-reached`, `insufficient-coins`, `tile-not-walkable`. `main.js#invalidText` maps each to a player sentence in the red toast and a live-region announcement.

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
- Replay envelope (`main.js#onTerminal`): `{v:1, build, contentVersion, cfgId, seed, initialHash, t0, commands[{tick,id,cmd}], hashes (every 50 ticks + terminal), terminal, sessionId, invalid, durationMs}`. Command ids `c<tick>-<seq>` are unique per session; duplicates are rejected client- and server-side.
- **Undo** (`main.js#undo`): available when `cfg.mechanics.undo` (Learn, Journey, Practice; never Daily or Challenges). A serialized snapshot is pushed before every accepted command (max 120); undo pops one, filters the command log to `tick ≤ restored tick`, and rebuilds the scene.
- **Hint** (`rules.js#hint`) reads only `legalActions`: urgent serve → any serve → pickup → "kitchen still cooking" → affordable upgrade → "wait for the next guest". The HUD hint line shows it continuously; the Hint button/`H` toasts it and highlights the table.

## 5. Modes and progression

| Mode | Entry | Content | Ranked | Undo | Notes |
|---|---|---|---|---|---|
| Learn | Play → Learn | 5 lessons (`LESSONS`): serve, pickup, patience, tray, hire+expand | no | no | Scripted `setup` states, spawn disabled (999 s), goal 0. Completion writes `tutorialDone[id]`. |
| Journey | Title → Journey | 40 stages `j01`–`j40`; every fifth is "Mastery" | no | yes | Stage N+1 unlocks when stage N has ≥1 star. Best stars and score stored per stage. |
| Daily | Title → Daily challenge | `dailyCfg(UTC date)` | yes | no | Seed `hashString('bistro-daily-YYYY-MM-DD')`; 4–5 open tables + 2 closed, guests every 4–5 to 6–8 s, patience 18–22 (+8) s, 150 s, goal derived from expected guests. Replayable all day; best score kept; streak tracked. |
| Practice | Play → Practice | calm / normal / rush (`PRACTICE`) | no | yes | Endless 180 s day (goal 0 → `day-complete`), random seed per start, 11×7 room. |
| Challenge | Play → Challenge | Solo Sprint, One Tray, Tiny Room, Rush Hour, Frugal, Marathon | yes | no | Constrained rulesets; seeds are `hashString('bistro-challenge-<id>')`. |

**Difficulty curve (Journey).** j01–j05 introduce serving, tray, expansion and the first mastery (two rooms, 200 goal). j06–j10 add helpers, shorter patience, stoves and a 4-queue rush. j11–j20 widen the room (11×7, 11×9), cut price ("Thin Margins"), cut patience ("Fickle Foodies", 16–22 s) and start you in debt ("Expansion Debt": 20 coins, 4 walls). j21–j30 reach 13×7/13×9 rooms and 6-guest queues; j31–j40 push spawn to every 3–4 s, 7–8 tables, 8-deep queues and a 600-coin goal in "Mastery: Star Service". `validateCfg` rejects any stage whose goal exceeds 85 % of the theoretical ceiling `daySec/avgSpawn × (price+tipMax)`.

**Achievements** (`store.js ACHIEVEMENTS`, granted in `main.js#checkAchievements`, idempotent): `first-service` (any completed round, lessons included), `full-house` (win with 0 lost and ≥8 served), `century` (100 served lifetime), `crew-chief` (5 hires lifetime), `mastery-row` (a star on every mastery stage), `regular` (3 distinct daily dates).

**Cosmetics.** Five themes (Ember, Mint, Noir, Sunset, Frost) recolour floor, walls, tables, cloth, metal and door glow; they never touch rules or ring colours.

## 6. Controls and interaction

| Input | Desktop | Mobile | Effect |
|---|---|---|---|
| Tap/click table with waiting guest | pointer | tap | `serve {table}` |
| Tap/click stove | pointer | tap | `pickup` |
| Tap/click floor tile | pointer | tap | `goto {x,y}` |
| Drag > 10 px or hold > 600 ms on canvas | — | — | Treated as a camera/scroll gesture: no command (`onPointerDown`) |
| `1`–`9` | key | — | Serve table N |
| `K` / `H` / `U` / `F` / `C` | key | — | Pickup / hint / rewind / toggle 2× / re-frame camera |
| `P` or `Esc` | key | — | Pause; on an in-round overlay, close it and resume |
| Bottom toolbar buttons | click | tap | Pick up, Hint, Rewind (if allowed), Speed, Pause |
| Station mirror **Serve** / **Pick up**, Upgrade buttons | click / Tab+Enter | tap (right drawer 🍽) | Same commands through DOM |
| Gamepad | D-pad ◀▶ cycles `legalActions` with a toast, A commits, B/Start pause | — | `pollGamepad` |

**Locking.** Commands are refused while `game.paused`, during the 3-2-1 countdown (paused), and after terminal (`not-active`). Fast-forward only scales the accumulator (max 40 steps per frame), never the rules. The sole non-interruptible phase is the 2-tick interact; a new serve command simply re-targets the walk.

**Feedback per input.** Accepted command → `order-noted` clip and HUD refresh; buy → cash register, wall knock or apron cue; rejected → red toast with the reason, `error-buzz`, and "Not allowed: …" in the live region; hint → toast + sparkle + table ring scaled 1.18×; pause → suspended audio context and a modal; rewind → swoosh + "Rewound" toast.

## 7. Screens and UI flow

State machine (`main.js#showScreen`, `openScreen`, `pauseGame`, `showResults`):

```
boot → title ─┬→ modes ─┬→ learn ──────┐
              │         ├→ journey ────┤
              │         ├→ practice ───┼→ [countdown] → active ⇄ paused ─┬→ settings/help → paused
              │         ├→ challenge ──┤                    │             └→ leave service ┐
              ├→ daily ─┴──────────────┘                    ↓ terminal                    │
              ├→ journey (direct)                      results ─┬→ play again / next stage │
              ├→ profile / leaderboard / settings / help        └→ home → title ←──────────┘
```

Every screen is a `.screen[role=dialog][aria-label=<name>]` sheet (max 720 px) over the persistent shell; opening one focuses its first control. Only one screen exists at a time; Settings/Help opened from Pause return to Pause (`backToContext`), and the ☰ button pauses during play or returns home otherwise.

**Layouts (`css/game.css`).**
- ≥1024 px: header bar (title, Coins/Earned/Clock/Served chips, ☰), 240 px left rail (objective, progress bar, hint, lesson step), central playfield with the bottom toolbar, 260 px right rail (station mirror, upgrade grid). Left-handed swaps the rails.
- <1024 px: rails become slide-in drawers (📋 and 🍽 header buttons); "Always show station panel" docks the right rail permanently.
- Portrait ≤700 px: toolbar buttons stretch to 30 % width in the bottom thumb zone; screens tighten padding.
- Landscape ≤500 px tall: compressed header and chips, 44 px toolbar minimum.
- Safe areas: `env(safe-area-inset-*)` pad the header, screens, toolbar, toast and caption line. Nothing critical sits under the bottom inset; the toolbar is the lowest interactive element and is inset-aware.

**Never cut off:** the four stat chips (they wrap), the toolbar, the results table and its buttons, and the station mirror's Serve buttons (the e2e test clicks them at both viewports).

## 8. Art direction

**Palette (CSS tokens).** Background `#14100d`, panel `#211a15`, panel-2 `#2b221b`, ink `#f2e9dd`, dim ink `#b8a894`, accent `#e8a54b`, danger `#e0574d`, ok `#7fd08a`, focus `#ffd27a`. High contrast: `#000/#101010/#1c1c1c`, ink `#fff`, accent `#ffd27a`, focus `#00e0ff`. High-visibility palette: accent `#ffb340`, danger `#ff6f61`, ok `#4dd0e1`.

**Scene colours (`render.js`).** Background `0x14100d`; key light `0xfff2dd` @2.2 from (6,12,4) with 1024² PCF soft shadows; hemisphere fill `0xccc4b8`/`0x30231a` @0.9; ACES tone mapping at exposure 1.05, sRGB output. Player waiter `0xe8a54b`, helpers `0x7ec8e8`, skin `0xf0d8b8`, guest bodies cycle `0xc96f4a, 0x6f8fc9, 0x8fc96f, 0xc9c06f, 0xa06fc9`; patience ring lerps green `0x7fd08a` → amber `0xffb35c` → red `0xe0574d` at 50 % / 0 %; legal-target ring `0xffd27a`.

**Theme table (`content.js THEMES`).**

| Theme | accent | floor / alt | wall | table | wood | cloth | metal | glow |
|---|---|---|---|---|---|---|---|---|
| Ember | #e8a54b | 4a3527 / 54402f | 2e2018 | 8a5a34 | 6b452a | a33b2e | 8f9096 | ffb35c |
| Mint | #6fd6a8 | 2f4a42 / 38564d | 1e302b | 5f8a6e | 47705c | 2e6e5c | 9aa5a0 | a8f0cd |
| Noir | #9aa7ff | 2b2b33 / 34343d | 1a1a20 | 4d4d5c | 3d3d47 | 5c2e4d | 7d7d8a | bdc7ff |
| Sunset | #ff8a6b | 54343a / 613e44 | 33222a | 8a5a48 | 6e463c | b3503e | 96898a | ffb08a |
| Frost | #7ec8e8 | 36444f / 40505c | 232e36 | 5c7484 | 4a5e6c | 3e6e8a | 9aa5ad | bfe4f5 |

**Shape language.** Everything is a rounded primitive: capsule bodies with sphere heads, cylinder tables with a cloth disc, box stoves with a pan and a translucent steam sphere, an instanced 0.98-tile checkerboard floor, 0.9-unit walls, a wooden counter along the kitchen row, six seeded wooden props outside the left wall (decor stream, cosmetic). Walled-off tables render at 35 % opacity behind a rotated grey barrier that is removed the tick the wall opens.

**Hero.** The room itself, framed by a 38° perspective camera at elevation `11 × span/9` and offset `8.5 × span/9` looking at the room centre, so any grid from 9×7 to 13×11 fills the playfield. The player waiter carries a pulsing amber ring so the eye always finds the tray.

**Typography.** System UI stack, 16 px base (20 px with Larger text), tabular numerals on chips and tables, the logo at `clamp(2em, 7vw, 3.4em)` in accent. Line length capped at 70 ch for descriptions and help.

**Motion.** Waiters lerp between tick positions with the frame alpha; steam bobs on a sine of the tick; the player ring pulses; serve gives a 0.03-amplitude 0.18 s camera impulse and win/lose 0.08/0.4 s, after which `frameCamera` restores the authored pose. Drawers slide 0.22 s. **Reduced motion** removes interpolation (snap), steam, ring pulse, camera impulses, drawer transitions and every CSS transition, and shortens the countdown cadence to 200 ms.

**Visual assets the design calls for.** Title key art (miniature bistro diorama, 16:9), a win illustration (cleared table, full tip jar) and a loss illustration (closed room, empty jar) for results, and a platform cover derived from the key art. All four ship (see §15). Board geometry is deliberately procedural, so no 3D model asset is required.

## 9. Audio direction

**Mix.** Four gain buses under one master — `music`, `effects`, `ambience`, `voice` (reserved; nothing routes to it) — each with a settings slider and a global mute (`audio.js#applySettings`). One-shots are authored Opus clips fetched lazily on first use and cached; while a clip is loading, or if it fails, the procedural synth for the same event plays instead, so no event is ever silent. Pitch variants on `cmd`, `spawn`, `pickup`, `serve` and `leave-happy` come from the seeded AV stream (`setAvRng`) for replay-consistent takes. Music is a generative low-passed triangle/sine pad walking C–Dm–G/B–Am every 4.8 s. Ambience is the authored `bistro-ambience` loop (loop points trimmed past the encoded fades) which fades out the synthesized brown-noise bed once decoded; seeded-random soft clinks continue on top. The context suspends on pause and on tab hide.

**Captions.** When "Captions for sound cues" is on, each event prints its caption (`CAPTIONS`) in the caption line above the toolbar for 1.8 s.

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

English only ships: every string is an inline literal in `ui.js`, `main.js` and `content.js`, `index.html` declares `lang="en"`, and there is no language selector or locale detection. The required locale set (en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT) is listed under "Design intent not yet implemented". Layout already tolerates ~30 % expansion: chips wrap, cards and help text cap at 70 ch, buttons are `inline-flex` with wrapping rows, and the level grid uses numbers only.

## 11. Accessibility

- **Keyboard-only path:** Tab reaches every control; the station mirror and upgrade panel rebuild each tick but restore focus by `data-fkey` (`ui.js#rebuildKeepingFocus`); number keys serve tables; `Esc` closes overlays; each screen focuses its first control on open. No keyboard trap: every dialog has a Back/Resume/Home button.
- **Screen reader:** `aria-live="polite"` region announces round start, lesson steps, each serve with its payout, angry departures, urgency warnings and every rejected command; rails carry `aria-label`s; the canvas section explains that the stations panel is the text version; journey cells announce stage, name and stars.
- **Captions** for every sound event (see §9); no information is audio-only — each cue has a ring, chip, toast or mirror row.
- **Contrast:** ink `#f2e9dd` on `#14100d` (≈14:1); accent-on-dark buttons use `#1c1206` text; High contrast mode goes to pure black/white with a cyan focus ring; the 3 px `:focus-visible` outline uses `--focus`.
- **Colour independence:** patience is ring colour *and* the mirror's "Waiting · Ns" countdown with `urgent` styling and bold text; high-visibility palette swaps red/green for orange/cyan.
- **Reduced motion, Larger text (20 px), Left-handed rails, Haptics toggle, Always-show station panel, Fast-forward** all live in Settings and persist.
- **Targets:** buttons are ≥44 px tall (36 px for the in-list "small" buttons, spaced 0.35 em); toolbar buttons ≥96 px wide on portrait phones.
- **No WebGL:** `render.create` returns null, a compatibility note appears in the playfield, and the mirror remains the full game.

## 12. StarHermit integration

Conventions per https://wiki.starhermit.com/ — packaging via `starhermit.txt` and an optional authoritative script.

**Used**
- `starhermit.txt`: `name=Bistro Builder`, `launch=index.html`, `owner=<uuid>`, `server=server.js`, `cover=coverart.png`.
- `server.js` as the game script: serves the distribution (refusing `server.js`, `spec.md`, anything under `data/`, and paths escaping the root), and exposes `GET /api/v1/time` (daily boundary sync with round-trip offset in `main.js#syncServerTime`), `GET /api/v1/scores?cfgId=`, `POST /api/v1/scores` (full deterministic replay through `rules.js`; rejects stale content version, unknown content, seed mismatch, hash or score mismatch; per-IP rate limit 12/min; idempotent per session+content), and `POST /api/v1/events` (anonymous funnel counters: `app-start`, `round-start`, `round-end`, `tutorial-step`, `settings-change`).
- Structured `{"error":"…"}` responses everywhere; the client treats any failure as "offline" and falls back to the local board.
- **Launch token** (`main.js#initPlatform`): read from the URL fragment `#game_token=<jwt>` (optional `&session_id=`, stripped after the read; query `?token=`/`?launch_token=` kept for local dev), decoded for `sub` + `game_scope` (never hard-coded), sent as `Authorization: Bearer` on every `/api` call, re-minted every 45 min via `POST /api/v1/games/{slug}/launch-token` (60 s retry on failure). The old self-disable on `<uuid>.starhermit.com` hosts is gone — hosted mode activates iff a token was read. Ranked envelopes carry `playerId` (the account id) so board rows attach to the account; `GET /api/v1/users/{id}/profile` (never `/api/v1/me`, never usernames; `Player <id8>` fallback) resolves row nicknames on the leaderboard screen, the own row is highlighted, and everything still degrades to local boards when the routes 404.

**Not used:** avatars, presence heartbeats, platform achievements (achievements are local in the save document), cloud saves, launch activity start/end, sessions/rooms, websockets, chat, voice, entitlements.

## 13. Technical architecture

- **`rules.js`** is pure: no DOM, no `Date`, no `Math.random`; state is plain JSON with a `v` field; `hashState` uses a stable key-sorted stringify over everything but `events`. The same file runs in Node for tests and the server.
- **`main.js`** owns the session object `{state, cfg, mode, lesson, commands, hashes, cmdIds, undoStack, over, paused, acc, prev, speed, urgentSeen, …}`, the `requestAnimationFrame` loop (dt clamped to 250 ms, up to 40 ticks per frame, a hash every 50 ticks), event draining to audio/announcements/lessons, and the replay envelope.
- **`render.js`** consumes snapshots (`sync(state, prev, alpha)`), never mutates them, and rejects a state whose `cfg` identity differs (undo therefore rebuilds). Picking raycasts only the `LAYER_PICK` proxies (table cylinders, stove boxes, floor plane). Quality tiers: low (DPR 1, no shadows), medium (DPR ≤1.5), high (DPR ≤2); "auto" picks medium on mobile user agents. Hidden tabs render nothing.
- **Persistence (`store.js`):** `bistrobuilder.save.v1` = `{sum: FNV-1a(payload), payload}` with settings + progress; a bad checksum or a future version yields a fresh document; a memory fallback covers private mode. `bistrobuilder.leaderboards.v1` holds the local board (top 100). Tokens and identity are never stored.
- **Determinism:** rules stream (`0x9e3779b9`) for the simulation, decor stream (`0x85ebca6b`) for props and rival scores, AV stream (`0xc2b2ae35`) for pitch variants; cosmetic streams never feed rules.
- **Budgets (by construction, not yet profiled):** one instanced floor draw, four walls, counter, one instanced prop mesh, ≤3 meshes + ring per table, 3 per stove, 3–4 per figure, one shadow-casting light; the mirror DOM is rebuilt per tick (≤ 10 Hz) and is the main CPU cost on low-end phones.
- **E2E drive:** `tests/e2e.mjs` runs its own static server with `/api/v1` stubs, opens headless Chrome via `playwright-core`, and plays only through visible UI — it reads the station mirror for state, clicks the mirror's Serve/Pick-up buttons at 1280×800 and presses the documented `1–9`/`K` keys at 390×844 (touch), toggles fast-forward with the real button, and fails on any `pageerror` or console error.

## 14. Testing and acceptance criteria

`npm test` (`tests/run-tests.js`, 18 tests): initial state and hash; serve/pickup legality and every invalid reason; payout = price + tip and the total formula; buy caps, funds and mechanics flags; expansion and helper hiring; goal win / day fail / resign terminals and post-terminal rejection; lost-guest penalty; serialize round-trip and version rejection; deterministic replay hash equality; fuzzed malformed commands never hang or produce NaN; every content config passes `validateAll`; 40 stages with mastery every fifth; daily determinism per date; golden bot sessions terminate on easy/medium/hard/challenge/daily; save migration and future-version refusal; leaderboard tie order; achievement key shape; and a live server check (time, static files, `server.js` forbidden, honest envelope accepted, duplicate replaced, inflated score / stale version / unknown content rejected with 422, 404 shape).

`npm run test:e2e` (`tests/e2e.mjs`): title visible → Settings toggles reduced motion on `<body>` and closes → Help opens/closes → Learn lesson 1 to "Lesson complete!" → Journey grid shows 40 cells with stage 1 unlocked → stage 1 played to a real results headline → progress persisted in localStorage → Play again → Pause freezes the clock → Resume → `U` rewinds and the clock keeps running → Leave service → resign results → Home. Desktop pass then mobile pass; zero page errors.

**QA bar (checkable):**
- A new player sees instructions within one screen (title tip → Learn) and per-mechanic guidance (lesson step text + continuous hint line).
- Every feature in this document is reachable by clicking visible UI at 1280×800 and 390×844, and the e2e run passes at both.
- No console errors or warnings during the e2e run (GPU/SwiftShader notices excepted).
- No text or control is clipped at either viewport: chips wrap, sheets scroll, toolbar fits.
- Ranked results cannot be forged: `server.js` reproduces the replay exactly or rejects it.

## 15. Asset inventory

| Path | Purpose | Source | Status |
|---|---|---|---|
| `assets/key-art.webp` (1200×672, 42 KB) | Title hero image above the logo | FLUX.2 klein, seed 5801, 30 steps | generated in this pass, wired |
| `assets/results-win.webp` (640×400, 15 KB) | Results illustration on a win / lesson complete | FLUX.2 klein, seed 5802, 30 steps | generated in this pass, wired |
| `assets/results-lose.webp` (640×400, 15 KB) | Results illustration on goal missed / resign | FLUX.2 klein, seed 5803, 30 steps | generated in this pass, wired |
| `coverart.png` (1200×675, 256-colour) | Platform cover (`cover=` in starhermit.txt) | Derived from key-art seed 5801 | replaced the generic placeholder in this pass |
| `icon.png`, `favicon.svg` | Platform icon / tab icon | authored earlier | shipped |
| `sfx/*.opus` × 15 (ui-tap … hint-sparkle) | Event one-shots (§9) | MOSS-SoundEffect v2.0, 100 steps | shipped |
| `sfx/service-open-bell.opus`, `wall-knock.opus`, `patience-tick.opus`, `helper-hired.opus` | New event one-shots | MOSS-SoundEffect v2.0, 100 steps, seeds from the tool's name hash | generated in this pass, wired |
| `sfx/bistro-ambience.opus` (10 s) | Ambience-bus loop | MOSS-SoundEffect v2.0, 100 steps | generated in this pass, wired |
| `sfx/manifest.txt` | Canonical clip → event → description → context table | hand-authored | generated in this pass |
| `vendor/three.module.min.js` | Renderer | three.js (MIT) | shipped |
| 3D models / character animation | — | — | none required: geometry is procedural and figures are capsules (no rig) |

## 16. Known limitations

- Localization: English only (§10).
- Presence, cloud save and platform-side achievements/leaderboards are not called; boards are the game's own `server.js` plus a local fallback, and "house regulars" are seeded rivals, not real players.
- The "Rewind" toast says "one second" but the snapshot cadence is one per accepted command; a rewind is "before your last command".
- Queued guests who have no table drain patience while standing at the door, so an over-full queue can lose guests you never had a chance to serve.
- Helper waiters share the Frost theme's accent colour (`0x7ec8e8`); under the Frost theme they are less distinct from the door glow.
- `goto` (walk somewhere) exists only as a floor tap; there is no keyboard or DOM equivalent — it is never required to win.
- Voice bus and haptics setting are stored and mixed but nothing produces voice or vibration.
- Draw-call and frame-time budgets are stated by construction; no profiling captures are stored in the repo.
- Journey stage titles, help and the daily date are not localized; the daily leaderboard title shows the raw config id (`daily-YYYY-MM-DD`).

## Design intent not yet implemented

- Full string tables and a language selector for en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT.
- Presence heartbeats, cloud-saved progress, and platform achievement/leaderboard endpoints per the StarHermit wiki, with friends filtering (launch-token identity and board nickname display are done; boards remain served by the game's own `server.js`).
- A per-second undo snapshot cadence to match the "Rewound one second" wording, or reword the toast.
- Item-specific synth/clip cues for tray and stove purchases (currently the generic cash register).
- Voice-bus content (a short greeter line on service start) and haptic pulses on `urgent` and `serve` on devices that support them.
