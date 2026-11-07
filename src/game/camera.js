/* =============================================================================
 * game/camera.js ── 横向跟随镜头 + 震屏 + KO 推镜
 *  · 竞技场宽 660，视口 480：镜头 x 仅在 0..180 之间移动
 *  · 震屏只影响世界层，不影响 HUD
 * ========================================================================== */
import { VIEW_W, ARENA_W } from '../core/canvas.js';

const MAX_X = Math.max(0, ARENA_W - VIEW_W);

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, k) { return a + (b - a) * k; }

export class Camera {
  constructor() {
    this.x = 0;
    this.zoom = 1;
    this.targetZoom = 1;
    this.shakeT = 0;
    this.shakeMax = 1;
    this.shakeMag = 0;
    this.sx = 0;
    this.sy = 0;
    this.focusX = 0;
  }

  reset() {
    this.x = 0;
    this.zoom = 1;
    this.targetZoom = 1;
    this.shakeT = 0;
    this.shakeMag = 0;
    this.sx = 0;
    this.sy = 0;
  }

  /** 触发震屏 */
  shake(mag, frames) {
    if (mag <= this.shakeMag && this.shakeT > 0) return;
    this.shakeMag = mag;
    this.shakeT = frames;
    this.shakeMax = frames;
  }

  /** 镜头推进（KO / 胜利） */
  zoomTo(z) { this.targetZoom = z; }

  /**
   * 每逻辑帧更新。
   * @param {object} a
   * @param {object} b
   * @param {boolean} [push] 是否 KO 推镜（居中到两人中间）
   */
  update(a, b, push) {
    const ax = a ? a.x : this.focusX;
    const bx = b ? b.x : this.focusX;
    this.focusX = (ax + bx) / 2;

    const target = clamp(this.focusX - VIEW_W / 2, 0, MAX_X);
    this.x = lerp(this.x, target, 0.12);

    if (push) this.targetZoom = 1.18;
    this.zoom = lerp(this.zoom, this.targetZoom, 0.06);

    if (this.shakeT > 0) {
      const k = this.shakeT / this.shakeMax;
      this.sx = (Math.random() * 2 - 1) * this.shakeMag * k;
      this.sy = (Math.random() * 2 - 1) * this.shakeMag * k * 0.7;
      this.shakeT--;
    } else {
      this.sx = 0;
      this.sy = 0;
      this.shakeMag = 0;
    }
  }
}
