import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { CHARACTERS, EXPRESSIONS, buildCharacter, animateRig } from './characters.js';

// =====================================================================
//  Renderer / scene
// =====================================================================
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, "ontouchstart" in window ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const SKY = 0x161c27;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 22, 55);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.05, 140);

// Upper floor lives in its own group so it can be hidden while you're downstairs (dollhouse view).
const upper = new THREE.Group();
scene.add(upper);

// =====================================================================
//  Small utilities
// =====================================================================
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = mulberry32(20261116);
const rr = (a, b) => a + R() * (b - a);
const pick = (arr) => arr[Math.floor(R() * arr.length)];

function canvasTex(w, h, draw, { repeat = null, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  return t;
}

function noise(g, w, h, n, alpha, light = false) {
  for (let i = 0; i < n; i++) {
    const v = light ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${rr(0, alpha)})`;
    g.fillRect(rr(0, w), rr(0, h), rr(1, 3), rr(1, 3));
  }
}

// =====================================================================
//  Procedural textures
// =====================================================================
const TEX = {};

// wide plank floor: 512px = 2m
TEX.floor = canvasTex(512, 512, (g, w, h) => {
  const rows = 12, ph = h / rows;
  for (let r = 0; r < rows; r++) {
    let x = -rr(0, 300);
    const y = r * ph;
    while (x < w) {
      const len = rr(170, 380);
      const c = [rr(120, 150), rr(70, 88), rr(36, 48)].map(Math.round);
      g.fillStyle = `rgb(${c})`;
      g.fillRect(x, y, len, ph);
      for (let k = 0; k < 9; k++) {
        g.strokeStyle = `rgba(50,25,10,${rr(0.05, 0.2)})`;
        g.lineWidth = rr(0.5, 1.6);
        g.beginPath();
        const yy = y + rr(2, ph - 2);
        g.moveTo(x, yy);
        g.bezierCurveTo(x + len * 0.3, yy + rr(-3, 3), x + len * 0.6, yy + rr(-3, 3), x + len, yy + rr(-2, 2));
        g.stroke();
      }
      g.fillStyle = 'rgba(30,14,6,0.85)';
      g.fillRect(x, y, 2, ph);
      x += len;
    }
    g.fillStyle = 'rgba(25,12,5,0.9)';
    g.fillRect(0, y, w, 1.5);
  }
}, { repeat: [0.5, 0.5] });

// generic grain (tinted by material colour): 256px = 0.8m
TEX.grain = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#d8d0c8'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 70; i++) {
    g.strokeStyle = `rgba(60,40,30,${rr(0.05, 0.22)})`;
    g.lineWidth = rr(0.5, 2.5);
    g.beginPath();
    const x = rr(0, w);
    g.moveTo(x, 0);
    g.bezierCurveTo(x + rr(-8, 8), h * 0.3, x + rr(-8, 8), h * 0.7, x + rr(-4, 4), h);
    g.stroke();
  }
}, { repeat: [1.25, 1.25] });

// warm plaster: 256px = 2m
TEX.plaster = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#ece4d8'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 60; i++) {
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    const x = rr(0, w), y = rr(0, h), r = rr(10, 50);
    g.fillStyle = `rgba(${R() < 0.5 ? '255,250,240' : '200,180,160'},${rr(0.04, 0.12)})`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  noise(g, w, h, 1500, 0.06);
}, { repeat: [0.5, 0.5] });

// brick: 512px = 1.6m
TEX.brick = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#6d5f56'; g.fillRect(0, 0, w, h);
  const rows = 24, bh = h / rows, bw = 70;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * bw / 2;
    for (let x = -bw; x < w + bw; x += bw) {
      const c = [rr(120, 160), rr(52, 70), rr(38, 52)].map(Math.round);
      if (R() < 0.15) { c[0] -= 30; c[1] -= 12; }
      g.fillStyle = `rgb(${c})`;
      g.fillRect(x + off + 2, r * bh + 2, bw - 4, bh - 4);
    }
  }
  noise(g, w, h, 3000, 0.15);
}, { repeat: [1 / 1.6, 1 / 1.6] });

// subway tiles: 256px = 0.6m
TEX.tile = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#b9ada0'; g.fillRect(0, 0, w, h);
  const th = 32, tw = 64;
  for (let r = 0; r < h / th; r++) for (let x = -tw; x < w + tw; x += tw) {
    const l = Math.round(rr(236, 248));
    g.fillStyle = `rgb(${l},${l - 4},${l - 12})`;
    g.fillRect(x + (r % 2) * tw / 2 + 2, r * th + 2, tw - 4, th - 4);
  }
}, { repeat: [1 / 0.6, 1 / 0.6] });

// bathroom checker floor: 256 = 1.2m
TEX.checker = canvasTex(256, 256, (g, w, h) => {
  const n = 8, s = w / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    g.fillStyle = (i + j) % 2 ? '#e9e1d2' : '#8a9a80';
    g.fillRect(i * s, j * s, s, s);
  }
  noise(g, w, h, 800, 0.08);
}, { repeat: [1 / 1.2, 1 / 1.2] });

// wet street stones
TEX.paving = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#2b2a2c'; g.fillRect(0, 0, w, h);
  const s = 64;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const l = Math.round(rr(60, 85));
    g.fillStyle = `rgb(${l},${l - 4},${l - 6})`;
    g.fillRect(i * s + 2, j * s + 2, s - 4, s - 4);
  }
  noise(g, w, h, 1500, 0.2);
}, { repeat: [1 / 1.2, 1 / 1.2] });

function rugTex(seed, P) {
  const rnd = mulberry32(seed);
  return canvasTex(384, 576, (g, w, h) => {
    g.fillStyle = P.border; g.fillRect(0, 0, w, h);
    const band = (inset, col, lw) => { g.strokeStyle = col; g.lineWidth = lw; g.strokeRect(inset, inset, w - 2 * inset, h - 2 * inset); };
    // border motifs
    for (let y = 20; y < h - 10; y += 22) for (const x of [20, w - 20]) { g.fillStyle = P.motif; g.beginPath(); g.moveTo(x, y - 8); g.lineTo(x + 7, y); g.lineTo(x, y + 8); g.lineTo(x - 7, y); g.fill(); }
    for (let x = 20; x < w - 10; x += 22) for (const y of [20, h - 20]) { g.fillStyle = P.motif; g.beginPath(); g.moveTo(x, y - 8); g.lineTo(x + 7, y); g.lineTo(x, y + 8); g.lineTo(x - 7, y); g.fill(); }
    band(38, P.accent, 5);
    g.fillStyle = P.field; g.fillRect(44, 44, w - 88, h - 88);
    // field pattern
    for (let y = 60; y < h - 50; y += 28) for (let x = 60 + ((y / 28) % 2) * 14; x < w - 50; x += 28) {
      g.fillStyle = rnd() < 0.5 ? P.motif : P.accent;
      g.globalAlpha = 0.55;
      g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
    }
    // central medallion
    const cx = w / 2, cy = h / 2;
    const layers = [[130, P.border], [105, P.accent], [85, P.motif], [55, P.field], [30, P.accent], [12, P.border]];
    for (const [r, c] of layers) { g.fillStyle = c; g.beginPath(); g.moveTo(cx, cy - r * 1.35); g.lineTo(cx + r, cy); g.lineTo(cx, cy + r * 1.35); g.lineTo(cx - r, cy); g.fill(); }
    band(52, P.motif, 2);
    for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.15})`; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
  });
}
TEX.rugLiving = rugTex(1, { border: '#5a1a22', field: '#7a2a2a', accent: '#d7a253', motif: '#2c3550' });
TEX.rugStudy = rugTex(2, { border: '#2b3149', field: '#6b2226', accent: '#c98d47', motif: '#e8d6b0' });
TEX.rugBed = rugTex(3, { border: '#6e2a30', field: '#8b3a3a', accent: '#3a4a5c', motif: '#e2c48a' });
TEX.rugRunner = rugTex(4, { border: '#7a3a34', field: '#a3593f', accent: '#e0b070', motif: '#4a2a28' });

TEX.floral = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#efe2cc'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 26; i++) {
    const x = rr(0, w), y = rr(0, h);
    g.strokeStyle = '#7a8a50'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + rr(-20, 20), y + 15, x + rr(-15, 15), y + 30); g.stroke();
    g.fillStyle = pick(['#8a2a3a', '#a04050', '#6e1f2c']);
    for (let p = 0; p < 5; p++) { g.beginPath(); g.arc(x + Math.cos(p * 1.26) * 4, y + Math.sin(p * 1.26) * 4, 3, 0, 7); g.fill(); }
  }
});

TEX.quilt = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#6a1e2e'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,200,200,0.13)'; g.lineWidth = 2;
  for (let i = -h; i < w + h; i += 32) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke();
    g.beginPath(); g.moveTo(i, h); g.lineTo(i + h, 0); g.stroke();
  }
  for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '40,0,10' : '160,70,80'},0.25)`; g.beginPath(); g.arc(rr(0, w), rr(0, h), rr(2, 6), 0, 7); g.fill(); }
}, { repeat: [1, 1] });

TEX.knit = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#e4d3b2'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(120,95,60,0.45)'; g.lineWidth = 2;
  for (let x = 0; x < w; x += 16) for (let y = 0; y < h; y += 10) {
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + 8, y + 8); g.lineTo(x + 16, y); g.stroke();
  }
}, { repeat: [3, 3] });

function booksTex(seed) {
  const rnd = mulberry32(seed);
  return canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = '#20120c'; g.fillRect(0, 0, w, h);
    const cols = ['#6e1f2c', '#7a2a24', '#2f4a3a', '#2b3a55', '#8a5a2a', '#5a3a28', '#a0743a', '#3c2a3e', '#8b3a3a', '#46523a'];
    let x = 0;
    while (x < w) {
      const bw = 10 + rnd() * 14, bh = h * (0.7 + rnd() * 0.3);
      g.fillStyle = cols[Math.floor(rnd() * cols.length)];
      g.fillRect(x, h - bh, bw - 1, bh);
      g.fillStyle = 'rgba(230,190,110,0.8)';
      g.fillRect(x + 1, h - bh + 8, bw - 3, 2);
      g.fillRect(x + 1, h - 14, bw - 3, 2);
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(x + 1, h - bh, 2, bh);
      x += bw;
      if (rnd() < 0.06) x += 14; // gap
    }
  });
}
TEX.books = [booksTex(11), booksTex(12), booksTex(13)];

TEX.starChart = canvasTex(512, 384, (g, w, h) => {
  g.fillStyle = '#b28a5c'; g.fillRect(0, 0, w, h);
  noise(g, w, h, 2500, 0.25);
  // pinned papers
  for (let i = 0; i < 14; i++) {
    const x = rr(0, w - 70), y = rr(0, h - 80);
    g.fillStyle = '#efe5cf'; g.fillRect(x, y, 64, 78);
    g.strokeStyle = 'rgba(60,80,50,0.7)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x + 32, y + 70); g.lineTo(x + 32, y + 15); g.stroke();
    for (let k = 0; k < 5; k++) { g.beginPath(); g.ellipse(x + 32 + (k % 2 ? 10 : -10), y + 22 + k * 9, 9, 4, k % 2 ? 0.5 : -0.5, 0, 7); g.stroke(); }
  }
  // central star chart
  g.fillStyle = '#1b2440'; g.fillRect(w * 0.27, h * 0.12, w * 0.46, h * 0.76);
  g.strokeStyle = '#d8b46a'; g.lineWidth = 2;
  g.beginPath(); g.arc(w / 2, h / 2, h * 0.33, 0, 7); g.stroke();
  for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(255,240,200,${rr(0.4, 1)})`; g.beginPath(); g.arc(w / 2 + rr(-1, 1) * h * 0.33, h / 2 + rr(-1, 1) * h * 0.33, rr(0.5, 2), 0, 7); g.fill(); }
  g.strokeStyle = 'rgba(216,180,106,0.6)'; g.lineWidth = 1;
  for (let c = 0; c < 6; c++) { g.beginPath(); let x = w / 2 + rr(-90, 90), y = h / 2 + rr(-90, 90); g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += rr(-30, 30); y += rr(-30, 30); g.lineTo(x, y); } g.stroke(); }
});

TEX.galaxy = canvasTex(256, 320, (g, w, h) => {
  g.fillStyle = '#0d0c18'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2000; i++) {
    const a = rr(0, Math.PI * 4), r = a * 9 + rr(-10, 10);
    g.fillStyle = `rgba(${R() < 0.5 ? '200,150,255' : '255,210,170'},${rr(0.1, 0.6)})`;
    g.fillRect(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r * 0.6, 2, 2);
  }
  for (let i = 0; i < 150; i++) { g.fillStyle = '#fff'; g.fillRect(rr(0, w), rr(0, h), 1, 1); }
});

TEX.garden = canvasTex(320, 256, (g, w, h) => {
  g.fillStyle = '#4a5a3a'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#8a4a36'; g.fillRect(w * 0.3, h * 0.25, w * 0.4, h * 0.5);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = pick(['#2f4a28', '#5a7a3a', '#3d5f2c', '#c97a9a', '#e6b8c8', '#f0e8e0']);
    g.beginPath(); g.arc(rr(0, w), rr(0, h), rr(3, 10), 0, 7); g.fill();
  }
});

TEX.fern = canvasTex(160, 210, (g, w, h) => {
  g.fillStyle = '#eee3cc'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#5a6e3a'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(w / 2, h * 0.9); g.lineTo(w / 2, h * 0.12); g.stroke();
  for (let y = h * 0.2; y < h * 0.85; y += 9) {
    const s = (h * 0.9 - y) * 0.35;
    g.beginPath(); g.ellipse(w / 2 - s / 2, y, s / 2, 3, -0.3, 0, 7); g.ellipse(w / 2 + s / 2, y, s / 2, 3, 0.3, 0, 7); g.stroke();
  }
});

TEX.flowerPrint = canvasTex(160, 210, (g, w, h) => {
  g.fillStyle = '#eee3cc'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#5a6e3a'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(w / 2, h * 0.9); g.lineTo(w / 2, h * 0.3); g.stroke();
  g.fillStyle = '#9a3a5a';
  for (let i = 0; i < 18; i++) { g.beginPath(); g.arc(w / 2 + rr(-25, 25), h * 0.3 + rr(-25, 25), 6, 0, 7); g.fill(); }
});

TEX.photo = canvasTex(160, 128, (g, w, h) => {
  g.fillStyle = '#c99a6a'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#5a3020'; g.beginPath(); g.arc(w * 0.35, h * 0.5, 30, 0, 7); g.arc(w * 0.68, h * 0.5, 28, 0, 7); g.fill();
  g.fillStyle = '#e8b896'; g.beginPath(); g.arc(w * 0.35, h * 0.55, 20, 0, 7); g.arc(w * 0.68, h * 0.56, 19, 0, 7); g.fill();
});

TEX.drops = canvasTex(256, 256, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  for (let i = 0; i < 200; i++) { g.fillStyle = `rgba(220,235,255,${rr(0.15, 0.5)})`; g.beginPath(); g.arc(rr(0, w), rr(0, h), rr(0.6, 2.2), 0, 7); g.fill(); }
  for (let i = 0; i < 25; i++) { g.strokeStyle = `rgba(220,235,255,${rr(0.1, 0.3)})`; g.lineWidth = rr(0.8, 1.6); const x = rr(0, w), y = rr(0, h); g.beginPath(); g.moveTo(x, y); g.lineTo(x + rr(-2, 2), y + rr(20, 60)); g.stroke(); }
});

