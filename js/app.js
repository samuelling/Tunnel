// TUNNEL — a giant wind tunnel with a fan at the end. Throw things in. Will it blend?
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import RAPIER from '../lib/rapier.mjs';
import { TUN, FAN, RHO, NU, G, beaufort } from './config.js';
import { Air } from './air.js';
import { aeroLoads, makePanels } from './aero.js';
import { Rotor, buildFan, bladeSweep, bladeAngle } from './fan.js';
import { createRenderer, buildScene, buildColliders } from './scene.js';
import { CATALOG, buildObject, sanitizeRecipe, recipePrompt, MATERIALS } from './objects.js';
import { shatterMesh, chunkMaterial } from './fracture.js';
import { Particles } from './particles.js';
import { Audio } from './audio.js';
import { generateRecipe, generatorAvailable } from './claude.js';

const $ = (id) => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches;
const MAX_BODIES = isTouch ? 170 : 260;
const DT = 1 / 180;

let renderer, scene, camera, controls, world, eventQueue, air, rotor, fan, particles, tunnel;
const audio = new Audio();
const bodies = [];
const byCollider = new Map();
const pending = [];          // deferred breaks this step
let simTime = 0, timeScale = 1, bulletUntil = 0, autoBullet = true, smokeOn = false, shake = 0;
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
  ({ scene, tunnel } = buildScene(renderer));
  camera = new THREE.PerspectiveCamera(48, 1, 0.05, 200);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 1; controls.maxDistance = 45;
  setCamera(0, true);

  world = new RAPIER.World({ x: 0, y: -G, z: 0 });
  world.timestep = DT;
  world.integrationParameters.numSolverIterations = 6;
  eventQueue = new RAPIER.EventQueue(true);
  buildColliders(world, RAPIER);

  air = new Air();
  rotor = new Rotor();
  fan = buildFan();
  scene.add(fan.group);
  particles = new Particles(scene);

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
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // keep a usable horizontal field of view on portrait phones
  const hfov = 68 * Math.PI / 180;
  camera.fov = Math.min(84, Math.max(48, 2 * Math.atan(Math.tan(hfov / 2) / camera.aspect) * 180 / Math.PI));
  camera.updateProjectionMatrix();
  particles.setScale(renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360)));
}

// ------------------------------------------------------------------------------- cameras
const CAMS = [
  { name: 'Overview', pos: [-5.5, 7.5, 15], tgt: [8, 2.6, 0] },
  { name: 'Feeder', pos: [-7.5, 3.9, 2.2], tgt: [10, 3, 0] },
  { name: 'Blades', pos: [TUN.fanX - 4.2, TUN.y0 + 0.7, 1.1], tgt: [TUN.fanX, TUN.y0 - 0.2, 0] },
  { name: 'Window', pos: [TUN.fanX - 3.2, TUN.y0 + 0.6, 5.2], tgt: [TUN.fanX - 0.8, TUN.y0, 0] },
  { name: 'Exit', pos: [TUN.L + 7, 4.5, 5], tgt: [TUN.fanX, 3, 0] },
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
  scene.add(group);
  group.position.copy(pos); group.quaternion.copy(quat);
  bodies.push(rec);
  root.live.add(rec);
  return rec;
}

function removeBody(rec, reason) {
  const i = bodies.indexOf(rec);
  if (i < 0) return;
  bodies.splice(i, 1);
  for (const h of rec.colliders) byCollider.delete(h);
  world.removeRigidBody(rec.body);
  scene.remove(rec.group);
  rec.group.traverse(o => { if (o.isMesh && o.userData.ownGeo) o.geometry.dispose(); });
  rec.root.live.delete(rec);
  if (reason === 'exit') rec.root.exitedMax = Math.max(rec.root.exitedMax, rec.mass);
  if (reason === 'dissolve') rec.root.dissolved += rec.mass;
}

function newRoot(recipe) {
  const r = { id: Math.random(), recipe, mass0: 0, live: new Set(), exitedMax: 0, dissolved: 0, firstHit: 0, maxE: 0, rpmDrop: 0, pieces: 0, done: false, thrown: simTime };
  roots.set(r.id, r);
  return r;
}

