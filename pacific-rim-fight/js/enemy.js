/* =============================================================================
 * enemy.js  ──  AI 控制的怪兽单位（GAME.Enemy）
 * 依赖：config.js（GAME.CONFIG / GAME.U）、combat.js（GAME.Combat 单位契约）
 *       physics.js（GAME.Physics.knockback，可选）、models.js（opts.model 已构建）
 * 加载方式：普通 <script>，挂载 window.GAME.Enemy
 *
 * ---------------------------------------------------------------------------
 * 【单位契约 Unit Contract】与 combat.js 头部声明严格一致；GAME.Player 为同级
 * 单位，main.js 以同样的方式对待二者（字段 / 方法完全对齐）：
 *   id / def / faction / style
 *   position(中心点在地上) / root / yaw(0=+X) / facing(+1右 / -1左)
 *   hp/maxHp stamina/maxStamina energy/maxEnergy stun/maxStun/stunTimer/stunDecayDelay
 *   state('idle'|'walk'|'run'|'attack'|'dodge'|'block'|'hit'|'stun'|'dead'|'ultimate')
 *   blocking / invuln / stunned / dead / frozen / knockbackVel
 *   comboHits / comboTimer / comboDamageBonus / moveInst / speedScale / aiState
 *   方法：update(dt,ctx) attack(key) takeHit(result) addEnergy spendEnergy
 *         spendStamina addComboHit getHitCenter setBlocking setStunned onStunned
 *         reset dispose getDebugInfo anim(name,opts)
 *
 * 【AI 设计（公平、可读）】
 *   · 状态机：patrol(慢速巡逻) / approach(接近) / combat(攻击) / guard(格挡蓄力)
 *             / retreat(低血低耐力后撤) / stunned / dead，由“反应计时器”门控决策，
 *             绝不每帧重新决策。
 *   · 距离决策使用 CONFIG.ai.ranges：近→撕咬 3 连、中→尾击/冲撞、远→冲撞/接近。
 *   · 每套 style 行为来自 def.ai：fast=近身撕咬连击 + 频繁闪避；tank=中距离尾击/冲撞、
 *     多格挡少闪避。
 *   · 反应式防御：观察对手 moveInst 的重招起手，按 guardRate/dodgeRate 掷骰格挡/闪避。
 *   · 难度缩放：attackRate→攻击频率 / reaction→决策延迟 / damageScale→aiDamageScale /
 *     moveSpeed→移动速度 / defenseScale→受击修正系数 / mistakeRate→误判(迟反应/挥空)。
 *   · 必杀技：能量满且距离合适时释放 def.ultimate；tank 采用 charge 时序、fast 采用
 *     bite 时序（见 attack('ultimate') 内联说明）。
 * ========================================================================== */
