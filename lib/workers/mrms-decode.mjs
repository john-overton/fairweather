/**
 * Worker thread for lib/mrms.ts: download, gunzip, and decode one MRMS frame (PrecipFlag + reflectivity)
 * into a combined grid, off the main thread. Plain JS so it runs without the Next.js bundler.
 *
 * In:  { id, flagUrl, refUrl }
 * Out: { id, grid: { nx, ny, la1, lo1, di, dj, cells } }  (cells.buffer is transferred)  or  { id, error }
 *
 * Each cell byte is (type << 4) | dBZ bin, where type is 1 rain, 2 snow, 3 rain with hail, and the bin is
 * floor(dBZ / 5) clamped to 1..14 (0 = nothing to draw).
 */
import { parentPort } from 'node:worker_threads';
import zlib from 'node:zlib';

const RAIN = 1, SNOW = 2, MIX = 3;
/** PrecipFlag codes: 1 warm stratiform, 3 snow, 6 convective, 7 rain with hail, 10 cold stratiform, 91/96 tropical */
const FLAG_TYPE = { 1: RAIN, 3: SNOW, 6: RAIN, 7: MIX, 10: RAIN, 91: RAIN, 96: RAIN };

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 8- or 16-bit grayscale, non-interlaced PNG (what GRIB2 template 5.41 embeds) */
function decodeGray(png) {
  if (!png.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  const idat = [];
  for (let i = 8; i < png.length;) {
    const len = png.readUInt32BE(i);
    const type = png.toString('ascii', i + 4, i + 8);
    const body = png.subarray(i + 8, i + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      depth = body[8]; colorType = body[9]; interlace = body[12];
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    i += 12 + len;
  }
  if (colorType !== 0 || (depth !== 8 && depth !== 16) || interlace) {
    throw new Error(`unsupported PNG (color ${colorType}, depth ${depth}, interlace ${interlace})`);
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = depth / 8, stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
    prev = cur;
  }
  if (depth === 8) return { width, height, data: out };
  const data = new Uint16Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = (out[2 * i] << 8) | out[2 * i + 1];
  return { width, height, data };
}

/** Single-field GRIB2 on a regular lat/lon grid (template 3.0) with PNG packing (template 5.41) */
function parseGrib(buf) {
  if (buf.toString('ascii', 0, 4) !== 'GRIB' || buf[7] !== 2) throw new Error('not GRIB2');
  let nx = 0, ny = 0, la1 = 0, lo1 = 0, di = 0, dj = 0, R = 0, E = 0, D = 0, tpl = -1, png = null;
  for (let i = 16; i < buf.length - 4;) {
    if (buf.toString('ascii', i, i + 4) === '7777') break;
    const len = buf.readUInt32BE(i);
    const sec = buf[i + 4];
    if (sec === 3) {
      if (buf.readUInt16BE(i + 12) !== 0) throw new Error('unsupported grid template');
      nx = buf.readUInt32BE(i + 30); ny = buf.readUInt32BE(i + 34);
      la1 = buf.readInt32BE(i + 46) / 1e6; lo1 = buf.readUInt32BE(i + 50) / 1e6;
      di = buf.readUInt32BE(i + 63) / 1e6; dj = buf.readUInt32BE(i + 67) / 1e6;
      if (buf[i + 71] !== 0) throw new Error('unsupported scan mode');
    } else if (sec === 5) {
      tpl = buf.readUInt16BE(i + 9);
      R = buf.readFloatBE(i + 11); E = buf.readInt16BE(i + 15); D = buf.readInt16BE(i + 17);
    } else if (sec === 7) {
      png = buf.subarray(i + 5, i + len);
    }
    i += len;
  }
  if (tpl !== 41 || !png) throw new Error(`unsupported data template ${tpl}`);
  const img = decodeGray(png);
  if (img.width !== nx || img.height !== ny) throw new Error('grid/image size mismatch');
  return { nx, ny, la1, lo1: lo1 > 180 ? lo1 - 360 : lo1, di, dj, R, scaleE: 2 ** E, scaleD: 10 ** D, data: img.data };
}

async function fetchField(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`MRMS ${res.status} ${url}`);
  return parseGrib(zlib.gunzipSync(Buffer.from(await res.arrayBuffer())));
}

async function decodeFrame(flagUrl, refUrl) {
  const [flag, ref] = await Promise.all([fetchField(flagUrl), fetchField(refUrl)]);
  if (flag.nx !== ref.nx || flag.ny !== ref.ny) throw new Error('grids differ');
  const cells = new Uint8Array(flag.nx * flag.ny);
  for (let k = 0; k < cells.length; k++) {
    const type = FLAG_TYPE[Math.round((flag.R + flag.data[k] * flag.scaleE) / flag.scaleD)];
    if (!type) continue;
    const dbz = (ref.R + ref.data[k] * ref.scaleE) / ref.scaleD;
    if (!(dbz >= 5)) continue;
    cells[k] = (type << 4) | Math.min(14, Math.floor(dbz / 5));
  }
  return { nx: flag.nx, ny: flag.ny, la1: flag.la1, lo1: flag.lo1, di: flag.di, dj: flag.dj, cells };
}

// One frame at a time keeps peak memory to a single decode (~150 MB for CONUS)
let queue = Promise.resolve();
parentPort.on('message', ({ id, flagUrl, refUrl }) => {
  queue = queue.then(async () => {
    try {
      const grid = await decodeFrame(flagUrl, refUrl);
      parentPort.postMessage({ id, grid }, [grid.cells.buffer]);
    } catch (e) {
      parentPort.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
    }
  });
});
