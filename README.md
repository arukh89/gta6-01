# Solmaris Heat

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/arukh89/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/arukh89/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

Solmaris Heat is an original open-world crime game set in the sun-soaked coastal city of Solmaris. Lena Cruz owes Dario one last favour, and the whole city is awake: explore on foot or in any car you can reach, work through six story jobs, take taxi fares, grab cash drops, and keep the Solmaris PD off your tail.

The city is a full grid of streets with traffic that follows the roads, pedestrians who stroll the sidewalks and scatter when trouble starts, a park, a neon district, downtown towers, a beach promenade and a marina. Crime raises a five-star wanted level; police cruisers chase and officers come on foot, and the heat only cools when you break line of sight or pay for a fresh coat at the Spray Barn. Combat is fists up close and a pistol at range, with synthesized sound throughout — engine hum, sirens, gunshots and a warm chord loop, all generated in code. The HUD carries wanted stars, health, money, the mission objective, a live minimap and a clock, and progress saves automatically between visits.

Every name, character, street, story beat, sound and line of art in this game is original. Nothing comes from any commercial game.

## Play it

Serve the game folder with any static server and open `game/index.html` in a desktop browser — it plays fully offline, with no network requests:

```sh
node serve.ts
# then open http://localhost:8080
```

Controls: WASD / arrows walk and drive, mouse aims, click attacks, E steals or enters a car, Shift sprints or handbrakes, 1 / 2 switch weapons, R reloads, P pauses, M mutes.

## How it is built

`game/` is plain static files: `index.html`, `style.css`, and ES modules under `game/src/`, one file per job — `world.js` builds the city, `player.js` walks and drives, `traffic.js` and `pedestrians.js` run the streets, `police.js` runs the wanted system, `combat.js` handles weapons, `missions.js` holds the story and taxi fares, `render3d.js` draws the city in 3D with the vendored three.js build under `game/vendor/` (a chase camera, windowed buildings, shadows and day-to-night light), `render.js` keeps the original 2D canvas renderer as a fallback (`?renderer=2d`), `hud.js` runs the HUD and minimap, `audio.js` synthesizes every sound, `save.js` keeps progress, and `update.js` steps it all at a fixed 60 Hz. No assets, no build step, no network requests.

`main.ts` (Node 22, standard library only) copies `game/` and `screenshots/` to `/output` and writes `/output/dossier.json` with the vendored make.fun library. Outside the grader, `MAKEFUN_OUTPUT_DIR` stands in for `/output`:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Screenshots in `screenshots/` are fresh renders of this game's own code, staged by `game/src/shots.js` from the same rules real play uses (`?shot=chase|foot|start|dusk&seed=7`).

---

Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards
