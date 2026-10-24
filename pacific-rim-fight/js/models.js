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
  var AC = CONFIG.artConfig || {};        // ART_CONFIG 统一视觉参数入口
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
          var glowMaterials = [];
          root.traverse(function (o) {
            if (o.isMesh) {
              o.castShadow = true; o.receiveShadow = true;
              var mats = Array.isArray(o.material) ? o.material : [o.material];
              for (var i = 0; i < mats.length; i++) {
                var mt = mats[i];
                if (mt && mt.emissive && mt.emissive.getHex && mt.emissive.getHex() !== 0) {
                  mt.userData.baseEmissiveIntensity = mt.emissiveIntensity;
                  mt.userData.isGlow = true;
                  if (glowMaterials.indexOf(mt) < 0) glowMaterials.push(mt);
                } else if (mt) {
                  mt.userData.baseEmissive = mt.emissive ? mt.emissive.clone() : new THREE.Color(0x000000);
                  mt.userData.baseEmissiveIntensity = mt.emissiveIntensity || 0;
                }
              }
            }
          });
          var s = (def.model.scale || 1);
          root.scale.multiplyScalar(s);
          if (def.model.rotationY) root.rotation.y += def.model.rotationY;
          var bodyMaterials = Models.collectBodyMaterials(root);
          return { root: root, clips: (gltf.animations || []), gltf: gltf, isPlaceholder: false, mixerTarget: root, glowMaterials: glowMaterials, bodyMaterials: bodyMaterials };
        }).catch(function (e) {
          console.warn('[Models] 高清模型加载失败，回退程序化低模：', def.id, e && e.message);
          var built = Models.build(def);
          return { root: built.root, clips: built.clips, gltf: null, isPlaceholder: true, mixerTarget: built.root, parts: built.parts, glowMaterials: built.glowMaterials, bodyMaterials: built.bodyMaterials, hitCenterY: built.hitCenterY };
        });
      }
      var b = Models.build(def);
      return Promise.resolve({ root: b.root, clips: b.clips, gltf: null, isPlaceholder: true, mixerTarget: b.root, parts: b.parts, glowMaterials: b.glowMaterials, bodyMaterials: b.bodyMaterials, hitCenterY: b.hitCenterY });
    },

    build: function (def) {
      return def.faction === 'kaiju' ? Models.buildKaiju(def) : Models.buildMecha(def);
    },

    /* ================================================================== */
    /* 通用建模辅助                                                        */
    /* ================================================================== */
    /* 通用 PBR 材质：默认金属度/粗糙度来自 ART_CONFIG.material，
       opts.maps 可传入 { map, roughnessMap, bumpMap, normalMap } 叠加表面细节。 */
    _mat: function (color, opts) {
      opts = opts || {};
      var def = AC.material || {};
      var m = new THREE.MeshStandardMaterial({
        color: color,
        metalness: opts.metalness !== undefined ? opts.metalness : (def.defaultMetalness !== undefined ? def.defaultMetalness : 0.55),
        roughness: opts.roughness !== undefined ? opts.roughness : (def.defaultRoughness !== undefined ? def.defaultRoughness : 0.5),
        emissive: opts.emissive !== undefined ? opts.emissive : 0x000000,
        emissiveIntensity: opts.emissiveIntensity || 1,
        flatShading: !!opts.flat
      });
      if (opts.maps) {
        if (opts.maps.map) m.map = opts.maps.map;
        if (opts.maps.roughnessMap) m.roughnessMap = opts.maps.roughnessMap;
        if (opts.maps.bumpMap) m.bumpMap = opts.maps.bumpMap;
        if (opts.maps.normalMap) m.normalMap = opts.maps.normalMap;
        if (opts.maps.emissiveMap) m.emissiveMap = opts.maps.emissiveMap;
      }
      if (opts.bumpScale !== undefined) m.bumpScale = opts.bumpScale;
      if (opts.envMapIntensity !== undefined) m.envMapIntensity = opts.envMapIntensity;
      m.userData.baseEmissive = m.emissive ? m.emissive.clone() : new THREE.Color(0x000000);
      m.userData.baseEmissiveIntensity = m.emissiveIntensity;
      return m;
    },
    _glowMat: function (color, intensity) {
      var m = new THREE.MeshStandardMaterial({
        color: color, metalness: 0.2, roughness: 0.3,
        emissive: color, emissiveIntensity: intensity === undefined ? 2.2 : intensity
      });
      m.userData.baseEmissiveIntensity = m.emissiveIntensity;
      m.userData.isGlow = true;
      return m;
    },
    /* 收集单位本体材质（非发光、可用于受击闪白 / 全局染色），同时记录发光材质呼吸 */
    collectBodyMaterials: function (root) {
      var list = [];
      if (!root) return list;
      root.traverse(function (o) {
        if (!o.isMesh) return;
        var mats = Array.isArray(o.material) ? o.material : [o.material];
        for (var i = 0; i < mats.length; i++) {
          var mt = mats[i];
          if (!mt) continue;
          if (mt.userData && mt.userData.isGlow) continue;
          if (list.indexOf(mt) < 0) list.push(mt);
        }
      });
      return list;
    },
    /* 受击闪白：把本体材质 emissive 临时置白，强度随 flash 衰减
       flash ∈ [0,1]，1=峰值。调用方在 update 里逐帧衰减后再次调用。 */
    flashBody: function (bodyMaterials, flash) {
      if (!bodyMaterials || !bodyMaterials.length) return;
      var col = (AC.hitFlash && AC.hitFlash.color !== undefined) ? AC.hitFlash.color : 0xffffff;
      var peak = (AC.glow && AC.glow.hitFlashIntensity) || 2.4;
      for (var i = 0; i < bodyMaterials.length; i++) {
        var m = bodyMaterials[i];
        if (!m || !m.emissive) continue;
        var base = m.userData && m.userData.baseEmissive ? m.userData.baseEmissive : null;
        var baseI = m.userData && m.userData.baseEmissiveIntensity !== undefined ? m.userData.baseEmissiveIntensity : 0;
        if (flash > 0.001) {
          m.emissive.setHex(col);
          m.emissiveIntensity = Math.max(baseI, peak * flash);
        } else {
          if (base) m.emissive.copy(base); else m.emissive.setHex(0x000000);
          m.emissiveIntensity = baseI;
        }
      }
    },
    /* 发光呼吸：按时间 t(秒) 微调所有发光材质强度，制造反应堆脉动 */
    pulseGlow: function (glowMaterials, t) {
      if (!glowMaterials || !glowMaterials.length) return;
      var sp = (AC.glow && AC.glow.pulseSpeed) || 1.6;
      var dp = (AC.glow && AC.glow.pulseDepth) || 0.18;
      var k = 1 + Math.sin(t * sp * Math.PI * 2) * dp;
      for (var i = 0; i < glowMaterials.length; i++) {
        var m = glowMaterials[i];
        if (!m) continue;
        var base = m.userData && m.userData.baseEmissiveIntensity !== undefined ? m.userData.baseEmissiveIntensity : m.emissiveIntensity;
        m.emissiveIntensity = base * k;
      }
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
    /* 倒角装甲板：圆角矩形沿 Z 挤出并倒角，比纯 Box 更有体积与高光层次 */
    _bevel: function (parent, w, h, d, mat, x, y, z, ry, radius) {
      var r = radius === undefined ? Math.min(w, h) * 0.14 : radius;
      r = Math.max(0, Math.min(r, w * 0.45, h * 0.45));
      var hw = w / 2 - r, hh = h / 2 - r;
      var shape = new THREE.Shape();
      shape.moveTo(-hw, -h / 2);
      shape.lineTo(hw, -h / 2);
      shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -hh);
      shape.lineTo(w / 2, hh);
      shape.quadraticCurveTo(w / 2, h / 2, hw, h / 2);
      shape.lineTo(-hw, h / 2);
      shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, hh);
      shape.lineTo(-w / 2, -hh);
      shape.quadraticCurveTo(-w / 2, -h / 2, -hw, -h / 2);
      var bs = Math.min(w, h, d) * 0.12;
      var body = Math.max(0.001, d - bs * 2);
      var geo = new THREE.ExtrudeGeometry(shape, {
        depth: body, bevelEnabled: true, bevelThickness: bs, bevelSize: bs, bevelSegments: 2, curveSegments: 3
      });
      geo.translate(0, 0, -body / 2);
      var m = new THREE.Mesh(geo, mat);
      m.position.set(x || 0, y || 0, z || 0);
      if (ry) m.rotation.y = ry;
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
      var tex = unitTextures('mecha');
      var MDEF = (AC.material || {});
      var mm = MDEF.mecha || { metalness: 0.62, roughness: 0.5, envMapIntensity: 1.0 };
      var ma = MDEF.accent || { metalness: 0.72, roughness: 0.42, envMapIntensity: 1.0 };
      var md = MDEF.dark || { metalness: 0.5, roughness: 0.66, envMapIntensity: 0.8 };
      var armor = Models._mat(def.armor, { metalness: mm.metalness, roughness: mm.roughness, maps: tex, bumpScale: 0.02, envMapIntensity: mm.envMapIntensity });
      var accent = Models._mat(def.accent, { metalness: ma.metalness, roughness: ma.roughness, maps: tex, envMapIntensity: ma.envMapIntensity });
      var dark = Models._mat(0x10151a, { metalness: md.metalness, roughness: md.roughness, envMapIntensity: md.envMapIntensity });
      var glow = Models._glowMat(def.glow, (AC.glow && AC.glow.mechaCore) || 1.15);
      var glowWarm = Models._glowMat(0xffd9a0, (AC.glow && AC.glow.mechaWarm) || 0.85);
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
        Models._bevel(leg, H * 0.085 * w, thigh, H * 0.09 * w, armor, 0, -thigh * 0.5, 0);   // 大腿（倒角装甲）
        Models._box(leg, H * 0.06 * w, thigh * 0.5, H * 0.1 * w, accent, 0, -thigh * 0.2, 0); // 髋侧甲
        /* 大腿液压杆（后侧双活塞） */
        for (var tp = -1; tp <= 1; tp += 2) {
          Models._cyl(leg, H * 0.009, H * 0.009, thigh * 0.6, dark, tp * H * 0.03 * w, -thigh * 0.5, -H * 0.045 * w, 6);
          Models._cyl(leg, H * 0.013, H * 0.013, H * 0.06, accent, tp * H * 0.03 * w, -thigh * 0.82, -H * 0.045 * w, 6);
        }
        var knee = Models._part('shin' + side, leg, 0, -thigh, 0);
        Models._cyl(knee, H * 0.05, H * 0.05, H * 0.06, dark, 0, 0, 0, 10);
        Models._bevel(knee, H * 0.07 * w, shin, H * 0.075 * w, armor, 0, -shin * 0.5, 0);    // 小腿（倒角装甲）
        Models._box(knee, H * 0.075 * w, H * 0.03, H * 0.085 * w, accent, 0, 0.01, H * 0.005); // 膝甲
        /* 小腿液压杆（后侧双活塞，体现机甲机械结构） */
        for (var lp = -1; lp <= 1; lp += 2) {
          Models._cyl(knee, H * 0.008, H * 0.008, shin * 0.7, dark, lp * H * 0.025 * w, -shin * 0.4, -H * 0.04 * w, 6);
          Models._cyl(knee, H * 0.012, H * 0.012, H * 0.05, accent, lp * H * 0.025 * w, -shin * 0.78, -H * 0.04 * w, 6);
        }
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
      Models._bevel(body, H * 0.21 * w, H * 0.19, H * 0.135 * w, armor, 0, H * 0.1, 0);       // 胸腔（倒角装甲）
      Models._bevel(body, H * 0.235 * w, H * 0.045, H * 0.145 * w, accent, 0, H * 0.20, 0);   // 肩桥（倒角装甲）
      Models._box(body, H * 0.09 * w, H * 0.16, H * 0.02, dark, 0, H * 0.1, H * 0.072 * w);    // 胸口面板
      /* 胸口反应堆（自发光核心）—— 环太平洋标志性核反应堆，加大并加多层环 */
      var core = Models._part('reactor', body, 0, H * 0.115, H * 0.055 * w);
      /* 外环装甲圈 */
      Models._cyl(core, H * 0.09, H * 0.09, H * 0.018, dark, 0, 0, -H * 0.005, 24).rotation.x = Math.PI / 2;
      /* 中环（金属） */
      Models._cyl(core, H * 0.072, H * 0.072, H * 0.02, accent, 0, 0, 0.002, 24).rotation.x = Math.PI / 2;
      /* 内环（发光） */
      Models._cyl(core, H * 0.05, H * 0.05, H * 0.03, glow, 0, 0, H * 0.012, 20).rotation.x = Math.PI / 2;
      /* 最亮核心点 */
      Models._cyl(core, H * 0.024, H * 0.024, H * 0.02, Models._glowMat(0xffffff, 3.2), 0, 0, H * 0.026, 12).rotation.x = Math.PI / 2;
      /* 胸侧冷却管（左右各一根，从肩部连向反应堆） */
      for (var cp = -1; cp <= 1; cp += 2) {
        Models._cyl(body, H * 0.012, H * 0.012, H * 0.16, dark, cp * H * 0.1 * w, H * 0.13, H * 0.03 * w, 8).rotation.z = cp * 0.35;
        Models._box(body, H * 0.018, H * 0.04, H * 0.03, accent, cp * H * 0.115 * w, H * 0.05, H * 0.04 * w);
      }
      /* 背部散热口 + 背包 */
      Models._box(body, H * 0.17 * w, H * 0.15, H * 0.08, dark, 0, H * 0.11, -H * 0.09 * w);
      for (var v = -1; v <= 1; v += 2) {
        Models._box(body, H * 0.03, H * 0.11, H * 0.03, glow, v * H * 0.055 * w, H * 0.13, -H * 0.135 * w);
      }
      /* 腰侧装甲裙板 */
      for (var k = -1; k <= 1; k += 2) {
        Models._box(body, H * 0.05 * w, H * 0.09, H * 0.05, accent, k * H * 0.115 * w, -H * 0.01, 0);
      }

      /* --- 头部（Conn-Pod 驾驶舱：宽面罩 + 天线/脊冠，环太平洋标志性设计）--- */
      var head = Models._part('head', body, 0, H * 0.245, 0);
      if (heavy) {
        /* 重击型：宽扁盒状驾驶舱（切尔诺·阿尔法风格），单条宽面罩 */
        Models._box(head, H * 0.12, H * 0.08, H * 0.12, armor, 0, 0, 0);
        Models._box(head, H * 0.125, H * 0.03, H * 0.125, accent, 0, H * 0.03, 0);        // 顶盖
        Models._box(head, H * 0.11, H * 0.014, H * 0.018, glow, 0, -H * 0.005, H * 0.062); // 宽面罩发光条
        Models._box(head, H * 0.018, H * 0.04, H * 0.018, dark, -H * 0.05, H * 0.04, 0);  // 左侧通讯柱
        Models._box(head, H * 0.018, H * 0.04, H * 0.018, dark, H * 0.05, H * 0.04, 0);   // 右侧通讯柱
        /* 顶部圆柱状反应堆排热口 */
        Models._cyl(head, H * 0.03, H * 0.03, H * 0.03, dark, 0, H * 0.06, 0, 10);
      } else {
        /* 均衡型：流线型驾驶舱，带 V 型脊冠 + 双天线（赤红风暴/吉普赛风格） */
        Models._box(head, H * 0.085, H * 0.07, H * 0.1, armor, 0, 0, 0);
        Models._box(head, H * 0.075, H * 0.02, H * 0.03, accent, 0, H * 0.045, H * 0.005); // 脊冠基座
        Models._box(head, H * 0.012, H * 0.035, H * 0.012, accent, 0, H * 0.07, 0);        // 中央天线
        Models._box(head, H * 0.01, H * 0.025, H * 0.01, dark, -H * 0.035, H * 0.055, 0);  // 左天线
        Models._box(head, H * 0.01, H * 0.025, H * 0.01, dark, H * 0.035, H * 0.055, 0);   // 右天线
        Models._box(head, H * 0.09, H * 0.012, H * 0.02, glow, 0, H * 0.004, H * 0.05);    // 面罩发光条
        Models._box(head, H * 0.03, H * 0.04, H * 0.02, dark, 0, -H * 0.03, H * 0.045);    // 下颚
      }

      /* --- 双臂 + 武器 --- */
      ['L', 'R'].forEach(function (side) {
        var sgn = (side === 'L' ? -1 : 1);
        var shW = heavy ? H * 0.115 : H * 0.085;
        var shoulder = Models._part('shoulder' + side, body, sgn * H * 0.13 * w, H * 0.175, 0);
        Models._box(shoulder, shW, H * 0.055, H * 0.11 * w, accent, sgn * H * 0.01, 0, 0);
        Models._bevel(shoulder, shW * 0.75, H * 0.09, H * 0.1 * w, armor, sgn * H * 0.015, -H * 0.02, 0);  // 肩甲（倒角装甲）
        Models._box(shoulder, H * 0.02, H * 0.02, H * 0.02, glow, sgn * H * 0.045, 0.005, 0);           // 肩灯
        /* 大型肩甲外板（Tasset，向外下延伸，环太平洋标志性宽肩轮廓） */
        Models._bevel(shoulder, shW * 0.9, H * 0.12, H * 0.13 * w, accent, sgn * H * 0.05, -H * 0.04, -H * 0.01 * w);
        Models._box(shoulder, shW * 0.5, H * 0.025, H * 0.04, glow, sgn * H * 0.06, -H * 0.08, -H * 0.04 * w); // 肩甲灯带
        var arm = Models._part('arm' + side, shoulder, 0, -H * 0.03, 0);
        Models._cyl(arm, H * 0.035, H * 0.032, H * 0.19, armor, 0, -H * 0.095, 0, 10);   // 上臂
        Models._cyl(arm, H * 0.02, H * 0.02, H * 0.03, dark, 0, -H * 0.19, 0, 8);        // 肘关节
        var fore = Models._part('forearm' + side, arm, 0, -H * 0.185, 0);
        Models._cyl(fore, H * 0.042, H * 0.038, H * 0.17, armor, 0, -H * 0.085, 0, 10);  // 前臂
        Models._box(fore, H * 0.07, H * 0.1, H * 0.07, accent, 0, -H * 0.14, 0);          // 护腕
        Models._box(fore, H * 0.015, H * 0.015, H * 0.05, glow, 0, -H * 0.145, H * 0.04);
        var fist = Models._part('fist' + side, fore, 0, -H * 0.175, 0);
        Models._box(fist, H * 0.07, H * 0.06, H * 0.07, dark, 0, -H * 0.03, 0);
        /* 武器：右臂主武器，左臂副武器（重击型换重拳/重炮） */
        if (side === 'R') {
          if (def.weapon.type === 'blade') {
            /* 等离子链锯：腕部旋转圆盘 + 带锯齿的能量刃 */
            var hub = Models._cyl(fore, H * 0.05, H * 0.05, H * 0.02, dark, 0, -H * 0.17, H * 0.05, 16);
            hub.rotation.x = Math.PI / 2;
            var disc = new THREE.Mesh(new THREE.CylinderGeometry(H * 0.075, H * 0.075, H * 0.012, 16), Models._mat(0xb9c4cc, { metalness: 1, roughness: 0.2 }));
            disc.position.set(0, -H * 0.17, H * 0.055); disc.rotation.x = Math.PI / 2; disc.castShadow = true;
            fore.add(disc);
            /* 锯齿刃（多个小三角沿刃边排列） */
            for (var s = 0; s < 6; s++) {
              Models._box(fore, H * 0.01, H * 0.02, H * 0.015, Models._mat(0xdfe6ec, { metalness: 1, roughness: 0.2 }),
                (s - 2.5) * H * 0.012, -H * 0.17 - s * H * 0.045, H * 0.11 + s * H * 0.002);
            }
            var edge = Models._box(fore, H * 0.012, H * 0.33, H * 0.012, glow, 0, -H * 0.18, H * 0.105);
            edge.material = glow;
          } else if (def.weapon.type === 'cannon') {
            /* 腕部重型炮管 */
            var barrel = Models._cyl(fore, H * 0.035, H * 0.03, H * 0.16, dark, 0, -H * 0.16, H * 0.08, 12);
            barrel.rotation.x = Math.PI / 2;
            Models._cyl(fore, H * 0.045, H * 0.045, H * 0.04, accent, 0, -H * 0.12, H * 0.04, 12);
            Models._cyl(fore, H * 0.02, H * 0.02, H * 0.03, glowWarm, 0, -H * 0.16, H * 0.17, 8).rotation.x = Math.PI / 2;
          }
        }
        if (side === 'L') {
          /* 左臂：副武器 —— 均衡型为等离子炮，重击型为震波拳套 */
          if (heavy) {
            /* 震波拳套：加大拳头 + 指节冲击器 */
            Models._box(fist, H * 0.1, H * 0.08, H * 0.1, accent, 0, -H * 0.03, 0);
            for (var kn = -1; kn <= 1; kn += 2) {
              Models._box(fist, H * 0.022, H * 0.022, H * 0.022, Models._mat(0x3a3f44, { metalness: 1 }), kn * H * 0.028, -H * 0.065, H * 0.04);
            }
            Models._box(fist, H * 0.04, H * 0.015, H * 0.015, glowWarm, 0, -H * 0.07, H * 0.052);
          } else {
            var gunBody = Models._box(fore, H * 0.06, H * 0.06, H * 0.1, dark, 0, -H * 0.12, H * 0.05);
            for (var b = -1; b <= 1; b += 2) {
              Models._cyl(fore, H * 0.012, H * 0.012, H * 0.12, Models._mat(0x22282d, { metalness: 1 }), b * H * 0.018, -H * 0.12, H * 0.1, 8).rotation.x = Math.PI / 2;
            }
            Models._box(fore, H * 0.05, H * 0.04, H * 0.04, glowWarm, 0, -H * 0.12, H * 0.13);
          }
        }
      });

      root.userData.height = H;
      var bodyMaterials = Models.collectBodyMaterials(root);
      return {
        root: root, parts: parts, clips: Models.createClips(root, 'mecha', def),
        height: H, radius: def.radius, hitCenterY: H * 0.55,
        glowMaterials: glowMaterials, bodyMaterials: bodyMaterials
      };
    },

    /* ================================================================== */
    /* 敌方怪兽（开菊兽生物风格）                                           */
    /* ================================================================== */
    buildKaiju: function (def) {
      var H = def.height * (def.scale || 1);
      var fast = def.style === 'fast';
      var bulk = fast ? 0.92 : 1.22;
      var tex = unitTextures('kaiju');
      var KDEF = (AC.material || {});
      var ks = KDEF.kaijuSkin || { metalness: 0.05, roughness: 0.9 };
      var kb = KDEF.kaijuBelly || { metalness: 0.05, roughness: 0.85 };
      var kp = KDEF.kaijuPlate || { metalness: 0.35, roughness: 0.8 };
      var skin = Models._mat(def.skin, { metalness: ks.metalness, roughness: ks.roughness, flat: true, maps: tex, bumpScale: 0.035 });
      var belly = Models._mat(def.belly, { metalness: kb.metalness, roughness: kb.roughness, flat: true, maps: tex, bumpScale: 0.025 });
      var plate = Models._mat(0x2b3238, { metalness: kp.metalness, roughness: kp.roughness, flat: true, maps: tex, bumpScale: 0.03 });
      var glow = Models._glowMat(def.glow, (AC.glow && AC.glow.kaijuCore) || 0.95);
      var glowSoft = Models._glowMat(def.glow, (AC.glow && AC.glow.kaijuSoft) || 0.6);
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
      Models._bevel(chest, H * 0.26 * bulk, H * 0.2, H * 0.22 * bulk, skin, 0, 0, 0);
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
        Models._bevel(torso, H * 0.3 * bulk, H * 0.05, H * 0.2 * bulk, plate, 0, H * 0.19, -H * 0.03);
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
      var bodyMaterials = Models.collectBodyMaterials(root);
      return {
        root: root, parts: parts, clips: Models.createClips(root, 'kaiju', def),
        height: H, radius: def.radius, hitCenterY: H * 0.55,
        glowMaterials: glowMaterials, bodyMaterials: bodyMaterials
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
  function canvasTexture(canvas, repeat, linear) {
    var t = new THREE.CanvasTexture(canvas);
    /* 颜色贴图需 SRGB；数据贴图（roughnessMap / bumpMap）保持线性空间 */
    if (!linear) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
    t.anisotropy = 4;
    return t;
  }
  function hex(col) { return '#' + new THREE.Color(col).getHexString(); }

  /* ==================================================================== */
  /* 单位程序化 PBR 贴图                                                   */
  /*   · map 以近白为底，乘到材质 color 上 → 不改变单位配色，只叠加细节     */
  /*   · roughnessMap / bumpMap 用于制造面板线 / 鳞片 / 磨损的微观层次      */
  /*   · 按 kind 缓存，机甲与怪兽各一套，避免重复生成                       */
  /* ==================================================================== */
  var _unitTexCache = {};
  function unitTextures(kind) {
    if (_unitTexCache[kind]) return _unitTexCache[kind];
    var set = {};

    if (kind === 'kaiju') {
      /* --- 生物皮肤：斑驳鳞片 --- */
      var kc = makeCanvas(512, 512), kg = kc.getContext('2d');
      kg.fillStyle = '#ffffff'; kg.fillRect(0, 0, 512, 512);
      for (var i = 0; i < 1400; i++) {
        var v = U.randInt(0, 60);
        var lum = 200 - v;
        kg.fillStyle = 'rgba(' + lum + ',' + lum + ',' + lum + ',' + U.rand(0.06, 0.22).toFixed(2) + ')';
        kg.beginPath();
        kg.ellipse(U.rand(0, 512), U.rand(0, 512), U.rand(6, 22), U.rand(4, 12), Math.random() * 3, 0, Math.PI * 2);
        kg.fill();
      }
      /* 鳞片网格暗线 */
      kg.strokeStyle = 'rgba(120,120,120,0.35)'; kg.lineWidth = 1.4;
      for (var ky = 0; ky < 560; ky += 26) {
        for (var kx = 0; kx < 560; kx += 26) {
          kg.beginPath();
          kg.arc(kx + U.rand(-4, 4), ky + U.rand(-4, 4), U.rand(8, 13), 0, Math.PI * 2);
          kg.stroke();
        }
      }
      set.map = canvasTexture(kc);

      /* 粗糙度：整体偏粗糙，局部有光滑膜感 */
      var krc = makeCanvas(256, 256), krg = krc.getContext('2d');
      krg.fillStyle = '#cfcfcf'; krg.fillRect(0, 0, 256, 256);
      for (var j = 0; j < 260; j++) {
        krg.fillStyle = 'rgba(' + U.randInt(90, 240) + ',' + U.randInt(90, 240) + ',' + U.randInt(90, 240) + ',' + U.rand(0.2, 0.5).toFixed(2) + ')';
        krg.beginPath(); krg.ellipse(U.rand(0, 256), U.rand(0, 256), U.rand(5, 18), U.rand(4, 12), 0, 0, Math.PI * 2); krg.fill();
      }
      set.roughnessMap = canvasTexture(krc, null, true);

      /* 凸凹：与鳞片暗线同构 */
      var kbc = makeCanvas(256, 256), kbg = kbc.getContext('2d');
      kbg.fillStyle = '#808080'; kbg.fillRect(0, 0, 256, 256);
      kbg.strokeStyle = '#4a4a4a'; kbg.lineWidth = 2;
      for (var by = 0; by < 300; by += 20) {
        for (var bx = 0; bx < 300; bx += 20) {
          kbg.beginPath(); kbg.arc(bx + U.rand(-3, 3), by + U.rand(-3, 3), U.rand(6, 10), 0, Math.PI * 2); kbg.stroke();
        }
      }
      set.bumpMap = canvasTexture(kbc, null, true);
    } else {
      /* --- 机甲装甲：面板线 + 铆钉 + 磨损 --- */
      var mc = makeCanvas(512, 512), mg = mc.getContext('2d');
      mg.fillStyle = '#f2f2f2'; mg.fillRect(0, 0, 512, 512);
      /* 面板缝隙 */
      mg.strokeStyle = 'rgba(70,70,70,0.55)'; mg.lineWidth = 2;
      for (var gy = 0; gy <= 512; gy += 64) { mg.beginPath(); mg.moveTo(0, gy); mg.lineTo(512, gy); mg.stroke(); }
      for (var gx = 0; gx <= 512; gx += 64) { mg.beginPath(); mg.moveTo(gx, 0); mg.lineTo(gx, 512); mg.stroke(); }
      mg.strokeStyle = 'rgba(90,90,90,0.35)'; mg.lineWidth = 1;
      for (var sy = 32; sy <= 480; sy += 64) {
        for (var sx = 32; sx <= 480; sx += 64) { mg.beginPath(); mg.moveTo(sx, sy); mg.lineTo(sx + 40, sy); mg.stroke(); }
      }
      /* 铆钉 */
      mg.fillStyle = 'rgba(60,60,60,0.55)';
      for (var ny = 0; ny <= 512; ny += 64) {
        for (var nx = 0; nx <= 512; nx += 64) {
          for (var rv = 0; rv < 3; rv++) { mg.beginPath(); mg.arc(nx + U.rand(8, 56), ny + U.rand(8, 56), 2.0, 0, Math.PI * 2); mg.fill(); }
        }
      }
      /* 划痕 / 污渍 */
      mg.strokeStyle = 'rgba(255,255,255,0.25)'; mg.lineWidth = 1;
      for (var sc = 0; sc < 90; sc++) {
        var lx = U.rand(0, 512), ly = U.rand(0, 512);
        mg.beginPath(); mg.moveTo(lx, ly); mg.lineTo(lx + U.rand(-24, 24), ly + U.rand(-6, 6)); mg.stroke();
      }
      for (var dt = 0; dt < 120; dt++) {
        mg.fillStyle = 'rgba(40,40,40,' + U.rand(0.04, 0.14).toFixed(2) + ')';
        mg.fillRect(U.rand(0, 512), U.rand(0, 512), U.rand(1, 4), U.rand(1, 4));
      }
      set.map = canvasTexture(mc);

      /* 粗糙度：基板较光滑，缝线/磨损处更粗糙 */
      var mrc = makeCanvas(256, 256), mrg = mrc.getContext('2d');
      mrg.fillStyle = '#8a8a8a'; mrg.fillRect(0, 0, 256, 256);
      for (var mr = 0; mr < 180; mr++) {
        mrg.fillStyle = 'rgba(' + U.randInt(120, 240) + ',' + U.randInt(120, 240) + ',' + U.randInt(120, 240) + ',' + U.rand(0.15, 0.4).toFixed(2) + ')';
        mrg.fillRect(U.rand(0, 256), U.rand(0, 256), U.rand(4, 30), U.rand(2, 10));
      }
      mrg.strokeStyle = 'rgba(230,230,230,0.5)'; mrg.lineWidth = 2;
      for (var mry = 0; mry <= 256; mry += 32) { mrg.beginPath(); mrg.moveTo(0, mry); mrg.lineTo(256, mry); mrg.stroke(); }
      for (var mrx = 0; mrx <= 256; mrx += 32) { mrg.beginPath(); mrg.moveTo(mrx, 0); mrg.lineTo(mrx, 256); mrg.stroke(); }
      set.roughnessMap = canvasTexture(mrc, null, true);

      /* 凸凹：面板缝为凹槽 */
      var mbc = makeCanvas(256, 256), mbg = mbc.getContext('2d');
      mbg.fillStyle = '#b0b0b0'; mbg.fillRect(0, 0, 256, 256);
      mbg.strokeStyle = '#303030'; mbg.lineWidth = 3;
      for (var mby = 0; mby <= 256; mby += 32) { mbg.beginPath(); mbg.moveTo(0, mby); mbg.lineTo(256, mby); mbg.stroke(); }
      for (var mbx = 0; mbx <= 256; mbx += 32) { mbg.beginPath(); mbg.moveTo(mbx, 0); mbg.lineTo(mbx, 256); mbg.stroke(); }
      set.bumpMap = canvasTexture(mbc, null, true);
    }

    _unitTexCache[kind] = set;
    return set;
  }

  /* 生成带窗户灯光的楼宇贴图：返回 { map, emissive }
   *   map      —— 墙体基色 + 窗户（亮窗=灯光色，暗窗=深色）
   *   emissive —— 仅亮窗区域发光，用于自发光贴图，让近景楼宇夜晚亮灯 */
  function makeWindowTexture(baseColor) {
    var B = AC.building || {};
    var size = B.windowTexSize || 128;
    var cell = 8;
    var litChance = B.windowLitChance !== undefined ? B.windowLitChance : 0.42;
    var warmRatio = B.windowWarmRatio !== undefined ? B.windowWarmRatio : 0.70;

    var mc = makeCanvas(size, size * 2), mg = mc.getContext('2d');
    mg.fillStyle = baseColor; mg.fillRect(0, 0, size, size * 2);

    var ec = makeCanvas(size, size * 2), eg = ec.getContext('2d');
    eg.fillStyle = '#000000'; eg.fillRect(0, 0, size, size * 2);

    for (var y = 0; y < size * 2; y += cell) {
      for (var x = 0; x < size; x += cell) {
        var r = Math.random();
        if (r < litChance) {
          var warm = Math.random() < warmRatio;
          var col = warm ? hex(PAL.windowWarm) : hex(PAL.windowCold);
          var a = U.rand(0.35, 1);
          mg.fillStyle = col; mg.globalAlpha = a;
          mg.fillRect(x + 2, y + 2, 4, 4);
          mg.globalAlpha = 1;
          eg.fillStyle = col; eg.globalAlpha = a;
          eg.fillRect(x + 2, y + 2, 4, 4);
          eg.globalAlpha = 1;
        } else if (r < litChance + 0.1) {
          mg.fillStyle = '#0d1114'; mg.fillRect(x + 2, y + 2, 4, 4);
        }
      }
    }
    /* 纵向混凝土分隔带 */
    mg.fillStyle = 'rgba(0,0,0,0.25)';
    eg.fillStyle = 'rgba(0,0,0,1)';
    for (var by = cell; by < size * 2; by += cell * 4) {
      mg.fillRect(0, by, size, 1); eg.fillRect(0, by, size, 1);
    }
    return { map: canvasTexture(mc), emissive: canvasTexture(ec) };
  }

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

    /* 近/中景楼宇窗户贴图（带独立自发光通道） */
    tex.winNear = makeWindowTexture(hex(PAL.buildingB));

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
  /* 多层退台式楼宇：每层往上缩进，窗户贴图 + 自发光，顶部可破损。
   * 返回 { group, material } —— material 用于受击闪色。 */
  function makeBuilding(w, h, d, opts) {
    opts = opts || {};
    var B = AC.building || {};
    var tiers = opts.tiers !== undefined ? opts.tiers : U.randInt(B.tiersMin || 2, B.tiersMax || 4);
    var setback = B.setback !== undefined ? B.setback : 0.12;
    var group = new THREE.Group();
    var mat = opts.material || new THREE.MeshStandardMaterial({
      map: opts.winTex.map, emissiveMap: opts.winTex.emissive,
      emissive: 0xffffff, emissiveIntensity: opts.emissiveIntensity || 0.72,
      color: 0xffffff, metalness: 0.4, roughness: 0.72
    });
    /* 记录原始自发光，便于受击闪色后还原（窗户灯光恢复） */
    if (!mat.userData) mat.userData = {};
    mat.userData.baseEmissive = mat.emissive ? mat.emissive.clone() : new THREE.Color(0x000000);
    mat.userData.baseEmissiveIntensity = mat.emissiveIntensity;
    var baseY = 0, cw = w, cd = d;
    for (var t = 0; t < tiers; t++) {
      var th = (h / tiers) * U.rand(0.72, 1.25);
      var seg = new THREE.Mesh(new THREE.BoxGeometry(cw, th, cd), mat);
      seg.position.set(U.rand(-0.5, 0.5), baseY + th / 2, U.rand(-0.5, 0.5));
      seg.rotation.y = U.rand(-0.08, 0.08);
      seg.castShadow = true; seg.receiveShadow = true;
      group.add(seg);
      baseY += th;
      cw = Math.max(2, cw * (1 - setback));
      cd = Math.max(2, cd * (1 - setback));
    }
    /* 顶部破损：碎块 + 钢筋 */
    if (opts.damaged !== false) {
      for (var c = 0; c < 2; c++) {
        var chip = new THREE.Mesh(new THREE.BoxGeometry(U.rand(2, 5), U.rand(1.5, 4), U.rand(2, 5)), mat);
        chip.position.set(U.rand(-w * 0.3, w * 0.3), baseY + U.rand(0.3, 1.8), U.rand(-d * 0.3, d * 0.3));
        chip.rotation.set(U.rand(-0.4, 0.4), U.rand(0, 3), U.rand(-0.4, 0.4));
        chip.castShadow = true;
        group.add(chip);
      }
      var rebarCount = B.rebarCount || 3;
      for (var rb = 0; rb < rebarCount; rb++) {
        var rebar = Models._cyl(group, 0.1, 0.1, U.rand(2, 5), Models._mat(0x6a7076, { metalness: 1, roughness: 0.5 }),
          U.rand(-w * 0.3, w * 0.3), baseY + U.rand(0.5, 2), U.rand(-d * 0.3, d * 0.3), 5);
        rebar.rotation.set(U.rand(-0.3, 0.3), U.rand(0, 3), U.rand(-0.3, 0.3));
      }
    }
    return { group: group, material: mat, height: baseY };
  }

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
      map: tex.window, emissiveMap: tex.window, emissive: 0xffffff,
      emissiveIntensity: (AC.building && AC.building.emissiveIntensity) || 0.42,
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

    /* 楼顶探照灯：来回扫射，灯束用透明圆锥 */
    if (ART.atmosphere.searchLights) {
      city.towers.sort(function (a, b) { return b.y - a.y; });
      var slCount = (AC.light && AC.light.searchlightCount) || 3;
      var coneOpacity = (AC.light && AC.light.searchlightConeOpacity) || 0.07;
      var sweep = (AC.light && AC.light.searchlightSweep) || 0.9;
      for (var s = 0; s < slCount && s < city.towers.length; s++) {
        var t = city.towers[s];
        var g = new THREE.Group();
        g.position.set(t.x, t.y, t.z);
        var cone = new THREE.Mesh(
          new THREE.ConeGeometry(9, 130, 18, 1, true),
          new THREE.MeshBasicMaterial({ color: PAL.searchLight, transparent: true, opacity: coneOpacity, depthWrite: false, side: THREE.DoubleSide, fog: false })
        );
        cone.position.set(0, -65, 0); cone.rotation.x = Math.PI; // 向下
        g.add(cone);
        var lamp = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 6), Models._glowMat(PAL.searchLight, 2.5));
        g.add(lamp);
        city.group.add(g);
        city.searchlights.push({ group: g, cone: cone, speed: U.rand(0.25, 0.5) * (s % 2 ? -1 : 1), phase: U.rand(0, 6.28), sweep: sweep });
      }
    }
  }

  /* --- 中景多层破损楼宇（窗户自发光）+ 火花 + 上升浓烟 --- */
  function buildMidLayer(city, tex) {
    var spec = ART.city.mid;
    var nearEmissive = (AC.building && AC.building.nearEmissiveIntensity) || 0.72;
    city.emberSpots = [];
    for (var i = 0; i < spec.count; i++) {
      var h = U.rand(spec.minH, spec.maxH), w = U.rand(10, 20), d = U.rand(10, 20);
      var x = U.rand(-spec.xRange, spec.xRange), z = U.rand(spec.zStart, spec.zEnd);
      var bd = makeBuilding(w, h, d, {
        winTex: tex.winNear, emissiveIntensity: nearEmissive, damaged: true
      });
      bd.group.position.set(x, 0, z);
      city.group.add(bd.group);
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
      city.layers.mid.push({ type: 'building', x: x, z: z, h: bd.height, w: w, d: d, mesh: bd.group });
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

  /* --- 近景 / 战场两侧：多层可破坏废墟（窗户自发光） --- */
  function buildNearLayers(city, tex) {
    var nearEmissive = (AC.building && AC.building.nearEmissiveIntensity) || 0.72;
    var baseMat = new THREE.MeshStandardMaterial({
      map: tex.winNear.map, emissiveMap: tex.winNear.emissive,
      emissive: 0xffffff, emissiveIntensity: nearEmissive,
      color: 0xffffff, metalness: 0.4, roughness: 0.72
    });
    baseMat.userData.baseEmissive = baseMat.emissive.clone();
    baseMat.userData.baseEmissiveIntensity = baseMat.emissiveIntensity;
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
          var sgn = i % 2 ? 1 : -1;
          x = sgn * U.rand(spec.xRange, spec.xRange + 16);
          z = U.rand(spec.zStart, spec.zEnd);
        } else {
          x = U.rand(-spec.xRange, spec.xRange);
          z = U.rand(spec.zStart, spec.zEnd);
        }
        /* 每栋建筑独立材质，受击闪色时才不会互相影响 */
        var myMat = baseMat.clone();
        myMat.userData.baseEmissive = baseMat.userData.baseEmissive.clone();
        myMat.userData.baseEmissiveIntensity = baseMat.userData.baseEmissiveIntensity;
        var bd = makeBuilding(w, h, d, { material: myMat, damaged: true });
        var group = bd.group;
        group.position.set(x, 0, z);
        var maxR = Math.max(w, d) * 0.62;
        city.group.add(group);
        city.layers[entry.layer].push({ type: 'ruin', x: x, z: z, mesh: group, h: bd.height });
        if (spec.destructible) {
          var maxHp = CONFIG.combat.destructible.hp;
          var dObj = {
            object3D: group, position: new THREE.Vector3(x, 0, z), radius: maxR,
            hp: maxHp, maxHp: maxHp, alive: true, flashTimer: 0, material: myMat,
            mesh: group, layer: entry.layer, height: bd.height
          };
          group.traverse(function (o) { if (o.isMesh) { o.userData.destructible = dObj; } });
          city.destructibles.push(dObj);
        }
      }
    });
  }

  /* --- 地面：雨后路面更光滑（低粗糙度 + 略高金属度 → 反射灯光） --- */
  function buildGround(city, tex) {
    var F = AC.fog || {};
    var g = new THREE.Mesh(
      new THREE.PlaneGeometry(CONFIG.arena.width + 120, 260),
      new THREE.MeshStandardMaterial({
        map: tex.ground, color: 0xffffff,
        metalness: F.wetMetalness !== undefined ? F.wetMetalness : 0.35,
        roughness: F.wetRoughness !== undefined ? F.wetRoughness : 0.38
      })
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

  /* --- 地面体积雾 / 火星 / 雨夜 --- */
  function buildEffects(city, tex) {
    var F = AC.fog || {};
    if (ART.atmosphere.groundFog) {
      var layers = F.groundLayers || 6;
      var baseOpacity = F.groundOpacity || 0.5;
      var totalH = F.groundHeight || 12;
      for (var i = 0; i < layers; i++) {
        var f = new THREE.Mesh(
          new THREE.PlaneGeometry(460, 130),
          new THREE.MeshBasicMaterial({ map: tex.fog, color: PAL.fog, transparent: true, opacity: baseOpacity * (1 - i / layers), depthWrite: false, side: THREE.DoubleSide, fog: false })
        );
        f.rotation.x = -Math.PI / 2;
        f.position.set(0, 1.2 + (totalH / layers) * i, -70 - i * 16);
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
    /* --- 雨夜：雨幕粒子（带风向倾斜）+ 地面溅水 --- */
    if (ART.atmosphere.rain) {
      var R = AC.rain || {};
      var rc = R.count || 1800;
      var rpos = new Float32Array(rc * 3);
      var area = R.area || { x: 140, z: 120 };
      var hmin = R.heightMin || 2, hmax = R.heightMax || 46;
      for (var rp = 0; rp < rc; rp++) {
        rpos[rp * 3]     = U.rand(-area.x, area.x);
        rpos[rp * 3 + 1] = U.rand(hmin, hmax);
        rpos[rp * 3 + 2] = U.rand(-area.z * 0.5, area.z * 1.2);
      }
      var rgeo = new THREE.BufferGeometry();
      rgeo.setAttribute('position', new THREE.BufferAttribute(rpos, 3));
      var rmat = new THREE.PointsMaterial({
        color: 0xbfd8ff, size: R.streakLen || 2.2, transparent: true,
        opacity: R.opacity || 0.42, depthWrite: false, sizeAttenuation: true,
        map: tex.fog      // 复用软贴图，让雨丝略带横向拉伸感
      });
      var rainPts = new THREE.Points(rgeo, rmat);
      rainPts.frustumCulled = false;
      city.rain = rainPts;
      city.rainArea = area;
      city.rainHeightMax = hmax;
      city.group.add(rainPts);

      /* 地面溅水点（小雨滴落点闪光） */
      city.splashes = [];
      var sc = R.splashCount || 140;
      for (var sp = 0; sp < sc; sp++) {
        var s = new THREE.Mesh(
          new THREE.PlaneGeometry(0.8, 0.8),
          new THREE.MeshBasicMaterial({ color: 0x9fc0e0, transparent: true, opacity: 0, depthWrite: false, fog: false })
        );
        s.position.set(U.rand(-area.x, area.x), 0.05, U.rand(-area.z * 0.5, area.z * 1.2));
        s.rotation.x = -Math.PI / 2;
        s.userData = { life: 0, max: (R.splashLife || 0.35) * U.rand(0.6, 1.2) };
        city.group.add(s);
        city.splashes.push(s);
      }
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
      var sw = sl.sweep !== undefined ? sl.sweep : 0.9;
      sl.group.rotation.y = Math.sin(elapsed * sl.speed + sl.phase) * sw;
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
    var driftSpeed = (AC.fog && AC.fog.driftSpeed) || 0.06;
    for (i = 0; i < this.fogPlanes.length; i++) {
      var fp = this.fogPlanes[i];
      fp.position.x = Math.sin(elapsed * driftSpeed + i) * 12;
    }
    /* 雨夜：雨滴下落 + 风向漂移，落地后回到顶部 */
    if (this.rain) {
      var Rcfg = AC.rain || {};
      var fall = Rcfg.fallSpeed || 38;
      var wind = Rcfg.wind || -3.5;
      var rarr = this.rain.geometry.attributes.position.array;
      var rarea = this.rainArea || { x: 140, z: 120 };
      var rmax = this.rainHeightMax || 46;
      for (i = 0; i < rarr.length; i += 3) {
        rarr[i + 1] -= dt * fall;
        rarr[i] += dt * wind;
        if (rarr[i + 1] < 0.2) {
          rarr[i + 1] = rmax;
          rarr[i] = U.rand(-rarea.x, rarea.x);
          rarr[i + 2] = U.rand(-rarea.z * 0.5, rarea.z * 1.2);
        }
        if (rarr[i] < -rarea.x) rarr[i] = rarea.x;
        else if (rarr[i] > rarea.x) rarr[i] = -rarea.x;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
    /* 地面溅水点闪烁 */
    if (this.splashes) {
      for (i = 0; i < this.splashes.length; i++) {
        var sp = this.splashes[i];
        sp.userData.life += dt;
        if (sp.userData.life >= sp.userData.max) {
          sp.userData.life = 0;
          sp.position.x = U.rand(-rarea.x, rarea.x);
          sp.position.z = U.rand(-rarea.z * 0.5, rarea.z * 1.2);
        }
        var tt = sp.userData.life / sp.userData.max;
        sp.material.opacity = (1 - tt) * 0.5;
        var spsc = 0.4 + tt * 2.2;
        sp.scale.set(spsc, spsc, spsc);
      }
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
    /* 可破坏建筑受击闪红（结束后还原窗户灯光自发光） */
    var list = this.destructibles;
    for (i = 0; i < list.length; i++) {
      var d = list[i];
      if (d.damageFlash) { d.flashTimer = d.damageFlash; d.damageFlash = 0; }
      if (!d.material || !d.material.emissive) continue;
      if (d.flashTimer > 0) {
        d.flashTimer = Math.max(0, d.flashTimer - dt * 2.2);
        d.material.emissive.setHex(0xff3200);
        d.material.emissiveIntensity = Math.max(0.001, d.flashTimer * 0.85);
      } else if (d.material.userData && d.material.userData.baseEmissive) {
        d.material.emissive.copy(d.material.userData.baseEmissive);
        d.material.emissiveIntensity = d.material.userData.baseEmissiveIntensity;
      }
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
