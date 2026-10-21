// Minimal GRIB2 decoder for what NOAA GFS ships: regular lat/lon grids (template 3.0),
// analysis/forecast products at a fixed surface (4.0) and simple or complex packing with
// optional spatial differencing (5.0 / 5.2 / 5.3), with or without a bitmap. Enough to read
// UGRD/VGRD 10 m without Java (grib2json) or native eccodes. Anything else throws, so a
// format change upstream fails the job loudly instead of producing garbage.
// Spec: WMO FM 92 GRIB2, https://www.nco.ncep.noaa.gov/pmb/docs/grib2/grib2_doc/

export interface Grib2Field {
  discipline: number;
  center: number;
  /** model run (reference time), UTC */
  refTime: Date;
  parameterCategory: number;
  parameterNumber: number;
  /** forecast time in hours (time unit converted) */
  forecastHours: number;
  surface1Type: number;
  surface1Value: number;
  grid: {
    template: number;
    nx: number;
    ny: number;
    /** degrees */
    la1: number; lo1: number; la2: number; lo2: number; dx: number; dy: number;
    scanMode: number;
    shapeOfEarth: number;
  };
  /** length nx*ny in scan order; NaN = missing */
  values: Float64Array;
}

// GRIB2 signed integers are sign-and-magnitude, not two's complement.
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

class BitReader {
  private bit = 0;
  constructor(private buf: Uint8Array, private byte: number) {}
  read(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) {
      v = v * 2 + ((this.buf[this.byte] >> (7 - this.bit)) & 1);
      if (++this.bit === 8) { this.bit = 0; this.byte++; }
    }
    return v;
  }
  /** skip to the next octet boundary */
  align(): void { if (this.bit) { this.bit = 0; this.byte++; } }
}

interface Drs {
  template: number;
  nPacked: number;
  R: number; E: number; D: number; nbits: number;
  // complex packing (5.2 / 5.3)
  missingMgmt?: number; ng?: number; widthRef?: number; widthBits?: number;
  lenRef?: number; lenInc?: number; lastLen?: number; lenBits?: number;
  sdOrder?: number; sdOctets?: number;
}

function parseDrs(s: Uint8Array, o: number): Drs {
  const template = uint(s, o + 9, 2);
  if (template !== 0 && template !== 2 && template !== 3) throw new Error(`GRIB2: data representation template 5.${template} not supported`);
  const R = new DataView(s.buffer, s.byteOffset + o + 11, 4).getFloat32(0, false);
  const d: Drs = { template, nPacked: uint(s, o + 5, 4), R, E: int(s, o + 15, 2), D: int(s, o + 17, 2), nbits: s[o + 19] };
  if (template >= 2) {
    if (s[o + 21] !== 1) throw new Error('GRIB2: only general group splitting is supported');
    Object.assign(d, {
      missingMgmt: s[o + 22], ng: uint(s, o + 31, 4), widthRef: s[o + 35], widthBits: s[o + 36],
      lenRef: uint(s, o + 37, 4), lenInc: s[o + 41], lastLen: uint(s, o + 42, 4), lenBits: s[o + 46],
    });
    if (template === 3) { d.sdOrder = s[o + 47]; d.sdOctets = s[o + 48]; }
  }
  return d;
}

/** Unpack the integer field X (null = missing) from section 7 data starting at `off`. */
function unpack(d: Drs, s: Uint8Array, off: number): (number | null)[] {
  const n = d.nPacked;
  if (d.template === 0) {
    const out = new Array<number | null>(n);
    if (d.nbits === 0) return out.fill(0);
    const br = new BitReader(s, off);
    for (let i = 0; i < n; i++) out[i] = br.read(d.nbits);
    return out;
  }
  // complex packing; spatial-differencing descriptors come first (5.3 only)
  let p = off;
  let ival1 = 0, ival2 = 0, minsd = 0;
  const order = d.sdOrder ?? 0;
  if (order) {
    const k = d.sdOctets!;
    if (order !== 1 && order !== 2) throw new Error(`GRIB2: spatial differencing order ${order} not supported`);
    ival1 = int(s, p, k); p += k;
    if (order === 2) { ival2 = int(s, p, k); p += k; }
    minsd = int(s, p, k); p += k;
  }
  const ng = d.ng!;
  const br = new BitReader(s, p);
  const refs = new Array<number>(ng), widths = new Array<number>(ng), lens = new Array<number>(ng);
  for (let g = 0; g < ng; g++) refs[g] = br.read(d.nbits);
  br.align();
  for (let g = 0; g < ng; g++) widths[g] = d.widthRef! + br.read(d.widthBits!);
  br.align();
  for (let g = 0; g < ng; g++) lens[g] = d.lenRef! + d.lenInc! * br.read(d.lenBits!);
  br.align();
  lens[ng - 1] = d.lastLen!;

  const mm = d.missingMgmt ?? 0;
  const refAllOnes = 2 ** d.nbits - 1;
  const out: (number | null)[] = [];
  for (let g = 0; g < ng; g++) {
    const w = widths[g];
    const allOnes = 2 ** w - 1;
    for (let i = 0; i < lens[g]; i++) {
      if (w === 0) {
        if (mm >= 1 && (refs[g] === refAllOnes || (mm === 2 && refs[g] === refAllOnes - 1))) out.push(null);
        else out.push(refs[g]);
      } else {
        const v = br.read(w);
        if (mm >= 1 && (v === allOnes || (mm === 2 && v === allOnes - 1))) out.push(null);
        else out.push(refs[g] + v);
      }
    }
  }
  if (out.length !== n) throw new Error(`GRIB2: unpacked ${out.length} values, expected ${n}`);
  if (order) {
    // undo spatial differencing over the non-missing values, in order
    const idx: number[] = [];
    for (let i = 0; i < n; i++) if (out[i] !== null) idx.push(i);
    const v = idx.map(i => out[i] as number);
    if (v.length) v[0] = ival1;
    if (order === 1) {
      for (let i = 1; i < v.length; i++) v[i] += minsd + v[i - 1];
    } else {
      if (v.length > 1) v[1] = ival2;
      for (let i = 2; i < v.length; i++) v[i] += minsd + 2 * v[i - 1] - v[i - 2];
    }
    idx.forEach((i, k) => { out[i] = v[k]; });
  }
  return out;
}

