// Decode worker: turns formats the browser can't play (DSD, ALAC, AIFF) into a WAV
// the <audio> element can, keeping resolution. Classic worker, no imports.
//
//   in : { id, kind: 'dsf'|'dff'|'alac'|'aiff', buffer, options }
//   out: { id, type: 'progress', value } ... then
//        { id, type: 'done', wav, info: { sampleRate, bitDepth, channels, duration } }
//        or { id, type: 'error', message }
'use strict';

const fourcc = (u8, o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
const fail = msg => { throw new Error(msg); };

// Reports progress at most every ~5%.
function progressor(id) {
  let last = -1;
  return v => {
    if (v - last < 0.05 && v < 1) return;
    last = v;
    self.postMessage({ id, type: 'progress', value: Math.min(1, v) });
  };
}

// ---------- WAV writer ----------

const MASKS = [0, 0x4, 0x3, 0x7, 0x33, 0x37, 0x3f, 0x70f, 0x63f];

// Returns { buf, u8, view, dataOffset }; caller fills the data area.
function wavAlloc({ sampleRate, channels, bits, validBits = bits, float = false, frames }) {
  const ext = channels > 2 || bits > 16 || validBits !== bits;
  const bytes = bits >> 3, blockAlign = bytes * channels;
  const dataSize = frames * blockAlign, head = ext ? 68 : 44;
  const buf = new ArrayBuffer(head + dataSize + (dataSize & 1));
  const view = new DataView(buf), u8 = new Uint8Array(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) u8[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); view.setUint32(4, buf.byteLength - 8, true); str(8, 'WAVE');
  str(12, 'fmt '); view.setUint32(16, ext ? 40 : 16, true);
  view.setUint16(20, ext ? 0xfffe : float ? 3 : 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bits, true);
  if (ext) {
    view.setUint16(36, 22, true);
    view.setUint16(38, validBits, true);
    view.setUint32(40, MASKS[channels] || 0, true);
    // KSDATAFORMAT_SUBTYPE_PCM / _IEEE_FLOAT
    u8.set([float ? 3 : 1, 0, 0, 0, 0, 0, 0x10, 0, 0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71], 44);
  }
  str(head - 8, 'data'); view.setUint32(head - 4, dataSize, true);
  return { buf, u8, view, dataOffset: head };
}

// Shrinks a WAV whose data area turned out shorter than allocated.
function wavTrim(w, frames, blockAlign) {
  const dataSize = frames * blockAlign, len = w.dataOffset + dataSize;
  if (len >= w.buf.byteLength) return w.buf;
  w.view.setUint32(w.dataOffset - 4, dataSize, true);
  w.view.setUint32(4, len - 8, true);
  return w.buf.transfer ? w.buf.transfer(len) : w.buf.slice(0, len);
}

// ---------- AIFF / AIFF-C ----------

function readExtended(v, o) {
  const exp = v.getUint16(o) & 0x7fff, hi = v.getUint32(o + 2), lo = v.getUint32(o + 6);
  if (!exp && !hi && !lo) return 0;
  return (hi * 2 ** 32 + lo) * 2 ** (exp - 16383 - 63);
}

function decodeAiff(buffer, progress) {
  const u8 = new Uint8Array(buffer), v = new DataView(buffer);
  if (fourcc(u8, 0) !== 'FORM') fail('Không phải tệp AIFF');
  const form = fourcc(u8, 8);
  if (form !== 'AIFF' && form !== 'AIFC') fail('Không phải tệp AIFF');
  let comm = null, ssnd = -1, ssndEnd = 0;
  for (let o = 12; o + 8 <= u8.length;) {
    const id = fourcc(u8, o), size = v.getUint32(o + 4), body = o + 8;
    if (id === 'COMM') {
      comm = {
        channels: v.getInt16(body), frames: v.getUint32(body + 2),
        bits: v.getInt16(body + 6), rate: readExtended(v, body + 8),
        comp: form === 'AIFC' && size >= 22 ? fourcc(u8, body + 18) : 'NONE',
      };
    } else if (id === 'SSND') {
      ssnd = body + 8 + v.getUint32(body);
      ssndEnd = Math.min(u8.length, body + size);
    }
    o = body + size + (size & 1);
  }
  if (!comm || ssnd < 0) fail('AIFF thiếu COMM hoặc SSND');
  const { channels, bits, comp } = comm;
  const rate = Math.round(comm.rate);
  const c = comp.toLowerCase();
  const swap = c === 'none' || c === 'twos' || c === 'in24' || c === 'in32';
  const keep = c === 'sowt' || c === '23ni' || c === '42ni';
  const fl32 = c === 'fl32', fl64 = c === 'fl64';
  if (!swap && !keep && !fl32 && !fl64) fail('AIFF-C nén (' + comp.trim() + ') chưa hỗ trợ');
  const inBytes = fl64 ? 8 : fl32 ? 4 : (bits + 7) >> 3;
  const outBytes = fl64 ? 4 : inBytes;
  const frames = Math.min(comm.frames, Math.floor((ssndEnd - ssnd) / (inBytes * channels)));
  const outBits = outBytes * 8;
  const w = wavAlloc({
    sampleRate: rate, channels, bits: outBits, float: fl32 || fl64,
    validBits: fl32 || fl64 ? outBits : Math.min(bits, outBits), frames,
  });
  const out = w.u8, total = frames * channels;
  const CH = 1 << 18;
  for (let s0 = 0; s0 < total; s0 += CH) {
    const s1 = Math.min(total, s0 + CH);
    let i = ssnd + s0 * inBytes, o = w.dataOffset + s0 * outBytes;
    if (keep) {
      out.set(u8.subarray(i, i + (s1 - s0) * inBytes), o);
      if (inBytes === 1) for (let k = o, e = o + s1 - s0; k < e; k++) out[k] ^= 0x80;
    } else if (fl64) {
      for (let s = s0; s < s1; s++, i += 8, o += 4) w.view.setFloat32(o, v.getFloat64(i), true);
    } else if (inBytes === 1) {
      for (let s = s0; s < s1; s++) out[o++] = u8[i++] ^ 0x80; // signed -> unsigned
    } else if (inBytes === 2) {
      for (let s = s0; s < s1; s++, i += 2, o += 2) { out[o] = u8[i + 1]; out[o + 1] = u8[i]; }
    } else if (inBytes === 3) {
      for (let s = s0; s < s1; s++, i += 3, o += 3) { out[o] = u8[i + 2]; out[o + 1] = u8[i + 1]; out[o + 2] = u8[i]; }
    } else {
      for (let s = s0; s < s1; s++, i += 4, o += 4) {
        out[o] = u8[i + 3]; out[o + 1] = u8[i + 2]; out[o + 2] = u8[i + 1]; out[o + 3] = u8[i];
      }
    }
    progress(s1 / total);
  }
  return { wav: w.buf, info: { sampleRate: rate, bitDepth: fl64 ? 64 : fl32 ? 32 : bits, channels, duration: frames / rate } };
}

// ---------- DSD (DSF / DSDIFF) -> 24-bit PCM ----------

// Kaiser-windowed sinc low-pass, length a multiple of 8, unity DC gain.
function besselI0(x) {
  let sum = 1, term = 1;
  for (let k = 1; k < 50; k++) { term *= (x / (2 * k)) ** 2; sum += term; if (term < 1e-12 * sum) break; }
  return sum;
}
function designLowpass(fs, pass, stop, atten = 100) {
  const dw = 2 * Math.PI * (stop - pass) / fs;
  let n = Math.ceil((atten - 7.95) / (2.285 * dw)) + 1;
  n = (n + 7) & ~7;
  const beta = 0.1102 * (atten - 8.7), fc = (pass + stop) / 2 / fs, mid = (n - 1) / 2;
  const h = new Float64Array(n), i0b = besselI0(beta);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const t = i - mid, r = t / mid;
    const sinc = t === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * t) / (Math.PI * t);
    h[i] = sinc * besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / i0b;
    sum += h[i];
  }
  for (let i = 0; i < n; i++) h[i] /= sum;
  return h;
}

