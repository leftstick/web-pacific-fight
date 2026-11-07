/* =============================================================================
 * ui/screens.js ── 标题 / 模式 / 选人 / 暂停 / 结算 界面
 *  · 只负责绘制与提供可点击矩形，状态推进由 main.js 负责
 *  · 背景复用 3 层视差舞台，叠加暗色蒙版保持 UI 可读
 * ========================================================================== */
import { text, cjk, rect, frame, panelPath } from '../core/pixel.js';
import { drawSprite } from '../art/sprite.js';
import { drawStage } from '../art/background.js';
import { STAGES } from '../data/stages.js';
import { HEROES } from '../data/characters.js';

const HERO_A = HEROES[0];
const HERO_B = HEROES[5];

/* ---- 布局常量 ------------------------------------------------------------ */

export const MODE_CARDS = [
  { id: 'arcade', name: '街机模式', desc: '连续挑战 10 只怪兽', x: 30, y: 64, w: 128, h: 86 },
  { id: 'versus', name: '自由对战', desc: '自选英雄与怪兽', x: 176, y: 64, w: 128, h: 86 },
  { id: 'training', name: '训练模式', desc: '无限时间 · 练连段', x: 322, y: 64, w: 128, h: 86 }
];

export const DIFF_NAMES = ['简单', '普通', '困难', '大师'];
export const DIFF_RECTS = [0, 1, 2, 3].map((i) => ({ x: 92 + i * 82, y: 182, w: 72, h: 22, id: i }));

export function heroRect(i) {
  const col = i % 3, row = (i / 3) | 0;
  return { x: 23 + col * 149, y: 52 + row * 84, w: 136, h: 76, id: i };
}

export function monsterRect(i) {
  const col = i % 5, row = (i / 5) | 0;
  return { x: 20 + col * 90, y: 54 + row * 88, w: 84, h: 80, id: i };
}

export const PAUSE_ITEMS = ['继续战斗', '重开本场', '调整键位', '返回标题'];
export function pauseRect(i) {
  return { x: 138, y: 104 + i * 28, w: 204, h: 24, id: i };
}

export function inRect(p, r) {
  return p && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/**
 * 中文自动换行（按字符宽度测量），超出最大行数时补省略号。
 * 字体与 cjk() 保持一致，避免测量与绘制不一致。
 */
function wrapCjk(ctx, str, x, y, maxW, maxLines, size, color, lineH) {
  ctx.save();
  ctx.font = size + 'px "PingFang SC","Microsoft YaHei","Heiti SC","Noto Sans CJK SC",sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = color;

  let line = '';
  let row = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ctx.measureText(line + ch).width > maxW && line) {
      ctx.fillText(line, x, y + row * lineH);
      row++;
      line = ch;
      if (row >= maxLines) break;
    } else {
      line += ch;
    }
  }
  if (row < maxLines && line) {
    if (row === maxLines - 1) {
      while (line.length > 1 && ctx.measureText(line + '…').width > maxW) line = line.slice(0, -1);
      if (line.length < str.length) line += '…';
    }
    ctx.fillText(line, x, y + row * lineH);
  }
  ctx.restore();
}

/* ---- 背景 ---------------------------------------------------------------- */

