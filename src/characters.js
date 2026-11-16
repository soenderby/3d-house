// =====================================================================
//  Procedural character models
//  Bodies are lofted from cross-section keys, garments are thin shells
//  over the same surfaces, faces are painted to a canvas (so expressions
//  can change), and hair is built from wavy tapered strands.
// =====================================================================
import * as THREE from 'three';

const TAU = Math.PI * 2;
const V3 = THREE.Vector3;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const spow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);
const deg = (d) => d * Math.PI / 180;
function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hex = (c) => '#' + new THREE.Color(c).getHexString();
const std = (o) => new THREE.MeshStandardMaterial(o);

// ---------------------------------------------------------------------
//  Lofted surfaces
//  keys: [{y, rx, rf, rb, x, z, e}]  (half-width, front depth, back depth,
//  centre offset, superellipse exponent).  a = 0 is the back, a = PI the front.
//  bumps: gaussian swellings on the front or back, mirrored across x.
// ---------------------------------------------------------------------
const PROPS = ['rx', 'rf', 'rb', 'x', 'z', 'e'];
function makeSurface(keys, bumps = []) {
  keys = keys.map((k) => ({ x: 0, z: 0, e: 2, rb: k.rf, ...k })).sort((a, b) => a.y - b.y);
  const n = keys.length;
  const tan = {};
  for (const p of PROPS) tan[p] = keys.map((k, i) => { const a = keys[Math.max(0, i - 1)], b = keys[Math.min(n - 1, i + 1)]; return (b[p] - a[p]) / (b.y - a.y); });
  const y0 = keys[0].y, y1 = keys[n - 1].y;
  const R = {};
  function ring(y, out = R) {
    y = clamp(y, y0, y1);
    let i = 0;
    while (i < n - 2 && y > keys[i + 1].y) i++;
    const k0 = keys[i], k1 = keys[i + 1], h = k1.y - k0.y, t = (y - k0.y) / h, t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    for (const p of PROPS) out[p] = h00 * k0[p] + h10 * h * tan[p][i] + h01 * k1[p] + h11 * h * tan[p][i + 1];
    return out;
  }
  function point(y, a, target) {
    const r = ring(y), s = Math.sin(a), c = Math.cos(a), pw = 2 / r.e;
    const x = r.x + r.rx * spow(s, pw);
    let z = r.z - (c > 0 ? r.rb : r.rf) * spow(c, pw);
    for (const b of bumps) {
      const w = b.back ? c : -c;
      if (w <= 0) continue;
      const dy = y - b.y, sy = dy > 0 ? (b.syUp ?? b.sy) : b.sy;
      const gy = Math.exp(-(dy * dy) / (sy * sy));
      if (gy < 1e-3) continue;
      let g = Math.exp(-((x - b.x) ** 2) / (b.sx * b.sx));
      if (b.x !== 0) g += Math.exp(-((x + b.x) ** 2) / (b.sx * b.sx));
      z += (b.back ? -1 : 1) * b.amp * gy * g * Math.pow(w, b.pw ?? 0.6);
    }
    return target.set(x, y, z);
  }
  const pa = new V3(), pb = new V3(), pc = new V3(), pd = new V3();
  function normal(y, a, target) {
    const ea = 2e-3, ey = (y1 - y0) * 1e-3;
    point(y, a + ea, pa); point(y, a - ea, pb);
    point(y + ey, a, pc); point(y - ey, a, pd);
    pa.sub(pb); pc.sub(pd);
    return target.crossVectors(pc, pa).normalize();
  }
  return { y0, y1, ring, point, normal };
}

