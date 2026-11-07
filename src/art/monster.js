/* =============================================================================
 * art/monster.js ── 怪兽像素骨架（四足 / 双足 / 虫形 / 浮空 / 团块）
 *  · 同一坐标原点：MON_OX / MON_OY 为脚底中心
 *  · 受击白闪使用 MONO 全白调色板，不额外做合成操作
 * ========================================================================== */
import { oct, seg, tri } from './shapes.js';

export const MON_W = 248, MON_H = 236, MON_OX = 118, MON_OY = 214;

/** 受击白闪调色板 */
export const MONO = {
  base: '#fff', base2: '#fff', suit: '#fff', suit2: '#fff',
  accent: '#fff', eye: '#fff', dark: '#fff', metal: '#fff',
  shell: '#fff', shell2: '#fff', belly: '#fff', claw: '#fff',
  glow: '#fff', spike: '#fff'
};

function monsterEyes(g, def, x, y, P, dark, spread) {
  const n = Math.min(6, def.eyes || 2);
  for (let i = 0; i < n; i++) {
    const ox = (i - (n - 1) / 2) * spread;
    const oy = (i % 2) * -(spread * 0.55);
    g.fillStyle = P.eye;
    g.fillRect(Math.round(x + ox), Math.round(y + oy), 4, 3);
    g.fillStyle = P.dark;
    g.fillRect(Math.round(x + ox + 1), Math.round(y + oy + 1), 1, 1);
  }
}

function spikesAlong(g, x1, y1, x2, y2, count, col, dark, size) {
  for (let i = 0; i < count; i++) {
    const k = (i + 0.5) / count;
    const x = x1 + (x2 - x1) * k;
    const y = y1 + (y2 - y1) * k;
    tri(g, x - size * 0.4, y, size * 0.8, size, col, dark);
  }
}

function drawQuad(g, def, pose, P, dark) {
  const h = def.h, gy = MON_OY, baseY = gy - h * 0.54 + pose.dy;
  const L = h * 0.8, H = h * 0.30;
  /* 四条腿（后两条先画） */
  for (let i = 0; i < 4; i++) {
    const back = i < 2;
    const x = MON_OX + (i % 2 === 0 ? -L * 0.30 : L * 0.26) + (back ? -6 : 6);
    const ang = back ? pose.legB[0] : pose.legF[0];
    const a2 = back ? pose.legB[1] : pose.legF[1];
    const k = seg(g, x, baseY + H * 0.3, ang * 0.5, h * 0.26, 13, 10, back ? P.shell2 : P.shell, dark);
    seg(g, k.x, k.y, ang * 0.5 + a2 * 0.4, h * 0.24, 10, 8, back ? P.shell2 : P.shell, dark);
  }
  /* 尾巴 */
  let tx = MON_OX - L * 0.44, ty = baseY - H * 0.1;
  for (let i = 0; i < 3; i++) {
    const a = 150 + pose.tail * 40 + i * 8;
    const s = seg(g, tx, ty, a, h * 0.16, 12 - i * 3, 9 - i * 3, P.shell2, dark);
    tx = s.x; ty = s.y;
  }
  /* 躯干 */
  oct(g, MON_OX, baseY, L * 0.5, H * 0.5, P.shell, dark);
  oct(g, MON_OX + 4, baseY + H * 0.26, L * 0.38, H * 0.24, P.belly, dark);
  spikesAlong(g, MON_OX - L * 0.34, baseY - H * 0.46, MON_OX + L * 0.30, baseY - H * 0.48, def.spikes, P.spike, dark, h * 0.10);
  /* 脖子与头 */
  const hx = MON_OX + L * 0.44, hy = baseY - h * 0.13 + Math.sin(pose.head * Math.PI / 180) * 6;
  seg(g, MON_OX + L * 0.28, baseY - H * 0.2, 40, h * 0.2, 24, 20, P.shell, dark);
  oct(g, hx, hy, h * 0.16, h * 0.13, P.shell, dark);
  /* 下颚 */
  const jaw = pose.mouth * 10;
  g.beginPath();
  g.moveTo(hx + h * 0.06, hy + h * 0.04);
  g.lineTo(hx + h * 0.20, hy + h * 0.05 + jaw);
  g.lineTo(hx + h * 0.05, hy + h * 0.10 + jaw * 0.4);
  g.closePath();
  g.fillStyle = P.shell2; g.fill();
  g.lineWidth = 2; g.strokeStyle = dark; g.stroke();
  if (pose.mouth > 0.5) {
    g.fillStyle = P.glow;
    g.fillRect(Math.round(hx + h * 0.07), Math.round(hy + h * 0.05), Math.round(h * 0.09), 3);
  }
  /* 前肢爪 */
  seg(g, MON_OX + L * 0.22, baseY - H * 0.2, pose.armF[0] * 0.4 + 20, h * 0.22, 14, 10, P.shell, dark);
  monsterEyes(g, def, hx + h * 0.02, hy - h * 0.05, P, dark, h * 0.045);
  tri(g, hx - h * 0.10, hy - h * 0.10, h * 0.06, h * 0.10, P.spike, dark);
}

