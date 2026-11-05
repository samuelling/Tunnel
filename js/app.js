// TUNNEL — a giant wind tunnel with a fan at the end. Throw things in. Will it blend?
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import RAPIER from '../lib/rapier.mjs';
import { TUN, FAN, RHO, NU, G, PORTAL, beaufort } from './config.js';
import { Air } from './air.js';
import { aeroLoads, makePanels } from './aero.js';
import { Rotor, buildFan, bladeSweep, bladeAngle } from './fan.js';
import { createRenderer, buildScene, buildColliders, toWorld } from './scene.js';
import { DropCollector, packPoints, dropTargets } from './portal.js';
import { CATALOG, buildObject, sanitizeRecipe, recipePrompt, MATERIALS } from './objects.js';
import { shatterMesh, chunkMaterial } from './fracture.js';
import { strengthOf, scaleStrength, BLADE, fmtForce } from './strength.js';
import { buildOutOfOrder } from './outoforder.js';
import { SessionPile, renderPileImage, renderPostcard, postcardNote } from './sharepile.js';
import { PileCam } from './pilecam.js';
import { buildSafetyBoard } from './safetyboard.js';
import { WORKER_URL, WORLD_BUILDER_URL } from './settings.js';
import { stats } from './stats.js';
import { TubeRide, RIDE_SECONDS } from './ride.js';
import { RealAir } from './realair.js';
import { Particles } from './particles.js';
import { Audio } from './audio.js';
import { generateRecipe, generatorAvailable } from './claude.js';
import * as claudeGen from './claude.js';
import { objectKey, looseKey } from './prompt.js';

const $ = (id) => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches;
const MAX_BODIES = isTouch ? 170 : 260;
const DT = 1 / 180;

let hubColliders = [], holeMode = false, holeAnim = null, holeThrottle = 70;
let renderer, scene, rig, portal, camera, controls, world, eventQueue, air, rotor, fan, particles, tunnel, drops, sign, safety;
const absorbing = [];
const audio = new Audio();
const bodies = [];
const byCollider = new Map();
const pending = [];          // deferred breaks this step
let simTime = 0, timeScale = 1, bulletUntil = 0, autoBullet = true, smokeOn = true, shake = 0;
let armed = null;            // recipe currently selected in the tray
let lastRoot = null, camMode = 0;
const recipes = [...CATALOG];
const roots = new Map();

// ------------------------------------------------------------------------------- boot
async function boot() {
  try {
    await RAPIER.init();
  } catch (e) { fail('Physics engine failed to load (' + e.message + ').'); return; }
  renderer = createRenderer($('c'), isTouch);
  ({ scene, rig, tunnel, portal } = buildScene(renderer));
  camera = new THREE.PerspectiveCamera(48, 1, 0.05, 200);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 1; controls.maxDistance = 45;
  setCamera(0, true);

  world = new RAPIER.World({ x: G, y: 0, z: 0 });   // tube frame: gravity points down the axis (+x)
  world.timestep = DT;
  world.integrationParameters.numSolverIterations = 6;
  eventQueue = new RAPIER.EventQueue(true);
  hubColliders = buildColliders(world, RAPIER).hub;
  buildHatch();

  air = new Air();
  rotor = new Rotor();
  fan = buildFan();
  sign = buildOutOfOrder(scene);
  safety = buildSafetyBoard(scene);
  rig.add(fan.group);
  particles = new Particles(rig);
  drops = new DropCollector({
    onJudge: (root) => { verdict(root); root.done = true; },
    onNoFuel: (d, refuel) => { const h = Math.max(1, Math.round(refuel / 3.6e6)); toast(`⛽ The portal is out of fuel. ${d.object.icon} ${d.object.name} is being held in Lost & Found (it refuels in about ${h} h).`); renderPayload(); },
    onSent: (d) => { rideGot(d); reserveForRide(d); showTally(); toast(`🌀 ${d.object.icon} ${d.object.name}: ${d.pieces.length} pieces delivered to World Builder`); if (pileCam && pileCam.running && d.id) pileCam.arrive(d, { local: true }); },
    onParked: (d) => (rideGot(d), showTally(), toast(`🌀 ${d.object.icon} ${d.object.name} went through the portal (World Builder link not set up yet)`)),
    onFail: (d) => (rideGot(d), toast(`🌀 ${d.object.name} went through, but World Builder didn't answer. Kept it for later.`)),
  });

  buildUI();
  showTally();
  resize();
  addEventListener('resize', resize);
  $('loading').hidden = true;
  $('start').hidden = false;
  requestAnimationFrame(loop);
}

function fail(msg) { $('loading').innerHTML = `<div class="err"><b>TUNNEL</b><p>${msg}</p><p>Needs a recent browser with WebGL and WebAssembly.</p></div>`; }

function resize() {
  const w = renderer.domElement.clientWidth || innerWidth, h = renderer.domElement.clientHeight || innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // keep a usable horizontal field of view on portrait phones
  const hfov = 68 * Math.PI / 180;
  camera.fov = Math.min(84, Math.max(48, 2 * Math.atan(Math.tan(hfov / 2) / camera.aspect) * 180 / Math.PI));
  camera.updateProjectionMatrix();
  particles.setScale(renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360)));
}

// ------------------------------------------------------------------------------- cameras
const GX = TUN.groundX, FY = TUN.groundX - TUN.fanX;
const CAMS = [
  { name: 'Overview', pos: [22, 8.5, 12], tgt: [0, 7.4, 0] },
  { name: 'Hopper', pos: [3.4, GX + 5.5, 4.2], tgt: [0, GX - 5, 0] },
  { name: 'Blades', pos: [0.7, FY + 3.6, 1.0], tgt: [0, FY - 0.3, 0] },
  { name: 'Window', pos: [6.2, FY + 1.0, 1.2], tgt: [0, FY + 0.2, 0] },
  { name: 'Portal', pos: [8.2, 2.3, 0.9], tgt: [0, 1.6, 0] },
  { name: 'Follow', follow: true },
];
let camTween = null;
function setCamera(i, instant) {
  camMode = i;
  const c = CAMS[i];
  $('camName') && ($('camName').textContent = c.name);
  if (c.follow) { toast('Follow cam: tracks your last throw'); return; }
  const to = { pos: new THREE.Vector3(...c.pos), tgt: new THREE.Vector3(...c.tgt) };
  if (instant) { camera.position.copy(to.pos); controls.target.copy(to.tgt); controls.update(); return; }
  camTween = { from: { pos: camera.position.clone(), tgt: controls.target.clone() }, to, t: 0 };
}

// ------------------------------------------------------------------------------- bodies
const panelCache = new Map();

function panelsFor(key, parts) {
  if (key && panelCache.has(key)) return panelCache.get(key);
  const tris = [];
  for (const p of parts) {
    if (p.plate) continue;
    let g;
    try { g = new ConvexGeometry(p.points); } catch (e) { continue; }
    const a = g.attributes.position.array;
    for (let i = 0; i < a.length; i++) tris.push(a[i]);
    g.dispose();
  }
  const panels = tris.length ? makePanels(tris) : null;
  if (key) panelCache.set(key, panels);
  return panels;
}

// parts: [{mesh, points:Vector3[] (body frame), mass, volume, plate, round, rest, matKind, color, center}]
function createBody({ recipe, group, parts, pos, quat, vel, angvel, level, root, radius, panelKey, impact }) {
  const mass = parts.reduce((s, p) => s + p.mass, 0);
  const desc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(pos.x, pos.y, pos.z)
    .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
    .setLinvel(vel.x, vel.y, vel.z).setAngvel({ x: angvel.x, y: angvel.y, z: angvel.z })
    .setCcdEnabled(true).setAngularDamping(0.03).setCanSleep(true);
  const body = world.createRigidBody(desc);
  const rec = { body, group, recipe, parts, level, root, mass, radius, born: simTime, cool: 0, volume: 0, plates: null, round: 0, colliders: [] };
  for (const p of parts) {
    let cd = null;
    if (p.round && p.shape === 'sphere' && parts.length <= 4) cd = RAPIER.ColliderDesc.ball(p.round).setTranslation(p.center.x, p.center.y, p.center.z);
    if (!cd) {
      const f = new Float32Array(p.points.length * 3);
      p.points.forEach((v, i) => { f[i * 3] = v.x; f[i * 3 + 1] = v.y; f[i * 3 + 2] = v.z; });
      cd = RAPIER.ColliderDesc.convexHull(f);
    }
    if (!cd) continue;
    cd.setMass(Math.max(1e-4, p.mass)).setFriction(0.6).setRestitution(p.rest ?? 0.3);
    if (impact > 0) cd.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(impact);
    const col = world.createCollider(cd, body);
    byCollider.set(col.handle, rec);
    rec.colliders.push(col.handle);
    rec.volume += p.volume;
    if (p.plate) (rec.plates ||= []).push(p.plate);
    if (p.round && parts.length <= 4) rec.round = Math.max(rec.round, p.round);
  }
  rec.panels = panelsFor(panelKey, parts);
  rec.impact = impact;
  const pi = body.principalInertia();
  rec.Imin = Math.max(1e-9, Math.min(pi.x, pi.y, pi.z));
  rig.add(group);
  group.position.copy(pos); group.quaternion.copy(quat);
  bodies.push(rec);
  root.live.add(rec);
  return rec;
}

function removeBody(rec, reason, keepMesh = false) {
  const i = bodies.indexOf(rec);
  if (i >= 0) bodies.splice(i, 1);
  else { const j = frozen.indexOf(rec); if (j < 0) return; frozen.splice(j, 1); }
  for (const h of rec.colliders) byCollider.delete(h);
  world.removeRigidBody(rec.body);
  if (!keepMesh) {
    rig.remove(rec.group);
    rec.group.traverse(o => { if (o.isMesh && o.userData.ownGeo) o.geometry.dispose(); });
  }
  rec.root.live.delete(rec);
  if (reason === 'exit' || reason === 'portal') rec.root.exitedMax = Math.max(rec.root.exitedMax, rec.mass);
  if (reason === 'dissolve') rec.root.dissolved += rec.mass;
}

function newRoot(recipe) {
  const r = { id: Math.random(), recipe, mass0: 0, live: new Set(), exitedMax: 0, dissolved: 0, firstHit: 0, maxE: 0, rpmDrop: 0, pieces: 0, done: false, thrown: simTime };
  roots.set(r.id, r);
  return r;
}

function spawnRecipe(recipe, pos, vel) {
  if (recipe.id !== 'blade-shard') stats.threw(recipe.name);
  const n = recipe.count || 1;
  const root = newRoot(recipe);
  for (let k = 0; k < n; k++) {
    const built = buildObject(recipe);
    const off = n > 1 ? new THREE.Vector3((Math.random() - 0.5) * 0.12, k * 0.004, (Math.random() - 0.5) * 0.12) : new THREE.Vector3();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3));
    const av = new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
    const v = vel.clone().add(new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(n > 1 ? 1.5 : 0.3));
    createBody({ recipe, group: built.group, parts: built.parts, pos: pos.clone().add(off), quat: q, vel: v, angvel: av, level: 0, root, radius: built.radius, panelKey: recipe.id, impact: recipe.impact || 0 });
    root.mass0 += recipe.mass;
  }
  lastRoot = root;
  trimBodies();
  return root;
}

function trimBodies() {
  while (bodies.length > MAX_BODIES) {
    let idx = bodies.findIndex(b => b.level > 0 && b.group.position.x < TUN.fanX - 3);
    if (idx < 0) idx = bodies.findIndex(b => b.level > 0 && !onHatch(b));   // spare the payload
    if (idx < 0) idx = bodies.findIndex(b => b.level > 0);
    if (idx < 0) idx = 0;
    removeBody(bodies[idx], 'dissolve');
  }
}

// ------------------------------------------------------------------------------- breaking
const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpM = new THREE.Matrix4();

function colorsOf(rec) { return [...new Set(rec.parts.map(p => p.color))].concat(rec.recipe.inner || []); }

function dissolve(rec, vel, energy) {
  const t = rec.body.translation();
  const n = Math.min(160, 8 + Math.round(rec.mass * 900 + Math.sqrt(energy) * 4));
  particles.emit(rec.recipe.spray, t, vel, n, 2 + Math.sqrt(energy / Math.max(rec.mass, 0.01)) * 0.15, colorsOf(rec));
  removeBody(rec, 'dissolve');
}

// Break a body. E: impact energy (J); vNew: post-impact velocity of its centre.
function breakBody(rec, E, vNew, hitPoint, quiet = false) {
  const r = rec.recipe;
  const t = rec.body.translation(), q = rec.body.rotation(), w = rec.body.angvel();
  const pos = new THREE.Vector3(t.x, t.y, t.z), quat = new THREE.Quaternion(q.x, q.y, q.z, q.w);
  const angv = new THREE.Vector3(w.x, w.y, w.z);
  const root = rec.root;
  const spreadV = Math.min(14, 1 + Math.sqrt(0.5 * E / Math.max(rec.mass, 1e-3)));
  // spray
  const sprayN = Math.min(quiet ? 60 : 420, 20 + Math.round(Math.sqrt(E) * (quiet ? 2 : 9) + rec.mass * 60));
  particles.emit(r.spray, hitPoint || pos, vNew, sprayN, spreadV * 0.9, colorsOf(rec));
  if (!quiet) {
    if (r.spray !== 'dust' && !r.pop) particles.emit('dust', pos, vNew, 10, 1.5, colorsOf(rec));
    audio.hit(r.sound, E);
  }
  if (r.pop) { removeBody(rec, 'dissolve'); root.pieces += 0; return; }

  const severity = E / Math.max(physFor(rec).Ebreak, 1e-3);
  const separate = rec.level === 0 && rec.parts.length > 1 && severity < 2.5;
  rig.remove(rec.group);
  const parts = rec.parts;
  if (rec.level > 0) root.pieces = Math.max(0, root.pieces - 1);
  removeBody(rec, 'broken');
  const pieceVel = (cLocal) => {
    const cw = cLocal.clone().applyQuaternion(quat);
    const v = vNew.clone().add(new THREE.Vector3().crossVectors(angv, cw));
    const dir = cw.lengthSq() > 1e-8 ? cw.clone().normalize() : new THREE.Vector3().randomDirection();
    return v.addScaledVector(dir, spreadV * (0.4 + Math.random() * 0.8)).addScaledVector(new THREE.Vector3().randomDirection(), spreadV * 0.3);
  };
  for (const p of parts) {
    const tiny = p.plate || p.volume < 2.5e-5 || p.mass < 0.002;
    if (separate) {
      // the part flies off whole, as its own body
      const g = new THREE.Group();
      const m = p.mesh; m.position.sub(p.center); m.updateMatrix(); g.add(m);
      const pts = p.points.map(v => v.clone().sub(p.center));
      const cw = p.center.clone().applyQuaternion(quat).add(pos);
      const plate = p.plate ? { ...p.plate, c: p.plate.c.clone().sub(p.center) } : null;
      let rad = 0; for (const v of pts) rad = Math.max(rad, v.length());
      createBody({ recipe: r, group: g, parts: [{ ...p, points: pts, center: new THREE.Vector3(), plate }], pos: cw, quat, vel: pieceVel(p.center), angvel: angv.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(8)), level: 1, root, radius: Math.max(rad, 0.01), panelKey: null, impact: 0 });
      root.pieces++;
      continue;
    }
    if (tiny) {
      const cw = p.center.clone().applyQuaternion(quat).add(pos);
      particles.emit(r.spray === 'sparks' ? 'shards' : r.spray, cw, pieceVel(p.center), Math.min(120, 20 + p.mass * 3000), spreadV * 0.6, [p.color, r.inner]);
      if (p.plate) particles.emit(p.matKind === 'paper' ? 'paper' : 'confetti', cw, pieceVel(p.center), 40, spreadV * 0.5, [p.color]);
      root.dissolved += p.mass;
      continue;
    }
    const k = Math.max(3, Math.min(isTouch ? 9 : 13, Math.round(3 + 2.2 * Math.log2(1 + severity) * Math.cbrt(p.volume / 0.001 + 0.2))));
    const chunks = shatterMesh(p.mesh, k, p.color, r.inner);
    const totalV = chunks.reduce((s, c) => s + c.volume, 0) || 1;
    const mat = chunkMaterial(p.matKind);
    for (const ch of chunks) {
      const m = new THREE.Mesh(ch.geo, mat); m.castShadow = ch.size > 0.06; m.userData.ownGeo = true;
      const g = new THREE.Group(); g.add(m);
      const pts = []; for (let i = 0; i < ch.points.length; i += 3) pts.push(new THREE.Vector3(ch.points[i], ch.points[i + 1], ch.points[i + 2]));
      const cmass = p.mass * ch.volume / totalV;
      if (cmass < 5e-4 || ch.size < 0.012) { root.dissolved += cmass; continue; }
      const cw = ch.centroid.clone().applyQuaternion(quat).add(pos);
      const crec = createBody({ recipe: r, group: g, parts: [{ mesh: m, points: pts, mass: cmass, volume: ch.volume, plate: null, round: 0, rest: p.rest, matKind: p.matKind, color: p.color, center: new THREE.Vector3(), shape: 'chunk' }],
        pos: cw, quat, vel: pieceVel(ch.centroid), angvel: new THREE.Vector3().randomDirection().multiplyScalar(5 + Math.random() * 15), level: rec.level + 2, root, radius: ch.size, panelKey: null, impact: 0 });
      root.pieces++;
      // a violent strike minces the pieces too (energy shared by mass, toughness scales ~ size²)
      const share = E * cmass / rec.mass * 0.6;
      const tq = scaleStrength(recipePhys(r), cmass / (root.mass0 / (r.count || 1))).Ebreak;
      if (crec.level < 5 && ch.size > 0.03 && share > 3 * tq) { crec.dead = true; breakBody(crec, share, new THREE.Vector3().copy(crec.body.linvel()), null, true); }
    }
    p.mesh.geometry.dispose?.();
  }
  trimBodies();
}

