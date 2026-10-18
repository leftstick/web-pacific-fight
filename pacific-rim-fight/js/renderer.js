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

  var THREE = null;          // 由 init 注入，禁止在脚本装载期使用
  var ADDONS = null;         // 由 init 注入（后处理 addon 集合）

  var DEG = Math.PI / 180;

  /* ---------------------------------------------------------------------------
   * 内部特效池容量（与 config 无关的内部常量，仅决定池大小）
   * ------------------------------------------------------------------------ */
  var FX = { spark: 84, flash: 18, dust: 40, ring: 6 };

  /* 命中等级参数：1 轻 / 2 重 / 3 必杀；颜色取自调色板 */
  var IMPACT = {
    1: { sparks: 10, speed: 15, sparkLife: 0.34, flashSize: 2.6, flashLife: 0.13, light: 5.0, lightLife: 0.18, ring: false, color: PAL.searchLight },
    2: { sparks: 20, speed: 22, sparkLife: 0.50, flashSize: 4.4, flashLife: 0.19, light: 16.0, lightLife: 0.30, ring: false, color: PAL.emberOrange },
    3: { sparks: 34, speed: 30, sparkLife: 0.72, flashSize: 7.0, flashLife: 0.28, light: 34.0, lightLife: 0.48, ring: true, color: PAL.lightning }
  };

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
    _vignettePass: null, _bloomPass: null,

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
        light = new THREE.PointLight(color, 0, 46, 2);
        R.scene.add(light);
        R._lights.point++;
      }

      var handle = {
        root: root, faction: faction, color: color, light: light,
        base: isMecha ? 1.5 : 1.8, offset: 0, phase: U.rand(0, 6.28)
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
     * spawnImpact(position, level, facing)
     *   池化的命中火花：加法混合精灵迸射 + 发光闪光 + 短时点光；
     *   level 1 轻 / 2 重 / 3 必杀（必杀额外展开一圈冲击波环）。
     *   热身后不再逐帧分配对象。
     * ==================================================================== */
    spawnImpact: function (position, level, facing) {
      if (!position) return;
      var lv = IMPACT[level] || IMPACT[1];
      var pos = R._pos(position);
      var fb = R._facingBias(facing);

      /* 火花迸射（背击更爆裂） */
      var n = lv.sparks + (fb > 0 ? 6 : 0);
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

      /* 必杀：冲击波环 */
      if (lv.ring) {
        var rg = R._acquire(R._rings);
        if (rg) {
          rg.mesh.position.copy(pos);
          rg.mesh.rotation.set(0, 0, 0);
          rg.mesh.material.color.setHex(PAL.lightning);
          rg.from = 1.2; rg.to = 16;
          rg.life = rg.maxLife = 0.55;
          rg.mesh.material.opacity = 1;
          rg.mesh.visible = true;
          rg.active = true;
        }
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
    },

    /* =======================================================================
     * cameraShake(intensity) —— 叠加式屏幕震动（上限 CONFIG.camera.shake.max）
     * ==================================================================== */
    cameraShake: function (intensity) {
      var add = (intensity === undefined ? 0.5 : intensity) * 0.6;
      R._shake = U.clamp(R._shake + add, 0, CAM.shake.max);
    },

    /* =======================================================================
     * zoomPunch() —— 触发必杀技镜头小幅拉近（CONFIG.camera.ultimateZoom）
     * ==================================================================== */
    zoomPunch: function () {
      R._zoomActive = true;
      R._zoomT = 0;
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

      /* 距离：保证横向可见半宽覆盖 span（竖直线性 fov → 距离换算） */
      var vTan = Math.tan(CAM.fov * DEG * 0.5);
      var need = span / (vTan * Math.max(0.4, cam.aspect));
      var dist = U.clamp(need, CAM.minDistance, CAM.maxDistance);

      R._dist = U.damp(R._dist, dist, CAM.distLerp, dt);
      R._midX = U.damp(R._midX, midX, CAM.followLerp, dt);
      var wantY = CAM.height + Math.max(0, topY - CAM.lookHeight) * 0.35;
      R._camY = U.damp(R._camY, wantY, CAM.heightLerp, dt);

      /* 必杀镜头缩放因子（在 update 中推进） */
      var zf = R._zoomFactor();
      var z = U.clamp(R._dist * zf, CAM.minDistance * CAM.ultimateZoom.scale, CAM.maxDistance);
      /* 相机 z 下限取 maxZ：永远位于战场 +Z 侧、不穿入场地 */
      if (z < CAM.maxZ) z = CAM.maxZ;

      cam.position.set(R._midX, R._camY, z);

      /* 震动偏移（加法） */
      var amt = R._shake;
      var rotZ = 0;
      if (amt > 0.001) {
        var t = R._elapsed * 26 + R._shakeSeed;
        cam.position.x += Math.sin(t * 1.7) * amt;
        cam.position.y += Math.cos(t * 2.3) * amt * 0.7;
        cam.position.z += Math.sin(t * 1.3) * amt * 0.2;
        rotZ = Math.sin(t * 2.1) * amt * CAM.shake.rotScale * 0.02;
        R._shake = Math.max(0, amt * Math.exp(-CAM.shake.decay * dt));
      } else {
        R._shake = 0;
      }

      /* 注视点：始终看向战场中线（lookHeight + offsetY），保持横向构图 */
      R._look.set(R._midX, CAM.lookHeight + CAM.offsetY, 0);
      cam.lookAt(R._look);
      cam.rotation.z += rotZ;
      cam.updateMatrixWorld();
    },

    /* =======================================================================
     * update(dt, elapsed)
     *   更新城市 / 火花 / 碎片 / 灯光闪烁，随后经 composer 渲染。
     * ==================================================================== */
    update: function (dt, elapsed) {
      dt = dt || 0;
      R._elapsed = (elapsed === undefined ? R._elapsed + dt : elapsed);

      if (R.city && R.city.update) R.city.update(dt, R._elapsed, R.camera);

      R._updateUnitLights(R._elapsed);
      R._updateFx(dt);
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
      if (R.renderer) R.renderer.setSize(w, h, false);

      var scale = RENDER.resolutionScale || 1;
      var bw = Math.max(1, Math.round(w * scale));
      var bh = Math.max(1, Math.round(h * scale));
      if (R.composer) R.composer.setSize(bw, bh);   // 会同步各 pass 尺寸
      if (R._bloomPass && R._bloomPass.setSize) R._bloomPass.setSize(bw, bh);
      if (R._size) R._size.set(w, h);
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
      if (R._ringGeo) R._ringGeo.dispose();
      if (R._glowTex) R._glowTex.dispose();

      if (R.scene && GAME.Models && GAME.Models.dispose) GAME.Models.dispose(R.scene);
      if (R.renderer) R.renderer.dispose();

      R._sparks.length = 0; R._flashes.length = 0; R._dusts.length = 0; R._rings.length = 0;
      R._unitHandles.length = 0; R._debris.length = 0;
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
      /* 半球光 + 环境光：提供基础体积感（过低会让结构不可读，故不再压到极限） */
      R._hemi = new THREE.HemisphereLight(PAL.skyTop, PAL.groundDiffuse, 0.34);
      R._hemi.position.set(0, 80, 0);
      scene.add(R._hemi);
      R._amb = new THREE.AmbientLight(PAL.skyBottom, 0.10);
      scene.add(R._amb);

      /* 冷色“月光”平行光：负责全部投影，方向取自 getSunDirection */
      var moon = new THREE.DirectionalLight(PAL.searchLight, 0.75);
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

      /* 冷色轮廓补光（无阴影，不计入点光预算）：从战场后方打亮单位背缘，强化剪影 */
      R._rim = new THREE.DirectionalLight(PAL.lightning, 0.42);
      R._rim.position.set(-14, 46, -70);
      R._rim.target.position.set(0, 6, 0);
      scene.add(R._rim);
      scene.add(R._rim.target);

      /* 特效点光池容量 = 剩余点光预算（预留 2 盏给单位专属光） */
      R._fxLightCount = Math.max(1, RENDER.maxLights.point - R._lights.point - 2);
    },

    /* =======================================================================
     * _buildEnvironment(scene)
     *   用 RoomEnvironment + PMREMGenerator 生成 IBL 环境贴图写入 scene.environment。
     *   PBR 金属漫反射为 0，外观全靠环境反射；没有 IBL 时金属会渲染成黑色。
     *   addon 缺失或生成失败时静默跳过（材质仍可用，仅失去环境反射）。
     * ==================================================================== */
    _buildEnvironment: function (scene) {
      if (!RENDER.envMap || !RENDER.envMap.enabled) return;
      var a = ADDONS || {};
      if (!a.RoomEnvironment || !THREE.PMREMGenerator) {
        if (!R._warnedNoEnv) {
          R._warnedNoEnv = true;
          console.warn('[Renderer] RoomEnvironment/PMREMGenerator 不可用，跳过 IBL 环境贴图。');
        }
        return;
      }
      try {
        var pmrem = new THREE.PMREMGenerator(R.renderer);
        var room = new a.RoomEnvironment();
        var rt = pmrem.fromScene(room, RENDER.envMap.blur || 0.04);
        scene.environment = rt.texture;
        if ('environmentIntensity' in scene) scene.environmentIntensity = RENDER.envMap.intensity;
        if (room.dispose) room.dispose();
        pmrem.dispose();
        R._envRT = rt;
      } catch (e) {
        if (!R._warnedNoEnv) {
          R._warnedNoEnv = true;
          console.warn('[Renderer] IBL 环境贴图生成失败，已跳过：', e && e.message);
        }
      }
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
      R._ringGeo = new THREE.RingGeometry(0.42, 1, 48);
      for (i = 0; i < FX.ring; i++) {
        var rm = new THREE.MeshBasicMaterial({ color: PAL.lightning, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
        var rmesh = new THREE.Mesh(R._ringGeo, rm);
        rmesh.visible = false;
        group.add(rmesh);
        R._rings.push({ mesh: rmesh, life: 0, maxLife: 1, active: false, from: 1, to: 1 });
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

    /* 后处理链：RenderPass -> UnrealBloom -> 内联 ShaderPass 暗角 -> FilmPass 颗粒 -> OutputPass */
    _buildPost: function () {
      var a = ADDONS || {};
      var need = ['EffectComposer', 'RenderPass'];
      if (RENDER.bloom.enabled) need.push('UnrealBloomPass');
      if (RENDER.vignette.enabled) need.push('ShaderPass');
      if (RENDER.filmGrain.enabled) need.push('FilmPass');
      need.push('OutputPass');

      var miss = [];
      for (var i = 0; i < need.length; i++) if (!a[need[i]]) miss.push(need[i]);
      if (miss.length) { R._postFallback('缺少 ' + miss.join('/')); return; }

      var composer = new a.EffectComposer(R.renderer);
      composer.addPass(new a.RenderPass(R.scene, R.camera));

      if (RENDER.bloom.enabled) {
        var res = new THREE.Vector2(R._size ? R._size.x : 1, R._size ? R._size.y : 1);
        R._bloomPass = new a.UnrealBloomPass(res, RENDER.bloom.strength, RENDER.bloom.radius, RENDER.bloom.threshold);
        composer.addPass(R._bloomPass);
      }
      if (RENDER.vignette.enabled) {
        R._vignettePass = new a.ShaderPass(R._vignetteShaderDef());
        composer.addPass(R._vignettePass);
      }
      if (RENDER.filmGrain.enabled) {
        composer.addPass(new a.FilmPass(RENDER.filmGrain.intensity, false));
      }
      composer.addPass(new a.OutputPass());
      R.composer = composer;
    },

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
        s = it.size * (1 + (1 - t) * 0.7);
        it.sprite.scale.set(s, s, s);
        it.sprite.material.opacity = t;
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
        it.mesh.material.opacity = (1 - k) * 0.9;
      }

      for (i = 0; i < R._fxLights.length; i++) {
        it = R._fxLights[i];
        if (!it.active) continue;
        it.life -= dt;
        if (it.life <= 0) { it.active = false; it.light.intensity = 0; continue; }
        it.light.intensity = it.base * (it.life / it.maxLife);
      }
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

    /* 必杀镜头缩放推进与因子 */
    _advanceZoom: function (dt) {
      if (!R._zoomActive) return;
      R._zoomT += dt;
      var ut = CAM.ultimateZoom;
      if (R._zoomT > ut.time * 2 + ut.hold) { R._zoomActive = false; R._zoomT = 0; }
    },
    _zoomFactor: function () {
      if (!R._zoomActive) return 1;
      var ut = CAM.ultimateZoom, t = R._zoomT;
      if (t < ut.time) return U.lerp(1, ut.scale, t / ut.time);
      if (t < ut.time + ut.hold) return ut.scale;
      return U.lerp(ut.scale, 1, Math.min(1, (t - ut.time - ut.hold) / ut.time));
    }
  };

  GAME.Renderer = R;

})(typeof window !== 'undefined' ? window : this);