function buildLoft(surf, o = {}) {
  const y0 = o.y0 ?? surf.y0, y1 = o.y1 ?? surf.y1, ny = o.ny ?? 24, na = o.na ?? 36, off = o.offset ?? 0, cs = o.capSeg ?? 5;
  const pos = [], nor = [], uv = [];
  const P = new V3(), N = new V3(), r = {};
  let rows = 0;
  const row = (y, s, dyc, nyc) => {
    surf.ring(y, r);
    const cx = r.x, cz = r.z;
    for (let j = 0; j <= na; j++) {
      const a = (j % na) / na * TAU;
      surf.point(y, a, P); surf.normal(y, a, N);
      P.addScaledVector(N, off);
      if (s !== 1) { P.x = cx + (P.x - cx) * s; P.z = cz + (P.z - cz) * s; P.y += dyc; N.multiplyScalar(s); N.y += nyc; N.normalize(); }
      pos.push(P.x, P.y, P.z); nor.push(N.x, N.y, N.z); uv.push(j / na, (y - surf.y0) / (surf.y1 - surf.y0));
    }
    rows++;
  };
  if (o.capLo) for (let k = cs; k >= 1; k--) { const f = k / cs * Math.PI / 2; row(y0, Math.max(0.002, Math.cos(f)), -o.capLo * Math.sin(f), -Math.sin(f)); }
  if (o.ys) for (const y of o.ys) row(y, 1, 0, 0);
  else for (let i = 0; i <= ny; i++) row(y0 + (y1 - y0) * i / ny, 1, 0, 0);
  if (o.capHi) for (let k = 1; k <= cs; k++) { const f = k / cs * Math.PI / 2; row(y1, Math.max(0.002, Math.cos(f)), o.capHi * Math.sin(f), Math.sin(f)); }
  const idx = [];
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < na; j++) {
    const a = i * (na + 1) + j, b = a + 1, c = a + na + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const gridYs = (surf, n) => Array.from({ length: n + 1 }, (_, i) => surf.y0 + (surf.y1 - surf.y0) * i / n);
// rows of a base grid between y0 and y1 (inclusive ends), so a shell's vertices sit exactly over the skin's
const rowsBetween = (ys, y0, y1) => [y0, ...ys.filter((y) => y > y0 + 1e-4 && y < y1 - 1e-4), y1];

// alpha mask over a surface's (angle, y) parameter space: inside(x, y, z, a) -> bool
function maskTexture(surf, inside, w = 512, h = 512) {
  const data = new Uint8Array(w * h * 4);
  const P = new V3();
  for (let j = 0; j < h; j++) {
    const y = surf.y0 + (surf.y1 - surf.y0) * (j + 0.5) / h;
    for (let i = 0; i < w; i++) {
      const a = (i + 0.5) / w * TAU;
      surf.point(y, a, P);
      const m = inside(P.x, y, P.z, a), v = m === true ? 255 : m === false ? 0 : clamp(m, 0, 1) * 255, k = (j * w + i) * 4;
      data[k] = data[k + 1] = data[k + 2] = data[k + 3] = v;
    }
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  t.wrapS = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

const mesh = (geo, mat, parent, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
const group = (parent, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
const SPHERE = new THREE.SphereGeometry(1, 20, 14);
const ball = (r, mat, parent, x, y, z, sx = 1, sy = 1, sz = 1) => { const m = mesh(SPHERE, mat, parent, x, y, z); m.scale.set(r * sx, r * sy, r * sz); return m; };

// ---------------------------------------------------------------------
//  Face painting (head-local metres; +x is the character's left)
// ---------------------------------------------------------------------
const FACE = { x0: -0.11, x1: 0.11, y0: -0.03, y1: 0.31, w: 512, h: 791 };
const FK = FACE.w / (FACE.x1 - FACE.x0);
const FX = (x) => (x - FACE.x0) * FK;
const FY = (y) => (FACE.y1 - y) * FK;

export const EXPRESSIONS = {
  smile: { label: 'Smile', open: 1, mouth: 'smile', brow: [0, 0, 0, 0], look: [0, 0] },
  laugh: { label: 'Laugh', open: 0, mouth: 'laugh', brow: [0.004, 0.05, 0.004, 0.05], look: [0, 0] },
  hmm: { label: 'Hmm…', open: 0.8, mouth: 'smirk', brow: [-0.003, -0.22, 0.008, 0.12], look: [0.7, 0.6] },
  wow: { label: 'Wow!', open: 1.3, mouth: 'o', brow: [0.009, 0.1, 0.009, 0.1], look: [0, 0] },
  blink: { open: 0, closedDown: true, mouth: 'smile', brow: [0, 0, 0, 0], look: [0, 0] },
};

function paintFace(ctx, f, col, ex, rnd) {
  const skin = new THREE.Color(col.skin);
  const shade = (k, a = 1) => { const c = skin.clone().multiplyScalar(k); return `rgba(${c.r * 255 | 0},${c.g * 255 | 0},${c.b * 255 | 0},${a})`; };
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = hex(col.skin); ctx.fillRect(0, 0, FACE.w, FACE.h);
  const local = (x, y, sx = 1) => { ctx.save(); ctx.translate(FX(x), FY(y)); ctx.scale(sx * FK, -FK); };
  // blush
  for (const s of [-1, 1]) {
    const g = ctx.createRadialGradient(FX(s * f.cheekX), FY(f.cheekY), 0, FX(s * f.cheekX), FY(f.cheekY), 0.034 * FK);
    g.addColorStop(0, `rgba(226,104,84,${f.blush})`); g.addColorStop(1, 'rgba(226,104,84,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, FACE.w, FACE.h);
  }
  // freckles across nose and cheeks
  ctx.fillStyle = shade(0.66, 0.42);
  for (let i = 0; i < f.freckles; i++) {
    const x = (rnd() * 2 - 1) * 0.062, y = f.cheekY + 0.006 + (rnd() * 2 - 1) * 0.02 - Math.abs(x) * 0.12;
    ctx.beginPath(); ctx.arc(FX(x), FY(y), (0.00045 + rnd() * 0.0006) * FK, 0, TAU); ctx.fill();
  }
  // nose: soft underside, nostrils and a highlight
  local(0, f.noseY);
  ctx.strokeStyle = shade(0.66, 0.75); ctx.lineWidth = 0.0016; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-0.0085, 0.001); ctx.quadraticCurveTo(-0.006, -0.004, -0.002, -0.003); ctx.quadraticCurveTo(0, -0.0045, 0.002, -0.003); ctx.quadraticCurveTo(0.006, -0.004, 0.0085, 0.001); ctx.stroke();
  ctx.fillStyle = shade(0.5, 0.7);
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(s * 0.0042, -0.0022, 0.0017, 0.0009, s * 0.4, 0, TAU); ctx.fill(); }
  ctx.fillStyle = 'rgba(255,240,220,0.16)'; ctx.beginPath(); ctx.ellipse(0, 0.006, 0.0035, 0.005, 0, 0, TAU); ctx.fill();
  ctx.restore();

  // eyes
  for (const s of [-1, 1]) {
    local(s * f.eyeX, f.eyeY, s);
    const w = f.eyeW / 2, h = f.eyeH / 2 * Math.min(ex.open, 1.3);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (ex.open < 0.15) {
      const k = ex.closedDown ? -1 : 1;
      ctx.strokeStyle = hex(col.lash); ctx.lineWidth = 0.0032;
      ctx.beginPath(); ctx.moveTo(-w, -0.001 * k); ctx.quadraticCurveTo(0, k * w * 0.62, w, 0.001 * k); ctx.stroke();
      ctx.lineWidth = 0.0018;
      for (const q of [0.55, 0.8, 1]) { ctx.beginPath(); ctx.moveTo(w * q, k * w * 0.3 * (1 - q * q)); ctx.lineTo(w * q + 0.004, k * w * 0.3 * (1 - q * q) + (k > 0 ? 0.0035 : -0.003)); ctx.stroke(); }
    } else {
      const almond = () => { ctx.beginPath(); ctx.moveTo(-w, -0.001); ctx.bezierCurveTo(-w * 0.55, h * 1.4, w * 0.45, h * 1.45, w, 0.0035); ctx.bezierCurveTo(w * 0.5, -h * 1.1, -w * 0.5, -h * 1.2, -w, -0.001); ctx.closePath(); };
      almond(); ctx.fillStyle = '#fff8ec'; ctx.fill();
      ctx.save(); ctx.clip();
      const ix = s * ex.look[0] * w * 0.3, iy = ex.look[1] * h * 0.35 + 0.0005, ir = f.irisR;
      const g = ctx.createRadialGradient(ix, iy - ir * 0.3, ir * 0.1, ix, iy, ir);
      g.addColorStop(0, hex(col.irisHi)); g.addColorStop(0.75, hex(col.iris)); g.addColorStop(1, hex(col.irisRim));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ix, iy, ir, 0, TAU); ctx.fill();
      ctx.fillStyle = '#1a0d08'; ctx.beginPath(); ctx.arc(ix, iy, ir * 0.48, 0, TAU); ctx.fill();
      const tg = ctx.createLinearGradient(0, h * 1.3, 0, 0); tg.addColorStop(0, 'rgba(40,15,5,0.5)'); tg.addColorStop(1, 'rgba(40,15,5,0)');
      ctx.fillStyle = tg; ctx.fillRect(-w, 0, 2 * w, h * 1.5);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(ix - s * ir * 0.38, iy + ir * 0.4, ir * 0.24, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(ix + s * ir * 0.35, iy - ir * 0.4, ir * 0.11, 0, TAU); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = hex(col.lash); ctx.lineWidth = f.lashW;
      ctx.beginPath(); ctx.moveTo(-w, -0.001); ctx.bezierCurveTo(-w * 0.55, h * 1.4, w * 0.45, h * 1.45, w, 0.0035); ctx.lineTo(w + 0.0045, 0.0075); ctx.stroke();
      ctx.strokeStyle = shade(0.5, 0.6); ctx.lineWidth = 0.0009;
      ctx.beginPath(); ctx.moveTo(w, 0.0035); ctx.bezierCurveTo(w * 0.5, -h * 1.1, -w * 0.5, -h * 1.2, -w, -0.001); ctx.stroke();
      // lid crease
      ctx.strokeStyle = shade(0.68, 0.6); ctx.lineWidth = 0.001;
      ctx.beginPath(); ctx.moveTo(-w * 0.8, h * 1.05 + 0.002); ctx.quadraticCurveTo(0, h * 1.55 + 0.004, w * 0.95, h * 0.7 + 0.004); ctx.stroke();
    }
    ctx.restore();
    // brow (index 0/1 = character's right, 2/3 = left)
    const bi = s < 0 ? 0 : 2;
    local(s * f.browX, f.browY + ex.brow[bi], s);
    ctx.rotate(ex.brow[bi + 1]);
    const bw = f.browW / 2, t = f.browT;
    ctx.fillStyle = hex(col.brow);
    ctx.beginPath(); ctx.moveTo(-bw, t * 0.2); ctx.quadraticCurveTo(-bw * 0.9, t * 0.75, -bw * 0.6, t * 0.8 + f.browArch * 0.5);
    ctx.quadraticCurveTo(bw * 0.2, f.browArch + t * 1.1, bw, -0.001);
    ctx.quadraticCurveTo(bw * 0.2, f.browArch + t * 0.1, -bw * 0.7, -t * 0.25 + f.browArch * 0.3); ctx.quadraticCurveTo(-bw, -t * 0.35, -bw, t * 0.2);
    ctx.fill();
    ctx.restore();
  }

  // mouth
  const mw = f.mouthW / 2;
  const lips = (w, sag, tU, tL) => {
    const top = [], mid = [], bot = [];
    for (let i = 0; i <= 24; i++) {
      const u = i / 12 - 1, x = u * w, m = -sag * (1 - u * u) + 0.0025 * u * u;
      mid.push([x, m]);
      top.push([x, m + tU * Math.pow(1 - u * u, 0.6) * (1 - 0.3 * Math.exp(-(u * u) / 0.03))]);
      bot.push([x, m - tL * Math.pow(1 - u * u, 0.8)]);
    }
    const poly = (a, b, fill) => { ctx.beginPath(); a.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); for (let i = b.length - 1; i >= 0; i--) ctx.lineTo(b[i][0], b[i][1]); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); };
    poly(top, mid, hex(col.lipDark)); poly(mid, bot, hex(col.lip));
    ctx.strokeStyle = hex(col.lipLine); ctx.lineWidth = 0.0013; ctx.lineCap = 'round';
    ctx.beginPath(); mid.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke();
    ctx.fillStyle = 'rgba(255,235,225,0.3)'; ctx.beginPath(); ctx.ellipse(0, -sag - tL * 0.45, w * 0.3, tL * 0.18, 0, 0, TAU); ctx.fill();
    // smile corners
    ctx.strokeStyle = shade(0.6, 0.7); ctx.lineWidth = 0.0011;
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * (w + 0.0005), 0.001); ctx.quadraticCurveTo(s * (w + 0.003), 0.003, s * (w + 0.003), 0.006); ctx.stroke(); }
  };
  if (ex.mouth === 'smile') { local(0, f.mouthY); lips(mw, 0.005, 0.0042, 0.0062); ctx.restore(); }
  else if (ex.mouth === 'smirk') { local(0.005, f.mouthY - 0.001); ctx.rotate(0.14); lips(mw * 0.62, 0.0012, 0.0045, 0.006); ctx.restore(); }
  else if (ex.mouth === 'o') {
    local(0, f.mouthY - 0.003);
    ctx.fillStyle = hex(col.lip); ctx.beginPath(); ctx.ellipse(0, 0, 0.0105, 0.0125, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#4a1418'; ctx.beginPath(); ctx.ellipse(0, 0, 0.0062, 0.008, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#c9605e'; ctx.beginPath(); ctx.ellipse(0, -0.005, 0.004, 0.0026, 0, 0, TAU); ctx.fill();
    ctx.restore();
  } else if (ex.mouth === 'laugh') {
    local(0, f.mouthY + 0.004);
    const w = mw * 1.2, d = 0.021;
    const shape = () => { ctx.beginPath(); ctx.moveTo(-w, 0.003); ctx.quadraticCurveTo(0, -0.003, w, 0.003); ctx.bezierCurveTo(w * 0.85, -d * 1.25, -w * 0.85, -d * 1.25, -w, 0.003); ctx.closePath(); };
    shape(); ctx.fillStyle = '#4a1418'; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.fillStyle = '#fffaf2'; ctx.fillRect(-w, -0.0065, 2 * w, 0.012);
    ctx.fillStyle = '#d5625f'; ctx.beginPath(); ctx.ellipse(0, -d * 0.98, w * 0.6, d * 0.42, 0, 0, TAU); ctx.fill();
    ctx.restore();
    shape(); ctx.strokeStyle = hex(col.lip); ctx.lineWidth = 0.003; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.restore();
  }
}

// ---------------------------------------------------------------------
//  Hair strands
// ---------------------------------------------------------------------
function strandBuilder() {
  const pos = [], nor = [], colr = [], idx = [];
  const p = new V3(), T = new V3(), o = new V3(), B = new V3(), N = new V3(), c = new THREE.Color();
  function add(pts, C, w0, th0, cA, cB, hl) {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const n = 30, m = 8, base = pos.length / 3;
    let pB = null;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      curve.getPoint(t, p); curve.getTangent(t, T);
      o.set(p.x - C.x, (p.y - C.y) * 0.35, p.z - C.z).normalize();
      B.crossVectors(T, o).normalize();
      if (pB && B.dot(pB) < 0) B.negate();
      pB = (pB || new V3()).copy(B);
      N.crossVectors(B, T).normalize(); if (N.dot(o) < 0) N.negate();
      const prof = (0.3 + 0.7 * sstep(0, 0.25, t)) * (1 - 0.72 * sstep(0.7, 1, t)) * (t > 0.999 ? 0.05 : 1);
      const w = w0 * prof, th = th0 * prof;
      c.copy(cA).lerp(cB, clamp(0.25 + 0.75 * Math.exp(-((t - hl) ** 2) / 0.03), 0, 1));
      for (let j = 0; j < m; j++) {
        const a = j / m * TAU, ca = Math.cos(a), sa = Math.sin(a);
        pos.push(p.x + B.x * ca * w + N.x * sa * th, p.y + B.y * ca * w + N.y * sa * th, p.z + B.z * ca * w + N.z * sa * th);
        const nx = B.x * ca * th + N.x * sa * w, ny = B.y * ca * th + N.y * sa * w, nz = B.z * ca * th + N.z * sa * w, l = Math.hypot(nx, ny, nz) || 1;
        // bias normals outward for a soft, clumped look
        nor.push(nx / l * 0.6 + N.x * 0.4, ny / l * 0.6 + N.y * 0.4, nz / l * 0.6 + N.z * 0.4);
        colr.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
      const a = base + i * m + j, b = base + i * m + (j + 1) % m, d = a + m, e = b + m;
      idx.push(a, b, d, b, e, d);
    }
  }
  function geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
    g.setIndex(idx);
    g.normalizeNormals();
    return g;
  }
  return { add, geometry };
}