// ------------------------------------------------------------------------------- physics
const loads = new Float32Array(6), wv = new Float32Array(4);
const fanC = new THREE.Vector3(TUN.fanX, TUN.y0, 0);

function physicsStep(dt) {
  rotor.step(dt);
  air.update(dt, rotor.omega * flowEff());
  world.timestep = dt;

  for (const rec of bodies) {
    const b = rec.body;
    if (b.isSleeping() && air.U < 0.5) continue;
    const t = b.translation(), q = b.rotation(), v = b.linvel(), w = b.angvel();
    aeroLoads(rec, air, t, q, v, w, loads);
    // implicit-ish limiter: an aero impulse may not reverse the relative wind in one step
    air.vel(t.x, t.y, t.z, wv, false);
    const rx = wv[0] - v.x, ry = wv[1] - v.y, rz = wv[2] - v.z;
    const rel = Math.hypot(rx, ry, rz) + 0.5;
    const F = Math.hypot(loads[0], loads[1], loads[2]);
    let s = 1;
    const dv = F * dt / rec.mass;
    if (dv > 0.8 * rel) s = 0.8 * rel / dv;
    let T = Math.hypot(loads[3], loads[4], loads[5]) * dt / rec.Imin;
    let st = 1; if (T > 20) st = 20 / T;
    if (F * s > 1e-7 || T > 0) {
      b.applyImpulse({ x: loads[0] * s * dt, y: loads[1] * s * dt, z: loads[2] * s * dt }, true);
      b.applyTorqueImpulse({ x: loads[3] * st * dt, y: loads[4] * st * dt, z: loads[5] * st * dt }, true);
    }
  }

  // the portal's pull: below the tube, things are drawn towards the axis and spun round it
  for (const rec of bodies) {
    const t = rec.body.translation();
    if (t.x < TUN.L) continue;
    const r = Math.hypot(t.y, t.z) + 1e-6, s = Math.min(1, (t.x - TUN.L) / (TUN.groundX - TUN.L));
    if (r > PORTAL.R * 2.2) continue;
    const a = (3 + 6 * s) * Math.min(1, r / 0.8), sw = 4 * s;
    const m = rec.mass * dt;
    rec.body.applyImpulse({ x: 2 * s * m, y: (-a * t.y / r - sw * t.z / r) * m, z: (-a * t.z / r + sw * t.y / r) * m }, true);
  }

  stepExtraction();
  world.step(eventQueue);

  eventQueue.drainContactForceEvents(ev => {
    const f = ev.totalForceMagnitude();
    for (const h of [ev.collider1(), ev.collider2()]) {
      const rec = byCollider.get(h);
      if (rec && rec.level === 0 && rec.impact > 0 && f > rec.impact && !rec.dead) { rec.dead = true; pending.push({ rec, E: physFor(rec).Ebreak * 1.5, kind: 'impact' }); }
    }
  });

  // blade strikes
  const th0 = rotor.prevTheta, th1 = rotor.theta;
  if (!holeMode && Math.abs(rotor.omega) > 0.2) {
    for (const rec of bodies) {
      if (rec.dead || simTime < rec.cool) continue;
      const t = rec.body.translation();
      const p = new THREE.Vector3(t.x - fanC.x, t.y - fanC.y, t.z - fanC.z);
      const hit = bladeSweep(p, rec.radius, th0, th1);
      if (!hit) continue;
      strike(rec, hit, t);
    }
  }
  checkStall(dt);
  for (const pnd of pending.splice(0)) {
    if (!bodies.includes(pnd.rec)) continue;
    const v = pnd.rec.body.linvel();
    hitRoot(pnd.rec.root, pnd.E, 0);
    breakBody(pnd.rec, pnd.E, new THREE.Vector3(v.x, v.y * 0.3, v.z), null);
  }
  simTime += dt;
}

function strike(rec, hit, t) {
  // The blade's leading edge sweeps through at ω·r. The strike speed is the edge speed relative
  // to the object along the direction of travel; the object is batted along the travel direction
  // and off the pitched face (normal = cosβ·x̂ + sinβ·t̂), which also flings it downstream.
  const cph = Math.cos(hit.phi), sph = Math.sin(hit.phi);
  const sg = Math.sign(rotor.omega) || 1;
  const tv = new THREE.Vector3(0, -sph * sg, cph * sg);              // blade direction of travel
  const beta = bladeAngle(hit.r);
  const face = new THREE.Vector3(Math.cos(beta), 0, 0).addScaledVector(tv, Math.sin(beta));
  const v = rec.body.linvel();
  const vo = new THREE.Vector3(v.x, v.y, v.z);
  const vt = Math.abs(rotor.omega) * hit.r - vo.dot(tv);
  rec.cool = simTime + Math.max(0.03, 0.6 * (2 * Math.PI / FAN.blades) / Math.max(1, Math.abs(rotor.omega)));
  if (vt < 0.5) return;
  const nc = tv.clone().multiplyScalar(0.55).addScaledVector(face, 0.85).normalize();
  const lever = nc.dot(tv) * hit.r;
  const meff = 1 / (1 / rec.mass + hit.r * hit.r / FAN.I);
  const J = (1 + FAN.restitution) * meff * vt;
  const E = 0.5 * meff * vt * vt;
  const vb = tv.clone().multiplyScalar(Math.abs(rotor.omega) * hit.r);
  const w0 = rotor.omega;
  rotor.omega -= sg * J * lever / FAN.I;
  const root = rec.root;
  root.rpmDrop = Math.max(root.rpmDrop, (w0 - rotor.omega) * 60 / (2 * Math.PI));
  hitRoot(root, E, w0);
  const contact = new THREE.Vector3(TUN.fanX, TUN.y0 + cph * hit.r, sph * hit.r);
  const r = rec.recipe;
  const vNew = vo.clone().addScaledVector(nc, J / rec.mass);
  const metal = r.unbreakable || r.spray === 'sparks' || rec.parts.some(p => p.matKind === 'metal' || p.matKind === 'chrome');
  if (metal) { particles.emit('sparks', contact, vb.clone().multiplyScalar(0.3), Math.min(160, 20 + E / 20), 6 + Math.sqrt(E) * 0.1); audio.sparks(); }
  audio.chop(E);
  if (E > 400) shake = Math.min(1, shake + Math.log10(E) / 8);
  if (!r.unbreakable && (rec.level > 0 && (rec.radius < 0.035 || rec.mass < 0.003 * root.mass0))) { dissolve(rec, vNew, E); return; }
  // object vs blade: peak force is the impulse over the contact time, capped by what the
  // object can push back with before it gives way
  const ph = physFor(rec);
  const Fimp = (1 + FAN.restitution) * meff * vt * vt / ph.d;
  const F = Math.min(Fimp, ph.Fneed);
  root.maxF = Math.max(root.maxF || 0, F);
  const k = bladeIndex(hit.phi);
  const cuttable = ph.Fneed <= bladeFu(k);
  bladeLoad(k, F, contact, rec);
  if (!r.unbreakable && cuttable && E > ph.Ebreak) { rec.dead = true; breakBody(rec, E, vNew, contact); return; }
  if (!cuttable && F > BLADE.Fy * 0.5) {
    particles.emit('sparks', contact, vb.clone().multiplyScalar(0.2), Math.min(200, 40 + F / 4000), 8);
    audio.hit('clang', Math.max(E, 2e4));
    root.beatBlade = true;
  }
  // bounce: apply the strike impulse at the blade side of the body
  const pt = new THREE.Vector3(t.x, t.y, t.z).addScaledVector(nc, -rec.radius * 0.6);
  rec.body.applyImpulseAtPoint({ x: nc.x * J, y: nc.y * J, z: nc.z * J }, { x: pt.x, y: pt.y, z: pt.z }, true);
  if (r.unbreakable) audio.hit(r.sound, E);
}

function hitRoot(root, E, w0) {
  root.maxE = Math.max(root.maxE, E);
  if (!root.firstHit) { root.firstHit = simTime; root.rpm0 = Math.abs(w0) * 60 / (2 * Math.PI); }
}

// ------------------------------------------------------------------------------- blade damage, jams, repairs
// Per-blade damage d: 0 straight, 0–1 progressively bent (yield load drops as it bends), ≥1 bent
// into the housing, ≥1.5 snapped. Any blade at ≥1, or the rotor stalled against something it
// can't cut, jams the fan: the breaker trips and it stays out of order until repaired.
const bladeDmg = new Float32Array(FAN.blades);
let jam = null, jamPrevThrottle = 0, repairing = false, stallT = 0, lastDmgToast = 0;
const extracting = [];
const lifetimeBill = () => +(localStorage.getItem('shredBill') || 0);

function bladeIndex(phi) {
  const s = 2 * Math.PI / FAN.blades;
  return ((Math.round((phi - rotor.theta) / s) % FAN.blades) + FAN.blades) % FAN.blades;
}
const bladeFy = (k) => BLADE.Fy * (1 - 0.5 * Math.min(1, bladeDmg[k]));
const bladeFu = (k) => BLADE.Fu * (1 - 0.35 * Math.min(1, bladeDmg[k]));
function flowEff() { let s = 0; for (const d of bladeDmg) s += Math.min(1, d); return 1 - 0.6 * s / FAN.blades; }
function imbalance() {
  let x = 0, y = 0;
  for (let k = 0; k < FAN.blades; k++) { const a = k * 2 * Math.PI / FAN.blades, d = Math.min(1.5, bladeDmg[k]); x += d * Math.cos(a); y += d * Math.sin(a); }
  return Math.hypot(x, y) / 1.5;
}
const bladeShard = { id: 'blade-shard', name: 'Fan blade (snapped)', icon: '🗡️', mass: 14, spray: 'sparks', sound: 'clang', inner: '#9aa0a8',
  blend: 'The blade has been recycled.', survive: 'A souvenir.', parts: [{ shape: 'box', size: [0.05, 1.05, 0.34], color: '#d9dde2', material: 'metal' }] };

function bladeLoad(k, F, contact, rec) {
  const fy = bladeFy(k), fu = bladeFu(k);
  if (F <= fy || jam) return;
  const before = bladeDmg[k];
  if (F >= fu) bladeDmg[k] = Math.max(bladeDmg[k], 1.5);
  else bladeDmg[k] = Math.min(1.49, bladeDmg[k] + (F - fy) / (BLADE.Fu - BLADE.Fy));
  fan.setBladeDamage(k, bladeDmg[k]);
  particles.emit('sparks', contact, { x: 0, y: 0, z: 0 }, 120, 12);
  audio.hit('clang', 4e5); shake = 1;
  const name = rec.recipe.name.toLowerCase();
  if (bladeDmg[k] >= 1.5) {
    toast(`💥 The ${name} snapped blade ${k + 1} clean off`);
    const sg = Math.sign(rotor.omega) || 1, a = Math.atan2(contact.z, contact.y);
    spawnRecipe(bladeShard, new THREE.Vector3(TUN.fanX - 0.4, Math.cos(a) * 1.5, Math.sin(a) * 1.5), new THREE.Vector3(-3, -Math.sin(a) * sg * 9, Math.cos(a) * sg * 9));
  } else if (bladeDmg[k] >= 1) toast(`Blade ${k + 1} bent into the housing`);
  else if (bladeDmg[k] - before > 0.06 && simTime - lastDmgToast > 0.6) { toast(`⚠ The ${name} bent blade ${k + 1} (${Math.round(bladeDmg[k] * 100)}%)`); lastDmgToast = simTime; }
  if (bladeDmg[k] >= 1) jamFan(bladeDmg[k] >= 1.5 ? 'snapped' : 'bent', rec, k);
  updateDamageUI();
}

function checkStall(dt) {
  if (jam || repairing || rotor.setpoint === 0) { stallT = 0; return; }
  const target = Math.abs(rotor.setpoint * FAN.omegaMax);
  let lodged = null;
  if (Math.abs(rotor.omega) < 0.25 * target) {
    for (const b of bodies) {
      if (b.dead || b.radius < 0.2) continue;
      const x = b.body.translation().x;
      if (Math.abs(x - TUN.fanX) < FAN.zone + b.radius + 0.35 && (!lodged || b.mass > lodged.mass)) lodged = b;
    }
  }
  stallT = lodged ? stallT + dt : Math.max(0, stallT - 2 * dt);
  if (lodged && stallT > 1.6) jamFan('wedged', lodged, -1);
}

function jamFan(reason, rec, k) {
  if (jam) return;
  stats.count('jams');
  jam = { reason, rec, k, name: rec ? rec.recipe.name : 'something' };
  rotor.locked = true;
  const thr = $('throttle');
  jamPrevThrottle = +thr.value || jamPrevThrottle;
  thr.value = 0; thr.oninput(); thr.disabled = true;
  audio.hit('clang', 8e5); audio.hit('thunk', 5e5); shake = 1;
  setTimeout(() => { sign.show(); audio.hit('clang', 3e4); }, 450);
  const knewJam = quota ? Date.now() - (quota.lastJam || 0) < 10 * 60000 : false;   // the board already says "0 days"
  if (quota) quota.lastJam = Date.now();
  safety?.update(quota, { jammed: true });
  if (!knewJam) try { const u = mailboxUrl().replace(/\/drops$/, ''); if (u) fetch(u + '/jam', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ by: jam.name }) }).catch(() => {}); } catch (e) { /* offline */ }
  const root = rec && rec.root;
  if (root && rec.recipe.id !== 'blade-shard') {
    const r = root.recipe;
    root.verdictHead = 'IT JAMMED THE FAN'; root.verdictQuip = r.survive; root.done = true;
    logItem(root, 'IT JAMMED THE FAN');
    showVerdict(r, 'IT JAMMED THE FAN', r.survive, `peak load ${fmtForce(root.maxF || 0)} · blades bend at ${fmtForce(BLADE.Fy)}`);
  }
  updateDamageUI();
}