function drawBiped(g, def, pose, P, dark) {
  const h = def.h, gy = MON_OY;
  const drop = pose.dy + pose.crouch * 20;
  const hipY = gy - h * 0.44 + drop;
  const lean = pose.lean * Math.PI / 180;
  const torso = h * 0.30;
  const sx = MON_OX + Math.sin(lean) * torso;
  const sy = hipY - Math.cos(lean) * torso;

  /* 后腿 + 后臂 */
  const kb = seg(g, MON_OX - h * 0.06, hipY, pose.legB[0] * 0.6, h * 0.22, 20, 15, P.shell2, dark);
  seg(g, kb.x, kb.y, pose.legB[0] * 0.6 + pose.legB[1] * 0.5, h * 0.22, 15, 12, P.shell2, dark);
  const eb = seg(g, sx - h * 0.09, sy + 6, pose.armB[0] * 0.6, h * 0.16, 15, 11, P.shell2, dark);
  seg(g, eb.x, eb.y, pose.armB[0] * 0.6 + pose.armB[1] * 0.5, h * 0.15, 11, 9, P.shell2, dark);

  /* 躯干 */
  g.beginPath();
  g.moveTo(MON_OX - h * 0.10, hipY);
  g.lineTo(sx - h * 0.13, sy);
  g.lineTo(sx + h * 0.13, sy);
  g.lineTo(MON_OX + h * 0.10, hipY);
  g.closePath();
  g.fillStyle = P.shell; g.fill();
  g.lineWidth = 2; g.strokeStyle = dark; g.stroke();
  oct(g, sx, sy + h * 0.10, h * 0.11, h * 0.12, P.belly, dark);
  spikesAlong(g, sx - h * 0.12, sy - 4, sx + h * 0.10, sy - 2, Math.max(3, def.spikes), P.spike, dark, h * 0.075);

  /* 前腿 */
  const kf = seg(g, MON_OX + h * 0.05, hipY, pose.legF[0] * 0.6, h * 0.24, 22, 16, P.shell, dark);
  const ft = seg(g, kf.x, kf.y, pose.legF[0] * 0.6 + pose.legF[1] * 0.5, h * 0.23, 16, 13, P.shell, dark);
  g.fillStyle = P.claw;
  g.fillRect(Math.round(ft.x) - 7, Math.round(ft.y) - 3, 16, 5);
  g.lineWidth = 2; g.strokeStyle = dark;
  g.strokeRect(Math.round(ft.x) - 7, Math.round(ft.y) - 3, 16, 5);

  /* 头 */
  const hx = sx + Math.sin(lean) * h * 0.06 + h * 0.03;
  const hy = sy - h * 0.12 + pose.head * 0.6;
  oct(g, hx, hy, h * 0.115, h * 0.10, P.shell, dark);
  const jaw = pose.mouth * h * 0.09;
  g.beginPath();
  g.moveTo(hx + h * 0.04, hy + h * 0.04);
  g.lineTo(hx + h * 0.17, hy + h * 0.05 + jaw);
  g.lineTo(hx + h * 0.02, hy + h * 0.09);
  g.closePath();
  g.fillStyle = P.shell2; g.fill(); g.stroke();
  if (pose.mouth > 0.45) {
    g.fillStyle = P.glow;
    g.fillRect(Math.round(hx + h * 0.05), Math.round(hy + h * 0.05), Math.round(h * 0.07), 3);
  }
  monsterEyes(g, def, hx + h * 0.02, hy - h * 0.07, P, dark, h * 0.035);
  tri(g, hx - h * 0.10, hy - h * 0.07, h * 0.05, h * 0.13, P.spike, dark);
  tri(g, hx + h * 0.02, hy - h * 0.09, h * 0.05, h * 0.16, P.spike, dark);

  /* 前臂 */
  const ef = seg(g, sx + h * 0.11, sy + 6, pose.armF[0] * 0.6, h * 0.17, 17, 13, P.shell, dark);
  const hand = seg(g, ef.x, ef.y, pose.armF[0] * 0.6 + pose.armF[1] * 0.5, h * 0.16, 13, 10, P.shell, dark);
  g.fillStyle = P.claw;
  for (let i = -1; i <= 1; i++) {
    g.fillRect(Math.round(hand.x + i * 4), Math.round(hand.y), 2, 7);
  }
}

