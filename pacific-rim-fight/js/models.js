/* =============================================================================
 * models.js  ──  程序化低模占位 + 夜晚废墟城市 + GLTF 替换接口
 * 依赖：config.js（GAME.CONFIG / GAME.U）
 * 加载方式：普通 <script>，挂载 window.GAME.Models
 * 说明：
 *   · 所有几何/贴图均在运行时程序化生成，不依赖任何外部素材文件
 *   · prepareUnit(def) 会先尝试加载 def.model.url 指定的 GLB（高清模型替换接口），
 *     失败或未配置时回退到本文件的程序化低模，保证功能始终完整
 *   · 动画通过 THREE.AnimationMixer 驱动（程序化 AnimationClip 作用在命名部件上），
 *     当替换为带骨骼的 GLTF 时，直接使用 GLTF 自带的 clips，接口不变
 * ========================================================================== */
(function (global) {
  'use strict';

  var GAME = global.GAME;
  var U = GAME.U;
  var CONFIG = GAME.CONFIG;
  var ART = CONFIG.art;
  var PAL = ART.palette;
  var THREE = null;          // 由 init() 注入，禁止在脚本装载时使用

  var Models = {
    /* ------------------------------------------------------------------ */
    /* 初始化                                                              */
    /* ------------------------------------------------------------------ */
    init: function (three) {
      THREE = three;
      return this;
    },

    /* GLTF 替换接口：把 manifest 中配置的 url 合并进 def.model */
    applyManifest: function (def) {
      var man = CONFIG.models.manifest || {};
      var entry = man[def.id];
      if (entry) {
        def.model = def.model || {};
        if (entry.url) def.model.url = CONFIG.models.basePath + entry.url;
        if (entry.scale) def.model.scale = entry.scale;
        if (entry.rotationY) def.model.rotationY = entry.rotationY;
      } else if (def.model && def.model.url && def.model.url.indexOf('/') < 0) {
        /* 只给了文件名时补上相对目录 */
        def.model.url = CONFIG.models.basePath + def.model.url;
      }
      return def;
    },

    /* 加载 GLB/GLTF（由 index.html 注入的 addons.GLTFLoader 提供加载器） */
    loadGLTF: function (url) {
      return new Promise(function (resolve, reject) {
        var addons = GAME.Renderer && GAME.Renderer.addons;
        var Loader = addons && addons.GLTFLoader;
        if (!Loader) { reject(new Error('GLTFLoader 未注入')); return; }
        try {
          var loader = new Loader();
          loader.load(url, function (gltf) { resolve(gltf); }, undefined, function (err) { reject(err || new Error('GLTF 加载失败: ' + url)); });
        } catch (e) { reject(e); }
      });
    },

    /* 准备单位模型：优先高清 GLTF，失败回退程序化占位（永不 reject） */
    prepareUnit: function (def) {
      Models.applyManifest(def);
      var url = def.model && def.model.url;
      if (CONFIG.models.enableGLTF && url) {
        return Models.loadGLTF(url).then(function (gltf) {
          var root = gltf.scene || gltf.scenes[0];
          root.traverse(function (o) {
            if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
          });
          var s = (def.model.scale || 1);
          root.scale.multiplyScalar(s);
          if (def.model.rotationY) root.rotation.y += def.model.rotationY;
          return { root: root, clips: (gltf.animations || []), gltf: gltf, isPlaceholder: false, mixerTarget: root };
        }).catch(function (e) {
          console.warn('[Models] 高清模型加载失败，回退程序化低模：', def.id, e && e.message);
          var built = Models.build(def);
          return { root: built.root, clips: built.clips, gltf: null, isPlaceholder: true, mixerTarget: built.root, parts: built.parts, glowMaterials: built.glowMaterials, hitCenterY: built.hitCenterY };
        });
      }
      var b = Models.build(def);
      return Promise.resolve({ root: b.root, clips: b.clips, gltf: null, isPlaceholder: true, mixerTarget: b.root, parts: b.parts, glowMaterials: b.glowMaterials, hitCenterY: b.hitCenterY });
    },

    build: function (def) {
      return def.faction === 'kaiju' ? Models.buildKaiju(def) : Models.buildMecha(def);
    },

    /* ================================================================== */
    /* 通用建模辅助                                                        */
    /* ================================================================== */
    _mat: function (color, opts) {
      opts = opts || {};
      return new THREE.MeshStandardMaterial({
        color: color,
        metalness: opts.metalness !== undefined ? opts.metalness : 0.85,
        roughness: opts.roughness !== undefined ? opts.roughness : 0.45,
        emissive: opts.emissive !== undefined ? opts.emissive : 0x000000,
        emissiveIntensity: opts.emissiveIntensity || 1,
        flatShading: !!opts.flat
      });
    },
    _glowMat: function (color, intensity) {
      return new THREE.MeshStandardMaterial({
        color: color, metalness: 0.2, roughness: 0.3,
        emissive: color, emissiveIntensity: intensity === undefined ? 2.2 : intensity
      });
    },
    /* 零件：带名字的 Group，便于 AnimationClip 定位 */
    _part: function (name, parent, x, y, z) {
      var g = new THREE.Group();
      g.name = name;
      g.position.set(x || 0, y || 0, z || 0);
      parent.add(g);
      return g;
    },
    _box: function (parent, w, h, d, mat, x, y, z, ry) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x || 0, y || 0, z || 0);
      if (ry) m.rotation.y = ry;
      m.castShadow = true; m.receiveShadow = true;
      parent.add(m);
      return m;
    },
    _cyl: function (parent, rt, rb, h, mat, x, y, z, seg) {
      var m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 8), mat);
      m.position.set(x || 0, y || 0, z || 0);
      m.castShadow = true; m.receiveShadow = true;
      parent.add(m);
      return m;
    },

    /* ================================================================== */
    /* 玩家机甲（环太平洋重型机甲风格）                                     */
    /* ================================================================== */
    buildMecha: function (def) {
      var H = def.height * (def.scale || 1);
      var style = def.style;
      var heavy = style === 'heavy';
      var w = heavy ? 1.28 : 1.0;                 // 体格宽度系数
      var armor = Models._mat(def.armor, { metalness: 0.9, roughness: 0.42 });
      var accent = Models._mat(def.accent, { metalness: 0.85, roughness: 0.4 });
      var dark = Models._mat(0x10151a, { metalness: 0.7, roughness: 0.6 });
      var glow = Models._glowMat(def.glow, 2.4);
      var glowWarm = Models._glowMat(0xffd9a0, 1.6);
      var glowMaterials = [glow, glowWarm];

      var root = new THREE.Group();
      root.name = def.id;
      var parts = {};

      /* --- 腿部（从髋部向下，落地于 y=0）--- */
      var legLen = H * 0.46;
      var thigh = legLen * 0.52, shin = legLen * 0.42;
      var parts4 = parts;
      ['L', 'R'].forEach(function (side, i) {
        var sx = (side === 'L' ? -1 : 1) * H * 0.085 * w;
        var leg = Models._part('leg' + side, root, sx, H * 0.47, 0);
        leg.rotation.z = (side === 'L' ? 1 : -1) * 0.02;
        Models._box(leg, H * 0.085 * w, thigh, H * 0.09 * w, armor, 0, -thigh * 0.5, 0);      // 大腿
        Models._box(leg, H * 0.06 * w, thigh * 0.5, H * 0.1 * w, accent, 0, -thigh * 0.2, 0); // 髋侧甲
        var knee = Models._part('shin' + side, leg, 0, -thigh, 0);
        Models._cyl(knee, H * 0.05, H * 0.05, H * 0.06, dark, 0, 0, 0, 10);
        Models._box(knee, H * 0.07 * w, shin, H * 0.075 * w, armor, 0, -shin * 0.5, 0);
        Models._box(knee, H * 0.075 * w, H * 0.03, H * 0.085 * w, accent, 0, 0.01, H * 0.005); // 膝甲
        var foot = Models._part('foot' + side, knee, 0, -shin, 0);
        Models._box(foot, H * 0.1 * w, H * 0.04, H * 0.14 * w, dark, 0, H * 0.02, H * 0.02);
        Models._box(foot, H * 0.105 * w, H * 0.02, H * 0.05, glowWarm, 0, H * 0.04, H * 0.07); // 足部灯带
      });

      /* --- 髋 --- */
      var hip = Models._part('hip', root, 0, H * 0.47, 0);
      Models._box(hip, H * 0.16 * w, H * 0.06, H * 0.1 * w, armor, 0, H * 0.01, 0);
      Models._box(hip, H * 0.19 * w, H * 0.1, H * 0.11 * w, accent, 0, H * 0.06, 0);

      /* --- 躯干 --- */
      var body = Models._part('body', root, 0, H * 0.53, 0);
      parts4.torso = body;
      Models._box(body, H * 0.15 * w, H * 0.08, H * 0.1 * w, armor, 0, -H * 0.015, 0);        // 腰腹
      Models._box(body, H * 0.21 * w, H * 0.19, H * 0.135 * w, armor, 0, H * 0.1, 0);          // 胸腔
      Models._box(body, H * 0.235 * w, H * 0.045, H * 0.145 * w, accent, 0, H * 0.20, 0);      // 肩桥
      Models._box(body, H * 0.09 * w, H * 0.16, H * 0.02, dark, 0, H * 0.1, H * 0.072 * w);    // 胸口面板
      /* 胸口反应堆（自发光核心） */
      var core = Models._part('reactor', body, 0, H * 0.115, H * 0.055 * w);
      Models._cyl(core, H * 0.055, H * 0.055, H * 0.03, glow, 0, 0, 0, 18).rotation.x = Math.PI / 2;
      Models._cyl(core, H * 0.075, H * 0.075, H * 0.012, dark, 0, 0, -H * 0.008, 18).rotation.x = Math.PI / 2;
      /* 背部散热口 + 背包 */
      Models._box(body, H * 0.17 * w, H * 0.15, H * 0.08, dark, 0, H * 0.11, -H * 0.09 * w);
      for (var v = -1; v <= 1; v += 2) {
        Models._box(body, H * 0.03, H * 0.11, H * 0.03, glow, v * H * 0.055 * w, H * 0.13, -H * 0.135 * w);
      }
      /* 腰侧装甲裙板 */
      for (var k = -1; k <= 1; k += 2) {
        Models._box(body, H * 0.05 * w, H * 0.09, H * 0.05, accent, k * H * 0.115 * w, -H * 0.01, 0);
      }

      /* --- 头部 --- */
      var head = Models._part('head', body, 0, H * 0.245, 0);
      if (heavy) {
        var dome = new THREE.Mesh(new THREE.SphereGeometry(H * 0.055, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), armor);
        dome.castShadow = true; head.add(dome);
        Models._box(head, H * 0.1, H * 0.045, H * 0.11, accent, 0, H * 0.01, 0);
        Models._box(head, H * 0.075, H * 0.012, H * 0.01, glow, 0, -H * 0.012, H * 0.05);   // 眼带
        for (var r = -1; r <= 1; r += 2) Models._cyl(head, H * 0.012, H * 0.012, H * 0.06, dark, r * H * 0.045, 0.01, 0, 6).rotation.z = Math.PI / 2;
      } else {
        Models._box(head, H * 0.085, H * 0.07, H * 0.1, armor, 0, 0, 0);
        Models._box(head, H * 0.09, H * 0.012, H * 0.02, glow, 0, H * 0.004, H * 0.05);      // 面罩发光条
        Models._box(head, H * 0.06, H * 0.02, H * 0.03, accent, 0, H * 0.045, H * 0.005);
        Models._box(head, H * 0.03, H * 0.04, H * 0.02, dark, 0, -H * 0.03, H * 0.045);
      }

      /* --- 双臂 + 武器 --- */
      ['L', 'R'].forEach(function (side) {
        var sgn = (side === 'L' ? -1 : 1);
        var shW = heavy ? H * 0.115 : H * 0.085;
        var shoulder = Models._part('shoulder' + side, body, sgn * H * 0.13 * w, H * 0.175, 0);
        Models._box(shoulder, shW, H * 0.055, H * 0.11 * w, accent, sgn * H * 0.01, 0, 0);
        Models._box(shoulder, shW * 0.75, H * 0.09, H * 0.1 * w, armor, sgn * H * 0.015, -H * 0.02, 0);   // 肩甲
        Models._box(shoulder, H * 0.02, H * 0.02, H * 0.02, glow, sgn * H * 0.045, 0.005, 0);           // 肩灯
        var arm = Models._part('arm' + side, shoulder, 0, -H * 0.03, 0);
        Models._cyl(arm, H * 0.035, H * 0.032, H * 0.19, armor, 0, -H * 0.095, 0, 10);   // 上臂
        Models._cyl(arm, H * 0.02, H * 0.02, H * 0.03, dark, 0, -H * 0.19, 0, 8);        // 肘关节
        var fore = Models._part('forearm' + side, arm, 0, -H * 0.185, 0);
        Models._cyl(fore, H * 0.042, H * 0.038, H * 0.17, armor, 0, -H * 0.085, 0, 10);  // 前臂
        Models._box(fore, H * 0.07, H * 0.1, H * 0.07, accent, 0, -H * 0.14, 0);          // 护腕
        Models._box(fore, H * 0.015, H * 0.015, H * 0.05, glow, 0, -H * 0.145, H * 0.04);
        var fist = Models._part('fist' + side, fore, 0, -H * 0.175, 0);
        Models._box(fist, H * 0.07, H * 0.06, H * 0.07, dark, 0, -H * 0.03, 0);
        /* 武器：右臂实体刀刃，左臂机炮（重击型换成链拳/重炮） */
        if (side === 'R' && def.weapon.type === 'blade') {
          var blade = new THREE.Mesh(new THREE.BoxGeometry(H * 0.02, H * 0.34, H * 0.09), Models._mat(0xb9c4cc, { metalness: 1, roughness: 0.25 }));
          blade.position.set(0, -H * 0.18, H * 0.06); blade.castShadow = true;
          fore.add(blade);
          var edge = Models._box(fore, H * 0.012, H * 0.33, H * 0.012, glow, 0, -H * 0.18, H * 0.105);
          edge.material = glow;
        }
        if (side === 'L') {
          var gunBody = Models._box(fore, H * 0.06, H * 0.06, H * 0.1, dark, 0, -H * 0.12, H * 0.05);
          for (var b = -1; b <= 1; b += 2) {
            Models._cyl(fore, H * 0.012, H * 0.012, H * 0.12, Models._mat(0x22282d, { metalness: 1 }), b * H * 0.018, -H * 0.12, H * 0.1, 8).rotation.x = Math.PI / 2;
          }
          Models._box(fore, H * 0.05, H * 0.04, H * 0.04, glowWarm, 0, -H * 0.12, H * 0.13);
        }
      });

      root.userData.height = H;
      return {
        root: root, parts: parts, clips: Models.createClips(root, 'mecha', def),
        height: H, radius: def.radius, hitCenterY: H * 0.55, glowMaterials: glowMaterials
      };
    },

    /* ================================================================== */
    /* 敌方怪兽（开菊兽生物风格）                                           */
    /* ================================================================== */
    buildKaiju: function (def) {
      var H = def.height * (def.scale || 1);
      var fast = def.style === 'fast';
      var bulk = fast ? 0.92 : 1.22;
      var skin = Models._mat(def.skin, { metalness: 0.05, roughness: 0.92, flat: true });
      var belly = Models._mat(def.belly, { metalness: 0.05, roughness: 0.85, flat: true });
      var plate = Models._mat(0x2b3238, { metalness: 0.35, roughness: 0.8, flat: true });
      var glow = Models._glowMat(def.glow, 2.0);
      var glowSoft = Models._glowMat(def.glow, 1.2);
      var glowMaterials = [glow, glowSoft];

      var root = new THREE.Group();
      root.name = def.id;
      var parts = {};

      /* --- 腿（蹲伏式，膝盖后折）--- */
      var thighLen = H * (fast ? 0.30 : 0.34), shinLen = H * (fast ? 0.30 : 0.28);
      ['L', 'R'].forEach(function (side) {
        var sgn = (side === 'L' ? -1 : 1);
        var leg = Models._part('leg' + side, root, sgn * H * 0.11 * bulk, H * 0.44, -H * 0.02);
        leg.rotation.z = sgn * 0.12;
        Models._box(leg, H * 0.12 * bulk, thighLen, H * 0.14, skin, 0, -thighLen * 0.5, 0);
        Models._box(leg, H * 0.13 * bulk, thighLen * 0.4, H * 0.15, belly, 0, -thighLen * 0.35, H * 0.01);
        var shin = Models._part('shin' + side, leg, 0, -thighLen, 0);
        Models._cyl(shin, H * 0.045, H * 0.05, H * 0.05, plate, 0, 0, 0, 8).rotation.z = Math.PI / 2;
        Models._box(shin, H * 0.1 * bulk, shinLen, H * 0.11, skin, 0, -shinLen * 0.5, 0);
        var foot = Models._part('foot' + side, shin, 0, -shinLen, 0);
        Models._box(foot, H * 0.12 * bulk, H * 0.05, H * 0.2, skin, 0, H * 0.025, H * 0.03);
        for (var t = 0; t < 3; t++) {
          Models._box(foot, H * 0.025, H * 0.03, H * 0.05, plate, (t - 1) * H * 0.035, H * 0.02, H * 0.13);
        }
      });

      /* --- 髋 / 躯干 --- */
      var hips = Models._part('hip', root, 0, H * 0.46, -H * 0.03);
      Models._box(hips, H * 0.22 * bulk, H * 0.16, H * 0.2 * bulk, skin, 0, 0, 0);
      var torso = Models._part('torso', root, 0, H * 0.58, -H * 0.02);
      parts.torso = torso;
      var chest = Models._part('chest', torso, 0, H * 0.07, 0);
      Models._box(chest, H * 0.26 * bulk, H * 0.2, H * 0.22 * bulk, skin, 0, 0, 0);
      Models._box(chest, H * 0.2 * bulk, H * 0.18, H * 0.1, belly, 0, -H * 0.02, H * 0.09);   // 胸腹
      /* 背部生物发光甲板 / 脊刺 */
      var spine = Models._part('spine', torso, 0, H * 0.15, -H * 0.09 * bulk);
      for (var i = 0; i < 5; i++) {
        var s = 1 - i * 0.12;
        Models._box(spine, H * 0.055 * s * bulk, H * 0.07 * s, H * 0.06, plate, 0, H * 0.035 * i, -H * 0.01 * i);
        Models._box(spine, H * 0.02, H * 0.05 * s, H * 0.012, glow, 0, H * 0.04 * i, -H * 0.045);   // 发光纹路
      }
      if (!fast) {
        /* 重甲型：大型背甲板 */
        Models._box(torso, H * 0.3 * bulk, H * 0.05, H * 0.2 * bulk, plate, 0, H * 0.19, -H * 0.03);
        Models._box(torso, H * 0.24 * bulk, H * 0.04, H * 0.16 * bulk, plate, 0, H * 0.13, -H * 0.06);
        for (var g = -1; g <= 1; g += 2) Models._box(torso, H * 0.015, H * 0.12, H * 0.06, glowSoft, g * H * 0.11 * bulk, H * 0.05, -H * 0.11 * bulk);
      }

      /* --- 颈 / 头（含可动的上下颚）--- */
      var neck = Models._part('neck', torso, 0, H * 0.16, H * 0.02);
      neck.rotation.x = 0.18;
      Models._cyl(neck, H * 0.05, H * 0.06, H * 0.1, skin, 0, H * 0.03, 0, 8);
      var head = Models._part('head', neck, 0, H * 0.09, H * 0.03);
      var headLen = H * (fast ? 0.2 : 0.16);
      Models._box(head, H * (fast ? 0.11 : 0.15), H * 0.1, headLen, skin, 0, 0, headLen * 0.35);       // 颅骨
      Models._box(head, H * 0.08, H * 0.06, H * 0.06, plate, 0, H * 0.05, headLen * 0.1);             // 头顶甲
      for (var e = -1; e <= 1; e += 2) {
        Models._box(head, H * 0.02, H * 0.02, H * 0.02, glow, e * H * 0.04, H * 0.02, headLen * 0.5);   // 双眼
        if (fast) Models._box(head, H * 0.012, H * 0.09, H * 0.012, glowSoft, e * H * 0.055, H * 0.08, headLen * 0.3).rotation.z = e * 0.35;
      }
      var jawUp = Models._part('jawUpper', head, 0, -H * 0.01, headLen * 0.6);   // 上颚（前伸）
      Models._box(jawUp, H * 0.09, H * 0.045, headLen * 0.45, skin, 0, 0, headLen * 0.2);
      for (var tu = 0; tu < 4; tu++) Models._box(jawUp, H * 0.014, H * 0.03, H * 0.014, Models._mat(0xdfe6ea, { roughness: 0.3 }), (tu - 1.5) * H * 0.022, -H * 0.02, headLen * 0.4);
      var jawLow = Models._part('jawLower', head, 0, -H * 0.045, headLen * 0.55);
      Models._box(jawLow, H * 0.085, H * 0.035, headLen * 0.42, belly, 0, 0, headLen * 0.2);
      for (var tl = 0; tl < 4; tl++) Models._box(jawLow, H * 0.012, H * 0.025, H * 0.012, Models._mat(0xdfe6ea, { roughness: 0.3 }), (tl - 1.5) * H * 0.02, H * 0.015, headLen * 0.38);
      Models._box(jawLow, H * 0.05, H * 0.01, headLen * 0.3, glow, 0, -H * 0.02, headLen * 0.25);    // 口腔发光

      /* --- 前肢（利爪）--- */
      ['L', 'R'].forEach(function (side) {
        var sgn = (side === 'L' ? -1 : 1);
        var shoulder = Models._part('shoulder' + side, chest, sgn * H * 0.14 * bulk, H * 0.03, 0);
        Models._box(shoulder, H * 0.08 * bulk, H * 0.09, H * 0.1 * bulk, skin, sgn * H * 0.01, -H * 0.01, 0);
        var fore = Models._part('fore' + side, shoulder, 0, -H * 0.05, 0);
        var upLen = H * (fast ? 0.24 : 0.19);
        Models._box(fore, H * 0.06 * bulk, upLen, H * 0.07, skin, 0, -upLen * 0.5, 0);
        Models._box(fore, H * 0.02, upLen * 0.5, H * 0.025, glowSoft, sgn * H * 0.03, -upLen * 0.5, 0);
        var claw = Models._part('claw' + side, fore, 0, -upLen, 0);
        var handLen = H * (fast ? 0.2 : 0.15);
        Models._box(claw, H * 0.07 * bulk, handLen * 0.55, H * 0.08, skin, 0, -handLen * 0.3, 0);
        for (var c = 0; c < 3; c++) {
          var cl = Models._box(claw, H * 0.02, handLen * 0.7, H * 0.02, Models._mat(0x1b2024, { metalness: 0.3, roughness: 0.5 }), (c - 1) * H * 0.03, -handLen * 0.9, H * 0.01);
          cl.rotation.x = 0.35;
        }
      });

      /* --- 三段尾巴 --- */
      var tailBase = Models._part('tailBase', hips, 0, H * 0.02, -H * 0.12);
      tailBase.rotation.x = -0.25;
      var tailLen = H * (fast ? 0.3 : 0.2);
      Models._box(tailBase, H * 0.11 * bulk, H * 0.11, tailLen, skin, 0, 0, -tailLen * 0.5);
      var tailMid = Models._part('tailMid', tailBase, 0, 0, -tailLen);
      Models._box(tailMid, H * 0.085, H * 0.085, tailLen, skin, 0, 0, -tailLen * 0.5);
      Models._box(tailMid, H * 0.03, H * 0.02, tailLen * 0.8, glowSoft, 0, -H * 0.05, -tailLen * 0.5);  // 尾下发光
      var tailTip = Models._part('tailTip', tailMid, 0, 0, -tailLen);
      Models._box(tailTip, H * 0.055, H * 0.055, tailLen * 0.7, skin, 0, 0, -tailLen * 0.35);

      root.userData.height = H;
      return {
        root: root, parts: parts, clips: Models.createClips(root, 'kaiju', def),
        height: H, radius: def.radius, hitCenterY: H * 0.55, glowMaterials: glowMaterials
      };
    },

    /* ================================================================== */
    /* 程序化动画（AnimationClip）—— 用命名部件生成，改用骨骼 GLTF 时直接替换 */
    /* ================================================================== */
    createClips: function (root, faction, def) {
      if (!THREE) return [];
      clipRoot = root;
      /* 记录各部件的静止位置，供位置轨道叠加 */
      root.traverse(function (o) {
        if (o.name) o.userData.restPos = { x: o.position.x, y: o.position.y, z: o.position.z };
      });
      var clips = faction === 'kaiju' ? kaijuClips(root, def) : mechaClips(root, def);
      clipRoot = null;
      return clips;
    },

    /* ================================================================== */
    /* 夜晚废墟城市                                                        */
    /* ================================================================== */
    buildCity: function (config, onProgress) {
      var city = {
        group: new THREE.Group(),
        layers: { far: [], mid: [], near: [], side: [] },
        destructibles: [],
        smoke: [], embers: null, searchlights: [], fogPlanes: [],
        _lightningTimer: 4, _flash: 0, _flashLight: null, _flashPlane: null,
        update: cityUpdate, lightning: cityLightning, reset: cityReset
      };
      city.group.name = 'city';
      var tex = cityTextures();
      var progress = onProgress || function () {};

      buildSky(city, tex);
      progress(0.15);
      buildFarLayer(city, tex);
      progress(0.4);
      buildMidLayer(city, tex);
      progress(0.6);
      buildNearLayers(city, tex);
      progress(0.75);
      buildGround(city, tex);
      progress(0.85);
      buildProps(city, tex);
      buildEffects(city, tex);
      progress(1);
      return city;
    },

    createDebrisMesh: function (size, color) {
      var g = new THREE.BoxGeometry(size.x * U.rand(0.5, 1), size.y * U.rand(0.5, 1), size.z * U.rand(0.5, 1));
      var m = new THREE.Mesh(g, Models._mat(color, { metalness: 0.3, roughness: 0.9, flat: true }));
      m.castShadow = true;
      return m;
    },

    dispose: function (obj) {
      if (!obj) return;
      obj.traverse(function (o) {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach(function (m) { m.dispose(); });
          else o.material.dispose();
        }
      });
    }
  };

  /* ==================================================================== */
  /* 动画片段定义                                                          */
  /* ==================================================================== */
  var TWO_PI = Math.PI * 2;
  var SAMPLES = 20;
  var clipRoot = null;        // 当前正在生成动画的模型根节点（用于读取部件静止位置）

  /* 由“关节 → 随时间变化的欧拉角函数”生成 AnimationClip
     注意：位置轨道写入的是绝对坐标，因此 spec.p 提供的是相对静止位置的偏移量，
     这里会自动叠加该部件的静止位置（rest position），避免把部件拽到原点。 */
  function buildClip(name, duration, loop, joints) {
    var times = [], i;
    for (i = 0; i <= SAMPLES; i++) times.push(duration * i / SAMPLES);
    var tracks = [];
    for (var partName in joints) {
      if (!joints.hasOwnProperty(partName)) continue;
      var spec = joints[partName];
      if (spec.q) {
        var qs = [];
        for (i = 0; i <= SAMPLES; i++) {
          var u = i / SAMPLES;
          var rot = spec.q(u) || [0, 0, 0];
          var e = new THREE.Euler(rot[0] || 0, rot[1] || 0, rot[2] || 0, 'XYZ');
          var quat = new THREE.Quaternion().setFromEuler(e).toArray();
          qs.push(quat[0], quat[1], quat[2], quat[3]);
        }
        tracks.push(new THREE.QuaternionKeyframeTrack(partName + '.quaternion', times.slice(), qs));
      }
      if (spec.p) {
        var target = clipRoot ? clipRoot.getObjectByName(partName) : null;
        var base = target ? target.userData.restPos : { x: 0, y: 0, z: 0 };
        var ps = [];
        for (i = 0; i <= SAMPLES; i++) {
          var u2 = i / SAMPLES;
          var d = spec.p(u2) || [0, 0, 0];
          ps.push(base.x + (d[0] || 0), base.y + (d[1] || 0), base.z + (d[2] || 0));
        }
        tracks.push(new THREE.VectorKeyframeTrack(partName + '.position', times.slice(), ps));
      }
    }
    var clip = new THREE.AnimationClip(name, duration, tracks);
    clip.userData = { loop: loop ? 'repeat' : 'once', speed: 1 };
    return clip;
  }

  function mechaClips(root, def) {
    var stance = def.style === 'heavy' ? 1.15 : 1.0;
    var blendArmsBlade = def.weapon.type === 'blade';
    var clips = [];
    var s = Math.sin, c = Math.cos, PI = Math.PI;

    /* 待机 */
    clips.push(buildClip('idle', 2.6, true, {
      hip: { q: function (u) { return [0, 0, s(u * TWO_PI) * 0.02]; } },
      body: { q: function (u) { return [s(u * TWO_PI) * 0.012, s(u * TWO_PI) * 0.02, s(u * TWO_PI) * 0.018]; }, p: function (u) { return [0, s(u * TWO_PI) * 0.1, 0]; } },
      head: { q: function (u) { return [s(u * TWO_PI + 0.8) * 0.05, s(u * TWO_PI * 0.5) * 0.08, 0]; } },
      shoulderL: { q: function (u) { return [s(u * TWO_PI) * 0.02, 0, s(u * TWO_PI) * 0.03]; } },
      shoulderR: { q: function (u) { return [s(u * TWO_PI + 0.4) * 0.02, 0, -s(u * TWO_PI) * 0.03]; } },
      armL: { q: function (u) { return [s(u * TWO_PI) * 0.03, 0, 0.05]; } },
      armR: { q: function (u) { return [s(u * TWO_PI + 0.5) * 0.03, 0, -0.05]; } },
      legL: { q: function (u) { return [0, 0, 0.02 + s(u * TWO_PI) * 0.01]; } },
      legR: { q: function (u) { return [0, 0, -0.02 - s(u * TWO_PI) * 0.01]; } }
    }));

    /* 行走：沉重交替步幅 + 髋部起伏 */
    clips.push(buildClip('walk', 1.35, true, {
      hip: { q: function (u) { return [0, s(u * TWO_PI) * 0.12, c(u * TWO_PI) * 0.04]; }, p: function (u) { return [0, Math.abs(s(u * TWO_PI)) * 0.18, 0]; } },
      body: { q: function (u) { return [0.06 * stance, -s(u * TWO_PI) * 0.07, s(u * TWO_PI) * 0.05]; }, p: function (u) { return [0, -Math.abs(s(u * TWO_PI)) * 0.22, 0]; } },
      head: { q: function (u) { return [0.05, s(u * TWO_PI + 1) * 0.06, 0]; } },
      legL: { q: function (u) { return [s(u * TWO_PI) * 0.42, 0, 0]; } },
      shinL: { q: function (u) { return [Math.max(0, -s(u * TWO_PI)) * 0.7, 0, 0]; } },
      legR: { q: function (u) { return [-s(u * TWO_PI) * 0.42, 0, 0]; } },
      shinR: { q: function (u) { return [Math.max(0, s(u * TWO_PI)) * 0.7, 0, 0]; } },
      armL: { q: function (u) { return [-s(u * TWO_PI) * 0.22, 0, 0.06]; } },
      forearmL: { q: function (u) { return [-0.25 - Math.max(0, -s(u * TWO_PI)) * 0.2, 0, 0]; } },
      armR: { q: function (u) { return [s(u * TWO_PI) * 0.22, 0, -0.06]; } },
      forearmR: { q: function (u) { return [-0.25 - Math.max(0, s(u * TWO_PI)) * 0.2, 0, 0]; } }
    }));

    /* 奔跑 */
    clips.push(buildClip('run', 0.82, true, {
      hip: { q: function (u) { return [0.06, s(u * TWO_PI) * 0.2, c(u * TWO_PI) * 0.08]; }, p: function (u) { return [0, Math.abs(s(u * TWO_PI)) * 0.3, 0]; } },
      body: { q: function (u) { return [0.16 * stance, -s(u * TWO_PI) * 0.12, s(u * TWO_PI) * 0.08]; }, p: function (u) { return [0, -Math.abs(s(u * TWO_PI)) * 0.35, 0]; } },
      head: { q: function (u) { return [-0.08, s(u * TWO_PI + 1) * 0.08, 0]; } },
      legL: { q: function (u) { return [s(u * TWO_PI) * 0.72, 0, 0]; } },
      shinL: { q: function (u) { return [Math.max(0.1, -s(u * TWO_PI)) * 1.0, 0, 0]; } },
      legR: { q: function (u) { return [-s(u * TWO_PI) * 0.72, 0, 0]; } },
      shinR: { q: function (u) { return [Math.max(0.1, s(u * TWO_PI)) * 1.0, 0, 0]; } },
      armL: { q: function (u) { return [-s(u * TWO_PI) * 0.5 - 0.25, 0, 0.1]; } },
      forearmL: { q: function (u) { return [-0.7, 0, 0]; } },
      armR: { q: function (u) { return [s(u * TWO_PI) * 0.5 - 0.25, 0, -0.1]; } },
      forearmR: { q: function (u) { return [-0.7, 0, 0]; } }
    }));

    /* 轻攻击：快速直拳（0.48s 对齐 moves.light 三段时长） */
    clips.push(buildClip('light', 0.48, false, {
      body: { q: function (u) { return [0, -0.3 * s(PI * u), 0]; } },
      hip: { q: function (u) { return [0, 0.12 * s(PI * u), 0]; } },
      armR: { q: function (u) { return [-1.35 * s(PI * Math.min(1, u / 0.62)), 0.1 * s(PI * u), -0.12]; } },
      forearmR: { q: function (u) { return [-0.9 + 0.85 * s(PI * Math.min(1, u / 0.62)), 0, 0]; } },
      armL: { q: function (u) { return [0.3 * s(PI * Math.min(1, u / 0.62)), 0, 0.15]; } },
      legR: { q: function (u) { return [0.12 * s(PI * u), 0, 0]; } }
    }));

    /* 重攻击：大幅抬臂下砸（1.10s，起手明显便于对手反应） */
    clips.push(buildClip('heavy', 1.10, false, {
      hip: { q: function (u) { return [0, -0.2 * s(PI * u) - 0.15 * s(PI * Math.min(1, u / 0.38)), 0]; }, p: function (u) { return [0, u < 0.38 ? u * 0.6 : (1 - (u - 0.38) / 0.62) * 0.38, 0]; } },
      body: { q: function (u) { return [u < 0.38 ? -0.42 * (u / 0.38) : 0.5 * ((u - 0.38) / 0.62), -0.35 * s(PI * u), 0]; } },
      armR: { q: function (u) { return [u < 0.38 ? -2.3 * (u / 0.38) : -2.3 + 3.1 * Math.min(1, (u - 0.38) / 0.25), 0, -0.25]; } },
      forearmR: { q: function (u) { return [u < 0.38 ? -1.3 * (u / 0.38) : -0.6 * (1 - Math.min(1, (u - 0.38) / 0.25)) - 0.4, 0, 0]; } },
      armL: { q: function (u) { return [0.5 * s(PI * u), 0, 0.3]; } },
      head: { q: function (u) { return [u < 0.38 ? -0.25 * (u / 0.38) : 0.3 * ((u - 0.38) / 0.62), 0, 0]; } },
      legL: { q: function (u) { return [-0.15 * s(PI * u), 0, 0]; } },
      legR: { q: function (u) { return [0.2 * s(PI * u), 0, 0]; } }
    }));

    /* 武器技能：刀刃突刺 / 机炮齐射（0.86s） */
    if (blendArmsBlade) {
      clips.push(buildClip('skill', 0.86, false, {
        body: { q: function (u) { return [0.1, -0.45 * s(PI * Math.min(1, u / 0.4)), 0]; } },
        armR: { q: function (u) { return [-0.5 - 1.0 * Math.min(1, u / 0.4) + 0.6 * Math.max(0, (u - 0.5) / 0.5), 0, -0.2]; } },
        forearmR: { q: function (u) { return [-1.4 + 1.2 * Math.min(1, u / 0.4), 0, 0]; } },
        armL: { q: function (u) { return [0.25, 0, 0.35]; } },
        head: { q: function (u) { return [0.1, 0.2 * s(PI * u), 0]; } }
      }));
    } else {
      clips.push(buildClip('skill', 0.86, false, {
        body: { q: function (u) { return [-0.2 * s(PI * u) - 0.05, 0.2 * s(PI * u), 0]; } },
        armL: { q: function (u) { return [-1.45 - 0.1 * s(u * 24), 0.1, 0.05]; }, p: function (u) { return [0, 0, -0.06 * Math.max(0, (u - 0.4) / 0.6)]; } },
        forearmL: { q: function (u) { return [-0.2, 0, 0]; } },
        armR: { q: function (u) { return [-0.9, 0, -0.15]; } },
        hip: { q: function (u) { return [0, 0.25 * s(PI * u), 0]; } }
      }));
    }

    /* 闪避：侧向收身（0.46s，与 moves 时长一致） */
    clips.push(buildClip('dodge', 0.46, false, {
      hip: { q: function (u) { return [0, 0.35 * s(PI * u), 0]; }, p: function (u) { return [0, s(PI * u) * 0.25, 0]; } },
      body: { q: function (u) { return [0.35 * s(PI * u), 0.5 * s(PI * u), 0.45 * s(PI * u)]; }, p: function (u) { return [0, -0.5 * s(PI * u), 0]; } },
      legL: { q: function (u) { return [0.7 * s(PI * u), 0, 0.25 * s(PI * u)]; } },
      legR: { q: function (u) { return [0.35 * s(PI * u), 0, -0.2 * s(PI * u)]; } },
      shinL: { q: function (u) { return [0.9 * s(PI * u), 0, 0]; } },
      shinR: { q: function (u) { return [0.6 * s(PI * u), 0, 0]; } },
      armL: { q: function (u) { return [-0.5 * s(PI * u), 0, 0.4 * s(PI * u)]; } },
      armR: { q: function (u) { return [-0.5 * s(PI * u), 0, -0.4 * s(PI * u)]; } }
    }));

    /* 格挡：双臂护住正面 + 下蹲（循环，微呼吸） */
    clips.push(buildClip('block', 1.0, true, {
      body: { q: function (u) { return [0.3, 0, 0]; }, p: function (u) { return [0, -0.35 + s(u * TWO_PI) * 0.02, 0]; } },
      hip: { q: function (u) { return [0.12, 0, 0]; } },
      armL: { q: function (u) { return [-1.15, 0, 0.5]; } },
      forearmL: { q: function (u) { return [-1.1, 0, 0.2]; } },
      armR: { q: function (u) { return [-1.15, 0, -0.5]; } },
      forearmR: { q: function (u) { return [-1.1, 0, -0.2]; } },
      legL: { q: function (u) { return [0.35, 0, 0.12]; } },
      shinL: { q: function (u) { return [0.5, 0, 0]; } },
      legR: { q: function (u) { return [0.35, 0, -0.12]; } },
      shinR: { q: function (u) { return [0.5, 0, 0]; } },
      head: { q: function (u) { return [0.15, 0, 0]; } }
    }));

    /* 受击：躯干后仰 + 手臂外张（0.5s） */
    clips.push(buildClip('hit', 0.5, false, {
      body: { q: function (u) { return [-0.45 * s(PI * u), 0.25 * s(PI * u), 0.12 * s(PI * u)]; }, p: function (u) { return [0, 0, -0.3 * s(PI * u)]; } },
      head: { q: function (u) { return [-0.4 * s(PI * u), 0, 0]; } },
      armL: { q: function (u) { return [0.6 * s(PI * u), 0, 0.5 * s(PI * u)]; } },
      armR: { q: function (u) { return [0.6 * s(PI * u), 0, -0.5 * s(PI * u)]; } },
      legL: { q: function (u) { return [-0.2 * s(PI * u), 0, 0]; } },
      hip: { p: function (u) { return [0, 0, -0.2 * s(PI * u)]; } }
    }));

    /* 死亡：跪地 → 前扑（1.9s，一次性，结尾定格） */
    clips.push(buildClip('death', 1.9, false, {
      hip: { p: function (u) { return [0, -Math.min(1, u / 0.55) * 1.1, 0]; }, q: function (u) { return [Math.min(1, u / 0.55) * 0.5, 0, 0]; } },
      body: { q: function (u) { return [Math.min(1, u / 0.6) * 0.4 + Math.max(0, (u - 0.6) / 0.4) * 1.0, 0.15, 0.2 * Math.min(1, (u - 0.6) / 0.4)]; }, p: function (u) { return [0, -Math.min(1, u / 0.6) * 0.6, Math.max(0, (u - 0.6) / 0.4) * 0.4]; } },
      head: { q: function (u) { return [Math.min(1, u / 0.7) * 0.6, 0, 0.4 * Math.min(1, (u - 0.5) / 0.5)]; } },
      armL: { q: function (u) { return [0.4 * Math.min(1, u / 0.5), 0, 0.6 * Math.min(1, u / 0.5)]; } },
      armR: { q: function (u) { return [0.4 * Math.min(1, u / 0.5), 0, -0.6 * Math.min(1, u / 0.5)]; } },
      legL: { q: function (u) { return [1.5 * Math.min(1, u / 0.55), 0, 0.2]; } },
      shinL: { q: function (u) { return [1.6 * Math.min(1, u / 0.55), 0, 0]; } },
      legR: { q: function (u) { return [1.5 * Math.min(1, u / 0.55), 0, -0.2]; } },
      shinR: { q: function (u) { return [1.6 * Math.min(1, u / 0.55), 0, 0]; } }
    }));

    /* 必杀技演出：蓄力 → 停顿 → 双刃风暴（2.3s，与 moves.ultimate 一致） */
    clips.push(buildClip('ultimate', 2.3, false, {
      hip: { q: function (u) { return [0, u < 0.5 ? 0.4 * (u / 0.5) : 0.4 - 0.9 * Math.min(1, (u - 0.5) / 0.25), 0]; }, p: function (u) { return [0, u < 0.5 ? -(u / 0.5) * 0.35 : -0.35 + Math.min(1, (u - 0.5) / 0.3) * 0.2, 0]; } },
      body: { q: function (u) { return [u < 0.5 ? -0.35 * (u / 0.5) : u < 0.72 ? 0.2 : 0.4 - 0.3 * s(PI * ((u - 0.72) / 0.28)), u < 0.5 ? 0 : (u < 0.72 ? 0 : -TWO_PI * ((u - 0.72) / 0.28)), 0]; } },
      armL: { q: function (u) { return [u < 0.5 ? -2.0 * (u / 0.5) : -2.0 + 1.4 * Math.min(1, (u - 0.5) / 0.22), 0, 0.4 - Math.min(1, (u - 0.72) / 0.28) * 1.6]; } },
      forearmL: { q: function (u) { return [-1.5 * Math.min(1, u / 0.5), 0, 0]; } },
      armR: { q: function (u) { return [u < 0.5 ? -2.0 * (u / 0.5) : -2.0 + 1.4 * Math.min(1, (u - 0.5) / 0.22), 0, -0.4 + Math.min(1, (u - 0.72) / 0.28) * 1.6]; } },
      forearmR: { q: function (u) { return [-1.5 * Math.min(1, u / 0.5), 0, 0]; } },
      head: { q: function (u) { return [u < 0.5 ? -0.3 * (u / 0.5) : 0.35, 0, 0]; } },
      legL: { q: function (u) { return [0.5 * s(PI * Math.min(1, u / 0.5)), 0, 0.15]; } },
      legR: { q: function (u) { return [0.5 * s(PI * Math.min(1, u / 0.5)), 0, -0.15]; } }
    }));

    return clips;
  }

  function kaijuClips(root, def) {
    var fast = def.style === 'fast';
    var clips = [];
    var s = Math.sin, PI = Math.PI;

    clips.push(buildClip('idle', 2.8, true, {
      hip: { q: function (u) { return [0, s(u * TWO_PI) * 0.05, s(u * TWO_PI) * 0.04]; }, p: function (u) { return [0, s(u * TWO_PI) * 0.08, 0]; } },
      torso: { q: function (u) { return [0.1 + s(u * TWO_PI) * 0.03, s(u * TWO_PI * 0.5) * 0.06, s(u * TWO_PI) * 0.03]; } },
      neck: { q: function (u) { return [s(u * TWO_PI + 1) * 0.06, 0, 0]; } },
      head: { q: function (u) { return [s(u * TWO_PI + 0.5) * 0.08, s(u * TWO_PI * 0.5) * 0.1, 0]; } },
      jawLower: { q: function (u) { return [Math.max(0, s(u * TWO_PI)) * 0.16, 0, 0]; } },
      tailBase: { q: function (u) { return [0, s(u * TWO_PI) * 0.16, 0]; } },
      tailMid: { q: function (u) { return [0, s(u * TWO_PI - 0.7) * 0.2, 0]; } },
      tailTip: { q: function (u) { return [0, s(u * TWO_PI - 1.4) * 0.26, 0]; } },
      foreL: { q: function (u) { return [0.15 + s(u * TWO_PI) * 0.04, 0, 0.12]; } },
      foreR: { q: function (u) { return [0.15 + s(u * TWO_PI + 0.6) * 0.04, 0, -0.12]; } }
    }));

    clips.push(buildClip('walk', 1.5, true, {
      hip: { q: function (u) { return [0, s(u * TWO_PI) * 0.14, Math.sin(u * TWO_PI) * 0.07]; }, p: function (u) { return [0, Math.abs(s(u * TWO_PI)) * 0.22, 0]; } },
      torso: { q: function (u) { return [0.16, -s(u * TWO_PI) * 0.1, s(u * TWO_PI) * 0.05]; } },
      head: { q: function (u) { return [-0.06, s(u * TWO_PI + 1) * 0.08, 0]; } },
      legL: { q: function (u) { return [s(u * TWO_PI) * 0.5, 0, 0]; } },
      shinL: { q: function (u) { return [Math.max(0, -s(u * TWO_PI)) * 0.8, 0, 0]; } },
      legR: { q: function (u) { return [-s(u * TWO_PI) * 0.5, 0, 0]; } },
      shinR: { q: function (u) { return [Math.max(0, s(u * TWO_PI)) * 0.8, 0, 0]; } },
      foreL: { q: function (u) { return [-0.3 + s(u * TWO_PI) * 0.25, 0, 0.15]; } },
      foreR: { q: function (u) { return [-0.3 - s(u * TWO_PI) * 0.25, 0, -0.15]; } },
      tailBase: { q: function (u) { return [0, -s(u * TWO_PI) * 0.25, 0]; } },
      tailMid: { q: function (u) { return [0, -s(u * TWO_PI - 0.6) * 0.3, 0]; } },
      tailTip: { q: function (u) { return [0, -s(u * TWO_PI - 1.2) * 0.36, 0]; } }
    }));

    clips.push(buildClip('run', 0.95, true, {
      hip: { q: function (u) { return [0.05, s(u * TWO_PI) * 0.22, s(u * TWO_PI) * 0.1]; }, p: function (u) { return [0, Math.abs(s(u * TWO_PI)) * 0.34, 0]; } },
      torso: { q: function (u) { return [0.3, -s(u * TWO_PI) * 0.16, s(u * TWO_PI) * 0.08]; } },
      head: { q: function (u) { return [-0.18, s(u * TWO_PI + 1) * 0.1, 0]; } },
      legL: { q: function (u) { return [s(u * TWO_PI) * 0.8, 0, 0]; } },
      shinL: { q: function (u) { return [Math.max(0.1, -s(u * TWO_PI)) * 1.05, 0, 0]; } },
      legR: { q: function (u) { return [-s(u * TWO_PI) * 0.8, 0, 0]; } },
      shinR: { q: function (u) { return [Math.max(0.1, s(u * TWO_PI)) * 1.05, 0, 0]; } },
      foreL: { q: function (u) { return [-0.7 + s(u * TWO_PI) * 0.5, 0, 0.25]; } },
      foreR: { q: function (u) { return [-0.7 - s(u * TWO_PI) * 0.5, 0, -0.25]; } },
      tailBase: { q: function (u) { return [0.15, -s(u * TWO_PI) * 0.35, 0]; } },
      tailMid: { q: function (u) { return [0, -s(u * TWO_PI - 0.6) * 0.4, 0]; } },
      tailTip: { q: function (u) { return [0, -s(u * TWO_PI - 1.2) * 0.45, 0]; } }
    }));

    /* 撕咬连击（0.56s，对齐 moves.bite） */
    clips.push(buildClip('bite', 0.56, false, {
      neck: { q: function (u) { return [u < 0.32 ? 0.45 * (u / 0.32) : 0.45 - 0.85 * Math.min(1, (u - 0.32) / 0.25), 0, 0]; } },
      head: { q: function (u) { return [u < 0.32 ? 0.3 * (u / 0.32) : 0.3 - 0.55 * Math.min(1, (u - 0.32) / 0.25), 0, 0]; } },
      jawLower: { q: function (u) { return [u < 0.32 ? 0.95 * (u / 0.32) : 0.95 * (1 - Math.min(1, (u - 0.32) / 0.12)), 0, 0]; } },
      jawUpper: { q: function (u) { return [u < 0.32 ? -0.25 * (u / 0.32) : -0.25 * (1 - Math.min(1, (u - 0.32) / 0.12)), 0, 0]; } },
      torso: { q: function (u) { return [0.1 + 0.35 * s(PI * u), 0, 0]; } },
      hip: { q: function (u) { return [0, 0.15 * s(PI * u), 0]; } }
    }));

    /* 尾击：180° 横扫（1.06s，对齐 moves.tail） */
    clips.push(buildClip('tail', 1.06, false, {
      hip: { q: function (u) { return [0, u < 0.4 ? 0.3 * (u / 0.4) : 0.3 - 1.3 * Math.min(1, (u - 0.4) / 0.3), 0]; } },
      torso: { q: function (u) { return [0.1, u < 0.4 ? -0.5 * (u / 0.4) : -0.5 + 1.1 * Math.min(1, (u - 0.4) / 0.3), 0]; } },
      tailBase: { q: function (u) { return [0.1, u < 0.4 ? -0.6 * (u / 0.4) : -0.6 + 2.0 * Math.min(1, (u - 0.4) / 0.25), 0]; } },
      tailMid: { q: function (u) { return [0, u < 0.4 ? -0.5 * (u / 0.4) : -0.5 + 1.8 * Math.min(1, (u - 0.44) / 0.26), 0]; } },
      tailTip: { q: function (u) { return [0, u < 0.4 ? -0.4 * (u / 0.4) : -0.4 + 1.6 * Math.min(1, (u - 0.48) / 0.27), 0]; } },
      head: { q: function (u) { return [0, 0.4 * s(PI * u), 0]; } },
      foreL: { q: function (u) { return [-0.5, 0, 0.5 * s(PI * u)]; } },
      foreR: { q: function (u) { return [-0.5, 0, -0.5 * s(PI * u)]; } }
    }));

    /* 冲撞：低头长距离突进（1.64s，对齐 moves.charge） */
    clips.push(buildClip('charge', 1.64, false, {
      hip: { p: function (u) { return [0, u < 0.32 ? -(u / 0.32) * 0.3 : -0.3 + Math.min(1, (u - 0.32) / 0.68) * 0.25, 0]; }, q: function (u) { return [u < 0.32 ? 0.2 * (u / 0.32) : 0.2, 0, 0]; } },
      torso: { q: function (u) { return [u < 0.32 ? 0.25 * (u / 0.32) : 0.25 + 0.45 * Math.min(1, (u - 0.32) / 0.2) - 0.4 * Math.max(0, (u - 0.78) / 0.22), 0, 0]; } },
      neck: { q: function (u) { return [0.35, 0, 0]; } },
      head: { q: function (u) { return [0.4, 0, 0]; } },
      jawLower: { q: function (u) { return [0.5, 0, 0]; } },
      foreL: { q: function (u) { return [0.9, 0, 0.35]; } },
      foreR: { q: function (u) { return [0.9, 0, -0.35]; } },
      legL: { q: function (u) { return [s(u * PI * 4) * 0.55, 0, 0]; } },
      shinL: { q: function (u) { return [Math.max(0, -s(u * PI * 4)) * 0.9, 0, 0]; } },
      legR: { q: function (u) { return [-s(u * PI * 4) * 0.55, 0, 0]; } },
      shinR: { q: function (u) { return [Math.max(0, s(u * PI * 4)) * 0.9, 0, 0]; } },
      tailBase: { q: function (u) { return [0.4, -0.3, 0]; } }
    }));

    /* 受击 */
    clips.push(buildClip('hit', 0.5, false, {
      hip: { p: function (u) { return [0, 0, -0.35 * s(PI * u)]; } },
      torso: { q: function (u) { return [-0.3 * s(PI * u), 0.2 * s(PI * u), 0.1 * s(PI * u)]; } },
      neck: { q: function (u) { return [-0.3 * s(PI * u), 0, 0]; } },
      head: { q: function (u) { return [-0.45 * s(PI * u), 0, 0.15 * s(PI * u)]; } },
      tailBase: { q: function (u) { return [-0.3 * s(PI * u), 0.3 * s(PI * u), 0]; } },
      foreL: { q: function (u) { return [0.5 * s(PI * u), 0, 0.5 * s(PI * u)]; } },
      foreR: { q: function (u) { return [0.5 * s(PI * u), 0, -0.5 * s(PI * u)]; } }
    }));

    /* 咆哮（1.6s）：昂头张颚 + 全身抖动 */
    clips.push(buildClip('roar', 1.6, false, {
      torso: { q: function (u) { return [-0.25 + s(u * PI * 8) * 0.02, 0, 0]; } },
      neck: { q: function (u) { return [-0.5 * Math.min(1, u / 0.2), 0, 0]; } },
      head: { q: function (u) { return [-0.45 * Math.min(1, u / 0.2), s(u * PI * 6) * 0.03, 0]; } },
      jawLower: { q: function (u) { return [1.15 * Math.min(1, u / 0.18) * (u < 0.8 ? 1 : 0.3), 0, 0]; } },
      jawUpper: { q: function (u) { return [-0.35, 0, 0]; } },
      hip: { p: function (u) { return [0, s(u * PI * 8) * 0.08, 0]; }, q: function (u) { return [0.1, 0, 0]; } },
      legL: { q: function (u) { return [0.2, 0, 0]; } },
      legR: { q: function (u) { return [0.2, 0, 0]; } },
      tailBase: { q: function (u) { return [-0.2, s(u * PI * 3) * 0.3, 0]; } },
      tailMid: { q: function (u) { return [0, -s(u * PI * 3 - 0.5) * 0.35, 0]; } },
      foreL: { q: function (u) { return [-0.4, 0, 0.3]; } },
      foreR: { q: function (u) { return [-0.4, 0, -0.3]; } }
    }));

    /* 死亡：侧倒（2.2s） */
    clips.push(buildClip('death', 2.2, false, {
      hip: { p: function (u) { return [0, -Math.min(1, u / 0.6) * 1.6, 0]; }, q: function (u) { return [0, 0, Math.min(1, u / 0.6) * 0.9]; } },
      torso: { q: function (u) { return [Math.min(1, u / 0.5) * 0.5, 0, Math.min(1, (u - 0.3) / 0.7) * 0.9]; } },
      neck: { q: function (u) { return [Math.min(1, u / 0.5) * 0.5, 0, 0]; } },
      head: { q: function (u) { return [Math.min(1, u / 0.5) * 0.6, 0, Math.min(1, (u - 0.4) / 0.6) * 0.6]; } },
      jawLower: { q: function (u) { return [0.5, 0, 0]; } },
      legL: { q: function (u) { return [1.4 * Math.min(1, u / 0.5), 0, 0.4]; } },
      shinL: { q: function (u) { return [1.5 * Math.min(1, u / 0.5), 0, 0]; } },
      legR: { q: function (u) { return [1.2 * Math.min(1, u / 0.5), 0, -0.4]; } },
      shinR: { q: function (u) { return [1.4 * Math.min(1, u / 0.5), 0, 0]; } },
      foreL: { q: function (u) { return [0.8 * Math.min(1, u / 0.5), 0, 0.6]; } },
      foreR: { q: function (u) { return [0.8 * Math.min(1, u / 0.5), 0, -0.6]; } },
      tailBase: { q: function (u) { return [0, s(PI * u) * 0.6, 0]; } },
      tailMid: { q: function (u) { return [0, s(PI * u - 0.4) * 0.7, 0]; } },
      tailTip: { q: function (u) { return [0, s(PI * u - 0.8) * 0.8, 0]; } }
    }));

    return clips;
  }

  /* ==================================================================== */
  /* 城市：运行时贴图生成                                                 */
  /* ==================================================================== */
  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function canvasTexture(canvas, repeat) {
    var t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
    t.anisotropy = 4;
    return t;
  }
  function hex(col) { return '#' + new THREE.Color(col).getHexString(); }

  function cityTextures() {
    var tex = {};
    /* 远景楼宇窗光贴图 */
    var c = makeCanvas(128, 256), g = c.getContext('2d');
    g.fillStyle = hex(PAL.buildingA); g.fillRect(0, 0, 128, 256);
    for (var y = 0; y < 256; y += 8) {
      for (var x = 0; x < 128; x += 8) {
        var r = Math.random();
        if (r < 0.42) {
          g.fillStyle = r < 0.30 ? hex(PAL.windowWarm) : hex(PAL.windowCold);
          g.globalAlpha = U.rand(0.35, 1);
          g.fillRect(x + 2, y + 2, 4, 4);
          g.globalAlpha = 1;
        } else if (r < 0.5) {
          g.fillStyle = '#0d1114'; g.fillRect(x + 2, y + 2, 4, 4);
        }
      }
    }
    tex.window = canvasTexture(c);

    /* 中景破损楼宇贴图：暗色 + 破损层 */
    var c2 = makeCanvas(128, 128), g2 = c2.getContext('2d');
    g2.fillStyle = hex(PAL.concrete); g2.fillRect(0, 0, 128, 128);
    for (var i = 0; i < 70; i++) {
      g2.fillStyle = 'rgba(0,0,0,' + U.rand(0.15, 0.5).toFixed(2) + ')';
      g2.fillRect(Math.random() * 128, Math.random() * 128, U.rand(3, 16), U.rand(2, 6));
    }
    for (var j = 0; j < 26; j++) {
      g2.fillStyle = 'rgba(255,200,120,' + U.rand(0.05, 0.25).toFixed(2) + ')';
      g2.fillRect(Math.random() * 128, Math.random() * 128, U.rand(4, 14), U.rand(3, 10));
    }
    tex.ruin = canvasTexture(c2);

    /* 地面：碎石柏油 + 裂纹 + 褪色标线 + 积水 */
    var g3c = makeCanvas(512, 512), g3 = g3c.getContext('2d');
    g3.fillStyle = hex(PAL.groundDiffuse); g3.fillRect(0, 0, 512, 512);
    for (var k = 0; k < 2600; k++) {
      g3.fillStyle = 'rgba(' + U.randInt(20, 70) + ',' + U.randInt(20, 70) + ',' + U.randInt(20, 72) + ',' + U.rand(0.1, 0.5).toFixed(2) + ')';
      g3.fillRect(Math.random() * 512, Math.random() * 512, U.rand(1, 6), U.rand(1, 6));
    }
    g3.strokeStyle = 'rgba(0,0,0,0.55)'; g3.lineWidth = 2;
    for (var cr = 0; cr < 34; cr++) {
      g3.beginPath();
      var px = Math.random() * 512, py = Math.random() * 512;
      g3.moveTo(px, py);
      for (var seg = 0; seg < 6; seg++) { px += U.rand(-40, 40); py += U.rand(-40, 40); g3.lineTo(px, py); }
      g3.stroke();
    }
    g3.strokeStyle = 'rgba(160,160,160,0.18)'; g3.lineWidth = 6; g3.setLineDash([28, 30]);
    g3.beginPath(); g3.moveTo(0, 256); g3.lineTo(512, 256); g3.stroke(); g3.setLineDash([]);
    for (var p = 0; p < 12; p++) {
      g3.fillStyle = 'rgba(120,160,180,' + U.rand(0.04, 0.14).toFixed(2) + ')';
      g3.beginPath();
      g3.ellipse(Math.random() * 512, Math.random() * 512, U.rand(12, 46), U.rand(8, 30), Math.random() * 3, 0, Math.PI * 2);
      g3.fill();
    }
    tex.ground = canvasTexture(g3c, [8, 3]);

    /* 烟尘 / 雾气精灵 */
    function softSprite(color, size) {
      var sc = makeCanvas(size, size), sg = sc.getContext('2d');
      var grad = sg.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0, color); grad.addColorStop(1, 'rgba(0,0,0,0)');
      sg.fillStyle = grad; sg.fillRect(0, 0, size, size);
      return canvasTexture(sc);
    }
    tex.smoke = softSprite('rgba(60,70,72,0.55)', 128);
    tex.ember = softSprite('rgba(255,150,60,1)', 64);
    tex.fog = softSprite('rgba(13,30,36,0.85)', 256);

    /* 天空渐变 */
    var sk = makeCanvas(16, 256), skg = sk.getContext('2d');
    var lg = skg.createLinearGradient(0, 0, 0, 256);
    lg.addColorStop(0, hex(PAL.skyTop));
    lg.addColorStop(0.55, hex(PAL.cloud));
    lg.addColorStop(1, hex(PAL.skyBottom));
    skg.fillStyle = lg; skg.fillRect(0, 0, 16, 256);
    tex.sky = canvasTexture(sk);

    /* 云层 */
    var cl = makeCanvas(256, 256), clg = cl.getContext('2d');
    clg.clearRect(0, 0, 256, 256);
    for (var q = 0; q < 60; q++) {
      var rg = clg.createRadialGradient(Math.random() * 256, Math.random() * 256, 0, Math.random() * 256, Math.random() * 256, U.rand(20, 70));
      rg.addColorStop(0, 'rgba(30,50,58,0.5)'); rg.addColorStop(1, 'rgba(30,50,58,0)');
      clg.fillStyle = rg; clg.fillRect(0, 0, 256, 256);
    }
    tex.cloud = canvasTexture(cl);
    return tex;
  }

  /* --- 天空 + 云 --- */
  function buildSky(city, tex) {
    var dome = new THREE.Mesh(
      new THREE.SphereGeometry(700, 32, 16),
      new THREE.MeshBasicMaterial({ map: tex.sky, side: THREE.BackSide, fog: false })
    );
    dome.name = 'skyDome';
    city.group.add(dome);
    city.skyDome = dome;
    city.clouds = [];
    for (var i = 0; i < 4; i++) {
      var m = new THREE.Mesh(
        new THREE.PlaneGeometry(900, 320),
        new THREE.MeshBasicMaterial({ map: tex.cloud, transparent: true, opacity: 0.35 - i * 0.06, depthWrite: false, fog: false, side: THREE.DoubleSide })
      );
      m.position.set(U.rand(-80, 80), 55 + i * 34, -300 - i * 90);
      city.clouds.push(m);
      city.group.add(m);
    }
    /* 雷电闪光（远处低频） */
    city._flashLight = new THREE.PointLight(PAL.lightning, 0, 900, 1.4);
    city._flashLight.position.set(0, 120, -320);
    city.group.add(city._flashLight);
    var fm = new THREE.Mesh(new THREE.PlaneGeometry(500, 260), new THREE.MeshBasicMaterial({ color: PAL.lightning, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    fm.position.set(0, 90, -430);
    city._flashPlane = fm;
    city.group.add(fm);
  }

  /* --- 远景摩天楼群（实例化）+ 楼顶探照灯 --- */
  function buildFarLayer(city, tex) {
    var spec = ART.city.far;
    var geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);                             // 以底面为原点，便于按高度缩放
    var mat = new THREE.MeshStandardMaterial({
      map: tex.window, emissiveMap: tex.window, emissive: 0xffffff, emissiveIntensity: 0.42,
      color: PAL.buildingB, metalness: 0.55, roughness: 0.62
    });
    var inst = new THREE.InstancedMesh(geo, mat, spec.count);
    inst.name = 'farTowers';
    var m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    city.towers = [];
    for (var i = 0; i < spec.count; i++) {
      var h = U.rand(spec.minH, spec.maxH);
      var w = U.rand(9, 22), d = U.rand(9, 22);
      pos.set(U.rand(-spec.xRange, spec.xRange), 0, U.rand(spec.zStart - 60, spec.zEnd));
      q.setFromEuler(new THREE.Euler(0, U.rand(-0.3, 0.3), 0));
      sc.set(w, h, d);
      m4.compose(pos, q, sc);
      inst.setMatrixAt(i, m4);
      city.towers.push({ x: pos.x, y: h, z: pos.z, w: w, d: d });
      city.layers.far.push({ type: 'tower', x: pos.x, y: h, z: pos.z });
    }
    inst.instanceMatrix.needsUpdate = true;
    city.group.add(inst);
    city.farInstanced = inst;

    /* 楼顶探照灯：3 盏，来回扫射 */
    if (ART.atmosphere.searchLights) {
      city.towers.sort(function (a, b) { return b.y - a.y; });
      for (var s = 0; s < 3 && s < city.towers.length; s++) {
        var t = city.towers[s];
        var g = new THREE.Group();
        g.position.set(t.x, t.y, t.z);
        var cone = new THREE.Mesh(
          new THREE.ConeGeometry(9, 130, 18, 1, true),
          new THREE.MeshBasicMaterial({ color: PAL.searchLight, transparent: true, opacity: 0.055, depthWrite: false, side: THREE.DoubleSide, fog: false })
        );
        cone.position.set(0, -65, 0); cone.rotation.x = Math.PI; // 向下
        g.add(cone);
        var lamp = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 6), Models._glowMat(PAL.searchLight, 2.5));
        g.add(lamp);
        city.group.add(g);
        city.searchlights.push({ group: g, cone: cone, speed: U.rand(0.25, 0.5) * (s % 2 ? -1 : 1), phase: U.rand(0, 6.28) });
      }
    }
  }

  /* --- 中景破损楼宇 + 火花 + 上升浓烟 --- */
  function buildMidLayer(city, tex) {
    var spec = ART.city.mid;
    var mat = new THREE.MeshStandardMaterial({ map: tex.ruin, color: 0xffffff, metalness: 0.4, roughness: 0.85 });
    city.emberSpots = [];
    for (var i = 0; i < spec.count; i++) {
      var h = U.rand(spec.minH, spec.maxH), w = U.rand(10, 20), d = U.rand(10, 20);
      var x = U.rand(-spec.xRange, spec.xRange), z = U.rand(spec.zStart, spec.zEnd);
      var b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      b.position.set(x, h / 2, z);
      b.castShadow = true; b.receiveShadow = true;
      city.group.add(b);
      /* 顶部破损缺口：顶部叠加两个小碎块 */
      for (var t = 0; t < 2; t++) {
        var chip = new THREE.Mesh(new THREE.BoxGeometry(U.rand(3, 7), U.rand(2, 5), U.rand(3, 7)), mat);
        chip.position.set(x + U.rand(-w * 0.3, w * 0.3), h + U.rand(0.5, 2), z + U.rand(-d * 0.3, d * 0.3));
        chip.rotation.y = U.rand(0, 1.5);
        chip.castShadow = true;
        city.group.add(chip);
      }
      /* 零星爆炸火光 */
      if (ART.atmosphere.embers && Math.random() < 0.5) {
        var em = new THREE.Mesh(new THREE.PlaneGeometry(U.rand(4, 9), U.rand(4, 9)), new THREE.MeshBasicMaterial({ map: tex.ember, color: PAL.emberOrange, transparent: true, opacity: U.rand(0.35, 0.7), depthWrite: false, blending: THREE.AdditiveBlending }));
        em.position.set(x + U.rand(-w * 0.3, w * 0.3), U.rand(1, h * 0.5), z + d * 0.52);
        em.userData.base = em.position.y;
        em.userData.flicker = U.rand(0, 6.28);
        city.group.add(em);
        city.emberSpots.push(em);
        if (ART.atmosphere.risingSmoke) city.smoke.push(makeSmoke(city, tex, em.position.x, em.position.y, z + d * 0.4));
      }
      city.layers.mid.push({ type: 'building', x: x, z: z, h: h, w: w, d: d, mesh: b });
    }
    for (var s = 0; s < 6; s++) {
      city.smoke.push(makeSmoke(city, tex, U.rand(-70, 70), U.rand(2, 12), U.rand(spec.zStart, spec.zEnd)));
    }
  }

  function makeSmoke(city, tex, x, y, z) {
    var m = new THREE.Mesh(
      new THREE.PlaneGeometry(U.rand(12, 26), U.rand(12, 26)),
      new THREE.MeshBasicMaterial({ map: tex.smoke, color: PAL.smoke, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide })
    );
    m.position.set(x, y, z);
    m.userData = { speed: U.rand(1.4, 3.2), life: U.rand(9, 18), age: U.rand(0, 8), y0: y, sway: U.rand(0, 6.28) };
    city.group.add(m);
    return m;
  }

  /* --- 近景 / 战场两侧：可破坏废墟 --- */
  function buildNearLayers(city, tex) {
    var mat = new THREE.MeshStandardMaterial({ map: tex.ruin, color: 0x9aa0a4, metalness: 0.4, roughness: 0.88 });
    var specN = ART.city.near, specS = ART.city.side;
    var list = [
      { spec: specN, layer: 'near' },
      { spec: specS, layer: 'side' }
    ];
    list.forEach(function (entry) {
      var spec = entry.spec;
      for (var i = 0; i < spec.count; i++) {
        var h = U.rand(spec.minH, spec.maxH), w = U.rand(8, 14), d = U.rand(8, 14);
        var x, z;
        if (entry.layer === 'side') {
          /* 战场两侧，避开双方出生点 */
          var sgn = i % 2 ? 1 : -1;
          x = sgn * U.rand(spec.xRange, spec.xRange + 16);
          z = U.rand(spec.zStart, spec.zEnd);
        } else {
          x = U.rand(-spec.xRange, spec.xRange);
          z = U.rand(spec.zStart, spec.zEnd);
        }
        var group = new THREE.Group();
        group.position.set(x, 0, z);
        /* 每栋建筑独立材质，受击闪红时才不会互相影响 */
        var myMat = mat.clone();
        var tiers = U.randInt(2, 4);
        var baseY = 0, maxR = Math.max(w, d) * 0.62;
        for (var t = 0; t < tiers; t++) {
          var th = h / tiers * U.rand(0.7, 1.3);
          var tw = w * (1 - t * 0.12), td = d * (1 - t * 0.12);
          var seg = new THREE.Mesh(new THREE.BoxGeometry(tw, th, td), myMat);
          seg.position.set(U.rand(-0.6, 0.6), baseY + th / 2, U.rand(-0.6, 0.6));
          seg.castShadow = true; seg.receiveShadow = true;
          group.add(seg);
          baseY += th;
        }
        /* 破损顶 + 钢筋 */
        var rubble = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, 1.2, d * 0.5), Models._mat(0x3a3f42, { roughness: 0.95, flat: true }));
        rubble.position.set(U.rand(-1, 1), baseY + 0.4, U.rand(-1, 1));
        rubble.rotation.set(U.rand(-0.3, 0.3), U.rand(0, 3), U.rand(-0.3, 0.3));
        group.add(rubble);
        /* 暴露的钢筋 */
        for (var rb = 0; rb < 3; rb++) {
          var rebar = Models._cyl(group, 0.1, 0.1, U.rand(2, 5), Models._mat(0x6a7076, { metalness: 1, roughness: 0.5 }), U.rand(-w * 0.3, w * 0.3), baseY + U.rand(0.6, 2), U.rand(-d * 0.3, d * 0.3), 5);
          rebar.rotation.set(U.rand(-0.3, 0.3), U.rand(0, 3), U.rand(-0.3, 0.3));
        }
        city.group.add(group);
        city.layers[entry.layer].push({ type: 'ruin', x: x, z: z, mesh: group, h: baseY });
        /* near 与 side 两层都可被摧毁 */
        if (spec.destructible) {
          var maxHp = CONFIG.combat.destructible.hp;
          var dObj = {
            object3D: group, position: new THREE.Vector3(x, 0, z), radius: maxR,
            hp: maxHp, maxHp: maxHp, alive: true, flashTimer: 0, material: myMat,
            mesh: group, layer: entry.layer, height: baseY
          };
          group.traverse(function (o) { if (o.isMesh) { o.userData.destructible = dObj; } });
          city.destructibles.push(dObj);
        }
      }
    });
  }

  /* --- 地面 --- */
  function buildGround(city, tex) {
    var g = new THREE.Mesh(
      new THREE.PlaneGeometry(CONFIG.arena.width + 120, 260),
      new THREE.MeshStandardMaterial({ map: tex.ground, color: 0xffffff, metalness: 0.22, roughness: 0.72 })
    );
    g.rotation.x = -Math.PI / 2;
    g.position.set(0, 0, -60);
    g.receiveShadow = true;
    g.name = 'ground';
    city.group.add(g);
    city.ground = g;
  }

  /* --- 路灯 / 路障 / 车辆 / 碎石 --- */
  function buildProps(city, tex) {
    var poleMat = Models._mat(0x1e2428, { metalness: 0.7, roughness: 0.5 });
    var lampGlow = Models._glowMat(PAL.lampLight, 1.8);
    var barrierMat = Models._mat(PAL.barrier, { metalness: 0.2, roughness: 0.7 });
    var carMat = Models._mat(0x1a1f23, { metalness: 0.75, roughness: 0.45 });
    var rubbleMat = Models._mat(0x33383b, { roughness: 0.95, flat: true });
    for (var i = 0; i < 8; i++) {
      var x = U.rand(-40, 40), z = U.rand(-14, 12);
      if (Math.abs(x) < 8) x += 12;                       // 避免正对出生点
      var lamp = new THREE.Group();
      lamp.position.set(x, 0, z);
      var pole = Models._cyl(lamp, 0.32, 0.4, 11, poleMat, 0, 5.5, 0, 8);
      var head = Models._box(lamp, 2.2, 0.5, 1.0, poleMat, 1.0, 11, 0);
      var glowHead = Models._box(lamp, 1.6, 0.18, 0.8, lampGlow, 1.0, 10.7, 0);
      city.group.add(lamp);
      city.propsUsed = (city.propsUsed || 0) + 1;
    }
    for (var b = 0; b < 10; b++) {
      var bx = U.rand(-40, 40), bz = U.rand(-13, 13);
      var bar = Models._box(city.group, 3.2, 1.1, 0.6, barrierMat, bx, 0.55, bz, U.rand(-0.4, 0.4));
      bar.castShadow = true;
    }
    for (var v = 0; v < 6; v++) {
      var vx = U.rand(-42, 42), vz = U.rand(-13, 10);
      if (Math.abs(vx) < 9) vx += 14;
      var car = new THREE.Group();
      car.position.set(vx, 0, vz);
      car.rotation.y = U.rand(-0.6, 0.6);
      Models._box(car, 4.6, 1.5, 9.5, carMat, 0, 0.9, 0);
      Models._box(car, 4.2, 1.1, 4.6, carMat, 0, 2.1, -0.4);
      Models._box(car, 0.3, 0.3, 0.3, Models._glowMat(PAL.emberOrange, 1.2), -1.4, 1.1, 4.6);
      Models._box(car, 0.3, 0.3, 0.3, Models._glowMat(PAL.emberOrange, 1.2), 1.4, 1.1, 4.6);
      city.group.add(car);
    }
    for (var r = 0; r < 46; r++) {
      var rx = U.rand(-46, 46), rz = U.rand(-15, 14);
      var chunk = Models.createDebrisMesh({ x: U.rand(0.6, 2.6), y: U.rand(0.4, 1.6), z: U.rand(0.6, 2.6) }, 0x2c3134);
      chunk.position.set(rx, 0.4, rz);
      chunk.rotation.set(U.rand(-0.4, 0.4), U.rand(0, 6.28), U.rand(-0.4, 0.4));
      city.group.add(chunk);
    }
  }

  /* --- 地面雾 / 火星 --- */
  function buildEffects(city, tex) {
    if (ART.atmosphere.groundFog) {
      for (var i = 0; i < 4; i++) {
        var f = new THREE.Mesh(
          new THREE.PlaneGeometry(420, 110),
          new THREE.MeshBasicMaterial({ map: tex.fog, color: PAL.fog, transparent: true, opacity: 0.42 - i * 0.06, depthWrite: false, side: THREE.DoubleSide, fog: false })
        );
        f.rotation.x = -Math.PI / 2;
        f.position.set(0, 2.2 + i * 2.4, -70 - i * 22);
        city.fogPlanes.push(f);
        city.group.add(f);
      }
    }
    if (ART.atmosphere.embers) {
      var count = 260;
      var pos = new Float32Array(count * 3);
      for (var p = 0; p < count; p++) {
        pos[p * 3] = U.rand(-60, 60);
        pos[p * 3 + 1] = U.rand(0.5, 26);
        pos[p * 3 + 2] = U.rand(-90, 16);
      }
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      var mat = new THREE.PointsMaterial({ size: 0.5, map: tex.ember, color: PAL.emberOrange, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
      var points = new THREE.Points(geo, mat);
      points.frustumCulled = false;
      city.embers = points;
      city.group.add(points);
      city._emberSeed = pos;
    }
  }

  /* --- 城市每帧更新 --- */
  function cityUpdate(dt, elapsed, camera) {
    var i;
    /* 云层漂移 + 探照灯扫射 */
    for (i = 0; i < (this.clouds || []).length; i++) {
      var cl = this.clouds[i];
      cl.position.x += dt * (2 + i * 0.6);
      if (cl.position.x > 200) cl.position.x = -200;
      cl.lookAt(camera ? camera.position : new THREE.Vector3());
    }
    for (i = 0; i < this.searchlights.length; i++) {
      var sl = this.searchlights[i];
      sl.group.rotation.y = Math.sin(elapsed * sl.speed + sl.phase) * 0.9;
      sl.group.rotation.z = Math.sin(elapsed * sl.speed * 0.6 + sl.phase) * 0.25;
      sl.cone.material.opacity = 0.04 + 0.02 * (0.5 + 0.5 * Math.sin(elapsed * 3 + sl.phase));
    }
    /* 火花闪烁 */
    for (i = 0; i < (this.emberSpots || []).length; i++) {
      var e = this.emberSpots[i];
      e.material.opacity = 0.3 + 0.4 * (0.5 + 0.5 * Math.sin(elapsed * 6 + e.userData.flicker));
      e.position.y = e.userData.base + Math.sin(elapsed * 2 + e.userData.flicker) * 0.3;
    }
    /* 浓烟上升 + 淡出回收 */
    for (i = 0; i < this.smoke.length; i++) {
      var s = this.smoke[i];
      s.userData.age += dt;
      s.position.y += s.userData.speed * dt;
      s.position.x += Math.sin(elapsed * 0.5 + s.userData.sway) * dt * 0.5;
      var t = s.userData.age / s.userData.life;
      if (t >= 1) {
        s.userData.age = 0;
        s.position.y = s.userData.y0;
      } else {
        s.material.opacity = 0.3 * (1 - t) * Math.min(1, t * 6);
        var sc = 1 + t * 0.8;
        s.scale.set(sc, sc, sc);
      }
      s.lookAt(camera ? camera.position : new THREE.Vector3());
    }
    /* 雾气漂移 */
    for (i = 0; i < this.fogPlanes.length; i++) {
      var fp = this.fogPlanes[i];
      fp.position.x = Math.sin(elapsed * 0.06 + i) * 12;
    }
    /* 火星漂浮 */
    if (this.embers && this._emberSeed) {
      var arr = this.embers.geometry.attributes.position.array;
      for (i = 0; i < arr.length; i += 3) {
        arr[i + 1] += dt * (1.2 + (i % 7) * 0.25);
        arr[i] += Math.sin(elapsed * 1.2 + i) * dt * 0.6;
        if (arr[i + 1] > 30) { arr[i + 1] = 0.4; arr[i] = U.rand(-60, 60); }
      }
      this.embers.geometry.attributes.position.needsUpdate = true;
    }
    /* 雷电（低频） */
    if (ART.atmosphere.distantLightning && this._flashLight) {
      this._lightningTimer -= dt;
      if (this._lightningTimer <= 0) {
        this._lightningTimer = U.rand(6, 16);
        this._flash = 1;
      }
      if (this._flash > 0) {
        this._flash = Math.max(0, this._flash - dt * 2.2);
        var f = this._flash > 0.75 ? 1 : this._flash * 1.3;
        this._flashLight.intensity = f * 2.6;
        this._flashPlane.material.opacity = f * 0.32;
      }
    }
    /* 可破坏建筑受击闪红 */
    var list = this.destructibles;
    for (i = 0; i < list.length; i++) {
      var d = list[i];
      if (d.damageFlash) { d.flashTimer = d.damageFlash; d.damageFlash = 0; }   // 兼容 combat.js 写入的字段
      if (!d.flashTimer || !d.material || !d.material.emissive) continue;
      d.flashTimer = Math.max(0, d.flashTimer - dt * 2.2);
      d.material.emissive.setHex(0xff3200);
      d.material.emissiveIntensity = d.flashTimer * 0.85;
    }
  }

  function cityLightning() { this._flash = 1; }

  function cityReset() {
    for (var i = 0; i < this.destructibles.length; i++) {
      var d = this.destructibles[i];
      d.alive = true;
      d.hp = d.maxHp;
      d.flashTimer = 0;
      if (d.mesh) d.mesh.visible = true;
    }
  }

  GAME.Models = Models;

})(typeof window !== 'undefined' ? window : this);