function updateDamageUI() {
  const el = $('damage');
  let worst = 0, n = 0; for (const d of bladeDmg) { worst = Math.max(worst, d); if (d > 0.02) n++; }
  if (repairing) return;
  if (!jam && n === 0) { el.hidden = true; return; }
  el.hidden = false;
  el.className = jam ? 'jam' : '';
  const why = !jam ? '' : jam.reason === 'snapped' ? `The ${jam.name.toLowerCase()} snapped blade ${jam.k + 1} off.`
    : jam.reason === 'bent' ? `The ${jam.name.toLowerCase()} bent blade ${jam.k + 1} into the housing.`
    : `A ${jam.name.toLowerCase()} is wedged in the rotor. The motor tripped.`;
  el.innerHTML = jam
    ? `<div class="msg"><b>⚠ FAN JAMMED</b><span>${escapeHtml(why)}</span></div><button id="btnRepair">🔧 Repair</button>`
    : `<div class="msg"><b>${n} blade${n > 1 ? 's' : ''} bent</b><span>airflow −${Math.round((1 - flowEff()) * 100)}% · it'll wobble</span></div><button id="btnRepair">🔧 Repair</button>`;
  $('btnRepair').onclick = repairFan;
}

function stepExtraction() {
  for (let i = extracting.length - 1; i >= 0; i--) {
    const e = extracting[i];
    if (!bodies.includes(e.rec)) { extracting.splice(i, 1); continue; }
    const k = Math.min(1, (performance.now() - e.t0) / e.ms), q = k * k * (3 - 2 * k);
    const p = e.from.clone().lerp(e.to, q);
    e.rec.body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
    e.rec.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    if (k >= 1) {
      for (const h of e.rec.colliders) world.getCollider(h)?.setSensor(false);
      e.rec.body.setGravityScale(1, true); e.rec.body.setLinvel({ x: 3, y: 0, z: 0 }, true);
      extracting.splice(i, 1);
    }
  }
}

function repairStep(text, ms, tick) {
  $('damage').innerHTML = `<div class="msg"><b>🔧 REPAIRING</b><span>${escapeHtml(text)}</span></div><div class="bar"><i></i></div>`;
  const bar = $('damage').querySelector('.bar i');
  return new Promise(res => {
    const t0 = performance.now();
    const f = () => { const k = Math.min(1, (performance.now() - t0) / ms); bar.style.width = (k * 100) + '%'; tick?.(k); if (k < 1) requestAnimationFrame(f); else res(); };
    f();
  });
}

async function repairFan() {
  if (repairing) return;
  repairing = true;
  stats.count('repairs');
  const thr = $('throttle');
  const prev = jam ? jamPrevThrottle : +thr.value;
  rotor.locked = true; thr.value = 0; thr.oninput(); thr.disabled = true;
  $('damage').hidden = false; $('damage').className = 'fix';
  const bill = [];
  if (camMode !== 3) setCamera(3);
  await repairStep('Lockout–tagout: isolating the motor', 900, (k) => { if (k === 1) audio.hit('thunk', 3e3); });
  // anything big still in the fan zone gets craned out and dropped through the portal
  const lodged = bodies.filter(b => !b.dead && b.radius > 0.15 && b.body.translation().x > TUN.fanX - 2.5 - b.radius && b.body.translation().x < TUN.L + 0.4);
  if (lodged.length) {
    for (const rec of lodged) {
      const t = rec.body.translation(), rr = Math.hypot(t.y, t.z) || 1, rc = Math.min(1.7, Math.max(1.1, rr));
      for (const h of rec.colliders) world.getCollider(h)?.setSensor(true);
      rec.body.setGravityScale(0, true);
      extracting.push({ rec, t0: performance.now(), ms: 1700, from: new THREE.Vector3(t.x, t.y, t.z), to: new THREE.Vector3(TUN.L + 0.25, t.y / rr * rc, t.z / rr * rc) });
    }
    const big = lodged.reduce((a, b) => (b.mass > a.mass ? b : a));
    bill.push(950);
    await repairStep(`Craning out the ${big.recipe.name.toLowerCase()} (into the Portal Chute it goes)`, 1800, (k) => { if (Math.random() < 0.05) audio.hit('thunk', 800); });
  }
  for (let k = 0; k < FAN.blades; k++) {
    const d0 = bladeDmg[k];
    if (d0 < 0.02) continue;
    const replace = d0 >= 1;
    let last = 0;
    await repairStep(replace ? `Fitting a new blade ${k + 1}` : `Hammering blade ${k + 1} straight`, replace ? 1400 : 900, (q) => {
      bladeDmg[k] = d0 * (1 - q); fan.setBladeDamage(k, bladeDmg[k] < 1.5 && d0 >= 1.5 && q < 0.5 ? 1.5 : bladeDmg[k]);
      if (performance.now() - last > (replace ? 300 : 180)) {
        last = performance.now();
        audio.hit('clang', 2e4);
        const a = rotor.theta + k * 2 * Math.PI / FAN.blades;
        particles.emit('sparks', { x: TUN.fanX, y: Math.cos(a) * 1.6, z: Math.sin(a) * 1.6 }, { x: 0, y: 0, z: 0 }, 30, 4);
      }
    });
    bladeDmg[k] = 0; fan.setBladeDamage(k, 0);
    bill.push(replace ? 14500 : Math.round(400 + 2600 * d0));
  }
  await repairStep('Resetting the breaker', 700, (k) => { if (k === 1) audio.hit('zap', 2e3); });
  jam = null; rotor.locked = false; thr.disabled = false; stallT = 0;
  sign.hide();
  safety?.update(quota, { jammed: false });
  const total = bill.reduce((a, b) => a + b, 0) + 250;     // + call-out fee
  const life = lifetimeBill() + total;
  try { localStorage.setItem('shredBill', String(life)); } catch {}
  repairing = false;
  updateDamageUI();
  toast(`✅ Back in service · repair bill $${total.toLocaleString()} (lifetime $${life.toLocaleString()})`);
  if (prev) { thr.value = prev; thr.oninput(); }
  // back to the Overview once the fan is spinning again
  setTimeout(() => { if (!jam && !repairing && camMode !== 0) setCamera(0); }, 900);
}

// verdicts, a little after the first blade strike
function checkVerdicts() {
  for (const root of roots.values()) {
    if (root.done) continue;
    const age = simTime - root.firstHit;
    if (root.firstHit && age > (root.recipe.unbreakable ? 0.4 : 1.1)) { verdict(root); root.done = true; continue; }
    if (!root.firstHit && root.live.size === 0) {
      root.done = true;
      if (root.exitedMax > 0) showVerdict(root.recipe, 'SLIPPED THROUGH', 'Threaded between the blades. Statistically rude.', '');
    }
    if (!root.firstHit && simTime - root.thrown > 120) root.done = true;
  }
  for (const [id, root] of roots) if (root.done && root.live.size === 0) roots.delete(id);
}

let tally = (() => { try { return JSON.parse(localStorage.getItem('shredTally')) || { kg: 0, n: 0, pieces: 0 }; } catch (e) { return { kg: 0, n: 0, pieces: 0 }; } })();
function addTally(root, score, pieces) {
  if (score < 0.4) return;
  tally.kg += root.mass0 * score; tally.n++; tally.pieces += pieces;
  try { localStorage.setItem('shredTally', JSON.stringify(tally)); } catch (e) {}
  showTally();
}
function showTally() { const el = $('tally'); if (el) el.textContent = (drops && drops.sentPieces ? `🌀 ${drops.sentPieces.toLocaleString()} pieces through the portal · ` : '') + (tally.n ? `Shredded so far: ${tally.n} things · ${tally.kg < 1 ? Math.round(tally.kg * 1000) + ' g' : tally.kg.toFixed(1) + ' kg'} · ${tally.pieces.toLocaleString()} pieces` : ''); }

function verdict(root) {
  let largest = root.exitedMax;
  let n = 0;
  for (const rec of root.live) { largest = Math.max(largest, rec.mass); n++; }
  const per = root.mass0 / (root.recipe.count || 1);
  const score = 1 - largest / per;
  const r = root.recipe;
  let head, quip;
  if (r.unbreakable || score < 0.4) { head = 'IT DID NOT BLEND'; quip = r.survive; }
  else if (score < 0.8) { head = 'PARTIALLY BLENDED'; quip = 'Chunky. Like a bad smoothie.'; }
  else { head = 'IT BLENDS!'; quip = r.blend; }
  const parts = [];
  parts.push(`${Math.max(n, root.pieces)} pieces`);
  if (largest > 0 && score > 0.05) parts.push(`biggest ${fmtMass(largest)}`);
  parts.push(`hit ${fmtE(root.maxE)}`);
  if (root.rpmDrop > 1) parts.push(`fan −${Math.round(root.rpmDrop)} rpm`);
  root.verdictHead = head; root.verdictQuip = quip;
  stats.count(head === 'IT BLENDS!' ? 'shredded' : head === 'PARTIALLY BLENDED' ? 'partial' : 'survived');
  logItem(root, head);
  showVerdict(r, head, quip, parts.join(' · '));
  if (!r.unbreakable) addTally(root, score, Math.max(n, root.pieces));
}

const fmtMass = (m) => m >= 1 ? `${m.toFixed(1)} kg` : `${Math.round(m * 1000)} g`;
const fmtE = (e) => e >= 1000 ? `${(e / 1000).toFixed(1)} kJ` : `${e.toFixed(e < 10 ? 1 : 0)} J`;

// ------------------------------------------------------------------------------- portal
let lastWhoosh = 0;
function absorb(rec) {
  if (rec.dead) return;
  rec.dead = true;
  const t = rec.body.translation(), v = rec.body.linvel(), q = rec.body.rotation();
  const root = rec.root;
  const tmpQ = new THREE.Quaternion(q.x, q.y, q.z, q.w);
  // world orientation = rig rotation ∘ body orientation
  const wq = rig.quaternion.clone().multiply(tmpQ);
  const pieces = rec.parts.map(p => {
    const off = p.center.clone().applyQuaternion(wq);
    return { c: p.color || '#999999', i: rec.recipe.inner || p.color || '#999999', m: +p.mass.toFixed(4),
      p: packPoints(p.points.map(v3 => v3.clone().sub(p.center))),
      o: [+off.x.toFixed(3), +off.y.toFixed(3), +off.z.toFixed(3)],
      v: [+(v.y).toFixed(2), +(-v.x).toFixed(2), +(v.z).toFixed(2)], q: [wq.x, wq.y, wq.z, wq.w].map(x => +x.toFixed(4)) };
  });
  drops.add(root, pieces);
  const gid = ++pileGroup;   // parts of one rigid body stay together in the heap
  pile.addPieces(pieces.map((pc, j) => ({ c: pc.c, p: pc.p, k: rec.parts[j].matKind, g: gid, o: pc.o, q: pc.q })));
  removeBody(rec, 'portal', true);
  absorbing.push({ group: rec.group, t: 0, x0: t.x, r0: Math.hypot(t.y, t.z), a0: Math.atan2(t.z, t.y), spinAxis: new THREE.Vector3().randomDirection() });
  portal.flash(Math.min(0.6, 0.08 + rec.mass * 0.05));
  if (performance.now() - lastWhoosh > 180) { audio.whoosh(rec.mass); lastWhoosh = performance.now(); }
}

