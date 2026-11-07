/* =============================================================================
 * art/fx.js ── 特效对象池（火花 / 碎屑 / 烟尘 / 冲击环 / 残影 / 伤害数字）
 *  · 池容量固定 200，所有粒子复用，绝不每帧新建对象
 *  · 粒子按类型渲染为像素方块，符合整体像素风
 * ========================================================================== */
import { text } from '../core/pixel.js';
import { drawSprite } from './sprite.js';

const MAX = 200;
const pool = [];
for (let i = 0; i < MAX; i++) {
  pool.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 0, size: 1, color: '#fff', type: 'spark', grav: 0.18, drag: 0.98 });
}
let cursor = 0;

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
    if (p.type === 'ring') p.size += 2.6;
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
}
