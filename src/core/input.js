/* =============================================================================
 * core/input.js ── 统一输入层（键盘 / 触屏虚拟按键 / 指针）
 *  · 逻辑帧开始时调用 beginFrame()，把「本帧新按下」写入 pressed 集合
 *  · 输入缓冲 6 帧：必杀、重击在硬直末尾按下也能在恢复后立即生效
 *  · 触屏按键由 ui/touch.js 通过 setVirtual() 注入，与键盘完全同构
 * ========================================================================== */
import { VIEW_W, VIEW_H } from './canvas.js';

/** 键位映射（桌面端调试用；触屏见 index.html 的 A/B/C 按钮） */
const KEYMAP = {
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyJ: 'light', KeyK: 'heavy', KeyL: 'special', KeyI: 'super',
  Enter: 'confirm', Escape: 'back', Backspace: 'back',
  Space: 'start'
};

const GAME_KEYS = new Set(Object.keys(KEYMAP));

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.raw = new Set();          // 键盘按住
    this.virt = new Set();         // 触屏按住
    this.heldS = new Set();        // 合并后的按住集合
    this.prevS = new Set();
    this.pressedS = new Set();     // 本帧新按下
    this.buf = Object.create(null);
    this.taps = [];                // 指针点击队列（菜单用）
    this.pointer = { x: 0, y: 0, down: false };
    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.raw.add(a);
      if (typeof window.__unlockAudio === 'function') window.__unlockAudio();
    }, { passive: false });

    window.addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      this.raw.delete(a);
    });

    window.addEventListener('blur', () => { this.raw.clear(); this.virt.clear(); });

    const toGame = (ev) => {
      const r = this.canvas.getBoundingClientRect();
      return {
        x: (ev.clientX - r.left) / r.width * VIEW_W,
        y: (ev.clientY - r.top) / r.height * VIEW_H
      };
    };

    this.canvas.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      const p = toGame(ev);
      this.pointer.x = p.x; this.pointer.y = p.y; this.pointer.down = true;
      this.taps.push(p);
      if (this.taps.length > 4) this.taps.shift();
      if (typeof window.__unlockAudio === 'function') window.__unlockAudio();
    }, { passive: false });

    this.canvas.addEventListener('pointermove', (ev) => {
      const p = toGame(ev);
      this.pointer.x = p.x; this.pointer.y = p.y;
    });

    const up = () => { this.pointer.down = false; };
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** 每个逻辑帧开头调用 */
  beginFrame() {
    this.prevS = this.heldS;
    this.heldS = new Set();
    for (const a of this.raw) this.heldS.add(a);
    for (const a of this.virt) this.heldS.add(a);

    this.pressedS.clear();
    for (const a of this.heldS) {
      if (!this.prevS.has(a)) {
        this.pressedS.add(a);
        // 攻击键缓冲长一些，方向键两帧即可
        this.buf[a] = (a === 'light' || a === 'heavy' || a === 'special' || a === 'super') ? 6 : 2;
      }
    }
    for (const k in this.buf) if (this.buf[k] > 0) this.buf[k]--;
  }

  held(a) { return this.heldS.has(a); }
  pressed(a) { return this.pressedS.has(a); }
  buffered(a) { return (this.buf[a] || 0) > 0; }
  consume(a) { this.buf[a] = 0; }

  /** 触屏注入 */
  setVirtual(action, on) {
    if (on) this.virt.add(action); else this.virt.delete(action);
  }
  clearVirtual() { this.virt.clear(); }

  /** 水平方向：-1 左 / 1 右 / 0 */
  axisX() {
    return (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0);
  }

  /** 取出一次点击（菜单用），没有则返回 null */
  takeTap() {
    return this.taps.length ? this.taps.shift() : null;
  }
  clearTaps() { this.taps.length = 0; }
}
