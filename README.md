# Cold War 1947 — Slice 1

Real-time multiplayer strategy game (Supremacy 1914 style). This is **Slice 1**: the foundation and the first part of the core loop.

Stack: React + Vite + PixiJS · NestJS · PostgreSQL (Neon) + Drizzle · Socket.IO. No Redis: the server clock polls Postgres for due timers.

## What works in this slice

- Accounts (register / login, httpOnly cookie session, bcrypt)
- Campaigns (one is created automatically on first start; players can create more), isolated from each other
- Country selection: 8 playable countries, 4 AI-only (Poland, Egypt, Sweden, Japan). Unclaimed countries run on AI
- 248-province world map (see Week 4), PixiJS render, pan / zoom / select, ownership colours
- Resources: money, food, oil, steel, electronics, rare materials, manpower. Production per province, calculated lazily from stored timestamps, so it keeps running while you are offline
- Double-resource provinces (about 2x of one resource)
- 9 buildings with slots, costs, server-side construction timers. **Working effects:** Local Factory (+25% province production), Recruitment Center (auto-recruits 1 infantry per hour if you can afford it). The other buildings can be built but their effects arrive in later slices (the UI marks them "effect coming later")
- Infantry upkeep (1 food + 0.5 money per hour each) creates economic pressure
- Notifications (building complete, recruited, AI takeover), pushed live over Socket.IO
- AI: economic AI for unclaimed countries, and **AI takeover after 48 hours of player inactivity** (`INACTIVITY_HOURS`). You get control back as soon as you open the game again
- Server authority: all spending is validated on the server inside a transaction that row-locks your country, so double-clicks cannot double-spend
- `GAME_SPEED` setting to test long timers quickly

## Week 1: armies and movement

- Select one of your armies (from the province panel or the Armies list) and click **Move**, then click a destination province on the map. You see the route and arrival time before confirming.
- Pathfinding finds the fastest route over province neighbours. Travel time depends on distance, terrain (forest, hills, mountains and desert are slower), the slowest unit in the army, and railways. A railway in two neighbouring provinces halves the time for that leg.
- You can send only some of the units: they split off as a new "Task Force" and the rest stay behind.
- Armies are drawn as gold markers travelling along their route. You can **Redirect** an army mid-march (it finishes its current leg first) or **Stop** it.
- Orders are stored with exact arrival times and applied by the server clock, so armies keep marching while you are offline or if the server restarts. Late legs are caught up without drift.
- For now armies can only travel through **your own provinces**. Entering enemy land arrives with combat in Week 2.
- **After updating from the earlier build, run `npm run db:push` again** to add the movement columns.

## Week 3: production, army management, supply, capital move

**Apply the database changes first** (`npm run db:push`, or `docs/week3.sql` in the Neon SQL editor), then restart. Existing campaigns keep working.

- **Military Factory** (now active) builds **artillery, light tanks and heavy tanks** from a queue, one unit at a time. Open a province with a finished factory, pick a unit and quantity (up to 10 per order, 20 queued per factory). The price is paid when you order; a unit that has not started can be cancelled for a full refund. Finished units join that province's Garrison. The queue runs while you are offline. Research will gate the tank types later (week 5).
- **Merge and split armies**: Armies panel, **Manage** (stationary armies only). Merge needs two armies in the same province.
- **Supply pressure**: units cost upkeep every hour (tanks burn oil). If a resource hits zero while still being used up, the top bar turns red and your armies fight at a penalty: oil and food -20%, money -10% attack and defence. The battle report lists it. Try it: build several tanks on a small oil income.
- **Capital move**: a province you own and that is not occupied, **Move capital here**: 2000 money + 500 steel, 24 game hours. The old capital stays in place until then. The capital has extra defence and losing it hurts, so choose a safe province. If the target is lost before it finishes, the move fails and nothing is refunded.

Done when: you build a mixed army of infantry, artillery and tanks and run short of oil.