// ------------------------------------------------------------------------------- share the pile
let shareURL = null;
async function openShare() {
  stats.count('shares');
  const box = $('shareBox');
  box.hidden = false;
  $('shareImg').hidden = true; $('shareActs').hidden = true; $('pcFlip').hidden = true;
  $('shareMsg').textContent = pile.items.length ? 'Printing your postcard…' : 'Nothing shredded yet this session. Throw something in first!';
  if (!pile.items.length) return;
  try { $('pcTo').value = localStorage.getItem('pcTo') || ''; } catch (e) { /* ignore */ }
  $('pcNote').placeholder = postcardNote(pile);
  $('shareActs').hidden = false;
  await printPostcard();
  let t = 0;
  const again = () => { clearTimeout(t); t = setTimeout(printPostcard, 450); };
  $('pcTo').oninput = () => { try { localStorage.setItem('pcTo', $('pcTo').value); } catch (e) { /* ignore */ } again(); };
  $('pcNote').oninput = again;
  $('pcFlip').onclick = () => {
    const card = $('pcCard'); card.classList.add('turning');
    setTimeout(() => { postcard.side = postcard.side === 'front' ? 'back' : 'front'; $('shareImg').src = postcard.urls[postcard.side]; card.classList.remove('turning'); }, 330);
  };
}
// both sides of the card, and how to send them (as pictures: Messages and Mail attach them)
const postcard = { side: 'front', urls: {}, files: [] };
async function printPostcard() {
  const site = /github\.io/.test(location.host) ? location.origin + location.pathname : 'samuelling.github.io/Tunnel';
  let pc;
  try { pc = await renderPostcard(pile, { url: site.replace(/^https?:\/\//, ''), to: $('pcTo').value.trim(), note: $('pcNote').value.trim(), bill: lifetimeBill() }); }
  catch (e) { console.error(e); $('shareMsg').textContent = 'The printing press jammed too. Try again?'; return; }
  for (const u of Object.values(postcard.urls)) URL.revokeObjectURL(u);
  postcard.urls = { front: URL.createObjectURL(pc.front), back: URL.createObjectURL(pc.back) };
  postcard.files = [new File([pc.front], 'shred-hole-postcard.png', { type: 'image/png' }), new File([pc.back], 'shred-hole-postcard-back.png', { type: 'image/png' })];
  $('shareImg').src = postcard.urls[postcard.side]; $('shareImg').hidden = false; $('pcFlip').hidden = false;
  const to = $('pcTo').value.trim();
  const shredUrl = 'https://samuelling.github.io/Tunnel/', zineUrl = 'https://megazine.org';
  const text = `${to ? to + ', a' : 'A'} postcard from the Shred Hole ✉️\nShred your own: ${shredUrl}\nMore weird stuff from megaZINE: ${zineUrl}`;
  $('shareMsg').textContent = 'Tap ✉️ Send postcard to pick Messages, Mail or anything else. Both sides go as pictures.';
  const canFiles = !!(navigator.canShare && navigator.canShare({ files: postcard.files }));
  const canFront = !canFiles && !!(navigator.canShare && navigator.canShare({ files: postcard.files.slice(0, 1) }));
  $('shareGo').hidden = !(canFiles || canFront);
  $('shareGo').onclick = async () => {
    // the card is what's shared; the line of text rides along as its caption
    try { await navigator.share({ files: canFiles ? postcard.files : postcard.files.slice(0, 1), text }); }
    catch (e) { if (e.name !== 'AbortError') toast('Sharing is blocked here. Save the postcard instead.'); }
  };
  const save = $('shareSave'); save.href = postcard.urls.front; save.download = 'shred-hole-postcard.png';
  save.onclick = () => { setTimeout(() => { const a = document.createElement('a'); a.href = postcard.urls.back; a.download = 'shred-hole-postcard-back.png'; a.click(); }, 400); };
  $('shareMail').href = `mailto:?subject=${encodeURIComponent('A postcard from the Shred Hole')}&body=${encodeURIComponent(text + '\n\n(Save the postcard from the Shred Hole and attach both sides: an email link can\'t carry pictures.)')}`;
  if (!$('shareGo').hidden) $('shareMsg').textContent = 'Tap ✉️ Send postcard to pick Messages, Mail or anything else. Both sides go as pictures.';
  else $('shareMsg').textContent = 'This browser can\'t hand pictures to Messages or Mail directly: Save postcard, then attach both sides.';
}

// ------------------------------------------------------------------------------- payload hatch
// Trapdoors above the portal. Debris collects on them as a payload; opening the hatch drops the
// lot through the portal, and it goes to World Builder as one delivery: one request and one
// write at the relay instead of one per object. It opens itself when full, after a long quiet
// spell, or as you leave the page, so nothing gets stranded.
const HATCH = { x: TUN.L + 1.45, R: 2.8, thick: 0.06, lip: 0.38 };
const PAYLOAD_FULL = { pieces: 400 };   // a payload's piece budget
// pieces that come to rest in the tray are frozen into static bodies: they still stack and
// collide, but cost the simulation almost nothing and don't count against MAX_BODIES
const frozen = [];
let hatchColliders = [], hatchDoors = [], hatchState = 'closed', hatchT = 0, hatchQuiet = 0, payloadStat = { n: 0, pieces: 0, kg: 0, roots: new Set() }, lastPayloadCount = 0;
// a round tray with a lip, just inside the portal's rim, so anything that does slide off still
// falls through; two half-disc trapdoors hinged at the rim
function buildHatch() {
  const R = HATCH.R;
  const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  hatchColliders.push(world.createCollider(RAPIER.ColliderDesc.cylinder(HATCH.thick, R).setTranslation(HATCH.x, 0, 0).setRotation({ x: qz.x, y: qz.y, z: qz.z, w: qz.w }).setFriction(0.8).setRestitution(0.1), fixed));
  const N = 18;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
    hatchColliders.push(world.createCollider(RAPIER.ColliderDesc.cuboid(HATCH.lip / 2, 0.04, (R + 0.06) * Math.PI / N * 1.15)
      .setTranslation(HATCH.x - HATCH.thick - HATCH.lip / 2, (R + 0.04) * Math.cos(a), (R + 0.04) * Math.sin(a)).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setFriction(0.6), fixed));
  }
  // the Portal Chute: dark steel doors with the portal's swirl and a stencil, a glowing violet rim
  const tex = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 512; const c = cv.getContext('2d');
    c.fillStyle = '#17121f'; c.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 14; i++) {
      c.strokeStyle = i % 2 ? 'rgba(64,224,255,0.35)' : 'rgba(155,77,255,0.5)'; c.lineWidth = 10 - i * 0.5;
      c.beginPath(); for (let a = 0; a < 6.3; a += 0.05) { const r = 18 + a * 34 + i * 5; const x = 256 + Math.cos(a + i * 0.45) * r, y = 256 + Math.sin(a + i * 0.45) * r; a ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke();
    }
    c.fillStyle = 'rgba(233,216,255,0.85)'; c.font = '900 46px Impact, "Arial Black", sans-serif'; c.textAlign = 'center';
    c.fillText('PORTAL CHUTE', 256, 120); c.font = '700 22px "Arial Black", sans-serif'; c.fillText('KEEP CLEAR · FLUSHES WITHOUT WARNING', 256, 410);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.5, emissive: new THREE.Color('#2b0a4a'), emissiveIntensity: 0.5 });
  const steel = new THREE.MeshStandardMaterial({ color: '#2b2238', roughness: 0.4, metalness: 0.8, side: THREE.DoubleSide, emissive: new THREE.Color('#9b4dff'), emissiveIntensity: 0.35 });
  const g = new THREE.Group(); rig.add(g);
  for (const side of [1, -1]) {
    // half-disc whose straight edge lies on y = 0, rotated so its face normal is the tube axis
    const geo = new THREE.CylinderGeometry(R, R, HATCH.thick * 2, 40, 1, false, side > 0 ? 0 : Math.PI, Math.PI).rotateZ(Math.PI / 2);
    geo.translate(0, -side * R, 0);            // hinge line (y = ±R) at the pivot's origin
    const pivot = new THREE.Group(); pivot.position.set(HATCH.x, side * R, 0);
    const door = new THREE.Mesh(geo, mat); door.castShadow = door.receiveShadow = true;
    pivot.add(door); g.add(pivot); hatchDoors.push({ pivot, side });
  }
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.06, R + 0.06, HATCH.lip, 48, 1, true).rotateZ(Math.PI / 2), steel);
  rim.position.x = HATCH.x - HATCH.thick - HATCH.lip / 2; g.add(rim);
  const lipRing = new THREE.Mesh(new THREE.TorusGeometry(R + 0.06, 0.06, 8, 64).rotateY(Math.PI / 2), steel);
  lipRing.position.x = HATCH.x - HATCH.thick - HATCH.lip; g.add(lipRing);
  const legLen = TUN.groundX - HATCH.x;
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(legLen, 0.1, 0.1), steel);
    leg.position.set(HATCH.x + legLen / 2, (R + 0.06) * Math.cos(a), (R + 0.06) * Math.sin(a)); leg.castShadow = true; g.add(leg);
  }
}
function freezeOnHatch(rec) {
  const i = bodies.indexOf(rec); if (i < 0) return;
  bodies.splice(i, 1); frozen.push(rec);
  rec.body.setBodyType(RAPIER.RigidBodyType.Fixed, false);
}
function thawHatch() {
  for (const rec of frozen.splice(0)) {
    rec.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    rec.body.setLinvel({ x: 1, y: 0, z: 0 }, true);
    rec.rest = 0; bodies.push(rec);
  }
}
function onHatch(rec) {
  const t = rec.body.translation();
  return t.x > TUN.L + 0.2 && t.x < HATCH.x + 0.1 && Math.hypot(t.y, t.z) < HATCH.R + 0.3;
}
function setDoors(k) { for (const d of hatchDoors) d.pivot.rotation.z = d.side * k * 1.45; }
function openPayloadHatch(why) {
  if (hatchState !== 'closed') return;
  if (why === 'lever') { const l = $('plLever'); l.classList.add('pulled'); setTimeout(() => l.classList.remove('pulled'), 520); }
  if (!payloadStat.n && why === 'lever') { audio.hit('thunk', 3000); toast('The Portal Chute is empty. Shred something first.'); return; }
  audio.start(); audio.hit('clang', 1.5e4); setTimeout(() => audio.whoosh(40), 250);
  hatchState = 'opening'; hatchT = 0;
  stats.count('flushes');
  if (why === 'lever' && rideOn()) startRide();
  drops.hold = true;
  // flip mode: get Pile Cam going now (so the payload is caught as it's sent), slide over once the doors are open
  if (!ride && flipping() && !onPile) { if ($('paneSrc').value !== 'live') pileCam?.start(); setTimeout(() => showPile(true), 1300); }
  for (const c of hatchColliders) c.setEnabled(false);
  thawHatch();
  for (const b of bodies) if (onHatch(b)) b.body.wakeUp();
  portal.flash(0.6);
  if (why === 'full') toast('🌀 PORTAL CHUTE FULL! Flushing it to World Builder');
  else if (why === 'idle') toast('🌀 The Portal Chute got bored and flushed itself');
  else toast(`🌀 FLUSH! ${payloadStat.n} thing${payloadStat.n === 1 ? '' : 's'} down the Portal Chute to World Builder`);
}
let hatchClock = 0;
function hatchTick() {
  if (!hatchColliders.length) return;
  const nowMs = performance.now(), dt = hatchClock ? Math.min(0.25, (nowMs - hatchClock) / 1000) : 0; hatchClock = nowMs;
  // what's on the hatch right now
  const roots = new Set(); let pieces = 0, kg = 0;
  for (const b of [...bodies]) {
    if (!onHatch(b)) { b.rest = 0; continue; }
    roots.add(b.root); pieces++; kg += b.mass;
    if (hatchState !== 'closed') continue;
    const v = b.body.linvel(), w = b.body.angvel();
    b.rest = (v.x * v.x + v.y * v.y + v.z * v.z < 0.04 && w.x * w.x + w.y * w.y + w.z * w.z < 0.5) ? (b.rest || 0) + dt : 0;
    if (b.rest > 0.4) freezeOnHatch(b);
  }
  for (const b of frozen) { roots.add(b.root); pieces++; kg += b.mass; }
  payloadStat = { n: roots.size, pieces, kg, roots };
  if (hatchState === 'closed') {
    drops.hold = true;
    hatchQuiet = roots.size === lastPayloadCount ? hatchQuiet + dt : 0;
    lastPayloadCount = roots.size;
    if (pieces >= PAYLOAD_FULL.pieces) openPayloadHatch('full');
    else if (roots.size && hatchQuiet > 120) openPayloadHatch('idle');
  } else if (hatchState === 'opening') {
    hatchT += dt; setDoors(Math.min(1, hatchT / 0.45));
    if (hatchT > 0.45) { hatchState = 'open'; hatchT = 0; }
  } else if (hatchState === 'open') {
    hatchT += dt;
    const falling = bodies.some(b => { const t = b.body.translation(); return t.x > TUN.L + 0.2 && Math.hypot(t.y, t.z) < PORTAL.R * 1.3; });
    if ((!falling && hatchT > 1.2) || hatchT > 6) {
      drops.finalizeAll();
      const d = drops.flushPayload();
      if (d && d.payload) toast(`🌀 Delivered: ${d.objects.length} things, ${d.pieces.length} pieces, one trip down the Portal Chute`);
      hatchState = 'closing'; hatchT = 0;
    }
  } else if (hatchState === 'closing') {
    hatchT += dt; setDoors(Math.max(0, 1 - hatchT / 0.6));
    if (hatchT > 0.6) { hatchState = 'closed'; for (const c of hatchColliders) c.setEnabled(true); hatchQuiet = 0; audio.hit('thunk', 2000); }
  }
  renderPayload();
}
function renderPayload() {
  const el = $('payload'); if (!el || el.hidden) return;
  const { n, pieces, kg } = payloadStat;
  $('plCount').textContent = n;
  $('plSub').textContent = n ? `${n === 1 ? 'thing' : 'things'} · ${pieces} pcs · ${kg < 1 ? Math.round(kg * 1000) + ' g' : kg.toFixed(kg < 10 ? 1 : 0) + ' kg'}` : 'chute is empty';
  $('plLever').classList.toggle('idle', !n || hatchState !== 'closed');
  const full = Math.min(1, pieces / PAYLOAD_FULL.pieces);
  $('plFill').style.width = (full * 100) + '%';
  el.classList.toggle('busy', hatchState !== 'closed');
  const lf = drops.parkedCount ? drops.parkedCount() : 0;
  $('plLost').hidden = !lf; if (lf) $('plLost').textContent = `🧳 Lost & Found: ${lf}`;
}
// leaving the page: send whatever is on the hatch now, without the animation
function flushInstantly() {
  if (!drops || !hatchColliders.length) return;
  thawHatch();
  for (const b of [...bodies]) if (onHatch(b)) absorb(b);
  drops.finalizeAll();
  drops.flushPayload();
}

// ------------------------------------------------------------------------------- hole mode
// The fan and its motor slide out of the tube through the side, the breaker is locked off, and
// whatever you drop just falls: through still air, down the tube, onto the Portal Chute, whole
// (fragile things can still break when they land). Slide it back in to shred again.
const HOLE_OUT = -(TUN.R + 3.6);   // sideways (tube y, i.e. world x): out of the tube, away from the Overview camera
function setHoleMode(on) {
  if (on === holeMode) return;
  if (on && (jam || repairing)) { toast('Fix the fan first: it has to be working to slide out'); return; }
  holeMode = on;
  const thr = $('throttle');
  if (on) {
    holeThrottle = +thr.value || holeThrottle;
    thr.value = 0; thr.oninput(); thr.disabled = true;
    rotor.locked = true;                         // breaker off: it spins down as it slides
    for (const c of hubColliders) c.setEnabled(false);
    toast('🕳️ HOLE MODE: the fan slides out of the way. Drop things straight down the tube.');
  } else {
    toast('The fan slides back in. Shredding resumes.');
  }
  audio.start(); audio.hit('clang', 2e4); setTimeout(() => audio.hit('thunk', 8e3), 900);
  holeAnim = { t: 0, from: fan.group.position.y, to: on ? HOLE_OUT : TUN.y0 };
  $('btnHole').classList.toggle('on', on);
  $('throttleBox').classList.toggle('hole', on);
  document.body.classList.toggle('holeMode', on);
}
function stepHole(dt) {
  const a = holeAnim;
  a.t = Math.min(1, a.t + dt / 1.6);
  const e = a.t < 0.5 ? 4 * a.t ** 3 : 1 - (-2 * a.t + 2) ** 3 / 2;
  const y = a.from + (a.to - a.from) * e;
  fan.group.position.y = y;
  if (tunnel.motor) tunnel.motor.position.y = y - TUN.y0;
  if (a.t >= 1) {
    holeAnim = null;
    if (!holeMode) {                             // back in place: colliders on, breaker on, throttle back
      for (const c of hubColliders) c.setEnabled(true);
      if (!jam) rotor.locked = false;
      const thr = $('throttle'); thr.disabled = false; thr.value = holeThrottle; thr.oninput();
    }
  }
}

// ------------------------------------------------------------------------------- real air
// The lab's lattice-Boltzmann solver on a slice through the tube, drawn as a glowing cut-away
// (js/realair.js). Visual only for now: the game's physics still uses its own air model.
let realAir = null, realAirMode = 'off', realAirBroken = false;
function setRealAir(mode, quiet) {
  if (mode !== 'off' && !realAir && !realAirBroken) {
    try { realAir = new RealAir(rig, { maxSteps: isTouch ? 24 : 48 }); }
    catch (e) { realAirBroken = true; console.warn(e); if (!quiet) toast('Real air needs WebGL2 float textures, which this browser doesn’t have'); mode = 'off'; }
  }
  if (realAirBroken) mode = 'off';
  realAirMode = mode;
  try { localStorage.setItem('shredRealAir', mode); } catch (e) { /* ignore */ }
  realAir?.setVisible(mode !== 'off'); realAir?.setMode(mode);
  $('btnAir').classList.toggle('on', mode !== 'off');
  $('airName').textContent = mode === 'off' ? '' : mode === 'smoke' ? 'SMOKE' : 'SWIRL';
  if (!quiet) toast(mode === 'off' ? 'Real air off' : mode === 'smoke' ? '🔬 Real air: lattice-Boltzmann CFD on a slice through the tube (smoke)' : '🔬 Real air: the same slice, coloured by swirl (vorticity)');
}

// ------------------------------------------------------------------------------- the lab
// Behind the scenes: the original lattice-Boltzmann wind tunnel (lab/), with this object as a
// side-view silhouette at real size. Built-ins go by id; anything else is handed over in storage.
function openInLab(r) {
  const builtIn = CATALOG.some(c => c.id === r.id);
  if (!builtIn) { try { localStorage.setItem('labRecipe', JSON.stringify(r)); } catch (e) { /* storage blocked */ } }
  window.open(`lab/?shred=${builtIn ? encodeURIComponent(r.id) : 'local'}`, '_blank', 'noopener');
}

// ------------------------------------------------------------------------------- ride along
// FLUSH! with RIDE ALONG on: the camera dives into the portal, you fly down the internet tube
// with the payload (its real pieces), each ring a real hop, then tumble out of the sky portal over
// the Shred Pile and watch it land. Skip ▶ (or Esc) jumps to the landing.
let ride = null, tube = null;
const rideOn = () => { try { return localStorage.getItem('shredRide') === '1'; } catch (e) { return false; } };
function setRideToggle(on) {
  try { localStorage.setItem('shredRide', on ? '1' : '0'); } catch (e) { /* ignore */ }
  $('plRide').setAttribute('aria-pressed', String(on));
  $('plRide').textContent = on ? '🎢 RIDE ALONG: ON' : '🎢 RIDE ALONG';
}
function rideGot(d) { if (ride && !ride.drop && (d.payload || d.pieces?.length)) { ride.drop = d; ride.gotAt = performance.now(); } }

