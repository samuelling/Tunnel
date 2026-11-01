// GLSL sources for the Tunnel solver and renderer.
// Lattice: D2Q9.  Velocity order: 0 rest, 1 E, 2 N, 3 W, 4 S, 5 NE, 6 NW, 7 SW, 8 SE.
// Textures hold POST-collision populations; each step pulls (streams) then collides.

export const HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DArray;
`;

export const FULLSCREEN_VS = `#version 300 es
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const LATTICE = `
const ivec2 CV[9] = ivec2[9](ivec2(0,0),ivec2(1,0),ivec2(0,1),ivec2(-1,0),ivec2(0,-1),
                             ivec2(1,1),ivec2(-1,1),ivec2(-1,-1),ivec2(1,-1));
const int OPP[9]  = int[9](0,3,4,1,2,7,8,5,6);
const int MIRY[9] = int[9](0,1,4,3,2,8,7,6,5);
const float WT[9] = float[9](4./9.,1./9.,1./9.,1./9.,1./9.,1./36.,1./36.,1./36.,1./36.);
float feq(int k, float rho, vec2 u){
  float cu = dot(vec2(CV[k]), u);
  return WT[k] * rho * (1.0 + 3.0*cu + 4.5*cu*cu - 1.5*dot(u,u));
}
`;

// ---------------------------------------------------------------------------
// Initialise populations to equilibrium at a uniform velocity (+ tiny seed noise
// so symmetric flows can break symmetry the way real ones do).
export const INIT_FS = HEADER + LATTICE + `
uniform vec2 uU;
uniform sampler2D uObs;
layout(location=0) out vec4 oA;
layout(location=1) out vec4 oB;
layout(location=2) out vec4 oC;
layout(location=3) out vec4 oF;
uniform ivec2 uSize;
void main(){
  ivec2 x = ivec2(gl_FragCoord.xy);
  vec4 ob = texelFetch(uObs, x, 0);
  // smooth (not grid-scale) seed perturbation so symmetric wakes can break symmetry
  vec2 xy = vec2(x) / vec2(uSize);
  vec2 pert = uU.x * 0.004 * vec2(0.0, sin(6.2831853*3.0*xy.x) * exp(-pow((xy.y-0.5)*4.0, 2.0)));
  vec2 u = ob.x < 0.0 ? ob.zw : uU + pert;
  float f[9];
  for(int k=0;k<9;k++) f[k] = feq(k, 1.0, u);
  oA = vec4(f[1],f[2],f[3],f[4]);
  oB = vec4(f[5],f[6],f[7],f[8]);
  oC = vec4(f[0], 1.0, u);
  oF = vec4(0.0,0.0,0.0,-1.0);
}`;