function buildHair(h, col, headG, rnd) {
  const C = new V3(...h.C);
  const hairG = group(headG);
  // under-volume: a masked shell that keeps the scalp and the gaps between strands filled
  const bulk = makeSurface(h.bulk);
  const fa = h.faceAngle;
  const mask = maskTexture(bulk, (x, y, z) => {
    const psi = Math.abs(Math.atan2(x, z - C.z));
    const open = fa * (1 - sstep(h.hairline - 0.045, h.hairline + 0.012, y - Math.max(0, x * h.partSide) * 0.25));
    return 0.5 + (psi - open) * 5;
  }, 512, 512);
  const bulkMat = std({ color: new THREE.Color(col.hairLo).lerp(new THREE.Color(col.hair), 0.6), roughness: 0.6, alphaMap: mask, alphaTest: 0.5, side: THREE.DoubleSide });
  mesh(buildLoft(bulk, { ny: 22, na: 36, capHi: h.bulkCap }), bulkMat, hairG);

  const sb = strandBuilder();
  const cLo = new THREE.Color(col.hairLo), cMid = new THREE.Color(col.hair), cHi = new THREE.Color(col.hairHi);
  // A lock runs from the parting down over the outside of the under-volume, drifting
  // from azimuth psi[0] to psi[2] (0 = front, +90deg = the character's left).
  const P = new V3(), N = new V3(), yTop = bulk.y1 + h.bulkCap * 0.5;
  const lock = (L) => {
    const [a, b, c] = L.psi, k = L.hold ?? 1, lift = L.lift ?? 0.01, curl = L.curl ?? 0.015;
    const backness = (1 - Math.cos(a)) / 2;
    const root = new V3(h.part[0] + (rnd() - 0.5) * 0.012, h.top - 0.006, lerp(h.part[1], h.part[2], backness));
    const amp = (L.wave ?? h.wave) * (0.8 + rnd() * 0.4), fr = h.waveFreq * (0.9 + rnd() * 0.2), ph = a * 1.4 + (L.layer ?? 0) * 1.3 + rnd() * 0.8;
    const out = [], n = 26;
    for (let i = 0; i <= n; i++) {
      const t = i / n, env = sstep(0.2, 0.55, t), wv = t * fr * TAU + ph;
      let y, psi;
      if (L.sweepY !== undefined) { // fringe: drop to the forehead, sweep sideways, then fall at the temple
        y = t < 0.25 ? lerp(yTop, L.sweepY, sstep(0, 0.25, t)) : t < 0.6 ? lerp(L.sweepY, L.sweepY - 0.035, (t - 0.25) / 0.35) : lerp(L.sweepY - 0.035, L.yEnd, sstep(0.6, 1, t) * 0.7 + (t - 0.6) * 0.75);
        psi = t < 0.6 ? lerp(a, b, sstep(0.12, 0.6, t)) : lerp(b, c, sstep(0.6, 1, t));
      } else {
        y = lerp(yTop, L.yEnd, Math.pow(t, k));
        psi = t < 0.45 ? lerp(a, b, sstep(0, 0.45, t)) : lerp(b, c, sstep(0.45, 1, t));
      }
      psi += env * amp * 5 * Math.cos(wv);
      bulk.point(y, Math.PI - psi, P); bulk.normal(Math.max(y, bulk.y0 + 0.002), Math.PI - psi, N);
      N.y *= 0.3; N.normalize();
      const tip = sstep(0.72, 1, t);
      P.addScaledVector(N, lift * (0.4 + 0.6 * sstep(0, 0.3, t)) + env * amp * (0.5 + 0.5 * Math.sin(wv)) + curl * tip * tip);
      if (y < bulk.y0) P.y = y;
      out.push(new V3().lerpVectors(root, P, sstep(0, 0.22, t)));
    }
    const tone = rnd();
    const cA = cLo.clone().lerp(cMid, 0.55 + tone * 0.45), cB = cMid.clone().lerp(cHi, 0.25 + tone * 0.5);
    sb.add(out, C, (L.w ?? h.lockW) * (0.9 + rnd() * 0.2), (L.th ?? h.lockT) * (0.9 + rnd() * 0.2), cA, cB, 0.3 + rnd() * 0.3);
  };
  // layered locks around the sides and back
  for (let layer = 0; layer < h.layers; layer++) {
    const n = h.count + layer * 2;
    for (let i = 0; i < n; i++) {
      const psi = fa * 0.9 + (i + 0.15 + rnd() * 0.7 + layer * 0.33) / n * (TAU - fa * 1.8);
      const j = () => (rnd() - 0.5) * 0.16;
      const backness = (1 - Math.cos(psi)) / 2;
      lock({
        layer, psi: [psi + j(), psi + j() * 0.5, psi + j() * 0.5], lift: 0.004 + layer * 0.012 + rnd() * 0.003,
        yEnd: lerp(h.endFront, h.endBack, sstep(0.3, 0.8, backness)) + (rnd() - 0.5) * h.endJit - layer * 0.006,
        curl: h.curl * (0.6 + rnd() * 0.6) * (rnd() < h.curlIn ? -1 : 1),
      });
    }
  }
  for (const L of h.fringe) lock({ th: 0.008, ...L, psi: L.psi.map(deg) });
  // the side-swept fringe: a fan of slim locks from the parting across the forehead
  const F = h.sweep;
  for (let i = 0; i < F.n; i++) {
    const u = i / (F.n - 1);
    lock({
      psi: [deg(lerp(30, -16, u)), deg(lerp(-34, -62, u)), deg(lerp(-68, -80, u))], sweepY: lerp(F.y1, F.y0, u) + (rnd() - 0.5) * 0.006,
      yEnd: lerp(F.end1, F.end0, u), lift: 0.003 + (1 - u) * 0.009 + rnd() * 0.003, w: 0.019, th: 0.007, wave: F.wave, curl: -0.004,
    });
  }
  mesh(sb.geometry(), std({ vertexColors: true, roughness: 0.48, metalness: 0.05 }), hairG);
  return hairG;
}

