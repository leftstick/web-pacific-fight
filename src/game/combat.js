/* =============================================================================
 * game/combat.js ── 命中结算与怪兽机制
 *  · 格挡判定：按住后 / 下段必须蹲防 / 跳跃攻击必须站防 / 投技不可防
 *  · 连段递减 100/90/80/70/60%，之后逐级降到 30% 下限
 *  · 浮空追打上限 3 段；霸体、反伤、破防、多段、投射物、陷阱、毒雾、落雷
 *  · 所有特效坐标：x 为世界坐标，y 为屏幕坐标（由主循环统一平移镜头）
 * ========================================================================== */
import { GROUND_Y, ARENA_W } from '../core/canvas.js';
import { overlaps, overlapCenter } from './hitbox.js';
import { hitSparks, blockSparks, dust, shockRing, damageText } from '../art/fx.js';
import { Audio } from '../core/audio.js';

const COMBO_SCALE = [1, 0.9, 0.8, 0.7, 0.6];

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

function damageScale(index) {
  if (index < COMBO_SCALE.length) return COMBO_SCALE[index];
  return Math.max(0.3, 0.6 - (index - 4) * 0.05);
}

export class Combat {
  constructor() {
    this.projectiles = [];
    this.hazards = [];
    this.onEvent = null;            // (type, data) => void，交给 match 做震屏/音效
  }

  reset() {
    this.projectiles.length = 0;
    this.hazards.length = 0;
  }

  _event(type, data) {
    if (this.onEvent) this.onEvent(type, data);
  }

  /* ---- 每逻辑帧 ---------------------------------------------------------- */

  update(a, b) {
    /* 命中停顿期间整个世界冻结，不再产生新判定 */
    if (a.hitstop > 0 || b.hitstop > 0) return;

    this._mechanics(a, b);
    this._mechanics(b, a);
    this._resolve(a, b);
    this._resolve(b, a);
    this._updateProjectiles(a, b);
    this._updateHazards(a, b);
    this._checkPhase(a);
    this._checkPhase(b);
  }

  /* ---- 招式附带的机制（只在指定帧触发一次） ------------------------------ */

  _mechanics(unit, opp) {
    const mv = unit.move;
    if (!mv || unit.state !== 'attack') return;
    const f = unit.moveFrame;

    if (mv.spawnFrame != null && !unit.spawned && f >= mv.spawnFrame) {
      unit.spawned = true;
      this._spawn(unit, opp, mv);
    }

    /* 钻地：中途瞬移到对手背后，破土时才有判定 */
    if (mv.mechanic === 'burrow' && !unit.mechDone && f >= 18) {
      unit.mechDone = true;
      this._warpBehind(unit, opp);
      unit.invuln = Math.max(unit.invuln, 12);
      dust(unit.x, GROUND_Y - 4, 12, '#b49a63', 30);
      shockRing(unit.x, GROUND_Y - 18, '#c89b3c', 14);
      Audio.play('roar');
    }

    /* 滞空俯冲：起手直接抬高，落地才算结束 */
    if (mv.mechanic === 'dive' && !unit.mechDone) {
      unit.mechDone = true;
      unit.grounded = false;
      unit.y = Math.max(unit.y, 46);
      unit.vy = 0;
      Audio.play('roar');
    }

    /* 多段触手：每段命中后轻微后撤，避免一次贴死 */
    if (mv.mechanic === 'multi' && unit.hitConfirmed) {
      unit.vx *= 0.86;
    }

    /* 震波：命中帧震屏 */
    if (mv.mechanic === 'shockwave' && f === mv.startup + 1 && !unit.mechDone) {
      unit.mechDone = true;
      shockRing(unit.x + unit.facing * 50, GROUND_Y - 10, '#ff5a3c', 26);
      this._event('shake', { mag: 5, frames: 16 });
      Audio.play('hitSuper');
    }
  }

  _warpBehind(unit, opp) {
    const back = opp.facing > 0 ? -1 : 1;
    unit.x = clamp(opp.x + back * 46, 52, ARENA_W - 52);
    unit.facing = opp.x >= unit.x ? 1 : -1;
    unit.vx = 0;
  }

