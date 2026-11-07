/* =============================================================================
 * main.js ── 入口：固定 60Hz 逻辑 + 状态机 + 页面壳交互
 *  loading → title → modeSelect → charSelect → (monsterSelect) → fight
 *          → pause → roundEnd（Match 内部）→ result → title
 * ========================================================================== */
import { fitCanvas, getContext, VIEW_W, VIEW_H } from './core/canvas.js';
import { Input } from './core/input.js';
import { Audio } from './core/audio.js';
import { HEROES } from './data/characters.js';
import { MONSTERS } from './data/monsters.js';
import { STAGES } from './data/stages.js';
import { Match } from './game/match.js';
import { Hud } from './ui/hud.js';
import { TouchPad, hasTouch } from './ui/touch.js';
import {
  drawTitle, drawModeSelect, drawCharSelect, drawMonsterSelect,
  drawPause, drawResult,
  MODE_CARDS, DIFF_NAMES, DIFF_RECTS, PAUSE_ITEMS,
  inRect, heroRect, monsterRect, pauseRect
} from './ui/screens.js';
import { cjk, rect, frame } from './core/pixel.js';
import { resetFx } from './art/fx.js';

const canvas = document.getElementById('game');
const wrap = document.getElementById('stage-wrap');
fitCanvas(canvas, wrap);
const ctx = getContext(canvas);

const input = new Input(canvas);
const touch = new TouchPad(input);
const hud = new Hud();
const touchable = hasTouch();

const state = {
  name: 'loading',
  t: 0,
  time: 0,
  modeSel: 0,
  diff: 1,
  charSel: 0,
  monSel: 0,
  editing: false
};

let run = null;          // { mode, diff, hero, monsterIndex, wins }
let match = null;
let result = null;       // 结算信息

/* 调试叠层：F1 判定框，` 键 FPS */
const debug = { hitbox: false, fps: false, frames: 0, fpsAt: 0, fpsVal: 60 };
window.addEventListener('keydown', (ev) => {
  if (ev.code === 'F1') { ev.preventDefault(); debug.hitbox = !debug.hitbox; }
  else if (ev.code === 'Backquote') { ev.preventDefault(); debug.fps = !debug.fps; }
});

/* ---- 页面壳：全屏 / 横屏遮罩 -------------------------------------------- */

const fullBtn = document.getElementById('btn-fullscreen');
const mask = document.getElementById('rotate-mask');

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
      try { await screen.orientation.lock('landscape'); } catch (e) { /* 静默降级 */ }
    } else {
      await document.exitFullscreen();
    }
  } catch (e) { /* iOS Safari 等不支持时静默降级 */ }
}

if (fullBtn) {
  fullBtn.addEventListener('click', (e) => { e.preventDefault(); toggleFullscreen(); });
}

function updateOrientation() {
  const portrait = window.innerHeight > window.innerWidth;
  if (mask) mask.classList.toggle('show', touchable && portrait);
}

window.addEventListener('resize', updateOrientation);
window.addEventListener('orientationchange', () => setTimeout(updateOrientation, 160));
updateOrientation();

/* ---- 工具 ---------------------------------------------------------------- */

function setState(name) {
  state.name = name;
  state.t = 0;
}
function cycle(i, n, d) { return (i + d + n) % n; }
function confirmKey() {
  return input.pressed('confirm') || input.pressed('light') || input.pressed('start');
}
function backKey() {
  return input.pressed('back') || input.pressed('special');
}
function clearCombatInput() {
  for (const k of ['light', 'heavy', 'special', 'super', 'up', 'down']) input.consume(k);
  input.clearVirtual();
  if (touch) touch.releaseAll();
}

/* ---- 流程 ---------------------------------------------------------------- */

/* 街机模式：前 5 关从 1–9 号怪兽随机不重复抽取，第 6 关固定陨核巨像 */
function buildArcadeList() {
  const pool = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 5).concat([9]);
}