// ---------------------------------------------------------------------------
// The core: stream (pull) + interpolated bounce-back + MRT collision with a
// Smagorinsky LES closure, momentum-exchange force measurement.
export const LBM_FS = HEADER + LATTICE + `
uniform sampler2D uA, uB, uC, uObs;
uniform ivec2 uSize;
uniform float uTau0;      // molecular relaxation time
uniform float uCs2;       // Smagorinsky constant squared
uniform int   uSlip;      // 1: free-slip tunnel walls, 0: no-slip
uniform float uUin;       // inlet speed (lattice)
uniform float uTI;        // turbulence intensity (fraction)
uniform float uTime;      // lattice time
uniform vec4  uModes[8];  // inflow turbulence modes: (wavenumber, freq, phase, amp)
uniform int   uSponge;    // outlet sponge length (cells)
uniform vec2  uPivot[8];  // moment reference point for each object (lattice)
uniform vec3  uRates;     // MRT rates: s_e, s_eps, s_q
uniform float uSigma;     // hybrid-regularisation weight (1 = pure populations)

layout(location=0) out vec4 oA;
layout(location=1) out vec4 oB;
layout(location=2) out vec4 oC;
layout(location=3) out vec4 oF;

float getF(ivec2 p, int k){
  if(k == 0) return texelFetch(uC, p, 0).x;
  if(k < 5)  return texelFetch(uA, p, 0)[k-1];
  return texelFetch(uB, p, 0)[k-5];
}

vec2 inletVel(float y){
  float yy = y / float(uSize.y);
  vec2 u = vec2(uUin, 0.0);
  for(int m=0;m<8;m++){
    vec4 md = uModes[m];
    float ph = 6.2831853*md.x*yy + md.y*uTime + md.z;
    u.x += uUin*uTI*md.w*sin(ph);
    u.y += uUin*uTI*md.w*0.8*cos(1.37*ph + md.z*2.1);
  }
  return u;
}

void main(){
  ivec2 x = ivec2(gl_FragCoord.xy);
  vec4 ob = texelFetch(uObs, x, 0);

  // Solid node: hold equilibrium at the wall velocity. If the body moves away and
  // uncovers this node, it re-enters the fluid with a physically sensible state.
  if(ob.x < 0.0){
    vec2 uw = ob.zw;
    float g[9];
    for(int k=0;k<9;k++) g[k] = feq(k, 1.0, uw);
    oA = vec4(g[1],g[2],g[3],g[4]);
    oB = vec4(g[5],g[6],g[7],g[8]);
    oC = vec4(g[0], 1.0, uw);
    oF = vec4(0.0,0.0,0.0,-1.0);
    return;
  }

  vec4 a0 = texelFetch(uA, x, 0);
  vec4 b0 = texelFetch(uB, x, 0);
  vec4 c0 = texelFetch(uC, x, 0);
  float fs[9];
  fs[0]=c0.x; fs[1]=a0.x; fs[2]=a0.y; fs[3]=a0.z; fs[4]=a0.w;
  fs[5]=b0.x; fs[6]=b0.y; fs[7]=b0.z; fs[8]=b0.w;

  float f[9];
  f[0] = fs[0];
  vec3 frc = vec3(0.0);
  float hit = -1.0;
  bool near = ob.x < 1.5;   // only nodes within ~1 link of a surface can touch it

  for(int k=1;k<9;k++){
    ivec2 n = x - CV[k];
    // tunnel walls (top/bottom), located halfway between nodes
    if(n.y < 0 || n.y >= uSize.y){
      if(uSlip == 1){
        ivec2 ns = ivec2(clamp(n.x, 0, uSize.x-1), x.y);
        f[k] = getF(ns, MIRY[k]);
      } else {
        f[k] = fs[OPP[k]];
      }
      continue;
    }
    if(n.x < 0){ f[k] = 0.0; continue; }          // inlet: replaced below
    if(n.x >= uSize.x) n.x = uSize.x - 1;           // outlet: zero-gradient
    if(near){
      vec4 on = texelFetch(uObs, n, 0);
      if(on.x < 0.0){
        // Link from x towards the solid is direction i = OPP[k].  The wall sits a
        // fraction q along it (from the signed distance field) -> Bouzidi.
        int i = OPP[k];
        float q = clamp(ob.x / (ob.x - on.x), 0.0, 1.0);
        vec2 uw = on.zw;
        float cu = dot(vec2(CV[k]), uw);
        float fi = fs[i];
        float fk;
        if(q < 0.5){
          ivec2 x2 = x + CV[k];
          bool ok = x2.x >= 0 && x2.y >= 0 && x2.x < uSize.x && x2.y < uSize.y
                    && texelFetch(uObs, x2, 0).x >= 0.0;
          if(ok) fk = 2.0*q*fi + (1.0-2.0*q)*getF(x2, i) + 6.0*WT[k]*cu;
          else   fk = fi + 6.0*WT[k]*cu;
        } else {
          fk = fi/(2.0*q) + (2.0*q-1.0)/(2.0*q)*fs[k] + 3.0*WT[k]*cu/q;
        }
        f[k] = fk;
        // Galilean-invariant momentum exchange (Wen et al. 2014)
        vec2 ci = vec2(CV[i]);
        vec2 ck = vec2(CV[k]);
        vec2 df = (ci - uw)*fi - (ck - uw)*fk;
        int id = int(on.y + 0.5);
        vec2 r = vec2(x) + q*ci - uPivot[id];
        frc += vec3(df, r.x*df.y - r.y*df.x);
        hit = on.y;
        continue;
      }
    }
    f[k] = getF(n, k);
  }

  // Velocity inlet (equilibrium, density extrapolated from the interior)
  if(x.x == 0){
    float rn = texelFetch(uC, ivec2(1, x.y), 0).y;
    vec2 ui = inletVel(float(x.y));
    for(int k=0;k<9;k++) f[k] = feq(k, rn, ui);
  }

  float rho = 0.0; vec2 j = vec2(0.0);
  for(int k=0;k<9;k++){ rho += f[k]; j += f[k]*vec2(CV[k]); }
  rho = max(rho, 0.2);
  vec2 u = j / rho;

  // ---- MRT moments (Lallemand & Luo 2000) ----
  float sa = f[1]+f[2]+f[3]+f[4];
  float sd = f[5]+f[6]+f[7]+f[8];
  float m_e   = -4.0*f[0] - sa + 2.0*sd;
  float m_eps =  4.0*f[0] - 2.0*sa + sd;
  float m_qx  = -2.0*f[1] + 2.0*f[3] + f[5] - f[6] - f[7] + f[8];
  float m_qy  = -2.0*f[2] + 2.0*f[4] + f[5] + f[6] - f[7] - f[8];
  float m_pxx = f[1] - f[2] + f[3] - f[4];
  float m_pxy = f[5] - f[6] + f[7] - f[8];

  float j2 = dot(j,j)/rho;
  float e_eq   = -2.0*rho + 3.0*j2;
  float eps_eq =  rho - 3.0*j2;
  float pxx_eq = (j.x*j.x - j.y*j.y)/rho;
  float pxy_eq = j.x*j.y/rho;

  float npxx = m_pxx - pxx_eq;
  float npxy = m_pxy - pxy_eq;

  // ---- Smagorinsky sub-grid viscosity from the local non-equilibrium stress ----
  float Q = sqrt(0.5*npxx*npxx + 2.0*npxy*npxy);
  float tau = 0.5*(uTau0 + sqrt(uTau0*uTau0 + 25.455844*uCs2*Q/rho)); // 18*sqrt(2)

  // ---- outlet sponge: raise viscosity, damp toward free stream ----
  float sp = 0.0;
  int xs = uSize.x - uSponge;
  if(x.x > xs){ sp = float(x.x - xs)/float(uSponge); sp *= sp; tau += 1.2*sp; }

  // ---- hybrid regularisation (after Jacob, Malaspinas & Sagaut 2018 / Feng et al. 2019):
  // blend the population stress with its finite-difference estimate from the velocity
  // field. Physically they agree; only the grid-scale noise that tau -> 1/2 cannot damp
  // differs, and that part is removed.
  {
    vec2 ue = texelFetch(uC, ivec2(min(x.x+1, uSize.x-1), x.y), 0).zw;
    vec2 uq = texelFetch(uC, ivec2(max(x.x-1, 0), x.y), 0).zw;
    vec2 un = texelFetch(uC, ivec2(x.x, min(x.y+1, uSize.y-1)), 0).zw;
    vec2 us = texelFetch(uC, ivec2(x.x, max(x.y-1, 0)), 0).zw;
    float dudx = 0.5*(ue.x-uq.x), dvdx = 0.5*(ue.y-uq.y);
    float dudy = 0.5*(un.x-us.x), dvdy = 0.5*(un.y-us.y);
    float fdxx = -2.0/3.0*rho*tau*(dudx - dvdy);
    float fdxy = -1.0/3.0*rho*tau*(dudy + dvdx);
    npxx = uSigma*npxx + (1.0-uSigma)*fdxx;
    npxy = uSigma*npxy + (1.0-uSigma)*fdxy;
  }

  float snu = 1.0/tau;
  float e2   = m_e   - uRates.x*(m_e   - e_eq);
  float eps2 = m_eps - uRates.y*(m_eps - eps_eq);
  float qx2  = m_qx  - uRates.z*(m_qx  + j.x);
  float qy2  = m_qy  - uRates.z*(m_qy  + j.y);
  float pxx2 = pxx_eq + (1.0 - snu)*npxx;
  float pxy2 = pxy_eq + (1.0 - snu)*npxy;

  // ---- back to populations: f = M^T D^-1 m ----
  float r9 = rho/9.0;
  float g[9];
  g[0] = r9 - e2/9.0 + eps2/9.0;
  float ax = r9 - e2/36.0 - eps2/18.0;
  g[1] = ax + j.x/6.0 - qx2/6.0 + pxx2*0.25;
  g[2] = ax + j.y/6.0 - qy2/6.0 - pxx2*0.25;
  g[3] = ax - j.x/6.0 + qx2/6.0 + pxx2*0.25;
  g[4] = ax - j.y/6.0 + qy2/6.0 - pxx2*0.25;
  float dg = r9 + e2/18.0 + eps2/36.0;
  g[5] = dg + ( j.x + j.y)/6.0 + ( qx2 + qy2)/12.0 + pxy2*0.25;
  g[6] = dg + (-j.x + j.y)/6.0 + (-qx2 + qy2)/12.0 - pxy2*0.25;
  g[7] = dg + (-j.x - j.y)/6.0 + (-qx2 - qy2)/12.0 + pxy2*0.25;
  g[8] = dg + ( j.x - j.y)/6.0 + ( qx2 - qy2)/12.0 - pxy2*0.25;

  if(sp > 0.0){
    float w = 0.04*sp;
    vec2 ut = mix(u, vec2(uUin, 0.0), 0.5*sp);
    for(int k=0;k<9;k++) g[k] = mix(g[k], feq(k, 1.0, ut), w);
  }

  oA = vec4(g[1],g[2],g[3],g[4]);
  oB = vec4(g[5],g[6],g[7],g[8]);
  oC = vec4(g[0], rho, u);
  oF = vec4(frc, hit);
}`;

