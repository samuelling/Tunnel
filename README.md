# Shred Hole (Vortex Portal)

A 15-metre vertical wind tower with a 4.6-metre fan at the bottom. Drop something in, gravity and a 40 m/s downdraft feed it to the blades, and find out: **will it blend?** Whatever comes out falls into a vortex portal in the floor and is delivered to Matt's [World Builder](https://github.com/CrumpLabSandbox/Worldbuilder), where it falls out of a matching portal in the sky onto the Shred Pile.

Silly premise, real physics underneath. The scientific 2D version (lattice-Boltzmann CFD) lives on in [`/lab`](lab/).

**Play:** https://samuelling.github.io/Tunnel/ (GitHub Pages, serving the repo root)

## What's modelled

| | |
|---|---|
| **Fan** | A 420 kg·m² rotor with a speed-controlled 1.2 MW motor, limited by stall torque and power, fighting an air load ∝ ω² (the fan law). Tunnel airspeed follows blade speed: about 40 m/s (90 mph) flat out. |
| **Blade strikes** | Momentum exchange between the blade's leading edge (moving at ω·r) and the object, using the reduced mass of object and rotor. Light things get batted downstream; heavy things visibly slow the fan, and an anvil can stall it. If the strike energy beats the object's toughness, it breaks. Violent strikes mince the pieces as well. |
| **Air** | A turbulent boundary layer growing from the intake lip (δ = 0.37·x·Re⁻¹ᐟ⁵, 1/7-power profile), a sink-like intake that sucks in things thrown nearby, flow splitting around the hub, swirl behind the rotor and a spreading exit jet. Turbulence is a sum of divergence-free random Fourier modes, advected with the flow. |
| **Aerodynamics** | Calculated per facet of each surface: impact pressure on the windward side, wake suction on the leeward side, skin friction. This is what makes things tumble and weathercock. Thin flat things use a flat-plate model with a sliding centre of pressure (after Andersen, Pesavento & Wang 2005), so cards flutter. Spinning balls get Magnus lift, and everything gets buoyancy (the helium balloon floats). |
| **Breakability** | Computed from materials, size and mass in `js/strength.js`; nothing is hand-tuned. Each material has a density, an effective work of fracture Γ (J/m², including plastic losses) and a crushing strength σ. The solid fraction f = (mass ÷ hull volume) ÷ material density gives an equivalent wall thickness t = f·V/S: a fridge comes out ~1 mm, a boulder solid. **Energy to break** E = Γ·A, with A = the smallest cross-section, or perimeter × t for shells. **Force to cut in** F = σ·fill·w·d, with blade edge w = 4 cm and engagement depth d. Peak strike force is min(F, F_imp), where F_imp = (1+e)·m_eff·v²/d. Blades bend above 250 kN (progressively, and a bent blade gets weaker) and snap at 600 kN. Anything stronger than the blade can't be cut, whatever the energy: a bank safe, a boulder, an anvil at speed. A blade bent into the housing, or the rotor stalled against something wedged in it, jams the fan. |
| **Jams & repairs** | A jam trips the breaker, locks the rotor and drops an OUT OF ORDER sign on chains (a ~5.5 m pendulum). 🔧 Repair: lockout–tagout, crane the culprit out and drop it through the portal (yes, an intact safe arrives in World Builder), hammer bent blades straight or fit new ones, reset the breaker. It keeps a running repair bill. Bent blades also unbalance the rotor (it shakes) and cut the airflow. |
| **Breaking** | Objects split into their parts, or shatter into convex chunks (a Voronoi-style split around interior seeds). Each chunk is a real rigid body, coloured from skin to insides. Fragment strength scales from the parent (fracture area ∝ size², cutting force ∝ size). Fragile things also break on hard landings. |
| **Rigid bodies** | [Rapier](https://rapier.rs) with continuous collision detection, at 180 Hz. |
| **Sound** | All synthesised: wind noise that follows the airspeed, a hum at the blade-pass frequency (blades × rev/s), and impacts per material. |

The HUD shows wind speed (with its Beaufort number), fan rpm, motor power, blade-tip speed and hum frequency. Selecting an object shows its mass, drag area, terminal velocity and the wind needed to lift it. Each verdict reports pieces, biggest surviving fragment, strike energy and how much the fan slowed.

## Controls

- Pick an object in the tray, then **flick** on the scene to throw it (or tap / press space for a gentle toss). Two fingers or right-drag to look around.
- **🪟 Split view** (desktop): the Shred Pile beside the tunnel. **Pile Cam** is World Builder's Shred Pile ported to stand alone (`js/pilecam.js`). It reads the same mailbox, uses the same constants and seeds each drop's place from its id, so it matches Matt's pile, and your own drops fall out of its sky portal the moment they're sent. **Live World Builder** shows the real world in the pane (`?visit=shred-pile`) when one is reachable, e.g. `http://localhost:3000` on Matt's machine. Add `?split` to the URL to open in split view.
- **📸** renders this session's pile (everything that went through the portal, heaped at the angle of repose) with a list of what went in and what it was made of. It opens the phone's share sheet (Messages, Mail), or you can save the image or send the text by email or SMS.
- **FAN** slider is bipolar. Above the centre line (SHRED) it pulls air down onto the blades; below it (LIFT) the rotor reverses and blows air up the tube at ~65% of the forward flow, so light things levitate or get blown out the top while heavy ones sink into the blades. Centre = off. 🎥 cycles cameras (Overview, Hopper, Blades, Window, Portal, Follow). 🐢 slow motion. ⏱️ auto bullet-time right before the chop. 💨 smoke tracers. 🎲 chaos.

## The portal → World Builder

Debris falling below the tube is caught by the portal's vortex (a swirling inflow in the air model, plus a pull on heavier pieces) and spirals into the floor. Each object's pieces are packed into a **debris drop**, which is sent once the object has been judged:

```json
{ "v": 1, "id": "…", "at": 1793660524134, "source": "shred-hole",
  "object": { "name": "Watermelon", "icon": "🍉", "verdict": "IT BLENDS!", "quip": "…", "mass": 7 },
  "spray": "juice", "colors": ["#2e7d32", "#ff3b4a"],
  "pieces": [ { "c": "#2e7d32", "i": "#ff3b4a", "m": 0.31,
                "p": [x, y, z, …],      // convex-hull points, metres, piece frame
                "q": [x, y, z, w],      // orientation entering the portal (world, y up)
                "o": [x, y, z],         // offset from the object's centre (0 for loose chunks)
                "v": [vx, vy, vz] } ],  // velocity entering the portal (m/s)
  "particles": { "count": 0, "colors": ["#ff3b4a"] } }
```

Drops go to `WORKER_URL/drops` (the Cloudflare Worker's KV mailbox) and to any URLs in `DROP_URLS` (`js/settings.js`). To test, you can also open the page with `?drop=<url>`. World Builder's server speaks the same API (`POST`/`GET /api/shred/drops`), so a deployed World Builder can be posted to directly. Undelivered drops are kept in the browser. The Claude-hosted copy of the page can't send data to other sites, so its portal keeps everything locally.

## Type anything (Claude designs the object)

The ✨ tile lets players type any object. Claude returns a JSON recipe: primitive parts with real dimensions, colours and materials, plus mass, toughness, what sprays out, what it sounds like, a verdict line and a physics fact. Built-in objects use the same recipe format (`js/objects.js`), so generated objects get the same physics.

There are two ways the page can reach Claude:

1. **Claude-hosted version (artifact).** The page asks Claude directly. Each viewer gets a consent prompt and it runs on their own Claude account. Nothing to set up.
2. **GitHub Pages.** A small Cloudflare Worker (`worker/`) holds an API key and only accepts `{"object": "<name>"}`. The prompt is built server-side, so the Worker can't be used as a general Claude proxy. It rate-limits each visitor and caches each object name for a week.

### Budget, in fun clothes

- **The Fabricator** (new Claude designs) keeps shop hours: a shared hourly pool (`GEN_POOL_PER_HOUR`, 40), a daily cap (`GEN_PER_DAY`, 150) after which it's **CLOSED** until 9 AM Eastern with a rotating excuse ("Claude went home."), and a personal 20 per hour counted in the visitor's browser (`GEN_PER_HOUR`). Each new design costs the Worker **one** KV write.
- **The Warehouse**: everything ever fabricated sits on a public shelf (`GET /warehouse`), free to throw. Names are matched loosely (`objectKey()` in `js/prompt.js`): "a lava lamp", "Lava Lamps" and "the LAVA LAMP" are one object.
- **The payload hatch**: debris collects in a tray above the portal (resting pieces are frozen into static bodies, so it costs the simulation little). **OPEN THE HATCH** (or O) sends it all as one delivery: one request and one write instead of one per object. It opens itself when full (400 pieces), after two quiet minutes, or when you leave the page.
- **Portal fuel**: a daily budget of deliveries (`FUEL_PER_DAY`, 600, under Cloudflare's 1,000 free writes). When it runs out, deliveries wait in **Lost & Found** (localStorage) and go out after it refuels at 00:00 UTC.
- **The pile naps**: Pile Cam and World Builder back off from checking every 6 s to once a minute when nothing arrives, and stop while the tab is hidden. The Worker serves readers a shared 10 s copy.
- **The safety board** by the portal: DAYS SINCE THE FAN JAMMED (shared by everyone, `POST /jam`), portal fuel, and whether the Fabricator is open.

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
3. For the portal mailbox, run `wrangler kv namespace create DROPS`, paste the id into `wrangler.toml`, then `wrangler deploy` again.
4. Paste the printed `https://tunnel-claude.<you>.workers.dev` URL into `js/settings.js` and push. To test before pushing, open the site once with `?worker=<url>`. World Builder collects from `<url>/drops`: set it as the Shred Pile record's `relay`.

`worker/wrangler.toml` sets the allowed origin, the model (Sonnet by default; Haiku is cheaper) and the rate limit.

## Files

```
index.html, css/app.css
js/app.js        game loop, throwing, cameras, verdicts, UI
js/fan.js        rotor dynamics, blade-sweep detection, blade geometry
js/air.js        flow model + turbulence
js/aero.js       facet and flat-plate aerodynamics, Magnus, buoyancy
js/objects.js    object recipes, recipe → meshes/colliders/mass properties
js/strength.js   breakability: material table, E_break and cutting force, blade limits
js/outoforder.js the OUT OF ORDER sign
js/sharepile.js  session pile → heap render + inventory → share image
js/pilecam.js    split view: World Builder's Shred Pile, standalone, live from the mailbox
js/safetyboard.js the safety board by the portal
js/bigstuff.js   the big stuff (bank safe, granite boulder and manhole cover are the fan-jammers): fridge, mannequin, toilet, cart, office chair, couch, grandfather clock, upright piano, pool flamingo, vending machine, clawfoot tub, giant teddy, disco ball, inflatable tube man
js/prompt.js     the object-design prompt (shared with the Worker)
js/fracture.js   convex-chunk shattering
js/particles.js  juice, sparks, confetti, smoke
js/audio.js      synthesised sound
js/scene.js      hangar, tunnel, static colliders
js/claude.js     Claude connection (artifact or Worker)
js/portal.js     debris-drop packing and delivery
worker/          Cloudflare Worker for the GitHub Pages version
lib/             vendored three.js r187 and Rapier 0.21 (MIT / Apache-2.0)
lab/             the original 2D lattice-Boltzmann wind tunnel
```
