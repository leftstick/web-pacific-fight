/* =============================================================================
 * art/sprite.js ── 光之战士分角色像素绘制 + 离屏缓存
 *  · 造型语言统一为「光之巨人」：银白主体 + 彩色分色 + 巨型发光眼 + 中央头冠
 *  · 宽肩窄腰、粗壮四肢、长靴护腕，头部约 24px，整体 6.5~7 头身
 *  · 六名战士的头部/头冠/胸甲/核心/武器各自独立；怪兽绘制见 art/monster.js
 *  · 每帧结果缓存到离屏 canvas，LRU 上限 120
 * ========================================================================== */
import { makeOffscreen } from '../core/canvas.js';
import { getPose } from './poses.js';
import { oct, seg, tri } from './shapes.js';
import {
  drawMonsterSprite, MONO,
  MON_W, MON_H, MON_OX, MON_OY
} from './monster.js';

/* 画布 220×170：脚底在 162，头顶约 16，头冠最高约 4，总高约 158 */
const HERO_W = 220, HERO_H = 170, HERO_OX = 96, HERO_OY = 162;

const cache = new Map();
const CACHE_MAX = 120;

/* ---- 共享骨架 ------------------------------------------------------------ */

function rig(def, pose) {
  const B = def.body || { w: 1, shoulder: 1, bulk: 1, leg: 1 };
  const drop = (pose.dy || 0) + (pose.crouch || 0) * 30;
  const hipX = HERO_OX;
  const hipY = HERO_OY - 72 + drop;
  const lean = (pose.lean || 0) * Math.PI / 180;
  const torsoLen = 44 * (0.94 + (B.bulk || 1) * 0.06);
  const sx = hipX + Math.sin(lean) * torsoLen;
  const sy = hipY - Math.cos(lean) * torsoLen;
  const headAng = ((pose.lean || 0) + (pose.head || 0)) * Math.PI / 180;
  return { B, drop, hipX, hipY, lean, torsoLen, sx, sy, headAng };
}

function leg(g, x, y, a1, a2, B, col, dark, thigh, shin, w0, w1, w2) {
  const t = thigh * (B.leg || 1);
  const s = shin * (B.leg || 1);
  const k = seg(g, x, y, a1, t, w0, w1, col, dark);
  return seg(g, k.x, k.y, a1 + a2, s, w1, w2, col, dark);
}

/** 无描边的肢体分色条，贴在肢体外侧 */
function stripeSeg(g, x, y, ang, len, w0, w1, col, side) {
  const r = ang * Math.PI / 180;
  const ex = x + Math.sin(r) * len;
  const ey = y + Math.cos(r) * len;
  const px = Math.cos(r), py = -Math.sin(r);
  const a0 = w0 * 0.08 * side, a1 = w0 * 0.5 * side;
  const b0 = w1 * 0.08 * side, b1 = w1 * 0.5 * side;
  g.beginPath();
  g.moveTo(x + px * a0, y + py * a0);
  g.lineTo(ex + px * b0, ey + py * b0);
  g.lineTo(ex + px * b1, ey + py * b1);
  g.lineTo(x + px * a1, y + py * a1);
  g.closePath();
  g.fillStyle = col;
  g.fill();
}

function legStripe(g, x, y, a1, a2, B, thigh, shin, w0, w1, w2, col, side) {
  const t = thigh * (B.leg || 1);
  const s = shin * (B.leg || 1);
  stripeSeg(g, x, y, a1, t, w0, w1, col, side);
  const r = a1 * Math.PI / 180;
  const kx = x + Math.sin(r) * t;
  const ky = y + Math.cos(r) * t;
  stripeSeg(g, kx, ky, a1 + a2, s, w1, w2, col, side);
}

/** 厚重战靴：鞋体 + 彩色靴口 + 深色鞋底 */
function boot(g, x, y, col, dark, forward, w, h, trim) {
  const bw = w || 13;
  const bh = h || 6;
  const bx = Math.round(x) - (bw >> 1) + (forward || 0);
  const by = Math.round(y) - bh;
  g.fillStyle = col;
  g.fillRect(bx, by, bw, bh);
  g.lineWidth = 2;
  g.strokeStyle = dark;
  g.strokeRect(bx, by, bw, bh);
  if (trim) {
    g.fillStyle = trim;
    g.fillRect(bx + 1, by, bw - 2, 2);
  }
  g.fillStyle = dark;
  g.fillRect(bx + 1, by + bh - 1, bw - 2, 1);
}

/** 粗壮手臂：上臂 / 前臂各一段，末端返回手掌位置 */
function arm(g, x, y, a1, a2, upCol, foreCol, dark, o) {
  const opt = o || {};
  const up = opt.up || 25;
  const fore = opt.fore || 23;
  const e = seg(g, x, y, a1, up, opt.uw || 11, opt.ew || 9, upCol, dark);
  const h = seg(g, e.x, e.y, a1 + a2, fore, opt.ew || 9, opt.hw || 7, foreCol, dark);
  return { elbow: e, hand: h };
}

/** 拳头 / 手甲 */
function fist(g, x, y, col, dark, r) {
  const s = r || 4.2;
  oct(g, x, y - s * 0.15, s, s * 0.86, col, dark);
}

/* ---- 光之巨人头部 -------------------------------------------------------- */

/** 斜置杏仁形发光巨眼 */
function ultraEye(g, x, y, dir, col, dark, rx, ry) {
  g.save();
  g.translate(x, y);
  g.rotate(dir * 0.17);
  g.beginPath();
  g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  g.fillStyle = col;
  g.fill();
  g.lineWidth = 1.6;
  g.strokeStyle = dark;
  g.stroke();
  g.restore();
  g.fillStyle = '#ffffff';
  g.fillRect(Math.round(x - rx * 0.45), Math.round(y - ry * 0.5), 1.5, 1.5);
}