// Per tap-byte lookup: T[k*256 + b] = sum of h over the 8 bits of byte b at position k.
function byteTables(h, lsbFirst) {
  const nb = h.length >> 3, T = new Float32Array(nb * 256);
  for (let k = 0; k < nb; k++) {
    for (let b = 0; b < 256; b++) {
      let s = 0;
      for (let j = 0; j < 8; j++) {
        const bit = lsbFirst ? (b >> j) & 1 : (b >> (7 - j)) & 1;
        s += bit ? h[k * 8 + j] : -h[k * 8 + j];
      }
      T[(k << 8) | b] = s;
    }
  }
  return T;
}

const DSD_IDLE = 0x69; // balanced silence pattern

// src: { u8, channels, rate, bytesPerCh, samples, lsbFirst, copy(ch, from, count, dst, at) }
function dsdToWav(src, progress) {
  const { channels, rate } = src;
  if (rate < 2822400 || rate % 44100) fail('Tần số DSD không hợp lệ: ' + rate);
  const outRate = rate <= 2822400 ? 88200 : 176400;
  const R = rate / outRate, step = R >> 3;
  const pass = outRate === 88200 ? 24000 : 40000;
  const h = designLowpass(rate, pass, outRate * 0.55);
  const nb = h.length >> 3, T = byteTables(h, src.lsbFirst);
  const pre = nb >> 1;
  const frames = Math.floor(src.samples / R);
  const w = wavAlloc({ sampleRate: outRate, channels, bits: 24, frames });
  const out = w.u8, stride = channels * 3;
  const M = 8192, buf = new Uint8Array(M * step + nb);
  const gain = 8388607; // DSD +-1 -> full scale: 0 dB SACD (50%) lands at -6 dBFS
  for (let n0 = 0; n0 < frames; n0 += M) {
    const m = Math.min(M, frames - n0);
    const a = n0 * step - pre, len = (m - 1) * step + nb; // stream byte range [a, a+len)
    for (let ch = 0; ch < channels; ch++) {
      // idle padding outside the data, real bytes inside
      const lo = Math.max(0, a), hi = Math.min(src.bytesPerCh, a + len);
      if (lo > a) buf.fill(DSD_IDLE, 0, lo - a);
      if (hi > lo) src.copy(ch, lo, hi - lo, buf, lo - a);
      if (a + len > Math.max(hi, lo)) buf.fill(DSD_IDLE, Math.max(hi, lo) - a, len);
      let o = w.dataOffset + n0 * stride + ch * 3;
      for (let n = 0, p = 0; n < m; n++, p += step, o += stride) {
        let acc = 0;
        for (let k = 0, q = p; k < nb; k++, q++) acc += T[(k << 8) | buf[q]];
        let s = Math.round(acc * gain);
        if (s > 8388607) s = 8388607; else if (s < -8388608) s = -8388608;
        out[o] = s & 255; out[o + 1] = (s >> 8) & 255; out[o + 2] = (s >> 16) & 255;
      }
    }
    progress((n0 + m) / frames);
  }
  return { wav: w.buf, info: { sampleRate: outRate, bitDepth: 24, channels, duration: frames / outRate, dsdRate: rate } };
}

