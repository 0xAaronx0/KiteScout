// Minimal GRIB1 decoder for what the Copernicus CDS ships for ERA5 single-level fields:
// regular lat/lon grids (data representation type 0) with simple packing, with or without a
// bitmap. Enough to read the ERA5 monthly means of 10 m u/v/speed without eccodes. Anything
// else throws, so a format change upstream fails the job loudly instead of producing garbage.
// Spec: WMO FM 92 GRIB edition 1, https://codes.ecmwf.int/grib/format/grib1/

export interface Grib1Field {
  table2Version: number;
  centre: number;
  /** indicatorOfParameter (ECMWF table 128: 165 = 10u, 166 = 10v, 207 = 10si) */
  param: number;
  levelType: number;
  level: number;
  /** reference date/time of the field, UTC */
  date: Date;
  timeRangeIndicator: number;
  grid: {
    nx: number;
    ny: number;
    /** degrees */
    la1: number; lo1: number; la2: number; lo2: number; dx: number; dy: number;
    scanMode: number;
  };
  /** length nx*ny in scan order; NaN = missing */
  values: Float64Array;
}

// GRIB1 signed integers are sign-and-magnitude, not two's complement.
function int(buf: Uint8Array, off: number, len: number): number {
  let v = buf[off] & 0x7f;
  for (let i = 1; i < len; i++) v = v * 256 + buf[off + i];
  return buf[off] & 0x80 ? -v : v;
}
function uint(buf: Uint8Array, off: number, len: number): number {
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 256 + buf[off + i];
  return v;
}
/** IBM System/360 single precision float (GRIB1 reference value). */
export function ibmFloat(buf: Uint8Array, off: number): number {
  const sign = buf[off] & 0x80 ? -1 : 1;
  const exponent = (buf[off] & 0x7f) - 64;
  const mantissa = uint(buf, off + 1, 3);
  return sign * mantissa * 2 ** (4 * exponent - 24);
}

function readBits(buf: Uint8Array, bitOffset: number, bits: number): number {
  let v = 0;
  for (let i = 0; i < bits; i++) {
    const b = bitOffset + i;
    v = v * 2 + ((buf[b >> 3] >> (7 - (b & 7))) & 1);
  }
  return v;
}

function decodeMessage(m: Uint8Array): Grib1Field {
  if (m[7] !== 1) throw new Error(`GRIB1: edition ${m[7]} is not 1`);
  // Section 1 (product definition)
  const p = 8, pLen = uint(m, p, 3);
  const flag = m[p + 7];
  const hasGds = (flag & 0x80) !== 0, hasBms = (flag & 0x40) !== 0;
  if (!hasGds) throw new Error('GRIB1: predefined grids without a grid section are not supported');
  const yearOfCentury = m[p + 12], century = m[p + 24];
  const year = (century - 1) * 100 + yearOfCentury;
  const date = new Date(Date.UTC(year, m[p + 13] - 1, m[p + 14], m[p + 15], m[p + 16]));
  const D = int(m, p + 26, 2);

  // Section 2 (grid description)
  const g = p + pLen, gLen = uint(m, g, 3);
  const nv = m[g + 3], pvpl = m[g + 4];
  if (m[g + 5] !== 0) throw new Error(`GRIB1: data representation type ${m[g + 5]} (only regular lat/lon 0)`);
  if (nv !== 0 && pvpl !== 255) throw new Error('GRIB1: reduced/quasi-regular grids are not supported');
  const nx = uint(m, g + 6, 2), ny = uint(m, g + 8, 2);
  const la1 = int(m, g + 10, 3) / 1000, lo1 = int(m, g + 13, 3) / 1000;
  const resFlags = m[g + 16];
  const la2 = int(m, g + 17, 3) / 1000, lo2 = int(m, g + 20, 3) / 1000;
  const scanMode = m[g + 27];
  if (scanMode !== 0 && scanMode !== 64) throw new Error(`GRIB1: scan mode ${scanMode} (only 0 or 64)`);
  const span = (a: number, b: number) => ((b - a) % 360 + 360) % 360;
  const increments = (resFlags & 0x80) !== 0;
  const dx = increments ? uint(m, g + 23, 2) / 1000 : span(lo1, lo2) / (nx - 1);
  const dy = increments ? uint(m, g + 25, 2) / 1000 : Math.abs(la2 - la1) / (ny - 1);

  // Section 3 (bitmap, optional)
  let off = g + gLen;
  let bitmap: Uint8Array | null = null;
  if (hasBms) {
    const bLen = uint(m, off, 3);
    if (uint(m, off + 4, 2) !== 0) throw new Error('GRIB1: predefined bitmaps are not supported');
    bitmap = m.subarray(off + 6, off + bLen);
    off += bLen;
  }

  // Section 4 (binary data)
  const bLen = uint(m, off, 3);
  const bFlag = m[off + 3] >> 4;
  if (bFlag & 0x8) throw new Error('GRIB1: spherical harmonics are not supported');
  if (bFlag & 0x4) throw new Error('GRIB1: complex/second-order packing is not supported');
  if (bFlag & 0x1) throw new Error('GRIB1: additional flags are not supported');
  const E = int(m, off + 4, 2), R = ibmFloat(m, off + 6), bits = m[off + 10];
  const data = m.subarray(off + 11, off + bLen);
  const n = nx * ny;
  const values = new Float64Array(n);
  const scale = 2 ** E, dec = 10 ** -D;
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (bitmap && !((bitmap[i >> 3] >> (7 - (i & 7))) & 1)) { values[i] = NaN; continue; }
    // Constant field: eccodes (which writes the CDS files) stores R unscaled and ignores D.
    values[i] = bits === 0 ? R : (R + readBits(data, k * bits, bits) * scale) * dec;
    k++;
  }
  if (bits > 0 && k * bits > data.length * 8) throw new Error('GRIB1: data section shorter than the grid');

  return {
    table2Version: m[p + 3], centre: m[p + 4], param: m[p + 8], levelType: m[p + 9], level: uint(m, p + 10, 2),
    date, timeRangeIndicator: m[p + 20],
    grid: { nx, ny, la1, lo1, la2, lo2, dx, dy, scanMode },
    values,
  };
}

/** Decodes every GRIB1 message in a file (messages may be concatenated). */
export function decodeGrib1(file: Uint8Array): Grib1Field[] {
  const out: Grib1Field[] = [];
  let pos = 0;
  while (pos + 8 <= file.length) {
    if (!(file[pos] === 0x47 && file[pos + 1] === 0x52 && file[pos + 2] === 0x49 && file[pos + 3] === 0x42)) { pos++; continue; }
    const len = uint(file, pos + 4, 3);
    if (file[pos + 7] !== 1) throw new Error(`GRIB1: edition ${file[pos + 7]} at byte ${pos} (expected 1)`);
    const end = pos + len;
    if (end > file.length || String.fromCharCode(...file.subarray(end - 4, end)) !== '7777') {
      throw new Error(`GRIB1: truncated message at byte ${pos}`);
    }
    out.push(decodeMessage(file.subarray(pos, end)));
    pos = end;
  }
  return out;
}
