/* =============================================================================
 * data/characters.js ── 6 名原创「光之战士」变体
 *  · 共享紧身战斗服 / 胸口能量计时器 / 发光双眼 / 头冠鳍片的视觉语言
 *  · 通过配色、头冠、计时器形状、胸甲纹样、体型、招式命名做原创差异化
 *  · 定位两两不同：均衡 / 牵制 / 突进 / 奇袭 / 投技 / 重装
 * ========================================================================== */
import { makeMove, hb } from './moves.js';

/** 通用招式基底（各角色再覆写） */
function baseMoves() {
  return {
    light: makeMove({
      name: '光刃·轻斩', anim: 'light',
      startup: 5, active: 3, recovery: 9,
      damage: 32, hitstun: 13, blockstun: 8, push: 1.8,
      hitstop: 6, cancel: ['heavy', 'special', 'super'],
      hitboxes: [hb(5, 7, 26, -70, 42, 24)]
    }),
    low: makeMove({
      name: '低扫·断踝', anim: 'low',
      startup: 6, active: 3, recovery: 11,
      damage: 26, hitstun: 12, blockstun: 8, push: 1.4,
      level: 'low', hitstop: 6, cancel: ['special', 'super'],
      hitboxes: [hb(6, 8, 24, -24, 44, 22)]
    }),
    heavy: makeMove({
      name: '重斩·断钢', anim: 'heavy',
      startup: 11, active: 4, recovery: 19,
      damage: 78, hitstun: 18, blockstun: 12, push: 3.2,
      hitstop: 10, hitSfx: 'hitHeavy', cancel: ['special', 'super'],
      hitboxes: [hb(11, 14, 32, -76, 58, 34)]
    }),
    air: makeMove({
      name: '坠击', anim: 'air',
      startup: 4, active: 6, recovery: 8,
      damage: 46, hitstun: 14, blockstun: 10, push: 1.6,
      level: 'overhead', hitstop: 8,
      hitboxes: [hb(4, 9, 24, -40, 44, 30)]
    }),
    special: makeMove({
      name: '必杀·光刃', anim: 'special',
      startup: 12, active: 5, recovery: 22,
      damage: 105, hitstun: 22, blockstun: 14, push: 4.2,
      hitstop: 12, hitSfx: 'hitHeavy', meterCost: 25,
      hitboxes: [hb(12, 16, 36, -64, 60, 42)]
    }),
    super: makeMove({
      name: '超必杀·光之裁决', anim: 'super',
      startup: 20, active: 8, recovery: 34,
      damage: 250, hitstun: 30, blockstun: 20, push: 6,
      hitstop: 20, hitSfx: 'hitSuper', meterCost: 100, knockdown: true,
      hitboxes: [hb(20, 27, 34, -70, 92, 80)]
    }),
    throw: makeMove({
      name: '投技·破城', anim: 'throw',
      startup: 5, active: 2, recovery: 22,
      damage: 110, hitstun: 30, blockstun: 0, push: 4.5,
      level: 'throw', knockdown: true, hitstop: 12,
      hitboxes: [hb(5, 6, 26, -58, 42, 54)]
    })
  };
}

function makeHero(cfg) {
  const moves = baseMoves();
  /* 逐角色覆写（只改数值与命名，不改结构） */
  for (const k in cfg.overrides) {
    moves[k] = Object.assign({}, moves[k], cfg.overrides[k]);
    moves[k].total = moves[k].startup + moves[k].active + moves[k].recovery;
  }
  return {
    id: cfg.id,
    name: cfg.name,
    title: cfg.title,
    role: cfg.role,
    desc: cfg.desc,
    palette: cfg.palette,
    body: cfg.body,
    crown: cfg.crown,
    timer: cfg.timer,
    chest: cfg.chest,
    weapon: cfg.weapon,
    stats: cfg.stats,
    portrait: cfg.portrait,
    moves
  };
}