/** 银白头部：上宽下窄、下颌收尖 */
function headBase(g, hx, hy, rx, ry, col, dark) {
  g.beginPath();
  g.moveTo(hx - rx * 0.62, hy - ry);
  g.quadraticCurveTo(hx, hy - ry * 1.14, hx + rx * 0.62, hy - ry);
  g.quadraticCurveTo(hx + rx * 1.02, hy - ry * 0.72, hx + rx * 0.96, hy - ry * 0.05);
  g.quadraticCurveTo(hx + rx * 0.86, hy + ry * 0.55, hx + rx * 0.4, hy + ry * 0.92);
  g.quadraticCurveTo(hx, hy + ry * 1.16, hx - rx * 0.4, hy + ry * 0.92);
  g.quadraticCurveTo(hx - rx * 0.86, hy + ry * 0.55, hx - rx * 0.96, hy - ry * 0.05);
  g.quadraticCurveTo(hx - rx * 1.02, hy - ry * 0.72, hx - rx * 0.62, hy - ry);
  g.closePath();
  g.fillStyle = col;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = dark;
  g.stroke();
}

/** 面颊两侧的彩色分色带（奥特曼头部的侧脸 / 耳鳍） */
function cheekPanel(g, hx, hy, rx, ry, col, dark) {
  for (const d of [-1, 1]) {
    g.beginPath();
    g.moveTo(hx + d * rx * 0.86, hy - ry * 0.55);
    g.lineTo(hx + d * rx * 1.0, hy - ry * 0.35);
    g.quadraticCurveTo(hx + d * rx * 0.98, hy + ry * 0.35, hx + d * rx * 0.8, hy + ry * 0.62);
    g.lineTo(hx + d * rx * 0.72, hy + ry * 0.45);
    g.quadraticCurveTo(hx + d * rx * 0.86, hy + ry * 0.05, hx + d * rx * 0.76, hy - ry * 0.5);
    g.closePath();
    g.fillStyle = col;
    g.fill();
    g.lineWidth = 1.4;
    g.strokeStyle = dark;
    g.stroke();
  }
}

function foreheadLamp(g, x, y, col, dark, r) {
  const s = r || 2.6;
  g.beginPath();
  g.moveTo(x, y - s * 1.5);
  g.lineTo(x + s, y);
  g.lineTo(x, y + s * 1.5);
  g.lineTo(x - s, y);
  g.closePath();
  g.fillStyle = col;
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = dark;
  g.stroke();
  g.fillStyle = '#ffffff';
  g.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
}

/**
 * 统一头部组装。
 * o: { rx, ry, headCol, panel, eyeCol, eyeRx, eyeRy, pod, lamp, crest(g,hx,hy,rx,ry) }
 */
function ultraHead(g, R, P, o) {
  const dark = P.dark;
  const rx = o.rx || 10.4;
  const ry = o.ry || 12.3;
  const hx = R.sx + Math.sin(R.headAng) * 8;
  const hy = R.sy - 17;

  seg(g, R.sx, R.sy - 1, 0, 8, o.neckW || 8.5, 10, o.neckCol || P.suit2, dark);
  headBase(g, hx, hy, rx, ry, o.headCol || P.base, dark);
  if (o.crest) o.crest(g, hx, hy, rx, ry);
  if (o.panel) cheekPanel(g, hx, hy, rx, ry, o.panel, dark);

  const erx = o.eyeRx || 4.5, ery = o.eyeRy || 3.15;
  ultraEye(g, hx - 5.05, hy - 0.5, -1, o.eyeCol || P.eye, dark, erx, ery);
  ultraEye(g, hx + 5.05, hy - 0.5, 1, o.eyeCol || P.eye, dark, erx, ery);

  /* 嘴部细线 */
  g.strokeStyle = dark;
  g.lineWidth = 1.4;
  g.beginPath();
  g.moveTo(hx - 2.6, hy + ry * 0.66);
  g.lineTo(hx + 2.6, hy + ry * 0.66);
  g.stroke();

  if (o.pod) {
    for (const d of [-1, 1]) {
      g.beginPath();
      g.ellipse(hx + d * rx * 0.9, hy + ry * 0.34, 2.4, 4, 0, 0, Math.PI * 2);
      g.fillStyle = o.pod;
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = dark;
      g.stroke();
    }
  }
  if (o.lamp) foreheadLamp(g, hx, hy - ry * 0.52, o.lamp, dark);
  return { hx, hy };
}

/* ---- 头冠变体 ------------------------------------------------------------ */

/** 中央刀刃冠（诺瓦） */
function crestBlade(g, hx, hy, rx, ry, col, trim, dark) {
  g.beginPath();
  g.moveTo(hx - 6, hy - ry * 0.78);
  g.quadraticCurveTo(hx - 5, hy - ry - 7, hx - 2, hy - ry - 14);
  g.lineTo(hx + 1.5, hy - ry - 14);
  g.quadraticCurveTo(hx + 6, hy - ry - 7, hx + 6, hy - ry * 0.55);
  g.lineTo(hx + 3, hy - ry * 0.5);
  g.closePath();
  g.fillStyle = col;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = dark;
  g.stroke();
  g.strokeStyle = trim;
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(hx + 0.5, hy - ry - 1.5);
  g.lineTo(hx - 0.8, hy - ry - 11);
  g.stroke();
}