function parseDsf(buffer) {
  const u8 = new Uint8Array(buffer), v = new DataView(buffer);
  if (fourcc(u8, 0) !== 'DSD ' || fourcc(u8, 28) !== 'fmt ') fail('Không phải tệp DSF');
  const f = 28 + 12;
  if (v.getUint32(f + 4, true) !== 0) fail('DSF: định dạng không hỗ trợ');
  const channels = v.getUint32(f + 12, true), rate = v.getUint32(f + 16, true);
  const bps = v.getUint32(f + 20, true);
  const samples = Number(v.getBigUint64(f + 24, true)), bs = v.getUint32(f + 32, true) || 4096;
  const fmtSize = Number(v.getBigUint64(32, true));
  const d = 28 + fmtSize;
  if (fourcc(u8, d) !== 'data') fail('DSF thiếu khối data');
  const start = d + 12, dataLen = Math.min(Number(v.getBigUint64(d + 4, true)) - 12, u8.length - start);
  const blocks = Math.floor(dataLen / (bs * channels));
  const bytesPerCh = Math.min(Math.ceil(samples / 8), blocks * bs);
  return {
    u8, channels, rate, bytesPerCh, samples: Math.min(samples, bytesPerCh * 8), lsbFirst: bps === 1,
    copy(ch, from, count, dst, at) { // blocks: [ch0 bs][ch1 bs]...
      while (count > 0) {
        const blk = Math.floor(from / bs), off = from - blk * bs, n = Math.min(count, bs - off);
        const s = start + (blk * channels + ch) * bs + off;
        dst.set(u8.subarray(s, s + n), at);
        from += n; at += n; count -= n;
      }
    },
  };
}

