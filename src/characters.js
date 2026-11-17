// =====================================================================
//  Procedural character models
//  Body proportions come from silhouette profiles measured off the
//  character reference sheets (tables below are in units of body height).
//  Bodies are lofted from those cross-sections, garments are thin shells
//  over the same surfaces, faces are painted to a canvas (so expressions
//  can change), and hair is a sculpted, clumped volume plus loose locks.
// =====================================================================
import * as THREE from 'three';

const TAU = Math.PI * 2;
const V3 = THREE.Vector3;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const spow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);
const deg = (d) => d * Math.PI / 180;
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hex = (c) => '#' + new THREE.Color(c).getHexString();
const rgba = (c, a) => { const k = new THREE.Color(c); return `rgba(${k.r * 255 | 0},${k.g * 255 | 0},${k.b * 255 | 0},${a})`; };
const std = (o) => new THREE.MeshStandardMaterial(o);

// ---------------------------------------------------------------------
//  Lofted surfaces
//  keys: [{y, rx, rf, rb, x, z, e}]  (half-width, front depth, back depth,
//  centre offset, superellipse exponent).  a = 0 is the back, a = PI the front.
//  bumps: gaussian swellings/dents on the front or back, mirrored across x.
//  warp: optional (point, y, a, ring) hook for relief such as hair clumps.
// ---------------------------------------------------------------------
const PROPS = ['rx', 'rf', 'rb', 'x', 'z', 'e'];
function makeSurface(keys, bumps = [], warp = null) {
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
    target.set(x, y, z);
    if (warp) warp(target, y, a, r);
    return target;
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

// o: { ys | y0,y1,ny, na, offset, capLo, capHi, color(y,a,Color), uvFn(y,a,[u,v]), uv1 }
function buildLoft(surf, o = {}) {
  const y0 = o.y0 ?? (o.ys ? o.ys[0] : surf.y0), y1 = o.y1 ?? (o.ys ? o.ys.at(-1) : surf.y1), ny = o.ny ?? 24, na = o.na ?? 36, off = o.offset ?? 0, cs = o.capSeg ?? 5;
  const pos = [], nor = [], uv = [], uv1 = [], colr = [];
  const P = new V3(), N = new V3(), r = {}, C = new THREE.Color(), UV = [0, 0];
  let rows = 0;
  const row = (y, s, dyc, nyc) => {
    surf.ring(y, r);
    const cx = r.x, cz = r.z;
    for (let j = 0; j <= na; j++) {
      const a = (j % na) / na * TAU;
      surf.point(y, a, P); surf.normal(y, a, N);
      P.addScaledVector(N, off);
      if (s !== 1) { P.x = cx + (P.x - cx) * s; P.z = cz + (P.z - cz) * s; P.y += dyc; N.multiplyScalar(s); N.y += nyc; N.normalize(); }
      pos.push(P.x, P.y, P.z); nor.push(N.x, N.y, N.z);
      const pu = j / na, pv = (y - surf.y0) / (surf.y1 - surf.y0);
      if (o.uvFn) { o.uvFn(y, j / na * TAU, UV); uv.push(UV[0], UV[1]); uv1.push(pu, pv); } else uv.push(pu, pv);
      if (o.color) { o.color(y, a, C); colr.push(C.r, C.g, C.b); }
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
  if (uv1.length) g.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
  if (colr.length) g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.setIndex(idx);
  return g;
}
const gridYs = (surf, n) => Array.from({ length: n + 1 }, (_, i) => surf.y0 + (surf.y1 - surf.y0) * i / n);
// rows of a base grid between y0 and y1 (inclusive ends), so a shell's vertices sit exactly over the skin's
const rowsBetween = (ys, y0, y1) => [y0, ...ys.filter((y) => y > y0 + 1e-4 && y < y1 - 1e-4), y1];

// A texture computed per texel over a surface's (angle, y) space.
// fn(x, y, z, a, out) writes sRGB r,g,b and an alpha "field" (0.5 = the cut edge) into out.
function procTexture(surf, fn, w, h, yLo = surf.y0, yHi = surf.y1) {
  const data = new Uint8Array(w * h * 4), P = new V3(), out = [0, 0, 0, 0];
  for (let j = 0; j < h; j++) {
    const y = surf.y0 + (surf.y1 - surf.y0) * (j + 0.5) / h;
    if (y < yLo || y > yHi) continue;
    for (let i = 0; i < w; i++) {
      const a = (i + 0.5) / w * TAU, k = (j * w + i) * 4;
      surf.point(y, a, P);
      fn(P.x, y, P.z, a, out);
      data[k] = clamp(out[0], 0, 1) * 255; data[k + 1] = clamp(out[1], 0, 1) * 255; data[k + 2] = clamp(out[2], 0, 1) * 255; data[k + 3] = clamp(out[3], 0, 1) * 255;
    }
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  t.wrapS = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
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

// Paint onto a surface's unwrapped skin.  blob() sizes are in metres.
function skinTex(surf, base, w, h, draw) {
  const t = canvasTex(w, h, (g) => {
    g.fillStyle = hex(base); g.fillRect(0, 0, w, h);
    const r = {};
    const py = (y) => (1 - (y - surf.y0) / (surf.y1 - surf.y0)) * h;
    const blob = (a, y, rxm, rym, color, alpha) => {
      surf.ring(y, r);
      const rp = rxm / (TAU * (r.rx + (r.rf + r.rb) / 2) / 2) * w, ryp = rym / (surf.y1 - surf.y0) * h;
      for (const k of [-1, 0, 1]) {
        const cx = (a / TAU + k) * w;
        if (cx + rp < 0 || cx - rp > w) continue;
        g.save(); g.translate(cx, py(y)); g.scale(rp, ryp);
        const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
        gr.addColorStop(0, rgba(color, alpha)); gr.addColorStop(0.55, rgba(color, alpha * 0.5)); gr.addColorStop(1, rgba(color, 0));
        g.fillStyle = gr; g.fillRect(-1, -1, 2, 2); g.restore();
      }
    };
    draw(blob, g, py);
  });
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

const mesh = (geo, mat, parent, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
const group = (parent, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
const SPHERE = new THREE.SphereGeometry(1, 20, 14);
const ball = (r, mat, parent, x, y, z, sx = 1, sy = 1, sz = 1) => { const m = mesh(SPHERE, mat, parent, x, y, z); m.scale.set(r * sx, r * sy, r * sz); return m; };

// ---------------------------------------------------------------------
//  Face painting (head-local metres; +x is the character's left)
// ---------------------------------------------------------------------
const FACE = { x0: -0.11, x1: 0.11, y0: -0.03, y1: 0.27, w: 1024, h: 1396 };
const FK = FACE.w / (FACE.x1 - FACE.x0);
const FX = (x) => (x - FACE.x0) * FK;
const FY = (y) => (FACE.y1 - y) * FK;

export const EXPRESSIONS = {
  smile: { label: 'Smile', open: 1, mouth: 'smile', brow: [0, 0, 0.002, 0.03], look: [0, 0] },
  laugh: { label: 'Laugh', open: 0, mouth: 'laugh', brow: [0.004, 0.05, 0.004, 0.05], look: [0, 0] },
  hmm: { label: 'Hmm…', open: 0.8, mouth: 'smirk', brow: [-0.003, -0.2, 0.008, 0.12], look: [0.7, 0.6] },
  wow: { label: 'Wow!', open: 1.3, mouth: 'o', brow: [0.009, 0.1, 0.009, 0.1], look: [0, 0] },
  blink: { open: 0, closedDown: true, mouth: 'smile', brow: [0, 0, 0.002, 0.03], look: [0, 0] },
};

function paintFace(ctx, f, col, ex, rnd) {
  const W = FACE.w, H = FACE.h;
  const sh = (a) => rgba(col.skinShade, a);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = hex(col.skin); ctx.fillRect(0, 0, W, H);
  const local = (x, y, sx = 1) => { ctx.save(); ctx.translate(FX(x), FY(y)); ctx.scale(sx * FK, -FK); };
  const soft = (x, y, rx, ry, color, a) => {
    ctx.save(); ctx.translate(FX(x), FY(y)); ctx.scale(rx * FK, ry * FK);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, rgba(color, a)); g.addColorStop(0.5, rgba(color, a * 0.55)); g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
  };
  // soft modelling: shade under the fringe, round the sides of the face, light the centre
  let g = ctx.createLinearGradient(0, FY(f.browY + 0.07), 0, FY(f.browY + 0.012));
  g.addColorStop(0, sh(0.5)); g.addColorStop(1, sh(0));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, FY(f.browY));
  for (const s of [-1, 1]) {
    g = ctx.createLinearGradient(FX(s * 0.092), 0, FX(s * 0.055), 0);
    g.addColorStop(0, sh(0.4)); g.addColorStop(1, sh(0));
    ctx.fillStyle = g; ctx.fillRect(s < 0 ? 0 : FX(0.05), 0, FX(-0.05), H);
  }
  soft(0, f.eyeY - 0.02, 0.03, 0.05, col.skinLight, 0.22);
  soft(0, 0.012, 0.03, 0.014, col.skinLight, 0.18);
  soft(0, f.mouthY - 0.02, 0.03, 0.01, col.skinShade, 0.22);
  // blush + freckles
  for (const s of [-1, 1]) {
    soft(s * f.cheekX, f.cheekY, 0.036, 0.027, col.blush, f.blush);
    soft(s * (f.cheekX - 0.004), f.cheekY + 0.012, 0.012, 0.007, col.skinLight, 0.25);
  }
  soft(0, f.noseY + 0.006, 0.02, 0.014, col.blush, f.blush * 0.45);
  for (let i = 0; i < f.freckles; i++) {
    const x = (rnd() * 2 - 1) * 0.066, y = f.cheekY + 0.008 + (rnd() * 2 - 1) * 0.02 - Math.abs(x) * 0.14;
    ctx.fillStyle = rnd() < f.frecklesLight ? rgba(col.skinLight, 0.55) : sh(0.4 + rnd() * 0.25);
    ctx.beginPath(); ctx.arc(FX(x), FY(y), (0.0004 + rnd() * 0.0007) * FK, 0, TAU); ctx.fill();
  }
  // nose: shaded underside, nostrils, bright tip
  soft(0, f.noseY - 0.006, 0.014, 0.006, col.skinShade, 0.45);
  for (const s of [-1, 1]) soft(s * 0.012, f.noseY + 0.004, 0.006, 0.012, col.skinShade, 0.2);
  local(0, f.noseY);
  ctx.strokeStyle = sh(0.8); ctx.lineWidth = 0.0015; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-0.0105, 0.0015); ctx.quadraticCurveTo(-0.0085, -0.0045, -0.0035, -0.0035); ctx.quadraticCurveTo(0, -0.0055, 0.0035, -0.0035); ctx.quadraticCurveTo(0.0085, -0.0045, 0.0105, 0.0015); ctx.stroke();
  ctx.fillStyle = rgba(col.lipLine, 0.75);
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(s * 0.0052, -0.0028, 0.0022, 0.0011, s * 0.45, 0, TAU); ctx.fill(); }
  ctx.restore();
  soft(-0.002, f.noseY + 0.007, 0.006, 0.006, 0xfff2e0, 0.5);

  // eyes
  for (const s of [-1, 1]) {
    soft(s * f.eyeX, f.eyeY + 0.006, 0.03, 0.02, col.skinShade, 0.2);
    local(s * f.eyeX, f.eyeY, s);
    ctx.rotate(f.eyeTilt);
    const w = f.eyeW / 2, h = f.eyeH / 2 * Math.min(ex.open, 1.3);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (ex.open < 0.15) {
      const k = ex.closedDown ? -1 : 1;
      ctx.strokeStyle = hex(col.lash); ctx.lineWidth = 0.0034;
      ctx.beginPath(); ctx.moveTo(-w, -0.001 * k); ctx.quadraticCurveTo(0, k * w * 0.62, w, 0.001 * k); ctx.stroke();
      ctx.lineWidth = 0.0018;
      for (const q of [0.5, 0.75, 1]) { ctx.beginPath(); ctx.moveTo(w * q, k * w * 0.3 * (1 - q * q)); ctx.lineTo(w * q + 0.0045, k * w * 0.3 * (1 - q * q) + (k > 0 ? 0.0038 : -0.0032)); ctx.stroke(); }
    } else {
      const upper = () => ctx.bezierCurveTo(-w * 0.55, h * 1.45, w * 0.4, h * 1.5, w, 0.003);
      const almond = () => { ctx.beginPath(); ctx.moveTo(-w, -0.0012); upper(); ctx.bezierCurveTo(w * 0.5, -h * 1.05, -w * 0.5, -h * 1.15, -w, -0.0012); ctx.closePath(); };
      // soft shadow over the lid
      ctx.fillStyle = rgba(col.lidShade, 0.35);
      ctx.beginPath(); ctx.moveTo(-w * 1.05, 0); ctx.bezierCurveTo(-w * 0.6, h * 2.2 + 0.003, w * 0.6, h * 2.3 + 0.003, w * 1.25, 0.006); ctx.bezierCurveTo(w * 0.4, h * 1.4, -w * 0.5, h * 1.4, -w * 1.05, 0); ctx.fill();
      almond(); ctx.fillStyle = '#fff6ea'; ctx.fill();
      ctx.save(); ctx.clip();
      const ix = s * ex.look[0] * w * 0.3, iy = ex.look[1] * h * 0.35 + 0.0006, ir = f.irisR;
      let ig = ctx.createRadialGradient(ix, iy - ir * 0.35, ir * 0.1, ix, iy, ir);
      ig.addColorStop(0, hex(col.irisHi)); ig.addColorStop(0.7, hex(col.iris)); ig.addColorStop(0.92, hex(col.irisRim)); ig.addColorStop(1, hex(col.irisRim));
      ctx.fillStyle = ig; ctx.beginPath(); ctx.arc(ix, iy, ir, 0, TAU); ctx.fill();
      ctx.strokeStyle = rgba(col.irisHi, 0.35); ctx.lineWidth = 0.00035;
      for (let i = 0; i < 26; i++) { const an = i / 26 * TAU; ctx.beginPath(); ctx.moveTo(ix + Math.cos(an) * ir * 0.5, iy + Math.sin(an) * ir * 0.5); ctx.lineTo(ix + Math.cos(an) * ir * 0.9, iy + Math.sin(an) * ir * 0.9); ctx.stroke(); }
      ctx.fillStyle = '#160a05'; ctx.beginPath(); ctx.arc(ix, iy, ir * 0.46, 0, TAU); ctx.fill();
      const tg = ctx.createLinearGradient(0, h * 1.4, 0, -h * 0.1); tg.addColorStop(0, 'rgba(40,15,5,0.6)'); tg.addColorStop(1, 'rgba(40,15,5,0)');
      ctx.fillStyle = tg; ctx.fillRect(-w, -h * 0.1, 2 * w, h * 1.6);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(ix - s * ir * 0.36, iy + ir * 0.4, ir * 0.25, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.arc(ix + s * ir * 0.38, iy - ir * 0.42, ir * 0.12, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
      ctx.restore();
      // lash line, wing and lashes
      ctx.strokeStyle = hex(col.lash); ctx.lineWidth = f.lashW;
      ctx.beginPath(); ctx.moveTo(-w, -0.0012); upper(); ctx.lineTo(w + 0.005, 0.0075); ctx.stroke();
      ctx.lineWidth = f.lashW * 0.55;
      for (let i = 0; i < f.lashes; i++) { const q = 0.35 + i / f.lashes * 0.7, lx = w * q, ly = h * 1.42 * (1 - q * q * 0.75) + 0.001; ctx.beginPath(); ctx.moveTo(lx, ly); ctx.quadraticCurveTo(lx + 0.002, ly + 0.003, lx + 0.0035 + q * 0.002, ly + 0.0045); ctx.stroke(); }
      ctx.strokeStyle = rgba(col.lash, 0.5); ctx.lineWidth = 0.0009;
      ctx.beginPath(); ctx.moveTo(w, 0.003); ctx.bezierCurveTo(w * 0.5, -h * 1.05, -w * 0.5, -h * 1.15, -w, -0.0012); ctx.stroke();
      ctx.strokeStyle = sh(0.7); ctx.lineWidth = 0.0011;
      ctx.beginPath(); ctx.moveTo(-w * 0.85, h * 1.1 + 0.0025); ctx.quadraticCurveTo(0, h * 1.75 + 0.005, w * 1.0, h * 0.8 + 0.0055); ctx.stroke();
      ctx.strokeStyle = sh(0.35); ctx.lineWidth = 0.001;
      ctx.beginPath(); ctx.moveTo(-w * 0.7, -h * 1.1 - 0.003); ctx.quadraticCurveTo(0, -h * 1.5 - 0.004, w * 0.8, -h * 0.9 - 0.002); ctx.stroke();
    }
    ctx.restore();
    // brow (index 0/1 = character's right, 2/3 = left)
    const bi = s < 0 ? 0 : 2;
    local(s * f.browX, f.browY + ex.brow[bi], s);
    ctx.rotate(ex.brow[bi + 1] + f.browTilt);
    const bw = f.browW / 2, t = f.browT, ar = f.browArch;
    const browPath = () => {
      ctx.beginPath(); ctx.moveTo(-bw, -t * 0.1);
      ctx.quadraticCurveTo(-bw * 1.02, t * 0.75, -bw * 0.7, t * 0.85 + ar * 0.35);
      ctx.quadraticCurveTo(bw * 0.25, ar + t * 1.25, bw * 0.55, ar * 0.9 + t * 0.55);
      ctx.quadraticCurveTo(bw * 0.85, ar * 0.5 + t * 0.2, bw * 1.05, -0.0015);
      ctx.quadraticCurveTo(bw * 0.7, ar * 0.45 - t * 0.05, bw * 0.3, ar * 0.75 + t * 0.05);
      ctx.quadraticCurveTo(-bw * 0.4, ar * 0.4 - t * 0.1, -bw, -t * 0.1);
    };
    browPath(); ctx.fillStyle = hex(col.brow); ctx.fill();
    ctx.save(); browPath(); ctx.clip();
    ctx.strokeStyle = rgba(col.browHi, 0.5); ctx.lineWidth = 0.0005;
    for (let i = 0; i < 22; i++) { const bx = -bw + i / 21 * 2 * bw; ctx.beginPath(); ctx.moveTo(bx, -t); ctx.lineTo(bx + 0.004, ar + t * 1.4); ctx.stroke(); }
    ctx.restore();
    ctx.restore();
  }

  // mouth
  const mw = f.mouthW / 2;
  const lips = (w, sag, tU, tL) => {
    const top = [], mid = [], bot = [];
    for (let i = 0; i <= 32; i++) {
      const u = i / 16 - 1, x = u * w, m = -sag * (1 - u * u) + 0.003 * u * u * u * u;
      mid.push([x, m]);
      top.push([x, m + tU * Math.pow(1 - u * u, 0.55) * (1 - 0.32 * Math.exp(-(u * u) / 0.02)) * (1 + 0.25 * Math.exp(-((Math.abs(u) - 0.25) ** 2) / 0.03))]);
      bot.push([x, m - tL * Math.pow(1 - u * u, 0.75)]);
    }
    const poly = (a, b, fill) => { ctx.beginPath(); a.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); for (let i = b.length - 1; i >= 0; i--) ctx.lineTo(b[i][0], b[i][1]); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); };
    poly(top, mid, hex(col.lipDark)); poly(mid, bot, hex(col.lip));
    ctx.strokeStyle = hex(col.lipLine); ctx.lineWidth = 0.0014; ctx.lineCap = 'round';
    ctx.beginPath(); mid.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke();
    ctx.fillStyle = 'rgba(255,238,225,0.42)'; ctx.beginPath(); ctx.ellipse(0, -sag - tL * 0.45, w * 0.32, tL * 0.2, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,238,225,0.2)'; ctx.beginPath(); ctx.ellipse(0, -sag + tU * 0.45, w * 0.22, tU * 0.16, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = sh(0.75); ctx.lineWidth = 0.0013;
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * (w + 0.0004), 0.0028); ctx.quadraticCurveTo(s * (w + 0.0035), 0.0045, s * (w + 0.0035), 0.0085); ctx.stroke(); }
  };
  if (ex.mouth === 'smile') { local(0.001, f.mouthY); ctx.rotate(f.smileTilt); lips(mw, 0.0075, f.lipU, f.lipL); ctx.restore(); }
  else if (ex.mouth === 'smirk') { local(0.006, f.mouthY - 0.001); ctx.rotate(0.16); lips(mw * 0.6, 0.0012, f.lipU * 1.1, f.lipL); ctx.restore(); }
  else if (ex.mouth === 'o') {
    local(0, f.mouthY - 0.003);
    ctx.fillStyle = hex(col.lip); ctx.beginPath(); ctx.ellipse(0, 0, 0.0115, 0.0135, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#4a1418'; ctx.beginPath(); ctx.ellipse(0, 0, 0.0068, 0.0088, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#c9605e'; ctx.beginPath(); ctx.ellipse(0, -0.0055, 0.0044, 0.0028, 0, 0, TAU); ctx.fill();
    ctx.restore();
  } else if (ex.mouth === 'laugh') {
    local(0, f.mouthY + 0.005);
    const w = mw * 1.05, d = 0.024;
    const shape = () => { ctx.beginPath(); ctx.moveTo(-w, 0.004); ctx.quadraticCurveTo(0, -0.003, w, 0.004); ctx.bezierCurveTo(w * 0.85, -d * 1.25, -w * 0.85, -d * 1.25, -w, 0.004); ctx.closePath(); };
    shape(); ctx.fillStyle = '#4a1418'; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.fillStyle = '#fffaf2'; ctx.fillRect(-w, -0.0072, 2 * w, 0.013);
    ctx.fillStyle = '#d5625f'; ctx.beginPath(); ctx.ellipse(0, -d * 0.98, w * 0.6, d * 0.42, 0, 0, TAU); ctx.fill();
    ctx.restore();
    shape(); ctx.strokeStyle = hex(col.lip); ctx.lineWidth = 0.0034; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.restore();
  }
  // chin and jaw shading
  soft(0, -0.012, 0.06, 0.02, col.skinShade, 0.45);
}

// ---------------------------------------------------------------------
//  Hair
// ---------------------------------------------------------------------
function strandBuilder() {
  const pos = [], nor = [], colr = [], uv = [], idx = [];
  const p = new V3(), T = new V3(), o = new V3(), B = new V3(), N = new V3(), c = new THREE.Color();
  function add(pts, C, w0, th0, cA, cB, hl) {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const n = 30, m = 10, base = pos.length / 3, u0 = Math.random() * 7;
    let pB = null;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      curve.getPoint(t, p); curve.getTangent(t, T);
      o.set(p.x - C.x, (p.y - C.y) * 0.35, p.z - C.z).normalize();
      B.crossVectors(T, o).normalize();
      if (pB && B.dot(pB) < 0) B.negate();
      pB = (pB || new V3()).copy(B);
      N.crossVectors(B, T).normalize(); if (N.dot(o) < 0) N.negate();
      const prof = (0.35 + 0.65 * sstep(0, 0.25, t)) * (1 - 0.8 * sstep(0.68, 1, t)) * (t > 0.999 ? 0.05 : 1);
      const w = w0 * prof, th = th0 * prof;
      c.copy(cA).lerp(cB, clamp(0.2 + 0.8 * Math.exp(-((t - hl) ** 2) / 0.03), 0, 1));
      for (let j = 0; j <= m; j++) {
        const a = j / m * TAU, ca = Math.cos(a), sa = Math.sin(a);
        pos.push(p.x + B.x * ca * w + N.x * sa * th, p.y + B.y * ca * w + N.y * sa * th, p.z + B.z * ca * w + N.z * sa * th);
        const nx = B.x * ca * th + N.x * sa * w, ny = B.y * ca * th + N.y * sa * w, nz = B.z * ca * th + N.z * sa * w, l = Math.hypot(nx, ny, nz) || 1;
        nor.push(nx / l * 0.6 + N.x * 0.4, ny / l * 0.6 + N.y * 0.4, nz / l * 0.6 + N.z * 0.4);
        colr.push(c.r, c.g, c.b); uv.push(u0 + j / m * 0.9, t * 1.6);
      }
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
      const a = base + i * (m + 1) + j, b = a + 1, d = a + m + 1, e = d + 1;
      idx.push(a, b, d, b, e, d);
    }
  }
  function geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.normalizeNormals();
    return g;
  }
  return { add, geometry };
}

let STREAKS = null;
function streakTexture() {
  if (STREAKS) return STREAKS;
  const rnd = mulberry(7);
  STREAKS = canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x++) {
      const v = 0.72 + 0.28 * (0.5 * rnd() + 0.5 * (0.5 + 0.5 * Math.sin(x * 0.37) * Math.sin(x * 0.11 + 2)));
      g.fillStyle = `rgb(${v * 255 | 0},${v * 255 | 0},${v * 255 | 0})`; g.fillRect(x, 0, 1, h);
    }
  });
  STREAKS.wrapS = STREAKS.wrapT = THREE.RepeatWrapping;
  return STREAKS;
}

