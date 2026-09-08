/**
 * LEGACY. Ya no se usa: los íconos de la app salen de una imagen real, con
 * `./scripts/icons.sh` (desde la raíz del repo). Este archivo queda como
 * referencia del logo vectorial original (también guardado en git como
 * `app/icon.svg`), que dibujaba las cuatro formas a mano.
 *
 * Si lo corrés, pisa `desktop/build/icon.*` y los PNG de `public/` con el
 * dibujo viejo. Correlo solo si querés volver a ese logo.
 *
 * Rasteriza sin ninguna librería: las cuatro formas del logo (cuadrado
 * redondeado, borde, anillo abierto y agujas) con distancias con signo, y
 * escribe el PNG a mano (zlib viene en Node).
 */

import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(HERE, "..");
const REPO = path.resolve(DESKTOP, "..");

// ------------------------------------------------------------------ paleta
const GRAD_A = [0x8b, 0x5c, 0xf6]; // violeta
const GRAD_B = [0x22, 0xd3, 0xee]; // cian
const INK = [0xf2, 0xf4, 0xfb];
const DARK = [0x0b, 0x0d, 0x14];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mix = (A, B, t) => [0, 1, 2].map((i) => A[i] + (B[i] - A[i]) * t);
/** El gradiente del SVG va de la esquina superior izquierda a la inferior derecha. */
const grad = (x, y) => mix(GRAD_A, GRAD_B, clamp((x + y) / 128, 0, 1));

// ------------------------------------------------------- distancias con signo
//  Todas trabajan en el espacio 64x64 del SVG. Negativo = adentro.

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - r;
}

function sdSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const t = clamp((wx * vx + wy * vy) / (vx * vx + vy * vy), 0, 1);
  return Math.hypot(wx - vx * t, wy - vy * t);
}

/** Arco con puntas redondeadas: fuera del rango angular vale la punta más cercana. */
function sdArc(px, py, cx, cy, r, degStart, degSweep) {
  const dx = px - cx;
  const dy = py - cy;
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  const rel = ((ang - degStart) % 360 + 360) % 360;
  if (rel <= degSweep) return Math.abs(Math.hypot(dx, dy) - r);

  const end = (a) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
  const [x0, y0] = end(degStart);
  const [x1, y1] = end(degStart + degSweep);
  return Math.min(Math.hypot(px - x0, py - y0), Math.hypot(px - x1, py - y1));
}

// El anillo del SVG: circunferencia 2·π·17, dasharray "80 27", rotado -58°.
const RING_R = 17;
const RING_SWEEP = (360 * 80) / (2 * Math.PI * RING_R);
const RING_START = -58;

// -------------------------------------------------------------- rasterizado

/** Pinta `color` con opacidad `a` sobre el acumulador (alpha "over", no premultiplicado). */
function over(dst, color, a) {
  if (a <= 0) return;
  const na = a + dst[3] * (1 - a);
  if (na <= 0) return;
  for (let i = 0; i < 3; i++) {
    dst[i] = (color[i] * a + dst[i] * dst[3] * (1 - a)) / na;
  }
  dst[3] = na;
}

function render(size) {
  const scale = size / 64;
  const px = 1 / scale; // un píxel del destino, medido en unidades del SVG
  const SS = 2; // 2x2 muestras por píxel, además del antialias por distancia
  const out = Buffer.alloc(size * size * 4);

  // distancia -> cobertura
  const cov = (d) => clamp(0.5 - d / px, 0, 1);

  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      const acc = [0, 0, 0, 0];

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (pxi + (sx + 0.5) / SS) / scale;
          const y = (py + (sy + 0.5) / SS) / scale;
          const c = [0, 0, 0, 0];

          // 1. fondo: cuadrado redondeado
          over(c, DARK, cov(sdRoundRect(x, y, 32, 32, 32, 32, 15)));

          // 2. borde con gradiente al 45 %
          const borde = Math.abs(sdRoundRect(x, y, 32, 32, 30.5, 30.5, 13.5)) - 1.5;
          over(c, grad(x, y), cov(borde) * 0.45);

          // 3. anillo abierto arriba
          const anillo = sdArc(x, y, 32, 33, RING_R, RING_START, RING_SWEEP) - 2.75;
          over(c, grad(x, y), cov(anillo));

          // 4. agujas
          over(c, INK, cov(sdSegment(x, y, 32, 33, 32, 22.5) - 2.25));
          over(c, INK, cov(sdSegment(x, y, 32, 33, 39.5, 33) - 2.25));

          // 5. eje
          over(c, DARK, cov(Math.hypot(x - 32, y - 33) - 2.6));

          for (let i = 0; i < 4; i++) acc[i] += c[i] / (SS * SS);
        }
      }

      const o = (py * size + pxi) * 4;
      out[o] = Math.round(clamp(acc[0], 0, 255));
      out[o + 1] = Math.round(clamp(acc[1], 0, 255));
      out[o + 2] = Math.round(clamp(acc[2], 0, 255));
      out[o + 3] = Math.round(clamp(acc[3] * 255, 0, 255));
    }
  }
  return out;
}

// --------------------------------------------------------------- PNG a mano

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  // 10..12 quedan en 0: deflate, filtro adaptativo, sin entrelazado

  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filtro None
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** ICO con varias resoluciones; cada entrada es un PNG embebido (Vista+). */
function encodeIco(pngs) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2); // 1 = icono
  head.writeUInt16LE(pngs.length, 4);

  let offset = 6 + 16 * pngs.length;
  const dir = [];
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; // 0 significa 256
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); // planos
    e.writeUInt16LE(32, 6); // bits por píxel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    dir.push(e);
    offset += data.length;
  }

  return Buffer.concat([head, ...dir, ...pngs.map((p) => p.data)]);
}

// ------------------------------------------------------------------ salida

const cache = new Map();
const png = (size) => {
  if (!cache.has(size)) cache.set(size, encodePng(render(size), size));
  return cache.get(size);
};

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  console.log(`  ${path.relative(REPO, file).replace(/\\/g, "/")}  (${(data.length / 1024).toFixed(1)} kB)`);
}

console.log("Generando iconos…");
write(
  path.join(DESKTOP, "build", "icon.ico"),
  encodeIco([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, data: png(size) })))
);
write(path.join(DESKTOP, "build", "icon.png"), png(512));
write(path.join(REPO, "public", "icon-192.png"), png(192));
write(path.join(REPO, "public", "icon-512.png"), png(512));
write(path.join(REPO, "public", "apple-touch-icon.png"), png(180));
console.log("Listo.");