function parseDff(buffer) {
  const u8 = new Uint8Array(buffer), v = new DataView(buffer);
  if (fourcc(u8, 0) !== 'FRM8' || fourcc(u8, 12) !== 'DSD ') fail('Không phải tệp DFF');
  const size64 = o => Number(v.getBigUint64(o));
  let channels = 0, rate = 0, cmpr = 'DSD ', start = -1, len = 0;
  const end = Math.min(u8.length, 12 + size64(4));
  for (let o = 16; o + 12 <= end;) {
    const id = fourcc(u8, o), size = size64(o + 4), body = o + 12;
    if (id === 'PROP' && fourcc(u8, body) === 'SND ') {
      for (let p = body + 4; p + 12 <= body + size;) {
        const sid = fourcc(u8, p), ss = size64(p + 4), sb = p + 12;
        if (sid === 'FS  ') rate = v.getUint32(sb);
        else if (sid === 'CHNL') channels = v.getUint16(sb);
        else if (sid === 'CMPR') cmpr = fourcc(u8, sb);
        p = sb + ss + (ss & 1);
      }
    } else if (id === 'DSD ') { start = body; len = Math.min(size, u8.length - body); }
    else if (id === 'DST ') cmpr = 'DST ';
    o = body + size + (size & 1);
  }
  if (cmpr === 'DST ') fail('DST chưa hỗ trợ');
  if (start < 0 || !channels) fail('DFF thiếu dữ liệu DSD');
  const bytesPerCh = Math.floor(len / channels);
  return {
    u8, channels, rate, bytesPerCh, samples: bytesPerCh * 8, lsbFirst: false,
    copy(ch, from, count, dst, at) { // byte-interleaved
      for (let i = 0, s = start + from * channels + ch; i < count; i++, s += channels) dst[at + i] = u8[s];
    },
  };
}

// ---------- MP4 / ALAC ----------

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'udta']);

function parseMp4Alac(buffer) {
  const u8 = new Uint8Array(buffer), v = new DataView(buffer);
  const tracks = [];
  let trak = null;
  const walk = (o, end) => {
    while (o + 8 <= end) {
      let size = v.getUint32(o), head = 8;
      const type = fourcc(u8, o + 4);
      if (size === 1) { size = Number(v.getBigUint64(o + 8)); head = 16; } else if (size === 0) size = end - o;
      if (size < head) break;
      const body = o + head, bend = Math.min(end, o + size);
      if (type === 'trak') { trak = {}; tracks.push(trak); }
      if (CONTAINERS.has(type)) walk(body, bend);
      else if (trak) parseLeaf(type, body, bend);
      o += size;
    }
  };
  const parseLeaf = (type, b, e) => {
    if (type === 'mdhd') {
      const ver = u8[b];
      trak.timescale = v.getUint32(b + (ver ? 20 : 12));
    } else if (type === 'stsd') {
      const eo = b + 8, esize = v.getUint32(eo);
      trak.codec = fourcc(u8, eo + 4);
      if (trak.codec !== 'alac') return;
      // find the 'alac' child box holding the 24-byte config (maybe inside 'wave')
      for (let p = eo + 36; p + 12 <= eo + esize; p++) {
        if (fourcc(u8, p) === 'alac' && v.getUint32(p - 4) === 36) { trak.cookie = p + 8; break; }
      }
    } else if (type === 'stsz') {
      const fixed = v.getUint32(b + 4), n = v.getUint32(b + 8);
      const sizes = new Uint32Array(n);
      for (let i = 0; i < n; i++) sizes[i] = fixed || v.getUint32(b + 12 + i * 4);
      trak.sizes = sizes;
    } else if (type === 'stco' || type === 'co64') {
      const n = v.getUint32(b + 4), offs = new Float64Array(n);
      for (let i = 0; i < n; i++) offs[i] = type === 'stco' ? v.getUint32(b + 8 + i * 4) : Number(v.getBigUint64(b + 8 + i * 8));
      trak.chunks = offs;
    } else if (type === 'stsc') {
      const n = v.getUint32(b + 4), list = [];
      for (let i = 0; i < n; i++) list.push([v.getUint32(b + 8 + i * 12), v.getUint32(b + 12 + i * 12)]);
      trak.stsc = list;
    } else if (type === 'stts') {
      const n = v.getUint32(b + 4);
      let total = 0;
      for (let i = 0; i < n; i++) total += v.getUint32(b + 8 + i * 8) * v.getUint32(b + 12 + i * 8);
      trak.ticks = total;
    }
  };
  walk(0, u8.length);
  const t = tracks.find(x => x.codec === 'alac');
  if (!t || !t.cookie) fail('Không tìm thấy luồng ALAC');
  if (!t.sizes || !t.chunks || !t.stsc) fail('ALAC: thiếu bảng mẫu');
  const c = t.cookie;
  const cfg = {
    frameLength: v.getUint32(c), bitDepth: u8[c + 5], pb: u8[c + 6], mb: u8[c + 7], kb: u8[c + 8],
    channels: u8[c + 9], maxRun: v.getUint16(c + 10), sampleRate: v.getUint32(c + 20),
  };
  // sample offsets from stsc + chunk offsets
  const n = t.sizes.length, offsets = new Float64Array(n);
  let s = 0;
  for (let ci = 0, e = 0; ci < t.chunks.length && s < n; ci++) {
    while (e + 1 < t.stsc.length && t.stsc[e + 1][0] <= ci + 1) e++;
    let off = t.chunks[ci];
    for (let k = 0; k < t.stsc[e][1] && s < n; k++, s++) { offsets[s] = off; off += t.sizes[s]; }
  }
  const frames = t.ticks && t.timescale ? Math.round(t.ticks * cfg.sampleRate / t.timescale) : 0;
  return { u8, cfg, sizes: t.sizes, offsets, count: s, frames };
}

