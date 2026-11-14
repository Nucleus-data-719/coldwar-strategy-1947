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

- **A world map of 2,351 provinces** across 151 countries, built from the real borders of 31 December 1947 (CShapes). See "Map rebuild" below. The output `map-geometry.generated.ts` is committed, so the game itself does not need the script.
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

### Unit artwork (included)
All 11 unit images are already included (cut out of your JPGs). To replace one, put a transparent PNG in `apps/web/public/units/` (names in the README.txt there: `infantry.png`, `artillery.png`, `light_tank.png`, `heavy_tank.png` (or one `tank.png`), `fighter.png`, `bomber.png`, `air_support.png`, `submarine.png`, `destroyer.png`, `cruiser.png`, `battleship.png`). When a file exists it replaces the drawn figure on the map tokens and in the panels; missing files fall back to the drawn ones, so they can be added one at a time.

## Week 12 follow-up (roads, sea lanes, army panel)
- Every pair of neighbouring provinces now has a road. Roads run through the border crossing of the two provinces (never across open water) and are drawn faint; highways (out of capitals) are a little stronger.
- Railways: a finished Railway in a province turns every road of that province into a railway (dark bed, sleepers, two rails) and travel on those roads takes half the time (changed in the map-fix round; before, both ends needed one).
- Sea lanes: a net of dots covers the oceans (shown when a ship is selected or a sea order is planned). Ships sail from port to port along the dots, ferries follow them too. Every coastal province has a harbour dot.
- Selecting an army shows only the army panel (Move / Attack, Cancel orders); close it to return to the province tabs.
- Regenerate the map after changing `map-source.mjs`: `node packages/shared/scripts/generate-map.mjs`.
- No SQL changes. Restart the server (shared movement code changed).

## Week 13: air orders
**Run `docs/week13.sql` in the Neon SQL editor before restarting the server** (adds patrol columns to `formations` and a `damage` column to `buildings`).

- Select an air force on the map, press **Move / Attack / Patrol…**, then choose **Attack / Move** (fly to a province; over an enemy province this is a strike and a battle, as before) or **Patrol**.
- A mixed army (for example a Garrison with aircraft in it): set the land units to 0 in the order panel to give the aircraft an air order. The aircraft split off as a new task force.
- **Patrol** sends the aircraft straight to a province (within 800 map units) and they circle there until you press **Cancel patrol**. The patrol circle is drawn on the map (fighters radius 100, air support 90, bombers 80; a mixed force uses its shortest range).
- Every game hour, inside the circle: enemy armies (countries you are at war with, wherever they stand) lose units, more from bombers and air support than from fighters, spread thinner over many armies; enemy buildings in enemy provinces take bomb damage (bombers most); enemy aircraft fight yours.
- Your aircraft lose units to air defence only over enemy-owned provinces (more with more enemy troops there) and to enemy fighters. Over friendly or neutral land only dogfights hurt them, and only enemies are ever hurt.
- Buildings at 50% damage or more stop working (production, railways) until repaired; at 100% they are destroyed. Repair is 1% per game hour once left alone.
- Out of range, or a force with land units, cannot patrol. Aircraft that lose all units are removed.
- AI armies do not use patrols yet (Week 15).

## Week 14: naval orders and ranges
**Run `docs/week14.sql` in the Neon SQL editor before restarting the server** (fleet position columns on `formations`, new `sea_mines` table).