TEX.glow = canvasTex(64, 64, (g, w, h) => {
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,220,140,1)');
  grd.addColorStop(0.3, 'rgba(255,190,90,0.45)');
  grd.addColorStop(1, 'rgba(255,170,60,0)');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
});

// =====================================================================
//  Materials
// =====================================================================
const std = (o) => new THREE.MeshStandardMaterial(o);
const MAT = {
  plaster: std({ color: 0xf4dcc0, map: TEX.plaster, roughness: 0.95 }),
  cap: std({ color: 0x3b302c, roughness: 0.9 }),
  brick: std({ map: TEX.brick, roughness: 0.92 }),
  floor: std({ map: TEX.floor, roughness: 0.5 }),
  wood: std({ color: 0x9a6034, map: TEX.grain, roughness: 0.55 }),
  darkWood: std({ color: 0x5a3220, map: TEX.grain, roughness: 0.55 }),
  frameWood: std({ color: 0x2e1d16, map: TEX.grain, roughness: 0.6 }),
  cream: std({ color: 0xe6dcc6, roughness: 0.65 }),
  white: std({ color: 0xf6f2ea, roughness: 0.3 }),
  velvet: new THREE.MeshPhysicalMaterial({ color: 0x6a1a28, roughness: 0.85, sheen: 1, sheenColor: new THREE.Color(0xd06a80), sheenRoughness: 0.5 }),
  plum: new THREE.MeshPhysicalMaterial({ color: 0x5a2448, roughness: 0.9, sheen: 0.8, sheenColor: new THREE.Color(0xb070a0) }),
  mustard: new THREE.MeshPhysicalMaterial({ color: 0xc08a2a, roughness: 0.8, sheen: 0.8, sheenColor: new THREE.Color(0xffd080) }),
  burgundy: std({ color: 0x6e1f2c, roughness: 0.6 }),
  brass: std({ color: 0xd2a656, metalness: 0.9, roughness: 0.28 }),
  iron: std({ color: 0x1c1c1f, metalness: 0.6, roughness: 0.5 }),
  ceramic: std({ color: 0xf1e8d8, roughness: 0.3 }),
  terracotta: std({ color: 0xb5653a, roughness: 0.85 }),
  leaf: std({ color: 0x3f6b2a, roughness: 0.65 }),
  leaf2: std({ color: 0x5f8f34, roughness: 0.65 }),
  leafDark: std({ color: 0x24401f, roughness: 0.8 }),
  autumn: std({ color: 0xa88a2a, roughness: 0.8 }),
  bark: std({ color: 0x3a2a20, roughness: 0.95 }),
  pink: std({ color: 0xc88aa8, roughness: 0.8 }),
  lilac: std({ color: 0xa07ab0, roughness: 0.8 }),
  hydWhite: std({ color: 0xf2ece0, roughness: 0.8 }),
  orange: std({ color: 0xc8662a, roughness: 0.5 }),
  red: std({ color: 0xb03a2a, roughness: 0.5 }),
  paper: std({ color: 0xefe5cf, roughness: 0.9 }),
  knit: std({ map: TEX.knit, roughness: 1 }),
  floral: std({ map: TEX.floral, roughness: 0.9 }),
  quilt: new THREE.MeshPhysicalMaterial({ map: TEX.quilt, roughness: 0.9, sheen: 0.6, sheenColor: new THREE.Color(0xc06070) }),
  tile: std({ map: TEX.tile, roughness: 0.25 }),
  checker: std({ map: TEX.checker, roughness: 0.35 }),
  paving: std({ map: TEX.paving, roughness: 0.25, metalness: 0.2 }),
  street: std({ color: 0x1d1e22, roughness: 0.18, metalness: 0.35 }),
  lawn: std({ color: 0x24321f, roughness: 0.9 }),
  stove: std({ color: 0x2a2624, roughness: 0.4, metalness: 0.4 }),
  steel: std({ color: 0xb8b6b0, roughness: 0.3, metalness: 0.8 }),
  jar: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, transmission: 0.0, transparent: true, opacity: 0.35 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x9fb8cc, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.18, depthWrite: false }),
  drops: new THREE.MeshBasicMaterial({ map: TEX.drops, transparent: true, opacity: 0.55, depthWrite: false }),
  flame: new THREE.MeshBasicMaterial({ color: 0xffc070 }),
  candle: std({ color: 0xffb060, emissive: 0xff8a30, emissiveIntensity: 1.6, transparent: true, opacity: 0.9 }),
  shade: std({ color: 0xfbe7c0, emissive: 0xffc880, emissiveIntensity: 1.1, side: THREE.DoubleSide }),
  bulb: new THREE.MeshBasicMaterial({ color: 0xfff0c8 }),
  winLit: new THREE.MeshBasicMaterial({ color: 0xffb860 }),
  winDim: new THREE.MeshBasicMaterial({ color: 0x5a4a3a }),
  winDark: std({ color: 0x15181f, roughness: 0.2, metalness: 0.5 }),
  navy: std({ color: 0x232c4a, roughness: 0.8 }),
  skin: std({ color: 0xf0c4a0, roughness: 0.7 }),
  hair: std({ color: 0x6a2e1a, roughness: 0.7 }),
  pants: std({ color: 0x3a2c2a, roughness: 0.9 }),
  cat: std({ color: 0xd08a48, roughness: 0.9 }),
  black: std({ color: 0x111111, roughness: 0.5 }),
};
const imgMat = (tex) => std({ map: tex, roughness: 0.8 });

// =====================================================================
//  Geometry helpers + collision registry
// =====================================================================
const colliders = [];
const fadeables = [];
const flickers = []; // {mesh, light, base}
const spinners = []; // animated things

function addCol(minX, minY, minZ, maxX, maxY, maxZ) { colliders.push({ minX, minY, minZ, maxX, maxY, maxZ }); }
function colFromObj(obj, pad = 0, maxY = null) {
  obj.updateWorldMatrix(true, true);
  const b = new THREE.Box3().setFromObject(obj);
  addCol(b.min.x + pad, b.min.y, b.min.z + pad, b.max.x - pad, maxY ?? b.max.y, b.max.z - pad);
}

// scale a BoxGeometry's UVs so textures are in world metres
function worldUV(geo, w, h, d) {
  const uv = geo.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v;
    uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]);
  }
}

// box with bottom at y
function box(w, h, d, mat, x, y, z, parent = scene, { solid = false, rotY = 0 } = {}) {
  const g = new THREE.BoxGeometry(w, h, d);
  worldUV(g, w, h, d);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y + h / 2, z);
  m.rotation.y = rotY;
  parent.add(m);
  if (solid) colFromObj(m);
  return m;
}
function cyl(rt, rb, h, mat, x, y, z, parent = scene, seg = 16) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y + h / 2, z);
  parent.add(m);
  return m;
}
const SPH = new THREE.SphereGeometry(1, 14, 10);
const SPH_LO = new THREE.SphereGeometry(1, 8, 6);
function sph(r, mat, x, y, z, parent = scene, sx = 1, sy = 1, sz = 1, lo = false) {
  const m = new THREE.Mesh(lo ? SPH_LO : SPH, mat);
  m.position.set(x, y, z);
  m.scale.set(r * sx, r * sy, r * sz);
  parent.add(m);
  return m;
}
function plane(w, h, mat, x, y, z, parent = scene, rotX = 0, rotY = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z);
  m.rotation.set(rotX, rotY, 0);
  parent.add(m);
  return m;
}
function grp(x, y, z, rotY = 0, parent = scene) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  parent.add(g);
  return g;
}
function rug(w, d, tex, x, y, z, parent = scene, rotY = 0) {
  const m = plane(w, d, imgMat(tex), x, y + 0.012, z, parent, -Math.PI / 2, 0);
  m.rotation.z = rotY;
  return m;
}

// =====================================================================
//  Walls, windows, doors
// =====================================================================
const T = 0.22; // wall thickness
const FACE = { '+x': 0, '-x': 1, '+z': 4, '-z': 5 };

function registerFade(mesh) {
  const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => m.clone());
  mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
  mesh.userData.mats = mats;
  mesh.userData.op = 1;
  mesh.userData.fade = true;
  fadeables.push(mesh);
}

function wallMats(outer, inner = MAT.plaster) {
  const arr = [inner, inner, MAT.cap, inner, inner, inner];
  if (outer) arr[FACE[outer]] = MAT.brick;
  return arr;
}

/**
 * axis 'x': wall runs along x (a0..a1) at z = c. axis 'z': runs along z at x = c.
 * openings: [{a, b, lo, hi, kind: 'window'|'door'|'open'}]  (lo/hi relative to y0)
 */
function wall(axis, c, a0, a1, y0, h, openings = [], { outer = null, parent = scene, t = T, mats = null } = {}) {
  const segMats = mats || wallMats(outer);
  const seg = (p0, p1, lo, hi) => {
    if (p1 - p0 < 0.001 || hi - lo < 0.001) return;
    const len = p1 - p0, mid = (p0 + p1) / 2;
    const m = axis === 'x'
      ? box(len, hi - lo, t, segMats, mid, y0 + lo, c, parent, { solid: true })
      : box(t, hi - lo, len, segMats, c, y0 + lo, mid, parent, { solid: true });
    registerFade(m);
  };
  let cur = a0;
  for (const o of [...openings].sort((p, q) => p.a - q.a)) {
    seg(cur, o.a, 0, h);
    seg(o.a, o.b, 0, o.lo);
    seg(o.a, o.b, o.hi, h);
    if (o.kind === 'window') addWindow(axis, c, o.a, o.b, y0 + o.lo, y0 + o.hi, parent, t);
    else if (o.kind === 'door' || o.kind === 'open') addDoorFrame(axis, c, o.a, o.b, y0, y0 + o.hi, parent, t);
    cur = o.b;
  }
  seg(cur, a1, 0, h);
}

function addWindow(axis, c, a, b, ylo, yhi, parent, t) {
  const W = b - a, H = yhi - ylo, mid = (a + b) / 2;
  const g = axis === 'x' ? grp(mid, ylo, c, 0, parent) : grp(c, ylo, mid, Math.PI / 2, parent);
  const f = 0.07, d = t + 0.06;
  const fm = MAT.frameWood;
  box(W + f * 2, f, d, fm, 0, H, 0, g);
  box(W + f * 2, f, d + 0.12, fm, 0, -f, 0, g); // sill
  box(f, H, d, fm, -W / 2 - f / 2, 0, 0, g);
  box(f, H, d, fm, W / 2 + f / 2, 0, 0, g);
  const nv = Math.max(1, Math.round(W / 0.45) - 1);
  for (let i = 1; i <= nv; i++) box(0.035, H, 0.06, fm, -W / 2 + (W * i) / (nv + 1), 0, 0, g);
  for (const hy of [H * 0.36, H * 0.68]) box(W, 0.035, 0.06, fm, 0, hy, 0, g);
  const glass = plane(W, H, MAT.glass, 0, H / 2, 0, g);
  glass.renderOrder = 2;
  for (const s of [-1, 1]) {
    const dr = plane(W, H, MAT.drops, 0, H / 2, s * 0.012, g, 0, s < 0 ? Math.PI : 0);
    dr.renderOrder = 3;
    dr.userData.dynamic = true;
  }
  glass.userData.dynamic = true;
  // glass blocks movement
  if (axis === 'x') addCol(a, ylo, c - 0.05, b, yhi, c + 0.05);
  else addCol(c - 0.05, ylo, a, c + 0.05, yhi, b);
}

function addDoorFrame(axis, c, a, b, y0, ytop, parent, t) {
  const W = b - a, H = ytop - y0, mid = (a + b) / 2;
  const g = axis === 'x' ? grp(mid, y0, c, 0, parent) : grp(c, y0, mid, Math.PI / 2, parent);
  const f = 0.08, d = t + 0.05;
  box(W + f * 2, f, d, MAT.cream, 0, H, 0, g);
  box(f, H, d, MAT.cream, -W / 2 - f / 2, 0, 0, g);
  box(f, H, d, MAT.cream, W / 2 + f / 2, 0, 0, g);
}

// =====================================================================
//  HOUSE LAYOUT
//  x: 0..20  (living 0-6 | hall 6-11 | kitchen 11-20), z: 0 (back) .. 10 (front, cut away)
//  Ground floor y 0..3.2, slab 3.2..3.4, upper floor 3.4..6.4
//  Garden: x 20..27
// =====================================================================
const H1 = 3.2, SLAB = 0.2, F2 = H1 + SLAB, H2 = 3.0;

// ---- ground: everything stands on this
addCol(-60, -2, -60, 60, 0, 60);

// Outside paving & street
{
  const p = box(60, 0.1, 60, MAT.paving, 10, -0.1, 5);
  void p;
  box(60, 0.02, 8, MAT.street, 10, -0.005, 17.5);
  box(60, 0.02, 0.3, std({ color: 0x5a5650, roughness: 0.5 }), 10, 0, 13.4); // kerb
  box(80, 0.02, 30, MAT.lawn, 10, -0.004, -16);
}

// House floors (wood)
box(20, 0.12, 10, MAT.floor, 10, -0.11, 5);
// Kitchen rug runner / bathroom etc. added later

// ---------- Ground floor walls ----------
// back wall z=0
wall('x', 0, -T / 2, 20 + T / 2, 0, H1 + SLAB, [
  { a: 0.6, b: 1.8, lo: 0.95, hi: 2.6, kind: 'window' },
  { a: 2.4, b: 3.6, lo: 0.95, hi: 2.6, kind: 'window' },
  { a: 4.2, b: 5.4, lo: 0.95, hi: 2.6, kind: 'window' },
  { a: 14.6, b: 17.2, lo: 1.15, hi: 2.75, kind: 'window' },
], { outer: '-z' });
// left wall x=0 (front door)
wall('z', 0, 0, 10, 0, H1 + SLAB, [{ a: 6.4, b: 7.5, lo: 0, hi: 2.3, kind: 'door' }], { outer: '-x' });
// right wall x=20 (back door to the garden)
wall('z', 20, 0, 10, 0, H1 + SLAB, [
  { a: 2.0, b: 3.2, lo: 0, hi: 2.35, kind: 'open' },
  { a: 5.4, b: 7.0, lo: 1.0, hi: 2.6, kind: 'window' },
], { outer: '+x' });
// interior walls
wall('z', 6, 0, 10, 0, H1, [{ a: 4.8, b: 6.9, lo: 0, hi: 2.45, kind: 'open' }]);
wall('z', 11, 0, 10, 0, H1, [{ a: 4.8, b: 7.4, lo: 0, hi: 2.45, kind: 'open' }]);
// cut-away low front wall
registerFade(box(20 + T, 0.9, T, wallMats('+z'), 10, 0, 10, scene, { solid: true }));

// front door (closed, decorative) on x=0
{
  const g = grp(0, 0, 6.95, Math.PI / 2);
  box(1.1, 2.3, 0.08, std({ color: 0x5e1a26, roughness: 0.5 }), 0, 0, 0.0, g);
  for (const [px, py] of [[-0.25, 0.25], [0.25, 0.25], [-0.25, 1.2], [0.25, 1.2]]) box(0.36, 0.75, 0.03, std({ color: 0x531622, roughness: 0.5 }), px, py, 0.05, g);
  sph(0.05, MAT.brass, 0.4, 1.05, 0.08, g);
  box(0.36, 0.08, 0.02, MAT.brass, 0, 1.0, 0.06, g);
}
// back door (open, swung outward into the garden)
{
  const g = grp(20 + T / 2, 0, 2.0, Math.PI * 0.4);
  const door = box(1.2, 2.33, 0.06, std({ color: 0x2e2420, roughness: 0.5 }), 0.6, 0, 0, g);
  void door;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) plane(0.4, 0.35, MAT.glass, 0.35 + j * 0.5, 0.45 + i * 0.45, 0.035, g);
  box(0.9, 0.02, 0.6, MAT.knit, 20 - 0.6, 0, 2.6); // door mat
}