## Week 4: real map, map modes, first shared test

**Apply the database changes first** (`docs/week4.sql` in the Neon SQL editor, or `npm run db:push`). The SQL also **deletes old campaigns**, because the placeholder grid is gone and their provinces no longer exist. Accounts are kept, and a fresh default campaign is created when the server starts.

- **A world map of 248 provinces** across 32 countries, drawn from simplified real geography (Americas, Europe, Africa, Asia). It is generated by `packages/shared/scripts/generate-map.mjs` from `map-source.mjs` (coastlines, seas, one seed per province). Edit the seeds and run `node packages/shared/scripts/generate-map.mjs` to change names, borders, terrain or resource hot spots. The output `map-geometry.generated.ts` is committed, so the game itself does not need the script.
- Neighbouring provinces share exactly the same border. Islands are linked by a few hand-made sea crossings (Channel, Irish Sea, Gibraltar, Korea, plus long Atlantic and Pacific lanes) that armies cross slowly until the navy arrives in week 8.
- **Map modes** (top left of the map): Political, Resources (best resource per province) and Terrain, with a legend. Province names appear when you zoom in.
- **Report a problem** button in the top bar for playtests. Read the reports with the SQL in `docs/PLAYTEST.md`, which is also the checklist for the three-person evening.
- Only the 8 playable countries can be picked in the lobby; the other 24 are run by the AI.

## Week 5: research

- New **Research** tab: five branches (Infantry, Armor, Air, Naval, Industry), five techs each, with prerequisites across branches.
- One project at a time. The price is paid at the start; the timer runs on the server, also while you are offline. Cancelling refunds 50% and loses the time.
- **Research Laboratory +15%** and **University +25%** research speed, counted only in provinces you hold and that are not occupied. Total speed is capped at **+100%**. Speed is fixed when a project starts, so build the university *before* the next project. Money cannot skip research.
- Effects: Armor unlocks Light/Heavy Tanks in the military factory (the factory dropdown only lists researched units, the server enforces it too). Industry techs raise production, Infantry/Armor/Air/Naval techs add combat strength, Industry 4 adds research speed.
- Air and naval techs unlock fighters, bombers, ships etc. Their production arrives in Week 8.
- **Before you start:** run `docs/week5.sql` in the Neon SQL editor, then restart.

## Week 6: generals