- **Ships now stop anywhere on the ocean.** A fleet has a position on the sea dots. Select it, press **Sail / Attack…**, then: click one of your harbours (sail there and dock), **right-click open ocean** (sail to the nearest dot), or **right-click a red enemy fleet** (attack). The planned route is drawn white; the voyage is drawn dashed. **Cancel orders** stops the fleet where it is. Fleets at sea cannot be split or merged; split in port.
- **Engagement range** (steps along the dots): submarines 0 (must be on top of the enemy), destroyers 1, corvettes 1 (new unit, researched with the destroyer), cruisers 1, battleships 2. A fleet attacking closes in until *every* ship can fire (its shortest range). Only ships in range fire: a battleship at 2 steps shells a destroyer that cannot answer. With a fleet selected, dots within range are lit (gold = whole fleet in range, pale blue = battleship-only reach).
- **Submarines:** battleships (×0.25) and cruisers (×0.5) are bad at hitting them; destroyers and corvettes (×1.5) are good. A fleet made only of submarines is invisible to the enemy unless a destroyer or corvette is within 3 steps.
- **Seeing the enemy:** you see enemy fleets within 3 steps of your ships at sea, and within 2 steps of your own harbours. They appear as red circles with the ship count. If the target moves out of reach before you arrive, contact is lost.
- **Mines:** a fleet holding position at sea with submarines, destroyers or corvettes can **Lay mines** (10 money + 20 steel per ship). Strength 3 per ship, up to 20; lasts 72 game hours. Enemy fleets (countries at war with you) sailing through lose up to 4% of ships per strength point (max 35%); destroyers and corvettes halve it. Each hit weakens the field. You always see your own mines; enemy mines show up only within 1 step of your destroyers/corvettes.
- Ships can attack ships only (not land). Land and air formations are unchanged. AI fleets still use the older harbour-to-harbour movement (Week 15).
- Corvettes use the destroyer picture until you add `apps/web/public/units/corvette.png`.

## Week 14 follow-up: order bar, route lines, railways, delay
**Run the two new lines at the bottom of `docs/week14.sql`** (`move_hold_until`, `move_hold_fraction`; run the whole file if you have not run it yet).

- **Order bar** (like Conflict of Nations): select an army and a bar appears at the bottom of the map with **Move**, **Attack**, **Waypoint**, **Delay**, **Cancel Orders** (ships: **Sail**, **Naval attack**, **Lay mines**), and an army panel with strength, speed, units, current position, destination, estimated travel time and arrival clock time. The old side-panel army card is gone; the side panel opens only to plan an order.
- **Move** must stay on your own land; **Attack** must end in enemy land. Right-clicking a province picks Move or Attack automatically.
- **Waypoint**: while an army is marching, add another stop; it first reaches the earlier destination, then continues.
- **Delay**: opens the *Delay movement* window. Pick 0–24 game hours; the army stops where it stands, and its whole route arrives that much later. *Cancel Delay* releases it. Several armies delayed by different amounts can be timed to arrive together.
- **Route lines**: every moving army has a thin steel-blue line with an arrow at its destination. Hover or select an army and its line turns into a wider blue track with white dashes marching to the arrow.
- **Roads** are now very faint; **railways** are drawn Supremacy-style: a thin outline, closely spaced dark ties and two light rails, so they are clearly not roads.
- Not included: Loadout and Rush (skipped as requested).

## Week 15: buildings on the map, AI air and sea, tutorial, balance
No database changes. Restart the server.

- **Buildings drawn on provinces.** Every building is a small badge with its own pictogram (factory, tent, gear, anchor, plane, flask, columns, tower, rails) above its province, outlined in the owner's colour. Under construction: faint pictogram, gold frame and a progress bar that fills in real time. Bombed: a red damage bar; at 50% a red cross (knocked out, repairs 1% per game hour). Hover for a tooltip (name, progress or damage, effect), click to open the province, right-click to give the selected army an order there. Shown from medium zoom in; the old ▣/⏳ counters are gone.
- **AI air force and navy** (only while an AI country is at war). It builds an Airbase and a Harbor, buys a few aircraft and ships at full price (it ignores research; capped at about 2 + half its provinces in aircraft, 1 + a third in ships), then:
  - sends aircraft to patrol over the biggest enemy army in reach (at least ~3 infantry of power inside the circle) and calls the patrol off when the enemy leaves;
  - attacks enemy fleets it can see and is at least 1.3x stronger than, sails mine-layers two steps off its own harbour, lays mines, and returns to port;
  - land attacks already follow roads and railways through the normal movement system.
