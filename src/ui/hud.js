/* =============================================================================
 * ui/hud.js ── 战斗 HUD
 *  · 分段血条 + 延迟白条 / 防御槽 / 能量槽 / 回合灯 / 计时器 / 连击计数
 *  · 全部在 640×360 屏幕坐标系绘制，不受镜头缩放影响
 * ========================================================================== */
import { text, textWidth, cjk, rect, frame } from '../core/pixel.js';
import { VIEW_W } from '../core/canvas.js';

const SEGS = 10;
const PAD = 18;
const BAR_W = 236;

function barSegments(ctx, x, y, w, h, ratio, color, flip) {
  const sw = w / SEGS;
  ctx.fillStyle = color;
  for (let i = 0; i < SEGS; i++) {
    const start = i * sw;
    const len = Math.min(sw - 1, Math.max(0, ratio * w - start));
    if (len <= 0) continue;
    const px = flip ? x + w - start - len : x + start;
    ctx.fillRect(Math.round(px), y, Math.max(1, Math.round(len)), h);
  }
}

function drawHealth(ctx, x, y, w, h, ratio, lag, color, flip) {
  rect(ctx, x - 1, y - 1, w + 2, h + 2, '#04080d');
  rect(ctx, x, y, w, h, '#17222c');
  barSegments(ctx, x, y, w, h, lag, '#f2f6ff', flip);
  barSegments(ctx, x, y, w, h, ratio, color, flip);
  frame(ctx, x - 1, y - 1, w + 2, h + 2, '#5d8098');
}

export class Hud {
  constructor() {
    this.lagA = 1;
    this.lagB = 1;
    this.lastRound = 1;
  }

  update(match) {
    if (match.round !== this.lastRound) {
      this.lastRound = match.round;
      this.lagA = match.a.hp / match.a.maxHp;
      this.lagB = match.b.hp / match.b.maxHp;
    }
    const ra = match.a.hp / match.a.maxHp;
    const rb = match.b.hp / match.b.maxHp;
    if (ra > this.lagA) this.lagA = ra; else this.lagA += (ra - this.lagA) * 0.045;
    if (rb > this.lagB) this.lagB = rb; else this.lagB += (rb - this.lagB) * 0.045;
  }

  draw(ctx, match, time) {
    const a = match.a, b = match.b;
    const ra = Math.max(0, a.hp / a.maxHp);
    const rb = Math.max(0, b.hp / b.maxHp);

    const rightX = VIEW_W - PAD - BAR_W;
    const midX = VIEW_W / 2;

    /* HUD 底板：保证月亮 / 霓虹不会从血条缝隙里透出来 */
    ctx.fillStyle = 'rgba(3, 10, 16, 0.62)';
    ctx.fillRect(0, 0, VIEW_W, 64);

    /* ---- 血条（≤25% 红色闪烁）---- */
    const lowA = ra <= 0.25 && (time >> 3) % 2 === 0;
    const lowB = rb <= 0.25 && (time >> 3) % 2 === 0;
    drawHealth(ctx, PAD, 14, BAR_W, 13, ra, this.lagA, lowA ? '#ff4a3c' : '#63e2ff', false);
    drawHealth(ctx, rightX, 14, BAR_W, 13, rb, this.lagB, lowB ? '#ffdd55' : '#ff6a52', true);

    /* 防御槽（细线） */
    rect(ctx, PAD, 31, BAR_W, 3, '#0a141c');
    barSegments(ctx, PAD, 31, BAR_W, 3, Math.max(0, a.guard / 100), '#8fd0e8', false);
    rect(ctx, rightX, 31, BAR_W, 3, '#0a141c');
    barSegments(ctx, rightX, 31, BAR_W, 3, Math.max(0, b.guard / 100), '#ffb08a', true);

    /* ---- 能量槽 ---- */
    this._meter(ctx, PAD, 39, 206, a.meter, '#63e2ff', false);
    this._meter(ctx, VIEW_W - PAD - 206, 39, 206, b.meter, '#ffc14d', true);

    /* ---- 角色名 ---- */
    cjk(ctx, a.def.name, PAD, 52, { size: 12, bold: true, color: '#cdeeff' });
    cjk(ctx, a.def.title, PAD + this._cjkW(a.def.name, 12) + 8, 54, { size: 9, color: '#5f8ba1' });
    cjk(ctx, b.def.name, VIEW_W - PAD, 52, { size: 12, bold: true, color: '#ffd9cf', align: 'right' });
    cjk(ctx, b.def.title, VIEW_W - PAD - this._cjkW(b.def.name, 12) - 8, 54, { size: 9, color: '#a06e63', align: 'right' });

    /* ---- 回合灯 ---- */
    this._lamps(ctx, midX - 52, 18, match.wins[0], '#63e2ff', false);
    this._lamps(ctx, midX + 52, 18, match.wins[1], '#ff6a52', true);

    /* ---- 计时器 ---- */
    const sec = Math.max(0, Math.ceil(match.timer / 60));
    const label = String(sec).padStart(2, '0');
    const low = sec <= 10;
    const blink = low && (time >> 3) % 2 === 0;
    text(ctx, label, midX, 13, {
      scale: 2, align: 'center',
      color: blink ? '#ff5a4a' : '#eaf6ff',
      shadow: '#06121c'
    });
    cjk(ctx, match.training ? '训练' : '第 ' + match.round + ' 回合', midX, 35, {
      size: 9, align: 'center', color: '#6f96a8'
    });

    /* ---- 连击计数 ---- */
    if (b.comboIndex > 1 && b.comboTimer > 0) {
      this._combo(ctx, 26, 98, b.comboIndex, '#ffe6a8', false);
    }
    if (a.comboIndex > 1 && a.comboTimer > 0) {
      this._combo(ctx, VIEW_W - 26, 98, a.comboIndex, '#ffb0a0', true);
    }

    /* ---- 阶段提示 ---- */
    if (b.phase2) {
      cjk(ctx, '狂暴', VIEW_W - 26, 70, { size: 10, align: 'right', color: '#ff6a52', bold: true, shadow: '#2a0505' });
    }

    /* ---- 中央横幅 ---- */
    const banner = match.banner;
    if (banner) this._banner(ctx, match, banner);
  }

