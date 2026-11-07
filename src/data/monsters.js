/* =============================================================================
 * data/monsters.js ── 10 只原创特摄风怪兽
 * 依据美术提示词实现：名称、体型、配色、甲壳/棘刺/多目/口器特征
 * 每只怪兽拥有 1 个独立战斗机制，且机制直接写进帧数据与 AI 行为：
 *   喷火 / 雷击 / 钻地 / 多段触手 / 陷阱 / 毒雾 / 滞空 / 反伤 / 突进 / 多阶段
 * ========================================================================== */
import { makeMove, hb } from './moves.js';

function baseMoves() {
  return {
    light: makeMove({
      name: '爪击', anim: 'light',
      startup: 8, active: 3, recovery: 15,
      damage: 42, hitstun: 15, blockstun: 10, push: 2.6,
      hitstop: 7, hitboxes: [hb(8, 10, 40, -76, 62, 46)]
    }),
    heavy: makeMove({
      name: '重砸', anim: 'slam',
      startup: 16, active: 4, recovery: 26,
      damage: 92, hitstun: 20, blockstun: 14, push: 4.2,
      hitstop: 10, hitSfx: 'hitHeavy', knockdown: true,
      hitboxes: [hb(16, 19, 44, -92, 76, 60)]
    }),
    special: makeMove({
      name: '咆哮冲击', anim: 'special',
      startup: 20, active: 5, recovery: 28,
      damage: 88, hitstun: 20, blockstun: 14, push: 4.6,
      hitstop: 10, hitSfx: 'hitHeavy',
      hitboxes: [hb(20, 24, 50, -86, 88, 66)]
    })
  };
}

function makeMonster(cfg) {
  const moves = baseMoves();
  for (const k in cfg.overrides || {}) {
    moves[k] = Object.assign({}, moves[k], cfg.overrides[k]);
    moves[k].total = moves[k].startup + moves[k].active + moves[k].recovery;
  }
  return {
    id: cfg.id,
    name: cfg.name,
    title: cfg.title,
    kind: cfg.kind,
    h: cfg.h,
    palette: cfg.palette,
    body: cfg.body,
    spikes: cfg.spikes || 0,
    eyes: cfg.eyes == null ? 2 : cfg.eyes,
    stats: Object.assign({ hp: 1100, walk: 1.25, dash: 2.8, jump: 6.2, weight: 1.2 }, cfg.stats),
    flags: cfg.flags || {},
    ai: Object.assign({ range: [46, 96], odds: 0.3, cooldown: 150 }, cfg.ai),
    desc: cfg.desc,
    moves
  };
}