function spawnRecipe(recipe, pos, vel) {
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

  const severity = E / Math.max(r.toughness * (rec.level ? Math.pow(rec.mass / root.mass0 * (r.count || 1), 0.66) : 1), 1e-3);
  const separate = rec.level === 0 && rec.parts.length > 1 && severity < 2.5;
  scene.remove(rec.group);
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
      const tq = r.toughness * Math.pow(cmass / (root.mass0 / (r.count || 1)), 0.66);
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
  air.update(dt, rotor.omega);
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

  world.step(eventQueue);

  eventQueue.drainContactForceEvents(ev => {
    const f = ev.totalForceMagnitude();
    for (const h of [ev.collider1(), ev.collider2()]) {
      const rec = byCollider.get(h);
      if (rec && rec.level === 0 && rec.impact > 0 && f > rec.impact && !rec.dead) { rec.dead = true; pending.push({ rec, E: rec.recipe.toughness * 1.5, kind: 'impact' }); }
    }
  });

  // blade strikes
  const th0 = rotor.prevTheta, th1 = rotor.theta;
  if (Math.abs(rotor.omega) > 0.2) {
    for (const rec of bodies) {
      if (rec.dead || simTime < rec.cool) continue;
      const t = rec.body.translation();
      const p = new THREE.Vector3(t.x - fanC.x, t.y - fanC.y, t.z - fanC.z);
      const hit = bladeSweep(p, rec.radius, th0, th1);
      if (!hit) continue;
      strike(rec, hit, t);
    }
  }
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
  const toughness = r.toughness * (rec.level ? Math.max(0.05, Math.pow(rec.mass / Math.max(root.mass0 / (r.count || 1), 1e-6), 0.66)) : 1);
  if (!r.unbreakable && (rec.level > 0 && (rec.radius < 0.035 || rec.mass < 0.003 * root.mass0))) { dissolve(rec, vNew, E); return; }
  if (!r.unbreakable && E > toughness) { rec.dead = true; breakBody(rec, E, vNew, contact); return; }
  // bounce: apply the strike impulse at the blade side of the body
  const pt = new THREE.Vector3(t.x, t.y, t.z).addScaledVector(nc, -rec.radius * 0.6);
  rec.body.applyImpulseAtPoint({ x: nc.x * J, y: nc.y * J, z: nc.z * J }, { x: pt.x, y: pt.y, z: pt.z }, true);
  if (r.unbreakable) audio.hit(r.sound, E);
}

function hitRoot(root, E, w0) {
  root.maxE = Math.max(root.maxE, E);
  if (!root.firstHit) { root.firstHit = simTime; root.rpm0 = Math.abs(w0) * 60 / (2 * Math.PI); }
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
function showTally() { const el = $('tally'); if (el) el.textContent = tally.n ? `Shredded so far: ${tally.n} things · ${tally.kg < 1 ? Math.round(tally.kg * 1000) + ' g' : tally.kg.toFixed(1) + ' kg'} · ${tally.pieces.toLocaleString()} pieces` : ''; }

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
  showVerdict(r, head, quip, parts.join(' · '));
  if (!r.unbreakable) addTally(root, score, Math.max(n, root.pieces));
}

const fmtMass = (m) => m >= 1 ? `${m.toFixed(1)} kg` : `${Math.round(m * 1000)} g`;
const fmtE = (e) => e >= 1000 ? `${(e / 1000).toFixed(1)} kJ` : `${e.toFixed(e < 10 ? 1 : 0)} J`;