function drawInsect(g, def, pose, P, dark) {
  const h = def.h, gy = MON_OY;
  const by = gy - h * 0.40 + pose.dy, L = h * 0.82, H = h * 0.24;
  for (let i = 0; i < 6; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = MON_OX + (side * (L * 0.30) + (i < 2 ? -6 : i < 4 ? 8 : -2));
    const legBack = i < 2;
    const k = seg(g, x, by + H * 0.2, side * (legBack ? 34 : 20) + pose.legB[0] * 0.3, h * 0.24, 9, 7, P.shell2, dark);
    seg(g, k.x, k.y, side * 10 + pose.legB[1] * 0.3, h * 0.22, 7, 5, P.shell2, dark);
  }
  oct(g, MON_OX, by, L * 0.52, H * 0.5, P.shell, dark);
  oct(g, MON_OX - L * 0.05, by + H * 0.22, L * 0.36, H * 0.22, P.belly, dark);
  spikesAlong(g, MON_OX - L * 0.34, by - H * 0.42, MON_OX + L * 0.28, by - H * 0.44, def.spikes, P.spike, dark, h * 0.10);

  const hx = MON_OX + L * 0.48, hy = by - h * 0.02 + pose.head * 0.5;
  oct(g, hx, hy, h * 0.12, h * 0.10, P.shell, dark);
  monsterEyes(g, def, hx + 2, hy - h * 0.03, P, dark, h * 0.032);
  /* 上颚 */
  g.beginPath();
  g.moveTo(hx + h * 0.06, hy + h * 0.03);
  g.lineTo(hx + h * 0.19, hy + h * 0.04 - pose.mouth * 6);
  g.lineTo(hx + h * 0.06, hy + h * 0.08);
  g.closePath();
  g.fillStyle = P.claw; g.fill(); g.stroke();
  /* 触角 */
  seg(g, hx - 2, hy - h * 0.08, 210, h * 0.16, 5, 3, P.spike, dark);
}

