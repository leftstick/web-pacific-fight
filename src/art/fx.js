/* =============================================================================
 * art/fx.js ── 特效对象池（火花 / 碎屑 / 烟尘 / 冲击环 / 光线 / 残影 / 伤害数字）
 *  · 池容量固定 200，所有粒子复用，绝不每帧新建对象
 *  · 粒子按类型渲染为像素方块，符合整体像素风
 *  · 超必杀额外提供横向光线 ray / 竖向光柱 beam / 全屏闪白
 * ========================================================================== */
import { text } from '../core/pixel.js';
import { VIEW_W, VIEW_H } from '../core/canvas.js';
import { drawSprite } from './sprite.js';

const MAX = 200;
const pool = [];
for (let i = 0; i < MAX; i++) {
  pool.push({
    active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 0,
    size: 1, color: '#fff', color2: '#fff', type: 'spark',
    grav: 0.18, drag: 0.98, h: 0, len: 0, dir: 1
  });
}
let cursor = 0;
let screenFlash = null;

const texts = [];
const ghosts = [];

function acquire() {
  for (let i = 0; i < MAX; i++) {
    const p = pool[cursor];
    cursor = (cursor + 1) % MAX;
    if (!p.active) return p;
  }
  const p = pool[cursor];
  cursor = (cursor + 1) % MAX;
  return p;
}

function emit(x, y, vx, vy, life, size, color, type, grav, drag) {
  const p = acquire();
  p.active = true;
  p.x = x; p.y = y; p.vx = vx; p.vy = vy;
  p.life = life; p.max = life;
  p.size = size; p.color = color; p.type = type;
  p.grav = grav == null ? 0.18 : grav;
  p.drag = drag == null ? 0.98 : drag;
}

/** 命中火花：level 1 轻击 / 2 重击 / 3 必杀 */
export function hitSparks(x, y, facing, level, color) {
  const n = level >= 3 ? 24 : level === 2 ? 14 : 7;
  for (let i = 0; i < n; i++) {
    const a = (Math.random() - 0.5) * 2.2;
    const sp = (level >= 3 ? 3.4 : 2.2) * (0.5 + Math.random());
    emit(x, y, Math.cos(a) * sp * facing + (Math.random() - 0.5), Math.sin(a) * sp,
      16 + Math.random() * 10, Math.random() < 0.3 ? 2 : 1,
      i % 3 === 0 ? '#ffffff' : (color || '#ffd27a'), 'spark', 0.16, 0.94);
  }
  const shards = level >= 3 ? 9 : level === 2 ? 5 : 2;
  for (let i = 0; i < shards; i++) {
    const a = -Math.PI * 0.35 + (Math.random() - 0.5) * 1.6;
    const sp = 1.6 + Math.random() * 2.2;
    emit(x, y, Math.cos(a) * sp * facing, Math.sin(a) * sp,
      22 + Math.random() * 16, 2 + (Math.random() * 2 | 0), color || '#8fa6b8', 'shard', 0.26, 0.985);
  }
  if (level >= 2) {
    for (let i = 0; i < (level >= 3 ? 12 : 6); i++) {
      emit(x + (Math.random() - 0.5) * 16, y + (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 0.9, -0.25 - Math.random() * 0.5,
        26 + Math.random() * 16, 3 + (Math.random() * 2 | 0), '#aab4bd', 'dust', -0.02, 0.96);
    }
  }
}

/** 防御成功：蓝白护盾火花 */
export function blockSparks(x, y, facing) {
  for (let i = 0; i < 10; i++) {
    const a = (Math.random() - 0.5) * 1.8;
    emit(x, y, Math.cos(a) * 2.2 * facing, Math.sin(a) * 2.2,
      14 + Math.random() * 8, 1 + (Math.random() * 2 | 0),
      i % 2 ? '#9fe8ff' : '#e6f8ff', 'spark', 0.1, 0.93);
  }
  emit(x, y, 0, 0, 14, 18, '#6fd0ff', 'ring', 0, 1);
}

/** 地面/落点烟尘 */
export function dust(x, y, n, color, spread) {
  const count = Math.min(20, n);
  for (let i = 0; i < count; i++) {
    emit(x + (Math.random() - 0.5) * (spread || 24), y + (Math.random() - 0.5) * 8,
      (Math.random() - 0.5) * 1.2, -0.2 - Math.random() * 0.8,
      22 + Math.random() * 18, 2 + (Math.random() * 3 | 0), color || '#9aa6ad', 'dust', -0.02, 0.95);
  }
}

/** 冲击环 */
export function shockRing(x, y, color, size) {
  emit(x, y, 0, 0, 18, size || 20, color || '#bff0ff', 'ring', 0, 1);
}

/* ---- 超必杀演出 ---------------------------------------------------------- */

const SUPER_FX = {
  nova:   { color: '#ff6a3c', edge: '#ffd27a', ray: 0.9, beam: 0,    sparks: 34, flash: 0.34 },
  aqua:   { color: '#57d8ff', edge: '#d8fbff', ray: 1.2, beam: 0,    sparks: 26, flash: 0.28 },
  solar:  { color: '#ffc14d', edge: '#fff3b0', ray: 0.8, beam: 1,    sparks: 32, flash: 0.36 },
  noctis: { color: '#d05cff', edge: '#ff9bf5', ray: 1.0, beam: 0,    sparks: 30, flash: 0.30 },
  verde:  { color: '#57ffb0', edge: '#c9ff6f', ray: 0.7, beam: 0.6,  sparks: 28, flash: 0.26 },
  glace:  { color: '#7fdcff', edge: '#eaffff', ray: 0.9, beam: 0.8,  sparks: 30, flash: 0.32 }
};

function superStyle(def) {
  return SUPER_FX[def && def.id] || SUPER_FX.nova;
}

/** 超必杀起手：角色周围聚能环 + 向内收束的粒子 */
export function superCharge(def, x, y) {
  const s = superStyle(def);
  emit(x, y, 0, 0, 20, 12, s.edge, 'ring', 0, 1);
  emit(x, y, 0, 0, 24, 22, s.color, 'ring', 0, 1);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const r = 32 + Math.random() * 16;
    emit(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.8,
      -Math.cos(a) * 1.5, -Math.sin(a) * 1.2,
      18 + Math.random() * 8, 2, i % 3 ? s.color : s.edge, 'spark', 0, 0.94);
  }
}