// ------------------------------------------------------------------------------- loop
let last = performance.now(), acc = 0, frames = 0;
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
    if (t.x > TUN.L + 30 || t.y < -2 || Math.abs(t.z) > 35 || t.x < -30) removeBody(rec, 'exit');
    else if (rec.level > 0 && t.y < 0.6 && simTime - rec.born > 90 && (t.x < 0 || t.x > TUN.L)) removeBody(rec, 'dissolve');
  }
  checkVerdicts();

  if (smokeOn && air.U > 0.3) {
    for (let k = 0; k < 6; k++) {
      const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * 3.4;
      particles.emit('smoke', { x: -1.8, y: TUN.y0 + Math.cos(a) * rr, z: Math.sin(a) * rr }, { x: 0, y: 0, z: 0 }, 1, 0.05);
    }
  }
  particles.update(fdt * ts, air);

  // fan visuals
  fan.rotor.rotation.x = rotor.theta;
  const sp = Math.abs(rotor.omega);
  const blur = Math.max(0, Math.min(0.75, (sp * ts - 7) / 25));
  fan.disc.material.opacity = blur;
  for (const m of fan.mats) m.opacity = 1 - blur * 0.85;
  const on = rotor.setpoint > 0 || sp > 1;
  tunnel.beaconMat.emissiveIntensity = on ? 0.6 + 2 * Math.max(0, Math.sin(now / 160)) : 0.1;
  tunnel.beaconLight.intensity = on ? 30 : 0;
  tunnel.beaconLight.target.position.set(tunnel.beacon.position.x + Math.cos(now / 300) * 6, 0, Math.sin(now / 300) * 6);

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
      const p = best.group.position;
      const d = new THREE.Vector3(-3.2, 1.4, 2.6);
      controls.target.lerp(p, 0.12);
      camera.position.lerp(p.clone().add(d), 0.06);
    }
  }
  controls.update();
  if (shake > 0.001) {
    const s = shake * 0.06;
    camera.position.x += (Math.random() - 0.5) * s; camera.position.y += (Math.random() - 0.5) * s;
    shake *= Math.pow(0.02, fdt);
  }
  renderer.render(scene, camera);
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
  const rpm = Math.abs(rotor.rpm);
  $('rpm').textContent = rpm.toFixed(0);
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
  make.innerHTML = '<span class="ic">✨</span><span class="nm">Type anything</span>';
  make.onclick = openMaker;
  tray.appendChild(make);
  for (const r of recipes) addTrayItem(r);
  renderThumbs();

  const thr = $('throttle');
  const setThr = () => {
    rotor.setpoint = thr.value / 100;
    $('thrOut').textContent = thr.value > 0 ? `${(FAN.phi * rotor.setpoint * FAN.omegaMax * FAN.Rtip).toFixed(0)} m/s` : 'OFF';
  };
  thr.oninput = setThr; setThr();
  $('btnCam').onclick = () => setCamera((camMode + 1) % CAMS.length);
  $('btnSlow').onclick = () => { timeScale = timeScale === 1 ? 0.25 : timeScale === 0.25 ? 0.06 : 1; $('btnSlow').classList.toggle('on', timeScale < 1); };
  $('btnBullet').onclick = () => { autoBullet = !autoBullet; $('btnBullet').classList.toggle('on', autoBullet); toast(autoBullet ? 'Auto bullet-time on: slows down right before the chop' : 'Auto bullet-time off'); };
  $('btnBullet').classList.toggle('on', autoBullet);
  $('btnSmoke').onclick = () => { smokeOn = !smokeOn; $('btnSmoke').classList.toggle('on', smokeOn); };
  $('btnSound').onclick = () => { audio.setEnabled(!audio.enabled); $('btnSound').classList.toggle('on', audio.enabled); $('btnSound').textContent = audio.enabled ? '🔊' : '🔇'; };
  $('btnSound').classList.add('on');
  $('btnGust').onclick = () => { air.gust = 2.5; toast('Gust!'); };
  $('btnChaos').onclick = chaos;
  $('btnClear').onclick = () => { for (const b of [...bodies]) removeBody(b, 'dissolve'); particles.clear(); roots.clear(); };
  $('btnInfo').onclick = () => { $('info').hidden = !$('info').hidden; };
  $('infoClose').onclick = () => { $('info').hidden = true; };
  $('start').onclick = () => {
    $('start').hidden = true; audio.start();
    if (rotor.setpoint === 0) { thr.value = 70; setThr(); }
    toast(isTouch ? 'Pick something below, then flick it at the tunnel' : 'Pick something below, then click or flick to throw it');
  };
  // maker dialog
  $('makeGo').onclick = runMaker;
  $('makeIn').onkeydown = (e) => { if (e.key === 'Enter') runMaker(); };
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
    if (e.code === 'Space' && armed) { e.preventDefault(); throwArmed(innerWidth / 2, innerHeight / 2, null); }
    if (e.key === 'c') setCamera((camMode + 1) % CAMS.length);
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
  $('card').innerHTML = `<b>${escapeHtml(r.name)}</b>
    <div class="facts"><span>mass <i>${fmtMass(m)}</i></span><span>size <i>${Lc.toFixed(2)} m</i></span><span>drag area <i>${(cda * 1e4).toFixed(0)} cm²</i></span>
    <span>terminal velocity <i>${vt.toFixed(1)} m/s</i></span><span>lifts off in <i>${bf.name.toLowerCase()}</i></span><span>Re now <i>${Re > 1e4 ? Re.toExponential(1) : Re.toFixed(0)}</i></span></div>
    ${r.fact ? `<p>${escapeHtml(r.fact)}</p>` : ''}<p class="hint">${isTouch ? 'Flick on the scene to throw · two fingers to look around' : 'Click or flick to throw · right-drag to look around · space = toss'}</p>`;
  $('card').hidden = false;
  clearTimeout(showCard.h);
  if (isTouch) showCard.h = setTimeout(() => { $('card').hidden = true; }, 6000);
}

