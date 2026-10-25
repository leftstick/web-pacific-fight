/* =============================================================================
 * player.js  ──  玩家操控的重型机甲（环太平洋风格 1v1 格斗）
 * 依赖：config.js（GAME.CONFIG / GAME.U）、combat.js（GAME.Combat 的动作契约）
 *       renderer.js（GAME.Renderer.THREE / spawnImpact / zoomPunch / cameraShake）
 *       physics.js（GAME.Physics.knockback）、models.js（程序化 clip 与部件层级）
 * 加载方式：普通 <script>，挂载 window.GAME.Player
 *
 * 【单位契约 Unit Contract】完整实现 combat.js 头部约定的全部字段与方法，
 *   使 Combat 只依赖接口，不关心玩家 / 敌人的具体实现。
 * 说明：
 *   · 所有数值、时间轴、耐力 / 能量 / 眩晕 / 击退参数均读取 GAME.CONFIG；
 *   · THREE 仅在构造 / 运行期通过 GAME.Renderer.THREE 取用，顶层绝不引用；
 *   · 当 opts.model.clips 为空数组时，动画部分自动降级为 no-op，逻辑仍完整可用。
 * ========================================================================== */
(function (global) {
  'use strict';

  var GAME = global.GAME;
  var U = GAME.U;
  var CONFIG = GAME.CONFIG;
  var C = CONFIG.combat;

  /* ------------------------- 配置快捷引用 ------------------------- */
  var ARENA = CONFIG.arena;
  var STAM = C.stamina;
  var ENERGY = C.energy;
  var STUN = C.stun;
  var BLOCK = C.block;
  var DODGE = C.dodge;
  var HITR = C.hitReactions;
  var TIMING = C.timing;
  var MOVES = C.moves;

  /* ------------------------- 实现细节常量（config 未定义者） ------------------------- */
  var BASE_SPEED = 9;              // 基础移速（世界单位/秒），实际 = BASE_SPEED * def.speed
  var SIDESTEP = 0.5;              // W/S 纵深侧步速度为横向的一半
  var ACCEL_LAMBDA = 6.5;          // 加速斜坡响应（降低→更重的惯性感）
  var YAW_LAMBDA = 5.5;            // 朝向平滑响应（降低→巨型机体转向迟缓）
  var MASS_REF = 1000;             // 击退质量归一化基准（与 physics.js 保持一致）
  var MODEL_YAW_OFFSET = Math.PI / 2;  // 程序化模型正面为 +Z，偏移后使 yaw=0 时正面指向 +X
  var HIT_BACK_AMOUNT = 0.8;       // 受击“后仰”时根节点的视觉回撤量（世界单位）

  var MFADE = 0.16;                // 默认交叉淡入淡出时长（秒）

  /* ===========================================================================
   * 构造函数
   * ======================================================================== */
  function Player(opts) {
    opts = opts || {};
    var def = opts.def || {};
    this.def = def;
    this.id = def.id || ('player_' + Math.floor(Math.random() * 1e6));
    this.faction = def.faction || 'mecha';
    this.style = def.style || 'balanced';
    this.name = def.name || '';
    this.nameEn = def.nameEn || '';

    /* --- 运行期依赖（不引用顶层 THREE） --- */
    this.renderer = opts.renderer || GAME.Renderer || null;
    this.physics = opts.physics || GAME.Physics || null;
    this.combat = opts.combat || GAME.Combat || null;
    this.THREE = (this.renderer && this.renderer.THREE) || (GAME.Renderer && GAME.Renderer.THREE) || null;

    /* --- 模型 --- */
    this.model = opts.model || null;
    this.root = (opts.model && opts.model.root) || null;
    this.clips = (opts.model && opts.model.clips) || [];
    this.isPlaceholder = !!(opts.model && opts.model.isPlaceholder);
    this.parts = (opts.model && opts.model.parts) || null;
    this._hitCenterY = (opts.model && opts.model.hitCenterY) ||
      ((def.height || 9.5) * (def.scale || 1) * 0.55);

    /* --- 位置与朝向 --- */
    var spawn = opts.position || ARENA.spawn.player;
    this._spawn = { x: spawn.x || 0, y: spawn.y || 0, z: spawn.z || 0 };
    if (this.THREE) {
      this.position = new this.THREE.Vector3(this._spawn.x, this._spawn.y, this._spawn.z);
    } else {
      this.position = makeFallbackVec(this._spawn.x, this._spawn.y, this._spawn.z);
    }
    this._initFacing = (opts.facing === -1) ? -1 : 1;
    this.facing = this._initFacing;
    this.yaw = this.facing > 0 ? 0 : Math.PI;

    /* --- 三大属性 + 装甲 --- */
    this.maxHp = def.hp || 1000;
    this.hp = this.maxHp;
    this.maxArmor = Math.round(this.maxHp * (def.armorRatio || 0));
    this.armor = this.maxArmor;
    this.maxStamina = def.stamina || STAM.max;
    this.stamina = this.maxStamina;
    this.maxEnergy = ENERGY.max;
    this.energy = CONFIG.debug.infiniteEnergy ? this.maxEnergy : 0;
    this.maxStun = STUN.max;
    this.stun = 0;
    this.stunTimer = 0;
    this.stunDecayDelay = 0;

    /* --- 状态标志（契约字段） --- */
    this.state = 'idle';
    this.blocking = false;
    this.invuln = false;
    this.stunned = false;
    this.dead = false;
    this.frozen = 0;                                   // 受击停顿剩余秒数（Combat 会写入并递减）
    this.knockbackVel = { x: 0, y: 0, z: 0 };          // 击退速度（单位自行积分）

    /* --- 连击 --- */
    this.comboHits = 0;
    this.comboTimer = 0;
    this.comboDamageBonus = 1;

    /* --- 动作与速度缩放 --- */
    this.moveInst = null;
    this.speedScale = 1;

    /* --- 内部状态 --- */
    this._vx = 0; this._vz = 0;                        // 自身移动速度
    this._speed = 0; this._bob = 0; this._stepT = 0;   // 步态
    this._chainIndex = 0; this._chainKey = null; this._chainWindow = 0;
    this._doingDodge = false; this._dodgeT = 0; this._dodgeFxT = 0; this._dodgeVX = 0; this._dodgeVZ = 0;
    this._buffer = { key: null, t: 0 };                             // 输入缓冲
    this._advanceT = 0; this._advanceVX = 0; this._advanceVZ = 0;   // 起手前冲 / 突进
    this._firing = false; this._fireCount = 0;                      // 机炮连射
    this._ultIndex = 0; this._ultTimes = [];                        // 必杀多段
    this._hitT = 0; this._flinchT = 0; this._hitBack = 0; this._staminaDelay = 0;
    this._exhausted = false;
    this._lastStateKey = '';

    /* --- 动画 --- */
    this.mixer = null;
    this._actions = {};
    this._clipByName = {};
    this._currentAction = null;
    this.currentClip = null;
    this._initAnimation();

    /* --- 初始同步 --- */
    this._syncVisual(0);
    this._emitState();
    if (!this.clips) this.clips = [];
  }

  /* ===========================================================================
   * 动画系统（THREE.AnimationMixer，缺片段静默降级）
   * ======================================================================== */
  Player.prototype._initAnimation = function () {
    if (!this.THREE || !this.root) return;
    var i, clip;
    for (i = 0; i < this.clips.length; i++) {
      clip = this.clips[i];
      if (clip && clip.name) this._clipByName[clip.name] = clip;
    }
    try {
      this.mixer = new this.THREE.AnimationMixer(this.root);
    } catch (e) {
      this.mixer = null;
    }
  };

  /* 播放（或交叉淡入）一个动画片段
   *   anim(name, opts)：opts = { fade, timeScale, force }
   *   · 片段缺失返回 null，不打印任何日志；循环 / 一次性由 clip.userData.loop 决定 */
  Player.prototype.anim = function (name, opts) {
    if (!this.mixer || !name) return null;
    var clip = this._clipByName[name];
    if (!clip) return null;

    opts = opts || {};
    var action = this._actions[name];
    if (!action) {
      try { action = this.mixer.clipAction(clip); }
      catch (e) { return null; }
      this._actions[name] = action;
    }

    var repeat = !(clip.userData && clip.userData.loop === 'once');
    var fade = (opts.fade !== undefined) ? opts.fade : MFADE;
    var speed = (opts.timeScale !== undefined) ? opts.timeScale : 1;

    if (action === this._currentAction && !opts.force) {
      action.setEffectiveTimeScale(speed);            // 已在播放：仅同步速度
      return action;
    }

    var prev = this._currentAction;
    action.reset();
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.setEffectiveTimeScale(speed);
    if (repeat) {
      action.setLoop(this.THREE.LoopRepeat, Infinity);
      action.clampWhenFinished = false;
    } else {
      action.setLoop(this.THREE.LoopOnce, 1);
      action.clampWhenFinished = true;                // 一次性动作在结尾定格
    }
    if (prev && prev !== action) {
      prev.fadeOut(fade);
      action.fadeIn(fade).play();
    } else {
      action.play();
      action.fadeIn(fade);
    }
    this._currentAction = action;
    this.currentClip = name;
    return action;
  };

  /* ===========================================================================
   * 主更新（ctx.dt 已包含顿帧时间缩放）
   * ======================================================================== */
  Player.prototype.update = function (dt, ctx) {
    ctx = ctx || {};
    dt = (typeof dt === 'number' && dt > 0) ? dt : 0;
    var input = ctx.input || GAME.Input || null;
    var combat = ctx.combat || this.combat || GAME.Combat || null;
    var renderer = ctx.renderer || this.renderer || GAME.Renderer || null;
    var opponent = ctx.opponent ||
      (combat && combat.opponentOf ? combat.opponentOf(this) : null);

    if (this.dead) {
      this._syncVisual(dt);
      this._emitState();
      return;
    }

    this._tickTimers(dt);
    this._handleBlock(dt, input);
    this._regen(dt);
    this._readActions(dt, input);
    this._updateMove(dt, combat, opponent, renderer);
    this._movement(dt, input, opponent);
    this._integrateKnockback(dt);
    if (opponent && opponent.position) this._separation(opponent);
    this._clampArena();
    this._pickLocomotion(dt);
    this._syncVisual(dt);
    this._emitState();
  };

  /* 各类计时器递减 */
  Player.prototype._tickTimers = function (dt) {
    /* 眩晕（Combat 只负责读条 / 累加，计时由单位自行推进） */
    if (this.stunned && this.stunTimer > 0) {
      this.stunTimer -= dt;
      if (this.stunTimer <= 0) {
        this.stunTimer = 0;
        this.stunned = false;
        if (this.state === 'stun') this.state = 'idle';
      }
    }
    /* 受击恢复（一次性 hit 片段 / 受击状态回退） */
    if (this._hitT > 0) {
      this._hitT -= dt;
      if (this._hitT <= 0 && this.state === 'hit' && !this.stunned) this.state = 'idle';
    }
    if (this._flinchT > 0) this._flinchT -= dt;
    if (this._staminaDelay > 0) this._staminaDelay -= dt;
    /* 轻攻击连段窗口 */
    if (this._chainWindow > 0) {
      this._chainWindow -= dt;
      if (this._chainWindow <= 0) { this._chainIndex = 0; this._chainKey = null; }
    }
    /* 受击后仰视觉回撤的衰减 */
    if (this._hitBack > 0) this._hitBack = U.damp(this._hitBack, 0, 7, dt);
  };

  /* 格挡：持续状态 + 逐秒耗耐力 + 耐力耗尽破防 */
  Player.prototype._handleBlock = function (dt, input) {
    if (this.dead) { this.blocking = false; return; }
    var want = (input && input.isDown) ? input.isDown('block') : false;
    this.setBlocking(want);
    if (this.blocking) {
      this._staminaDelay = STAM.regenDelay;            // 格挡期间不回复耐力
      this.stamina -= STAM.blockDrainRate * dt;
      if (this.stamina <= 0) {
        this.stamina = 0;
        this.setBlocking(false);
        this.setStunned(BLOCK.breakStunDuration);      // 耐力耗尽 → 破防硬直
        U.bus.emit('unit:guard-break', { unit: this });
      }
    }
  };

  /* 耐力 / 能量恢复 + 力竭惩罚 */
  Player.prototype._regen = function (dt) {
    /* 耐力 */
    if (this._staminaDelay > 0) {
      this._staminaDelay -= dt;
    } else if (this.stamina < this.maxStamina) {
      this.stamina = Math.min(this.maxStamina, this.stamina + STAM.regen * dt);
    }
    /* 能量（自然恢复 * def.energyRegen 倍率） */
    if (CONFIG.debug.infiniteEnergy) {
      this.energy = this.maxEnergy;
    } else if (this.energy < this.maxEnergy) {
      this.energy = Math.min(this.maxEnergy, this.energy + ENERGY.regen * (this.def.energyRegen || 1) * dt);
    }
    /* 力竭：耐力低于闪避消耗 → 动作减速，只提示一次 */
    if (this.stamina < STAM.dodgeCost) {
      if (this.speedScale !== STAM.exhaustedPenalty) {
        this.speedScale = STAM.exhaustedPenalty;
        this._exhausted = true;
        U.bus.emit('unit:exhausted', { unit: this });
      }
    } else if (this.speedScale !== 1) {
      this.speedScale = 1;
      this._exhausted = false;
    }
  };

  /* 输入 → 动作（含输入缓冲：条件不满足的按键在窗口内保留，见 feel.buffer） */
  Player.prototype._readActions = function (dt, input) {
    if (!input || typeof input.justPressed !== 'function') return;
    if (this.dead || this.stunned || this._doingDodge) return;
    if (!this._buffer) this._buffer = { key: null, t: 0 };

    var combat = this.combat || GAME.Combat || null;
    var feel = (combat && combat.feel) ? combat.feel() : {};
    var bufCfg = feel.buffer || {};
    var bufferOn = bufCfg.enabled !== false;
    var priority = bufCfg.priority || ['dodge', 'ultimate', 'skill', 'heavy', 'light'];
    var windowOf = (combat && combat.bufferSeconds) ? combat.bufferSeconds : function () { return 0; };

    /* 1. 本帧新按键：按优先级只取一个，记为最新意图 */
    var pressed = null;
    for (var i = 0; i < priority.length; i++) {
      if (input.justPressed(priority[i])) { pressed = priority[i]; break; }
    }
    if (pressed) {
      if (this._hitT > 0 && pressed !== 'dodge') pressed = null;   /* 受击硬直仅允许闪避 */
      if (pressed) {
        /* 动作占用中才进缓冲；资源不足直接交给 attack 处理（避免反复重试） */
        if (bufferOn && !this._canStartMove(pressed)) {
          this._buffer.key = pressed;
          this._buffer.t = windowOf(pressed);
        } else {
          this._buffer.key = pressed;
          this._buffer.t = 0;
        }
      }
    }

    /* 2. 顿帧期间只记录意图，不推进计时 */
    if (this.frozen > 0) return;

    var key = this._buffer.key;
    if (!key) return;
    if (this._hitT > 0 && key !== 'dodge') return;                /* 硬直中保留非闪避意图 */

    /* 3. 尝试执行；仍不可行则在窗口内每帧重试，过期丢弃 */
    if (this.attack(key)) {
      this._buffer.key = null; this._buffer.t = 0;
      return;
    }
    if (this._buffer.t > 0) this._buffer.t -= dt;
    if (this._buffer.t <= 0) { this._buffer.key = null; this._buffer.t = 0; }
  };

  /* ===========================================================================
   * 动作发起：attack(key)
   * ======================================================================== */
  Player.prototype.attack = function (key) {
    if (this.dead || this.stunned || this.frozen > 0) return false;
    if (typeof key !== 'string') return false;

    /* --- 打断规则 --- */
    if (!this._canStartMove(key)) return false;

    /* --- 资源校验 --- */
    if (key === 'skill') {
      var eCost = MOVES.skill ? (MOVES.skill.energyCost || 0) : 0;
      if (!this._hasEnergy(eCost)) { this._emitNoResource('energy', key); return false; }
    } else if (key === 'heavy') {
      var sCost = MOVES.heavy ? (MOVES.heavy.staminaCost || 0) : 0;
      if (sCost > 0 && this.stamina < sCost) { this._emitNoResource('stamina', key); return false; }
    } else if (key === 'dodge') {
      if (this.stamina < STAM.dodgeCost) { this._emitNoResource('stamina', key); return false; }
    } else if (key === 'ultimate') {
      if (!this._ultimateReady()) { this._emitNoResource('energy', key); return false; }
    }

    /* --- 闪避为自定义状态机（moves 表无 dodge），不经过 combat.createMove --- */
    if (key === 'dodge') { this._startDodge(); return true; }

    var move = MOVES[key];
    if (!move) return false;
    var combat = this.combat || GAME.Combat;
    if (!combat || !combat.createMove) return false;

    var mi = combat.createMove(this, key);
    if (!mi) return false;
    mi.hitCount = 0;
    mi.maxCombo = move.comboMax || 1;
    mi.speedScale = this.speedScale;

    /* --- 轻攻击连段计数 + 小步前冲 --- */
    if (key === 'light') {
      var maxCombo = move.comboMax || 1;
      if (this._chainKey === 'light' && this._chainIndex > 0 && this._chainIndex < maxCombo) {
        this._chainIndex++;
      } else {
        this._chainIndex = 1;
      }
      this._chainKey = 'light';
      this._chainWindow = TIMING.comboWindow;
      mi.currIndex = this._chainIndex - 1;
    } else {
      this._chainIndex = 0;
      this._chainKey = null;
    }

    this.setBlocking(false);
    this._advanceT = 0; this._advanceVX = 0; this._advanceVZ = 0;
    this._firing = false; this._fireCount = 0;
    this.moveInst = mi;

    /* --- 按键专属：资源扣除 / 状态 / 演出 --- */
    switch (key) {
      case 'light':
        this.state = 'attack';
        this.anim('light', { fade: 0.12 });
        if (this.def.weapon && this.def.weapon.type === 'blade' && global.GAME.Audio) GAME.Audio.play('plasma', { gain: 0.25 });
        break;
      case 'heavy':
        this.spendStamina(move.staminaCost || 0);
        this.state = 'attack';
        this.anim('heavy', { fade: 0.2 });                  // 重攻击起手更长、淡入更慢
        if (this.def.weapon && this.def.weapon.type === 'blade' && global.GAME.Audio) GAME.Audio.play('plasma', { gain: 0.35, duration: 0.28 });
        break;
      case 'skill':
        this.spendEnergy(move.energyCost || 0);
        this.state = 'attack';
        this.anim('skill', { fade: 0.14 });
        if (this.def.weapon && this.def.weapon.type === 'blade') {
          /* 刀刃：突进斩（起手 → 判定阶段向对手贴身突进） */
        } else {
          /* 机炮：判定阶段连射，产生炮口火光 + 自身后坐 */
          this._firing = true;
        }
        break;
      case 'ultimate':
        this._consumeAllEnergy();
        this.state = 'ultimate';
        this._ultIndex = 0; this._ultTimes = [];
        this.anim('ultimate', { fade: 0.18, force: true });
        if (this.renderer && this.renderer.zoomPunch) this.renderer.zoomPunch();
        U.bus.emit('unit:ultimate', {
          unit: this,
          name: (this.def.ultimate && this.def.ultimate.name) || '',
          desc: (this.def.ultimate && this.def.ultimate.desc) || ''
        });
        break;
    }
    return true;
  };

  /* 判断当前是否可发起新动作（重攻击 / 必杀不自取消；轻攻击按连段规则衔接） */
  Player.prototype._canStartMove = function (key) {
    var mi = this.moveInst;
    if (!mi || mi.phase === 'done') return true;
    var cur = mi.key;
    if (cur === 'ultimate') return false;                        // 必杀期间不可自取消
    if (cur === 'heavy') return mi.phase === 'recovery';         // 重攻击仅收招阶段可取消
    if (cur === 'skill') return mi.phase === 'recovery';         // 武器技能同理
    if (cur === 'light') {
      if (mi.phase === 'recovery') return true;
      /* 已命中且未到连段上限 → 可在判定后半段接下一段 */
      return (mi.hitCount > 0 && (mi.currIndex + 1) < (mi.maxCombo || 1));
    }
    return mi.phase === 'recovery';
  };

  /* 闪避：位移 + 无敌帧（invulnStart ~ invulnEnd 之间精确无敌） */
  Player.prototype._startDodge = function () {
    var input = GAME.Input;
    var ax = (input && input.getAxis) ? input.getAxis() : { x: 0, y: 0 };
    var dist = DODGE.distance;
    var dirX, dirZ = 0;
    if (Math.abs(ax.x) > 0.3) {
      dirX = U.sign(ax.x);                      // 侧向闪避（更远）
      dist *= (DODGE.direction && DODGE.direction.side !== undefined) ? DODGE.direction.side : 1;
    } else {
      dirX = -this.facing;                      // 默认后闪（稍短）
      dist *= (DODGE.direction && DODGE.direction.back !== undefined) ? DODGE.direction.back : 0.75;
    }
    if (Math.abs(ax.y) > 0.3 && Math.abs(ax.x) <= 0.3) dirZ = ax.y * 0.4;   // 少量纵深变化

    this.spendStamina(STAM.dodgeCost);
    this.setBlocking(false);
    this._advanceT = 0;
    this._doingDodge = true;
    this._dodgeT = 0;
    this._dodgeFxT = 0;
    this._dodgeVX = dirX * dist / DODGE.duration;
    this._dodgeVZ = dirZ * dist / DODGE.duration;
    this.invuln = false;
    this.state = 'dodge';
    this.anim('dodge', { fade: 0.1 });
  };

  /* ===========================================================================
   * 动作推进 + 攻击结算 + 特殊招式
   * ======================================================================== */
  Player.prototype._updateMove = function (dt, combat, opponent, renderer) {
    var mi = this.moveInst;
    if (!mi) return;

    var evt = (combat && combat.updateMove) ? combat.updateMove(this, dt) : null;

    if (evt === 'active-enter') this._onActiveEnter(mi, opponent, renderer);

    var move = mi.move;

    /* 机炮连射：判定窗口内按节奏点射 */
    if (mi.key === 'skill' && this._firing && mi.phase === 'active' && move) {
      var frac = move.active > 0 ? (mi.t / move.active) : 1;
      while (this._fireCount < 3 && frac >= (this._fireCount + 0.25) / 3) {
        this._spawnMuzzle(renderer);
        this._fireCount++;
      }
    }

    /* 必杀技：活动窗口内分 2~3 段施加伤害（每段重置命中列表） */
    if (mi.key === 'ultimate' && mi.phase === 'active' && move) {
      var f = move.active > 0 ? (mi.t / move.active) : 1;
      while (this._ultIndex < this._ultTimes.length && f >= this._ultTimes[this._ultIndex]) {
        mi.hitTargets.length = 0;                       // 允许对同一目标再次结算
        if (combat && combat.resolveAttack && opponent) {
          combat.resolveAttack(this, [opponent], null);
        }
        this._ultIndex++;
      }
    }

    /* 普通攻击判定帧结算（必杀走上面的多段逻辑） */
    if (mi.key !== 'ultimate' && mi.phase === 'active' && combat && combat.resolveAttack) {
      var targets = opponent ? [opponent] : (combat.units || []);
      var self = this;
      combat.resolveAttack(this, targets, function () {
        if (self.moveInst) self.moveInst.hitCount++;
      });
    }

    if (evt === 'done') this._endMove();
  };

  /* 判定阶段进入时的招式专属处理 */
  Player.prototype._onActiveEnter = function (mi, opponent, renderer) {
    var move = mi.move;
    var key = mi.key;

    /* P2：攻击拖尾（纯渲染层，追踪右臂；不触碰 position / 物理） */
    if (renderer && renderer.startTrail) {
      renderer.startTrail(this, trailColorFor(key, 'mecha'));
    }

    if (key === 'light') {
      this._advanceToward(opponent, 1.3, 0.14);          // 轻攻击小步前压
    } else if (key === 'heavy') {
      this._advanceToward(opponent, 2.2, 0.18);          // 重攻击前压更多
    } else if (key === 'skill') {
      if (this.def.weapon && this.def.weapon.type === 'blade') {
        var d = this._distTo(opponent);
        var travel = Math.max(0, d - (move.range * 0.5));    // 突进到有效打击距离
        this._advanceToward(opponent, travel, Math.max(0.12, move.active * 0.5));
      } else {
        this._fireCount = 0;
      }
    } else if (key === 'ultimate') {
      this._ultIndex = 0;
      this._ultTimes = [0.15, 0.5, 0.82];                // 活动窗口内的三段打击时间点
    }
  };

  /* 朝对手做一次受控位移（用速度积分，避免瞬移穿模） */
  Player.prototype._advanceToward = function (opp, dist, dur) {
    if (!opp || !opp.position || dist <= 0 || dur <= 0) return;
    var dx = opp.position.x - this.position.x;
    var dz = opp.position.z - this.position.z;
    var d = Math.sqrt(dx * dx + dz * dz) || 1;
    this._advanceVX = (dx / d) * (dist / dur);
    this._advanceVZ = (dz / d) * (dist / dur);
    this._advanceT = dur;
  };

  /* 机炮炮口火光 + 自身后坐 */
  Player.prototype._spawnMuzzle = function (renderer) {
    var fwdX = Math.cos(this.yaw), fwdZ = Math.sin(this.yaw);
    var c = this.getHitCenter();
    var px = c.x + fwdX * 3.0, py = c.y + 1.2, pz = c.z + fwdZ * 3.0;
    if (renderer && renderer.spawnImpact) renderer.spawnImpact({ x: px, y: py, z: pz }, 2, 'front');
    this.knockbackVel.x -= fwdX * 3.0;                   // 后坐：向身后方向推
    this.knockbackVel.z -= fwdZ * 3.0;
  };

  /* 动作结束：清空动作实例并回到可行动状态 */
  Player.prototype._endMove = function () {
    /* P2：结束攻击拖尾 */
    if (this.renderer && this.renderer.endTrail) this.renderer.endTrail(this);
    this.moveInst = null;
    this._advanceT = 0; this._advanceVX = 0; this._advanceVZ = 0;
    this._firing = false;
    this._ultIndex = 0; this._ultTimes = [];
    if (this.state === 'attack' || this.state === 'ultimate') this.state = 'idle';
  };

  /* ===========================================================================
   * 移动 / 朝向 / 步态
   * ======================================================================== */
  Player.prototype._movement = function (dt, input, opponent) {
    /* 朝向始终平滑转向对手 */
    if (opponent && opponent.position) {
      var tox = opponent.position.x - this.position.x;
      var toz = opponent.position.z - this.position.z;
      var targetYaw = Math.atan2(toz, tox);
      this.yaw = this.yaw + U.angleDelta(this.yaw, targetYaw) * (1 - Math.exp(-YAW_LAMBDA * dt));
      this.facing = Math.cos(this.yaw) >= 0 ? 1 : -1;
    }

    var maxSpeed = this._maxSpeed();
    var tvx = 0, tvz = 0;
    /* 前摇（startup）期间允许小幅移动（feel.startupMoveScale，默认 0.5 倍速） */
    var startupScale = 0;
    if (this.moveInst && this.moveInst.phase === 'startup') {
      var feel = (GAME.Combat && GAME.Combat.feel) ? GAME.Combat.feel() : {};
      var s = feel.startupMoveScale;
      startupScale = (typeof s === 'number' && s > 0) ? s : 0;
    }
    var canMove = !this.dead && !this.stunned && this.frozen <= 0 &&
      !this.blocking && !this._doingDodge && (!this.moveInst || startupScale > 0);
    if (canMove && input && input.getAxis) {
      var ax = input.getAxis();
      var ms = maxSpeed * (startupScale > 0 ? startupScale : 1);
      tvx = ax.x * ms;                                   // A/D → x
      tvz = ax.y * ms * SIDESTEP;                        // W/S → 慢速纵深侧步
    }

    /* 加速斜坡 */
    this._vx = U.damp(this._vx, tvx, ACCEL_LAMBDA, dt);
    this._vz = U.damp(this._vz, tvz, ACCEL_LAMBDA, dt);

    /* 无输入时叠加地面摩擦，快速停下 */
    if (Math.abs(tvx) < 0.01 && Math.abs(tvz) < 0.01) {
      var f = Math.pow(ARENA.groundFriction, dt * 60);
      this._vx *= f; this._vz *= f;
    }

    this.position.x += this._vx * dt;
    this.position.z += this._vz * dt;

    /* 起手前冲 / 突进位移 */
    if (this._advanceT > 0) {
      this.position.x += this._advanceVX * dt;
      this.position.z += this._advanceVZ * dt;
      this._advanceT -= dt;
      if (this._advanceT <= 0) { this._advanceVX = 0; this._advanceVZ = 0; }
    }

    /* 闪避位移 + 无敌帧（invulnStart ~ invulnEnd 之间精确无敌） */
    if (this._doingDodge) {
      this.position.x += this._dodgeVX * dt;
      this.position.z += this._dodgeVZ * dt;
      this.invuln = (this._dodgeT >= DODGE.invulnStart && this._dodgeT <= DODGE.invulnEnd);
      this._dodgeT += dt;
      /* 闪避残影：行进间每 60ms 留下一道速度环 + 尘雾 */
      var feelD = (GAME.Combat && GAME.Combat.feel) ? GAME.Combat.feel() : {};
      var trailOn = !(feelD.dodgeTrail && feelD.dodgeTrail.enabled === false);
      var rd = GAME.Renderer;
      if (trailOn && rd && rd.spawnDodgeStreak) {
        this._dodgeFxT = (this._dodgeFxT || 0) + dt;
        if (this._dodgeFxT >= 0.06) {
          this._dodgeFxT = 0;
          rd.spawnDodgeStreak(this.getHitCenter ? this.getHitCenter() : this.position);
        }
      }
      if (this._dodgeT >= DODGE.duration) {
        this._doingDodge = false;
        this.invuln = false;
        this._dodgeFxT = 0;
        if (this.state === 'dodge') this.state = 'idle';
      }
    }

    /* 步态：速度大小 → 步频 / 抖动强度 */
    this._speed = Math.sqrt(this._vx * this._vx + this._vz * this._vz);
    var prevStep = Math.floor(this._stepT);
    this._stepT += dt * (this._speed * 0.55 + 0.02);
    this._bob = canMove ? Math.min(1, this._speed / (maxSpeed || 1)) : 0;

    /* 脚步落地溅水（雨夜地面积水） */
    if (this._speed > 1.0 && Math.floor(this._stepT) > prevStep) {
      var rd2 = GAME.Renderer;
      if (rd2 && rd2.spawnSplash) {
        rd2.spawnSplash({ x: this.position.x, y: this.position.y + 0.1, z: this.position.z });
      }
    }

    /* 机甲关节蒸汽排气：移动/攻击时更频繁，静止时低频 */
    this._steamT = (this._steamT || 0) - dt;
    var steamInterval = this._speed > 0.5 ? 0.22 : (this.moveInst ? 0.18 : 0.5);
    if (this._steamT <= 0) {
      this._steamT = steamInterval;
      var rd = GAME.Renderer;
      if (rd && rd.spawnSteam) {
        var H = this.def.height || 9;
        var sx = this.position.x, sy = this.position.y, sz = this.position.z;
        var sgn = this.facing || 1;
        rd.spawnSteam({ x: sx - sgn * 0.9, y: sy + H * 0.62, z: sz });   // 左肩
        rd.spawnSteam({ x: sx + sgn * 0.9, y: sy + H * 0.62, z: sz });   // 右肩
        if (this._speed > 0.5 || this.moveInst) {
          rd.spawnSteam({ x: sx - sgn * 0.5, y: sy + H * 0.22, z: sz }); // 左膝
          rd.spawnSteam({ x: sx + sgn * 0.5, y: sy + H * 0.22, z: sz }); // 右膝
        }
      }
    }
  };

  /* 最大移速 = 基础移速 * def.speed * speedScale（力竭惩罚） */
  Player.prototype._maxSpeed = function () {
    return BASE_SPEED * (this.def.speed || 1) * (this.speedScale || 1);
  };

  /* ===========================================================================
   * 击退积分 / 最小间距 / 边界约束
   * ======================================================================== */
  Player.prototype._integrateKnockback = function (dt) {
    var kv = this.knockbackVel;
    kv.y += ARENA.gravity * dt;                          // 重力

    this.position.x += kv.x * dt;
    this.position.y += kv.y * dt;
    this.position.z += kv.z * dt;

    if (this.position.y <= 0) {                          // 触地
      this.position.y = 0;
      if (kv.y < 0) kv.y = 0;
      var f = Math.pow(ARENA.groundFriction, dt * 60);
      kv.x *= f; kv.z *= f;
    } else {
      kv.x *= (1 - ARENA.airDrag);                       // 空中阻尼
      kv.z *= (1 - ARENA.airDrag);
    }
    if (Math.abs(kv.x) < 0.02) kv.x = 0;
    if (Math.abs(kv.z) < 0.02) kv.z = 0;
    if (Math.abs(kv.y) < 0.02 && this.position.y <= 0) kv.y = 0;
  };

  /* 与对手保持最小间距（玩家施加完整修正，敌方施加一半，见 enemy.js） */
  Player.prototype._separation = function (opp) {
    var sep = ARENA.minSeparation;
    var dx = this.position.x - opp.position.x;
    var dz = this.position.z - opp.position.z;
    var d = Math.sqrt(dx * dx + dz * dz);
    if (d < 1e-4) {                                      // 完全重叠：沿反向推开
      this.position.x -= this.facing * sep;
      return;
    }
    if (d >= sep) return;
    var inv = 1 / d;
    var corr = sep - d;                                  // 完整修正量
    this.position.x += dx * inv * corr;
    this.position.z += dz * inv * corr;
  };

  /* 边界约束：x ∈ ±width/2，z ∈ ±depth/2 */
  Player.prototype._clampArena = function () {
    var hw = ARENA.width / 2, hd = ARENA.depth / 2;
    if (this.position.x > hw) { this.position.x = hw; this._vx = 0; this.knockbackVel.x = 0; }
    else if (this.position.x < -hw) { this.position.x = -hw; this._vx = 0; this.knockbackVel.x = 0; }
    if (this.position.z > hd) { this.position.z = hd; this._vz = 0; this.knockbackVel.z = 0; }
    else if (this.position.z < -hd) { this.position.z = -hd; this._vz = 0; this.knockbackVel.z = 0; }
  };

  /* ===========================================================================
   * 基础动作选择（待机 / 行走 / 奔跑 / 格挡 / 眩晕）
   * ======================================================================== */
  Player.prototype._pickLocomotion = function (dt) {
    if (this.dead || this._doingDodge || this.moveInst) return;
    if (this.state === 'hit' || this._flinchT > 0) return;   // 受击片段播放中

    if (this.stunned) {
      this.state = 'stun';
      this.anim('hit', { fade: 0.12 });
      return;
    }
    if (this.blocking) {
      this.state = 'block';
      this.anim('block', { fade: 0.12 });
      return;
    }

    var maxSpeed = this._maxSpeed() || 1;
    var sp = this._speed || 0;
    if (sp > maxSpeed * 0.15) {
      var run = sp > maxSpeed * 0.6;
      this.state = run ? 'run' : 'walk';
      /* 剪辑速度随移动速度缩放，避免脚底打滑 */
      this.anim(run ? 'run' : 'walk', {
        fade: 0.16,
        timeScale: U.clamp(sp / (maxSpeed * 0.7), 0.55, 1.7)
      });
    } else {
      this.state = 'idle';
      this.anim('idle', { fade: 0.18 });
    }
  };

  /* ===========================================================================
   * 视觉同步（根节点位置 / 朝向 / 步态起伏 / 受击后仰 / 混合器推进）
   * ======================================================================== */
  Player.prototype._syncVisual = function (dt) {
    var bobY = 0;
    if (this._bob > 0 && (this.state === 'walk' || this.state === 'run')) {
      bobY = Math.abs(Math.sin(this._stepT)) * 0.12 * this._bob;   // 行走时躯干起伏
    }
    var backX = -this.facing * this._hitBack * HIT_BACK_AMOUNT;    // 受击后仰视觉回撤

    if (this.root) {
      this.root.position.set(this.position.x + backX, this.position.y + bobY, this.position.z);
      this.root.rotation.y = MODEL_YAW_OFFSET - this.yaw;          // 模型正面 +Z → 对齐 yaw
    }
    /* 材质：受击闪白衰减 + 发光呼吸 */
    this._updateMaterials(dt);
    if (this.mixer) this.mixer.update(dt);
  };

  /* 材质反馈：受击闪白逐帧衰减；发光材质呼吸脉动 */
  Player.prototype._updateMaterials = function (dt) {
    var mdl = this.model;
    if (!mdl) return;
    var HF = (CONFIG.artConfig && CONFIG.artConfig.hitFlash) || {};
    if (this._flashT > 0) {
      this._flashT = Math.max(0, this._flashT - dt * (HF.decay || 5.5));
    }
    var k = this._flashT > 0 ? this._flashT / (HF.duration || 0.18) : 0;
    if (mdl.bodyMaterials && GAME.Models && GAME.Models.flashBody) {
      GAME.Models.flashBody(mdl.bodyMaterials, U.clamp(k, 0, 1));
    }
    if (mdl.glowMaterials && GAME.Models && GAME.Models.pulseGlow) {
      GAME.Models.pulseGlow(mdl.glowMaterials, (this._elapsed = (this._elapsed || 0) + dt));
    }
  };

  /* ===========================================================================
   * 资源 / 连击 接口
   * ======================================================================== */
  Player.prototype.addEnergy = function (n) {
    if (CONFIG.debug.infiniteEnergy) { this.energy = this.maxEnergy; return this.energy; }
    this.energy = U.clamp(this.energy + (n || 0), 0, this.maxEnergy);
    return this.energy;
  };

  Player.prototype._hasEnergy = function (n) {
    return CONFIG.debug.infiniteEnergy || this.energy >= (n || 0);
  };

  Player.prototype.spendEnergy = function (n) {
    n = n || 0;
    if (n <= 0) return true;
    if (CONFIG.debug.infiniteEnergy) return true;
    if (this.energy < n) return false;
    this.energy -= n;
    return true;
  };

  Player.prototype._consumeAllEnergy = function () {
    this.energy = CONFIG.debug.infiniteEnergy ? this.maxEnergy : 0;
  };

  Player.prototype._ultimateReady = function () {
    return CONFIG.debug.infiniteEnergy || this.energy >= ENERGY.ultimateReadyAt;
  };

  Player.prototype.spendStamina = function (n) {
    n = n || 0;
    if (n <= 0) return true;
    this._staminaDelay = STAM.regenDelay;
    if (this.stamina < n) return false;
    this.stamina -= n;
    return true;
  };

  Player.prototype.addComboHit = function (n) {
    n = (n === undefined) ? 1 : n;
    if (n <= 0) return;                                   // 被格挡不计连击
    this.comboHits += n;
    this.comboTimer = TIMING.comboWindow;
    this.comboDamageBonus = 1 + Math.min(C.combo.maxBonus, this.comboHits * C.combo.bonusPerHit);
  };

  Player.prototype.setBlocking = function (b) {
    b = !!b;
    if (this.dead || this.stunned || this._doingDodge) b = false;
    if (b && this.moveInst) b = false;
    if (b === this.blocking) return this.blocking;
    this.blocking = b;
    if (b) {
      /* 记录格挡按下时刻，供 Combat.isPerfectGuard 判定完美格挡窗口 */
      this._blockPressT = (GAME.Combat && GAME.Combat.nowSec) ? GAME.Combat.nowSec() : Date.now() / 1000;
      if (this.state === 'idle' || this.state === 'walk' || this.state === 'run') {
        this.state = 'block';
        this.anim('block', { fade: 0.12 });
      }
    } else if (this.state === 'block') {
      this.state = 'idle';
    }
    return this.blocking;
  };

  /* ===========================================================================
   * 眩晕
   * ======================================================================== */
  Player.prototype.setStunned = function (dur) {
    dur = (dur === undefined) ? STUN.duration : dur;
    this.stunned = true;
    this.stunTimer = dur;
    this.stun = 0;
    this.stunDecayDelay = 0;
    this.blocking = false;
    this.invuln = false;
    if (this.moveInst) { this._endMove(); }               // 眩晕打断当前动作
    this.state = 'stun';
    this.anim('hit', { fade: 0.12, force: true });
  };

  /* Combat 在写入眩晕时会回调（此处与 setStunned 保持一致、互不冲突） */
  Player.prototype.onStunned = function (dur) {
    if (!this.stunned) this.setStunned(dur);
    else this.stunTimer = Math.max(this.stunTimer, dur === undefined ? STUN.duration : dur);
  };

  /* ===========================================================================
   * 受击回调：takeHit(result)
   * ======================================================================== */
  Player.prototype.takeHit = function (result) {
    if (!result || this.dead) return;

    /* 受击闪白（仅视觉，不改判定） */
    var HF = (CONFIG.artConfig && CONFIG.artConfig.hitFlash) || {};
    this._flashT = Math.max(this._flashT || 0, HF.duration || 0.18);

    var duringUlt = (this.state === 'ultimate');

    /* --- 被击杀 --- */
    if (result.killed) {
      this._applyKnockback(result, true);
      this._enterDeath();
      return;
    }

    /* --- 必杀霸体：不被击断、不被眩晕（保留招式演出） --- */
    if (duringUlt) {
      this.stunned = false;
      this.stunTimer = 0;
      this.stun = 0;
      this.frozen = Math.max(this.frozen, result.hitstop || HITR.hitStopLight);
      this._applyKnockback(result, false);
      this._hitBack = Math.max(this._hitBack, 0.6);
      return;
    }

    /* --- 被格挡：短促抖动 + 断耐力恢复 --- */
    if (result.blocked) {
      this._staminaDelay = STAM.regenDelay;
      this._flinchT = 0.12;
      this.anim('hit', { fade: 0.06, timeScale: 1.4, force: true });
      this.frozen = Math.max(this.frozen, result.hitstop || HITR.hitStopLight);
      this._hitBack = Math.max(this._hitBack, 0.5);
      /* P2：格挡护盾波纹（受击点展开能量环）；完美格挡金色、普通格挡青色 */
      if (this.renderer && this.renderer.spawnShieldRipple) {
        this.renderer.spawnShieldRipple(result.position, result.perfect ? 0xffd66e : 0x6fd0ff);
      }
      if (result.broken) {
        /* 破防：红闪 + 额外抖动（文字由 UI 显示 GUARD BREAK） */
        this._flashT = Math.max(this._flashT || 0, (CONFIG.artConfig && CONFIG.artConfig.hitFlash && CONFIG.artConfig.hitFlash.duration) || 0.18);
        this._flinchT = 0.3;
      }
      this._applyKnockback(result, false);
      return;
    }

    /* --- 普通受击：播放受击片段、冻结、打断当前动作（必杀除外）、击退 --- */
    if (this.moveInst) {                                    /* P2：被打断时结束拖尾 */
      if (this.renderer && this.renderer.endTrail) this.renderer.endTrail(this);
    }
    this.moveInst = null;
    this._advanceT = 0; this._advanceVX = 0; this._advanceVZ = 0;
    this._doingDodge = false; this.invuln = false;
    this.frozen = Math.max(this.frozen, result.hitstop || HITR.hitStopLight);
    this._hitT = Math.max(this._hitT, Math.max(0.25, result.hitstop || 0));
    this.state = 'hit';
    this.anim('hit', { fade: 0.06 });
    this._hitBack = Math.max(this._hitBack, 1);
    this.addEnergy(0);                                    // 受击积攒能量由 Combat 负责，这里保持一致性
    this._applyKnockback(result, false);
  };

  /* 计算并写入击退速度：有 Ammo 物理则用探针，否则用等价解析式 */
  Player.prototype._applyKnockback = function (result, big) {
    var dir = result.knockDir || { x: -this.facing, y: 0, z: 0 };
    var force = (result.knockback || 0) * (HITR.knockbackScale || 1);
    var vel;
    var phys = this.physics || GAME.Physics;
    if (phys && phys.available && typeof phys.knockback === 'function') {
      vel = phys.knockback(this, dir, force);
    } else {
      /* 与 physics.js 无 Ammo 分支等价的解析式：速度 = 力 * MASS_REF / 质量 */
      var unitMass = Math.max(1, (this.def.hp || 1000) * (this.def.defense || 1));
      var sc = force * MASS_REF / unitMass;
      vel = { x: dir.x * sc, y: dir.y * sc, z: dir.z * sc };
    }
    var pop = Math.min(big ? 8 : 4, force * (big ? 0.5 : 0.35));   // 轻微上抛，形成击退弧线
    this.knockbackVel.x = vel.x;
    this.knockbackVel.y = Math.max(vel.y, 0) + pop;
    this.knockbackVel.z = vel.z;
  };

  /* 死亡：切死亡片段、关闭输入与动作 */
  Player.prototype._enterDeath = function () {
    this.dead = true;
    this.hp = 0;
    this.state = 'dead';
    this.blocking = false;
    this.invuln = false;
    this.stunned = false;
    this.moveInst = null;
    this._doingDodge = false;
    this._vx = 0; this._vz = 0;
    this._advanceT = 0;
    this.anim('death', { fade: 0.1, force: true });
    U.bus.emit('unit:dead', { unit: this });
  };

  /* ===========================================================================
   * 命中中心（默认胸口高度）
   * ======================================================================== */
  Player.prototype.getHitCenter = function () {
    var y = this.position.y + (this._hitCenterY || 0);
    if (this._hitCenter && this._hitCenter.set) {
      this._hitCenter.set(this.position.x, y, this.position.z);
      return this._hitCenter;
    }
    if (this.THREE) {
      this._hitCenter = new this.THREE.Vector3(this.position.x, y, this.position.z);
      return this._hitCenter;
    }
    var v = { x: this.position.x, y: y, z: this.position.z };
    v.clone = function () { var o = { x: this.x, y: this.y, z: this.z }; o.clone = this.clone; return o; };
    this._hitCenter = v;
    return this._hitCenter;
  };

  /* ===========================================================================
   * 状态广播（可见变化时触发）
   * ======================================================================== */
  Player.prototype._emitState = function () {
    var key = this.state + '|' + Math.round(this.hp) + '|' + Math.round(this.stamina) + '|' +
      Math.round(this.energy) + '|' + this.comboHits;
    if (key === this._lastStateKey) return;
    this._lastStateKey = key;
    U.bus.emit('player:state', {
      unit: this, id: this.id, state: this.state,
      hp: this.hp, stamina: this.stamina, energy: this.energy, comboHits: this.comboHits
    });
  };

  /* ===========================================================================
   * 复位 / 释放 / 调试
   * ======================================================================== */
  Player.prototype.reset = function () {
    this.hp = this.maxHp;
    this.armor = this.maxArmor;
    this.stamina = this.maxStamina;
    this.energy = CONFIG.debug.infiniteEnergy ? this.maxEnergy : 0;
    this.stun = 0; this.stunTimer = 0; this.stunDecayDelay = 0;
    this.state = 'idle';
    this.blocking = false; this.invuln = false; this.stunned = false; this.dead = false;
    this.frozen = 0;
    this.knockbackVel = { x: 0, y: 0, z: 0 };
    this.comboHits = 0; this.comboTimer = 0; this.comboDamageBonus = 1;
    this.moveInst = null; this.speedScale = 1; this._exhausted = false;
    this._vx = 0; this._vz = 0; this._speed = 0; this._bob = 0; this._stepT = 0;
    this._chainIndex = 0; this._chainKey = null; this._chainWindow = 0;
    this._doingDodge = false; this._dodgeT = 0; this._dodgeFxT = 0; this._dodgeVX = 0; this._dodgeVZ = 0;
    this._buffer = { key: null, t: 0 };
    this._advanceT = 0; this._advanceVX = 0; this._advanceVZ = 0;
    this._firing = false; this._fireCount = 0;
    this._ultIndex = 0; this._ultTimes = [];
    this._hitT = 0; this._flinchT = 0; this._hitBack = 0; this._staminaDelay = 0;

    if (this.position.set) this.position.set(this._spawn.x, this._spawn.y || 0, this._spawn.z);
    this.facing = this._initFacing;
    this.yaw = this.facing > 0 ? 0 : Math.PI;

    if (this._actions) {
      for (var k in this._actions) {
        if (this._actions[k]) this._actions[k].stop();
      }
    }
    this._currentAction = null;
    this.currentClip = null;
    this.anim('idle', { fade: 0.1, force: true });
    this._lastStateKey = '';
    this._syncVisual(0);
    this._emitState();
    return this;
  };

  Player.prototype.dispose = function () {
    if (this.mixer) {
      try {
        if (this.root) this.mixer.uncacheRoot(this.root);
        if (this.mixer.stopAllAction) this.mixer.stopAllAction();
      } catch (e) { /* 忽略 */ }
      this.mixer = null;
    }
    this._actions = {};
    this._clipByName = {};
    this._currentAction = null;
    if (this.root && this.root.parent && this.root.parent.remove) {
      this.root.parent.remove(this.root);
    }
  };

  Player.prototype.getDebugInfo = function () {
    return {
      id: this.id, style: this.style, state: this.state,
      dead: this.dead, stunned: this.stunned, blocking: this.blocking, invuln: this.invuln,
      hp: Math.round(this.hp), maxHp: this.maxHp,
      stamina: Math.round(this.stamina), maxStamina: this.maxStamina,
      energy: Math.round(this.energy), maxEnergy: this.maxEnergy,
      stun: Math.round(this.stun), maxStun: this.maxStun,
      comboHits: this.comboHits, comboDamageBonus: this.comboDamageBonus,
      speedScale: this.speedScale,
      pos: { x: this.position.x, y: this.position.y, z: this.position.z },
      yaw: this.yaw, facing: this.facing,
      move: this.moveInst ? this.moveInst.key : null,
      movePhase: this.moveInst ? this.moveInst.phase : null,
      buffer: (this._buffer && this._buffer.key) ? (this._buffer.key + (this._buffer.t > 0 ? ' ' + this._buffer.t.toFixed(2) + 's' : '')) : null,
      clip: this.currentClip
    };
  };

  /* ===========================================================================
   * 内部小工具
   * ======================================================================== */
  function makeFallbackVec(x, y, z) {
    return {
      x: x, y: y, z: z,
      set: function (a, b, c) { this.x = a; this.y = b; this.z = c; return this; }
    };
  }

  Player.prototype._distTo = function (opp) {
    if (!opp || !opp.position) return 0;
    var dx = opp.position.x - this.position.x;
    var dz = opp.position.z - this.position.z;
    return Math.sqrt(dx * dx + dz * dz);
  };

  Player.prototype._emitNoResource = function (kind, key) {
    U.bus.emit('unit:no-resource', { unit: this, kind: kind, action: key });
  };

  /* P2：按动作键返回拖尾颜色（取自 ART_CONFIG.fx.trail） */
  function trailColorFor(key, faction) {
    var T = (CONFIG.artConfig && CONFIG.artConfig.fx && CONFIG.artConfig.fx.trail) || {};
    if (faction === 'kaiju') return T.colorKaiju || 0x69ffc8;
    if (key === 'heavy') return T.colorHeavy || 0xffc86b;
    if (key === 'skill') return T.colorSkill || 0xff7a1e;
    if (key === 'ultimate') return T.colorUltimate || 0x9fd8ff;
    return T.colorLight || 0x6fd0ff;
  }

  GAME.Player = Player;

})(typeof window !== 'undefined' ? window : this);
