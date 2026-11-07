/* =============================================================================
 * ui/screens.js ── 标题 / 模式 / 选人 / 暂停 / 结算 界面
 *  · 只负责绘制与提供可点击矩形，状态推进由 main.js 负责
 *  · 全部布局基于 640×360 逻辑分辨率
 *  · 背景复用 3 层视差舞台，叠加暗色蒙版保持 UI 可读
 * ========================================================================== */
import { text, cjk, rect, frame, panelPath } from '../core/pixel.js';
import { drawSprite } from '../art/sprite.js';
import { drawStage } from '../art/background.js';
import { STAGES } from '../data/stages.js';
import { HEROES } from '../data/characters.js';
import { VIEW_W, VIEW_H } from '../core/canvas.js';

const HERO_A = HEROES[0];
const HERO_B = HEROES[5];
const CX = VIEW_W / 2;

/* ---- 布局常量 ------------------------------------------------------------ */

export const MODE_CARDS = [
  { id: 'arcade', name: '街机模式', desc: '连续挑战 10 只怪兽', x: 36, y: 84, w: 172, h: 126 },
  { id: 'versus', name: '自由对战', desc: '自选英雄与怪兽', x: 234, y: 84, w: 172, h: 126 },
  { id: 'training', name: '训练模式', desc: '无限时间 · 练连段', x: 432, y: 84, w: 172, h: 126 }
];

export const DIFF_NAMES = ['简单', '普通', '困难', '大师'];
export const DIFF_RECTS = [0, 1, 2, 3].map((i) => ({ x: 117 + i * 106, y: 238, w: 88, h: 30, id: i }));

export function heroRect(i) {
  const col = i % 3, row = (i / 3) | 0;
  return { x: 10 + col * 212, y: 64 + row * 116, w: 196, h: 108, id: i };
}

export function monsterRect(i) {
  const col = i % 5, row = (i / 5) | 0;
  return { x: 16 + col * 124, y: 66 + row * 116, w: 112, h: 104, id: i };
}

export const PAUSE_ITEMS = ['继续战斗', '重开本场', '调整键位', '返回标题'];
export function pauseRect(i) {
  return { x: 208, y: 104 + i * 34, w: 224, h: 30, id: i };
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

  /* 先按宽度折行，再按最大行数截断，避免误加省略号 */
  const lines = [];
  let cur = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (cur && ctx.measureText(cur + ch).width > maxW) {
      lines.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) lines.push(cur);

  const last = Math.min(lines.length, maxLines) - 1;
  for (let i = 0; i <= last; i++) {
    let s = lines[i];
    if (i === last && lines.length > maxLines) {
      while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
      s += '…';
    }
    ctx.fillText(s, x, y + i * lineH);
  }
  ctx.restore();
}

/* ---- 背景 ---------------------------------------------------------------- */

export function drawMenuBg(ctx, time, stageIndex) {
  const stage = STAGES[(stageIndex || 0) % STAGES.length];
  const camX = 60 + Math.sin(time * 0.004) * 34;
  drawStage(ctx, stage, camX, time);
  ctx.fillStyle = 'rgba(3, 7, 12, 0.58)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  /* 斜向光带装饰 */
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = stage.accent;
  for (let i = 0; i < 6; i++) {
    const x = ((time * 0.4 + i * 148) % 800) - 80;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 42, 0);
    ctx.lineTo(x - 58, VIEW_H);
    ctx.lineTo(x - 100, VIEW_H);
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
  ctx.translate(98, 332);
  ctx.scale(0.96, 0.96);
  drawSprite(ctx, HERO_A, 'idle', 0.2, 0, 0, 0, { facing: 1, bucket: 'titleA' });
  ctx.restore();
  ctx.save();
  ctx.translate(VIEW_W - 98, 332);
  ctx.scale(0.96, 0.96);
  drawSprite(ctx, HERO_B, 'idle', 0.7, 0, 0, 0, { facing: -1, bucket: 'titleB' });
  ctx.restore();

  /* 标题 */
  const pulse = 1 + Math.sin(time * 0.05) * 0.02;
  cjk(ctx, '光之战士', CX, 40, {
    size: Math.round(48 * pulse), align: 'center', bold: true,
    color: '#eaf6ff', shadow: '#1a5f8a'
  });
  cjk(ctx, '像 素 对 决', CX, 104, {
    size: 18, align: 'center', bold: true, color: '#63e2ff', shadow: '#06121c'
  });
  text(ctx, 'PIXEL  SHOWDOWN', CX, 130, { scale: 1, align: 'center', color: '#4f7f96' });

  /* 分隔线 */
  rect(ctx, CX - 110, 148, 220, 1, '#2a4a5c');

  cjk(ctx, '6 名原创光之战士 · 10 只原创怪兽', CX, 162, {
    size: 10, align: 'center', color: '#8fb8c9'
  });
  cjk(ctx, '手感优先 · 判定严谨 · 横屏 60 帧', CX, 180, {
    size: 10, align: 'center', color: '#5f8ba1'
  });

  if ((time >> 4) % 2 === 0) {
    cjk(ctx, '按 J / 点击屏幕 开始', CX, 218, {
      size: 14, align: 'center', bold: true, color: '#ffe6a8', shadow: '#140a02'
    });
  }

  cjk(ctx, '原创作品 · 与任何版权方无关', CX, 338, {
    size: 8, align: 'center', color: '#436a7c'
  });
}