// ---------------------------------------------------------------------
//  Character definitions
// ---------------------------------------------------------------------
export const CHARACTERS = [
  {
    id: 'ochre', name: 'Ochre', height: 1.53, seed: 11,
    blurb: 'Petite, bookish and quick on her feet. Tortoiseshell glasses, gold hoops, a wavy chin-length bob.',
    colors: {
      skin: 0xc98d58, hair: 0x4a2a1b, hairHi: 0x7a4a2c, hairLo: 0x2c170f, outfit: 0xd9952b, outfitDark: 0xa86c18,
      brow: 0x35190f, lash: 0x24100a, iris: 0x5a3018, irisHi: 0x9a6230, irisRim: 0x2a1408, lip: 0xb86a58, lipDark: 0xa05848, lipLine: 0x6a2e24,
    },
    torso: [
      { y: 0.695, rx: 0.075, rf: 0.07, rb: 0.06, z: -0.004, e: 2.1 },
      { y: 0.725, rx: 0.114, rf: 0.082, rb: 0.078, z: -0.004, e: 2.2 },
      { y: 0.765, rx: 0.138, rf: 0.084, rb: 0.088, z: -0.006, e: 2.2 },
      { y: 0.81, rx: 0.135, rf: 0.08, rb: 0.088, z: -0.008, e: 2.2 },
      { y: 0.87, rx: 0.112, rf: 0.077, rb: 0.076, z: -0.004, e: 2.2 },
      { y: 0.95, rx: 0.092, rf: 0.069, rb: 0.064, z: 0, e: 2.2 },
      { y: 1.017, rx: 0.102, rf: 0.072, rb: 0.07, z: 0.004, e: 2.3 },
      { y: 1.07, rx: 0.113, rf: 0.075, rb: 0.078, z: 0.006, e: 2.4 },
      { y: 1.12, rx: 0.122, rf: 0.07, rb: 0.08, z: 0.004, e: 2.5 },
      { y: 1.152, rx: 0.124, rf: 0.06, rb: 0.072, z: 0, e: 2.5 },
      { y: 1.178, rx: 0.082, rf: 0.046, rb: 0.058, z: -0.002, e: 2.3 },
      { y: 1.2, rx: 0.04, rf: 0.039, rb: 0.043, z: 0.002, e: 2 },
      { y: 1.24, rx: 0.033, rf: 0.033, rb: 0.035, z: 0.008, e: 2 },
      { y: 1.28, rx: 0.033, rf: 0.033, rb: 0.035, z: 0.012, e: 2 },
    ],
    torsoBumps: [
      { x: 0.052, y: 1.064, sx: 0.04, sy: 0.036, syUp: 0.05, amp: 0.038 },
      { back: true, x: 0.064, y: 0.752, sx: 0.055, sy: 0.045, syUp: 0.075, amp: 0.04 },
    ],
    navelY: 0.905,
    hip: { x: 0.0715, y: 0.765 }, glute: { y: -0.02, sx: 0.06, sy: 0.04, syUp: 0.06, amp: 0.022 },
    thigh: [
      { y: 0, rx: 0.0715, rf: 0.062, rb: 0.086 },
      { y: -0.05, rx: 0.0725, rf: 0.07, rb: 0.086, x: 0.001 },
      { y: -0.15, rx: 0.062, rf: 0.066, rb: 0.063, x: -0.004 },
      { y: -0.26, rx: 0.049, rf: 0.052, rb: 0.048, x: -0.011 },
      { y: -0.352, rx: 0.042, rf: 0.046, rb: 0.04, x: -0.016 },
    ],
    shin: [
      { y: 0, rx: 0.042, rf: 0.046, rb: 0.04 },
      { y: -0.04, rx: 0.04, rf: 0.042, rb: 0.043 },
      { y: -0.12, rx: 0.045, rf: 0.04, rb: 0.055, x: 0.002 },
      { y: -0.22, rx: 0.033, rf: 0.034, rb: 0.038 },
      { y: -0.321, rx: 0.026, rf: 0.029, rb: 0.029, x: -0.002 },
    ],
    ankleH: 0.092, shoe: 0.84,
    shoulder: { x: 0.128, y: 1.138 }, armRest: 0.13,
    upper: [
      { y: 0, rx: 0.035, rf: 0.036, rb: 0.036 },
      { y: -0.07, rx: 0.033, rf: 0.034, rb: 0.035 },
      { y: -0.215, rx: 0.027, rf: 0.027, rb: 0.028 },
    ],
    fore: [
      { y: 0, rx: 0.027, rf: 0.027, rb: 0.028 },
      { y: -0.05, rx: 0.027, rf: 0.028, rb: 0.028 },
      { y: -0.15, rx: 0.021, rf: 0.023, rb: 0.023 },
      { y: -0.245, rx: 0.015, rf: 0.021, rb: 0.021 },
    ],
    hand: 0.95,
    neckY: 1.232, chinY: 1.216, neckBase: 1.2,
    head: [
      { y: 0, rx: 0.018, rf: 0.03, rb: 0.012, z: 0.03, e: 2 },
      { y: 0.02, rx: 0.047, rf: 0.05, rb: 0.03, z: 0.02, e: 2.1 },
      { y: 0.05, rx: 0.07, rf: 0.068, rb: 0.055, z: 0.012, e: 2.2 },
      { y: 0.09, rx: 0.084, rf: 0.078, rb: 0.075, z: 0.005, e: 2.2 },
      { y: 0.14, rx: 0.09, rf: 0.082, rb: 0.09, z: 0, e: 2.2 },
      { y: 0.19, rx: 0.09, rf: 0.085, rb: 0.098, z: 0, e: 2.2 },
      { y: 0.24, rx: 0.08, rf: 0.078, rb: 0.092, z: 0, e: 2.1 },
      { y: 0.275, rx: 0.05, rf: 0.055, rb: 0.065, z: 0, e: 2 },
    ],
    headCap: 0.012,
    face: {
      eyeX: 0.041, eyeY: 0.125, eyeW: 0.043, eyeH: 0.031, irisR: 0.0128, lashW: 0.0028,
      browX: 0.042, browY: 0.163, browW: 0.046, browT: 0.0066, browArch: 0.006,
      noseY: 0.072, mouthY: 0.042, mouthW: 0.048, cheekX: 0.05, cheekY: 0.082, blush: 0.3, freckles: 60,
    },
    glasses: true, earring: 'hoop', earY: 0.1,
    hair: {
      C: [0, 0.165, -0.006], top: 0.305, part: [0.03, 0.045, -0.07], partSide: 1,
      hairline: 0.2, faceAngle: deg(60),
      bulk: [
        { y: 0.0, rx: 0.112, rf: 0.07, rb: 0.105, z: -0.018 },
        { y: 0.045, rx: 0.13, rf: 0.082, rb: 0.118, z: -0.014 },
        { y: 0.11, rx: 0.134, rf: 0.092, rb: 0.122, z: -0.01 },
        { y: 0.19, rx: 0.124, rf: 0.093, rb: 0.12, z: -0.006 },
        { y: 0.255, rx: 0.102, rf: 0.086, rb: 0.106, z: -0.006 },
        { y: 0.297, rx: 0.062, rf: 0.06, rb: 0.07, z: -0.006 },
      ],
      bulkCap: 0.012,
      endFront: 0.02, endBack: 0.0, endJit: 0.025, curl: 0.02, curlIn: 0.75,
      layers: 2, count: 13, lockW: 0.027, lockT: 0.012, wave: 0.01, waveFreq: 1.5,
      sweep: { n: 7, y0: 0.205, y1: 0.262, end0: 0.045, end1: 0.1, wave: 0.003 },
      fringe: [{ psi: [40, 64, 76], sweepY: 0.222, yEnd: 0.05, lift: 0.006, w: 0.03, wave: 0.004 }],
    },
    bra: { band: 1.004, side: 1.072, strap: 1.112, scoop: 1.088, backScoop: 1.1, sx0: 0.05, sx1: 0.08, a0: 0.42, a1: 0.82, top: 1.2 },
    shorts: { waist: 0.888, hem: -0.105 },
  },
  {
    id: 'plum', name: 'Plum', height: 1.78, seed: 29,
    blurb: 'Tall, soft and sunny. Golden shoulder-length waves, freckles and a laugh that fills the house.',
    colors: {
      skin: 0xe6ab78, hair: 0xd29a4c, hairHi: 0xf2cc86, hairLo: 0xa06a2c, outfit: 0x6e3a62, outfitDark: 0x4e2646,
      brow: 0x8a5a26, lash: 0x3a1c10, iris: 0xa86a22, irisHi: 0xe0a848, irisRim: 0x5a3210, lip: 0xd0705e, lipDark: 0xb85a50, lipLine: 0x7a3028,
    },
    torso: [
      { y: 0.84, rx: 0.11, rf: 0.11, rb: 0.095, z: -0.01, e: 2.1 },
      { y: 0.88, rx: 0.2, rf: 0.13, rb: 0.125, z: -0.01, e: 2.2 },
      { y: 0.925, rx: 0.252, rf: 0.126, rb: 0.138, z: -0.012, e: 2.2 },
      { y: 0.985, rx: 0.25, rf: 0.134, rb: 0.138, z: -0.01, e: 2.2 },
      { y: 1.055, rx: 0.212, rf: 0.138, rb: 0.124, z: -0.004, e: 2.2 },
      { y: 1.14, rx: 0.152, rf: 0.124, rb: 0.106, z: 0.004, e: 2.2 },
      { y: 1.228, rx: 0.164, rf: 0.114, rb: 0.108, z: 0.008, e: 2.3 },
      { y: 1.3, rx: 0.178, rf: 0.114, rb: 0.115, z: 0.01, e: 2.4 },
      { y: 1.37, rx: 0.188, rf: 0.1, rb: 0.115, z: 0.006, e: 2.5 },
      { y: 1.42, rx: 0.186, rf: 0.085, rb: 0.1, z: 0, e: 2.5 },
      { y: 1.452, rx: 0.12, rf: 0.062, rb: 0.076, z: -0.002, e: 2.3 },
      { y: 1.48, rx: 0.054, rf: 0.05, rb: 0.054, z: 0.002, e: 2 },
      { y: 1.53, rx: 0.044, rf: 0.042, rb: 0.045, z: 0.01, e: 2 },
      { y: 1.57, rx: 0.044, rf: 0.042, rb: 0.045, z: 0.014, e: 2 },
    ],
    torsoBumps: [
      { x: 0.086, y: 1.29, sx: 0.07, sy: 0.058, syUp: 0.085, amp: 0.098 },
      { x: 0, y: 1.035, sx: 0.14, sy: 0.07, syUp: 0.06, amp: 0.028 },
      { back: true, x: 0.118, y: 0.905, sx: 0.1, sy: 0.075, syUp: 0.12, amp: 0.078 },
    ],
    navelY: 1.105,
    hip: { x: 0.132, y: 0.925 }, glute: { y: -0.04, sx: 0.11, sy: 0.07, syUp: 0.09, amp: 0.045 },
    thigh: [
      { y: 0, rx: 0.132, rf: 0.112, rb: 0.15 },
      { y: -0.07, rx: 0.139, rf: 0.126, rb: 0.15, x: 0.004 },
      { y: -0.2, rx: 0.119, rf: 0.116, rb: 0.112, x: -0.011 },
      { y: -0.34, rx: 0.092, rf: 0.094, rb: 0.086, x: -0.03 },
      { y: -0.48, rx: 0.073, rf: 0.08, rb: 0.072, x: -0.045 },
    ],
    shin: [
      { y: 0, rx: 0.073, rf: 0.08, rb: 0.072 },
      { y: -0.05, rx: 0.072, rf: 0.074, rb: 0.078 },
      { y: -0.14, rx: 0.08, rf: 0.07, rb: 0.098, x: 0.004 },
      { y: -0.26, rx: 0.056, rf: 0.056, rb: 0.062 },
      { y: -0.356, rx: 0.042, rf: 0.046, rb: 0.046, x: -0.004 },
    ],
    ankleH: 0.089, shoe: 1.08,
    shoulder: { x: 0.198, y: 1.398 }, armRest: 0.2,
    upper: [
      { y: 0, rx: 0.058, rf: 0.06, rb: 0.06 },
      { y: -0.1, rx: 0.06, rf: 0.062, rb: 0.065 },
      { y: -0.2, rx: 0.05, rf: 0.052, rb: 0.054 },
      { y: -0.29, rx: 0.042, rf: 0.043, rb: 0.044 },
    ],
    fore: [
      { y: 0, rx: 0.042, rf: 0.043, rb: 0.044 },
      { y: -0.06, rx: 0.044, rf: 0.045, rb: 0.046 },
      { y: -0.17, rx: 0.033, rf: 0.036, rb: 0.036 },
      { y: -0.265, rx: 0.021, rf: 0.028, rb: 0.028 },
    ],
    hand: 1.25,
    neckY: 1.516, chinY: 1.5, neckBase: 1.482,
    head: [
      { y: 0, rx: 0.024, rf: 0.034, rb: 0.014, z: 0.03, e: 2 },
      { y: 0.018, rx: 0.05, rf: 0.054, rb: 0.036, z: 0.02, e: 2.1 },
      { y: 0.045, rx: 0.07, rf: 0.071, rb: 0.06, z: 0.012, e: 2.2 },
      { y: 0.085, rx: 0.081, rf: 0.08, rb: 0.08, z: 0.005, e: 2.2 },
      { y: 0.13, rx: 0.085, rf: 0.083, rb: 0.092, z: 0, e: 2.2 },
      { y: 0.175, rx: 0.085, rf: 0.085, rb: 0.098, z: 0, e: 2.2 },
      { y: 0.22, rx: 0.074, rf: 0.076, rb: 0.09, z: 0, e: 2.1 },
      { y: 0.248, rx: 0.048, rf: 0.052, rb: 0.062, z: 0, e: 2 },
    ],
    headCap: 0.01,
    face: {
      eyeX: 0.042, eyeY: 0.126, eyeW: 0.042, eyeH: 0.027, irisR: 0.0118, lashW: 0.0032,
      browX: 0.042, browY: 0.158, browW: 0.04, browT: 0.0052, browArch: 0.0055,
      noseY: 0.078, mouthY: 0.047, mouthW: 0.046, cheekX: 0.05, cheekY: 0.086, blush: 0.42, freckles: 90,
    },
    glasses: false, earring: 'stud', earY: 0.105,
    hair: {
      C: [0, 0.15, -0.006], top: 0.29, part: [0.028, 0.045, -0.07], partSide: 1,
      hairline: 0.2, faceAngle: deg(56),
      bulk: [
        { y: -0.085, rx: 0.134, rf: 0.04, rb: 0.108, z: -0.03 },
        { y: -0.03, rx: 0.142, rf: 0.06, rb: 0.118, z: -0.022 },
        { y: 0.04, rx: 0.14, rf: 0.082, rb: 0.12, z: -0.014 },
        { y: 0.11, rx: 0.136, rf: 0.092, rb: 0.122, z: -0.008 },
        { y: 0.18, rx: 0.124, rf: 0.096, rb: 0.118, z: -0.006 },
        { y: 0.24, rx: 0.1, rf: 0.088, rb: 0.104, z: -0.006 },
        { y: 0.278, rx: 0.06, rf: 0.058, rb: 0.068, z: -0.006 },
      ],
      bulkCap: 0.012,
      endFront: -0.075, endBack: -0.125, endJit: 0.03, curl: 0.02, curlIn: 0.5,
      layers: 2, count: 14, lockW: 0.029, lockT: 0.013, wave: 0.017, waveFreq: 2.2,
      sweep: { n: 7, y0: 0.198, y1: 0.25, end0: -0.03, end1: 0.07, wave: 0.006 },
      fringe: [{ psi: [40, 62, 74], sweepY: 0.214, yEnd: -0.03, lift: 0.006, w: 0.032, wave: 0.008 }],
    },
    bra: { band: 1.2, side: 1.315, strap: 1.37, scoop: 1.33, backScoop: 1.36, sx0: 0.075, sx1: 0.118, a0: 0.42, a1: 0.8, top: 1.48 },
    shorts: { waist: 1.075, hem: -0.15 },
  },
];