/** 后掠旗鳍（阿库亚）：从额前向后上方掀起的中置鳍 */
function crestSail(g, hx, hy, rx, ry, col, trim, dark) {
  g.beginPath();
  g.moveTo(hx - 4.5, hy - ry * 0.76);
  g.quadraticCurveTo(hx - 8.5, hy - ry - 2, hx - 14.5, hy - ry - 8.5);
  g.quadraticCurveTo(hx - 9, hy - ry - 6.5, hx - 4, hy - ry - 5.5);
  g.quadraticCurveTo(hx + 1.5, hy - ry - 4.5, hx + 4.5, hy - ry * 0.55);
  g.closePath();
  g.fillStyle = col;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = dark;
  g.stroke();
  g.strokeStyle = trim;
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(hx - 12.5, hy - ry - 7);
  g.lineTo(hx - 5, hy - ry - 5);
  g.stroke();
}

/** 双角冠（索拉） */
function crestHorns(g, hx, hy, rx, ry, col, base, dark) {
  for (const d of [-1, 1]) {
    g.beginPath();
    g.moveTo(hx + d * 3.5, hy - ry * 0.9);
    g.lineTo(hx + d * 13.5, hy - ry - 8);
    g.lineTo(hx + d * 8.5, hy - ry * 0.4);
    g.closePath();
    g.fillStyle = col;
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = dark;
    g.stroke();
    g.fillStyle = base;
    g.beginPath();
    g.moveTo(hx + d * 4.5, hy - ry * 0.78);
    g.lineTo(hx + d * 8.5, hy - ry * 0.62);
    g.lineTo(hx + d * 8.5, hy - ry * 0.42);
    g.closePath();
    g.fill();
  }
}

/** 头镖（奈克缇）：从额前向后上方伸出的厚刃 */
function crestSlugger(g, hx, hy, rx, ry, col, edge, dark) {
  g.beginPath();
  g.moveTo(hx + 2.5, hy - ry * 0.9);
  g.lineTo(hx - 7, hy - ry - 11);
  g.lineTo(hx - 12, hy - ry - 6.5);
  g.lineTo(hx - 3.5, hy - ry * 0.5);
  g.closePath();
  g.fillStyle = col;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = dark;
  g.stroke();
  g.strokeStyle = edge;
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(hx - 3, hy - ry * 0.8);
  g.lineTo(hx - 8.5, hy - ry - 9.5);
  g.stroke();
}

/** 藤蔓枝冠（维尔德） */
function crestBranch(g, hx, hy, rx, ry, col, leaf, dark) {
  g.strokeStyle = col;
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(hx - 4, hy - ry * 0.78);
  g.quadraticCurveTo(hx - 11, hy - ry - 2, hx - 15, hy - ry - 7);
  g.moveTo(hx + 4, hy - ry * 0.78);
  g.quadraticCurveTo(hx + 11, hy - ry - 2, hx + 15, hy - ry - 7);
  g.stroke();
  tri(g, hx - 20, hy - ry - 5, 6, 7, leaf, dark);
  tri(g, hx + 9, hy - ry - 7, 6, 7, leaf, dark);
}

/** 冰棱冠（格莱斯） */
function crestIce(g, hx, hy, rx, ry, col, light, dark) {
  const y = hy - ry * 0.74;
  tri(g, hx - rx * 0.95, y, 5.5, 8, col, dark);
  tri(g, hx - rx * 0.42, y - 1, 6.5, 14, light, dark);
  tri(g, hx + 1, y, 6, 10, col, dark);
  tri(g, hx + rx * 0.46, y, 5.5, 7, light, dark);
}

/* ---- 躯干 / 肩甲 / 计时器 ------------------------------------------------ */

/**
 * 银白躯干 + 彩色侧板。
 * o: { shoulder, waist, hip, bodyCol, panelCol, collarCol, chevron }
 */
function ultraTorso(g, R, P, o) {
  const B = R.B, dark = P.dark;
  const sw = (o.shoulder || 14) * B.shoulder;
  const ww = (o.waist || 8) * B.w;
  const hp = (o.hip || 10) * B.w;
  const sx = R.sx, sy = R.sy, hipX = R.hipX, hipY = R.hipY;

  g.beginPath();
  g.moveTo(sx - sw, sy + 1);
  g.lineTo(sx - sw * 0.9, sy + 9);
  g.lineTo(sx - ww, hipY - 13);
  g.lineTo(sx - hp, hipY);
  g.lineTo(sx + hp, hipY);
  g.lineTo(sx + ww, hipY - 13);
  g.lineTo(sx + sw * 0.9, sy + 9);
  g.lineTo(sx + sw, sy + 1);
  g.closePath();
  g.fillStyle = o.bodyCol || P.base;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = dark;
  g.stroke();

  if (o.panelCol) {
    for (const d of [-1, 1]) {
      g.beginPath();
      g.moveTo(sx + d * sw, sy + 1);
      g.lineTo(sx + d * sw * 0.52, sy + 2);
      g.lineTo(sx + d * ww * 0.85, hipY - 10);
      g.lineTo(sx + d * hp, hipY);
      g.lineTo(sx + d * ww, hipY - 13);
      g.lineTo(sx + d * sw * 0.88, sy + 10);
      g.closePath();
      g.fillStyle = o.panelCol;
      g.fill();
      g.strokeStyle = dark;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(sx + d * sw * 0.52, sy + 2);
      g.lineTo(sx + d * ww * 0.85, hipY - 10);
      g.stroke();
    }
  }

  if (o.collarCol) {
    g.strokeStyle = o.collarCol;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(sx - sw * 0.68, sy + 1);
    g.lineTo(sx, sy + 8);
    g.lineTo(sx + sw * 0.68, sy + 1);
    g.stroke();
  }

  if (o.chevron) {
    g.lineJoin = 'miter';
    g.strokeStyle = dark;
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(sx - sw * 0.86, sy + 2);
    g.lineTo(sx - sw * 0.3, sy + 11);
    g.lineTo(sx, sy + 15);
    g.lineTo(sx + sw * 0.3, sy + 11);
    g.lineTo(sx + sw * 0.86, sy + 2);
    g.stroke();
    g.strokeStyle = o.chevron;
    g.lineWidth = 5;
    g.stroke();
  }
}

