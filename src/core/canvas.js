/* =============================================================================
 * core/canvas.js ── 640×360 固定内部分辨率画布
 *  · 逻辑分辨率固定 640×360，渲染时整数倍放大（小屏退化为非整数倍但保持像素化）
 *  · 所有绘制坐标都在 640×360 空间内，避免不同设备上的尺寸漂移
 * ========================================================================== */
export const VIEW_W = 640;
export const VIEW_H = 360;
export const GROUND_Y = 310;      // 地面线（角色的脚底 y）

/** 舞台可用宽度（角色活动范围，比视口宽，用于镜头横向推移） */
export const ARENA_W = 1280;
export const ARENA_MIN_X = 32;
export const ARENA_MAX_X = ARENA_W - 32;

/**
 * 让 canvas 以整数倍铺满视口并居中；返回当前缩放倍率。
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLElement} wrap
 */
export function fitCanvas(canvas, wrap) {
  let scale = 1;
  function resize() {
    const vw = window.innerWidth || VIEW_W;
    const vh = window.innerHeight || VIEW_H;
    let s = Math.min(vw / VIEW_W, vh / VIEW_H);
    // 大屏用整数倍，保证每个逻辑像素都对齐；小屏允许小数避免黑边过大
    scale = s >= 1 ? Math.floor(s) : s;
    if (scale < 0.5) scale = 0.5;
    const w = Math.round(VIEW_W * scale);
    const h = Math.round(VIEW_H * scale);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    if (wrap) {
      wrap.style.width = w + 'px';
      wrap.style.height = h + 'px';
    }
    return scale;
  }
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 160));
  return () => scale;
}

/** 取 2D 上下文并关闭图像平滑（像素风必需） */
export function getContext(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

/** 创建一张离屏画布（用于精灵缓存 / 背景缓存） */
export function makeOffscreen(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  return { canvas: c, ctx: g };
}