// ---------- Slab between floors (part of the upper group: hidden when downstairs) ----------
const HOLE = { x0: 7.5, x1: 9.4, z0: 3.0, z1: 9.0 };
const slabMats = [MAT.cap, MAT.cap, MAT.floor, MAT.plaster, MAT.cap, MAT.cap];
function slab(x0, x1, z0, z1) {
  const m = box(x1 - x0, SLAB, z1 - z0, slabMats, (x0 + x1) / 2, H1, (z0 + z1) / 2, upper, { solid: true });
  registerFade(m);
}
slab(0, HOLE.x0, 0, 10);
slab(HOLE.x1, 20, 0, 10);
slab(HOLE.x0, HOLE.x1, 0, HOLE.z0);
slab(HOLE.x0, HOLE.x1, HOLE.z1, 10);

// ---------- Upper walls ----------
wall('x', 0, -T / 2, 20 + T / 2, F2, H2, [
  { a: 2.3, b: 4.2, lo: 0.85, hi: 2.45, kind: 'window' },
  { a: 12.0, b: 13.1, lo: 1.2, hi: 2.3, kind: 'window' },
], { outer: '-z', parent: upper });
wall('z', 0, 0, 10, F2, H2, [{ a: 6.6, b: 8.4, lo: 0.85, hi: 2.45, kind: 'window' }], { outer: '-x', parent: upper });
wall('z', 20, 0, 10, F2, H2, [{ a: 3.0, b: 4.5, lo: 0.85, hi: 2.5, kind: 'window' }], { outer: '+x', parent: upper });
wall('z', 6, 0, 10, F2, H2, [{ a: 6.0, b: 7.5, lo: 0, hi: 2.2, kind: 'door' }], { parent: upper });
wall('z', 11, 0, 10, F2, H2, [
  { a: 1.2, b: 2.2, lo: 0, hi: 2.2, kind: 'door' },
  { a: 6.0, b: 7.5, lo: 0, hi: 2.2, kind: 'door' },
], { parent: upper });
// bathroom (x 11..14, z 0..4.5)
wall('x', 4.5, 11, 14 + T / 2, F2, H2, [], { parent: upper });
wall('z', 14, 0, 4.5, F2, H2, [], { parent: upper });
registerFade(box(20 + T, 0.9, T, wallMats('+z'), 10, F2, 10, upper, { solid: true }));

// bathroom floor tiles
box(3, 0.01, 4.5, MAT.checker, 12.5, F2, 2.25, upper);

// ---------- Staircase (bottom at the front, climbing toward the back) ----------
{
  const N = 12, rise = F2 / N, run = 0.5, sx0 = 7.6, sx1 = 9.3, zStart = 9.0;
  const sw = sx1 - sx0, sxm = (sx0 + sx1) / 2;
  const runner = std({ color: 0x8a3a34, roughness: 0.95 });
  for (let i = 0; i < N; i++) {
    const zf = zStart - i * run, zb = zf - run, top = (i + 1) * rise;
    box(sw, top, run, MAT.cream, sxm, 0, (zf + zb) / 2, scene, { solid: true });
    box(sw + 0.04, 0.04, run + 0.03, MAT.wood, sxm, top - 0.04, (zf + zb) / 2 + 0.015);
    box(sw * 0.62, 0.012, run, runner, sxm, top, (zf + zb) / 2);
  }
  // banisters on both sides
  for (const bx of [sx0 + 0.04, sx1 - 0.04]) {
    for (let i = 0; i < N; i++) {
      const z = zStart - i * run - run / 2, base = (i + 1) * rise;
      cyl(0.018, 0.018, 0.9, MAT.white, bx, base, z, scene, 6);
    }
    const len = Math.hypot(N * run, F2);
    const rail = box(0.07, 0.07, len, MAT.wood, bx, 0, zStart - (N * run) / 2);
    rail.position.y = F2 / 2 + 0.95;
    rail.rotation.x = Math.atan2(F2, N * run);
    box(0.12, 1.1, 0.12, MAT.wood, bx, 0, zStart - 0.1);
    sph(0.07, MAT.wood, bx, 1.15, zStart - 0.1);
  }
  // railings around the stair hole upstairs (hidden with the upper floor)
  const railLine = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), along = x1 !== x0;
    const n = Math.round(len / 0.14);
    for (let i = 0; i <= n; i++) cyl(0.018, 0.018, 0.92, MAT.white, x0 + ((x1 - x0) * i) / n, F2, z0 + ((z1 - z0) * i) / n, upper, 6);
    const r = along ? box(len, 0.06, 0.08, MAT.wood, (x0 + x1) / 2, F2 + 0.92, z0, upper) : box(0.08, 0.06, len, MAT.wood, x0, F2 + 0.92, (z0 + z1) / 2, upper);
    void r;
    if (along) addCol(Math.min(x0, x1), F2, z0 - 0.05, Math.max(x0, x1), F2 + 1, z0 + 0.05);
    else addCol(x0 - 0.05, F2, Math.min(z0, z1), x0 + 0.05, F2 + 1, Math.max(z0, z1));
  };
  railLine(HOLE.x0 - 0.04, HOLE.z0 + 0.6, HOLE.x0 - 0.04, HOLE.z1 + 0.04);
  railLine(HOLE.x1 + 0.04, HOLE.z0 + 0.6, HOLE.x1 + 0.04, HOLE.z1 + 0.04);
  railLine(HOLE.x0 - 0.04, HOLE.z1 + 0.04, HOLE.x1 + 0.04, HOLE.z1 + 0.04);
}

// =====================================================================
//  Furniture builders (local space, front faces +z)
// =====================================================================
function candle(x, y, z, parent = scene, s = 1) {
  const jar = cyl(0.06 * s, 0.055 * s, 0.11 * s, MAT.candle, x, y, z, parent, 12);
  const flame = sph(0.018 * s, MAT.flame, x, y + 0.13 * s, z, parent, 1, 1.8, 1);
  jar.userData.dynamic = true; flame.userData.dynamic = true;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }));
  glow.scale.set(0.5 * s, 0.5 * s, 1);
  glow.position.set(x, y + 0.1 * s, z);
  parent.add(glow);
  flickers.push({ flame, glow, seed: R() * 100 });
}

function leafy(x, y, z, parent = scene, s = 1, potMat = MAT.terracotta) {
  const g = grp(x, y, z, R() * 6, parent);
  cyl(0.18 * s, 0.13 * s, 0.32 * s, potMat, 0, 0, 0, g);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2, r = rr(0.1, 0.28) * s;
    const l = sph(0.16 * s, i % 2 ? MAT.leaf : MAT.leaf2, Math.cos(a) * r, 0.42 * s + rr(0, 0.35) * s, Math.sin(a) * r, g, 0.55, 0.22, 1, true);
    l.rotation.set(rr(-0.6, 0.6), a, rr(-0.5, 0.5));
  }
  if (y === 0 || y === F2) addCol(x - 0.2 * s, y, z - 0.2 * s, x + 0.2 * s, y + 0.5 * s, z + 0.2 * s);
  return g;
}

function ivy(x, y, z, parent = scene, len = 1.2, potMat = MAT.terracotta, strands = 5) {
  const g = grp(x, y, z, 0, parent);
  cyl(0.15, 0.11, 0.22, potMat, 0, 0, 0, g);
  for (let s = 0; s < strands; s++) {
    const a = (s / strands) * Math.PI * 2 + rr(-0.3, 0.3);
    let px = Math.cos(a) * 0.14, pz = Math.sin(a) * 0.14, py = 0.22;
    const L = len * rr(0.6, 1.1);
    for (let k = 0; k < L / 0.09; k++) {
      sph(0.065, k % 3 ? MAT.leaf : MAT.leaf2, px, py, pz, g, 1, 0.75, 0.35, true).rotation.y = rr(0, 6);
      px += Math.cos(a) * 0.02; pz += Math.sin(a) * 0.02; py -= 0.085;
    }
  }
  for (let i = 0; i < 6; i++) sph(0.07, MAT.leaf2, rr(-0.12, 0.12), 0.26, rr(-0.12, 0.12), g, 1, 0.6, 0.6, true);
  return g;
}

function flowers(x, y, z, parent = scene, mat = MAT.pink, s = 1, vase = MAT.ceramic) {
  const g = grp(x, y, z, 0, parent);
  cyl(0.07 * s, 0.09 * s, 0.24 * s, vase, 0, 0, 0, g, 14);
  sph(0.02 * s, MAT.burgundy, 0.06 * s, 0.13 * s, 0.07 * s, g, 1, 2, 1);
  for (let i = 0; i < 9; i++) sph(0.075 * s, mat, rr(-0.12, 0.12) * s, (0.32 + rr(0, 0.12)) * s, rr(-0.12, 0.12) * s, g, 1, 0.9, 1, true);
  for (let i = 0; i < 5; i++) sph(0.06 * s, MAT.leaf, rr(-0.14, 0.14) * s, 0.27 * s, rr(-0.14, 0.14) * s, g, 1, 0.4, 1, true);
  if (y === 0 || y === F2) addCol(x - 0.12 * s, y, z - 0.12 * s, x + 0.12 * s, y + 0.45 * s, z + 0.12 * s);
  return g;
}

function frame(w, h, tex, x, y, z, rotY, parent = scene, fm = MAT.frameWood) {
  const g = grp(x, y, z, rotY, parent);
  box(w, h, 0.04, fm, 0, -h / 2, 0, g);
  plane(w - 0.08, h - 0.08, imgMat(tex), 0, 0, 0.022, g);
  return g;
}

function bookshelf(w, h, d, x, y, z, rotY, parent = scene, shelves = 5) {
  const g = grp(x, y, z, rotY, parent);
  const m = MAT.darkWood;
  box(0.04, h, d, m, -w / 2 + 0.02, 0, 0, g);
  box(0.04, h, d, m, w / 2 - 0.02, 0, 0, g);
  box(w, 0.04, d, m, 0, h - 0.04, 0, g);
  box(w, h, 0.02, m, 0, 0, -d / 2 + 0.01, g);
  const step = (h - 0.1) / shelves;
  for (let i = 0; i < shelves; i++) {
    const sy = 0.06 + i * step;
    box(w - 0.06, 0.03, d, m, 0, sy, 0, g);
    const bt = TEX.books[i % 3].clone();
    bt.needsUpdate = true;
    bt.offset.x = R();
    bt.repeat.set((w - 0.1) / 1.2, 1);
    const bh = step * 0.85;
    const mats = [MAT.burgundy, MAT.burgundy, MAT.paper, MAT.paper, imgMat(bt), MAT.paper];
    const books = new THREE.Mesh(new THREE.BoxGeometry(w - 0.1, bh, d * 0.75), mats);
    books.position.set(0, sy + 0.03 + bh / 2, 0.02);
    g.add(books);
  }
  colFromObj(g);
  return g;
}

function windsor(x, y, z, rotY, parent = scene, cushion = MAT.mustard, throwMat = null) {
  const g = grp(x, y, z, rotY, parent);
  const m = MAT.wood;
  box(0.48, 0.05, 0.45, m, 0, 0.43, 0, g);
  if (cushion) box(0.44, 0.06, 0.42, cushion, 0, 0.48, 0.01, g);
  for (const [lx, lz] of [[-0.2, -0.18], [0.2, -0.18], [-0.2, 0.18], [0.2, 0.18]]) cyl(0.022, 0.026, 0.43, m, lx, 0, lz, g, 8);
  for (let i = 0; i < 6; i++) cyl(0.012, 0.012, 0.5, m, -0.18 + i * 0.072, 0.48, -0.2, g, 6);
  box(0.5, 0.06, 0.05, m, 0, 0.97, -0.2, g);
  if (throwMat) box(0.4, 0.75, 0.03, throwMat, -0.05, 0.3, -0.24, g);
  colFromObj(g, 0.04, y + 0.5);
  return g;
}

function roundTable(r, h, x, y, z, parent = scene) {
  const g = grp(x, y, z, 0, parent);
  cyl(r, r, 0.05, MAT.wood, 0, h - 0.05, 0, g, 28);
  cyl(r * 0.92, r * 0.92, 0.08, MAT.darkWood, 0, h - 0.13, 0, g, 28);
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; cyl(0.03, 0.025, h - 0.1, MAT.darkWood, Math.cos(a) * r * 0.7, 0, Math.sin(a) * r * 0.7, g, 8); }
  colFromObj(g, r * 0.12);
  return g;
}

