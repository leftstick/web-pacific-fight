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
      mecha: { metalness: 0.62, roughness: 0.32,  envMapIntensity: 1.35 },
      accent:{ metalness: 0.72, roughness: 0.26, envMapIntensity: 1.35 },
      dark:  { metalness: 0.5,  roughness: 0.45, envMapIntensity: 1.1 },
      kaijuSkin: { metalness: 0.08, roughness: 0.52 },   /* 生物黏液：略湿反光 */
      kaijuBelly:{ metalness: 0.05, roughness: 0.55 },
      kaijuPlate:{ metalness: 0.35, roughness: 0.48 },   /* 甲壳湿润 */
      defaultMetalness: 0.55,
      defaultRoughness: 0.4
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
      dirt: 0.18,             // 污渍密度上限
      /* 细节贴图强化：颜色贴图 1024、法线/粗糙度 512，避免近距离糊成色块 */
      mapSize: 1024,
      detailSize: 512,
      anisotropy: 8,          // 各向异性过滤（斜视角装甲不再糊）
      normalStrength: { mecha: 0.85, kaiju: 1.15 }  // 法线凹凸强度
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
    },
    /* =========================================================================
     * fx —— 战斗特效统一参数（P2：拖尾 / 火花 / 爆炸 / 护盾波纹 / 镜头震动）
     *   所有数量上限与强度集中于此，renderer.js 读取，便于迭代调参。
     *   纯渲染层：不参与碰撞 / 物理 / 伤害结算。
     * ====================================================================== */
    fx: {
      /* --- 攻击拖尾（带状几何体，追踪右臂世界坐标） --- */
      trail: {
        enabled: true,
        segments: 16,           // 拖尾段数（越大越平滑、越费顶点）
        width: 2.2,             // 头部宽度（世界单位，加宽→等离子链锯感）
        widthFalloff: 0.2,      // 尾部宽度 = 头部 * 该值
        life: 0.28,             // 单段拖尾寿命（秒），决定拖尾长度
        opacity: 0.92,
        /* 各动作拖尾色（机甲冷蓝 / 橙；怪兽青绿） */
        colorLight: 0x6fd0ff,
        colorHeavy: 0xffc86b,
        colorSkill: 0xff7a1e,
        colorUltimate: 0x9fd8ff,
        colorKaiju: 0x69ffc8,
        maxActive: 4            // 同时存在的拖尾条数上限
      },
      /* --- 命中火花 --- */
      spark: {
        pool: 120,              // 池容量
        tiers: {                // level 1 轻 / 2 重 / 3 必杀
          1: { count: 12, speed: 16, life: 0.34, flashSize: 2.6, flashLife: 0.13, light: 5.0, lightLife: 0.18, ring: false, color: 0xdff1ff },
          2: { count: 22, speed: 24, life: 0.50, flashSize: 4.4, flashLife: 0.19, light: 16.0, lightLife: 0.30, ring: false, color: 0xff7a1e },
          3: { count: 38, speed: 32, life: 0.72, flashSize: 7.0, flashLife: 0.28, light: 36.0, lightLife: 0.48, ring: true,  color: 0x9fd8ff }
        }
      },
      /* --- 爆炸（建筑崩塌 / 必杀终结） --- */
      explosion: {
        pool: 6,                // 爆炸实例上限
        radius: 9,              // 爆炸半径
        sparks: 28,             // 迸射火星数
        dustCount: 14,          // 烟尘数
        ringFrom: 1.2, ringTo: 20,
        ringLife: 0.7,
        light: 30, lightLife: 0.5,
        color: 0xff7a1e,
        smokeColor: 0x2b3236
      },
      /* --- 护盾波纹（格挡命中瞬间） --- */
      shield: {
        pool: 8,                // 波纹实例上限
        radiusFrom: 2.0,
        radiusTo: 7.5,
        life: 0.5,
        opacity: 0.7,
        color: 0x6fd0ff
      },
      /* --- 分级镜头震动 --- */
      shake: {
        tiers: {                // level → 强度（叠加、上限由 camera.shake.max 控制）
          1: 0.35,              // 轻攻击
          2: 1.1,               // 重攻击 / 技能
          3: 2.2,               // 必杀技
          4: 1.8                // 建筑崩塌
        },
        decay: 6.0,             // 衰减速度
        rotScale: 0.06          // 旋转震动系数
      },
      /* --- 命中粒子组合：不同动作产生不同粒子（对应提示词3） --- */
      hitCombo: {
        light:    { spark: 5,  impact: 1, blood: 0, slash: 0 },
        heavy:    { spark: 10, impact: 1, blood: 3, slash: 0 },
        skill:    { spark: 8,  impact: 1, blood: 2, slash: 2 },
        ultimate: { spark: 20, impact: 2, blood: 8, slash: 3 },
        bite:     { spark: 6,  impact: 1, blood: 4, slash: 0 },
        tail:     { spark: 12, impact: 1, blood: 2, slash: 2 },
        charge:   { spark: 10, impact: 2, blood: 3, slash: 0 },
        block:    { spark: 8,  impact: 1, blood: 0, slash: 0 },
        perfect:  { spark: 12, impact: 2, blood: 0, slash: 3 }
      },
      bloodColors: [0xb02a3a, 0x8a1f5c, 0x6d1b3f],  // 开菊兽血液（红紫）
      slashColor: 0x9fd8ff,                          // 刀光轨迹（青蓝）
      dodgeColor: 0x8fe3ff,                          // 闪避残影（浅青）
      /* --- 必杀镜头缩放 --- */
      zoom: {
        enabled: true,
        scale: 0.74,            // 距离乘数（越小越近）
        inTime: 0.22,           // 拉近时长
        hold: 1.4,              // 保持时长
        outTime: 0.40,          // 拉回时长
        fovKick: -3             // 触发瞬间 fov 微收（deg），增强冲击
      },
      /* --- 平滑跟随 --- */
      follow: {
        positionLerp: 4.6,      // 位置跟随（越大越紧）
        distanceLerp: 2.8,      // 距离缩放
        heightLerp: 3.2,        // 高度
        deadZone: 1.2           // 跟随死区（单位位移小于此值时相机不动，减少微抖）
      }
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
    height: 5.0,              // 相机高度（低于注视点→低角度仰拍，凸显百吨巨型压迫感）
    lookHeight: 8,            // 注视点高度（抬到机甲胸/头部）
    baseDistance: 36,         // 基准横向距离（沿 +Z 看向战场）
    minDistance: 22,
    maxDistance: 54,
    maxZ: 26,                 // 相机 z 上限（永远位于战场 +Z 侧）
    framePadding: 9,          // 自动取景时双方外扩距离（含单位自身体宽，保证双方完整入镜）
    followLerp: 4.2,          // 相机位置跟随平滑
    distLerp: 2.6,            // 距离缩放平滑
    heightLerp: 3.0,
    shake: {                  // 重击屏幕震动
      decay: 6.0,             // 衰减速度（指数）
      max: 2.2,               // 位移上限（世界单位，上调→重击更猛）
      rotScale: 0.5,          // 旋转震动系数
      triggerScale: 0.02      // 伤害 → 震动强度换算
    },
    ultimateZoom: {           // 必杀技镜头小幅缩放
      scale: 0.72,            // 距离乘数（越小越近，必杀更近）
      time: 0.35,
      hold: 1.6
    },
    /* 预置：少量机位偏移，避免完全笔直 */
    offsetY: 1.0
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
      hitstopUltimate: 0.38,   // 必杀命中慢动作（0.2~0.4s，过长会拖慢节奏）
      comboWindow: 0.9,        // 连击窗口
      comboResetTime: 1.2
    },

    /* -------------------------------------------------------------------------
     * 动作反馈手感调参表（集中配置，便于整体调参）
     *   - hitStop   命中顿帧（按帧数配置，统一换算为秒）
     *   - shake     屏幕震动总开关
     *   - buffer    输入缓冲（动作被"忙"拒绝时缓存，窗口内自动释放）
     *   - 前摇/完美格挡/闪避残影 等手感参数
     * ---------------------------------------------------------------------- */
    feel: {
      /* 命中顿帧：按帧数配置（fps 为换算基准） */
      hitStop: {
        enabled: true,
        fps: 60,
        frames: { light: 3, heavy: 6, skill: 8, ultimate: 10 }
      },
      /* 屏幕震动总开关（低画质可关闭） */
      shake: { enabled: true },
      /* 输入缓冲：帧数窗口 + 释放优先级（越靠前越优先） */
      buffer: {
        enabled: true,
        fps: 60,
        frames: { light: 5, heavy: 5, skill: 8, ultimate: 10, dodge: 3 },
        priority: ['dodge', 'ultimate', 'skill', 'heavy', 'light']
      },
      /* 前摇期间允许的小幅移动速度倍率（0 = 完全锁死） */
      startupMoveScale: 0.5,
      /* 完美格挡：按下格挡后该时长内被命中即触发 */
      perfectGuard: {
        enabled: true,
        window: 0.18,            // 判定窗口（秒）
        damageReduction: 0.92,   // 完美格挡额外减伤
        hitstop: 0.10            // 强调成功感的额外顿帧
      },
      /* 闪避残影拖尾 */
      dodgeTrail: { enabled: true }
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
        label: '重攻击', startup: 0.50, active: 0.16, recovery: 0.62,
        damage: 96, range: 9.0, arc: 80, stun: 25, knockback: 7.5,
        staminaCost: 18, energyGain: 12, breakGuard: true, blockable: true,
        sound: 'heavy', animation: 'heavy', comboMax: 1, groundShake: 1.0
      },
      skill: {                 // 武器技能：机炮/刀刃，消耗少量能量
        label: '武器技能', startup: 0.22, active: 0.30, recovery: 0.34,
        damage: 58, range: 12.0, arc: 60, stun: 12, knockback: 4.2,
        energyCost: 10, energyGain: 4, breakGuard: false, blockable: true,
        sound: 'skill', animation: 'skill', comboMax: 2, groundShake: 0.6
      },
      ultimate: {              // 必杀技：满能量释放，专属演出
        label: '必杀技', startup: 0.90, active: 0.60, recovery: 0.95,
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
      regen: 3.0,               // 每秒自然恢复
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
    armorRatio: 0.35,            /* 装甲值 = maxHp * 该比例（先于血量承受伤害） */
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
    armorRatio: 0.25,            /* 怪兽甲壳：装甲值比例略低，但甲壳破防后更脆 */
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
    },
    /* 攻击预兆（telegraph）：起手时在敌方脚下/身前闪一圈警示环，
       并按难度缩放起手时长（简单更长便于反应，困难更短） */
    telegraph: {
      enabled: true,
      color: 0xff8a3c,
      life: 0.30,
      radiusFrom: 1.5,
      radiusTo: 7.0,
      opacity: 0.75,
      startupScale: { easy: 1.55, normal: 1.15, hard: 0.85 }
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
      },
      /* 触屏模式：虚拟按键图标 */
      touch: {
        label: '触屏模式',
        light: '轻攻', heavy: '重攻', dodge: '闪避', block: '格挡',
        skill: '技能', ultimate: '必杀', pause: '⏸',
        confirm: '确认', cancel: '返回',
        move: '左摇杆', menu: '左摇杆选择 · 确认'
      }
    },
    /* 触屏控制（仅在触屏设备且未连接手柄时启用） */
    touch: {
      enabled: true,
      joystickRadius: 56,        // 摇杆有效半径（px）
      joystickDeadzone: 14,      // 摇杆死区（px）
      joystickBaseSize: 120,     // 摇杆底盘视觉直径
      joystickKnobSize: 54,      // 摇杆旋钮直径
      /* 右侧按键布局（相对右下角的偏移，单位 vw/vh 由 CSS 控制） */
      buttons: [
        { action: 'light', label: '轻攻', size: 64, pos: [0, 0] },
        { action: 'heavy', label: '重攻', size: 64, pos: [1, -1] },
        { action: 'skill', label: '技能', size: 52, pos: [-1, -1] },
        { action: 'dodge', label: '闪避', size: 52, pos: [-1, 0] },
        { action: 'block', label: '格挡', size: 56, pos: [0, -1] },
        { action: 'ultimate', label: '必杀', size: 58, pos: [1, 0] }
      ]
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
      block: 'BLOCK', guardBreak: 'GUARD BREAK', perfectGuard: 'PERFECT GUARD',
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
      light:   { type: 'noise', freq: 680, dur: 0.12, gain: 0.5 },
      heavy:   { type: 'noise', freq: 180, dur: 0.44, gain: 1.0 },   /* 重击：更低沉、更长 */
      skill:   { type: 'square', freq: 240, dur: 0.22, gain: 0.4 },
      ultimate:{ type: 'sawtooth', freq: 70, dur: 1.4, gain: 1.1 },  /* 必杀：更低频轰鸣 */
      hit:     { type: 'noise', freq: 130, dur: 0.20, gain: 0.8 },   /* 命中：金属闷响 */
      block:   { type: 'square', freq: 520, dur: 0.14, gain: 0.35 },
      step:    { type: 'sine', freq: 52, dur: 0.22, gain: 0.5 },    /* 脚步：厚重低频 */
      hydraulic:{ type: 'noise', freq: 320, dur: 0.22, gain: 0.32 },  /* 液压关节：出招起手短促机械声 */
      roar:    { type: 'sawtooth', freq: 80, dur: 1.5, gain: 0.9 },  /* 怪兽咆哮：低沉 */
      plasma:  { type: 'sawtooth', freq: 1400, dur: 0.18, gain: 0.3 }, /* 等离子链锯嗡鸣 */
      armorBreak: { type: 'noise', freq: 220, dur: 0.5, gain: 0.85 }, /* 装甲破碎：金属撕裂 */
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
    /* 景深：仅远景虚化（主体机甲/怪兽与镜头之间保持全清晰）
       focusOffset 相对相机到战场平面的距离，range 为过渡纵深，maxPx 为最大虚化像素 */
    dof: { enabled: true, focusOffset: 26, range: 150, strength: 0.55, maxPx: 3.2 },
    maxLights: { point: 6, spot: 3 },
    resolutionScale: 1.0,

    /* =======================================================================
     * P3：画质三档预设（low / medium / high）+ 自动降级
     *   setQuality(level) 会把对应预设合并到上面的渲染参数，再重建后处理/阴影。
     *   auto 模式由 Renderer.detectQuality() 根据设备能力选择。
     * ==================================================================== */
    quality: 'auto',      // 'auto' | 'low' | 'medium' | 'high'
    qualityPresets: {
      high: {
        bloom: { enabled: true, strength: 0.70, radius: 0.7, threshold: 0.68 },
        shadows: { enabled: true, type: 'PCFSoft', mapSize: 2048, radius: 4 },
        vignette: { enabled: true, offset: 1.05, darkness: 0.62 },
        filmGrain: { enabled: true, intensity: 0.06 },
        fog: { enabled: true, density: 0.0038 },
        envMap: { enabled: true, intensity: 0.62 },
        resolutionScale: 1.0,
        antialias: true,
        particleScale: 1.0,          // 特效粒子数量乘数
        rainScale: 1.0,
        dof: { enabled: true }       // 景深：仅桌面高画质开启
      },
      medium: {
        bloom: { enabled: true, strength: 0.45, radius: 0.5, threshold: 0.78 },
        shadows: { enabled: true, type: 'PCFSoft', mapSize: 1024, radius: 3 },
        vignette: { enabled: true, offset: 1.1, darkness: 0.55 },
        filmGrain: { enabled: true, intensity: 0.04 },
        fog: { enabled: true, density: 0.0032 },
        envMap: { enabled: true, intensity: 0.5 },
        resolutionScale: 0.85,
        antialias: true,
        particleScale: 0.7,
        rainScale: 0.7,
        dof: { enabled: false }
      },
      low: {
        bloom: { enabled: false, strength: 0.3, radius: 0.4, threshold: 0.85 },
        shadows: { enabled: false, type: 'Basic', mapSize: 512, radius: 1 },
        vignette: { enabled: true, offset: 1.2, darkness: 0.5 },
        filmGrain: { enabled: false, intensity: 0.03 },
        fog: { enabled: true, density: 0.0028 },
        envMap: { enabled: false, intensity: 0.4 },
        resolutionScale: 0.65,
        antialias: false,
        particleScale: 0.4,
        rainScale: 0.4,
        dof: { enabled: false }
      }
    },

    /* P3：后处理效果运行时开关（用户可在暂停菜单单独切换，独立于画质预设） */
    postFx: {
      bloom: true,
      vignette: true,
      filmGrain: true
    },

    /* P3：自动降级判定阈值（detectQuality 用） */
    autoQuality: {
      lowDprThreshold: 1.5,          // devicePixelRatio <= 此值 且 移动端 → low
      lowScreenArea: 1280 * 720,     // 屏幕面积 <= 此值 → 倾向 low
      mobileForceLow: true           // 移动端强制 low（可改 false 走 medium）
    }
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