// code table 4.4 (indicator of unit of time range) -> hours
const HOURS_PER_UNIT: Record<number, number> = { 0: 1 / 60, 1: 1, 2: 24, 10: 3, 11: 6, 12: 12, 13: 1 / 3600 };

/** Decode every field in a GRIB2 byte stream (several messages, each possibly with several fields). */
export function decodeGrib2(input: Uint8Array): Grib2Field[] {
  const fields: Grib2Field[] = [];
  let pos = 0;
  while (pos + 16 <= input.length) {
    // tolerate padding between messages
    if (!(input[pos] === 0x47 && input[pos + 1] === 0x52 && input[pos + 2] === 0x49 && input[pos + 3] === 0x42)) { pos++; continue; }
    if (input[pos + 7] !== 2) throw new Error(`GRIB: edition ${input[pos + 7]} not supported`);
    const discipline = input[pos + 6];
    const end = pos + uint(input, pos + 8, 8);
    if (end > input.length) throw new Error('GRIB2: truncated message');
    let o = pos + 16;
    let center = 0, refTime = new Date(NaN);
    let grid: Grib2Field['grid'] | null = null;
    let nPoints = 0;
    let prod: { cat: number; num: number; fh: number; st: number; sv: number } | null = null;
    let drs: Drs | null = null;
    let bitmap: Uint8Array | null = null;
    while (o < end - 4) {
      const len = uint(input, o, 4);
      const sec = input[o + 4];
      if (sec === 1) {
        center = uint(input, o + 5, 2);
        refTime = new Date(Date.UTC(uint(input, o + 12, 2), input[o + 14] - 1, input[o + 15], input[o + 16], input[o + 17], input[o + 18]));
      } else if (sec === 3) {
        const t = uint(input, o + 12, 2);
        if (t !== 0) throw new Error(`GRIB2: grid template 3.${t} not supported (only regular lat/lon)`);
        nPoints = uint(input, o + 6, 4);
        const basic = uint(input, o + 38, 4), sub = uint(input, o + 42, 4);
        const unit = basic === 0 || basic === 0xffffffff ? 1e-6 : basic / sub;
        const deg = (off: number, signed = true) => {
          const v = signed ? int(input, o + off, 4) : uint(input, o + off, 4);
          return Math.round(v * unit * 1e6) / 1e6;
        };
        grid = {
          template: 0, shapeOfEarth: input[o + 14],
          nx: uint(input, o + 30, 4), ny: uint(input, o + 34, 4),
          la1: deg(46), lo1: deg(50), la2: deg(55), lo2: deg(59), dx: deg(63, false), dy: deg(67, false),
          scanMode: input[o + 71],
        };
      } else if (sec === 4) {
        const t = uint(input, o + 7, 2);
        if (t !== 0) throw new Error(`GRIB2: product template 4.${t} not supported`);
        const unitH = HOURS_PER_UNIT[input[o + 17]];
        if (unitH === undefined) throw new Error(`GRIB2: time unit ${input[o + 17]} not supported`);
        prod = {
          cat: input[o + 9], num: input[o + 10], fh: int(input, o + 18, 4) * unitH,
          st: input[o + 22], sv: int(input, o + 24, 4) / 10 ** int(input, o + 23, 1),
        };
      } else if (sec === 5) {
        drs = parseDrs(input, o);
      } else if (sec === 6) {
        const ind = input[o + 5];
        if (ind === 0) bitmap = input.subarray(o + 6, o + len);
        else if (ind === 255) bitmap = null;
        else if (ind !== 254) throw new Error(`GRIB2: predefined bitmap ${ind} not supported`);
      } else if (sec === 7) {
        if (!grid || !prod || !drs) throw new Error('GRIB2: data section before grid/product/representation');
        const X = unpack(drs, input, o + 5);
        const scale = 2 ** drs.E, dec = 10 ** -drs.D;
        const values = new Float64Array(nPoints).fill(NaN);
        let k = 0;
        for (let i = 0; i < nPoints; i++) {
          if (bitmap && !((bitmap[i >> 3] >> (7 - (i & 7))) & 1)) continue;
          const x = X[k++];
          if (x !== null && x !== undefined) values[i] = (drs.R + x * scale) * dec;
        }
        if (k !== X.length) throw new Error(`GRIB2: bitmap covers ${k} points, data has ${X.length}`);
        fields.push({
          discipline, center, refTime, parameterCategory: prod.cat, parameterNumber: prod.num,
          forecastHours: prod.fh, surface1Type: prod.st, surface1Value: prod.sv, grid: { ...grid }, values,
        });
      }
      o += len;
    }
    pos = end;
  }
  return fields;
}
