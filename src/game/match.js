/* =============================================================================
 * game/match.js ── 一场对战的完整回合流程
 *  · 三局两胜，每回合 99 秒；KO / 时间到按剩余血量判胜
 *  · KO 后 0.25 倍速慢动作 1 秒 + 镜头推进 + 败者倒地 / 胜者姿态
 *  · 负责镜头、舞台、角色、特效、投射物与机关的统一绘制
 * ========================================================================== */
import { GROUND_Y, ARENA_W } from '../core/canvas.js';
import { Fighter } from './fighter.js';
import { Combat } from './combat.js';
import { Camera } from './camera.js';
import { AIController } from './ai.js';
import { drawStage } from '../art/background.js';
import { drawSprite } from '../art/sprite.js';
import { drawGhosts, drawFx, resetFx } from '../art/fx.js';
import { Audio } from '../core/audio.js';

/** 把 Input 包装成 Fighter 能用的控制器 */
export function inputControl(input) {
  return {
    snapshot() {
      return {
        left: input.held('left'),
        right: input.held('right'),
        up: input.buffered('up'),
        down: input.held('down'),
        light: input.buffered('light'),
        heavy: input.buffered('heavy'),
        special: input.buffered('special'),
        super: input.buffered('super'),
        special2: false
      };
    },
    consume(a) { input.consume(a); },
    buffered(a) { return input.buffered(a); },
    pressed(a) { return input.pressed(a); }
  };
}

function spriteBucket(unit) {
  const st = unit.state;
  if (st === 'attack' && unit.move) return 'm' + unit.moveFrame;
  if (st === 'walk') return 'w' + ((unit._walkT || 0) * 8 | 0);
  if (st === 'idle' || st === 'block' || st === 'crouch') return 'i' + ((unit._idleT || 0) * 10 | 0);
  if (st === 'hitstun' || st === 'airhit') return 'h';
  if (st === 'knockdown' || st === 'ko' || st === 'win') return 's';
  if (st === 'jump' || st === 'fall') return 'j' + (unit.vy > 0 ? 'u' : 'd');
  return 'n';
}

export class Match {
  /**
   * @param {{hero:object, monster:object, stage:object, difficulty:number, input:object, training?:boolean}} opts
   */
  constructor(opts) {
    this.hero = opts.hero;
    this.monster = opts.monster;
    this.stage = opts.stage;
    this.difficulty = opts.difficulty || 1;
    this.training = !!opts.training;

    this.combat = new Combat();
    this.camera = new Camera();

    this.a = new Fighter(this.hero, {
      isPlayer: true,
      control: inputControl(opts.input),
      x: 206, facing: 1, groundY: GROUND_Y
    });
    this.b = new Fighter(this.monster, {
      isPlayer: false,
      x: ARENA_W - 206, facing: -1, groundY: GROUND_Y
    });
    this.ai = new AIController(this.b, this.a, this.difficulty);
    this.b.control = this.ai;

    this.round = 1;
    this.wins = [0, 0];
    this.timer = 99 * 60;
    this.phase = 'intro';         // intro / fight / roundEnd / matchEnd
    this.phaseT = 0;
    this.tick = 0;
    this.reason = '';             // ko / time / draw
    this.roundWinner = null;
    this.matchWinner = null;
    this.slowTick = 0;

    this.combat.onEvent = (type, data) => {
      if (type === 'shake') this.camera.shake(data.mag, data.frames);
      else if (type === 'phase') {
        this.camera.shake(5, 20);
      } else if (type === 'ko') {
        this.camera.zoomTo(1.18);
        this.camera.shake(4, 20);
      }
    };

    /* 双人从舞台中央对称开场 */
    this._positions();
  }

  /* ---- 回合控制 ---------------------------------------------------------- */

  _positions() {
    const mid = ARENA_W / 2;
    this.a.resetRound(mid - 96, 1);
    this.b.resetRound(mid + 96, -1);
    if (this.monster.flags && this.monster.flags.hover) {
      this.b.grounded = true;
      this.b.y = this.monster.flags.hover;
      this.b.vy = 0;
    }
    this.combat.reset();
    resetFx();
    this.camera.targetZoom = 1;
    this.camera.zoom = 1;
    this.camera.x = Math.max(0, mid - 240);
  }

  _nextRound() {
    this.round++;
    this.timer = 99 * 60;
    this.phase = 'intro';
    this.phaseT = 0;
    this.reason = '';
    this.roundWinner = null;
    /* 每回合开始保留 50% 能量 */
    this.a.meter = Math.min(100, this.a.meter * 0.5);
    this.b.meter = Math.min(100, this.b.meter * 0.5);
    this._positions();
  }

  /** 血量相同的时间到：重开本回合，不改变比分与回合数 */
  _replayRound() {
    this.timer = 99 * 60;
    this.phase = 'intro';
    this.phaseT = 0;
    this.reason = '';
    this.roundWinner = null;
    this._positions();
  }

  _endRound(winner, reason) {
    this.phase = 'roundEnd';
    this.phaseT = 0;
    this.reason = reason;
    this.roundWinner = winner;
    this.camera.zoomTo(1.18);

    if (winner) {
      winner.state = 'win';
      winner.winPose = true;
      this.wins[winner === this.a ? 0 : 1]++;
    }

    if (reason === 'ko') {
      Audio.play('ko');
      this.camera.shake(5, 24);
    } else {
      Audio.play('win');
    }
  }

