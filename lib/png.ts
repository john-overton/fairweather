/**
 * Minimal PNG codec on Node's zlib (no dependencies).
 * decodeGray: 8- or 16-bit grayscale, non-interlaced (what MRMS GRIB2 template 5.41 embeds).
 * encodeRGBA: 8-bit RGBA, used for rendered radar tiles.
 */
import zlib from 'node:zlib';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface GrayImage { width: number; height: number; data: Uint8Array | Uint16Array }

export function decodeGray(png: Buffer): GrayImage {
  if (!png.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  const idat: Buffer[] = [];
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
  if (depth === 8) return { width, height, data: new Uint8Array(out.buffer, out.byteOffset, out.length) };
  const data = new Uint16Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = (out[2 * i] << 8) | out[2 * i + 1];
  return { width, height, data };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

export function encodeRGBA(width: number, height: number, rgba: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}