function buildHair(h, col, headG, rnd) {
  const C = new V3(...h.C);
  const hairG = group(headG);
  const cLo = new THREE.Color(col.hairLo), cMid = new THREE.Color(col.hair), cHi = new THREE.Color(col.hairHi);
  const top = h.bulk.at(-1).y;
  const smooth = makeSurface(h.bulk);

  // ---- the sculpted volume: wavy clumps in relief, cut into lock tips at the bottom
  const layer = (L) => {
    const keys = h.bulk.map((k) => ({ ...k, rx: k.rx * L.scale, rf: k.rf * L.scale, rb: k.rb * L.scale }));
    const N = h.clumps + L.dn, k1 = TAU / h.waveLen, s1 = L.seed, s2 = L.seed * 2.3 + 1;
    const flow = (a, y) => N * a + h.meander * Math.sin(k1 * y + 2 * a + s1) + h.meander * 0.35 * Math.sin(k1 * 1.9 * y + 5 * a + s2);
    const ridge = (x) => 1 - Math.pow(Math.abs(Math.sin(x / 2)), 0.75);
    const env = (y) => sstep(top - 0.015, top - 0.1, y);
    const surf = makeSurface(keys, [], (P, y, a, r) => {
      const x = flow(a, y), dx = P.x - r.x, dz = P.z - r.z, l = Math.hypot(dx, dz) || 1;
      const d = env(y) * (h.relief * (ridge(x) - 0.45) + h.swell * Math.sin(k1 * y + 2 * a + s1 + 1.2));
      P.x += dx / l * d; P.z += dz / l * d;
    });
    const tipY = (a, y) => {
      const x = flow(a, y), id = Math.round(x / TAU), psi = Math.PI - a, backness = (1 - Math.cos(psi)) / 2;
      return lerp(h.endFront, h.endBack, sstep(0.25, 0.8, backness)) + L.dy - hash(id + L.seed * 13) * h.endJit + h.tipLen * Math.pow(1 - ridge(x), 0.8);
    };
    const mask = procTexture(surf, (x, y, z, a, out) => {
      const psiS = Math.atan2(x, z - C.z), psi = Math.abs(psiS);
      const fa = h.faceAngle * (psiS > 0 ? h.tuck : 1) * (1 - 0.25 * sstep(h.earY + 0.05, h.earY - 0.03, y) * (psiS > 0 ? 0 : h.cheekCover));
      const open = fa * (1 - sstep(h.hairline - 0.05, h.hairline + 0.012, y));
      const v = Math.min(0.5 + (psi - open) * 5, 0.5 + (y - tipY(a, y)) * 45);
      out[0] = out[1] = out[2] = out[3] = v;
    }, 512, 512);
    mask.channel = 1; mask.colorSpace = THREE.NoColorSpace;
    const lo = cLo.clone().multiplyScalar(L.dark), mid = cMid.clone().multiplyScalar(L.dark), hi = cHi.clone().multiplyScalar(L.dark);
    const geo = buildLoft(surf, {
      ny: 84, na: 200, capHi: 0.006,
      uvFn: (y, a, uv) => { uv[0] = flow(a, y) / TAU * 2; uv[1] = y * 3; },
      color: (y, a, c) => {
        const rg = ridge(flow(a, y)), e = env(y);
        c.copy(lo).lerp(mid, Math.pow(rg, 0.6) * (0.55 + 0.45 * e) + 0.25 * (1 - e));
        const band = Math.exp(-(((y - h.shineY - 0.02 * Math.sin(2 * a + s1)) / 0.04) ** 2)) + 0.6 * Math.exp(-(((y - h.shineY + h.waveLen * 0.9) / 0.035) ** 2));
        c.lerp(hi, clamp(band * rg * 0.85, 0, 1));
        c.lerp(lo, 0.45 * sstep(top - 0.07, top, y) * h.roots);
      },
    });
    const mat = std({ vertexColors: true, map: streakTexture(), bumpMap: streakTexture(), bumpScale: 1.2, roughness: 0.5, alphaMap: mask, alphaTest: 0.5, side: THREE.DoubleSide });
    mesh(geo, mat, hairG);
  };
  layer({ scale: 0.93, dn: 2, seed: 4.1, dy: 0.012, dark: 0.72 });
  layer({ scale: 1, dn: 0, seed: 1.3, dy: 0, dark: 1 });

  // ---- loose locks: the side-swept fringe and face-framing pieces
  const sb = strandBuilder();
  const P = new V3(), Nn = new V3(), yTop = top;
  const lock = (L) => {
    const [a, b, c] = L.psi, lift = L.lift ?? 0.016, curl = L.curl ?? 0.012;
    const backness = (1 - Math.cos(a)) / 2;
    const root = new V3(h.part[0] + (rnd() - 0.5) * 0.01, top + 0.002, lerp(h.part[1], h.part[2], backness));
    const amp = (L.wave ?? h.lockWave) * (0.8 + rnd() * 0.4), fr = (L.freq ?? 1.6) * (0.9 + rnd() * 0.2), ph = a * 1.4 + rnd() * 0.8;
    const out = [], n = 26;
    for (let i = 0; i <= n; i++) {
      const t = i / n, env = sstep(0.2, 0.55, t), wv = t * fr * TAU + ph;
      let y, psi;
      if (L.sweepY !== undefined) { // drop to the forehead, sweep sideways, then fall at the temple
        y = t < 0.25 ? lerp(yTop, L.sweepY, sstep(0, 0.25, t)) : t < 0.6 ? lerp(L.sweepY, L.sweepY - 0.03, (t - 0.25) / 0.35) : lerp(L.sweepY - 0.03, L.yEnd, sstep(0.6, 1, t) * 0.7 + (t - 0.6) * 0.75);
        psi = t < 0.6 ? lerp(a, b, sstep(0.1, 0.6, t)) : lerp(b, c, sstep(0.6, 1, t));
      } else {
        y = lerp(yTop, L.yEnd, t);
        psi = t < 0.45 ? lerp(a, b, sstep(0, 0.45, t)) : lerp(b, c, sstep(0.45, 1, t));
      }
      psi += env * amp * 5 * Math.cos(wv);
      smooth.point(y, Math.PI - psi, P); smooth.normal(Math.max(y, smooth.y0 + 0.002), Math.PI - psi, Nn);
      Nn.y *= 0.3; Nn.normalize();
      const tip = sstep(0.72, 1, t);
      P.addScaledVector(Nn, lift * (0.35 + 0.65 * sstep(0, 0.3, t)) + env * amp * (0.5 + 0.5 * Math.sin(wv)) + curl * tip * tip);
      if (y < smooth.y0) P.y = y;
      out.push(new V3().lerpVectors(root, P, sstep(0, 0.2, t)));
    }
    const tone = rnd();
    const cA = cLo.clone().lerp(cMid, 0.5 + tone * 0.5), cB = cMid.clone().lerp(cHi, 0.35 + tone * 0.5);
    sb.add(out, C, (L.w ?? 0.022) * (0.9 + rnd() * 0.2), (L.th ?? 0.009) * (0.9 + rnd() * 0.2), cA, cB, 0.3 + rnd() * 0.25);
  };
  const F = h.sweep;
  for (let i = 0; i < F.n; i++) {
    const u = i / (F.n - 1);
    lock({
      psi: [deg(lerp(F.a[0], F.a[1], u)), deg(lerp(F.b[0], F.b[1], u)), deg(lerp(F.c[0], F.c[1], u))], sweepY: lerp(F.y[0], F.y[1], u) + (rnd() - 0.5) * 0.005,
      yEnd: lerp(F.end[0], F.end[1], u), lift: F.lift + u * 0.012 + rnd() * 0.003, w: F.w, th: 0.009, wave: F.wave, curl: F.curl ?? 0.004,
    });
  }
  for (const L of h.locks) lock({ ...L, psi: L.psi.map(deg) });
  mesh(sb.geometry(), std({ vertexColors: true, map: streakTexture(), bumpMap: streakTexture(), bumpScale: 1, roughness: 0.48 }), hairG);
  return hairG;
}

