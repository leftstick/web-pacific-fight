/* =============================================================================
 * game/ai.js ── 电脑对手控制器
 *  · 与玩家共用同一套 Fighter 输入接口（snapshot / consume / buffered）
 *  · 四档难度：反应延迟 14/12/10/8 帧，进攻频率、防御率、反制率、连段长度
 *  · 不读帧、不完美防御：只在「延迟观测」到的状态上做概率决策
 * ========================================================================== */

const LEVELS = [
  { name: '简单', react: 14, aggro: 0.28, block: 0.32, punish: 0.18, combo: 1, think: 24 },
  { name: '普通', react: 12, aggro: 0.48, block: 0.52, punish: 0.38, combo: 2, think: 18 },
  { name: '困难', react: 10, aggro: 0.68, block: 0.72, punish: 0.62, combo: 3, think: 13 },
  { name: '大师', react: 8,  aggro: 0.84, block: 0.86, punish: 0.82, combo: 4, think: 9 }
];

function rnd(a, b) { return a + Math.random() * (b - a); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

export class AIController {
  /**
   * @param {object} self Fighter
   * @param {object} opp Fighter
   * @param {number} level 0..3
   */
  constructor(self, opp, level = 1) {
    this.self = self;
    this.opp = opp;
    this.level = clamp(level | 0, 0, 3);
    this.cfg = LEVELS[this.level];

    this.press = { left: 0, right: 0, up: 0, down: 0, light: 0, heavy: 0, special: 0, super: 0, special2: 0 };
    this.history = [];
    this.thinkT = 0;
    this.specialCd = 40;
    this.comboCount = 0;
    this.comboArmed = false;
    this.lastMoveKey = null;
    this.react = this.cfg.react;
    this.blockT = 0;
    this.wanderT = 0;
  }

  setLevel(level) {
    this.level = clamp(level | 0, 0, 3);
    this.cfg = LEVELS[this.level];
    this.react = this.cfg.react;
  }

  /* ---- Fighter 调用的输入接口 ------------------------------------------- */

  snapshot() {
    const p = this.press;
    return {
      left: p.left > 0,
      right: p.right > 0,
      up: p.up > 0,
      down: p.down > 0,
      light: p.light > 0,
      heavy: p.heavy > 0,
      special: p.special > 0,
      super: p.super > 0,
      special2: p.special2 > 0
    };
  }

  consume(key) { if (this.press[key] != null) this.press[key] = 0; }
  buffered(key) { return (this.press[key] || 0) > 0; }
  pressed(key) { return (this.press[key] || 0) > 0; }

  /* ---- 每逻辑帧 ---------------------------------------------------------- */

  update() {
    const s = this.self, o = this.opp;
    for (const k in this.press) if (this.press[k] > 0) this.press[k]--;

    if (!s || !o || s.dead || o.dead) { this._clearHold(); return; }

    /* 记录对手状态，取「反应延迟」之前的快照 */
    this.history.push({
      x: o.x, y: o.y, state: o.state, grounded: o.grounded,
      moveKey: o.moveKey, moveFrame: o.moveFrame, hp: o.hp
    });
    if (this.history.length > 24) this.history.shift();
    const obs = this.history[Math.max(0, this.history.length - 1 - this.react)] || this.history[this.history.length - 1];

    if (this.specialCd > 0) this.specialCd--;
    if (this.blockT > 0) this.blockT--;

    /* 受击中：只在临近落地时尝试受身 */
    if (s.state === 'hitstun' || s.state === 'airhit' || s.state === 'knockdown' || s.state === 'ko') {
      if (s.state === 'airhit' && s.y < 26 && Math.random() < 0.35) this.press.light = 2;
      this._clearHold();
      return;
    }

    /* 出招中：命中确认后按难度追加连段 */
    if (s.state === 'attack') {
      this._combo();
      return;
    }

    this.thinkT--;
    if (this.thinkT > 0) return;
    this.thinkT = this.cfg.think + rnd(-2, 2);
    this.react = this.cfg.react + ((Math.random() * 3) | 0) - 1;

    this._decide(obs);
  }

  /* 命中确认后的取消连段 */
  _combo() {
    const s = this.self;
    if (this.lastMoveKey !== s.moveKey) {
      this.lastMoveKey = s.moveKey;
      this.comboCount = 0;
      this.comboArmed = false;
    }
    if (!s.hitConfirmed || this.comboArmed) return;
    if (this.comboCount >= this.cfg.combo) return;

    this.comboArmed = true;
    this.comboCount++;
    const m = s.def.moves;
    if (m.special && this.specialCd <= 0 && Math.random() < 0.6) {
      this.press.special = 2;
      this.specialCd = 70;
    } else if (m.heavy) {
      this.press.heavy = 2;
    }
  }

  _decide(obs) {
    const s = this.self;
    const cfg = this.cfg;
    const ai = s.def.ai || { range: [44, 104], odds: 0.4, cooldown: 150 };
    const dist = Math.abs(obs.x - s.x);
    const toward = obs.x >= s.x ? 'right' : 'left';
    const away = toward === 'right' ? 'left' : 'right';

    /* 每次决策先清掉上一轮的方向，避免左右同时按住 */
    this.press.left = 0;
    this.press.right = 0;

    /* 对手正在出招：按防御率举盾（只对延迟观测后的帧生效） */
    const threat = obs.state === 'attack' || obs.state === 'jump';
    if (threat && dist < 120 && Math.random() < cfg.block) {
      this.blockT = 10 + ((Math.random() * 8) | 0);
      this.press[away] = this.blockT;
      this.press.down = dist < 70 && Math.random() < 0.45 ? this.blockT : 0;
      return;
    }

    /* 对手硬直 / 落地：按反制率惩罚 */
    const punishable = obs.state === 'hitstun' || obs.state === 'blockstun' || obs.state === 'knockdown';
    if (punishable && dist < 100 && Math.random() < cfg.punish) {
      this._attack(dist);
      return;
    }

    /* 距离过远：靠近；过近：拉开或抢招 */
    if (dist > ai.range[1] + 16) {
      this.press[toward] = 8 + ((Math.random() * 8) | 0);
      return;
    }
    if (dist < ai.range[0]) {
      if (Math.random() < cfg.aggro * 0.6) { this._attack(dist); return; }
      this.press[away] = 8;
      return;
    }

    /* 中距离：按进攻频率决定 */
    if (Math.random() < cfg.aggro) {
      this._attack(dist);
      return;
    }

    /* 游走：小步靠近或后退 */
    this.wanderT = 6 + ((Math.random() * 8) | 0);
    this.press[Math.random() < 0.6 ? toward : away] = this.wanderT;
    if (Math.random() < 0.12) this.press.up = 2;
  }

  _attack(dist) {
    const s = this.self;
    const m = s.def.moves;

    /* 终焉兽半血后：高概率切换震波（special2） */
    if (s.phase2 && m.special2 && Math.random() < 0.55) {
      this.press.special2 = 2;
      return;
    }

    /* 满能量：偶尔放超必杀 */
    if (m.super && s.meter >= 100 && Math.random() < 0.45) {
      this.press.super = 2;
      return;
    }

    /* 必杀：冷却好且距离合适 */
    if (m.special && this.specialCd <= 0 && dist < 140 && Math.random() < 0.5) {
      this.press.special = 2;
      this.specialCd = (s.def.ai && s.def.ai.cooldown ? s.def.ai.cooldown : 150) + ((Math.random() * 40) | 0);
      return;
    }

    if (dist < 74 && m.heavy && Math.random() < 0.5) {
      this.press.heavy = 2;
      return;
    }
    if (m.light) {
      this.press.light = 2;
      if (dist < 60 && Math.random() < 0.18) this.press.down = 2;
    }
  }

  _clearHold() {
    this.press.left = 0;
    this.press.right = 0;
    this.press.up = 0;
    this.press.down = 0;
  }
}

export { LEVELS as AI_LEVELS };
