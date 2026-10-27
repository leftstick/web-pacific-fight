/* =============================================================================
 * combat.js  ──  战斗判定 / 伤害 / 硬直 / 击退 / 眩晕 / 场景破坏
 * 依赖：config.js（GAME.CONFIG / GAME.U）
 * 加载方式：普通 <script>，挂载 window.GAME.Combat
 *
 * ---------------------------------------------------------------------------
 * 【单位契约 Unit Contract】player.js / enemy.js 需实现以下字段与方法，
 *   Combat 只操作这些接口，不关心具体是机甲还是怪兽：
 *   unit.id / unit.def / unit.faction / unit.style
 *   unit.position  : THREE.Vector3(世界坐标，中心点在地上)
 *   unit.yaw       : 朝向弧度（0 = +X 方向）
 *   unit.facing    : +1 面向右 / -1 面向左
 *   unit.hp / maxHp / stamina / maxStamina / energy / maxEnergy / stun / maxStun
 *   unit.state     : 'idle'|'walk'|'run'|'attack'|'dodge'|'block'|'hit'|'stun'|'dead'|'ultimate'
 *   unit.blocking  : bool   unit.invuln : bool   unit.stunned : bool   unit.dead : bool
 *   unit.frozen    : number (受击停顿剩余秒数，Combat 会写入)
 *   unit.knockbackVel : {x,y,z} (Combat 写入，单位自行积分应用)
 *   unit.comboHits / unit.comboTimer
 *   unit.attack(key)        开始一个动作
 *   unit.takeHit(result)    受击回调（播放受击动画、停止当前动作等）
 *   unit.getHitCenter() -> THREE.Vector3（受击判定中心，默认胸口高度）
 *   unit.spendStamina(n) / unit.spendEnergy(n) -> bool
 *   unit.setBlocking(bool)  进入/退出格挡
 * ---------------------------------------------------------------------------
 * ========================================================================== */