// =====================================================================
//  LIVING ROOM (x 0..6, z 0..10)
// =====================================================================
rug(4.4, 3.3, TEX.rugLiving, 3.0, 0, 2.9);
{
  // sofa under the windows
  const g = grp(3.0, 0, 0.75, 0);
  const v = MAT.velvet;
  for (const lx of [-1.1, 1.1]) for (const lz of [-0.32, 0.32]) cyl(0.03, 0.03, 0.12, MAT.darkWood, lx, 0, lz, g, 8);
  box(2.5, 0.3, 0.92, v, 0, 0.12, 0, g);
  for (let i = -1; i <= 1; i++) box(0.74, 0.14, 0.7, v, i * 0.76, 0.42, 0.08, g);
  box(2.5, 0.55, 0.26, v, 0, 0.42, -0.33, g);
  for (const s of [-1, 1]) {
    box(0.24, 0.42, 0.92, v, s * 1.2, 0.3, 0, g);
    cyl(0.13, 0.13, 0.92, v, s * 1.2, 0.72, 0, g, 14).rotation.x = Math.PI / 2;
  }
  // pillows
  const p1 = box(0.48, 0.42, 0.13, MAT.floral, 0.55, 0.5, -0.12, g); p1.rotation.z = 0.12; p1.rotation.x = -0.25;
  const p2 = box(0.5, 0.45, 0.14, MAT.mustard, 1.0, 0.5, -0.12, g); p2.rotation.z = -0.1; p2.rotation.x = -0.25;
  // chunky knit throw draped over the back
  box(0.7, 0.04, 0.6, MAT.knit, -0.65, 0.97, -0.2, g);
  box(0.7, 0.62, 0.04, MAT.knit, -0.65, 0.4, 0.42, g);
  addCol(1.7, 0, 0.29, 4.3, 0.55, 1.21);
  addCol(1.7, 0, 0.12, 4.3, 0.98, 0.5);
}
roundTable(0.62, 0.48, 3.0, 0, 2.75);
{
  // books + vase + candle on the coffee table
  box(0.32, 0.05, 0.22, MAT.burgundy, 2.7, 0.48, 2.7);
  box(0.3, 0.05, 0.2, MAT.navy, 2.7, 0.53, 2.7);
  box(0.28, 0.04, 0.2, MAT.cream, 2.7, 0.58, 2.7);
  cyl(0.06, 0.06, 0.07, MAT.brass, 2.7, 0.62, 2.7);
  flowers(3.15, 0.48, 2.65, scene, MAT.pink, 0.9);
  candle(3.3, 0.48, 3.0);
}
// knitted pouf with a sleeping cat
const pouf = sph(0.36, MAT.knit, 4.7, 0.25, 3.7, scene, 1, 0.68, 1);
addCol(4.38, 0, 3.38, 5.02, 0.48, 4.02);
const catPos = new THREE.Vector3(4.7, 0.5, 3.7);
{
  const g = grp(4.7, 0.48, 3.7, 0.6);
  sph(0.2, MAT.cat, 0, 0.1, 0, g, 1.1, 0.55, 0.8);
  sph(0.1, MAT.cat, 0.2, 0.09, 0.08, g);
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.07, 4), MAT.cat); e.position.set(0.22, 0.18, 0.08 + s * 0.05); g.add(e); }
  const tail = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.03, 6, 16, Math.PI), MAT.cat);
  tail.rotation.x = Math.PI / 2; tail.position.set(0, 0.05, 0); g.add(tail);
  for (const s of [-1, 1]) sph(0.012, MAT.black, 0.29, 0.1, 0.08 + s * 0.035, g, 1, 0.4, 1);
  g.userData.cat = true;
  spinners.push({ obj: g, kind: 'cat' });
}
windsor(1.3, 0, 3.4, Math.PI * 0.62, scene, MAT.mustard, MAT.plum);
// bookcase against the hall wall
bookshelf(1.3, 2.4, 0.4, 6 - T / 2 - 0.2, 0, 1.9, -Math.PI / 2, scene, 6);
leafy(6 - 0.35, 2.42, 1.6, scene, 0.9);
ivy(6 - 0.35, 2.42, 2.35, scene, 1.4);
// floor lamp (tiffany-ish)
{
  const g = grp(4.85, 0, 0.55);
  cyl(0.18, 0.2, 0.04, MAT.brass, 0, 0, 0, g);
  cyl(0.02, 0.02, 1.55, MAT.brass, 0, 0.04, 0, g, 8);
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.26, 16, 1, true), MAT.shade);
  shade.position.set(0, 1.62, 0); g.add(shade);
  sph(0.06, MAT.bulb, 0, 1.55, 0, g);
  addCol(4.7, 0, 0.4, 5.0, 1.8, 0.7);
}
leafy(0.45, 0, 0.5, scene, 1.4, MAT.cream);
leafy(5.5, 0, 4.4, scene, 1.6);
// windowsill candles and flowers
candle(1.2, 0.95, 0.05); candle(4.8, 0.95, 0.05);
flowers(3.0, 0.95, 0.05, scene, MAT.pink, 1);
// wall art & sconce by the front door
frame(0.6, 0.8, TEX.galaxy, T / 2 + 0.01, 2.2, 4.6, Math.PI / 2, scene, MAT.brass);
{
  const g = grp(T / 2, 1.9, 5.7, Math.PI / 2);
  box(0.08, 0.2, 0.06, MAT.iron, 0, 0, 0.05, g);
  box(0.2, 0.32, 0.2, std({ color: 0xffa040, emissive: 0xff8a20, emissiveIntensity: 0.9 }), 0, 0.05, 0.22, g);
  box(0.24, 0.04, 0.24, MAT.iron, 0, 0.37, 0.22, g);
}
leafy(0.45, 0, 8.6, scene, 1.2);


// =====================================================================
//  HALL (x 6..11) - stairs already built
// =====================================================================
rug(0.9, 2.6, TEX.rugRunner, 10.2, 0, 7.6);
{
  // sideboard with lamp at the back of the hall
  const g = grp(10.2, 0, 0.45);
  box(1.3, 0.85, 0.45, MAT.darkWood, 0, 0.05, 0, g);
  for (const s of [-1, 1]) box(0.58, 0.7, 0.02, MAT.wood, s * 0.31, 0.12, 0.23, g);
  for (const s of [-1, 1]) sph(0.02, MAT.brass, s * 0.06, 0.5, 0.25, g);
  colFromObj(g);
  cyl(0.08, 0.1, 0.35, MAT.brass, -0.35, 0.9, 0, g);
  const sh = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.2, 14, 1, true), MAT.shade); sh.position.set(-0.35, 1.38, 0); g.add(sh);
  flowers(0.3, 0.9, 0, g, MAT.lilac, 1);
}
{
  const g = grp(6.6, 0, 0.6);
  cyl(0.28, 0.24, 0.4, std({ color: 0xa07848, roughness: 0.9 }), 0, 0, 0, g); // basket
  box(0.4, 0.08, 0.3, MAT.knit, 0, 0.4, 0, g);
  colFromObj(g);
}
frame(0.35, 0.45, TEX.fern, 6 + T / 2 + 0.01, 2.0, 2.0, Math.PI / 2);
frame(0.35, 0.45, TEX.flowerPrint, 6 + T / 2 + 0.01, 2.0, 2.6, Math.PI / 2);
frame(0.35, 0.45, TEX.fern, 11 - T / 2 - 0.01, 2.0, 2.0, -Math.PI / 2);
// pendant lamp
{
  cyl(0.008, 0.008, 0.6, MAT.iron, 8.45, 2.6, 1.5);
  sph(0.18, std({ color: 0xffe0a0, emissive: 0xffb060, emissiveIntensity: 1.4 }), 8.45, 2.5, 1.5);
  cyl(0.1, 0.12, 0.06, MAT.brass, 8.45, 2.64, 1.5);
}
ivy(10.7, 0.9, 4.2, scene, 0.6);
{
  // little console + plant on the right walkway wall
  box(0.35, 0.9, 0.9, MAT.darkWood, 10.75, 0, 4.2, scene, { solid: true });
}

// =====================================================================
//  KITCHEN (x 11..20)
// =====================================================================
{
  const top = 0.92;
  // back counter run
  const runX0 = 11.15, runX1 = 19.85;
  box(runX1 - runX0, top - 0.05, 0.62, MAT.cream, (runX0 + runX1) / 2, 0, 0.42, scene);
  box(runX1 - runX0, 0.05, 0.68, MAT.wood, (runX0 + runX1) / 2, top - 0.05, 0.45);
  addCol(runX0, 0, 0.1, runX1, top, 0.8);
  // cabinet doors + brass cup pulls
  for (let x = runX0 + 0.3; x < runX1 - 0.2; x += 0.6) {
    if (Math.abs(x - 15.9) < 0.6) continue;
    box(0.54, 0.6, 0.02, std({ color: 0xddd2ba, roughness: 0.6 }), x, 0.1, 0.74);
    box(0.5, 0.12, 0.02, std({ color: 0xddd2ba, roughness: 0.6 }), x, 0.72, 0.74);
    box(0.1, 0.02, 0.03, MAT.brass, x, 0.77, 0.76);
  }
  // farmhouse sink under the window
  box(0.85, 0.32, 0.66, MAT.white, 15.9, top - 0.3, 0.44);
  box(0.75, 0.05, 0.5, std({ color: 0xd8d4cc }), 15.9, top - 0.02, 0.42);
  {
    const g = grp(15.9, top, 0.17);
    cyl(0.025, 0.03, 0.35, MAT.brass, 0, 0, 0, g, 10);
    const sp = cyl(0.02, 0.02, 0.2, MAT.brass, 0, 0.33, 0.08, g, 8); sp.rotation.x = Math.PI / 2;
    for (const s of [-1, 1]) cyl(0.025, 0.025, 0.08, MAT.brass, s * 0.16, 0, 0, g, 8);
  }
  // tea towel
  box(0.25, 0.4, 0.02, MAT.floral, 15.9, 0.25, 0.79);
  // backsplash tiles
  box(8.6, 0.6, 0.02, MAT.tile, 15.5, top, T / 2 + 0.01);
  // range cooker
  {
    const g = grp(12.3, 0, 0.45);
    box(0.95, 0.9, 0.66, MAT.stove, 0, 0, 0, g);
    box(0.7, 0.4, 0.02, MAT.black, 0, 0.18, 0.34, g);
    box(0.6, 0.02, 0.03, MAT.brass, 0, 0.63, 0.35, g);
    for (let i = 0; i < 5; i++) cyl(0.03, 0.03, 0.03, MAT.brass, -0.36 + i * 0.18, 0.74, 0.34, g, 10).rotation.x = Math.PI / 2;
    for (const [bx, bz] of [[-0.22, -0.15], [0.22, -0.15], [-0.22, 0.15], [0.22, 0.15]]) cyl(0.1, 0.1, 0.02, MAT.iron, bx, 0.9, bz, g, 14);
    // dutch oven
    cyl(0.17, 0.15, 0.17, MAT.burgundy, -0.22, 0.92, 0.12, g, 20);
    cyl(0.175, 0.175, 0.03, MAT.burgundy, -0.22, 1.09, 0.12, g, 20);
    sph(0.03, MAT.black, -0.22, 1.13, 0.12, g);
    box(0.9, 0.12, 0.08, MAT.stove, 0, 0.9, -0.28, g);
  }
  // jars, utensils, coffee pour-over on the counter
  for (let i = 0; i < 4; i++) {
    cyl(0.08, 0.08, 0.2 + i * 0.03, MAT.jar, 13.2 + i * 0.22, top, 0.3).renderOrder = 1;
    cyl(0.07, 0.07, 0.1 + i * 0.02, pick([MAT.autumn, MAT.wood, MAT.cream, MAT.darkWood]), 13.2 + i * 0.22, top, 0.3);
    cyl(0.083, 0.083, 0.03, MAT.wood, 13.2 + i * 0.22, top + 0.2 + i * 0.03, 0.3);
  }
  cyl(0.08, 0.07, 0.2, MAT.ceramic, 11.6, top, 0.35);
  for (let i = 0; i < 4; i++) { const u = cyl(0.012, 0.012, 0.32, MAT.wood, 11.6 + rr(-0.03, 0.03), top + 0.15, 0.35 + rr(-0.03, 0.03), scene, 6); u.rotation.z = rr(-0.2, 0.2); }
  cyl(0.1, 0.06, 0.18, MAT.jar, 14.2, top, 0.35); cyl(0.08, 0.08, 0.08, std({ color: 0x3a1e10 }), 14.2, top, 0.35);
  // bottles & fruit bowl
  cyl(0.04, 0.045, 0.24, std({ color: 0x5a2a12, roughness: 0.2 }), 17.0, top, 0.3);
  cyl(0.04, 0.045, 0.2, std({ color: 0x5a2a12, roughness: 0.2 }), 17.12, top, 0.3);
  cyl(0.2, 0.12, 0.1, MAT.wood, 18.4, top, 0.4);
  for (let i = 0; i < 7; i++) sph(0.05, i % 2 ? MAT.orange : MAT.red, 18.4 + rr(-0.12, 0.12), top + 0.13, 0.4 + rr(-0.1, 0.1));
  flowers(14.7, 1.15, 0.12, scene, MAT.hydWhite, 1.1); // on the window sill
  leafy(17.6, 1.15, 0.12, scene, 0.8);
  candle(17.25, 1.15, 0.12, scene);
  // open shelves with mugs
  for (const sy of [1.75, 2.3]) {
    box(2.4, 0.05, 0.3, MAT.wood, 12.4, sy, 0.27);
    for (let i = 0; i < 6; i++) {
      const mx = 11.45 + i * 0.36;
      if (i % 3 === 2) { cyl(0.11, 0.07, 0.12, MAT.burgundy, mx, sy + 0.05, 0.27); continue; }
      cyl(0.05, 0.045, 0.11, MAT.ceramic, mx, sy + 0.05, 0.27);
    }
  }
  ivy(13.4, 2.35, 0.27, scene, 1.0, MAT.ceramic);
  ivy(11.5, 2.35, 0.27, scene, 0.9, MAT.ceramic);
  // under-shelf light strip
  box(2.3, 0.02, 0.05, MAT.bulb, 12.4, 1.73, 0.3);
}
// island
{
  const g = grp(15.5, 0, 4.6);
  const m = MAT.wood;
  box(2.2, 0.08, 1.0, m, 0, 0.87, 0, g);
  for (const [lx, lz] of [[-1.02, -0.42], [1.02, -0.42], [-1.02, 0.42], [1.02, 0.42]]) box(0.09, 0.87, 0.09, MAT.darkWood, lx, 0, lz, g);
  for (const sy of [0.12, 0.45]) box(2.05, 0.04, 0.9, MAT.darkWood, 0, sy, 0, g);
  // shelf contents
  box(0.7, 0.28, 0.45, std({ color: 0xa07848, roughness: 0.9 }), -0.55, 0.49, 0, g); // basket
  box(0.5, 0.06, 0.4, MAT.floral, -0.55, 0.77, 0, g);
  cyl(0.13, 0.11, 0.3, MAT.ceramic, 0.2, 0.49, 0, g); // jug
  for (let i = 0; i < 3; i++) cyl(0.22 - i * 0.04, 0.16 - i * 0.03, 0.08, MAT.cream, 0.7, 0.49 + i * 0.07, 0, g, 18);
  for (let i = 0; i < 3; i++) cyl(0.15, 0.15, 0.1, MAT.steel, -0.6 + i * 0.4, 0.16, 0, g, 18);
  ivy(0.75, 0.95, -0.25, g, 0.7);
  // baking things on top
  cyl(0.28, 0.17, 0.22, MAT.burgundy, -0.3, 0.95, -0.05, g, 22);
  cyl(0.24, 0.24, 0.02, MAT.paper, -0.3, 1.15, -0.05, g, 22);
  const pin = cyl(0.045, 0.045, 0.5, MAT.wood, 0.2, 0.95, 0.2, g, 10); pin.rotation.z = Math.PI / 2; pin.position.y = 1.0;
  cyl(0.11, 0.11, 0.28, MAT.jar, 0.6, 0.95, -0.2, g);
  cyl(0.1, 0.1, 0.2, MAT.paper, 0.6, 0.95, -0.2, g);
  for (let i = 0; i < 3; i++) sph(0.035, std({ color: 0xc89060 }), 0.35 + i * 0.07, 0.99, 0.25, g, 1, 1.25, 1);
  box(0.4, 0.02, 0.3, MAT.floral, -0.75, 0.95, 0.15, g);
  box(0.2, 0.26, 0.02, MAT.paper, 0.95, 1.0, 0.0, g).rotation.x = -0.3;
  colFromObj(g, 0, 0.95);
}
rug(1.4, 3.0, TEX.rugRunner, 15.5, 0, 4.6, scene, Math.PI / 2);
// dining table
rug(2.6, 2.6, TEX.rugBed, 13.6, 0, 7.9);
roundTable(0.6, 0.76, 13.6, 0, 7.9);
windsor(13.6, 0, 7.05, 0, scene, MAT.velvet);
windsor(12.8, 0, 8.4, Math.PI * 0.62 + Math.PI, scene, MAT.velvet, MAT.plum);
windsor(14.45, 0, 8.4, -Math.PI * 0.62 - Math.PI, scene, MAT.velvet);
flowers(13.45, 0.76, 7.85, scene, MAT.hydWhite, 0.9);
candle(13.8, 0.76, 8.05);
box(0.3, 0.04, 0.22, MAT.burgundy, 13.85, 0.76, 7.7);
// coat hooks + aprons, radiator near the back door
{
  box(0.04, 0.06, 0.9, MAT.wood, 20 - T / 2 - 0.02, 1.8, 4.4);
  box(0.03, 1.0, 0.36, MAT.burgundy, 20 - T / 2 - 0.05, 0.85, 4.15);
  box(0.03, 0.7, 0.32, std({ color: 0xc0a070, roughness: 1 }), 20 - T / 2 - 0.05, 1.05, 4.65);
  const g = grp(20 - T / 2 - 0.1, 0.1, 6.2);
  for (let i = 0; i < 10; i++) box(0.12, 0.65, 0.06, std({ color: 0x8a7a50, metalness: 0.7, roughness: 0.4 }), 0, 0, -0.4 + i * 0.09, g);
  colFromObj(g);
  leafy(19.5, 0, 8.5, scene, 1.3);
}
frame(0.4, 0.5, TEX.flowerPrint, 20 - T / 2 - 0.01, 2.2, 8.0, -Math.PI / 2);

