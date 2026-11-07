/* =============================================================================
 * core/audio.js ── WebAudio 程序化音效（不加载任何音频文件）
 *  · 撞击 / 挥空 / 防御 / 必杀 / 超必杀 / KO / 怪兽咆哮 / 喷火 / 雷击
 *  · 全部由振荡器 + 噪声 + 包络实时合成，资源占用极小
 * ========================================================================== */

class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ready = false;
    this.enabled = true;
    this.noiseBuf = null;
  }

  /** 必须在首次用户手势中调用（浏览器自动播放策略） */
  unlock() {
    if (this.ready && this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.5);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
      this.ready = true;
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch (e) {
      this.ready = false;
    }
  }

  _env(gain, t, dur, peak) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  _tone(type, f0, f1, dur, peak, delay = 0) {
    if (!this.ready) return;
    const c = this.ctx;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    this._env(g, t, dur, peak);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  _noise(dur, freq, peak, type = 'bandpass', delay = 0) {
    if (!this.ready || !this.noiseBuf) return;
    const c = this.ctx;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.35), t + dur);
    f.Q.value = 1.1;
    const g = c.createGain();
    this._env(g, t, dur, peak);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t); s.stop(t + dur + 0.02);
  }

  play(name) {
    if (!this.ready || !this.enabled) return;
    switch (name) {
      case 'whiff':   this._noise(0.07, 2400, 0.10); break;
      case 'hitLight':
        this._tone('square', 210, 90, 0.08, 0.16);
        this._noise(0.09, 1800, 0.22);
        break;
      case 'hitHeavy':
        this._tone('sine', 110, 42, 0.22, 0.42);
        this._tone('square', 160, 60, 0.10, 0.14);
        this._noise(0.18, 900, 0.30, 'lowpass');
        break;
      case 'hitSuper':
        this._tone('sine', 90, 30, 0.45, 0.50);
        this._noise(0.35, 600, 0.34, 'lowpass');
        this._tone('sawtooth', 300, 60, 0.25, 0.16);
        break;
      case 'block':
        this._tone('triangle', 420, 180, 0.10, 0.22);
        this._noise(0.09, 3200, 0.16, 'highpass');
        break;
      case 'jump':    this._tone('square', 300, 620, 0.09, 0.10); break;
      case 'land':    this._noise(0.10, 500, 0.20, 'lowpass'); break;
      case 'special':
        this._tone('sawtooth', 160, 720, 0.20, 0.18);
        this._noise(0.16, 2400, 0.14);
        break;
      case 'super':
        this._tone('sawtooth', 120, 980, 0.55, 0.20);
        this._tone('square', 60, 240, 0.50, 0.16);
        this._noise(0.40, 2000, 0.18);
        break;
      case 'ko':
        this._tone('sine', 240, 40, 0.85, 0.40);
        this._tone('square', 120, 30, 0.80, 0.14);
        break;
      case 'select':  this._tone('square', 660, 880, 0.06, 0.10); break;
      case 'confirm': this._tone('square', 520, 1040, 0.10, 0.12); break;
      case 'back':    this._tone('square', 420, 220, 0.08, 0.09); break;
      case 'roar':
        this._tone('sawtooth', 110, 60, 0.55, 0.26);
        this._tone('sawtooth', 165, 90, 0.50, 0.16);
        this._noise(0.45, 700, 0.22, 'lowpass');
        break;
      case 'fire':
        this._noise(0.40, 1200, 0.26, 'lowpass');
        this._tone('sawtooth', 200, 80, 0.35, 0.12);
        break;
      case 'thunder':
        this._noise(0.30, 5000, 0.30, 'highpass');
        this._tone('square', 90, 35, 0.35, 0.30);
        break;
      case 'tech':    this._tone('square', 700, 1100, 0.08, 0.12); break;
      case 'round':   this._tone('square', 440, 440, 0.09, 0.12); break;
      case 'fight':   this._tone('square', 880, 880, 0.16, 0.16); break;
      case 'win':
        this._tone('square', 523, 523, 0.12, 0.14);
        this._tone('square', 659, 659, 0.12, 0.14, 0.13);
        this._tone('square', 784, 784, 0.26, 0.16, 0.26);
        break;
      default: break;
    }
  }
}

export const Audio = new AudioSys();
window.__unlockAudio = () => Audio.unlock();
