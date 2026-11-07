/* =============================================================================
 * art/poses.js ── 骨架姿态库（纯数据 + 插值）
 *  · 所有角色的姿态由同一套关节参数描述，用调色板与体型系数区分外观
 *  · 攻击动作统一为「预备 → 命中 → 收招」，按招式进度插值，避免姿势硬切
 * ========================================================================== */

const BASE = {
  dy: 0, lean: 2, head: 0,
  armF: [10, 14], armB: [-12, 12],
  legF: [5, 4], legB: [-7, 8],
  crouch: 0, blade: 0, tail: 0, mouth: 0, wing: 0
};

function P(o) { return Object.assign({}, BASE, o || {}); }

function lerp(a, b, k) { return a + (b - a) * k; }

function mixPose(a, b, k) {
  return {
    dy: lerp(a.dy, b.dy, k),
    lean: lerp(a.lean, b.lean, k),
    head: lerp(a.head, b.head, k),
    armF: [lerp(a.armF[0], b.armF[0], k), lerp(a.armF[1], b.armF[1], k)],
    armB: [lerp(a.armB[0], b.armB[0], k), lerp(a.armB[1], b.armB[1], k)],
    legF: [lerp(a.legF[0], b.legF[0], k), lerp(a.legF[1], b.legF[1], k)],
    legB: [lerp(a.legB[0], b.legB[0], k), lerp(a.legB[1], b.legB[1], k)],
    crouch: lerp(a.crouch, b.crouch, k),
    blade: lerp(a.blade, b.blade, k),
    tail: lerp(a.tail, b.tail, k),
    mouth: lerp(a.mouth, b.mouth, k),
    wing: lerp(a.wing, b.wing, k)
  };
}

/* 攻击预备姿态（蓄力） */
const WIND = {
  light: P({ lean: -4, armF: [-42, -6], armB: [-24, 10] }),
  heavy: P({ lean: -16, dy: 3, armF: [-62, -18], armB: [-40, -6], head: 4 }),
  low: P({ crouch: 1, dy: 22, lean: 8, legF: [30, -50], legB: [-20, -40] }),
  air: P({ armF: [-20, 20], legF: [50, -40], legB: [-30, -30] }),
  special: P({ lean: -12, dy: 2, armF: [-54, -24], armB: [-46, -18], blade: 0.15 }),
  super: P({ lean: -22, dy: 8, armF: [-150, -20], armB: [-140, -16], head: -10, blade: 0.2 }),
  throw: P({ lean: 4, armF: [-30, 10], armB: [-20, 8] }),
  slam: P({ lean: -20, dy: 4, armF: [-150, -10], armB: [-140, -8], head: -8 }),
  breath: P({ lean: -12, head: -6, mouth: 0.2, armF: [-30, 6], armB: [-24, 4] }),
  roar: P({ lean: -8, head: -16, mouth: 0.8, armF: [-40, 10], armB: [-34, 8] }),
  burrow: P({ dy: 26, lean: 10, crouch: 1, armF: [-30, 20], armB: [-26, 16] }),
  tentacle: P({ lean: -10, armF: [-70, -20], armB: [-60, -16], tail: -0.6 })
};

/* 命中姿态（伸展最大） */
const HIT = {
  light: P({ lean: 10, armF: [78, 4], armB: [-18, 16], blade: 0.6 }),
  heavy: P({ lean: 20, dy: 4, armF: [104, 12], armB: [-30, 20], head: 8, blade: 1 }),
  low: P({ crouch: 1, dy: 24, lean: 16, legF: [82, 6], legB: [-26, -18] }),
  air: P({ lean: 14, armF: [24, 10], legF: [76, 6], legB: [-24, -16] }),
  special: P({ lean: 14, armF: [86, 2], armB: [30, 20], blade: 1 }),
  super: P({ lean: 24, dy: 2, armF: [96, 0], armB: [40, 10], head: 10, blade: 1 }),
  throw: P({ lean: 16, armF: [72, 16], armB: [44, 20] }),
  slam: P({ lean: 26, dy: 8, armF: [96, 26], armB: [86, 22], head: 14 }),
  breath: P({ lean: 16, head: 8, mouth: 1, armF: [10, 10], armB: [-6, 8] }),
  roar: P({ lean: 6, head: 12, mouth: 1, armF: [30, 20], armB: [22, 16] }),
  burrow: P({ dy: 40, lean: 20, crouch: 1, armF: [60, 30], armB: [50, 26] }),
  tentacle: P({ lean: 12, armF: [80, 30], armB: [60, 24], tail: 0.8 })
};

/**
 * 攻击姿态：t 为招式整体进度 0..1
 * 阶段：预备(0~0.40) → 出手(0.40~0.60) → 命中保持(0.60~0.68) → 收招(0.68~1)
 */
function attackPose(kind, t) {
  const wind = WIND[kind] || WIND.light;
  const hit = HIT[kind] || HIT.light;
  const base = P();
  if (t < 0.40) return mixPose(base, wind, smooth(t / 0.40));
  if (t < 0.60) return mixPose(wind, hit, smooth((t - 0.40) / 0.20));
  if (t < 0.68) return hit;
  return mixPose(hit, base, smooth((t - 0.68) / 0.32));
}

function smooth(x) {
  x = Math.max(0, Math.min(1, x));
  return x * x * (3 - 2 * x);
}

const ATTACKS = {
  light: 1, heavy: 1, low: 1, air: 1, special: 1, super: 1, throw: 1,
  slam: 1, breath: 1, roar: 1, burrow: 1, tentacle: 1, dash: 1, shockwave: 1
};