/**
 * 超必杀释放：横向光线 + 冲击环 + 屏幕闪白 + 碎屑。
 * @param {object} def 角色定义
 * @param {number} x 释放点世界 x
 * @param {number} y 释放点屏幕 y（胸口高度）
 * @param {number} facing 朝向
 * @param {number} groundY 地面屏幕 y
 */
export function superBurst(def, x, y, facing, groundY) {
  const s = superStyle(def);
  screenFlash = { a: s.flash, color: s.edge };

  /* 主光线：沿朝向贯穿战场 */
  const ray = acquire();
  ray.active = true;
  ray.type = 'ray';
  ray.x = x + facing * 10;
  ray.y = y;
  ray.vx = 0; ray.vy = 0;
  ray.life = 30; ray.max = 30;
  ray.len = 430 * s.ray;
  ray.dir = facing;
  ray.h = 15;
  ray.color = s.color;
  ray.color2 = s.edge;
  ray.grav = 0; ray.drag = 1;

  /* 竖向光柱（太阳 / 大地 / 冰系） */
  if (s.beam > 0) {
    const beam = acquire();
    beam.active = true;
    beam.type = 'beam';
    beam.x = x + facing * 6;
    beam.y = groundY;
    beam.vx = 0; beam.vy = 0;
    beam.life = 34; beam.max = 34;
    beam.size = 34 * s.beam;
    beam.h = 300;
    beam.color = s.color;
    beam.color2 = s.edge;
    beam.grav = 0; beam.drag = 1;
  }

  /* 冲击环：由内向外扩散 */
  emit(x, y, 0, 0, 20, 16, s.edge, 'ring', 0, 1);
  emit(x, y, 0, 0, 24, 32, s.color, 'ring', 0, 1);
  emit(x, groundY - 4, 0, 0, 22, 22, s.color, 'ring', 0, 1);

  /* 前向火花与碎屑 */
  const n = s.sparks;
  for (let i = 0; i < n; i++) {
    const spread = (Math.random() - 0.5) * 1.5;
    const sp = 3 + Math.random() * 5;
    emit(x + facing * 12, y + (Math.random() - 0.5) * 20,
      Math.cos(spread) * sp * facing, Math.sin(spread) * sp,
      16 + Math.random() * 16, Math.random() < 0.35 ? 3 : 2,
      i % 4 === 0 ? '#ffffff' : (i % 2 ? s.color : s.edge), 'spark', 0.12, 0.93);
  }
  for (let i = 0; i < 10; i++) {
    emit(x + (Math.random() - 0.5) * 30, groundY - 4,
      (Math.random() - 0.5) * 3, -0.6 - Math.random() * 1.4,
      22 + Math.random() * 14, 3, s.color, 'dust', -0.03, 0.95);
  }
}

