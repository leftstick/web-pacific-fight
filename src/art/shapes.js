/* =============================================================================
 * art/shapes.js ── 像素绘制基础图形
 *  · 八边形躯干 / 锥形肢体 / 三角尖刺，全部 2px 描边
 *  · 角色与怪兽共用，保证描边粗细与像素颗粒一致
 * ========================================================================== */

/** 八边形（像素化椭圆），用于躯干、头部、关节 */
export function oct(g, cx, cy, rx, ry, col, dark) {
  g.beginPath();
  const k = 0.42;
  g.moveTo(cx - rx * k, cy - ry);
  g.lineTo(cx + rx * k, cy - ry);
  g.lineTo(cx + rx, cy - ry * k);
  g.lineTo(cx + rx, cy + ry * k);
  g.lineTo(cx + rx * k, cy + ry);
  g.lineTo(cx - rx * k, cy + ry);
  g.lineTo(cx - rx, cy + ry * k);
  g.lineTo(cx - rx, cy - ry * k);
  g.closePath();
  g.fillStyle = col; g.fill();
  g.lineWidth = 2; g.strokeStyle = dark; g.stroke();
}

/**
 * 一段锥形肢体，返回末端点。
 * ang 为角度（0 = 向下，正 = 向画布右侧）。
 */
export function seg(g, x, y, ang, len, w0, w1, col, dark) {
  const r = ang * Math.PI / 180;
  const ex = x + Math.sin(r) * len;
  const ey = y + Math.cos(r) * len;
  const px = Math.cos(r), py = -Math.sin(r);
  g.beginPath();
  g.moveTo(x + px * w0 / 2, y + py * w0 / 2);
  g.lineTo(ex + px * w1 / 2, ey + py * w1 / 2);
  g.lineTo(ex - px * w1 / 2, ey - py * w1 / 2);
  g.lineTo(x - px * w0 / 2, y - py * w0 / 2);
  g.closePath();
  g.fillStyle = col; g.fill();
  g.lineWidth = 2; g.strokeStyle = dark; g.stroke();
  return { x: ex, y: ey, a: ang };
}

/** 三角尖刺 / 鳍片 */
export function tri(g, x, y, w, h, col, dark) {
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + w, y);
  g.lineTo(x + w * 0.5, y - h);
  g.closePath();
  g.fillStyle = col; g.fill();
  g.lineWidth = 2; g.strokeStyle = dark; g.stroke();
}