// ---------------------------------------------------------------------
//  Build one character -> rig
// ---------------------------------------------------------------------
export function buildCharacter(def) {
  const rnd = mulberry(def.seed);
  const col = def.colors;
  const skin = std({ color: col.skin, roughness: 0.62, emissive: col.skin, emissiveIntensity: 0.05 });
  const cloth = std({ color: col.outfit, roughness: 0.78 });
  const clothDark = std({ color: col.outfitDark, roughness: 0.7 });
  const white = std({ color: 0xf4efe6, roughness: 0.7 });
  const sole = std({ color: 0xd8d2c6, roughness: 0.85 });
  const gold = std({ color: 0xe0b040, roughness: 0.3, metalness: 0.85, emissive: 0x6a4a10, emissiveIntensity: 0.35 });

  const root = new THREE.Group();
  root.userData.dynamic = true;
  const hips = group(root);
  const torsoG = group(hips);
  const J = { hips, torso: torsoG };

  // ---- torso
  const torso = makeSurface(def.torso, def.torsoBumps);
  const tv = (y) => (y - torso.y0) / (torso.y1 - torso.y0);
  const torsoTex = canvasTex(512, 1024, (g, w, h) => {
    g.fillStyle = hex(col.skin); g.fillRect(0, 0, w, h);
    const sk = new THREE.Color(col.skin).multiplyScalar(0.55);
    const dark = (a) => `rgba(${sk.r * 255 | 0},${sk.g * 255 | 0},${sk.b * 255 | 0},${a})`;
    const ny = (1 - tv(def.navelY)) * h;
    const gr = g.createRadialGradient(w / 2, ny, 0, w / 2, ny, 13);
    gr.addColorStop(0, dark(0.85)); gr.addColorStop(0.5, dark(0.4)); gr.addColorStop(1, dark(0));
    g.save(); g.translate(w / 2, ny); g.scale(0.5, 1); g.translate(-w / 2, -ny); g.fillStyle = gr; g.fillRect(0, ny - 20, w, 40); g.restore();
    // faint midline and collarbones
    g.strokeStyle = dark(0.1); g.lineWidth = 3; g.lineCap = 'round';
    g.beginPath(); g.moveTo(w / 2, ny - 26); g.lineTo(w / 2, (1 - tv(def.bra.band)) * h); g.stroke();
    const cy = (1 - tv(def.shoulder.y + 0.012)) * h;
    g.strokeStyle = dark(0.16); g.lineWidth = 2.5;
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(w / 2 + s * 12, cy + 12); g.quadraticCurveTo(w / 2 + s * 50, cy + 4, w / 2 + s * 92, cy - 6); g.stroke(); }
    // a few shoulder freckles
    g.fillStyle = dark(0.3);
    for (let i = 0; i < 40; i++) { g.beginPath(); g.arc(rnd() * w, cy + 10 + rnd() * 50, 0.8 + rnd(), 0, TAU); g.fill(); }
  });
  const torsoSkin = std({ map: torsoTex, roughness: 0.62, emissive: col.skin, emissiveIntensity: 0.05 });
  const TY = gridYs(torso, 110), TA = 64;
  mesh(buildLoft(torso, { ys: TY, na: TA, capLo: 0.03 }), torsoSkin, torsoG);

  // ---- sports bra: a shell over the chest, cut to shape by an alpha mask
  const b = def.bra;
  const braMask = maskTexture(torso, (x, y, z, a) => {
    const front = Math.cos(a) < 0;
    const ang = front ? Math.abs(a - Math.PI) : Math.min(a, TAU - a);
    const lowC = front ? b.scoop : b.backScoop;
    const low = ang < b.a0 ? lowC + (b.strap - lowC) * Math.pow(ang / b.a0, 2.4) : lerp(b.strap, b.side, sstep(b.a1 - 0.12, Math.PI / 2 - 0.1, ang));
    const ax = Math.abs(x);
    return 0.5 + Math.min(y - b.band, Math.max(low - y, Math.min(ax - b.sx0, b.sx1 - ax))) * 70;
  });
  const braMat = std({ color: col.outfit, roughness: 0.78, alphaMap: braMask, alphaTest: 0.5 });
  mesh(buildLoft(torso, { y0: b.band - 0.004, ys: rowsBetween(TY, b.band - 0.004, b.top), na: TA, offset: 0.005 }), braMat, torsoG);
  mesh(buildLoft(torso, { ys: rowsBetween(TY, b.band - 0.004, b.band + 0.022), na: TA, offset: 0.007 }), clothDark, torsoG);

  // ---- bike shorts: pelvis shell + thigh shells
  const sh = def.shorts;
  mesh(buildLoft(torso, { y0: torso.y0, ys: rowsBetween(TY, torso.y0, sh.waist), na: TA, offset: 0.005, capLo: 0.032 }), cloth, torsoG);
  mesh(buildLoft(torso, { ys: rowsBetween(TY, sh.waist - 0.03, sh.waist), na: TA, offset: 0.007 }), clothDark, torsoG);

  // ---- necklace: a fine chain draped over the collarbones with a small pendant
  {
    const pts = [], P = new V3(), N = new V3(), yb = def.neckBase, drop = def.height * 0.036;
    for (let i = 0; i <= 40; i++) {
      const a = i / 40 * TAU, fr = (1 - Math.cos(a)) / 2;
      const y = yb + 0.004 - drop * Math.pow(fr, 1.8);
      torso.point(y, a, P); torso.normal(y, a, N);
      pts.push(P.clone().addScaledVector(N, 0.0025));
    }
    const curve = new THREE.CatmullRomCurve3(pts, true);
    mesh(new THREE.TubeGeometry(curve, 80, 0.0013, 5, true), gold, torsoG);
    const p = pts[20];
    ball(0.0058, gold, torsoG, p.x, p.y - 0.006, p.z + 0.003, 1, 1, 0.5);
  }

  // ---- legs
  const shoeGeo = makeShoe();
  for (const s of [-1, 1]) {
    const mir = (keys) => keys.map((k) => ({ ...k, x: (k.x ?? 0) * s }));
    const leg = group(hips, s * def.hip.x, def.hip.y, 0);
    const thigh = makeSurface(mir(def.thigh), [{ back: true, x: 0, ...def.glute }]);
    const LY = gridYs(thigh, 30);
    mesh(buildLoft(thigh, { ys: LY, na: 32, capLo: def.thigh.at(-1).rf * 0.8, capHi: 0.05 }), skin, leg);
    mesh(buildLoft(thigh, { y1: 0, ys: rowsBetween(LY, sh.hem, 0), na: 32, offset: 0.005, capHi: 0.052 }), cloth, leg);
    mesh(buildLoft(thigh, { ys: rowsBetween(LY, sh.hem, sh.hem + 0.016), na: 32, offset: 0.007 }), clothDark, leg);
    const kneeK = def.thigh.at(-1);
    const shinG = group(leg, (kneeK.x ?? 0) * s, kneeK.y, 0);
    const shin = makeSurface(mir(def.shin));
    mesh(buildLoft(shin, { ny: 22, na: 28, capHi: def.shin[0].rf * 0.8, capLo: 0.02 }), skin, shinG);
    const ank = def.shin.at(-1);
    const foot = group(shinG, (ank.x ?? 0) * s, ank.y, 0);
    foot.scale.setScalar(def.shoe);
    const fy = -def.ankleH / def.shoe;
    const up = mesh(shoeGeo.upper, white, foot, 0, fy + 0.02, 0.012); up.rotation.y = s * 0.06;
    const so = mesh(shoeGeo.sole, sole, foot, 0, fy + 0.012, 0.012); so.rotation.y = s * 0.06;
    const cuff = mesh(new THREE.CylinderGeometry(0.036, 0.033, 0.035, 20), white, foot, 0, fy + 0.098, -0.004);
    cuff.scale.z = 1.12;
    for (let i = 0; i < 3; i++) { const l = mesh(new THREE.BoxGeometry(0.036, 0.004, 0.007), sole, up, 0, 0.046 - i * 0.008, 0.062 + i * 0.02); l.rotation.x = 0.55; }
    J[s < 0 ? 'legR' : 'legL'] = leg; J[s < 0 ? 'shinR' : 'shinL'] = shinG;
  }

  // ---- arms
  for (const s of [-1, 1]) {
    const arm = group(torsoG, s * def.shoulder.x, def.shoulder.y, 0);
    const upper = makeSurface(def.upper);
    mesh(buildLoft(upper, { ny: 16, na: 24, capHi: def.upper[0].rx * 0.85, capLo: def.upper.at(-1).rx * 0.8 }), skin, arm);
    const foreG = group(arm, 0, def.upper.at(-1).y, 0);
    const fore = makeSurface(def.fore);
    mesh(buildLoft(fore, { ny: 16, na: 24, capHi: def.fore[0].rx * 0.8, capLo: 0.01 }), skin, foreG);
    const hand = group(foreG, 0, def.fore.at(-1).y, 0);
    hand.scale.setScalar(def.hand);
    const palm = makeSurface([
      { y: -0.072, rx: 0.0095, rf: 0.027, rb: 0.027, e: 2.4 },
      { y: -0.04, rx: 0.012, rf: 0.032, rb: 0.03, e: 2.4 },
      { y: -0.012, rx: 0.013, rf: 0.024, rb: 0.022, e: 2.2 },
      { y: 0.012, rx: 0.015, rf: 0.021, rb: 0.021, e: 2 },
    ]);
    mesh(buildLoft(palm, { ny: 10, na: 18, capLo: 0.006 }), skin, hand);
    const lens = [0.03, 0.035, 0.032, 0.025];
    for (let i = 0; i < 4; i++) {
      const f = group(hand, 0, -0.07, 0.021 - i * 0.0142);
      f.rotation.z = -s * (0.2 + i * 0.05); f.rotation.x = (1.5 - i) * -0.05;
      const r = 0.0066 - i * 0.0003;
      mesh(new THREE.CapsuleGeometry(r, lens[i], 3, 8), skin, f, 0, -lens[i] / 2, 0);
      const f2 = group(f, 0, -lens[i], 0); f2.rotation.z = -s * 0.4;
      mesh(new THREE.CapsuleGeometry(r * 0.9, lens[i] * 0.75, 3, 8), skin, f2, 0, -lens[i] * 0.375, 0);
    }
    const th = group(hand, -s * 0.004, -0.02, 0.026);
    th.rotation.x = -0.55; th.rotation.z = -s * 0.25;
    mesh(new THREE.CapsuleGeometry(0.0078, 0.028, 3, 8), skin, th, 0, -0.014, 0);
    const th2 = group(th, 0, -0.03, 0); th2.rotation.x = 0.3;
    mesh(new THREE.CapsuleGeometry(0.0068, 0.02, 3, 8), skin, th2, 0, -0.01, 0);
    J[s < 0 ? 'armR' : 'armL'] = arm; J[s < 0 ? 'foreR' : 'foreL'] = foreG;
  }

  // ---- head
  const f = def.face;
  const headG = group(torsoG, 0, def.neckY, 0);
  const headIn = group(headG, 0, def.chinY - def.neckY, 0); // origin at the chin
  J.head = headG;
  const headSurf = makeSurface(def.head, [
    { x: 0, y: f.noseY + 0.003, sx: 0.0105, sy: 0.011, syUp: 0.034, amp: 0.02, pw: 1 },
    { x: f.cheekX, y: f.cheekY, sx: 0.03, sy: 0.03, amp: 0.006 },
    { x: 0, y: f.mouthY, sx: 0.022, sy: 0.011, amp: 0.005 },
    { x: f.eyeX, y: f.eyeY, sx: 0.02, sy: 0.014, amp: -0.0035 },
    { x: 0, y: 0.014, sx: 0.02, sy: 0.013, amp: 0.004 },
  ]);
  const headGeo = buildLoft(headSurf, { ny: 56, na: 64, capLo: 0.006, capHi: def.headCap });
  { // planar-project the face texture from the front
    const p = headGeo.attributes.position, n = headGeo.attributes.normal, uv = headGeo.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), front = n.getZ(i) > -0.05;
      uv.setXY(i, front ? (x - FACE.x0) / (FACE.x1 - FACE.x0) : (x > 0 ? 0.995 : 0.005), (p.getY(i) - FACE.y0) / (FACE.y1 - FACE.y0));
    }
  }
  const faceCanvas = document.createElement('canvas'); faceCanvas.width = FACE.w; faceCanvas.height = FACE.h;
  const faceCtx = faceCanvas.getContext('2d');
  const faceTex = new THREE.CanvasTexture(faceCanvas);
  faceTex.colorSpace = THREE.SRGBColorSpace; faceTex.anisotropy = 4;
  mesh(headGeo, std({ map: faceTex, roughness: 0.6, emissive: col.skin, emissiveIntensity: 0.05 }), headIn);
  let exprName = null;
  const paint = (name) => { if (name === exprName) return; exprName = name; paintFace(faceCtx, f, col, EXPRESSIONS[name], mulberry(def.seed + 5)); faceTex.needsUpdate = true; };

  // ears + earrings
  const earX = headSurf.ring(def.earY).rx;
  for (const s of [-1, 1]) {
    const e = ball(0.015, skin, headIn, s * (earX + 0.002), def.earY + 0.012, -0.004, 0.45, 1.25, 0.8);
    e.rotation.y = s * 0.3;
    if (def.earring === 'hoop') {
      const h = mesh(new THREE.TorusGeometry(0.0115, 0.0016, 8, 24), gold, headIn, s * (earX + 0.004), def.earY - 0.018, 0.002);
      h.rotation.y = Math.PI / 2 - s * 0.35;
    } else ball(0.0042, gold, headIn, s * (earX + 0.006), def.earY - 0.002, 0.002);
  }

  // glasses
  if (def.glasses) {
    const tort = canvasTex(64, 64, (g) => {
      g.fillStyle = '#4a2410'; g.fillRect(0, 0, 64, 64);
      for (let i = 0; i < 40; i++) { g.fillStyle = ['#8a4a1a', '#2a1208', '#b06a24', '#6a3414'][i % 4]; g.beginPath(); g.arc(rnd() * 64, rnd() * 64, 2 + rnd() * 6, 0, TAU); g.fill(); }
    });
    tort.wrapS = tort.wrapT = THREE.RepeatWrapping; tort.repeat.set(6, 1);
    const frame = std({ map: tort, roughness: 0.3, metalness: 0.1 });
    const lens = new THREE.MeshStandardMaterial({ color: 0xfff4e0, transparent: true, opacity: 0.13, roughness: 0.05, metalness: 0.2, depthWrite: false });
    const P = new V3();
    headSurf.point(f.eyeY, Math.PI, P);
    const gz = P.z + 0.012, gx = f.eyeX + 0.003, R = 0.0325;
    const gl = group(headIn, 0, f.eyeY + 0.001, gz);
    for (const s of [-1, 1]) {
      const rim = mesh(new THREE.TorusGeometry(R, 0.0034, 10, 40), frame, gl, s * gx, 0, -0.004);
      rim.rotation.y = s * 0.16; rim.scale.set(1.06, 1, 1);
      const l = mesh(new THREE.CircleGeometry(R, 28), lens, gl, s * gx, 0, -0.004); l.rotation.y = s * 0.16; l.scale.set(1.06, 1, 1);
      // temple arm back to the ear
      const x0 = s * (gx + R * 1.06), z0 = -0.008, x1 = s * (earX + 0.006), z1 = -(gz) - 0.004;
      const len = Math.hypot(x1 - x0, z1 - z0);
      const t = mesh(new THREE.BoxGeometry(0.0035, 0.005, len), frame, gl, (x0 + x1) / 2, 0.006, (z0 + z1) / 2);
      t.rotation.y = Math.atan2(x1 - x0, z1 - z0);
      ball(0.005, frame, gl, x0, 0.006, z0, 0.9, 0.9, 0.7);
    }
    const br = mesh(new THREE.TorusGeometry(0.0075, 0.0028, 8, 14, Math.PI), frame, gl, 0, 0.004, 0);
    void br;
  }

  buildHair(def.hair, col, headIn, rnd);
  paint('smile');

  // ---- rig
  const rig = {
    def, root, joints: J, height: def.height, name: def.name,
    expr: 'smile', exprTimer: 0, blink: 2 + rnd() * 3, rest: def.armRest,
    setExpression(name, hold = 0) { this.expr = EXPRESSIONS[name] ? name : 'smile'; this.exprTimer = hold; paint(this.expr); },
    tickFace(dt) {
      if (this.exprTimer > 0) { this.exprTimer -= dt; if (this.exprTimer <= 0) { this.expr = 'smile'; paint('smile'); } }
      if (this.expr !== 'smile') return;
      this.blink -= dt;
      if (this.blink < 0) { paint('blink'); if (this.blink < -0.12) { paint('smile'); this.blink = 2 + Math.random() * 4; } }
    },
  };
  return rig;
}