export function drawMenuBg(ctx, time, stageIndex) {
  const stage = STAGES[(stageIndex || 0) % STAGES.length];
  const camX = 60 + Math.sin(time * 0.004) * 34;
  drawStage(ctx, stage, camX, time);
  ctx.fillStyle = 'rgba(3, 7, 12, 0.58)';
  ctx.fillRect(0, 0, 480, 270);

  /* 斜向光带装饰 */
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = stage.accent;
  for (let i = 0; i < 5; i++) {
    const x = ((time * 0.4 + i * 130) % 620) - 60;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 34, 0);
    ctx.lineTo(x - 46, 270);
    ctx.lineTo(x - 80, 270);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* ---- 标题 ---------------------------------------------------------------- */

export function drawTitle(ctx, time) {
  drawMenuBg(ctx, time, 0);

  /* 左右两名英雄站桩 */
  ctx.save();
  ctx.translate(66, 232);
  ctx.scale(0.82, 0.82);
  drawSprite(ctx, HERO_A, 'idle', 0.2, 0, 0, 0, { facing: 1, bucket: 'titleA' });
  ctx.restore();
  ctx.save();
  ctx.translate(414, 232);
  ctx.scale(0.82, 0.82);
  drawSprite(ctx, HERO_B, 'idle', 0.7, 0, 0, 0, { facing: -1, bucket: 'titleB' });
  ctx.restore();

  /* 标题 */
  const pulse = 1 + Math.sin(time * 0.05) * 0.02;
  cjk(ctx, '光之战士', 240, 44, {
    size: Math.round(44 * pulse), align: 'center', bold: true,
    color: '#eaf6ff', shadow: '#1a5f8a'
  });
  cjk(ctx, '像 素 对 决', 240, 96, {
    size: 16, align: 'center', bold: true, color: '#63e2ff', shadow: '#06121c'
  });
  text(ctx, 'PIXEL  SHOWDOWN', 240, 120, { scale: 1, align: 'center', color: '#4f7f96' });

  /* 分隔线 */
  rect(ctx, 160, 136, 160, 1, '#2a4a5c');

  cjk(ctx, '6 名原创光之战士 · 10 只原创怪兽', 240, 150, {
    size: 9, align: 'center', color: '#8fb8c9'
  });
  cjk(ctx, '手感优先 · 判定严谨 · 横屏 60 帧', 240, 166, {
    size: 9, align: 'center', color: '#5f8ba1'
  });

  if ((time >> 4) % 2 === 0) {
    cjk(ctx, '按 J / 点击屏幕 开始', 240, 204, {
      size: 13, align: 'center', bold: true, color: '#ffe6a8', shadow: '#140a02'
    });
  }

  cjk(ctx, '原创作品 · 与任何版权方无关', 240, 250, {
    size: 7, align: 'center', color: '#436a7c'
  });
}

/* ---- 模式选择 ------------------------------------------------------------ */

export function drawModeSelect(ctx, time, index, diff) {
  drawMenuBg(ctx, time, 1);

  cjk(ctx, '选择模式', 240, 20, { size: 18, align: 'center', bold: true, color: '#eaf6ff', shadow: '#06121c' });
  cjk(ctx, '街机模式连续挑战全部 10 只怪兽', 240, 42, { size: 8, align: 'center', color: '#6f96a8' });

  for (let i = 0; i < MODE_CARDS.length; i++) {
    const c = MODE_CARDS[i];
    const sel = i === index;
    drawModeCard(ctx, c, sel, time);
  }

  cjk(ctx, '难度', DIFF_RECTS[0].x - 54, DIFF_RECTS[0].y + 5, { size: 11, color: '#8fb8c9', bold: true });
  for (const r of DIFF_RECTS) {
    const on = r.id === diff;
    rect(ctx, r.x, r.y, r.w, r.h, on ? '#2a4a5c' : '#101b24');
    frame(ctx, r.x, r.y, r.w, r.h, on ? '#ffd76a' : '#2f4a5c');
    cjk(ctx, DIFF_NAMES[r.id], r.x + r.w / 2, r.y + 5, {
      size: 11, align: 'center', color: on ? '#ffe6a8' : '#7fa3b4', bold: on
    });
  }

  cjk(ctx, 'A/D 选择模式 · W/S 切换难度 · J 确认 · L 返回', 240, 226, {
    size: 8, align: 'center', color: '#5f8ba1'
  });
  cjk(ctx, '触屏：点击模式直接进入', 240, 242, { size: 8, align: 'center', color: '#436a7c' });
}

function drawModeCard(ctx, c, sel, time) {
  const bob = sel ? Math.sin(time * 0.1) * 2 : 0;
  const y = c.y + bob;
  rect(ctx, c.x, y, c.w, c.h, sel ? '#16303e' : '#0c1720');
  frame(ctx, c.x, y, c.w, c.h, sel ? '#ffd76a' : '#2f4a5c', sel ? 2 : 1);
  if (sel) {
    ctx.globalAlpha = 0.16;
    rect(ctx, c.x + 4, y + 4, c.w - 8, c.h - 8, '#63e2ff');
    ctx.globalAlpha = 1;
  }

  const cx = c.x + c.w / 2;
  const iy = y + 30;
  if (c.id === 'arcade') {
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = sel ? '#ffe6a8' : '#6f96a8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx - 16 + i * 10, iy - 12);
      ctx.lineTo(cx + 16 + i * 10, iy);
      ctx.lineTo(cx - 16 + i * 10, iy + 12);
      ctx.stroke();
    }
  } else if (c.id === 'versus') {
    ctx.strokeStyle = sel ? '#ffe6a8' : '#6f96a8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 18, iy + 12);
    ctx.lineTo(cx + 18, iy - 12);
    ctx.moveTo(cx + 18, iy + 12);
    ctx.lineTo(cx - 18, iy - 12);
    ctx.stroke();
  } else {
    ctx.strokeStyle = sel ? '#ffe6a8' : '#6f96a8';
    ctx.lineWidth = 2;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(cx, iy, i * 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = sel ? '#ffe6a8' : '#6f96a8';
    ctx.fillRect(cx - 2, iy - 2, 4, 4);
  }

  cjk(ctx, c.name, cx, y + 52, { size: 13, align: 'center', bold: true, color: sel ? '#ffe6a8' : '#cdeeff' });
  cjk(ctx, c.desc, cx, y + 68, { size: 8, align: 'center', color: sel ? '#9fc2d3' : '#5f8ba1' });
}

/* ---- 选人 ---------------------------------------------------------------- */

export function drawCharSelect(ctx, time, list, index) {
  drawMenuBg(ctx, time, 2);

  cjk(ctx, '选择光之战士', 240, 14, { size: 17, align: 'center', bold: true, color: '#eaf6ff', shadow: '#06121c' });
  cjk(ctx, '同一套骨架 · 六种定位 · 原创配色', 240, 36, { size: 8, align: 'center', color: '#6f96a8' });

  for (let i = 0; i < list.length; i++) {
    const h = list[i];
    const r = heroRect(i);
    const sel = i === index;
    const bob = sel ? Math.sin(time * 0.12) * 2 : 0;

    rect(ctx, r.x, r.y + bob, r.w, r.h, sel ? '#16303e' : '#0b151d');
    frame(ctx, r.x, r.y + bob, r.w, r.h, sel ? '#ffd76a' : '#2f4a5c', sel ? 2 : 1);

    /* 缩略立绘 */
    ctx.save();
    ctx.translate(r.x + 36, r.y + 72 + bob);
    ctx.scale(0.36, 0.36);
    drawSprite(ctx, h, 'idle', (time % 120) / 120, 0, 0, 0, {
      facing: 1, bucket: 'hi' + h.id
    });
    ctx.restore();

    cjk(ctx, h.name, r.x + 72, r.y + 12 + bob, { size: 14, bold: true, color: sel ? '#ffe6a8' : '#cdeeff' });
    cjk(ctx, h.role, r.x + 118, r.y + 16 + bob, { size: 8, align: 'right', color: h.palette.accent });

    wrapCjk(ctx, h.desc, r.x + 72, r.y + 33 + bob, 58, 2, 7,
      sel ? '#a9cfdf' : '#6f96a8', 9);
    cjk(ctx, '体 ' + h.stats.hp + ' · 速 ' + h.stats.walk.toFixed(2), r.x + 72, r.y + 56 + bob, {
      size: 7, color: '#4f7a8c'
    });
  }

  cjk(ctx, '方向键选择 · J 确认 · L 返回', 240, 232, { size: 8, align: 'center', color: '#5f8ba1' });
  cjk(ctx, '点击卡片直接选择', 240, 246, { size: 8, align: 'center', color: '#436a7c' });
}

/* ---- 选怪兽 -------------------------------------------------------------- */

export function drawMonsterSelect(ctx, time, list, index) {
  drawMenuBg(ctx, time, 0);

  cjk(ctx, '选择对手', 240, 14, { size: 17, align: 'center', bold: true, color: '#eaf6ff', shadow: '#06121c' });
  cjk(ctx, '10 只原创怪兽 · 每一只都有独立战斗机制', 240, 36, {
    size: 8, align: 'center', color: '#a06e63'
  });

  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    const r = monsterRect(i);
    const sel = i === index;
    const bob = sel ? Math.sin(time * 0.12) * 1.5 : 0;

    rect(ctx, r.x, r.y + bob, r.w, r.h, sel ? '#2a1620' : '#0b1218');
    frame(ctx, r.x, r.y + bob, r.w, r.h, sel ? '#ff6a52' : '#2f4a5c', sel ? 2 : 1);

    ctx.save();
    ctx.translate(r.x + r.w / 2, r.y + 58 + bob);
    ctx.scale(0.23, 0.23);
    drawSprite(ctx, m, 'idle', (time % 150) / 150, 0, 0, 0, {
      facing: 1, bucket: 'mi' + m.id
    });
    ctx.restore();

    cjk(ctx, m.name, r.x + r.w / 2, r.y + 60 + bob, {
      size: 9, align: 'center', bold: true, color: sel ? '#ffd9cf' : '#cdeeff'
    });
    cjk(ctx, m.title, r.x + r.w / 2, r.y + 71 + bob, {
      size: 7, align: 'center', color: sel ? '#ff8a72' : '#5f8ba1'
    });
  }

  cjk(ctx, '方向键选择 · J 确认 · L 返回', 240, 240, { size: 8, align: 'center', color: '#5f8ba1' });
}

