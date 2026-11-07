/* =============================================================================
 * game/fighter.js ── 战斗单位（玩家 / AI / 怪兽通用）
 *  · 帧驱动的状态机：idle / walk / crouch / jump / attack / block /
 *    blockstun / hitstun / airhit / knockdown / getup / dash / ko / win
 *  · 招式判定、伤害结算交给 combat.js，本文件只负责状态与物理
 * ========================================================================== */
import { ARENA_MIN_X, ARENA_MAX_X, GROUND_Y } from '../core/canvas.js';
import { toWorld } from './hitbox.js';
import { Audio } from '../core/audio.js';
import {
  groundNeutral, tryAttack, startMove, attackState
} from './fighterMoves.js';

const GRAVITY = 0.32;          // 每帧重力（跳跃 44 帧：2 * 7.04 / 0.32）

export class Fighter {
  constructor(def, opts = {}) {
    this.def = def;
    this.isPlayer = !!opts.isPlayer;
    this.control = opts.control || null;
    this.groundY = opts.groundY || GROUND_Y;

    this.maxHp = def.stats.hp;
    this.hp = this.maxHp;
    this.meter = opts.meter || 0;
    this.guard = 100;
    this.guardTimer = 0;

    this.x = opts.x || 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.facing = opts.facing || 1;
    this.grounded = true;

    this.state = 'idle';
    this.stateTimer = 0;
    this.animT = 0;              // 动作进度（0..1，用于精灵）
    this.move = null;
    this.moveKey = null;
    this.moveFrame = 0;
    this.hitIds = new Set();
    this.hitConfirmed = false;
    this.spawned = false;
    this.armorLeft = 0;
    this.invuln = 0;
    this.hitstop = 0;
    this.flash = 0;
    this.comboIndex = 0;
    this.comboTimer = 0;
    this.speedMul = 1;
    this.slowT = 0;
    this.poisonT = 0;
    this.trapT = 0;
    this._frame = 0;
    this._lastTap = null;
    this.blocking = false;
    this.crouching = false;
    this.juggle = 0;
    this.dead = false;
    this.winPose = false;
    this.techWindow = 0;
    this.landLock = 0;
    this.mechDone = false;
    this.phase2 = false;
  }

  get height() { return this.def.h || 108; }

  /** 回合开始重置（能量槽跨回合保留） */
  resetRound(x, facing) {
    this.hp = this.maxHp;
    this.guard = 100;
    this.guardTimer = 0;
    this.x = x;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.facing = facing;
    this.grounded = true;
    this.state = 'idle';
    this.stateTimer = 0;
    this.animT = 0;
    this.move = null;
    this.moveKey = null;
    this.moveFrame = 0;
    this.hitIds.clear();
    this.hitConfirmed = false;
    this.spawned = false;
    this.armorLeft = 0;
    this.invuln = 0;
    this.hitstop = 0;
    this.flash = 0;
    this.comboIndex = 0;
    this.comboTimer = 0;
    this.speedMul = 1;
    this.slowT = 0;
    this.poisonT = 0;
    this.trapT = 0;
    this.blocking = false;
    this.crouching = false;
    this.juggle = 0;
    this.dead = false;
    this.winPose = false;
    this.mechDone = false;
    this.phase2 = false;
    this._lastTap = null;
  }

  /* ---- 输入 -------------------------------------------------------------- */

  _snap() {
    if (!this.control) return { left: false, right: false, up: false, down: false, light: false, heavy: false, special: false, super: false, special2: false };
    return this.control.snapshot();
  }

  _use(key) {
    if (this.control && this.control.consume) this.control.consume(key);
  }

  /* ---- 每帧更新 ---------------------------------------------------------- */