/**
 * 人形（光之战士）姿态
 * @param {object} def 角色定义
 * @param {string} action 动作名
 * @param {number} t 动作进度 0..1
 */
export function humanoidPose(def, action, t) {
  switch (action) {
    case 'idle': {
      const s = Math.sin(t * Math.PI * 2);
      return P({
        dy: s * 1.2,
        lean: 2 + s * 1.2,
        head: s * 1.6,
        armF: [10 + s * 3, 14 + s * 2],
        armB: [-12 - s * 2, 12 - s * 2],
        legF: [5, 4], legB: [-7, 8]
      });
    }
    case 'walk': {
      const s = Math.sin(t * Math.PI * 2);
      return P({
        dy: Math.abs(s) * -1.4,
        lean: 5,
        armF: [10 - s * 22, 14 + s * 8],
        armB: [-12 + s * 22, 12 - s * 8],
        legF: [5 + s * 26, 4 + Math.max(0, s) * 18],
        legB: [-7 - s * 26, 8 + Math.max(0, -s) * 18]
      });
    }
    case 'crouch':
      return P({ crouch: 1, dy: 24, lean: 10, legF: [52, -78], legB: [40, -68], armF: [18, 26], armB: [-8, 22] });
    case 'jump':
      return P({ dy: -2, lean: 8, legF: [46, -46], legB: [-32, -34], armF: [-40, 30], armB: [-50, 26] });
    case 'fall':
      return P({ lean: 4, legF: [26, -20], legB: [-22, -16], armF: [-16, 40], armB: [-26, 36] });
    case 'block':
      return P({ lean: -7, armF: [56, 104], armB: [42, 112], legF: [10, 6], legB: [-12, 10] });
    case 'crouchBlock':
      return P({ crouch: 1, dy: 24, lean: -2, armF: [66, 96], armB: [54, 104], legF: [52, -78], legB: [40, -68] });
    case 'hit':
      return P({ lean: -24, head: -12, dy: -2, armF: [-44, -16], armB: [-52, -12], legF: [-10, 12], legB: [12, 6] });
    case 'ko':
      return P({ dy: 40, lean: -78, head: -18, armF: [-70, -20], armB: [-80, -16], legF: [24, -10], legB: [-18, -20] });
    case 'win':
      return P({ lean: -2, armF: [-152, -18], armB: [-140, -22], head: -4, dy: -1 });
    case 'dash':
      return P({ lean: 24, dy: 4, legF: [44, 2], legB: [-38, 18], armF: [-30, 20], armB: [-44, 16] });
    case 'backdash':
      return P({ lean: -14, legF: [-20, 20], legB: [24, 10], armF: [-20, 30], armB: [-30, 26] });
    default:
      if (ATTACKS[action]) return attackPose(action, t);
      return P();
  }
}

/**
 * 怪兽姿态：在人形骨架上放大肢体幅度，并加入尾巴 / 口腔 / 翅膀
 */
export function monsterPose(def, action, t) {
  const kind = def.kind;
  switch (action) {
    case 'idle': {
      const s = Math.sin(t * Math.PI * 2);
      return P({
        dy: s * 2.2,
        lean: 6 + s * 2,
        head: s * 3,
        armF: [14 + s * 4, 18],
        armB: [-16 - s * 3, 16],
        legF: [6, 8], legB: [-8, 10],
        tail: s * 0.25,
        wing: kind === 'float' ? 0.6 + s * 0.4 : 0
      });
    }
    case 'walk': {
      const s = Math.sin(t * Math.PI * 2);
      return P({
        dy: -Math.abs(s) * 2,
        lean: 9,
        armF: [16 - s * 26, 20 + s * 10],
        armB: [-18 + s * 26, 18 - s * 10],
        legF: [6 + s * 30, 8 + Math.max(0, s) * 20],
        legB: [-8 - s * 30, 10 + Math.max(0, -s) * 18],
        tail: s * 0.4
      });
    }
    case 'crouch':
      return P({ crouch: 1, dy: 26, lean: 16, legF: [56, -70], legB: [44, -62], armF: [26, 30], armB: [-6, 26] });
    case 'jump':
      return P({ lean: 10, legF: [50, -40], legB: [-34, -30], armF: [-40, 34], armB: [-50, 30], tail: -0.4 });
    case 'fall':
      return P({ lean: 8, legF: [30, -22], legB: [-24, -18], armF: [-20, 42], armB: [-28, 38], tail: 0.3 });
    case 'block':
      return P({ lean: -6, armF: [60, 100], armB: [46, 108], legF: [10, 10], legB: [-12, 12] });
    case 'hit':
      return P({ lean: -28, head: -14, dy: -2, armF: [-50, -18], armB: [-60, -12], legF: [-12, 14], legB: [14, 8], tail: -0.5 });
    case 'ko':
      return P({ dy: 44, lean: -84, head: -20, armF: [-76, -20], armB: [-86, -16], legF: [26, -8], legB: [-20, -22], tail: 0.2 });
    case 'win':
      return P({ lean: -4, armF: [-160, -14], armB: [-148, -18], head: -8, mouth: 0.9 });
    case 'dash':
      return P({ lean: 28, dy: 4, legF: [48, 4], legB: [-42, 20], armF: [-32, 22], armB: [-46, 18], tail: -0.6 });
    default:
      if (ATTACKS[action]) return attackPose(action, t);
      return P();
  }
}

/** 依据角色类型选择姿态函数 */
export function getPose(def, action, t) {
  return def.kind ? monsterPose(def, action, t) : humanoidPose(def, action, t);
}
