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
      if (opts.normalScale !== undefined && m.normalScale) m.normalScale.set(opts.normalScale, opts.normalScale);
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
    /* 椭球肌肉块：怪兽躯干/四肢用它打破方盒轮廓，圆润的高光更接近生物 */
    _ellipsoid: function (parent, rx, ry, rz, mat, x, y, z, seg) {
      var m = new THREE.Mesh(new THREE.SphereGeometry(1, seg || 14, Math.max(8, Math.floor((seg || 14) * 0.7))), mat);
      m.scale.set(rx, ry, rz);
      m.position.set(x || 0, y || 0, z || 0);
      m.castShadow = true; m.receiveShadow = true;
      parent.add(m);
      return m;
    },
    /* 胶囊肢体：圆柱 + 半球端盖，用来做连续的上臂/大腿，避免一串椭球拼成“糖葫芦” */
    _capsule: function (parent, radius, length, mat, x, y, z, seg) {
      var m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.001, length), 6, seg || 14), mat);
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

    /* 梯形装甲板：上/下宽度独立，形成真正的斜切甲片轮廓。
       opt = { bevel, rotX, rotY, rotZ }，厚度沿 Z 轴挤出。 */
    _trap: function (parent, topW, botW, h, d, mat, x, y, z, opt) {
      opt = opt || {};
      var hwT = topW / 2, hwB = botW / 2;
      var shape = new THREE.Shape();
      shape.moveTo(-hwB, -h / 2);
      shape.lineTo(hwB, -h / 2);
      shape.lineTo(hwT, h / 2);
      shape.lineTo(-hwT, h / 2);
      shape.closePath();
      var b = opt.bevel !== undefined ? opt.bevel : Math.min(topW, botW, h, d) * 0.07;
      b = Math.max(0, Math.min(b, h * 0.18, d * 0.18));
      var body = Math.max(0.001, d - b * 2);
      var geo = new THREE.ExtrudeGeometry(shape, {
        depth: body, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b,
        bevelSegments: 2, curveSegments: 1
      });
      geo.translate(0, 0, -body / 2);
      var m = new THREE.Mesh(geo, mat);
      m.position.set(x || 0, y || 0, z || 0);
      if (opt.rotX) m.rotation.x = opt.rotX;
      if (opt.rotY) m.rotation.y = opt.rotY;
      if (opt.rotZ) m.rotation.z = opt.rotZ;
      m.castShadow = true; m.receiveShadow = true;
      parent.add(m);
      return m;
    },

    /* 任意多边形薄板：pts = [[x,y], ...]，沿 Z 挤出。
       用于骨冠、背鳍、刀刃等需要尖角的生物/硬表面轮廓。 */
    _poly: function (parent, pts, d, mat, x, y, z, opt) {
      opt = opt || {};
      var shape = new THREE.Shape();
      shape.moveTo(pts[0][0], pts[0][1]);
      for (var i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
      shape.closePath();
      var b = opt.bevel || 0;
      var body = Math.max(0.001, d - b * 2);
      var geo = new THREE.ExtrudeGeometry(shape, {
        depth: body, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b,
        bevelSegments: 2, curveSegments: 2
      });
      geo.translate(0, 0, -body / 2);
      var m = new THREE.Mesh(geo, mat);
      m.position.set(x || 0, y || 0, z || 0);
      if (opt.rotX) m.rotation.x = opt.rotX;
      if (opt.rotY) m.rotation.y = opt.rotY;
      if (opt.rotZ) m.rotation.z = opt.rotZ;
      m.castShadow = true; m.receiveShadow = true;
      parent.add(m);
      return m;
    },

    /* 机身编号/贴花：白灰喷漆字，只贴在朝向镜头那一面 */
    _decalTexture: function (text) {
      Models._decalCache = Models._decalCache || {};
      if (Models._decalCache[text]) return Models._decalCache[text];
      var c = document.createElement('canvas');
      c.width = 256; c.height = 96;
      var g = c.getContext('2d');
      g.clearRect(0, 0, 256, 96);
      g.fillStyle = 'rgba(226,236,240,0.92)';
      g.font = 'bold 64px "Arial Black", Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, 128, 46);
      g.fillStyle = 'rgba(226,236,240,0.55)';
      g.fillRect(44, 82, 168, 5);
      var t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      Models._decalCache[text] = t;
      return t;
    },
    /* 黄黑警示条：贴在脚背/小腿，给大色块一个工业细节 */
    _stripeTexture: function () {
      if (Models._stripeTex) return Models._stripeTex;
      var c = document.createElement('canvas');
      c.width = 128; c.height = 64;
      var g = c.getContext('2d');
      g.fillStyle = '#1a1c1e'; g.fillRect(0, 0, 128, 64);
      g.fillStyle = '#d9a93a';
      for (var i = -2; i < 8; i++) {
        g.beginPath();
        g.moveTo(i * 24, 64); g.lineTo(i * 24 + 24, 0);
        g.lineTo(i * 24 + 36, 0); g.lineTo(i * 24 + 12, 64);
        g.closePath(); g.fill();
      }
      var t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = THREE.RepeatWrapping;
      t.repeat.set(2, 1);
      Models._stripeTex = t;
      return t;
    },

    /* 软接触阴影贴图：径向渐变，贴在单位脚下，弥补远景实时阴影不足 */
    _shadowTexture: function () {
      if (Models._shadowTex) return Models._shadowTex;
      var c = document.createElement('canvas');
      c.width = 256; c.height = 128;
      var g = c.getContext('2d');
      var grad = g.createRadialGradient(128, 64, 4, 128, 64, 120);
      grad.addColorStop(0, 'rgba(0,0,0,0.9)');
      grad.addColorStop(0.42, 'rgba(0,0,0,0.45)');
      grad.addColorStop(0.72, 'rgba(0,0,0,0.16)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 128);
      var t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      Models._shadowTex = t;
      return t;
    },

    /* ================================================================== */
    /* 玩家机甲（环太平洋重型机甲风格）                                     */
    /* ================================================================== */
    buildMecha: function (def) {
      var H = def.height * (def.scale || 1);
      var style = def.style;
      var heavy = style === 'heavy';
      var w = heavy ? 1.14 : 1.0;                 // 体格宽度系数
      var tex = unitTextures('mecha');
      var MDEF = (AC.material || {});
      var mm = MDEF.mecha || { metalness: 0.62, roughness: 0.5, envMapIntensity: 1.0 };
      var ma = MDEF.accent || { metalness: 0.72, roughness: 0.42, envMapIntensity: 1.0 };
      var md = MDEF.dark || { metalness: 0.5, roughness: 0.66, envMapIntensity: 0.8 };
      var armor = Models._mat(def.armor, { metalness: mm.metalness, roughness: mm.roughness, maps: tex, normalScale: 0.9, envMapIntensity: mm.envMapIntensity });
      var accent = Models._mat(def.accent, { metalness: ma.metalness, roughness: ma.roughness, maps: tex, normalScale: 0.7, envMapIntensity: ma.envMapIntensity });
      var dark = Models._mat(0x10151a, { metalness: md.metalness, roughness: md.roughness, envMapIntensity: md.envMapIntensity });
      var steel = Models._mat(0x8d979e, { metalness: 0.9, roughness: 0.28, envMapIntensity: 1.35 });
      var glow = Models._glowMat(def.glow, (AC.glow && AC.glow.mechaCore) || 1.15);
      var glowWarm = Models._glowMat(0xffd9a0, (AC.glow && AC.glow.mechaWarm) || 0.85);
      var visor = Models._glowMat(0x7fe6ff, 1.05);   // 冷蓝双眼：降低过曝，保留 Jaeger 面罩的蓝光
      var bladeGlow = Models._glowMat(0x7fe6ff, 0.45);
      var line = Models._mat(0x1a2026, { metalness: 0.45, roughness: 0.78 });   // 面板缝/凹线
      var stripeMat = Models._mat(0xffffff, { metalness: 0.3, roughness: 0.72, maps: { map: Models._stripeTexture() } });
      var glowMaterials = [glow, glowWarm, visor, bladeGlow];

      var root = new THREE.Group();
      root.name = def.id;
      root.scale.setScalar(1.08);                 // 撑满 9.5m 判定高度，体量不再偏小
      var parts = {};

      /* 脚下软接触阴影：湿地面上明确“落地”，远景也不悬浮 */
      var shadowTex = Models._shadowTexture();
      if (shadowTex) {
        var shadow = new THREE.Mesh(
          new THREE.PlaneGeometry(H * 0.88, H * 0.55),
          new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.7, depthWrite: false })
        );
        shadow.name = 'contactShadow';
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.y = 0.035;
        shadow.renderOrder = 2;
        root.add(shadow);
      }

      /* --- 腿部：梯形装甲 + 外露关节/液压，避免方形积木腿 --- */
      var legLen = H * 0.48;
      var thigh = legLen * 0.50, shin = legLen * 0.44;
      var parts4 = parts;
      ['L', 'R'].forEach(function (side) {
        var sgn = (side === 'L' ? -1 : 1);
        var leg = Models._part('leg' + side, root, sgn * H * 0.118 * w, H * 0.47, 0);
        /* 髋球与轴 */
        Models._cyl(leg, H * 0.056 * w, H * 0.05 * w, H * 0.06, dark, 0, 0, 0, 14).rotation.z = Math.PI / 2;
        Models._cyl(leg, H * 0.012, H * 0.012, H * 0.075, steel, sgn * H * 0.052 * w, 0, 0, 8).rotation.z = Math.PI / 2;
        /* 大腿内构 + 主甲（上宽下窄） */
        Models._cyl(leg, H * 0.042 * w, H * 0.036 * w, thigh * 0.92, dark, 0, -thigh * 0.5, 0, 12);
        Models._trap(leg, H * 0.148 * w, H * 0.112 * w, thigh * 0.92, H * 0.155 * w, armor, 0, -thigh * 0.5, 0, { bevel: H * 0.009 });
        /* 正面红色甲片：带一点前倾，侧视有层次 */
        Models._trap(leg, H * 0.092 * w, H * 0.072 * w, thigh * 0.60, H * 0.034 * w, accent, 0, -thigh * 0.38, H * 0.087 * w, { bevel: H * 0.004, rotX: -0.05 });
        /* 外侧甲片 + 内侧小甲 */
        Models._trap(leg, H * 0.052 * w, H * 0.040 * w, thigh * 0.58, H * 0.09 * w, armor, sgn * H * 0.060 * w, -thigh * 0.54, 0, { bevel: H * 0.004 });
        Models._bevel(leg, H * 0.032 * w, thigh * 0.34, H * 0.055 * w, accent, -sgn * H * 0.052 * w, -thigh * 0.7, -H * 0.02, 0, H * 0.003);
        /* 后侧双液压 */
        for (var tp = -1; tp <= 1; tp += 2) {
          Models._cyl(leg, H * 0.009, H * 0.009, thigh * 0.66, steel, tp * H * 0.03 * w, -thigh * 0.48, -H * 0.062 * w, 6);
          Models._cyl(leg, H * 0.015, H * 0.015, H * 0.06, dark, tp * H * 0.03 * w, -thigh * 0.78, -H * 0.062 * w, 8);
        }
        /* 面板缝 */
        Models._box(leg, H * 0.005, thigh * 0.46, H * 0.007, line, sgn * H * 0.046 * w, -thigh * 0.52, H * 0.079 * w);
        Models._box(leg, H * 0.082 * w, H * 0.006, H * 0.007, line, 0, -thigh * 0.22, H * 0.08 * w);

        /* --- 膝关节与小腿 --- */
        var knee = Models._part('shin' + side, leg, 0, -thigh, 0);
        Models._cyl(knee, H * 0.054 * w, H * 0.054 * w, H * 0.085, dark, 0, 0, 0, 16).rotation.z = Math.PI / 2;
        Models._cyl(knee, H * 0.026, H * 0.026, H * 0.095, steel, sgn * H * 0.048 * w, 0, 0, 10).rotation.z = Math.PI / 2;
        /* 小腿主甲 */
        Models._trap(knee, H * 0.125 * w, H * 0.088 * w, shin * 0.94, H * 0.14 * w, armor, 0, -shin * 0.5, 0, { bevel: H * 0.008 });
        /* 膝甲：向前上方翘起 */
        Models._trap(knee, H * 0.092 * w, H * 0.112 * w, H * 0.082, H * 0.052, accent, 0, H * 0.004, H * 0.082 * w, { bevel: H * 0.005, rotX: 0.16 });
        /* 迎面甲 */
        Models._trap(knee, H * 0.086 * w, H * 0.066 * w, shin * 0.54, H * 0.032 * w, accent, 0, -shin * 0.3, H * 0.077 * w, { bevel: H * 0.004 });
        /* 外侧鳍片 */
        Models._trap(knee, H * 0.042 * w, H * 0.028 * w, shin * 0.42, H * 0.07 * w, accent, sgn * H * 0.054 * w, -shin * 0.5, -H * 0.012, { bevel: H * 0.003, rotZ: sgn * 0.1 });
        /* 后侧液压 + 膝灯 */
        for (var lp = -1; lp <= 1; lp += 2) {
          Models._cyl(knee, H * 0.009, H * 0.009, shin * 0.72, steel, lp * H * 0.026 * w, -shin * 0.45, -H * 0.085 * w, 6);
        }
        Models._box(knee, H * 0.004, shin * 0.38, H * 0.006, line, -sgn * H * 0.04 * w, -shin * 0.46, H * 0.073 * w);
        Models._box(knee, H * 0.032, H * 0.012, H * 0.012, glow, 0, -H * 0.004, H * 0.108 * w);

        /* --- 脚：宽靴形，前脚掌分趾 --- */
        var foot = Models._part('foot' + side, knee, 0, -shin, 0);
        Models._cyl(foot, H * 0.036, H * 0.036, H * 0.065, dark, 0, 0, 0, 14).rotation.z = Math.PI / 2;
        Models._trap(foot, H * 0.112 * w, H * 0.168 * w, H * 0.062, H * 0.235 * w, armor, 0, H * 0.032, H * 0.048, { bevel: H * 0.006 });
        Models._trap(foot, H * 0.088 * w, H * 0.12 * w, H * 0.036, H * 0.10 * w, accent, 0, H * 0.073, H * 0.024, { bevel: H * 0.004 });
        Models._box(foot, H * 0.10 * w, H * 0.052, H * 0.055, dark, 0, H * 0.03, -H * 0.078);
        for (var tt = -1; tt <= 1; tt++) {
          Models._box(foot, H * 0.042 * w, H * 0.032, H * 0.075, dark, tt * H * 0.05 * w, H * 0.022, H * 0.155 * w);
          Models._box(foot, H * 0.036 * w, H * 0.014, H * 0.05, steel, tt * H * 0.05 * w, H * 0.041, H * 0.172 * w);
        }
        Models._box(foot, H * 0.072 * w, H * 0.012, H * 0.02, glowWarm, 0, H * 0.064, H * 0.105 * w);
        Models._box(foot, H * 0.06 * w, H * 0.02, H * 0.006, stripeMat, 0, H * 0.05, -H * 0.108);
      });

      /* --- 髋 / 骨盆：窄腰 + 外翻裙甲，和宽胸形成倒三角 --- */
      var hip = Models._part('hip', root, 0, H * 0.47, 0);
      Models._cyl(hip, H * 0.072 * w, H * 0.08 * w, H * 0.075, dark, 0, H * 0.022, 0, 14);
      Models._trap(hip, H * 0.192 * w, H * 0.142 * w, H * 0.088, H * 0.145 * w, armor, 0, -H * 0.012, 0, { bevel: H * 0.007 });
      Models._trap(hip, H * 0.072 * w, H * 0.052 * w, H * 0.10, H * 0.05, accent, 0, -H * 0.042, H * 0.062 * w, { bevel: H * 0.004 });
      for (var k = -1; k <= 1; k += 2) {
        Models._trap(hip, H * 0.055 * w, H * 0.082 * w, H * 0.155, H * 0.06, accent,
          k * H * 0.112 * w, -H * 0.05, H * 0.012, { bevel: H * 0.004, rotZ: k * 0.22 });
        Models._box(hip, H * 0.018, H * 0.042, H * 0.04, glow, k * H * 0.152 * w, -H * 0.05, H * 0.032);
        Models._bevel(hip, H * 0.04 * w, H * 0.075, H * 0.03, dark, k * H * 0.075 * w, -H * 0.025, -H * 0.062);
      }
      Models._trap(hip, H * 0.125 * w, H * 0.095 * w, H * 0.10, H * 0.05, dark, 0, -H * 0.036, -H * 0.082 * w, { rotX: -0.16 });
      Models._box(hip, H * 0.15 * w, H * 0.012, H * 0.02, glow, 0, -H * 0.076, H * 0.058 * w);

      /* --- 躯干：倒三角胸腔 + 分层腹甲 + 前凸反应堆 --- */
      var body = Models._part('body', root, 0, H * 0.55, 0);
      parts4.torso = body;
      /* 腰腹：裸露机械 + 三段腹甲 */
      Models._cyl(body, H * 0.062 * w, H * 0.078 * w, H * 0.09, dark, 0, -H * 0.02, 0, 14);
      for (var ab = 0; ab < 3; ab++) {
        Models._box(body, H * (0.135 + ab * 0.016) * w, H * 0.024, H * 0.055, ab === 1 ? accent : armor,
          0, -H * 0.004 + ab * H * 0.026, H * 0.058 * w);
      }
      Models._box(body, H * 0.145 * w, H * 0.012, H * 0.026, glowWarm, 0, H * 0.006, H * 0.088 * w);
      /* 胸腔：上宽下窄的倒三角 */
      Models._trap(body, H * 0.315 * w, H * 0.195 * w, H * 0.20, H * 0.185 * w, accent, 0, H * 0.14, 0, { bevel: H * 0.011 });
      /* 锁骨/肩桥：压窄并改深色内构，避免一条横贯胸口的灰色“货架” */
      Models._trap(body, H * 0.30 * w, H * 0.195 * w, H * 0.05, H * 0.17 * w, dark, 0, H * 0.215, 0, { bevel: H * 0.006 });
      /* 左右胸甲 + 进气格栅 + 侧肋：主体用红色，灰色只做窄镶边 */
      for (var cp = -1; cp <= 1; cp += 2) {
        Models._trap(body, H * 0.098 * w, H * 0.080 * w, H * 0.112, H * 0.035, accent,
          cp * H * 0.083 * w, H * 0.155, H * 0.098 * w, { bevel: H * 0.004, rotZ: cp * -0.1 });
        Models._trap(body, H * 0.048 * w, H * 0.036 * w, H * 0.072, H * 0.018, armor,
          cp * H * 0.075 * w, H * 0.166, H * 0.115 * w, { bevel: H * 0.002, rotZ: cp * -0.08 });
        for (var vs = 0; vs < 3; vs++) {
          Models._box(body, H * 0.045 * w, H * 0.007, H * 0.012, glow,
            cp * H * 0.083 * w, H * 0.112 + vs * H * 0.018, H * 0.12 * w);
        }
        Models._trap(body, H * 0.058 * w, H * 0.042 * w, H * 0.15, H * 0.065, accent,
          cp * H * 0.152 * w, H * 0.145, -H * 0.01, { bevel: H * 0.004, rotZ: cp * 0.1 });
        Models._box(body, H * 0.008, H * 0.11, H * 0.008, line, cp * H * 0.162 * w, H * 0.14, H * 0.045 * w);
        /* 肩窝 */
        Models._cyl(body, H * 0.06 * w, H * 0.06 * w, H * 0.075, dark, cp * H * 0.16 * w, H * 0.192, 0, 14).rotation.z = Math.PI / 2;
      }
      /* 中胸：深色反应堆基座 + 装甲圈 */
      Models._trap(body, H * 0.075 * w, H * 0.055 * w, H * 0.09, H * 0.028, dark, 0, H * 0.048, H * 0.093 * w, { bevel: H * 0.003 });
      var core = Models._part('reactor', body, 0, H * 0.145, H * 0.108 * w);
      Models._cyl(core, H * 0.096 * w, H * 0.108 * w, H * 0.032, dark, 0, 0, 0, 10).rotation.x = Math.PI / 2;
      Models._cyl(core, H * 0.078 * w, H * 0.086 * w, H * 0.022, steel, 0, 0, H * 0.012, 24).rotation.x = Math.PI / 2;
      Models._cyl(core, H * 0.058 * w, H * 0.064 * w, H * 0.02, accent, 0, 0, H * 0.024, 20).rotation.x = Math.PI / 2;
      Models._cyl(core, H * 0.036 * w, H * 0.036 * w, H * 0.016, Models._glowMat(0x77dcff, 0.75), 0, 0, H * 0.035, 20).rotation.x = Math.PI / 2;
      Models._cyl(core, H * 0.015 * w, H * 0.015 * w, H * 0.012, Models._glowMat(0xcaf5ff, 0.55), 0, 0, H * 0.043, 14).rotation.x = Math.PI / 2;
      /* 反应堆辐条：把白色光球拆成可读的机械环 */
      for (var rs = 0; rs < 6; rs++) {
        var ra = rs / 6 * Math.PI * 2 + 0.26;
        var spoke = Models._box(core, H * 0.010, H * 0.044, H * 0.01, steel,
          Math.cos(ra) * H * 0.046, Math.sin(ra) * H * 0.046, H * 0.03);
        spoke.rotation.z = ra - Math.PI / 2;
      }
      /* 背部动力包 + 双排散热口 */
      Models._box(body, H * 0.245 * w, H * 0.19, H * 0.09, dark, 0, H * 0.14, -H * 0.115 * w);
      Models._trap(body, H * 0.26 * w, H * 0.22 * w, H * 0.045, H * 0.10, accent, 0, H * 0.238, -H * 0.10 * w, { bevel: H * 0.004 });
      for (var v = -1; v <= 1; v += 2) {
        Models._cyl(body, H * 0.028, H * 0.032, H * 0.075, steel, v * H * 0.08 * w, H * 0.265, -H * 0.11 * w, 10);
        Models._box(body, H * 0.03, H * 0.13, H * 0.02, glow, v * H * 0.065 * w, H * 0.145, -H * 0.162 * w);
        Models._box(body, H * 0.065 * w, H * 0.03, H * 0.04, accent, v * H * 0.10 * w, H * 0.09, -H * 0.14 * w);
      }
      Models._trap(body, H * 0.02, H * 0.05, H * 0.16, H * 0.05, dark, 0, H * 0.25, -H * 0.15 * w);

      /* --- 头部（Conn-Pod 驾驶舱：宽面罩 + 天线/脊冠）--- */
      Models._cyl(body, H * 0.046, H * 0.056, H * 0.085, dark, 0, H * 0.285, 0, 10);
      Models._trap(body, H * 0.135 * w, H * 0.115 * w, H * 0.036, H * 0.115 * w, armor, 0, H * 0.316, 0, { bevel: H * 0.003 });
      var head = Models._part('head', body, 0, H * 0.35, H * 0.006);
      if (heavy) {
        /* 重击型：宽扁驾驶舱，单条宽面罩 */
        Models._trap(head, H * 0.12, H * 0.148, H * 0.095, H * 0.155, armor, 0, 0, 0, { bevel: H * 0.006 });
        Models._trap(head, H * 0.148, H * 0.13, H * 0.04, H * 0.14, accent, 0, H * 0.062, 0, { bevel: H * 0.004 });
        /* 双眼式面罩：中间留深色分隔，读作 Jaeger 的双眼而不是一条白色灯带 */
        for (var he = -1; he <= 1; he += 2) {
          var hEye = Models._box(head, H * 0.050, H * 0.019, H * 0.018, visor, he * H * 0.036, H * 0.004, H * 0.080);
          hEye.rotation.z = -he * 0.12;
        }
        Models._box(head, H * 0.012, H * 0.018, H * 0.022, dark, 0, H * 0.004, H * 0.083);
        Models._box(head, H * 0.142, H * 0.014, H * 0.03, steel, 0, H * 0.028, H * 0.077);
        Models._box(head, H * 0.052, H * 0.026, H * 0.04, dark, 0, -H * 0.044, H * 0.052);
        for (var hc = -1; hc <= 1; hc += 2) {
          Models._box(head, H * 0.028, H * 0.062, H * 0.03, dark, hc * H * 0.062, H * 0.042, 0);
          Models._box(head, H * 0.012, H * 0.035, H * 0.012, glowWarm, hc * H * 0.05, 0.0, H * 0.076);
          Models._cyl(head, H * 0.018, H * 0.018, H * 0.03, steel, hc * H * 0.04, H * 0.09, -H * 0.01, 8);
        }
      } else {
        /* 均衡型：流线驾驶舱 + V 型脊冠 + 双天线 */
        Models._trap(head, H * 0.105, H * 0.132, H * 0.098, H * 0.14, armor, 0, 0, 0, { bevel: H * 0.006 });
        Models._trap(head, H * 0.092, H * 0.12, H * 0.045, H * 0.135, accent, 0, H * 0.06, -0.002, { bevel: H * 0.004 });
        for (var me = -1; me <= 1; me += 2) {
          var mEye = Models._box(head, H * 0.048, H * 0.020, H * 0.018, visor, me * H * 0.032, H * 0.003, H * 0.076);
          mEye.rotation.z = -me * 0.14;
        }
        Models._box(head, H * 0.010, H * 0.018, H * 0.022, dark, 0, H * 0.003, H * 0.079);
        Models._box(head, H * 0.118, H * 0.012, H * 0.02, steel, 0, H * 0.023, H * 0.073);
        Models._box(head, H * 0.10, H * 0.012, H * 0.023, dark, 0, -H * 0.026, H * 0.074);
        Models._box(head, H * 0.042, H * 0.045, H * 0.025, dark, 0, -H * 0.048, H * 0.06);
        Models._box(head, H * 0.012, H * 0.072, H * 0.014, accent, 0, H * 0.105, -H * 0.006);
        Models._box(head, H * 0.009, H * 0.04, H * 0.01, dark, -H * 0.042, H * 0.07, 0);
        Models._box(head, H * 0.009, H * 0.04, H * 0.01, dark, H * 0.042, H * 0.07, 0);
        Models._box(head, H * 0.01, H * 0.026, H * 0.014, glowWarm, -H * 0.05, 0.004, H * 0.068);
        Models._box(head, H * 0.01, H * 0.026, H * 0.014, glowWarm, H * 0.05, 0.004, H * 0.068);
      }

      /* --- 双臂 + 武器：宽肩重甲轮廓 --- */
      ['L', 'R'].forEach(function (side) {
        var sgn = (side === 'L' ? -1 : 1);
        var shoulder = Models._part('shoulder' + side, body, sgn * H * 0.172 * w, H * 0.195, 0);
        var ball = Models._cyl(shoulder, H * 0.055 * w, H * 0.055 * w, H * 0.085, dark, 0, 0, 0, 14);
        ball.rotation.z = Math.PI / 2;
        /* 主肩甲：外沿下压、上缘高过肩轴 */
        Models._trap(shoulder, (heavy ? 0.155 : 0.125) * H, (heavy ? 0.175 : 0.15) * H, H * 0.115, H * 0.175 * w, accent,
          sgn * H * 0.018, H * 0.028, 0, { bevel: H * 0.008, rotZ: sgn * -0.12 });
        /* 顶层甲：更窄、更斜，读作机械肩盖而不是平置货架 */
        Models._trap(shoulder, (heavy ? 0.085 : 0.072) * H, (heavy ? 0.12 : 0.10) * H, H * 0.05, H * 0.135 * w, steel,
          sgn * H * 0.002, H * 0.078, -H * 0.004, { bevel: H * 0.004, rotZ: sgn * -0.30 });
        /* 外翻副甲 */
        Models._trap(shoulder, (heavy ? 0.07 : 0.055) * H, (heavy ? 0.05 : 0.04) * H, H * 0.14, H * 0.15 * w, accent,
          sgn * H * 0.10 * w, -H * 0.015, 0, { bevel: H * 0.004, rotZ: sgn * 0.22 });
        /* 正面小甲 + 灯 + 编号 */
        Models._trap(shoulder, H * 0.075, H * 0.06, H * 0.062, H * 0.02, armor, sgn * H * 0.012, H * 0.004, H * 0.094 * w, { bevel: H * 0.002 });
        Models._box(shoulder, H * 0.055, H * 0.01, H * 0.01, glow, sgn * H * 0.012, -H * 0.03, H * 0.1 * w);
        var dm = new THREE.MeshBasicMaterial({
          map: Models._decalTexture(side === 'L' ? (heavy ? 'CH-07' : 'GX-05') : '05'),
          transparent: true, depthWrite: false, opacity: 0.72
        });
        var decal = new THREE.Mesh(new THREE.PlaneGeometry(H * 0.07, H * 0.026), dm);
        decal.position.set(sgn * H * 0.012, H * 0.008, H * 0.105 * w);
        decal.renderOrder = 2;
        shoulder.add(decal);
        Models._box(shoulder, H * 0.008, H * 0.06, H * 0.02, line, sgn * H * 0.06, H * 0.02, H * 0.085 * w);

        var arm = Models._part('arm' + side, shoulder, 0, -H * 0.06, 0);
        /* 上臂：深色内构 + 红色外甲 */
        Models._cyl(arm, H * 0.05 * w, H * 0.042 * w, H * 0.20, dark, 0, -H * 0.1, 0, 12);
        Models._trap(arm, H * 0.078, H * 0.065, H * 0.15, H * 0.09, accent, 0, -H * 0.095, 0, { bevel: H * 0.004 });
        Models._trap(arm, H * 0.056, H * 0.048, H * 0.09, H * 0.03, armor, 0, -H * 0.145, H * 0.055, { bevel: H * 0.002 });
        Models._cyl(arm, H * 0.022, H * 0.022, H * 0.05, steel, 0, -H * 0.2, 0, 10);
        Models._cyl(arm, H * 0.008, H * 0.008, H * 0.14, steel, sgn * H * 0.05, -H * 0.1, -H * 0.02, 6);

        var fore = Models._part('forearm' + side, arm, 0, -H * 0.205, 0);
        Models._cyl(fore, H * 0.05, H * 0.05, H * 0.07, dark, 0, H * 0.005, 0, 14).rotation.z = Math.PI / 2;
        /* 前臂：向手腕外扩的重装护手 */
        Models._cyl(fore, H * 0.042, H * 0.036, H * 0.19, dark, 0, -H * 0.09, 0, 12);
        Models._trap(fore, H * 0.118 * w, H * 0.148 * w, H * 0.185, H * 0.145 * w, armor, 0, -H * 0.09, 0, { bevel: H * 0.007 });
        Models._trap(fore, H * 0.092 * w, H * 0.112 * w, H * 0.12, H * 0.04, accent, 0, -H * 0.085, H * 0.078 * w, { bevel: H * 0.004 });
        Models._box(fore, H * 0.012, H * 0.10, H * 0.02, glow, sgn * H * 0.06 * w, -H * 0.09, H * 0.05);
        Models._box(fore, H * 0.085 * w, H * 0.018, H * 0.045, steel, 0, 0, H * 0.045);
        Models._cyl(fore, H * 0.007, H * 0.007, H * 0.14, steel, -sgn * H * 0.055 * w, -H * 0.10, -H * 0.05, 6);
        Models._box(fore, H * 0.004, H * 0.1, H * 0.006, line, sgn * H * 0.045 * w, -H * 0.09, H * 0.078 * w);

        var fist = Models._part('fist' + side, fore, 0, -H * 0.19, 0);
        Models._bevel(fist, H * 0.11 * w, H * 0.085, H * 0.115 * w, dark, 0, -H * 0.02, 0);
        Models._trap(fist, H * 0.10 * w, H * 0.095 * w, H * 0.04, H * 0.12 * w, accent, 0, -H * 0.04, 0, { bevel: H * 0.004 });
        for (var ff = -1; ff <= 1; ff++) {
          Models._box(fist, H * 0.028 * w, H * 0.03, H * 0.045, steel, ff * H * 0.032 * w, -H * 0.065, H * 0.04);
        }
        /* 武器：右臂主武器；均衡型双腕同款链锯，近侧手臂也能看到刀锋 */
        if (side === 'R' || (side === 'L' && def.weapon.type === 'blade')) {
          if (def.weapon.type === 'blade') {
            /* 等离子链锯：腕部圆盘 + 有厚度的锥形刀身 + 外缘锯齿光，
               不再用一根通体发光的方条，近看能读出“机械刀”而不是“光剑” */
            var hub = Models._cyl(fore, H * 0.06, H * 0.06, H * 0.025, dark, 0, -H * 0.135, H * 0.055, 18);
            hub.rotation.x = Math.PI / 2;
            var disc = new THREE.Mesh(new THREE.CylinderGeometry(H * 0.078, H * 0.078, H * 0.014, 20), steel);
            disc.position.set(0, -H * 0.135, H * 0.06); disc.rotation.x = Math.PI / 2; disc.castShadow = true;
            fore.add(disc);
            var sgnB = (side === 'R' ? 1 : -1);
            var bladeRig = Models._part('bladeRig' + side, fore, 0, 0, 0);
            bladeRig.rotation.y = -0.45;   // 刀面转向镜头约 45°，避免只看到一条刀刃侧棱
            var bladeLen = H * 0.40;
            var bw = H * 0.054;
            var bladeShape = new THREE.Shape();
            bladeShape.moveTo(-bw * 0.46, 0);
            bladeShape.lineTo(bw * 0.46, 0);
            bladeShape.quadraticCurveTo(bw * 0.60, -bladeLen * 0.18, bw * 0.46, -bladeLen * 0.55);
            bladeShape.quadraticCurveTo(bw * 0.28, -bladeLen * 0.82, bw * 0.05, -bladeLen);
            bladeShape.lineTo(-bw * 0.32, -bladeLen * 0.95);
            bladeShape.quadraticCurveTo(-bw * 0.55, -bladeLen * 0.54, -bw * 0.50, -bladeLen * 0.18);
            bladeShape.closePath();
            var bladeGeo = new THREE.ExtrudeGeometry(bladeShape, {
              depth: H * 0.016, bevelEnabled: true,
              bevelThickness: H * 0.004, bevelSize: H * 0.003, bevelSegments: 2, curveSegments: 4
            });
            var bladeBody = new THREE.Mesh(bladeGeo, steel);
            bladeBody.position.set(0, -H * 0.045, H * 0.092);
            bladeBody.castShadow = true; bladeBody.receiveShadow = true;
            bladeRig.add(bladeBody);
            /* 刀脊与血槽：用深色窄条把刀身分成“厚背 + 薄刃” */
            Models._box(bladeRig, H * 0.014, bladeLen * 0.94, H * 0.012, dark, -sgnB * bw * 0.26, -H * 0.045 - bladeLen * 0.48, H * 0.112);
            Models._box(bladeRig, H * 0.009, bladeLen * 0.54, H * 0.008, accent, 0, -H * 0.045 - bladeLen * 0.34, H * 0.114);
            /* 外缘锯齿用实体钢齿，只在刃口留一条极细的能量线，
               避免整把刀变成一根发光棒 */
            for (var s = 0; s < 8; s++) {
              var tY = -H * 0.045 - bladeLen * (0.10 + s * 0.105);
              var tX = sgnB * (bw * (0.44 - s * 0.008) + H * 0.006);
              var tooth = Models._box(bladeRig, H * 0.020, H * 0.026, H * 0.018, steel, tX, tY, H * 0.112);
              tooth.rotation.z = sgnB * (0.5 + s * 0.015);
            }
            Models._box(bladeRig, H * 0.0035, bladeLen * 0.52, H * 0.004, bladeGlow,
              sgnB * bw * 0.47, -H * 0.045 - bladeLen * 0.32, H * 0.115);
            /* 刀尖插槽：拖尾 / 刀光读取世界坐标 */
            Models._part(side === 'R' ? 'bladeR' : 'bladeL', bladeRig, 0, -H * 0.045 - bladeLen, H * 0.108);
          } else if (def.weapon.type === 'cannon') {
            /* 腕部重型炮管 */
            var barrel = Models._cyl(fore, H * 0.04, H * 0.034, H * 0.19, dark, 0, -H * 0.16, H * 0.085, 14);
            barrel.rotation.x = Math.PI / 2;
            Models._cyl(fore, H * 0.052, H * 0.052, H * 0.05, accent, 0, -H * 0.13, H * 0.045, 14);
            Models._cyl(fore, H * 0.022, H * 0.022, H * 0.035, glowWarm, 0, -H * 0.16, H * 0.19, 10).rotation.x = Math.PI / 2;
            for (var vb = -1; vb <= 1; vb += 2) {
              Models._box(fore, H * 0.015, H * 0.06, H * 0.02, accent, vb * H * 0.04, -H * 0.14, H * 0.1);
            }
          }
        }
        if (side === 'L') {
          if (heavy) {
            /* 震波拳套：加大拳头 + 指节冲击器 */
            Models._bevel(fist, H * 0.115 * w, H * 0.095, H * 0.115 * w, accent, 0, -H * 0.03, 0);
            for (var kn = -1; kn <= 1; kn += 2) {
              Models._box(fist, H * 0.026, H * 0.026, H * 0.026, steel, kn * H * 0.034, -H * 0.072, H * 0.045);
            }
            Models._box(fist, H * 0.05, H * 0.018, H * 0.018, glowWarm, 0, -H * 0.078, H * 0.06);
          } else {
            /* 双链锯形态：左腕只保留液压锁与发光导线，避免与刀身同时出现炮管 */
            Models._box(fore, H * 0.095 * w, H * 0.028, H * 0.04, steel, 0, -H * 0.165, H * 0.07);
            Models._box(fore, H * 0.012, H * 0.075, H * 0.012, glowWarm, 0, -H * 0.115, H * 0.098);
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
      var bulk = fast ? 0.94 : 1.16;
      var tex = unitTextures('kaiju');
      var KDEF = (AC.material || {});
      var ks = KDEF.kaijuSkin || { metalness: 0.05, roughness: 0.9 };
      var kb = KDEF.kaijuBelly || { metalness: 0.05, roughness: 0.85 };
      var kp = KDEF.kaijuPlate || { metalness: 0.35, roughness: 0.8 };
      /* 甲壳黏液微弱自发光：雨夜里皮肤缝渗出冷绿微光，不做高亮泛光 */
      var skin = Models._mat(def.skin, { metalness: ks.metalness, roughness: ks.roughness, maps: tex, normalScale: 2.0, emissive: 0x0c241f, emissiveIntensity: 0.18 });
      var belly = Models._mat(def.belly, { metalness: kb.metalness, roughness: kb.roughness, maps: tex, normalScale: 0.85, emissive: 0x0a211c, emissiveIntensity: 0.12 });
      var plate = Models._mat(0x4a555c, { metalness: kp.metalness, roughness: kp.roughness, flat: true, maps: tex, normalScale: 1.1 });
      var bone = Models._mat(0xc9c2a8, { metalness: 0.05, roughness: 0.45, flat: true });
      var glow = Models._glowMat(def.glow, (AC.glow && AC.glow.kaijuCore) || 0.95);
      var glowSoft = Models._glowMat(def.glow, (AC.glow && AC.glow.kaijuSoft) || 0.6);
      var eyeGlow = Models._glowMat(0xffb648, 1.15);   // 琥珀色兽眼：比荧光绿更像生物，也不会过曝成白球
      var spikeMat = Models._mat(0x1a1f22, { metalness: 0.1, roughness: 0.6, flat: true });
      var glowMaterials = [glow, glowSoft, eyeGlow];

      /* 生物尖刺：细长锥体，可指定朝向。用于重甲怪兽全身骨刺 */
      function spike(parent, len, rad, x, y, z, rotX, rotY, rotZ, mat) {
        var c = new THREE.Mesh(new THREE.ConeGeometry(rad || H * 0.012, len || H * 0.08, 5), mat || spikeMat);
        c.position.set(x, y, z);
        if (rotX) c.rotation.x = rotX;
        if (rotY) c.rotation.y = rotY;
        if (rotZ) c.rotation.z = rotZ;
        c.castShadow = true;
        parent.add(c);
        return c;
      }

      var root = new THREE.Group();
      root.name = def.id;
      var parts = {};

      /* 脚下软接触阴影：巨兽踩在湿地面上，有明确落点 */
      var shadowTex = Models._shadowTexture();
      if (shadowTex) {
        var shadow = new THREE.Mesh(
          new THREE.PlaneGeometry(H * 0.95, H * 0.55),
          new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.68, depthWrite: false })
        );
        shadow.name = 'contactShadow';
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.y = 0.035;
        shadow.renderOrder = 2;
        root.add(shadow);
      }

      /* --- 腿：数趾落地 + 屈膝蓄力轮廓 --- */
      var thighLen = H * (fast ? 0.29 : 0.27), shinLen = H * (fast ? 0.23 : 0.21);
      var legTop = H * (fast ? 0.55 : 0.53);
      ['L', 'R'].forEach(function (side) {
        var sgn = (side === 'L' ? -1 : 1);
        var leg = Models._part('leg' + side, root, sgn * H * 0.135 * bulk, legTop, -H * 0.015);
        /* 髋关节球 */
        Models._ellipsoid(leg, H * 0.072 * bulk, H * 0.072, H * 0.075 * bulk, skin, 0, 0, 0);
        /* 大腿：前后拉长的连续肌肉 */
        var thighR = H * 0.056 * bulk;
        var thighMesh = Models._capsule(leg, thighR, Math.max(thighR, thighLen - thighR * 2.0), skin, 0, -thighLen * 0.5, H * 0.005, 16);
        thighMesh.scale.z = 1.28;
        /* 前侧股甲/鳞片 */
        for (var tf = 0; tf < 3; tf++) {
          Models._bevel(leg, H * (0.07 - tf * 0.008) * bulk, thighLen * 0.20, H * 0.022,
            tf === 1 && !fast ? plate : belly, 0, -thighLen * (0.24 + tf * 0.20), H * (0.062 - tf * 0.004),
            0, H * 0.004);
        }
        if (!fast) {
          Models._bevel(leg, H * 0.10 * bulk, thighLen * 0.34, H * 0.05, plate, sgn * H * 0.018, -thighLen * 0.28, H * 0.045, 0, H * 0.005);
        }
        Models._box(leg, H * 0.010, thighLen * 0.26, H * 0.012, glowSoft, sgn * H * 0.062 * bulk, -thighLen * 0.55, H * 0.04);
        /* 后侧肌腱 */
        Models._ellipsoid(leg, H * 0.036 * bulk, thighLen * 0.24, H * 0.045, skin, 0, -thighLen * 0.62, -H * 0.055);

        var shin = Models._part('shin' + side, leg, 0, -thighLen, 0);
        Models._ellipsoid(shin, H * 0.062 * bulk, H * 0.06, H * 0.065, spikeMat, 0, 0, 0);
        var shinR = H * 0.047 * bulk;
        var shinMesh = Models._capsule(shin, shinR, Math.max(shinR, shinLen - shinR * 2.0), skin, 0, -shinLen * 0.5, 0, 16);
        shinMesh.scale.z = 1.22;
        var calf = Models._ellipsoid(shin, H * 0.038 * bulk, shinLen * 0.30, H * 0.05, skin, 0, -shinLen * 0.42, -H * 0.045);
        calf.rotation.x = -0.2;
        Models._bevel(shin, H * 0.078 * bulk, shinLen * 0.46, H * 0.028, belly, 0, -shinLen * 0.34, H * 0.058, 0, H * 0.004);
        Models._box(shin, H * 0.010, shinLen * 0.34, H * 0.012, glowSoft, sgn * H * 0.038, -shinLen * 0.52, H * 0.062);
        /* 踝关节 */
        Models._ellipsoid(shin, H * 0.046 * bulk, H * 0.04, H * 0.05, spikeMat, 0, -shinLen, 0);
        var foot = Models._part('foot' + side, shin, 0, -shinLen, 0);
        /* 脚掌：低楔形，三趾前伸 */
        Models._bevel(foot, H * 0.16 * bulk, H * 0.055, H * 0.17, skin, 0, H * 0.028, H * 0.02, 0, H * 0.006);
        Models._bevel(foot, H * 0.11 * bulk, H * 0.028, H * 0.10, belly, 0, H * 0.06, -H * 0.005, 0, H * 0.003);
        for (var t = 0; t < 3; t++) {
          var tx = (t - 1) * H * 0.052 * bulk;
          var toe = Models._ellipsoid(foot, H * 0.030 * bulk, H * 0.028, H * 0.095, belly, tx, H * 0.024, H * 0.14);
          toe.rotation.y = (t - 1) * 0.16;
          spike(foot, H * 0.085, H * 0.018, tx * 1.1, H * 0.026, H * 0.235, Math.PI / 2, 0, 0, bone);
        }
        spike(foot, H * 0.07, H * 0.02, 0, H * 0.05, -H * 0.105, -Math.PI / 2, 0, 0, bone);
      });

      /* --- 髋 / 躯干：前倾的巨兽重心，胸腔前后拉长 --- */
      var hips = Models._part('hip', root, 0, H * 0.54, -H * 0.02);
      Models._ellipsoid(hips, H * 0.118 * bulk, H * 0.088, H * 0.105 * bulk, skin, 0, -H * 0.005, H * 0.005);
      Models._bevel(hips, H * 0.17 * bulk, H * 0.055, H * 0.14 * bulk, belly, 0, -H * 0.075, H * 0.04, 0, H * 0.006);
      for (var hg = -1; hg <= 1; hg += 2) {
        Models._ellipsoid(hips, H * 0.045 * bulk, H * 0.07, H * 0.06 * bulk, skin, hg * H * 0.095 * bulk, -H * 0.03, -H * 0.05);
        if (!fast) Models._bevel(hips, H * 0.045, H * 0.10, H * 0.05, plate, hg * H * 0.13 * bulk, H * 0.015, H * 0.02, 0, H * 0.004);
      }
      /* 前倾枢轴：不参与动画，给所有动画一个天然弓背基线 */
      var torsoPivot = Models._part('torsoPivot', root, 0, H * 0.59, -H * 0.015);
      torsoPivot.rotation.x = fast ? 0.22 : 0.15;
      var torso = Models._part('torso', torsoPivot, 0, 0, 0);
      parts.torso = torso;
      /* 腰腹 */
      Models._ellipsoid(torso, H * 0.10 * bulk, H * 0.09, H * 0.095 * bulk, skin, 0, -H * 0.055, 0);
      var chest = Models._part('chest', torso, 0, H * 0.105, H * 0.01);
      /* 胸腔主体：宽厚、前后更长，侧视是一个前倾的桶形 */
      Models._ellipsoid(chest, H * 0.155 * bulk, H * 0.125, H * 0.175 * bulk, skin, 0, 0, -H * 0.015);
      Models._ellipsoid(chest, H * 0.10 * bulk, H * 0.10, H * 0.13 * bulk, skin, 0, H * 0.045, -H * 0.07); // 背峰
      /* 斜方肌 */
      for (var mg2 = -1; mg2 <= 1; mg2 += 2) {
        Models._ellipsoid(chest, H * 0.062 * bulk, H * 0.042, H * 0.07, skin, mg2 * H * 0.085 * bulk, H * 0.112, -H * 0.015);
      }
      /* 胸肌/胸骨：腹色只做小块肌肉，胸骨改用深色角质，避免胸口出现米色十字 */
      for (var pc = -1; pc <= 1; pc += 2) {
        var pec = Models._bevel(chest, H * 0.088 * bulk, H * 0.052, H * 0.022, belly,
          pc * H * 0.072 * bulk, -H * 0.005, H * 0.158 * bulk, 0, H * 0.005);
        pec.rotation.z = pc * 0.12;
      }
      Models._bevel(chest, H * 0.038 * bulk, H * 0.175, H * 0.028, plate, 0, -H * 0.025, H * 0.166 * bulk, 0, H * 0.006);
      /* 腹部横带：窄而贴合，从胸下延伸到髋部 */
      for (var sc = 0; sc < 5; sc++) {
        Models._ellipsoid(torso, H * (0.086 - sc * 0.009) * bulk, H * 0.020, H * 0.026, sc === 2 ? plate : belly,
          0, -H * 0.02 - sc * H * 0.032, H * 0.074 - sc * H * 0.002);
      }
      /* 腰侧发光腺体 */
      for (var gg = -1; gg <= 1; gg += 2) {
        Models._box(torso, H * 0.012, H * 0.09, H * 0.05, glowSoft, gg * H * 0.10 * bulk, H * 0.02, -H * 0.055);
      }
      if (!fast) {
        /* 重甲型：宽背甲 + 肩部大刺 */
        Models._bevel(chest, H * 0.24 * bulk, H * 0.05, H * 0.20 * bulk, plate, 0, H * 0.10, -H * 0.055);
        for (var br = 0; br < 5; br++) {
          var bz = -H * 0.04 - br * H * 0.028;
          spike(torso, H * (0.10 - br * 0.008), H * 0.016, -H * 0.075 * bulk, H * 0.15 - br * H * 0.022, bz, -0.55, 0, -0.2, plate);
          spike(torso, H * (0.10 - br * 0.008), H * 0.016, H * 0.075 * bulk, H * 0.15 - br * H * 0.022, bz, -0.55, 0, 0.2, plate);
        }
      }
      /* 背部骨板：从颈后延伸到腰，侧视是连续锯齿背 */
      var finN = fast ? 7 : 6;
      for (var fi = 0; fi < finN; fi++) {
        var ft = fi / (finN - 1);
        var fy = H * (0.20 - ft * 0.11);
        var fz = -H * (0.10 + ft * 0.015);
        var fh = H * (fast ? (0.135 - Math.abs(ft - 0.32) * 0.10) : (0.115 - Math.abs(ft - 0.4) * 0.06));
        var fl = H * (0.085 - ft * 0.02);
        Models._poly(torso, [
          [-fl, 0], [fl, 0], [fl * 0.55, fh * 0.32], [fl * 0.18, fh], [-fl * 0.35, fh * 0.45]
        ], H * 0.024, bone, 0, fy, fz, { rotY: Math.PI / 2 });
      }
      /* 脊背发光缝 */
      for (var gs = 0; gs < 5; gs++) {
        Models._box(torso, H * 0.014, H * 0.018, H * 0.055, glow, 0, H * 0.16 - gs * H * 0.045, -H * 0.055 - gs * H * 0.012);
      }

      /* --- 颈 / 头：长颈前伸 + 刀锋骨冠 --- */
      var neckPivot = Models._part('neckPivot', torso, 0, H * 0.195, H * 0.07);
      /* 抵消前倾躯干：脖子反向抬起，头保持接近水平，骨冠才不会被肩挡住 */
      neckPivot.rotation.x = fast ? -0.16 : -0.08;
      var neck = Models._part('neck', neckPivot, 0, 0, 0);
      var neckLen = H * (fast ? 0.14 : 0.12);
      Models._cyl(neck, H * 0.062, H * 0.095, neckLen, skin, 0, neckLen * 0.35, 0, 12);
      for (var nf = 0; nf < 3; nf++) {
        Models._bevel(neck, H * (0.085 - nf * 0.008), neckLen * 0.22, H * 0.028, belly,
          0, neckLen * (0.2 + nf * 0.22), H * 0.055, 0, H * 0.003);
      }
      Models._ellipsoid(neck, H * 0.045, neckLen * 0.4, H * 0.05, skin, -H * 0.055, neckLen * 0.45, 0);
      Models._ellipsoid(neck, H * 0.045, neckLen * 0.4, H * 0.05, skin, H * 0.055, neckLen * 0.45, 0);
      for (var ns = 0; ns < 3; ns++) {
        spike(neck, H * (0.09 - ns * 0.012), H * 0.014, 0, neckLen * (0.25 + ns * 0.22), -H * 0.06, -0.6, 0, 0, bone);
      }
      var head = Models._part('head', neck, 0, neckLen * 0.80, H * 0.045);
      var headLen = H * (fast ? 0.33 : 0.28);
      var headW = H * (fast ? 0.215 : 0.235);
      if (fast) {
        /* 刀锋头：楔形颅骨 + 从鼻梁扬起的巨大骨刃 */
        Models._ellipsoid(head, headW * 0.46, H * 0.082, headLen * 0.46, skin, 0, H * 0.015, headLen * 0.30);
        var snout = Models._cyl(head, headW * 0.20, headW * 0.40, headLen * 0.52, skin, 0, -H * 0.005, headLen * 0.62, 10);
        snout.rotation.x = Math.PI / 2;
        Models._ellipsoid(head, headW * 0.42, H * 0.042, headLen * 0.24, skin, 0, H * 0.012, headLen * 0.72);
        /* 颅顶骨冠：高耸、前伸、侧视 unmistakable 的刀锋轮廓 */
        Models._poly(head, [
          [-headLen * 0.24, 0],
          [headLen * 0.30, 0],
          [headLen * 0.18, H * 0.045],
          [headLen * 0.06, H * 0.125],
          [-headLen * 0.04, H * 0.150],
          [-headLen * 0.14, H * 0.090],
          [-headLen * 0.22, H * 0.035]
        ], H * 0.034, bone, 0, H * 0.055, headLen * 0.26, { rotY: -Math.PI / 2 });
        /* 副冠：左右各一片薄骨板，增加厚度感 */
        for (var cr = -1; cr <= 1; cr += 2) {
          Models._poly(head, [
            [-headLen * 0.16, 0],
            [headLen * 0.16, 0],
            [headLen * 0.06, H * 0.075],
            [-headLen * 0.03, H * 0.09],
            [-headLen * 0.12, H * 0.04]
          ], H * 0.012, plate, cr * H * 0.028, H * 0.05, headLen * 0.24, { rotY: -Math.PI / 2 });
        }
        /* 眉脊 / 眼窝 / 发光眼：眼睛必须探出颅骨侧面，否则从三分之四视角完全看不见 */
        for (var e2 = -1; e2 <= 1; e2 += 2) {
          var brow = Models._bevel(head, headW * 0.22, H * 0.020, H * 0.045, bone, e2 * headW * 0.30, H * 0.055, headLen * 0.56, 0, H * 0.003);
          brow.rotation.z = -e2 * 0.30;
          Models._ellipsoid(head, H * 0.030, H * 0.032, headLen * 0.042, spikeMat, e2 * headW * 0.395, H * 0.020, headLen * 0.615);
          Models._ellipsoid(head, H * 0.014, H * 0.019, headLen * 0.030, eyeGlow, e2 * headW * 0.452, H * 0.020, headLen * 0.63);
          /* 竖瞳：在发光眼球外侧压一条深色窄缝，远看也有“眼睛”而不是光点 */
          Models._box(head, H * 0.007, H * 0.014, headLen * 0.008, spikeMat, e2 * headW * 0.493, H * 0.020, headLen * 0.642);
          var lid = Models._bevel(head, H * 0.052, H * 0.012, headLen * 0.036, skin, e2 * headW * 0.445, H * 0.032, headLen * 0.632, 0, H * 0.002);
          lid.rotation.z = -e2 * 0.34;
          spike(head, H * 0.10, H * 0.015, e2 * headW * 0.42, H * 0.015, headLen * 0.30, Math.PI / 2, 0, e2 * 0.3, bone);
          Models._box(head, H * 0.008, H * 0.05, H * 0.008, glowSoft, e2 * H * 0.052, H * 0.06, headLen * 0.28).rotation.z = -e2 * 0.35;
        }
        spike(head, headLen * 0.20, H * 0.014, 0, H * 0.085, headLen * 0.10, -0.75, 0, 0, bone);
      } else {
        /* 棱皮龟：宽方颅 + 厚重眉脊 + 头顶骨刺 */
        Models._bevel(head, headW, H * 0.155, headLen * 0.95, skin, 0, 0, headLen * 0.36, 0, H * 0.012);
        Models._ellipsoid(head, headW * 0.44, H * 0.075, headLen * 0.34, skin, 0, H * 0.062, headLen * 0.32);
        Models._ellipsoid(head, headW * 0.34, H * 0.06, headLen * 0.24, skin, 0, H * 0.015, headLen * 0.70);
        Models._box(head, headW * 1.02, H * 0.035, headLen * 0.16, plate, 0, H * 0.075, headLen * 0.72);
        Models._box(head, headW * 0.86, H * 0.05, headLen * 0.60, plate, 0, H * 0.098, headLen * 0.26);
        var snoutRidge = Models._bevel(head, headW * 0.28, H * 0.03, headLen * 0.42, plate, 0, H * 0.043, headLen * 0.64);
        snoutRidge.rotation.x = -0.08;
        for (var hs = -1; hs <= 1; hs++) {
          spike(head, H * (hs === 0 ? 0.15 : 0.11), H * 0.019, hs * H * 0.045, H * 0.13, headLen * 0.16, -0.18, 0, 0, bone);
        }
        for (var e3 = -1; e3 <= 1; e3 += 2) {
          /* 宽方颅的侧面几乎是平面，眼球要贴着侧面外沿才露得出来 */
          Models._ellipsoid(head, H * 0.024, H * 0.028, headLen * 0.038, spikeMat, e3 * headW * 0.440, H * 0.038, headLen * 0.705);
          Models._ellipsoid(head, H * 0.015, H * 0.019, headLen * 0.032, eyeGlow, e3 * headW * 0.505, H * 0.038, headLen * 0.718);
          Models._box(head, H * 0.007, H * 0.014, headLen * 0.009, spikeMat, e3 * headW * 0.548, H * 0.038, headLen * 0.732);
          var lid2 = Models._bevel(head, H * 0.060, H * 0.012, headLen * 0.040, skin, e3 * headW * 0.485, H * 0.052, headLen * 0.716, 0, H * 0.002);
          lid2.rotation.z = -e3 * 0.34;
          Models._box(head, headW * 0.16, H * 0.030, headLen * 0.18, bone, e3 * headW * 0.43, H * 0.080, headLen * 0.64);
          Models._ellipsoid(head, H * 0.075, H * 0.078, headLen * 0.14, skin, e3 * headW * 0.34, H * 0.005, headLen * 0.52);
          Models._box(head, H * 0.055, H * 0.075, H * 0.06, plate, e3 * H * 0.09, H * 0.018, headLen * 0.65);
          spike(head, H * 0.10, H * 0.02, e3 * H * 0.095, H * 0.005, headLen * 0.55, 0, 0, e3 * 0.9, bone);
          spike(head, H * 0.075, H * 0.015, e3 * headW * 0.18, H * 0.052, headLen * 0.86, 1.35, 0, e3 * 0.2, bone);
        }
        Models._box(head, headW * 0.24, H * 0.024, H * 0.045, spikeMat, 0, H * 0.025, headLen * 0.88);
      }
      var jawUp = Models._part('jawUpper', head, 0, -H * 0.035, headLen * 0.62);
      Models._box(jawUp, headW * 0.72, H * 0.05, headLen * 0.55, skin, 0, 0, headLen * 0.25);
      Models._ellipsoid(jawUp, headW * 0.36, H * 0.032, headLen * 0.27, skin, 0, H * 0.004, headLen * 0.27);
      Models._ellipsoid(jawUp, headW * 0.10, H * 0.022, headLen * 0.16, belly, 0, H * 0.014, headLen * 0.44);
      for (var tu = 0; tu < 6; tu++) {
        var tux = (tu - 2.5) * headW * 0.1;
        spike(jawUp, H * 0.068, H * 0.012, tux, -H * 0.025, headLen * 0.36, Math.PI, 0, 0, bone);
      }
      var jawLow = Models._part('jawLower', head, 0, -H * 0.082, headLen * 0.56);
      Models._box(jawLow, headW * 0.66, H * 0.045, headLen * 0.5, belly, 0, 0, headLen * 0.22);
      Models._ellipsoid(jawLow, headW * 0.32, H * 0.028, headLen * 0.24, belly, 0, -H * 0.002, headLen * 0.23);
      Models._ellipsoid(jawLow, headW * 0.20, H * 0.035, headLen * 0.13, skin, 0, -H * 0.008, headLen * 0.02);
      Models._box(jawLow, headW * 0.34, H * 0.022, headLen * 0.42, skin, 0, -H * 0.005, headLen * 0.2);
      for (var tl = 0; tl < 5; tl++) {
        var tlx = (tl - 2) * headW * 0.1;
        spike(jawLow, H * 0.055, H * 0.011, tlx, H * 0.022, headLen * 0.36, 0, 0, 0, bone);
      }
      Models._box(jawLow, headW * 0.42, H * 0.012, headLen * 0.22, glow, 0, -H * 0.012, headLen * 0.22);
      for (var jw = -1; jw <= 1; jw += 2) {
        Models._ellipsoid(jawLow, H * 0.04, H * 0.03, headLen * 0.11, skin, jw * headW * 0.31, H * 0.005, headLen * 0.16);
      }
      if (!fast) {
        spike(jawLow, H * 0.11, H * 0.015, -headW * 0.38, H * 0.015, headLen * 0.28, 0.3, 0, -0.4, bone);
        spike(jawLow, H * 0.11, H * 0.015, headW * 0.38, H * 0.015, headLen * 0.28, 0.3, 0, 0.4, bone);
      }

      /* --- 前肢：肩位抬高、肘部前屈，爪落在胸腹前而不是垂到膝盖 --- */
      ['L', 'R'].forEach(function (side) {
        var sgn = (side === 'L' ? -1 : 1);
        var shoulder = Models._part('shoulder' + side, chest, sgn * H * 0.168 * bulk, H * 0.085, H * 0.062);
        /* 三角肌：前后拉长的肌肉块，不再是正圆球 */
        var shMass = Models._ellipsoid(shoulder, H * 0.052 * bulk, H * 0.060, H * 0.066, skin, 0, 0, 0);
        shMass.rotation.z = sgn * 0.12;
        /* 肩胛骨板：从颈侧向后包住肩膀，给出爬兽的肩背过渡 */
        Models._poly(shoulder, [
          [-H * 0.075, 0], [H * 0.07, H * 0.012], [H * 0.045, H * 0.072],
          [0, H * 0.098], [-H * 0.058, H * 0.046]
        ], H * 0.030, plate, 0, H * 0.040, -H * 0.012, { rotY: Math.PI / 2 });
        spike(shoulder, H * 0.145, H * 0.022, sgn * H * 0.028, H * 0.082, -H * 0.008, -0.24, 0, -sgn * 0.55, bone);

        /* 静态肩外展放在中间枢轴上：动画只驱动 fore，不会覆盖这层角度 */
        var armRig = Models._part('armRig' + side, shoulder, 0, -H * 0.012, 0);
        armRig.rotation.z = sgn * 0.20;
        armRig.rotation.x = -0.05;
        var upLen = H * (fast ? 0.135 : 0.125);
        var armR = H * 0.044 * bulk;
        var fore = Models._part('fore' + side, armRig, 0, 0, 0);
        var upperArm = Models._capsule(fore, armR, upLen * 0.70, skin, 0, -upLen * 0.46, 0, 14);
        upperArm.scale.z = 1.16;
        /* 上臂外侧骨甲 + 后侧肌腱 */
        Models._bevel(fore, H * 0.052 * bulk, upLen * 0.54, H * 0.042, plate,
          sgn * H * 0.030, -upLen * 0.42, H * 0.010, 0, H * 0.005);
        Models._ellipsoid(fore, H * 0.030, upLen * 0.28, H * 0.038, skin, 0, -upLen * 0.46, -H * 0.046);
        Models._box(fore, H * 0.010, upLen * 0.32, H * 0.012, glowSoft, sgn * H * 0.044 * bulk, -upLen * 0.56, H * 0.050);

        /* 肘关节：大幅前屈，前臂朝前下方，形成猛兽的持爪姿态 */
        var elbowJoint = Models._part('elbow' + side, fore, 0, -upLen, 0);
        elbowJoint.rotation.x = fast ? -0.42 : -0.36;
        elbowJoint.rotation.z = -sgn * 0.08;
        Models._ellipsoid(elbowJoint, H * 0.046, H * 0.050, H * 0.050, spikeMat, 0, 0, 0);
        spike(elbowJoint, H * 0.115, H * 0.019, sgn * H * 0.038, H * 0.008, -H * 0.018, -0.42, 0, -sgn * 0.85, bone);
        var foreLen = H * (fast ? 0.125 : 0.115);
        var lowerR = armR * 0.86;
        var lowerArm = Models._capsule(elbowJoint, lowerR, foreLen * 0.70, skin, 0, -foreLen * 0.44, 0, 14);
        lowerArm.scale.z = 1.14;
        /* 前臂板甲 + 向外翻的骨刃 */
        Models._bevel(elbowJoint, H * 0.058 * bulk, foreLen * 0.60, H * 0.048, plate,
          sgn * H * 0.022, -foreLen * 0.40, H * 0.012, 0, H * 0.006);
        spike(elbowJoint, H * 0.155, H * 0.020, sgn * H * 0.048 * bulk, -foreLen * 0.44, -H * 0.004, -0.12, 0, -sgn * 1.18, bone);
        Models._box(elbowJoint, H * 0.010, foreLen * 0.44, H * 0.012, glowSoft, sgn * H * 0.046 * bulk, -foreLen * 0.54, H * 0.052);

        var claw = Models._part('claw' + side, elbowJoint, 0, -foreLen, 0);
        var handLen = H * (fast ? 0.105 : 0.100);
        var handR = H * 0.050 * bulk;
        var handMesh = Models._capsule(claw, handR, handLen * 0.42, skin, 0, -handLen * 0.30, H * 0.004, 12);
        handMesh.scale.z = 1.18;
        /* 掌背骨甲：挥击时爪部有硬质高光轮廓 */
        Models._poly(claw, [
          [-H * 0.055, 0], [H * 0.050, H * 0.004], [H * 0.030, H * 0.048],
          [0, H * 0.064], [-H * 0.040, H * 0.034]
        ], H * 0.028, plate, 0, -handLen * 0.12, H * 0.042, { rotY: Math.PI / 2 });
        /* 爪尖插槽：怪兽攻击拖尾读取世界坐标 */
        Models._part('clawTip' + side, claw, 0, -handLen * 0.90, H * 0.012);
        for (var c = 0; c < 4; c++) {
          var cx = (c - 1.5) * H * 0.032;
          Models._box(claw, H * 0.026, handLen * 0.48, H * 0.030, skin, cx, -handLen * 0.57, H * 0.008);
          spike(claw, H * 0.115, H * 0.015, cx, -handLen * 0.86, H * 0.016, Math.PI - 0.20, 0, 0, bone); // 下弯利爪
        }
        spike(claw, H * 0.10, H * 0.015, sgn * H * 0.060, -handLen * 0.45, H * 0.020, Math.PI * 0.62, 0, sgn * 0.30, bone); // 拇指爪
      });

      /* --- 四段尾巴：粗根、上扬 S 曲线、连续尾鳍与骨刺 --- */
      var tailRoot = Models._part('tailRoot', hips, 0, H * 0.005, -H * 0.12 * bulk);
      tailRoot.rotation.x = -0.10;             // 先微微下垂，再由中段扬起
      tailRoot.rotation.y = 0.18;              // 主要留在矢状面内，侧视能看到完整尾巴
      var tailSeg = H * (fast ? 0.185 : 0.165);
      var tailW = H * (fast ? 0.155 : 0.165) * bulk;

      var tailBase = Models._part('tailBase', tailRoot, 0, 0, 0);
      /* 尾根：与髋部相接的粗椭球，避免圆柱切面 */
      Models._ellipsoid(tailBase, tailW * 0.52, tailW * 0.46, tailSeg * 0.58, skin, 0, 0, -tailSeg * 0.46);
      Models._ellipsoid(tailBase, tailW * 0.42, tailW * 0.42, tailSeg * 0.34, skin, 0, tailW * 0.04, -tailSeg * 0.10);
      /* 尾背浅色腱脊：夜色里勾出尾巴上缘，避免整条尾巴埋进暗部 */
      Models._ellipsoid(tailBase, tailW * 0.30, tailW * 0.10, tailSeg * 0.40, belly, 0, tailW * 0.24, -tailSeg * 0.48);
      /* 尾根背鳍：从髋后立起的一片骨板 */
      Models._poly(tailBase, [
        [-tailSeg * 0.40, 0], [tailSeg * 0.40, 0],
        [tailSeg * 0.22, H * 0.075], [-tailSeg * 0.06, H * 0.155], [-tailSeg * 0.34, H * 0.050]
      ], H * 0.022, bone, 0, tailW * 0.30, -tailSeg * 0.48, { rotY: Math.PI / 2 });

      /* 静态 S 形弯：动画只驱动 tailBase，曲率挂在中间枢轴上不会被覆盖 */
      var tailCurveA = Models._part('tailCurveA', tailBase, 0, 0, -tailSeg * 0.94);
      tailCurveA.rotation.x = 0.17;
      tailCurveA.rotation.y = 0.10;
      var tailMid = Models._part('tailMid', tailCurveA, 0, 0, 0);
      Models._ellipsoid(tailMid, tailW * 0.40, tailW * 0.36, tailSeg * 0.52, skin, 0, 0, -tailSeg * 0.46);
      Models._ellipsoid(tailMid, tailW * 0.23, tailW * 0.08, tailSeg * 0.36, belly, 0, tailW * 0.18, -tailSeg * 0.46);
      Models._box(tailMid, H * 0.026, H * 0.018, tailSeg * 0.72, glowSoft, 0, -tailW * 0.30, -tailSeg * 0.46); // 尾下发光
      Models._poly(tailMid, [
        [-tailSeg * 0.36, 0], [tailSeg * 0.34, 0],
        [tailSeg * 0.16, H * 0.065], [-tailSeg * 0.06, H * 0.130], [-tailSeg * 0.30, H * 0.040]
      ], H * 0.019, bone, 0, tailW * 0.24, -tailSeg * 0.46, { rotY: Math.PI / 2 });

      var tailCurveB = Models._part('tailCurveB', tailMid, 0, 0, -tailSeg * 0.90);
      tailCurveB.rotation.x = 0.19;
      tailCurveB.rotation.y = 0.08;
      var tailTip = Models._part('tailTip', tailCurveB, 0, 0, 0);
      Models._ellipsoid(tailTip, tailW * 0.29, tailW * 0.26, tailSeg * 0.46, skin, 0, 0, -tailSeg * 0.42);
      Models._ellipsoid(tailTip, tailW * 0.16, tailW * 0.06, tailSeg * 0.30, belly, 0, tailW * 0.13, -tailSeg * 0.42);
      Models._poly(tailTip, [
        [-tailSeg * 0.30, 0], [tailSeg * 0.26, 0],
        [tailSeg * 0.10, H * 0.050], [-tailSeg * 0.06, H * 0.095], [-tailSeg * 0.26, H * 0.030]
      ], H * 0.016, bone, 0, tailW * 0.18, -tailSeg * 0.42, { rotY: Math.PI / 2 });

      var tailCurveC = Models._part('tailCurveC', tailTip, 0, 0, -tailSeg * 0.84);
      tailCurveC.rotation.x = 0.16;
      tailCurveC.rotation.y = 0.06;
      var tailEnd = Models._part('tailEnd', tailCurveC, 0, 0, 0);
      Models._ellipsoid(tailEnd, tailW * 0.20, tailW * 0.18, tailSeg * 0.34, skin, 0, 0, -tailSeg * 0.30);
      /* 尾刃：一块明显高出尾尖的骨刃，侧视可直接辨认尾巴方向 */
      Models._poly(tailEnd, [
        [-tailSeg * 0.34, 0], [tailSeg * 0.24, 0], [tailSeg * 0.10, H * 0.055],
        [-tailSeg * 0.08, H * 0.115], [-tailSeg * 0.30, H * 0.040]
      ], H * 0.020, bone, 0, tailW * 0.10, -tailSeg * 0.34, { rotY: Math.PI / 2 });
      spike(tailEnd, H * 0.19, H * 0.024, 0, 0, -tailSeg * 0.56, -Math.PI / 2 + 0.28, 0, 0, plate); // 尾尖刃

      /* 尾脊骨刺：骨色高出轮廓，远看也能区分“尾巴”而不是第三条手臂 */
      [tailBase, tailMid, tailTip].forEach(function (seg, si) {
        var sz = si === 0 ? 0.40 : (si === 1 ? 0.50 : 0.48);
        spike(seg, H * (0.13 - si * 0.02), H * 0.018, 0, tailW * 0.26, -tailSeg * sz, -0.55, 0, 0, bone);
        spike(seg, H * (0.09 - si * 0.015), H * 0.013, -tailW * 0.24, tailW * 0.20, -tailSeg * (sz + 0.12), -0.5, 0, 0.25, bone);
        spike(seg, H * (0.09 - si * 0.015), H * 0.013, tailW * 0.24, tailW * 0.20, -tailSeg * (sz + 0.12), -0.5, 0, -0.25, bone);
      });
      /* 尾巴背侧骨刺：速攻型两排 + 尾刃，重甲型密集三排 */
      if (fast) {
        for (var fs = 0; fs < 2; fs++) {
          var fz = -tailSeg * (0.3 + fs * 0.4);
          spike(tailBase, H * 0.08, H * 0.012, -tailW * 0.3, tailW * 0.38, fz, -0.5, 0, 0.35, plate);
          spike(tailBase, H * 0.08, H * 0.012, tailW * 0.3, tailW * 0.38, fz, -0.5, 0, -0.35, plate);
        }
        for (var fm = 0; fm < 3; fm++) {
          spike(tailMid, H * 0.09, H * 0.012, 0, tailW * 0.32, -tailSeg * (0.15 + fm * 0.3), -0.5, 0, 0, plate);
        }
        spike(tailTip, H * 0.12, H * 0.014, -tailW * 0.2, tailW * 0.2, -tailSeg * 0.45, -0.5, 0, 0.4, plate);
        spike(tailTip, H * 0.12, H * 0.014, tailW * 0.2, tailW * 0.2, -tailSeg * 0.45, -0.5, 0, -0.4, plate);
      } else {
        [tailBase, tailMid, tailTip].forEach(function (seg, si) {
          var segLen = si === 2 ? tailSeg * 0.9 : tailSeg;
          var cnt = si === 0 ? 4 : (si === 1 ? 3 : 2);
          var halfW = (si === 0 ? 0.05 : si === 1 ? 0.04 : 0.025) * H * bulk;
          var spikeH = H * (0.11 - si * 0.018);
          for (var k = 0; k < cnt; k++) {
            var kz = -segLen * (0.2 + k * (0.6 / Math.max(1, cnt - 1)));
            var ky = tailW * (0.42 - si * 0.04);
            spike(seg, spikeH, H * 0.012, -halfW, ky, kz, -0.55, 0, 0.3, plate);
            spike(seg, spikeH, H * 0.012, halfW, ky, kz, -0.55, 0, -0.3, plate);
            spike(seg, spikeH * 1.25, H * 0.014, 0, ky + H * 0.005, kz, -0.5, 0, 0, plate);
          }
        });
      }

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
    /* 平滑相位：a..b 之间从 0 过渡到 1，用于起手 / 挥砍 / 收势分段 */
    function ease(a, b, x) {
      var t = Math.min(1, Math.max(0, (x - a) / Math.max(1e-4, b - a)));
      return t * t * (3 - 2 * t);
    }

    /* 待机 */
    clips.push(buildClip('idle', 2.6, true, {
      hip: { q: function (u) { return [0, 0, s(u * TWO_PI) * 0.02]; } },
      body: { q: function (u) { return [s(u * TWO_PI) * 0.012, s(u * TWO_PI) * 0.02, s(u * TWO_PI) * 0.018]; }, p: function (u) { return [0, s(u * TWO_PI) * 0.1, 0]; } },
      head: { q: function (u) { return [s(u * TWO_PI + 0.8) * 0.05, s(u * TWO_PI * 0.5) * 0.08, 0]; } },
      shoulderL: { q: function (u) { return [s(u * TWO_PI) * 0.02 - 0.02, 0, -0.07]; } },
      shoulderR: { q: function (u) { return [s(u * TWO_PI + 0.4) * 0.02 - 0.02, 0, 0.07]; } },
      /* 待机时双臂离开躯干、肘部前屈：正面机位能看清手臂与刀的分层 */
      armL: { q: function (u) { return [s(u * TWO_PI) * 0.03 - 0.10, 0, -0.20]; } },
      armR: { q: function (u) { return [s(u * TWO_PI + 0.5) * 0.03 - 0.10, 0, 0.20]; } },
      forearmL: { q: function (u) { return [-0.30 + s(u * TWO_PI + 0.3) * 0.015, 0, -0.04]; } },
      forearmR: { q: function (u) { return [-0.30 + s(u * TWO_PI + 0.8) * 0.015, 0, 0.04]; } },
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

    /* 轻攻击（0.66s 对齐 moves.light 三段时长）
       · 镜头在 +Z、机甲面向 +X，画面里能看到的是左臂；因此主挥砍必须由左臂完成，
         右臂只做反向配重。旧版把 68° 大挥砍给了被躯干挡住的右臂，玩家只能看到刀光。
       · 刀刃型：左臂从画面左侧高举 → 横跨身前的斜斩 → 收势；
       · 非刀刃型：同样的左臂横勾拳（机炮型没有可见刀身，靠拳头读出动作）。 */
    if (blendArmsBlade) {
      clips.push(buildClip('light', 0.66, false, {
        hip: {
          q: function (u) {
            var w = ease(0, 0.32, u), h = ease(0.32, 0.52, u), r = ease(0.52, 1.0, u);
            return [0, -0.18 * w + 0.42 * h - 0.24 * r, 0.03 * w - 0.05 * h + 0.02 * r];
          }
        },
        body: {
          q: function (u) {
            var w = ease(0, 0.32, u), h = ease(0.32, 0.52, u), r = ease(0.52, 1.0, u);
            return [0.05 * w - 0.10 * h + 0.05 * r,
              -0.40 * w + 0.88 * h - 0.48 * r,
              -0.05 * w + 0.09 * h - 0.04 * r];
          }
        },
        /* 主挥砍：左臂 Z 轴从 -1.45rad（指向画面左侧）扫到 +1.30rad（横跨身前指向怪兽） */
        armL: {
          q: function (u) {
            var w = ease(0, 0.34, u), h = ease(0.34, 0.56, u), r = ease(0.56, 1.0, u);
            return [-0.10 - 0.48 * w + 0.40 * h + 0.08 * r,
              -0.15 * w + 0.30 * h - 0.15 * r,
              -0.20 - 1.25 * w + 2.75 * h - 1.50 * r];
          }
        },
        forearmL: {
          q: function (u) {
            var w = ease(0, 0.34, u), h = ease(0.34, 0.56, u), r = ease(0.56, 1.0, u);
            return [-0.30 - 0.55 * w + 0.55 * h,
              0,
              -0.04 - 0.14 * w + 0.18 * h - 0.04 * r];
          }
        },
        shoulderL: {
          q: function (u) {
            var w = ease(0, 0.34, u), h = ease(0.34, 0.56, u), r = ease(0.56, 1.0, u);
            return [0, 0, -0.07 - 0.10 * w + 0.22 * h - 0.12 * r];
          }
        },
        /* 远端右臂：反向摆动做配重，动作被躯干遮挡也不影响读数 */
        armR: {
          q: function (u) {
            var w = ease(0, 0.34, u), h = ease(0.34, 0.56, u), r = ease(0.56, 1.0, u);
            return [-0.10 + 0.40 * w - 0.10 * h - 0.30 * r,
              0.12 * w - 0.18 * h + 0.06 * r,
              0.20 + 0.45 * w - 0.65 * h + 0.20 * r];
          }
        },
        forearmR: {
          q: function (u) {
            var w = ease(0, 0.34, u), h = ease(0.34, 0.56, u), r = ease(0.56, 1.0, u);
            return [-0.30 - 0.45 * w + 0.40 * h + 0.05 * r, 0, 0.04];
          }
        },
        shoulderR: {
          q: function (u) {
            var w = ease(0, 0.34, u), h = ease(0.34, 0.56, u), r = ease(0.56, 1.0, u);
            return [0, 0, 0.07 + 0.10 * w - 0.18 * h + 0.08 * r];
          }
        },
        head: {
          q: function (u) {
            var w = ease(0, 0.30, u), h = ease(0.30, 0.52, u), r = ease(0.52, 1.0, u);
            return [0.04, -0.26 * w + 0.40 * h - 0.14 * r, 0];
          }
        },
        legL: { q: function (u) { return [-0.10 * s(PI * u), 0, 0.03]; } },
        legR: { q: function (u) { return [0.16 * s(PI * u), 0, -0.02]; } },
        shinL: { q: function (u) { return [0.20 * Math.max(0, s(PI * u)), 0, 0]; } },
        shinR: { q: function (u) { return [0.12 * Math.max(0, s(PI * u)), 0, 0]; } }
      }));
    } else {
      clips.push(buildClip('light', 0.66, false, {
        hip: {
          q: function (u) {
            var w = ease(0, 0.32, u), h = ease(0.32, 0.52, u), r = ease(0.52, 1.0, u);
            return [0, -0.16 * w + 0.38 * h - 0.22 * r, 0.03 * w - 0.04 * h + 0.01 * r];
          }
        },
        body: {
          q: function (u) {
            var w = ease(0, 0.32, u), h = ease(0.32, 0.52, u), r = ease(0.52, 1.0, u);
            return [0.05 * w - 0.08 * h + 0.03 * r,
              -0.36 * w + 0.80 * h - 0.44 * r,
              -0.04 * w + 0.07 * h - 0.03 * r];
          }
        },
        /* 机炮型：左臂横勾拳，肘部在判定帧伸直到位 */
        armL: {
          q: function (u) {
            var w = ease(0, 0.34, u), h = ease(0.34, 0.56, u), r = ease(0.56, 1.0, u);
            return [-0.10 - 0.42 * w + 0.28 * h + 0.14 * r,
              -0.10 * w + 0.20 * h - 0.10 * r,
              -0.20 - 0.85 * w + 2.40 * h - 1.55 * r];
          }
        },
        forearmL: {
          q: function (u) {
            var w = ease(0, 0.34, u), h = ease(0.34, 0.56, u), r = ease(0.56, 1.0, u);
            return [-0.30 - 0.55 * w + 0.70 * h - 0.15 * r, 0, -0.04 - 0.08 * w + 0.10 * h - 0.02 * r];
          }
        },
        shoulderL: {
          q: function (u) {
            var w = ease(0, 0.34, u), h = ease(0.34, 0.56, u), r = ease(0.56, 1.0, u);
            return [0, 0, -0.07 - 0.08 * w + 0.18 * h - 0.10 * r];
          }
        },
        armR: {
          q: function (u) {
            var w = ease(0, 0.34, u), h = ease(0.34, 0.56, u), r = ease(0.56, 1.0, u);
            return [-0.10 + 0.35 * w - 0.35 * h,
              0.10 * w - 0.14 * h + 0.04 * r,
              0.20 + 0.25 * w - 0.35 * h + 0.10 * r];
          }
        },
        forearmR: { q: function (u) { return [-0.30 - 0.30 * ease(0, 0.34, u) + 0.25 * ease(0.34, 0.56, u), 0, 0.04]; } },
        head: {
          q: function (u) {
            var w = ease(0, 0.30, u), h = ease(0.30, 0.52, u), r = ease(0.52, 1.0, u);
            return [0.03, -0.22 * w + 0.34 * h - 0.12 * r, 0];
          }
        },
        legL: { q: function (u) { return [-0.09 * s(PI * u), 0, 0.03]; } },
        legR: { q: function (u) { return [0.15 * s(PI * u), 0, -0.02]; } },
        shinL: { q: function (u) { return [0.18 * Math.max(0, s(PI * u)), 0, 0]; } },
        shinR: { q: function (u) { return [0.10 * Math.max(0, s(PI * u)), 0, 0]; } }
      }));
    }

    /* 重攻击：全身后摆蓄力 → 髋部带动躯干扭转下砸 → 明显收招硬直
       时长 1.28s 与 moves.heavy（起手0.50 + 判定0.16 + 收招0.62）严格对齐，
       避免逻辑已结束而动画还停在中途造成“姿势硬切”。 */
    clips.push(buildClip('heavy', 1.28, false, {
      hip: {
        q: function (u) {
          var w = u < 0.39 ? (u / 0.39) : 1;
          var hit = Math.min(1, Math.max(0, (u - 0.39) / 0.13));
          var rec = Math.max(0, (u - 0.72) / 0.28);
          return [0, -0.26 * w + 0.5 * hit - 0.24 * rec, 0.05 * w - 0.05 * hit];
        },
        p: function (u) {
          var w = u < 0.39 ? (u / 0.39) : 1;
          var rec = Math.max(0, (u - 0.72) / 0.28);
          return [0, -0.2 * w + rec * 0.2, 0];
        }
      },
      body: {
        q: function (u) {
          var w = u < 0.39 ? (u / 0.39) : 1;
          var hit = Math.min(1, Math.max(0, (u - 0.39) / 0.14));
          var rec = Math.max(0, (u - 0.72) / 0.28);
          return [-0.42 * w + 0.8 * hit - 0.38 * rec,
            0.5 * w - 1.0 * hit + 0.5 * rec,
            0.12 * w - 0.2 * hit];
        }
      },
      armR: {
        q: function (u) {
          var w = u < 0.39 ? (u / 0.39) : 1;
          var hit = Math.min(1, Math.max(0, (u - 0.39) / 0.14));
          var rec = Math.max(0, (u - 0.72) / 0.28);
          return [-2.55 * w + 3.45 * hit - 0.9 * rec, 0.25 * w - 0.25 * hit, -0.28];
        }
      },
      forearmR: { q: function (u) { return [-1.45 * Math.min(1, u / 0.39) + 1.0 * Math.min(1, Math.max(0, (u - 0.39) / 0.14)), 0, 0]; } },
      armL: { q: function (u) { return [0.55 * Math.min(1, u / 0.39) - 0.55 * Math.min(1, Math.max(0, (u - 0.45) / 0.3)), 0, 0.34]; } },
      head: { q: function (u) { return [-0.28 * Math.min(1, u / 0.39) + 0.42 * Math.min(1, Math.max(0, (u - 0.39) / 0.14)), 0.2 * Math.min(1, u / 0.39), 0]; } },
      legL: { q: function (u) { return [-0.22 * s(PI * u), 0, 0.03]; } },
      legR: { q: function (u) { return [0.26 * s(PI * u), 0, -0.03]; } },
      shinL: { q: function (u) { return [0.18 * Math.max(0, s(PI * u)), 0, 0]; } },
      shinR: { q: function (u) { return [0.22 * Math.max(0, s(PI * u)), 0, 0]; } }
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

    /* 必杀技演出：全身重心下压长蓄力 → 释放 → 双刃风暴（2.45s，
       与 moves.ultimate 起手0.90 + 判定0.60 + 收招0.95 完全对齐） */
    clips.push(buildClip('ultimate', 2.45, false, {
      hip: {
        q: function (u) {
          var w = u < 0.37 ? (u / 0.37) : 1;
          var rel = Math.min(1, Math.max(0, (u - 0.37) / 0.09));
          return [0, 0.45 * w - 1.0 * rel, 0];
        },
        p: function (u) {
          var w = u < 0.37 ? (u / 0.37) : 1;
          var rel = Math.min(1, Math.max(0, (u - 0.37) / 0.14));
          return [0, -0.42 * w + 0.26 * rel, 0];
        }
      },
      body: {
        q: function (u) {
          var w = u < 0.37 ? (u / 0.37) : 1;
          var rel = Math.min(1, Math.max(0, (u - 0.37) / 0.09));
          var spin = Math.max(0, (u - 0.62) / 0.38);
          return [-0.4 * w + 0.28 * rel, -TWO_PI * spin, 0];
        }
      },
      armL: {
        q: function (u) {
          var w = Math.min(1, u / 0.37);
          var rel = Math.min(1, Math.max(0, (u - 0.37) / 0.2));
          var ext = Math.min(1, Math.max(0, (u - 0.62) / 0.38));
          return [-2.2 * w + 1.5 * rel, 0, 0.45 - ext * 1.7];
        }
      },
      forearmL: { q: function (u) { return [-1.6 * Math.min(1, u / 0.37) + 0.5 * Math.min(1, Math.max(0, (u - 0.45) / 0.18)), 0, 0]; } },
      armR: {
        q: function (u) {
          var w = Math.min(1, u / 0.37);
          var rel = Math.min(1, Math.max(0, (u - 0.37) / 0.2));
          var ext = Math.min(1, Math.max(0, (u - 0.62) / 0.38));
          return [-2.2 * w + 1.5 * rel, 0, -0.45 + ext * 1.7];
        }
      },
      forearmR: { q: function (u) { return [-1.6 * Math.min(1, u / 0.37) + 0.5 * Math.min(1, Math.max(0, (u - 0.45) / 0.18)), 0, 0]; } },
      head: { q: function (u) { return [-0.34 * Math.min(1, u / 0.37) + 0.5 * Math.min(1, Math.max(0, (u - 0.4) / 0.12)), 0, 0]; } },
      legL: { q: function (u) { return [0.55 * Math.min(1, u / 0.37) - 0.2 * Math.min(1, Math.max(0, (u - 0.4) / 0.15)), 0, 0.18]; } },
      legR: { q: function (u) { return [0.55 * Math.min(1, u / 0.37) - 0.2 * Math.min(1, Math.max(0, (u - 0.4) / 0.15)), 0, -0.18]; } },
      shinL: { q: function (u) { return [0.35 * Math.min(1, u / 0.37), 0, 0]; } },
      shinR: { q: function (u) { return [0.35 * Math.min(1, u / 0.37), 0, 0]; } }
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
      foreL: { q: function (u) { return [-0.42 + s(u * TWO_PI) * 0.035, 0, 0.16]; } },
      foreR: { q: function (u) { return [-0.42 + s(u * TWO_PI + 0.6) * 0.035, 0, -0.16]; } }
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
      /* 躯干先后坐蓄力，再随咬合前扑，避免头部单独瞬移 */
      torso: {
        q: function (u) {
          var w = u < 0.32 ? (u / 0.32) : 1;
          var lunge = Math.min(1, Math.max(0, (u - 0.32) / 0.16));
          return [0.1 - 0.16 * w + 0.46 * lunge, 0, 0];
        }
      },
      hip: {
        q: function (u) {
          var lunge = Math.min(1, Math.max(0, (u - 0.32) / 0.16));
          return [0, 0.18 * lunge, 0];
        },
        p: function (u) {
          var lunge = Math.min(1, Math.max(0, (u - 0.32) / 0.16));
          return [0, 0, 0.18 * lunge];
        }
      }
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
    /* 颜色贴图需 SRGB；数据贴图（roughnessMap / normalMap）保持线性空间 */
    if (!linear) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
    var UT = AC.unitTexture || {};
    t.anisotropy = UT.anisotropy || 8;   // 斜视角下装甲/鳞片不再糊成一片
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    return t;
  }
  function hex(col) { return '#' + new THREE.Color(col).getHexString(); }

  /* 由高度图（灰度 canvas）生成法线贴图：Sobel 求梯度 → 切线空间法线。
     用于给程序化装甲/甲壳增加真实的凹凸高光，替代强度有限的 bumpMap。 */
  function heightToNormal(srcCanvas, strength) {
    var w = srcCanvas.width, h = srcCanvas.height;
    var src = srcCanvas.getContext('2d').getImageData(0, 0, w, h).data;
    var lum = new Float32Array(w * h);
    var i;
    for (i = 0; i < w * h; i++) {
      lum[i] = (src[i * 4] * 0.299 + src[i * 4 + 1] * 0.587 + src[i * 4 + 2] * 0.114) / 255;
    }
    function L(x, y) {
      x = (x + w) % w; y = (y + h) % h;
      return lum[y * w + x];
    }
    var out = makeCanvas(w, h);
    var octx = out.getContext('2d');
    var img = octx.createImageData(w, h);
    var s = strength === undefined ? 1 : strength;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var dx = (L(x + 1, y) - L(x - 1, y)) * s;
        var dy = (L(x, y + 1) - L(x, y - 1)) * s;
        var nx = -dx, ny = dy, nz = 1;          // 画布 y 向下 → 绿色通道取反
        var len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        var o = (y * w + x) * 4;
        img.data[o] = (nx / len * 0.5 + 0.5) * 255;
        img.data[o + 1] = (ny / len * 0.5 + 0.5) * 255;
        img.data[o + 2] = (nz / len * 0.5 + 0.5) * 255;
        img.data[o + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    return canvasTexture(out, null, true);
  }

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
    var UT = AC.unitTexture || {};
    var MAP = UT.mapSize || 1024;         // 颜色贴图（近距离细节）
    var DET = UT.detailSize || 512;       // 法线/粗糙度贴图
    var mScale = MAP / 512, dScale = DET / 256;
    var NS = UT.normalStrength || {};

    if (kind === 'kaiju') {
      /* --- 生物皮肤：斑驳鳞片 --- */
      var kc = makeCanvas(MAP, MAP), kg = kc.getContext('2d');
      kg.scale(mScale, mScale);
      kg.fillStyle = '#e8e8e8'; kg.fillRect(0, 0, 512, 512);
      /* 大块深浅斑：先铺生物体表的明暗分区 */
      for (var blot = 0; blot < 46; blot++) {
        var bl = U.randInt(72, 168);
        kg.fillStyle = 'rgba(' + bl + ',' + bl + ',' + bl + ',' + U.rand(0.09, 0.23).toFixed(2) + ')';
        kg.beginPath();
        kg.ellipse(U.rand(0, 512), U.rand(0, 512), U.rand(28, 92), U.rand(18, 55), Math.random() * 3, 0, Math.PI * 2);
        kg.fill();
      }
      for (var i = 0; i < 2600; i++) {
        var v = U.randInt(0, 70);
        var lum = 210 - v;
        kg.fillStyle = 'rgba(' + lum + ',' + lum + ',' + lum + ',' + U.rand(0.09, 0.24).toFixed(2) + ')';
        kg.beginPath();
        kg.ellipse(U.rand(0, 512), U.rand(0, 512), U.rand(2.5, 9), U.rand(1.8, 5.5), Math.random() * 3, 0, Math.PI * 2);
        kg.fill();
      }
      /* 不规则鳞片：逐行错位、尺寸和朝向随机，避免等距圆点形成“编织篮” */
      var kRows = 34, kCols = 26;
      for (var ky = 0; ky < kRows; ky++) {
        var kyy = (ky + 0.5) * (512 / kRows) + U.rand(-2.5, 2.5);
        var kOff = (ky % 2) * 0.5;
        for (var kx = 0; kx < kCols; kx++) {
          var kxx = (kx + 0.5 + kOff) * (512 / kCols) + U.rand(-4.5, 4.5);
          var krw = U.rand(6.0, 13.5);
          var krh = krw * U.rand(0.52, 0.92);
          var krot = U.rand(-0.55, 0.55);
          var kbase = U.randInt(146, 208);
          kg.fillStyle = 'rgba(' + kbase + ',' + kbase + ',' + kbase + ',' + U.rand(0.20, 0.36).toFixed(2) + ')';
          kg.beginPath(); kg.ellipse(kxx, kyy, krw, krh, krot, 0, Math.PI * 2); kg.fill();
          /* 下缘压暗、上缘提亮：单颗鳞片就有圆度 */
          kg.strokeStyle = 'rgba(66,66,66,' + U.rand(0.16, 0.32).toFixed(2) + ')';
          kg.lineWidth = 0.9;
          kg.beginPath(); kg.ellipse(kxx, kyy, krw, krh, krot, Math.PI * 0.05, Math.PI * 1.08); kg.stroke();
          kg.strokeStyle = 'rgba(255,255,255,' + U.rand(0.10, 0.20).toFixed(2) + ')';
          kg.lineWidth = 0.7;
          kg.beginPath(); kg.ellipse(kxx, kyy - krh * 0.16, krw * 0.80, krh * 0.68, krot, Math.PI * 1.12, Math.PI * 1.90); kg.stroke();
        }
      }
      /* 长皱纹：跨越整片鳞区的深沟，打断规则网格 */
      for (var kw = 0; kw < 44; kw++) {
        var kwx = U.rand(0, 512), kwy = U.rand(0, 512);
        var kang = U.rand(0, Math.PI * 2), klen = U.rand(30, 96);
        var kmx = kwx + Math.cos(kang) * klen * 0.5 + U.rand(-16, 16);
        var kmy = kwy + Math.sin(kang) * klen * 0.5 + U.rand(-16, 16);
        var kex = kwx + Math.cos(kang) * klen, key = kwy + Math.sin(kang) * klen;
        kg.strokeStyle = 'rgba(70,70,70,' + U.rand(0.14, 0.30).toFixed(2) + ')';
        kg.lineWidth = U.rand(1.1, 2.6);
        kg.beginPath(); kg.moveTo(kwx, kwy); kg.quadraticCurveTo(kmx, kmy, kex, key); kg.stroke();
        kg.strokeStyle = 'rgba(255,255,255,0.09)';
        kg.lineWidth = 0.9;
        kg.beginPath(); kg.moveTo(kwx, kwy - 1.4); kg.quadraticCurveTo(kmx, kmy - 1.4, kex, key - 1.4); kg.stroke();
      }
      /* 疣粒 / 毛孔：近看才有，远看不形成网格 */
      for (var kp = 0; kp < 420; kp++) {
        var kpx = U.rand(0, 512), kpy = U.rand(0, 512), kpr = U.rand(0.9, 2.8);
        kg.fillStyle = 'rgba(72,72,72,' + U.rand(0.18, 0.36).toFixed(2) + ')';
        kg.beginPath(); kg.arc(kpx, kpy, kpr, 0, Math.PI * 2); kg.fill();
        kg.fillStyle = 'rgba(235,235,235,0.14)';
        kg.beginPath(); kg.arc(kpx - kpr * 0.4, kpy - kpr * 0.4, kpr * 0.45, 0, Math.PI * 2); kg.fill();
      }
      set.map = canvasTexture(kc);

      /* 粗糙度：整体偏粗糙，局部有光滑膜感 */
      var krc = makeCanvas(DET, DET), krg = krc.getContext('2d');
      krg.scale(dScale, dScale);
      krg.fillStyle = '#cfcfcf'; krg.fillRect(0, 0, 256, 256);
      for (var j = 0; j < 260; j++) {
        krg.fillStyle = 'rgba(' + U.randInt(90, 240) + ',' + U.randInt(90, 240) + ',' + U.randInt(90, 240) + ',' + U.rand(0.2, 0.5).toFixed(2) + ')';
        krg.beginPath(); krg.ellipse(U.rand(0, 256), U.rand(0, 256), U.rand(5, 18), U.rand(4, 12), 0, 0, Math.PI * 2); krg.fill();
      }
      set.roughnessMap = canvasTexture(krc, null, true);

      /* 高度图：错位鳞片凸起 + 皱纹凹陷，与颜色图同一套不规则布局 → 转法线贴图 */
      var khc = makeCanvas(DET, DET), khg = khc.getContext('2d');
      khg.scale(dScale, dScale);
      khg.fillStyle = '#8a8a8a'; khg.fillRect(0, 0, 256, 256);
      var hRows = 30, hCols = 22;
      for (var hy = 0; hy < hRows; hy++) {
        var hyy = (hy + 0.5) * (256 / hRows) + U.rand(-1.5, 1.5);
        var hOff = (hy % 2) * 0.5;
        for (var hx = 0; hx < hCols; hx++) {
          var hxx = (hx + 0.5 + hOff) * (256 / hCols) + U.rand(-2.2, 2.2);
          var hrw = U.rand(3.2, 6.8);
          var hrh = hrw * U.rand(0.52, 0.92);
          var hrot = U.rand(-0.55, 0.55);
          khg.fillStyle = 'rgba(' + U.randInt(150, 196) + ',' + U.randInt(150, 196) + ',' + U.randInt(150, 196) + ',0.85)';
          khg.beginPath(); khg.ellipse(hxx, hyy, hrw, hrh, hrot, 0, Math.PI * 2); khg.fill();
          khg.strokeStyle = 'rgba(52,52,52,' + U.rand(0.35, 0.6).toFixed(2) + ')';
          khg.lineWidth = U.rand(0.8, 1.5);
          khg.beginPath(); khg.ellipse(hxx, hyy, hrw, hrh, hrot, Math.PI * 0.05, Math.PI * 1.08); khg.stroke();
        }
      }
      for (var hw = 0; hw < 40; hw++) {
        var hwx = U.rand(0, 256), hwy = U.rand(0, 256);
        var hang = U.rand(0, Math.PI * 2), hlen = U.rand(16, 52);
        khg.strokeStyle = 'rgba(44,44,44,' + U.rand(0.35, 0.65).toFixed(2) + ')';
        khg.lineWidth = U.rand(1.0, 2.2);
        khg.beginPath(); khg.moveTo(hwx, hwy);
        khg.quadraticCurveTo(hwx + Math.cos(hang) * hlen * 0.5 + U.rand(-8, 8), hwy + Math.sin(hang) * hlen * 0.5 + U.rand(-8, 8), hwx + Math.cos(hang) * hlen, hwy + Math.sin(hang) * hlen);
        khg.stroke();
      }
      set.normalMap = heightToNormal(khc, NS.kaiju || 1.15);
    } else {
      /* --- 机甲装甲：面板线 + 铆钉 + 磨损 --- */
      var mc = makeCanvas(MAP, MAP), mg = mc.getContext('2d');
      mg.scale(mScale, mScale);
      mg.fillStyle = '#f2f2f2'; mg.fillRect(0, 0, 512, 512);
      /* 面板缝隙 */
      mg.strokeStyle = 'rgba(62,62,62,0.72)'; mg.lineWidth = 2.4;
      for (var gy = 0; gy <= 512; gy += 64) { mg.beginPath(); mg.moveTo(0, gy); mg.lineTo(512, gy); mg.stroke(); }
      for (var gx = 0; gx <= 512; gx += 64) { mg.beginPath(); mg.moveTo(gx, 0); mg.lineTo(gx, 512); mg.stroke(); }
      mg.strokeStyle = 'rgba(80,80,80,0.5)'; mg.lineWidth = 1.2;
      for (var sy = 32; sy <= 480; sy += 64) {
        for (var sx = 32; sx <= 480; sx += 64) { mg.beginPath(); mg.moveTo(sx, sy); mg.lineTo(sx + 40, sy); mg.stroke(); }
      }
      /* 铆钉 */
      mg.fillStyle = 'rgba(52,52,52,0.7)';
      for (var ny = 0; ny <= 512; ny += 64) {
        for (var nx = 0; nx <= 512; nx += 64) {
          for (var rv = 0; rv < 3; rv++) { mg.beginPath(); mg.arc(nx + U.rand(8, 56), ny + U.rand(8, 56), 2.2, 0, Math.PI * 2); mg.fill(); }
        }
      }
      /* 划痕 / 污渍 */
      mg.strokeStyle = 'rgba(255,255,255,0.35)'; mg.lineWidth = 1;
      for (var sc = 0; sc < 140; sc++) {
        var lx = U.rand(0, 512), ly = U.rand(0, 512);
        mg.beginPath(); mg.moveTo(lx, ly); mg.lineTo(lx + U.rand(-24, 24), ly + U.rand(-6, 6)); mg.stroke();
      }
      for (var dt = 0; dt < 120; dt++) {
        mg.fillStyle = 'rgba(40,40,40,' + U.rand(0.04, 0.14).toFixed(2) + ')';
        mg.fillRect(U.rand(0, 512), U.rand(0, 512), U.rand(1, 4), U.rand(1, 4));
      }
      set.map = canvasTexture(mc);

      /* 粗糙度：基板较光滑，缝线/磨损处更粗糙 */
      var mrc = makeCanvas(DET, DET), mrg = mrc.getContext('2d');
      mrg.scale(dScale, dScale);
      mrg.fillStyle = '#8a8a8a'; mrg.fillRect(0, 0, 256, 256);
      for (var mr = 0; mr < 180; mr++) {
        mrg.fillStyle = 'rgba(' + U.randInt(120, 240) + ',' + U.randInt(120, 240) + ',' + U.randInt(120, 240) + ',' + U.rand(0.15, 0.4).toFixed(2) + ')';
        mrg.fillRect(U.rand(0, 256), U.rand(0, 256), U.rand(4, 30), U.rand(2, 10));
      }
      mrg.strokeStyle = 'rgba(230,230,230,0.5)'; mrg.lineWidth = 2;
      for (var mry = 0; mry <= 256; mry += 32) { mrg.beginPath(); mrg.moveTo(0, mry); mrg.lineTo(256, mry); mrg.stroke(); }
      for (var mrx = 0; mrx <= 256; mrx += 32) { mrg.beginPath(); mrg.moveTo(mrx, 0); mrg.lineTo(mrx, 256); mrg.stroke(); }
      set.roughnessMap = canvasTexture(mrc, null, true);

      /* 高度图：面板凹槽 + 铆钉凸点 + 划痕 → 法线贴图（斜视时高光沿凹槽走） */
      var mhc = makeCanvas(DET, DET), mhg = mhc.getContext('2d');
      mhg.scale(dScale, dScale);
      mhg.fillStyle = '#9a9a9a'; mhg.fillRect(0, 0, 256, 256);
      /* 凹槽 */
      mhg.strokeStyle = '#2c2c2c'; mhg.lineWidth = 3;
      for (var mhy = 0; mhy <= 256; mhy += 32) { mhg.beginPath(); mhg.moveTo(0, mhy); mhg.lineTo(256, mhy); mhg.stroke(); }
      for (var mhx = 0; mhx <= 256; mhx += 32) { mhg.beginPath(); mhg.moveTo(mhx, 0); mhg.lineTo(mhx, 256); mhg.stroke(); }
      /* 铆钉 */
      mhg.fillStyle = '#e8e8e8';
      for (var rhy = 0; rhy <= 256; rhy += 32) {
        for (var rhx = 0; rhx <= 256; rhx += 32) {
          for (var rv2 = 0; rv2 < 3; rv2++) {
            mhg.beginPath(); mhg.arc(rhx + U.rand(4, 28), rhy + U.rand(4, 28), 1.6, 0, Math.PI * 2); mhg.fill();
          }
        }
      }
      /* 磕碰浅坑 */
      mhg.fillStyle = '#656565';
      for (var dg = 0; dg < 40; dg++) {
        mhg.beginPath(); mhg.arc(U.rand(0, 256), U.rand(0, 256), U.rand(1, 3), 0, Math.PI * 2); mhg.fill();
      }
      set.normalMap = heightToNormal(mhc, NS.mecha || 0.85);
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
    /* 远景楼宇窗光贴图：墙体与窗光分离
     *   map      —— 墙体基色 + 窗户颜色
     *   emissive —— 仅窗户发光，避免整栋楼像灯箱一样把夜空刷亮 */
    var c = makeCanvas(128, 256), g = c.getContext('2d');
    var ce = makeCanvas(128, 256), ge = ce.getContext('2d');
    g.fillStyle = hex(PAL.buildingA); g.fillRect(0, 0, 128, 256);
    ge.fillStyle = '#000000'; ge.fillRect(0, 0, 128, 256);
    for (var y = 0; y < 256; y += 8) {
      for (var x = 0; x < 128; x += 8) {
        var r = Math.random();
        if (r < 0.22) {
          var wc = r < 0.16 ? hex(PAL.windowWarm) : hex(PAL.windowCold);
          var wa = U.rand(0.3, 0.95);
          g.fillStyle = wc; g.globalAlpha = wa;
          g.fillRect(x + 2, y + 2, 4, 4);
          g.globalAlpha = 1;
          ge.fillStyle = wc; ge.globalAlpha = wa;
          ge.fillRect(x + 2, y + 2, 4, 4);
          ge.globalAlpha = 1;
        } else if (r < 0.34) {
          g.fillStyle = '#0d1114'; g.fillRect(x + 2, y + 2, 4, 4);
        }
      }
    }
    tex.window = { map: canvasTexture(c), emissive: canvasTexture(ce) };

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
    g3.strokeStyle = 'rgba(190,188,172,0.34)'; g3.lineWidth = 9; g3.setLineDash([30, 36]);
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
      map: tex.window.map, emissiveMap: tex.window.emissive, emissive: 0xffffff,
      emissiveIntensity: (AC.building && AC.building.emissiveIntensity) || 0.42,
      color: 0xb9c2c6, metalness: 0.5, roughness: 0.66
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
        map: tex.ground, color: 0x161c20,
        metalness: F.wetMetalness !== undefined ? F.wetMetalness : 0.22,
        roughness: F.wetRoughness !== undefined ? F.wetRoughness : 0.56,
        envMapIntensity: 0.38
      })
    );
    g.rotation.x = -Math.PI / 2;
    g.position.set(0, 0, -60);
    g.receiveShadow = true;
    g.name = 'ground';
    city.group.add(g);
    city.ground = g;

    /* 积水：低粗糙度圆面借 IBL 反射城市灯光，让地面不再是均匀灰板 */
    var puddleMat = new THREE.MeshStandardMaterial({
      color: 0x0c1a20, metalness: 1.0, roughness: 0.035,
      transparent: true, opacity: 0.72, depthWrite: false, envMapIntensity: 1.45
    });
    for (var p = 0; p < 9; p++) {
      var puddle = new THREE.Mesh(new THREE.CircleGeometry(1, 22), puddleMat);
      puddle.rotation.x = -Math.PI / 2;
      puddle.position.set(U.rand(-30, 30), 0.012 + p * 0.0004, U.rand(-16, 10));
      puddle.scale.set(U.rand(2.2, 6.5), U.rand(1.1, 3.2), 1);
      puddle.renderOrder = 1;
      city.group.add(puddle);
    }
  }

  /* --- 路灯 / 路障 / 车辆 / 碎石 --- */
  function buildProps(city, tex) {
    var poleMat = Models._mat(0x1e2428, { metalness: 0.7, roughness: 0.5 });
    var lampGlow = Models._glowMat(PAL.lampLight, 1.15);
    var barrierMat = Models._mat(PAL.barrier, { metalness: 0.2, roughness: 0.7 });
    var carMat = Models._mat(0x1a1f23, { metalness: 0.75, roughness: 0.45 });
    var rubbleMat = Models._mat(0x33383b, { roughness: 0.95, flat: true });
    for (var i = 0; i < 6; i++) {
      var x = U.rand(19, 42) * (i % 2 ? 1 : -1), z = U.rand(-24, -5); // 灯杆退到场地两侧，不切断双方构图
      var lamp = new THREE.Group();
      lamp.position.set(x, 0, z);
      Models._cyl(lamp, 0.32, 0.4, 11, poleMat, 0, 5.5, 0, 8);
      Models._box(lamp, 2.2, 0.5, 1.0, poleMat, 1.0, 11, 0);
      Models._box(lamp, 1.6, 0.18, 0.8, lampGlow, 1.0, 10.7, 0);
      city.group.add(lamp);
      city.propsUsed = (city.propsUsed || 0) + 1;
    }
    for (var b = 0; b < 7; b++) {
      var bx = U.rand(14, 40) * (b % 2 ? 1 : -1), bz = U.rand(-16, 0);
      var bry = U.rand(-0.4, 0.4);
      var bar = Models._box(city.group, 2.6, 0.9, 0.55, barrierMat, bx, 0.45, bz, bry);
      bar.castShadow = true;
      /* 白色反光条：让路障不再是一块纯红方砖 */
      Models._box(city.group, 2.3, 0.14, 0.02, Models._mat(0xd9d4c8, { roughness: 0.6 }),
        bx + Math.sin(bry) * 0.285, 0.62, bz + Math.cos(bry) * 0.285, bry);
    }
    for (var v = 0; v < 5; v++) {
      var vx = U.rand(-42, 42), vz = U.rand(-17, -4);
      if (Math.abs(vx) < 11) vx += 15;
      var car = new THREE.Group();
      car.position.set(vx, 0, vz);
      car.rotation.y = U.rand(-0.6, 0.6);
      Models._box(car, 4.4, 1.4, 9.0, carMat, 0, 0.85, 0);
      Models._box(car, 4.0, 1.0, 4.2, carMat, 0, 2.0, -0.4);
      Models._box(car, 0.3, 0.3, 0.3, Models._glowMat(PAL.emberOrange, 1.2), -1.4, 1.05, 4.4);
      Models._box(car, 0.3, 0.3, 0.3, Models._glowMat(PAL.emberOrange, 1.2), 1.4, 1.05, 4.4);
      city.group.add(car);
    }
    for (var r = 0; r < 24; r++) {
      var rx = U.rand(16, 46) * (r % 2 ? 1 : -1), rz = U.rand(-18, 1);
      var chunk = Models.createDebrisMesh({ x: U.rand(0.4, 1.15), y: U.rand(0.2, 0.55), z: U.rand(0.4, 1.15) }, 0x23282b);
      /* 碎石半埋进路面：抬高只留 1/3 体量，避免战场中出现浮空黑块 */
      chunk.position.set(rx, 0.08, rz);
      chunk.rotation.set(U.rand(-0.25, 0.25), U.rand(0, 6.28), U.rand(-0.25, 0.25));
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
      var rpos = new Float32Array(rc * 6);          // 每滴雨两个顶点 → 线段雨丝
      var area = R.area || { x: 140, z: 120 };
      var hmin = R.heightMin || 2, hmax = R.heightMax || 46;
      var streak = R.streakLen || 2.2;
      var rainWind = (R.wind || -3.5) * 0.055;
      for (var rp = 0; rp < rc; rp++) {
        var rv = rp * 6;
        var rx0 = U.rand(-area.x, area.x);
        var ry0 = U.rand(hmin, hmax);
        var rz0 = U.rand(-area.z * 0.5, area.z * 1.2);
        rpos[rv] = rx0; rpos[rv + 1] = ry0; rpos[rv + 2] = rz0;
        rpos[rv + 3] = rx0 + rainWind; rpos[rv + 4] = ry0 - streak; rpos[rv + 5] = rz0 + 0.04;
      }
      var rgeo = new THREE.BufferGeometry();
      rgeo.setAttribute('position', new THREE.BufferAttribute(rpos, 3));
      var rmat = new THREE.LineBasicMaterial({
        color: 0xaacbea, transparent: true,
        opacity: R.opacity || 0.42, depthWrite: false
      });
      var rainPts = new THREE.LineSegments(rgeo, rmat);
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
      /* 画质缩放：只更新/绘制前 N 颗雨滴（同一 buffer 复用，不重建几何体、不新建对象） */
      var rscale = this.rainScale != null ? this.rainScale : 1;
      var rverts = this.rain.geometry.attributes.position.count;
      var rdraw = Math.max(2, Math.floor(rverts * rscale / 2) * 2);
      if (this.rain.geometry.drawRange.count !== rdraw) this.rain.geometry.drawRange.count = rdraw;
      var streak = Rcfg.streakLen || 2.2;
      /* rdraw 是顶点数，position.array 是 float 数组：每次跨 6 个 float 处理一对端点 */
      for (i = 0; i < rdraw * 3; i += 6) {
        rarr[i + 1] -= dt * fall;
        rarr[i + 4] -= dt * fall;
        rarr[i] += dt * wind;
        rarr[i + 3] += dt * wind;
        if (rarr[i + 1] < 0.2) {
          var nx = U.rand(-rarea.x, rarea.x);
          var nz = U.rand(-rarea.z * 0.5, rarea.z * 1.2);
          rarr[i] = nx; rarr[i + 1] = rmax; rarr[i + 2] = nz;
          rarr[i + 3] = nx + wind * 0.055; rarr[i + 4] = rmax - streak; rarr[i + 5] = nz + 0.04;
        }
        if (rarr[i] < -rarea.x) { rarr[i] = rarea.x; rarr[i + 3] = rarea.x + wind * 0.055; }
        else if (rarr[i] > rarea.x) { rarr[i] = -rarea.x; rarr[i + 3] = -rarea.x + wind * 0.055; }
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
    /* 地面溅水点闪烁 */
    if (this.splashes) {
      /* 溅水点数量随画质缩减（隐藏的网格不再参与绘制，省 draw call） */
      var splScale = this.rainScale != null ? this.rainScale : 1;
      var splOn = Math.max(10, Math.floor(this.splashes.length * splScale));
      for (i = 0; i < this.splashes.length; i++) {
        var sp = this.splashes[i];
        if (i >= splOn) { if (sp.visible) sp.visible = false; continue; }
        if (!sp.visible) sp.visible = true;
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
    /* 雷电（低频，双闪更真实） */
    if (ART.atmosphere.distantLightning && this._flashLight) {
      this._lightningTimer -= dt;
      if (this._lightningTimer <= 0) {
        this._lightningTimer = U.rand(4.5, 12);
        this._flash = 1;
        this._flash2 = 0;   /* 第二次闪 */
      }
      if (this._flash > 0) {
        this._flash = Math.max(0, this._flash - dt * 2.4);
        var f = this._flash > 0.75 ? 1 : this._flash * 1.3;
        this._flashLight.intensity = f * 4.5;
        this._flashPlane.material.opacity = f * 0.4;
        /* 主闪衰减到一半时触发第二次较弱闪 */
        if (this._flash < 0.5 && this._flash2 === 0) this._flash2 = 0.6;
      }
      if (this._flash2 > 0) {
        this._flash2 = Math.max(0, this._flash2 - dt * 3.0);
        this._flashLight.intensity = Math.max(this._flashLight.intensity, this._flash2 * 2.2);
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