/* ---- 暂停 ---------------------------------------------------------------- */

export function drawPause(ctx, time, index, editing) {
  ctx.fillStyle = 'rgba(3, 7, 12, 0.72)';
  ctx.fillRect(0, 0, 480, 270);

  panelPath(ctx, 124, 64, 232, 174, 8);
  rect(ctx, 124, 64, 232, 174, '#0b1721');
  ctx.strokeStyle = '#3f6a82';
  ctx.lineWidth = 1;
  ctx.stroke();

  cjk(ctx, '暂停', 240, 74, { size: 18, align: 'center', bold: true, color: '#eaf6ff', shadow: '#06121c' });
  rect(ctx, 176, 98, 128, 1, '#2a4a5c');

  for (let i = 0; i < PAUSE_ITEMS.length; i++) {
    const r = pauseRect(i);
    const on = i === index;
    rect(ctx, r.x, r.y, r.w, r.h, on ? '#1a3a4a' : '#0e1a23');
    frame(ctx, r.x, r.y, r.w, r.h, on ? '#ffd76a' : '#243c4b');
    cjk(ctx, PAUSE_ITEMS[i], 240, r.y + 6, {
      size: 11, align: 'center', color: on ? '#ffe6a8' : '#9fc2d3', bold: on
    });
  }

  if (editing) {
    cjk(ctx, '拖动屏幕上的按键 / 摇杆调整位置', 240, 218, {
      size: 9, align: 'center', color: '#63e2ff'
    });
    cjk(ctx, '再次点击「调整键位」保存并退出', 240, 230, {
      size: 8, align: 'center', color: '#5f8ba1'
    });
  } else {
    cjk(ctx, '空格 / J 确认 · Esc 返回战斗', 240, 224, { size: 8, align: 'center', color: '#5f8ba1' });
  }
  if ((time >> 4) % 2 === 0) {
    cjk(ctx, '·', 240, 244, { size: 12, align: 'center', color: '#3f6a82' });
  }
}