// ---------------------------------------------------------------------
//  Character definitions.  Profile tables are in units of body height:
//  torso rows  [height, half-width, back z, front z, exponent]
//  limb rows   [height, centre x, half-width, back z, front z]
// ---------------------------------------------------------------------
export const CHARACTERS = [
  {
    id: 'ochre', name: 'Ochre', height: 1.53, seed: 11,
    blurb: 'Petite, bookish and quick on her feet. Tortoiseshell glasses, gold hoops, a wavy chin-length bob.',
    colors: {
      skin: 0xdb7e3c, skinShade: 0xa9521f, skinLight: 0xf2a468, blush: 0xd9502a,
      hair: 0x5a331c, hairHi: 0xa27654, hairLo: 0x2e170c, outfit: 0xdf8020, outfitDark: 0xb05c0c,
      brow: 0x2a140a, browHi: 0x5a3018, lash: 0x1e0d06, lidShade: 0x8a4420, iris: 0x4a2610, irisHi: 0x8a5226, irisRim: 0x1e0e06,
      lip: 0xc65a3a, lipDark: 0xa8452c, lipLine: 0x6e2a18,
    },
    torso: [
      [0.436, 0.045, -0.058, 0.058, 2.1], [0.46, 0.085, -0.062, 0.064], [0.48, 0.104, -0.062, 0.062], [0.5, 0.105, -0.06, 0.058],
      [0.52, 0.101, -0.058, 0.054], [0.55, 0.092, -0.05, 0.055], [0.58, 0.082, -0.042, 0.06], [0.61, 0.068, -0.034, 0.059],
      [0.64, 0.0605, -0.033, 0.058], [0.67, 0.067, -0.041, 0.057], [0.7, 0.074, -0.052, 0.054, 2.35], [0.73, 0.08, -0.059, 0.052, 2.45],
      [0.755, 0.086, -0.06, 0.047, 2.5], [0.775, 0.083, -0.055, 0.04, 2.4], [0.79, 0.055, -0.048, 0.031, 2.2], [0.805, 0.032, -0.04, 0.026, 2],
      [0.825, 0.027, -0.034, 0.023, 2], [0.86, 0.027, -0.03, 0.027, 2],
    ],
    torsoBumps: [
      { x: 0.034, y: 0.715, sx: 0.027, sy: 0.022, syUp: 0.036, amp: 0.024 },
      { back: true, x: 0.043, y: 0.505, sx: 0.04, sy: 0.032, syUp: 0.05, amp: 0.028 },
      { x: 0.04, y: 0.772, sx: 0.03, sy: 0.005, amp: 0.003 }, { x: 0, y: 0.785, sx: 0.008, sy: 0.008, amp: -0.004 },
      { x: 0, y: 0.605, sx: 0.0045, sy: 0.006, amp: -0.006, pw: 1 }, { x: 0, y: 0.645, sx: 0.006, sy: 0.04, amp: -0.002 },
      { back: true, x: 0, y: 0.66, sx: 0.008, sy: 0.09, amp: -0.005 }, { back: true, x: 0.04, y: 0.73, sx: 0.025, sy: 0.03, amp: 0.004 },
    ],
    navel: 0.605, bustY: 0.715,
    thigh: [
      [0.5, 0.053, 0.053, -0.058, 0.05], [0.46, 0.053, 0.0525, -0.066, 0.067], [0.43, 0.051, 0.05, -0.065, 0.065], [0.4, 0.049, 0.045, -0.065, 0.048],
      [0.37, 0.046, 0.041, -0.063, 0.037], [0.34, 0.042, 0.037, -0.057, 0.028], [0.31, 0.039, 0.034, -0.057, 0.019], [0.285, 0.04, 0.031, -0.059, 0.012],
    ],
    shin: [
      [0.285, 0.04, 0.031, -0.059, 0.012], [0.25, 0.046, 0.033, -0.071, 0], [0.22, 0.047, 0.0365, -0.076, -0.001], [0.19, 0.046, 0.034, -0.075, -0.005],
      [0.16, 0.0455, 0.027, -0.069, -0.01], [0.13, 0.043, 0.022, -0.063, -0.012], [0.1, 0.0395, 0.018, -0.058, -0.012], [0.07, 0.037, 0.0175, -0.055, -0.008],
    ],
    glute: { y: -0.012, sx: 0.06, sy: 0.04, syUp: 0.06, amp: 0.03 },
    shoe: 0.93,
    shoulder: [0.09, 0.755, -0.008], armRest: 0.148,
    upper: [
      { y: 0, rx: 0.037, rf: 0.042, rb: 0.042 }, { y: -0.06, rx: 0.034, rf: 0.037, rb: 0.038 },
      { y: -0.13, rx: 0.032, rf: 0.033, rb: 0.034 }, { y: -0.194, rx: 0.031, rf: 0.032, rb: 0.033 },
    ],
    fore: [
      { y: 0, rx: 0.031, rf: 0.032, rb: 0.033 }, { y: -0.035, rx: 0.034, rf: 0.036, rb: 0.035 },
      { y: -0.1, rx: 0.028, rf: 0.03, rb: 0.03 }, { y: -0.18, rx: 0.017, rf: 0.023, rb: 0.023 },
    ],
    hand: 1.12,
    chin: 0.8375, headZ: 0.016, neckBase: 0.805, necklaceDrop: 0.05,
    head: [
      { y: 0, rx: 0.016, rf: 0.028, rb: 0.012, z: 0.03, e: 2 },
      { y: 0.015, rx: 0.04, rf: 0.046, rb: 0.03, z: 0.022, e: 2.1 },
      { y: 0.04, rx: 0.062, rf: 0.064, rb: 0.055, z: 0.014, e: 2.2 },
      { y: 0.075, rx: 0.081, rf: 0.078, rb: 0.078, z: 0.006, e: 2.25 },
      { y: 0.11, rx: 0.087, rf: 0.084, rb: 0.09, z: 0.002, e: 2.25 },
      { y: 0.15, rx: 0.086, rf: 0.086, rb: 0.096, z: 0, e: 2.2 },
      { y: 0.19, rx: 0.077, rf: 0.08, rb: 0.092, z: 0, e: 2.1 },
      { y: 0.22, rx: 0.056, rf: 0.06, rb: 0.072, z: 0, e: 2 },
    ],
    headCap: 0.012,
    face: {
      eyeX: 0.0385, eyeY: 0.119, eyeW: 0.042, eyeH: 0.027, eyeTilt: 0.06, irisR: 0.0118, lashW: 0.0028, lashes: 4,
      browX: 0.041, browY: 0.15, browW: 0.056, browT: 0.0085, browArch: 0.006, browTilt: 0.04,
      noseY: 0.083, mouthY: 0.0475, mouthW: 0.066, lipU: 0.0042, lipL: 0.0068, smileTilt: 0.07,
      cheekX: 0.052, cheekY: 0.078, blush: 0.5, freckles: 70, frecklesLight: 0,
    },
    glasses: true, earring: 'hoop', earY: 0.1,
    hair: {
      C: [0, 0.12, -0.01], part: [-0.028, 0.05, -0.07], hairline: 0.198, faceAngle: deg(60), tuck: 1.45, cheekCover: 0.3, earY: 0.1,
      bulk: [
        { y: -0.06, rx: 0.112, rf: 0.055, rb: 0.125, z: -0.03 },
        { y: -0.03, rx: 0.122, rf: 0.062, rb: 0.136, z: -0.03 },
        { y: 0.0, rx: 0.132, rf: 0.072, rb: 0.146, z: -0.03 },
        { y: 0.035, rx: 0.142, rf: 0.083, rb: 0.153, z: -0.028 },
        { y: 0.07, rx: 0.146, rf: 0.09, rb: 0.156, z: -0.026 },
        { y: 0.11, rx: 0.142, rf: 0.094, rb: 0.154, z: -0.022 },
        { y: 0.155, rx: 0.128, rf: 0.096, rb: 0.144, z: -0.016 },
        { y: 0.195, rx: 0.105, rf: 0.092, rb: 0.124, z: -0.01 },
        { y: 0.228, rx: 0.07, rf: 0.07, rb: 0.088, z: -0.006, x: -0.008 },
        { y: 0.245, rx: 0.035, rf: 0.035, rb: 0.045, z: -0.004, x: -0.014 },
      ],
      clumps: 10, waveLen: 0.17, meander: 0.9, relief: 0.013, swell: 0.006, endFront: 0, endBack: -0.025, endJit: 0.02, tipLen: 0.028,
      shineY: 0.17, roots: 0.3, lockWave: 0.006,
      sweep: { n: 7, a: [-16, -30], b: [40, 12], c: [74, 66], y: [0.176, 0.214], end: [0.11, 0.14], lift: 0.012, w: 0.021, wave: 0.003 },
      locks: [
        { psi: [-40, -60, -68], sweepY: 0.185, yEnd: 0.01, lift: 0.014, w: 0.022, wave: 0.006 },
        { psi: [-34, -54, -63], sweepY: 0.2, yEnd: 0.03, lift: 0.022, w: 0.02, wave: 0.005 },
      ],
    },
    bra: { band: 0.672, side: 0.722, strap: 0.752, scoop: 0.738, backScoop: 0.748, sx0: 0.034, sx1: 0.056, a0: 0.5, a1: 0.85, top: 0.8 },
    shorts: { waist: 0.585, hem: 0.405 },
  },
  {
    id: 'plum', name: 'Plum', height: 1.78, seed: 29,
    blurb: 'Tall, soft and sunny. Golden shoulder-length waves, freckles and a laugh that fills the house.',
    colors: {
      skin: 0xfaa866, skinShade: 0xd97a3c, skinLight: 0xffcf9c, blush: 0xf0603c,
      hair: 0xe8a04e, hairHi: 0xfdd898, hairLo: 0xa85e1c, outfit: 0x7a3848, outfitDark: 0x582434,
      brow: 0xa8682c, browHi: 0xd8964a, lash: 0x3a1a0c, lidShade: 0xc86a3a, iris: 0x7a4a1c, irisHi: 0xc88a3a, irisRim: 0x3a200c,
      lip: 0xee7a5a, lipDark: 0xd9604a, lipLine: 0x9a3a28,
    },
    torso: [
      [0.41, 0.05, -0.084, 0.084, 2.1], [0.44, 0.1, -0.09, 0.092], [0.47, 0.14, -0.092, 0.094], [0.5, 0.146, -0.09, 0.09],
      [0.53, 0.139, -0.088, 0.085], [0.56, 0.127, -0.08, 0.088], [0.59, 0.108, -0.07, 0.092], [0.62, 0.092, -0.058, 0.09],
      [0.65, 0.08, -0.051, 0.087], [0.68, 0.084, -0.054, 0.086], [0.71, 0.092, -0.064, 0.084, 2.35], [0.74, 0.1, -0.074, 0.082, 2.45],
      [0.77, 0.104, -0.076, 0.076, 2.5], [0.795, 0.104, -0.072, 0.062, 2.5], [0.815, 0.075, -0.062, 0.045, 2.3], [0.832, 0.036, -0.048, 0.032, 2],
      [0.85, 0.03, -0.04, 0.028, 2], [0.885, 0.03, -0.036, 0.03, 2],
    ],
    torsoBumps: [
      { x: 0.05, y: 0.725, sx: 0.04, sy: 0.03, syUp: 0.048, amp: 0.04 },
      { back: true, x: 0.07, y: 0.53, sx: 0.06, sy: 0.045, syUp: 0.06, amp: 0.027 },
      { x: 0.05, y: 0.798, sx: 0.035, sy: 0.005, amp: 0.003 }, { x: 0, y: 0.812, sx: 0.008, sy: 0.008, amp: -0.004 },
      { x: 0, y: 0.615, sx: 0.005, sy: 0.006, amp: -0.008, pw: 1 }, { x: 0, y: 0.535, sx: 0.08, sy: 0.006, amp: -0.005 },
      { back: true, x: 0, y: 0.67, sx: 0.008, sy: 0.09, amp: -0.006 }, { back: true, x: 0.05, y: 0.655, sx: 0.04, sy: 0.006, amp: -0.004 },
      { back: true, x: 0.05, y: 0.75, sx: 0.03, sy: 0.03, amp: 0.004 },
    ],
    navel: 0.615, bustY: 0.725, bellyFold: 0.535,
    thigh: [
      [0.5, 0.073, 0.073, -0.088, 0.08], [0.46, 0.072, 0.072, -0.09, 0.095], [0.43, 0.069, 0.069, -0.09, 0.091], [0.4, 0.0635, 0.0625, -0.082, 0.083],
      [0.37, 0.058, 0.057, -0.073, 0.073], [0.34, 0.0555, 0.05, -0.062, 0.057], [0.31, 0.058, 0.045, -0.063, 0.042], [0.285, 0.066, 0.0425, -0.07, 0.028],
    ],
    shin: [
      [0.285, 0.066, 0.0425, -0.07, 0.028], [0.25, 0.072, 0.047, -0.084, 0.016], [0.22, 0.074, 0.05, -0.09, 0.013], [0.19, 0.076, 0.046, -0.087, 0.008],
      [0.16, 0.0785, 0.037, -0.077, 0.001], [0.13, 0.079, 0.029, -0.068, -0.004], [0.1, 0.079, 0.0225, -0.061, -0.006], [0.065, 0.079, 0.022, -0.058, -0.003],
    ],
    glute: { y: 0.03, sx: 0.1, sy: 0.07, syUp: 0.07, amp: 0.03 },
    shoe: 1.1,
    shoulder: [0.11, 0.785, -0.012], armRest: 0.217,
    upper: [
      { y: 0, rx: 0.058, rf: 0.066, rb: 0.066 }, { y: -0.08, rx: 0.06, rf: 0.066, rb: 0.068 },
      { y: -0.17, rx: 0.058, rf: 0.06, rb: 0.062 }, { y: -0.255, rx: 0.054, rf: 0.055, rb: 0.056 },
    ],
    fore: [
      { y: 0, rx: 0.054, rf: 0.055, rb: 0.056 }, { y: -0.04, rx: 0.057, rf: 0.058, rb: 0.058 },
      { y: -0.11, rx: 0.047, rf: 0.048, rb: 0.048 }, { y: -0.18, rx: 0.033, rf: 0.036, rb: 0.036 }, { y: -0.228, rx: 0.024, rf: 0.031, rb: 0.031 },
    ],
    hand: 1.22,
    chin: 0.863, headZ: 0.02, neckBase: 0.832, necklaceDrop: 0.055,
    head: [
      { y: 0, rx: 0.022, rf: 0.03, rb: 0.012, z: 0.03, e: 2 },
      { y: 0.015, rx: 0.047, rf: 0.05, rb: 0.03, z: 0.022, e: 2.1 },
      { y: 0.04, rx: 0.068, rf: 0.066, rb: 0.055, z: 0.014, e: 2.2 },
      { y: 0.075, rx: 0.083, rf: 0.079, rb: 0.078, z: 0.006, e: 2.25 },
      { y: 0.11, rx: 0.087, rf: 0.084, rb: 0.09, z: 0.002, e: 2.25 },
      { y: 0.15, rx: 0.086, rf: 0.086, rb: 0.096, z: 0, e: 2.2 },
      { y: 0.19, rx: 0.076, rf: 0.08, rb: 0.092, z: 0, e: 2.1 },
      { y: 0.217, rx: 0.054, rf: 0.058, rb: 0.07, z: 0, e: 2 },
    ],
    headCap: 0.011,
    face: {
      eyeX: 0.039, eyeY: 0.127, eyeW: 0.041, eyeH: 0.022, eyeTilt: 0.1, irisR: 0.0105, lashW: 0.0034, lashes: 5,
      browX: 0.041, browY: 0.163, browW: 0.054, browT: 0.0078, browArch: 0.007, browTilt: 0.05,
      noseY: 0.086, mouthY: 0.055, mouthW: 0.068, lipU: 0.0052, lipL: 0.0085, smileTilt: 0.08,
      cheekX: 0.053, cheekY: 0.088, blush: 0.6, freckles: 60, frecklesLight: 0.35,
    },
    glasses: false, earring: 'stud', earY: 0.105,
    hair: {
      C: [0, 0.12, -0.01], part: [-0.028, 0.05, -0.07], hairline: 0.2, faceAngle: deg(58), tuck: 1, cheekCover: 0.5, earY: 0.1,
      bulk: [
        { y: -0.2, rx: 0.12, rf: 0.02, rb: 0.14, z: -0.05 },
        { y: -0.16, rx: 0.136, rf: 0.022, rb: 0.156, z: -0.05 },
        { y: -0.11, rx: 0.156, rf: 0.03, rb: 0.174, z: -0.05 },
        { y: -0.05, rx: 0.17, rf: 0.052, rb: 0.186, z: -0.045 },
        { y: 0.0, rx: 0.17, rf: 0.075, rb: 0.186, z: -0.04 },
        { y: 0.04, rx: 0.161, rf: 0.088, rb: 0.18, z: -0.034 },
        { y: 0.08, rx: 0.15, rf: 0.094, rb: 0.17, z: -0.028 },
        { y: 0.12, rx: 0.144, rf: 0.096, rb: 0.16, z: -0.022 },
        { y: 0.16, rx: 0.128, rf: 0.096, rb: 0.144, z: -0.016 },
        { y: 0.195, rx: 0.1, rf: 0.09, rb: 0.12, z: -0.01 },
        { y: 0.225, rx: 0.066, rf: 0.066, rb: 0.084, z: -0.006, x: -0.008 },
        { y: 0.24, rx: 0.033, rf: 0.033, rb: 0.042, z: -0.004, x: -0.014 },
      ],
      clumps: 11, waveLen: 0.14, meander: 1.25, relief: 0.017, swell: 0.012, endFront: -0.075, endBack: -0.15, endJit: 0.03, tipLen: 0.04,
      shineY: 0.16, roots: 0.7, lockWave: 0.012,
      sweep: { n: 7, a: [-14, -28], b: [38, 10], c: [68, 60], y: [0.178, 0.214], end: [0.03, 0.08], lift: 0.012, w: 0.023, wave: 0.006 },
      locks: [
        { psi: [-42, -60, -68], sweepY: 0.19, yEnd: -0.06, lift: 0.016, w: 0.024, wave: 0.014, freq: 2 },
        { psi: [-36, -56, -64], sweepY: 0.203, yEnd: -0.03, lift: 0.024, w: 0.022, wave: 0.012 },
        { psi: [60, 66, 70], yEnd: -0.07, lift: 0.018, w: 0.022, wave: 0.014, freq: 2 },
      ],
    },
    bra: { band: 0.682, side: 0.735, strap: 0.77, scoop: 0.752, backScoop: 0.765, sx0: 0.045, sx1: 0.075, a0: 0.5, a1: 0.85, top: 0.826 },
    shorts: { waist: 0.595, hem: 0.39 },
  },
];