- New **Generals** tab with a roster of 15 historical commanders in five categories (Infantry, Armor, Air, Naval, Strategist), three each: common, rare, epic.
- **Recruiting:** you start with Ridgway, Abrams and Bradley. The rest are recruited by collecting fragments (5 common / 10 rare / 20 epic). For now the only source is a free dispatch every 20 hours that gives one fragment; missions replace it in Week 13.
- **Deploying:** 5 slots. Each general leads one army (pick it in his card's drop-down). He stays with the army when it moves. If you merge his army into another that has no general he follows it; otherwise he is freed.
- **Passive bonus:** +4/6/8% combat (common/rare/epic) plus 1% per level, applied to every battle his army fights, but only if the army contains his kind of units (infantry generals: infantry or artillery, armor: tanks, strategist: anything). Air and naval generals have nothing to lead until Week 8.
- **Active ability:** +10/15/20% on top for 2 hours, then a 12 hour cooldown. Both bonuses appear by name in the battle report's modifier list.
- **Experience:** win 100 XP, loss 40, taking an undefended province 20. Levels at 100, 300, 600 and 1000 XP (max level 5).
- **Defeat:** a general whose army is destroyed is locked for 24 hours and can then be deployed again.
- Timers scale with `GAME_SPEED` like everything else.
- **Before you start:** run `docs/week6.sql` in the Neon SQL editor, then restart.

## Week 7: diplomacy and alliances

- The **Diplomacy** tab now lists every country with a relationship stage (hostile, unfriendly, neutral, friendly, allied, at war) built from an opinion score of -100 to 100, plus the war list.
- **Alliances:** up to 3. An AI country accepts when its opinion of you is 25 or more; a player gets a request to accept or decline in the same tab. You cannot declare war on an ally; break the alliance first (costs -30 opinion).
- **Foreign aid:** send money, food, oil, steel, electronics or rare materials to any country you are not at war with. Every 150 worth is +1 opinion (max +10 per gift), so gifts are how you win an AI over. Gifts never buy research or units.
- **Mutual defence:** when a country is attacked, each of its allies gets a call to war with a **2 hour** countdown (scaled by `GAME_SPEED`). They can **Join now**, **Decline** (the alliance ends, -40 opinion) or do nothing and join automatically when the timer ends, even if offline. A call is voided if the alliance, the war or the situation changed. When an ally joins, the aggressor's own allies get called in turn.
- **AI diplomacy (basic):** AI countries accept or refuse alliance offers and honour defence calls. They do not propose alliances or declare wars on their own yet; AI warfare arrives in Week 8.
- **Not in yet:** peace treaties. A war still lasts until the campaign ends.
- **Before you start:** run `docs/week7.sql` in the Neon SQL editor, then restart.

## Week 8: air, navy and AI warfare

**No SQL this week** (no database changes). Copy the files over and restart. Optionally add `AI_WAR_INTERVAL_SECONDS=60` to your `.env` (it defaults to 60).

- **Airbase** builds fighters, bombers and air support aircraft. **Harbor** (coastal provinces) builds submarines, destroyers, cruisers and battleships. Both need the unit researched first (Air and Naval branches). A province's buildings share one production queue; finished units join its garrison.
- **Air (basic):** aircraft fight in battles with their own stats. A side with more fighters than the enemy gets **Air superiority +8%**; an army with air support aircraft and land troops gets **Close air support +6%**. Both show in the battle report.
- **Navy (basic):** any army that contains a ship can only move between **coastal** provinces. Ships fight with their own stats when they attack or defend a coastal province. **Ships and aircraft cannot occupy land:** if a force with no land units wins, it destroys the defenders but the province stays with its owner and the force stays where it was. Split ships off a garrison before moving it.
- **AI warfare:** AI countries that are at war now decide every minute (not every 5) and:
  - **Defend:** if enemy armies are in or heading to a province, or sit next to it, and the AI has less power there than the threat, it recruits emergency infantry there (up to 4 per province, 8 per decision, paid from its stockpile).
  - **Build up:** next to a lost home province it masses enough troops to retake it.
  - **Counterattack:** a province with a clearly stronger stack (1.5x the defender, always leaving 2 infantry behind) attacks an adjacent enemy-held province, home provinces first, through the normal movement and combat rules. At most 2 attacks per decision.
  - It still never declares war on its own. Allies honour defence calls (Week 7).
- The AI planner is a pure function in `packages/shared/src/ai-war.ts` with its own tests.

## Map resource icons

Zoom in to see a small icon on each deposit province: **oil** (drop), **steel** (ingot), **electronics** (bolt) or **rare materials** (gem). A **doubled region** gets a gold ring and **x2**. They are drawn as vectors in `features/world-map/resource-icons.ts`, so there are no image files to manage.

## Performance (to do when hosted)

Actions currently take several seconds because each request makes many sequential database round trips to a remote database from your own computer (starting research reads the country, buildings, provinces and research tables several times, inside a row lock). Planned fix once the game is deployed next to its database: cache the research and building summaries per country, batch the reads into fewer queries, and add timing logs per request.

## Map rebalance (before Week 9)

- **Fair sizes:** big countries (USA, Soviet Union, China, India, Brazil) have **10** provinces, medium countries (UK, France, Turkey) **8**, and every AI-run country **4 or fewer**. The world now has 166 provinces.
- **Resources:** every province produces money, food and manpower (differences come from terrain, not luck). **Oil, steel, electronics and rare materials come only from deposit provinces**, one deposit per province, with fixed output (oil 24, steel 28, electronics 8, rare 5 per hour).
- **Double-resource regions:** every country has one or two provinces where its deposit produces **twice** as much. Big countries have 2, medium and AI-run countries 1. Doubled provinces get a 4th building slot.
- **Same size, same wealth:** all big countries have exactly the same strategic output (2 steel deposits, 2 oil, 1 electronics, 1 rare, two of them doubled); all medium countries too (2 steel, 1 oil, 1 electronics, 1 rare, one doubled). A test checks this. The deposit locations are historical where possible and adjusted where fairness needed it. "Iron" is the steel resource.
- **Map icons:** a deposit province shows its resource icon; doubled regions get a gold ring and x2.
- To tune the map: edit `packages/shared/scripts/map-source.mjs` (deposit, doubled flag) and run `node packages/shared/scripts/generate-map.mjs`. The balance test (`map-balance.test.ts`) will tell you if you break the rules.
- **Before you start:** run `docs/map-rebalance.sql` in the Neon SQL editor. It deletes all old campaigns (accounts stay), then restart; a fresh campaign is created automatically.

## Not built yet (next slices)

Combat and province capture · research · generals · monthly missions and leaderboard · diplomacy and alliances · capital relocation · payments. The Research / Generals / Diplomacy tabs are placeholders.

## Setup

Requirements: Node.js 20+ and a Neon (or any PostgreSQL) database.

```bash
npm install
cp .env.example .env        # then edit .env (see below)
npm run build:shared
npm run db:push             # creates the tables in your database
npm run dev                 # server on :3000, web on :5173
```

Open http://localhost:5173, register, pick a country in the lobby, and play.

### `.env`

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | Required. Neon pooled connection string |
| `DATABASE_URL_DIRECT` | Optional. Neon direct string, used only by `db:push` |
| `JWT_SECRET` | Required. 32+ random characters |
| `PORT` | Server port (default 3000). If you change it, also change `SERVER` in `apps/web/vite.config.ts` |
| `CORS_ORIGIN` | Allowed web origin(s), comma separated |
| `GAME_SPEED` | 1 = real time. 60 = one real minute is one game hour |
| `TICK_MS` | How often the server checks timers (default 5000) |
| `INACTIVITY_HOURS` | Hours before AI takes over a player (default 48) |
| `AI_INTERVAL_SECONDS` | Seconds between AI decisions (divided by `GAME_SPEED`) |
| `AI_WAR_INTERVAL_SECONDS` | Same, for an AI country that is at war (default 60) |
| `SCHEDULER_ENABLED` | Set `false` to stop timers (for example on a second instance) |
| `ALLOW_CAMPAIGN_CREATION` | Set `false` to stop players creating campaigns |

### Quick test of the loop

Set `GAME_SPEED=60` in `.env`. A local factory then builds in 1 minute, a recruitment center in 30 seconds, and AI countries start building within about a minute. To test the 48-hour takeover quickly, set `INACTIVITY_HOURS=0.01`, log out, and wait a minute.

## Notes

- **Neon:** use the pooled URL for `DATABASE_URL`, and the direct URL for `DATABASE_URL_DIRECT` if `db:push` has trouble.
- **Schema changes:** this slice uses `drizzle-kit push`. When you want versioned migrations, run `npx drizzle-kit generate` inside `apps/server` and switch to `migrate`.
- **Hosting:** Socket.IO needs a long-running Node process (Railway, Fly, Render, a VPS), not a serverless platform. Run only one server instance for now, because the scheduler assumes a single process.
- **In production** set `NODE_ENV=production`, serve over HTTPS, and set `VITE_API_URL` when building the web app if it is hosted on a different origin than the API (cookies are then sent cross-site with `SameSite=None; Secure`).
- **Map:** generated from `packages/shared/scripts/map-source.mjs` (simplified real geography). Province geometry is stored independently of PixiJS, so a more detailed map can replace it later without touching the renderer.
- **Balance:** costs, times, unit stats and starting resources live in `packages/shared/src/game-data/`.

## Structure

```
apps/server/src   auth, db (schema), economy, buildings, campaigns, notifications,
                  scheduler (timers), ai, realtime (Socket.IO)
apps/web/src      pages, features/world-map, features/economy, services
packages/shared   types, game-data, map-data, rules (shared by server and web), tests
```

Run the rule/map tests with `npm test`.

## Week 2: war, battles and province capture

**Apply the database changes first** (`npm run db:push`, or the SQL in `docs/week2.sql` if db:push fails on Neon), then restart. Existing campaigns work, but only new campaigns get garrisons in every province (see below).

How it works:

- **Declare war** in the Diplomacy tab, or from any foreign province panel. War starts at once. Armies can only enter your own land and the land of countries you are at war with.
- **Order an army** into enemy land as usual. A battle is fought when it arrives. The move panel warns you when the route attacks someone.
- **Battles** are automatic and seeded (replayable). Both sides hit each other every round; defenders get terrain, fortress and local-defence bonuses to attack *and* defence. A side below 10% strength breaks and is destroyed. The loser loses the whole army.
- **Capture**: if the defenders are wiped out (or there were none) the province changes owner and the army moves in. It produces nothing for 6 game hours. If it was a capital, the loser's capital moves to another province, you take 15% of their stockpile and their stability drops by 20.
- **Battle reports** (sidebar) show both armies before and after, the bonuses, and round-by-round strength, with plain-language reasons.
- Every province in a **new** campaign starts with a small garrison (capitals 5 infantry, others 2). Create a new campaign (`ALLOW_CAMPAIGN_CREATION=true`) to get them.
- The AI does not attack yet; it only defends. Peace treaties arrive with diplomacy.

Done when: you capture an AI province, its income moves to you (after the occupation period), and the report tells you why you won.


## Week 9 - Interface overhaul

* **Design system** in `apps/web/src/styles/styles.css`: colour tokens (brass / NATO blue / Soviet red on a dark situation-room base), type scale, 4px spacing grid, buttons (primary, secondary, danger, ghost, icon), inputs, panels, chips, tables, progress bars and CSS tooltips (`data-tip="..."`, optional `data-tip-pos="below|right|left"`). Every screen uses these; nothing relies on the browser default look.
* **Layout**: fixed top bar (country, all seven resources with icons, rates and hover explanations, alerts bell with unread count, report button), navigation rail along the left edge, and a slide-in details drawer (Province / Armies / Battles / Alerts) that sits beside the map and never covers it. On narrow screens the rail becomes a bottom bar and the drawer a bottom sheet.
* `components/Icon.tsx` holds the SVG icons; resource icons match the ones drawn on the map.
* The map now resizes when the drawer opens or closes (ResizeObserver).
* Login and lobby were restyled with the same crest and components.
* **Local Factory fix** (from Week 8 feedback): Local Factory and Industry research boost only money, oil, steel, electronics and rare materials, never food or manpower.
* No database changes this week.

## Week 10 - Art and sound

**Art** (`apps/web/src/components/art.tsx`, drawn as SVG, no image files):
* 11 unit silhouettes (infantry with rifle, artillery, light/heavy tank, fighter, bomber, air support, submarine, destroyer, cruiser, battleship) and 9 building icons, used in the Province and Armies panels.
* Flags: the 1947 flags of the 12 playable countries (USSR, USA, UK, France, China (ROC), India, Turkey, Brazil, Poland, Egypt, Sweden, Japan). AI-run regional blocs (Iberia, Maghreb, etc.) are not single historic states, so they get emblem banners in their bloc colour. Flags show in the top bar and the country picker.
* Map: terrain marks on provinces (mountain peaks, trees, hill arcs, desert dots, plains grass), and NATO-style army counters. Stationary armies are now visible on the map (previously only marching ones were), with a symbol for the main unit type, the owner colour band and the unit count. Marching armies show a dashed route with an arrow head.
* Panels have brass corner brackets and the map has a faint grain.

**Sound** (`apps/web/src/services/audio.ts`): all sounds are synthesized in the browser with the Web Audio API, so there are no audio files, nothing to license and nothing to download.
* Effects: button click, confirm (primary buttons), warning (danger buttons), province select, build, recruit, research complete, battle, victory, defeat, alert, war declared. Server notifications and new battle reports pick their sound automatically.
* Music: a slow generated theme in D minor (drone, pad, march taps, sparse lead). It is off by default; use the music button in the top bar. Both toggles are remembered in the browser.
* Browsers only allow sound after the first click, so nothing plays before that.
* To use recorded music or effects later, drop files in `apps/web/public/audio/` and replace the matching recipe in `audio.ts`.

No database changes this week.

## Week 11 - Onboarding and clarity

* **Tutorial "Orders from HQ"** (`features/tutorial/Tutorial.tsx`): six steps (look at your capital, build a Recruitment Center, train soldiers, send an army, declare war, capture a province). Each step ticks itself by reading the real game state, no "next" buttons. "Show me" buttons lead the player to the right place. Progress is remembered per campaign in the browser; the ? button in the top bar reopens it.
* **Numbers explain themselves**: the server now returns a rate breakdown (`resources.breakdown`). Hover any resource in the top bar to see: stockpile, income from provinces, buildings, research, army upkeep, and the net rate per hour. Captured provinces that are not producing yet are mentioned.
* **Map overlays**: two new map modes. *Supply* shows whether armies are supplied or short (a resource that causes a combat penalty has run out). *Diplomacy* colours each country by how it feels about you (allied, friendly, neutral, unfriendly, hostile, at war).
* **Alerts**: grouped runs of the same kind ("Show 3 earlier like this"), type tags, relative times, unread-only filter, mark all read.
* **Phone**: pinch-to-zoom on the map, larger touch targets, bottom-sheet details panel with a handle, tutorial collapsed by default, scrollable map-mode pill.
* No database changes. Restart the server (the state response gained a field).

## Week 12 - Roads and land troops on the map

* **Roads**: the map generator now builds a road network (206 roads between 166 provinces; run `node packages/shared/scripts/generate-map.mjs` to rebuild). Roads come from a sparse "relative neighbourhood" rule, with at most two crossings between any two countries (so borders have chokepoints), every country connected inside itself, and the whole world as connected as before. Highways run out of capitals (25% faster), ordinary roads, and ferries are the long sea lanes (slower). Rendered on the map as light lines (highways thicker, ferries dashed blue).
* **Land forces travel only along roads** (server and browser use the same `planRoute`). Ships and aircraft are not bound to roads. The AI war planner also uses roads. Tests in `packages/shared/src/roads.test.ts`.
* **Armies are visible on the map**: a figure (soldier with rifle, tank, field gun, aircraft, warship) on a NATO-style plate with the owner colour and unit count. Click one to select it (gold frame). The details panel shows an Army card: units, status, **Move / Attack…** and **Cancel orders**.
* **Orders**: with an army selected, **right-click any province** to order it there (the route is previewed as a line along the roads, then confirm). Attacking an enemy province is the same order and the panel says "Attack". On a phone use the Move / Attack… button, then tap the destination.
* **Cancel orders**: an army heading into its own land finishes the current leg and halts. An army about to attack turns back instead and returns to the province it left.
* Not in this week: aircraft patrol and attack orders (Week 13), naval orders and ranges (Week 14), buildings drawn on provinces and enemy armies on the map (Week 15).
* No database changes. Restart the server.