function makeShoe() {
  // lofted along the foot's length, then laid down so the loft axis points forward
  const upper = makeSurface([
    { y: -0.082, rx: 0.02, rb: 0.03, rf: 0.008, e: 2.4 },
    { y: -0.06, rx: 0.034, rb: 0.07, rf: 0.008, e: 2.6 },
    { y: -0.02, rx: 0.04, rb: 0.078, rf: 0.008, e: 2.6 },
    { y: 0.03, rx: 0.044, rb: 0.062, rf: 0.008, e: 2.6 },
    { y: 0.085, rx: 0.048, rb: 0.042, rf: 0.008, e: 2.6 },
    { y: 0.13, rx: 0.043, rb: 0.034, rf: 0.008, e: 2.5 },
    { y: 0.158, rx: 0.024, rb: 0.022, rf: 0.008, e: 2.3 },
  ]);
  const sole = makeSurface([
    { y: -0.086, rx: 0.022, rb: 0.006, rf: 0.012, e: 3 },
    { y: -0.06, rx: 0.037, rb: 0.006, rf: 0.012, e: 3 },
    { y: 0.03, rx: 0.047, rb: 0.006, rf: 0.012, e: 3 },
    { y: 0.085, rx: 0.051, rb: 0.006, rf: 0.012, e: 3 },
    { y: 0.132, rx: 0.046, rb: 0.006, rf: 0.012, e: 3 },
    { y: 0.163, rx: 0.026, rb: 0.006, rf: 0.012, e: 3 },
  ]);
  const u = buildLoft(upper, { ny: 22, na: 24, capLo: 0.006, capHi: 0.01 }).rotateX(Math.PI / 2);
  const s = buildLoft(sole, { ny: 14, na: 24, capLo: 0.006, capHi: 0.008 }).rotateX(Math.PI / 2);
  return { upper: u, sole: s };
}