const torsoKeys = (H, t) => t.map(([f, hw, zb, zf, e]) => ({ y: f * H, rx: hw * H, rf: (zf - zb) / 2 * H, rb: (zf - zb) / 2 * H, z: (zf + zb) / 2 * H, e: e ?? 2.25 }));
const scaleBump = (H, b) => ({ ...b, x: b.x * H, y: b.y * H, sx: b.sx * H, sy: b.sy * H, syUp: b.syUp === undefined ? undefined : b.syUp * H, amp: b.amp * H });
// limb table -> pivot (at the first row's centre) and keys local to it, mirrored for side s
function limbKeys(H, t, s) {
  const [f0, cx0, , zb0, zf0] = t[0], pivot = new V3(cx0 * H * s, f0 * H, (zb0 + zf0) / 2 * H);
  const keys = t.map(([f, cx, hw, zb, zf]) => ({ y: f * H - pivot.y, x: cx * H * s - pivot.x, rx: hw * H, rf: (zf - zb) / 2 * H, rb: (zf - zb) / 2 * H, z: (zf + zb) / 2 * H - pivot.z, e: 2.15 }));
  return { pivot, keys };
}
const srgb = (c) => [(c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255];

// ---------------------------------------------------------------------
//  Hands and shoes
// ---------------------------------------------------------------------
function buildHand(parent, skin, nail, s) {
  const hand = group(parent);
  const palm = makeSurface([
    { y: -0.088, rx: 0.0105, rf: 0.035, rb: 0.031, e: 2.8 },
    { y: -0.06, rx: 0.013, rf: 0.037, rb: 0.032, e: 2.6 },
    { y: -0.025, rx: 0.0145, rf: 0.03, rb: 0.027, e: 2.4 },
    { y: 0.012, rx: 0.015, rf: 0.021, rb: 0.021, e: 2 },
  ]);
  mesh(buildLoft(palm, { ny: 12, na: 20, capLo: 0.006 }), skin, hand);
  const zs = [0.027, 0.0095, -0.008, -0.0245], lens = [0.064, 0.072, 0.067, 0.052];
  for (let i = 0; i < 4; i++) {
    let g = group(hand, 0, -0.088, zs[i]);
    g.rotation.z = -s * (0.1 + i * 0.05); g.rotation.x = (1.5 - i) * -0.06;
    const r0 = 0.0074 - i * 0.0004;
    [0.44, 0.31, 0.25].forEach((fr, k) => {
      const len = lens[i] * fr, r = r0 * (1 - k * 0.1);
      mesh(new THREE.CapsuleGeometry(r, len, 4, 10), skin, g, 0, -len / 2, 0);
      if (k === 2) { const n = ball(r * 0.82, nail, g, s * r * 0.55, -len * 0.72, 0, 0.5, 1.3, 1); n.rotation.z = 0; }
      g = group(g, 0, -len, 0); g.rotation.z = -s * (k === 0 ? 0.3 + i * 0.05 : 0.24);
    });
  }
  ball(0.016, skin, hand, -s * 0.006, -0.034, 0.022, 0.75, 1.35, 1);
  let th = group(hand, -s * 0.005, -0.03, 0.03);
  th.rotation.x = -0.6; th.rotation.z = -s * 0.3;
  [[0.034, 0.0086], [0.027, 0.0076]].forEach(([len, r], k) => {
    mesh(new THREE.CapsuleGeometry(r, len, 4, 10), skin, th, 0, -len / 2, 0);
    if (k === 1) ball(r * 0.85, nail, th, s * r * 0.3, -len * 0.7, r * 0.5, 1, 1.3, 0.5);
    th = group(th, 0, -len, 0); th.rotation.x = 0.3;
  });
  return hand;
}

let SHOE = null;
function shoeGeo() {
  if (SHOE) return SHOE;
  // lofted along the foot's length, then laid down so the loft axis points forward
  const upperKeys = [
    { y: -0.082, rx: 0.02, rb: 0.03, rf: 0.008, e: 2.4 },
    { y: -0.06, rx: 0.034, rb: 0.072, rf: 0.008, e: 2.6 },
    { y: -0.02, rx: 0.04, rb: 0.08, rf: 0.008, e: 2.6 },
    { y: 0.03, rx: 0.044, rb: 0.064, rf: 0.008, e: 2.6 },
    { y: 0.085, rx: 0.048, rb: 0.044, rf: 0.008, e: 2.6 },
    { y: 0.13, rx: 0.044, rb: 0.035, rf: 0.008, e: 2.5 },
    { y: 0.16, rx: 0.026, rb: 0.024, rf: 0.008, e: 2.3 },
  ];
  const upper = makeSurface(upperKeys);
  const sole = makeSurface(upperKeys.map((k) => ({ ...k, rx: k.rx + 0.004, rb: 0.004, rf: 0.016, e: 3 })));
  const lay = (g) => g.rotateX(Math.PI / 2);
  SHOE = {
    upper: lay(buildLoft(upper, { ny: 28, na: 28, capLo: 0.006, capHi: 0.01 })),
    toe: lay(buildLoft(upper, { y0: 0.105, y1: 0.16, ny: 8, na: 28, offset: 0.0018, capHi: 0.011 })),
    heel: lay(buildLoft(upper, { y0: -0.082, y1: -0.045, ny: 6, na: 28, offset: 0.0018, capLo: 0.007 })),
    sole: lay(buildLoft(sole, { ny: 16, na: 28, capLo: 0.008, capHi: 0.01 })),
  };
  return SHOE;
}
function buildShoe(parent, M, s) {
  const G = shoeGeo(), shoe = group(parent);
  shoe.rotation.y = s * 0.07;
  mesh(G.upper, M.white, shoe);
  mesh(G.toe, M.rubber, shoe);
  mesh(G.heel, M.cloth, shoe);
  mesh(G.sole, M.rubber, shoe, 0, -0.006, 0);
  const tread = mesh(G.sole, M.tread, shoe, 0, -0.017, 0); tread.scale.set(0.97, 0.5, 0.985);
  const tongue = mesh(new THREE.BoxGeometry(0.03, 0.006, 0.07), M.white, shoe, 0, 0.066, 0.03); tongue.rotation.x = 0.5;
  for (let i = 0; i < 5; i++) {
    for (const d of [-1, 1]) { const l = mesh(new THREE.BoxGeometry(0.034, 0.0035, 0.0045), M.lace, shoe, 0, 0.066 - i * 0.0075, 0.04 + i * 0.016); l.rotation.x = 0.5; l.rotation.y = d * 0.35; }
  }
  for (const d of [-1, 1]) { const st = mesh(new THREE.BoxGeometry(0.002, 0.012, 0.075), M.cloth, shoe, d * 0.0415, 0.03, 0.02); st.rotation.x = 0.35; st.rotation.y = d * 0.06; }
  return shoe;
}

// ---------------------------------------------------------------------
//  Build one character -> rig
// ---------------------------------------------------------------------
export function buildCharacter(def) {
  const rnd = mulberry(def.seed);
  const col = def.colors, H = def.height;
  const skinMat = (map) => new THREE.MeshPhysicalMaterial({ map, color: map ? 0xffffff : col.skin, roughness: 0.58, sheen: 0.55, sheenRoughness: 0.45, sheenColor: new THREE.Color(col.skinLight), emissive: col.skin, emissiveIntensity: 0.05 });
  const skin = skinMat(null);
  const clothDark = std({ color: col.outfitDark, roughness: 0.7 });
  const nail = std({ color: new THREE.Color(col.skinLight).lerp(new THREE.Color(0xff9a9a), 0.35), roughness: 0.3 });
  const gold = std({ color: 0xe6b040, roughness: 0.28, metalness: 0.9, emissive: 0x6a4a10, emissiveIntensity: 0.4 });
  const SM = {
    white: std({ color: 0xf6f1e8, roughness: 0.75 }), rubber: std({ color: 0xe8dfd0, roughness: 0.6 }), tread: std({ color: 0x8a7a6a, roughness: 0.9 }),
    lace: std({ color: 0xfffaf2, roughness: 0.8 }), cloth: std({ color: col.outfit, roughness: 0.8 }),
  };
  const fabric = (g, w, h, base) => {
    g.fillStyle = hex(base); g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.04)'; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1); }
  };
  const stitch = (g, x0, x1, y, color) => { g.strokeStyle = color; g.lineWidth = 1.4; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); g.setLineDash([]); };

  const root = new THREE.Group();
  root.userData.dynamic = true;
  const hips = group(root);
  const torsoG = group(hips);
  const J = { hips, torso: torsoG };

  // ---- torso
  const torso = makeSurface(torsoKeys(H, def.torso), def.torsoBumps.map((b) => scaleBump(H, b)));
  const navelY = def.navel * H, shY = def.shoulder[1] * H, bustY = def.bustY * H, waistY = 0.64 * H, hipY = 0.5 * H;
  const torsoTex = skinTex(torso, col.skin, 1024, 1024, (blob) => {
    blob(Math.PI, navelY, 0.012, 0.017, col.skinShade, 0.6); blob(Math.PI, navelY + 0.003, 0.0035, 0.006, col.lipLine, 0.75);
    blob(Math.PI, navelY + 0.06, 0.008, 0.05, col.skinShade, 0.22); blob(Math.PI, navelY - 0.04, 0.05, 0.035, col.skinLight, 0.2);
    for (const s of [-1, 1]) {
      blob(Math.PI + s * 0.5, shY + 0.012, 0.05, 0.007, col.skinShade, 0.4); blob(Math.PI + s * 0.5, shY + 0.024, 0.05, 0.007, col.skinLight, 0.3);
      blob(Math.PI + s * 1.45, shY - 0.01, 0.05, 0.04, col.blush, 0.2);
      blob(Math.PI + s * 1.35, waistY, 0.03, 0.07, col.skinShade, 0.2);
      blob(s * 0.3, hipY + 0.085 * H, 0.012, 0.012, col.skinShade, 0.3); blob(s * 0.75, shY - 0.03, 0.045, 0.05, col.skinShade, 0.14);
      blob(Math.PI + s * 0.55, navelY + 0.02, 0.025, 0.08, col.skinLight, 0.1);
    }
    blob(Math.PI, bustY + 0.045, 0.014, 0.06, col.skinShade, 0.3); blob(Math.PI, shY + 0.03, 0.02, 0.012, col.skinShade, 0.3);
    blob(0, waistY + 0.03, 0.009, 0.16, col.skinShade, 0.4); blob(0, shY - 0.02, 0.04, 0.05, col.skinLight, 0.12);
    if (def.bellyFold) { blob(Math.PI, def.bellyFold * H, 0.13, 0.007, col.skinShade, 0.55); blob(Math.PI, def.bellyFold * H + 0.03, 0.1, 0.03, col.skinLight, 0.18); for (const s of [-1, 1]) blob(s * 0.5, 0.655 * H, 0.07, 0.006, col.skinShade, 0.4); }
    for (let i = 0; i < 70; i++) blob(Math.PI + (rnd() - 0.5) * 3.4, shY + 0.02 - rnd() * 0.09, 0.0016, 0.0016, col.skinShade, 0.5);
  });
  const TY = gridYs(torso, 150), TA = 96;
  mesh(buildLoft(torso, { ys: TY, na: TA, capLo: 0.03 }), skinMat(torsoTex), torsoG);

  // ---- sports bra: a shell over the chest; one procedural texture gives its cut, piping and seams
  const b = Object.fromEntries(Object.entries(def.bra).map(([k, v]) => [k, k === 'a0' || k === 'a1' ? v : v * H]));
  const oc = srgb(col.outfit), od = srgb(col.outfitDark);
  const braTex = procTexture(torso, (x, y, z, a, out) => {
    const front = Math.cos(a) < 0;
    const ang = front ? Math.abs(a - Math.PI) : Math.min(a, TAU - a);
    const lowC = front ? b.scoop : b.backScoop;
    const low = ang < b.a0 ? lowC + (b.strap - lowC) * Math.pow(ang / b.a0, 2.4) : lerp(b.strap, b.side, sstep(b.a1 - 0.12, Math.PI / 2 - 0.1, ang));
    const ax = Math.abs(x), edge = Math.max(low - y, Math.min(ax - b.sx0, b.sx1 - ax));
    const fld = Math.min(y - b.band, edge);
    let k = 0; // 0 = fabric, 1 = dark trim
    if (edge < 0.006) k = 1;
    if (y < b.band + 0.03) k = 0.75 + 0.25 * Math.sin(a * 260);
    if (Math.abs(y - b.band - 0.034) < 0.0009 && Math.sin(a * 400) > -0.2) k = 0.8;
    if (Math.abs(Math.abs(a - Math.PI) - Math.PI / 2) < 0.012) k = Math.max(k, 0.5);
    const n = 0.97 + 0.06 * hash(Math.floor(a * 700) + Math.floor(y * 1900) * 7.13);
    out[0] = lerp(oc[0], od[0], k) * n; out[1] = lerp(oc[1], od[1], k) * n; out[2] = lerp(oc[2], od[2], k) * n; out[3] = 0.5 + fld * 70;
  }, 1024, 1024, b.band - 0.01, b.top + 0.005);
  mesh(buildLoft(torso, { ys: rowsBetween(TY, b.band - 0.004, b.top), na: TA, offset: 0.0045 }), std({ map: braTex, roughness: 0.8, alphaTest: 0.5 }), torsoG);
  mesh(buildLoft(torso, { ys: rowsBetween(TY, b.band - 0.004, b.band + 0.028), na: TA, offset: 0.0062 }), std({ map: braTex, roughness: 0.75 }), torsoG);

  // ---- bike shorts: pelvis shell + thigh shells, with side panels, seams and stitched hems
  const sh = { waist: def.shorts.waist * H, hem: def.shorts.hem * H };
  const tvPx = (y, h) => (1 - (y - torso.y0) / (torso.y1 - torso.y0)) * h;
  const pelvisTex = canvasTex(1024, 1024, (g, w, h) => {
    fabric(g, w, h, col.outfit);
    g.fillStyle = rgba(col.outfitDark, 0.6); for (const u of [0.25, 0.75]) g.fillRect((u - 0.045) * w, 0, 0.09 * w, h);
    g.fillStyle = rgba(col.outfitDark, 0.55); for (const u of [0, 0.5, 1]) g.fillRect(u * w - 1.5, 0, 3, h);
    const yw = tvPx(sh.waist, h), bw = 0.034 / (torso.y1 - torso.y0) * h;
    g.fillStyle = hex(col.outfitDark); g.fillRect(0, yw - 2, w, bw + 2);
    g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 1; for (let x = 0; x < w; x += 5) { g.beginPath(); g.moveTo(x, yw); g.lineTo(x, yw + bw); g.stroke(); }
    stitch(g, 0, w, yw + bw + 5, rgba(col.outfitDark, 0.9));
  });
  pelvisTex.wrapS = THREE.RepeatWrapping;
  const cloth = std({ map: pelvisTex, roughness: 0.8 });
  mesh(buildLoft(torso, { ys: rowsBetween(TY, torso.y0, sh.waist), na: TA, offset: 0.0045, capLo: 0.032 }), cloth, torsoG);
  mesh(buildLoft(torso, { ys: rowsBetween(TY, sh.waist - 0.034, sh.waist), na: TA, offset: 0.0062 }), clothDark, torsoG);

  // ---- necklace: a fine chain draped over the collarbones with a small pendant
  {
    const pts = [], P = new V3(), N = new V3(), yb = def.neckBase * H;
    for (let i = 0; i <= 40; i++) {
      const a = i / 40 * TAU, fr = (1 - Math.cos(a)) / 2;
      const y = yb + 0.006 - def.necklaceDrop * Math.pow(fr, 1.8);
      torso.point(y, a, P); torso.normal(y, a, N);
      pts.push(P.clone().addScaledVector(N, 0.0022));
    }
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 96, 0.0011, 5, true), gold, torsoG);
    const p = pts[20];
    ball(0.0062, gold, torsoG, p.x, p.y - 0.007, p.z + 0.003, 1, 1, 0.45);
    ball(0.0022, gold, torsoG, p.x, p.y - 0.001, p.z + 0.002);
  }

  // ---- legs
  for (const s of [-1, 1]) {
    const inner = s > 0 ? Math.PI * 1.5 : Math.PI * 0.5, outerU = s > 0 ? 0.25 : 0.75;
    const T = limbKeys(H, def.thigh, s), S = limbKeys(H, def.shin, s);
    const leg = group(hips, T.pivot.x, T.pivot.y, T.pivot.z);
    const kneeY = T.keys.at(-1).y;
    const thigh = makeSurface(T.keys, [{ back: true, x: 0, ...def.glute }, { x: 0, y: kneeY + 0.012, sx: 0.022, sy: 0.024, amp: 0.005 }]);
    const thighTex = skinTex(thigh, col.skin, 256, 512, (blob) => {
      blob(inner, kneeY * 0.45, 0.04, 0.2, col.skinShade, 0.16); blob(Math.PI, kneeY * 0.55, 0.03, 0.15, col.skinLight, 0.16);
      blob(Math.PI, kneeY + 0.02, 0.04, 0.04, col.blush, 0.3); blob(Math.PI, kneeY + 0.055, 0.035, 0.008, col.skinShade, 0.22);
      blob(0, kneeY + 0.015, 0.035, 0.006, col.skinShade, 0.4);
    });
    const LY = gridYs(thigh, 40), hemL = sh.hem - T.pivot.y;
    mesh(buildLoft(thigh, { ys: LY, na: 40, capLo: T.keys.at(-1).rf * 0.8, capHi: 0.05 }), skinMat(thighTex), leg);
    const thighCloth = canvasTex(256, 512, (g, w, h) => {
      fabric(g, w, h, col.outfit);
      g.fillStyle = rgba(col.outfitDark, 0.6); g.fillRect((outerU - 0.09) * w, 0, 0.18 * w, h);
      g.fillStyle = rgba(col.outfitDark, 0.55); g.fillRect((1 - outerU) * w - 1, 0, 2, h);
      const yh = (1 - (hemL - thigh.y0) / (thigh.y1 - thigh.y0)) * h, bh = 0.02 / (thigh.y1 - thigh.y0) * h;
      g.fillStyle = hex(col.outfitDark); g.fillRect(0, yh - bh, w, bh + 2);
      stitch(g, 0, w, yh - bh - 4, rgba(col.outfitDark, 0.9));
    });
    mesh(buildLoft(thigh, { ys: rowsBetween(LY, hemL, 0), na: 40, offset: 0.0045, capHi: 0.052 }), std({ map: thighCloth, roughness: 0.8 }), leg);
    mesh(buildLoft(thigh, { ys: rowsBetween(LY, hemL, hemL + 0.02), na: 40, offset: 0.0062 }), clothDark, leg);
    const kneeK = T.keys.at(-1);
    const shinG = group(leg, kneeK.x, kneeK.y, kneeK.z);
    const shin = makeSurface(S.keys, [{ x: 0, y: -0.008, sx: 0.022, sy: 0.024, amp: 0.005 }]);
    const ankY = S.keys.at(-1).y;
    const shinTex = skinTex(shin, col.skin, 256, 512, (blob) => {
      blob(Math.PI, -0.005, 0.04, 0.04, col.blush, 0.3); blob(Math.PI, ankY * 0.5, 0.012, 0.14, col.skinLight, 0.3);
      blob(0, -0.012, 0.035, 0.006, col.skinShade, 0.4); blob(0, ankY * 0.35, 0.03, 0.07, col.skinLight, 0.12); blob(inner, ankY * 0.5, 0.03, 0.15, col.skinShade, 0.14);
      blob(0, ankY * 0.85, 0.008, 0.05, col.skinShade, 0.2);
    });
    mesh(buildLoft(shin, { ny: 30, na: 36, capHi: S.keys[0].rf * 0.8, capLo: 0.02 }), skinMat(shinTex), shinG);
    const ank = S.keys.at(-1);
    const foot = group(shinG, ank.x, ank.y, ank.z + 0.012);
    foot.scale.setScalar(def.shoe);
    const fy = -(S.pivot.y + ank.y) / def.shoe; // the floor, in shoe units
    const shoe = buildShoe(foot, SM, s); shoe.position.set(0, fy + 0.026, 0.004);
    const cr = ank.rx * 1.12 / def.shoe;
    const cuff = mesh(new THREE.CylinderGeometry(cr * 1.08, cr, 0.04, 24), SM.white, foot, 0, fy + 0.104, -0.012); cuff.scale.z = 1.15;
    const cuffTop = mesh(new THREE.TorusGeometry(cr * 1.08, 0.004, 8, 24), SM.white, foot, 0, fy + 0.124, -0.012); cuffTop.rotation.x = Math.PI / 2; cuffTop.scale.y = 1.15;
    J[s < 0 ? 'legR' : 'legL'] = leg; J[s < 0 ? 'shinR' : 'shinL'] = shinG;
  }

  // ---- arms
  for (const s of [-1, 1]) {
    const arm = group(torsoG, s * def.shoulder[0] * H, shY, def.shoulder[2] * H);
    const upper = makeSurface(def.upper), fore = makeSurface(def.fore, [{ back: true, x: 0, y: -0.004, sx: 0.016, sy: 0.016, amp: 0.004 }]);
    const elbowY = def.upper.at(-1).y;
    const upperTex = skinTex(upper, col.skin, 256, 256, (blob) => {
      blob(Math.PI / 2, -0.01, 0.05, 0.05, col.blush, 0.2); blob(Math.PI * 1.5, -0.01, 0.05, 0.05, col.blush, 0.2);
      blob(Math.PI, elbowY * 0.5, 0.012, 0.08, col.skinLight, 0.22); blob(0, elbowY + 0.01, 0.03, 0.03, col.blush, 0.28);
    });
    mesh(buildLoft(upper, { ny: 22, na: 28, capHi: def.upper[0].rx * 0.95, capLo: def.upper.at(-1).rx * 0.8 }), skinMat(upperTex), arm);
    const foreG = group(arm, 0, elbowY, 0);
    const foreTex = skinTex(fore, col.skin, 256, 256, (blob) => { blob(0, -0.006, 0.03, 0.03, col.blush, 0.3); blob(Math.PI, def.fore.at(-1).y * 0.45, 0.012, 0.07, col.skinLight, 0.22); blob(Math.PI, -0.004, 0.03, 0.005, col.skinShade, 0.3); });
    mesh(buildLoft(fore, { ny: 22, na: 28, capHi: def.fore[0].rx * 0.8, capLo: 0.01 }), skinMat(foreTex), foreG);
    const hand = buildHand(foreG, skin, nail, s);
    hand.position.y = def.fore.at(-1).y; hand.scale.setScalar(def.hand);
    J[s < 0 ? 'armR' : 'armL'] = arm; J[s < 0 ? 'foreR' : 'foreL'] = foreG;
  }

  // ---- head
  const f = def.face, chinY = def.chin * H;
  const headG = group(torsoG, 0, chinY + 0.012, def.headZ - 0.01);
  const headIn = group(headG, 0, -0.012, 0.01); // origin at the chin
  J.head = headG;
  const headSurf = makeSurface(def.head, [
    { x: 0, y: f.noseY - 0.002, sx: 0.0115, sy: 0.011, syUp: 0.034, amp: 0.021, pw: 1 },
    { x: 0.0105, y: f.noseY - 0.004, sx: 0.006, sy: 0.006, amp: 0.004, pw: 1 },
    { x: f.cheekX - 0.006, y: f.cheekY, sx: 0.03, sy: 0.028, amp: 0.007 },
    { x: 0, y: f.mouthY + 0.004, sx: 0.022, sy: 0.006, amp: 0.004 }, { x: 0, y: f.mouthY - 0.006, sx: 0.018, sy: 0.006, amp: 0.005 },
    { x: 0.034, y: f.mouthY + 0.001, sx: 0.006, sy: 0.006, amp: -0.003 },
    { x: f.eyeX, y: f.eyeY, sx: 0.02, sy: 0.013, amp: -0.004 }, { x: f.browX, y: f.browY, sx: 0.028, sy: 0.007, amp: 0.003 },
    { x: 0, y: 0.014, sx: 0.02, sy: 0.013, amp: 0.005 }, { x: 0, y: f.mouthY - 0.02, sx: 0.02, sy: 0.006, amp: -0.003 },
  ]);
  const headGeo = buildLoft(headSurf, { ny: 90, na: 96, capLo: 0.006, capHi: def.headCap });
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
  faceTex.colorSpace = THREE.SRGBColorSpace; faceTex.anisotropy = 8;
  mesh(headGeo, skinMat(faceTex), headIn);
  let exprName = null;
  const paint = (name) => { if (name === exprName) return; exprName = name; paintFace(faceCtx, f, col, EXPRESSIONS[name], mulberry(def.seed + 5)); faceTex.needsUpdate = true; };

  // ears + earrings
  const earX = headSurf.ring(def.earY).rx;
  const earIn = std({ color: col.skinShade, roughness: 0.7 });
  for (const s of [-1, 1]) {
    const e = group(headIn, s * (earX - 0.001), def.earY + 0.012, -0.012); e.rotation.y = s * 0.45; e.rotation.z = -s * 0.08;
    ball(0.017, skin, e, 0, 0, 0, 0.42, 1.25, 0.82);
    ball(0.011, earIn, e, s * 0.0035, 0.002, 0.003, 0.3, 1.15, 0.7);
    ball(0.007, skin, e, s * 0.001, -0.018, 0.002, 0.5, 0.9, 0.8);
    if (def.earring === 'hoop') {
      const hoop = mesh(new THREE.TorusGeometry(0.0125, 0.0026, 10, 28), gold, headIn, s * (earX + 0.005), def.earY - 0.021, -0.006);
      hoop.rotation.y = Math.PI / 2 - s * 0.5;
    } else ball(0.0052, std({ color: 0xfff1dc, roughness: 0.25, metalness: 0.3 }), headIn, s * (earX + 0.004), def.earY - 0.006, -0.004);
  }

  // glasses
  if (def.glasses) {
    const tort = canvasTex(128, 64, (g) => {
      g.fillStyle = '#4a2008'; g.fillRect(0, 0, 128, 64);
      for (let i = 0; i < 90; i++) { g.fillStyle = ['#8a4614', '#241006', '#b86a20', '#6a300e', '#d08a34'][i % 5]; g.beginPath(); g.ellipse(rnd() * 128, rnd() * 64, 2 + rnd() * 7, 1.5 + rnd() * 4, rnd() * 3, 0, TAU); g.fill(); }
    });
    tort.wrapS = tort.wrapT = THREE.RepeatWrapping; tort.repeat.set(5, 1);
    const frame = new THREE.MeshPhysicalMaterial({ map: tort, roughness: 0.22, clearcoat: 0.8, clearcoatRoughness: 0.2 });
    const lens = new THREE.MeshStandardMaterial({ color: 0xfff4e0, transparent: true, opacity: 0.1, roughness: 0.05, metalness: 0.2, depthWrite: false });
    const P = new V3();
    headSurf.point(f.eyeY, Math.PI, P);
    const gz = P.z + 0.006, gx = f.eyeX + 0.002, R = 0.0335;
    const gl = group(headIn, 0, f.eyeY - 0.004, gz);
    for (const s of [-1, 1]) {
      const rim = mesh(new THREE.TorusGeometry(R, 0.0042, 12, 48), frame, gl, s * gx, 0, -0.005);
      rim.rotation.y = s * 0.17; rim.scale.set(1.04, 1, 1.3);
      const l = mesh(new THREE.CircleGeometry(R, 32), lens, gl, s * gx, 0, -0.005); l.rotation.y = s * 0.17; l.scale.set(1.04, 1, 1); l.userData.noShadow = true;
      const x0 = s * (gx + R * 1.04 + 0.002), z0 = -0.011, x1 = s * (earX + 0.004), z1 = -gz - 0.012;
      const len = Math.hypot(x1 - x0, z1 - z0);
      const t = mesh(new THREE.BoxGeometry(0.004, 0.0065, len), frame, gl, (x0 + x1) / 2, 0.008, (z0 + z1) / 2);
      t.rotation.y = Math.atan2(x1 - x0, z1 - z0);
      ball(0.0062, frame, gl, x0, 0.008, z0, 0.9, 0.95, 0.8);
      ball(0.0016, gold, gl, x0 - s * 0.001, 0.0095, z0 + 0.005);
    }
    const br = mesh(new THREE.TorusGeometry(0.0078, 0.0034, 8, 16, Math.PI), frame, gl, 0, 0.006, 0.0005);
    br.scale.z = 1.2;
  }

  buildHair(def.hair, col, headIn, rnd);
  paint('smile');
  root.traverse((o) => { if (o.isMesh) { o.castShadow = !o.userData.noShadow; o.receiveShadow = !o.userData.noShadow; } });

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