function drawFloat(g, def, pose, P, dark) {
  const h = def.h, gy = MON_OY;
  const cy = gy - h * 0.58 + pose.dy;
  /* 下垂触须 */
  for (let i = 0; i < 5; i++) {
    const x = MON_OX + (i - 2) * h * 0.10;
    const a = 168 + i * 5 + pose.tail * 12;
    const s1 = seg(g, x, cy + h * 0.12, a, h * 0.20, 10, 7, P.shell2, dark);
    seg(g, s1.x, s1.y, a + 8, h * 0.18, 7, 4, P.shell2, dark);
  }
  /* 球状身体 */
  oct(g, MON_OX, cy, h * 0.30, h * 0.26, P.shell, dark);
  oct(g, MON_OX + 4, cy + h * 0.06, h * 0.22, h * 0.14, P.belly, dark);
  spikesAlong(g, MON_OX - h * 0.22, cy - h * 0.20, MON_OX + h * 0.20, cy - h * 0.22, def.spikes, P.spike, dark, h * 0.08);
  /* 巨眼 */
  const ex = MON_OX + h * 0.10, ey = cy - h * 0.06;
  oct(g, ex, ey, h * 0.11, h * 0.10, P.claw, dark);
  g.fillStyle = P.eye;
  g.fillRect(Math.round(ex - h * 0.03), Math.round(ey - h * 0.035), Math.round(h * 0.06), Math.round(h * 0.07));
  g.fillStyle = P.dark;
  g.fillRect(Math.round(ex - 1), Math.round(ey - 2), 3, 4);
  /* 侧鳍 */
  g.beginPath();
  g.moveTo(MON_OX - h * 0.14, cy + h * 0.02);
  g.lineTo(MON_OX - h * 0.34, cy - h * 0.08 - pose.wing * 8);
  g.lineTo(MON_OX - h * 0.16, cy + h * 0.12);
  g.closePath();
  g.fillStyle = P.shell2; g.fill(); g.stroke();
}

function drawBlob(g, def, pose, P, dark) {
  const h = def.h, gy = MON_OY;
  const cy = gy - h * 0.36 + pose.dy;
  /* 触手 */
  for (let i = 0; i < 4; i++) {
    const side = i < 2 ? -1 : 1;
    const a = side * (40 + i * 12) + pose.armF[0] * 0.5;
    const s1 = seg(g, MON_OX + side * h * 0.12, cy - h * 0.08, a, h * 0.20, 14, 10, P.shell2, dark);
    const s2 = seg(g, s1.x, s1.y, a + side * 26 + pose.armF[1] * 0.4, h * 0.17, 10, 6, P.shell2, dark);
    g.fillStyle = P.claw;
    g.fillRect(Math.round(s2.x) - 1, Math.round(s2.y), 3, 5);
  }
  /* 团块身体 */
  oct(g, MON_OX, cy, h * 0.34, h * 0.30, P.shell, dark);
  oct(g, MON_OX, cy + h * 0.10, h * 0.26, h * 0.18, P.belly, dark);
  /* 多眼 */
  monsterEyes(g, def, MON_OX - h * 0.10, cy - h * 0.10, P, dark, h * 0.055);
  /* 口器 */
  const jaw = pose.mouth * h * 0.08;
  g.beginPath();
  g.moveTo(MON_OX - h * 0.12, cy + h * 0.06);
  g.lineTo(MON_OX + h * 0.12, cy + h * 0.06);
  g.lineTo(MON_OX, cy + h * 0.10 + jaw);
  g.closePath();
  g.fillStyle = P.dark; g.fill();
  if (pose.mouth > 0.4) {
    g.fillStyle = P.glow;
    g.fillRect(MON_OX - h * 0.06, Math.round(cy + h * 0.07), Math.round(h * 0.12), 3);
  }
}

/** 按 kind 分派绘制怪兽 */
export function drawMonsterSprite(g, def, pose, flash) {
  const P = flash ? MONO : def.palette;
  const dark = flash ? '#fff' : P.dark;
  switch (def.kind) {
    case 'quad': drawQuad(g, def, pose, P, dark); break;
    case 'insect': drawInsect(g, def, pose, P, dark); break;
    case 'float': drawFloat(g, def, pose, P, dark); break;
    case 'blob': drawBlob(g, def, pose, P, dark); break;
    default: drawBiped(g, def, pose, P, dark); break;
  }
}
