// WASAPI Exclusive (bit-perfect) backend for the Windows app. The Engine hands it lossless songs (FLAC, WAV,
// and the WAV the app decodes from DSD / ALAC; MP3 too) when Cài đặt → Đầu ra → Engine is "WASAPI Exclusive".
// The song is copied once to a temp file and played by native/xs-audio.exe straight to the DAC, at the song's
// own sample rate and bit depth. Gapless between songs of the same format. Formats it cannot open (AAC, Ogg,
// Opus…) or a DAC that refuses the format stay on Web Audio.
const X = () => window.hubDesktop?.xs || null;
export const xsSupported = () => !!X();

// FLAC / RIFF-WAV / MP3 by their first bytes.
export async function xsCanPlay(blob) {
  const b = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  const s = String.fromCharCode(...b);
  return s === 'fLaC' || s === 'RIFF' || s === 'RF64' || s.startsWith('ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);
}

export class Exclusive extends EventTarget {
  constructor() {
    super();
    this.pos = 0; this.dur = 0; this.paused = true; this.track = null; this.next = null; this.format = null;
    this._at = 0; this._waits = [];
    this._off = X()?.on((line) => this._line(line));
  }
  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  cmd(line) { return X().cmd(line); }

  _line(line) {
    const [k, ...rest] = line.split(' ');
    if (k === 'pos') { this.pos = +rest[0] || 0; this.dur = +rest[1] || this.dur; this._at = performance.now(); this._emit('time'); return; }
    if (k === 'state') { this.paused = rest[0] !== 'playing'; this._at = performance.now(); this._emit('state'); return; }
    if (k === 'format') { const [rate, bits, cont, valid, ch] = rest.map(Number); this.format = { rate, bits, cont, valid, ch }; this._emit('format', this.format); return; }
    if (k === 'transition') { if (this.next) { this.track = this.next.track; this.next = null; } this.pos = 0; this._emit('transition', { track: this.track }); return; }
    if (k === 'ended') { this._emit('ended', { track: this.track }); return; }
    if (k === 'exit') { this.paused = true; this._emit('state'); }
    if (k === 'error') this.lastError = rest.slice(2).join(' ');
    if (this._waits.length) { for (const w of this._waits.splice(0)) w(line); return; }
    if (k === 'error') this._emit('error', { code: rest[0], message: rest.slice(2).join(' ') || 'Lỗi thiết bị âm thanh' });
  }
  _wait() { return new Promise((res) => this._waits.push(res)); }

  // The song as a temp file the helper can open (cached by id + size).
  async file(track, url) {
    const key = `${track.id}-${track.size || track.fileSize || ''}-${url.startsWith('blob:') ? 'b' : 'u'}`;
    const known = await X().file(key);
    if (known) return known;
    const blob = await (await fetch(url)).blob();
    if (!(await xsCanPlay(blob))) return null;
    return X().file(key, await blob.arrayBuffer());
  }

  // → true when the helper took the song; false to fall back to Web Audio.
  async load(track, url, { startAt = 0, autoplay = true } = {}) {
    this.lastError = '';
    const path = await this.file(track, url);
    if (!path) { this.lastError = 'định dạng này không phát độc quyền được'; return false; }
    this.track = track; this.next = null; this.pos = startAt; this.dur = track.duration || 0;
    const w = this._wait();
    await this.cmd(`open ${path}\t${startAt || 0}`);
    const r = await w;
    if (!r.startsWith('loaded')) return false;
    this.dur = +r.split(' ')[1] || this.dur;
    if (autoplay) await this.play();
    return true;
  }
  async preload(track, url) {
    if (this.next?.url === url) return;
    const path = await this.file(track, url).catch(() => null);
    if (!path) { this.clearNext(); return; }
    this.next = { track, url };
    await this.cmd('next ' + path);
  }
  clearNext() { if (this.next) { this.next = null; this.cmd('nextclear'); } }
  play() { this.paused = false; return this.cmd('play'); }
  pause() { return this.cmd('pause'); }
  seek(t) { this.pos = Math.max(0, t); this._at = performance.now(); return this.cmd('seek ' + this.pos.toFixed(3)); }
  stop() { this.next = null; this.track = null; this.paused = true; return this.cmd('stop'); }
  setVolume(v) { return this.cmd('volume ' + Math.max(0, Math.min(1, v)).toFixed(4)); }
  // Between the helper's 100 ms position lines, extrapolate so lyrics stay smooth.
  get time() { return this.paused ? this.pos : Math.min(this.dur || Infinity, this.pos + (performance.now() - this._at) / 1000); }
}