/** 屏幕空间闪白（在 HUD 之前调用） */
export function drawScreenFlash(ctx) {
  if (!screenFlash || screenFlash.a <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(0.7, screenFlash.a);
  ctx.fillStyle = screenFlash.color;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.restore();
}

/** 冲刺残影 */
export function ghost(def, action, t, x, y, facing, groundY) {
  ghosts.push({ def, action, t, x, y, facing, groundY, life: 10 });
  if (ghosts.length > 6) ghosts.shift();
}

/** 伤害数字 */
export function damageText(x, y, value, color) {
  texts.push({ x, y, text: String(value), color: color || '#ffe6a8', life: 40, max: 40 });
  if (texts.length > 8) texts.shift();
}

/** 每逻辑帧调用 */
export function updateFx() {
  for (let i = 0; i < MAX; i++) {
    const p = pool[i];
    if (!p.active) continue;
    p.x += p.vx;
    p.y += p.vy;
    p.vy += p.grav;
    p.vx *= p.drag;
    p.vy *= p.drag;
    if (p.type === 'ring') p.size += 2.1;
    p.life--;
    if (p.life <= 0) p.active = false;
  }
  for (let i = texts.length - 1; i >= 0; i--) {
    const t = texts[i];
    t.y -= 0.7;
    t.life--;
    if (t.life <= 0) texts.splice(i, 1);
  }
  for (let i = ghosts.length - 1; i >= 0; i--) {
    ghosts[i].life--;
    if (ghosts[i].life <= 0) ghosts.splice(i, 1);
  }
  if (screenFlash) {
    screenFlash.a -= 0.035;
    if (screenFlash.a <= 0) screenFlash = null;
  }
}

/** 残影（在角色之前绘制） */
export function drawGhosts(ctx) {
  for (const g of ghosts) {
    drawSprite(ctx, g.def, g.action, g.t, g.x, g.y, g.groundY, {
      facing: g.facing, alpha: (g.life / 10) * 0.35, bucket: 'ghost' + g.life
    });
  }
}

/** 粒子与伤害数字（在角色之后绘制） */
export function drawFx(ctx) {
  for (let i = 0; i < MAX; i++) {
    const p = pool[i];
    if (!p.active) continue;
    if (p.type === 'ring') {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.stroke();
    } else if (p.type === 'ray') {
      const k = p.life / p.max;
      const grow = Math.min(1, (1 - k) * 4);
      const len = p.len * grow;
      const th = p.h * (0.45 + k * 0.55);
      ctx.globalAlpha = 0.18 + k * 0.62;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y - th / 2, p.dir * len, th);
      ctx.globalAlpha = 0.25 + k * 0.65;
      ctx.fillStyle = p.color2;
      ctx.fillRect(p.x, p.y - th / 5, p.dir * len, th / 2.5);
      ctx.globalAlpha = 1;
    } else if (p.type === 'beam') {
      const t = 1 - p.life / p.max;
      const open = Math.min(1, t * 4);
      const w = p.size * open * (t > 0.55 ? Math.max(0.15, 1 - (t - 0.55) * 1.8) : 1);
      ctx.globalAlpha = 0.55 * (1 - t);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x - w / 2), Math.round(p.y - p.h), Math.round(w), Math.round(p.h));
      ctx.globalAlpha = 0.75 * (1 - t);
      ctx.fillStyle = p.color2;
      ctx.fillRect(Math.round(p.x - w / 5), Math.round(p.y - p.h), Math.max(2, Math.round(w / 2.5)), Math.round(p.h));
      ctx.globalAlpha = 1;
    } else if (p.type === 'dust') {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0.12, p.life / p.max) * 0.75;
      const s = p.size + (1 - p.life / p.max) * 3;
      ctx.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), Math.round(s), Math.round(s));
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
  }
  for (const t of texts) {
    const a = Math.min(1, t.life / 18);
    ctx.globalAlpha = a;
    text(ctx, t.text, t.x, t.y, { scale: 1, color: t.color, align: 'center', shadow: '#20100a' });
    ctx.globalAlpha = 1;
  }
}

/** 清空 */
export function resetFx() {
  for (const p of pool) p.active = false;
  texts.length = 0;
  ghosts.length = 0;
  screenFlash = null;
}