  _spawn(unit, opp, mv) {
    const p = mv.projectile;
    if (p) {
      this.projectiles.push({
        x: unit.x + unit.facing * 40,
        y: GROUND_Y - (unit.y + 58),
        vx: unit.facing * p.speed,
        w: p.w, h: p.h, life: p.life, age: 0,
        damage: p.damage, hitstun: p.hitstun, level: p.level || 'mid',
        color: p.color, kind: p.kind || 'energy',
        dir: unit.facing, owner: unit
      });
      if (p.kind === 'fire') Audio.play('fire');
      else Audio.play('special');
      return;
    }

    const st = mv.strike;
    if (st) {
      this.hazards.push({
        type: 'strike', x: opp.x, timer: st.warning, radius: st.radius,
        damage: st.damage, hitstun: st.hitstun, color: st.color || '#6fd0ff',
        struck: false, flash: 0, life: st.warning + 30, owner: unit
      });
      Audio.play('thunder');
      return;
    }

    const tr = mv.trap;
    if (tr) {
      this.hazards.push({
        type: 'trap', x: unit.x + unit.facing * 62, w: tr.w,
        life: tr.life, duration: tr.duration, slow: tr.slow, hit: false, owner: unit
      });
      Audio.play('special');
      return;
    }

    const cl = mv.cloud;
    if (cl) {
      this.hazards.push({
        type: 'cloud', x: unit.x + unit.facing * 68, y: GROUND_Y - 44,
        w: cl.w, h: cl.h, life: cl.life, dps: cl.dps, color: cl.color || '#8de03c', owner: unit
      });
      Audio.play('fire');
      return;
    }

    if (mv.mechanic === 'teleport') {
      this._warpBehind(unit, opp);
      unit.invuln = Math.max(unit.invuln, 10);
      dust(unit.x, GROUND_Y - 4, 10, '#57ffb0', 24);
      shockRing(unit.x, GROUND_Y - 24, '#57ffb0', 16);
      Audio.play('special');
    }
  }

  /* ---- 近身命中 ---------------------------------------------------------- */

  _resolve(attacker, defender) {
    if (defender.dead) return;
    const boxes = attacker.attackBoxes();
    if (!boxes.length) return;
    const mv = attacker.move;
    if (!mv) return;

    const hurt = defender.hurtboxes();
    if (!hurt.length) return;

    for (let i = 0; i < boxes.length; i++) {
      if (attacker.hitIds.has(i)) continue;
      for (const h of hurt) {
        if (!overlaps(boxes[i], h)) continue;

        attacker.hitIds.add(i);
        /* 投技不能抓浮空 / 无投技判定的对手 */
        if (mv.level === 'throw' && (!defender.grounded || (defender.def.flags && defender.def.flags.noThrow))) {
          break;
        }
        /* 浮空追打上限 3 段 */
        if (!defender.grounded && defender.juggle >= 3) break;

        const c = overlapCenter(boxes[i], h);
        attacker.hitConfirmed = true;
        this._applyHit(attacker, defender, mv, c.x, c.y, attacker.x);
        break;
      }
    }
  }