/* ---- 模式选择 ------------------------------------------------------------ */

export function drawModeSelect(ctx, time, index, diff) {
  drawMenuBg(ctx, time, 1);

  cjk(ctx, '选择模式', CX, 22, { size: 22, align: 'center', bold: true, color: '#eaf6ff', shadow: '#06121c' });
  cjk(ctx, '街机模式连续挑战全部 10 只怪兽', CX, 52, { size: 10, align: 'center', color: '#6f96a8' });

  for (let i = 0; i < MODE_CARDS.length; i++) {
    const c = MODE_CARDS[i];
    const sel = i === index;
    drawModeCard(ctx, c, sel, time);
  }

  cjk(ctx, '难度', CX, 218, { size: 12, align: 'center', color: '#8fb8c9', bold: true });
  for (const r of DIFF_RECTS) {
    const on = r.id === diff;
    rect(ctx, r.x, r.y, r.w, r.h, on ? '#2a4a5c' : '#101b24');
    frame(ctx, r.x, r.y, r.w, r.h, on ? '#ffd76a' : '#2f4a5c');
    cjk(ctx, DIFF_NAMES[r.id], r.x + r.w / 2, r.y + 8, {
      size: 13, align: 'center', color: on ? '#ffe6a8' : '#7fa3b4', bold: on
    });
  }

  cjk(ctx, 'A/D 选择模式 · W/S 切换难度 · J 确认 · L 返回', CX, 288, {
    size: 9, align: 'center', color: '#5f8ba1'
  });
  cjk(ctx, '触屏：点击模式直接进入', CX, 306, { size: 9, align: 'center', color: '#436a7c' });
}

function drawModeCard(ctx, c, sel, time) {
  const bob = sel ? Math.sin(time * 0.1) * 2 : 0;
  const y = c.y + bob;
  rect(ctx, c.x, y, c.w, c.h, sel ? '#16303e' : '#0c1720');
  frame(ctx, c.x, y, c.w, c.h, sel ? '#ffd76a' : '#2f4a5c', sel ? 2 : 1);
  if (sel) {
    ctx.globalAlpha = 0.16;
    rect(ctx, c.x + 5, y + 5, c.w - 10, c.h - 10, '#63e2ff');
    ctx.globalAlpha = 1;
  }

  const cx = c.x + c.w / 2;
  const iy = y + 46;
  if (c.id === 'arcade') {
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = sel ? '#ffe6a8' : '#6f96a8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx - 20 + i * 13, iy - 16);
      ctx.lineTo(cx + 20 + i * 13, iy);
      ctx.lineTo(cx - 20 + i * 13, iy + 16);
      ctx.stroke();
    }
  } else if (c.id === 'versus') {
    ctx.strokeStyle = sel ? '#ffe6a8' : '#6f96a8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 24, iy + 16);
    ctx.lineTo(cx + 24, iy - 16);
    ctx.moveTo(cx + 24, iy + 16);
    ctx.lineTo(cx - 24, iy - 16);
    ctx.stroke();
  } else {
    ctx.strokeStyle = sel ? '#ffe6a8' : '#6f96a8';
    ctx.lineWidth = 2;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(cx, iy, i * 8, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = sel ? '#ffe6a8' : '#6f96a8';
    ctx.fillRect(cx - 2, iy - 2, 4, 4);
  }

  cjk(ctx, c.name, cx, y + 80, { size: 16, align: 'center', bold: true, color: sel ? '#ffe6a8' : '#cdeeff' });
  cjk(ctx, c.desc, cx, y + 104, { size: 9, align: 'center', color: sel ? '#9fc2d3' : '#5f8ba1' });
}