// ---------------------------------------------------------------------------
// Rasterise rigid bodies into the lattice: signed distance (lattice units),
// object id, and local wall velocity (rigid-body kinematics).
export const OBSTACLE_FS = HEADER + `
uniform sampler2DArray uSDF;
uniform int  uN;
uniform vec4 uXf[8];   // tex-centre x, y, cos, sin
uniform vec4 uKin[8];  // scale S (lattice per tex side), omega, vx, vy (of pivot)
uniform vec2 uPiv[8];
uniform float uDil[8];  // dilation (cells) that keeps very thin parts >= ~2.5 cells thick
out vec4 o;
void main(){
  vec2 p = floor(gl_FragCoord.xy);
  float d = 1e4; float id = -1.0; vec2 uw = vec2(0.0);
  for(int i=0;i<8;i++){
    if(i >= uN) break;
    vec4 xf = uXf[i]; vec4 kn = uKin[i];
    vec2 r = p - xf.xy;
    vec2 l = vec2(xf.z*r.x + xf.w*r.y, -xf.w*r.x + xf.z*r.y) / kn.x + 0.5;
    if(l.x <= 0.0 || l.y <= 0.0 || l.x >= 1.0 || l.y >= 1.0) continue;
    float di = texture(uSDF, vec3(l, float(i))).r * kn.x - uDil[i];
    if(di < d){
      d = di; id = float(i);
      vec2 rp = p - uPiv[i];
      uw = kn.zw + kn.y*vec2(-rp.y, rp.x);
      float s = length(uw);
      if(s > 0.3) uw *= 0.3/s;
    }
  }
  o = vec4(d, id, uw);
}`;