// ---------------------------------------------------------------------
//  Animation.  s = { t, dt, speed, phase, air, action }
//  The character faces +z; negative x-rotation swings a limb forward.
// ---------------------------------------------------------------------
export function animateRig(rig, s) {
  const J = rig.joints, t = s.t;
  const k = clamp(s.speed / 3.2, 0, 1);       // how much we are moving
  const run = sstep(1.8, 4.2, s.speed);        // walk -> run blend
  const ph = s.phase, sw = Math.sin(ph);
  const rest = rig.rest;
  const breathe = Math.sin(t * 1.7);
  if (s.air) {
    J.legL.rotation.x = -0.75; J.shinL.rotation.x = 1.15;
    J.legR.rotation.x = 0.3; J.shinR.rotation.x = 0.55;
    J.armL.rotation.set(-0.5, 0, rest + 1.0); J.armR.rotation.set(0.4, 0, -rest - 1.0);
    if (J.foreL) { J.foreL.rotation.set(-0.6, 0, 0); J.foreR.rotation.set(-0.6, 0, 0); }
    J.hips.position.y = 0; J.hips.rotation.set(0.06, 0, 0);
    J.torso.rotation.set(0, 0, 0);
    if (J.head) J.head.rotation.set(-0.1, 0, 0);
    return;
  }
  const A = k * lerp(0.5, 0.85, run);
  J.legL.rotation.x = -sw * A - run * k * 0.12; J.legR.rotation.x = sw * A - run * k * 0.12;
  J.legL.rotation.z = 0; J.legR.rotation.z = 0;
  if (J.shinL) {
    const bend = (p) => k * (0.1 + lerp(0.75, 1.5, run) * Math.pow(Math.max(0, Math.cos(p - 0.5)), 1.4));
    J.shinL.rotation.x = bend(ph); J.shinR.rotation.x = bend(ph + Math.PI);
  }
  const armA = k * lerp(0.45, 0.8, run);
  J.armL.rotation.set(sw * armA, 0, rest + breathe * 0.012 * (1 - k));
  J.armR.rotation.set(-sw * armA, 0, -rest - breathe * 0.012 * (1 - k));
  if (J.foreL) {
    const eb = 0.14 + k * lerp(0.25, 1.35, run);
    J.foreL.rotation.set(-eb - Math.max(0, -sw) * k * 0.3, 0, 0);
    J.foreR.rotation.set(-eb - Math.max(0, sw) * k * 0.3, 0, 0);
  }
  J.hips.position.y = -k * 0.012 + Math.abs(Math.cos(ph)) * k * lerp(0.02, 0.05, run) * rig.height / 1.6;
  J.hips.rotation.set(k * lerp(0.03, 0.13, run), sw * k * 0.07, Math.sin(ph) * k * 0.025);
  J.torso.rotation.set(breathe * 0.006, -sw * k * 0.16, -Math.sin(ph) * k * 0.03 + Math.sin(t * 0.6) * 0.012 * (1 - k));
  if (J.head) J.head.rotation.set(-k * run * 0.08 + Math.sin(t * 0.9) * 0.02 * (1 - k), sw * k * 0.1 + Math.sin(t * 0.43) * 0.09 * (1 - k), Math.sin(t * 0.7) * 0.025 * (1 - k));

  if (s.action === 'wave') {
    J.armR.rotation.set(0, 0, (J.foreR ? -2.0 : -2.6) + Math.sin(t * (J.foreR ? 2 : 9)) * (J.foreR ? 0.05 : 0.3));
    if (J.foreR) J.foreR.rotation.set(0, 0, -0.95 + Math.sin(t * 9) * 0.4);
    if (J.head) J.head.rotation.z = -0.1;
    J.torso.rotation.z = -0.04;
  } else if (s.action === 'still') {
    J.torso.rotation.set(0, 0, 0); J.hips.rotation.set(0, 0, 0);
    if (J.head) J.head.rotation.set(0, 0, 0);
    J.armL.rotation.set(0, 0, rest); J.armR.rotation.set(0, 0, -rest);
    if (J.foreL) { J.foreL.rotation.set(-0.08, 0, 0); J.foreR.rotation.set(-0.08, 0, 0); }
  }
}