/** 斜向外扩的梯形肩甲，替代圆球肩 */
function pauldron(g, x, y, dir, col, edge, dark, w, h) {
  const W = w || 10, H = h || 8;
  g.beginPath();
  g.moveTo(x - dir * 4, y - H * 0.5);
  g.lineTo(x + dir * (W - 2), y - H * 0.65);
  g.lineTo(x + dir * (W + 1), y + H * 0.2);
  g.lineTo(x - dir * 2, y + H * 0.55);
  g.closePath();
  g.fillStyle = col;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = dark;
  g.stroke();
  if (edge) {
    g.strokeStyle = edge;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x - dir * 2, y - H * 0.34);
    g.lineTo(x + dir * (W * 0.9), y - H * 0.5);
    g.stroke();
  }
}

function roundCore(g, x, y, r, P, dark) {
  g.strokeStyle = P.accent;
  g.lineWidth = 1;
  g.beginPath();
  g.arc(x, y, r + 3.2, 0, Math.PI * 2);
  g.stroke();
  oct(g, x, y, r + 1.6, r + 1.6, P.metal, dark);
  oct(g, x, y, r, r, P.eye, dark);
  g.fillStyle = '#ffffff';
  g.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
}

function sunCore(g, x, y, P, dark, flame) {
  g.strokeStyle = flame;
  g.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    g.beginPath();
    g.moveTo(x + Math.cos(a) * 6, y + Math.sin(a) * 6);
    g.lineTo(x + Math.cos(a) * 10, y + Math.sin(a) * 10);
    g.stroke();
  }
  oct(g, x, y, 6, 6, P.metal, dark);
  oct(g, x, y, 3.6, 3.6, P.eye, dark);
  g.fillStyle = '#ffffff';
  g.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
}

function leafCore(g, x, y, r, col, trim, dark) {
  g.beginPath();
  g.moveTo(x, y - r);
  g.quadraticCurveTo(x + r * 0.9, y, x, y + r);
  g.quadraticCurveTo(x - r * 0.9, y, x, y - r);
  g.closePath();
  g.fillStyle = col;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = dark;
  g.stroke();
  g.strokeStyle = trim;
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(x, y - r * 0.7);
  g.lineTo(x, y + r * 0.6);
  g.stroke();
}

function starCore(g, x, y, r, col, dark) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.fillStyle = col;
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = dark;
  g.stroke();
}

function heroHex(g, cx, cy, r, col, dark) {
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 3;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
  g.fillStyle = col;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = dark;
  g.stroke();
}

function blade(g, x, y, ang, pose, col, edge, dark, o) {
  const opt = o || {};
  const len = (opt.base || 18) + (opt.grow || 24) * (pose.blade || 0);
  const r = ang * Math.PI / 180;
  const dx = Math.sin(r), dy = Math.cos(r);
  const px = Math.cos(r), py = -Math.sin(r);
  const w = opt.width || 4;
  g.beginPath();
  g.moveTo(x + px * 2, y + py * 2);
  g.lineTo(x + dx * len * 0.78 + px * w, y + dy * len * 0.78 + py * w);
  g.lineTo(x + dx * len, y + dy * len);
  g.lineTo(x + dx * len * 0.78 - px * w, y + dy * len * 0.78 - py * w);
  g.lineTo(x - px * 2, y - py * 2);
  g.closePath();
  g.fillStyle = col;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = dark;
  g.stroke();
  g.strokeStyle = edge;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x + px * 2, y + py * 2);
  g.lineTo(x + dx * len, y + dy * len);
  g.stroke();
}

function gauntlet(g, x, y, col, glow, dark, power, flash) {
  const s = 6 + Math.min(3, (power || 0) * 4);
  if (!flash && power > 0.22) {
    g.globalAlpha = 0.18 + power * 0.28;
    g.fillStyle = glow;
    g.beginPath();
    g.arc(x, y, s + 4 + power * 5, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
  }
  oct(g, x, y, s, s * 0.86, col, dark);
  g.fillStyle = glow;
  g.fillRect(Math.round(x) - 2, Math.round(y) - 2, 4, 4);
}

function belt(g, x, y, w, col, dark) {
  g.fillStyle = col;
  g.fillRect(Math.round(x - w / 2), Math.round(y) - 2, w, 5);
  g.lineWidth = 2;
  g.strokeStyle = dark;
  g.strokeRect(Math.round(x - w / 2), Math.round(y) - 2, w, 5);
}

function drawBow(g, x, y, pose, P, dark, flash) {
  const power = pose.blade || 0;
  g.save();
  g.translate(x, y);
  g.strokeStyle = P.metal;
  g.lineWidth = 2.5;
  g.beginPath();
  g.arc(0, 0, 12, -1.1, 1.1);
  g.stroke();
  g.strokeStyle = flash ? '#fff' : P.accent;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(12 * Math.cos(-1.1), 12 * Math.sin(-1.1));
  g.lineTo(12 * Math.cos(1.1), 12 * Math.sin(1.1));
  g.stroke();
  if (power > 0.18) {
    g.strokeStyle = flash ? '#fff' : P.eye;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-6, 0);
    g.lineTo(10 + power * 22, 0);
    g.stroke();
  }
  g.strokeStyle = dark;
  g.lineWidth = 2;
  g.beginPath();
  g.arc(0, 0, 12, -1.1, 1.1);
  g.stroke();
  g.restore();
}

/* ---- ① 炽核·诺瓦：中央刀刃冠 + 红银分色 + 圆形计时器 + 黄色巨眼 ---------- */