function startRide() {
  if (ride) return;
  const pc = ensurePileCam();
  ride = { t0: performance.now(), drop: null, covered: false, pileWasHere: $('pileCanvas').parentNode, pileWasRunning: pc.running };
  // Pile Cam starts now (hidden) so its heap is rebuilt by the time we arrive
  pc.hidden = true; pc.start();
  if (pc.first) pc.pollClock = pc.pollEvery;
  controls.enabled = false;
  const p0 = camera.position.clone(), t0 = controls.target.clone(), f0 = camera.fov;
  const P = [p0, new THREE.Vector3(1.5, 6, 7), new THREE.Vector3(0.05, 1.2, 0.3)], T = [t0, new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(0, -6, 0)];
  let k = 0;
  audio.whoosh?.(60);
  ride.dive = (dt) => {
    k = Math.min(1, k + dt / 1.5);
    const e = k * k * (3 - 2 * k), seg = e < 0.55 ? 0 : 1, f = seg ? (e - 0.55) / 0.45 : e / 0.55;
    camera.position.lerpVectors(P[seg], P[seg + 1], f);
    camera.lookAt(new THREE.Vector3().lerpVectors(T[seg], T[seg + 1], f));
    camera.fov = f0 + (92 - f0) * e; camera.updateProjectionMatrix();
    if (k >= 1) { ride.dive = null; enterTube(); }
  };
}

function enterTube() {
  const el = $('ride');
  el.hidden = false; el.classList.remove('pile');
  $('rideBack').hidden = true; $('rideSkip').hidden = false;
  flash();
  ride.covered = true;
  if (!tube) tube = new TubeRide($('rideCanvas'));
  tube.resize();
  ride.phase = 'tube'; ride.u = 0; ride.tt = 0; ride.hopShown = -1;
  const waitStart = performance.now();
  // wait (briefly) for the payload to be sent: its id seeds the route, its pieces fly with you
  const go = () => {
    if (!ride) return;
    if (!ride.drop && performance.now() - waitStart < 4000) { caption('PACKING THE PAYLOAD…', 'Squeezing it into bytes'); requestAnimationFrame(go); return; }
    const d = ride.drop || { pieces: [], object: { name: 'Something' } };
    ride.hops = rideHops(d);
    tube.build(hashSeed(d.id || String(Date.now())), ride.hops);
    tube.setDebris(d);
    $('rideStats').textContent = rideStatsText(d);
    ride.last = performance.now();
    requestAnimationFrame(tubeFrame);
  };
  go();
}
function hashSeed(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rideStatsText(d) {
  const n = d.objects?.length || 1, kb = d._wireBytes ? (d._wireBytes / 1024).toFixed(1) + ' KB' : '';
  return [`PAYLOAD ${String(d.id || 'local').slice(0, 8).toUpperCase()}`, `${n} object${n === 1 ? '' : 's'} · ${(d.pieces?.length || 0).toLocaleString()} pieces${kb ? ' · ' + kb : ''}`].join('\n');
}
function rideHops(d) {
  const colo = d._colo ? `Cloudflare ${d._colo}` : 'Cloudflare\'s edge';
  const what = d.objects?.length ? `${d.objects.length} things` : (d.object?.name || 'your payload');
  return [
    { at: 0.03, hop: 'PAYLOAD AWAY', sub: `${what}, shredded and packed into bytes`, color: '#ffd23f' },
    { at: 0.13, hop: 'HOP 1 · YOUR WI-FI', sub: 'The router has seen worse. Not much worse.', color: '#6bff9e' },
    { at: 0.26, hop: 'HOP 2 · YOUR INTERNET PROVIDER', sub: 'Merging onto the information superhighway (left lane)', color: '#7df9ff' },
    { at: 0.40, hop: `HOP 3 · ${colo.toUpperCase()}`, sub: d._colo ? `The nearest Cloudflare data centre (${d._colo}) catches it` : 'The nearest Cloudflare data centre catches it', color: '#ff9b3f' },
    { at: 0.53, hop: 'HOP 4 · THE WORKER', sub: d.id ? `Stamped ${String(d.id).slice(0, 8)}, slimmed to a quarter of its size` : 'Stamped, slimmed, given a seat number', color: '#9b8cff' },
    { at: 0.66, hop: 'HOP 5 · THE MAILBOX', sub: d._fuelLeft != null ? `Filed under "recent". Portal fuel left today: ${d._fuelLeft.toLocaleString()}` : 'Filed under "recent"', color: '#ff6bd6' },
    { at: 0.79, hop: 'HOP 6 · WORLD BUILDER', sub: '"Anything new?" "Oh, you have no idea."', color: '#7df9ff' },
    { at: 0.92, hop: 'THE SKY PORTAL · 150 M UP', sub: 'Brace.', color: '#ffffff' },
  ];
}
function caption(hop, sub) {
  $('rideHop').textContent = hop; $('rideSub').textContent = sub || '';
  const c = $('rideHop').parentNode; c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop');
}
function flash() { const f = $('rideFlash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }

function tubeFrame(now) {
  if (!ride || ride.phase !== 'tube') return;
  const dt = Math.min(0.05, (now - ride.last) / 1000); ride.last = now;
  ride.tt += dt;
  // ease in, cruise, a last burst of speed into the portal
  const x = Math.min(1, ride.tt / RIDE_SECONDS);
  ride.u = x < 0.12 ? 0.5 * (x / 0.12) ** 2 * 0.12 : x < 0.9 ? 0.06 + (x - 0.12) * (0.84 / 0.78) : 0.9 + (x - 0.9) * 1.0;
  tube.uniforms.uWarp.value = Math.max(0, (x - 0.85) / 0.15);
  const i = ride.hops.findLastIndex(h => ride.u >= h.at);
  if (i !== ride.hopShown && i >= 0) { ride.hopShown = i; caption(ride.hops[i].hop, ride.hops[i].sub); audio.hit(i === ride.hops.length - 1 ? 'zap' : 'pop', 900); }
  tube.frame(ride.u, ride.tt, dt);
  if (x >= 1) {
    // the Shred Pile is still unpacking: hang in the portal's glow for a moment (at most 6 s) so you land on the whole heap
    if (pileCam && !pileCam.ready && ride.tt < RIDE_SECONDS + 6) { if (!ride.holding) { ride.holding = true; caption('ARRIVING…', 'The Shred Pile is unpacking itself'); } }
    else { exitTube(); return; }
  }
  requestAnimationFrame(tubeFrame);
}

function skipTube() { if (ride?.phase !== 'tube') return; if (ride.hops) ride.tt = Math.max(ride.tt, RIDE_SECONDS); else exitTube(); }

function exitTube() {
  if (!ride || ride.phase === 'pile') return;
  ride.phase = 'pile';
  flash(); audio.whoosh?.(80);
  const pc = pileCam, d = ride.drop;
  // split view showing the live world hides this canvas: show it for the landing
  ride.canvasWasHidden = $('pileCanvas').hidden; $('pileCanvas').hidden = false;
  $('ridePile').appendChild($('pileCanvas'));
  $('ride').classList.add('pile');
  $('rideSkip').hidden = true;
  pc.hidden = false; if (!pc.running) pc.start();
  requestAnimationFrame(() => pc.resize());
  caption('THE SHRED PILE', d ? `${(d.pieces?.length || 0).toLocaleString()} pieces, landing now` : 'Here it all ends up');
  const done = () => { $('rideBack').hidden = false; $('rideLive').hidden = !worldBuilderUrl(); caption('DELIVERED', `${pc.total.pieces.toLocaleString()} pieces on the Shred Pile now. Look around, or head back.`); };
  if (d && d.pieces?.length) pc.rideIn(d, done); else done();
}

function endRide() {
  if (!ride) return;
  const pc = pileCam, r = ride;
  ride = null;
  rideLive(false); $('rideLive').hidden = true;
  if (r.canvasWasHidden) $('pileCanvas').hidden = true;
  if (pc) { pc.ride = null; pc.controls.enabled = true; pc.hidden = false; r.pileWasHere.appendChild($('pileCanvas')); if (!r.pileWasRunning || !document.body.classList.contains('split') || (flipping() && !onPile)) pc.stop(); else pc.resize(); }
  $('ride').hidden = true; $('ride').classList.remove('pile');
  controls.enabled = true;
  setCamera(0, true); resize();
}
// after landing: peek at the same heap in Matt's live World Builder, right here (Pile Cam rests meanwhile)
function rideLive(on) {
  const f = $('rideFrame');
  if (ride) ride.live = on;
  $('ride').classList.toggle('live', on);
  $('rideLive').textContent = on ? '🗑 Back to our view of the pile' : '🌐 See it live in World Builder';
  if (on) { if (f.src !== worldBuilderUrl()) f.src = worldBuilderUrl(); caption('WORLD BUILDER, LIVE', 'The same Shred Pile in Matt\'s world. Drag to look around.'); }
  else {
    if (f.getAttribute('src') && f.getAttribute('src') !== 'about:blank') f.src = 'about:blank';
    if (ride?.phase === 'pile' && pileCam) caption('THE SHRED PILE', `${pileCam.total.pieces.toLocaleString()} pieces and counting`);
  }
  if (pileCam && ride?.phase === 'pile') pileCam.hidden = on;
}
// reserve the payload in Pile Cam as soon as its id is known, so polling doesn't land it early
function reserveForRide(d) { if (ride && pileCam && d?.id) pileCam.reserved.add(d.id); }

// ------------------------------------------------------------------------------- title screen
// TAP TO START runs the title through a strip-cut shredder: the words are cut into vertical
// strips that get dragged down, wobble, and drop out of the bottom of the screen.
function shredTitle() {
  const start = $('start'), st = start.querySelector('.st');
  start.dataset.going = '1';
  start.style.pointerEvents = 'none';
  let fade = null;
  const done = () => { start.hidden = true; start.style.pointerEvents = ''; fade?.cancel(); delete start.dataset.going; box?.remove(); st.style.visibility = ''; };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !st.animate) { start.hidden = true; delete start.dataset.going; start.style.pointerEvents = ''; return; }
  const r = st.getBoundingClientRect();
  const box = document.createElement('div'); box.className = 'stShred';   // wears the title's styles
  Object.assign(box.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', zIndex: 21, pointerEvents: 'none' });
  const n = Math.max(12, Math.min(34, Math.round(r.width / 22))), w = r.width / n;
  for (let i = 0; i < n; i++) {
    const c = st.cloneNode(true);
    Object.assign(c.style, { position: 'absolute', left: 0, top: 0, width: r.width + 'px', margin: 0, boxSizing: 'border-box',
      clipPath: `inset(0 ${(r.width - (i + 1) * w - 0.5).toFixed(1)}px 0 ${(i * w - 0.5).toFixed(1)}px)`, transformOrigin: `${(i + 0.5) * w}px 0`, willChange: 'transform' });
    box.appendChild(c);
    const side = (i + 0.5) / n - 0.5, jx = side * 60 + (Math.random() - 0.5) * 30, rot = (Math.random() - 0.5) * 28 + side * 20;
    const fall = innerHeight - r.top + 80 + Math.random() * 120, delay = Math.abs(side) * 120 + Math.random() * 140;
    c.animate([
      { transform: 'translate(0, 0) rotate(0deg)' },
      { transform: `translate(${(jx * 0.15).toFixed(1)}px, ${(8 + Math.random() * 14).toFixed(1)}px) rotate(${(rot * 0.08).toFixed(1)}deg)`, offset: 0.18 },   // bitten by the blades
      { transform: `translate(${(jx * 0.4).toFixed(1)}px, ${(r.height * 0.18).toFixed(1)}px) rotate(${(rot * 0.35).toFixed(1)}deg)`, offset: 0.42 },
      { transform: `translate(${jx.toFixed(1)}px, ${fall.toFixed(0)}px) rotate(${rot.toFixed(1)}deg)`, opacity: 0.85 },
    ], { duration: 1050 + Math.random() * 350, delay, easing: 'cubic-bezier(.45,.05,.85,.55)', fill: 'forwards' });
  }
  document.body.appendChild(box);
  st.style.visibility = 'hidden';
  fade = start.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 800, delay: 250, easing: 'ease-out', fill: 'forwards' });
  audio.hit('tear', 4e4); setTimeout(() => audio.hit('crunch', 1.5e4), 120); setTimeout(() => audio.hit('tear', 2e4), 320);
  setTimeout(done, 1750);
}

// ------------------------------------------------------------------------------- teleport
function worldBuilderUrl() {
  let u = ''; try { u = localStorage.getItem('wbUrl') || ''; } catch {}
  return u || WORLD_BUILDER_URL;
}
function openWarp() {
  $('warpUrl').value = worldBuilderUrl();
  $('warp').hidden = false;
}
function warpToWorldBuilder() {
  stats.count('warps');
  let url;
  try { url = new URL($('warpUrl').value.trim() || worldBuilderUrl(), location.href); }
  catch { $('warpUrl').focus(); return; }
  try { localStorage.setItem('wbUrl', url.href); } catch {}
  if (!/lat=/.test(url.hash)) url.searchParams.set('visit', 'shred-pile');   // a link with a camera position already says where
  flushInstantly();   // whatever is waiting in the Portal Chute goes through ahead of you
  $('warp').hidden = true;
  audio.whoosh?.(40);
  document.body.classList.add('warping');
  setTimeout(() => {
    // inside an embedded copy (the Claude-hosted one) a new tab is the only way out
    if (window.top !== window) { window.open(url.href, '_blank', 'noopener'); document.body.classList.remove('warping'); }
    else location.href = url.href;
  }, 850);
}

// ------------------------------------------------------------------------------- toolbar tips
// The toolbar is all emoji, so hovering a button (with a mouse) pops up its name and what it does.
const TOOL_TIPS = {
  btnCam: ['Camera', 'Cycle through the views (C)'],
  btnSlow: ['Slow motion', 'Run the world at a crawl'],
  btnBullet: ['Bullet time', 'Auto slow-mo right before the blades hit'],
  btnSmoke: ['Smoke tracers', 'Show the airflow down the tube'],
  btnHole: ['Hole mode', 'Slide the fan out of the way and just drop things down the tube'],
  btnAir: ['Real air', 'Live CFD on a slice through the tube: off → smoke → swirl'],
  btnGust: ['Gust', 'A sudden blast of air'],
  btnSound: ['Sound', 'Mute or unmute'],
  btnChaos: ['Chaos', 'Throw 8 random things at once'],
  btnShare: ['Share your pile', 'Picture of what you shredded, to text or email'],
  btnSplit: ['Split view', 'Watch the Shred Pile fill up (on a phone it slides over when you flush)'],
  btnWarp: ['Teleport', 'Leave the Shred Hole for World Builder'],
  btnInfo: ['How it works', 'The physics behind the silliness'],
};
function setupToolTips() {
  const tip = document.createElement('div'); tip.id = 'toolTip'; tip.hidden = true; document.body.appendChild(tip);
  let showT = 0;
  const hide = () => { clearTimeout(showT); tip.hidden = true; };
  for (const b of document.querySelectorAll('#tools button')) {
    const t = TOOL_TIPS[b.id] || [b.title, ''];
    b.setAttribute('aria-label', t[0]); b.dataset.title = b.title; b.removeAttribute('title');   // no double tooltip
    b.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse') return;
      clearTimeout(showT);
      showT = setTimeout(() => {
        tip.innerHTML = `<b>${t[0]}</b>${t[1] ? `<span>${t[1]}</span>` : ''}`;
        tip.hidden = false;
        const r = b.getBoundingClientRect(), w = tip.offsetWidth;
        tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
        tip.style.top = (r.bottom + 8) + 'px';
        tip.style.setProperty('--ax', (r.left + r.width / 2 - parseFloat(tip.style.left)) + 'px');
      }, 120);
    });
    b.addEventListener('pointerleave', hide);
    b.addEventListener('click', hide);
  }
}

