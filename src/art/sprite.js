/* =============================================================================
 * art/sprite.js ── 光之战士分部件像素组装 + 调色板置换 + 离屏缓存
 *  · 同一套骨架，六个光之战士靠调色板 / 头冠 / 计时器 / 胸甲 / 体型系数区分
 *  · 怪兽骨架见 art/monster.js
 *  · 每帧绘制结果缓存到离屏 canvas，按「角色 + 动作 + 帧」索引，LRU 上限 120
 * ========================================================================== */
import { makeOffscreen } from '../core/canvas.js';
import { getPose } from './poses.js';
import { oct, seg, tri } from './shapes.js';
import {
  drawMonsterSprite, MONO,
  MON_W, MON_H, MON_OX, MON_OY
} from './monster.js';

const HERO_W = 184, HERO_H = 142, HERO_OX = 76, HERO_OY = 128;

const cache = new Map();
const CACHE_MAX = 120;

/* ---- 光之战士 ------------------------------------------------------------ */

function drawCrown(g, def, hx, hy, P, dark) {
  switch (def.crown) {
    case 'fin':
      tri(g, hx - 8, hy - 6, 7, 10, P.accent, dark);
      tri(g, hx - 1, hy - 7, 8, 13, P.accent, dark);
      tri(g, hx + 6, hy - 5, 6, 9, P.accent, dark);
      break;
    case 'blade':
      g.beginPath();
      g.moveTo(hx - 4, hy - 4);
      g.lineTo(hx + 16, hy - 16);
      g.lineTo(hx + 6, hy - 2);
      g.closePath();
      g.fillStyle = P.accent; g.fill();
      g.lineWidth = 2; g.strokeStyle = dark; g.stroke();
      break;
    case 'horn':
      tri(g, hx - 8, hy - 5, 6, 11, P.accent, dark);
      tri(g, hx + 3, hy - 6, 6, 14, P.accent, dark);
      break;
    case 'crest':
      g.beginPath();
      g.moveTo(hx - 2, hy - 6);
      g.lineTo(hx - 16, hy - 15);
      g.lineTo(hx - 4, hy - 2);
      g.closePath();
      g.fillStyle = P.accent; g.fill();
      g.lineWidth = 2; g.strokeStyle = dark; g.stroke();
      break;
    case 'block':
      oct(g, hx, hy - 8, 9, 4, P.metal, dark);
      break;
    default: // ring
      oct(g, hx - 1, hy - 8, 7, 4, P.metal, dark);
      oct(g, hx - 12, hy - 6, 3, 3, P.accent, dark);
      break;
  }
}

function drawTimer(g, def, x, y, P, dark) {
  const c = P.eye;
  g.lineWidth = 2; g.strokeStyle = dark;
  switch (def.timer) {
    case 'bar':
      g.fillStyle = P.metal; g.fillRect(x - 6, y - 3, 12, 6);
      g.strokeRect(x - 6, y - 3, 12, 6);
      g.fillStyle = c; g.fillRect(x - 4, y - 1, 8, 2);
      break;
    case 'cross':
      g.fillStyle = P.metal; g.fillRect(x - 5, y - 5, 10, 10);
      g.strokeRect(x - 5, y - 5, 10, 10);
      g.fillStyle = c; g.fillRect(x - 1, y - 4, 2, 8); g.fillRect(x - 4, y - 1, 8, 2);
      break;
    case 'circle':
      oct(g, x, y, 4, 4, P.metal, dark);
      g.fillStyle = c; g.fillRect(x - 1, y - 1, 2, 2);
      break;
    case 'hex':
      oct(g, x, y, 5, 4, P.metal, dark);
      g.fillStyle = c; g.fillRect(x - 2, y - 1, 4, 2);
      break;
    case 'ring':
      oct(g, x, y, 5, 5, P.metal, dark);
      oct(g, x, y, 2, 2, c, dark);
      break;
    default: // diamond
      g.beginPath();
      g.moveTo(x, y - 5); g.lineTo(x + 4, y); g.lineTo(x, y + 5); g.lineTo(x - 4, y);
      g.closePath();
      g.fillStyle = P.metal; g.fill(); g.stroke();
      g.fillStyle = c; g.fillRect(x - 1, y - 1, 2, 2);
      break;
  }
}