(function (global) {
  'use strict';

  var GAME = global.GAME;
  var U = GAME.U;
  var CONFIG = GAME.CONFIG;
  var C = CONFIG.combat;
  var MOVE_KEYS = Object.keys(C.moves);

  /* 全局顿帧状态（命中瞬间整个世界短暂减速，制造打击重量感） */
  var freezeTimer = 0;
  var freezeDuration = 0;
  var freezeScale = 0.06;       /* 顿帧期间的时间缩放（必杀可更低） */

  /* 手感调参表（缺省为空对象，保证旧配置也能运行） */
  function FEEL() { return (C && C.feel) || {}; }

  /* 按帧数配置换算顿帧秒数；未配置时回退到旧 timing 字段 */
  function hitStopSeconds(key, fallback) {
    var f = FEEL().hitStop;
    if (!f || f.enabled === false) return fallback || 0;
    var frames = (f.frames || {})[key];
    if (typeof frames !== 'number') return fallback || 0;
    var fps = f.fps || 60;
    return frames / fps;
  }

  /* 输入缓冲窗口（帧 → 秒） */
  function bufferSeconds(key) {
    var b = FEEL().buffer;
    if (!b || b.enabled === false) return 0;
    var frames = (b.frames || {})[key];
    if (typeof frames !== 'number') return 0;
    return frames / (b.fps || 60);
  }

  /* 真实时间（秒）：完美格挡窗口需用真实时间，避免被顿帧拖慢 */
  function nowSec() {
    return ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) / 1000;
  }

  /* 动作 key → 顿帧档位（怪兽动作没有独立档位，映射到最接近的机甲档位） */
  var HITSTOP_ALIAS = { bite: 'light', tail: 'skill', charge: 'heavy', roar: 'skill' };

  var Combat = {
    /* 由 main.js 注入 */
    physics: null,
    renderer: null,
    units: [],
    destructibles: [],        // 可破坏建筑 {object3D, position, radius, hp, maxHp, def}
    stats: null,

    /* ---------------- 初始化 ---------------- */
    init: function (opts) {
      opts = opts || {};
      this.physics = opts.physics || null;
      this.renderer = opts.renderer || null;
      this.units = opts.units || [];
      this.destructibles = opts.destructibles || [];
      this.stats = { damageDealt: 0, damageTaken: 0, hits: 0, blocked: 0, maxCombo: 0, buildingsDestroyed: 0, duration: 0, ultimateUsed: 0 };
      freezeTimer = 0; freezeDuration = 0; freezeScale = 0.06;
      return this;
    },

    /* ---------------- 顿帧 / 时间缩放 ---------------- */
    hitstop: function (seconds, scale) {
      if (FEEL().hitStop && FEEL().hitStop.enabled === false) return;
      if (seconds > freezeTimer) { freezeTimer = seconds; freezeDuration = Math.max(seconds, freezeDuration); }
      freezeTimer = Math.max(freezeTimer, seconds);
      /* 减速强度：必杀/击杀用更深慢动作（0.04），其余默认 0.06 */
      if (scale && scale < freezeScale) freezeScale = scale;
    },
    /* main.js 用它乘到 dt 上 */
    timeScale: function () { return freezeTimer > 0 ? freezeScale : 1.0; },
    isFrozen: function () { return freezeTimer > 0; },
    /* 调试面板用：剩余顿帧秒数 */
    freezeRemain: function () { return freezeTimer; },

    /* 手感调参对外接口（player.js 复用同一套换算规则，避免数值不一致） */
    hitStopSeconds: hitStopSeconds,
    bufferSeconds: bufferSeconds,
    feel: function () { return FEEL(); },
    nowSec: nowSec,

    /* 命中顿帧时长：优先按 feel.hitStop.frames 换算，未配置时回退旧 timing */
    _resolveHitstop: function (move, killed, perfect) {
      var key = move.key;
      /* 击杀统一使用必杀级顿帧，强调终结感 */
      if (killed) key = 'ultimate';
      else if (HITSTOP_ALIAS[key]) key = HITSTOP_ALIAS[key];
      var fallback = (move.key === 'ultimate') ? C.timing.hitstopUltimate
        : (move.key === 'heavy' || move.key === 'charge') ? C.timing.hitstopHeavy
          : C.timing.hitstop;
      var seconds = hitStopSeconds(key, fallback);
      /* 完美格挡额外追加强调顿帧 */
      if (perfect) {
        var pg = FEEL().perfectGuard || {};
        seconds = Math.max(seconds, pg.hitstop || 0);
      }
      return seconds;
    },

    /* 完美格挡判定：格挡键刚按下 feel.perfectGuard.window 秒内接住攻击 */
    isPerfectGuard: function (defender) {
      var pg = FEEL().perfectGuard;
      if (!pg || pg.enabled === false) return false;
      if (!defender || !defender.blocking) return false;
      var pressed = defender._blockPressT;
      if (typeof pressed !== 'number') return false;
      var dt = nowSec() - pressed;
      return dt >= 0 && dt <= (pg.window || 0.18);
    },

    /* ---------------- 动作生命周期 ---------------- */
    /* 返回一个动作实例，unit 持有并每帧交给 updateMove */
    createMove: function (unit, key) {
      var move = C.moves[key];
      if (!move) { console.warn('[Combat] 未定义动作:', key); return null; }
      return {
        key: key,
        move: move,
        t: 0,
        phase: 'startup',            // startup → active → recovery → done
        hasHit: false,
        hitTargets: [],
        speedScale: unit.speedScale || 1 // 受耐力惩罚后的动作速度
      };
    },

    /* 动作推进；返回事件：'active-enter' | 'done' | null */
    updateMove: function (unit, dt) {
      var mi = unit.moveInst;
      if (!mi) return null;
      var move = mi.move;
      var scale = mi.speedScale || 1;
      mi.t += dt * scale;
      var evt = null;
      if (mi.phase === 'startup' && mi.t >= move.startup) {
        mi.phase = 'active'; mi.t = 0; evt = 'active-enter';
      } else if (mi.phase === 'active' && mi.t >= move.active) {
        mi.phase = 'recovery'; mi.t = 0;
      } else if (mi.phase === 'recovery' && mi.t >= move.recovery) {
        mi.phase = 'done'; evt = 'done';
      }
      return evt;
    },
    /* 动作是否可以衔接下一段（轻攻击连击） */
    canCancel: function (unit) {
      var mi = unit.moveInst;
      if (!mi) return true;
      if (mi.phase === 'recovery') return true;
      /* 已命中的轻攻击允许在 active 后半段接下一段 */
      if (mi.phase === 'active' && mi.hitCount > 0 && mi.currIndex >= mi.maxCombo - 1) return true;
      return false;
    },

    /* ---------------- 距离 / 朝向 / 命中判定 ---------------- */
    distance: function (a, b) {
      var dx = a.position.x - b.position.x;
      var dz = a.position.z - b.position.z;
      return Math.sqrt(dx * dx + dz * dz);
    },
    /* 命中落在受击者的哪个方位：front / side / back
       （按受击者朝向判定：受击者面向攻击者=正面，侧对=侧面，背对=背面暴击） */
    facingOf: function (attacker, target) {
      var dx = attacker.position.x - target.position.x;   // 受击者 → 攻击者
      var dz = attacker.position.z - target.position.z;
      var toAttacker = Math.atan2(dz, dx);
      var rel = Math.abs(U.angleDelta(target.yaw, toAttacker)) * 180 / Math.PI;
      if (rel <= C.facing.frontAngle) return 'front';
      if (rel <= C.facing.sideAngle) return 'side';
      return 'back';
    },
    /* 命中高度部位：high(高空/头部) / mid(躯干) / low(腿部) */
    partOf: function (attacker, target) {
      var ay = attacker.getHitCenter ? attacker.getHitCenter().y : attacker.position.y;
      var th = target.getHitCenter ? target.getHitCenter().y : target.position.y;
      if (th > ay + 1.6) return 'high';
      if (th < ay - 1.6) return 'low';
      return 'mid';
    },
    /* 扇形 + 距离判定 */
    inArc: function (attacker, target, move) {
      var range = move.range * (1 + (attacker.def.radius + target.def.radius - 6.8) * 0.06);
      var d = this.distance(attacker, target);
      if (d > range) return false;
      var dx = target.position.x - attacker.position.x;
      var dz = target.position.z - attacker.position.z;
      var toTarget = Math.atan2(dz, dx);
      var rel = Math.abs(U.angleDelta(attacker.yaw, toTarget)) * 180 / Math.PI;
      return rel <= move.arc * 0.5;
    },

    /* ---------------- 攻击结算：主动方每帧调用 ---------------- */
    /* 在 active 判定帧内检测所有敌对单位，命中则结算一次 */
    resolveAttack: function (attacker, targets, onHit, opts) {
      var mi = attacker.moveInst;
      if (!mi || mi.phase !== 'active') return null;
      var move = mi.move;
      var result = null;
      for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (!t || t.dead || t === attacker) continue;
        if (mi.hitTargets.indexOf(t.id) >= 0) continue;   // 同一动作对同一目标只命中一次
        if (!this.inArc(attacker, t, move)) continue;
        mi.hitTargets.push(t.id);
        result = this.applyHit(attacker, t, move, mi, opts);
        if (onHit) onHit(t, result);
      }
      return result;
    },

    /* 核心伤害计算 + 状态结算
     * opts（可选，P0 必杀分段 / 演出控制）：
     *   damageScale / knockbackScale  伤害与击退倍率
     *   lethal                        默认 true；false 时血量下限 1，不会击杀
     *   cinematic                     强制受击反应、跳过眩晕（用于必杀多段）
     *   impactLevel                   命中特效等级覆盖
     *   zoom                          是否触发必杀镜头缩放（默认 true）
     */
    applyHit: function (attacker, defender, move, moveInst, opts) {
      opts = opts || {};
      var facing = this.facingOf(attacker, defender);
      var part = this.partOf(attacker, defender);
      var blocked = false;
      var broken = false;
      var perfect = false;

      /* 格挡判定：正面格挡且动作可被格挡，且攻击者不在目标身后 */
      if (defender.blocking && facing === 'front' && move.blockable !== false && !move.unblockable) {
        var pg = FEEL().perfectGuard;
        /* 完美格挡：格挡键刚按下的窗口内接住攻击（不适用于破防重招） */
        if (pg && pg.enabled !== false && !move.breakGuard && this.isPerfectGuard(defender)) {
          perfect = true;
          blocked = true;
        } else if (move.breakGuard && defender.stamina < C.stamina.dodgeCost) {
          broken = true;                                  // 耐力不足被重击破防
        } else if (move.breakGuard && Math.random() < 0.35) {
          broken = true;
        } else {
          blocked = true;
        }
      }
      /* 无敌帧（闪避）完全免伤 */
      if (defender.invuln) {
        var dodged = {
          damage: 0, blocked: false, broken: false, dodged: true, facing: facing, part: part,
          killed: false, knockback: 0, stun: 0, hitstop: 0, move: move.key, critical: false
        };
        if (global.GAME.Audio) GAME.Audio.play('uiMove');
        return dodged;
      }

      /* --- 伤害公式 --- */
      var dmg = move.damage;
      dmg *= (attacker.def.attack || 1);
      dmg *= C.facing[facing];                          // 正面/侧面/背面系数
      dmg *= C.part[part];
      dmg *= (attacker.comboDamageBonus || 1);          // 连击加成
      dmg /= (defender.def.defense || 1);               // 防御力
      if (attacker.aiDamageScale) dmg *= attacker.aiDamageScale;   // AI 难度伤害系数
      if (opts.damageScale !== undefined) dmg *= opts.damageScale; // 必杀分段倍率
      if (blocked) dmg *= (1 - C.block.damageReduction);
      if (perfect) {
        var pgCfg = FEEL().perfectGuard || {};
        dmg *= (1 - (pgCfg.damageReduction !== undefined ? pgCfg.damageReduction : 0.92));
      }

      var stun = move.stun * (blocked ? (1 - C.block.stunReduction) : 1);
      stun *= (1 - (defender.def.stunResist || 0));
      stun = Math.round(stun);

      var kbScale = (opts.knockbackScale !== undefined) ? opts.knockbackScale : 1;
      var kb = move.knockback * (blocked ? (1 - C.block.knockbackReduction) : 1) * kbScale;
      var killed = false;

      /* --- 资源扣除（装甲先扛，溢出扣血）--- */
      var armorBroken = false;
      var armorDamage = 0;
      if (defender.hp > 0) {
        var remaining = dmg;
        if (defender.maxArmor > 0 && defender.armor > 0) {
          armorDamage = Math.min(defender.armor, remaining);
          defender.armor = Math.max(0, defender.armor - armorDamage);
          remaining -= armorDamage;
          if (defender.armor <= 0 && armorDamage > 0) armorBroken = true;
        }
        if (remaining > 0) {
          defender.hp = Math.max(0, defender.hp - remaining);
          if (defender.hp <= 0) {
            /* P0：必杀前两段只打空血条，留 1 点血给终结段 */
            if (opts.lethal === false) defender.hp = 1;
            else killed = true;
          }
        }
      }

      /* --- 受击方能量与耐力 --- */
      if (!killed) {
        defender.addEnergy(C.energy.gainOnHitTaken * (blocked ? 0.6 : 1));
        if (blocked) {
          defender.spendStamina(move.damage * 0.22);
          if (broken) defender.spendStamina(defender.stamina);      // 破防清空耐力
        }
      }
      attacker.addEnergy(move.energyGain || 0);
      attacker.addComboHit(blocked ? 0 : 1);

      /* --- 眩晕积累 --- */
      var stunned = false;
      if (!blocked && stun > 0 && !opts.cinematic) stunned = this.addStun(defender, stun);

      /* 接触点：从受击者胸口中心偏向攻击者一侧的表面，火花 / 伤害数字都锚在这里 */
      var hc = defender.getHitCenter ? defender.getHitCenter() : defender.position;
      var contact = { x: hc.x, y: hc.y, z: hc.z };
      if (attacker && attacker.position && defender.position) {
        var cdx = attacker.position.x - defender.position.x;
        var cdz = attacker.position.z - defender.position.z;
        var clen = Math.sqrt(cdx * cdx + cdz * cdz) || 1;
        var surf = ((defender.def && defender.def.radius) || 3.2) * 0.55;
        contact.x += (cdx / clen) * surf;
        contact.z += (cdz / clen) * surf;
        if (part === 'high') contact.y += 0.8;
        else if (part === 'low') contact.y -= 1.2;
      }

      var result = {
        damage: Math.round(dmg),
        armorDamage: Math.round(armorDamage),
        armorBroken: armorBroken,
        blocked: blocked,
        broken: broken,
        perfect: perfect,
        dodged: false,
        facing: facing,
        part: part,
        critical: facing === 'back',
        killed: killed,
        knockback: kb,
        stun: stun,
        stunnedNow: stunned,
        /* 顿帧：优先按帧数配置换算；完美格挡额外追加强调顿帧 */
        hitstop: this._resolveHitstop(move, killed, perfect),
        move: move.key,
        cinematic: !!opts.cinematic,
        lethal: opts.lethal !== false,
        attacker: attacker,
        defender: defender,
        position: contact
      };

      /* --- 击退方向：从攻击者指向受击者 --- */
      var kdx = defender.position.x - attacker.position.x;
      var kdz = defender.position.z - attacker.position.z;
      var len = Math.sqrt(kdx * kdx + kdz * kdz) || 1;
      result.knockDir = { x: kdx / len, y: 0, z: kdz / len };

      /* --- 装甲破损视觉分层（纯视觉）：血量跨过 75/50/25% 阈值时局部装甲碎片脱落 --- */
      if (!blocked && defender.hp > 0) {
        var hpRatio = defender.hp / (defender.maxHp || 1);
        var stage = hpRatio > 0.75 ? 0 : (hpRatio > 0.5 ? 1 : (hpRatio > 0.25 ? 2 : 3));
        if (stage > (defender._debrisStage || 0)) {
          defender._debrisStage = stage;
          if (this.renderer && this.renderer.spawnArmorDebris) {
            this.renderer.spawnArmorDebris(result.position, defender);
          }
        }
      }

      /* --- 统计 --- */
      if (attacker === this.playerUnit) {
        this.stats.damageDealt += result.damage;
        var combo = (typeof attacker.comboHits === 'number') ? attacker.comboHits : 0;
        if (combo > this.stats.maxCombo) this.stats.maxCombo = combo;
      }
      if (defender === this.playerUnit) this.stats.damageTaken += result.damage;
      this.stats.hits++; if (blocked) this.stats.blocked++;

      /* --- 反馈：顿帧 / 震动 / 音效 / 特效 --- */
      /* 必杀/击杀：更深慢动作（0.04），强化重击电影感 */
      var isUlt = (move.key === 'ultimate') || killed;
      this.hitstop(result.hitstop, isUlt ? 0.055 : 0.07);
      var shakeOn = !(FEEL().shake && FEEL().shake.enabled === false);
      if (shakeOn && this.renderer && this.renderer.cameraShake) {
        /* 分级镜头震动（1 轻 / 2 重·技能 / 3 必杀；完美格挡额外加强） */
        if (perfect) this.renderer.cameraShake(2);
        else {
          var lv = blocked ? 1 : (move.key === 'ultimate' ? 3 : (move.key === 'heavy' || move.key === 'skill' || move.key === 'tail' || move.key === 'charge' ? 2 : 1));
          this.renderer.cameraShake(lv);
        }
      }
      if (this.renderer && this.renderer.spawnImpact) {
        /* 动作专属粒子组合：perfect > block > 动作 key */
        var comboKey = perfect ? 'perfect'
          : (blocked ? 'block' : (C.moves[move.key] ? move.key : 'light'));
        var impactLv = (opts.impactLevel !== undefined) ? opts.impactLevel
          : (blocked ? 1 : (move.key === 'ultimate' ? 3 : (move.key === 'light' ? 2 : 2)));
        this.renderer.spawnImpact(
          result.position,
          impactLv,
          result.facing,
          { combo: comboKey, perfect: perfect, broken: broken }
        );
      }
      if (global.GAME.Audio) GAME.Audio.play(blocked ? 'block' : 'hit', {});
      if (move.key === 'ultimate' && opts.zoom !== false && this.renderer && this.renderer.zoomPunch) this.renderer.zoomPunch();
      if (move.breakGuard && shakeOn && this.renderer && this.renderer.cameraShake) {
        this.renderer.cameraShake(2);                          /* 破防 → 2 级震动 */
      }

      /* 手柄震动：重击/技能/必杀命中或玩家受重击时触发 */
      var isHeavy = (move.key === 'heavy' || move.key === 'skill' || move.key === 'charge' || move.key === 'ultimate' || move.key === 'tail');
      var playerInvolved = (attacker === this.playerUnit || defender === this.playerUnit);
      if (isHeavy && playerInvolved && global.GAME.Input && GAME.Input.vibrate) {
        var dur = move.key === 'ultimate' ? 280 : 140;
        var str = move.key === 'ultimate' ? 0.9 : 0.65;
        GAME.Input.vibrate(dur, str, str * 0.5);
      }

      /* --- 装甲破防：碎片飞溅 + 震动 + 事件 --- */
      if (armorBroken) {
        if (shakeOn && this.renderer && this.renderer.cameraShake) this.renderer.cameraShake(2);
        if (this.renderer && this.renderer.spawnImpact) {
          this.renderer.spawnImpact(result.position, 2, result.facing, { combo: 'heavy' });
        }
        if (this.renderer && this.renderer.spawnArmorDebris) {
          this.renderer.spawnArmorDebris(result.position, defender);
        }
        if (global.GAME.Audio) GAME.Audio.play('armorBreak', {});
        U.bus.emit('combat:armor-break', { unit: defender, attacker: attacker });
      }
      /* 完美格挡：通知 UI 弹提示 */
      if (perfect) U.bus.emit('combat:perfect-guard', { unit: defender });

      /* --- 场景破坏：命中点附近的建筑也会受损 --- */
      this.splashDestructibles(result.position, result.damage * (move.key === 'ultimate' ? 1.4 : 0.5), result.knockDir);

      if (result.stunnedNow) {
        U.bus.emit('combat:stun', { unit: defender });
      }
      U.bus.emit('combat:hit', result);

      /* --- 通知受击方 --- */
      defender.takeHit(result);
      if (killed) U.bus.emit('combat:ko', { winner: attacker, loser: defender });

      return result;
    },

    /* 直接伤害（爆炸、场景、环境等无攻击者来源） */
    applyRawDamage: function (target, amount, opts) {
      opts = opts || {};
      if (!target || target.dead || target.invuln) return null;
      var dmg = amount / (target.def.defense || 1);
      if (target.blocking) dmg *= (1 - C.block.damageReduction * 0.6);
      target.hp = Math.max(0, target.hp - dmg);
      var killed = target.hp <= 0;
      var res = {
        damage: Math.round(dmg), blocked: false, broken: false, dodged: false,
        facing: 'side', part: 'mid', critical: false, killed: killed,
        knockback: opts.knockback || 0, stun: opts.stun || 0,
        hitstop: C.timing.hitstop, move: opts.source || 'environment',
        position: target.getHitCenter ? target.getHitCenter().clone() : target.position.clone(),
        knockDir: opts.knockDir || { x: 0, y: 0, z: 0 },
        attacker: null, defender: target
      };
      target.takeHit(res);
      if (killed) U.bus.emit('combat:ko', { winner: null, loser: target });
      return res;
    },

    /* ---------------- 眩晕 ---------------- */
    addStun: function (target, amount) {
      target.stun = Math.min(C.stun.max, target.stun + amount);
      target.stunDecayDelay = C.stun.hitDecayDelay;
      if (target.stun >= C.stun.max) {
        point_applyStun(target, C.stun.duration);
        return true;
      }
      return false;
    },
    applyStun: function (target, duration) { point_applyStun(target, duration); },

    /* ---------------- 单位状态更新（每帧，由 main.js 调用） ---------------- */
    update: function (dt) {
      this.stats.duration += dt;
      /* 顿帧 */
      if (freezeTimer > 0) {
        freezeTimer = Math.max(0, freezeTimer - dt);
        if (freezeTimer === 0) { freezeDuration = 0; freezeScale = 0.06; }
      }
      for (var i = 0; i < this.units.length; i++) {
        var u = this.units[i];
        if (!u) continue;
        /* 眩晕条衰减 */
        if (u.stunDecayDelay > 0) u.stunDecayDelay -= dt;
        else if (u.stun > 0 && !u.stunned) u.stun = Math.max(0, u.stun - C.stun.decayRate * dt);
        /* 连击窗口 */
        if (u.comboTimer > 0) {
          u.comboTimer -= dt;
          if (u.comboTimer <= 0) { u.comboHits = 0; u.comboDamageBonus = 1; }
        }
        /* 受击停顿 */
        if (u.frozen > 0) u.frozen = Math.max(0, u.frozen - dt);
      }
      /* 可破坏建筑缓慢自愈（避免长时间战斗无掩体，可选） */
      for (var b = 0; b < this.destructibles.length; b++) {
        var d = this.destructibles[b];
        if (d.object3D && d.alive === false) continue;
      }
    },

    /* ---------------- 可破坏场景 ---------------- */
    /* 半径范围内的建筑分摊伤害 */
    splashDestructibles: function (position, damage, dir) {
      if (!this.destructibles || !this.destructibles.length) return;
      for (var i = 0; i < this.destructibles.length; i++) {
        var b = this.destructibles[i];
        if (!b.alive) continue;
        var dx = b.position.x - position.x, dz = b.position.z - position.z;
        var d = Math.sqrt(dx * dx + dz * dz);
        if (d > (b.radius + 3.5)) continue;
        var falloff = Math.max(0.25, 1 - d / (b.radius + 3.5));
        this.damageBuilding(b, damage * falloff, { x: dx || (dir ? dir.x : 0), y: 0, z: dz || (dir ? dir.z : 0) });
      }
    },
    /* 建筑受损 → 归零则崩塌（碎片由 renderer/models 生成） */
    damageBuilding: function (building, damage, dir) {
      if (!building.alive) return;
      building.hp -= damage;
      if (building.object3D && building.object3D.material && building.object3D.material.emissive) {
        /* 受损反馈：短暂发红（由 renderer 每帧衰减） */
        building.damageFlash = 1;
      }
      if (building.hp <= 0) {
        building.alive = false;
        building.hp = 0;
        var destroyedPos = building.position.clone ? building.position.clone() : building.position;
        if (this.renderer && this.renderer.collapseBuilding) this.renderer.collapseBuilding(building, dir);
        if (global.GAME.Audio) GAME.Audio.play('explosion');
        if (this.renderer && this.renderer.cameraShake) this.renderer.cameraShake(4);  /* P2：建筑崩塌 → 4 级 */
        /* 爆炸伤害 */
        for (var i = 0; i < this.units.length; i++) {
          var u = this.units[i];
          if (!u || u.dead) continue;
          var dx = u.position.x - destroyedPos.x, dz = u.position.z - destroyedPos.z;
          var d = Math.sqrt(dx * dx + dz * dz);
          if (d < C.destructible.explosionRadius) {
            var f = 1 - d / C.destructible.explosionRadius;
            var len = Math.sqrt(dx * dx + dz * dz) || 1;
            this.applyRawDamage(u, C.destructible.explosionDamage * f, {
              source: 'explosion', knockback: 6 * f, stun: 10 * f,
              knockDir: { x: dx / len, y: 0, z: dz / len }
            });
          }
        }
        this.stats.buildingsDestroyed++;
        U.bus.emit('combat:building-destroyed', building);
      }
    },

    /* ---------------- 便捷查询 ---------------- */
    getUnitById: function (id) {
      for (var i = 0; i < this.units.length; i++) if (this.units[i] && this.units[i].id === id) return this.units[i];
      return null;
    },
    opponentOf: function (unit) {
      for (var i = 0; i < this.units.length; i++) if (this.units[i] && this.units[i].id !== unit.id) return this.units[i];
      return null;
    },
    /* 动作表查询（供 UI 显示技能文案） */
    getMove: function (key) { return C.moves[key]; },
    /* 平衡数值展示用：把攻击动作按单位倍率换算成面板数值 */
    previewDamage: function (unitDef, key) {
      var m = C.moves[key]; if (!m) return 0;
      return Math.round(m.damage * (unitDef.attack || 1));
    }
  };

  /* 眩晕处理：内部函数，写入目标状态并通知其动画 */
  function point_applyStun(target, duration) {
    target.stun = 0;
    target.stunDecayDelay = 0;
    target.stunned = true;
    target.stunTimer = duration;
    target.blocking = false;
    if (target.onStunned) target.onStunned(duration);
    if (target.setStunned) target.setStunned(duration);
    if (global.GAME.Audio) GAME.Audio.play('heavy');
    U.bus.emit('combat:stunned', { unit: target, duration: duration });
  }

  GAME.Combat = Combat;

})(typeof window !== 'undefined' ? window : this);