// Bit reader over a Uint8Array (out-of-range bytes read as 0).
class Bits {
  constructor(u8, pos, end) { this.u8 = u8; this.pos = pos * 8; this.end = end * 8; }
  peek32(p = this.pos) { // 32 bits starting at bit p
    const u = this.u8, i = p >> 3, s = p & 7;
    const w = ((u[i] << 24) | (u[i + 1] << 16) | (u[i + 2] << 8) | u[i + 3]) >>> 0;
    return s ? ((w << s) | (u[i + 4] >>> (8 - s))) >>> 0 : w;
  }
  read(n) { // n <= 32, unsigned
    if (!n) return 0;
    const r = this.peek32() >>> (32 - n);
    this.pos += n;
    return r;
  }
  readSigned(n) { // n <= 32
    if (n <= 16) { const x = this.read(n); return (x << (32 - n)) >> (32 - n); }
    const hi = this.read(16), lo = this.read(n - 16);
    return ((hi << 16) >> (32 - n)) | lo; // two-part read like Apple's
  }
  skip(n) { this.pos += n; }
  align() { this.pos = (this.pos + 7) & ~7; }
}

const QBSHIFT = 9, QB = 1 << QBSHIFT, MMULSHIFT = 2, MDENSHIFT = QBSHIFT - MMULSHIFT - 1;
const MOFF = 1 << (MDENSHIFT - 2), BITOFF = 24, MAX_PREFIX = 9;