function chooseMode(mode) {
  run = {
    mode, diff: state.diff, hero: HEROES[0],
    monsterIndex: 0, stageIndex: 0, wins: 0,
    arcadeList: mode === 'arcade' ? buildArcadeList() : null
  };
  setState('charSelect');
}

function chooseHero(i) {
  run.hero = HEROES[i];
  if (run.mode === 'versus') {
    state.monSel = 0;
    setState('monsterSelect');
  } else {
    run.stageIndex = 0;
    startFight(run.mode === 'arcade' ? run.arcadeList[0] : 0);
  }
}

function startFight(monsterIndex) {
  run.monsterIndex = monsterIndex;
  run.wins = 0;
  result = null;
  const monster = MONSTERS[monsterIndex % MONSTERS.length];
  const stageIdx = run.mode === 'arcade' ? run.stageIndex : monsterIndex;
  const stage = STAGES[stageIdx % STAGES.length];
  match = new Match({
    hero: run.hero,
    monster,
    stage,
    difficulty: run.diff,
    input,
    training: run.mode === 'training'
  });
  hud.lastRound = 1;
  hud.lagA = 1;
  hud.lagB = 1;
  resetFx();
  clearCombatInput();
  setState('fight');
}

function toTitle() {
  match = null;
  run = null;
  result = null;
  clearCombatInput();
  setState('title');
}

function buildResult() {
  if (!match) return;
  const win = match.matchWinner === match.a;
  const arcade = run.mode === 'arcade';
  const training = run.mode === 'training';
  const total = arcade && run.arcadeList ? run.arcadeList.length : 0;
  const cleared = arcade ? (win ? run.stageIndex + 1 : run.stageIndex) : 0;
  const lines = [
    '回合比分  ' + match.wins[0] + ' : ' + match.wins[1],
    '难度  ' + DIFF_NAMES[run.diff]
  ];
  if (arcade) lines.push('街机关卡  ' + cleared + ' / ' + total);
  if (training) lines.push('训练模式 · 无限时间');

  let prompt = '按 J / 点击屏幕 返回标题';
  if (arcade && win && run.stageIndex < total - 1) {
    prompt = '按 J / 点击屏幕 挑战下一只';
  }
  if (arcade && win && run.stageIndex === total - 1) {
    lines.unshift('陨核巨像已被击破 · 街机通关');
  }

  result = {
    win, lines, prompt,
    stageIndex: run.stageIndex % STAGES.length,
    arcade, training
  };
  setState('result');
}

function resultConfirm() {
  if (!result) { toTitle(); return; }
  if (result.arcade && result.win && run.stageIndex < run.arcadeList.length - 1) {
    run.stageIndex++;
    startFight(run.arcadeList[run.stageIndex]);
    return;
  }
  toTitle();
}

/* ---- 逻辑帧 -------------------------------------------------------------- */