function drawChest(g, def, x, y, P) {
  g.fillStyle = P.accent;
  switch (def.chest) {
    case 'stripe':
      g.fillRect(x - 3, y - 9, 2, 18);
      g.fillRect(x + 2, y - 7, 2, 14);
      break;
    case 'wave':
      g.fillRect(x - 7, y - 6, 14, 2);
      g.fillRect(x - 5, y - 2, 10, 2);
      g.fillRect(x - 3, y + 2, 6, 2);
      break;
    case 'bolt':
      g.fillRect(x - 5, y - 8, 4, 8);
      g.fillRect(x - 1, y - 4, 6, 3);
      g.fillRect(x + 1, y, 4, 8);
      break;
    case 'plate':
      g.fillRect(x - 10, y - 8, 20, 3);
      g.fillRect(x - 10, y + 5, 20, 3);
      break;
    case 'core':
      oct(g, x, y, 5, 6, P.accent, P.dark);
      break;
    default: // v
      g.fillRect(x - 8, y - 8, 3, 10);
      g.fillRect(x + 5, y - 8, 3, 10);
      g.fillRect(x - 5, y + 1, 10, 3);
      break;
  }
}

function drawWeapon(g, def, hx, hy, ang, pose, P, dark) {
  const len = 26 * pose.blade;
  if (len < 2) return;
  const r = ang * Math.PI / 180;
  const ex = hx + Math.sin(r) * len, ey = hy + Math.cos(r) * len;
  const px = Math.cos(r) * 2.5, py = -Math.sin(r) * 2.5;
  g.beginPath();
  g.moveTo(hx + px, hy + py);
  g.lineTo(ex, ey);
  g.lineTo(hx - px, hy - py);
  g.closePath();
  g.fillStyle = P.accent; g.fill();
  g.lineWidth = 2; g.strokeStyle = dark; g.stroke();
  g.fillStyle = P.eye;
  g.fillRect(Math.round(ex) - 1, Math.round(ey) - 1, 2, 2);
}

function drawHeroSprite(g, def, pose, flash) {
  const P = flash ? MONO : def.palette;
  const dark = flash ? '#fff' : P.dark;
  const B = def.body;
  const drop = pose.dy + pose.crouch * 24;
  const hipX = HERO_OX, hipY = HERO_OY - 52 + drop;
  const lean = pose.lean * Math.PI / 180;
  const torsoLen = 33 * B.bulk;
  const sx = hipX + Math.sin(lean) * torsoLen;
  const sy = hipY - Math.cos(lean) * torsoLen;

  /* 后腿 */
  const hipB = { x: hipX - 4 * B.w, y: hipY };
  const kb1 = seg(g, hipB.x, hipB.y, pose.legB[0], 27 * B.leg, 11, 8, P.suit2, dark);
  seg(g, kb1.x, kb1.y, pose.legB[0] + pose.legB[1], 27 * B.leg, 8, 6, P.suit2, dark);
  /* 后臂 */
  const shB = { x: sx - 9 * B.shoulder, y: sy + 2 };
  const eb1 = seg(g, shB.x, shB.y, pose.armB[0], 17, 9, 7, P.suit2, dark);
  seg(g, eb1.x, eb1.y, pose.armB[0] + pose.armB[1], 16, 7, 6, P.suit2, dark);

  /* 躯干 */
  g.beginPath();
  g.moveTo(hipX - 7 * B.w, hipY);
  g.lineTo(sx - 11 * B.shoulder, sy);
  g.lineTo(sx + 11 * B.shoulder, sy);
  g.lineTo(hipX + 7 * B.w, hipY);
  g.closePath();
  g.fillStyle = P.suit; g.fill();
  g.lineWidth = 2; g.strokeStyle = dark; g.stroke();

  /* 胸甲 */
  g.beginPath();
  g.moveTo(sx - 10 * B.shoulder, sy + 1);
  g.lineTo(sx + 10 * B.shoulder, sy + 1);
  g.lineTo(sx + 7 * B.shoulder, sy + 13);
  g.lineTo(sx - 7 * B.shoulder, sy + 13);
  g.closePath();
  g.fillStyle = P.base2; g.fill();
  g.lineWidth = 2; g.strokeStyle = dark; g.stroke();
  drawChest(g, def, sx, sy + 7, P);
  drawTimer(g, def, sx, sy + 8, P, dark);

  /* 前腿 */
  const hipF = { x: hipX + 4 * B.w, y: hipY };
  const kf1 = seg(g, hipF.x, hipF.y, pose.legF[0], 27 * B.leg, 12, 9, P.suit, dark);
  const ft = seg(g, kf1.x, kf1.y, pose.legF[0] + pose.legF[1], 27 * B.leg, 9, 7, P.suit, dark);
  /* 战靴 */
  g.fillStyle = P.metal;
  g.fillRect(Math.round(ft.x) - 5, Math.round(ft.y) - 3, 11, 5);
  g.lineWidth = 2; g.strokeStyle = dark; g.strokeRect(Math.round(ft.x) - 5, Math.round(ft.y) - 3, 11, 5);

  /* 肩甲 */
  oct(g, sx - 12 * B.shoulder, sy + 1, 7, 6, P.metal, dark);
  oct(g, sx + 12 * B.shoulder, sy + 1, 7, 6, P.metal, dark);

  /* 头 */
  const headAng = (pose.lean + pose.head) * Math.PI / 180;
  const hx = sx + Math.sin(headAng) * 5;
  const hy = sy - 11;
  oct(g, hx, hy, 9, 8, P.base, dark);
  /* 发光双眼 */
  g.fillStyle = P.eye;
  g.fillRect(Math.round(hx + 1), Math.round(hy - 2), 4, 2);
  g.fillRect(Math.round(hx + 7), Math.round(hy - 2), 3, 2);
  /* 头冠 */
  drawCrown(g, def, hx, hy + 6, P, dark);

  /* 前臂 + 武器 */
  const shF = { x: sx + 9 * B.shoulder, y: sy + 2 };
  const ef = seg(g, shF.x, shF.y, pose.armF[0], 17, 10, 8, P.suit, dark);
  const hand = seg(g, ef.x, ef.y, pose.armF[0] + pose.armF[1], 16, 8, 6, P.base2, dark);
  drawWeapon(g, def, hand.x, hand.y, pose.armF[0] + pose.armF[1], pose, P, dark);
}