/* ---- 选人 ---------------------------------------------------------------- */

export function drawCharSelect(ctx, time, list, index) {
  drawMenuBg(ctx, time, 2);

  cjk(ctx, '选择光之战士', CX, 16, { size: 20, align: 'center', bold: true, color: '#eaf6ff', shadow: '#06121c' });
  cjk(ctx, '六名独立绘制 · 六种定位 · 原创配色', CX, 44, { size: 9, align: 'center', color: '#6f96a8' });

  for (let i = 0; i < list.length; i++) {
    const h = list[i];
    const r = heroRect(i);
    const sel = i === index;
    const bob = sel ? Math.sin(time * 0.12) * 2 : 0;

    rect(ctx, r.x, r.y + bob, r.w, r.h, sel ? '#16303e' : '#0b151d');
    frame(ctx, r.x, r.y + bob, r.w, r.h, sel ? '#ffd76a' : '#2f4a5c', sel ? 2 : 1);

    /* 缩略立绘 */
    ctx.save();
    ctx.translate(r.x + 56, r.y + 100 + bob);
    ctx.scale(0.52, 0.52);
    drawSprite(ctx, h, 'idle', (time % 120) / 120, 0, 0, 0, {
      facing: 1, bucket: 'hi' + h.id
    });
    ctx.restore();

    cjk(ctx, h.short || h.name, r.x + 112, r.y + 10 + bob, { size: 15, bold: true, color: sel ? '#ffe6a8' : '#cdeeff' });
    cjk(ctx, h.name.split('·')[0] + ' · ' + h.title, r.x + 112, r.y + 32 + bob, {
      size: 8, color: h.palette.accent
    });

    wrapCjk(ctx, h.desc, r.x + 112, r.y + 46 + bob, 82, 1, 8,
      sel ? '#a9cfdf' : '#6f96a8', 11);
    cjk(ctx, '体 ' + h.stats.hp + ' · 速 ' + h.stats.walk.toFixed(2), r.x + 112, r.y + 76 + bob, {
      size: 8, color: '#4f7a8c'
    });
  }

  cjk(ctx, '方向键选择 · J 确认 · L 返回', CX, 310, { size: 9, align: 'center', color: '#5f8ba1' });
  cjk(ctx, '点击卡片直接选择', CX, 328, { size: 9, align: 'center', color: '#436a7c' });
}

/* ---- 选怪兽 -------------------------------------------------------------- */

export function drawMonsterSelect(ctx, time, list, index) {
  drawMenuBg(ctx, time, 0);

  cjk(ctx, '选择对手', CX, 16, { size: 20, align: 'center', bold: true, color: '#eaf6ff', shadow: '#06121c' });
  cjk(ctx, '10 只原创怪兽 · 每一只都有独立战斗机制', CX, 44, {
    size: 9, align: 'center', color: '#a06e63'
  });

  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    const r = monsterRect(i);
    const sel = i === index;
    const bob = sel ? Math.sin(time * 0.12) * 1.5 : 0;

    rect(ctx, r.x, r.y + bob, r.w, r.h, sel ? '#2a1620' : '#0b1218');
    frame(ctx, r.x, r.y + bob, r.w, r.h, sel ? '#ff6a52' : '#2f4a5c', sel ? 2 : 1);

    ctx.save();
    ctx.translate(r.x + r.w / 2, r.y + 82 + bob);
    ctx.scale(0.28, 0.28);
    drawSprite(ctx, m, 'idle', (time % 150) / 150, 0, 0, 0, {
      facing: 1, bucket: 'mi' + m.id
    });
    ctx.restore();

    cjk(ctx, m.name, r.x + r.w / 2, r.y + 84 + bob, {
      size: 10, align: 'center', bold: true, color: sel ? '#ffd9cf' : '#cdeeff'
    });
    cjk(ctx, m.title, r.x + r.w / 2, r.y + 96 + bob, {
      size: 7, align: 'center', color: sel ? '#ff8a72' : '#5f8ba1'
    });
  }

  cjk(ctx, '方向键选择 · J 确认 · L 返回', CX, 316, { size: 9, align: 'center', color: '#5f8ba1' });
}