// ---------------------------------------------------------------------------
// Force reduction: per-object block sums, then totals accumulated over steps.
export const REDUCE1_FS = HEADER + `
uniform sampler2D uF;
uniform int uBW;
uniform ivec2 uSize;
out vec4 o;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  int k = p.x / uBW;
  int bx = p.x - k*uBW;
  float fk = float(k);
  vec3 s = vec3(0.0);
  for(int j=0;j<16;j++){
    for(int i=0;i<16;i++){
      ivec2 c = ivec2(bx*16+i, p.y*16+j);
      if(c.x >= uSize.x || c.y >= uSize.y) continue;
      vec4 v = texelFetch(uF, c, 0);
      if(abs(v.w - fk) < 0.5) s += v.xyz;
    }
  }
  o = vec4(s, 0.0);
}`;

export const REDUCE2_FS = HEADER + `
uniform sampler2D uP, uAcc;
uniform int uBW, uBH;
out vec4 o;
void main(){
  int k = int(gl_FragCoord.x);
  vec3 s = vec3(0.0);
  for(int j=0;j<uBH;j++)
    for(int i=0;i<uBW;i++)
      s += texelFetch(uP, ivec2(k*uBW+i, j), 0).xyz;
  vec4 a = texelFetch(uAcc, ivec2(k,0), 0);
  o = vec4(a.xyz + s, a.w + 1.0);
}`;