- **Tutorial:** the Move step now explains the order bar and route lines; two optional "advanced" steps (air patrol, fleet at sea) appear after the basics and do not block finishing.
- **Balance pass** (numbers in `patrol.ts`, `naval.ts`, checked by new guard-rail tests): air defence over enemy land lowered (5 bombers over a 30-unit enemy now lose about a quarter of their number per game day and destroy about a quarter of the enemy, instead of losing 37%); mine damage per field lowered to 3% of the fleet per strength point, capped at 25% (was 4%, 35%).
- Known gaps: AI does not research; AI fleets do not protect transports (there are none yet); the AI never takes ships on hunts beyond 8 steps.

## Map rebuild: 1947 world, 2,351 provinces, 40 playable countries, wood

**Borders** come from CShapes 2.0 on 31 December 1947 (`packages/shared/scripts/data/cshapes-1947.json`, made by `prepare-cshapes.mjs`). Some entries are folded together (Alaska, Hawaii and Puerto Rico into the USA, Newfoundland into Canada, Tibet into China, the two Germanys and two Koreas, Kashmir into India and Pakistan, Spanish and French overseas bits, Papua and New Guinea into Australia). Microstates too small for the grid (Maldives, Comoros) are left out; Greenland and Svalbard are not on the map.

**Countries:** 40 playable, 111 AI-only.
- Superpowers: USA and Soviet Union, 65 provinces each.
- Major (50 to 65): China, India, Brazil, France, Germany, Canada, Australia, Argentina, Mexico, Indonesia, United Kingdom, Japan, Turkey.
- Medium (35 to 50): Italy, Spain, Poland, Sweden, Norway, Finland, Romania, Yugoslavia, Czechoslovakia, Egypt, Iran, Iraq, Saudi Arabia, Pakistan, South Africa, Korea, Thailand, Burma, Philippines, Vietnam, Ethiopia, Colombia, Chile, Peru, Venezuela.
- AI countries get 1 to 15 provinces by area.

**Provinces and resources**
- **Cities** (named after real 1947 cities) produce manpower, money and one resource: food, oil, steel, electronics, rare earth or wood. **Ordinary provinces** (named "<nearest city> Plains/Woods/Hills/Highlands/Desert") produce manpower and money only.
- Every playable country has exactly **two deposit provinces** (not cities) that produce one resource at double rate (gold ring and x2 on the map).
- Every playable country has oil, steel, electronics, rare earth, wood and food somewhere. Where history gave a country none of one (for example Finland has no oil), the generator gives one of its cities that resource and prints it. History decides the rest: Saudi oil (Dhahran, Ghawar), Japanese electronics, Chinese rare earth (Bayan Obo), Turkish steel (Karabuk, Divrigi), Ploiesti oil, Kiruna iron, Baku and Abadan.
- New resource **wood**, needed by every building (60 to 120 each). Rare earth is now orange and electronics green on the map and in the top bar.
- Hourly numbers (in `map-data.ts`): rural 5 to 8 money, 12 to 18 manpower; city 16 to 24 money, 26 to 36 manpower; capital x1.5. A city's resource gives 45 food, 18 oil, 22 steel, 6 electronics, 4 rare earth or 22 wood; a deposit gives double. Food now comes only from food cities and farmland deposits, so check your food income.

**Map generator** (`node packages/shared/scripts/generate-map.mjs [--debug out.svg]`, about 10 seconds): rasterises the borders on a 0.25 degree grid, places a seed on every city and deposit from `map-source.mjs`, spreads the other provinces by k-means (denser where people lived: Siberia, the Canadian north, Tibet and the Australian interior get fewer), assigns every cell to the nearest seed on the same landmass, traces shared borders, and builds roads, ferries (short sea hops, automatic), harbours and sea lanes. Port cities within 3/4 of a degree of the sea are moved to the shore. Edit `map-source.mjs` (cities, deposits, counts, merges) and re-run it. `map-balance.test.ts` checks the rules.

**Performance on the web:** province outlines are redrawn only when their owner, selection or overlay changes; name labels, army labels and icons are created and shown only for provinces on screen and when zoomed in.

**To upgrade:** run `docs/map-rebuild.sql` in the Neon SQL editor (adds the wood column and deletes the old campaigns, because the old province keys no longer exist), restart the server, and a fresh campaign is created. `npm run db:push` also adds the column.

