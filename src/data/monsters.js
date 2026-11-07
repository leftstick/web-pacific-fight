/* =============================================================================
 * data/monsters.js ── 10 只原创特摄风怪兽
 * 每只怪兽拥有 1 个独立战斗机制，且机制直接写进帧数据与 AI 行为：
 *   flame 喷火 / thunder 雷击 / burrow 钻地 / tentacle 多段触手 / web 陷阱
 *   poison 毒雾 / hover 滞空 / armor 装甲反伤 / dash 高速突进 / boss 多阶段
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
    eyes: cfg.eyes || 2,
    stats: Object.assign({ hp: 1100, walk: 1.25, dash: 2.8, jump: 6.2, weight: 1.2 }, cfg.stats),
    flags: cfg.flags || {},
    ai: Object.assign({ range: [46, 96], odds: 0.3, cooldown: 150 }, cfg.ai),
    desc: cfg.desc,
    moves
  };
}

export const MONSTERS = [
  /* ① 喷火：中距离火球压制 */
  makeMonster({
    id: 'flame', name: '焰牙兽', title: '喷火', kind: 'quad', h: 150, spikes: 9, eyes: 3,
    desc: '口腔喷吐熔岩火球，中距离最危险。',
    palette: {
      shell: '#7a2418', shell2: '#4a120c', belly: '#c98a4a', claw: '#e8d7b0',
      eye: '#ffd24a', glow: '#ff6a22', dark: '#1a0603', spike: '#2a0d08'
    },
    body: { bulk: 1.05, len: 1.0, head: 1.05, tail: 1.0 },
    stats: { hp: 1080, walk: 1.28, dash: 2.9, jump: 6.0, weight: 1.15 },
    ai: { range: [70, 130], odds: 0.34, cooldown: 140 },
    overrides: {
      special: {
        name: '熔岩喷吐', anim: 'breath', mechanic: 'projectile',
        startup: 24, active: 1, recovery: 26, damage: 0, hitboxes: [], spawnFrame: 20,
        projectile: { speed: 3.8, w: 20, h: 16, life: 120, damage: 64, hitstun: 18, level: 'mid', color: '#ff6a22', kind: 'fire' }
      }
    }
  }),

  /* ② 雷击：延迟落雷，需要走位躲避 */
  makeMonster({
    id: 'thunder', name: '雷角兽', title: '雷击', kind: 'biped', h: 168, spikes: 7, eyes: 2,
    desc: '双角积蓄电荷，在对手脚下召唤落雷。',
    palette: {
      shell: '#2a3f6e', shell2: '#16233f', belly: '#8fa6cc', claw: '#dfe8f7',
      eye: '#9fe8ff', glow: '#6fd0ff', dark: '#060b16', spike: '#1b2a4a'
    },
    body: { bulk: 1.1, len: 0.95, head: 1.1, tail: 0.9 },
    stats: { hp: 1140, walk: 1.32, dash: 3.0, jump: 6.4, weight: 1.2 },
    ai: { range: [90, 160], odds: 0.36, cooldown: 160 },
    overrides: {
      special: {
        name: '落雷', anim: 'roar', mechanic: 'strike',
        startup: 28, active: 1, recovery: 32, damage: 0, hitboxes: [], spawnFrame: 26,
        strike: { warning: 26, radius: 34, damage: 78, hitstun: 20, color: '#6fd0ff' }
      }
    }
  }),

  /* ③ 钻地：无敌潜行后从背后破土 */
  makeMonster({
    id: 'burrow', name: '地穴兽', title: '钻地', kind: 'insect', h: 126, spikes: 11, eyes: 4,
    desc: '钻入地下规避攻击，从身后破土而出。',
    palette: {
      shell: '#5a4a2a', shell2: '#33270f', belly: '#b49a63', claw: '#efe0bb',
      eye: '#ffd24a', glow: '#c89b3c', dark: '#0e0903', spike: '#22180a'
    },
    body: { bulk: 1.0, len: 1.15, head: 0.95, tail: 0.8 },
    stats: { hp: 1020, walk: 1.45, dash: 3.6, jump: 5.8, weight: 1.0 },
    ai: { range: [40, 110], odds: 0.4, cooldown: 180 },
    overrides: {
      special: {
        name: '潜地突袭', anim: 'burrow', mechanic: 'burrow',
        startup: 12, active: 4, recovery: 30, damage: 86, hitstun: 22,
        push: 4.6, hitstop: 12, hitSfx: 'hitHeavy', knockdown: true,
        hitboxes: [hb(44, 47, 36, -60, 70, 62)]
      }
    }
  }),

  /* ④ 触手：多段判定，命中后拉开距离 */
  makeMonster({
    id: 'tentacle', name: '触须兽', title: '触手', kind: 'blob', h: 152, spikes: 4, eyes: 5,
    desc: '六条触须连续抽击，多段命中极难脱身。',
    palette: {
      shell: '#5b2a62', shell2: '#351538', belly: '#c08ad0', claw: '#efd8f7',
      eye: '#c9ff6f', glow: '#b45ce0', dark: '#120616', spike: '#2c1033'
    },
    body: { bulk: 1.15, len: 0.9, head: 0.9, tail: 0.7 },
    stats: { hp: 1180, walk: 1.2, dash: 2.6, jump: 5.6, weight: 1.25 },
    ai: { range: [50, 105], odds: 0.38, cooldown: 150 },
    overrides: {
      special: {
        name: '触手乱舞', anim: 'tentacle', mechanic: 'multi',
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

  /* ⑤ 蛛网：地面布陷阱，踩中减速 */
  makeMonster({
    id: 'web', name: '蛛网兽', title: '陷阱', kind: 'insect', h: 118, spikes: 6, eyes: 6,
    desc: '在场地布下黏网，踩中会大幅减速。',
    palette: {
      shell: '#384a35', shell2: '#1f2c1d', belly: '#9aa88c', claw: '#e5edd9',
      eye: '#ff6a52', glow: '#8bd06f', dark: '#080d07', spike: '#233020'
    },
    body: { bulk: 0.98, len: 1.05, head: 0.9, tail: 0.7 },
    stats: { hp: 980, walk: 1.55, dash: 3.4, jump: 6.6, weight: 0.95 },
    ai: { range: [60, 130], odds: 0.4, cooldown: 190 },
    overrides: {
      special: {
        name: '黏网陷阱', anim: 'roar', mechanic: 'trap',
        startup: 18, active: 1, recovery: 26, damage: 0, hitboxes: [], spawnFrame: 16,
        trap: { life: 480, w: 64, slow: 0.45, duration: 150 }
      }
    }
  }),

  /* ⑥ 毒雾：持续掉血区域 */
  makeMonster({
    id: 'poison', name: '毒沼兽', title: '毒雾', kind: 'quad', h: 146, spikes: 8, eyes: 2,
    desc: '喷出剧毒瘴气，站在雾中会持续失血。',
    palette: {
      shell: '#455a26', shell2: '#27330f', belly: '#9fb46a', claw: '#e6efc9',
      eye: '#d8ff5a', glow: '#8de03c', dark: '#0a0f04', spike: '#2a3510'
    },
    body: { bulk: 1.08, len: 1.0, head: 1.0, tail: 0.9 },
    stats: { hp: 1120, walk: 1.22, dash: 2.7, jump: 5.9, weight: 1.2 },
    ai: { range: [60, 140], odds: 0.38, cooldown: 200 },
    overrides: {
      special: {
        name: '剧毒瘴气', anim: 'breath', mechanic: 'cloud',
        startup: 20, active: 1, recovery: 30, damage: 0, hitboxes: [], spawnFrame: 18,
        cloud: { life: 420, w: 120, h: 54, dps: 0.55, color: '#8de03c' }
      }
    }
  }),

  /* ⑦ 滞空：漂浮空中，投技无效 */
  makeMonster({
    id: 'hover', name: '浮空兽', title: '滞空', kind: 'float', h: 142, spikes: 5, eyes: 1,
    desc: '常驻滞空，俯冲攻击难以反击，投技对它无效。',
    palette: {
      shell: '#3f5c66', shell2: '#233840', belly: '#a8ccd4', claw: '#e2f2f6',
      eye: '#ff9bd2', glow: '#66d8ff', dark: '#050d10', spike: '#1c2e35'
    },
    body: { bulk: 1.0, len: 0.9, head: 1.0, tail: 0.5 },
    stats: { hp: 1010, walk: 1.4, dash: 3.2, jump: 7.0, weight: 0.85 },
    flags: { hover: 30, noThrow: true },
    ai: { range: [50, 120], odds: 0.36, cooldown: 160 },
    overrides: {
      special: {
        name: '俯冲撕咬', anim: 'air', mechanic: 'dive',
        startup: 14, active: 10, recovery: 22, damage: 84, hitstun: 18,
        push: 3.6, hitstop: 10, hitSfx: 'hitHeavy', knockdown: true,
        hitboxes: [hb(14, 23, 34, -54, 70, 56)]
      }
    }
  }),

  /* ⑧ 甲壳：高防御 + 防御反伤 */
  makeMonster({
    id: 'armor', name: '甲壳兽', title: '反伤', kind: 'biped', h: 172, spikes: 14, eyes: 4,
    desc: '厚重甲壳吸收冲击，防御时反弹伤害。',
    palette: {
      shell: '#4a4f3c', shell2: '#2b2f21', belly: '#b8bd97', claw: '#e8ebd6',
      eye: '#ffb03c', glow: '#d8c96a', dark: '#0b0c07', spike: '#333823'
    },
    body: { bulk: 1.3, len: 0.95, head: 1.0, tail: 0.8 },
    stats: { hp: 1380, walk: 1.02, dash: 2.2, jump: 5.2, weight: 1.55 },
    flags: { reflect: 0.15, armor: 1 },
    ai: { range: [44, 92], odds: 0.3, cooldown: 170 },
    overrides: {
      heavy: { startup: 19, damage: 104, armor: 1 },
      special: {
        name: '装甲冲撞', anim: 'slam', mechanic: 'dash',
        startup: 20, active: 6, recovery: 30, damage: 112, hitstun: 22,
        push: 5.2, hitstop: 12, hitSfx: 'hitSuper', armor: 1, knockdown: true,
        dash: 4.2, hitboxes: [hb(20, 25, 40, -90, 86, 92)]
      }
    }
  }),

  /* ⑨ 疾影：高速突进，血少速度快 */
  makeMonster({
    id: 'dash', name: '疾影兽', title: '高速突进', kind: 'quad', h: 128, spikes: 10, eyes: 2,
    desc: '以残影速度连续突进，专抓出招硬直。',
    palette: {
      shell: '#3a2a4e', shell2: '#201530', belly: '#8f7bb0', claw: '#eee4ff',
      eye: '#ff4a7a', glow: '#b06bff', dark: '#080410', spike: '#2a1b3d'
    },
    body: { bulk: 0.92, len: 1.2, head: 0.95, tail: 1.1 },
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

  /* ⑩ 终焉：多阶段 Boss，半血狂暴 */
  makeMonster({
    id: 'boss', name: '终焉兽', title: '多阶段', kind: 'biped', h: 200, spikes: 18, eyes: 6,
    desc: '半血后进入狂暴形态，攻击速度与手段全面升级。',
    palette: {
      shell: '#5c1a2a', shell2: '#380a15', belly: '#c48a8a', claw: '#f2dcdc',
      eye: '#ff2a4a', glow: '#ff5a3c', dark: '#12040a', spike: '#3d0f1e'
    },
    body: { bulk: 1.35, len: 1.05, head: 1.15, tail: 1.0 },
    stats: { hp: 1450, walk: 1.1, dash: 2.6, jump: 5.6, weight: 1.7 },
    flags: { phases: 2 },
    ai: { range: [50, 120], odds: 0.34, cooldown: 165 },
    overrides: {
      heavy: { startup: 18, damage: 108 },
      special: {
        name: '终焉吐息', anim: 'breath', mechanic: 'projectile',
        startup: 26, active: 1, recovery: 30, damage: 0, hitboxes: [], spawnFrame: 22,
        projectile: { speed: 3.4, w: 26, h: 20, life: 130, damage: 72, hitstun: 20, level: 'mid', color: '#ff5a3c', kind: 'fire' }
      },
      special2: {
        name: '终焉震波', anim: 'slam', mechanic: 'shockwave',
        startup: 22, active: 8, recovery: 32, damage: 118, hitstun: 24,
        push: 5.6, hitstop: 14, hitSfx: 'hitSuper', armor: 1, knockdown: true,
        hitboxes: [hb(22, 29, 46, -70, 110, 150)]
      }
    }
  })
];

export const MONSTER_BY_ID = Object.fromEntries(MONSTERS.map((m) => [m.id, m]));
