/* =============================================================================
 * ui/touch.js ── 触屏虚拟摇杆 + 三按键 + 键位拖动自定义
 *  · Pointer Events 多点触控；摇杆 8 向，快速下拉 = 蹲
 *  · 按键位置写入 localStorage，刷新后保持
 *  · 布局避开 env(safe-area-inset-*)（由 index.html 的 CSS 负责）
 * ========================================================================== */

const STORE_KEY = 'gws.touch.layout.v1';
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

export function hasTouch() {
  return (navigator.maxTouchPoints || 0) > 0 ||
    (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
}

export class TouchPad {
  constructor(input) {
    this.input = input;
    this.layer = document.getElementById('touch-layer');
    this.zone = document.getElementById('stick-zone');
    this.base = document.getElementById('stick-base');
    this.knob = document.getElementById('stick-knob');
    this.cluster = document.getElementById('btn-cluster');
    this.buttons = Array.from(document.querySelectorAll('.tbtn'));
    this.special = this.buttons.find((b) => b.dataset.act === 'special');

    this.editing = false;
    this.stickId = null;
    this.drag = null;
    this.hold = { light: null, heavy: null, special: null };

    this._bindStick();
    this._bindButtons();
    this._restore();
  }

  show(on) {
    this.layer.classList.toggle('on', !!on);
    if (!on) this.releaseAll();
  }

  setMeter(v) {
    if (this.special) this.special.classList.toggle('ready', v >= 25);
  }

  releaseAll() {
    this.stickId = null;
    if (this.knob) this.knob.style.transform = '';
    this.input.clearVirtual();
    for (const b of this.buttons) b.classList.remove('pressed');
    this.hold.light = this.hold.heavy = this.hold.special = null;
  }

  /* ---- 摇杆 -------------------------------------------------------------- */

  _bindStick() {
    if (!this.zone) return;
    const down = (e) => {
      e.preventDefault();
      if (this.editing) { this._beginDrag(this.zone, e, 'stick'); return; }
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      try { this.zone.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      this._joy(e);
    };
    const move = (e) => {
      if (this.stickId !== e.pointerId) return;
      e.preventDefault();
      this._joy(e);
    };
    const up = (e) => {
      if (this.stickId !== e.pointerId) return;
      this.stickId = null;
      this.knob.style.transform = '';
      this.input.setVirtual('left', false);
      this.input.setVirtual('right', false);
      this.input.setVirtual('up', false);
      this.input.setVirtual('down', false);
    };

    this.zone.addEventListener('pointerdown', down, { passive: false });
    this.zone.addEventListener('pointermove', move, { passive: false });
    this.zone.addEventListener('pointerup', up);
    this.zone.addEventListener('pointercancel', up);
    this.zone.addEventListener('lostpointercapture', up);
    this.zone.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _joy(e) {
    const r = this.base.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const max = r.width * 0.38;
    const len = Math.hypot(dx, dy);
    if (len > max) { dx = dx / len * max; dy = dy / len * max; }
    this.knob.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';

    const dead = 11;
    this.input.setVirtual('left', dx < -dead);
    this.input.setVirtual('right', dx > dead);
    this.input.setVirtual('up', dy < -dead);
    this.input.setVirtual('down', dy > dead);
  }

  /* ---- 按键 -------------------------------------------------------------- */

  _bindButtons() {
    for (const btn of this.buttons) {
      const act = btn.dataset.act;
      const down = (e) => {
        e.preventDefault();
        if (this.editing) { this._beginDrag(btn, e, 'btn'); return; }
        this.hold[act] = e.pointerId;
        btn.classList.add('pressed');
        this.input.setVirtual(act, true);
        try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      };
      const up = (e) => {
        if (this.hold[act] !== e.pointerId) return;
        this.hold[act] = null;
        btn.classList.remove('pressed');
        if (!this.editing) this.input.setVirtual(act, false);
      };
      btn.addEventListener('pointerdown', down, { passive: false });
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('lostpointercapture', up);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  /* ---- 自定义布局 -------------------------------------------------------- */

  startEdit() {
    this.editing = true;
    this.releaseAll();
    this.layer.classList.add('editing');
  }

  stopEdit() {
    this.editing = false;
    this.layer.classList.remove('editing');
    this._save();
  }

  _beginDrag(el, e, kind) {
    e.preventDefault();
    const cs = getComputedStyle(el);
    this.drag = {
      el, kind, id: e.pointerId,
      sx: e.clientX, sy: e.clientY,
      left: parseFloat(cs.left) || 0,
      bottom: parseFloat(cs.bottom) || 0
    };
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    el.style.transition = 'none';

    const move = (ev) => this._dragMove(ev);
    const end = (ev) => {
      this._dragEnd(ev);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      el.removeEventListener('lostpointercapture', end);
    };
    el.addEventListener('pointermove', move, { passive: false });
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  }

  _dragMove(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    e.preventDefault();
    const maxL = d.kind === 'stick' ? 320 : 230;
    const maxB = d.kind === 'stick' ? 220 : 150;
    d.el.style.left = clamp(d.left + (e.clientX - d.sx), -60, maxL) + 'px';
    d.el.style.bottom = clamp(d.bottom - (e.clientY - d.sy), -30, maxB) + 'px';
  }

  _dragEnd(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    d.el.style.transition = '';
    this.drag = null;
    this._save();
  }

  _save() {
    try {
      const data = {
        stick: { left: this.zone.style.left, bottom: this.zone.style.bottom },
        light: this._pos(this.buttons[0]),
        heavy: this._pos(this.buttons[1]),
        special: this._pos(this.buttons[2])
      };
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch (err) { /* 隐私模式忽略 */ }
  }

  _pos(el) {
    return el ? { left: el.style.left, bottom: el.style.bottom } : null;
  }

  _restore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.stick && this.zone) {
        if (data.stick.left) this.zone.style.left = data.stick.left;
        if (data.stick.bottom) this.zone.style.bottom = data.stick.bottom;
      }
      for (let i = 0; i < this.buttons.length; i++) {
        const key = ['light', 'heavy', 'special'][i];
        const el = this.buttons[i];
        if (data[key] && el) {
          if (data[key].left) el.style.left = data[key].left;
          if (data[key].bottom) el.style.bottom = data[key].bottom;
        }
      }
    } catch (err) { /* ignore */ }
  }
}