  /**
   * 结算一次命中。
   * @param {object} attacker
   * @param {object} defender
   * @param {object} mv 招式数据（或投射物/落雷的伪招式）
   * @param {number} cx 命中点世界 x
   * @param {number} cy 命中点屏幕 y
   * @param {number} srcX 攻击来源 x（用于推开方向）
   */
  _applyHit(attacker, defender, mv, cx, cy, srcX) {
    if (defender.dead || defender.invuln > 0) return;
    const level = mv.level || 'mid';

    /* 浮空追打上限 3 段（投技除外） */
    if (!defender.grounded && defender.juggle >= 3 && level !== 'throw') return;

    /* ---- 格挡判定 ---- */
    const stanceOk = defender.blocking && defender.grounded &&
      (defender.state === 'idle' || defender.state === 'walk' || defender.state === 'block' ||
       defender.state === 'crouch' || defender.state === 'blockstun');
    let blocked = stanceOk && level !== 'throw' && level !== 'unblockable';
    if (blocked && level === 'low') blocked = !!defender.crouching;       // 下段：必须蹲防
    if (blocked && level === 'overhead') blocked = !defender.crouching;   // 跳攻：必须站防

    if (blocked) {
      const chip = mv.damage * (mv.chip == null ? 0.12 : mv.chip) * 0.5;
      defender.meter = Math.min(100, defender.meter + 1);
      defender.guard -= mv.damage * 0.55;

      if (defender.guard <= 0) {
        defender.guard = 0;
        defender.onGuardBreak();
        defender.hitstop = 10;
        attacker.hitstop = 10;
        blockSparks(cx, cy, attacker.facing);
        shockRing(cx, cy, '#ffd27a', 12);
        damageText(cx, cy - 12, '破防', '#ffd27a');
        this._event('shake', { mag: 3, frames: 10 });
        Audio.play('block');
      } else {
        defender.onBlock(mv.blockstun || 8, (mv.push || 2) * 0.55, srcX, chip);
        defender.hitstop = 4;
        attacker.hitstop = 4;
        blockSparks(cx, cy, attacker.facing);
        Audio.play('block');
        this._event('shake', { mag: 1.5, frames: 6 });
      }

      /* 甲壳反伤：防御成功时把一部分伤害弹回攻击者 */
      const reflect = defender.def.flags && defender.def.flags.reflect;
      if (reflect) {
        attacker.hp = Math.max(0, attacker.hp - mv.damage * reflect);
        attacker.flash = 3;
        damageText(attacker.x, GROUND_Y - 90, Math.round(mv.damage * reflect), '#a9ff9a');
        Audio.play('hitLight');
      }
      return;
    }

    /* ---- 命中 ---- */
    const scale = damageScale(defender.comboIndex);
    let dmg = mv.damage * scale;

    attacker.meter = Math.min(100, attacker.meter + (mv.meterGain == null ? 2 : mv.meterGain));
    defender.meter = Math.min(100, defender.meter + 3);

    /* 霸体：硬吃这一下，不进入受击硬直 */
    if (defender.armorLeft > 0 && level !== 'throw' && level !== 'unblockable') {
      defender.armorLeft--;
      dmg *= 0.6;
      defender.hp = Math.max(0, defender.hp - dmg);
      defender.flash = 4;
      defender.hitstop = 8;
      attacker.hitstop = 8;
      const dir = defender.x >= attacker.x ? 1 : -1;
      defender.vx = dir * (mv.push || 2) * 0.4;
      hitSparks(cx, cy, attacker.facing, 2, '#ffd27a');
      damageText(cx, cy - 8, Math.round(dmg), '#ffe6a8');
      this._event('shake', { mag: 3, frames: 10 });
      Audio.play('hitHeavy');
      if (defender.hp <= 0) defender.onKO();
      return;
    }

    defender.hp = Math.max(0, defender.hp - dmg);
    defender.onHit(mv.hitstun || 14, mv.push || 2, !!mv.knockdown, srcX);

    const stop = mv.hitstop == null ? 6 : mv.hitstop;
    defender.hitstop = stop;
    attacker.hitstop = stop;

    const lv = stop >= 20 ? 3 : stop >= 10 ? 2 : 1;
    const fxColor = level === 'low' ? '#ffc14d' : '#ffe6a8';
    hitSparks(cx, cy, attacker.facing, lv, fxColor);
    damageText(cx, cy - 10, Math.round(dmg), lv >= 3 ? '#ffd27a' : '#ffffff');
    if (lv >= 3) {
      shockRing(cx, cy, '#ffd27a', 18);
      this._event('shake', { mag: 5, frames: 18 });
    } else {
      this._event('shake', { mag: lv === 2 ? 3 : 1.5, frames: lv === 2 ? 10 : 6 });
    }

    Audio.play(mv.hitSfx || (lv === 1 ? 'hitLight' : 'hitHeavy'));

    if (defender.hp <= 0) {
      defender.onKO();
      this._event('ko', { attacker, defender });
    }
  }

  /* ---- 投射物 ------------------------------------------------------------ */

  _updateProjectiles(a, b) {
    for (const p of this.projectiles) {
      p.x += p.vx;
      p.age++;
      p.life--;
      if (p.life <= 0 || p.x < -40 || p.x > ARENA_W + 40) { p.dead = true; continue; }

      const target = p.owner === a ? b : a;
      if (target.dead || target.invuln > 0) continue;

      const box = { x1: p.x - p.w / 2, x2: p.x + p.w / 2, y1: p.y - p.h / 2, y2: p.y + p.h / 2, cx: p.x, cy: p.y };
      let hit = null;
      for (const h of target.hurtboxes()) {
        if (overlaps(box, h)) { hit = h; break; }
      }
      if (hit) {
        p.dead = true;
        const c = overlapCenter(box, hit);
        this._applyHit(p.owner, target, {
          damage: p.damage, hitstun: p.hitstun, blockstun: 10, push: 2.4,
          level: p.level, hitstop: 8, hitSfx: 'hitHeavy', knockdown: false,
          chip: 0.1, meterGain: 2
        }, c.x, c.y, p.x);
      }
    }
    if (this.projectiles.some((p) => p.dead)) {
      this.projectiles = this.projectiles.filter((p) => !p.dead);
    }
  }

  /* ---- 场地机关 ---------------------------------------------------------- */