// ---------------------------------------------------------------------------
const VELSAMPLE = `
vec2 velAt(vec2 g){
  g = clamp(g, vec2(0.0), vec2(uSize - 1));
  ivec2 i = ivec2(floor(g));
  vec2 f = g - vec2(i);
  ivec2 i1 = min(i + 1, uSize - 1);
  vec2 a = texelFetch(uC, i, 0).zw;
  vec2 b = texelFetch(uC, ivec2(i1.x, i.y), 0).zw;
  vec2 c = texelFetch(uC, ivec2(i.x, i1.y), 0).zw;
  vec2 d = texelFetch(uC, i1, 0).zw;
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
`;

// Visualisation fields at grid resolution, half-float so they filter smoothly.
export const VISPREP_FS = HEADER + `
uniform sampler2D uC, uObs;
uniform ivec2 uSize;
uniform float uU;     // reference speed (lattice)
uniform float uL;     // reference length (cells)
layout(location=0) out vec4 o0;
layout(location=1) out vec4 o1;
vec4 C(ivec2 p){ return texelFetch(uC, clamp(p, ivec2(0), uSize-1), 0); }
void main(){
  ivec2 x = ivec2(gl_FragCoord.xy);
  vec4 c = C(x);
  vec4 ob = texelFetch(uObs, x, 0);
  vec4 xp = C(x+ivec2(1,0)), xm = C(x-ivec2(1,0)), yp = C(x+ivec2(0,1)), ym = C(x-ivec2(0,1));
  float U = max(uU, 1e-6);
  float speed = length(c.zw)/U;
  float curl = ((xp.w - xm.w) - (yp.z - ym.z))*0.5 * uL / U;
  float cp = (c.y - 1.0)/3.0 / (0.5*U*U);
  float dpy = (yp.y - ym.y)*0.5/3.0 / (0.5*U*U) * uL;
  float dpx = (xp.y - xm.y)*0.5/3.0 / (0.5*U*U) * uL;
  if(ob.x < 0.0){ speed = 0.0; curl = 0.0; }
  o0 = vec4(speed, curl, cp, dpy + 0.35*dpx);
  o1 = vec4(clamp(ob.x, -60.0, 60.0), ob.y, 0.0, 0.0);
}`;

// ---------------------------------------------------------------------------
// Smoke (passive scalar) advection: MacCormack with limiter, RK2 characteristics.
const DYE_COMMON = `
uniform sampler2D uC, uDye;
uniform ivec2 uSize;
uniform float uDt;
` + VELSAMPLE + `
vec2 back(vec2 g, float dt){
  vec2 v1 = velAt(g);
  vec2 v2 = velAt(g - 0.5*dt*v1);
  return g - dt*v2;
}
vec4 dyeAt(vec2 g){ return texture(uDye, (g + 0.5)/vec2(uSize)); }
`;

export const DYE_PRED_FS = HEADER + DYE_COMMON + `
out vec4 o;
void main(){
  vec2 g = floor(gl_FragCoord.xy);
  o = dyeAt(back(g, uDt));
}`;

export const DYE_CORR_FS = HEADER + DYE_COMMON + `
uniform sampler2D uPred, uObs;
uniform vec4 uRake;      // x, count, enabled, rainbow
uniform vec4 uWand;      // x, y, radius, strength
uniform vec3 uWandCol;
uniform float uDecay;
out vec4 o;
vec3 hue(float h){ return clamp(abs(mod(h*6.0+vec3(0.,4.,2.),6.)-3.)-1., 0., 1.); }
void main(){
  vec2 g = floor(gl_FragCoord.xy);
  vec2 uv = (g + 0.5)/vec2(uSize);
  vec4 phi = texture(uDye, uv);
  vec4 pred = texture(uPred, uv);
  // forward-trace the predictor back to here to estimate the error
  vec2 v1 = velAt(g);
  vec2 v2 = velAt(g + 0.5*uDt*v1);
  vec2 gf = g + uDt*v2;
  vec4 back2 = texture(uPred, (gf + 0.5)/vec2(uSize));
  vec4 res = pred + 0.5*(phi - back2);
  // limiter: clamp to the stencil around the departure point
  vec2 gb = back(g, uDt);
  vec2 b0 = floor(gb);
  vec4 s00 = dyeAt(b0), s10 = dyeAt(b0+vec2(1,0)), s01 = dyeAt(b0+vec2(0,1)), s11 = dyeAt(b0+vec2(1,1));
  vec4 mn = min(min(s00,s10),min(s01,s11)), mx = max(max(s00,s10),max(s01,s11));
  res = clamp(res, mn, mx);
  res *= uDecay;
  // smoke rake nozzles
  if(uRake.z > 0.5 && abs(g.x - uRake.x) < 1.5){
    float n = uRake.y;
    float sp = float(uSize.y)/n;
    float yy = (g.y + 0.5)/sp - 0.5;
    float idx = floor(yy + 0.5);
    float dist = abs(yy - idx)*sp;
    if(dist < 0.9 && idx >= 0.0 && idx < n){
      vec3 col = uRake.w > 0.5 ? hue(idx/n*0.85) : vec3(1.0);
      res = vec4(col, 1.0);
    }
  }
  if(uWand.w > 0.0){
    float d = length(g - uWand.xy);
    float a = exp(-d*d/(uWand.z*uWand.z)) * uWand.w;
    res = mix(res, vec4(uWandCol, 1.0), clamp(a,0.,1.));
  }
  vec4 ob = texelFetch(uObs, ivec2(g), 0);
  if(ob.x < 0.0 || g.x < 1.0) res = vec4(0.0);
  o = res;
}`;