**Known limits:** the game state is now about 350 KB per refresh and the sea-route search scans about 3,000 dots, (addressed in Week 16). AI countries start with the same stockpile and garrison per province as before. Balance numbers are first guesses.

## Week 16: performance, security, closed beta

Full notes, backups and the tester checklist are in `docs/week16.md`. No database change this week.

- **Faster:** the state call reads in parallel (one round trip instead of a dozen), large answers are gzipped (about 10x smaller), sea routes use a priority queue, AI countries decide four at a time, and the browser refreshes at most every 1.5 s on server pushes.
- **Timing:** requests slower than `SLOW_REQUEST_MS` are logged. `GET /api/metrics` (header `x-admin-token`, from `ADMIN_TOKEN` in `.env`) lists p50/p95/max per route. `GET /api/health` is for uptime checks.
- **Security:** security headers, 64 KB body limit, HS256-pinned sessions, rate limits you can set (`RATE_LIMIT_PER_MIN`, `AUTH_RATE_LIMIT_PER_MIN`), `TRUST_PROXY=1` behind a proxy. Every body and id was already validated; this week's review confirmed it.
- **Closed beta:** set `BETA_INVITE_CODES=code1,code2` in `.env` and registering asks for a code (the sign-up form has the field).
- **Load test:** `node scripts/load-test.mjs --players 50 --minutes 2` (see `docs/week16.md` for the temporary limits to raise). Clean up with `docs/week16-cleanup.sql`.
- **New `.env` values** (all optional): `BETA_INVITE_CODES`, `ADMIN_TOKEN`, `SLOW_REQUEST_MS`, `AI_CONCURRENCY`, `AI_MAX_PER_TICK`, `TRUST_PROXY`, `RATE_LIMIT_PER_MIN`, `AUTH_RATE_LIMIT_PER_MIN`.

**Not measured here:** the sandbox has no database, so the load test and the server timings could not be run in this build. Run the script on your machine and on the hosted server and send me the table; the next fixes should follow its numbers.

**Backlog:** a 3D, Hearts of Iron IV style terrain map (logged in the plan).

## Map fixes, round 1

No database change. **Garrison changes apply to new campaigns only**, so create a new campaign to see them (old campaigns keep their garrisons).

- **Names:** only cities (and capitals, with a star) show a name on the map. Plains, woods and hills are named in their panel.
- **Troop counts:** the number of troops no longer shows on provinces or cities. Your armies are still drawn as figures, and the panel shows the numbers.
- **Thinner lines:** ordinary borders are one screen pixel at any zoom; your provinces (gold) and enemy provinces (red) are only slightly stronger; selection is a thin white line. Roads, highways, ferries and railways are about half as wide.
- **Garrisons:** each city, the capital included, starts with 5 infantry. Rural provinces start empty, and an army entering an undefended province takes it without a fight.
- **Railways:** a finished railway turns every road of its province into a railway on the map and halves travel time on all of them (see `railLeg` in `movement.ts`). Before, both ends needed a railway, so the first one showed nothing.
- **Logged for later:** the 3D, Hearts of Iron IV style map (in the plan).

## Map fixes, round 2

**Restart the server after unzipping.** The map changed (many cities became ordinary provinces, so their keys changed), so campaigns made before this build are hidden automatically and a fresh "Classic Cold War 1947" campaign is created. No SQL is needed (`docs/map-rebuild.sql` still deletes the hidden ones if you want them gone).

- **Cities per country** (capital included): super and major countries 7, medium countries 6, small playable countries 3 to 5. Every other province is rural. Set in `scripts/map-source.mjs` (`cityTarget`, `KEEP_CITIES`); a country with only 3 cities may lack one resource, which is the point of being small. Re-run `node packages/shared/scripts/generate-map.mjs` after editing.
- **Garrisons:** 5 infantry per city, none in rural provinces (round 1), so with fewer cities there are far fewer garrisons.
- **Railways:** drawn only inside the province that has one: a thin black track from its centre to the border. A road between two railway provinces is drawn in full. Travel: a railway doubles speed inside its own province, so with one end it takes 75% of the time and with both ends 50% (`railEnds` in `movement.ts`).
- **Zoomed-out view (Hearts of Iron IV style):** below zoom 0.9 the map shows whole countries in one colour with thin borders and a large name laid along each country (`strategic-view.ts`). Provinces, roads, railways, icons and building badges are not drawn at all in that view, which is what makes the world view fast. Zoom in to see provinces. Clicking a country selects its capital. Orders to a province need the province view.
- **Depth look:** a pale shallow-water halo around the coasts, a dark slab under the land and a soft vignette. This is a 2.5D look, not a tilted camera.
- **Not done:** a real tilted 3D camera (perspective, terrain textures). It needs a different renderer and a rewrite of clicking and army drawing, so it is a separate piece of work.