function drawNova(g, def, pose, P, flash) {
  const R = rig(def, pose), B = R.B, dark = P.dark;
  const red = flash ? '#fff' : '#e03a2c';
  const red2 = flash ? '#fff' : '#a82418';
  const eye = flash ? '#fff' : '#ffc21a';

  /* 后腿 */
  const kb = leg(g, R.hipX - 5 * B.w, R.hipY, pose.legB[0], pose.legB[1], B, P.base2, dark, 36, 34, 14, 10, 7.5);
  legStripe(g, R.hipX - 5 * B.w, R.hipY, pose.legB[0], pose.legB[1], B, 36, 34, 14, 10, 7.5, red2, -1);
  boot(g, kb.x, kb.y, red2, dark, 0, 14, 6, red);

  /* 后臂 */
  pauldron(g, R.sx - 14 * B.shoulder, R.sy + 3, -1, red2, null, dark, 11, 8);
  const ab = arm(g, R.sx - 13 * B.shoulder, R.sy + 4, pose.armB[0], pose.armB[1], P.base2, red2, dark, { uw: 12, ew: 10, hw: 8 });
  fist(g, ab.hand.x, ab.hand.y, P.base2, dark, 4.4);

  /* 躯干 */
  ultraTorso(g, R, P, {
    shoulder: 14, waist: 8, hip: 9.5,
    bodyCol: P.metal, panelCol: red, collarCol: red2, chevron: red
  });

  /* 前腿 + 腰带 */
  const kf = leg(g, R.hipX + 5 * B.w, R.hipY, pose.legF[0], pose.legF[1], B, P.base, dark, 37, 35, 15, 11, 8);
  legStripe(g, R.hipX + 5 * B.w, R.hipY, pose.legF[0], pose.legF[1], B, 37, 35, 15, 11, 8, red, 1);
  boot(g, kf.x, kf.y, red, dark, 2, 15, 7, red2);
  belt(g, R.hipX, R.hipY - 2, 20 * B.w, red2, dark);

  /* 计时器 */
  roundCore(g, R.sx, R.sy + 20, 6.2, P, dark);

  /* 头 */
  ultraHead(g, R, P, {
    rx: 10.4, ry: 12.4,
    headCol: P.base,
    panel: red,
    eyeCol: eye,
    eyeRx: 4.6, eyeRy: 3.2,
    pod: red2,
    crest: function (gg, hx, hy, rx, ry) {
      crestBlade(gg, hx, hy, rx, ry, P.metal, red, dark);
    }
  });

  /* 前臂 + 肩甲 + 光刃 */
  const af = arm(g, R.sx + 13 * B.shoulder, R.sy + 4, pose.armF[0], pose.armF[1], P.base, red, dark, { uw: 13, ew: 10, hw: 8 });
  fist(g, af.hand.x, af.hand.y, P.metal, dark, 4.6);
  pauldron(g, R.sx + 14 * B.shoulder, R.sy + 3, 1, red, P.accent, dark, 12, 9);
  blade(g, af.hand.x, af.hand.y, pose.armF[0] + pose.armF[1], pose, P.metal, eye, dark, { base: 16, grow: 26, width: 4 });
}

/* ---- ② 苍澜·阿库亚：后掠旗鳍 + 蓝银分色 + 额头光束灯 + 光弓 ------------ */

function drawAqua(g, def, pose, P, flash) {
  const R = rig(def, pose), B = R.B, dark = P.dark;
  const blue = flash ? '#fff' : '#2e8fd6';
  const blue2 = flash ? '#fff' : '#17537f';
  const eye = flash ? '#fff' : '#3fd6ff';

  const kb = leg(g, R.hipX - 4 * B.w, R.hipY, pose.legB[0], pose.legB[1], B, P.base2, dark, 35, 33, 12.5, 9, 6.5);
  legStripe(g, R.hipX - 4 * B.w, R.hipY, pose.legB[0], pose.legB[1], B, 35, 33, 12.5, 9, 6.5, blue2, -1);
  boot(g, kb.x, kb.y, blue2, dark, 0, 12.5, 6, blue);

  pauldron(g, R.sx - 12.5 * B.shoulder, R.sy + 3, -1, blue2, null, dark, 10, 7.5);
  const ab = arm(g, R.sx - 11.5 * B.shoulder, R.sy + 4, pose.armB[0], pose.armB[1], P.base2, blue2, dark, { uw: 11, ew: 9, hw: 7.5 });
  fist(g, ab.hand.x, ab.hand.y, P.base2, dark, 4);

  ultraTorso(g, R, P, {
    shoulder: 12.5, waist: 7, hip: 8.5,
    bodyCol: P.metal, panelCol: blue, collarCol: blue2, chevron: blue
  });

  const kf = leg(g, R.hipX + 4 * B.w, R.hipY, pose.legF[0], pose.legF[1], B, P.base, dark, 36, 34, 13, 9.5, 7);
  legStripe(g, R.hipX + 4 * B.w, R.hipY, pose.legF[0], pose.legF[1], B, 36, 34, 13, 9.5, 7, blue, 1);
  boot(g, kf.x, kf.y, blue, dark, 2, 13, 6, blue2);
  belt(g, R.hipX, R.hipY - 2, 17 * B.w, blue2, dark);

  roundCore(g, R.sx, R.sy + 19, 5.8, P, dark);

  ultraHead(g, R, P, {
    rx: 10, ry: 12.2,
    headCol: P.base,
    panel: blue,
    eyeCol: eye,
    eyeRx: 4.4, eyeRy: 3.05,
    pod: blue2,
    lamp: P.accent,
    crest: function (gg, hx, hy, rx, ry) {
      crestSail(gg, hx, hy, rx, ry, P.base2, blue, dark);
    }
  });

  const af = arm(g, R.sx + 11.5 * B.shoulder, R.sy + 4, pose.armF[0], pose.armF[1], P.base, blue, dark, { uw: 12, ew: 9.5, hw: 7.5 });
  fist(g, af.hand.x, af.hand.y, P.metal, dark, 4.2);
  pauldron(g, R.sx + 12.5 * B.shoulder, R.sy + 3, 1, blue, P.accent, dark, 10, 8);
  drawBow(g, af.hand.x, af.hand.y, pose, P, dark, flash);
}

