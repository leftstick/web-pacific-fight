/* =============================================================================
 * main.js  ──  游戏入口与主循环
 * 依赖：config.js / combat.js / models.js / physics.js / input.js /
 *       renderer.js / player.js / enemy.js / ui.js
 * 加载方式：普通 <script>，由 index.html 末尾的 ES module 注入 THREE 后调用 boot()
 *
 * 状态机：loading → menu ⇄ select / help → fight → (pause) → result → menu
 * ========================================================================== */
(function (global) {
  'use strict';

  var GAME = global.GAME;
  var U = GAME.U;
  var CONFIG = GAME.CONFIG;
  var C = CONFIG.combat;
  var RE = CONFIG.render;
  var UI_CFG = CONFIG.ui;

  var M = {
    three: null,
    addons: null,
    canvas: null,
    state: 'loading',
    player: null,
    enemy: null,
    models: {},            // def.id → {root, clips, isPlaceholder}  战斗用
    previewModels: {},     // def.id → {root}                        选机预览用
    selection: { mecha: 0, kaiju: 0 },
    difficulty: CONFIG.ai.difficulty,
    elapsed: 0,
    lastTime: 0,
    koTimer: 0,
    slowMo: 0,
    timers: [],
    preview: { renderer: null, scene: null, camera: null, canvas: null, angle: 0, group: null },
    _booted: false
  };

  /* ======================================================================== */
  /* 音效：程序化 WebAudio（无外部音频文件）                                   */
  /* ======================================================================== */
  var Audio = global.GAME.Audio = {
    ctx: null, master: null, ready: false, noiseBuffer: null, ambient: null,

    /* 浏览器要求用户交互后才能播放音频 */
    unlock: function () {
      if (this.ready && this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC || !CONFIG.audio.enabled) return;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = CONFIG.audio.masterVolume;
        this.master.connect(this.ctx.destination);
        this._buildNoise();
        this._startAmbient();
        this.ready = true;
      } catch (e) { console.warn('[Audio] 初始化失败，已静音', e); }
    },

    _buildNoise: function () {
      var len = Math.floor(this.ctx.sampleRate * 1.2);
      var buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buf;
    },

    /* 低频环境轰鸣：城市远处的战斗余韵 */
    _startAmbient: function () {
      var ctx = this.ctx;
      var src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer; src.loop = true;
      var filt = ctx.createBiquadFilter();
      filt.type = 'lowpass'; filt.frequency.value = 110;
      var g = ctx.createGain(); g.gain.value = CONFIG.audio.ambientVolume * 0.25;
      src.connect(filt); filt.connect(g); g.connect(this.master);
      src.start();
      this.ambient = g;
    },

    play: function (name, opts) {
      if (!this.ready || !this.ctx || !CONFIG.audio.enabled) return;
      var s = CONFIG.audio.sounds[name];
      if (!s) return;
      opts = opts || {};
      var ctx = this.ctx, t = ctx.currentTime;
      var dur = (opts.duration || s.dur) * 1.0;
      var gain = (opts.gain || s.gain) * CONFIG.audio.sfxVolume;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), t + Math.min(0.02, dur * 0.2));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      if (s.type === 'noise') {
        var src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        var f = ctx.createBiquadFilter();
        f.type = 'bandpass'; f.frequency.value = s.freq * U.rand(0.9, 1.1); f.Q.value = 0.9;
        src.connect(f); f.connect(g);
        src.start(t); src.stop(t + dur);
      } else {
        var osc = ctx.createOscillator();
        osc.type = s.type;
        osc.frequency.setValueAtTime(s.freq, t);
        osc.frequency.exponentialRampToValueAtTime(Math.max(30, s.freq * 0.4), t + dur);
        osc.connect(g);
        osc.start(t); osc.stop(t + dur);
      }
      g.connect(this.master);
    },

    setVolume: function (v) {
      CONFIG.audio.masterVolume = U.clamp(v, 0, 1);
      if (this.master) this.master.gain.value = CONFIG.audio.masterVolume;
    }
  };

  /* ======================================================================== */
  /* 主控                                                                     */
  /* ======================================================================== */
  var Main = GAME.Main = {

    /* ----------------------------- 启动 ---------------------------------- */
    boot: function (opts) {
      if (M._booted) return;
      M._booted = true;
      opts = opts || {};
      var THREE = M.three = opts.three;
      M.addons = opts.addons || {};
      if (!THREE) { console.error('[Main] 未注入 THREE'); return; }

      GAME.Input.init(global);
      GAME.UI.init({ input: GAME.Input, renderer: GAME.Renderer });
      GAME.UI.showScreen('loading');
      GAME.UI.setLoadingProgress(0.04, '初始化渲染器');

      M.canvas = document.getElementById('game-canvas');
      GAME.Renderer.init(THREE, M.addons, M.canvas);
      GAME.UI.renderer = GAME.Renderer;
      Main.resize();
      global.addEventListener('resize', Main.resize);

      /* 音频解锁（首次交互） */
      var unlock = function () { Audio.unlock(); };
      global.addEventListener('pointerdown', unlock, { once: true });
      global.addEventListener('keydown', unlock, { once: true });

      Main.bindEvents();
      Main.startLoop();

      GAME.UI.setLoadingProgress(0.12, '初始化物理世界');
      GAME.Physics.init({ three: THREE, arena: CONFIG.arena, gravity: CONFIG.arena.gravity })
        .then(function (ok) {
          if (!ok) console.warn('[Main] Ammo.js 不可用，使用轻量物理回退');
          return Main.loadModels();
        })
        .then(function () {
          Main.preparePreview();
          GAME.UI.setLoadingProgress(1, UI_CFG.texts.loading + ' · 完成');
          global.setTimeout(function () {
            M.state = 'menu';
            GAME.UI.showScreen('menu');
            GAME.UI.setControllerStatus();
          }, 420);
        })
        .catch(function (e) {
          console.error('[Main] 加载失败', e);
          Main.fatal('资源加载失败：' + (e && e.message ? e.message : e));
        });
    },

    fatal: function (msg) {
      if (global.__GAME_FATAL__) global.__GAME_FATAL__(msg);
      else console.error(msg);
    },

    /* --------------------------- 载入全部单位模型 -------------------------- */
    loadModels: function () {
      var defs = CONFIG.units.mechas.concat(CONFIG.units.kaiju);
      var total = defs.length || 1, done = 0;
      return Promise.all(defs.map(function (def) {
        return GAME.Models.prepareUnit(def).then(function (prepared) {
          M.models[def.id] = prepared;
          done++;
          GAME.UI.setLoadingProgress(0.12 + 0.82 * (done / total), '载入模型 · ' + def.name);
        });
      }));
    },

    /* ----------------------------- 选机预览 ------------------------------ */
    preparePreview: function () {
      var THREE = M.three;
      var host = document.getElementById('select-preview');
      if (!host || !THREE) return;
      var canvas = document.createElement('canvas');
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.display = 'block';
      host.appendChild(canvas);
      M.preview.canvas = canvas;
      var pr = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
      /* 预览是静态展示，允许比战斗更高的采样密度，保证边缘不锯齿、贴图不糊 */
      pr.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2.25));
      pr.toneMapping = THREE.ACESFilmicToneMapping;
      pr.toneMappingExposure = 1.22;
      pr.outputColorSpace = THREE.SRGBColorSpace;
      M.preview.renderer = pr;

      var scene = new THREE.Scene();
      M.preview.scene = scene;
      var cam = new THREE.PerspectiveCamera(34, 1, 0.5, 300);
      cam.position.set(0, 8.6, 26);
      cam.lookAt(0, 6.2, 0);
      M.preview.camera = cam;

      /* IBL 环境反射：金属装甲没有环境贴图会渲染成死黑色块 */
      var ad = M.addons || {};
      if (ad.RoomEnvironment && THREE.PMREMGenerator) {
        try {
          var pmrem = new THREE.PMREMGenerator(pr);
          var room = new ad.RoomEnvironment();
          var rt = pmrem.fromScene(room, 0.03);
          scene.environment = rt.texture;
          if ('environmentIntensity' in scene) scene.environmentIntensity = 0.9;
          if (room.dispose) room.dispose();
          pmrem.dispose();
          M.preview.envRT = rt;
        } catch (e) { console.warn('[Preview] IBL 生成失败，使用直射光', e && e.message); }
      }

      scene.add(new THREE.AmbientLight(0x50606e, 1.15));
      var key = new THREE.DirectionalLight(0xffffff, 2.6);
      key.position.set(-13, 24, 16);
      scene.add(key);
      var rim = new THREE.DirectionalLight(PALAccent(), 1.9);
      rim.position.set(17, 11, -13);
      scene.add(rim);
      /* 冷色底部补光：勾出装甲下缘，避免整体变成平面剪影 */
      var fill = new THREE.DirectionalLight(0x6fd0ff, 0.75);
      fill.position.set(4, -8, 12);
      scene.add(fill);

      /* 预览用模型：与战斗用模型独立，避免同一 Object3D 归属两个场景 */
      var group = new THREE.Group();
      scene.add(group);
      M.preview.group = group;

      /* 脚下软阴影：没有接触阴影时模型会像浮在空中的色块 */
      var shTex = (function () {
        var c = document.createElement('canvas'); c.width = c.height = 128;
        var g = c.getContext('2d');
        var grd = g.createRadialGradient(64, 64, 2, 64, 64, 62);
        grd.addColorStop(0, 'rgba(0,0,0,0.72)');
        grd.addColorStop(0.55, 'rgba(0,0,0,0.28)');
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
        return new THREE.CanvasTexture(c);
      })();

      var defs = CONFIG.units.mechas.concat(CONFIG.units.kaiju);
      Promise.all(defs.map(function (def) {
        return GAME.Models.prepareUnit(def).then(function (p) {
          var root = p.root;
          root.position.set(def.faction === 'kaiju' ? 6.5 : -6.5, 0, 0);
          root.rotation.y = def.faction === 'kaiju' ? Math.PI * 0.85 : -Math.PI * 0.15;
          root.visible = false;
          /* 接触阴影（水平放置，不随朝向摆动） */
          var sh = new THREE.Mesh(
            new THREE.PlaneGeometry(def.height * 1.55, def.height * 1.55),
            new THREE.MeshBasicMaterial({ map: shTex, transparent: true, opacity: 0.62, depthWrite: false })
          );
          sh.rotation.x = -Math.PI / 2;
          sh.position.y = 0.03;
          sh.renderOrder = -1;
          root.add(sh);
          group.add(root);

          /* 待机动画：预览模型不再僵直站立，缓慢呼吸 + 关节微动 */
          var mixer = null;
          if (p.clips && p.clips.length) {
            try {
              mixer = new THREE.AnimationMixer(root);
              var idleClip = null;
              for (var ci = 0; ci < p.clips.length; ci++) {
                if (p.clips[ci] && p.clips[ci].name === 'idle') { idleClip = p.clips[ci]; break; }
              }
              if (idleClip) {
                var idleAct = mixer.clipAction(idleClip);
                idleAct.setLoop(THREE.LoopRepeat, Infinity);
                idleAct.play();
              }
            } catch (e) { mixer = null; }
          }
          M.previewModels[def.id] = { root: root, clips: p.clips, def: def, mixer: mixer, steamT: U.rand(0.4, 1.2) };
        });
      })).then(Main.refreshPreview);

      /* 预览蒸汽粒子池：肩部/背甲缓慢排气，复用固定 sprite，不逐帧新建 */
      var steamTex = (function () {
        var c = document.createElement('canvas'); c.width = c.height = 64;
        var g = c.getContext('2d');
        var grd = g.createRadialGradient(32, 32, 1, 32, 32, 31);
        grd.addColorStop(0, 'rgba(255,255,255,0.95)');
        grd.addColorStop(0.45, 'rgba(220,235,245,0.45)');
        grd.addColorStop(1, 'rgba(210,230,240,0)');
        g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
        return new THREE.CanvasTexture(c);
      })();
      M.preview.steamPool = [];
      for (var si = 0; si < 14; si++) {
        var sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: steamTex, transparent: true, opacity: 0, depthWrite: false, color: 0xdfeaf2
        }));
        sp.visible = false;
        scene.add(sp);
        M.preview.steamPool.push({ sprite: sp, life: 0, maxLife: 1, vel: new THREE.Vector3() });
      }
    },

    refreshPreview: function () {
      var mecha = CONFIG.units.mechas[M.selection.mecha];
      var kaiju = CONFIG.units.kaiju[M.selection.kaiju];
      for (var id in M.previewModels) {
        if (!M.previewModels.hasOwnProperty(id)) continue;
        var e = M.previewModels[id];
        e.root.visible = (e.def === mecha || e.def === kaiju);
      }
    },

    renderPreview: function (dt) {
      var pv = M.preview;
      if (!pv.renderer || !pv.canvas) return;
      var w = pv.canvas.clientWidth || 480, h = pv.canvas.clientHeight || 420;
      if (pv._w !== w || pv._h !== h) {
        pv._w = w; pv._h = h;
        pv.renderer.setSize(w, h, false);
        pv.camera.aspect = w / h;
        pv.camera.updateProjectionMatrix();
      }
      /* 缓慢自转，便于观察装甲细节 */
      pv.angle += dt * 0.25;
      for (var id in M.previewModels) {
        if (!M.previewModels.hasOwnProperty(id)) continue;
        var e = M.previewModels[id];
        if (!e.root.visible) continue;
        var base = e.def.faction === 'kaiju' ? Math.PI * 0.85 : -Math.PI * 0.15;
        e.root.rotation.y = base + Math.sin(pv.angle) * 0.55;
        if (e.mixer) e.mixer.update(dt);

        /* 关节蒸汽：肩部/背甲缓慢排气（死亡循环复用池内 sprite） */
        e.steamT = (e.steamT || 0) - dt;
        if (e.steamT <= 0) {
          e.steamT = U.rand(0.55, 1.0);
          var p = null, pool = pv.steamPool || [];
          for (var pi = 0; pi < pool.length; pi++) { if (pool[pi].life <= 0) { p = pool[pi]; break; } }
          if (p) {
            var H = e.def.height || 9;
            var isK = e.def.faction === 'kaiju';
            var lx = (isK ? 0.16 : 0.09) * H * (Math.random() < 0.5 ? -1 : 1);
            p.sprite.position.set(lx, (isK ? 0.62 : 0.6) * H, isK ? -0.08 * H : 0);
            e.root.updateMatrixWorld(true);
            e.root.localToWorld(p.sprite.position);
            p.vel.set(U.rand(-0.25, 0.25), U.rand(0.7, 1.4), U.rand(-0.2, 0.2));
            p.life = p.maxLife = U.rand(0.9, 1.5);
            p.sprite.material.opacity = 0.0;
            p.sprite.scale.setScalar(1.0);
            p.sprite.visible = true;
          }
        }
      }

      /* 蒸汽池推进：上升 + 扩散 + 淡出 */
      var pool2 = pv.steamPool || [];
      for (var sj = 0; sj < pool2.length; sj++) {
        var q = pool2[sj];
        if (q.life <= 0) continue;
        q.life -= dt;
        if (q.life <= 0) { q.sprite.visible = false; continue; }
        var k = q.life / q.maxLife;
        q.sprite.position.x += q.vel.x * dt;
        q.sprite.position.y += q.vel.y * dt;
        q.sprite.position.z += q.vel.z * dt;
        var grow = 1.0 + (1 - k) * 2.4;
        q.sprite.scale.setScalar(grow);
        q.sprite.material.opacity = Math.sin(Math.min(1, (1 - k) * 6) * Math.PI * 0.5) * k * 0.42;
      }

      pv.renderer.render(pv.scene, pv.camera);
    },

    /* ------------------------------ 事件绑定 ----------------------------- */
    bindEvents: function () {
      var bus = U.bus;
      bus.on('ui:start-game', function () { Main.startFight(M.selection.mecha, M.selection.kaiju, M.difficulty); });
      bus.on('ui:open-select', function () {
        M.state = 'select';
        Main.refreshPreview();
        GAME.UI.showScreen('select');
      });
      bus.on('ui:select-confirm', function (e) {
        M.selection.mecha = e.mechaIndex;
        M.selection.kaiju = e.kaijuIndex;
        M.difficulty = e.difficulty || M.difficulty;
        Main.startFight(M.selection.mecha, M.selection.kaiju, M.difficulty);
      });
      bus.on('ui:select-change', function (e) {
        if (e.side === 'mecha') M.selection.mecha = e.index;
        else M.selection.kaiju = e.index;
        Main.refreshPreview();
      });
      bus.on('ui:difficulty-change', function (e) { M.difficulty = e.difficulty; });
      bus.on('ui:help-open', function () { M.state = 'help'; GAME.UI.showScreen('help'); });
      bus.on('ui:help-close', function () { M.state = Main.hasUnits() ? 'menu' : 'menu'; GAME.UI.showScreen('menu'); });
      bus.on('ui:resume', function () { Main.resume(); });
      bus.on('ui:restart', function () { Main.startFight(M.selection.mecha, M.selection.kaiju, M.difficulty); });
      bus.on('ui:main-menu', function () { Main.toMenu(); });

      bus.on('debug:toggle', function (e) { GAME.Renderer.setDebugHitboxes(!!e.showHitboxes); });
      bus.on('combat:ko', function (e) { Main.onKO(e); });
      bus.on('combat:building-destroyed', function () { if (GAME.Audio) GAME.Audio.play('explosion'); });

      /* 单位事件音效 */
      bus.on('combat:hit', function (r) { if (r && r.blocked && GAME.Audio) GAME.Audio.play('block'); });
      bus.on('unit:ultimate', function (e) {
        if (GAME.Audio) GAME.Audio.play('ultimate');
        if (e && e.unit === M.player && GAME.Combat.stats) GAME.Combat.stats.ultimateUsed++;
      });
      bus.on('combat:stunned', function () { if (GAME.Audio) GAME.Audio.play('heavy'); });
    },

    hasUnits: function () { return !!(M.player && M.enemy); },

    /* ------------------------------ 战斗生命周期 ------------------------- */
    startFight: function (mechaIndex, kaijuIndex, difficulty) {
      var mechaDef = CONFIG.units.mechas[U.clamp(mechaIndex | 0, 0, CONFIG.units.mechas.length - 1)];
      var kaijuDef = CONFIG.units.kaiju[U.clamp(kaijuIndex | 0, 0, CONFIG.units.kaiju.length - 1)];
      M.selection.mecha = mechaIndex | 0;
      M.selection.kaiju = kaijuIndex | 0;
      M.difficulty = difficulty || M.difficulty;
      CONFIG.ai.difficulty = M.difficulty;

      Main.disposeUnits();

      var mModel = M.models[mechaDef.id];
      var kModel = M.models[kaijuDef.id];
      if (!mModel || !kModel) { Main.fatal('模型尚未加载完成'); return; }

      M.player = new GAME.Player({
        def: mechaDef, model: mModel, three: M.three,
        position: { x: CONFIG.arena.spawn.player.x, y: 0, z: CONFIG.arena.spawn.player.z },
        facing: 1, physics: GAME.Physics, renderer: GAME.Renderer, combat: GAME.Combat
      });
      M.enemy = new GAME.Enemy({
        def: kaijuDef, model: kModel, three: M.three,
        position: { x: CONFIG.arena.spawn.enemy.x, y: 0, z: CONFIG.arena.spawn.enemy.z },
        facing: -1, physics: GAME.Physics, renderer: GAME.Renderer, combat: GAME.Combat,
        difficulty: CONFIG.ai.levels[M.difficulty] || CONFIG.ai.levels.normal
      });

      GAME.Renderer.addUnit(M.player.root, 'mecha');
      GAME.Renderer.addUnit(M.enemy.root, 'kaiju');

      if (GAME.Renderer.city && GAME.Renderer.city.reset) GAME.Renderer.city.reset();

      GAME.Combat.init({
        physics: GAME.Physics, renderer: GAME.Renderer,
        units: [M.player, M.enemy],
        destructibles: (GAME.Renderer.city && GAME.Renderer.city.destructibles) || []
      });
      GAME.Combat.playerUnit = M.player;

      GAME.UI.player = M.player;
      GAME.UI.enemy = M.enemy;

      M.state = 'fight';
      M.slowMo = 0;
      M.koTimer = 0;
      GAME.UI.hidePause();
      GAME.UI.showScreen('fight');
      Main.roundIntro();

      /* 镜头立即对准双方，避免开场跳变 */
      GAME.Renderer.updateCamera([M.player, M.enemy], 1);
    },

    roundIntro: function () {
      GAME.UI.showCenterText(UI_CFG.texts.roundStart, { style: 'info', duration: 1.0 });
      Main.after(1.0, function () {
        GAME.UI.showCenterText(UI_CFG.texts.fight, { style: 'fight', duration: 0.9 });
      });
    },

    disposeUnits: function () {
      if (M.player) { GAME.Renderer.removeUnit(M.player.root); M.player.dispose(); M.player = null; }
      if (M.enemy) { GAME.Renderer.removeUnit(M.enemy.root); M.enemy.dispose(); M.enemy = null; }
    },

    pause: function () {
      if (M.state !== 'fight') return;
      M.state = 'pause';
      GAME.UI.showPause();
    },

    resume: function () {
      if (M.state !== 'pause') return;
      M.state = 'fight';
      GAME.UI.hidePause();
      GAME.UI.updateMenu(0);       // 释放暂停界面高亮
    },

    toMenu: function () {
      M.state = 'menu';
      GAME.UI.hidePause();
      GAME.UI.showScreen('menu');
      if (GAME.Renderer.city && GAME.Renderer.city.reset) GAME.Renderer.city.reset();
    },

    onKO: function (e) {
      if (M.state !== 'fight' && M.state !== 'pause') return;
      M.state = 'ko';
      M.slowMo = 2.0;
      if (C.rules.slowMoOnKO) M.slowMo = 2.4 + C.rules.koSlowMo;
      M.koTimer = UI_CFG.screen.koDelay + (UI_CFG.screen.resultDelay || 1.2);
      M.koWinner = e && e.winner ? e.winner : null;
    },

    showResult: function () {
      M.state = 'result';
      var victory = (M.koWinner === M.player);
      if (!M.koWinner) victory = false;
      GAME.UI.setResult({
        victory: victory,
        stats: GAME.Combat.stats || {},
        playerName: M.player ? M.player.def.name : '',
        enemyName: M.enemy ? M.enemy.def.name : '',
        difficulty: (CONFIG.ai.levels[M.difficulty] || {}).name || ''
      });
      GAME.UI.showScreen('result');
    },

    /* ------------------------------ 计时器 -------------------------------- */
    after: function (delay, fn) { M.timers.push({ t: delay, fn: fn }); },
    _updateTimers: function (dt) {
      for (var i = M.timers.length - 1; i >= 0; i--) {
        var tm = M.timers[i];
        tm.t -= dt;
        if (tm.t <= 0) { M.timers.splice(i, 1); tm.fn(); }
      }
    },

    /* ------------------------------ 尺寸 ---------------------------------- */
    resize: function () {
      var cv = M.canvas;
      if (!cv) return;
      var w = cv.clientWidth || global.innerWidth;
      var h = cv.clientHeight || global.innerHeight;
      GAME.Renderer.onResize(w, h);
    },

    /* ------------------------------ 主循环 -------------------------------- */
    startLoop: function () {
      if (M._looping) return;
      M._looping = true;
      M.lastTime = U.now();
      var loop = function () {
        global.requestAnimationFrame(loop);
        var now = U.now();
        var dt = Math.min(0.05, Math.max(0.0001, now - M.lastTime));
        M.lastTime = now;
        Main.step(dt);
      };
      global.requestAnimationFrame(loop);
    },

    step: function (dt) {
      M.elapsed += dt;
      /* 平滑 FPS（调试面板用） */
      if (dt > 0) M.fps = M.fps ? (M.fps * 0.9 + (1 / dt) * 0.1) : (1 / dt);
      GAME.Input.update(dt);
      Main._updateTimers(dt);

      var worldScale = GAME.Combat.timeScale();
      if (M.slowMo > 0) { worldScale *= C.rules.koSlowMo; M.slowMo = Math.max(0, M.slowMo - dt); }
      var wdt = dt * worldScale;

      if (M.state === 'fight' || M.state === 'ko') {
        if (GAME.Input.consume('pause') && M.state === 'fight') { Main.pause(); }
        else {
          GAME.Physics.step(wdt);
          if (M.player && M.enemy) {
            var ctx = Main.makeCtx(wdt, dt);
            /* 每个单位须拿到「对方」作为 opponent，否则 AI 会把自身当对手 */
            ctx.opponent = M.enemy;
            M.player.update(wdt, ctx);
            ctx.opponent = M.player;
            M.enemy.update(wdt, ctx);
            /* 顿帧计时用真实 dt：若用 wdt（已被压到 0.06 倍）会让 3 帧顿帧拖成十几帧 */
            GAME.Combat.update(dt);
            GAME.UI.updateHUD({ player: M.player, enemy: M.enemy });
            GAME.Renderer.updateCamera([M.player, M.enemy], dt);
          }
          if (M.state === 'ko') {
            M.koTimer -= dt;
            if (M.koTimer <= 0) Main.showResult();
          }
        }
      } else {
        /* 菜单 / 选机 / 暂停 / 结算：界面导航 + 背景城市继续演出 */
        if (M.state !== 'loading') GAME.UI.updateMenu(dt);
        GAME.Renderer.updateCamera(Main.idleTargets(), dt);
      }

      GAME.Renderer.update(dt, M.elapsed);
      if (M.state === 'select') Main.renderPreview(dt);
      /* F3 调试面板（与碰撞盒同步开关） */
      if (CONFIG.debug.showStats && GAME.UI && GAME.UI.updateDebugPanel) GAME.UI.updateDebugPanel();
    },

    makeCtx: function (wdt, rawDt) {
      return {
        dt: wdt,
        rawDt: rawDt,
        elapsed: M.elapsed,
        timeScale: 1,
        input: GAME.Input,
        combat: GAME.Combat,
        physics: GAME.Physics,
        renderer: GAME.Renderer,
        opponent: M.enemy,
        units: [M.player, M.enemy],
        arena: CONFIG.arena,
        difficulty: CONFIG.ai.levels[M.difficulty] || CONFIG.ai.levels.normal,
        player: M.player,
        enemy: M.enemy
      };
    },

    /* 非战斗状态下的取景目标：仅框住战场中央 */
    idleTargets: function () {
      var half = CONFIG.arena.width * 0.16;
      return [{ position: { x: -half, y: 0, z: 0 } }, { position: { x: half, y: 0, z: 0 } }];
    },

    /* 供 UI / 调试读取的只读状态 */
    getState: function () {
      return {
        state: M.state,
        selection: M.selection,
        difficulty: M.difficulty,
        player: M.player ? M.player.getDebugInfo() : null,
        enemy: M.enemy ? M.enemy.getDebugInfo() : null
      };
    },

    /* 调试面板快照：FPS / 时间缩放与顿帧 / 渲染统计 / 双方状态 */
    getDebugSnapshot: function () {
      var c = GAME.Combat;
      var rd = (GAME.Renderer && GAME.Renderer.getDebugInfo) ? GAME.Renderer.getDebugInfo() : {};
      var feel = (c && c.feel) ? c.feel() : {};
      return {
        fps: Math.round(M.fps || 0),
        worldScale: c ? c.timeScale() : 1,
        freeze: (c && c.freezeRemain) ? c.freezeRemain() : 0,
        hitstopEnabled: !!(feel.hitStop && feel.hitStop.enabled !== false),
        shakeEnabled: !(feel.shake && feel.shake.enabled === false),
        bufferEnabled: !(feel.buffer && feel.buffer.enabled === false),
        drawCalls: rd.drawCalls || 0,
        triangles: rd.triangles || 0,
        sparks: rd.sparks || 0,
        dusts: rd.dusts || 0,
        rings: rd.rings || 0,
        shields: rd.shields || 0,
        trails: rd.trails || 0,
        shake: rd.shake || 0,
        player: M.player ? M.player.getDebugInfo() : null,
        enemy: M.enemy ? M.enemy.getDebugInfo() : null
      };
    }
  };

  /* 怪兽高光色（预览补光） */
  function PALAccent() {
    return CONFIG.art.kaijuGlow.fast;
  }

})(typeof window !== 'undefined' ? window : this);