  _meter(ctx, x, y, w, value, color, flip) {
    const r = Math.max(0, Math.min(1, value / 100));
    const h = 6;
    rect(ctx, x - 1, y - 1, w + 2, h + 2, '#04080d');
    rect(ctx, x, y, w, h, '#101b24');
    barSegments(ctx, x, y, w, h, r, value >= 100 ? '#ffd76a' : color, flip);
    frame(ctx, x - 1, y - 1, w + 2, h + 2, value >= 100 ? '#b98a2c' : '#2f4a5c');
    if (value >= 25) {
      cjk(ctx, '气', flip ? x + w + 7 : x - 12, y - 2, { size: 8, color: '#6f96a8' });
    }
  }

  _lamps(ctx, x, y, wins, color, right) {
    for (let i = 0; i < 2; i++) {
      const cx = right ? x + i * 11 : x - i * 11;
      const on = wins > i;
      ctx.fillStyle = on ? color : '#1b2a36';
      ctx.fillRect(cx - 4, y, 8, 8);
      ctx.fillStyle = on ? '#ffffff' : '#2c4050';
      ctx.fillRect(cx - 2, y + 2, 4, 4);
    }
  }

  _combo(ctx, x, y, n, color, right) {
    const label = '连击';
    const num = String(n);
    const nw = textWidth(num, 2);
    if (right) {
      cjk(ctx, label, x, y + 6, { size: 9, align: 'right', color, bold: true, shadow: '#140a02' });
      text(ctx, num, x - this._cjkW(label, 9) - 8, y, { scale: 2, align: 'right', color, shadow: '#140a02' });
    } else {
      text(ctx, num, x, y, { scale: 2, color, shadow: '#140a02' });
      cjk(ctx, label, x + nw + 6, y + 6, { size: 9, color, bold: true, shadow: '#140a02' });
    }
  }

  _banner(ctx, match, label) {
    const t = match.phaseT;
    let alpha = 1;
    let size = 26;
    if (match.phase === 'intro') {
      size = t < 46 ? 16 : 28;
      alpha = t > 60 ? Math.max(0, 1 - (t - 60) / 14) : 1;
    } else if (match.phase === 'roundEnd') {
      size = t < 10 ? 20 + t * 2 : 32;
      alpha = t > 180 ? Math.max(0, 1 - (t - 180) / 30) : 1;
    } else if (match.phase === 'matchEnd') {
      size = 34;
      alpha = 1;
    }
    ctx.globalAlpha = alpha;
    cjk(ctx, label, VIEW_W / 2, 150, {
      size, align: 'center', bold: true,
      color: match.reason === 'time' ? '#ffd76a' : '#eaf6ff',
      shadow: '#0a1830'
    });
    ctx.globalAlpha = 1;
  }

  _cjkW(str, size) {
    return str.length * size;
  }
}