/* ---- ③ 曜金·索拉：双角冠 + 金红分色 + 太阳纹 + 火焰拳套 ---------------- */

function drawSolar(g, def, pose, P, flash) {
  const R = rig(def, pose), B = R.B, dark = P.dark;
  const gold = flash ? '#fff' : '#e8b33b';
  const gold2 = flash ? '#fff' : '#a97a16';
  const red = flash ? '#fff' : '#c8342a';
  const eye = flash ? '#fff' : '#ffd84a';

  const kb = leg(g, R.hipX - 5 * B.w, R.hipY, pose.legB[0], pose.legB[1], B, P.base2, dark, 36, 34, 15, 11, 8);
  legStripe(g, R.hipX - 5 * B.w, R.hipY, pose.legB[0], pose.legB[1], B, 36, 34, 15, 11, 8, gold2, -1);
  boot(g, kb.x, kb.y, gold2, dark, 0, 15, 7, gold);

  pauldron(g, R.sx - 16 * B.shoulder, R.sy + 3, -1, gold2, red, dark, 12, 9);
  const ab = arm(g, R.sx - 15 * B.shoulder, R.sy + 4, pose.armB[0], pose.armB[1], P.base2, gold2, dark, { uw: 13, ew: 10.5, hw: 8.5 });
  fist(g, ab.hand.x, ab.hand.y, P.base2, dark, 4.8);

  ultraTorso(g, R, P, {
    shoulder: 16, waist: 9, hip: 11,
    bodyCol: P.metal, panelCol: gold, collarCol: red, chevron: gold
  });

  const kf = leg(g, R.hipX + 5 * B.w, R.hipY, pose.legF[0], pose.legF[1], B, P.base, dark, 37, 35, 16, 12, 8.5);
  legStripe(g, R.hipX + 5 * B.w, R.hipY, pose.legF[0], pose.legF[1], B, 37, 35, 16, 12, 8.5, gold, 1);
  boot(g, kf.x, kf.y, gold, dark, 2, 16, 7, gold2);
  belt(g, R.hipX, R.hipY - 2, 22 * B.w, red, dark);

  sunCore(g, R.sx, R.sy + 20, P, dark, flash ? '#fff' : '#ff7a1e');

  ultraHead(g, R, P, {
    rx: 10.8, ry: 12.5,
    headCol: P.base,
    panel: gold,
    eyeCol: eye,
    eyeRx: 4.7, eyeRy: 3.3,
    pod: gold2,
    crest: function (gg, hx, hy, rx, ry) {
      crestHorns(gg, hx, hy, rx, ry, P.metal, red, dark);
    }
  });

  const af = arm(g, R.sx + 15 * B.shoulder, R.sy + 4, pose.armF[0], pose.armF[1], P.base, gold, dark, { uw: 14, ew: 11, hw: 9 });
  fist(g, af.hand.x, af.hand.y, P.metal, dark, 5);
  pauldron(g, R.sx + 16 * B.shoulder, R.sy + 3, 1, gold, red, dark, 13, 10);
  gauntlet(g, af.hand.x, af.hand.y, P.metal, flash ? '#fff' : '#ff7a1e', dark, pose.blade, flash);
}

/* ---- ④ 幽紫·奈克缇：厚刃头镖 + 紫黑分色 + 额头灯 + 暗刃 ---------------- */

