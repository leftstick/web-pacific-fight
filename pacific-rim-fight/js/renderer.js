/* =============================================================================
 * renderer.js  ──  渲染器：Three.js r170 场景 / 相机 / 灯光 / 后处理 / 打击特效
 * 依赖：config.js（GAME.CONFIG / GAME.U）、models.js（GAME.Models）、
 *       physics.js（GAME.Physics，可选：不可用时碎片自动走运动学回退）
 * 加载方式：普通 <script>（非 module），挂载 window.GAME.Renderer
 * 说明：
 *   · THREE 与 addons 由 index.html 在 boot 时通过 init(three, addons, canvas) 注入，
 *     本文件顶层绝不直接引用 THREE（THREE 变量声明为 null，只在函数体内使用）。
 *   · 固定 2.5D 横向视角：相机永远位于战场 +Z 侧，只沿 x 跟随双方中点、按跨度自动取景，
 *     永不旋转 / 环绕；屏幕震动与必杀镜头缩放只做加法偏移。
 *   · 所有数值 / 颜色均来自 GAME.CONFIG.render / CONFIG.camera / CONFIG.art.palette。
 * ========================================================================== */
(function (global) {
  'use strict';

  var GAME = global.GAME;
  var U = GAME.U;
  var CONFIG = GAME.CONFIG;
  var CAM = CONFIG.camera;
  var RENDER = CONFIG.render;
  var ART = CONFIG.art;
  var PAL = ART.palette;
  var AC = CONFIG.artConfig || {};        // ART_CONFIG 统一视觉参数入口

  var THREE = null;          // 由 init 注入，禁止在脚本装载期使用
  var ADDONS = null;         // 由 init 注入（后处理 addon 集合）

  var DEG = Math.PI / 180;

  /* ---------------------------------------------------------------------------
   * 内部特效池容量：取自 ART_CONFIG.fx（P2 统一参数管理），回退到安全默认值。
   * ------------------------------------------------------------------------ */
  var FXCFG = (AC.fx) || {};
  var SPARK_TIERS = (FXCFG.spark && FXCFG.spark.tiers) || {};
  var FX = {
    spark: (FXCFG.spark && FXCFG.spark.pool) || 120,
    flash: (FXCFG.shield && FXCFG.shield.pool) ? ((FXCFG.shield.pool * 3) | 0) + 24 : 24,
    dust: (FXCFG.explosion && FXCFG.explosion.dustCount) ? (FXCFG.explosion.dustCount * 4) : 40,
    ring: Math.max(6, ((FXCFG.explosion && FXCFG.explosion.pool) || 6) + ((FXCFG.spark && SPARK_TIERS[3] && SPARK_TIERS[3].ring) ? 6 : 0)),
    shield: (FXCFG.shield && FXCFG.shield.pool) || 8,
    explosion: (FXCFG.explosion && FXCFG.explosion.pool) || 6,
    trail: (FXCFG.trail && FXCFG.trail.maxActive) || 4,
    arc: (FXCFG.arc && FXCFG.arc.pool) || 8
  };

  /* 命中等级参数：1 轻 / 2 重 / 3 必杀；取自 ART_CONFIG.fx.spark.tiers，
     缺失时回退到调色板安全值。 */
  function impactTier(level) {
    var t = SPARK_TIERS[level] || SPARK_TIERS[1] || {};
    return {
      sparks: t.count || 12,
      speed: t.speed || 16,
      sparkLife: t.life || 0.34,
      flashSize: t.flashSize || 2.6,
      flashLife: t.flashLife || 0.13,
      light: t.light || 5,
      lightLife: t.lightLife || 0.18,
      ring: !!t.ring,
      color: t.color !== undefined ? t.color : PAL.searchLight
    };
  }
  var IMPACT = { 1: impactTier(1), 2: impactTier(2), 3: impactTier(3) };

  /* ===========================================================================
   * GAME.Renderer —— 对外 API（属性 + 方法）
   * ======================================================================== */
  var R = {
    /* --- 对外属性（init 后可用） --- */
    THREE: null,
    addons: null,
    scene: null,
    camera: null,
    renderer: null,
    composer: null,
    city: null,

    /* --- 内部状态 --- */
    _warnedNoPost: false,
    _elapsed: 0,
    _size: null, _tmp: null, _look: null,
    _glowTex: null, _ringGeo: null,
    _fxGroup: null, _debugGroup: null,
    _sparks: [], _flashes: [], _dusts: [], _rings: [], _fxLights: [],
    _shields: [], _explosions: [], _trails: [], _arcs: [],
    _arcGeo: null,
    _koFocus: null, _koFocusT: 0,
    _unitHandles: [], _unitLightPool: [], _debris: [],
    _lights: { point: 0, spot: 0 },
    _fxLightCount: 0,
    _hemi: null, _amb: null, _moon: null, _cityGlow: [], _emberLight: null, _emberBase: 0.55,
    _searchlights: [],
    _shake: 0, _shakeSeed: 0,
    _dist: 0, _camY: 0, _midX: 0,
    _zoomActive: false, _zoomT: 0,
    _debugHitboxes: false,
    _sunDir: null,
    _vignettePass: null, _bloomPass: null, _dofPass: null,

    /* =======================================================================
     * init(three, addons, canvas) -> renderer 实例
     *   注入 THREE / addons，初始化 Models，创建渲染器 / 相机 / 场景。
     * ==================================================================== */
    init: function (three, addons, canvas) {
      THREE = three;
      ADDONS = addons;
      R.THREE = three;
      R.addons = addons;

      /* 先把 THREE 交给 Models，保证其内部建模可用 */
      if (GAME.Models && GAME.Models.init) GAME.Models.init(three);

      var w = Math.max(1, (canvas && canvas.clientWidth) || global.innerWidth || 1280);
      var h = Math.max(1, (canvas && canvas.clientHeight) || global.innerHeight || 720);

      /* --- WebGL 渲染器 --- */
      var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: RENDER.antialias });
      renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, RENDER.pixelRatioCap));
      renderer.setSize(w, h, false);
      renderer.shadowMap.enabled = !!RENDER.shadows.enabled;
      renderer.shadowMap.type = R._shadowType(RENDER.shadows.type);
      renderer.toneMapping = R._toneMapping(RENDER.toneMapping.type);
      renderer.toneMappingExposure = RENDER.toneMapping.exposure;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      R.renderer = renderer;

      /* --- 相机（固定 2.5D 横向视角） --- */
      R.scene = new THREE.Scene();
      R.camera = new THREE.PerspectiveCamera(CAM.fov, w / h, CAM.near, CAM.far);
      R.camera.position.set(0, CAM.height, CAM.baseDistance);
      R.camera.lookAt(0, CAM.lookHeight + CAM.offsetY, 0);

      /* --- 缓存/临时对象 --- */
      R._size = new THREE.Vector2(w, h);
      R._tmp = new THREE.Vector3();
      R._look = new THREE.Vector3(0, CAM.lookHeight + CAM.offsetY, 0);
      R._dist = CAM.baseDistance;
      R._camY = CAM.height;
      R._midX = 0;
      R._shakeSeed = Math.random() * 100;

      R.buildScene();

      /* P3：启动时按 RENDER.quality 应用画质（auto → 自动检测） */
      R.setQuality(RENDER.quality || 'auto');

      return R.renderer;
    },

    /* =======================================================================
     * buildScene() —— 构建整张场景：雾 / 天空与城市（含地面）/ 灯光 / 后处理链
     * ==================================================================== */
    buildScene: function () {
      var scene = R.scene;

      /* 1) 体积雾（指数雾，夜晚远景压暗） */
      if (RENDER.fog.enabled) scene.fog = new THREE.FogExp2(PAL.fog, RENDER.fog.density);

      /* 2) 天空 + 夜晚废墟城市（地面属于城市的一部分） */
      R.city = GAME.Models.buildCity(ART);
      scene.add(R.city.group);

      /* 3) 灯光（暗调高对比） */
      R._buildLights(scene);

      /* 3.5) IBL 环境贴图：为 PBR 金属提供环境反射（缺省则静默跳过） */
      R._buildEnvironment(scene);

      /* 4) 特效池 + 调试辅助 */
      R._glowTex = R._makeGlowTexture();
      R._buildFxPools(scene);
      R._buildDebugHelpers(scene);

      /* 5) 后处理链 */
      R._buildPost();

      /* 调试开关：F3 由 input.js 切换 CONFIG.debug.showHitboxes 并广播 */
      if (U.bus && U.bus.on) {
        U.bus.on('debug:toggle', function (payload) {
          R.setDebugHitboxes(!!(payload && payload.showHitboxes));
        });
      }
      return scene;
    },

    /* =======================================================================
     * addUnit(root, faction) -> handle
     *   把单位根节点加入场景，并挂一盏专属彩色点光（机甲冷蓝 / 怪兽青绿）。
     *   点光从池中复用，始终处于 CONFIG.render.maxLights 预算内。
     * ==================================================================== */
    addUnit: function (root, faction) {
      if (!root) return null;
      R.scene.add(root);

      var isMecha = faction === 'mecha';
      var color = isMecha ? ART.mechaGlow.balanced : ART.kaijuGlow.fast;

      var light = R._unitLightPool.pop() || null;
      if (!light && R._lights.point < RENDER.maxLights.point) {
        light = new THREE.PointLight(color, 0, 32, 2);
        R.scene.add(light);
        R._lights.point++;
      }

      var handle = {
        root: root, faction: faction, color: color, light: light,
        base: isMecha ? 7.0 : 9.0, offset: 0, phase: U.rand(0, 6.28)
      };
      if (light) {
        light.color.setHex(color);
        light.intensity = handle.base;
        light.visible = true;
        handle.offset = ((root.userData && root.userData.height) ? root.userData.height : 8) * 0.55;
        light.position.set(root.position.x, root.position.y + handle.offset, root.position.z);
      }
      R._unitHandles.push(handle);
      return handle;
    },

    /* =======================================================================
     * removeUnit(root) —— 移出场景并把专属点光归还池中
     * ==================================================================== */
    removeUnit: function (root) {
      if (!root) return;
      R.scene.remove(root);
      for (var i = 0; i < R._unitHandles.length; i++) {
        var h = R._unitHandles[i];
        if (h.root === root) {
          if (h.light) {
            h.light.intensity = 0;
            h.light.visible = false;
            R._unitLightPool.push(h.light);   // 复用，不新建
          }
          R._unitHandles.splice(i, 1);
          break;
        }
      }
    },

    /* =======================================================================
     * spawnImpact(position, level, facing, opts)
     *   池化的命中火花：加法混合精灵迸射 + 发光闪光 + 短时点光；
     *   level 1 轻 / 2 重 / 3 必杀（必杀额外展开一圈冲击波环）。
     *   opts（可选）：{ combo: 'light'|'heavy'|'skill'|'ultimate'|'block'|'perfect' }
     *   按 ART_CONFIG.fx.hitCombo 生成动作专属的 火花/冲击环/血液/刀光 组合。
     *   热身后不再逐帧分配对象。
     * ==================================================================== */
    spawnImpact: function (position, level, facing, opts) {
      if (!position) return;
      var lv = IMPACT[level] || IMPACT[1];
      var pos = R._pos(position);
      var fb = R._facingBias(facing);
      var combos = FXCFG.hitCombo || {};
      var combo = (opts && opts.combo && combos[opts.combo]) ? combos[opts.combo] : null;
      var pScale = (R._particleScale != null ? R._particleScale : 1);

      /* 火花迸射（背击更爆裂；P3：按画质 particleScale 缩放数量） */
      var baseSparks = combo ? combo.spark : lv.sparks;
      var n = Math.round((baseSparks + (fb > 0 ? 6 : 0)) * pScale);
      for (var i = 0; i < n; i++) {
        var sk = R._acquire(R._sparks);
        if (!sk) break;
        sk.vel.set(U.rand(-1, 1) + fb * 0.6, U.rand(0.15, 1.1), U.rand(-0.7, 0.7)).normalize();
        sk.vel.multiplyScalar(lv.speed * U.rand(0.5, 1.25));
        sk.sprite.position.copy(pos);
        sk.sprite.material.color.setHex(R._sparkColor(lv.color, i));
        sk.size = U.rand(0.5, 1.2) * (level >= 3 ? 1.4 : 1);
        sk.life = sk.maxLife = lv.sparkLife * U.rand(0.75, 1.25);
        sk.sprite.material.opacity = 1;
        sk.sprite.visible = true;
        sk.active = true;
      }

      /* 发光闪光 */
      var fl = R._acquire(R._flashes);
      if (fl) {
        fl.sprite.position.copy(pos);
        fl.sprite.material.color.setHex(lv.color);
        fl.size = lv.flashSize;
        fl.life = fl.maxLife = lv.flashLife;
        fl.sprite.material.opacity = 1;
        fl.sprite.visible = true;
        fl.active = true;
      }

      /* 短时点光（复用池内光源） */
      R._pulseFxLight(pos, lv.color, lv.light, lv.lightLife);

      /* 冲击波环：必杀固定 1 圈；组合配置可要求多圈 */
      var ringCount = combo ? (combo.impact | 0) : (lv.ring ? 1 : 0);
      for (var r = 0; r < ringCount; r++) {
        var rg = R._acquire(R._rings);
        if (!rg) break;
        rg.mesh.position.copy(pos);
        rg.mesh.rotation.set(0, 0, 0);
        rg.mesh.material.color.setHex(PAL.lightning);
        /* 轻/重击只留一圈贴身的能量波，必杀才允许扩散到 10m+，避免糊住整个怪兽 */
        rg.from = 0.8 + r * 0.8;
        rg.to = (level >= 3 ? 9.5 : 5.0) + r * 2.2;
        rg.life = rg.maxLife = (level >= 3 ? 0.46 : 0.34) + r * 0.08;
        rg.mesh.material.opacity = 1;
        rg.mesh.visible = true;
        rg.active = true;
      }

      /* 开菊兽血液：红紫粒子，初速低 + 重力下落（复用火花池） */
      var bloodCount = combo ? Math.round((combo.blood | 0) * pScale) : 0;
      var bloodColors = FXCFG.bloodColors || [0xb02a3a];
      for (var b = 0; b < bloodCount; b++) {
        var bl = R._acquire(R._sparks);
        if (!bl) break;
        bl.vel.set(U.rand(-0.8, 0.8) + fb * 0.4, U.rand(0.5, 1.4), U.rand(-0.5, 0.5)).normalize();
        bl.vel.multiplyScalar(lv.speed * U.rand(0.25, 0.6));
        bl.sprite.position.copy(pos);
        bl.sprite.material.color.setHex(bloodColors[b % bloodColors.length]);
        bl.size = U.rand(0.7, 1.6);
        bl.life = bl.maxLife = 0.55 * U.rand(0.8, 1.3);
        bl.sprite.material.opacity = 1;
        bl.sprite.visible = true;
        bl.active = true;
      }

      /* 刀光弧线：青蓝色细环，随机倾角，短促扩散（复用冲击环池） */
      var slashCount = combo ? (combo.slash | 0) : 0;
      for (var s = 0; s < slashCount; s++) {
        var sl = R._acquire(R._rings);
        if (!sl) break;
        sl.mesh.position.copy(pos);
        sl.mesh.rotation.set(U.rand(-0.9, 0.9), U.rand(-0.6, 0.6), U.rand(0, Math.PI * 2));
        sl.mesh.material.color.setHex(FXCFG.slashColor !== undefined ? FXCFG.slashColor : 0x9fd8ff);
        sl.from = 2.0; sl.to = 9.0 + s * 2.0;
        sl.life = sl.maxLife = 0.28;
        sl.mesh.material.opacity = 0.9;
        sl.mesh.visible = true;
        sl.active = true;
      }

      /* 必杀命中：大范围冲击烟尘（复用烟尘池，数量随画质缩放，手机上不爆池） */
      if (level >= 3) R.spawnShockDust(pos, 1);
    },

    /* =======================================================================
     * spawnShockDust(pos, scale)
     *   必杀命中的冲击波烟尘：贴地向外扩散的厚重尘团，复用烟尘对象池。
     * ==================================================================== */
    spawnShockDust: function (pos, scale) {
      if (!pos) return;
      var p = R._pos(pos);
      var s = scale || 1;
      var pScale = (R._particleScale != null ? R._particleScale : 1);
      var n = Math.max(2, Math.round(7 * s * pScale));
      for (var i = 0; i < n; i++) {
        var d = R._acquire(R._dusts);
        if (!d) break;
        var ang = U.rand(0, Math.PI * 2);
        var spd = U.rand(4.5, 11) * s;
        d.vel.set(Math.cos(ang) * spd, U.rand(0.5, 3.0), Math.sin(ang) * spd);
        d.sprite.position.copy(p);
        d.sprite.position.x += U.rand(-0.6, 0.6);
        d.sprite.material.color.setHex(0x9aa6ad);
        d.size = U.rand(1.6, 3.0) * s;
        d.life = d.maxLife = U.rand(0.6, 1.1);
        d.sprite.material.opacity = 0.5;
        d.sprite.visible = true;
        d.active = true;
      }
    },

    /* =======================================================================
     * spawnArmorDebris(position, unit)
     *   装甲破防碎片：复用火花池，金属碎片色（灰/暗橙），带重力下落，
     *   数量随画质缩放。不新建对象。
     * ==================================================================== */
    spawnArmorDebris: function (position, unit) {
      if (!position) return;
      var pos = R._pos(position);
      var pScale = (R._particleScale != null ? R._particleScale : 1);
      var isMecha = unit && unit.def && unit.def.faction === 'mecha';
      var colors = isMecha ? [0x8a929a, 0x5a626a, 0xc0392b] : [0x3f4a52, 0x6b7276, 0xff7a1e];
      var n = Math.round(16 * pScale);
      for (var i = 0; i < n; i++) {
        var d = R._acquire(R._sparks);
        if (!d) break;
        d.vel.set(U.rand(-1, 1), U.rand(0.4, 1.4), U.rand(-1, 1)).normalize();
        d.vel.multiplyScalar(U.rand(8, 18));
        d.sprite.position.copy(pos);
        d.sprite.position.y += U.rand(0, 1.5);
        d.sprite.material.color.setHex(colors[i % colors.length]);
        d.size = U.rand(0.4, 0.9);
        d.life = d.maxLife = U.rand(0.6, 1.1);
        d.sprite.material.opacity = 1;
        d.sprite.visible = true;
        d.active = true;
        d.debris = true;   /* 标记：受重力影响（在 _updateFx 中下坠） */
      }
    },

    /* =======================================================================
     * spawnSteam(pos)
     *   机甲关节蒸汽排气：复用烟尘池，白色蒸汽向上飘散 + 轻微扩散，
     *   寿命短、不发光。用于机甲肩/膝关节周期性排气。
     * ==================================================================== */
    spawnSteam: function (pos) {
      if (!pos) return;
      var p = R._pos(pos);
      var pScale = (R._particleScale != null ? R._particleScale : 1);
      var n = Math.max(1, Math.round(3 * pScale));
      for (var i = 0; i < n; i++) {
        var d = R._acquire(R._dusts);
        if (!d) break;
        d.vel.set(U.rand(-0.3, 0.3), U.rand(1.5, 3.2), U.rand(-0.3, 0.3));
        d.sprite.position.copy(p);
        d.sprite.material.color.setHex(0xeaf2f7);
        d.size = U.rand(0.8, 1.6);
        d.life = d.maxLife = U.rand(0.5, 0.9);
        d.sprite.material.opacity = 0.6;
        d.sprite.visible = true;
        d.active = true;
      }
    },

    /* =======================================================================
     * spawnSplash(pos)
     *   机甲脚步溅水：复用火花池，蓝白色水花向四周低角度飞溅，带重力。
     *   用于雨夜机甲移动/落地时的水花。
     * ==================================================================== */
    spawnSplash: function (pos) {
      if (!pos) return;
      var p = R._pos(pos);
      var pScale = (R._particleScale != null ? R._particleScale : 1);
      var n = Math.max(1, Math.round(4 * pScale));
      for (var i = 0; i < n; i++) {
        var d = R._acquire(R._sparks);
        if (!d) break;
        var ang = U.rand(0, Math.PI * 2);
        d.vel.set(Math.cos(ang) * U.rand(1, 3), U.rand(0.8, 2.2), Math.sin(ang) * U.rand(1, 3));
        d.sprite.position.copy(p);
        d.sprite.material.color.setHex(i % 2 ? 0xbfd8ff : 0xffffff);
        d.size = U.rand(0.3, 0.6);
        d.life = d.maxLife = U.rand(0.3, 0.55);
        d.sprite.material.opacity = 0.9;
        d.sprite.visible = true;
        d.active = true;
      }
    },

    /* =======================================================================
     * collapseBuilding(building, dir)
     *   隐藏建筑网格，抛掷碎片（Ammo 动态刚体；不可用时走运动学回退），
     *   叠加尘雾 + 橙色闪光 + 短时点光；碎片在 CONFIG.combat.destructible.debrisLife
     *   后回收。
     * ==================================================================== */
    collapseBuilding: function (building, dir) {
      if (!building) return;
      var mesh = building.mesh || building.object3D;
      if (mesh) mesh.visible = false;

      var D = CONFIG.combat.destructible;
      var base = building.position || (mesh && mesh.position) || { x: 0, y: 0, z: 0 };
      var bh = building.height || (building.userData && building.userData.height) || 12;
      var bx = base.x, bz = base.z;

      var dirx = dir ? (dir.x || 0) : 0, dirz = dir ? (dir.z || 0) : 0;
      var dl = Math.sqrt(dirx * dirx + dirz * dirz) || 1;
      dirx /= dl; dirz /= dl;

      var physics = GAME.Physics;
      var usePhys = !!(physics && physics.available);
      var count = D.debrisCount || 14;

      for (var i = 0; i < count; i++) {
        var size = { x: U.rand(1.6, 3.6), y: U.rand(1.2, 2.6), z: U.rand(1.6, 3.6) };
        var m = GAME.Models.createDebrisMesh(size, PAL.concrete);
        m.position.set(
          bx + dirx * 2 + U.rand(-3, 3),
          U.rand(0.5, Math.max(1, bh * 0.85)),
          bz + dirz * 2 + U.rand(-3, 3)
        );
        m.rotation.set(U.rand(-0.4, 0.4), U.rand(0, 6.28), U.rand(-0.4, 0.4));
        R.scene.add(m);

        var vel = {
          x: dirx * U.rand(3, 9) + U.rand(-3, 3),
          y: U.rand(3, 11),
          z: dirz * U.rand(3, 9) + U.rand(-3, 3)
        };
        var entry = {
          mesh: m, handle: null, kinematic: !usePhys, alive: true,
          vel: new THREE.Vector3(vel.x, vel.y, vel.z),
          spin: new THREE.Vector3(U.rand(-3, 3), U.rand(-3, 3), U.rand(-3, 3)),
          life: D.debrisLife
        };

        if (usePhys) {
          var h = physics.addDynamicBox(size, m.position, U.rand(4, 9), {
            velocity: vel, friction: 0.7, restitution: 0.15,
            onExpire: function (hh) { R._expireDebris(hh); }
          });
          physics.attachMesh(h, m);
          entry.handle = h;
          entry.kinematic = false;
        }
        R._debris.push(entry);
      }

      /* 尘雾 + 橙色闪光 + 短时点光 */
      R._spawnDust(bx, bh * 0.4, bz, bh);
      var fl = R._acquire(R._flashes);
      if (fl) {
        fl.sprite.position.set(bx, bh * 0.5, bz);
        fl.sprite.material.color.setHex(PAL.emberOrange);
        fl.sprite.material.opacity = 1;
        fl.size = 9;
        fl.life = fl.maxLife = 0.30;
        fl.sprite.visible = true;
        fl.active = true;
      }
      R._pulseFxLight(R._tmp.set(bx, bh * 0.5, bz), PAL.emberOrange, 22, 0.5);

      /* P2：建筑崩塌 → 大爆炸特效（冲击波环 + 火星 + 烟尘 + 强点光） */
      R.spawnExplosion(R._tmp.set(bx, bh * 0.5, bz), 4);
    },

    /* =======================================================================
     * spawnExplosion(position, level)
     *   P2 大爆炸特效（建筑崩塌 / 必杀终结）：冲击波环 + 迸射火星 +
     *   上升烟尘 + 强点光。level 预留分级（当前 4 级=建筑）。
     *   取自 ART_CONFIG.fx.explosion。纯渲染层。
     * ==================================================================== */
    spawnExplosion: function (position, level) {
      if (!position) return;
      var E = (FXCFG.explosion) || {};
      var pos = R._pos(position);

      /* 冲击波环（复用 ring 池） */
      var rg = R._acquire(R._rings);
      if (rg) {
        rg.mesh.position.copy(pos);
        rg.mesh.rotation.set(0, 0, 0);
        rg.mesh.material.color.setHex(E.color !== undefined ? E.color : PAL.emberOrange);
        rg.from = E.ringFrom || 1.2;
        rg.to = E.ringTo || 20;
        rg.life = rg.maxLife = E.ringLife || 0.7;
        rg.mesh.material.opacity = 0.9;
        rg.mesh.visible = true;
        rg.active = true;
      }

      /* 迸射火星（复用 spark 池） */
      var sparkN = E.sparks || 28;
      for (var i = 0; i < sparkN; i++) {
        var sk = R._acquire(R._sparks);
        if (!sk) break;
        sk.vel.set(U.rand(-1, 1), U.rand(0.2, 1.4), U.rand(-1, 1)).normalize();
        sk.vel.multiplyScalar((E.radius || 9) * U.rand(0.5, 1.4));
        sk.sprite.position.copy(pos);
        sk.sprite.material.color.setHex(i % 3 === 0 ? (E.color || PAL.emberOrange) : PAL.windowWarm);
        sk.size = U.rand(0.6, 1.5);
        sk.life = sk.maxLife = (E.ringLife || 0.7) * U.rand(0.6, 1.1);
        sk.sprite.material.opacity = 1;
        sk.sprite.visible = true;
        sk.active = true;
      }

      /* 上升烟尘（复用 dust 池） */
      var dustN = E.dustCount || 14;
      for (var d = 0; d < dustN; d++) {
        var du = R._acquire(R._dusts);
        if (!du) break;
        du.sprite.position.set(pos.x + U.rand(-2, 2), pos.y + U.rand(-1, 2), pos.z + U.rand(-2, 2));
        du.vel.set(U.rand(-1.5, 1.5), U.rand(1.5, 4.0), U.rand(-1.5, 1.5));
        du.size = U.rand(5, 10);
        du.life = du.maxLife = U.rand(1.0, 2.0);
        du.sprite.material.color.setHex(E.smokeColor !== undefined ? E.smokeColor : PAL.smoke);
        du.sprite.material.opacity = 0.55;
        du.sprite.visible = true;
        du.active = true;
      }

      /* 强点光 */
      R._pulseFxLight(pos, E.color || PAL.emberOrange, E.light || 30, E.lightLife || 0.5);
    },

    /* =======================================================================
     * spawnShieldRipple(position, color)
     *   P2 护盾波纹：格挡命中瞬间，受击点展开一圈半透明能量环（水平 + 略带垂直）。
     *   取自 ART_CONFIG.fx.shield。纯渲染层。
     * ==================================================================== */
    spawnShieldRipple: function (position, color) {
      if (!position) return;
      var S = (FXCFG.shield) || {};
      var pos = R._pos(position);
      var sh = R._acquire(R._shields);
      if (!sh) return;
      sh.mesh.position.copy(pos);
      sh.mesh.rotation.set(Math.PI * 0.5, 0, 0);   // 水平展开
      sh.mesh.material.color.setHex(color !== undefined ? color : (S.color || 0x6fd0ff));
      sh.from = S.radiusFrom || 2.0;
      sh.to = S.radiusTo || 7.5;
      sh.life = sh.maxLife = S.life || 0.5;
      sh.mesh.material.opacity = S.opacity !== undefined ? S.opacity : 0.7;
      sh.mesh.visible = true;
      sh.active = true;
    },

    /* =======================================================================
     * spawnTelegraph(position)
     *   AI 攻击预兆：敌方起手瞬间在脚下展开橙色警示环（水平），
     *   参数取自 CONFIG.ai.telegraph，纯渲染层。
     * ==================================================================== */
    spawnTelegraph: function (position) {
      var T = (CONFIG.ai && CONFIG.ai.telegraph) || {};
      if (T.enabled === false || !position) return;
      var pos = R._pos(position);
      var rg = R._acquire(R._rings);
      if (!rg) return;
      rg.mesh.position.set(pos.x, 0.12, pos.z);
      rg.mesh.rotation.set(Math.PI * 0.5, 0, 0);
      rg.mesh.material.color.setHex(T.color !== undefined ? T.color : 0xff8a3c);
      rg.from = T.radiusFrom || 1.5;
      rg.to = T.radiusTo || 7.0;
      rg.life = rg.maxLife = T.life || 0.3;
      rg.mesh.material.opacity = T.opacity !== undefined ? T.opacity : 0.75;
      rg.mesh.visible = true;
      rg.active = true;
    },

    /* =======================================================================
     * spawnDodgeStreak(position)
     *   闪避残影：青色速度环 + 脚下尘雾（复用 shield / dust 池，
     *   不克隆模型，行进间每 ~60ms 触发一次形成拖影）。
     * ==================================================================== */
    spawnDodgeStreak: function (position) {
      if (!position) return;
      var pos = R._pos(position);
      var sh = R._acquire(R._shields);
      if (sh) {
        sh.mesh.position.copy(pos);
        sh.mesh.rotation.set(Math.PI * 0.5, 0, 0);
        sh.mesh.material.color.setHex(FXCFG.dodgeColor !== undefined ? FXCFG.dodgeColor : 0x8fe3ff);
        sh.from = 2.2; sh.to = 6.0;
        sh.life = sh.maxLife = 0.22;
        sh.mesh.material.opacity = 0.5;
        sh.mesh.visible = true;
        sh.active = true;
      }
      R._spawnDust(pos.x, 0.4, pos.z, 6);
    },

    /* =======================================================================
     * spawnSlashArc(unit, opts)
     *   攻击瞬间的刀光弧面：独立预建 Mesh 池（XY 平面，面向相机），
     *   一次挥砍快速放大并淡出。纯渲染层，不参与判定。
     *   opts = { radius, color, life, tilt, startAngle, spin, forward, z }
     * ==================================================================== */
    spawnSlashArc: function (unit, opts) {
      if (!unit) return;
      opts = opts || {};
      var A = FXCFG.arc || {};
      if (A.enabled === false) return;
      var slot = R._acquire(R._arcs);
      if (!slot) return;

      var c = unit.getHitCenter ? unit.getHitCenter() : unit.position;
      var facing = (opts.facing !== undefined) ? opts.facing : (unit.facing || 1);
      var h = (unit.def && unit.def.height) || 9.5;
      var radius = opts.radius || A.radius || h * 0.72;
      var fwd = (opts.forward !== undefined) ? opts.forward : h * 0.08;
      var yOff = (opts.y !== undefined) ? opts.y : h * 0.03;
      var zOff = (opts.z !== undefined) ? opts.z : 1.1;
      var sign = facing < 0 ? -1 : 1;

      slot.mesh.position.set(c.x + sign * fwd, c.y + yOff, c.z + zOff);
      slot.mesh.rotation.set(0, facing < 0 ? Math.PI : 0, 0);
      slot.rotZ = (opts.startAngle !== undefined ? opts.startAngle : 1.0) * sign;
      slot.spin = (opts.spin !== undefined ? opts.spin : -2.6) * sign;
      slot.mesh.rotation.z = slot.rotZ;
      slot.mesh.material.color.setHex(opts.color !== undefined ? opts.color : (A.color !== undefined ? A.color : 0x9fd8ff));
      slot.from = radius * 0.48;
      slot.to = radius;
      slot.opacity = opts.opacity !== undefined ? opts.opacity : (A.opacity !== undefined ? A.opacity : 0.9);
      slot.life = slot.maxLife = opts.life || A.life || 0.22;
      var s0 = slot.from;
      slot.mesh.scale.set(s0, s0, s0);
      slot.mesh.material.opacity = slot.opacity;
      slot.mesh.visible = true;
      slot.active = true;
    },

    /* =======================================================================
     * setKOFocus(unit) / clearKOFocus()
     *   KO 后把镜头缓慢推近败者；clear 后恢复自动框住双方。
     * ==================================================================== */
    setKOFocus: function (unit) {
      var KF = FXCFG.koFocus || {};
      if (KF.enabled === false) return;
      R._koFocus = unit || null;
      R._koFocusT = 0;
    },
    clearKOFocus: function () {
      R._koFocus = null;
      R._koFocusT = 0;
    },

    /* =======================================================================
     * spawnDeathBurst(unit, stage)
     *   死亡演出分层特效，复用现有粒子池：
     *   mecha: impact（贯穿火花）→ fall（跪地扬尘/碎片）→ reactor（反应堆殉爆）
     *   kaiju: impact（蓝血喷溅）→ fall（倒地尘环）→ final（荧光蓝血扩散）
     * ==================================================================== */
    spawnDeathBurst: function (unit, stage) {
      if (!unit) return;
      var faction = (unit.def && unit.def.faction) || unit.faction || 'kaiju';
      var c = unit.getHitCenter ? unit.getHitCenter() : unit.position;
      var h = (unit.def && unit.def.height) || 9.5;
      var pos = { x: c.x, y: c.y, z: c.z };
      var ground = { x: unit.position.x, y: 0.6, z: unit.position.z };
      var feelCfg = (CONFIG.combat && CONFIG.combat.feel) || {};
      var shakeOn = !(feelCfg.shake && feelCfg.shake.enabled === false);

      if (faction === 'mecha') {
        if (stage === 'impact') {
          R.spawnImpact(pos, 2, unit.facing || 1, { combo: 'heavy' });
          R._pulseFxLight(pos, 0xffb066, 18, 0.35);
        } else if (stage === 'fall') {
          R.spawnArmorDebris({ x: pos.x, y: h * 0.35, z: pos.z }, unit);
          R.spawnShockDust(ground, 1.2);
          R.spawnExplosion({ x: pos.x, y: h * 0.42, z: pos.z }, 4);
          if (shakeOn) R.cameraShake(4);
        } else {
          /* 反应堆殉爆：胸/双肩/髋三点连锁爆炸 + 白闪 + 大量碎片 */
          R.spawnExplosion({ x: pos.x, y: h * 0.55, z: pos.z }, 4);
          R.spawnExplosion({ x: pos.x - h * 0.22, y: h * 0.62, z: pos.z }, 3);
          R.spawnExplosion({ x: pos.x + h * 0.22, y: h * 0.62, z: pos.z }, 3);
          R.spawnExplosion({ x: pos.x, y: h * 0.2, z: pos.z }, 3);
          R.spawnArmorDebris({ x: pos.x, y: h * 0.5, z: pos.z }, unit);
          R.spawnShockDust(ground, 1.6);
          var fl = R._acquire(R._flashes);
          if (fl) {
            fl.sprite.position.set(pos.x, h * 0.55, pos.z + 1.2);
            fl.sprite.material.color.setHex(0xfff3d6);
            fl.sprite.material.opacity = 1;
            fl.size = 14;
            fl.life = fl.maxLife = 0.42;
            fl.sprite.visible = true;
            fl.active = true;
          }
          R._pulseFxLight({ x: pos.x, y: h * 0.55, z: pos.z }, 0xffe0b0, 34, 0.9);
          if (shakeOn) R.cameraShake(4);
        }
        return;
      }

      /* 开菊兽：荧光蓝血 + 蓝色点光 + 倒地烟尘 */
      if (stage === 'impact') {
        R._spawnBloodBurst(pos, 22, FXCFG.kaijuBloodColors || [0x35d5ff, 0x0f8dff]);
        R._pulseFxLight(pos, 0x35d5ff, 16, 0.4);
      } else if (stage === 'fall') {
        R._spawnBloodBurst({ x: pos.x, y: h * 0.3, z: pos.z }, 18, FXCFG.kaijuBloodColors);
        R.spawnShockDust(ground, 1.5);
        R._pulseFxLight({ x: pos.x, y: h * 0.2, z: pos.z }, 0x35d5ff, 20, 0.6);
        if (shakeOn) R.cameraShake(4);
      } else {
        R._spawnBloodBurst({ x: pos.x, y: h * 0.18, z: pos.z }, 26, FXCFG.kaijuBloodColors);
        R.spawnShockDust(ground, 0.8);
        R._pulseFxLight({ x: pos.x, y: h * 0.15, z: pos.z }, 0x72f0ff, 12, 0.7);
      }
    },

    /* 荧光蓝血：低初速 + 重力下坠（复用火花池） */
    _spawnBloodBurst: function (pos, count, colors) {
      var p = R._pos(pos);
      var cols = colors || [0x35d5ff, 0x0f8dff];
      var pScale = (R._particleScale != null ? R._particleScale : 1);
      var n = Math.max(1, Math.round((count || 12) * pScale));
      for (var i = 0; i < n; i++) {
        var b = R._acquire(R._sparks);
        if (!b) break;
        b.vel.set(U.rand(-0.9, 0.9), U.rand(0.4, 1.5), U.rand(-0.6, 0.6)).normalize();
        b.vel.multiplyScalar(U.rand(4, 10));
        b.sprite.position.copy(p);
        b.sprite.position.x += U.rand(-0.6, 0.6);
        b.sprite.material.color.setHex(cols[i % cols.length]);
        b.size = U.rand(0.7, 1.5);
        b.life = b.maxLife = U.rand(0.7, 1.3);
        b.sprite.material.opacity = 1;
        b.sprite.visible = true;
        b.active = true;
      }
    },

    /* =======================================================================
     * startTrail(unit, color) / endTrail(unit)
     *   P2 攻击拖尾：追踪 unit 右臂（fistR/forearmR/armR，找不到则用命中中心+前向），
     *   生成一条带状几何体拖尾。纯渲染层，不触碰 unit.position / 物理。
     *   unit 只读取其 root / getHitCenter / yaw / facing / position。
     * ==================================================================== */
    startTrail: function (unit, color) {
      if (!unit || !(FXCFG.trail && FXCFG.trail.enabled)) return;
      /* 若该 unit 已有活跃拖尾，先重置 */
      R.endTrail(unit);
      var slot = R._acquire(R._trails);
      if (!slot) return;
      slot.unit = unit;
      slot.color = color;
      slot.active = true;
      slot.head.copy(R._trailHeadPos(unit));
      /* 初始化所有段都在 head，避免出现从原点拉出的直线 */
      for (var i = 0; i < slot.points.length; i++) slot.points[i].copy(slot.head);
      slot.age = 0;
      slot.mesh.visible = true;
    },
    endTrail: function (unit) {
      for (var i = 0; i < R._trails.length; i++) {
        var t = R._trails[i];
        if (t.active && t.unit === unit) { t.active = false; t.unit = null; t.mesh.visible = false; }
      }
    },

    /* =======================================================================
     * cameraShake(intensity|level) —— 叠加式屏幕震动
     *   兼容旧签名：数值 > 0 且 <=4 视为分级 level（读 ART_CONFIG.fx.shake.tiers）；
     *   其他数值视为原始强度。上限 CONFIG.camera.shake.max。
     * ==================================================================== */
    cameraShake: function (intensity) {
      var v;
      if (typeof intensity === 'number' && intensity >= 1 && intensity <= 4 &&
          FXCFG.shake && FXCFG.shake.tiers && FXCFG.shake.tiers[intensity]) {
        v = FXCFG.shake.tiers[intensity];                // 分级：1 轻 / 2 重 / 3 必杀 / 4 建筑
      } else {
        v = (intensity === undefined ? 0.5 : intensity) * 0.6;
      }
      R._shake = U.clamp(R._shake + v, 0, CAM.shake.max);
    },
    /* 便捷：分级震动 */
    cameraShakeLevel: function (level) { R.cameraShake(level); },

    /* =======================================================================
     * zoomPunch() —— 触发必杀技镜头拉近（P2：支持 fovKick 冲击）
     *   参数取自 ART_CONFIG.fx.zoom。
     * ==================================================================== */
    zoomPunch: function () {
      if (!(FXCFG.zoom && FXCFG.zoom.enabled)) return;
      R._zoomActive = true;
      R._zoomT = 0;
      R._fovBase = R.camera ? R.camera.fov : CAM.fov;
      R._fovKick = (FXCFG.zoom.fovKick !== undefined) ? FXCFG.zoom.fovKick : 0;
    },

    /* =======================================================================
     * updateCamera(targets, dt)
     *   固定 2.5D：永不旋转 / 环绕；相机位于 +Z 侧；
     *   跟随双方中点，按跨度自动取景（framePadding），距离缓动并夹在
     *   minDistance..maxDistance；叠加震动偏移 / 旋转与必杀缩放。
     * ==================================================================== */
    updateCamera: function (targets, dt) {
      dt = Math.min(dt || 0.016, 0.05);
      var cam = R.camera;
      if (!cam) return;

      var minX = Infinity, maxX = -Infinity, topY = CAM.lookHeight;
      var n = 0, sx = 0;
      if (targets && targets.length) {
        for (var i = 0; i < targets.length; i++) {
          var p = R._targetPos(targets[i]);
          if (!p) continue;
          sx += p.x;
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y > topY) topY = p.y;
          n++;
        }
      }

      var midX, span;
      if (n > 0) {
        midX = sx / n;
        /* 横向半宽 = 双方最大间距的一半 + 外扩 */
        span = (maxX - minX) * 0.5 + CAM.framePadding;
      } else {
        midX = 0;
        span = CAM.framePadding;
      }

      /* KO 特写：只框败者，缓慢推近并降低机位 */
      var KF = FXCFG.koFocus || {};
      var focusK = 0;
      if (R._koFocus && KF.enabled !== false) {
        var fp = R._targetPos(R._koFocus);
        if (fp) {
          R._koFocusT = Math.min(1, (R._koFocusT || 0) + dt * (KF.lerp || 2.4));
          focusK = R._koFocusT;
          midX = U.lerp(midX, fp.x, focusK);
          span = U.lerp(span, CAM.framePadding * 0.42, focusK);
          topY = fp.y;
        }
      }

      /* 距离：保证横向可见半宽覆盖 span（竖直线性 fov → 距离换算） */
      var vTan = Math.tan(CAM.fov * DEG * 0.5);
      var need = span / (vTan * Math.max(0.4, cam.aspect));
      var dist = U.clamp(need, CAM.minDistance, CAM.maxDistance);
      if (focusK > 0) dist = U.lerp(dist, KF.distance || 24, focusK);

      /* P2：跟随参数取自 ART_CONFIG.fx.follow（位置/距离/高度 lerp + 死区） */
      var F = (FXCFG.follow) || {};
      var posLerp = F.positionLerp !== undefined ? F.positionLerp : CAM.followLerp;
      var distLerp = F.distanceLerp !== undefined ? F.distanceLerp : CAM.distLerp;
      var hLerp = F.heightLerp !== undefined ? F.heightLerp : CAM.heightLerp;
      var dead = F.deadZone !== undefined ? F.deadZone : 0;
      /* 死区：目标中点位移小于 dead 时不跟随，减少微抖 */
      if (Math.abs(midX - R._midX) < dead) midX = R._midX;

      R._dist = U.damp(R._dist, dist, distLerp, dt);
      R._midX = U.damp(R._midX, midX, posLerp, dt);
      var wantY = CAM.height + Math.max(0, topY - CAM.lookHeight) * 0.35;
      if (focusK > 0) wantY = U.lerp(wantY, KF.height || 3.2, focusK);
      R._camY = U.damp(R._camY, wantY, hLerp, dt);

      /* 必杀镜头缩放因子（在 update 中推进） */
      var zf = R._zoomFactor();
      var z = U.clamp(R._dist * zf, CAM.minDistance * CAM.ultimateZoom.scale, CAM.maxDistance);
      /* 相机 z 下限取 maxZ：永远位于战场 +Z 侧、不穿入场地 */
      if (z < CAM.maxZ) z = CAM.maxZ;

      cam.position.set(R._midX, R._camY, z);

      /* 震动偏移（加法）；P2 衰减/旋转系数取自 ART_CONFIG.fx.shake */
      var amt = R._shake;
      var rotZ = 0;
      var sh = (FXCFG.shake) || {};
      var decay = sh.decay !== undefined ? sh.decay : CAM.shake.decay;
      var rotScale = sh.rotScale !== undefined ? sh.rotScale : (CAM.shake.rotScale * 0.02);
      if (amt > 0.001) {
        var t = R._elapsed * 26 + R._shakeSeed;
        cam.position.x += Math.sin(t * 1.7) * amt;
        cam.position.y += Math.cos(t * 2.3) * amt * 0.7;
        cam.position.z += Math.sin(t * 1.3) * amt * 0.2;
        rotZ = Math.sin(t * 2.1) * amt * rotScale;
        R._shake = Math.max(0, amt * Math.exp(-decay * dt));
      } else {
        R._shake = 0;
      }

      /* 注视点：通常看向战场中线；KO 特写时下移到败者胸口 */
      var lookY = CAM.lookHeight + CAM.offsetY;
      if (focusK > 0) lookY = U.lerp(lookY, KF.lookHeight || 5.2, focusK);
      R._look.set(R._midX, lookY, 0);
      cam.lookAt(R._look);
      cam.rotation.z += rotZ;
      cam.updateMatrixWorld();

      /* 英雄光跟随镜头与双方中点：从画面左上方斜切，亮面始终朝向观众 */
      if (R._hero) {
        R._hero.position.set(R._midX - 12, R._camY + 22, z + 30);
        R._hero.target.position.set(R._midX + 1, lookY - 1.2, 0);
        R._hero.target.updateMatrixWorld();
      }

      /* 景深：焦点平面跟随当前机位（主体及其前方全清晰，只虚化远景城市），
         抽样步长按后处理缓冲的真实像素尺寸换算，避免高 DPI 下虚化过强 */
      if (R._dofPass) {
        var du = R._dofPass.uniforms;
        du.uFocus.value = z + ((RENDER.dof && RENDER.dof.focusOffset) || 26);
        var rt1 = R.composer && R.composer.renderTarget1;
        if (rt1 && rt1.width > 0) du.uTexel.value.set(1 / rt1.width, 1 / rt1.height);
      }
    },

    /* =======================================================================
     * update(dt, elapsed)
     *   更新城市 / 火花 / 碎片 / 灯光闪烁，随后经 composer 渲染。
     * ==================================================================== */
    update: function (dt, elapsed) {
      dt = dt || 0;
      R._elapsed = (elapsed === undefined ? R._elapsed + dt : elapsed);

      /* 渲染统计：EffectComposer 每帧会多次 render，关闭自动重置后按帧清零，
         这样 info.render.calls 才是整帧总调用数（调试面板用） */
      if (R.renderer && R.renderer.info) {
        R.renderer.info.autoReset = false;
        R.renderer.info.reset();
      }

      if (R.city && R.city.update) R.city.update(dt, R._elapsed, R.camera);

      R._updateUnitLights(R._elapsed);
      R._updateFx(dt);
      R._updateArcs(dt);
      R._updateTrails(dt);
      R._updateDebris(dt);

      /* 同步 Ammo 刚体变换到碎片网格（渲染器只做同步，步进由主循环负责） */
      if (GAME.Physics && GAME.Physics.syncBodies) GAME.Physics.syncBodies();

      R._updateSearchlights(R._elapsed);
      R._updateLightFlicker(R._elapsed);
      R._advanceZoom(dt);

      if (R.composer) R.composer.render(dt);
      else if (R.renderer) R.renderer.render(R.scene, R.camera);
    },

    /* =======================================================================
     * onResize(width, height) —— 相机 / 渲染器 / 合成器同步尺寸
     * ==================================================================== */
    onResize: function (width, height) {
      var w = Math.max(1, width || (R.renderer && R.renderer.domElement.clientWidth) || global.innerWidth || 1280);
      var h = Math.max(1, height || (R.renderer && R.renderer.domElement.clientHeight) || global.innerHeight || 720);

      if (R.camera) { R.camera.aspect = w / h; R.camera.updateProjectionMatrix(); }
      if (R._size) R._size.set(w, h);
      /* P3：统一走 _applyResolution（像素比 × resolutionScale，自动同步 composer） */
      R._applyResolution();
      return R;
    },

    /* =======================================================================
     * setDebugHitboxes(bool) —— 开关调试辅助层（F3 经事件总线触发）
     * ==================================================================== */
    setDebugHitboxes: function (on) {
      R._debugHitboxes = !!on;
      if (R._debugGroup) R._debugGroup.visible = R._debugHitboxes;
      return R;
    },

    /* =======================================================================
     * getDebugInfo() -> object
     *   调试面板用：渲染调用数 / 三角形数 / 各类粒子活跃数 / 当前震动强度。
     * ==================================================================== */
    getDebugInfo: function () {
      function activeCount(pool) {
        var n = 0;
        if (!pool) return n;
        for (var i = 0; i < pool.length; i++) if (pool[i] && pool[i].active) n++;
        return n;
      }
      var info = R.renderer && R.renderer.info;
      return {
        drawCalls: info ? info.render.calls : 0,
        triangles: info ? info.render.triangles : 0,
        sparks: activeCount(R._sparks),
        dusts: activeCount(R._dusts),
        rings: activeCount(R._rings),
        shields: activeCount(R._shields),
        trails: activeCount(R._trails),
        arcs: activeCount(R._arcs),
        shake: Math.round((R._shake || 0) * 1000) / 1000
      };
    },

    /* =======================================================================
     * getSunDirection() -> THREE.Vector3
     *   “月光”方向（归一化）：自左前上方斜射，提供侧向轮廓与投影。
     * ==================================================================== */
    getSunDirection: function () {
      if (!R._sunDir) R._sunDir = new THREE.Vector3(-0.42, 0.78, 0.46).normalize();
      return R._sunDir;
    },

    /* =======================================================================
     * dispose() —— 释放后处理 / 几何 / 材质 / 贴图 / 渲染器
     * ==================================================================== */
    dispose: function () {
      var i;
      if (R.composer && R.composer.dispose) { try { R.composer.dispose(); } catch (e) {} }
      R.composer = null;

      for (i = 0; i < R._sparks.length; i++) if (R._sparks[i].sprite.material) R._sparks[i].sprite.material.dispose();
      for (i = 0; i < R._flashes.length; i++) if (R._flashes[i].sprite.material) R._flashes[i].sprite.material.dispose();
      for (i = 0; i < R._dusts.length; i++) if (R._dusts[i].sprite.material) R._dusts[i].sprite.material.dispose();
      for (i = 0; i < R._rings.length; i++) if (R._rings[i].mesh.material) R._rings[i].mesh.material.dispose();
      for (i = 0; i < R._shields.length; i++) {
        if (R._shields[i].mesh.material) R._shields[i].mesh.material.dispose();
        if (R._shields[i].mesh.geometry) R._shields[i].mesh.geometry.dispose();
      }
      for (i = 0; i < R._trails.length; i++) {
        if (R._trails[i].mesh.material) R._trails[i].mesh.material.dispose();
        if (R._trails[i].mesh.geometry) R._trails[i].mesh.geometry.dispose();
      }
      for (i = 0; i < R._arcs.length; i++) {
        if (R._arcs[i].mesh.material) R._arcs[i].mesh.material.dispose();
      }
      if (R._arcGeo) R._arcGeo.dispose();
      if (R._ringGeo) R._ringGeo.dispose();
      if (R._glowTex) R._glowTex.dispose();

      if (R.scene && GAME.Models && GAME.Models.dispose) GAME.Models.dispose(R.scene);
      if (R.renderer) R.renderer.dispose();

      R._sparks.length = 0; R._flashes.length = 0; R._dusts.length = 0; R._rings.length = 0;
      R._shields.length = 0; R._trails.length = 0; R._arcs.length = 0;
      R._unitHandles.length = 0; R._debris.length = 0;
      R._koFocus = null; R._koFocusT = 0;
      return R;
    },

    /* =======================================================================
     * 内部实现：工具 / 灯池 / 特效池 / 后处理 / 每帧更新
     * ==================================================================== */

    /* 阴影类型 / 色调映射：把 CONFIG 里的字符串映射为 THREE 常量 */
    _shadowType: function (t) {
      if (t === 'PCFSoft') return THREE.PCFSoftShadowMap;
      if (t === 'Basic') return THREE.BasicShadowMap;
      return THREE.PCFShadowMap;
    },
    _toneMapping: function (t) {
      if (t === 'ACESFilmic') return THREE.ACESFilmicToneMapping;
      if (t === 'Reinhard') return THREE.ReinhardToneMapping;
      if (t === 'Cineon') return THREE.CineonToneMapping;
      return THREE.NoToneMapping;
    },

    /* 灯光：暗环境 + 冷月光 + 暖城市辉光 + 闪烁余烬 + 3 盏探照灯 + 冷色轮廓补光 */
    _buildLights: function (scene) {
      var L = AC.light || {};
      /* 半球光 + 环境光：提供基础体积感（过低会让结构不可读，故不再压到极限） */
      R._hemi = new THREE.HemisphereLight(PAL.skyTop, 0x2b2723, L.hemiIntensity !== undefined ? L.hemiIntensity : 0.34);
      R._hemi.position.set(0, 80, 0);
      scene.add(R._hemi);
      R._amb = new THREE.AmbientLight(PAL.skyBottom, L.ambIntensity !== undefined ? L.ambIntensity : 0.10);
      scene.add(R._amb);

      /* 冷色“月光”平行光：负责全部投影，方向取自 getSunDirection */
      var moon = new THREE.DirectionalLight(PAL.searchLight, L.moonIntensity !== undefined ? L.moonIntensity : 0.75);
      var sd = R.getSunDirection();
      moon.position.copy(sd).multiplyScalar(160);
      moon.target.position.set(0, 0, 0);
      scene.add(moon);
      scene.add(moon.target);
      if (RENDER.shadows.enabled) {
        moon.castShadow = true;
        var ms = RENDER.shadows.mapSize;
        moon.shadow.mapSize.set(ms, ms);
        moon.shadow.radius = RENDER.shadows.radius;
        var sc = moon.shadow.camera;
        var halfW = CONFIG.arena.width * 0.6 + 10;
        var halfD = CONFIG.arena.depth * 1.2 + 10;
        sc.left = -halfW; sc.right = halfW; sc.top = halfD; sc.bottom = -halfD;
        sc.near = 1; sc.far = 420;
        sc.updateProjectionMatrix();
      }
      R._moon = moon;

      /* 暖色城市夜辉：2 盏点光 */
      R._cityGlow = [];
      var glows = [
        { x: -CONFIG.arena.width * 0.34, y: 13, z: -6, color: PAL.windowWarm, i: 0.9 },
        { x: CONFIG.arena.width * 0.36, y: 11, z: -4, color: PAL.lampLight, i: 0.7 }
      ];
      for (var g = 0; g < glows.length; g++) {
        var spec = glows[g];
        var pl = new THREE.PointLight(spec.color, spec.i, 70, 2);
        pl.position.set(spec.x, spec.y, spec.z);
        scene.add(pl);
        R._cityGlow.push({ light: pl, base: spec.i, phase: U.rand(0, 6.28) });
        R._lights.point++;
      }

      /* 闪烁的橙色余烬光：1 盏 */
      R._emberLight = new THREE.PointLight(PAL.emberOrange, R._emberBase, 60, 2);
      R._emberLight.position.set(0, 6, 4);
      scene.add(R._emberLight);
      R._lights.point++;

      /* 3 盏探照灯聚光：Models 的城市里已布置探照灯夹具，
         此处补齐与之一一对应的 3 盏真实 SpotLight，
         数量严格等于 CONFIG.render.maxLights.spot，不再新增。 */
      R._searchlights = [];
      var fixtures = (R.city && R.city.searchlights) || [];
      var halfArena = CONFIG.arena.width * 0.5;
      for (var i = 0; i < RENDER.maxLights.spot; i++) {
        if (R._lights.spot >= RENDER.maxLights.spot) break;
        var fx = fixtures[i] || null;
        var px = (fx && fx.group) ? U.clamp(fx.group.position.x, -halfArena, halfArena) : (i - 1) * 22;
        var sp = new THREE.SpotLight(PAL.searchLight, 2.2, 260, 0.34, 0.55, 1.4);
        sp.position.set(px, 52, -30 - i * 6);
        sp.castShadow = false;
        var tg = new THREE.Object3D();
        tg.position.set(px, 0, -6);
        scene.add(tg);
        sp.target = tg;
        scene.add(sp);
        R._searchlights.push({
          light: sp, target: tg, baseX: px,
          phase: U.rand(0, 6.28), speed: U.rand(0.5, 0.9) * (i % 2 ? -1 : 1)
        });
        R._lights.spot++;
      }

      /* 正面主光：从镜头侧上方压下来，让装甲/鳞片的体积和贴图细节真正可见 */
      R._key = new THREE.DirectionalLight(0xffe2bf, L.keyIntensity !== undefined ? L.keyIntensity : 1.55);
      R._key.position.set(20, 44, 58);
      R._key.target.position.set(0, 6, 0);
      R._key.castShadow = false;
      scene.add(R._key);
      scene.add(R._key.target);

      /* 反向冷色补光：与主光拉开色温，避免暗部糊成黑块 */
      R._fill = new THREE.DirectionalLight(PAL.lightning, L.fillIntensity !== undefined ? L.fillIntensity : 0.55);
      R._fill.position.set(-38, 18, 40);
      R._fill.target.position.set(0, 6, 0);
      R._fill.castShadow = false;
      scene.add(R._fill);
      scene.add(R._fill.target);

      /* 冷色轮廓补光（无阴影，不计入点光预算）：从战场后方打亮单位背缘，强化剪影 */
      R._rim = new THREE.DirectionalLight(PAL.lightning, L.rimIntensity !== undefined ? L.rimIntensity : 1.15);
      R._rim.position.set(-14, 46, -70);
      R._rim.target.position.set(0, 6, 0);
      scene.add(R._rim);
      scene.add(R._rim.target);

      /* 英雄光：始终从镜头左上方跟随双方中点，保证 2.5D 机位看到的面永远有细节，
         与固定主光形成左右夹光；这是夜景里机甲不再渲染成黑色剪影的关键。 */
      R._hero = new THREE.DirectionalLight(0xfff0dc, L.heroIntensity !== undefined ? L.heroIntensity : 1.65);
      R._hero.position.set(-12, 24, 40);
      R._hero.target.position.set(0, 5, 0);
      R._hero.castShadow = false;
      scene.add(R._hero);
      scene.add(R._hero.target);

      /* 特效点光池容量 = 剩余点光预算（预留 2 盏给单位专属光） */
      R._fxLightCount = Math.max(1, RENDER.maxLights.point - R._lights.point - 2);
    },

    /* =======================================================================
     * _makeEnvTexture()
     *   程序化生成「雨夜城市」等距柱状环境图：顶部冷蓝夜空、地平线暖橙城市辉光、
     *   下方深色湿地面，并叠加楼宇剪影与零星窗光。金属装甲反射的是战场环境，
     *   而不是 RoomEnvironment 那种灰白摄影棚，体积感和色调统一得多。
     * ==================================================================== */
    _makeEnvTexture: function () {
      var c = document.createElement('canvas');
      c.width = 1024; c.height = 512;
      var g = c.getContext('2d');
      var grad = g.createLinearGradient(0, 0, 0, 512);
      grad.addColorStop(0.00, '#050d13');
      grad.addColorStop(0.38, '#0b1b22');
      grad.addColorStop(0.52, '#314247');
      grad.addColorStop(0.62, '#1a2427');
      grad.addColorStop(1.00, '#070a0c');
      g.fillStyle = grad; g.fillRect(0, 0, 1024, 512);

      /* 地平线暖光（城市灯海） */
      var warm = g.createRadialGradient(300, 300, 10, 300, 300, 360);
      warm.addColorStop(0, 'rgba(255, 176, 92, 0.55)');
      warm.addColorStop(0.45, 'rgba(255, 150, 72, 0.16)');
      warm.addColorStop(1, 'rgba(255, 150, 72, 0)');
      g.fillStyle = warm; g.fillRect(0, 0, 1024, 512);
      var cool = g.createRadialGradient(760, 280, 10, 760, 280, 320);
      cool.addColorStop(0, 'rgba(111, 208, 255, 0.30)');
      cool.addColorStop(1, 'rgba(111, 208, 255, 0)');
      g.fillStyle = cool; g.fillRect(0, 0, 1024, 512);

      /* 楼宇剪影 + 窗光：在金属上形成竖向反射条纹 */
      for (var i = 0; i < 42; i++) {
        var w = U.rand(10, 34), h = U.rand(30, 150);
        var x = U.rand(0, 1024), y = 300 - h;
        g.fillStyle = 'rgba(6, 12, 15, ' + U.rand(0.35, 0.8).toFixed(2) + ')';
        g.fillRect(x, y, w, h + 120);
        for (var ww = 0; ww < 8; ww++) {
          if (Math.random() > 0.45) continue;
          g.fillStyle = Math.random() < 0.8 ? 'rgba(255, 196, 116, 0.5)' : 'rgba(170, 220, 255, 0.4)';
          g.fillRect(x + U.rand(2, w - 4), y + U.rand(4, Math.max(5, h - 4)), U.rand(1, 2.5), U.rand(1, 2.5));
        }
      }
      var tex = new THREE.CanvasTexture(c);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    },

    /* =======================================================================
     * _buildEnvironment(scene)
     *   用程序化城市环境图 + PMREMGenerator 生成 IBL 环境贴图。
     *   PBR 金属漫反射为 0，外观全靠环境反射；没有 IBL 时金属会渲染成黑色。
     * ==================================================================== */
    _buildEnvironment: function (scene) {
      if (!RENDER.envMap || !RENDER.envMap.enabled) return;
      var a = ADDONS || {};
      if (!THREE.PMREMGenerator) {
        if (!R._warnedNoEnv) {
          R._warnedNoEnv = true;
          console.warn('[Renderer] PMREMGenerator 不可用，跳过 IBL 环境贴图。');
        }
        return;
      }
      try {
        var pmrem = new THREE.PMREMGenerator(R.renderer);
        var envTex = R._makeEnvTexture();
        var rt = pmrem.fromEquirectangular(envTex);
        envTex.dispose();
        scene.environment = rt.texture;
        if ('environmentIntensity' in scene) scene.environmentIntensity = RENDER.envMap.intensity;
        pmrem.dispose();
        R._envRT = rt;
      } catch (e) {
        if (!R._warnedNoEnv) {
          R._warnedNoEnv = true;
          console.warn('[Renderer] IBL 环境贴图生成失败，已跳过：', e && e.message);
        }
      }
    },

    /* 月牙刀光几何：两端收尖、中段最厚，端部顶点压暗形成渐隐。
       比整圈厚环带更像“挥砍轨迹”，也不会在加法混合下糊成白盘。 */
    _makeArcGeometry: function () {
      var segs = 48;
      var arc = Math.PI * 1.18;
      var pos = [], col = [], uv = [], idx = [];
      for (var i = 0; i <= segs; i++) {
        var t = i / segs;
        var a = -arc * 0.5 + arc * t;
        var mid = Math.sin(Math.PI * t);
        var thick = 0.035 + 0.115 * mid;
        var outer = 1.0;
        var inner = outer - thick;
        pos.push(Math.cos(a) * outer, Math.sin(a) * outer, 0);
        pos.push(Math.cos(a) * inner, Math.sin(a) * inner, 0);
        var edge = 0.24 + 0.76 * Math.pow(mid, 0.55);
        col.push(edge, edge, edge, edge * 0.72, edge * 0.72, edge * 0.72);
        uv.push(t, 1, t, 0);
      }
      for (var s = 0; s < segs; s++) {
        var a0 = s * 2, b0 = s * 2 + 1, a1 = s * 2 + 2, b1 = s * 2 + 3;
        idx.push(a0, b0, a1, b0, b1, a1);
      }
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeBoundingSphere();
      return geo;
    },

    /* 特效对象池：火花 / 闪光 / 尘雾 / 冲击波环 / 特效点光（一次预建，热身后零分配） */
    _buildFxPools: function (scene) {
      var tex = R._glowTex;
      var group = new THREE.Group();
      group.name = 'fx';
      scene.add(group);
      R._fxGroup = group;

      var i;
      for (i = 0; i < FX.spark; i++) {
        var sm = new THREE.SpriteMaterial({ map: tex, color: 0xffffff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
        var sp = new THREE.Sprite(sm);
        sp.visible = false;
        group.add(sp);
        R._sparks.push({ sprite: sp, vel: new THREE.Vector3(), life: 0, maxLife: 1, active: false, size: 1 });
      }
      for (i = 0; i < FX.flash; i++) {
        var fm = new THREE.SpriteMaterial({ map: tex, color: 0xffffff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
        var fs = new THREE.Sprite(fm);
        fs.visible = false;
        group.add(fs);
        R._flashes.push({ sprite: fs, life: 0, maxLife: 1, active: false, size: 1 });
      }
      for (i = 0; i < FX.dust; i++) {
        var dm = new THREE.SpriteMaterial({ map: tex, color: PAL.smoke, transparent: true, opacity: 0, depthWrite: false, fog: false });
        var ds = new THREE.Sprite(dm);
        ds.visible = false;
        group.add(ds);
        R._dusts.push({ sprite: ds, vel: new THREE.Vector3(), life: 0, maxLife: 1, active: false, size: 1 });
      }
      /* 细冲击波环：环带越窄，扩散时越像能量波而不是糊满屏幕的白盘 */
      R._ringGeo = new THREE.RingGeometry(0.88, 1, 56);
      for (i = 0; i < FX.ring; i++) {
        var rm = new THREE.MeshBasicMaterial({ color: PAL.lightning, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
        var rmesh = new THREE.Mesh(R._ringGeo, rm);
        rmesh.visible = false;
        group.add(rmesh);
        R._rings.push({ mesh: rmesh, life: 0, maxLife: 1, active: false, from: 1, to: 1 });
      }

      /* P2 护盾波纹池（水平能量环，NormalBlending + Additive） */
      for (i = 0; i < FX.shield; i++) {
        var sm2 = new THREE.MeshBasicMaterial({ color: 0x6fd0ff, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
        var sgeo = new THREE.RingGeometry(0.6, 1, 48);
        var smesh = new THREE.Mesh(sgeo, sm2);
        smesh.rotation.x = Math.PI * 0.5;
        smesh.visible = false;
        group.add(smesh);
        R._shields.push({ mesh: smesh, life: 0, maxLife: 1, active: false, from: 1, to: 1 });
      }

      /* P2 攻击拖尾池：每条 = 一条带状几何体（segments 段 * 2 顶点），
         顶点位置在 update 中按 head 世界坐标重写。 */
      var T = (FXCFG.trail) || {};
      var seg = Math.max(4, (T.segments || 16) | 0);
      var trailGeo = new THREE.BufferGeometry();
      var positions = new Float32Array(seg * 2 * 3);
      var colors = new Float32Array(seg * 2 * 3);
      var indices = [];
      for (var s = 0; s < seg - 1; s++) {
        var a = s * 2, b = s * 2 + 1, c = s * 2 + 2, d = s * 2 + 3;
        indices.push(a, c, b, b, c, d);
      }
      trailGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      trailGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      trailGeo.setIndex(indices);
      trailGeo.computeBoundingSphere();
      for (i = 0; i < FX.trail; i++) {
        var tm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, vertexColors: true, fog: false });
        var tmesh = new THREE.Mesh(trailGeo, tm);
        tmesh.visible = false;
        tmesh.frustumCulled = false;
        group.add(tmesh);
        var pts = [];
        for (var p = 0; p < seg; p++) pts.push(new THREE.Vector3());
        R._trails.push({
          mesh: tmesh, unit: null, color: 0x6fd0ff, active: false, age: 0,
          head: new THREE.Vector3(), points: pts, seg: seg,
          positions: positions.slice(), colors: colors.slice()
        });
      }
      R._trailSeg = seg;

      /* 刀光弧池：共享一个月牙几何体，MeshBasicMaterial 加法混合 */
      R._arcGeo = R._makeArcGeometry();
      for (i = 0; i < FX.arc; i++) {
        var am = new THREE.MeshBasicMaterial({
          color: 0x9fd8ff, transparent: true, opacity: 0,
          side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
          depthWrite: false, fog: false, vertexColors: true
        });
        var amesh = new THREE.Mesh(R._arcGeo, am);
        amesh.visible = false;
        amesh.frustumCulled = false;
        group.add(amesh);
        R._arcs.push({
          mesh: amesh, life: 0, maxLife: 1, active: false,
          from: 1, to: 1, opacity: 1, rotZ: 0, spin: 0
        });
      }

      for (i = 0; i < R._fxLightCount; i++) {
        if (R._lights.point >= RENDER.maxLights.point) break;
        var l = new THREE.PointLight(PAL.emberOrange, 0, 60, 2);
        l.position.set(0, 6, 0);
        scene.add(l);
        R._fxLights.push({ light: l, life: 0, maxLife: 1, active: false, base: 1 });
        R._lights.point++;
      }
    },

    /* 调试辅助层（初始为空，仅作为可见性开关的载体） */
    _buildDebugHelpers: function (scene) {
      R._debugGroup = new THREE.Group();
      R._debugGroup.name = 'debug-hitboxes';
      R._debugGroup.visible = !!R._debugHitboxes;
      scene.add(R._debugGroup);
    },

    /* 径向发光贴图（火花 / 闪光 / 尘雾共用），程序化生成，无外部素材 */
    _makeGlowTexture: function () {
      var size = 64;
      var c = global.document.createElement('canvas');
      c.width = c.height = size;
      var g = c.getContext('2d');
      var grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
      var tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    },

    /* 内联 GLSL 暗角（offset / darkness 取自 CONFIG.render.vignette） */
    _vignetteShaderDef: function () {
      return {
        uniforms: {
          tDiffuse: { value: null },
          offset: { value: RENDER.vignette.offset },
          darkness: { value: RENDER.vignette.darkness }
        },
        vertexShader: [
          'varying vec2 vUv;',
          'void main() {',
          '  vUv = uv;',
          '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
          '}'
        ].join('\n'),
        fragmentShader: [
          'varying vec2 vUv;',
          'uniform sampler2D tDiffuse;',
          'uniform float offset;',
          'uniform float darkness;',
          'void main() {',
          '  vec4 texel = texture2D(tDiffuse, vUv);',
          '  vec2 uv = (vUv - 0.5) * offset;',
          '  float v = smoothstep(0.25, 1.0, dot(uv, uv));',
          '  texel.rgb *= (1.0 - darkness * v);',
          '  gl_FragColor = texel;',
          '}'
        ].join('\n')
      };
    },

    /* 景深着色器定义：按深度只虚化「相机焦点平面之后」的远景（城市天际线/远楼），
     *   主体机甲怪兽位于焦点平面之前或附近，保持全清晰。
     *   5 抽样十字模糊，成本可控；低画质预设直接关闭该 pass。 */
    _dofShaderDef: function () {
      var dcfg = RENDER.dof || {};
      return {
        uniforms: {
          tDiffuse: { value: null },
          tDepth: { value: null },
          uNear: { value: CAM.near },
          uFar: { value: CAM.far },
          uFocus: { value: CAM.baseDistance + (dcfg.focusOffset || 26) },
          uRange: { value: dcfg.range || 150 },
          uStrength: { value: dcfg.strength || 0.55 },
          uMaxPx: { value: dcfg.maxPx || 3.2 },
          uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) }
        },
        vertexShader: [
          'varying vec2 vUv;',
          'void main() {',
          '  vUv = uv;',
          '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
          '}'
        ].join('\n'),
        fragmentShader: [
          'varying vec2 vUv;',
          'uniform sampler2D tDiffuse;',
          'uniform sampler2D tDepth;',
          'uniform float uNear;',
          'uniform float uFar;',
          'uniform float uFocus;',
          'uniform float uRange;',
          'uniform float uStrength;',
          'uniform float uMaxPx;',
          'uniform vec2 uTexel;',
          'void main() {',
          '  vec4 base = texture2D(tDiffuse, vUv);',
          '  float d = texture2D(tDepth, vUv).x;',
          '  float z = d * 2.0 - 1.0;',
          '  float dz = (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));',
          '  float coc = clamp((dz - uFocus) / max(uRange, 1.0), 0.0, 1.0);',
          '  coc = coc * coc * uStrength;',
          '  if (coc < 0.003) { gl_FragColor = base; return; }',
          '  vec2 r = uTexel * (coc * uMaxPx);',
          '  vec4 c = base * 0.40;',
          '  c += texture2D(tDiffuse, vUv + vec2( r.x, 0.0)) * 0.15;',
          '  c += texture2D(tDiffuse, vUv + vec2(-r.x, 0.0)) * 0.15;',
          '  c += texture2D(tDiffuse, vUv + vec2(0.0,  r.y)) * 0.15;',
          '  c += texture2D(tDiffuse, vUv + vec2(0.0, -r.y)) * 0.15;',
          '  gl_FragColor = c;',
          '}'
        ].join('\n')
      };
    },

    /* =======================================================================
     * 后处理链：RenderPass -> [景深] -> UnrealBloom -> 暗角 -> FilmPass -> OutputPass
     *   P3：每个 pass 是否启用 = 画质预设 enabled AND 用户运行时开关 RENDER.postFx.*
     * ==================================================================== */
    _buildPost: function () {
      var a = ADDONS || {};
      /* 有效开关：预设 enabled && 用户运行时开关 */
      var bloomOn = !!(RENDER.bloom.enabled && RENDER.postFx.bloom);
      var vignetteOn = !!(RENDER.vignette.enabled && RENDER.postFx.vignette);
      var filmOn = !!(RENDER.filmGrain.enabled && RENDER.postFx.filmGrain);
      var dofOn = !!(RENDER.dof && RENDER.dof.enabled && a.ShaderPass);

      var need = ['EffectComposer', 'RenderPass'];
      if (bloomOn) need.push('UnrealBloomPass');
      if (vignetteOn || dofOn) need.push('ShaderPass');
      if (filmOn) need.push('FilmPass');
      need.push('OutputPass');

      var miss = [];
      for (var i = 0; i < need.length; i++) if (!a[need[i]]) miss.push(need[i]);
      if (miss.length) { R._postFallback('缺少 ' + miss.join('/')); return; }

      /* 重建前释放旧 composer */
      if (R.composer && R.composer.dispose) { try { R.composer.dispose(); } catch (e) {} }
      R._bloomPass = null; R._vignettePass = null; R._dofPass = null;

      /* 景深需要带深度纹理的渲染目标；任何不支持/异常都回退到普通链路，绝不让画面黑屏 */
      var composer = null;
      if (dofOn) {
        try {
          var depthTex = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
          depthTex.minFilter = THREE.NearestFilter;
          depthTex.magFilter = THREE.NearestFilter;
          var rt = new THREE.WebGLRenderTarget(1, 1, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            type: THREE.HalfFloatType,
            depthBuffer: true
          });
          rt.depthTexture = depthTex;
          composer = new a.EffectComposer(R.renderer, rt);
          /* RenderPass 先画进 rt2，景深 pass 再采样 rt2 的深度纹理并写入 rt1；
             因此深度纹理只能挂在 rt2 上，rt1 必须解绑，避免采样与写入同一纹理（反馈环）。 */
          if (composer.renderTarget2) composer.renderTarget2.depthTexture = depthTex;
          if (composer.renderTarget1) composer.renderTarget1.depthTexture = null;
          var ddef = R._dofShaderDef();
          R._dofPass = new a.ShaderPass(ddef);
          /* ShaderPass 会克隆 uniform，纹理必须在其构造之后再绑定真实深度纹理 */
          R._dofPass.uniforms.tDepth.value = depthTex;
          R._dofPass.uniforms.uNear.value = CAM.near;
          R._dofPass.uniforms.uFar.value = CAM.far;
        } catch (err) {
          console.warn('[Post] 景深初始化失败，已回退普通后处理链', err && err.message);
          R._dofPass = null;
          composer = null;
          dofOn = false;
        }
      }
      if (!composer) composer = new a.EffectComposer(R.renderer);

      composer.addPass(new a.RenderPass(R.scene, R.camera));
      if (R._dofPass) composer.addPass(R._dofPass);

      if (bloomOn) {
        var res = new THREE.Vector2(R._size ? R._size.x : 1, R._size ? R._size.y : 1);
        R._bloomPass = new a.UnrealBloomPass(res, RENDER.bloom.strength, RENDER.bloom.radius, RENDER.bloom.threshold);
        composer.addPass(R._bloomPass);
      }
      if (vignetteOn) {
        R._vignettePass = new a.ShaderPass(R._vignetteShaderDef());
        composer.addPass(R._vignettePass);
      }
      if (filmOn) {
        composer.addPass(new a.FilmPass(RENDER.filmGrain.intensity, false));
      }
      composer.addPass(new a.OutputPass());
      R.composer = composer;

      /* 同步尺寸 */
      if (R._size) R.composer.setSize(R._size.x, R._size.y);
    },

    /* P3：自动检测画质等级（low / medium / high） */
    detectQuality: function () {
      var aq = RENDER.autoQuality || {};
      var dpr = (typeof global !== 'undefined' && global.devicePixelRatio) || 1;
      var w = (typeof global !== 'undefined' && global.innerWidth) || 1280;
      var h = (typeof global !== 'undefined' && global.innerHeight) || 720;
      var area = w * h;
      var isMobile = (typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '')) ||
        (typeof global !== 'undefined' && global.ontouchstart !== undefined && area < (1280 * 800));

      /* 桌面端不再因为 1080p / dpr=1 被误判成低画质：只有小窗口或低核心数才降档。
         低画质仍可在暂停菜单手动选择。 */
      if (isMobile) return (aq.mobileForceLow !== false) ? 'medium' : 'high';
      var cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 8;
      if (area <= 1024 * 600 || cores <= 4) return 'medium';
      return 'high';
    },

    /* P3：应用画质预设（合并到 RENDER 并重建后处理 / 阴影） */
    setQuality: function (level) {
      var presets = RENDER.qualityPresets || {};
      var preset = presets[level];
      if (!preset) {
        /* auto → 检测 */
        level = R.detectQuality();
        preset = presets[level] || presets.high;
      }
      RENDER.quality = level;
      RENDER._appliedQuality = level;

      /* 合并预设到运行时参数（浅合并子对象） */
      var merge = function (dst, src) {
        if (!src) return;
        for (var k in src) {
          if (!src.hasOwnProperty(k)) continue;
          if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) {
            if (!dst[k]) dst[k] = {};
            merge(dst[k], src[k]);
          } else {
            dst[k] = src[k];
          }
        }
      };
      merge(RENDER, preset);

      /* 粒子 / 雨滴规模（广播给特效系统用） */
      R._particleScale = preset.particleScale != null ? preset.particleScale : 1;
      R._rainScale = preset.rainScale != null ? preset.rainScale : 1;
      /* 雨幕与地面溅水按画质缩减（同一份 Points/网格复用，只改可见数量，不新建对象） */
      if (R.city) R.city.rainScale = R._rainScale;

      /* 重建阴影设置 */
      if (R.renderer) {
        R.renderer.shadowMap.enabled = !!RENDER.shadows.enabled;
        R.renderer.shadowMap.type = R._shadowType(RENDER.shadows.type);
      }

      /* 重建后处理链 */
      R._buildPost();

      /* 同步像素比 / 分辨率 */
      R._applyResolution();

      if (U && U.bus && U.bus.emit) U.bus.emit('renderer:quality', { level: level });
      return level;
    },

    /* P3：运行时切换单个后处理效果（不重建画质预设） */
    setPostFx: function (opts) {
      opts = opts || {};
      if (opts.bloom !== undefined) RENDER.postFx.bloom = !!opts.bloom;
      if (opts.vignette !== undefined) RENDER.postFx.vignette = !!opts.vignette;
      if (opts.filmGrain !== undefined) RENDER.postFx.filmGrain = !!opts.filmGrain;
      R._buildPost();
      if (U && U.bus && U.bus.emit) U.bus.emit('renderer:postfx', { postFx: RENDER.postFx });
    },

    /* P3：应用分辨率缩放（像素比 × resolutionScale） */
    _applyResolution: function () {
      if (!R.renderer || !R._size) return;
      var base = Math.min((typeof global !== 'undefined' && global.devicePixelRatio) || 1, RENDER.pixelRatioCap);
      var scale = RENDER.resolutionScale != null ? RENDER.resolutionScale : 1;
      R.renderer.setPixelRatio(Math.max(0.5, base * scale));
      R.renderer.setSize(R._size.x, R._size.y, false);
      if (R.composer && R.composer.setSize) R.composer.setSize(R._size.x, R._size.y);
    },

    /* P3：当前画质等级（auto 模式返回已应用的实际等级） */
    getQuality: function () { return RENDER._appliedQuality || RENDER.quality || 'high'; },

    /* addon 缺失：回退到 renderer.render(scene, camera)，仅告警一次 */
    _postFallback: function (msg) {
      R.composer = null;
      if (!R._warnedNoPost) {
        R._warnedNoPost = true;
        console.warn('[Renderer] 后处理不可用（' + msg + '），回退 renderer.render(scene, camera)。');
      }
    },

    /* 池取用：优先空闲，池满时复用最接近过期的一项 */
    _acquire: function (pool) {
      if (!pool || !pool.length) return null;
      var best = null, bestRatio = Infinity;
      for (var i = 0; i < pool.length; i++) {
        var it = pool[i];
        if (!it.active) return it;
        var r = it.maxLife > 0 ? it.life / it.maxLife : 0;
        if (r < bestRatio) { bestRatio = r; best = it; }
      }
      return best;
    },

    /* 特效点光脉冲（复用池内光源） */
    _pulseFxLight: function (pos, color, intensity, life) {
      var slot = null, bestRatio = Infinity;
      for (var i = 0; i < R._fxLights.length; i++) {
        var f = R._fxLights[i];
        if (!f.active) { slot = f; break; }
        var r = f.maxLife > 0 ? f.life / f.maxLife : 0;
        if (r < bestRatio) { bestRatio = r; slot = f; }
      }
      if (!slot) return;
      slot.light.position.copy(pos);
      slot.light.color.setHex(color);
      slot.light.intensity = intensity;
      slot.base = intensity;
      slot.life = slot.maxLife = Math.max(0.05, life);
      slot.active = true;
    },

    _pos: function (p) {
      if (p && p.isVector3) R._tmp.copy(p);
      else R._tmp.set((p && p.x) || 0, (p && p.y) || 0, (p && p.z) || 0);
      return R._tmp;
    },
    _targetPos: function (t) {
      if (!t) return null;
      if (t.isVector3) return t;
      if (t.position) return t.position;
      return null;
    },
    _facingBias: function (facing) {
      if (typeof facing === 'string') {
        if (facing === 'back') return 1;
        if (facing === 'front') return -1;
        return 0;
      }
      if (typeof facing === 'number') return U.sign(facing);
      if (facing && facing.x !== undefined) return U.sign(facing.x);
      return 0;
    },
    _sparkColor: function (base, idx) { return (idx % 4 === 0) ? PAL.windowWarm : base; },

    /* 尘雾：从池中取若干普通混合精灵，上升并淡出 */
    _spawnDust: function (x, y, z, scale) {
      var k = scale ? U.clamp(scale / 12, 0.6, 1.6) : 1;
      for (var i = 0; i < 6; i++) {
        var d = R._acquire(R._dusts);
        if (!d) break;
        d.sprite.position.set(x + U.rand(-2, 2), y + U.rand(-1, 1), z + U.rand(-2, 2));
        d.vel.set(U.rand(-2, 2), U.rand(1.2, 3.0), U.rand(-2, 2));
        d.size = U.rand(4, 8) * k;
        d.life = d.maxLife = U.rand(1.1, 1.9);
        d.sprite.material.opacity = 0.55;
        d.sprite.visible = true;
        d.active = true;
      }
    },

    /* 单位专属点光跟随 + 呼吸式明暗 */
    _updateUnitLights: function (t) {
      for (var i = 0; i < R._unitHandles.length; i++) {
        var h = R._unitHandles[i];
        if (!h.light) continue;
        var r = h.root;
        if (!r || r.visible === false) { h.light.intensity = 0; continue; }
        h.light.position.set(r.position.x, r.position.y + h.offset, r.position.z);
        h.light.intensity = h.base * (0.82 + 0.18 * Math.sin(t * 3.1 + h.phase));
      }
    },

    /* 火花 / 闪光 / 尘雾 / 冲击波环 / 特效点光 的逐帧推进 */
    _updateFx: function (dt) {
      var i, it, t, s;

      for (i = 0; i < R._sparks.length; i++) {
        it = R._sparks[i];
        if (!it.active) continue;
        it.life -= dt;
        if (it.life <= 0) { it.active = false; it.sprite.visible = false; continue; }
        it.vel.y += CONFIG.arena.gravity * dt;
        it.sprite.position.x += it.vel.x * dt;
        it.sprite.position.y += it.vel.y * dt;
        it.sprite.position.z += it.vel.z * dt;
        t = it.life / it.maxLife;
        s = it.size * (0.4 + 0.9 * t);
        it.sprite.scale.set(s, s, s);
        it.sprite.material.opacity = U.clamp(t * 1.4, 0, 1);
      }

      for (i = 0; i < R._flashes.length; i++) {
        it = R._flashes[i];
        if (!it.active) continue;
        it.life -= dt;
        if (it.life <= 0) { it.active = false; it.sprite.visible = false; continue; }
        t = it.life / it.maxLife;
        s = it.size * (1 + (1 - t) * 0.22);
        it.sprite.scale.set(s, s, s);
        /* 更快衰减：命中瞬间亮一下，不长时间糊住角色 */
        it.sprite.material.opacity = t * t * t;
      }

      for (i = 0; i < R._dusts.length; i++) {
        it = R._dusts[i];
        if (!it.active) continue;
        it.life -= dt;
        if (it.life <= 0) { it.active = false; it.sprite.visible = false; continue; }
        it.sprite.position.x += it.vel.x * dt;
        it.sprite.position.y += it.vel.y * dt;
        it.sprite.position.z += it.vel.z * dt;
        it.vel.multiplyScalar(1 - Math.min(1, dt * 0.8));
        t = it.life / it.maxLife;
        s = it.size * (1 + (1 - t) * 1.8);
        it.sprite.scale.set(s, s, s);
        it.sprite.material.opacity = 0.55 * t;
      }

      for (i = 0; i < R._rings.length; i++) {
        it = R._rings[i];
        if (!it.active) continue;
        it.life -= dt;
        if (it.life <= 0) { it.active = false; it.mesh.visible = false; continue; }
        var k = 1 - it.life / it.maxLife;            // 0 -> 1
        var e = 1 - (1 - k) * (1 - k);               // easeOutQuad
        s = U.lerp(it.from, it.to, e);
        it.mesh.scale.set(s, s, s);
        it.mesh.material.opacity = Math.pow(1 - k, 1.7) * 0.42;
      }

      /* P2 护盾波纹：径向扩散 + 淡出 */
      for (i = 0; i < R._shields.length; i++) {
        it = R._shields[i];
        if (!it.active) continue;
        it.life -= dt;
        if (it.life <= 0) { it.active = false; it.mesh.visible = false; continue; }
        var kk = 1 - it.life / it.maxLife;
        var ee = 1 - (1 - kk) * (1 - kk);
        s = U.lerp(it.from, it.to, ee);
        it.mesh.scale.set(s, s, s);
        it.mesh.material.opacity = (1 - kk) * 0.7;
      }

      for (i = 0; i < R._fxLights.length; i++) {
        it = R._fxLights[i];
        if (!it.active) continue;
        it.life -= dt;
        if (it.life <= 0) { it.active = false; it.light.intensity = 0; continue; }
        it.light.intensity = it.base * (it.life / it.maxLife);
      }
    },

    /* 刀光弧逐帧推进：快速放大 + 旋转 + 淡出 */
    _updateArcs: function (dt) {
      for (var i = 0; i < R._arcs.length; i++) {
        var it = R._arcs[i];
        if (!it.active) continue;
        it.life -= dt;
        if (it.life <= 0) { it.active = false; it.mesh.visible = false; continue; }
        var k = 1 - it.life / it.maxLife;
        var e = 1 - (1 - k) * (1 - k);
        var s = U.lerp(it.from, it.to, e);
        it.mesh.scale.set(s, s, s);
        it.mesh.rotation.z = it.rotZ + it.spin * k;
        it.mesh.material.opacity = (1 - k) * it.opacity;
      }
    },

    /* =======================================================================
     * P2 攻击拖尾：每帧采样刀尖 / 爪尖 / 右臂世界坐标 → 推进带状几何体顶点
     * ==================================================================== */
    _trailHeadPos: function (unit) {
      if (!unit) return R._tmp.set(0, 0, 0);
      var root = unit.root;
      /* 优先追踪武器插槽（bladeR → clawTipR → clawR），
         再回退右拳 / 前臂 / 大臂，最后用命中中心 + 前向偏移 */
      var anchor = null;
      if (root && root.getObjectByName) {
        anchor = root.getObjectByName('bladeR') ||
          root.getObjectByName('clawTipR') ||
          root.getObjectByName('clawR') ||
          root.getObjectByName('fistR') ||
          root.getObjectByName('forearmR') ||
          root.getObjectByName('armR');
      }
      if (anchor) {
        anchor.getWorldPosition(R._tmp);
      } else {
        var c = unit.getHitCenter ? unit.getHitCenter() : unit.position;
        var fwdX = Math.cos(unit.yaw || 0), fwdZ = Math.sin(unit.yaw || 0);
        R._tmp.set(c.x + fwdX * 3.0, c.y + 0.5, c.z + fwdZ * 3.0);
      }
      return R._tmp;
    },
    _updateTrails: function (dt) {
      var T = (FXCFG.trail) || {};
      var life = T.life || 0.22;
      var w = T.width || 1.6;
      var wf = T.widthFalloff !== undefined ? T.widthFalloff : 0.25;
      var opacity = T.opacity !== undefined ? T.opacity : 0.85;
      var cam = R.camera;

      for (var i = 0; i < R._trails.length; i++) {
        var tr = R._trails[i];
        if (!tr.active) continue;
        /* 已无对应单位（被回收）：渐隐收尾 */
        if (!tr.unit) {
          tr.age += dt;
          if (tr.age > life) { tr.active = false; tr.mesh.visible = false; }
          R._buildTrailMesh(tr, w, wf, opacity, cam, false);
          continue;
        }
        /* 采样新 head，并把所有段向后推（段 0 = 最新 head） */
        var head = R._trailHeadPos(tr.unit);
        tr.head.copy(head);
        for (var j = tr.points.length - 1; j > 0; j--) tr.points[j].copy(tr.points[j - 1]);
        tr.points[0].copy(head);
        tr.age = 0;
        R._buildTrailMesh(tr, w, wf, opacity, cam, true);
      }
    },
    /* 把 points[] 写成带状几何体顶点（左右两条边 + 顶点色渐变） */
    _buildTrailMesh: function (tr, width, widthFalloff, opacity, cam, visible) {
      var geo = tr.mesh.geometry;
      var pos = geo.attributes.position.array;
      var col = geo.attributes.color.array;
      var n = tr.points.length;
      var cx = cam ? cam.position.x : 0, cy = cam ? cam.position.y : 0, cz = cam ? cam.position.z : 0;
      var colR = ((tr.color >> 16) & 255) / 255;
      var colG = ((tr.color >> 8) & 255) / 255;
      var colB = (tr.color & 255) / 255;
      for (var i = 0; i < n; i++) {
        var p = tr.points[i];
        /* 法线方向：cross(段方向, 视线方向)，得到屏幕空间宽度方向 */
        var nx, ny, nz;
        if (i < n - 1) {
          nx = p.x - tr.points[i + 1].x;
          ny = p.y - tr.points[i + 1].y;
          nz = p.z - tr.points[i + 1].z;
        } else {
          nx = p.x - tr.points[i - 1].x;
          ny = p.y - tr.points[i - 1].y;
          nz = p.z - tr.points[i - 1].z;
        }
        var vx = cx - p.x, vy = cy - p.y, vz = cz - p.z;
        /* cross(n, v) */
        var px = ny * vz - nz * vy;
        var py = nz * vx - nx * vz;
        var pz = nx * vy - ny * vx;
        var pl = Math.sqrt(px * px + py * py + pz * pz) || 1;
        px /= pl; py /= pl; pz /= pl;
        var half = width * (i === 0 ? 1 : U.lerp(1, widthFalloff, i / (n - 1))) * 0.5;
        var a = i * 2 * 3;
        pos[a] = p.x + px * half;     pos[a + 1] = p.y + py * half;     pos[a + 2] = p.z + pz * half;
        pos[a + 3] = p.x - px * half; pos[a + 4] = p.y - py * half;     pos[a + 5] = p.z - pz * half;
        /* 顶点色：越靠近尾部越暗（模拟能量消散） */
        var f = U.clamp(1 - i / (n - 1), 0, 1);
        col[a] = colR * f; col[a + 1] = colG * f; col[a + 2] = colB * f;
        col[a + 3] = colR * f; col[a + 4] = colG * f; col[a + 5] = colB * f;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
      geo.computeBoundingSphere();
      tr.mesh.material.opacity = visible ? opacity : 0;
      tr.mesh.visible = visible;
    },

    /* 碎片：Ammo 模式下由 Physics 驱动并回收；不可用时走运动学回退 */
    _updateDebris: function (dt) {
      var write = 0;
      for (var i = 0; i < R._debris.length; i++) {
        var e = R._debris[i];
        if (e.kinematic && e.alive) {
          e.vel.y += CONFIG.arena.gravity * dt;
          e.mesh.position.x += e.vel.x * dt;
          e.mesh.position.y += e.vel.y * dt;
          e.mesh.position.z += e.vel.z * dt;
          if (e.mesh.position.y < 0.4) {
            e.mesh.position.y = 0.4;
            e.vel.y = Math.abs(e.vel.y) * 0.25;
            e.vel.x *= 0.72; e.vel.z *= 0.72;
          }
          e.mesh.rotation.x += e.spin.x * dt;
          e.mesh.rotation.y += e.spin.y * dt;
          e.mesh.rotation.z += e.spin.z * dt;
          e.life -= dt;
          if (e.life <= 0) R._finalizeDebris(e);
        }
        if (e.alive) R._debris[write++] = e;
      }
      R._debris.length = write;
    },

    /* Physics 到期回调：把对应碎片网格移出场景 */
    _expireDebris: function (handle) {
      for (var i = 0; i < R._debris.length; i++) {
        if (R._debris[i].handle === handle) { R._finalizeDebris(R._debris[i]); return; }
      }
    },
    _finalizeDebris: function (e) {
      if (!e || !e.alive) return;
      e.alive = false;
      if (e.mesh) R.scene.remove(e.mesh);
      e.handle = null;   // 刚体已由 Physics.removeBody 回收
    },

    /* 探照灯扫射 */
    _updateSearchlights: function (t) {
      for (var i = 0; i < R._searchlights.length; i++) {
        var s = R._searchlights[i];
        s.light.position.x = s.baseX + Math.sin(t * s.speed + s.phase) * 8;
        s.target.position.x = s.baseX + Math.sin(t * s.speed + s.phase) * 16;
        s.target.position.z = -6 + Math.cos(t * s.speed * 0.7 + s.phase) * 4;
        s.light.intensity = 2.2 * (0.8 + 0.2 * Math.sin(t * 3 + s.phase));
      }
    },

    /* 余烬光闪烁 + 城市辉光微呼吸 */
    _updateLightFlicker: function (t) {
      if (R._emberLight) {
        R._emberLight.intensity = R._emberBase * (0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 11 + Math.sin(t * 3.1) * 3)));
      }
      for (var i = 0; i < R._cityGlow.length; i++) {
        var g = R._cityGlow[i];
        g.light.intensity = g.base * (0.85 + 0.15 * Math.sin(t * 1.7 + g.phase));
      }
    },

    /* 必杀镜头缩放推进与因子（P2：参数取自 ART_CONFIG.fx.zoom，含 fovKick） */
    _advanceZoom: function (dt) {
      if (!R._zoomActive) return;
      R._zoomT += dt;
      var z = (FXCFG.zoom) || {};
      var inT = z.inTime !== undefined ? z.inTime : CAM.ultimateZoom.time;
      var hold = z.hold !== undefined ? z.hold : CAM.ultimateZoom.hold;
      var outT = z.outTime !== undefined ? z.outTime : CAM.ultimateZoom.time;
      if (R._zoomT > inT + hold + outT) {
        R._zoomActive = false; R._zoomT = 0;
        if (R.camera && R._fovBase !== undefined) { R.camera.fov = R._fovBase; R.camera.updateProjectionMatrix(); }
      } else if (R.camera && R._fovKick) {
        /* fov kick：在拉近瞬间快速收窄 fov，再缓慢回到基准，增强冲击 */
        var f = R._fovKick;
        var k = Math.min(1, R._zoomT / Math.max(0.01, inT));
        R.camera.fov = R._fovBase + f * (1 - k);
        R.camera.updateProjectionMatrix();
      }
    },
    _zoomFactor: function () {
      if (!R._zoomActive) return 1;
      var z = (FXCFG.zoom) || {};
      var scale = z.scale !== undefined ? z.scale : CAM.ultimateZoom.scale;
      var inT = z.inTime !== undefined ? z.inTime : CAM.ultimateZoom.time;
      var hold = z.hold !== undefined ? z.hold : CAM.ultimateZoom.hold;
      var outT = z.outTime !== undefined ? z.outTime : CAM.ultimateZoom.time;
      var t = R._zoomT;
      if (t < inT) return U.lerp(1, scale, t / inT);
      if (t < inT + hold) return scale;
      return U.lerp(scale, 1, Math.min(1, (t - inT - hold) / outT));
    }
  };

  GAME.Renderer = R;

})(typeof window !== 'undefined' ? window : this);