function tick() {
  state.time++;
  state.t++;
  input.beginFrame();

  switch (state.name) {
    case 'loading': {
      if (state.t > 48) setState('title');
      break;
    }

    case 'title': {
      const tap = input.takeTap();
      if (confirmKey() || tap) { Audio.play('confirm'); setState('modeSelect'); }
      break;
    }

    case 'modeSelect': {
      if (input.pressed('left')) state.modeSel = cycle(state.modeSel, MODE_CARDS.length, -1);
      if (input.pressed('right')) state.modeSel = cycle(state.modeSel, MODE_CARDS.length, 1);
      if (input.pressed('up')) state.diff = cycle(state.diff, 4, 1);
      if (input.pressed('down')) state.diff = cycle(state.diff, 4, -1);

      const tap = input.takeTap();
      if (tap) {
        for (const r of DIFF_RECTS) {
          if (inRect(tap, r)) { state.diff = r.id; Audio.play('select'); }
        }
        for (const c of MODE_CARDS) {
          if (inRect(tap, c)) { Audio.play('confirm'); chooseMode(c.id); break; }
        }
      }
      if (state.name === 'modeSelect') {
        if (confirmKey()) { Audio.play('confirm'); chooseMode(MODE_CARDS[state.modeSel].id); }
        else if (backKey()) { Audio.play('back'); setState('title'); }
      }
      break;
    }

    case 'charSelect': {
      if (input.pressed('left')) state.charSel = cycle(state.charSel, HEROES.length, -1);
      if (input.pressed('right')) state.charSel = cycle(state.charSel, HEROES.length, 1);
      if (input.pressed('up')) state.charSel = cycle(state.charSel, HEROES.length, -3);
      if (input.pressed('down')) state.charSel = cycle(state.charSel, HEROES.length, 3);

      const tap = input.takeTap();
      if (tap) {
        for (let i = 0; i < HEROES.length; i++) {
          if (inRect(tap, heroRect(i))) {
            state.charSel = i;
            Audio.play('confirm');
            chooseHero(i);
            break;
          }
        }
      }
      if (state.name === 'charSelect') {
        if (confirmKey()) { Audio.play('confirm'); chooseHero(state.charSel); }
        else if (backKey()) { Audio.play('back'); setState('modeSelect'); }
      }
      break;
    }

    case 'monsterSelect': {
      if (input.pressed('left')) state.monSel = cycle(state.monSel, MONSTERS.length, -1);
      if (input.pressed('right')) state.monSel = cycle(state.monSel, MONSTERS.length, 1);
      if (input.pressed('up')) state.monSel = cycle(state.monSel, MONSTERS.length, -5);
      if (input.pressed('down')) state.monSel = cycle(state.monSel, MONSTERS.length, 5);

      const tap = input.takeTap();
      if (tap) {
        for (let i = 0; i < MONSTERS.length; i++) {
          if (inRect(tap, monsterRect(i))) {
            state.monSel = i;
            Audio.play('confirm');
            startFight(i);
            break;
          }
        }
      }
      if (state.name === 'monsterSelect') {
        if (confirmKey()) { Audio.play('confirm'); startFight(state.monSel); }
        else if (backKey()) { Audio.play('back'); setState('charSelect'); }
      }
      break;
    }

    case 'fight': {
      if (input.pressed('start') || input.pressed('back')) {
        Audio.play('select');
        state.pauseSel = 0;
        setState('pause');
        touch.releaseAll();
        break;
      }
      match.update();
      hud.update(match);
      touch.setMeter(match.a.meter);
      if (match.phase === 'matchEnd' && match.phaseT > 100) {
        buildResult();
      }
      break;
    }

    case 'pause': {
      if (input.pressed('up')) state.pauseSel = cycle(state.pauseSel || 0, PAUSE_ITEMS.length, -1);
      if (input.pressed('down')) state.pauseSel = cycle(state.pauseSel || 0, PAUSE_ITEMS.length, 1);

      const tap = input.takeTap();
      if (tap && !state.editing) {
        for (let i = 0; i < PAUSE_ITEMS.length; i++) {
          if (inRect(tap, pauseRect(i))) { state.pauseSel = i; pauseChoose(i); break; }
        }
      }

      if (!state.editing) {
        if (confirmKey()) pauseChoose(state.pauseSel || 0);
        else if (backKey()) { Audio.play('back'); setState('fight'); }
      } else if (backKey()) {
        touch.stopEdit();
        state.editing = false;
      }
      break;
    }

    case 'result': {
      const tap = input.takeTap();
      if (confirmKey() || tap) { Audio.play('confirm'); resultConfirm(); }
      else if (backKey()) { Audio.play('back'); toTitle(); }
      break;
    }
  }

  input.clearTaps();

  /* 触屏层只在战斗 / 暂停中显示 */
  const showTouch = touchable && (state.name === 'fight' || state.name === 'pause');
  touch.show(showTouch);
  if (state.name !== 'fight' && state.name !== 'pause' && state.editing) {
    state.editing = false;
    touch.stopEdit();
  }
}

