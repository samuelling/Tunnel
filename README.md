# Tunnel

A physically modelled wind tunnel that runs in the browser. Put cylinders, airfoils, bridge decks, rubber ducks, teapots, your own drawings, words or photos into the test section. Then watch the flow, read the force balance, or let the object move: spring mounts, pivots, motors and free flight.

**Live:** https://samuelling.github.io/tunnel/ (serve the repo root with GitHub Pages)
**Validation page:** `validate.html`

---

## Physics

The tunnel is a 2D incompressible flow solver running on the GPU (WebGL2 fragment shaders, float32).

| Piece | Model |
|---|---|
| Fluid | Lattice-Boltzmann, **D2Q9**, pull streaming |
| Collision | **Multiple-relaxation-time** (Lallemand & Luo 2000). Bulk and ghost moments relax independently of shear, and the raised bulk viscosity damps spurious lattice acoustics |
| Stabilisation | **Hybrid regularisation** (after Jacob, Malaspinas & Sagaut 2018; Feng et al. 2019). 2 % of the non-equilibrium stress is taken from a finite-difference strain estimate. This removes the grid-scale checkerboard noise that appears as τ → ½, and the resolved physics is unchanged |
| Turbulence | **Smagorinsky LES** (C<sub>s</sub> adjustable). The eddy viscosity comes locally from the non-equilibrium stress, so no finite-difference gradients are needed (Hou et al. 1996) |
| Walls of the model | **Interpolated bounce-back** (Bouzidi, Firdaouss & Lallemand 2001). The surface sits at its true sub-cell position, taken from a signed distance field, so curved bodies aren't staircases |
| Moving walls | Rigid-body wall velocity (translation + rotation) enters the bounce-back. Covered and uncovered nodes are refilled at equilibrium |
| Forces | **Momentum exchange**, Galilean-invariant form (Wen et al. 2014). Summed per object on the GPU and averaged over each frame's substeps |
| Inlet | Velocity inlet with optional **free-stream turbulence**: a sum of random Fourier modes advected at U∞, intensity set in % |
| Outlet | Zero-gradient, plus an absorbing sponge (the "diffuser") that raises viscosity and damps pressure waves before they reflect |
| Tunnel walls | Free-slip (specular) or no-slip (bounce-back) |
| Smoke | Passive scalar, **MacCormack** advection with a limiter and RK2 characteristics. Rake of nozzles plus a hand-held smoke wand |
| Tracers | 16k–65k seeded particles, RK2, rendered as streak exposures |

### Units

You set real quantities: fluid (air, water, honey, Mars atmosphere…), wind speed in m/s, test-section height and object size in metres, material density in kg/m³. These map to lattice units as follows:

- Δx = test-section height / grid height
- Lattice inlet speed ≤ 0.05 (lattice Mach ≈ 0.087). It is lowered automatically for very viscous fluids so the relaxation time stays in range. Keeping it low matters for a subtle reason: lattice sound is artificially slow, and at higher lattice Mach the tunnel's first transverse acoustic mode lands right on typical vortex-shedding frequencies. The shedding then locks onto it, which doubled the lift fluctuation in early tests.
- Δt = U<sub>lattice</sub> · Δx / U
- ν<sub>lattice</sub> = ν · Δt / Δx²

Every readout converts back to SI: drag and lift in N per metre of span, moment, shedding frequency in Hz, Reynolds and Strouhal numbers. The HUD shows how much slower (or faster) than real time the run is.

At realistic Reynolds numbers (10⁴–10⁶) the molecular relaxation time sits just above ½. The flow is then under-resolved on purpose, and the LES closure carries the sub-grid scales. That is the same trade-off real engineering CFD makes.

### Rigid-body dynamics

Each object is a rigid body with mass and moment of inertia integrated from its silhouette and material density. Its mount sets which degrees of freedom are free:

| Mount | DOF | What it shows |
|---|---|---|
| Fixed | none | Force balance: C<sub>D</sub>, C<sub>L</sub>, C<sub>M</sub>, Strouhal |
| Pivot | θ (optional return spring) | Weathervanes, Savonius rotors, autorotation |
| Motor | driven θ̇ | Magnus effect on a spinning cylinder, motor torque |
| Spring | heave y and/or pitch θ about an elastic axis, with natural frequencies and damping ζ | Vortex-induced vibration, galloping, classical flutter (the Tacoma Narrows deck preset) |
| Free | x, y, θ with gravity, buoyancy and wall contact | Tumbling cards, fluttering leaves, levitating a ping-pong ball in the vertical tunnel |