  update() {
    this.tick++;

    if (this.phase === 'intro') {
      this.phaseT++;
      if (this.phaseT === 2) Audio.play('round');
      if (this.phaseT === 46) Audio.play('fight');
      this.a.update(this.b);
      this.b.update(this.a);
      this.camera.update(this.a, this.b, false);
      if (this.phaseT >= 74) {
        this.phase = 'fight';
        this.phaseT = 0;
      }
      return;
    }

    if (this.phase === 'fight') {
      this.ai.update();
      this.a.update(this.b);
      this.b.update(this.a);
      this.combat.update(this.a, this.b);
      /* 训练模式：能量常满，方便反复练习必杀/超必杀 */
      if (this.training) this.a.meter = 100;
      if (!this.training) this._checkEnd();
      this.camera.update(this.a, this.b, false);
      if (this.phase === 'fight' && !this.training) {
        this.timer--;
        if (this.timer <= 0) {
          this.timer = 0;
          this._timeUp();
        }
      }
      if (this.training && (this.a.hp <= 0 || this.b.hp <= 0)) {
        this.a.hp = Math.max(1, this.a.hp);
        this.b.hp = Math.max(1, this.b.hp);
      }
      return;
    }

    if (this.phase === 'roundEnd') {
      this.phaseT++;
      /* 前 1 秒 0.25 倍速：每 4 个逻辑帧才推进一次世界 */
      const slow = this.phaseT < 60 ? 4 : 1;
      if (this.phaseT % slow === 0) {
        this.a.update(this.b);
        this.b.update(this.a);
        this.combat.update(this.a, this.b);
      }
      this.camera.update(this.a, this.b, true);
      if (this.phaseT > 210) {
        if (this.wins[0] >= 2 || this.wins[1] >= 2) {
          this.phase = 'matchEnd';
          this.phaseT = 0;
          this.matchWinner = this.wins[0] >= 2 ? this.a : this.b;
          Audio.play('win');
        } else if (this.reason === 'time' && this.roundWinner === null) {
          /* 时间到且血量相同：平局重开本回合 */
          this._replayRound();
        } else {
          this._nextRound();
        }
      }
      return;
    }

    /* matchEnd：保持胜者姿态 */
    if (this.phase === 'matchEnd') {
      this.phaseT++;
      this.a.update(this.b);
      this.b.update(this.a);
      this.camera.update(this.a, this.b, true);
    }
  }

  _checkEnd() {
    if (this.phase !== 'fight') return;
    const aDead = this.a.hp <= 0;
    const bDead = this.b.hp <= 0;
    if (!aDead && !bDead) return;

    if (aDead && bDead) {
      this._endRound(null, 'draw');
    } else {
      this._endRound(aDead ? this.b : this.a, 'ko');
    }
  }

  _timeUp() {
    if (this.phase !== 'fight') return;
    const ra = this.a.hp / this.a.maxHp;
    const rb = this.b.hp / this.b.maxHp;
    if (Math.abs(ra - rb) < 0.001) this._endRound(null, 'time');
    else this._endRound(ra > rb ? this.a : this.b, 'time');
  }

  /** 当前回合是否已经分出胜负（供 HUD 显示横幅） */
  get banner() {
    if (this.phase === 'intro') return this.phaseT < 46 ? '第 ' + this.round + ' 回合' : '开始！';
    if (this.phase === 'roundEnd') {
      if (this.reason === 'draw') return '平局';
      if (this.reason === 'time') return '时间到';
      return 'K.O.';
    }
    if (this.phase === 'matchEnd') {
      return this.matchWinner === this.a ? '胜利' : '败北';
    }
    return '';
  }

  /* ---- 绘制 -------------------------------------------------------------- */

  draw(ctx, time) {
    const cam = this.camera;

    ctx.save();
    /* KO 推镜：以画面中心缩放 */
    if (cam.zoom !== 1) {
      ctx.translate(240, 135);
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(-240, -135);
    }

    drawStage(ctx, this.stage, cam.x, time);

    ctx.save();
    ctx.translate(-Math.round(cam.x + cam.sx), Math.round(cam.sy));

    /* 地面投影 */
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    for (const u of [this.a, this.b]) {
      const w = u.def.kind ? 46 : 30;
      const shrink = Math.max(0.3, 1 - u.y / 120);
      ctx.fillRect(Math.round(u.x - w * shrink / 2), GROUND_Y - 3, Math.round(w * shrink), 4);
    }

    drawGhosts(ctx);
    this._drawFighter(ctx, this.a);
    this._drawFighter(ctx, this.b);
    this.combat.draw(ctx, time);
    drawFx(ctx);

    ctx.restore();
    ctx.restore();
  }

  /** 调试：F1 显示判定框（红 = 攻击，蓝 = 受击） */
  drawDebug(ctx) {
    const cam = this.camera;
    ctx.save();
    if (cam.zoom !== 1) {
      ctx.translate(240, 135);
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(-240, -135);
    }
    ctx.save();
    ctx.translate(-Math.round(cam.x + cam.sx), Math.round(cam.sy));
    ctx.lineWidth = 1;
    for (const u of [this.a, this.b]) {
      ctx.strokeStyle = '#4fa3ff';
      for (const b of u.hurtboxes()) ctx.strokeRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1);
      ctx.strokeStyle = '#ff4040';
      for (const b of u.attackBoxes()) ctx.strokeRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1);
    }
    ctx.restore();
    ctx.restore();
  }

  _drawFighter(ctx, u) {
    /* 受击白闪时附加 2px 抖动 */
    let x = u.x;
    let y = u.y;
    if (u.flash > 0) {
      x += (Math.random() * 4 - 2);
      y += (Math.random() * 2 - 1);
    }
    drawSprite(ctx, u.def, u.animAction(), u.animProgress(), x, y, GROUND_Y, {
      facing: u.facing,
      bucket: spriteBucket(u),
      flash: u.flash > 0
    });
  }
}