// Adaptive Golomb-Rice entropy decoder (ag_dec.c dyn_decomp).
function dynDecomp(br, out, num, chanBits, pb, mb0, kb) {
  const wb = (1 << kb) - 1;
  let mb = mb0, zmode = 0, c = 0, pos = br.pos;
  const end = br.end;
  while (c < num) {
    if (pos >= end) fail('ALAC: dữ liệu hỏng');
    let m = mb >>> QBSHIFT;
    let k = 31 - Math.clz32(m + 3);
    if (k > kb) k = kb;
    m = (1 << k) - 1;
    // dyn_get_32bit
    let sl = br.peek32(pos), n = Math.clz32(~sl);
    if (n >= MAX_PREFIX) {
      const p = pos + MAX_PREFIX;
      n = chanBits <= 32 ? (chanBits === 32 ? br.peek32(p) : br.peek32(p) >>> (32 - chanBits))
        : ((br.peek32(p) * 2 ** (chanBits - 32)) + (br.peek32(p + 32) >>> (64 - chanBits)));
      pos = p + chanBits;
    } else {
      pos += n + 1;
      if (k !== 1) {
        const vv = ((sl << (n + 1)) >>> 0) >>> (32 - k);
        pos += k - 1;
        n = n * m;
        if (vv >= 2) { n += vv - 1; pos += 1; }
      }
    }
    const nd = (n + zmode) >>> 0;
    const mag = ((nd + 1) >>> 0) >>> 1;
    out[c++] = nd & 1 ? -mag | 0 : mag | 0;
    mb = (Math.imul(pb, nd) + mb - (Math.imul(pb, mb) >>> QBSHIFT)) >>> 0;
    if (n > 0xffff) mb = 0xffff;
    zmode = 0;
    if (((mb << MMULSHIFT) >>> 0) < QB && c < num) {
      zmode = 1;
      const kk = Math.clz32(mb) - BITOFF + ((mb + MOFF) >> MDENSHIFT);
      const mz = ((1 << kk) - 1) & wb;
      // dyn_get (run length)
      sl = br.peek32(pos);
      let pre = Math.clz32(~sl), r;
      if (pre >= MAX_PREFIX) {
        pos += MAX_PREFIX;
        r = br.peek32(pos) >>> 16;
        pos += 16;
      } else {
        pos += pre + 1;
        const vv = ((sl << (pre + 1)) >>> 0) >>> (32 - kk);
        pos += kk;
        r = pre * mz + vv - 1;
        if (vv < 2) { r -= vv - 1; pos -= 1; }
      }
      if (c + r > num) fail('ALAC: dữ liệu hỏng');
      for (let j = 0; j < r; j++) out[c++] = 0;
      if (r >= 65535) zmode = 0;
      mb = 0;
    }
  }
  br.pos = pos;
}

// Dynamic predictor (dp_dec.c unpc_block). coefs: Int16Array, updated in place.
function unpcBlock(pc, out, num, coefs, numActive, chanBits, denShift) {
  const sh = 32 - chanBits; // (x << sh) >> sh sign-extends to chanBits (sh = 0: int32 wrap)
  out[0] = pc[0];
  if (numActive === 0) { if (pc !== out) out.set(pc.subarray(1, num), 1); return; }
  if (numActive === 31) {
    let prev = out[0];
    for (let j = 1; j < num; j++) { prev = ((pc[j] + prev) << sh) >> sh; out[j] = prev; }
    return;
  }
  for (let j = 1; j <= numActive && j < num; j++) out[j] = ((pc[j] + out[j - 1]) << sh) >> sh;
  const lim = numActive + 1, denHalf = denShift ? 1 << (denShift - 1) : 0;
  for (let j = lim; j < num; j++) {
    const top = out[j - lim], b = j - 1;
    let sum = 0;
    for (let k = 0; k < numActive; k++) sum = (sum + Math.imul(coefs[k], out[b - k] - top)) | 0;
    let del0 = pc[j];
    out[j] = ((del0 + top + ((sum + denHalf) >> denShift)) << sh) >> sh;
    if (del0 > 0) {
      for (let k = numActive - 1; k >= 0; k--) {
        const dd = (top - out[b - k]) | 0;
        if (dd > 0) { coefs[k]--; del0 = (del0 - Math.imul(numActive - k, dd >> denShift)) | 0; }
        else if (dd < 0) { coefs[k]++; del0 = (del0 - Math.imul(numActive - k, (-dd | 0) >> denShift)) | 0; }
        if (del0 <= 0) break;
      }
    } else if (del0 < 0) {
      for (let k = numActive - 1; k >= 0; k--) {
        const dd = (top - out[b - k]) | 0;
        if (dd > 0) { coefs[k]++; del0 = (del0 - Math.imul(numActive - k, (-dd | 0) >> denShift)) | 0; }
        else if (dd < 0) { coefs[k]--; del0 = (del0 - Math.imul(numActive - k, dd >> denShift)) | 0; }
        if (del0 >= 0) break;
      }
    }
  }
}