// ---------------------------------------------------------------------------
// Tracer particles (seeded flow, like PIV) — advected with RK2.
export const PART_FS = HEADER + `
uniform sampler2D uP, uC, uObs;
uniform ivec2 uSize;
uniform float uDt;
uniform float uFrame;
out vec4 o;
` + VELSAMPLE + `
float hash(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
void main(){
  ivec2 id = ivec2(gl_FragCoord.xy);
  vec4 p = texelFetch(uP, id, 0);
  vec2 g = p.xy;
  vec2 v1 = velAt(g);
  vec2 v2 = velAt(g + 0.5*uDt*v1);
  g += uDt*v2;
  p.z += uDt;
  bool dead = g.x < 0.0 || g.y < 0.0 || g.x > float(uSize.x-1) || g.y > float(uSize.y-1) || p.z > p.w;
  if(!dead){ if(texelFetch(uObs, ivec2(g+0.5), 0).x < 0.0) dead = true; }
  if(dead){
    vec3 s = vec3(vec2(id), uFrame);
    float r1 = hash(s), r2 = hash(s+13.7), r3 = hash(s+71.3);
    g = vec2(r1*float(uSize.x-1), r2*float(uSize.y-1));
    p.z = 0.0;
    p.w = 400.0 + 4000.0*r3;
  }
  o = vec4(g, p.zw);
}`;

export const PART_VS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uP, uC;
uniform ivec2 uPSize;
uniform ivec2 uSize;
uniform float uStreak;
uniform float uU;
uniform float uPointSize;
uniform int uLines;
out float vSpeed;
out float vEnd;
void main(){
  int pid = uLines == 1 ? (gl_VertexID >> 1) : gl_VertexID;
  int end = uLines == 1 ? (gl_VertexID & 1) : 0;
  ivec2 t = ivec2(pid % uPSize.x, pid / uPSize.x);
  vec4 p = texelFetch(uP, t, 0);
  ivec2 gi = clamp(ivec2(p.xy + 0.5), ivec2(0), uSize - 1);
  vec2 v = texelFetch(uC, gi, 0).zw;
  vec2 pos = p.xy - float(end)*v*uStreak;
  vSpeed = length(v)/max(uU,1e-6);
  vEnd = float(end);
  vec2 ndc = (pos + 0.5)/vec2(uSize)*2.0 - 1.0;
  gl_Position = vec4(ndc, 0.0, 1.0);
  gl_PointSize = uPointSize;
}`;

export const PART_DRAW_FS = HEADER + `
in float vSpeed;
in float vEnd;
uniform float uAlpha;
uniform int uColorMode;
out vec4 o;
void main(){
  vec3 c = uColorMode == 1 ? mix(vec3(0.35,0.75,1.0), vec3(1.0,0.85,0.5), clamp(vSpeed-0.5,0.,1.)) : vec3(0.85,0.92,1.0);
  float a = uAlpha * (1.0 - 0.85*vEnd);
  o = vec4(c*a, a);
}`;

// ---------------------------------------------------------------------------
// Final composite.
export const RENDER_FS = HEADER + `
uniform sampler2D uVis, uSolid, uDye;
uniform ivec2 uSize;
uniform vec4 uView;       // viewport x, y, w, h in device pixels
uniform int uMode;        // 0 smoke, 1 vorticity, 2 speed, 3 pressure, 4 schlieren, 5 streaks
uniform float uRange;     // colour scale multiplier
uniform vec3 uObjCol[8];
uniform int uSel;
uniform float uPxPerCell;
uniform float uSmokeGain;
out vec4 o;