/* ---- 缓存 ---------------------------------------------------------------- */

function buildSprite(def, action, t, flash) {
  const hero = !def.kind;
  const W = hero ? HERO_W : MON_W;
  const H = hero ? HERO_H : MON_H;
  const o = makeOffscreen(W, H);
  const g = o.ctx;
  g.lineJoin = 'miter';
  g.miterLimit = 2;
  const pose = getPose(def, action, Math.max(0, Math.min(1, t)));
  if (hero) drawHeroSprite(g, def, pose, flash);
  else drawMonsterSprite(g, def, pose, flash);
  return { canvas: o.canvas, ox: hero ? HERO_OX : MON_OX, oy: hero ? HERO_OY : MON_OY };
}

/**
 * 取精灵（带缓存）。
 * @param {object} def 角色/怪兽定义
 * @param {string} action 动作名
 * @param {number} t 动作进度 0..1
 * @param {string|number} bucket 缓存分桶（同一动作的离散帧号）
 * @param {boolean} flash 是否白色受击剪影
 */
export function getSprite(def, action, t, bucket, flash) {
  const key = def.id + '|' + action + '|' + bucket + (flash ? '|f' : '');
  let s = cache.get(key);
  if (s) return s;
  s = buildSprite(def, action, t, !!flash);
  cache.set(key, s);
  if (cache.size > CACHE_MAX) {
    const first = cache.keys().next().value;
    cache.delete(first);
  }
  return s;
}

/**
 * 直接绘制精灵到画布（自动处理朝向）。
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} def
 * @param {string} action
 * @param {number} t
 * @param {number} x 脚底世界 x
 * @param {number} y 脚底高度（世界坐标，0=地面）
 * @param {number} groundY 地面屏幕 y
 * @param {{facing?:number, bucket?:string|number, flash?:boolean, alpha?:number, tint?:string}} [opt]
 */
export function drawSprite(ctx, def, action, t, x, y, groundY, opt = {}) {
  const bucket = opt.bucket == null ? Math.round(t * 5) : opt.bucket;
  const meta = getSprite(def, action, t, bucket, opt.flash);
  const facing = opt.facing == null ? 1 : opt.facing;
  ctx.save();
  if (opt.alpha != null) ctx.globalAlpha = opt.alpha;
  ctx.translate(Math.round(x), Math.round(groundY - y));
  if (facing < 0) ctx.scale(-1, 1);
  ctx.drawImage(meta.canvas, -meta.ox, -meta.oy);
  ctx.restore();
}

/** 清空缓存（切换角色/重开时调用，避免显存堆积） */
export function clearSpriteCache() {
  cache.clear();
}