/* ---- 结算 ---------------------------------------------------------------- */

export function drawResult(ctx, time, info) {
  drawMenuBg(ctx, time, (info && info.stageIndex) || 0);
  ctx.fillStyle = 'rgba(3, 7, 12, 0.42)';
  ctx.fillRect(0, 0, 480, 270);

  const win = info.win;
  cjk(ctx, win ? '胜 利' : '败 北', 240, 54, {
    size: 40, align: 'center', bold: true,
    color: win ? '#ffe6a8' : '#ff6a52',
    shadow: win ? '#5a3a08' : '#2a0505'
  });
  cjk(ctx, win ? '光之战士守住了战场' : '怪兽踏碎了防线', 240, 104, {
    size: 10, align: 'center', color: win ? '#9fd7ea' : '#c08a80'
  });

  rect(ctx, 150, 128, 180, 1, '#2a4a5c');
  const lines = info.lines || [];
  for (let i = 0; i < lines.length; i++) {
    cjk(ctx, lines[i], 240, 140 + i * 16, {
      size: 9, align: 'center', color: i === 0 ? '#cdeeff' : '#7fa3b4'
    });
  }

  if ((time >> 4) % 2 === 0) {
    cjk(ctx, info.prompt || '按 J / 点击屏幕 继续', 240, 218, {
      size: 12, align: 'center', bold: true, color: '#ffe6a8', shadow: '#140a02'
    });
  }
  cjk(ctx, '按 L 返回标题', 240, 242, { size: 8, align: 'center', color: '#436a7c' });
}