/* ---- 暂停 ---------------------------------------------------------------- */

export function drawPause(ctx, time, index, editing) {
  ctx.fillStyle = 'rgba(3, 7, 12, 0.72)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  panelPath(ctx, 176, 52, 288, 256, 10);
  rect(ctx, 176, 52, 288, 256, '#0b1721');
  ctx.strokeStyle = '#3f6a82';
  ctx.lineWidth = 1;
  ctx.stroke();

  cjk(ctx, '暂停', CX, 64, { size: 22, align: 'center', bold: true, color: '#eaf6ff', shadow: '#06121c' });
  rect(ctx, CX - 78, 92, 156, 1, '#2a4a5c');

  for (let i = 0; i < PAUSE_ITEMS.length; i++) {
    const r = pauseRect(i);
    const on = i === index;
    rect(ctx, r.x, r.y, r.w, r.h, on ? '#1a3a4a' : '#0e1a23');
    frame(ctx, r.x, r.y, r.w, r.h, on ? '#ffd76a' : '#243c4b');
    cjk(ctx, PAUSE_ITEMS[i], CX, r.y + 8, {
      size: 13, align: 'center', color: on ? '#ffe6a8' : '#9fc2d3', bold: on
    });
  }

  if (editing) {
    cjk(ctx, '拖动屏幕上的按键 / 摇杆调整位置', CX, 250, {
      size: 10, align: 'center', color: '#63e2ff'
    });
    cjk(ctx, '再次点击「调整键位」保存并退出', CX, 268, {
      size: 9, align: 'center', color: '#5f8ba1'
    });
  } else {
    cjk(ctx, '空格 / J 确认 · Esc 返回战斗', CX, 256, { size: 9, align: 'center', color: '#5f8ba1' });
    if ((time >> 4) % 2 === 0) {
      cjk(ctx, '·', CX, 282, { size: 12, align: 'center', color: '#3f6a82' });
    }
  }
}

/* ---- 结算 ---------------------------------------------------------------- */

export function drawResult(ctx, time, info) {
  drawMenuBg(ctx, time, (info && info.stageIndex) || 0);
  ctx.fillStyle = 'rgba(3, 7, 12, 0.42)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const win = info.win;
  cjk(ctx, win ? '胜 利' : '败 北', CX, 52, {
    size: 46, align: 'center', bold: true,
    color: win ? '#ffe6a8' : '#ff6a52',
    shadow: win ? '#5a3a08' : '#2a0505'
  });
  cjk(ctx, win ? '光之战士守住了战场' : '怪兽踏碎了防线', CX, 112, {
    size: 12, align: 'center', color: win ? '#9fd7ea' : '#c08a80'
  });

  rect(ctx, CX - 120, 136, 240, 1, '#2a4a5c');
  const lines = info.lines || [];
  for (let i = 0; i < lines.length; i++) {
    cjk(ctx, lines[i], CX, 150 + i * 18, {
      size: 10, align: 'center', color: i === 0 ? '#cdeeff' : '#7fa3b4'
    });
  }

  if ((time >> 4) % 2 === 0) {
    cjk(ctx, info.prompt || '按 J / 点击屏幕 继续', CX, 252, {
      size: 13, align: 'center', bold: true, color: '#ffe6a8', shadow: '#140a02'
    });
  }
  cjk(ctx, '按 L 返回标题', CX, 306, { size: 9, align: 'center', color: '#436a7c' });
}