// ------------------------------------------------------------------------------- split view
let pileCam = null;
function mailboxUrl() {
  try { const w = localStorage.getItem('tunnelWorker'); if (w) return w.replace(/\/$/, '') + '/drops'; } catch {}
  return WORKER_URL ? WORKER_URL.replace(/\/$/, '') + '/drops' : '';
}
// Wide screens: the pile sits beside the tunnel. Phones and small windows ("flip"): the pile is
// a whole screen to the right; you stay on the tunnel until a flush, then it slides over.
const flipMode = () => innerWidth < 900 || innerHeight < 520;
let onPile = false;
let splitT = 0;
function setSplit(on) {
  const flip = on && flipMode();
  clearTimeout(splitT);
  document.body.classList.toggle('flip', flip);
  $('toPile').hidden = !flip;
  if (!flip) showPile(false, true);
  if (on) {
    stats.count('splits');
    // get the pile drawing (at its final size) before it slides in, so it arrives already moving
    setPaneSource($('paneSrc').value);
    if (flip && !onPile) pileCam?.stop();
    requestAnimationFrame(() => document.body.classList.add('split'));
  } else {
    document.body.classList.remove('split');
    // keep drawing while it slides away, then rest
    splitT = setTimeout(() => { if (!document.body.classList.contains('split')) { pileCam?.stop(); $('paneFrame').src = 'about:blank'; } }, 600);
  }
}
// flip mode: slide the pile in or out. While it covers the screen only the pile is drawn (the
// tunnel stops drawing once the slide has finished, and starts again as soon as it slides back).
let pileCovers = false, coverT = 0;
function showPile(on, quiet = false) {
  onPile = !!on;
  clearTimeout(coverT);
  if (!onPile) pileCovers = false;
  if (!document.body.classList.contains('flip')) { document.body.classList.toggle('onPile', false); return; }
  if (onPile && $('paneSrc').value !== 'live' && pileCam) { pileCam.start(); pileCam.resize(); }
  requestAnimationFrame(() => document.body.classList.toggle('onPile', onPile));
  if (onPile) coverT = setTimeout(() => { if (onPile) pileCovers = true; }, 600);
  else if (pileCam && !quiet) coverT = setTimeout(() => { if (!onPile) pileCam.stop(); }, 600);
}
const flipping = () => document.body.classList.contains('flip');
// swipe in from an edge to flip between the two
function setupFlipSwipe() {
  let x0 = null, y0 = 0, from = null;
  addEventListener('touchstart', (e) => {
    if (!flipping() || e.touches.length !== 1) return;
    const t = e.touches[0];
    from = !onPile && t.clientX > innerWidth - 26 ? 'right' : onPile && t.clientX < 26 ? 'left' : null;
    if (from) { x0 = t.clientX; y0 = t.clientY; }
  }, { passive: true, capture: true });
  addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { if (from === 'right' && dx < 0) showPile(true); if (from === 'left' && dx > 0) showPile(false); }
    x0 = null; from = null;
  }, { passive: true, capture: true });
}
function ensurePileCam() {
  if (pileCam) return pileCam;
  pileCam = new PileCam($('pileCanvas'), mailboxUrl());
  pileCam.pollClock = -1e9;   // first read (and rebuilding the heap) waits until the pane has slid in
  setTimeout(() => { pileCam.pollClock = pileCam.pollEvery; }, 650);
  const stat = () => { const t = pileCam.total; $('paneStat').textContent = `${t.pieces.toLocaleString()} pieces · ${t.kg.toFixed(0)} kg so far${pileCam.napping ? ' · 💤 napping' : ''}`; };
  pileCam.onNote = stat; pileCam.onNap = stat;
  pileCam.onBale = (n) => { if (pileCam.compacting) toast(`🗜️ The compactor squashed the Shred Pile into bale #${n}`); };
  if (!mailboxUrl()) $('paneStat').textContent = 'no mailbox set up';
  return pileCam;
}
function setPaneSource(src) {
  const live = src === 'live';
  $('pileCanvas').hidden = live;
  if (!live) {
    $('paneFrame').hidden = true; $('paneLive').hidden = true; $('paneFrame').src = 'about:blank';
    ensurePileCam();
    pileCam.start(); pileCam.resize();
  } else {
    pileCam?.stop();
    const u = worldBuilderUrl();
    $('paneUrl').value = u;
    if (u) showLive(u); else { $('paneFrame').hidden = true; $('paneLive').hidden = false; }
  }
}
function showLive(u) {
  const url = new URL(u, location.href);
  if (!/lat=/.test(url.hash)) url.searchParams.set('visit', 'shred-pile');
  $('paneLive').hidden = true;
  $('paneFrame').hidden = false;
  $('paneFrame').src = url.href;
  $('paneStat').textContent = url.host;
}
addEventListener('resize', () => { if (pileCam?.running) pileCam.resize(); });

// ------------------------------------------------------------------------------- loop
let last = performance.now(), acc = 0, frames = 0, lastCW = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const fdt = Math.min(0.05, (now - last) / 1000); last = now; frames++;
  let ts = timeScale;
  if (performance.now() < bulletUntil) ts = Math.min(ts, 0.12);
  acc += fdt * ts;
  let steps = 0;
  const dt = ts < 1 ? DT * Math.max(0.25, ts * 1.5) : DT;
  while (acc >= dt && steps < 6) { physicsStep(dt); acc -= dt; steps++; }
  if (steps === 6) acc = 0;

  // auto bullet-time when a whole object is about to meet the blades
  if (autoBullet && Math.abs(rotor.omega) > 5) {
    for (const rec of bodies) {
      if (rec.level !== 0 || rec.root.bulleted) continue;
      const t = rec.body.translation();
      const vx = rec.body.linvel().x;
      if (t.x > TUN.fanX - 1.2 - Math.max(0, vx) * 0.12 && t.x < TUN.fanX && Math.hypot(t.y - TUN.y0, t.z) < TUN.R) {
        rec.root.bulleted = true; bulletUntil = performance.now() + 1500;
      }
    }
  }

  // sync meshes, cull escapees
  for (let i = bodies.length - 1; i >= 0; i--) {
    const rec = bodies[i];
    const t = rec.body.translation(), q = rec.body.rotation();
    rec.group.position.set(t.x, t.y, t.z);
    rec.group.quaternion.set(q.x, q.y, q.z, q.w);
    const rr = Math.hypot(t.y, t.z);
    if (t.x > TUN.groundX - 1.4 - rec.radius && rr < PORTAL.R * 0.95) absorb(rec);
    else if (t.x > TUN.groundX + 2 || t.x < -40 || Math.abs(t.y) > 40 || Math.abs(t.z) > 40) removeBody(rec, 'exit');
    else if (rec.level > 0 && t.x > TUN.groundX - 0.8 && simTime - rec.born > 90) removeBody(rec, 'dissolve');
  }
  checkVerdicts();

  if (smokeOn && air.U > 0.3) {
    for (let k = 0; k < 6; k++) {
      const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * 3.4;
      particles.emit('smoke', { x: air.flowDir > 0 ? -1.6 : TUN.L + 0.9, y: Math.cos(a) * rr * (air.flowDir > 0 ? 1 : 0.7), z: Math.sin(a) * rr * (air.flowDir > 0 ? 1 : 0.7) }, { x: 0, y: 0, z: 0 }, 1, 0.05);
    }
  }
  particles.update(fdt * ts, air);

  // things falling into the portal: spiral in, shrink, gone
  for (let i = absorbing.length - 1; i >= 0; i--) {
    const e = absorbing[i];
    e.t += fdt * Math.max(ts, 0.3);
    const k = Math.min(1, e.t / 0.9);
    const ang = e.a0 + k * k * 9, rad = e.r0 * (1 - k);
    e.group.position.set(e.x0 + k * 1.4 + 0.6 * k * k, Math.cos(ang) * rad, Math.sin(ang) * rad);
    e.group.rotateOnAxis(e.spinAxis, fdt * 9);
    e.group.scale.setScalar(Math.max(0.001, 1 - k * k));
    if (k >= 1) { rig.remove(e.group); e.group.traverse(o => { if (o.isMesh && o.userData.ownGeo) o.geometry.dispose(); }); absorbing.splice(i, 1); }
  }
  drops.tick();
  hatchTick(fdt);
  portal.update(now / 1000, fdt);

  // fan visuals
  fan.rotor.rotation.x = rotor.theta;
  const sp = Math.abs(rotor.omega);
  const blur = Math.max(0, Math.min(0.75, (sp * ts - 7) / 25));
  fan.disc.material.opacity = blur;
  for (const m of fan.mats) m.opacity = 1 - blur * 0.85;
  const on = rotor.setpoint > 0 || sp > 1;
  tunnel.beaconMat.emissiveIntensity = on ? 0.6 + 2 * Math.max(0, Math.sin(now / 160)) : 0.1;
  tunnel.beaconLight.intensity = on ? 30 : 0;
  tunnel.beaconLight.target.position.set(tunnel.beacon.position.x + Math.cos(now / 300) * 8, tunnel.beacon.position.y - 6, Math.sin(now / 300) * 8);

  // camera
  if (camTween) {
    camTween.t = Math.min(1, camTween.t + fdt / 0.9);
    const e = 1 - Math.pow(1 - camTween.t, 3);
    camera.position.lerpVectors(camTween.from.pos, camTween.to.pos, e);
    controls.target.lerpVectors(camTween.from.tgt, camTween.to.tgt, e);
    if (camTween.t >= 1) camTween = null;
  }
  if (CAMS[camMode].follow && lastRoot) {
    let best = null;
    for (const rec of lastRoot.live) if (!best || rec.mass > best.mass) best = rec;
    if (best) {
      const p = best.group.getWorldPosition(new THREE.Vector3());
      const d = new THREE.Vector3(-3.2, 1.4, 2.6);
      controls.target.lerp(p, 0.12);
      camera.position.lerp(p.clone().add(d), 0.06);
    }
  }
  controls.update();
  sign.update(fdt, camera);
  safety?.tick(now / 1000);
  const imb = imbalance();                      // a bent blade throws the rotor out of balance
  if (imb > 0.02 && !rotor.locked) shake = Math.max(shake, Math.min(0.9, imb * 0.8 * Math.min(1, Math.abs(rotor.omega) / 25)));
  if (shake > 0.001) {
    const s = shake * 0.06;
    camera.position.x += (Math.random() - 0.5) * s; camera.position.y += (Math.random() - 0.5) * s;
    shake *= Math.pow(0.02, fdt);
  }
  if (ride && ride.dive) ride.dive(fdt);
  if (holeAnim) stepHole(fdt);
  if (realAir && realAirMode !== 'off' && !(ride && ride.covered)) { try { realAir.update(fdt * ts, { bodies, air, camera, rig, hub: !holeMode }); } catch (e) { console.warn(e); setRealAir('off', true); realAirBroken = true; } }
  const cw = renderer.domElement.clientWidth;   // the split pane is gliding in or out: follow it
  if (cw !== lastCW) { lastCW = cw; resize(); }
  if (!(pileCovers && flipping()) && !(ride && ride.covered)) renderer.render(scene, camera);   // flip mode: the tunnel is off-screen
  audio.update(air.U, rotor.omega, FAN.blades, Math.abs(rotor.torque) / FAN.Tmax, ts);
  if (frames % 4 === 0) hud(ts);
}

// ------------------------------------------------------------------------------- HUD + UI
function hud(ts) {
  const U = air.U;
  $('wind').textContent = U.toFixed(U < 10 ? 1 : 0);
  $('mph').textContent = `${(U * 2.237).toFixed(0)} mph · ${(U * 3.6).toFixed(0)} km/h`;
  const bf = beaufort(U);
  $('bft').textContent = `Beaufort ${bf.n} · ${bf.name}`;
  const rpm = rotor.rpm;
  $('rpm').textContent = (rpm < -0.5 ? '−' : '') + Math.abs(rpm).toFixed(0);
  $('kw').textContent = (rotor.power / 1000).toFixed(0);
  $('tip').textContent = (Math.abs(rotor.omega) * FAN.Rtip).toFixed(0);
  $('bpf').textContent = (Math.abs(rotor.omega) / (2 * Math.PI) * FAN.blades).toFixed(0);
  $('slowBadge').hidden = ts >= 0.99;
  $('slowBadge').textContent = ts < 0.2 ? 'BULLET TIME' : `SLOW-MO ×${ts.toFixed(2)}`;
  $('count').textContent = bodies.length;
}