const ray = new THREE.Raycaster();
function throwArmed(sx, sy, swipe) {
  if (!armed) return;
  audio.start();
  // aim: where the pointer ray meets the plane x = −1.8 just in front of the intake
  const ndc = new THREE.Vector2(sx / innerWidth * 2 - 1, -(sy / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const plane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 1.8);
  let pos = new THREE.Vector3();
  if (!ray.ray.intersectPlane(plane, pos) || pos.distanceTo(camera.position) > 40) pos.set(-1.8, TUN.y0 + 0.4, 0);
  // keep it near the intake mouth
  const dy = pos.y - TUN.y0, dz = pos.z, rr = Math.hypot(dy, dz), lim = TUN.R + 1.2;
  if (rr > lim) { pos.y = TUN.y0 + dy * lim / rr; pos.z = dz * lim / rr; }
  pos.y = Math.max(0.4, pos.y);
  if (camera.position.x > 0 && camera.position.x < TUN.L && Math.hypot(camera.position.y - TUN.y0, camera.position.z) < TUN.R) {
    // camera is inside the tube: launch from just in front of it
    pos = camera.position.clone().add(ray.ray.direction.clone().multiplyScalar(1.2));
  }
  let vel = new THREE.Vector3(4.5, 1.2, 0);
  if (swipe) {
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const k = 0.012;
    const sp = Math.min(30, Math.hypot(swipe.x, swipe.y) * k);
    vel = right.multiplyScalar(swipe.x * k).add(up.multiplyScalar(-swipe.y * k));
    vel.x += 3 + sp * 0.6;
    if (vel.length() > 30) vel.setLength(30);
  }
  spawnRecipe(armed, pos, vel);
}

function chaos() {
  const list = recipes.filter(r => r.id !== 'anvil');
  for (let i = 0; i < 8; i++) setTimeout(() => {
    const r = list[(Math.random() * list.length) | 0];
    spawnRecipe(r, new THREE.Vector3(-1.8, TUN.y0 + (Math.random() - 0.3) * 2, (Math.random() - 0.5) * 3), new THREE.Vector3(4 + Math.random() * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 2));
  }, i * 260);
  if (rotor.setpoint < 0.3) { $('throttle').value = 80; $('throttle').oninput(); }
  toast('CHAOS');
}

let verdictTimer = 0;
function showVerdict(r, head, quip, stats) {
  const v = $('verdict');
  v.className = head.startsWith('IT BLENDS') ? 'blend' : head.startsWith('PART') ? 'part' : 'survive';
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
async function openMaker() {
  $('maker').hidden = false;
  $('makeMsg').textContent = '';
  const ok = await generatorAvailable();
  $('makeNote').innerHTML = ok
    ? 'Claude designs it: shape, mass, toughness, what sprays out and what it sounds like.'
    : 'Typing objects needs Claude: open the <b>Claude-hosted</b> version of Tunnel, or set up the Worker described in the README.';
  $('makeGo').disabled = !ok;
  setTimeout(() => $('makeIn').focus(), 50);
}

async function runMaker() {
  const what = $('makeIn').value.trim().slice(0, 60);
  if (!what) return;
  $('makeGo').disabled = true;
  const quips = ['Consulting Claude about the aerodynamics of', 'Estimating the shear strength of', 'Calculating how many pieces make', 'Asking the fan’s lawyer about'];
  $('makeMsg').textContent = `${quips[(Math.random() * quips.length) | 0]} “${what}”…`;
  try {
    const raw = await generateRecipe(what, recipePrompt(what));
    addGenerated(raw);
    $('maker').hidden = true;
  } catch (e) {
    $('makeMsg').textContent = 'Claude couldn’t build that one: ' + (e.message || e);
  } finally { $('makeGo').disabled = false; }
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

window.tunnel = { addRecipe: addGenerated, get bodies() { return bodies; }, rotor: () => rotor, air: () => air, spawn: (id, x = -1.8) => spawnRecipe(recipes.find(r => r.id === id), new THREE.Vector3(x, TUN.y0 + 0.3, 0), new THREE.Vector3(5, 1, 0)), setThrottle: (v) => { $('throttle').value = v; $('throttle').oninput(); }, setCamera, arm: (id) => arm(recipes.find(r => r.id === id)) };

boot().catch(e => { console.error(e); fail(e.message); });