function pauseChoose(i) {
  if (!match) { toTitle(); return; }
  if (i === 0) {
    Audio.play('confirm');
    clearCombatInput();
    setState('fight');
  } else if (i === 1) {
    Audio.play('confirm');
    startFight(run.monsterIndex);
  } else if (i === 2) {
    if (!state.editing) {
      state.editing = true;
      touch.startEdit();
      Audio.play('select');
    } else {
      state.editing = false;
      touch.stopEdit();
      Audio.play('confirm');
    }
  } else if (i === 3) {
    Audio.play('back');
    toTitle();
  }
}

/* ---- 渲染 ---------------------------------------------------------------- */

function renderLoading() {
  ctx.fillStyle = '#05070a';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  cjk(ctx, '光之战士', 240, 92, { size: 30, align: 'center', bold: true, color: '#eaf6ff', shadow: '#1a5f8a' });
  cjk(ctx, '像素对决', 240, 132, { size: 12, align: 'center', color: '#63e2ff' });
  const k = Math.min(1, state.t / 48);
  rect(ctx, 150, 174, 180, 8, '#101b24');
  frame(ctx, 150, 174, 180, 8, '#2f4a5c');
  rect(ctx, 152, 176, Math.round(176 * k), 4, '#63e2ff');
  cjk(ctx, '正在程序化生成像素资产…', 240, 194, { size: 9, align: 'center', color: '#5f8ba1' });
}

function render() {
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);

  switch (state.name) {
    case 'loading': renderLoading(); break;
    case 'title': drawTitle(ctx, state.time); break;
    case 'modeSelect': drawModeSelect(ctx, state.time, state.modeSel, state.diff); break;
    case 'charSelect': drawCharSelect(ctx, state.time, HEROES, state.charSel); break;
    case 'monsterSelect': drawMonsterSelect(ctx, state.time, MONSTERS, state.monSel); break;
    case 'fight':
      if (match) { match.draw(ctx, state.time); hud.draw(ctx, match, state.time); }
      break;
    case 'pause':
      if (match) {
        match.draw(ctx, state.time);
        hud.draw(ctx, match, state.time);
        drawPause(ctx, state.time, state.pauseSel || 0, state.editing);
      }
      break;
    case 'result':
      drawResult(ctx, state.time, result || { win: false, lines: [] });
      break;
  }

  /* 调试叠层 */
  if (debug.hitbox && match && (state.name === 'fight' || state.name === 'pause')) {
    match.drawDebug(ctx);
  }
  if (debug.fps) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(4, VIEW_H - 18, 118, 14);
    cjk(ctx, 'FPS ' + debug.fpsVal + '  逻辑 60Hz', 8, VIEW_H - 15, { size: 8, color: '#8cf0a8' });
  }
}

/* ---- 固定 60Hz 主循环 ---------------------------------------------------- */

const STEP = 1000 / 60;
let acc = 0;
let last = 0;

function loop(now) {
  if (!last) { last = now; debug.fpsAt = now; }
  let dt = now - last;
  last = now;
  if (dt > 100) dt = 100;
  acc += dt;

  let steps = 0;
  while (acc >= STEP && steps < 5) {
    tick();
    acc -= STEP;
    steps++;
  }
  if (steps === 5) acc = 0;

  /* 调试 FPS：每 0.5 秒统计一次渲染帧数 */
  debug.frames++;
  if (now - debug.fpsAt >= 500) {
    debug.fpsVal = Math.round(debug.frames * 1000 / (now - debug.fpsAt));
    debug.frames = 0;
    debug.fpsAt = now;
  }

  render();
  requestAnimationFrame(loop);
}

/* 初始化暂停菜单选中项 */
state.pauseSel = 0;

/* 页面隐藏时自动暂停 */
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.name === 'fight') setState('pause');
});

requestAnimationFrame(loop);

/* 便于调试：控制台可查看当前状态 */
window.__game = { get state() { return state.name; }, get match() { return match; }, debug };