// ALAC element channel -> WAV channel order (C L R Ls Rs LFE... -> L R C LFE ...).
const ALAC_ORDER = [[0], [0, 1], [2, 0, 1], [2, 0, 1, 3], [2, 0, 1, 3, 4], [2, 0, 1, 4, 5, 3], [2, 0, 1, 4, 5, 6, 3], [2, 6, 7, 0, 1, 4, 5, 3]];

function makeAlacDecoder(cfg) {
  const { frameLength: fl, bitDepth, channels } = cfg;
  const pred = new Int32Array(fl), mixU = new Int32Array(fl), mixV = new Int32Array(fl);
  const shiftBuf = new Uint16Array(fl * 2), coefsU = new Int16Array(32), coefsV = new Int16Array(32);
  const order = ALAC_ORDER[channels - 1] || ALAC_ORDER[0].map((_, i) => i);

  const readSub = (br, coefs) => {
    const hb = br.read(8), mode = hb >> 4, den = hb & 15;
    const hb2 = br.read(8), pbf = hb2 >> 5, num = hb2 & 31;
    for (let i = 0; i < num; i++) coefs[i] = br.read(16);
    return { mode, den, pbf, num };
  };
  const predict = (br, sub, coefs, num, chanBits, dst) => {
    dynDecomp(br, pred, num, chanBits, (cfg.pb * sub.pbf) >> 2, cfg.mb, cfg.kb);
    if (sub.mode === 0) unpcBlock(pred, dst, num, coefs, sub.num, chanBits, sub.den);
    else {
      unpcBlock(pred, pred, num, null, 31, chanBits, 0);
      unpcBlock(pred, dst, num, coefs, sub.num, chanBits, sub.den);
    }
  };

  // Decodes one packet into out (Int32Array, interleaved, frame capacity fl). Returns frames.
  return (u8, start, size, out) => {
    const br = new Bits(u8, start, start + size);
    let chIdx = 0, frames = 0;
    while (true) {
      const tag = br.read(3);
      if (tag === 7) break; // END
      if (tag === 0 || tag === 3 || tag === 1) { // SCE / LFE / CPE
        const stereo = tag === 1;
        br.skip(4); // element instance
        if (br.read(12) !== 0) fail('ALAC: header lạ');
        const hb = br.read(4);
        const partial = hb >> 3;
        let shifted = (hb >> 1) & 3;
        const escape = hb & 1;
        if (shifted === 3) fail('ALAC: dữ liệu hỏng');
        let num = fl;
        if (partial) num = (br.read(16) * 65536 + br.read(16));
        if (num > fl) fail('ALAC: khung quá dài');
        let chanBits = bitDepth - shifted * 8 + (stereo ? 1 : 0);
        let mixBits = 0, mixRes = 0, shiftPos = 0;
        if (!escape) {
          mixBits = br.read(8); mixRes = (br.read(8) << 24) >> 24;
          const su = readSub(br, coefsU), sv = stereo ? readSub(br, coefsV) : null;
          if (shifted) { shiftPos = br.pos; br.skip(shifted * 8 * num * (stereo ? 2 : 1)); }
          predict(br, su, coefsU, num, chanBits, mixU);
          if (stereo) predict(br, sv, coefsV, num, chanBits, mixV);
        } else {
          chanBits = bitDepth;
          for (let i = 0; i < num; i++) {
            mixU[i] = br.readSigned(chanBits);
            if (stereo) mixV[i] = br.readSigned(chanBits);
          }
          shifted = 0;
        }
        if (shifted) {
          const save = br.pos, sh = shifted * 8, n = num * (stereo ? 2 : 1);
          br.pos = shiftPos;
          for (let i = 0; i < n; i++) shiftBuf[i] = br.read(sh);
          br.pos = save;
        }
        const sh = shifted * 8, c0 = order[chIdx], c1 = order[chIdx + 1];
        if (stereo) {
          for (let j = 0, k = 0; j < num; j++, k += 2) {
            let l = mixU[j], r = mixV[j];
            if (mixRes) { l = (l + r - (Math.imul(mixRes, r) >> mixBits)) | 0; r = (l - r) | 0; }
            if (sh) { l = (l << sh) | shiftBuf[k]; r = (r << sh) | shiftBuf[k + 1]; }
            out[j * channels + c0] = l; out[j * channels + c1] = r;
          }
          chIdx += 2;
        } else {
          for (let j = 0; j < num; j++) out[j * channels + c0] = sh ? (mixU[j] << sh) | shiftBuf[j] : mixU[j];
          chIdx += 1;
        }
        frames = num;
      } else if (tag === 4) { // DSE
        br.skip(4);
        const align = br.read(1);
        let count = br.read(8);
        if (count === 255) count += br.read(8);
        if (align) br.align();
        br.skip(count * 8);
      } else if (tag === 6) { // FIL
        let count = br.read(4);
        if (count === 15) count += br.read(8) - 1;
        br.skip(count * 8);
      } else fail('ALAC: phần tử không hỗ trợ (' + tag + ')');
      if (chIdx >= channels) break;
      if (br.pos > br.end) fail('ALAC: dữ liệu hỏng');
    }
    return frames;
  };
}

