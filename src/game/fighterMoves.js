/* =============================================================================
 * game/fighterMoves.js ── 战斗单位的「地面中立 / 出招 / 招式推进」逻辑
 *  · 从 fighter.js 拆出，保持单模块 < 500 行
 *  · 全部以 Fighter 实例作为第一个参数，状态字段与主状态机完全一致
 * ========================================================================== */
import { Audio } from '../core/audio.js';

const FRICTION = 0.78;

/** 地面中立：移动、防御、蹲防、跳跃、双击前冲/后撤、出招 */
export function groundNeutral(f, c, opp) {
  if (!f.grounded) { f.state = 'jump'; return; }

  /* 每次落地后重新朝向对手（仅在未出招时） */
  if (opp && Math.abs(opp.x - f.x) > 4) f.facing = opp.x >= f.x ? 1 : -1;

  const fwd = f.facing > 0 ? c.right : c.left;
  const back = f.facing > 0 ? c.left : c.right;

  /* 攻击输入优先 */
  if (f._tryAttack(c, fwd)) return;

  /* 跳跃（起跳 12f 由 sprite 动画表现，44 帧滞空由物理保证） */
  if (c.up) {
    f._use('up');
    f.vy = 7.04 * (f.def.stats.jump / 7.0);
    f.grounded = false;
    f.state = 'jump';
    f.vx = ((c.right ? 1 : 0) - (c.left ? 1 : 0)) * 2.0;
    Audio.play('jump');
    return;
  }

  /* 按住「后」= 防御；按住「下 + 后」= 蹲防 */
  f.blocking = !!back;
  if (c.down) {
    f.state = 'crouch';
    f.crouching = true;
    f.vx *= 0.6;
    f._walkAudio(false);
    return;
  }

  const dir = (c.right ? 1 : 0) - (c.left ? 1 : 0);
  if (dir !== 0) {
    /* 双击方向：前 = 前冲，后 = 后撤（带 6 帧无敌） */
    const now = f._frame;
    if (!f._prevDir || f._prevDir !== dir) {
      const last = f._lastTap;
      if (last && last.dir === dir && now - last.f < 13 && f._lastTap.done !== now) {
        f._lastTap = { dir, f: 0, done: now };
        if (dir === f.facing) { f._dash(dir); return; }
        f._backdash(dir);
        return;
      }
      f._lastTap = { dir, f: now, done: 0 };
    }
    f._prevDir = dir;

    const speed = f.def.stats.walk * f.speedMul * (f.trapT > 0 ? 0.5 : 1);
    f.vx = dir * speed;
    f.state = 'walk';
    f._walkAudio(true);
  } else {
    f._prevDir = 0;
    f.vx *= FRICTION;
    f.state = 'idle';
    f._walkAudio(false);
  }
}

/** 攻击输入判定（优先级：二阶段必杀 > 超必杀 > 必杀 > 重击/投技 > 轻击） */
export function tryAttack(f, c, fwd, airborne) {
  const m = f.def.moves;
  const down = c.down;

  if (c.special2 && m.special2) {
    f._use('special2');
    f.startMove('special2');
    return true;
  }
  if (c.super && m.super && f.meter >= m.super.meterCost) {
    f._use('super');
    f.startMove('super');
    return true;
  }
  if (c.special && m.special && f.meter >= (m.special.meterCost || 0)) {
    f._use('special');
    /* 蹲 + 必杀键 = 超必杀（手柄/键盘无独立超必杀键时同样可用） */
    if (down && m.super && f.meter >= m.super.meterCost) f.startMove('super');
    else f.startMove('special');
    return true;
  }
  if (c.heavy && m.heavy) {
    f._use('heavy');
    /* 前 + 重击 = 投技（近身不可防） */
    if (!airborne && fwd && m.throw) { f.startMove('throw'); return true; }
    f.startMove('heavy');
    return true;
  }
  if (c.light && m.light) {
    f._use('light');
    if (airborne && m.air) f.startMove('air');
    else if (down && m.low) f.startMove('low');
    else f.startMove('light');
    return true;
  }
  return false;
}

/** 起招：扣除能量、重置命中记录、设置位移与音效 */
export function startMove(f, key) {
  const mv = f.def.moves[key];
  if (!mv) return false;
  if (mv.meterCost && f.meter < mv.meterCost) return false;
  if (mv.meterCost) f.meter -= mv.meterCost;

  f.move = mv;
  f.moveKey = key;
  f.moveFrame = 0;
  f.state = 'attack';
  f.stateTimer = 0;
  f.hitIds.clear();
  f.hitConfirmed = false;
  f.spawned = false;
  f.mechDone = false;
  f.armorLeft = mv.armor || 0;
  f.blocking = false;
  f.vx *= 0.25;
  if (mv.dash) f.vx = f.facing * mv.dash;
  if (f.grounded) f.y = 0;

  if (mv.meterCost >= 100) Audio.play('super');
  else if (mv.meterCost) Audio.play('special');
  else Audio.play('whiff');
  return true;
}

/** 招式推进：帧数递增、命中取消、结束回到中立 */
export function attackState(f, c) {
  if (!f.move) { f.state = 'idle'; return; }
  f.moveFrame++;

  /* 取消窗口：命中后可取消到更高阶招式 */
  if (f.hitConfirmed && f.grounded) {
    const chain = { light: ['heavy', 'special', 'super'], low: ['special', 'super'], heavy: ['special', 'super'] };
    const allowed = chain[f.moveKey] || [];
    if (allowed.includes('heavy') && c.heavy) { f._use('heavy'); f.startMove('heavy'); return; }
    if (allowed.includes('special') && c.special && f.def.moves.special) {
      const m = f.def.moves.special;
      if (f.meter >= (m.meterCost || 0)) { f._use('special'); f.startMove('special'); return; }
    }
    if (allowed.includes('super') && c.super && f.def.moves.super && f.meter >= 100) {
      f._use('super'); f.startMove('super'); return;
    }
  }

  f.vx *= 0.86;
  if (f.moveFrame >= f.move.total) {
    f.move = null;
    f.moveKey = null;
    f.state = f.grounded ? 'idle' : 'jump';
  }
}