// =====================================================================
//  GARDEN (x 20..27, z 0..10)
// =====================================================================
{
  const gw = (axis, c, a0, a1, h) => {
    const m = axis === 'x' ? box(a1 - a0, h, 0.3, MAT.brick, (a0 + a1) / 2, 0, c, scene, { solid: true }) : box(0.3, h, a1 - a0, MAT.brick, c, 0, (a0 + a1) / 2, scene, { solid: true });
    registerFade(m);
  };
  gw('x', -0.1, 20, 27.3, 2.4);
  gw('z', 27.15, -0.1, 10.3, 2.4);
  // iron railing at the front of the garden
  for (let x = 20.2; x <= 27; x += 0.15) cyl(0.012, 0.012, 1.1, MAT.iron, x, 0, 10.1, scene, 5);
  box(7, 0.04, 0.04, MAT.iron, 23.6, 1.08, 10.1);
  box(7, 0.04, 0.04, MAT.iron, 23.6, 0.2, 10.1);
  addCol(20, 0, 10.0, 27.3, 1.2, 10.2);
  // ivy on the walls
  for (let i = 0; i < 70; i++) sph(rr(0.12, 0.3), pick([MAT.leaf, MAT.leafDark, MAT.leaf2]), rr(20.2, 27), rr(0.4, 2.5), 0.08, scene, 1, 1, 0.4, true);
  for (let i = 0; i < 70; i++) sph(rr(0.12, 0.3), pick([MAT.leaf, MAT.leafDark, MAT.leaf2]), 26.98, rr(0.4, 2.5), rr(0, 10), scene, 0.4, 1, 1, true);
  // hydrangea bushes
  const bush = (x, z, flower) => {
    const g = grp(x, 0, z);
    for (let i = 0; i < 6; i++) sph(rr(0.25, 0.4), MAT.leafDark, rr(-0.3, 0.3), rr(0.25, 0.6), rr(-0.3, 0.3), g, 1, 0.8, 1, true);
    for (let i = 0; i < 10; i++) sph(rr(0.1, 0.14), flower, rr(-0.4, 0.4), rr(0.5, 0.95), rr(-0.4, 0.4), g, 1, 1, 1, true);
    colFromObj(g, 0.15);
  };
  bush(21.7, 0.7, MAT.hydWhite); bush(23.0, 0.6, MAT.pink); bush(26.3, 1.4, MAT.hydWhite); bush(26.3, 4.2, MAT.lilac); bush(26.3, 7.0, MAT.pink);
  // bistro table + chairs
  roundTable(0.38, 0.72, 23.6, 0, 2.6).traverse((o) => { if (o.isMesh) o.material = MAT.iron; });
  candle(23.6, 0.72, 2.6, scene, 1.3);
  for (const [cx, cz, ry] of [[23.0, 2.1, Math.PI * 0.25], [24.2, 3.1, Math.PI * 1.25]]) {
    const g = grp(cx, 0, cz, ry);
    box(0.42, 0.04, 0.42, MAT.iron, 0, 0.44, 0, g);
    for (const [lx, lz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) cyl(0.015, 0.015, 0.44, MAT.iron, lx, 0, lz, g, 5);
    for (let i = 0; i < 5; i++) cyl(0.01, 0.01, 0.45, MAT.iron, -0.17 + i * 0.085, 0.46, -0.2, g, 5);
    colFromObj(g, 0.04, 0.48);
  }
  // pots along the house wall
  for (const [px, pz, s] of [[20.6, 4.0, 1.2], [20.5, 5.0, 0.9], [20.6, 8.6, 1.4], [21.6, 9.4, 1]]) { leafy(px, 0, pz, scene, s); addCol(px - 0.2 * s, 0, pz - 0.2 * s, px + 0.2 * s, 0.4 * s, pz + 0.2 * s); }
  // lantern post
  {
    const g = grp(25.6, 0, 8.4);
    cyl(0.05, 0.07, 2.2, MAT.iron, 0, 0, 0, g, 8);
    box(0.3, 0.42, 0.3, std({ color: 0xffa040, emissive: 0xff8a20, emissiveIntensity: 1.0 }), 0, 2.2, 0, g);
    box(0.36, 0.06, 0.36, MAT.iron, 0, 2.62, 0, g);
    colFromObj(g, 0.08, 2.2);
  }
  // little wet tree outside the railing
  const tree = (x, z, s, leafMat) => {
    const g = grp(x, 0, z);
    cyl(0.12 * s, 0.18 * s, 3 * s, MAT.bark, 0, 0, 0, g, 8);
    for (let i = 0; i < 9; i++) sph(rr(0.7, 1.1) * s, i % 3 ? leafMat : MAT.leafDark, rr(-1, 1) * s, (3 + rr(0, 1.6)) * s, rr(-1, 1) * s, g, 1, 0.85, 1, true);
  };
  tree(29.5, 4, 1.4, MAT.autumn);
  tree(-3.5, 3, 1.5, MAT.autumn);
  tree(-2.5, -4, 1.3, MAT.leaf);
  tree(8, -5, 1.6, MAT.autumn);
  tree(17, -4.5, 1.4, MAT.leafDark);
  tree(24, -5, 1.5, MAT.autumn);
  tree(-6, 12, 1.4, MAT.autumn);
  tree(32, 14, 1.6, MAT.autumn);
  // invisible boundaries of the playable lot
  addCol(-1, 0, 10.0, 0, 3, 10.3);
  // tall invisible barrier along the cut-away front so you can't tumble into the street
  addCol(-1, -1, 10.0, 28, 20, 10.25);
}

// back garden wall, neighbours' houses behind and across the street
{
  box(30, 1.8, 0.3, MAT.brick, 10, 0, -3.5);
  for (let i = 0; i < 40; i++) sph(rr(0.2, 0.4), pick([MAT.leaf, MAT.leafDark]), rr(-4, 26), rr(0.5, 1.9), -3.35, scene, 1, 1, 0.5, true);
  const terrace = (z, facing) => {
    for (let k = 0; k < 7; k++) {
      const x0 = -14 + k * 7.2, h = rr(9, 11.5);
      box(7, h, 6, MAT.brick, x0 + 3.5, 0, z);
      const fz = z + facing * 3.01;
      for (let fl = 0; fl < 3; fl++) for (let wi = 0; wi < 3; wi++) {
        const lit = R() < 0.55;
        const wm = lit ? MAT.winLit : R() < 0.5 ? MAT.winDim : MAT.winDark;
        plane(1.0, 1.6, wm, x0 + 1.4 + wi * 2.1, 1.6 + fl * 3.0, fz, scene, 0, facing > 0 ? 0 : Math.PI);
      }
      box(7.2, 0.4, 6.2, MAT.cap, x0 + 3.5, h, z);
    }
  };
  terrace(-14, 1);
  terrace(27, -1);
  // street lamps
  for (const lx of [-4, 10, 24]) {
    cyl(0.06, 0.09, 3.6, MAT.iron, lx, 0, 13.2, scene, 8);
    box(0.32, 0.45, 0.32, std({ color: 0xffd9a0, emissive: 0xffb050, emissiveIntensity: 2.5 }), lx, 3.6, 13.2);
  }
  // iron railing along the front of the house
  for (let x = -0.1; x <= 20; x += 0.18) cyl(0.012, 0.012, 1.0, MAT.iron, x, 0, 11.2, scene, 5);
  box(20.2, 0.04, 0.04, MAT.iron, 10, 0.98, 11.2);
  // neighbour wall on the left
  box(0.4, 7, 16, MAT.brick, -1.6, 0, 3);
}

// =====================================================================
//  STUDY (upper, x 0..6)
// =====================================================================
const U = upper;
rug(3.6, 2.8, TEX.rugStudy, 3.1, F2, 3.4, U);
{
  // desk under the window
  const g = grp(3.25, F2, 0.75, 0, U);
  box(2.4, 0.06, 0.9, MAT.wood, 0, 0.74, 0, g);
  box(2.3, 0.14, 0.85, MAT.darkWood, 0, 0.6, 0, g);
  for (const s of [-0.6, 0, 0.6]) sph(0.02, MAT.brass, s, 0.67, 0.43, g);
  for (const [lx, lz] of [[-1.12, -0.38], [1.12, -0.38], [-1.12, 0.38], [1.12, 0.38]]) cyl(0.04, 0.03, 0.6, MAT.darkWood, lx, 0, lz, g, 10);
  colFromObj(g, 0, F2 + 0.8);
  // open book, papers, mug, brass lamp, orrery
  const ob = box(0.5, 0.03, 0.34, MAT.paper, -0.2, 0.8, 0.1, g); ob.rotation.y = 0.08;
  box(0.02, 0.035, 0.34, MAT.burgundy, -0.2, 0.8, 0.1, g);
  box(0.45, 0.005, 0.32, MAT.paper, 0.45, 0.8, 0.15, g).rotation.y = -0.15;
  cyl(0.045, 0.04, 0.1, MAT.ceramic, 0.6, 0.8, -0.1, g);
  for (let i = 0; i < 3; i++) box(0.28, 0.06, 0.2, pick([MAT.burgundy, MAT.navy, MAT.darkWood]), -0.95, 0.8 + i * 0.06, -0.2, g);
  cyl(0.035, 0.03, 0.12, MAT.ceramic, -0.75, 0.8, -0.25, g);
  for (let i = 0; i < 3; i++) cyl(0.006, 0.006, 0.18, MAT.wood, -0.75 + rr(-0.01, 0.01), 0.88, -0.25, g, 4);
  // desk lamp
  cyl(0.1, 0.11, 0.03, MAT.brass, -0.7, 0.8, 0.1, g);
  const arm = cyl(0.012, 0.012, 0.5, MAT.brass, -0.7, 0.8, 0.1, g, 6); arm.rotation.z = -0.35; arm.position.x = -0.62;
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.14, 14, 1, true), MAT.brass);
  shade.position.set(-0.45, 1.25, 0.1); shade.rotation.z = 0.5; g.add(shade);
  sph(0.04, MAT.bulb, -0.43, 1.2, 0.1, g);
  // orrery
  const orr = grp(0.95, 0.8, -0.15, 0, g);
  cyl(0.09, 0.11, 0.04, MAT.brass, 0, 0, 0, orr);
  cyl(0.01, 0.01, 0.25, MAT.brass, 0, 0.04, 0, orr, 6);
  const spin = grp(0, 0.3, 0, 0, orr);
  sph(0.06, std({ color: 0xe0a040, emissive: 0x804010, emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.3 }), 0, 0, 0, spin);
  for (const [r, s] of [[0.12, 0.018], [0.18, 0.025], [0.24, 0.02]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.003, 4, 40), MAT.brass); ring.rotation.x = Math.PI / 2; spin.add(ring);
    sph(s, MAT.brass, r, 0, 0, spin).rotation.y = R() * 6;
  }
  spin.traverse((o) => { o.userData.dynamic = true; });
  spinners.push({ obj: spin, kind: 'spin' });
}
windsor(3.2, F2, 1.8, Math.PI + 0.15, U, MAT.mustard);
bookshelf(3.0, 2.4, 0.4, T / 2 + 0.2, F2, 2.6, Math.PI / 2, U, 6);
bookshelf(1.2, 2.4, 0.4, 5.9 - 0.2, F2, 1.0, -Math.PI / 2, U, 6);
frame(1.3, 1.0, TEX.starChart, 1.2, F2 + 2.45, T / 2 + 0.02, 0, U);
frame(0.45, 0.55, TEX.galaxy, 5.9 - 0.01, F2 + 2.2, 3.2, -Math.PI / 2, U, MAT.brass);
ivy(0.4, F2 + 2.4, 1.0, U, 1.2);
ivy(5.5, F2 + 2.4, 0.4, U, 1.4);
flowers(4.15, F2 + 0.85, 0.06, U, MAT.hydWhite, 0.8, MAT.jar);
{
  // reading armchair with throw + side table and candle
  const g = grp(1.4, F2, 6.0, Math.PI * 0.75, U);
  box(0.95, 0.42, 0.9, MAT.velvet, 0, 0.05, 0, g);
  box(0.95, 0.6, 0.22, MAT.velvet, 0, 0.45, -0.34, g);
  for (const s of [-1, 1]) box(0.18, 0.28, 0.9, MAT.velvet, s * 0.42, 0.45, 0, g);
  box(0.6, 0.65, 0.04, MAT.knit, 0.1, 0.35, -0.47, g);
  colFromObj(g, 0.05, F2 + 0.5);
  roundTable(0.3, 0.55, 2.5, F2, 6.4, U);
  candle(2.5, F2 + 0.55, 6.35, U);
  box(0.24, 0.06, 0.18, MAT.burgundy, 2.4, F2 + 0.55, 6.5, U);
  // globe
  cyl(0.05, 0.08, 0.6, MAT.wood, 4.9, F2, 6.4, U);
  const globe = sph(0.2, std({ color: 0x5a7a8a, roughness: 0.5 }), 4.9, F2 + 0.82, 6.4, U);
  globe.userData.dynamic = true;
  spinners.push({ obj: globe, kind: 'spin' });
  const meridian = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.008, 4, 30), MAT.brass); meridian.position.set(4.9, F2 + 0.82, 6.4); U.add(meridian);
  addCol(4.7, F2, 6.2, 5.1, F2 + 1.05, 6.6);
  // telescope by the window
  const tg = grp(0.6, F2, 8.6, 0.6, U);
  for (let i = 0; i < 3; i++) { const l = cyl(0.015, 0.015, 1.2, MAT.wood, Math.cos(i * 2.1) * 0.2, 0, Math.sin(i * 2.1) * 0.2, tg, 5); l.rotation.set(Math.sin(i * 2.1) * 0.25, 0, -Math.cos(i * 2.1) * 0.25); l.position.y = 0.55; }
  const tube = cyl(0.05, 0.07, 0.9, MAT.brass, 0, 1.1, 0, tg, 12); tube.rotation.z = -1.1; tube.position.y = 1.2;
  colFromObj(tg, 0.05, F2 + 1.4);
  // basket of scrolls
  cyl(0.2, 0.17, 0.3, std({ color: 0xa07848, roughness: 0.9 }), 4.9, F2, 1.0, U);
  for (let i = 0; i < 5; i++) cyl(0.03, 0.03, 0.55, MAT.paper, 4.9 + rr(-0.1, 0.1), F2 + 0.05, 1.0 + rr(-0.1, 0.1), U, 8).rotation.z = rr(-0.25, 0.25);
}

// =====================================================================
//  LANDING (upper, x 6..11)
// =====================================================================
rug(3.6, 1.0, TEX.rugRunner, 8.5, F2, 1.5, U, Math.PI / 2);
{
  const g = grp(6.45, F2, 0.45, 0, U);
  roundTable(0.25, 0.7, 0, 0, 0, g);
  ivy(6.45, F2 + 0.7, 0.45, U, 0.8);
  frame(0.4, 0.5, TEX.flowerPrint, 6 + T / 2 + 0.01, F2 + 2.0, 1.6, Math.PI / 2, U);
  frame(0.4, 0.5, TEX.fern, 8.5, F2 + 2.1, T / 2 + 0.02, 0, U);
  cyl(0.008, 0.008, 0.5, MAT.iron, 8.5, F2 + 2.5, 1.5, U);
  sph(0.15, std({ color: 0xffe0a0, emissive: 0xffb060, emissiveIntensity: 1.4 }), 8.5, F2 + 2.4, 1.5, U);
  leafy(10.6, F2, 9.4, U, 1.1);
  leafy(6.4, F2, 9.4, U, 1.0);
}

