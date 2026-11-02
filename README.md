# Tunnel: the Shred Hole

A giant 3D wind tunnel with a 4.6-metre fan at the end. Pick something, throw it in and find out: **will it blend?**

Silly premise, real physics underneath. The scientific 2D version (lattice-Boltzmann CFD) lives on in [`/lab`](lab/).

**Play:** https://samuelling.github.io/tunnel/ (GitHub Pages, serving the repo root)

## What's modelled

| | |
|---|---|
| **Fan** | A 420 kg·m² rotor with a speed-controlled 1.2 MW motor, limited by stall torque and power, fighting an air load ∝ ω² (the fan law). Tunnel airspeed follows blade speed: about 40 m/s (90 mph) flat out. |
| **Blade strikes** | Momentum exchange between the blade's leading edge (moving at ω·r) and the object, using the reduced mass of object and rotor. Light things get batted downstream; heavy things visibly slow the fan, and an anvil can stall it. If the strike energy beats the object's toughness, it breaks. Violent strikes mince the pieces as well. |
| **Air** | A turbulent boundary layer growing from the intake lip (δ = 0.37·x·Re⁻¹ᐟ⁵, 1/7-power profile), a sink-like intake that sucks in things thrown nearby, flow splitting around the hub, swirl behind the rotor and a spreading exit jet. Turbulence is a sum of divergence-free random Fourier modes, advected with the flow. |
| **Aerodynamics** | Calculated per facet of each surface: impact pressure on the windward side, wake suction on the leeward side, skin friction. This is what makes things tumble and weathercock. Thin flat things use a flat-plate model with a sliding centre of pressure (after Andersen, Pesavento & Wang 2005), so cards flutter. Spinning balls get Magnus lift, and everything gets buoyancy (the helium balloon floats). |
| **Breaking** | Objects split into their parts, or shatter into convex chunks (a Voronoi-style split around interior seeds). Each chunk is a real rigid body, coloured from skin to insides. Fragile things also break on hard landings. |
| **Rigid bodies** | [Rapier](https://rapier.rs) with continuous collision detection, at 180 Hz. |
| **Sound** | All synthesised: wind noise that follows the airspeed, a hum at the blade-pass frequency (blades × rev/s), and impacts per material. |

The HUD shows wind speed (with its Beaufort number), fan rpm, motor power, blade-tip speed and hum frequency. Selecting an object shows its mass, drag area, terminal velocity and the wind needed to lift it. Each verdict reports pieces, biggest surviving fragment, strike energy and how much the fan slowed.

## Controls

- Pick an object in the tray, then **flick** on the scene to throw it (or tap / press space for a gentle toss). Two fingers or right-drag to look around.
- **FAN** slider sets the wind. 🎥 cycles cameras (Overview, Feeder, Blades, Window, Exit, Follow). 🐢 slow motion. ⏱️ auto bullet-time right before the chop. 💨 smoke tracers. 🎲 chaos.

## Type anything (Claude designs the object)

The ✨ tile lets players type any object. Claude returns a JSON recipe: primitive parts with real dimensions, colours and materials, plus mass, toughness, what sprays out, what it sounds like, a verdict line and a physics fact. Built-in objects use the same recipe format (`js/objects.js`), so generated objects get the same physics.

There are two ways the page can reach Claude:

1. **Claude-hosted version (artifact).** The page asks Claude directly. Each viewer gets a consent prompt and it runs on their own Claude account. Nothing to set up.
2. **GitHub Pages.** A small Cloudflare Worker (`worker/`) holds an API key and only accepts `{"object": "<name>"}`. The prompt is built server-side, so the Worker can't be used as a general Claude proxy. It rate-limits each visitor and caches each object name for a week.

### Deploying the Worker

1. **API key.** Max includes monthly API credit. On claude.ai go to Settings → Billing → API credits → Link organization. Then create an API key in that Console organization, and set a workspace spend limit there as a safety net.
2. **Deploy:**
   ```sh
   npm i -g wrangler
   cd worker
   wrangler login
   wrangler secret put ANTHROPIC_API_KEY
   wrangler deploy
   ```
3. Paste the printed `https://tunnel-claude.<you>.workers.dev` URL into `js/settings.js` and push. To test before pushing, open the site once with `?worker=<url>`.

`worker/wrangler.toml` sets the allowed origin, the model (Sonnet by default; Haiku is cheaper) and the rate limit.

## Files

```
index.html, css/app.css
js/app.js        game loop, throwing, cameras, verdicts, UI
js/fan.js        rotor dynamics, blade-sweep detection, blade geometry
js/air.js        flow model + turbulence
js/aero.js       facet and flat-plate aerodynamics, Magnus, buoyancy
js/objects.js    object recipes, recipe → meshes/colliders/mass properties
js/prompt.js     the object-design prompt (shared with the Worker)
js/fracture.js   convex-chunk shattering
js/particles.js  juice, sparks, confetti, smoke
js/audio.js      synthesised sound
js/scene.js      hangar, tunnel, static colliders
js/claude.js     Claude connection (artifact or Worker)
worker/          Cloudflare Worker for the GitHub Pages version
lib/             vendored three.js r187 and Rapier 0.21 (MIT / Apache-2.0)
lab/             the original 2D lattice-Boltzmann wind tunnel
```