vec3 inferno(float t){
  t = clamp(t,0.,1.);
  const vec3 c0 = vec3(0.0002189403691192265, 0.001651004631001012, -0.01948089843709184);
  const vec3 c1 = vec3(0.1065134194856116, 0.5639564367884091, 3.932712388889277);
  const vec3 c2 = vec3(11.60249308247187, -3.972853965665698, -15.9423941062914);
  const vec3 c3 = vec3(-41.70399613139459, 17.43639888205313, 44.35414519872813);
  const vec3 c4 = vec3(77.162935699427, -33.40235894210092, -81.80730925738993);
  const vec3 c5 = vec3(-71.31942824499214, 32.62606426397723, 73.20951985803202);
  const vec3 c6 = vec3(25.13112622477341, -12.24266895238567, -23.07032500287172);
  return c0+t*(c1+t*(c2+t*(c3+t*(c4+t*(c5+t*c6)))));
}
vec3 diverge(float v, vec3 neg, vec3 pos){
  float a = clamp(abs(v), 0., 1.);
  vec3 base = vec3(0.035,0.04,0.05);
  vec3 hi = v < 0.0 ? neg : pos;
  vec3 c = mix(base, hi, smoothstep(0.0, 0.55, a));
  return mix(c, vec3(0.97,0.96,0.92), smoothstep(0.55, 1.0, a)*0.85);
}
vec3 coolwarm(float v){
  v = clamp(v, -1., 1.);
  vec3 cold = vec3(0.16,0.33,0.86), mid = vec3(0.92,0.92,0.92), warm = vec3(0.83,0.15,0.15);
  return v < 0.0 ? mix(mid, cold, -v) : mix(mid, warm, v);
}

void main(){
  vec2 uv = (gl_FragCoord.xy - uView.xy)/uView.zw;
  vec2 g = uv*vec2(uSize);
  vec4 vis = texture(uVis, uv);
  vec4 sol = texture(uSolid, uv);
  vec3 col;
  float y = uv.y;
  if(uMode == 0 || uMode == 5){
    vec3 bg = mix(vec3(0.018,0.022,0.03), vec3(0.04,0.047,0.06), 1.0 - abs(y-0.5)*1.6);
    col = bg;
    if(uMode == 0){
      vec4 d = texture(uDye, uv);
      float a = 1.0 - exp(-d.a*uSmokeGain);
      vec3 sc = d.a > 1e-4 ? d.rgb/d.a : vec3(1.0);
      col = mix(bg, sc*0.92, a);
    }
  } else if(uMode == 1){
    col = diverge(vis.y/(6.0*uRange), vec3(0.18,0.55,1.0), vec3(1.0,0.42,0.08));
  } else if(uMode == 2){
    col = inferno(vis.x/(1.8*uRange));
  } else if(uMode == 3){
    float cp = vis.z/uRange;
    col = coolwarm(cp > 0.0 ? cp : cp/2.0);
  } else {
    float s = vis.w/(2.0*uRange);
    col = vec3(0.55 + 0.45*tanh(s*3.0));
    col *= vec3(0.98,0.97,0.93);
  }
  // bodies
  float sd = sol.x;
  float edge = clamp(0.5 - sd*uPxPerCell, 0.0, 1.0);
  if(edge > 0.0){
    int id = int(sol.y + 0.5);
    vec3 base = uObjCol[clamp(id,0,7)];
    float depth = clamp(-sd/8.0, 0.0, 1.0);
    vec3 bc = base*(0.62 + 0.38*(1.0-depth));
    float rim = smoothstep(1.6/uPxPerCell + 0.9, 0.0, -sd);
    bc = mix(bc, base*1.25 + 0.08, rim*0.55);
    if(id == uSel){ bc += 0.06; }
    col = mix(col, bc, edge);
  }
  o = vec4(col, 1.0);
}`;
