/* =============================================================================
 * data/characters.js ── 6 名原创「光之战士」
 *  · 视觉语言：紧身战斗服 / 能量核心 / 发光双眼 / 头冠 / 胸甲纹样
 *  · 依据美术提示词逐角色实现：配色、体型、头冠、核心位置与招式命名
 *  · 定位两两不同：均衡 / 牵制 / 突进 / 奇袭 / 投技 / 重装
 * ========================================================================== */
import { makeMove, hb } from './moves.js';

/** 通用招式基底（各角色再覆写） */
function baseMoves() {
  return {
    light: makeMove({
      name: '光刃·轻斩', anim: 'light',
      startup: 5, active: 3, recovery: 8,
      damage: 30, hitstun: 12, blockstun: 9, push: 2,
      hitstop: 6, cancel: ['heavy', 'special', 'super'],
      hitboxes: [hb(5, 7, 26, -70, 42, 24)]
    }),
    low: makeMove({
      name: '低扫·断踝', anim: 'low',
      startup: 6, active: 3, recovery: 10,
      damage: 25, hitstun: 11, blockstun: 8, push: 2,
      level: 'low', hitstop: 6, cancel: ['crouchHeavy', 'special', 'super'],
      hitboxes: [hb(6, 8, 24, -24, 44, 22)]
    }),
    crouchHeavy: makeMove({
      name: '蹲重·碎地', anim: 'low',
      startup: 14, active: 4, recovery: 22,
      damage: 90, hitstun: 20, blockstun: 14, push: 6,
      level: 'low', knockdown: true, hitstop: 10, hitSfx: 'hitHeavy',
      hitboxes: [hb(14, 17, 30, -34, 58, 32)]
    }),
    heavy: makeMove({
      name: '重斩·断钢', anim: 'heavy',
      startup: 12, active: 4, recovery: 18,
      damage: 80, hitstun: 18, blockstun: 12, push: 5,
      hitstop: 10, hitSfx: 'hitHeavy', cancel: ['special', 'super'],
      hitboxes: [hb(12, 15, 32, -76, 58, 34)]
    }),
    air: makeMove({
      name: '跳轻·坠击', anim: 'air',
      startup: 7, active: 6, recovery: 6,
      damage: 45, hitstun: 13, blockstun: 10, push: 3,
      level: 'overhead', hitstop: 8,
      hitboxes: [hb(7, 12, 24, -40, 44, 30)]
    }),
    airHeavy: makeMove({
      name: '跳重·裂空', anim: 'air',
      startup: 11, active: 5, recovery: 10,
      damage: 85, hitstun: 18, blockstun: 12, push: 5,
      level: 'overhead', hitstop: 10, hitSfx: 'hitHeavy',
      hitboxes: [hb(11, 15, 28, -44, 54, 38)]
    }),
    special: makeMove({
      name: '必杀·光刃', anim: 'special',
      startup: 18, active: 6, recovery: 28,
      damage: 120, hitstun: 22, blockstun: 16, push: 8,
      hitstop: 12, hitSfx: 'hitHeavy', meterCost: 25,
      hitboxes: [hb(18, 23, 36, -64, 60, 42)]
    }),
    super: makeMove({
      name: '超必杀·光之裁决', anim: 'super',
      startup: 12, active: 8, recovery: 36,
      damage: 320, hitstun: 30, blockstun: 20, push: 12,
      hitstop: 20, hitSfx: 'hitSuper', meterCost: 100, knockdown: true,
      invuln: 8,
      hitboxes: [hb(12, 19, 34, -70, 92, 80)]
    }),
    throw: makeMove({
      name: '投技·破城', anim: 'throw',
      startup: 5, active: 2, recovery: 24,
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
    short: cfg.short,
    title: cfg.title,
    role: cfg.role,
    desc: cfg.desc,
    palette: cfg.palette,
    body: cfg.body,
    crown: cfg.crown,
    timer: cfg.timer,
    core: cfg.core || 'chest',
    chest: cfg.chest,
    weapon: cfg.weapon,
    stats: cfg.stats,
    portrait: cfg.portrait,
    moves
  };
}

export const HEROES = [
  /* ① 炽核·诺瓦 NOVA：红橙 + 冷银，胸口菱形核心，火焰双角冠 */
  makeHero({
    id: 'nova', name: '炽核·诺瓦', short: '诺瓦', title: '均衡型', role: '均衡',
    desc: '红银光刃，攻守均衡。',
    palette: {
      base: '#f3f7ff', base2: '#c9d2dc', suit: '#e8412f', suit2: '#a52a1d',
      accent: '#ffb347', eye: '#ffc14d', dark: '#2a0a06', metal: '#d9dee6'
    },
    body: { w: 1.0, shoulder: 1.0, bulk: 1.0, leg: 1.0 },
    crown: 'flame', timer: 'diamond', core: 'chest', chest: 'v', weapon: 'blade',
    stats: { hp: 1000, walk: 1.62, dash: 4.0, jump: 7.0, weight: 1.0 },
    portrait: 0,
    overrides: {
      special: { name: '等离子斩' },
      /* 新星爆裂：全屏冲击波 */
      super: { name: '新星爆裂', hitboxes: [hb(12, 19, 0, -70, 460, 150)] }
    }
  }),

  /* ② 苍澜·阿库亚 AQUA：青蓝 + 珍珠银，额头水滴核心，旗鱼鳍冠 */
  makeHero({
    id: 'aqua', name: '苍澜·阿库亚', short: '阿库亚', title: '牵制型', role: '牵制',
    desc: '苍澜光矢，封锁距离。',
    palette: {
      base: '#e9fbff', base2: '#b7d9e6', suit: '#2e8fd6', suit2: '#1b5c92',
      accent: '#7fe6ff', eye: '#bff4ff', dark: '#05141f', metal: '#d8e8ee'
    },
    body: { w: 0.88, shoulder: 0.86, bulk: 0.9, leg: 1.08 },
    crown: 'sail', timer: 'teardrop', core: 'head', chest: 'wave', weapon: 'bow',
    stats: { hp: 1000, walk: 1.42, dash: 3.7, jump: 7.2, weight: 0.95 },
    portrait: 1,
    overrides: {
      light: { name: '光矢·点射', hitboxes: [hb(5, 7, 30, -70, 48, 20)] },
      heavy: { name: '光矢·贯穿', startup: 13, recovery: 21, damage: 72 },
      special: {
        name: '潮汐刃', anim: 'special',
        damage: 0, startup: 14, active: 1, recovery: 26,
        hitboxes: [], spawnFrame: 14,
        projectile: { speed: 5.4, w: 22, h: 10, life: 110, damage: 74, hitstun: 18, level: 'mid', color: '#57d8ff' }
      },
      super: { name: '深海漩涡' }
    }
  }),

  /* ③ 曜金·索拉 SOLAR：金黄 + 白，八芒太阳轮，日冕环冠 */
  makeHero({
    id: 'solar', name: '曜金·索拉', short: '索拉', title: '突进型', role: '突进',
    desc: '日轮突进，压制全场。',
    palette: {
      base: '#fffaf0', base2: '#efdcae', suit: '#e8b33b', suit2: '#a97a16',
      accent: '#fff3b0', eye: '#fffbe0', dark: '#241503', metal: '#ffffff'
    },
    body: { w: 1.06, shoulder: 1.14, bulk: 1.06, leg: 1.0 },
    crown: 'corona', timer: 'sun', core: 'chest', chest: 'plate', weapon: 'fist',
    stats: { hp: 1000, walk: 1.95, dash: 4.9, jump: 7.3, weight: 0.9 },
    portrait: 2,
    overrides: {
      light: { name: '疾拳·连打', startup: 4, damage: 28, recovery: 8 },
      heavy: { name: '烈踢·破空', startup: 9, damage: 70, recovery: 17 },
      special: { name: '日冕冲锋', startup: 10, damage: 96, push: 4.8, dash: 5.5 },
      super: { name: '耀斑坠击' }
    }
  }),

  /* ④ 幽紫·奈克缇 NOCTIS：幽紫 + 暗银，额前六芒星，蝠翼双角 */
  makeHero({
    id: 'noctis', name: '幽紫·奈克缇', short: '奈克缇', title: '奇袭型', role: '奇袭',
    desc: '影步绕后，六芒暗袭。',
    palette: {
      base: '#efe6ff', base2: '#b9a8d6', suit: '#6c4bb6', suit2: '#3e2870',
      accent: '#ff5cf0', eye: '#ff9bf5', dark: '#0d0618', metal: '#8f8aa3'
    },
    body: { w: 0.88, shoulder: 0.88, bulk: 0.86, leg: 1.08 },
    crown: 'batwing', timer: 'star', core: 'head', chest: 'core', weapon: 'dagger',
    stats: { hp: 1000, walk: 1.78, dash: 4.4, jump: 7.5, weight: 0.88 },
    portrait: 3,
    overrides: {
      low: { name: '影足·断隙', damage: 30, startup: 5 },
      heavy: { name: '影刃·回旋', damage: 72 },
      special: { name: '暗影跃斩', mechanic: 'teleport', startup: 11, damage: 92, spawnFrame: 11 },
      super: { name: '虚空吞噬' }
    }
  }),

  /* ⑤ 翡翠·维尔德 VERDE：翠绿 + 银，叶脉核心，藤冠，重型投技 */
  makeHero({
    id: 'verde', name: '翡翠·维尔德', short: '维尔德', title: '投技型', role: '投技',
    desc: '藤冠投技，近身绞杀。',
    palette: {
      base: '#e9fff4', base2: '#a9dcc2', suit: '#35a472', suit2: '#1f6b4a',
      accent: '#8cf0a8', eye: '#b6ffcf', dark: '#04140d', metal: '#c7d5ce'
    },
    body: { w: 1.16, shoulder: 1.18, bulk: 1.2, leg: 1.0 },
    crown: 'vine', timer: 'leaf', core: 'chest', chest: 'plate', weapon: 'fist',
    stats: { hp: 1000, walk: 1.28, dash: 3.4, jump: 6.4, weight: 1.2 },
    portrait: 4,
    overrides: {
      light: { name: '铁掌·推山', damage: 36, push: 2.4 },
      heavy: { name: '重拳·崩岳', startup: 14, damage: 88, recovery: 22 },
      special: {
        name: '藤蔓缠缚', level: 'throw', damage: 150, startup: 7,
        active: 2, recovery: 28, knockdown: true, push: 5.5,
        hitboxes: [hb(7, 8, 28, -58, 46, 56)]
      },
      super: { name: '巨木审判' }
    }
  }),

  /* ⑥ 霜白·格莱斯 GLACE：冰白 + 浅蓝，六边冰晶，冰棱冠，最重装 */
  makeHero({
    id: 'glace', name: '霜白·格莱斯', short: '格莱斯', title: '重装型', role: '重装',
    desc: '冰晶重装，霸体反打。',
    palette: {
      base: '#ffffff', base2: '#cfe6f2', suit: '#e6f2f8', suit2: '#a7c6d8',
      accent: '#7fc4e8', eye: '#d9f6ff', dark: '#0a1a24', metal: '#7fc4e8'
    },
    body: { w: 1.24, shoulder: 1.3, bulk: 1.3, leg: 1.02 },
    crown: 'ice', timer: 'hex', core: 'chest', chest: 'plate', weapon: 'fist',
    stats: { hp: 1000, walk: 1.16, dash: 3.1, jump: 6.1, weight: 1.32 },
    portrait: 5,
    overrides: {
      light: { name: '寒拳·碎冰', damage: 38, startup: 7, recovery: 11 },
      heavy: { name: '冰锤·落霜', startup: 15, damage: 96, recovery: 24, armor: 1, knockdown: true },
      special: {
        name: '冰墙突刺', startup: 18, damage: 128, recovery: 28,
        armor: 1, knockdown: true, hitSfx: 'hitSuper'
      },
      super: { name: '绝对零度' }
    }
  })
];

export const HERO_BY_ID = Object.fromEntries(HEROES.map((h) => [h.id, h]));