  update(opponent) {
    this._frame++;
    if (this.hitstop > 0) { this.hitstop--; return; }
    if (this.state === 'ko') { this._physics(); return; }
    if (this.flash > 0) this.flash--;

    if (this.invuln > 0) this.invuln--;
    if (this.slowT > 0) {
      this.slowT--;
      if (this.slowT <= 0) this.speedMul = 1;
    }
    if (this.poisonT > 0) {
      this.poisonT--;
      if (this.poisonT % 12 === 0 && this.hp > 1) this.hp -= 0.6;
    }
    if (this.comboTimer > 0) {
      this.comboTimer--;
      if (this.comboTimer <= 0) this.comboIndex = 0;
    }
    if (this.trapT > 0) this.trapT--;
    if (this.guardTimer > 0) this.guardTimer--;
    else if (this.guard < 100) this.guard = Math.min(100, this.guard + 0.35);

    const c = this._snap();
    this.crouching = false;

    switch (this.state) {
      case 'idle':
      case 'walk':
      case 'block':
      case 'crouch': this._groundNeutral(c, opponent); break;
      case 'win': this.vx *= 0.9; break;
      case 'dash': this._dashState(c); break;
      case 'backdash': this._backdashState(); break;
      case 'jump': this._airState(c); break;
      case 'attack': this._attackState(c); break;
      case 'blockstun': this._stunState('blockstun'); break;
      case 'hitstun': this._stunState('hitstun'); break;
      case 'airhit': this._airHitState(); break;
      case 'knockdown':
        this.stateTimer--;
        this.vx *= 0.86;
        if (this.stateTimer <= 0) { this.state = 'getup'; this.stateTimer = 12; this.invuln = Math.max(this.invuln, 18); }
        break;
      case 'getup':
        this.stateTimer--;
        if (this.stateTimer <= 0) { this.state = 'idle'; this.stateTimer = 0; }
        break;
      default: break;
    }

    this._physics();

    /* 滞空怪兽：非受击 / 非倒地时保持悬浮高度 */
    if (this.def.flags && this.def.flags.hover &&
        this.state !== 'ko' && this.state !== 'knockdown' &&
        this.state !== 'airhit' && this.state !== 'getup') {
      this.grounded = true;
      this.y = this.def.flags.hover;
      this.vy = 0;
    }

    /* 落地判定 */
    if (!this.grounded && this.y <= 0) {
      this.y = 0;
      this.vy = 0;
      this.grounded = true;
      if (this.state === 'airhit') {
        /* 受身：落地前 6 帧内按轻击 */
        if (this.techWindow > 0 && this.control && this.control.buffered && this.control.buffered('light')) {
          this._use('light');
          this.state = 'getup';
          this.stateTimer = 10;
          this.invuln = 26;
          this.vx = 0;
          Audio.play('tech');
        } else {
          this.state = 'knockdown';
          this.stateTimer = 34;
          this.vx = -this.facing * 1.6;
        }
      } else if (this.state === 'jump' || this.state === 'attack') {
        if (this.state === 'attack') {
          this.state = 'idle';
          this.move = null; this.moveKey = null;
        } else {
          this.state = 'idle';
        }
        Audio.play('land');
      }
    }
    if (this.state === 'airhit' && !this.grounded) this.techWindow = this.y < 16 ? 6 : 0;
  }

  /* ---- 地面中立 ---------------------------------------------------------- */

  _groundNeutral(c, opp) {
    groundNeutral(this, c, opp);
  }

  _walkAudio(on) {
    if (!on) { this._stepT = 0; return; }
    this._stepT = (this._stepT || 0) + Math.abs(this.vx) * 0.06;
    if (this._stepT > 1) {
      this._stepT = 0;
      if (Math.random() < 0.35) Audio.play('land');
    }
  }

  _dash(dir) {
    this.state = 'dash';
    this.stateTimer = 14;
    this.invuln = 0;
    this.vx = dir * this.def.stats.dash;
    Audio.play('whiff');
  }

  _backdash(dir) {
    this.state = 'backdash';
    this.stateTimer = 18;
    this.invuln = 3;
    /* 首帧 8px 位移，其余靠速度衰减，符合帧表 */
    this.x += dir * 8;
    this.vx = dir * this.def.stats.dash * 0.5;
    Audio.play('whiff');
  }

  _dashState(c) {
    this.stateTimer--;
    this.vx *= 0.92;
    if (this._tryAttack(c, this.facing > 0 ? c.right : c.left)) return;
    if (this.stateTimer <= 0) { this.state = 'idle'; this.vx *= 0.4; }
  }

  _backdashState() {
    this.stateTimer--;
    this.vx *= 0.9;
    if (this.stateTimer <= 0) this.state = 'idle';
  }

  _airState(c) {
    if (this._tryAttack(c, false, true)) return;
    this.facing = this.facing || 1;
  }

  _airHitState() {
    this.stateTimer--;
    if (this.stateTimer <= 0) this.stateTimer = 0;
  }

  _stunState(kind) {
    this.stateTimer--;
    if (this.stateTimer <= 0) {
      this.state = 'idle';
      this.stateTimer = 0;
      this.vx *= 0.4;
    }
  }

  /* ---- 出招 -------------------------------------------------------------- */

  _tryAttack(c, fwd, airborne) {
    return tryAttack(this, c, fwd, airborne);
  }

  startMove(key) {
    return startMove(this, key);
  }

  _attackState(c) {
    attackState(this, c);
  }

  /* ---- 物理 -------------------------------------------------------------- */

  _physics() {
    if (!this.grounded) {
      this.vy -= GRAVITY;
      this.y += this.vy;
      if (this.y < 0) this.y = 0;
    }
    this.x += this.vx;
    if (this.x < ARENA_MIN_X) { this.x = ARENA_MIN_X; this.vx = 0; }
    if (this.x > ARENA_MAX_X) { this.x = ARENA_MAX_X; this.vx = 0; }
    if (this.grounded) this.vx *= 0.86;
  }