export const MONSTERS = [
  /* ① 熔岩巨蜥 MAGMARA：黑曜甲壳 + 岩浆裂隙，中距离喷火 */
  makeMonster({
    id: 'magmara', name: '熔岩巨蜥', title: '喷火', kind: 'quad', h: 180, spikes: 10, eyes: 2,
    desc: '黑曜甲壳下涌动着岩浆，口腔喷吐熔岩火球。',
    palette: {
      shell: '#2b2328', shell2: '#161014', belly: '#5a3a2a', claw: '#d8b07a',
      eye: '#ff5a2a', glow: '#ff6a22', dark: '#0a0507', spike: '#3a1c12'
    },
    body: { bulk: 1.1, len: 1.05, head: 1.08, tail: 1.0 },
    stats: { hp: 1080, walk: 1.24, dash: 2.8, jump: 5.8, weight: 1.25 },
    ai: { range: [70, 130], odds: 0.34, cooldown: 140 },
    overrides: {
      special: {
        name: '熔岩喷吐', anim: 'breath', mechanic: 'projectile',
        startup: 24, active: 1, recovery: 26, damage: 0, hitboxes: [], spawnFrame: 20,
        projectile: { speed: 3.8, w: 20, h: 16, life: 120, damage: 64, hitstun: 18, level: 'mid', color: '#ff6a22', kind: 'fire' }
      }
    }
  }),

  /* ② 三目电蛾 VOLTREYES：电黄 + 风暴紫，三目，滞空落雷 */
  makeMonster({
    id: 'voltreyes', name: '三目电蛾', title: '雷击', kind: 'float', h: 130, spikes: 3, eyes: 3,
    desc: '三只复眼蓄满电荷，在对手脚下召唤落雷。',
    palette: {
      shell: '#e8d34a', shell2: '#a88a1c', belly: '#5b3f8c', claw: '#f4f0c8',
      eye: '#fff7a8', glow: '#ffe94a', dark: '#1a1024', spike: '#5b3f8c'
    },
    body: { bulk: 0.98, len: 0.95, head: 1.0, tail: 0.8 },
    stats: { hp: 1010, walk: 1.38, dash: 3.1, jump: 7.2, weight: 0.85 },
    flags: { hover: 28, noThrow: true },
    ai: { range: [90, 160], odds: 0.36, cooldown: 160 },
    overrides: {
      special: {
        name: '落雷', anim: 'roar', mechanic: 'strike',
        startup: 28, active: 1, recovery: 32, damage: 0, hitboxes: [], spawnFrame: 26,
        strike: { warning: 26, radius: 34, damage: 78, hitstun: 20, color: '#ffe94a' }
      }
    }
  }),

  /* ③ 骨甲蠕虫 OSSWYRM：骨白 + 墓褐，无眼，环形齿口，钻地绕后 */
  makeMonster({
    id: 'osswyrm', name: '骨甲蠕虫', title: '钻地', kind: 'worm', h: 200, spikes: 14, eyes: 0,
    desc: '分节骨甲钻入地下，从背后破土咬合。',
    palette: {
      shell: '#e8e0c8', shell2: '#a89a78', belly: '#6a5a40', claw: '#fff8e0',
      eye: '#fff8e0', glow: '#c8b88a', dark: '#1a1408', spike: '#5a4a32'
    },
    body: { bulk: 1.0, len: 1.1, head: 1.0, tail: 0.9 },
    stats: { hp: 1060, walk: 1.45, dash: 3.6, jump: 5.8, weight: 1.1 },
    ai: { range: [40, 110], odds: 0.4, cooldown: 180 },
    overrides: {
      special: {
        name: '潜地骨袭', anim: 'burrow', mechanic: 'burrow',
        startup: 12, active: 4, recovery: 30, damage: 86, hitstun: 22,
        push: 4.6, hitstop: 12, hitSfx: 'hitHeavy', knockdown: true,
        hitboxes: [hb(44, 47, 36, -60, 70, 62)]
      }
    }
  }),

  /* ④ 深渊章鱼 ABYSSAL：深海蓝 + 紫，单横瞳，六腕多段 */
  makeMonster({
    id: 'abyssal', name: '深渊章鱼', title: '触手', kind: 'octo', h: 170, spikes: 4, eyes: 1,
    desc: '六条腕足连续抽击，多段命中极难脱身。',
    palette: {
      shell: '#1f3a6e', shell2: '#12234a', belly: '#5b2a8a', claw: '#c8e8ff',
      eye: '#57e8ff', glow: '#57e8ff', dark: '#050a18', spike: '#2a1a52'
    },
    body: { bulk: 1.18, len: 0.9, head: 0.9, tail: 0.7 },
    stats: { hp: 1180, walk: 1.2, dash: 2.6, jump: 5.6, weight: 1.25 },
    ai: { range: [50, 105], odds: 0.38, cooldown: 150 },
    overrides: {
      special: {
        name: '六腕乱舞', anim: 'tentacle', mechanic: 'multi',
        startup: 16, active: 21, recovery: 20, damage: 34, hitstun: 12,
        push: 1.4, hitstop: 6, hits: 3, hitGap: 7,
        hitboxes: [
          hb(16, 18, 48, -84, 92, 40),
          hb(23, 25, 48, -76, 92, 40),
          hb(30, 32, 48, -92, 96, 44)
        ]
      }
    }
  }),

  /* ⑤ 结晶蜘蛛 CRYSTALIS：青晶 + 暗板岩，八条晶腿，布丝陷阱 */
  makeMonster({
    id: 'crystalis', name: '结晶蜘蛛', title: '陷阱', kind: 'spider', h: 140, spikes: 8, eyes: 6,
    desc: '八条晶腿在场地织下晶丝，踩中会大幅减速。',
    palette: {
      shell: '#3fb6a8', shell2: '#1f6e68', belly: '#8fe8dc', claw: '#e0fffa',
      eye: '#ff6a52', glow: '#7ffff0', dark: '#08161a', spike: '#2b3a44'
    },
    body: { bulk: 1.0, len: 1.05, head: 0.92, tail: 0.7 },
    stats: { hp: 980, walk: 1.55, dash: 3.4, jump: 6.6, weight: 0.95 },
    ai: { range: [60, 130], odds: 0.4, cooldown: 190 },
    overrides: {
      special: {
        name: '晶丝罗网', anim: 'roar', mechanic: 'trap',
        startup: 18, active: 1, recovery: 26, damage: 0, hitboxes: [], spawnFrame: 16,
        trap: { life: 480, w: 64, slow: 0.45, duration: 150 }
      }
    }
  }),

  /* ⑥ 毒沼蟾王 TOXKING：沼绿 + 病黄，巨口长舌，毒雾持续伤害 */
  makeMonster({
    id: 'toxking', name: '毒沼蟾王', title: '毒雾', kind: 'toad', h: 175, spikes: 6, eyes: 2,
    desc: '喷出剧毒瘴气，站在雾中会持续失血。',
    palette: {
      shell: '#4a6b2a', shell2: '#2a3f14', belly: '#b8c46a', claw: '#e8f0c0',
      eye: '#ff9a2a', glow: '#9a5bd8', dark: '#0a1004', spike: '#6b7a2a'
    },
    body: { bulk: 1.2, len: 1.0, head: 1.05, tail: 0.8 },
    stats: { hp: 1120, walk: 1.18, dash: 2.5, jump: 5.6, weight: 1.3 },
    ai: { range: [60, 140], odds: 0.38, cooldown: 200 },
    overrides: {
      special: {
        name: '剧毒瘴气', anim: 'breath', mechanic: 'cloud',
        startup: 20, active: 1, recovery: 30, damage: 0, hitboxes: [], spawnFrame: 18,
        cloud: { life: 420, w: 120, h: 54, dps: 0.55, color: '#9a5bd8' }
      }
    }
  }),

  /* ⑦ 双头翼龙 DUOWING：铁锈红 + 板岩灰，双首，空中俯冲 */
  makeMonster({
    id: 'duowing', name: '双头翼龙', title: '滞空', kind: 'wyvern', h: 145, spikes: 8, eyes: 4,
    desc: '两个头分别吐息火焰与寒霜，从空中俯冲撕咬。',
    palette: {
      shell: '#8a3a2a', shell2: '#4a4f5a', belly: '#c08a6a', claw: '#f0e0c8',
      eye: '#ffb05a', glow: '#ff8a3c', dark: '#140806', spike: '#5a2a1e'
    },
    body: { bulk: 1.0, len: 1.0, head: 1.1, tail: 1.0 },
    stats: { hp: 1030, walk: 1.34, dash: 3.2, jump: 7.4, weight: 0.95 },
    flags: { hover: 22, noThrow: true },
    ai: { range: [50, 120], odds: 0.36, cooldown: 160 },
    overrides: {
      special: {
        name: '双首俯冲', anim: 'air', mechanic: 'dive',
        startup: 14, active: 10, recovery: 22, damage: 84, hitstun: 18,
        push: 3.6, hitstop: 10, hitSfx: 'hitHeavy', knockdown: true,
        hitboxes: [hb(14, 23, 34, -54, 70, 56)]
      }
    }
  }),

  /* ⑧ 齿轮傀儡 COGSHADE：黄铜 + 炮铜，单透镜眼，装甲反伤 */
  makeMonster({
    id: 'cogshade', name: '齿轮傀儡', title: '反伤', kind: 'biped', h: 150, spikes: 6, eyes: 1,
    desc: '齿轮胸腔吸收冲击，防御时反弹伤害。',
    palette: {
      shell: '#a87a3a', shell2: '#4a4f57', belly: '#d8b46a', claw: '#e8dcc0',
      eye: '#ff5a2a', glow: '#ffb03c', dark: '#12100a', spike: '#6a5228'
    },
    body: { bulk: 1.24, len: 0.95, head: 1.0, tail: 0.6 },
    stats: { hp: 1380, walk: 1.02, dash: 2.2, jump: 5.2, weight: 1.55 },
    flags: { reflect: 0.15, armor: 1 },
    ai: { range: [44, 92], odds: 0.3, cooldown: 170 },
    overrides: {
      heavy: { startup: 19, damage: 104, armor: 1 },
      special: {
        name: '齿轮碾压', anim: 'slam', mechanic: 'dash',
        startup: 20, active: 6, recovery: 30, damage: 112, hitstun: 22,
        push: 5.2, hitstop: 12, hitSfx: 'hitSuper', armor: 1, knockdown: true,
        dash: 4.2, hitboxes: [hb(20, 25, 40, -90, 86, 92)]
      }
    }
  }),

  /* ⑨ 影噬猎犬 SHADOWHOUND：炭黑 + 幽紫，无眼窝，高速突进 */
  makeMonster({
    id: 'shadowhound', name: '影噬猎犬', title: '高速突进', kind: 'quad', h: 110, spikes: 9, eyes: 2,
    desc: '半实体暗影之躯，以残影速度连续突进。',
    palette: {
      shell: '#1e1a24', shell2: '#0e0c12', belly: '#3a2a52', claw: '#c8b0ff',
      eye: '#b06bff', glow: '#b06bff', dark: '#050308', spike: '#2a1b3d'
    },
    body: { bulk: 0.9, len: 1.24, head: 0.95, tail: 1.15 },
    stats: { hp: 950, walk: 1.72, dash: 5.2, jump: 7.4, weight: 0.85 },
    flags: { afterimage: true },
    ai: { range: [46, 118], odds: 0.46, cooldown: 120 },
    overrides: {
      light: { startup: 6, recovery: 12, damage: 36 },
      special: {
        name: '残影突袭', anim: 'special', mechanic: 'dash',
        startup: 12, active: 8, recovery: 24, damage: 92, hitstun: 20,
        push: 4.4, hitstop: 10, hitSfx: 'hitHeavy', dash: 7.5,
        hitboxes: [hb(12, 19, 38, -66, 78, 56)]
      }
    }
  }),

  /* ⑩ 陨核巨像 METEORRON：玄武岩 + 熔金，单垂直光缝，半血两阶段 */
  makeMonster({
    id: 'meteorron', name: '陨核巨像', title: '多阶段', kind: 'biped', h: 200, spikes: 12, eyes: 1,
    desc: '陨石熔铸的巨像，半血后核心完全暴露并狂暴。',
    palette: {
      shell: '#2a2420', shell2: '#161210', belly: '#e8a23a', claw: '#ffd27a',
      eye: '#ffd27a', glow: '#ff8a2a', dark: '#080504', spike: '#4a3a2a'
    },
    body: { bulk: 1.38, len: 1.05, head: 1.2, tail: 0.9 },
    stats: { hp: 1450, walk: 1.1, dash: 2.6, jump: 5.6, weight: 1.7 },
    flags: { phases: 2 },
    ai: { range: [50, 120], odds: 0.34, cooldown: 165 },
    overrides: {
      heavy: { startup: 18, damage: 108 },
      special: {
        name: '陨核吐息', anim: 'breath', mechanic: 'projectile',
        startup: 26, active: 1, recovery: 30, damage: 0, hitboxes: [], spawnFrame: 22,
        projectile: { speed: 3.4, w: 26, h: 20, life: 130, damage: 72, hitstun: 20, level: 'mid', color: '#ff8a2a', kind: 'fire' }
      },
      special2: {
        name: '陨核震波', anim: 'shockwave', mechanic: 'shockwave',
        startup: 22, active: 8, recovery: 32, damage: 118, hitstun: 24,
        push: 5.6, hitstop: 14, hitSfx: 'hitSuper', armor: 1, knockdown: true,
        hitboxes: [hb(22, 29, 46, -70, 110, 150)]
      }
    }
  })
];

export const MONSTER_BY_ID = Object.fromEntries(MONSTERS.map((m) => [m.id, m]));