**Fix after first test of round 2:** the zoomed-out view had holes (some provinces were not filled, because Pixi dropped some polygons when many touching ones shared one fill; each province is now filled on its own), and zooming in was slow (a wide coast halo made of 2,300 stroked outlines was drawn every frame, and every province shape was drawn even when off screen). The halo is gone, and province shapes outside the window are now hidden.

## Map fixes, round 3

**Restart the server and use the new default campaign** (the city layout changed again, so older campaigns are hidden automatically).

- **Political map has no terrain symbols** (mountains, trees, dunes). They are drawn only in the Terrain map mode.
- **Railways** now stop exactly on the province boundary: a railway in one province is drawn from its centre to the border crossing of each road, no further and no shorter. A road between two railway provinces is drawn in full.
- **Cities are placed by frontier, not by list.** For every playable country the generator finds each stretch of land border with a neighbour and picks cities so that every stretch has a city near it, while keeping cities apart from each other (`pickCities` in `generate-map.mjs`). Hand-written preferences are in `map-source.mjs`: `KEEP_CITIES` (strong preference for the 15 super and major countries), `MUST_CITIES` (never dropped: Ploiesti, Dhahran, Basra, Abadan, Karabuk, Quetta, Gilgit, Lahore) and `BORDER_CITIES` (extra frontier towns such as Quetta, Gilgit, Jodhpur, Srinagar, Kashgar, Urumqi, Boa Vista, Campo Grande, Whitehorse). Run the generator to see which frontiers are left uncovered ("frontier ..." lines).
- **Countries without a player** with a long border and no city near it get a fort town there, such as Fort Chad, Fort Algeria and Fort Egypt for Libya. They hold the 5-infantry garrison like any city.
- Counts stay 7 for super and major countries, 6 for medium, 3 to 5 for small. Pakistan now has Karachi, Quetta, Dalbandin, Lahore, Gilgit and Chittagong; India has Srinagar and Jodhpur on the Pakistani side and Imphal in the east; China has Urumqi and Kashgar in the west.
- Some famous cities are gone because they sit next to a capital or another city (New York, Sydney, Sao Paulo, Leningrad, Toronto). To bring one back, put it in `MUST_CITIES` and re-run.

## Map fixes, round 4

- **Railways** are drawn as grey double-rail track with ties, thinner and lighter than before (still only inside their own province).
- **Libya, Algeria and other AI countries**: coastal cities are removed (capitals stay) and real towns on the land borders are added instead (Ghadames, Ghat, Kufra, Jaghbub, Tindouf, Tamanrasset, Bechar, Tebessa, ...). The generated "Fort ..." outposts are gone. Edit `AI_BORDER_TOWNS` in `packages/shared/scripts/map-source.mjs`.
- **Less clutter**: resource icons, building badges and city names show only on your own provinces. Foreign countries show just their capital. The Resources map mode still shows everyone's icons.
- Province keys changed: restart the server and use the new default campaign.

## Army orders, round 1

**Apply the database changes first:** `npm run db:push`, or run `docs/orders-update.sql` in the Neon SQL editor (adds `rest_x`, `rest_y`, `front_country_id` to `formations`). Then restart the server.

