/* =============================================================================
 * art/background.js ── 3 层视差像素舞台
 *  · 远景天际线 / 中景建筑 / 近景平台道具，分别用不同视差系数跟随镜头
 *  · 3 个舞台：废墟都市（雨）/ 熔岩深渊（余烬）/ 太空站（星域）
 * ========================================================================== */
import { VIEW_W, VIEW_H, GROUND_Y } from '../core/canvas.js';

function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function drawStars(ctx, stage, time, camX) {
  if (!stage.stars) return;
  for (let i = 0; i < stage.stars; i++) {
    const x = (hash(i * 3.1) * VIEW_W * 1.6 - camX * 0.08 + VIEW_W * 2) % VIEW_W;
    const y = hash(i * 7.7) * 120 + 6;
    const tw = 0.55 + 0.45 * Math.sin(time * 0.06 + i);
    if (tw < 0.62) continue;
    ctx.fillStyle = i % 7 === 0 ? stage.glow : '#cfe2ff';
    ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
}

function drawSkyline(ctx, camX, factor, baseY, color, seed, spacing, minH, maxH) {
  const off = ((-camX * factor) % spacing + spacing) % spacing;
  for (let i = -2; i < VIEW_W / spacing + 3; i++) {
    const idx = Math.floor(camX * factor / spacing) + i;
    const h = minH + hash(idx * 1.7 + seed) * (maxH - minH);
    const w = spacing * (0.55 + hash(idx * 2.3 + seed) * 0.4);
    const x = i * spacing - off;
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(baseY - h), Math.round(w), Math.round(h) + 2);
    /* 窗格 */
    if (hash(idx + seed) > 0.45) {
      ctx.fillStyle = 'rgba(160,220,255,0.20)';
      for (let wy = baseY - h + 8; wy < baseY - 8; wy += 10) {
        for (let wx = x + 4; wx < x + w - 6; wx += 7) {
          if (hash(wx * 0.3 + wy * 0.7 + seed) > 0.55) ctx.fillRect(Math.round(wx), Math.round(wy), 2, 3);
        }
      }
    }
    /* 天线 */
    if (hash(idx * 5.3) > 0.82) {
      ctx.fillRect(Math.round(x + w * 0.5), Math.round(baseY - h - 12), 1, 12);
    }
  }
}

function drawGround(ctx, stage, camX, time) {
  const y = GROUND_Y;
  /* 地面主体 */
  ctx.fillStyle = stage.ground;
  ctx.fillRect(0, y, VIEW_W, VIEW_H - y);
  ctx.fillStyle = stage.ground2;
  ctx.fillRect(0, y + 14, VIEW_W, VIEW_H - y - 14);
  ctx.fillStyle = stage.line;
  ctx.fillRect(0, y, VIEW_W, 2);

  const off = ((-camX) % 48 + 48) % 48;
  if (stage.groundFx === 'cracks') {
    for (let i = -1; i < VIEW_W / 48 + 2; i++) {
      const x = i * 48 + off;
      ctx.fillStyle = stage.accent;
      ctx.fillRect(Math.round(x + 6), y + 20, 2, 8);
      ctx.fillRect(Math.round(x + 8), y + 26, 6, 2);
      ctx.fillStyle = stage.glow;
      ctx.fillRect(Math.round(x + 30), y + 8, 1, 5);
    }
  } else if (stage.groundFx === 'panel') {
    for (let i = -1; i < VIEW_W / 48 + 2; i++) {
      const x = i * 48 + off;
      ctx.fillStyle = stage.line;
      ctx.fillRect(Math.round(x), y + 2, 1, VIEW_H - y);
      ctx.fillRect(Math.round(x + 4), y + 18, 40, 1);
      ctx.fillStyle = stage.accent;
      if ((i & 3) === 0) ctx.fillRect(Math.round(x + 20), y + 6, 3, 2);
    }
  } else {
    for (let i = -1; i < VIEW_W / 48 + 2; i++) {
      const x = i * 48 + off;
      ctx.fillStyle = '#2f4553';
      ctx.fillRect(Math.round(x + 4), y + 8, 10, 3);
      ctx.fillRect(Math.round(x + 26), y + 18, 14, 2);
      ctx.fillStyle = '#1d2f3a';
      ctx.fillRect(Math.round(x + 18), y + 26, 8, 3);
    }
  }
}