  /* ---- 受击 -------------------------------------------------------------- */

  /** 受击硬直（由 combat 调用） */
  onHit(stun, push, knockdown, srcX) {
    const dir = this.x >= srcX ? 1 : -1;
    this.move = null; this.moveKey = null;
    this.comboIndex++;
    this.comboTimer = 90;
    this.facing = -dir;
    this.flash = 4;
    this.blocking = false;
    this.armorLeft = 0;

    if (!this.grounded) {
      this.state = 'airhit';
      this.stateTimer = stun;
      this.juggle++;
      this.vy = 1.6;
      this.vx = dir * push * 0.7;
    } else if (knockdown) {
      this.state = 'knockdown';
      this.stateTimer = 38;
      this.vx = dir * push;
      this.vy = 1.2;
      this.grounded = false;
    } else {
      this.state = 'hitstun';
      this.stateTimer = stun;
      this.vx = dir * push;
    }
  }

  /** 防御硬直 */
  onBlock(stun, push, srcX, chip) {
    const dir = this.x >= srcX ? 1 : -1;
    this.state = 'blockstun';
    this.stateTimer = stun;
    this.vx = dir * push * 0.55;
    if (chip) this.hp = Math.max(0, this.hp - chip);
  }

  /** 破防 */
  onGuardBreak() {
    this.state = 'hitstun';
    this.stateTimer = 20;
    this.guard = 100;
    this.guardTimer = 120;
  }

  /** 被投技 */
  onThrown(damage, srcX) {
    const dir = this.x >= srcX ? 1 : -1;
    this.hp = Math.max(0, this.hp - damage);
    this.state = 'knockdown';
    this.stateTimer = 46;
    this.vx = dir * 4;
    this.vy = 1.6;
    this.grounded = false;
    this.flash = 5;
  }

  onKO() {
    this.dead = true;
    this.state = 'ko';
    this.move = null;
    this.hp = 0;
    this.vx = -this.facing * 1.4;
    this.flash = 0;
  }

  /* ---- 判定框 ------------------------------------------------------------ */

  hurtboxes() {
    if (this.invuln > 0 || this.state === 'ko') return [];
    const H = this.height;
    const bw = (this.def.body ? this.def.body.bulk || this.def.body.w || 1 : 1) * (this.def.kind ? H * 0.20 : 16);
    let h, cy;
    if (this.state === 'crouch' || this.crouching || (this.state === 'attack' && this.move && this.move.anim === 'low')) {
      h = H * 0.70; cy = -h / 2;
    } else if (!this.grounded) {
      h = H * 0.82; cy = -H * 0.44;
    } else {
      h = H; cy = -H / 2;
    }
    return [toWorld(this, { x: 0, y: cy, w: bw, h })];
  }

  /** 当前帧生效的判定框（世界坐标） */
  attackBoxes() {
    if (this.state !== 'attack' || !this.move) return [];
    const out = [];
    for (const b of this.move.hitboxes) {
      if (this.moveFrame >= b.from && this.moveFrame <= b.to) out.push(toWorld(this, b));
    }
    return out;
  }

  /* ---- 渲染信息 ---------------------------------------------------------- */

  animAction() {
    switch (this.state) {
      case 'attack': return this.move ? this.move.anim : 'idle';
      case 'block': return 'block';
      case 'blockstun': return this.crouching ? 'crouchBlock' : 'block';
      case 'hitstun': return 'hit';
      case 'airhit': return 'hit';
      case 'knockdown': return 'ko';
      case 'getup': return 'crouch';
      case 'ko': return 'ko';
      case 'win': return 'win';
      case 'crouch': return this.blocking ? 'crouchBlock' : 'crouch';
      case 'dash': return 'dash';
      case 'backdash': return 'backdash';
      case 'jump': return this.vy > 0 ? 'jump' : 'fall';
      case 'walk': return 'walk';
      default: return 'idle';
    }
  }

  /** 动画进度 0..1 */
  animProgress() {
    if (this.state === 'attack' && this.move) {
      return Math.min(1, this.moveFrame / this.move.total);
    }
    if (this.state === 'walk') {
      this._walkT = ((this._walkT || 0) + 0.032) % 1;
      return this._walkT;
    }
    if (this.state === 'idle' || this.state === 'block' || this.state === 'crouch') {
      this._idleT = ((this._idleT || 0) + 0.006) % 1;
      return this._idleT;
    }
    if (this.state === 'hit' || this.state === 'hitstun' || this.state === 'airhit') return 0.5;
    if (this.state === 'dash' || this.state === 'backdash') return 0.5;
    return 0.25;
  }
}