// =====================================================================
//  BATHROOM (upper, x 11..14, z 0..4.5)
// =====================================================================
{
  // claw-foot tub
  const g = grp(12.3, F2, 0.62, 0, U);
  const tub = sph(0.5, MAT.white, 0, 0.36, 0, g, 1.6, 0.6, 0.85);
  box(1.4, 0.04, 0.65, std({ color: 0xbfd2d8, roughness: 0.1 }), 0, 0.5, 0, g);
  void tub;
  for (const [fx, fz] of [[-0.6, -0.25], [0.6, -0.25], [-0.6, 0.25], [0.6, 0.25]]) sph(0.05, MAT.brass, fx, 0.06, fz, g);
  cyl(0.02, 0.02, 0.3, MAT.brass, -0.75, 0.5, 0, g, 8);
  colFromObj(g, 0.05, F2 + 0.62);
  // towel rail
  box(0.5, 0.6, 0.04, MAT.floral, 11 + T / 2 + 0.05, F2 + 0.8, 3.4).rotation.y = Math.PI / 2;
  // pedestal sink + oval mirror on the wall to the bedroom
  const sg = grp(14 - T / 2 - 0.3, F2, 2.6, -Math.PI / 2, U);
  cyl(0.08, 0.12, 0.8, MAT.white, 0, 0, 0, sg);
  cyl(0.28, 0.2, 0.15, MAT.white, 0, 0.78, 0.05, sg, 20);
  cyl(0.015, 0.015, 0.18, MAT.brass, 0, 0.93, -0.15, sg, 8);
  const mir = sph(0.3, std({ color: 0xc9d6dc, metalness: 0.9, roughness: 0.05 }), 0, 1.65, -0.27, sg, 0.8, 1.1, 0.05);
  void mir;
  const mf = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 6, 30), MAT.brass); mf.scale.set(0.8, 1.1, 1); mf.position.set(0, 1.65, -0.26); sg.add(mf);
  colFromObj(sg, 0.05);
  flowers(13.6, F2, 4.0, U, MAT.lilac, 1);
  leafy(11.45, F2, 4.05, U, 1);
  // sconce
  box(0.12, 0.2, 0.12, std({ color: 0xffe0a0, emissive: 0xffb060, emissiveIntensity: 1.4 }), 13.7, F2 + 2.0, 2.6);
}

// =====================================================================
//  BEDROOM (upper, x 11..20 minus bathroom)
// =====================================================================
rug(3.8, 2.8, TEX.rugBed, 16.6, F2, 2.8, U);
{
  const g = grp(16.6, F2, 1.35, 0, U);
  // frame
  box(1.85, 0.25, 2.2, MAT.wood, 0, 0.12, 0, g);
  box(1.95, 1.25, 0.08, MAT.wood, 0, 0, -1.12, g);
  for (let i = 0; i < 9; i++) cyl(0.025, 0.025, 0.55, MAT.wood, -0.8 + i * 0.2, 0.6, -1.12, g, 6);
  box(2.0, 0.1, 0.1, MAT.wood, 0, 1.2, -1.12, g);
  box(1.95, 0.45, 0.06, MAT.wood, 0, 0, 1.12, g);
  // mattress, sheets, quilt
  box(1.78, 0.22, 2.1, MAT.white, 0, 0.37, 0, g);
  const q = box(1.9, 0.08, 1.45, MAT.quilt, 0, 0.56, 0.35, g);
  void q;
  box(1.9, 0.4, 0.05, MAT.quilt, 0, 0.2, 1.08, g);
  for (const s of [-1, 1]) box(0.05, 0.4, 1.45, MAT.quilt, s * 0.95, 0.2, 0.35, g);
  box(1.84, 0.1, 0.4, MAT.cream, 0, 0.57, -0.42, g); // folded sheet
  box(1.92, 0.04, 0.5, MAT.floral, 0, 0.64, 0.6, g); // throw across the foot
  for (const s of [-1, 1]) box(0.05, 0.42, 0.5, MAT.floral, s * 0.97, 0.26, 0.6, g);
  for (const s of [-0.45, 0.45]) { const p = sph(0.4, MAT.cream, s, 0.72, -0.85, g, 1, 0.38, 0.5); void p; }
  const mp = box(0.6, 0.35, 0.14, MAT.mustard, -0.05, 0.62, -0.62, g); mp.rotation.x = -0.4;
  addCol(15.66, F2, 0.21, 17.54, F2 + 0.62, 2.48);
  addCol(15.6, F2, 0.15, 17.6, F2 + 1.3, 0.3);
  // slippers
  for (const s of [-1, 1]) sph(0.07, MAT.knit, 15.3 + s * 0.09, F2 + 0.04, 2.3, U, 0.8, 0.5, 1.6);
  // nightstands
  const ns = (x) => { const n = grp(x, F2, 0.45, 0, U); box(0.55, 0.62, 0.45, MAT.wood, 0, 0, 0, n); box(0.45, 0.18, 0.02, MAT.darkWood, 0, 0.38, 0.23, n); sph(0.02, MAT.brass, 0, 0.47, 0.25, n); colFromObj(n); return n; };
  const nr = ns(18.0);
  cyl(0.06, 0.1, 0.4, MAT.brass, -0.1, 0.62, -0.05, nr);
  const lsh = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 0.26, 18, 1, true), MAT.shade); lsh.position.set(-0.1, 1.12, -0.05); nr.add(lsh);
  for (let i = 0; i < 3; i++) box(0.08, 0.24, 0.17, pick([MAT.burgundy, MAT.navy, MAT.darkWood]), 0.12 + i * 0.08, 0.62, 0, nr);
  candle(18.2, F2 + 0.62, 0.6, U, 0.8);
  // stool on the left with book + mug, flowers
  const st = grp(15.15, F2, 0.55, 0, U);
  cyl(0.24, 0.24, 0.05, MAT.wood, 0, 0.55, 0, st, 18);
  for (let i = 0; i < 3; i++) { const a = i * 2.1; const l = cyl(0.02, 0.025, 0.55, MAT.wood, Math.cos(a) * 0.17, 0, Math.sin(a) * 0.17, st, 6); void l; }
  box(0.22, 0.04, 0.16, MAT.paper, 0, 0.6, 0.06, st);
  cyl(0.045, 0.04, 0.1, MAT.ceramic, 0.12, 0.6, -0.08, st);
  colFromObj(st, 0.04);
  flowers(14.5, F2, 0.45, U, MAT.pink, 1.2);
  // gallery wall
  frame(1.2, 0.9, TEX.garden, 16.3, F2 + 2.6, T / 2 + 0.02, 0, U, MAT.brass);
  frame(0.4, 0.5, TEX.fern, 15.3, F2 + 2.55, T / 2 + 0.02, 0, U);
  frame(0.4, 0.5, TEX.flowerPrint, 15.3, F2 + 1.95, T / 2 + 0.02, 0, U);
  frame(0.35, 0.42, TEX.garden, 17.3, F2 + 2.55, T / 2 + 0.02, 0, U);
  frame(0.35, 0.42, TEX.fern, 17.3, F2 + 2.05, T / 2 + 0.02, 0, U);
  ivy(14.5, F2 + 2.3, 0.3, U, 1.3, MAT.terracotta);
  // curtains by the side window
  for (const cz of [2.75, 4.75]) box(0.06, 2.7, 0.45, MAT.floral, 20 - T / 2 - 0.12, F2 + 0.1, cz, U);
  box(0.04, 0.04, 2.6, MAT.brass, 20 - T / 2 - 0.12, F2 + 2.82, 3.75, U);
  // dresser with photo, candle, dish
  const dr = grp(20 - T / 2 - 0.28, F2, 7.0, -Math.PI / 2, U);
  box(1.3, 0.9, 0.5, MAT.wood, 0, 0, 0, dr);
  for (let r = 0; r < 3; r++) for (const s of [-1, 1]) { box(0.58, 0.24, 0.02, MAT.darkWood, s * 0.31, 0.08 + r * 0.27, 0.25, dr); box(0.1, 0.03, 0.03, MAT.brass, s * 0.31, 0.2 + r * 0.27, 0.27, dr); }
  colFromObj(dr);
  frame(0.3, 0.24, TEX.photo, 20 - T / 2 - 0.4, F2 + 1.03, 6.6, -Math.PI / 2 - 0.2, U, MAT.brass);
  candle(19.55, F2 + 0.9, 7.3, U);
  cyl(0.12, 0.08, 0.04, MAT.ceramic, 19.6, F2 + 0.9, 7.0, U, 16);
  flowers(19.6, F2 + 0.9, 7.6, U, MAT.lilac, 1);
  leafy(19.5, F2, 9.4, U, 1.4);
  // armchair corner
  windsor(12.4, F2, 8.4, Math.PI * 0.8, U, MAT.mustard, MAT.knit);
  frame(0.4, 0.5, TEX.fern, 14 + T / 2 + 0.01, F2 + 2.0, 2.2, Math.PI / 2, U);
  frame(0.4, 0.5, TEX.flowerPrint, 14 + T / 2 + 0.01, F2 + 2.0, 3.0, Math.PI / 2, U);
}

// =====================================================================
//  Lights
// =====================================================================
scene.add(new THREE.HemisphereLight(0xffd9b0, 0x2a2030, 0.55));
const moon = new THREE.DirectionalLight(0x8aa0c8, 0.35);
moon.position.set(-10, 20, 15);
scene.add(moon);
const lamps = [];
function lamp(x, y, z, intensity, dist, color = 0xffb46a) {
  const l = new THREE.PointLight(color, intensity, dist, 1.6);
  l.position.set(x, y, z);
  scene.add(l);
  lamps.push({ l, base: intensity, seed: R() * 100 });
  return l;
}
lamp(4.85, 1.55, 0.7, 9, 9);        // living floor lamp
lamp(1.0, 2.2, 6.0, 6, 8);          // living sconce
lamp(8.45, 2.35, 2.2, 6, 8);        // hall pendant
lamp(15.0, 2.7, 4.2, 12, 11);       // kitchen
lamp(2.5, F2 + 1.3, 1.0, 7, 8);     // study desk lamp
lamp(17.9, F2 + 1.2, 0.7, 8, 9);    // bedroom lamp
lamp(12.6, F2 + 2.2, 2.4, 5, 6);    // bathroom
lamp(15.8, F2 + 2.4, 6.8, 5, 8);    // bedroom fill
lamp(25.6, 2.4, 8.2, 6, 9, 0xffa850); // garden lantern

// =====================================================================
//  Rain
// =====================================================================
const RAIN = 3500;
const rainPos = new Float32Array(RAIN * 6);
const rainSpeed = new Float32Array(RAIN);
function inHouse(x, z) { return x > -0.3 && x < 20.3 && z > -0.3 && z < 10.3; }
function seedDrop(i, top) {
  let x, z;
  do { x = rr(-14, 36); z = rr(-14, 24); } while (inHouse(x, z));
  const y = top ? 14 : rr(0, 14);
  rainPos.set([x, y, z, x - 0.02, y - 0.35, z], i * 6);
  rainSpeed[i] = rr(11, 15);
}
for (let i = 0; i < RAIN; i++) seedDrop(i, false);
const rainGeo = new THREE.BufferGeometry();
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xa8bcd0, transparent: true, opacity: 0.38 }));
rain.frustumCulled = false;
scene.add(rain);
function updateRain(dt) {
  for (let i = 0; i < RAIN; i++) {
    const o = i * 6, d = rainSpeed[i] * dt;
    rainPos[o + 1] -= d; rainPos[o + 4] -= d;
    rainPos[o] -= d * 0.03; rainPos[o + 3] -= d * 0.03;
    if (rainPos[o + 4] < 0) seedDrop(i, true);
  }
  rainGeo.attributes.position.needsUpdate = true;
}

// =====================================================================
//  Collectible stars
// =====================================================================
const starShape = new THREE.Shape();
for (let i = 0; i < 10; i++) {
  const a = (i / 10) * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.07 : 0.17;
  if (i === 0) starShape.moveTo(Math.cos(a) * r, Math.sin(a) * r); else starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
}
const starGeo = new THREE.ExtrudeGeometry(starShape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1 });
starGeo.center();
const starMat = std({ color: 0xffd060, emissive: 0xffa020, emissiveIntensity: 1.3, metalness: 0.6, roughness: 0.3 });
const stars = [];
function addStar(x, y, z, hint) {
  const m = new THREE.Mesh(starGeo, starMat);
  m.position.set(x, y, z);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.scale.set(0.9, 0.9, 1);
  m.add(glow);
  scene.add(m);
  stars.push({ m, base: y, got: false, hint, upper: y > F2 - 0.2 });
}
addStar(3.4, 0.95, 0.85, 'on the sofa');
addStar(8.45, 0.8, 1.2, 'behind the stairs');
addStar(15.5, 1.35, 4.6, 'on the kitchen island');
addStar(13.6, 1.15, 9.3, 'by the dining table');
addStar(24.6, 0.8, 6.0, 'in the rainy garden');
addStar(3.1, F2 + 0.8, 4.0, 'in the study');
addStar(16.6, F2 + 1.05, 1.5, 'on the bed');
addStar(12.6, F2 + 0.8, 3.0, 'in the bathroom');
addStar(8.45, F2 + 0.8, 9.55, 'at the top of the stairs');

// =====================================================================
//  The player character
// =====================================================================
const player = new THREE.Group();
player.userData.dynamic = true;
scene.add(player);

// The original cozy-sweater figure, kept as a third selectable character.
function buildClassic() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const sweater = new THREE.MeshPhysicalMaterial({ color: 0x8a2a3a, roughness: 0.9, sheen: 0.6, sheenColor: new THREE.Color(0xff9090) });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.32, 6, 14), sweater);
  torso.position.y = 0.92; torso.scale.set(1, 1, 0.8); body.add(torso);
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.055, 8, 18), MAT.mustard);
  scarf.rotation.x = Math.PI / 2; scarf.position.y = 1.18; body.add(scarf);
  const tail = box(0.1, 0.32, 0.04, MAT.mustard, 0.08, 0.86, 0.17, body); tail.rotation.z = 0.15;
  sph(0.19, MAT.skin, 0, 1.38, 0, body);
  sph(0.205, MAT.hair, 0, 1.43, -0.03, body, 1, 0.95, 1);
  sph(0.19, MAT.hair, 0, 1.36, -0.07, body, 1.02, 1, 0.9);
  sph(0.09, MAT.hair, 0, 1.6, -0.12, body); // bun
  for (const s of [-1, 1]) sph(0.025, MAT.black, s * 0.07, 1.39, 0.17, body, 1, 1.3, 0.6);
  for (const s of [-1, 1]) sph(0.03, std({ color: 0xe89a90 }), s * 0.11, 1.33, 0.15, body, 1, 0.7, 0.5);
  const J = { hips: body, torso: new THREE.Group() };
  const limb = (name, x, y, mat, len, r) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat);
    m.position.y = -len / 2 - r * 0.5;
    pivot.add(m);
    body.add(pivot);
    J[name] = pivot;
  };
  limb('legR', -0.09, 0.62, MAT.pants, 0.4, 0.075);
  limb('legL', 0.09, 0.62, MAT.pants, 0.4, 0.075);
  limb('armR', -0.26, 1.12, sweater, 0.36, 0.06);
  limb('armL', 0.26, 1.12, sweater, 0.36, 0.06);
  for (const s of ['legL', 'legR']) sph(0.08, MAT.darkWood, 0, -0.62, 0.05, J[s], 1, 0.6, 1.4); // boots
  for (const s of ['armL', 'armR']) sph(0.055, MAT.skin, 0, -0.5, 0, J[s]);
  return {
    def: { id: 'classic', name: 'Scarlet', height: 1.62, colors: { outfit: 0x8a2a3a }, blurb: 'The original house-wanderer, bundled up in a red sweater and mustard scarf.' },
    root, joints: J, height: 1.62, name: 'Scarlet', rest: 0.08, expr: 'smile', setExpression() {}, tickFace() {},
  };
}
const rigs = [...CHARACTERS.map(buildCharacter), buildClassic()];
// a small warm light that travels with the player so the figure reads in the dim rooms
{ const glow = new THREE.PointLight(0xffdcb8, 0.55, 3.5, 2); glow.position.set(0, 1.9, 0.6); player.add(glow); }
let rig = null;
// soft blob shadow
const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.32, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
shadow.rotation.x = -Math.PI / 2;
scene.add(shadow);