function drawRain(ctx, time, camX) {
  ctx.fillStyle = 'rgba(160,210,240,0.45)';
  for (let i = 0; i < 46; i++) {
    const sp = 180 + hash(i) * 120;
    const x = ((hash(i * 3.7) * (VIEW_W + 120) + camX * 0.4 - time * 3.2) % (VIEW_W + 120) + VIEW_W + 120) % (VIEW_W + 120) - 60;
    const y = ((hash(i * 9.1) * VIEW_H + time * sp * 0.6) % VIEW_H);
    ctx.fillRect(Math.round(x), Math.round(y), 1, 4);
  }
}

function drawEmbers(ctx, time) {
  for (let i = 0; i < 30; i++) {
    const x = (hash(i * 5.1) * VIEW_W + Math.sin(time * 0.02 + i) * 14) % VIEW_W;
    const y = (hash(i * 2.9) * VIEW_H - time * (0.35 + hash(i) * 0.6) % VIEW_H + VIEW_H) % VIEW_H;
    ctx.fillStyle = i % 3 === 0 ? '#ffd27a' : '#ff7a3c';
    ctx.fillRect(Math.round(x), Math.round(y), 2, 1);
  }
}

/**
 * 绘制舞台（在世界坐标系之外调用，自行处理视差）。
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} stage
 * @param {number} camX 镜头世界 x
 * @param {number} time 累计逻辑帧
 */
export function drawStage(ctx, stage, camX, time) {
  /* 天空：分层色带（离散色阶，避免平滑渐变） */
  const bands = stage.sky;
  const bh = Math.ceil(VIEW_H / bands.length);
  for (let i = 0; i < bands.length; i++) {
    ctx.fillStyle = bands[i];
    ctx.fillRect(0, i * bh, VIEW_W, bh + 1);
  }

  drawStars(ctx, stage, time, camX);

  if (stage.moon) {
    /* 像素圆盘月亮：逐行填充，避免出现方块色块 */
    const mx = Math.round(382 - camX * 0.04), my = 38, r = 11;
    ctx.fillStyle = '#dbe8f2';
    for (let dy = -r; dy <= r; dy++) {
      const w = Math.round(Math.sqrt(r * r - dy * dy));
      ctx.fillRect(mx - w, my + dy, w * 2 + 1, 1);
    }
    /* 环形山（略深的月面斑块） */
    ctx.fillStyle = '#b9cddd';
    ctx.fillRect(mx - 5, my - 5, 4, 3);
    ctx.fillRect(mx + 2, my + 1, 5, 4);
    ctx.fillRect(mx - 3, my + 5, 3, 2);
  }

  /* 远景：低矮天际线 */
  drawSkyline(ctx, camX, 0.18, GROUND_Y - 18, stage.far, 11, 30, 34, 78);
  /* 中景：主城建筑 */
  drawSkyline(ctx, camX, 0.42, GROUND_Y - 4, stage.mid, 37, 46, 52, 132);
  /* 近景：大型结构 / 残骸 */
  drawSkyline(ctx, camX, 0.72, GROUND_Y + 2, stage.near, 71, 84, 24, 58);

  /* 近景轮廓上的霓虹点 */
  for (let i = 0; i < 18; i++) {
    const x = ((hash(i * 6.1) * 900 - camX * 0.72) % 720 + 720) % 720 - 100;
    const y = GROUND_Y - 20 - hash(i * 3.3) * 46;
    ctx.fillStyle = i % 4 === 0 ? stage.accent : stage.glow;
    ctx.fillRect(Math.round(x), Math.round(y), 2, 2);
  }

  drawGround(ctx, stage, camX, time);

  if (stage.weather === 'rain') drawRain(ctx, time, camX);
  else if (stage.weather === 'ember') drawEmbers(ctx, time);
}