function drawNoctis(g, def, pose, P, flash) {
  const R = rig(def, pose), B = R.B, dark = P.dark;
  const purple = flash ? '#fff' : '#6c4bb6';
  const purple2 = flash ? '#fff' : '#3e2870';
  const glow = flash ? '#fff' : '#ff5cf0';

  const kb = leg(g, R.hipX - 4 * B.w, R.hipY, pose.legB[0], pose.legB[1], B, P.base2, dark, 36, 34, 13.5, 10, 7.2);
  legStripe(g, R.hipX - 4 * B.w, R.hipY, pose.legB[0], pose.legB[1], B, 36, 34, 13.5, 10, 7.2, purple2, -1);
  boot(g, kb.x, kb.y, purple2, dark, 0, 13.5, 6.5, purple);

  pauldron(g, R.sx - 14 * B.shoulder, R.sy + 2, -1, purple2, null, dark, 11, 8);
  const ab = arm(g, R.sx - 13 * B.shoulder, R.sy + 4, pose.armB[0], pose.armB[1], P.base2, purple2, dark, { uw: 12, ew: 9.5, hw: 7.5 });
  fist(g, ab.hand.x, ab.hand.y, P.base2, dark, 4.6);

  ultraTorso(g, R, P, {
    shoulder: 14, waist: 8, hip: 9.5,
    bodyCol: P.metal, panelCol: purple, collarCol: purple2, chevron: purple
  });

  const kf = leg(g, R.hipX + 4 * B.w, R.hipY, pose.legF[0], pose.legF[1], B, P.base, dark, 37, 35, 14, 10.5, 7.5);
  legStripe(g, R.hipX + 4 * B.w, R.hipY, pose.legF[0], pose.legF[1], B, 37, 35, 14, 10.5, 7.5, purple, 1);
  boot(g, kf.x, kf.y, purple, dark, 2, 14, 6.5, purple2);
  belt(g, R.hipX, R.hipY - 2, 20 * B.w, purple2, dark);

  /* 胸口暗紫菱形核 */
  g.strokeStyle = glow;
  g.lineWidth = 1;
  g.beginPath();
  g.arc(R.sx, R.sy + 20, 8.6, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.moveTo(R.sx, R.sy + 12);
  g.lineTo(R.sx + 6.4, R.sy + 20);
  g.lineTo(R.sx, R.sy + 28);
  g.lineTo(R.sx - 6.4, R.sy + 20);
  g.closePath();
  g.fillStyle = glow;
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = dark;
  g.stroke();

  ultraHead(g, R, P, {
    rx: 10.2, ry: 12.4,
    headCol: P.base,
    panel: purple,
    eyeCol: glow,
    eyeRx: 4.4, eyeRy: 3.0,
    lamp: glow,
    crest: function (gg, hx, hy, rx, ry) {
      crestSlugger(gg, hx, hy, rx, ry, P.base2, glow, dark);
    }
  });

  const af = arm(g, R.sx + 13 * B.shoulder, R.sy + 4, pose.armF[0], pose.armF[1], P.base, purple, dark, { uw: 13, ew: 10, hw: 8 });
  fist(g, af.hand.x, af.hand.y, P.metal, dark, 4.8);
  pauldron(g, R.sx + 14 * B.shoulder, R.sy + 2, 1, purple, glow, dark, 11, 8);
  blade(g, af.hand.x, af.hand.y, pose.armF[0] + pose.armF[1], pose, P.metal, glow, dark, { base: 13, grow: 22, width: 3.4 });
}

/* ---- ⑤ 翡翠·维尔德：藤蔓枝冠 + 绿银分色 + 叶脉核心 + 重拳 ----------------- */

function drawVerde(g, def, pose, P, flash) {
  const R = rig(def, pose), B = R.B, dark = P.dark;
  const green = flash ? '#fff' : '#35a472';
  const green2 = flash ? '#fff' : '#1f6b4a';
  const leaf = flash ? '#fff' : '#8cf0a8';

  const kb = leg(g, R.hipX - 6 * B.w, R.hipY, pose.legB[0], pose.legB[1], B, P.base2, dark, 37, 35, 17, 13, 9.5);
  legStripe(g, R.hipX - 6 * B.w, R.hipY, pose.legB[0], pose.legB[1], B, 37, 35, 17, 13, 9.5, green2, -1);
  boot(g, kb.x, kb.y, green2, dark, 0, 17, 7.5, green);

  pauldron(g, R.sx - 18 * B.shoulder, R.sy + 3, -1, green2, leaf, dark, 13, 9);
  const ab = arm(g, R.sx - 17 * B.shoulder, R.sy + 4, pose.armB[0], pose.armB[1], P.base2, green2, dark, { uw: 15, ew: 12, hw: 9.5 });
  fist(g, ab.hand.x, ab.hand.y, P.base2, dark, 5.4);

  ultraTorso(g, R, P, {
    shoulder: 18, waist: 10.5, hip: 12.5,
    bodyCol: P.metal, panelCol: green, collarCol: green2, chevron: green
  });

  /* 腹部藤蔓纹 */
  g.strokeStyle = green2;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(R.sx - 7, R.sy + 6);
  g.quadraticCurveTo(R.sx - 2, R.sy + 12, R.sx - 6, R.sy + 20);
  g.moveTo(R.sx + 7, R.sy + 6);
  g.quadraticCurveTo(R.sx + 2, R.sy + 12, R.sx + 6, R.sy + 20);
  g.stroke();

  const kf = leg(g, R.hipX + 6 * B.w, R.hipY, pose.legF[0], pose.legF[1], B, P.base, dark, 38, 36, 18, 13.5, 9.5);
  legStripe(g, R.hipX + 6 * B.w, R.hipY, pose.legF[0], pose.legF[1], B, 38, 36, 18, 13.5, 9.5, green, 1);
  boot(g, kf.x, kf.y, green, dark, 2, 18, 8, green2);
  belt(g, R.hipX, R.hipY - 2, 26 * B.w, green2, dark);

  leafCore(g, R.sx, R.sy + 20, 7.4, leaf, green2, dark);

  ultraHead(g, R, P, {
    rx: 11, ry: 12.6,
    headCol: P.base,
    panel: green,
    eyeCol: leaf,
    eyeRx: 4.6, eyeRy: 3.2,
    pod: green2,
    crest: function (gg, hx, hy, rx, ry) {
      crestBranch(gg, hx, hy, rx, ry, green2, leaf, dark);
    }
  });

  const af = arm(g, R.sx + 17 * B.shoulder, R.sy + 4, pose.armF[0], pose.armF[1], P.base, green, dark, { uw: 16, ew: 12.5, hw: 10 });
  fist(g, af.hand.x, af.hand.y, P.metal, dark, 5.6);
  pauldron(g, R.sx + 18 * B.shoulder, R.sy + 3, 1, green, leaf, dark, 13, 10);
  gauntlet(g, af.hand.x, af.hand.y, P.metal, leaf, dark, pose.blade, flash);
}

/* ---- ⑥ 霜白·格莱斯：冰棱冠 + 白蓝分色 + 六边形计时器 + 重装 -------------- */

function drawGlace(g, def, pose, P, flash) {
  const R = rig(def, pose), B = R.B, dark = P.dark;
  const ice = flash ? '#fff' : '#7fc4e8';
  const ice2 = flash ? '#fff' : '#4f93b8';
  const eye = flash ? '#fff' : '#8fe6ff';

  const kb = leg(g, R.hipX - 6 * B.w, R.hipY, pose.legB[0], pose.legB[1], B, P.base2, dark, 37, 35, 18, 13, 9.5);
  legStripe(g, R.hipX - 6 * B.w, R.hipY, pose.legB[0], pose.legB[1], B, 37, 35, 18, 13, 9.5, ice2, -1);
  boot(g, kb.x, kb.y, ice2, dark, 0, 18, 7.5, ice);

  pauldron(g, R.sx - 19 * B.shoulder, R.sy + 3, -1, ice2, null, dark, 14, 10);
  const ab = arm(g, R.sx - 18 * B.shoulder, R.sy + 4, pose.armB[0], pose.armB[1], P.base2, ice2, dark, { uw: 16, ew: 13, hw: 10 });
  fist(g, ab.hand.x, ab.hand.y, P.base2, dark, 5.6);

  ultraTorso(g, R, P, {
    shoulder: 19, waist: 11, hip: 13.5,
    bodyCol: P.metal, panelCol: ice, collarCol: ice2, chevron: ice
  });

  const kf = leg(g, R.hipX + 6 * B.w, R.hipY, pose.legF[0], pose.legF[1], B, P.base, dark, 38, 36, 19, 14, 10);
  legStripe(g, R.hipX + 6 * B.w, R.hipY, pose.legF[0], pose.legF[1], B, 38, 36, 19, 14, 10, ice, 1);
  boot(g, kf.x, kf.y, ice, dark, 2, 19, 8, ice2);
  belt(g, R.hipX, R.hipY - 2, 28 * B.w, ice2, dark);

  /* 六边形计时器 */
  heroHex(g, R.sx, R.sy + 20, 7.8, P.metal, dark);
  heroHex(g, R.sx, R.sy + 20, 5, eye, dark);
  g.fillStyle = '#ffffff';
  g.fillRect(Math.round(R.sx) - 1, Math.round(R.sy + 19), 2, 2);

  ultraHead(g, R, P, {
    rx: 11.2, ry: 12.7,
    headCol: P.base,
    panel: ice,
    eyeCol: eye,
    eyeRx: 4.7, eyeRy: 3.2,
    pod: ice2,
    crest: function (gg, hx, hy, rx, ry) {
      crestIce(gg, hx, hy, rx, ry, ice, '#dff6ff', dark);
    }
  });

  const af = arm(g, R.sx + 18 * B.shoulder, R.sy + 4, pose.armF[0], pose.armF[1], P.base, ice, dark, { uw: 17, ew: 13.5, hw: 10.5 });
  fist(g, af.hand.x, af.hand.y, P.metal, dark, 5.8);
  pauldron(g, R.sx + 19 * B.shoulder, R.sy + 3, 1, ice, '#dff6ff', dark, 14, 10);
  gauntlet(g, af.hand.x, af.hand.y, P.metal, '#dff6ff', dark, pose.blade, flash);
}

/* ---- 兜底：未知角色使用通用光之巨人骨架 ---------------------------------- */

function drawHeroFallback(g, def, pose, P, flash) {
  const R = rig(def, pose), B = R.B, dark = P.dark;

  const kb = leg(g, R.hipX - 4 * B.w, R.hipY, pose.legB[0], pose.legB[1], B, P.base2, dark, 36, 34, 14, 10.5, 7.5);
  legStripe(g, R.hipX - 4 * B.w, R.hipY, pose.legB[0], pose.legB[1], B, 36, 34, 14, 10.5, 7.5, P.suit2, -1);
  boot(g, kb.x, kb.y, P.suit2, dark, 0, 14, 6.5, P.suit);
  const ab = arm(g, R.sx - 13 * B.shoulder, R.sy + 4, pose.armB[0], pose.armB[1], P.base2, P.suit2, dark, { uw: 12.5, ew: 10, hw: 8 });
  fist(g, ab.hand.x, ab.hand.y, P.base2, dark, 4.8);

  ultraTorso(g, R, P, {
    shoulder: 14, waist: 8, hip: 9.5,
    bodyCol: P.metal, panelCol: P.suit, collarCol: P.suit2, chevron: P.suit
  });

  const kf = leg(g, R.hipX + 4 * B.w, R.hipY, pose.legF[0], pose.legF[1], B, P.base, dark, 37, 35, 14.5, 11, 8);
  legStripe(g, R.hipX + 4 * B.w, R.hipY, pose.legF[0], pose.legF[1], B, 37, 35, 14.5, 11, 8, P.suit, 1);
  boot(g, kf.x, kf.y, P.suit, dark, 2, 14.5, 7, P.suit2);
  belt(g, R.hipX, R.hipY - 2, 20 * B.w, P.suit2, dark);
  roundCore(g, R.sx, R.sy + 19, 6.2, P, dark);

  ultraHead(g, R, P, {
    rx: 10.4, ry: 12.3,
    headCol: P.base,
    panel: P.suit,
    eyeCol: P.eye,
    pod: P.suit2,
    crest: function (gg, hx, hy, rx, ry) {
      crestBlade(gg, hx, hy, rx, ry, P.metal, P.accent, dark);
    }
  });

  const af = arm(g, R.sx + 13 * B.shoulder, R.sy + 4, pose.armF[0], pose.armF[1], P.base, P.suit, dark, { uw: 13, ew: 10, hw: 8 });
  fist(g, af.hand.x, af.hand.y, P.metal, dark, 5);
  pauldron(g, R.sx + 14 * B.shoulder, R.sy + 3, 1, P.suit, P.accent, dark, 11, 8.5);
  blade(g, af.hand.x, af.hand.y, pose.armF[0] + pose.armF[1], pose, P.metal, P.accent, dark, { base: 14, grow: 22 });
}

const HERO_DRAW = {
  nova: drawNova,
  aqua: drawAqua,
  solar: drawSolar,
  noctis: drawNoctis,
  verde: drawVerde,
  glace: drawGlace
};

function drawHeroSprite(g, def, pose, flash) {
  const P = flash ? MONO : def.palette;
  const fn = HERO_DRAW[def.id] || drawHeroFallback;
  fn(g, def, pose, P, flash);
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