const P = { pos: new THREE.Vector3(3.0, 0, 6.8), vy: 0, onGround: true, r: 0.27, h: 1.62, yaw: Math.PI, speed: 0, walk: 0 };
function setCharacter(i) {
  if (rig) player.remove(rig.root);
  rig = rigs[i];
  rig.root.position.set(0, 0, 0); rig.root.rotation.set(0, 0, 0);
  player.add(rig.root);
  P.h = rig.height;
  try { localStorage.setItem('house-character', rig.def.id); } catch (e) { /* private mode */ }
}
const STEP = 0.36, G = 16, JUMP = 5.9, RUN = 4.3;

// =====================================================================
//  Merge static geometry by material (fewer draw calls)
// =====================================================================
function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const buckets = new Map();
  const victims = [];
  root.traverse((o) => {
    if (!o.isMesh || o.userData.fade || o.userData.dynamic || Array.isArray(o.material)) return;
    let p = o, skip = false;
    while (p) { if (p.userData.dynamic || p === player) { skip = true; break; } if (p === root) break; p = p.parent; }
    if (skip || o.parent === null) return;
    if (root === scene && isInside(o, upper)) return;
    if (o.material.transparent) return;
    const geo = o.geometry.index ? o.geometry.clone() : null;
    if (!geo) return;
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    if (!geo.attributes.uv || !geo.attributes.normal) return;
    geo.applyMatrix4(o.matrixWorld);
    if (!buckets.has(o.material)) buckets.set(o.material, []);
    buckets.get(o.material).push(geo);
    victims.push(o);
  });
  for (const v of victims) v.parent.remove(v);
  for (const [mat, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    if (merged) root.add(new THREE.Mesh(merged, mat));
  }
}
function isInside(o, ancestor) { let p = o.parent; while (p) { if (p === ancestor) return true; p = p.parent; } return false; }
// stars/cat/player are added to scene directly; protect them
for (const s of stars) s.m.userData.dynamic = true;
scene.traverse((o) => { if (o.userData.cat) o.userData.dynamic = true; });
pouf.userData.dynamic = false;
mergeStatic(upper);
mergeStatic(scene);

// =====================================================================
//  Physics / collision
// =====================================================================
function overlapsXZ(b, x, z, r) { return x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ; }
function blocksAt(b, y) { return b.maxY > y + STEP && b.minY < y + P.h; }
function moveAxis(dx, dz) {
  let x = P.pos.x + dx, z = P.pos.z + dz;
  for (const b of colliders) {
    if (!blocksAt(b, P.pos.y)) continue;
    if (!overlapsXZ(b, x, z, P.r)) continue;
    if (overlapsXZ(b, P.pos.x, P.pos.z, P.r)) continue; // already inside: let it go
    if (dx > 0) x = b.minX - P.r - 1e-4; else if (dx < 0) x = b.maxX + P.r + 1e-4;
    if (dz > 0) z = b.minZ - P.r - 1e-4; else if (dz < 0) z = b.maxZ + P.r + 1e-4;
  }
  P.pos.x = x; P.pos.z = z;
}
function groundAt(x, z, y) {
  let g = -Infinity;
  for (const b of colliders) if (b.maxY <= y + STEP + 1e-3 && b.maxY > g && overlapsXZ(b, x, z, P.r * 0.85)) g = b.maxY;
  return g;
}
function physics(dt, mx, mz, jump) {
  const sub = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / sub;
  for (let s = 0; s < sub; s++) {
    moveAxis(mx * h, 0);
    moveAxis(0, mz * h);
    if (jump && P.onGround) { P.vy = JUMP; P.onGround = false; jump = false; sfx('jump'); rig.setExpression('wow', 0.55); }
    const wasGround = P.onGround;
    P.vy -= G * h;
    let ny = P.pos.y + P.vy * h;
    if (P.vy > 0) {
      for (const b of colliders) {
        if (b.minY >= P.pos.y + P.h - 0.02 && ny + P.h > b.minY && overlapsXZ(b, P.pos.x, P.pos.z, P.r * 0.85)) { ny = b.minY - P.h; P.vy = 0; }
      }
    }
    const g = groundAt(P.pos.x, P.pos.z, P.pos.y);
    if (ny <= g) { ny = g; P.vy = 0; P.onGround = true; }
    else if (wasGround && P.vy <= 0 && P.pos.y - g < 0.4) { ny = g; P.vy = 0; P.onGround = true; }
    else P.onGround = false;
    P.pos.y = ny;
  }
}

// =====================================================================
//  Input
// =====================================================================
const keys = new Set();
let jumpQueued = false;
window.addEventListener('keydown', (e) => {
  if (show.active) { showKey(e); return; }
  keys.add(e.code);
  if (e.code === 'Space') { jumpQueued = true; e.preventDefault(); }
  if (e.code === 'KeyC' && started) openShowcase();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

const cam = { yaw: 0, pitch: 0.55, dist: 6.5, target: new THREE.Vector3(3, 1.3, 7) };
let dragging = false, lastX = 0, lastY = 0;
renderer.domElement.addEventListener('mousedown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
window.addEventListener('mouseup', () => { dragging = false; });
window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  if (show.active) { showDrag(e.clientX - lastX, e.clientY - lastY, e.shiftKey || (e.buttons & 2)); lastX = e.clientX; lastY = e.clientY; return; }
  cam.yaw -= (e.clientX - lastX) * 0.006;
  cam.pitch = THREE.MathUtils.clamp(cam.pitch + (e.clientY - lastY) * 0.005, 0.12, 1.35);
  lastX = e.clientX; lastY = e.clientY;
});
renderer.domElement.addEventListener('wheel', (e) => { if (show.active) { show.zoom = THREE.MathUtils.clamp(show.zoom * Math.exp(e.deltaY * 0.0012), 0.28, 1.6); e.preventDefault(); return; } cam.dist = THREE.MathUtils.clamp(cam.dist + e.deltaY * 0.005, 2.5, 12); e.preventDefault(); }, { passive: false });
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

// touch: left joystick + right-side camera drag
const joy = { id: null, x: 0, y: 0, cx: 0, cy: 0 };
const look = { id: null, x: 0, y: 0 };
const joyEl = document.getElementById('joy'), knob = document.getElementById('knob');
function setTouchMode() { document.body.classList.add('touch'); }
window.addEventListener('touchstart', (e) => {
  setTouchMode();
  if (show.active) { showTouch(e); return; }
  for (const t of e.changedTouches) {
    if (t.target.id === 'jump' || t.target.id === 'mute' || t.target.id === 'go') continue;
    if (t.clientX < window.innerWidth * 0.45 && joy.id === null) {
      joy.id = t.identifier;
      const r = joyEl.getBoundingClientRect();
      joy.cx = r.left + r.width / 2; joy.cy = r.top + r.height / 2;
      updateJoy(t);
    } else if (look.id === null) {
      look.id = t.identifier; look.x = t.clientX; look.y = t.clientY;
    }
  }
}, { passive: true });
function updateJoy(t) {
  let dx = t.clientX - joy.cx, dy = t.clientY - joy.cy;
  const len = Math.hypot(dx, dy), max = 55;
  if (len > max) { dx *= max / len; dy *= max / len; }
  joy.x = dx / max; joy.y = dy / max;
  knob.style.transform = `translate(${dx}px, ${dy}px)`;
}
window.addEventListener('touchmove', (e) => {
  if (show.active) { showTouch(e, true); if (e.target === renderer.domElement) e.preventDefault(); return; }
  for (const t of e.changedTouches) {
    if (t.identifier === joy.id) updateJoy(t);
    else if (t.identifier === look.id) {
      cam.yaw -= (t.clientX - look.x) * 0.008;
      cam.pitch = THREE.MathUtils.clamp(cam.pitch + (t.clientY - look.y) * 0.006, 0.12, 1.35);
      look.x = t.clientX; look.y = t.clientY;
    }
  }
  e.preventDefault();
}, { passive: false });
function endTouch(e) {
  show.touch = null;
  for (const t of e.changedTouches) {
    if (t.identifier === joy.id) { joy.id = null; joy.x = joy.y = 0; knob.style.transform = ''; }
    if (t.identifier === look.id) look.id = null;
  }
}
window.addEventListener('touchend', endTouch);
window.addEventListener('touchcancel', endTouch);
document.getElementById('jump').addEventListener('touchstart', (e) => { jumpQueued = true; e.preventDefault(); }, { passive: false });
document.getElementById('jump').addEventListener('click', () => { jumpQueued = true; });

// =====================================================================
//  Audio (procedural rain + chimes)
// =====================================================================
let actx = null, master = null, muted = false;
function startAudio() {
  if (actx) return;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    master = actx.createGain(); master.gain.value = 0.9; master.connect(actx.destination);
    const len = actx.sampleRate * 3;
    const buf = actx.createBuffer(2, len, actx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch); let last = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.06 * w) / 1.06; d[i] = w * 0.25 + last * 2.2; }
    }
    const src = actx.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    const hp = actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 180;
    const g = actx.createGain(); g.gain.value = 0.16;
    src.connect(hp).connect(lp).connect(g).connect(master);
    src.start();
  } catch (e) { actx = null; }
}
function sfx(kind) {
  if (!actx || muted) return;
  const t = actx.currentTime;
  const notes = kind === 'star' ? [880, 1175, 1568] : kind === 'win' ? [660, 880, 1046, 1318, 1760] : kind === 'meow' ? [700] : [];
  if (kind === 'jump') {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(260, t); o.frequency.exponentialRampToValueAtTime(420, t + 0.12);
    g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g).connect(master); o.start(t); o.stop(t + 0.16);
    return;
  }
  if (kind === 'meow') {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(520, t); o.frequency.linearRampToValueAtTime(780, t + 0.12); o.frequency.linearRampToValueAtTime(430, t + 0.45);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.07, t + 0.05); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(g).connect(master); o.start(t); o.stop(t + 0.52);
    return;
  }
  notes.forEach((f, i) => {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    const st = t + i * 0.09;
    g.gain.setValueAtTime(0.0001, st); g.gain.linearRampToValueAtTime(0.09, st + 0.02); g.gain.exponentialRampToValueAtTime(0.001, st + 0.9);
    o.connect(g).connect(master); o.start(st); o.stop(st + 1);
  });
}
const muteBtn = document.getElementById('mute');
muteBtn.addEventListener('click', () => {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.9;
  muteBtn.textContent = muted ? '🔈' : '🔊';
});

// =====================================================================
//  HUD
// =====================================================================
const starsEl = document.getElementById('stars');
const toastEl = document.getElementById('toast');
let toastTimer = 0;
function toast(msg, dur = 2.4) { toastEl.innerHTML = msg; toastEl.style.opacity = 1; toastTimer = dur; }
function updateStarHud() { const n = stars.filter((s) => s.got).length; starsEl.textContent = `★ ${n} / ${stars.length}`; return n; }
updateStarHud();

let started = false;
function beginGame() {
  document.getElementById('start').style.display = 'none';
  if (started) return;
  started = true;
  startAudio();
  toast('Find all the golden stars ✨', 3);
}
document.getElementById('go').addEventListener('click', beginGame);

// ---- character picker on the title card
const pickEl = document.getElementById('pick');
function refreshPicker() {
  pickEl.innerHTML = '';
  rigs.forEach((r, i) => {
    const b = document.createElement('button');
    b.innerHTML = `<i style="background:#${new THREE.Color(r.def.colors.outfit).getHexString()}"></i>${r.name}`;
    if (r === rig) b.className = 'on';
    b.addEventListener('click', () => { setCharacter(i); refreshPicker(); });
    pickEl.appendChild(b);
  });
}
{
  let saved = null;
  try { saved = localStorage.getItem('house-character'); } catch (e) { /* private mode */ }
  const want = new URLSearchParams(location.search).get('char') || saved;
  setCharacter(Math.max(0, rigs.findIndex((r) => r.def.id === want)));
  refreshPicker();
}