function decodeAlac(buffer, progress) {
  const mp4 = parseMp4Alac(buffer);
  const { cfg, u8 } = mp4;
  const { channels, bitDepth, sampleRate, frameLength } = cfg;
  if (!channels || ![16, 20, 24, 32].includes(bitDepth)) fail('ALAC: cấu hình không hợp lệ');
  const decode = makeAlacDecoder(cfg);
  const container = bitDepth === 20 ? 24 : bitDepth, bytes = container >> 3;
  const cap = Math.max(mp4.frames, 0) || mp4.count * frameLength;
  const maxFrames = mp4.count * frameLength;
  let w = wavAlloc({ sampleRate, channels, bits: container, validBits: bitDepth, frames: Math.min(cap + frameLength, maxFrames) });
  let capFrames = Math.min(cap + frameLength, maxFrames);
  const pcm = new Int32Array(frameLength * channels);
  const up = bitDepth === 20 ? 4 : 0; // 20-bit left-justified in 24
  let total = 0;
  for (let i = 0; i < mp4.count; i++) {
    const n = decode(u8, mp4.offsets[i], mp4.sizes[i], pcm);
    if (total + n > capFrames) { // stts lied: grow (rare)
      const bigger = wavAlloc({ sampleRate, channels, bits: container, validBits: bitDepth, frames: maxFrames });
      bigger.u8.set(w.u8.subarray(w.dataOffset, w.dataOffset + total * channels * bytes), bigger.dataOffset);
      w = bigger; capFrames = maxFrames;
    }
    const cnt = n * channels, o0 = w.dataOffset + total * channels * bytes, d = w.u8;
    if (bytes === 2) for (let s = 0, o = o0; s < cnt; s++, o += 2) { const x = pcm[s]; d[o] = x; d[o + 1] = x >> 8; }
    else if (bytes === 3) for (let s = 0, o = o0; s < cnt; s++, o += 3) { const x = pcm[s] << up; d[o] = x; d[o + 1] = x >> 8; d[o + 2] = x >> 16; }
    else for (let s = 0, o = o0; s < cnt; s++, o += 4) { const x = pcm[s]; d[o] = x; d[o + 1] = x >> 8; d[o + 2] = x >> 16; d[o + 3] = x >> 24; }
    total += n;
    if ((i & 63) === 0) progress(i / mp4.count);
  }
  if (mp4.frames && total > mp4.frames) total = mp4.frames; // trim encoder padding
  const wav = wavTrim(w, total, channels * bytes);
  return { wav, info: { sampleRate, bitDepth, channels, duration: total / sampleRate } };
}

// ---------- dispatch ----------

self.onmessage = e => {
  const { id, kind, buffer } = e.data || {};
  const progress = progressor(id);
  try {
    let r;
    if (kind === 'aiff') r = decodeAiff(buffer, progress);
    else if (kind === 'dsf') r = dsdToWav(parseDsf(buffer), progress);
    else if (kind === 'dff') r = dsdToWav(parseDff(buffer), progress);
    else if (kind === 'alac') r = decodeAlac(buffer, progress);
    else fail('Định dạng không hỗ trợ: ' + kind);
    progress(1);
    self.postMessage({ id, type: 'done', wav: r.wav, info: r.info }, [r.wav]);
  } catch (err) {
    self.postMessage({ id, type: 'error', message: err && err.message || String(err) });
  }
};
