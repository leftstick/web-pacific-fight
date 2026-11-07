/* =============================================================================
 * game/hitbox.js ── AABB 判定
 *  · 所有判定框都是数据（招式表里的 hitbox 数组 / 角色的 hurtbox）
 *  · 坐标约定：世界 x 向右；判定框 y 使用屏幕坐标（0 = 屏幕顶部，GROUND_Y = 地面）
 * ========================================================================== */
import { GROUND_Y } from '../core/canvas.js';

/**
 * 把角色本地的判定框转为世界 AABB。
 * · x 为竞技场世界坐标（0..ARENA_W），由镜头负责平移
 * · y 为屏幕坐标（向下为正）：脚底 = groundY，招式表里的负 y 表示脚底以上的高度
 * · 角色跳跃时 unit.y 为离地高度，因此脚底屏幕 y = groundY - unit.y
 */
export function toWorld(unit, box) {
  const cx = unit.x + unit.facing * (box.x || 0);
  const foot = (unit.groundY == null ? GROUND_Y : unit.groundY) - (unit.y || 0);
  const cy = foot + (box.y || 0);
  const w = box.w || 10;
  const h = box.h || 10;
  return { x1: cx - w / 2, x2: cx + w / 2, y1: cy - h / 2, y2: cy + h / 2, cx, cy };
}

/** AABB 相交 */
export function overlaps(a, b) {
  return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

/** 相交中心点（用于特效位置） */
export function overlapCenter(a, b) {
  return {
    x: (Math.max(a.x1, b.x1) + Math.min(a.x2, b.x2)) / 2,
    y: (Math.max(a.y1, b.y1) + Math.min(a.y2, b.y2)) / 2
  };
}

/**
 * 取招式在当前帧生效的判定框。
 * @param {object} move
 * @param {number} frame 招式内帧
 */
export function activeBoxes(move, frame) {
  if (!move || !move.hitboxes) return [];
  const out = [];
  for (const b of move.hitboxes) {
    if (frame >= b.from && frame <= b.to) out.push(b);
  }
  return out;
}