function buildUI() {
  // tray
  const tray = $('tray');
  tray.innerHTML = '';
  const make = document.createElement('button');
  make.className = 'item make';
  make.innerHTML = '<span class="ic">✨</span><span class="nm">Type anything</span><span id="tixBadge" class="tixb" hidden></span>';
  make.onclick = openMaker;
  tray.appendChild(make);
  for (const r of recipes) addTrayItem(r);
  // the status board: every minute while the Fabricator is open, every 5 min otherwise, never in a hidden tab
  refreshQuota();
  setInterval(() => { if (!document.hidden && (!$('maker').hidden || performance.now() - quotaAsked > 5 * 60000)) refreshQuota(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && performance.now() - quotaAsked > 5 * 60000) refreshQuota(); });
  setInterval(() => { if (!$('maker').hidden) renderTickets(); }, 1000);
  renderThumbs();

  const thr = $('throttle');
  const setThr = () => {
    let v = +thr.value;
    if (Math.abs(v) < 6) { v = 0; if (+thr.value !== 0) thr.value = 0; }   // centre detent = off
    rotor.setpoint = v / 100;
    const u = FAN.phi * Math.abs(rotor.setpoint) * FAN.omegaMax * FAN.Rtip * (v < 0 ? FAN.reverseEff : 1);
    $('thrOut').textContent = holeMode ? 'NO FAN' : v === 0 ? 'OFF' : `${v > 0 ? '↓' : '↑'} ${u.toFixed(0)} m/s`;
    $('throttleBox').classList.toggle('rev', v < 0);
  };
  thr.oninput = setThr; setThr();
  $('btnCam').onclick = () => setCamera((camMode + 1) % CAMS.length);
  $('card').onclick = () => { $('card').hidden = true; };
  $('btnSlow').onclick = () => { timeScale = timeScale === 1 ? 0.25 : timeScale === 0.25 ? 0.06 : 1; $('btnSlow').classList.toggle('on', timeScale < 1); };
  $('btnBullet').onclick = () => { autoBullet = !autoBullet; $('btnBullet').classList.toggle('on', autoBullet); toast(autoBullet ? 'Auto bullet-time on: slows down right before the chop' : 'Auto bullet-time off'); };
  $('btnBullet').classList.toggle('on', autoBullet);
  $('btnSmoke').onclick = () => { smokeOn = !smokeOn; $('btnSmoke').classList.toggle('on', smokeOn); };
  $('btnHole').onclick = () => setHoleMode(!holeMode);
  $('btnAir').onclick = () => setRealAir(realAirMode === 'off' ? 'smoke' : realAirMode === 'smoke' ? 'swirl' : 'off');
  // on by default on desktops (smoke); phones start with it off, to spare the battery
  { let m = null; try { m = localStorage.getItem('shredRealAir'); } catch (e) { /* ignore */ } setRealAir(m || (!isTouch && innerWidth >= 900 ? 'smoke' : 'off'), true); }
  $('btnSound').onclick = () => { audio.setEnabled(!audio.enabled); $('btnSound').classList.toggle('on', audio.enabled); $('btnSound').textContent = audio.enabled ? '🔊' : '🔇'; };
  $('btnSound').classList.add('on');
  $('btnGust').onclick = () => { air.gust = 2.5; toast('Gust!'); };
  $('btnChaos').onclick = chaos;
  $('btnInfo').onclick = () => { $('info').hidden = !$('info').hidden; };
  $('btnShare').onclick = openShare;
  $('btnWarp').onclick = openWarp;
  $('warpClose').onclick = $('warpStay').onclick = () => { $('warp').hidden = true; };
  $('warpGo').onclick = warpToWorldBuilder;
  $('warpUrl').onkeydown = (e) => { if (e.key === 'Enter') warpToWorldBuilder(); };
  setupToolTips();
  $('hatch').onclick = pullHatch;
  $('plLever').onclick = () => openPayloadHatch('lever');
  setRideToggle(rideOn());
  $('plRide').onclick = () => { setRideToggle(!rideOn()); toast(rideOn() ? '🎢 Ride along is on: pull FLUSH! and go with the payload' : 'Ride along is off'); };
  $('rideSkip').onclick = skipTube;
  $('rideLive').onclick = () => rideLive(!ride?.live);
  $('rideBack').onclick = endRide;
  addEventListener('keydown', (e) => { if (!ride || e.key !== 'Escape') return; if (ride.phase === 'tube') skipTube(); else if (ride.phase === 'pile' && !$('rideBack').hidden) endRide(); });
  addEventListener('resize', () => { if (ride?.phase === 'tube') tube?.resize(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushInstantly(); });
  addEventListener('pagehide', flushInstantly);
  $('btnSplit').onclick = () => setSplit(!document.body.classList.contains('split'));
  $('toPile').onclick = () => showPile(true);
  $('paneBack').onclick = () => showPile(false);
  setupFlipSwipe();
  // iOS Safari ignores user-scalable=no: stop its page pinch-zoom and double-tap zoom here
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
  addEventListener('resize', () => { const on = document.body.classList.contains('split'); if (on && flipMode() !== flipping()) setSplit(true); });
  $('paneClose').onclick = () => setSplit(false);
  $('paneSrc').onchange = () => setPaneSource($('paneSrc').value);
  $('paneGo').onclick = () => { const u = $('paneUrl').value.trim(); if (u) { try { localStorage.setItem('wbUrl', u); } catch {} showLive(u); } };
  if (new URLSearchParams(location.search).has('split')) setSplit(true);
  $('shareClose').onclick = () => { $('shareBox').hidden = true; };
  $('infoClose').onclick = () => { $('info').hidden = true; };
  $('start').onclick = () => {
    if ($('start').dataset.going) return;
    audio.start(); stats.start(); shredTitle(); $('hatch').hidden = false; $('payload').hidden = false;
    if (!armed) { const c = recipes.find(r => r.id === 'couch'); if (c) arm(c); }   // a couch is ready to go: pull the lever
    $('hatch').classList.toggle('idle', !armed);
    if (rotor.setpoint === 0) { thr.value = 70; setThr(); }
    toast(isTouch ? 'A couch is loaded. Pull DROP IT! (or flick it at the tunnel), or pick something else below' : 'A couch is loaded. Pull DROP IT! (D) or click/flick to throw it, or pick something else below');
  };
  // maker dialog
  $('makeGo').onclick = runMaker;
  $('makeIn').onkeydown = (e) => { if (e.key === 'Enter') runMaker(); };
  $('makeIn').oninput = () => renderWarehouse();
  $('makeClose').onclick = () => { $('maker').hidden = true; };
  document.querySelectorAll('#maker .chips button').forEach(b => b.onclick = () => { $('makeIn').value = b.textContent; runMaker(); });

  // throwing
  const cv = renderer.domElement;
  let down = null;
  cv.addEventListener('pointerdown', (e) => {
    audio.start();
    if (!armed || e.button !== 0) return;
    down = { x: e.clientX, y: e.clientY, t: performance.now(), pts: [[e.clientX, e.clientY, performance.now()]] };
  });
  cv.addEventListener('pointermove', (e) => { if (down) { down.pts.push([e.clientX, e.clientY, performance.now()]); if (down.pts.length > 8) down.pts.shift(); } });
  cv.addEventListener('pointerup', (e) => {
    if (!down) return;
    const d = down; down = null;
    const p0 = d.pts[0], p1 = [e.clientX, e.clientY, performance.now()];
    const dtp = Math.max(16, p1[2] - p0[2]) / 1000;
    const swipe = { x: (p1[0] - p0[0]) / dtp, y: (p1[1] - p0[1]) / dtp };
    throwArmed(d.x, d.y, Math.hypot(e.clientX - d.x, e.clientY - d.y) > 14 ? swipe : null);
  });
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space' && armed) { e.preventDefault(); throwArmed(renderer.domElement.clientWidth / 2, innerHeight / 2, null); }
    if (e.key === 'c') setCamera((camMode + 1) % CAMS.length);
    if (e.key === 'd' || e.key === 'D' || e.key === 'h' || e.key === 'H') pullHatch();
    if (e.key === 'f' || e.key === 'F' || e.key === 'o' || e.key === 'O') openPayloadHatch('lever');
  });
}

function addTrayItem(r, prepend) {
  const tray = $('tray');
  const b = document.createElement('button');
  b.className = 'item'; b.dataset.id = r.id; b.title = r.name;
  b.innerHTML = `<canvas width="96" height="96"></canvas><span class="nm">${escapeHtml(r.name)}</span>`;
  b.onclick = () => arm(armed === r ? null : r);
  if (prepend) tray.insertBefore(b, tray.children[1]); else tray.appendChild(b);
  return b;
}
const escapeHtml = (s) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function arm(r) {
  armed = r;
  $('hatch').classList.toggle('idle', !r);
  document.querySelectorAll('#tray .item').forEach(el => el.classList.toggle('on', r && el.dataset.id === r.id));
  if (r) {
    controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };
    showCard(r);
  } else {
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    $('card').hidden = true;
  }
}

// physics facts for the selected object
function showCard(r) {
  const built = buildObject(r);
  const panels = panelsFor(r.id, built.parts);
  // drag area averaged over orientations: CdA ≈ mean panel force / (½ρU²) for unit wind from 6 directions
  let cda = 0;
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const fake = { mean: (x, y, z, o) => { o[0] = o[1] = o[2] = 0; o[3] = 0; return o; }, turb: (x, y, z, w, o) => { o[0] = o[1] = o[2] = 0; return o; } };
  const rec = { panels, plates: built.parts.filter(p => p.plate).map(p => p.plate), round: 0, volume: 0 };
  const out = new Float32Array(6);
  for (const d of dirs) {
    aeroLoads(rec, fake, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, { x: -d[0], y: -d[1], z: -d[2] }, { x: 0, y: 0, z: 0 }, out);
    cda += Math.abs(out[0] * d[0] + out[1] * d[1] + out[2] * d[2]) / (0.5 * RHO);
  }
  cda /= 6;
  built.group.traverse(o => o.geometry && o.geometry.dispose());
  const m = r.mass * 1;
  const vt = Math.sqrt(2 * m * G / (RHO * Math.max(cda, 1e-5)));
  const Lc = built.radius * 2;
  const Re = air.U * Lc / NU;
  const bf = beaufort(vt);
  const ph = recipePhys(r);
  const verdictTxt = r.unbreakable ? 'won’t shatter' : ph.Fneed > BLADE.Fu ? '⚠ stronger than the blades' : ph.Fneed > BLADE.Fy ? '⚠ will bend blades' : '';
  if (compactUI()) {
    $('card').classList.add('mini');
    $('card').innerHTML = `<b>${escapeHtml(r.name)}</b> <span class="facts"><span><i>${fmtMass(m)}</i></span><span>${Lc.toFixed(1)} m</span><span>breaks at <i>${fmtE(ph.Ebreak)}</i></span>${verdictTxt ? `<span class="warn">${verdictTxt}</span>` : ''}</span>
      <div class="hint">Pull DROP IT! or flick the scene · tap here to hide</div>`;
    $('card').hidden = false;
    clearTimeout(showCard.h);
    showCard.h = setTimeout(() => { $('card').hidden = true; }, 3500);
    return;
  }
  $('card').classList.remove('mini');
  $('card').innerHTML = `<b>${escapeHtml(r.name)}</b>
    <div class="facts"><span>mass <i>${fmtMass(m)}</i></span><span>size <i>${Lc.toFixed(2)} m</i></span><span>drag area <i>${(cda * 1e4).toFixed(0)} cm²</i></span>
    <span>terminal velocity <i>${vt.toFixed(1)} m/s</i></span><span>lifts off in <i>${bf.name.toLowerCase()}</i></span><span>Re now <i>${Re > 1e4 ? Re.toExponential(1) : Re.toFixed(0)}</i></span>
    <span>walls <i>${ph.f > 0.6 ? 'solid' : ph.t < 0.01 ? (ph.t * 1000).toFixed(1) + ' mm' : (ph.t * 100).toFixed(1) + ' cm'}</i></span><span>breaks at <i>${fmtE(ph.Ebreak)}</i></span><span>cutting force <i>${fmtForce(ph.Fneed)}</i></span>${verdictTxt ? `<span class="warn">${verdictTxt}</span>` : ''}</div>
    ${r.fact ? `<p>${escapeHtml(r.fact)}</p>` : ''}<p class="hint">${isTouch ? 'Flick on the scene to throw · two fingers to look around' : 'Click or flick to throw · right-drag to look around · space = toss'} · <a href="#" class="labLink">🔬 its airflow in the lab</a></p>`;
  $('card').querySelector('.labLink').onclick = (e) => { e.preventDefault(); openInLab(r); };
  $('card').hidden = false;
  clearTimeout(showCard.h);
  if (isTouch) showCard.h = setTimeout(() => { $('card').hidden = true; }, 6000);
}

function compactUI() { return innerWidth <= 700 || (isTouch && innerHeight <= 500); }

// bounding radius of a recipe (cached), so big things are aimed clear of the tube wall
const radiusCache = new WeakMap();
function recipeRadius(r) {
  if (!radiusCache.has(r)) { const b = buildObject(r); b.group.traverse(o => o.geometry && o.geometry.dispose()); radiusCache.set(r, b.radius); }
  return radiusCache.get(r);
}

// this session's shred pile (for the 📸 share picture)
const pile = new SessionPile();
let pileGroup = 0;
const matsCache = new WeakMap();
function matsOf(r) {
  if (!matsCache.has(r)) {
    const b = buildObject(r), out = {};
    for (const p of b.parts) out[p.matKind] = (out[p.matKind] || 0) + p.mass * (r.count || 1);
    b.group.traverse(o => o.geometry && o.geometry.dispose());
    matsCache.set(r, out);
  }
  return matsCache.get(r);
}
function logItem(root, head) {
  if (root.logged) return;
  root.logged = true;
  pile.addItem(root.recipe, head, root.mass0, matsOf(root.recipe));
}

// physical strength of a recipe (cached) and of any body (fragments scale from their parent)
const physCache = new WeakMap();
function recipePhys(r) {
  if (!physCache.has(r)) { const b = buildObject(r); physCache.set(r, strengthOf(r, b)); b.group.traverse(o => o.geometry && o.geometry.dispose()); }
  return physCache.get(r);
}
function physFor(rec) {
  const s = recipePhys(rec.recipe);
  if (!rec.level) return s;
  return scaleStrength(s, rec.mass / Math.max(rec.root.mass0 / (rec.recipe.count || 1), 1e-6));
}

const ray = new THREE.Raycaster();
const qInv = () => rig.quaternion.clone().invert();
// DROP IT!: drop the selected object straight down the middle of the hopper
function pullHatch() {
  const h = $('hatch');
  if (!armed) {
    h.classList.remove('wiggle'); void h.offsetWidth; h.classList.add('wiggle');
    toast(compactUI() ? 'Pick something from the tray first' : 'Pick something from the tray first, then pull DROP IT!');
    return;
  }
  audio.start();
  h.classList.add('pulled');
  audio.hit('thunk', 4000); setTimeout(() => audio.hit('clang', 900), 90);
  setTimeout(() => h.classList.remove('pulled'), 520);
  const rad = recipeRadius(armed), lim = Math.max(0, Math.min(0.35, TUN.R - rad - 0.3));
  const a = Math.random() * Math.PI * 2, r = Math.random() * lim;
  const wp = new THREE.Vector3(Math.cos(a) * r, TUN.groundX + 1.4 + Math.min(1.2, rad * 0.6), Math.sin(a) * r);
  const wv = new THREE.Vector3((Math.random() - 0.5) * 0.3, -3, (Math.random() - 0.5) * 0.3);
  spawnRecipe(armed, rig.worldToLocal(wp), wv.applyQuaternion(qInv()));
  if (compactUI()) $('card').hidden = true;
}

function throwArmed(sx, sy, swipe) {
  if (!armed) return;
  audio.start();
  // aim: where the pointer ray meets a level plane just above the intake (world space)
  const rc = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2((sx - rc.left) / rc.width * 2 - 1, -((sy - rc.top) / rc.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const topY = TUN.groundX + 1.4;
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -topY);
  let wp = new THREE.Vector3();
  if (!ray.ray.intersectPlane(plane, wp) || wp.distanceTo(camera.position) > 60) wp.set((Math.random() - 0.5) * 1.5, topY, (Math.random() - 0.5) * 1.5);
  const rr = Math.hypot(wp.x, wp.z), lim = Math.max(0.15, TUN.R - Math.max(0.5, recipeRadius(armed) + 0.25));
  if (rr > lim) { wp.x *= lim / rr; wp.z *= lim / rr; }
  wp.y = topY;
  // launching from inside the tube (Blades camera): drop it just in front of the lens
  const cl = rig.worldToLocal(camera.position.clone());
  if (cl.x > 0 && cl.x < TUN.L && Math.hypot(cl.y, cl.z) < TUN.R) wp = camera.position.clone().add(ray.ray.direction.clone().multiplyScalar(1.2));
  let wv = new THREE.Vector3((Math.random() - 0.5) * 0.8, -1.5, (Math.random() - 0.5) * 0.8);
  if (swipe) {
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const k = 0.012;
    wv = right.multiplyScalar(swipe.x * k).add(up.multiplyScalar(-swipe.y * k));
    wv.y -= 2;
    if (wv.length() > 30) wv.setLength(30);
  }
  spawnRecipe(armed, rig.worldToLocal(wp), wv.applyQuaternion(qInv()));
  if (compactUI()) $('card').hidden = true;
}

function chaos() {
  if (jam || repairing) { toast('The fan is out of order. Repair it first.'); return; }
  const list = recipes.filter(r => r.id !== 'anvil' && r.mass < 150);
  for (let i = 0; i < 8; i++) setTimeout(() => {
    const r = list[(Math.random() * list.length) | 0];
    const sp = Math.max(0.2, 2 * (TUN.R - Math.max(0.5, recipeRadius(r) + 0.25)));
    spawnRecipe(r, new THREE.Vector3(-1.4 - Math.max(0, recipeRadius(r) - 0.4), (Math.random() - 0.5) * sp, (Math.random() - 0.5) * sp), new THREE.Vector3(1 + Math.random() * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2));
  }, i * 260);
  if (rotor.setpoint < 0.3) { $('throttle').value = 80; $('throttle').oninput(); }  // chaos needs the shredder
  toast('CHAOS');
}

let verdictTimer = 0;
function showVerdict(r, head, quip, stats) {
  const v = $('verdict');
  v.className = head.startsWith('IT BLENDS') ? 'blend' : head.startsWith('PART') ? 'part' : head.includes('JAMMED') ? 'jam' : 'survive';
  v.innerHTML = `<div class="ic">${r.icon || '✨'}</div><div><div class="hd">${head}</div><div class="nm">${escapeHtml(r.name)}</div><div class="q">${escapeHtml(quip)}</div>${stats ? `<div class="st">${stats}</div>` : ''}</div>`;
  v.hidden = false;
  v.classList.remove('pop'); void v.offsetWidth; v.classList.add('pop');
  clearTimeout(verdictTimer); verdictTimer = setTimeout(() => { v.hidden = true; }, 4200);
}

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2600);
}