  _updateHazards(a, b) {
    for (const h of this.hazards) {
      h.life--;
      const target = h.owner === a ? b : a;
      if (!target) continue;

      if (h.type === 'trap') {
        if (target.grounded && target.trapT <= 0 && Math.abs(target.x - h.x) <= h.w / 2) {
          target.trapT = h.duration;
          h.dead = true;
          dust(target.x, GROUND_Y - 6, 8, '#8bd06f', 18);
          Audio.play('block');
        } else if (h.life <= 0) {
          h.dead = true;
        }
      } else if (h.type === 'cloud') {
        if (!target.dead && target.grounded && target.y < 10 && Math.abs(target.x - h.x) <= h.w / 2) {
          target.poisonT = Math.max(target.poisonT, 60);
        }
        if (h.life <= 0) h.dead = true;
      } else if (h.type === 'strike') {
        h.timer--;
        if (h.flash > 0) h.flash--;
        if (!h.struck && h.timer <= 0) {
          h.struck = true;
          h.flash = 16;
          shockRing(h.x, GROUND_Y - 6, h.color, 18);
          this._event('shake', { mag: 4, frames: 14 });
          Audio.play('thunder');
          if (target.grounded && Math.abs(target.x - h.x) <= h.radius && target.invuln <= 0) {
            this._applyHit(h.owner, target, {
              damage: h.damage, hitstun: h.hitstun, blockstun: 12, push: 3,
              level: 'mid', hitstop: 10, hitSfx: 'hitHeavy', knockdown: false,
              chip: 0.1, meterGain: 2
            }, target.x, GROUND_Y - 60, h.x);
          }
        }
        if (h.timer < -20) h.dead = true;
      }
    }
    if (this.hazards.some((h) => h.dead)) {
      this.hazards = this.hazards.filter((h) => !h.dead);
    }
  }

  _checkPhase(unit) {
    const f = unit.def.flags;
    if (!f || !f.phases || unit.phase2) return;
    if (unit.hp > unit.maxHp * 0.5) return;
    unit.phase2 = true;
    unit.flash = 10;
    shockRing(unit.x, GROUND_Y - 70, '#ff5a3c', 30);
    dust(unit.x, GROUND_Y - 6, 16, '#ff5a3c', 40);
    Audio.play('roar');
    this._event('phase', { unit });
  }

  /* ---- 绘制（需在镜头平移后的世界坐标系中调用） -------------------------- */

  draw(ctx, time) {
    /* 投射物 */
    for (const p of this.projectiles) {
      const x = Math.round(p.x), y = Math.round(p.y);
      const flick = (p.age >> 2) % 2;
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = p.color;
      for (let i = 1; i <= 4; i++) {
        ctx.fillRect(x - p.dir * i * 5 - 2, y - 2 + (i % 2 ? flick : 0), 4, 4);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = p.color;
      ctx.fillRect(x - p.w / 2, y - p.h / 2, p.w, p.h);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 3, y - 3, 6, 6);
      if (p.kind === 'fire') {
        ctx.fillStyle = '#ffb04a';
        ctx.fillRect(x - p.w / 2 - 3, y - 2, 3, 4);
      }
    }

    /* 机关 */
    for (const h of this.hazards) {
      if (h.type === 'trap') {
        ctx.strokeStyle = '#8bd06f';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(Math.round(h.x), GROUND_Y - 3, h.w / 2, Math.PI, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = '#c9ff6f';
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.moveTo(h.x + i * 8, GROUND_Y - 4);
          ctx.lineTo(h.x + i * 12, GROUND_Y - 26);
          ctx.stroke();
        }
      } else if (h.type === 'cloud') {
        const n = 14;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + time * 0.02;
          const rx = Math.cos(a) * h.w * 0.5 * (0.6 + (i % 3) * 0.15);
          const ry = Math.sin(a) * h.h * 0.4;
          ctx.globalAlpha = 0.24 + (i % 4) * 0.05;
          ctx.fillStyle = h.color;
          ctx.fillRect(Math.round(h.x + rx), Math.round(h.y + ry), 7, 5);
        }
        ctx.globalAlpha = 1;
      } else if (h.type === 'strike') {
        if (!h.struck) {
          const pulse = 3 + Math.sin(h.timer * 0.5) * 2;
          ctx.strokeStyle = h.color;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(Math.round(h.x), GROUND_Y - 4, h.radius + pulse, Math.PI, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = h.color;
          ctx.fillRect(Math.round(h.x) - 2, GROUND_Y - 6, 4, 4);
          ctx.globalAlpha = 1;
        } else if (h.flash > 0) {
          ctx.fillStyle = '#eaf6ff';
          let y = 70;
          let x = Math.round(h.x);
          while (y < GROUND_Y) {
            const w = 4 + (y % 3) * 2;
            ctx.fillRect(x - w / 2, y, w, 10);
            x += (y % 2 ? 5 : -5);
            y += 10;
          }
          ctx.fillStyle = h.color;
          ctx.fillRect(Math.round(h.x) - 12, GROUND_Y - 4, 24, 5);
        }
      }
    }
  }

}