- **Move and Attack with an arrow.** Click anywhere on the map: the arrow ends on the exact spot you clicked and the army stands there on arrival (a move inside one province works too). The arrow is white for your own land and **red** when the order goes into enemy land.
- **War on demand.** Sending troops into a country you are not at war with shows "declares war on X" in red; the button reads *Declare war and go*, and war is declared when you confirm. (Allies still have to be un-allied first.)
- **Armies merge by themselves.** Idle armies of yours in the same place join when one arrives: land with land, aircraft with aircraft, ships with ships. A mix of unit types becomes "1st Army", "2nd Army", and so on. Armies you placed on different spots inside a province stay apart. AI-controlled countries keep their own armies.
- **Split** (new order button): choose how many of each unit to peel off; the new army stays put and can be given orders.
- **Front line** (new order button, like HOI4): hover a border (it glows green), click the country, press *Assign to border*. The army spreads out along the border so every border province has a unit (extra units go to evenly spread provinces; with fewer units than provinces, evenly spread provinces are covered and cities first). A coloured line marks the front on the map. When you are at war with that country the guards advance and attack on their own, cities first, until the land is taken. *Cancel Orders* releases them.
- **Fainter borders:** province, own-country and enemy outlines are thinner and lighter.

## Speed and database transfer, round 1

Why Neon showed 4.5 GB: every game-state request read the whole world (all 2,351 province rows with their large columns, every army stack), the browser refetched it after each event, the AI re-read the whole world for each decision in wartime, and the game clock ran every 5 s all night while the dev server was on. Changes:

- **State** reads only the three province columns the map needs, sums army counts in SQL (one row per province), and shares one snapshot of the world between requests for 3 s (`WORLD_CACHE_MS`). The snapshot is dropped at once when buildings, ownership or wars change. Your own armies and resources are always read fresh.
- **Browser** refetches at most every 2.5 s after a push instead of every 1.5 s.
- **Game clock** runs every `TICK_MS` (5 s) while a browser is connected and every `IDLE_TICK_MS` (60 s) while nobody is. Nothing is lost: all progress is stored as timestamps, and resolves at the next tick.
- **AI at war** reads only the columns it uses and only its own and its enemies' armies.
- New optional `.env` values: `IDLE_TICK_MS`, `WORLD_CACHE_MS`.

Not measured here (no database in the sandbox). After deploying, check `/api/metrics` (x-admin-token header) and Neon's monthly transfer graph.

## Private test site (Railway)

The server now serves the built web app too (one address, no CORS), asks for `SITE_PASSWORD` before anything loads, and tells search engines not to list it. `Dockerfile` and `railway.json` build and run it; the tables are created at start. Step by step: `docs/deploy-railway.md`. New `.env` values: `SITE_PASSWORD`, `NOINDEX`, `WEB_DIST`. New npm scripts: `build:deploy`, `start:deploy`. New dependency: `compression` (run `npm install`).

## The 1950 world

The game now starts on 1 January 1950 and is called Cold War 1950.

- **Borders** come from CShapes on 1 Jan 1950 (`packages/shared/scripts/data/cshapes-1950.json`; made with `prepare-cshapes.mjs`, which now takes `--date=YYYY-MM-DD`). Regenerate the map with `node packages/shared/scripts/generate-map.mjs`.
- **44 playable countries** (was 40): Germany is split into **West Germany** (Bonn, 6 cities) and **East Germany** (East Berlin, 4); Korea into **South Korea** and **North Korea**, with border cities Chunchon and Kaesong facing each other; China is the **People's Republic** (capital Beijing, Nanjing is now a city) and **Taiwan** (Republic of China, Taipei) is playable; **Israel** (Jerusalem, Tel Aviv, Haifa, Eilat) is new.
- **Tibet** stands alone as an independent AI country (Lhasa, Shigatse, Chamdo), so it can be taken. **Jordan** includes the West Bank, **Egypt** holds Gaza, Dutch New Guinea is separate, and the 1947-only entries (Palestine, Newfoundland, Kashmir halves) are gone.
- **Flags** drawn for the PRC, Taiwan (ROC), both Germanys, North Korea and Israel; South Korea keeps the Taegeukgi.
- Names, start year, research era and saved-preference keys say 1950. The default campaign is "Classic Cold War 1950".
- **Province keys changed again.** Old campaigns are hidden automatically and a new default campaign is created at start. To delete the hidden ones, run `docs/map-rebuild.sql`.