(function (global) {
  'use strict';

  var GAME = global.GAME;
  var U = GAME.U;
  var CONFIG = GAME.CONFIG;
  var C = CONFIG.combat;
  var AICFG = CONFIG.ai;

  /* ---------------------------------------------------------------------------
   * 实现常量（CONFIG 未定义、仅属于实现细节的数值，避免硬编码进逻辑）
   * ------------------------------------------------------------------------ */
  var BASE_MOVE_SPEED = 9;            // 基础移动速度（世界单位/秒；config 只给相对倍率）
  var KNOCK_MASS_REF = 1000;          // 与 physics.js 击退质量基准一致（无 Ammo 回退公式）
  var MODEL_FORWARD_Y = Math.PI / 2;  // 程序化怪兽模型默认朝 +Z，需 +90° 对齐 yaw(0=+X)
  var NORMAL_REACTION = (AICFG.levels.normal && AICFG.levels.normal.reaction) || 0.42;
  var KB_FRICTION_FPS = 60;           // 地面摩擦按 60fps 每帧衰减（与 physics.js 回退一致）

  /* ===========================================================================
   * 构造函数
   *   opts = { def, model:{root,clips,isPlaceholder}, position, facing, physics,
   *            renderer, combat, difficulty }
   * ======================================================================== */
  function Enemy(opts) {
    opts = opts || {};
    var def = opts.def || CONFIG.units.kaiju[0];
    var model = opts.model || {};

    /* THREE 仅在运行期获取（renderer 经 init 注入），顶层绝不引用 */
    var T = (opts.renderer && opts.renderer.THREE) || global.THREE || null;

    this.THREE = T;
    this.def = def;
    this.id = def.id;
    this.faction = def.faction || 'kaiju';
    this.style = def.style || 'fast';

    /* --- 模型 / 动画 --- */
    this.model = model;
    this.root = model.root || null;
    this.clips = model.clips || [];
    this.isPlaceholder = !!model.isPlaceholder;

    /* --- 位置 / 朝向 --- */
    var p = opts.position || {};
    var px = p.x || 0, py = p.y || 0, pz = p.z || 0;
    this.position = T ? new T.Vector3(px, py, pz) : { x: px, y: py, z: pz };
    this._spawn = { x: px, y: py, z: pz };
    this.facing = (opts.facing === 1 || opts.facing === -1) ? opts.facing
      : (opts.facing > 0 ? 1 : -1);       // 缺省朝左（怪兽通常位于 +x 侧）
    this._spawnFacing = this.facing;
    this.yaw = this.facing > 0 ? 0 : Math.PI;

    /* --- 三大属性 --- */
    this.maxHp = def.hp || 1000;                      this.hp = this.maxHp;
    this.maxStamina = def.stamina || C.stamina.max;   this.stamina = this.maxStamina;
    this.maxEnergy = C.energy.max;                    this.energy = 0;
    this.maxStun = C.stun.max;                        this.stun = 0;
    this.stunTimer = 0;                               this.stunDecayDelay = 0;

    /* --- 战斗状态 --- */
    this.state = 'idle';
    this.blocking = false;
    this.invuln = false;
    this.stunned = false;
    this.dead = false;
    this.frozen = 0;
    this.knockbackVel = { x: 0, y: 0, z: 0 };
    this.comboHits = 0;
    this.comboTimer = 0;
    this.comboDamageBonus = 1;
    this.moveInst = null;
    this.speedScale = 1;

    /* --- 运动 --- */
    this.vel = { x: 0, y: 0, z: 0 };
    this.grounded = true;

    /* --- AI --- */
    this.ai = def.ai || {};
    this.difficulty = null;
    this.aiDamageScale = 1;
    this.aiDefenseScale = 1;
    this.moveSpeed = 1;
    this.mistakeRate = 0;
    this.reactionTime = NORMAL_REACTION;
    this.aiState = 'patrol';
    this.distance = 0;
    this.decideTimer = 0;
    this.attackCool = 0;
    this.guardTimer = 0;
    this.pressTimer = 0;
    this.biteChain = 0;
    this.patrolDir = 0;
    this._setDifficulty(opts.difficulty);

    /* --- 计时器（反应式防御 / 闪避 / 咆哮）--- */
    this.currentMoveKey = null;
    this.dodgeTimer = 0;
    this.dodgeElapsed = 0;
    this.dodgeDir = { x: 0, z: 0 };
    this.dodgeSpeed = 0;
    this.roarTimer = 0;
    this.roarCool = U.rand(3.0, AICFG.states.roar.cooldown);
    this._reactKey = null;
    this._reactAccum = 0;
    this._reacted = false;

    /* --- 外部引用 --- */
    this.physics = opts.physics || null;
    this.renderer = opts.renderer || null;
    this.combat = opts.combat || null;

    /* --- 动画混合器 --- */
    this.mixer = null;
    this.actions = {};
    this.currentClip = null;
    this._lastStateSig = '';
    this._initAnim();

    this._syncRoot();
  }

  /* ===========================================================================
   * 原型方法
   * ======================================================================== */
  Enemy.prototype = {

    constructor: Enemy,

    /* ---------------------------------------------------------------------------
     * 难度：解析 difficulty 条目并刷新由难度派生的全部缩放系数
     * ------------------------------------------------------------------------ */
    _setDifficulty: function (diff) {
      if (typeof diff === 'string') diff = AICFG.levels[diff] || AICFG.levels.normal;
      this.difficulty = diff || AICFG.levels[AICFG.difficulty] || AICFG.levels.normal;
      var d = this.difficulty;
      this.aiDamageScale = d.damageScale !== undefined ? d.damageScale : 1;    // Combat 读取出招伤害
      this.aiDefenseScale = d.defenseScale !== undefined ? d.defenseScale : 1; // 本文件 takeHit 受击修正
      this.moveSpeed = d.moveSpeed !== undefined ? d.moveSpeed : 1;
      this.mistakeRate = d.mistakeRate !== undefined ? d.mistakeRate : 0;
      /* 反应时间：难度基准 + 风格差异（fast 更快、tank 更慢） */
      this.reactionTime = Math.max(0.08, (d.reaction || NORMAL_REACTION) +
        (((this.ai && this.ai.reaction) || NORMAL_REACTION) - NORMAL_REACTION));
    },

    /* ---------------------------------------------------------------------------
     * 动画：基于 THREE.AnimationMixer，缺失片段优雅降级（no-op）
     * ------------------------------------------------------------------------ */
    _initAnim: function () {
      var T = this.THREE;
      if (!T || !this.model || !this.model.mixerTarget) return;
      if (!this.clips || !this.clips.length) return;
      this.mixer = new T.AnimationMixer(this.model.mixerTarget);
      for (var i = 0; i < this.clips.length; i++) {
        var clip = this.clips[i];
        if (clip && clip.name) this.actions[clip.name] = this.mixer.clipAction(clip);
      }
    },

    /* 切换动画片段（交叉淡化）；片段缺失时返回 null 且不改动当前动画 */
    anim: function (name, opts) {
      opts = opts || {};
      var T = this.THREE;
      var act = this.actions ? this.actions[name] : null;
      if (!act || !T || !this.mixer) return null;
      if (this.currentClip === name && !opts.force) return act;

      var fade = opts.fade !== undefined ? opts.fade : 0.22;
      var once = opts.once === true;
      var prev = this.currentClip ? this.actions[this.currentClip] : null;

      act.reset();
      act.setLoop(once ? T.LoopOnce : T.LoopRepeat, once ? 1 : Infinity);
      act.clampWhenFinished = !!opts.clamp;
      act.setEffectiveTimeScale(opts.timeScale || 1);
      act.setEffectiveWeight(1);
      act.enabled = true;
      act.play();

      if (prev && prev !== act) act.crossFadeFrom(prev, fade, false);
      else if (fade > 0) act.fadeIn(fade);

      this.currentClip = name;
      return act;
    },

    /* ---------------------------------------------------------------------------
     * 资源
     * ------------------------------------------------------------------------ */
    addEnergy: function (n) {
      if (!n) return;
      this.energy = U.clamp(this.energy + n, 0, this.maxEnergy);
    },
    spendEnergy: function (n) {
      if (this.energy < n) return false;
      this.energy -= n;
      return true;
    },
    spendStamina: function (n) {
      if (this.stamina < n) return false;
      this.stamina -= n;
      this.staminaDelay = C.stamina.regenDelay;   // 消耗后延迟恢复
      return true;
    },
    addComboHit: function (n) {
      if (!n || n <= 0) return;
      this.comboHits += n;
      this.comboTimer = C.timing.comboWindow;
      this.comboDamageBonus = Math.min(1 + C.combo.maxBonus, 1 + this.comboHits * C.combo.bonusPerHit);
    },

    /* ---------------------------------------------------------------------------
     * 受击判定中心（胸口高度；Combat 会调用 .clone()）
     * ------------------------------------------------------------------------ */
    getHitCenter: function () {
      var h = (this.def && this.def.height ? this.def.height : 11) * 0.55;
      var x = this.position.x, y = this.position.y + h, z = this.position.z;
      if (this.THREE) return new this.THREE.Vector3(x, y, z);
      return { x: x, y: y, z: z, clone: function () { return { x: x, y: y, z: z }; } };
    },

    /* ---------------------------------------------------------------------------
     * 动作
     * ------------------------------------------------------------------------ */
    /* key ∈ 'bite'|'tail'|'charge'|'ultimate'；返回是否成功开始 */
    attack: function (key) {
      if (this.dead || this.stunned || this.blocking || this.dodgeTimer > 0) return false;
      if (this.moveInst) return false;                          // 单动作，不叠加

      var combat = this.combat;
      var isUlt = (key === 'ultimate');
      var baseKey = isUlt ? (this.style === 'tank' ? 'charge' : 'bite') : key;
      var move = C.moves[baseKey];
      if (!move) return false;

      /* 必杀：消耗满能量 */
      if (isUlt && !this.spendEnergy(C.moves.ultimate.energyCost)) return false;
      /* 普通动作的耐力消耗（怪兽动作表未用 staminaCost，留作通用） */
      if (!isUlt && move.staminaCost && !this.spendStamina(move.staminaCost)) return false;

      var mi = combat && combat.createMove ? combat.createMove(this, baseKey) : this._fallbackCreateMove(baseKey);
      if (!mi) { if (isUlt) this.addEnergy(C.moves.ultimate.energyCost); return false; }
      /* Combat.canCancel 会读取这些连击元数据 */
      mi.maxCombo = move.comboMax || 1;
      mi.currIndex = 0;
      mi.hitCount = 0;

      if (isUlt) {
        /* 必杀时序选择说明：
         *   tank → 沿用 charge 的起手/判定/收招（长距离前倾冲撞）；
         *   fast → 沿用 bite 的时序（爆发撕咬）。
         *   两者都克隆基础动作并提高伤害、延长起手（戏剧性蓄力），并把 move.key
         *   标记为 'ultimate'，以触发 Combat 的专属演出（不可格挡 / 更高顿帧 /
         *   满级命中特效 / 镜头推近）。 */
        var clone = {};
        for (var mk in move) { if (move.hasOwnProperty(mk)) clone[mk] = move[mk]; }
        clone.key = 'ultimate';
        clone.damage = Math.round(move.damage * 1.8);          // 伤害提升
        clone.startup = move.startup + 0.4;                     // 蓄力加长（玩家有反应窗口）
        clone.unblockable = true;
        clone.cinematic = true;
        clone.ultimate = true;
        clone.label = (this.def.ultimate && this.def.ultimate.name) || '必杀技';
        mi.move = clone;
        mi.key = 'ultimate';
        mi.isUltimate = true;

        this.state = 'ultimate';
        this.aiState = 'combat';
        this.anim(baseKey, { fade: 0.2, timeScale: 0.8 });
        if (GAME.Audio) GAME.Audio.play('ultimate');
        U.bus.emit('unit:ultimate', {
          unit: this, name: clone.label,
          desc: this.def.ultimate && this.def.ultimate.desc,
          move: baseKey, damage: clone.damage
        });
      } else {
        this.state = 'attack';
        this.anim(move.animation || baseKey, { fade: 0.14 });
        if (GAME.Audio && move.sound) GAME.Audio.play(move.sound);
      }

      this.moveInst = mi;
      this.currentMoveKey = baseKey;
      this._emitState();
      return true;
    },

    /* ---------------------------------------------------------------------------
     * 受击回调（Combat.applyHit / applyRawDamage 调用）
     * ------------------------------------------------------------------------ */
    takeHit: function (result) {
      if (!result || this.dead) return;

      /* 受击无敌（闪避成功）：无伤害、无打断 */
      if (result.dodged) { this.anim('run', { fade: 0.08 }); return; }

      /* 受击闪白（仅视觉，不改判定） */
      var HF = (CONFIG.artConfig && CONFIG.artConfig.hitFlash) || {};
      this._flashT = Math.max(this._flashT || 0, HF.duration || 0.18);

      /* 难度防御系数修正（文档化实现）：
       *   Combat.applyHit 已按 def.defense 结算并扣除 HP；此处按 defenseScale 追加
       *   难度修正（>1 更耐打、<1 更脆），通过回补/补扣 HP 实现，绝不修改冻结的 def。
       *   为避免与 Combat 已发出的 combat:ko 冲突，修正不会自行制造击杀（hp 下限 1）。 */
      if (this.aiDefenseScale && this.aiDefenseScale !== 1 && result.damage > 0) {
        var diff = result.damage - result.damage / this.aiDefenseScale;   // 正=回补（少受）
        this.hp = U.clamp(this.hp + diff, 1, this.maxHp);
      }

      /* 死亡 */
      if (result.killed || this.hp <= 0) { this._die(result); return; }

      /* 受击停顿（Combat 每帧衰减 frozen） */
      this.frozen = Math.max(this.frozen, result.hitstop || C.timing.hitstop);

      /* 击退速度（Combat 写入，本单位每帧积分应用） */
      this.knockbackVel = this._knock(result);

      if (result.blocked) {
        /* 格挡成功：保持格挡姿态，不被节奏打断 */
        this._stress();
        if (GAME.Audio) GAME.Audio.play('block');
        this._emitState();
        return;
      }

      /* 必杀动作期间不被普通受击打断 */
      var ultLock = this.moveInst && this.moveInst.isUltimate;

      if (this.moveInst && !ultLock) {
        this.moveInst = null;                 // 打断当前动作
        this.state = 'hit';
        this.currentMoveKey = null;
      }
      if (!ultLock) this.anim('hit', { once: true, clamp: true, fade: 0.07 });

      /* 眩晕：Combat.addStun → setStunned/onStunned 已在本单位内处理 */
      this._stress();
      this._emitState();
    },

    _die: function (result) {
      this.dead = true;
      this.hp = 0;
      this.state = 'dead';
      this.aiState = 'dead';
      this.moveInst = null;
      this.blocking = false;
      this.invuln = false;
      this.stunned = false;
      this.stunTimer = 0;
      this.knockbackVel = this._knock(result);   // 倒地滑行
      this.anim('death', { once: true, clamp: true, fade: 0.15 });
      if (GAME.Audio) GAME.Audio.play('roar');
      this._emitState();
    },

    /* 击退速度：优先走 physics，缺省时复刻其无 Ammo 回退公式 */
    _knock: function (result) {
      if (!result) return { x: 0, y: 0, z: 0 };
      var force = (result.knockback || 0) * (C.hitReactions.knockbackScale || 1);
      if (force <= 0) return { x: 0, y: 0, z: 0 };
      var dir = result.knockDir || { x: -this.facing, y: 0, z: 0 };
      var out;
      if (this.physics && this.physics.knockback) {
        out = this.physics.knockback(this, dir, force);
      } else {
        var mass = Math.max(1, (this.def.hp || 1000) * (this.def.defense || 1));
        var len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z) || 1;
        var sc = force * KNOCK_MASS_REF / mass;
        out = { x: (dir.x / len) * sc, y: (dir.y / len) * sc, z: (dir.z / len) * sc };
      }
      /* 受击位置反馈：轻抬升，随后由重力拉回（重击更明显） */
      if (force >= 3) out.y += force * 0.18;
      return out;
    },

    /* 被压制：连击 / 受击 → 决策迟缓、倾向后撤（“挣扎感”） */
    _stress: function () {
      this.pressTimer = Math.max(this.pressTimer, 0.55);
      if (this.moveInst && !this.moveInst.isUltimate) this.moveInst = null;
      this.decideTimer = Math.max(this.decideTimer, this.reactionTime * 0.7);
    },

    /* ---------------------------------------------------------------------------
     * 格挡 / 眩晕
     * ------------------------------------------------------------------------ */
    setBlocking: function (v) {
      v = !!v;
      if (this.dead || this.stunned) { this.blocking = false; return; }
      if (v && (this.moveInst || this.dodgeTimer > 0)) return;   // 动作中不可起格挡
      if (v === this.blocking) return;
      this.blocking = v;
      if (v) {
        this.state = 'block';
        this.anim('block', { fade: 0.12 });     // 怪兽无 block 片段时静默降级
      } else if (this.state === 'block') {
        this.state = 'idle';
      }
    },

    setStunned: function (duration) {
      duration = duration || C.stun.duration;
      this.stunned = true;
      this.stunTimer = Math.max(this.stunTimer, duration);
      this.stun = 0;
      this.blocking = false;
      this.moveInst = null;
      this.dodgeTimer = 0;
      this.invuln = false;
      this.state = 'stun';
      this.aiState = 'stunned';
      this.anim('hit', { once: true, clamp: true, fade: 0.1 });
      this._emitState();
    },
    onStunned: function (duration) { this.setStunned(duration); },

    /* ---------------------------------------------------------------------------
     * 重置 / 清理
     * ------------------------------------------------------------------------ */
    reset: function () {
      this.hp = this.maxHp;
      this.stamina = this.maxStamina;
      this.energy = 0;
      this.stun = 0;
      this.stunTimer = 0;
      this.stunDecayDelay = 0;
      this.state = 'idle';
      this.blocking = false;
      this.invuln = false;
      this.stunned = false;
      this.dead = false;
      this.frozen = 0;
      this.knockbackVel = { x: 0, y: 0, z: 0 };
      this.vel = { x: 0, y: 0, z: 0 };
      this.grounded = true;
      this.comboHits = 0;
      this.comboTimer = 0;
      this.comboDamageBonus = 1;
      this.moveInst = null;
      this.currentMoveKey = null;
      this.speedScale = 1;
      this.aiState = 'patrol';
      this.decideTimer = 0;
      this.attackCool = 0;
      this.guardTimer = 0;
      this.pressTimer = 0;
      this.biteChain = 0;
      this.dodgeTimer = 0;
      this.dodgeElapsed = 0;
      this.roarTimer = 0;
      this._reactKey = null;
      this._reactAccum = 0;
      this._reacted = false;
      this.distance = 0;
      this._lastStateSig = '';
      if (this.position.set) this.position.set(this._spawn.x, this._spawn.y, this._spawn.z);
      else { this.position.x = this._spawn.x; this.position.y = this._spawn.y; this.position.z = this._spawn.z; }
      this.facing = this._spawnFacing;
      this.yaw = this.facing > 0 ? 0 : Math.PI;
      if (this.mixer) { this.mixer.stopAllAction(); this.currentClip = null; }
      this.anim('idle', { fade: 0, force: true });
      this._syncRoot();
      return this;
    },

    dispose: function () {
      if (this.mixer) {
        this.mixer.stopAllAction();
        if (this.mixer.uncacheRoot && this.model && this.model.mixerTarget) {
          this.mixer.uncacheRoot(this.model.mixerTarget);
        }
      }
      this.mixer = null;
      this.actions = {};
      this.currentClip = null;
      this.model = null;
      this.root = null;
      this.combat = null;
      this.physics = null;
      this.renderer = null;
    },

    getDebugInfo: function () {
      return {
        id: this.id,
        faction: this.faction,
        style: this.style,
        state: this.state,
        aiState: this.aiState,
        hp: Math.round(this.hp),
        maxHp: this.maxHp,
        stamina: Math.round(this.stamina),
        energy: Math.round(this.energy),
        stun: Math.round(this.stun),
        diff: this.difficulty && this.difficulty.name,
        move: this.currentMoveKey,
        distance: Math.round(this.distance * 10) / 10,
        blocking: this.blocking,
        invuln: this.invuln,
        stunned: this.stunned,
        dead: this.dead,
        frozen: Math.round(this.frozen * 1000) / 1000
      };
    },

    /* ===========================================================================
     * 每帧更新
     *   ctx = { dt, elapsed, input, combat, physics, renderer, opponent,
     *           difficulty, arena }
     * ======================================================================== */
    update: function (dt, ctx) {
      ctx = ctx || {};
      if (ctx.physics) this.physics = ctx.physics;
      if (ctx.renderer) this.renderer = ctx.renderer;
      if (ctx.combat) this.combat = ctx.combat;
      if (ctx.difficulty && ctx.difficulty !== this.difficulty) this._setDifficulty(ctx.difficulty);
      if (!(dt > 0)) return;

      var combat = ctx.combat || this.combat;
      var opponent = ctx.opponent || (combat && combat.opponentOf ? combat.opponentOf(this) : null);
      var arena = ctx.arena || CONFIG.arena;

      /* 死亡：播放倒地余韵 + 物理滑行 */
      if (this.dead) {
        this._integratePhysics(dt, arena);
        this._syncRoot();
        this._updateMaterials(dt);
        if (this.mixer) this.mixer.update(dt);
        return;
      }

      /* 受击停顿：不决策、不主动移动，仅保留击退惯性 */
      if (this.frozen > 0) {
        this._integratePhysics(dt, arena, true);
        this._syncRoot();
        this._updateMaterials(dt);
        if (this.mixer) this.mixer.update(dt);
        return;
      }

      /* 计时器衰减 */
      if (this.staminaDelay > 0) this.staminaDelay -= dt;
      if (this.attackCool > 0) this.attackCool -= dt;
      if (this.roarCool > 0) this.roarCool -= dt;
      if (this.pressTimer > 0) this.pressTimer -= dt;
      if (this.roarTimer > 0) this.roarTimer -= dt;

      this._regen(dt);

      /* 眩晕推进 */
      if (this.stunned) {
        this.stunTimer -= dt;
        if (this.stunTimer <= 0) {
          this.stunned = false;
          this.stunTimer = 0;
          this.state = 'idle';
          this.aiState = 'combat';
          this.decideTimer = this.reactionTime * 0.5;
        }
      }

      /* 格挡：持续时间 + 耐力持续消耗 */
      if (this.blocking) {
        if (this.guardTimer > 0) this.guardTimer -= dt;
        if (this.guardTimer <= 0 || !this.spendStamina(C.stamina.blockDrainRate * dt)) {
          this.setBlocking(false);
        }
      }

      /* 闪避推进（含无敌帧） */
      this._updateDodge(dt);

      /* 动作推进 */
      this._updateMove(dt, combat, opponent);

      /* 命中判定：active 帧内每帧尝试（Combat 内部对同一目标去重） */
      if (this.moveInst && this.moveInst.phase === 'active' && combat && combat.resolveAttack && opponent) {
        combat.resolveAttack(this, [opponent]);
      }

      /* 主动速度归零（若本帧未执行移动则保持静止） */
      this.vel.x = 0;
      this.vel.z = 0;

      /* AI 决策（受反应计时器门控） */
      if (!this.stunned && !this.blocking && this.dodgeTimer <= 0 && !this.moveInst) {
        this._ai(dt, opponent, combat, arena);
      }

      /* 偶尔咆哮（节流） */
      this._maybeRoar();

      /* 物理积分 + 防重叠 + 朝向 + 节点同步 */
      this._integratePhysics(dt, arena, false);
      this._resolveSeparation(opponent);
      this._face(opponent);
      this._syncRoot();
      this._updateMaterials(dt);

      /* 动画 */
      this._updateAnim();
      if (this.mixer) this.mixer.update(dt);

      this._emitState();
    },

    /* ---------------------------------------------------------------------------
     * 资源回复
     * ------------------------------------------------------------------------ */
    _regen: function (dt) {
      if (this.staminaDelay <= 0 && this.stamina < this.maxStamina) {
        this.stamina = Math.min(this.maxStamina, this.stamina + C.stamina.regen * dt);
      }
      this.energy = Math.min(this.maxEnergy, this.energy + C.energy.regen * (this.def.energyRegen || 1) * dt);
      /* 耐力耗尽 → 动作速度惩罚（Combat.createMove 会读取 speedScale） */
      this.speedScale = (this.stamina <= 0.0001) ? C.stamina.exhaustedPenalty : 1;
    },

    /* ---------------------------------------------------------------------------
     * 动作推进
     * ------------------------------------------------------------------------ */
    _updateMove: function (dt, combat, opponent) {
      var mi = this.moveInst;
      if (!mi) return;
      var evt = (combat && combat.updateMove) ? combat.updateMove(this, dt) : this._stepMove(dt, mi);

      if (evt === 'done') {
        var wasBite = (mi.key === 'bite');
        this.moveInst = null;
        this.currentMoveKey = null;
        if (this.state === 'attack' || this.state === 'ultimate') this.state = 'idle';
        /* 攻击后冷却：attackRate 与 aggression 越高，间隔越短（保留最小反应窗口） */
        var rate = (this.difficulty.attackRate || 1) * (this.ai.aggression || 1);
        if (rate <= 0) rate = 1;
        this.attackCool = Math.max(0.12, U.rand(0.18, 0.42) / rate);
        if (wasBite && this.comboTimer <= 0) this.biteChain = 0;
      }
    },

    /* 无 combat 时的动作推进回退（保持类自洽） */
    _stepMove: function (dt, mi) {
      var move = mi.move;
      if (!move) { return 'done'; }
      var scale = mi.speedScale || 1;
      mi.t += dt * scale;
      var evt = null;
      if (mi.phase === 'startup' && mi.t >= move.startup) { mi.phase = 'active'; mi.t = 0; evt = 'active-enter'; }
      else if (mi.phase === 'active' && mi.t >= move.active) { mi.phase = 'recovery'; mi.t = 0; }
      else if (mi.phase === 'recovery' && mi.t >= move.recovery) { mi.phase = 'done'; evt = 'done'; }
      return evt;
    },
    _fallbackCreateMove: function (key) {
      var move = C.moves[key];
      if (!move) return null;
      return {
        key: key, move: move, t: 0, phase: 'startup', hasHit: false,
        hitTargets: [], speedScale: this.speedScale || 1,
        maxCombo: move.comboMax || 1, currIndex: 0, hitCount: 0
      };
    },

    /* ---------------------------------------------------------------------------
     * 闪避（侧后跳 + 无敌帧）
     * ------------------------------------------------------------------------ */
    _updateDodge: function (dt) {
      if (this.dodgeTimer <= 0) return;
      this.dodgeTimer -= dt;
      this.dodgeElapsed += dt;
      this.invuln = (this.dodgeElapsed >= C.dodge.invulnStart && this.dodgeElapsed <= C.dodge.invulnEnd);
      if (this.dodgeTimer > 0) {
        var step = this.dodgeSpeed * dt;
        this.position.x += this.dodgeDir.x * step;
        this.position.z += this.dodgeDir.z * step;
      }
      if (this.dodgeTimer <= 0) {
        this.dodgeTimer = 0;
        this.invuln = false;
        if (this.state === 'dodge') this.state = 'idle';
      }
    },

    _startDodge: function (opponent) {
      if (this.stamina < C.stamina.dodgeCost) return false;
      if (!this.spendStamina(C.stamina.dodgeCost)) return false;
      this.dodgeTimer = C.dodge.duration;
      this.dodgeElapsed = 0;
      this.invuln = false;
      this.state = 'dodge';
      this.moveInst = null;
      /* 后跳方向：远离对手（2.5D 主要沿 x 后撤，少量 z 修正） */
      var dx = this.position.x - opponent.position.x;
      var dz = this.position.z - opponent.position.z;
      var len = Math.sqrt(dx * dx + dz * dz);
      if (len < 1e-4) { dx = -this.facing; dz = 0; len = 1; }
      var dist = C.dodge.distance * (C.dodge.direction.back || 0.75);
      this.dodgeDir = { x: dx / len, z: (dz / len) * 0.5 };
      this.dodgeSpeed = dist / C.dodge.duration;
      this.anim('run', { fade: 0.06 });
      if (GAME.Audio) GAME.Audio.play('step');
      return true;
    },

    /* ---------------------------------------------------------------------------
     * AI：反应门控 → 决策 → 执行
     * ------------------------------------------------------------------------ */
    _ai: function (dt, opponent, combat, arena) {
      if (!opponent) { this.aiState = 'patrol'; this.distance = 0; return; }
      var d = this._dist(opponent, combat);
      this.distance = d;
      if (this.decideTimer > 0) this.decideTimer -= dt;

      /* 反应式防御优先（观察对手重招起手），仍受反应延迟门控 */
      if (this._reactiveDefence(opponent, d, dt)) return;

      /* 未到下一次决策时间：只持续执行当前意图 */
      if (this.decideTimer > 0) { this._execute(opponent, d, arena); return; }

      this._decide(d, opponent);
      this._execute(opponent, d, arena);
    },

    /* 反应式防御：对手重招起手且进入射程时，掷骰格挡 / 闪避 */
    _reactiveDefence: function (opponent, d, dt) {
      var omi = opponent.moveInst;
      var relevant = omi && omi.phase === 'startup' && omi.move && this._isThreat(omi);
      if (!relevant) { this._reactKey = null; this._reactAccum = 0; this._reacted = false; return false; }

      var reach = (omi.move.range || 8) * 1.25 + 1.0;
      if (d > reach) return false;

      /* 同一段起手只评估一次 */
      if (this._reactKey !== omi) { this._reactKey = omi; this._reactAccum = 0; this._reacted = false; }
      this._reactAccum += dt;
      if (this._reacted) return (this.blocking || this.dodgeTimer > 0);

      /* 必须“看见”起手一段时间后才可能反应（difficulty.reaction 决定） */
      if (this._reactAccum < this.reactionTime * 0.6) return false;
      this._reacted = true;

      var guardRate = (this.ai && this.ai.guardRate) || 0;
      var dodgeRate = (this.ai && this.ai.dodgeRate) || 0;
      var roll = Math.random();

      if (roll < dodgeRate && this.stamina >= C.stamina.dodgeCost) {
        if (this._startDodge(opponent)) { this.aiState = 'retreat'; return true; }
      } else if (roll < dodgeRate + guardRate && this.stamina > 0) {
        this.setBlocking(true);
        this.guardTimer = AICFG.states.guard.duration;
        this.aiState = 'guard';
        return true;
      }
      return false;
    },

    _isThreat: function (omi) {
      /* 注意：动作 key 在 moveInst 上（Combat.createMove 写入 mi.key），
       * 而非动作数据 C.moves[key] 上，二者不可混用。 */
      var k = omi.isUltimate ? 'ultimate' : omi.key;
      return (k === 'heavy' || k === 'skill' || k === 'ultimate' || k === 'tail' || k === 'charge');
    },

    /* 决策：选择下一个 aiState，并在合适时发起攻击 */
    _decide: function (d, opponent) {
      var mistake = Math.random() < this.mistakeRate;
      var hpFrac = this.hp / this.maxHp;
      var stFrac = this.stamina / this.maxStamina;

      /* 决策延迟：反应时间 + 误判 + 被压制时的迟滞 */
      var delay = this.reactionTime;
      if (mistake) delay *= U.rand(1.5, 2.2);
      if (this.pressTimer > 0) delay *= 1.3;

      /* 必杀技优先（能量满 + 距离合适 + 未误判） */
      if (this.energy >= C.energy.ultimateReadyAt && !mistake && this._ultDistanceOk(d)) {
        if (this.attack('ultimate')) { this.decideTimer = delay; return; }
      }

      /* 后撤：低血 / 低耐力 / 被连击压制 */
      if ((hpFrac < 0.30 && Math.random() < 0.75) ||
          (stFrac < 0.20 && Math.random() < 0.60) ||
          this.pressTimer > 0) {
        this.aiState = 'retreat';
        this.decideTimer = delay;
        return;
      }

      var range = this._classifyRange(d);
      var prefer = (this.ai && this.ai.prefer) || 'mid';

      if (range === 'close') {
        /* 近身 → 撕咬 3 连 */
        this.aiState = 'combat';
        if (this.attackCool <= 0 && !this.moveInst && this._tryBiteCombo(opponent, d)) {
          this.decideTimer = delay;
          return;
        }
      } else if (range === 'mid') {
        this.aiState = 'combat';
        var acted = false;
        if (this.attackCool <= 0 && !this.moveInst) {
          /* 尾击：tank 偏好，fast 较少 */
          var pTail = (prefer === 'mid' || this.style === 'tank') ? 0.65 : 0.35;
          var tailReach = this._moveRange('tail', opponent);
          if (d <= tailReach && Math.random() < pTail) acted = this.attack('tail');
          /* 冲撞（中远距离突进） */
          if (!acted && this._canCharge(d, opponent)) {
            var pCharge = (this.style === 'tank') ? 0.40 : 0.25;
            if (Math.random() < pCharge) acted = this.attack('charge');
          }
          /* fast：更愿意贴近到 close 再撕咬 */
          if (!acted && (prefer === 'close' || this.style === 'fast') && Math.random() < 0.6) {
            this.aiState = 'approach';
          }
        }
      } else {
        /* 远距 → 冲撞或接近 */
        this.aiState = 'approach';
        if (this.attackCool <= 0 && !this.moveInst && this._canCharge(d, opponent) && Math.random() < 0.5) {
          this.attack('charge');
        }
      }

      /* 误判挥空：距离/时机不对也出招，形成可见的“挥空” */
      if (mistake && this.attackCool <= 0 && !this.moveInst && Math.random() < 0.5) {
        this.attack(Math.random() < 0.6 ? 'bite' : 'tail');
      }

      this.decideTimer = delay;
    },

    /* 执行：依据当前 aiState 设定移动速度（2.5D 沿 x 轴） */
    _execute: function (opponent, d, arena) {
      if (this.dead || this.stunned || this.dodgeTimer > 0 || this.blocking || this.moveInst) {
        this.vel.x = 0; this.vel.z = 0; return;
      }
      var R = AICFG.ranges;
      var cfg = AICFG.states;
      var toX = U.sign(opponent.position.x - this.position.x) || this.facing;
      var base = BASE_MOVE_SPEED * this.moveSpeed * (this.def.speed || 1);
      var sp = 0, dir = toX;

      switch (this.aiState) {
        case 'patrol':
          if (!this.patrolDir) this.patrolDir = Math.random() < 0.5 ? -1 : 1;
          sp = base * cfg.patrol.speed;
          dir = this.patrolDir;
          if (this.position.x > arena.width / 2 - 6) this.patrolDir = -1;
          if (this.position.x < -arena.width / 2 + 6) this.patrolDir = 1;
          break;
        case 'approach':
          sp = base * cfg.approach.speed;
          if (d <= R.close) sp = 0;                 // 逼近到近身距离即停
          dir = toX;
          break;
        case 'combat':
          var ideal = (this.style === 'tank') ? R.mid * 0.8 : R.close * 0.9;
          if (d > ideal + 1.2) { sp = base * cfg.combat.speed; dir = toX; }
          else if (d < ideal - 1.5) { sp = base * cfg.combat.speed * 0.8; dir = -toX; }
          else sp = 0;
          break;
        case 'retreat':
          sp = base * cfg.approach.speed * 0.9;
          dir = -toX;
          break;
        default:
          sp = 0;
      }

      this.vel.x = dir * sp;
      this.vel.z = 0;

      /* 状态（供 UI / 调试） */
      if (sp <= 0.01) this.state = 'idle';
      else if (sp < base * 0.6) this.state = 'walk';
      else this.state = 'run';
    },

    /* 撕咬连击：命中后可在连击窗口内接下一段（最多 bite.comboMax 段） */
    _tryBiteCombo: function (opponent, d) {
      if (this.attackCool > 0 || this.moveInst) return false;
      var biteMax = (C.moves.bite && C.moves.bite.comboMax) || 3;
      var chaining = (this.comboHits > 0 && this.comboTimer > 0 && this.biteChain < biteMax);
      var rate = (this.ai && this.ai.comboRate) || 0.5;
      var chance = chaining ? (0.55 + rate * 0.40) : (0.35 + rate * 0.55);
      if (chaining || Math.random() < chance) {
        if (this.attack('bite')) {
          this.biteChain = chaining ? (this.biteChain + 1) : 1;
          return true;
        }
      }
      return false;
    },

    /* ---------------------------------------------------------------------------
     * 距离 / 射程辅助（与 Combat.inArc 的范围修正保持口径一致）
     * ------------------------------------------------------------------------ */
    _dist: function (opponent, combat) {
      if (combat && combat.distance) return combat.distance(this, opponent);
      var dx = this.position.x - opponent.position.x;
      var dz = this.position.z - opponent.position.z;
      return Math.sqrt(dx * dx + dz * dz);
    },
    _moveRange: function (key, opponent) {
      var m = C.moves[key];
      if (!m) return 0;
      var ra = (this.def.radius || 3.6) + ((opponent && opponent.def && opponent.def.radius) || 3.2);
      return m.range * (1 + (ra - 6.8) * 0.06);
    },
    _classifyRange: function (d) {
      var R = AICFG.ranges;
      if (d <= R.close) return 'close';
      if (d <= R.mid) return 'mid';
      return 'far';
    },
    _canCharge: function (d, opponent) {
      var reach = this._moveRange('charge', opponent);
      return (d <= reach && d > AICFG.ranges.close * 0.7);
    },
    _ultDistanceOk: function (d) {
      /* tank 的必杀沿用 charge（长距离），fast 沿用 bite（近身） */
      return (this.style === 'tank') ? (d <= 20) : (d <= 12);
    },

    /* ---------------------------------------------------------------------------
     * 物理积分：主动速度 + 击退速度 + 重力 + 地面摩擦 + 边界钳制
     * ------------------------------------------------------------------------ */
    _integratePhysics: function (dt, arena, frozenOnly) {
      arena = arena || CONFIG.arena;
      var g = (arena.gravity !== undefined) ? arena.gravity : CONFIG.arena.gravity;
      var kb = this.knockbackVel || (this.knockbackVel = { x: 0, y: 0, z: 0 });

      /* 主动位移 */
      if (!frozenOnly) {
        var dash = this.moveInst && this.moveInst.move && this.moveInst.move.dashSpeed;
        if (dash) {
          /* 冲撞：沿朝向突进（速度受难度 / 单位速度 / 耐力惩罚影响） */
          var ds = dash * (this.moveInst.speedScale || 1) * this.moveSpeed * (this.def.speed || 1);
          this.position.x += this.facing * ds * dt;
        } else if (!this.moveInst) {
          this.position.x += this.vel.x * dt;
          this.position.z += this.vel.z * dt;
        }
      }

      /* 击退速度积分 + 重力 */
      this.position.x += kb.x * dt;
      this.position.y += kb.y * dt;
      this.position.z += kb.z * dt;
      kb.y += g * dt;

      /* 地面碰撞 */
      if (this.position.y <= 0) {
        this.position.y = 0;
        if (kb.y < 0) kb.y = 0;
        this.grounded = true;
      } else {
        this.grounded = false;
      }

      /* 水平阻尼：着地走 groundFriction，空中走 airDrag */
      if (this.grounded) {
        var f = Math.pow(arena.groundFriction, dt * KB_FRICTION_FPS);
        kb.x *= f; kb.z *= f;
        if (Math.abs(kb.x) < 0.05) kb.x = 0;
        if (Math.abs(kb.z) < 0.05) kb.z = 0;
      } else {
        var ad = Math.pow(1 - (arena.airDrag || 0), dt);
        kb.x *= ad; kb.z *= ad;
      }

      /* 2.5D：非闪避时缓慢回到中线 */
      if (this.dodgeTimer <= 0) this.position.z = U.damp(this.position.z, 0, 1.5, dt);

      /* 边界钳制（按单位半径内缩） */
      var inset = (this.def.radius || 3.6) * 0.5;
      var hw = arena.width * 0.5 - inset;
      var hd = arena.depth * 0.5 - inset;
      this.position.x = U.clamp(this.position.x, -hw, hw);
      this.position.z = U.clamp(this.position.z, -hd, hd);
    },

    /* 防重叠：与对手保持 arena.minSeparation；怪兽只承担“半量”修正
     * （玩家承担全量），残差留待下一帧继续分离。 */
    _resolveSeparation: function (opponent) {
      if (!opponent) return;
      var dx = this.position.x - opponent.position.x;
      var dz = this.position.z - opponent.position.z;
      var d = Math.sqrt(dx * dx + dz * dz);
      var minSep = CONFIG.arena.minSeparation;
      if (d >= minSep) return;
      if (d < 1e-4) { dx = -this.facing; dz = 0; d = 1; }
      var corr = (minSep - d) * 0.5;              // 半量修正
      this.position.x += (dx / d) * corr;
      this.position.z += (dz / d) * corr;
      /* 修正后再次钳制边界 */
      var inset = (this.def.radius || 3.6) * 0.5;
      this.position.x = U.clamp(this.position.x, -CONFIG.arena.width * 0.5 + inset, CONFIG.arena.width * 0.5 - inset);
      this.position.z = U.clamp(this.position.z, -CONFIG.arena.depth * 0.5 + inset, CONFIG.arena.depth * 0.5 - inset);
    },

    /* 朝向：面朝对手（2.5D 仅需 0 / PI） */
    _face: function (opponent) {
      if (!opponent) return;
      var dx = opponent.position.x - this.position.x;
      if (Math.abs(dx) > 0.05) {
        this.facing = dx >= 0 ? 1 : -1;
        this.yaw = this.facing > 0 ? 0 : Math.PI;
      }
    },

    /* 节点同步：位置 + 旋转（怪兽模型默认朝 +Z，需旋转对齐 yaw） */
    _syncRoot: function () {
      if (!this.root) return;
      if (this.root.position && this.root.position.set) {
        this.root.position.set(this.position.x, this.position.y, this.position.z);
      }
      this.root.rotation.y = MODEL_FORWARD_Y - this.yaw;
    },

    /* 材质反馈：受击闪白逐帧衰减；发光材质呼吸脉动 */
    _updateMaterials: function (dt) {
      var mdl = this.model;
      if (!mdl) return;
      var HF = (CONFIG.artConfig && CONFIG.artConfig.hitFlash) || {};
      if (this._flashT > 0) this._flashT = Math.max(0, this._flashT - dt * (HF.decay || 5.5));
      var k = this._flashT > 0 ? this._flashT / (HF.duration || 0.18) : 0;
      if (mdl.bodyMaterials && GAME.Models && GAME.Models.flashBody) {
        GAME.Models.flashBody(mdl.bodyMaterials, U.clamp(k, 0, 1));
      }
      if (mdl.glowMaterials && GAME.Models && GAME.Models.pulseGlow) {
        this._matT = (this._matT || 0) + dt;
        GAME.Models.pulseGlow(mdl.glowMaterials, this._matT);
      }
    },

    /* ---------------------------------------------------------------------------
     * 动画选择
     * ------------------------------------------------------------------------ */
    _updateAnim: function () {
      var clip;
      if (this.dead) clip = 'death';
      else if (this.roarTimer > 0) clip = 'roar';
      else if (this.stunned) clip = 'hit';
      else if (this.dodgeTimer > 0) clip = 'run';
      else if (this.blocking) clip = 'block';
      else if (this.moveInst) clip = (this.moveInst.move && this.moveInst.move.animation) || 'idle';
      else {
        switch (this.aiState) {
          case 'approach': clip = 'walk'; break;
          case 'retreat': clip = 'run'; break;
          default: clip = 'idle';
        }
      }
      var once = (this.dead || this.stunned);
      this.anim(clip, { once: once, clamp: once, fade: clip === 'hit' ? 0.07 : 0.2 });
    },

    /* 偶尔咆哮：仅在 idle/patrol 且冷却结束时节流触发 */
    _maybeRoar: function () {
      if (this.dead || this.stunned || this.blocking || this.dodgeTimer > 0 || this.moveInst) return;
      if (this.roarTimer > 0 || this.roarCool > 0) return;
      if (this.aiState === 'patrol' || this.state === 'idle' || this.state === 'walk') {
        this.anim('roar', { once: true, fade: 0.2 });
        this.roarTimer = AICFG.states.roar.duration;
        this.roarCool = AICFG.states.roar.cooldown;
        if (GAME.Audio) GAME.Audio.play('roar');
      }
    },

    /* 状态变化时广播 enemy:state */
    _emitState: function () {
      var sig = this.state + '|' + this.aiState + '|' + (this.dead ? 1 : 0);
      if (sig === this._lastStateSig) return;
      this._lastStateSig = sig;
      U.bus.emit('enemy:state', {
        unit: this,
        state: this.state,
        aiState: this.aiState,
        hp: this.hp,
        stamina: this.stamina,
        energy: this.energy,
        difficulty: this.difficulty && this.difficulty.name
      });
    }
  };

  GAME.Enemy = Enemy;

})(typeof window !== 'undefined' ? window : this);