The equations of motion use the full rigid-body mass matrix about the pivot, including the centroid offset that couples heave and pitch (the mechanism behind flutter). Gravity acts at the centroid; buoyancy (ρ<sub>fluid</sub>·A·g) is added explicitly. Very light bodies (density near or below the fluid's, e.g. foam in water) would make explicit coupling unstable. The solver therefore uses a lagged added-mass correction, so free bodies stay stable at any density ratio.

Thin objects (cards, leaves) are thickened to at least about 2.5 cells. Their "effective" material densities keep the real mass per unit span.

### Validation

`validate.html` runs flow past a circular cylinder and compares with the literature. The tunnel has 5–6 % blockage and slip walls, which raises C<sub>D</sub> by a few percent compared with an unconfined cylinder.

| Case | Grid | C<sub>D</sub> Tunnel | C<sub>D</sub> literature (unconfined) | C<sub>L</sub> rms | St Tunnel | St literature |
|---|---|---|---|---|---|---|
| Re 20 (steady) | 300×160, D = 10 cells | 2.27 | 2.05–2.09 | — | steady | steady |
| Re 100 | 300×160, D = 10 cells | 1.49 | 1.33–1.40 | 0.236 (lit. ≈ 0.23) | 0.167 | 0.164–0.167 |
| Re 10⁵, LES | 320×160, D = 24 cells, 15 % blockage | 1.73 | stability check | 1.02 | — | ≈ 0.2 |

These runs used a software GPU at a deliberately coarse 10-cell diameter. Both that and the 6 % blockage push C<sub>D</sub> up by several percent. The lift fluctuation and shedding frequency are the more sensitive measures, and they match. The in-app grids put 20–80 cells across a typical model. On a real GPU, `validate.html` runs its default (finer) cases in a minute or two.

### Honest limits

- **2D.** Every object is an infinitely long extrusion of its silhouette: a rubber duck here is a duck-shaped beam. 2D turbulence cascades energy to large scales, so wakes are more coherent than in 3D, and bluff-body drag at high Re typically comes out 10–30 % above 3D experiments.
- **Incompressible.** Fine up to about 100 m/s in air. Shocks and transonic effects are not modelled.
- **Wall resolution.** At Re ≳ 10⁴ the boundary layer is thinner than a cell, so separation on smooth curved bodies is less precise than on sharp-edged ones. Sharp-edged bodies (plates, squares, bridge decks) are the most trustworthy at high Re.

## Using it

- **Objects tab:** tap a model to add it (up to 8). Type a word, upload a photo (it becomes a silhouette), or use the **✎ Draw** tool: a closed loop becomes a solid, an open stroke becomes a bent plate.
- **Move tool:** drag to move, drag the orange handle, scroll, or twist with two fingers to rotate. Free-flying objects can be thrown.
- **Smoke tool:** drag to release smoke. **Probe tool:** place pitot probes that read speed and C<sub>p</sub>.
- **Model tab:** size, angle, material, density, mount, springs, motor speed, plus live coefficients.
- **View tab:** smoke, vorticity, speed, pressure coefficient, schlieren, particles.
- **Data tab:** time history of C<sub>D</sub>/C<sub>L</sub>/C<sub>M</sub>, means, RMS, shedding frequency, CSV export.
- Keyboard: space to pause, ←/→ to rotate (shift for 0.1°), delete to remove.

No build step. Open `index.html` from any static server.

```
python3 -m http.server
```

## Files

```
index.html        app shell
css/style.css
js/shaders.js     all GLSL: LBM-MRT-LES kernel, obstacle rasteriser, reductions, smoke, particles, renderer
js/lbm.js         GPU solver (textures, passes, async readback)
js/body.js        rigid-body dynamics and mounts
js/shapes.js      object library, silhouette → signed distance field (exact EDT), mass properties
js/units.js       fluids, materials, SI ↔ lattice scaling
js/main.js        UI, interaction, instrumentation, main loop
validate.html     cylinder benchmarks
```