export const HEROES = [
  /* ① 均衡型：正统全能，攻守速度都在中位 */
  makeHero({
    id: 'canghui', name: '苍辉', title: '均衡型', role: '均衡',
    desc: '攻守均衡，适合上手。',
    palette: {
      base: '#eaf4ff', base2: '#b9cadd', suit: '#1b3f78', suit2: '#122a4d',
      accent: '#63e2ff', eye: '#d9fbff', dark: '#07111f', metal: '#9fc2dd'
    },
    body: { w: 1.0, shoulder: 1.0, bulk: 1.0, leg: 1.0 },
    crown: 'fin', timer: 'diamond', chest: 'v', weapon: 'blade',
    stats: { hp: 1000, walk: 1.62, dash: 4.0, jump: 7.0, weight: 1.0 },
    portrait: 0,
    overrides: {
      special: { name: '光刃·裂波', damage: 100 },
      super: { name: '超必杀·苍蓝裁决', damage: 250 }
    }
  }),

  /* ② 牵制型：远程光矢，移动偏慢，靠距离压制 */
  makeHero({
    id: 'mulan', name: '暮蓝', title: '牵制型', role: '牵制',
    desc: '光矢封距，逼敌入局。',
    palette: {
      base: '#dfe8f7', base2: '#a9b3d4', suit: '#2a2f6b', suit2: '#191d47',
      accent: '#8a7bff', eye: '#cfc4ff', dark: '#0a0a1e', metal: '#8e97c9'
    },
    body: { w: 0.94, shoulder: 0.92, bulk: 0.94, leg: 1.02 },
    crown: 'crest', timer: 'bar', chest: 'wave', weapon: 'bow',
    stats: { hp: 940, walk: 1.42, dash: 3.7, jump: 7.2, weight: 0.95 },
    portrait: 1,
    overrides: {
      light: { name: '光矢·点射', hitboxes: [hb(5, 7, 30, -70, 48, 20)] },
      heavy: { name: '光矢·贯穿', startup: 13, recovery: 21, damage: 72 },
      special: {
        name: '必杀·苍蓝光矢', anim: 'special',
        damage: 0, startup: 14, active: 1, recovery: 26,
        hitboxes: [], spawnFrame: 14,
        projectile: { speed: 5.4, w: 22, h: 10, life: 110, damage: 74, hitstun: 18, level: 'mid', color: '#8a7bff' }
      },
      super: { name: '超必杀·暮蓝星陨', damage: 235 }
    }
  }),

  /* ③ 突进型：最快的移动与突进，贴身压制 */
  makeHero({
    id: 'chisun', name: '赤隼', title: '突进型', role: '突进',
    desc: '高速连段，防御偏弱。',
    palette: {
      base: '#ffe9dd', base2: '#d9a48c', suit: '#8a1f24', suit2: '#5c1014',
      accent: '#ff7a3c', eye: '#ffe1a8', dark: '#1a0708', metal: '#e0a07a'
    },
    body: { w: 0.96, shoulder: 0.96, bulk: 0.92, leg: 1.0 },
    crown: 'blade', timer: 'cross', chest: 'stripe', weapon: 'claw',
    stats: { hp: 920, walk: 1.95, dash: 4.9, jump: 7.3, weight: 0.9 },
    portrait: 2,
    overrides: {
      light: { name: '疾拳·连打', startup: 4, damage: 28, recovery: 8 },
      heavy: { name: '烈踢·破空', startup: 9, damage: 70, recovery: 17 },
      special: { name: '必杀·赤炎突进', startup: 10, damage: 96, push: 4.8, dash: 5.5 },
      super: { name: '超必杀·焚天烈袭', damage: 265 }
    }
  }),

  /* ④ 奇袭型：闪现绕背与下段偷袭 */
  makeHero({
    id: 'youying', name: '幽荧', title: '奇袭型', role: '奇袭',
    desc: '影步绕后，出手诡异。',
    palette: {
      base: '#e6f7ee', base2: '#9fc7b4', suit: '#123a34', suit2: '#0a2622',
      accent: '#57ffb0', eye: '#c9ffe4', dark: '#04120f', metal: '#79b7a4'
    },
    body: { w: 0.9, shoulder: 0.9, bulk: 0.88, leg: 1.06 },
    crown: 'horn', timer: 'circle', chest: 'core', weapon: 'dagger',
    stats: { hp: 900, walk: 1.78, dash: 4.4, jump: 7.5, weight: 0.88 },
    portrait: 3,
    overrides: {
      low: { name: '影足·断隙', damage: 30, startup: 5 },
      heavy: { name: '影刃·回旋', damage: 72 },
      special: { name: '必杀·影步', mechanic: 'teleport', startup: 11, damage: 92, spawnFrame: 11 },
      super: { name: '超必杀·幽影乱舞', damage: 240 }
    }
  }),

  /* ⑤ 投技型：近身指令投，血厚但慢 */
  makeHero({
    id: 'panshi', name: '磐石', title: '投技型', role: '投技',
    desc: '贴身投技，近身即死。',
    palette: {
      base: '#f2e6c8', base2: '#c4ab7c', suit: '#5a3a12', suit2: '#3a2508',
      accent: '#ffc14d', eye: '#ffe9a8', dark: '#150c02', metal: '#b08b4f'
    },
    body: { w: 1.14, shoulder: 1.16, bulk: 1.18, leg: 1.0 },
    crown: 'block', timer: 'hex', chest: 'plate', weapon: 'fist',
    stats: { hp: 1120, walk: 1.28, dash: 3.4, jump: 6.4, weight: 1.2 },
    portrait: 4,
    overrides: {
      light: { name: '铁掌·推山', damage: 36, push: 2.4 },
      heavy: { name: '重拳·崩岳', startup: 14, damage: 88, recovery: 22 },
      special: {
        name: '必杀·断脊摔', level: 'throw', damage: 150, startup: 7,
        active: 2, recovery: 28, knockdown: true, push: 5.5,
        hitboxes: [hb(7, 8, 28, -58, 46, 56)]
      },
      super: { name: '超必杀·地裂抱杀', damage: 300 }
    }
  }),

  /* ⑥ 重装型：霸体推进，最高伤害与最慢速度 */
  makeHero({
    id: 'leizhu', name: '雷铸', title: '重装型', role: '重装',
    desc: '霸体重锤，硬吃一击。',
    palette: {
      base: '#dfe3ea', base2: '#a3adbd', suit: '#3b414d', suit2: '#242932',
      accent: '#ffd34d', eye: '#fff0b0', dark: '#0b0d10', metal: '#98a3b3'
    },
    body: { w: 1.2, shoulder: 1.24, bulk: 1.26, leg: 0.96 },
    crown: 'ring', timer: 'ring', chest: 'bolt', weapon: 'hammer',
    stats: { hp: 1180, walk: 1.16, dash: 3.1, jump: 6.1, weight: 1.32 },
    portrait: 5,
    overrides: {
      light: { name: '重刃·压', damage: 38, startup: 7, recovery: 11 },
      heavy: { name: '重锤·落雷', startup: 15, damage: 96, recovery: 24, armor: 1, knockdown: true },
      special: {
        name: '必杀·雷铸崩击', startup: 18, damage: 128, recovery: 28,
        armor: 1, knockdown: true, hitSfx: 'hitSuper'
      },
      super: { name: '超必杀·天雷铸灭', damage: 320 }
    }
  })
];

export const HERO_BY_ID = Object.fromEntries(HEROES.map((h) => [h.id, h]));
