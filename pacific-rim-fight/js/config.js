/* =============================================================================
 * config.js  ──  全局配置与参数（CONFIG / INPUT_CONFIG）
 * 所有数值、参数、按键映射统一存放于此，其它模块只读取、不硬编码。
 * 依赖：无（本文件必须最先加载）
 * 加载方式：普通 <script>（非 module），挂载到 window.GAME
 * ========================================================================== */
(function (global) {
  'use strict';

  var GAME = global.GAME = global.GAME || {};
  GAME.VERSION = '1.0.0';

  /* ---------------------------------------------------------------------------
   * 第三方库 CDN（稳定链接，纯静态引用，无需构建工具）
   * three r170 只提供 ESM 构建，因此 index.html 用 importmap 引入；
   * Ammo.js 使用 asm.js 构建（单文件、无独立 .wasm，双击 index.html 也能加载）。
   * ------------------------------------------------------------------------ */
  GAME.CDN = {
    three: 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js',
    threeAddons: 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/',
    ammo: 'https://cdn.jsdelivr.net/gh/kripken/ammo.js@master/builds/ammo.js',
    ammoWasm: 'https://cdn.jsdelivr.net/gh/kripken/ammo.js@master/builds/ammo.wasm.js'
  };

  /* ===========================================================================
   * 1. 渲染 / 场景 / 美术风格（夜晚临海城市废墟，对标环太平洋香港中环）
   * ======================================================================== */
  var ART = {
    /* 美术调色板：整体偏暗、高对比，主光来自城市灯光/爆炸火光/单位自发光 */
    palette: {
      skyTop: 0x08131a,       // 天空顶部：暗蓝绿
      skyBottom: 0x1a2f36,    // 天空底部（靠近地平线）
      cloud: 0x14262c,        // 阴云
      lightning: 0x9fd8ff,    // 远处低频雷电
      fog: 0x0d1e24,          // 体积雾/远景雾色
      groundDiffuse: 0x141618,// 碎石柏油路面
      concrete: 0x2a2c2e,     // 混凝土废墟
      buildingA: 0x1c2226,    // 远景摩天楼基色
      buildingB: 0x232a2f,
      windowWarm: 0xffc86b,   // 远景窗户暖黄灯
      windowCold: 0xbfe3ff,   // 少量冷白窗
      lampLight: 0xffd9a0,    // 路灯
      searchLight: 0xdff1ff,  // 楼顶探照灯
      emberOrange: 0xff7a1e,  // 爆炸火光
      smoke: 0x2b3236,        // 浓烟
      roadLine: 0x8a8f93,     // 路面标线
      barrier: 0xd8442c       // 路障
    },
    /* 单位发光色（机甲冷蓝/橙黄，怪兽青绿） */
    mechaGlow: { balanced: 0x6fd0ff, heavy: 0xff9540 },
    kaijuGlow: { fast: 0x69ffc8, tank: 0x8ce0ff },

    /* 城市分层视差参数（远景/中景/近景三层） */
    city: {
      far: { count: 46, xRange: 260, zStart: -150, zEnd: -420, minH: 40, maxH: 110, style: 'skyline' },
      mid: { count: 22, xRange: 150, zStart: -60, zEnd: -150, minH: 22, maxH: 60, style: 'damaged' },
      near: { count: 12, xRange: 90, zStart: -34, zEnd: -60, minH: 10, maxH: 26, style: 'ruin', destructible: true },
      /* 战场两侧的废墟楼宇（可被撞毁，产生碎片） */
      side: { count: 8, xRange: 34, zStart: -26, zEnd: 12, minH: 12, maxH: 30, destructible: true }
    },

    /* 氛围效果开关 */
    atmosphere: {
      groundFog: true,        // 地面层体积雾遮挡远景底部
      risingSmoke: true,      // 中景上升浓烟
      embers: true,           // 漂浮火星
      distantLightning: true, // 远处低频雷电闪烁
      searchLights: true,     // 楼顶探照灯扫射
      rain: true              // 雨夜雨幕
    }
  };

  /* ===========================================================================
   * ART_CONFIG —— 视觉参数统一管理（材质 / 贴图 / 建筑 / 雨雾 / 灯光 / 受击反馈）
   *   所有可调视觉量集中于此，models.js / renderer.js 统一读取，便于迭代调参。
   *   与 ART.palette / ART.city / ART.atmosphere 并存，旧字段保留向后兼容。
   * ======================================================================== */
  var ART_CONFIG = {
    /* ---------- 单位 PBR 材质默认值 ---------- */
    material: {
      mecha: { metalness: 0.62, roughness: 0.5,  envMapIntensity: 1.0 },
      accent:{ metalness: 0.72, roughness: 0.42, envMapIntensity: 1.0 },
      dark:  { metalness: 0.5,  roughness: 0.66, envMapIntensity: 0.8 },
      kaijuSkin: { metalness: 0.05, roughness: 0.9 },
      kaijuBelly:{ metalness: 0.05, roughness: 0.85 },
      kaijuPlate:{ metalness: 0.35, roughness: 0.8 },
      defaultMetalness: 0.55,
      defaultRoughness: 0.5
    },
    /* ---------- 发光 ---------- */
    glow: {
      mechaCore: 1.15,        // 机甲主反应堆自发光强度
      mechaWarm: 0.85,        // 机甲暖辅光
      kaijuCore: 0.95,        // 怪兽主发光
      kaijuSoft: 0.6,         // 怪兽软发光
      pulseSpeed: 1.6,        // 发光呼吸频率（Hz）
      pulseDepth: 0.18,       // 呼吸幅度（0~1）
      hitFlashIntensity: 2.4  // 受击闪白峰值 emissiveIntensity
    },
    /* ---------- 程序化贴图（机甲 / 怪兽） ---------- */
    unitTexture: {
      mechaPanelGap: 64,      // 面板缝隙间隔(px)
      mechaRivetsPerPanel: 3, // 每格铆钉数
      mechaScratchCount: 90,  // 划痕条数
      kaijuScaleCount: 1400,  // 鳞片斑点数
      kaijuScaleGrid: 26,     // 鳞片网格间距
      dirt: 0.18              // 污渍密度上限
    },
    /* ---------- 城市多层建筑 ---------- */
    building: {
      tiersMin: 2, tiersMax: 4,           // 每层楼段数
      setback: 0.12,                      // 每往上一层缩进比例
      windowLitChance: 0.42,              // 窗户点亮概率
      windowWarmRatio: 0.70,              // 暖光窗占比
      emissiveIntensity: 0.55,            // 远景窗户自发光
      nearEmissiveIntensity: 0.72,        // 近景窗户自发光（更亮）
      damageTop: true,                    // 顶部破损
      rebarCount: 3,                      // 暴露钢筋数
      windowTexSize: 128                  // 窗户贴图分辨率
    },
    /* ---------- 雨夜 ---------- */
    rain: {
      enabled: true,
      count: 1800,             // 雨滴数量
      area: { x: 140, z: 120 },// 雨幕覆盖范围（以战场为中心）
      heightMin: 2, heightMax: 46,
      fallSpeed: 38,           // 下落速度
      wind: -3.5,              // 水平风速（向左）
      streakLen: 2.2,          // 雨丝长度
      opacity: 0.42,
      splashCount: 140,        // 地面溅水点
      splashLife: 0.35
    },
    /* ---------- 体积雾 ---------- */
    fog: {
      groundLayers: 6,         // 地面雾平面层数
      groundOpacity: 0.5,      // 地面雾基础不透明度
      groundHeight: 12,        // 地面雾总高度
      driftSpeed: 0.06,
      wetRoughness: 0.38,      // 雨后地面粗糙度（更光滑=反射更强）
      wetMetalness: 0.35       // 雨后地面金属度
    },
    /* ---------- 灯光 ---------- */
    light: {
      searchlightCount: 3,
      searchlightConeOpacity: 0.07,
      searchlightSweep: 0.9,   // 扫射摆角
      rimIntensity: 0.42,      // 冷色轮廓补光
      moonIntensity: 0.75,
      hemiIntensity: 0.34,
      ambIntensity: 0.10
    },
    /* ---------- 受击反馈 ---------- */
    hitFlash: {
      duration: 0.18,          // 闪白持续（秒）
      decay: 5.5,              // 衰减系数
      color: 0xffffff          // 闪白色（白）
    }
  };

  /* ===========================================================================
   * 2. 相机（固定横向 2.5D 视角，自动框住双方单位）
   * ======================================================================== */
  var CAMERA = {
    fov: 42,
    near: 0.5,
    far: 1200,
    mode: 'side',             // 固定横向视角（不可自由旋转）
    height: 12,               // 相机高度
    lookHeight: 6,            // 注视点高度
    baseDistance: 36,         // 基准横向距离（沿 +Z 看向战场）
    minDistance: 22,
    maxDistance: 54,
    maxZ: 26,                 // 相机 z 上限（永远位于战场 +Z 侧）
    framePadding: 6,          // 自动取景时双方外扩距离（收紧 → 单位占屏更大）
    followLerp: 4.2,          // 相机位置跟随平滑
    distLerp: 2.6,            // 距离缩放平滑
    heightLerp: 3.0,
    shake: {                  // 重击屏幕震动
      decay: 6.5,             // 衰减速度（指数）
      max: 1.5,               // 位移上限（世界单位）
      rotScale: 0.5,          // 旋转震动系数
      triggerScale: 0.02      // 伤害 → 震动强度换算
    },
    ultimateZoom: {           // 必杀技镜头小幅缩放
      scale: 0.78,            // 距离乘数（越小越近）
      time: 0.35,
      hold: 1.6
    },
    /* 预置：少量机位偏移，避免完全笔直 */
    offsetY: 1.5
  };

  /* ===========================================================================
   * 3. 场景 / 竞技场与物理世界
   * ======================================================================== */
  var ARENA = {
    width: 96,                // 战场可活动宽度（x ∈ [-48, 48]）
    depth: 30,                // 战场纵深（z ∈ [-15, 15]）
    light2D: true,            // 2.5D 战斗：主要活动在一条横轴上
    minSeparation: 4.5,       // 双方最小间距（防重叠）
    spawn: { player: { x: -26, z: 0 }, enemy: { x: 26, z: 0 } },
    gravity: -32,             // 重力加速度（世界单位/s²，重型单位手感）
    groundFriction: 0.86,
    airDrag: 0.02
  };

  /* ===========================================================================
   * 4. 战斗数值（三大属性：HP / STAMINA / ENERGY）
   * ======================================================================== */
  var COMBAT = {
    /* 时间轴（秒）：所有动作 = 起手(startup) + 判定(active) + 收招(recovery) */
    timing: {
      hitstop: 0.075,          // 命中顿帧（打击重量感核心）
      hitstopHeavy: 0.14,
      hitstopUltimate: 0.45,
      comboWindow: 0.9,        // 连击窗口
      comboResetTime: 1.2
    },

    /* 动作表：范围 range 以“双方中心距离”计，判定为扇形（角度见 arc） */
    moves: {
      light: {                 // 轻攻击：快、低伤、低硬直，可连段
        label: '轻攻击', startup: 0.16, active: 0.12, recovery: 0.20,
        damage: 34, range: 7.5, arc: 100, stun: 5, knockback: 2.4,
        staminaCost: 0, energyGain: 6, breakGuard: false, blockable: true,
        sound: 'light', animation: 'light', comboMax: 3, groundShake: 0.35
      },
      heavy: {                 // 重攻击：慢、高伤、高硬直，可破防
        label: '重攻击', startup: 0.42, active: 0.16, recovery: 0.52,
        damage: 96, range: 9.0, arc: 80, stun: 25, knockback: 7.5,
        staminaCost: 18, energyGain: 12, breakGuard: true, blockable: true,
        sound: 'heavy', animation: 'heavy', comboMax: 1, groundShake: 1.0
      },
      skill: {                 // 武器技能：机炮/刀刃，消耗少量能量
        label: '武器技能', startup: 0.22, active: 0.30, recovery: 0.34,
        damage: 58, range: 12.0, arc: 60, stun: 12, knockback: 4.2,
        energyCost: 15, energyGain: 4, breakGuard: false, blockable: true,
        sound: 'skill', animation: 'skill', comboMax: 2, groundShake: 0.6
      },
      ultimate: {              // 必杀技：满能量释放，专属演出
        label: '必杀技', startup: 0.75, active: 0.60, recovery: 0.95,
        damage: 260, range: 15.0, arc: 140, stun: 60, knockback: 13.0,
        energyCost: 100, energyGain: 0, breakGuard: true, blockable: false,
        sound: 'ultimate', animation: 'ultimate', comboMax: 1, groundShake: 2.0,
        unblockable: true, cinematic: true
      },
      /* 怪兽专用动作 */
      bite: {                  // 撕咬连击
        label: '撕咬', startup: 0.18, active: 0.14, recovery: 0.24,
        damage: 40, range: 7.0, arc: 70, stun: 7, knockback: 3.0,
        energyGain: 6, blockable: true, animation: 'bite', comboMax: 3, groundShake: 0.35
      },
      tail: {                  // 尾击：中距离横扫
        label: '尾击', startup: 0.40, active: 0.18, recovery: 0.48,
        damage: 82, range: 11.0, arc: 150, stun: 22, knockback: 6.8,
        energyGain: 11, blockable: true, breakGuard: false, animation: 'tail', comboMax: 1, groundShake: 0.9
      },
      charge: {                // 冲撞：远距离突进
        label: '冲撞', startup: 0.52, active: 0.42, recovery: 0.70,
        damage: 120, range: 16.0, arc: 55, stun: 34, knockback: 11.0,
        energyGain: 14, blockable: true, breakGuard: true, animation: 'charge', comboMax: 1, groundShake: 1.4,
        dashSpeed: 22
      }
    },

    /* 部位判定：正面 / 侧面 / 背面 伤害系数 */
    facing: {
      front: 1.0, side: 1.15, back: 1.35,
      frontAngle: 60,           // ±60° 视为正面
      sideAngle: 120            // ±60°~±120° 为侧面，其余为背面
    },
    /* 命中部位（高度）判定 */
    part: { high: 1.1, mid: 1.0, low: 0.9 },

    /* 三大属性规则 */
    hp: { regen: 0 },
    stamina: {
      max: 100,
      regen: 14,                // 每秒自动恢复
      regenDelay: 0.8,          // 消耗后延迟恢复
      dodgeCost: 22,
      blockDrainRate: 26,       // 持续格挡每秒消耗
      blockBreakRecovery: 1.4,  // 破防硬直时长
      exhaustedPenalty: 0.55    // 耐力不足时动作速度惩罚
    },
    energy: {
      max: 100,
      regen: 1.6,               // 每秒自然恢复
      gainOnHitTaken: 4.0,      // 受击积攒
      gainOnBlock: 2.5,
      ultimateReadyAt: 100
    },
    stun: {                     // 连续命中积累眩晕值
      max: 100,
      decayRate: 12,            // 每秒衰减
      duration: 2.4,            // 满值眩晕时长
      hitDecayDelay: 1.0
    },
    block: {
      damageReduction: 0.72,    // 正面减伤 72%
      knockbackReduction: 0.6,
      stunReduction: 0.7,
      breakStunDuration: 1.4
    },
    dodge: {
      duration: 0.46,
      invulnStart: 0.05,        // 无敌帧起
      invulnEnd: 0.34,          // 无敌帧止
      distance: 11.5,
      direction: { back: 0.75, side: 1.0 }  // 侧向移动更远
    },
    /* 反应与受击反馈 */
    hitReactions: {
      hitStopLight: 0.05,
      hitStopHeavy: 0.13,
      knockbackScale: 1.0,
      positionFeedback: true,   // 受击有位置反馈
      hitShake: 0.6
    },
    /* 连击与眩晕奖励 */
    combo: { bonusPerHit: 0.04, maxBonus: 0.4 },

    /* 场景可破坏建筑 */
    destructible: {
      hp: 120,
      explosionRadius: 9,
      explosionDamage: 26,
      debrisCount: 14,
      debrisLife: 6.0,
      collapseSpeed: 1.0
    },
    /* 胜负 */
    rules: { rounds: 1, mode: 'single', timeLimit: 0, slowMoOnKO: true, koSlowMo: 0.28 }
  };

  /* ===========================================================================
   * 5. 单位数据（2 台玩家机甲 + 2 种敌方怪兽）
   *    ── 模型替换接口：model.url 指向 assets/models/*.glb 即自动替换低模占位
   * ======================================================================== */
  var MECHA_BASE = {
    faction: 'mecha',
    height: 9.5,
    radius: 3.2,
    animations: {
      idle: 'idle', walk: 'walk', run: 'run', light: 'light', heavy: 'heavy',
      skill: 'skill', dodge: 'dodge', block: 'block', hit: 'hit', death: 'death',
      ultimate: 'ultimate'
    }
  };
  var KAIJU_BASE = {
    faction: 'kaiju',
    height: 11.0,
    radius: 3.6,
    animations: {
      idle: 'idle', walk: 'walk', run: 'run', bite: 'bite', tail: 'tail',
      charge: 'charge', hit: 'hit', roar: 'roar', death: 'death'
    }
  };

  var MECHAS = [
    {
      id: 'mecha_balanced',
      style: 'balanced',                     // 均衡型
      name: '游侠 · 赤色风暴',
      nameEn: 'RANGER CRIMSON STORM',
      tag: '均衡型',
      desc: '第 5 代猎手机甲，双腕等离子链锯，攻守均衡、机动灵活。',
      hp: 1000, attack: 1.0, defense: 1.0, speed: 1.05, energyRegen: 1.25,
      stamina: 110, stunResist: 0.0,
      glow: ART.mechaGlow.balanced,          // 胸口反应堆 / 眼部：冷蓝
      accent: 0xc0392b,                      // 装甲主色：赤红
      armor: 0x4a5057,
      weapon: { type: 'blade', name: '等离子链锯', skillName: '链锯连斩' },
      ultimate: { name: '反应堆超载 · 双刃风暴', desc: '反应堆超载，双腕链锯高速连斩，无视格挡。' },
      scale: 1.0,
      model: { type: 'procedural', url: null, clips: null }   // ← 替换高清 GLTF 的接口
    },
    {
      id: 'mecha_heavy',
      style: 'heavy',                        // 重击型
      name: '切尔诺 · 西伯利亚',
      nameEn: 'CHERNO SIBERIA',
      tag: '重击型',
      desc: '第一代重装猎手，双层装甲、涡轮链拳，速度慢但正面压制极强。',
      hp: 1360, attack: 1.22, defense: 1.32, speed: 0.84, energyRegen: 1.0,
      stamina: 130, stunResist: 0.25,
      glow: ART.mechaGlow.heavy,             // 橙黄
      accent: 0x2f6f4f,
      armor: 0x53585c,
      weapon: { type: 'cannon', name: '腕部机炮', skillName: '燃烧弹齐射' },
      ultimate: { name: '涡轮超载 · 铁拳镇海', desc: '涡轮增压全力轰击，附带冲击波击退。' },
      scale: 1.12,
      model: { type: 'procedural', url: null, clips: null }
    }
  ];

  var KAIJUS = [
    {
      id: 'kaiju_fast',
      style: 'fast',                         // 速攻型
      name: '镰刃魔',
      nameEn: 'SCYTHE FIEND',
      tag: '速攻型',
      desc: '两足高速开菊兽，前肢双镰，习惯连续撕咬与突进扑击。',
      hp: 900, attack: 0.95, defense: 0.88, speed: 1.28, energyRegen: 1.2,
      stamina: 100, stunResist: 0.1,
      glow: ART.kaijuGlow.fast,              // 青绿荧光
      skin: 0x4b6b52,
      belly: 0x7d8a6a,
      ai: { aggression: 1.35, reaction: 0.30, comboRate: 0.85, guardRate: 0.18, dodgeRate: 0.34, prefer: 'close' },
      ultimate: { name: '狂暴撕咬', desc: '进入狂暴状态，撕咬速度大幅提升。' },
      scale: 1.0,
      model: { type: 'procedural', url: null, clips: null }
    },
    {
      id: 'kaiju_tank',
      style: 'tank',                         // 重甲型
      name: '铁背山岳',
      nameEn: 'IRONBACK MOUNTAIN',
      tag: '重甲型',
      desc: '三级重甲开菊兽，背部甲板提供巨大防护，冲撞可摧毁楼宇。',
      hp: 1420, attack: 1.18, defense: 1.35, speed: 0.82, energyRegen: 0.95,
      stamina: 125, stunResist: 0.3,
      glow: ART.kaijuGlow.tank,
      skin: 0x3f4a52,
      belly: 0x6b7276,
      ai: { aggression: 0.95, reaction: 0.50, comboRate: 0.55, guardRate: 0.34, dodgeRate: 0.14, prefer: 'mid' },
      ultimate: { name: '甲板冲撞', desc: '全身甲板前倾，长距离冲撞并将敌人撞飞。' },
      scale: 1.24,
      model: { type: 'procedural', url: null, clips: null }
    }
  ];
  MECHAS.forEach(function (m) { for (var k in MECHA_BASE) if (!(k in m)) m[k] = MECHA_BASE[k]; });
  KAIJUS.forEach(function (m) { for (var k in KAIJU_BASE) if (!(k in m)) m[k] = KAIJU_BASE[k]; });

  /* ===========================================================================
   * 6. AI 三档难度
   * ======================================================================== */
  var AI = {
    difficulty: 'normal',
    levels: {
      easy:   { name: '简单', reaction: 0.75, attackRate: 0.55, damageScale: 0.75, defenseScale: 0.85, moveSpeed: 0.85, mistakeRate: 0.30 },
      normal: { name: '普通', reaction: 0.42, attackRate: 1.0,  damageScale: 1.0,  defenseScale: 1.0,  moveSpeed: 1.0,  mistakeRate: 0.14 },
      hard:   { name: '困难', reaction: 0.22, attackRate: 1.45, damageScale: 1.2,  defenseScale: 1.15, moveSpeed: 1.12, mistakeRate: 0.05 }
    },
    /* 距离决策阈值 */
    ranges: { far: 22, mid: 12, close: 6.5, retreat: 4.0 },
    /* 行为状态：巡逻 / 接近 / 战斗 / 防守 / 咆哮 */
    states: {
      patrol: { speed: 0.35, switchChance: 0.6 },
      approach: { speed: 1.0 },
      combat: { speed: 0.75 },
      guard: { duration: 0.9 },
      roar: { duration: 1.6, cooldown: 12 }
    }
  };

  /* ===========================================================================
   * 7. 输入配置（INPUT_CONFIG）── 键盘 + 手柄，集中管理便于修改
   * ======================================================================== */
  var INPUT_CONFIG = {
    /* --- 键盘映射：一个动作可绑定多个键（KeyboardEvent.code）--- */
    keyboard: {
      left:     ['KeyA', 'ArrowLeft'],
      right:    ['KeyD', 'ArrowRight'],
      forward:  ['KeyW', 'ArrowUp'],
      back:     ['KeyS', 'ArrowDown'],
      light:    ['KeyJ'],            // 轻攻击
      heavy:    ['KeyK'],            // 重攻击
      dodge:    ['KeyL'],            // 闪避
      block:    ['Space'],           // 格挡
      skill:    ['KeyU'],            // 武器技能
      ultimate: ['KeyI'],            // 必杀技
      pause:    ['KeyP', 'Escape'],  // 暂停
      confirm:  ['Enter', 'KeyJ'],   // 菜单确认
      cancel:   ['Escape', 'Backspace'],
      menuUp:   ['KeyW', 'ArrowUp'],
      menuDown: ['KeyS', 'ArrowDown'],
      menuLeft: ['KeyA', 'ArrowLeft'],
      menuRight:['KeyD', 'ArrowRight'],
      debug:    ['F3']
    },

    /* --- 手柄映射（W3C 标准映射，Xbox 布局索引）--- */
    gamepad: {
      buttons: {
        light: 2,           // X / □ 轻攻击
        heavy: 3,           // Y / △ 重攻击
        dodge: 0,           // A / × 闪避
        block: 1,           // B / ○ 格挡
        skill: 4,           // LB / L1 武器技能
        ultimate: 7,        // RT / R2 必杀技
        pause: 9,           // Start 暂停
        confirm: 0,         // A 确认
        cancel: 1,          // B 返回
        menuUp: 12, menuDown: 13, menuLeft: 14, menuRight: 15
      },
      axes: { moveX: 0, moveY: 1 },
      deadzone: 0.20,
      triggerThreshold: 0.35,       // 扳机（RT）模拟量阈值
      triggerAxes: { l2: 6, r2: 5 },// 部分手柄扳机在轴上
      pollInterval: 1 / 60
    },

    /* --- 动态按键提示文案：全局按当前活跃设备自动切换 --- */
    prompts: {
      keyboard: {
        label: '键盘模式',
        light: 'J', heavy: 'K', dodge: 'L', block: '空格', skill: 'U', ultimate: 'I',
        pause: 'P', confirm: 'Enter', cancel: 'Esc',
        move: 'WASD', menu: 'W/S 选择 · Enter 确认 · Esc 返回'
      },
      gamepad: {   // Xbox 布局
        label: '手柄模式',
        light: 'X', heavy: 'Y', dodge: 'A', block: 'B', skill: 'LB', ultimate: 'RT',
        pause: 'Start', confirm: 'A', cancel: 'B',
        move: '左摇杆', menu: '摇杆选择 · A 确认 · B 返回'
      },
      /* PlayStation 手柄自动切换为 □△×○ 文案 */
      ps: {
        label: '手柄模式',
        light: '□', heavy: '△', dodge: '×', block: '○', skill: 'L1', ultimate: 'R2',
        pause: 'Options', confirm: '×', cancel: '○',
        move: '左摇杆', menu: '摇杆选择 · × 确认 · ○ 返回'
      }
    },
    promptActionNames: {
      light: '轻攻', heavy: '重攻', dodge: '闪避', block: '格挡',
      skill: '技能', ultimate: '必杀', pause: '暂停', confirm: '确认', cancel: '返回'
    },
    /* 设备切换：输入静默多久后允许切换活跃设备（秒） */
    deviceSwitchIdle: 0.15,
    defaultDevice: 'keyboard'
  };

  /* ===========================================================================
   * 8. UI 文案与 HUD 参数
   * ======================================================================== */
  var UI = {
    texts: {
      title: '环太平洋 · 机甲对决',
      subtitle: 'PACIFIC RIM — MECHA COMBAT',
      start: '开始游戏', select: '机甲选择', help: '操作说明', quit: '退出',
      resume: '继续战斗', restart: '重新开始', mainMenu: '返回主菜单',
      rematch: '再战一局', victory: '胜利', defeat: '战败',
      roundStart: '准备战斗', fight: 'FIGHT!', ko: 'K.O.',
      loading: '正在加载战场资源',
      controllerPad: '控制器：已连接手柄', controllerKb: '控制器：键盘模式',
      difficulty: '难度', player: '玩家', enemy: '敌方',
      ultimateReady: '必杀技就绪'
    },
    hud: {
      barSegments: 12,          // 分段式血条
      lowHpThreshold: 0.30,     // 低于 30% 红色闪烁
      lowHpBlinkRate: 3.2,
      damageNumberLife: 0.9,
      showCombo: true,
      showStun: true
    },
    screen: {
      fadeTime: 0.35,
      roundIntro: 1.8,
      koDelay: 1.2,
      resultDelay: 1.6
    }
  };

  /* ===========================================================================
   * 9. 模型替换接口（GLTF / GLB）
   *    · 把高清模型放进 assets/models/ 并在对应单位 model.url 填相对路径即可自动替换
   *    · clips 可指定自定义动画片段名映射；留空则使用 models.js 生成的程序化动画
   * ======================================================================== */
  var MODELS = {
    basePath: 'assets/models/',           // 相对路径，不以 / 开头
    texturePath: 'assets/textures/',
    enableGLTF: true,                     // 关闭则强制使用程序化低模占位
    /* 预置替换清单（示例：填好 url 即可替换，无需改代码）*/
    manifest: {
      mecha_balanced: { url: null, scale: 1, rotationY: 0 },
      mecha_heavy:    { url: null, scale: 1, rotationY: 0 },
      kaiju_fast:     { url: null, scale: 1, rotationY: 0 },
      kaiju_tank:     { url: null, scale: 1, rotationY: 0 },
      cityBlock:      { url: null, scale: 1, rotationY: 0 }
    }
  };

  /* ===========================================================================
   * 10. 音频（WebAudio 程序化音效，无外部音频文件）
   * ======================================================================== */
  var AUDIO = {
    enabled: true,
    masterVolume: 0.5,
    sfxVolume: 0.6,
    ambientVolume: 0.35,
    sounds: {
      light:   { type: 'noise', freq: 780, dur: 0.12, gain: 0.5 },
      heavy:   { type: 'noise', freq: 320, dur: 0.34, gain: 0.9 },
      skill:   { type: 'square', freq: 240, dur: 0.22, gain: 0.4 },
      ultimate:{ type: 'sawtooth', freq: 90, dur: 1.2, gain: 1.0 },
      hit:     { type: 'noise', freq: 180, dur: 0.18, gain: 0.7 },
      block:   { type: 'square', freq: 520, dur: 0.14, gain: 0.35 },
      step:    { type: 'sine', freq: 70, dur: 0.16, gain: 0.35 },
      roar:    { type: 'sawtooth', freq: 120, dur: 1.0, gain: 0.8 },
      explosion:{ type: 'noise', freq: 140, dur: 0.7, gain: 0.9 },
      thunder: { type: 'noise', freq: 60, dur: 1.4, gain: 0.5 },
      uiMove:  { type: 'square', freq: 640, dur: 0.06, gain: 0.22 },
      uiConfirm:{ type: 'square', freq: 880, dur: 0.10, gain: 0.3 }
    }
  };

  /* ===========================================================================
   * 11. 调试开关
   * ======================================================================== */
  var DEBUG = {
    showHitboxes: false,
    showStats: false,
    invincible: false,
    infiniteEnergy: false,
    skipIntro: false
  };

  /* ===========================================================================
   * 12. 性能与渲染器
   * ======================================================================== */
  var RENDER = {
    pixelRatioCap: 1.75,
    antialias: true,
    shadows: { enabled: true, type: 'PCFSoft', mapSize: 2048, radius: 4 },
    toneMapping: { type: 'ACESFilmic', exposure: 1.12 },
    outputColorSpace: 'srgb',
    /* 泛光：降低强度、抬高阈值，让自发光回归“点缀”而非吞掉本体 */
    bloom: { enabled: true, strength: 0.55, radius: 0.6, threshold: 0.72 },
    /* IBL 环境贴图：为 PBR 金属提供环境反射（金属漫反射为 0，无环境反射即全黑） */
    envMap: { enabled: true, intensity: 0.62, blur: 0.04 },
    vignette: { enabled: true, offset: 1.05, darkness: 0.62 },
    filmGrain: { enabled: true, intensity: 0.055 },   // 极淡胶片颗粒
    fog: { enabled: true, near: 40, far: 340, density: 0.0038 },
    groundFogPass: { enabled: true, height: 7, opacity: 0.55 },
    maxLights: { point: 6, spot: 3 },
    resolutionScale: 1.0
  };

  /* ===========================================================================
   * 汇总导出
   * ======================================================================== */
  GAME.CONFIG = {
    art: ART,
    artConfig: ART_CONFIG,
    camera: CAMERA,
    arena: ARENA,
    combat: COMBAT,
    units: { mechas: MECHAS, kaiju: KAIJUS },
    ai: AI,
    ui: UI,
    models: MODELS,
    audio: AUDIO,
    render: RENDER,
    debug: DEBUG,
    /* 便捷索引 */
    findUnit: function (id) {
      var i, list = [MECHAS, KAIJUS];
      for (i = 0; i < list.length; i++) {
        for (var j = 0; j < list[i].length; j++) if (list[i][j].id === id) return list[i][j];
      }
      return null;
    }
  };
  GAME.ART_CONFIG = ART_CONFIG;   // 全局便捷访问：视觉参数统一入口
  GAME.INPUT_CONFIG = INPUT_CONFIG;
  GAME.CONFIG.input = INPUT_CONFIG;

  /* ===========================================================================
   * 通用小工具（全局，避免各模块重复实现）
   * ======================================================================== */
  GAME.U = {
    clamp: function (v, a, b) { return v < a ? a : (v > b ? b : v); },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    /* 帧率无关的指数插值 */
    damp: function (a, b, lambda, dt) { return GAME.U.lerp(a, b, 1 - Math.exp(-lambda * dt)); },
    rand: function (a, b) { return a + Math.random() * (b - a); },
    randInt: function (a, b) { return Math.floor(a + Math.random() * (b - a + 1)); },
    pick: function (arr) { return arr[Math.floor(Math.random() * arr.length)]; },
    sign: function (v) { return v < 0 ? -1 : (v > 0 ? 1 : 0); },
    /* 角度差（弧度，范围 -PI~PI） */
    angleDelta: function (a, b) {
      var d = (b - a) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      return d;
    },
    now: function () { return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000; },
    /* 简易对象池 */
    pool: function (factory) {
      var items = [];
      return {
        get: function () { return items.length ? items.pop() : factory(); },
        put: function (it) { items.push(it); }
      };
    },
    /* 事件总线 */
    bus: (function () {
      var map = {};
      return {
        on: function (evt, fn) { (map[evt] = map[evt] || []).push(fn); return fn; },
        off: function (evt, fn) {
          var a = map[evt]; if (!a) return;
          var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
        },
        emit: function (evt, payload) {
          var a = map[evt]; if (!a) return;
          for (var i = 0; i < a.length; i++) { try { a[i](payload); } catch (e) { console.error('[bus]', evt, e); } }
        }
      };
    })()
  };

})(typeof window !== 'undefined' ? window : this);