// =====================================================================
//  Character showcase: a parchment studio with a turntable
// =====================================================================
const show = {
  active: false, scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.05, 60),
  idx: 0, yaw: 0.35, yawT: 0.35, pitch: 0.06, zoom: 1, view: 'front', anim: 'idle', expr: 'smile', spin: false, lineup: false,
  panY: 0, phase: 0, speed: 0, focus: new THREE.Vector3(0, 0.8, 0), touch: null, markers: new THREE.Group(), blobs: [],
};
{
  const S = show.scene;
  S.background = new THREE.Color(0xf1d9b8);
  S.fog = new THREE.Fog(0xf1d9b8, 9, 22);
  S.add(new THREE.HemisphereLight(0xfff6e6, 0xdcb690, 1.4));
  const key = new THREE.DirectionalLight(0xfff1dc, 2.3); key.position.set(-2.2, 3.4, 4); S.add(key);
  const fill = new THREE.DirectionalLight(0xffe2c0, 0.7); fill.position.set(3.5, 1.5, 2.5); S.add(fill);
  const rim = new THREE.DirectionalLight(0xffd0a0, 1.3); rim.position.set(1.5, 2.6, -4); S.add(rim);
  const bounce = new THREE.DirectionalLight(0xffe6c8, 0.55); bounce.position.set(0, -1.5, 3); S.add(bounce);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 48), std({ color: 0xe9cda8, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; S.add(floor);
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.36, 0.04, 64), std({ color: 0xf6e4c8, roughness: 0.9 }));
  ped.position.y = 0.0; S.add(ped);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.012, 6, 96), std({ color: 0x8a5a34, roughness: 0.6 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.022; S.add(ring);
  show.stage = new THREE.Group(); show.stage.position.y = 0.02; S.add(show.stage);
  S.add(show.markers);
  for (let i = 0; i < rigs.length; i++) {
    const b = new THREE.Mesh(new THREE.CircleGeometry(0.27, 24), new THREE.MeshBasicMaterial({ color: 0x5a3018, transparent: true, opacity: 0.22, depthWrite: false }));
    b.rotation.x = -Math.PI / 2; b.position.y = 0.024; b.scale.setScalar(rigs[i].height / 1.6);
    show.stage.add(b); show.blobs.push(b);
  }
}
function labelSprite(text, color = '#3a2116') {
  const tex = canvasTex(256, 64, (g) => { g.clearRect(0, 0, 256, 64); g.font = '34px Georgia'; g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 34); });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  sp.scale.set(0.6, 0.15, 1);
  return sp;
}
const LINE_X = [-0.72, 0.05, 0.86];
function layoutShowcase() {
  const st = show.stage, cur = rigs[show.idx];
  show.markers.clear();
  rigs.forEach((r, i) => {
    const on = show.lineup || i === show.idx;
    if (on) st.add(r.root); else st.remove(r.root);
    const x = show.lineup ? LINE_X[i] : 0;
    r.root.position.set(x, 0, 0); r.root.rotation.set(0, 0, 0);
    show.blobs[i].visible = on; show.blobs[i].position.x = x;
    if (show.lineup) {
      // dashed crown line + height label behind each figure
      const y = r.height + 0.02;
      for (let k = -4; k <= 4; k++) {
        const d = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.006, 0.006), new THREE.MeshBasicMaterial({ color: r.def.colors.outfit }));
        d.position.set(x + k * 0.09, y, -0.45); show.markers.add(d);
      }
      const l1 = labelSprite(`${r.name} · ${r.height.toFixed(2)} m`); l1.position.set(x, y + 0.1, -0.45); show.markers.add(l1);
    }
  });
  document.getElementById('cname').textContent = cur.name;
  document.getElementById('cheight').textContent = `${cur.height.toFixed(2)} m`;
  document.getElementById('cblurb').textContent = cur.def.blurb;
  document.getElementById('swatch').style.background = '#' + new THREE.Color(cur.def.colors.outfit).getHexString();
  document.getElementById('playAs').textContent = `Play as ${cur.name}`;
  document.getElementById('exprRow').style.visibility = cur.def.id === 'classic' ? 'hidden' : 'visible';
  document.getElementById('lineup').classList.toggle('on', show.lineup);
  document.getElementById('spin').classList.toggle('on', show.spin);
  for (const [id, key] of [['views', 'view'], ['anims', 'anim'], ['exprs', 'expr']]) for (const b of document.getElementById(id).children) b.classList.toggle('on', b.dataset.k === show[key]);
  for (const r of rigs) r.setExpression(show.expr);
}
const VIEWS = { front: ['Front', 0], side: ['Side', -Math.PI / 2], back: ['Back', Math.PI], face: ['Face', 0.3] };
const ANIMS = { idle: 'Idle', walk: 'Walk', run: 'Run', wave: 'Wave', still: 'Reference pose' };
function showSet(key, val) {
  show[key] = val;
  if (key === 'view') {
    // turn the shortest way round to the requested side
    const target = VIEWS[val][1];
    show.yawT = show.yaw + Math.atan2(Math.sin(target - show.yaw), Math.cos(target - show.yaw));
    show.pitch = val === 'face' ? 0.02 : 0.06; show.zoom = val === 'face' ? 0.3 : 1; show.spin = false; show.panY = 0;
  }
  layoutShowcase();
}
function fillButtons(id, key, entries) {
  const el = document.getElementById(id);
  for (const [k, label] of entries) {
    const b = document.createElement('button'); b.textContent = label; b.dataset.k = k; b.style.marginRight = '6px';
    b.addEventListener('click', () => showSet(key, k));
    el.appendChild(b);
  }
}
fillButtons('views', 'view', Object.entries(VIEWS).map(([k, v]) => [k, v[0]]));
fillButtons('anims', 'anim', Object.entries(ANIMS));
fillButtons('exprs', 'expr', Object.entries(EXPRESSIONS).filter(([, v]) => v.label).map(([k, v]) => [k, v.label]));
function showStep(d) { show.idx = (show.idx + d + rigs.length) % rigs.length; layoutShowcase(); }
function openShowcase() {
  if (show.active) return;
  show.active = true; show.idx = rigs.indexOf(rig); show.expr = 'smile';
  keys.clear(); joy.id = null; joy.x = joy.y = 0;
  player.remove(rig.root);
  document.body.classList.add('show');
  document.getElementById('start').style.display = 'none';
  layoutShowcase();
}
function closeShowcase(play) {
  if (!show.active) return;
  show.active = false;
  for (const r of rigs) { show.stage.remove(r.root); r.setExpression('smile'); }
  setCharacter(play ? show.idx : rigs.indexOf(rig));
  refreshPicker();
  document.body.classList.remove('show');
  if (play) beginGame(); else if (!started) document.getElementById('start').style.display = 'flex';
}
function showDrag(dx, dy, pan) {
  if (pan) { show.panY = THREE.MathUtils.clamp(show.panY + dy * 0.0025 * show.zoom, -1, 1); return; }
  show.yawT -= dx * 0.008; show.yaw = show.yawT;
  show.pitch = THREE.MathUtils.clamp(show.pitch + dy * 0.005, -0.25, 1.1);
  show.view = ''; for (const b of document.getElementById('views').children) b.classList.remove('on');
}
function showTouch(e, move) {
  if (e.target !== renderer.domElement) return;
  const ts = e.touches;
  if (ts.length === 1) {
    const t = ts[0];
    if (move && show.touch && show.touch.n === 1) showDrag(t.clientX - show.touch.x, t.clientY - show.touch.y);
    show.touch = { n: 1, x: t.clientX, y: t.clientY };
  } else if (ts.length >= 2) {
    const d = Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);
    const my = (ts[0].clientY + ts[1].clientY) / 2;
    if (move && show.touch && show.touch.n === 2) { show.zoom = THREE.MathUtils.clamp(show.zoom * show.touch.d / d, 0.28, 1.6); showDrag(0, my - show.touch.y, true); }
    show.touch = { n: 2, d, y: my };
  }
}
function showKey(e) {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') showStep(-1);
  else if (e.code === 'ArrowRight' || e.code === 'KeyD') showStep(1);
  else if (e.code === 'Escape' || e.code === 'KeyC') closeShowcase(false);
  else if (e.code === 'Enter') closeShowcase(true);
}
document.getElementById('prev').addEventListener('click', () => showStep(-1));
document.getElementById('next').addEventListener('click', () => showStep(1));
document.getElementById('spin').addEventListener('click', () => { show.spin = !show.spin; layoutShowcase(); });
document.getElementById('lineup').addEventListener('click', () => { show.lineup = !show.lineup; layoutShowcase(); });
document.getElementById('showBack').addEventListener('click', () => closeShowcase(false));
document.getElementById('playAs').addEventListener('click', () => closeShowcase(true));
document.getElementById('openShow').addEventListener('click', openShowcase);
document.getElementById('chars').addEventListener('click', openShowcase);

function tickShowcase(dt) {
  const cur = rigs[show.idx];
  const target = { idle: 0, walk: 1.5, run: 4.3, wave: 0, still: 0 }[show.anim];
  show.speed = THREE.MathUtils.lerp(show.speed, target, Math.min(1, dt * 6));
  show.phase += dt * show.speed * 2.6;
  for (const r of rigs) {
    if (!r.root.parent) continue;
    animateRig(r, { t: elapsed + r.height * 7, speed: show.speed, phase: show.phase + (r === cur ? 0 : r.height * 3), air: false, action: show.anim });
    if (show.expr === 'smile') r.tickFace(dt);
  }
  if (show.spin) { show.yawT += dt * 0.7; }
  show.yaw = THREE.MathUtils.lerp(show.yaw, show.yawT, Math.min(1, dt * 7));
  // frame the figure (or the whole line-up), keeping clear of the info panel
  const c = show.cam, aspect = window.innerWidth / window.innerHeight;
  const panelH = document.getElementById('panel').offsetHeight + 20;
  const h = show.lineup ? 1.95 : cur.height + 0.1, w = show.lineup ? 2.9 : cur.height * 0.62;
  const freeFrac = Math.max(0.35, 1 - (panelH + 44) / window.innerHeight);
  const tanV = Math.tan(c.fov * Math.PI / 360);
  const dist = Math.max(h / (2 * tanV * freeFrac), w / (2 * tanV * aspect)) * 1.04 * show.zoom;
  const face = show.zoom < 0.75 ? THREE.MathUtils.smoothstep(0.75 - show.zoom, 0, 0.45) : 0;
  const fy = THREE.MathUtils.lerp(h * 0.5, cur.height * 0.89, show.lineup ? 0 : face);
  show.focus.lerp(tmpV.set(show.lineup ? 0.06 : 0, fy + show.panY, 0), Math.min(1, dt * 7));
  const cp = Math.cos(show.pitch);
  c.position.set(show.focus.x + Math.sin(show.yaw) * cp * dist, show.focus.y + Math.sin(show.pitch) * dist, show.focus.z + Math.cos(show.yaw) * cp * dist);
  c.lookAt(show.focus);
  // shift the view up so the figure sits in the free area above the panel
  const off = (panelH - 44) / 2;
  c.setViewOffset(window.innerWidth, window.innerHeight, 0, off, window.innerWidth, window.innerHeight);
  c.aspect = aspect; c.updateProjectionMatrix();
  renderer.render(show.scene, c);
}
if (location.hash === '#showcase') openShowcase();

// =====================================================================
//  Main loop
// =====================================================================
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const tmpV = new THREE.Vector3();
const fwd = new THREE.Vector3(), right = new THREE.Vector3();
let catCooldown = 0, won = false, elapsed = 0;

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  if (show.active) { tickShowcase(dt); requestAnimationFrame(tick); return; }

  // ---- input -> movement
  let ix = 0, iz = 0;
  if (started) {
    if (keys.has('KeyW') || keys.has('ArrowUp')) iz += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) iz -= 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
    if (keys.has('KeyQ')) cam.yaw += dt * 1.8;
    if (keys.has('KeyE')) cam.yaw -= dt * 1.8;
    ix += joy.x; iz -= joy.y;
  }
  let mag = Math.hypot(ix, iz);
  if (mag > 1) { ix /= mag; iz /= mag; mag = 1; }
  fwd.set(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
  right.set(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
  const speed = RUN * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 0.5 : 1);
  const mx = (fwd.x * iz + right.x * ix) * speed * mag;
  const mz = (fwd.z * iz + right.z * ix) * speed * mag;
  physics(dt, mag > 0.05 ? mx / Math.max(mag, 1e-6) * mag : 0, mag > 0.05 ? mz / Math.max(mag, 1e-6) * mag : 0, jumpQueued && started);
  jumpQueued = false;
  if (P.pos.y < -5) P.pos.set(3, 0, 6.8);

  // ---- character pose
  if (mag > 0.05) {
    const targetYaw = Math.atan2(mx, mz);
    let d = targetYaw - P.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    P.yaw += d * Math.min(1, dt * 12);
  }
  P.speed = THREE.MathUtils.lerp(P.speed, mag * speed, Math.min(1, dt * 10));
  P.walk += dt * P.speed * 2.6;
  animateRig(rig, { t: elapsed, speed: P.speed, phase: P.walk, air: !P.onGround });
  rig.tickFace(dt);
  player.position.copy(P.pos);
  player.rotation.y = P.yaw;
  const gy = groundAt(P.pos.x, P.pos.z, P.pos.y);
  shadow.position.set(P.pos.x, Math.max(gy, -0.05) + 0.02, P.pos.z);
  const hgt = P.pos.y - gy;
  shadow.material.opacity = 0.35 * Math.max(0, 1 - hgt / 2.5);

  // ---- upper floor visibility (dollhouse)
  const showUpper = P.pos.y > 1.7;
  upper.visible = showUpper;
  for (const s of stars) if (!s.got) s.m.visible = s.upper ? showUpper : true;

  // ---- camera
  const tgt = tmpV.set(P.pos.x, P.pos.y + rig.height * 0.78, P.pos.z);
  cam.target.lerp(tgt, Math.min(1, dt * 8));
  const cp = Math.cos(cam.pitch);
  camera.position.set(
    cam.target.x + Math.sin(cam.yaw) * cp * cam.dist,
    cam.target.y + Math.sin(cam.pitch) * cam.dist,
    cam.target.z + Math.cos(cam.yaw) * cp * cam.dist,
  );
  camera.lookAt(cam.target);

  // ---- fade walls between camera and player
  const dir = tmpV.copy(cam.target).sub(camera.position);
  const dist = dir.length();
  dir.normalize();
  raycaster.set(camera.position, dir);
  raycaster.far = dist - 0.2;
  const vis = fadeables.filter((m) => m.parent.visible || m.parent === scene);
  const hit = new Set(raycaster.intersectObjects(vis, false).map((h) => h.object));
  // second ray toward the character's knees so low walls don't hide the body
  const knee = new THREE.Vector3(P.pos.x, P.pos.y + 0.4, P.pos.z).sub(camera.position);
  raycaster.far = knee.length() - 0.2;
  raycaster.set(camera.position, knee.normalize());
  for (const h of raycaster.intersectObjects(vis, false)) hit.add(h.object);
  // also fade walls the camera itself is inside / very near
  for (const m of fadeables) {
    const target = hit.has(m) ? 0.13 : 1;
    const op = THREE.MathUtils.lerp(m.userData.op, target, Math.min(1, dt * 9));
    if (Math.abs(op - m.userData.op) < 1e-4 && op === target) continue;
    m.userData.op = op;
    for (const mt of m.userData.mats) {
      mt.opacity = op;
      const tr = op < 0.99;
      if (mt.transparent !== tr) { mt.transparent = tr; mt.needsUpdate = true; }
      mt.depthWrite = op > 0.5;
    }
  }

  // ---- stars
  const pc = tmpV.set(P.pos.x, P.pos.y + 0.8, P.pos.z);
  for (const s of stars) {
    if (s.got) continue;
    s.m.rotation.y += dt * 2;
    s.m.position.y = s.base + Math.sin(elapsed * 2 + s.base * 3) * 0.06;
    if (s.m.visible && s.m.position.distanceTo(pc) < 0.85) {
      s.got = true;
      s.m.visible = false;
      const n = updateStarHud();
      if (n === stars.length && !won) {
        won = true;
        sfx('win');
        toast('✨ All stars found! ✨<br><span style="font-size:15px">Time for tea and a book while the rain falls.</span>', 6);
      } else {
        sfx('star');
        rig.setExpression('laugh', 1.6);
        toast(`★ Found a star ${s.hint}!`, 2);
      }
    }
  }

  // ---- cat
  catCooldown -= dt;
  if (catCooldown < 0 && P.pos.distanceTo(catPos) < 1.1) {
    catCooldown = 8;
    sfx('meow');
    toast('The cat purrs sleepily 🐈', 2);
  }

  // ---- ambience: flickering candles, lamps, spinning things
  for (const f of flickers) {
    const k = 0.85 + Math.sin(elapsed * 13 + f.seed) * 0.08 + Math.sin(elapsed * 23.7 + f.seed * 2) * 0.06;
    f.flame.scale.y = 0.018 * 1.8 * k;
    f.glow.material.opacity = 0.65 * k;
  }
  for (const L of lamps) L.l.intensity = L.base * (0.96 + Math.sin(elapsed * 9 + L.seed) * 0.02 + Math.sin(elapsed * 17 + L.seed) * 0.02);
  for (const s of spinners) {
    if (s.kind === 'spin') s.obj.rotation.y += dt * 0.4;
    if (s.kind === 'cat') s.obj.scale.y = 1 + Math.sin(elapsed * 2.2) * 0.04;
  }

  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) toastEl.style.opacity = 0; }

  updateRain(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// expose a tiny debug handle (handy for tests)
window.__game = { P, cam, stars, colliders, renderer, show, rigs, showSet, openShowcase, closeShowcase, setCharacter, start: () => document.getElementById('go').click() };
tick();