// thumbnails: render each recipe once in a tiny offscreen renderer
let thumbR = null;
function thumbRenderer() {
  if (thumbR) return thumbR;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  r.setSize(128, 128, false);
  r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping;
  const s = new THREE.Scene();
  // textures can't be shared across WebGL contexts, so the thumbnail renderer gets its own environment
  s.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
  s.add(new THREE.HemisphereLight('#ffffff', '#445', 1.2));
  const d = new THREE.DirectionalLight('#fff', 2); d.position.set(2, 3, 4); s.add(d);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  thumbR = { r, s, cam, canvas };
  return thumbR;
}
function renderThumb(rec, target) {
  const T = thumbRenderer();
  const built = buildObject(rec);
  const g = built.group;
  g.rotation.set(0.25, -0.6, 0.05);
  T.s.add(g);
  g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g);
  const sph = box.getBoundingSphere(new THREE.Sphere());
  const size = box.getSize(new THREE.Vector3());
  const dist = Math.max(size.x, size.y, size.z) * 0.62 / Math.tan(15 * Math.PI / 180);
  T.cam.position.copy(sph.center).add(new THREE.Vector3(0.3, 0.35, 1).normalize().multiplyScalar(dist));
  T.cam.lookAt(sph.center);
  T.r.render(T.s, T.cam);
  const c = target.getContext('2d');
  c.clearRect(0, 0, target.width, target.height);
  c.drawImage(T.canvas, 0, 0, target.width, target.height);
  T.s.remove(g);
  g.traverse(o => o.geometry && o.geometry.dispose());
}
function renderThumbs() {
  document.querySelectorAll('#tray .item[data-id]').forEach(el => {
    const r = recipes.find(x => x.id === el.dataset.id);
    if (r) renderThumb(r, el.querySelector('canvas'));
  });
}

// ------------------------------------------------------------------------------- Claude maker
// ---- shred tickets: one shared hourly pool of new Claude designs (see worker/worker.js)
let quota = null, quotaAt = 0, quotaAsked = 0;
async function refreshQuota({ shelf = false } = {}) {
  quotaAsked = performance.now();
  const q = await claudeGen.fetchQuota({ shelf });
  if (q) { quota = q; quotaAt = performance.now(); }
  if (q && q.wire >= 2 && drops) drops.slim = true;
  if (q && Array.isArray(q.items)) { warehouse = q.items; warehouseAt = performance.now(); renderWarehouse(); }
  else if (shelf) loadWarehouse();   // an older Worker doesn't bundle the shelf with the board
  safety?.update(quota, { jammed: !!jam });
  renderTickets();
}
function renderTickets() {
  const sign = $('tickets'), badge = $('tixBadge');
  if (!quota || !quota.on) { sign.hidden = true; if (badge) badge.hidden = true; return; }
  const ms = Math.max(0, quota.resetsIn - (performance.now() - quotaAt));
  if (ms <= 0 && performance.now() - quotaAsked > 5000) refreshQuota();   // a new hour, a new batch
  const empty = quota.poolLeft <= 0;
  sign.hidden = false; sign.classList.toggle('empty', empty);
  const closed = quota.open === false;
  sign.classList.toggle('closed', closed);
  $('tixClosed').hidden = !closed;
  if (closed) {
    const os = Math.max(0, Math.ceil((quota.opensIn - (performance.now() - quotaAt)) / 1000));
    if (os <= 0 && performance.now() - quotaAsked > 5000) refreshQuota();
    $('tixWhy').textContent = quota.excuse || 'Claude went home.';
    $('tixOpens').textContent = `${Math.floor(os / 3600)}:${String(Math.floor(os / 60) % 60).padStart(2, '0')}:${String(os % 60).padStart(2, '0')}`;
  }
  $('tixLeft').textContent = quota.poolLeft;
  $('tixPool').textContent = quota.pool;
  const bu = quota.boostUntil && Date.parse(quota.boostUntil);
  $('tixBoost').hidden = !(bu > Date.now());
  if (bu > Date.now()) $('tixBoost').textContent = ` · ⚡ demo boost until ${new Date(bu).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  $('tixLabel').textContent = empty ? 'OUT OF TICKETS' : quota.poolLeft === 1 ? 'TICKET LEFT THIS HOUR' : 'TICKETS LEFT THIS HOUR';
  const s = Math.ceil(ms / 1000);
  $('tixClock').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  $('tixYou').textContent = Math.min(claudeGen.myTicketsLeft(), quota.poolLeft);
  if (badge) { badge.hidden = false; badge.textContent = closed ? 'CLOSED' : '🎟 ' + quota.poolLeft; badge.classList.toggle('empty', empty || closed); }
  updateMakeButton();
}

// ---- the Warehouse: everything anyone has fabricated, free to throw
let warehouse = [], warehouseAt = 0;
async function loadWarehouse() {
  if (performance.now() - warehouseAt < 60000 && warehouse.length) { renderWarehouse(); return; }
  warehouse = await claudeGen.fetchWarehouse(); warehouseAt = performance.now();
  renderWarehouse();
}
function shelfMatch() {
  const v = $('makeIn').value, k = objectKey(v), lk = looseKey(v);
  return k ? warehouse.find(w => w.k === k) || warehouse.find(w => looseKey(w.k) === lk) || null : null;
}
// already in the tray (a built-in like the fridge, or something made this session)? no Claude needed
function trayMatch() {
  const lk = looseKey($('makeIn').value);
  if (!lk || lk.length < 3) return null;
  return recipes.find(r => r.id !== 'blade-shard' && (looseKey(r.name) === lk || (lk.length >= 4 && looseKey(r.name).endsWith(' ' + lk)))) || null;
}
function renderWarehouse() {
  const box = $('whouse');
  box.hidden = !warehouse.length && !quota;
  if (box.hidden) return;
  $('whCount').textContent = warehouse.length ? `· ${warehouse.length} thing${warehouse.length === 1 ? '' : 's'}` : '';
  const q = objectKey($('makeIn').value), m = shelfMatch();
  const list = warehouse.filter(w => !q || w.k.includes(q) || objectKey(w.name).includes(q)).slice(0, 120);
  const el = $('whList'); el.innerHTML = '';
  if (!list.length) { el.innerHTML = `<span class="none">${warehouse.length ? 'Nothing like that on the shelf yet. Make it!' : 'Empty shelves. Be the first to fabricate something.'}</span>`; }
  for (const w of list) {
    const b = document.createElement('button');
    b.textContent = `${w.icon || '✨'} ${w.name}`;
    if (m && m.k === w.k) b.classList.add('match');
    b.onclick = () => grabFromShelf(w);
    el.appendChild(b);
  }
  updateMakeButton();
}
function updateMakeButton() {
  const m = shelfMatch(), closed = quota && quota.open === false, out = quota && quota.poolLeft <= 0;
  const btn = $('makeGo');
  if (trayMatch()) { btn.textContent = 'In the tray (free)'; btn.disabled = false; }
  else if (m) { btn.textContent = 'Grab it (free)'; btn.disabled = false; }
  else { btn.textContent = closed ? 'Closed' : 'Make it'; btn.disabled = !!(closed || (out && quota)) || btn.dataset.busy === '1'; }
}
async function grabFromShelf(w) {
  $('makeMsg').textContent = `Fetching ${w.icon || ''} ${w.name} from the Warehouse…`;
  try {
    const raw = await claudeGen.fetchShelfItem(w.k);
    const r = addGenerated(raw);
    stats.count('grabs');
    $('maker').hidden = true;
    toast(`🏬 ${r.icon} ${r.name}, fresh off the Warehouse shelf (free). Throw it.`);
  } catch (e) { $('makeMsg').textContent = e.message || String(e); }
}

async function openMaker() {
  $('maker').hidden = false;
  // one request for the ticket board and the Warehouse shelf together
  if (performance.now() - warehouseAt < 60000 && warehouse.length) { renderWarehouse(); if (performance.now() - quotaAsked > 15000) refreshQuota(); }
  else { renderWarehouse(); refreshQuota({ shelf: true }); }
  $('makeMsg').textContent = '';
  const ok = await generatorAvailable();
  $('makeNote').innerHTML = ok
    ? 'Claude designs it: shape, mass, materials, what sprays out and what it sounds like. Things someone already designed are free.'
    : 'Typing objects needs Claude: open the <b>Claude-hosted</b> version of Tunnel, or set up the Worker described in the README.';
  $('makeGo').disabled = !ok;
  if (ok) updateMakeButton();
  setTimeout(() => $('makeIn').focus(), 50);
}

async function runMaker() {
  const what = $('makeIn').value.trim().slice(0, 60);
  if (!what) return;
  const t = trayMatch();
  if (t) { arm(t); $('maker').hidden = true; toast(`${t.icon} ${t.name} is already in the tray. Free, no ticket.`); return; }
  const m = shelfMatch();
  if (m) return grabFromShelf(m);
  $('makeGo').dataset.busy = '1'; $('makeGo').disabled = true;
  $('makeMsg').textContent = '';
  const fab = startFab(what);
  try {
    const raw = await generateRecipe(what, recipePrompt(what));
    const r = sanitizeRecipe(raw);
    await fab.finish(r.icon);
    addGenerated(raw);
    $('maker').hidden = true;
    if (quota && claudeGen.poolLeft !== null) { quota.poolLeft = claudeGen.poolLeft; quota.youLeft = Math.min(claudeGen.designsLeft ?? quota.youLeft, quota.poolLeft); renderTickets(); }
    const left = claudeGen.designsLeft;
    if (claudeGen.lastFromShelf) toast(`🏬 ${r.icon} ${r.name} was already in the Warehouse: free!`);
    else { warehouseAt = 0; stats.count('designs'); }   // it's on the shelf now
    if (!claudeGen.lastFromShelf && left !== null && left <= 5) toast(`${r.icon} ${r.name} is ready. ${left === 0 ? 'That was your last new design this hour.' : `${left} new design${left === 1 ? '' : 's'} left this hour.`}`);
  } catch (e) {
    fab.fail();
    $('makeMsg').textContent = e.limit ? '⏳ ' + e.message : 'Claude couldn’t build that one: ' + (e.message || e);
    if (e.limit) refreshQuota();
  } finally { fab.stop(); $('makeGo').dataset.busy = '0'; updateMakeButton(); }
}

// The Fabricator: something to watch while Claude designs the object (usually 10–40 s).
// Progress is honest about not knowing: it creeps toward 95% on a ~12 s time constant and
// only jumps to 100% when the design actually arrives.
const FAB_STEPS = ['Reading the work order', 'Sketching the shape', 'Choosing materials', 'Weighing it', 'Working out how it breaks', 'Tuning the crunch'];
const FAB_QUIPS = ['Consulting Claude about the aerodynamics of', 'Estimating the shear strength of', 'Calculating how many pieces make', 'Asking the fan’s lawyer about', 'Looking up the density of', 'Rummaging for parts for', 'Arguing about the colour of', 'Checking the warranty on'];
const FAB_SHAPES = ['📦', '🔩', '🧱', '⚙️', '🪵', '🧲', '🔧', '🪛', '🧊', '🛢️'];
function startFab(what) {
  const el = $('fab'), steps = $('fabSteps'), thing = $('fabThing');
  el.hidden = false; el.classList.remove('done', 'fail');
  $('fabWhat').textContent = what.toUpperCase();
  steps.innerHTML = FAB_STEPS.map(t => `<li>${t}</li>`).join('');
  $('fabFill').style.width = '2%';
  document.querySelector('#maker .chips').hidden = true;
  $('makeIn').disabled = true;
  const t0 = performance.now(); let qi = (Math.random() * FAB_QUIPS.length) | 0, si = 0, tick = 0;
  const quip = () => { $('fabQuip').textContent = `${FAB_QUIPS[qi++ % FAB_QUIPS.length]} “${what}”…`; };
  quip();
  const timer = setInterval(() => {
    const t = (performance.now() - t0) / 1000;
    const p = 0.95 * (1 - Math.exp(-t / 12));
    $('fabFill').style.width = (2 + p * 98).toFixed(1) + '%';
    $('fabTime').textContent = t < 60 ? `${t | 0}s` : `${(t / 60) | 0}m ${String((t | 0) % 60).padStart(2, '0')}s`;
    const on = Math.min(FAB_STEPS.length - 1, Math.floor(p / 0.95 * FAB_STEPS.length));
    [...steps.children].forEach((li, i) => { li.className = i < on ? 'done' : i === on ? 'on' : ''; });
    if (++tick % 4 === 0) { thing.classList.remove('wire'); thing.textContent = FAB_SHAPES[si++ % FAB_SHAPES.length]; }
    if (tick % 13 === 0) quip();
    if (t > 45 && tick % 13 === 6) $('fabQuip').textContent = 'Still going. Big ideas take a while…';
  }, 200);
  thing.classList.add('wire'); thing.textContent = '?';
  let stopped = false;
  const stop = () => {
    if (stopped) return; stopped = true; clearInterval(timer);
    document.querySelector('#maker .chips').hidden = false;
    $('makeIn').disabled = false;
    setTimeout(() => { if (!el.classList.contains('fail')) el.hidden = true; }, 0);
  };
  return {
    stop,
    finish: (icon) => new Promise(res => {
      clearInterval(timer);
      [...steps.children].forEach(li => { li.className = 'done'; });
      $('fabFill').style.width = '100%';
      thing.classList.remove('wire'); thing.textContent = icon || '✨';
      $('fabQuip').textContent = 'Done. Fresh off the line.';
      el.classList.add('done');
      setTimeout(res, 750);
    }),
    fail: () => {
      clearInterval(timer);
      el.classList.add('fail');
      thing.classList.remove('wire'); thing.textContent = '💥';
      const on = steps.querySelector('li.on'); if (on) on.className = '';
      $('fabQuip').textContent = 'The Fabricator jammed.';
    },
  };
}

function addGenerated(raw) {
  const r = sanitizeRecipe(raw);
  r.id = 'gen-' + Date.now();
  buildObject(r);   // throws early if the recipe can't be built
  recipes.push(r);
  const el = addTrayItem(r, true);
  renderThumb(r, el.querySelector('canvas'));
  arm(r);
  toast(`${r.icon} ${r.name} is ready. Throw it.`);
  return r;
}

window.tunnel = { get pileCam() { return pileCam; }, openHatch: () => openPayloadHatch('lever'), get payload() { return payloadStat; }, get hatchState() { return hatchState; }, pile, share: () => openShare(), phys: (id) => recipePhys(recipes.find(r => r.id === id)), recipes: () => recipes, repair: () => repairFan(), get jam() { return jam; }, bladeDmg, addRecipe: addGenerated, get bodies() { return bodies; }, rotor: () => rotor, air: () => air, spawn: (id, x = -1.4) => spawnRecipe(recipes.find(r => r.id === id), new THREE.Vector3(x, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6), new THREE.Vector3(2, 0, 0)), get drops() { return drops; }, setThrottle: (v) => { $('throttle').value = v; $('throttle').oninput(); }, setCamera, arm: (id) => arm(recipes.find(r => r.id === id)) };

boot().catch(e => { console.error(e); fail(e.message); });
