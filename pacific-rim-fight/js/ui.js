/* =============================================================================
 * ui.js  ──  界面 / HUD / 菜单与选择逻辑（GAME.UI）
 * 依赖：config.js（GAME.CONFIG / GAME.INPUT_CONFIG / GAME.U）
 *       input.js（GAME.Input：按键提示 / 设备 / 菜单导航）
 * 加载方式：普通 <script>，挂载 window.GAME.UI
 *
 * 说明：
 *   · 本文件不包含任何游戏 / 场景逻辑，也绝不创建 WebGLRenderer；
 *     世界坐标转屏幕坐标使用 init 注入的 renderer.camera（Vector3.project）。
 *   · 所有文案、阈值、按键映射均读取 GAME.CONFIG / GAME.INPUT_CONFIG，不硬编码数值。
 *   · init() 永不抛错：查询 DOM 时一旦缺失仅 console.warn 一次并安全降级。
 * ========================================================================== */
(function (global) {
  'use strict';

  var GAME = global.GAME;
  var U = GAME.U;
  var CONFIG = GAME.CONFIG;
  var UI_CFG = CONFIG.ui;
  var INPUT_CFG = GAME.INPUT_CONFIG;

  /* ===========================================================================
   * DOM 查询：缓存 + 缺失仅告警一次
   * ======================================================================== */
  var DOM = {};        // id -> element | null（缓存，含 null）
  var warned = {};     // id -> 1（已告警）

  function qid(id) {
    if (typeof document === 'undefined' || !document.getElementById) return null;
    var el = document.getElementById(id);
    if (!el && !warned[id]) { warned[id] = 1; console.warn('[UI] 未找到 DOM 元素 #' + id + '，已安全降级。'); }
    return el;
  }
  /* 读取并缓存元素；null 也会被缓存，避免重复查询 */
  function D(id) {
    if (DOM.hasOwnProperty(id)) return DOM[id];
    var el = qid(id);
    DOM[id] = el;
    return el;
  }

  /* ===========================================================================
   * 内部状态
   * ======================================================================== */
  var caches = { p: {}, e: {} };      // HUD 每侧最后写入值（避免布局抖动）
  var _tmpV = null;                   // 复用的 THREE.Vector3（投影用）
  var centerTimer = 0, centerStyle = null;
  var comboTimer = 0;
  var ultTimer = 0;
  var dmgPool = [], dmgRAF = 0, dmgLast = 0;
  var previewHost = null;
  var helpRefs = { table: null, thKb: null, thGp: null };
  var subscribed = false;
  var _maxHpCache = 0;

  /* 屏幕 id 映射 */
  var SCREEN_IDS = {
    loading: 'screen-loading', menu: 'screen-menu', select: 'screen-select',
    fight: 'screen-fight', pause: 'screen-pause', result: 'screen-result', help: 'screen-help'
  };

  /* HUD 元素（仅战斗时可见） */
  var HUD_IDS = [
    'p-name', 'p-hp', 'p-hp-fill', 'p-hp-segments', 'p-stamina-fill', 'p-energy-fill',
    'p-ultimate-ready', 'p-blocking', 'p-stunned', 'p-exhausted',
    'e-name', 'e-hp', 'e-hp-fill', 'e-hp-segments', 'e-stamina-fill', 'e-stun-fill',
    'center-text', 'combo-display', 'ultimate-banner', 'damage-layer', 'fight-prompts'
  ];

  var DIFFICULTY_ORDER = ['easy', 'normal', 'hard'];

  /* 菜单条目定义（key -> 数组） */
  var MENU_ITEMS = [
    { id: 'menu-start', action: 'start' },
    { id: 'menu-select', action: 'open-select' },
    { id: 'menu-help', action: 'help-open' },
    { id: 'menu-difficulty', action: 'difficulty' },
    { id: 'menu-controller', action: 'controller' }
  ];
  var PAUSE_ITEMS = [
    { id: 'pause-resume', action: 'resume' },
    { id: 'pause-restart', action: 'restart' },
    { id: 'pause-menu', action: 'main-menu' }
  ];
  var RESULT_ITEMS = [
    { id: 'result-rematch', action: 'restart' },
    { id: 'result-menu', action: 'main-menu' }
  ];
  var ITEMS_BY_KEY = { menu: MENU_ITEMS, pause: PAUSE_ITEMS, result: RESULT_ITEMS };

  /* ===========================================================================
   * 通用小工具
   * ======================================================================== */
  function clampInt(v, a, b) { v = Math.round(v); return v < a ? a : (v > b ? b : v); }
  function nowSec() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000; }
  function raf(fn) {
    if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(fn);
    return setTimeout(fn, 16);
  }
  function setText(el, text) { if (el) el.textContent = (text === undefined || text === null) ? '' : String(text); }
  function toggleCls(el, cls, on) { if (el && el.classList) el.classList.toggle(cls, !!on); }
  function emit(evt, payload) {
    if (U && U.bus && U.bus.emit) U.bus.emit(evt, payload);
  }
  function clearT(id) { if (id) clearTimeout(id); return 0; }

  /* ===========================================================================
   * HUD 建造 / 更新
   * ======================================================================== */
  function buildSegments(container) {
    if (!container) return;
    container.innerHTML = '';
    var n = (UI_CFG.hud.barSegments | 0) || 12;
    for (var i = 0; i < n; i++) {
      var s = document.createElement('span');
      s.className = 'seg';
      container.appendChild(s);
    }
  }

  function buildHud() {
    buildSegments(D('p-hp-segments'));
    buildSegments(D('e-hp-segments'));
  }

  /* 仅在百分比发生有意义变化时写入宽度 */
  function setFill(el, frac, cache, key) {
    if (!el) return;
    var pct = Math.round(U.clamp(frac, 0, 1) * 1000) / 10;
    if (cache[key] === pct) return;
    cache[key] = pct;
    el.style.width = pct + '%';
  }

  function updateSegments(container, frac, cache, key) {
    if (!container) return;
    var count = container.children.length;
    if (!count) return;
    var lit = Math.round(U.clamp(frac, 0, 1) * count);
    if (cache[key] === lit) return;
    cache[key] = lit;
    for (var i = 0; i < count; i++) toggleCls(container.children[i], 'on', i < lit);
  }

  function updateBadge(id, on, cache, key) {
    var el = D(id);
    if (!el) return;
    on = !!on;
    if (cache[key] === on) return;
    cache[key] = on;
    el.classList.toggle('active', on);
  }

  function updateSideHud(side, unit) {
    var pfx = (side === 'p') ? 'p' : 'e';
    var cache = caches[pfx];

    /* 名称（变化时才写入） */
    if (unit) {
      var nm = unit.name || (unit.def && unit.def.name) || '';
      if (cache.name !== nm) { cache.name = nm; setText(D(pfx + '-name'), nm); }
    }
    if (!unit) return;

    var hp = unit.hp || 0, maxHp = unit.maxHp || 1;
    var frac = U.clamp(hp / maxHp, 0, 1);

    /* 血量数字：旧版只画进度条、从不写数字，换机体后 HUD 会一直停在 1000/900 */
    var hpText = String(Math.max(0, Math.ceil(hp)));
    if (cache.hpText !== hpText) { cache.hpText = hpText; setText(D(pfx + '-hp'), hpText); }

    /* 装甲条（先于血量承受伤害；maxArmor 为 0 时隐藏） */
    var maxAr = unit.maxArmor || 0;
    var arFill = D(pfx + '-armor-fill');
    if (arFill) {
      if (maxAr > 0) {
        arFill.parentElement.style.display = '';
        setFill(arFill, U.clamp((unit.armor || 0) / maxAr, 0, 1), cache, 'armor');
      } else {
        arFill.parentElement.style.display = 'none';
      }
    }

    setFill(D(pfx + '-hp-fill'), frac, cache, 'hpFill');
    updateSegments(D(pfx + '-hp-segments'), frac, cache, 'hpSeg');

    /* 低血量：红色闪烁类 + 闪烁周期 */
    var low = (frac <= UI_CFG.hud.lowHpThreshold) && !unit.dead;
    if (cache.low !== low) {
      cache.low = low;
      var hpFill = D(pfx + '-hp-fill');
      if (hpFill) {
        hpFill.classList.toggle('low', low);
        var rate = UI_CFG.hud.lowHpBlinkRate || 3;
        hpFill.style.animationDuration = (1 / rate) + 's';
      }
    }

    /* 耐力 */
    var st = unit.stamina || 0, maxSt = unit.maxStamina || 1;
    setFill(D(pfx + '-stamina-fill'), U.clamp(st / maxSt, 0, 1), cache, 'stamina');

    if (side === 'p') {
      /* 能量 + 必杀就绪 */
      var en = unit.energy || 0, maxEn = unit.maxEnergy || 1;
      setFill(D('p-energy-fill'), U.clamp(en / maxEn, 0, 1), cache, 'energy');
      var readyAt = (CONFIG.combat.energy && CONFIG.combat.energy.ultimateReadyAt) || 100;
      updateBadge('p-ultimate-ready', en >= readyAt, cache, 'ready');
      /* 状态徽章 */
      updateBadge('p-blocking', unit.blocking, cache, 'blocking');
      updateBadge('p-stunned', !!(unit.stunned || unit.state === 'stun'), cache, 'stunned');
      updateBadge('p-exhausted', !!(unit._exhausted || (unit.speedScale && unit.speedScale < 1)), cache, 'exhausted');
    } else {
      /* 敌方眩晕条（其余敌方资源无对应 DOM，安全跳过） */
      var sn = unit.stun || 0, maxSn = unit.maxStun || 1;
      setFill(D('e-stun-fill'), U.clamp(sn / maxSn, 0, 1), cache, 'stun');
    }
  }

  /* ===========================================================================
   * 选择面板：列表 / 名称 / 标签 / 描述 / 属性条 / 技能提示
   * ======================================================================== */
  function maxHpAcross() {
    if (_maxHpCache) return _maxHpCache;
    var m = 1, lists = [CONFIG.units.mechas, CONFIG.units.kaiju];
    for (var i = 0; i < lists.length; i++) {
      for (var j = 0; j < lists[i].length; j++) if (lists[i][j].hp > m) m = lists[i][j].hp;
    }
    _maxHpCache = m;
    return m;
  }

  function statRow(label, value, max, display) {
    var row = document.createElement('div'); row.className = 'stat-row';
    var l = document.createElement('span'); l.className = 'stat-label'; l.textContent = label;
    var track = document.createElement('div'); track.className = 'stat-track';
    var fill = document.createElement('div'); fill.className = 'stat-fill';
    fill.style.width = Math.round(U.clamp(value / max, 0, 1) * 100) + '%';
    track.appendChild(fill);
    var v = document.createElement('span'); v.className = 'stat-value';
    v.textContent = (display === undefined) ? String(value) : display;
    row.appendChild(l); row.appendChild(track); row.appendChild(v);
    return row;
  }

  function buildStats(host, def) {
    if (!host || !def) return;
    host.innerHTML = '';
    var mult = 1.5;   // 攻击 / 防御 / 速度 / 能量回复的展示基准
    host.appendChild(statRow('生命', def.hp, maxHpAcross(), def.hp));
    host.appendChild(statRow('攻击', def.attack, mult, (def.attack || 0).toFixed(2)));
    host.appendChild(statRow('防御', def.defense, mult, (def.defense || 0).toFixed(2)));
    host.appendChild(statRow('速度', def.speed, mult, (def.speed || 0).toFixed(2)));
    host.appendChild(statRow('能量回复', def.energyRegen, mult, (def.energyRegen || 0).toFixed(2)));
  }

  function promptSpan(action) {
    var s = document.createElement('span');
    s.className = 'prompt-glyph';
    s.setAttribute('data-prompt', action);
    return s;
  }

  function buildSkills(host, def) {
    if (!host || !def) return;
    host.innerHTML = '';
    var skillName = def.weapon ? (def.weapon.skillName || def.weapon.name) : (def.faction === 'kaiju' ? '撕咬连击' : '');
    var ultName = (def.ultimate && def.ultimate.name) || '';

    var skillRow = document.createElement('div'); skillRow.className = 'skill-row';
    skillRow.appendChild(promptSpan('skill'));
    var sn = document.createElement('span'); sn.className = 'skill-name'; sn.textContent = skillName;
    skillRow.appendChild(sn);
    host.appendChild(skillRow);

    var ultRow = document.createElement('div'); ultRow.className = 'skill-row';
    ultRow.appendChild(promptSpan('ultimate'));
    var un = document.createElement('span'); un.className = 'skill-name'; un.textContent = ultName;
    ultRow.appendChild(un);
    host.appendChild(ultRow);
  }

  function refreshPanel(side) {
    var list = (side === 'mecha') ? CONFIG.units.mechas : CONFIG.units.kaiju;
    var idx = clampInt(UI.state.select[side], 0, list.length - 1);
    var def = list[idx];
    if (!def) return;
    var nameHost = D('select-' + side + '-name');
    if (nameHost) {
      nameHost.innerHTML = '';
      var cn = document.createElement('span'); cn.className = 'unit-name-cn'; cn.textContent = def.name || '';
      nameHost.appendChild(cn);
      if (def.nameEn) {
        var en = document.createElement('span'); en.className = 'unit-name-en'; en.textContent = def.nameEn;
        nameHost.appendChild(en);
      }
    }
    setText(D('select-' + side + '-tag'), def.tag || '');
    setText(D('select-' + side + '-desc'), def.desc || '');
    buildStats(D('select-' + side + '-stats'), def);
    buildSkills(D('select-' + side + '-skills'), def);
    UI.refreshPrompts();
  }

  function fillList(side, list, host) {
    if (!host || !list) return;
    host.innerHTML = '';
    for (var i = 0; i < list.length; i++) {
      (function (i) {
        var def = list[i];
        var item = document.createElement('div');
        item.className = 'select-item';
        item.setAttribute('data-side', side);
        item.setAttribute('data-index', String(i));
        var n = document.createElement('span'); n.className = 'select-item-name'; n.textContent = def.name || '';
        var t = document.createElement('span'); t.className = 'select-item-tag'; t.textContent = def.tag || '';
        item.appendChild(n); item.appendChild(t);
        item.addEventListener('click', function () {
          UI.setSelectHighlight(side, i);
          emit('ui:select-change', { side: side, index: i });
        });
        item.addEventListener('mouseenter', function () { UI.setSelectHighlight(side, i); });
        host.appendChild(item);
      })(i);
    }
  }

  function buildSelectLists() {
    fillList('mecha', CONFIG.units.mechas, D('select-mecha-list'));
    fillList('kaiju', CONFIG.units.kaiju, D('select-kaiju-list'));
    var vs = D('select-vs');
    if (vs && !vs.textContent) vs.textContent = 'VS';
  }

  function setSelectFocus(side) {
    toggleCls(D('select-mecha-list'), 'focus', side === 'mecha');
    toggleCls(D('select-kaiju-list'), 'focus', side === 'kaiju');
  }

  /* ===========================================================================
   * 战斗提示 / 帮助表
   * ======================================================================== */
  function promptItem(action) {
    var w = document.createElement('span'); w.className = 'prompt-item';
    w.appendChild(promptSpan(action));
    var n = document.createElement('span'); n.className = 'prompt-name';
    n.textContent = (INPUT_CFG.promptActionNames && INPUT_CFG.promptActionNames[action]) || '';
    w.appendChild(n);
    return w;
  }

  function buildFightPrompts() {
    var fp = D('fight-prompts');
    if (!fp) return;
    /* 设备徽章与按键提示同处 #fight-prompts，清空重建时必须保留它，否则会被一起移除 */
    var badge = D('device-badge');
    fp.innerHTML = '';
    if (badge) fp.appendChild(badge);
    var acts = ['light', 'heavy', 'dodge', 'block', 'skill', 'ultimate'];
    for (var i = 0; i < acts.length; i++) fp.appendChild(promptItem(acts[i]));
    var sp = D('select-prompts');
    if (sp) {
      sp.innerHTML = '';
      var menuActs = ['confirm', 'cancel'];
      for (var j = 0; j < menuActs.length; j++) sp.appendChild(promptItem(menuActs[j]));
    }
  }

  /* 键盘按键：Event.code -> 友好显示 */
  var KEY_LABEL = {
    Space: '空格', Enter: 'Enter', Escape: 'Esc', Backspace: 'Backspace',
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓'
  };
  function formatKey(code) {
    if (KEY_LABEL[code]) return KEY_LABEL[code];
    if (code.indexOf('Key') === 0) return code.slice(3);
    if (code.indexOf('Digit') === 0) return code.slice(5);
    return code;
  }
  function formatKeyList(codes) {
    if (!codes || !codes.length) return '—';
    var out = [];
    for (var i = 0; i < codes.length; i++) out.push(formatKey(codes[i]));
    return out.join(' / ');
  }

  /* 手柄按钮索引 -> Xbox 布局标签 */
  var GP_LABEL = {
    0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT',
    8: 'Back', 9: 'Start', 10: 'LS', 11: 'RS', 12: '↑', 13: '↓', 14: '←', 15: '→'
  };
  function gpLabel(idx) {
    if (idx === undefined || idx === null) return '—';
    return (GP_LABEL[idx] !== undefined) ? GP_LABEL[idx] : ('B' + idx);
  }

  function helpRow(action, kbText, gpText) {
    var tr = document.createElement('tr');
    var td0 = document.createElement('td'); td0.className = 'help-action';
    td0.textContent = (INPUT_CFG.promptActionNames && INPUT_CFG.promptActionNames[action]) || action;
    var td1 = document.createElement('td'); td1.className = 'help-kb'; td1.textContent = kbText;
    var td2 = document.createElement('td'); td2.className = 'help-gp'; td2.textContent = gpText;
    tr.appendChild(td0); tr.appendChild(td1); tr.appendChild(td2);
    return tr;
  }

  function buildHelp() {
    var host = D('help-body');
    if (!host) return;
    host.innerHTML = '';

    var table = document.createElement('table');
    table.className = 'help-table';

    var thead = document.createElement('thead');
    var trh = document.createElement('tr');
    var thMk = document.createElement('th'); thMk.textContent = '操作';
    var thKb = document.createElement('th'); thKb.className = 'col-kb'; thKb.textContent = '键盘';
    var thGp = document.createElement('th'); thGp.className = 'col-gp'; thGp.textContent = '手柄';
    trh.appendChild(thMk); trh.appendChild(thKb); trh.appendChild(thGp);
    thead.appendChild(trh); table.appendChild(thead);

    var tbody = document.createElement('tbody');

    /* 移动 */
    var moveCodes = [];
    var kb = INPUT_CFG.keyboard;
    var dirs = ['left', 'right', 'forward', 'back'];
    for (var d = 0; d < dirs.length; d++) {
      var arr = kb[dirs[d]] || [];
      for (var k = 0; k < arr.length; k++) moveCodes.push(arr[k]);
    }
    tbody.appendChild(helpRow('move', formatKeyList(moveCodes), '左摇杆'));

    /* 其余动作：以 promptActionNames 顺序为准 */
    var order = ['light', 'heavy', 'dodge', 'block', 'skill', 'ultimate', 'pause', 'confirm', 'cancel'];
    for (var i = 0; i < order.length; i++) {
      var a = order[i];
      tbody.appendChild(helpRow(a, formatKeyList(kb[a]), gpLabel(INPUT_CFG.gamepad.buttons[a])));
    }

    table.appendChild(tbody);
    host.appendChild(table);

    helpRefs.table = table;
    helpRefs.thKb = thKb;
    helpRefs.thGp = thGp;
    updateHelpDevice(UI.input && UI.input.device);
  }

  function updateHelpDevice(device) {
    if (!helpRefs.table) return;
    var keyboard = (device !== 'gamepad');
    toggleCls(helpRefs.thKb, 'active', keyboard);
    toggleCls(helpRefs.thGp, 'active', !keyboard);
    helpRefs.table.setAttribute('data-device', device || 'keyboard');
  }

  /* ===========================================================================
   * 浮动伤害数字：世界->屏幕投影 + 对象池 + rAF 飘字
   * ======================================================================== */
  function acquireDamage(layer) {
    var free = null, oldest = null, oldestK = Infinity, i;
    for (i = 0; i < dmgPool.length; i++) {
      var it = dmgPool[i];
      if (!it.active) { free = it; break; }
      var ratio = it.maxLife > 0 ? it.life / it.maxLife : 0;
      if (ratio < oldestK) { oldestK = ratio; oldest = it; }
    }
    if (!free) {
      if (dmgPool.length < 16) {
        var el = document.createElement('div');
        el.className = 'damage-number';
        layer.appendChild(el);
        free = { el: el, active: false, x: 0, y: 0, vy: 0, life: 0, maxLife: 1, baseScale: 1 };
        dmgPool.push(free);
      } else {
        free = oldest;
      }
    }
    return free;
  }

  function damageStep() {
    dmgRAF = 0;
    var t = nowSec();
    var dt = t - dmgLast;
    dmgLast = t;
    if (dt <= 0) dt = 0.016;
    if (dt > 0.1) dt = 0.1;

    var any = false, i;
    for (i = 0; i < dmgPool.length; i++) {
      var e = dmgPool[i];
      if (!e.active) continue;
      e.life -= dt;
      if (e.life <= 0) {
        e.active = false;
        e.el.classList.remove('active');
        continue;
      }
      any = true;
      e.y += e.vy * dt;
      var k = e.life / e.maxLife;
      var sc = e.baseScale * (1.25 - 0.25 * k);
      e.el.style.opacity = String(Math.max(0, k));
      e.el.style.left = e.x + 'px';
      e.el.style.top = e.y + 'px';
      e.el.style.transform = 'translate(-50%, -50%) scale(' + sc.toFixed(3) + ')';
    }
    if (any) dmgRAF = raf(damageStep);
    else dmgRAF = 0;
  }

  function spawnDamage(worldPos, amount, opts) {
    opts = opts || {};
    var layer = D('damage-layer');
    if (!layer) return;

    var R = UI.renderer;
    var THREE = R && R.THREE;
    var cam = R && R.camera;
    var x = 0, y = 0, ok = false;

    if (THREE && cam && worldPos && THREE.Vector3) {
      if (!_tmpV) _tmpV = new THREE.Vector3();
      _tmpV.set(worldPos.x || 0, worldPos.y || 0, worldPos.z || 0);
      _tmpV.project(cam);
      if (_tmpV.z <= 1) {                       // 位于相机前方
        var w = (R.renderer && R.renderer.domElement && R.renderer.domElement.clientWidth) ||
          (R._size && R._size.x) || 1280;
        var h = (R.renderer && R.renderer.domElement && R.renderer.domElement.clientHeight) ||
          (R._size && R._size.y) || 720;
        x = (_tmpV.x * 0.5 + 0.5) * w;
        y = (-_tmpV.y * 0.5 + 0.5) * h;
        ok = true;
      }
    }
    if (!ok) {                                   // 无渲染器/相机：退化到画面上方居中
      x = (layer.clientWidth || 1280) / 2;
      y = 240;
    }

    var e = acquireDamage(layer);
    e.el.className = 'damage-number' +
      (opts.blocked ? ' blocked' : '') + (opts.critical ? ' critical' : '') +
      (opts.perfect ? ' perfect-word' : '') + (opts.broken ? ' break-word' : '');
    /* 战斗文字优先：破防 > 完美格挡 > 普通格挡 > 伤害数字 */
    var dmgText;
    if (opts.broken) dmgText = UI_CFG.texts.guardBreak || 'GUARD BREAK';
    else if (opts.perfect) dmgText = UI_CFG.texts.perfectGuard || 'PERFECT GUARD';
    else if (opts.blocked) {
      var bd = Math.round(amount || 0);
      dmgText = (UI_CFG.texts.block || 'BLOCK') + (bd > 0 ? ' ' + bd : '');
    } else dmgText = String(Math.round(amount || 0));
    e.el.textContent = dmgText;
    e.el.classList.add('active');
    e.x = x;
    e.y = y;
    e.vy = -42;                                  // 像素/秒，向上飘
    e.life = e.maxLife = UI_CFG.hud.damageNumberLife || 0.9;
    e.baseScale = opts.broken ? 1.35 : (opts.perfect ? 1.3 : (opts.critical ? 1.35 : (opts.blocked ? 1.05 : 1.0)));
    e.active = true;

    e.el.style.opacity = '1';
    e.el.style.left = e.x + 'px';
    e.el.style.top = e.y + 'px';
    e.el.style.transform = 'translate(-50%, -50%) scale(' + e.baseScale.toFixed(3) + ')';

    if (!dmgRAF) { dmgLast = nowSec(); dmgRAF = raf(damageStep); }
  }

  /* ===========================================================================
   * 中央文字 / 连击 / 必杀横幅 / 眩晕提示
   * ======================================================================== */
  function doShowCenter(text, duration, style) {
    var el = D('center-text');
    if (!el) return;
    centerTimer = clearT(centerTimer);
    if (centerStyle) { el.classList.remove(centerStyle); centerStyle = null; }
    el.textContent = (text === undefined || text === null) ? '' : String(text);
    if (style) { el.classList.add(style); centerStyle = style; }
    el.classList.add('active');
    if (duration > 0) {
      centerTimer = setTimeout(function () { UI.hideCenterText(); }, duration * 1000);
    }
  }

  /* ===========================================================================
   * 难度 / 控制器状态
   * ======================================================================== */
  function cycleDifficulty(dir) {
    dir = (dir < 0) ? -1 : 1;
    var i = DIFFICULTY_ORDER.indexOf(UI.state.difficulty);
    if (i < 0) i = 0;
    i = (i + dir + DIFFICULTY_ORDER.length) % DIFFICULTY_ORDER.length;
    var key = DIFFICULTY_ORDER[i];
    UI.setDifficultyLabel(key);
    emit('ui:difficulty-change', { difficulty: key });
  }

  /* ===========================================================================
   * 菜单导航
   * ======================================================================== */
  function applyCursor(items, cursor) {
    for (var i = 0; i < items.length; i++) toggleCls(D(items[i].id), 'selected', i === cursor);
  }

  function setCursor(key, index) {
    var items = ITEMS_BY_KEY[key];
    if (!items) return;
    UI._cursor[key] = clampInt(index, 0, items.length - 1);
    applyCursor(items, UI._cursor[key]);
  }

  function confirmSelect() {
    emit('ui:select-confirm', {
      mechaIndex: UI.state.select.mecha,
      kaijuIndex: UI.state.select.kaiju,
      difficulty: UI.state.difficulty
    });
  }

  function activateAction(action) {
    switch (action) {
      case 'start': emit('ui:start-game'); break;
      case 'open-select': emit('ui:open-select'); break;
      case 'help-open': emit('ui:help-open'); break;
      case 'help-close': emit('ui:help-close'); break;
      case 'resume': emit('ui:resume'); break;
      case 'restart': emit('ui:restart'); break;
      case 'main-menu': emit('ui:main-menu'); break;
      case 'difficulty': cycleDifficulty(1); break;
      case 'controller': UI.setControllerStatus(); break;
      case 'select-confirm': confirmSelect(); break;
      default: break;
    }
  }

  function cancelAction(key) {
    switch (key) {
      case 'pause': emit('ui:resume'); break;
      case 'result': emit('ui:main-menu'); break;
      case 'select': emit('ui:main-menu'); break;
      case 'help': emit('ui:help-close'); break;
      default: break;   // menu：取消无操作
    }
  }

  function navList(key) {
    var items = ITEMS_BY_KEY[key];
    var input = UI.input;
    if (!items || !input || typeof input.consume !== 'function') return;

    var cur = UI._cursor[key] || 0;
    var moved = 0;
    if (input.consume('menuUp') || input.consume('menuLeft')) moved = -1;
    if (input.consume('menuDown') || input.consume('menuRight')) moved = 1;
    if (moved !== 0) {
      cur = (cur + moved + items.length) % items.length;
      UI._cursor[key] = cur;
      applyCursor(items, cur);
    }
    if (input.consume('confirm')) activateAction(items[cur].action);
    if (input.consume('cancel')) cancelAction(key);
  }

  function navSelect() {
    var input = UI.input;
    if (!input || typeof input.consume !== 'function') return;
    var sel = UI.state.select;

    /* 左右切换两侧焦点 */
    if (input.consume('menuLeft') || input.consume('menuRight')) {
      sel.side = (sel.side === 'mecha') ? 'kaiju' : 'mecha';
      setSelectFocus(sel.side);
    }

    var list = (sel.side === 'mecha') ? CONFIG.units.mechas : CONFIG.units.kaiju;
    var n = list.length;
    var moved = 0;
    if (input.consume('menuUp')) moved = -1;
    if (input.consume('menuDown')) moved = 1;
    if (moved !== 0 && n > 0) {
      var idx = (sel[sel.side] + moved + n) % n;
      UI.setSelectHighlight(sel.side, idx);
      emit('ui:select-change', { side: sel.side, index: idx });
    }

    if (input.consume('confirm')) confirmSelect();
    if (input.consume('cancel')) emit('ui:main-menu');
  }

  /* ===========================================================================
   * 静态文案 / 事件绑定 / 总线订阅
   * ======================================================================== */
  function loadStaticTexts() {
    var T = UI_CFG.texts;
    setText(D('menu-start'), T.start);
    setText(D('menu-select'), T.select);
    setText(D('menu-help'), T.help);
    setText(D('pause-resume'), T.resume);
    setText(D('pause-restart'), T.restart);
    setText(D('pause-menu'), T.mainMenu);
    setText(D('result-rematch'), T.rematch);
    setText(D('result-menu'), T.mainMenu);
    setText(D('help-back'), (INPUT_CFG.promptActionNames && INPUT_CFG.promptActionNames.cancel) || '返回');
    var lt = D('loading-text');
    if (lt && !lt.textContent) lt.textContent = T.loading;
  }

  function wireButton(id, fn, hoverKey, hoverIndex) {
    var el = D(id);
    if (!el) return;
    el.addEventListener('click', function () {
      if (hoverKey !== undefined) setCursor(hoverKey, hoverIndex);
      fn();
    });
  }

  function wireEvents() {
    wireButton('menu-start', function () { emit('ui:start-game'); }, 'menu', 0);
    wireButton('menu-select', function () { emit('ui:open-select'); }, 'menu', 1);
    wireButton('menu-help', function () { emit('ui:help-open'); }, 'menu', 2);
    wireButton('menu-difficulty', function () { cycleDifficulty(1); }, 'menu', 3);
    wireButton('menu-controller', function () { UI.setControllerStatus(); }, 'menu', 4);

    wireButton('pause-resume', function () { emit('ui:resume'); }, 'pause', 0);
    wireButton('pause-restart', function () { emit('ui:restart'); }, 'pause', 1);
    wireButton('pause-menu', function () { emit('ui:main-menu'); }, 'pause', 2);

    wireButton('result-rematch', function () { emit('ui:restart'); }, 'result', 0);
    wireButton('result-menu', function () { emit('ui:main-menu'); }, 'result', 1);

    wireButton('help-back', function () { emit('ui:help-close'); });

    wireButton('select-confirm', function () { confirmSelect(); });
    wireButton('select-back', function () { emit('ui:main-menu'); });
    wireButton('select-difficulty', function () { cycleDifficulty(1); });

    /* P3：画质切换按钮 */
    var qRow = D('quality-row');
    if (qRow) {
      var qBtns = qRow.querySelectorAll('.quality-btn');
      for (var qi = 0; qi < qBtns.length; qi++) {
        (function (btn) {
          btn.addEventListener('click', function () {
            var lv = btn.getAttribute('data-quality');
            UI.setQuality(lv);
          });
        })(qBtns[qi]);
      }
    }
    /* P3：后处理效果开关 */
    var fxBloom = D('fx-bloom'), fxVig = D('fx-vignette'), fxFilm = D('fx-film');
    if (fxBloom) fxBloom.addEventListener('change', function () { UI.setPostFx({ bloom: fxBloom.checked }); });
    if (fxVig) fxVig.addEventListener('change', function () { UI.setPostFx({ vignette: fxVig.checked }); });
    if (fxFilm) fxFilm.addEventListener('change', function () { UI.setPostFx({ filmGrain: fxFilm.checked }); });
  }

  function subscribe() {
    if (subscribed) return;
    subscribed = true;

    /* 手柄插拔：刷新控制器状态行（与设备切换事件互补） */
    if (typeof global.addEventListener === 'function') {
      global.addEventListener('gamepadconnected', function () { UI.setControllerStatus(); });
      global.addEventListener('gamepaddisconnected', function () { UI.setControllerStatus(); });
    }

    if (!U || !U.bus || !U.bus.on) return;

    /* 眩晕满值：眩晕提示 */
    U.bus.on('combat:stunned', function (p) { UI.showStunNotice(p && p.unit); });

    /* 装甲破防：中央提示 */
    U.bus.on('combat:armor-break', function (p) {
      var isPlayer = p && p.unit === UI.player;
      UI.showCenterText(isPlayer ? '装甲破损' : '敌甲壳破裂', { duration: 0.7, style: 'armor-break' });
    });
    /* 完美格挡：中央提示 */
    U.bus.on('combat:perfect-guard', function (p) {
      var isPlayer = p && p.unit === UI.player;
      if (isPlayer) UI.showCenterText('格挡成功', { duration: 0.5, style: 'perfect' });
    });

    /* 击杀：中央 K.O. */
    U.bus.on('combat:ko', function () {
      var dur = (UI_CFG.screen && UI_CFG.screen.koDelay) || 1.2;
      UI.showCenterText(UI_CFG.texts.ko, { duration: dur, style: 'ko' });
    });

    /* 单位必杀：横幅 */
    U.bus.on('unit:ultimate', function (p) {
      if (p) UI.showUltimateBanner(p.name, p.desc);
    });

    /* 设备切换：按键提示 + 控制器状态 + 帮助表高亮 + 底部设备徽章 */
    U.bus.on('input:device', function () {
      UI.refreshPrompts();
      UI.setControllerStatus();
      updateHelpDevice(UI.input && UI.input.device);
      UI._updateDeviceBadge();
    });

    /* 触屏模式开关：隐藏底部键盘提示（虚拟按键已替代） */
    U.bus.on('input:touch', function (p) {
      var fp = D('fight-prompts');
      if (fp) fp.classList.toggle('touch-hidden', !!(p && p.enabled));
      UI._updateDeviceBadge();
    });

    /* 调试面板（F3）：与碰撞盒同步开关 */
    U.bus.on('debug:toggle', function (p) {
      var on = !!(p && p.showHitboxes);
      CONFIG.debug.showStats = on;
      var el = D('debug-panel');
      if (!el) return;
      el.classList.toggle('active', on);
      if (!on) el.textContent = '';
    });

    /* 资源不足：对应触屏按钮闪红提示 */
    U.bus.on('unit:no-resource', function (p) {
      if (!p || p.unit !== UI.player) return;       // 仅玩家侧反馈
      var action = p.action || '';
      var btn = document.querySelector('.touch-btn[data-action="' + action + '"]');
      if (!btn) return;
      btn.classList.remove('no-res');
      /* 强制重排以重启动画 */
      void btn.offsetWidth;
      btn.classList.add('no-res');
      setTimeout(function () { btn.classList.remove('no-res'); }, 520);
    });

    /* 命中：伤害数字 + 连击 + 血条闪白 */
    U.bus.on('combat:hit', function (r) {
      if (!r) return;
      UI.showDamageNumber(r.position, r.damage, {
        blocked: r.blocked, critical: r.critical, perfect: r.perfect, broken: r.broken
      });
      var hits = (r.attacker && r.attacker.comboHits) || 0;
      if (hits >= 2) UI.showCombo(hits, r.damage);
      /* 受击方血条闪白 */
      if (r.defender) UI.flashBar(r.defender.faction === 'mecha' ? 'p' : 'e');
    });
  }

  /* ===========================================================================
   * GAME.UI 对外接口
   * ======================================================================== */
  var UI = {
    /* --- 注入引用 --- */
    input: null,
    renderer: null,
    player: null,
    enemy: null,

    currentScreen: null,

    state: {
      difficulty: 'normal',
      select: { mecha: 0, kaiju: 0, side: 'mecha' }
    },
    _cursor: { menu: 0, pause: 0, result: 0 },

    /* =======================================================================
     * init(opts) {input, renderer, player, enemy} —— 缓存引用并构建全部 DOM 结构
     * ==================================================================== */
    init: function (opts) {
      opts = opts || {};
      UI.input = opts.input || GAME.Input || null;
      UI.renderer = opts.renderer || GAME.Renderer || null;
      UI.player = opts.player || null;
      UI.enemy = opts.enemy || null;
      previewHost = D('select-preview');

      try {
        /* 难度初值来自配置 */
        UI.state.difficulty = (CONFIG.ai && CONFIG.ai.difficulty) || 'normal';

        buildHud();
        buildSelectLists();
        buildFightPrompts();
        buildHelp();
        loadStaticTexts();
        wireEvents();

        UI.setDifficultyLabel(UI.state.difficulty);
        UI.setControllerStatus();
        applyCursor(MENU_ITEMS, UI._cursor.menu);
        applyCursor(PAUSE_ITEMS, UI._cursor.pause);
        applyCursor(RESULT_ITEMS, UI._cursor.result);

        UI.setSelectHighlight('mecha', 0);
        UI.setSelectHighlight('kaiju', 0);
        setSelectFocus('mecha');

        UI.refreshPrompts();
        UI._updateDeviceBadge();
        UI.refreshQualityUI();
        UI.refreshFxUI();
        UI.showScreen('loading');
        subscribe();
      } catch (e) {
        console.warn('[UI] init 初始化异常：', e);
      }
      return UI;
    },

    /* =======================================================================
     * showScreen(name) —— 切换屏幕；HUD 仅在 fight 时可见
     * ==================================================================== */
    showScreen: function (name) {
      var keys = Object.keys(SCREEN_IDS);
      for (var i = 0; i < keys.length; i++) {
        var el = D(SCREEN_IDS[keys[i]]);
        if (!el) continue;
        var on = (name === keys[i]);
        el.classList.toggle('active', on);
        el.classList.toggle('hidden', !on);
      }
      UI.currentScreen = (name && SCREEN_IDS[name]) ? name : null;
      UI._setHudVisible(UI.currentScreen === 'fight');
      /* 战斗时显示触屏控制，其余界面隐藏 */
      if (UI.input && typeof UI.input.setTouchVisible === 'function') {
        UI.input.setTouchVisible(UI.currentScreen === 'fight');
      }
      if (UI.currentScreen === 'menu' || UI.currentScreen === 'select') UI.refreshPrompts();
      if (UI.currentScreen === 'pause') { UI.refreshQualityUI(); UI.refreshFxUI(); }
      return UI.currentScreen;
    },

    /* HUD 整体可见性（各元素独立切换，兼容 HUD 位于 screen-fight 内外的结构） */
    _setHudVisible: function (visible) {
      for (var i = 0; i < HUD_IDS.length; i++) {
        var el = D(HUD_IDS[i]);
        if (el) el.classList.toggle('hidden', !visible);
      }
    },

    /* =======================================================================
     * 加载进度
     * ==================================================================== */
    _lastLoadPct: -1,
    setLoadingProgress: function (p, label) {
      p = U.clamp((typeof p === 'number') ? p : 0, 0, 1);
      var pct = Math.round(p * 100);
      if (UI._lastLoadPct !== pct) {
        UI._lastLoadPct = pct;
        setText(D('loading-pct'), pct + '%');
        var f = D('loading-fill');
        if (f) f.style.width = pct + '%';
      }
      if (label !== undefined) setText(D('loading-text'), label);
    },

    /* =======================================================================
     * HUD 刷新（每帧调用，内部缓存避免布局抖动）
     * ==================================================================== */
    updateHUD: function (state) {
      state = state || {};
      var p = state.player, e = state.enemy;
      if (!p && state.hp !== undefined) p = state;    // 直接传入玩家状态
      if (!p) p = UI.player;
      if (!e) e = UI.enemy;
      updateSideHud('p', p);
      updateSideHud('e', e);
    },

    /* =======================================================================
     * 中央文字
     * ==================================================================== */
    showCenterText: function (text, opts) {
      opts = opts || {};
      var def = (UI_CFG.screen && UI_CFG.screen.roundIntro) || 1.2;
      var dur = (opts.duration === undefined) ? def : opts.duration;
      doShowCenter(text, dur, opts.style || null);
    },
    hideCenterText: function () {
      var el = D('center-text');
      if (el) el.classList.remove('active');
      centerTimer = 0;
    },

    /* =======================================================================
     * F3 调试面板：FPS / 时间缩放 / 顿帧 / 震动 / 粒子 / 渲染调用 / 双方状态
     * ==================================================================== */
    updateDebugPanel: function () {
      var el = D('debug-panel');
      if (!el || !el.classList.contains('active')) return;
      var M = GAME.Main;
      var s = (M && M.getDebugSnapshot) ? M.getDebugSnapshot() : null;
      if (!s) return;
      var p = s.player || {};
      var e = s.enemy || {};
      var lines = [];
      lines.push('FPS ' + s.fps + '   scale ' + s.worldScale.toFixed(2) +
        (s.freeze > 0 ? '   HITSTOP ' + (s.freeze * 1000).toFixed(0) + 'ms' : ''));
      lines.push('HITSTOP ' + (s.hitstopEnabled ? 'on' : 'off') +
        '   SHAKE ' + (s.shakeEnabled ? 'on' : 'off') + ' ' + s.shake.toFixed(2) +
        '   BUFFER ' + (s.bufferEnabled ? 'on' : 'off'));
      lines.push('DRAW ' + s.drawCalls + '   TRI ' + s.triangles);
      lines.push('FX spark ' + s.sparks + '  dust ' + s.dusts + '  ring ' + s.rings +
        '  shield ' + s.shields + '  trail ' + s.trails);
      lines.push('');
      lines.push('P  ' + (p.state || '-') + (p.movePhase ? '/' + p.movePhase : '') +
        '  hp ' + (p.hp || 0) + '  st ' + (p.stamina || 0) + '  en ' + (p.energy || 0));
      lines.push('   combo ' + (p.comboHits || 0) + '  buffer ' + (p.buffer || '-'));
      lines.push('E  ' + (e.state || '-') + '/' + (e.aiState || '-') +
        '  hp ' + (e.hp || 0) + '  st ' + (e.stamina || 0) + '  en ' + (e.energy || 0));
      lines.push('   move ' + (e.move || '-') + '  dist ' + (e.distance || 0) +
        '  diff ' + (e.diffKey || '-'));
      el.textContent = lines.join('\n');
    },

    /* =======================================================================
     * 连击提示
     * ==================================================================== */
    showCombo: function (hits, damage) {
      if (!UI_CFG.hud.showCombo) return;
      var el = D('combo-display');
      if (!el) return;
      el.innerHTML = '';
      var num = document.createElement('span'); num.className = 'combo-count'; num.textContent = '×' + (hits | 0);
      el.appendChild(num);
      if (damage) {
        var dmg = document.createElement('span'); dmg.className = 'combo-damage';
        dmg.textContent = 'DMG ' + String(Math.round(damage));
        el.appendChild(dmg);
      }
      el.classList.add('active');
      comboTimer = clearT(comboTimer);
      var reset = (CONFIG.combat.timing && CONFIG.combat.timing.comboResetTime) || 1.2;
      comboTimer = setTimeout(function () { el.classList.remove('active'); comboTimer = 0; }, reset * 1000);
    },

    /* =======================================================================
     * 浮动伤害数字（世界坐标 -> 屏幕）
     * ==================================================================== */
    showDamageNumber: function (worldPos, amount, opts) {
      spawnDamage(worldPos, amount, opts);
    },

    /* =======================================================================
     * 必杀技横幅
     * ==================================================================== */
    showUltimateBanner: function (name, desc) {
      var el = D('ultimate-banner');
      if (!el) return;
      el.innerHTML = '';
      var n = document.createElement('div'); n.className = 'ub-name'; n.textContent = name || '';
      el.appendChild(n);
      if (desc) {
        var d = document.createElement('div'); d.className = 'ub-desc'; d.textContent = desc;
        el.appendChild(d);
      }
      el.classList.add('active');
      ultTimer = clearT(ultTimer);
      var z = CONFIG.camera && CONFIG.camera.ultimateZoom;
      /* 横幅只覆盖蓄力 + 前两段，终结段和 KO 演出不再被大字遮挡 */
      var dur = z ? Math.min(1.7, z.time + z.hold * 0.8) : 1.6;
      ultTimer = setTimeout(function () { el.classList.remove('active'); ultTimer = 0; }, dur * 1000);
    },

    /* =======================================================================
     * 眩晕提示
     * ==================================================================== */
    showStunNotice: function (who) {
      if (!UI_CFG.hud.showStun) return;
      var name = '';
      if (who && typeof who === 'object') {
        name = who.name || (who.def && who.def.name) || '';
      } else if (who === 'player' && UI.player) {
        name = UI.player.name || (UI.player.def && UI.player.def.name) || UI_CFG.texts.player;
      } else if (who === 'enemy' && UI.enemy) {
        name = UI.enemy.name || (UI.enemy.def && UI.enemy.def.name) || UI_CFG.texts.enemy;
      }
      var text = name ? (name + ' 眩晕！') : '眩晕！';
      var dur = (CONFIG.combat.stun && CONFIG.combat.stun.duration) || 1.5;
      doShowCenter(text, dur, 'stun');
    },

    /* =======================================================================
     * 结算界面
     * ==================================================================== */
    setResult: function (data) {
      data = data || {};
      var title = data.victory ? UI_CFG.texts.victory : UI_CFG.texts.defeat;
      setText(D('result-title'), title);

      var host = D('result-stats');
      if (!host) return;
      host.innerHTML = '';
      var stats = data.stats || {};

      var rows = [];
      if (data.playerName || data.enemyName) {
        rows.push(['对阵', (data.playerName || UI_CFG.texts.player) + '  VS  ' + (data.enemyName || UI_CFG.texts.enemy)]);
      }
      rows.push(['造成伤害', Math.round(stats.damageDealt || 0)]);
      rows.push(['承受伤害', Math.round(stats.damageTaken || 0)]);
      rows.push(['命中次数', stats.hits || 0]);
      rows.push(['最大连击', stats.maxCombo || 0]);
      rows.push(['击毁楼宇', stats.buildingsDestroyed || 0]);
      rows.push(['必杀释放', stats.ultimateUsed || 0]);
      rows.push(['战斗时长', ((stats.duration || 0).toFixed(1)) + ' s']);

      for (var i = 0; i < rows.length; i++) {
        var r = document.createElement('div'); r.className = 'result-row';
        var rk = document.createElement('span'); rk.className = 'result-key'; rk.textContent = rows[i][0];
        var rv = document.createElement('span'); rv.className = 'result-value'; rv.textContent = String(rows[i][1]);
        r.appendChild(rk); r.appendChild(rv);
        host.appendChild(r);
      }
    },

    /* =======================================================================
     * 暂停显示
     * ==================================================================== */
    showPause: function () { UI.showScreen('pause'); },
    hidePause: function () { if (UI.currentScreen === 'pause') UI.showScreen('fight'); },

    /* =======================================================================
     * 控制器状态行
     * ==================================================================== */
    setControllerStatus: function (text) {
      if (text === undefined) {
        var connected = (UI.input && typeof UI.input.isConnected === 'function') ? UI.input.isConnected() : false;
        text = connected ? UI_CFG.texts.controllerPad : UI_CFG.texts.controllerKb;
      }
      setText(D('menu-controller'), text);
      UI._updateDeviceBadge();
    },

    /* P3：底部操作提示面板的设备模式徽章 */
    _updateDeviceBadge: function () {
      var badge = D('device-badge');
      if (!badge) return;
      var dev = (UI.input && UI.input.device) || 'keyboard';
      var label = (dev === 'gamepad') ? (UI_CFG.texts.controllerPad || '手柄模式') : (UI_CFG.texts.controllerKb || '键盘模式');
      setText(badge, label);
    },

    /* P3：受击时血条闪白（不修改数值，仅视觉反馈） */
    flashBar: function (side) {
      var fill = D((side === 'e' ? 'e' : 'p') + '-hp-fill');
      if (!fill) return;
      fill.classList.remove('flash');
      /* 强制重排以重启动画 */
      void fill.offsetWidth;
      fill.classList.add('flash');
    },

    /* P3：设置画质（委托 Renderer，再刷新按钮高亮） */
    setQuality: function (level) {
      var R = UI.renderer;
      if (R && typeof R.setQuality === 'function') {
        try { R.setQuality(level); } catch (e) { console.warn('[UI] setQuality 失败', e); }
      }
      UI.refreshQualityUI();
    },

    /* P3：切换后处理效果 */
    setPostFx: function (opts) {
      var R = UI.renderer;
      if (R && typeof R.setPostFx === 'function') {
        try { R.setPostFx(opts); } catch (e) { console.warn('[UI] setPostFx 失败', e); }
      }
      UI.refreshFxUI();
    },

    /* P3：根据当前画质刷新按钮高亮 */
    refreshQualityUI: function () {
      var R = UI.renderer;
      var cur = (R && typeof R.getQuality === 'function') ? R.getQuality() : (CONFIG.render.quality || 'high');
      var qRow = D('quality-row');
      if (!qRow) return;
      var btns = qRow.querySelectorAll('.quality-btn');
      for (var i = 0; i < btns.length; i++) {
        btns[i].classList.toggle('active', btns[i].getAttribute('data-quality') === cur);
      }
    },

    /* P3：根据当前后处理开关刷新复选框 */
    refreshFxUI: function () {
      var pf = (CONFIG.render && CONFIG.render.postFx) || {};
      var cb = D('fx-bloom'); if (cb) cb.checked = !!pf.bloom;
      var cv = D('fx-vignette'); if (cv) cv.checked = !!pf.vignette;
      var cf = D('fx-film'); if (cf) cf.checked = !!pf.filmGrain;
    },

    /* =======================================================================
     * 选择高亮 + 刷新该侧面板
     * ==================================================================== */
    setSelectHighlight: function (side, index) {
      if (side !== 'mecha' && side !== 'kaiju') return;
      var list = (side === 'mecha') ? CONFIG.units.mechas : CONFIG.units.kaiju;
      var n = list.length;
      if (!n) return;
      index = clampInt(index, 0, n - 1);
      UI.state.select[side] = index;

      var host = D('select-' + side + '-list');
      if (host) {
        var items = host.children;
        for (var i = 0; i < items.length; i++) items[i].classList.toggle('selected', i === index);
      }
      refreshPanel(side);
    },

    /* =======================================================================
     * 难度标签
     * ==================================================================== */
    setDifficultyLabel: function (name) {
      var levels = CONFIG.ai && CONFIG.ai.levels;
      if (!levels) return;
      var key = name;
      if (!levels[key]) {
        for (var k in levels) { if (levels.hasOwnProperty(k) && levels[k].name === name) { key = k; break; } }
      }
      if (!levels[key]) key = (CONFIG.ai && CONFIG.ai.difficulty) || 'normal';
      UI.state.difficulty = key;
      var label = (UI_CFG.texts.difficulty || '难度') + '：' + (levels[key].name || key);
      setText(D('menu-difficulty'), label);
      setText(D('select-difficulty'), label);
    },

    /* =======================================================================
     * 预览宿主（由外部模型模块注入使用）
     * ==================================================================== */
    setPreviewHost: function (el) { previewHost = el || null; },
    getPreviewHost: function () { return previewHost; },

    /* =======================================================================
     * 刷新所有 data-prompt 提示（委托 GAME.Input + 本地兜底）
     * ==================================================================== */
    refreshPrompts: function () {
      if (UI.input && typeof UI.input.refreshPrompts === 'function') {
        try { UI.input.refreshPrompts(); } catch (e) { /* 忽略 */ }
      }
      if (typeof document === 'undefined' || !document.querySelectorAll) return;
      var nodes = document.querySelectorAll('[data-prompt]');
      for (var i = 0; i < nodes.length; i++) {
        var a = nodes[i].getAttribute('data-prompt');
        if (!a) continue;
        var glyph = '';
        if (UI.input && typeof UI.input.getPromptGlyph === 'function') {
          try { glyph = UI.input.getPromptGlyph(a); } catch (e) { glyph = ''; }
        }
        if (glyph) nodes[i].textContent = glyph;
      }
    },

    /* =======================================================================
     * updateMenu(dt) —— 菜单屏幕激活时每帧调用；两套设备统一走 GAME.Input
     * ==================================================================== */
    updateMenu: function (dt) {
      var s = UI.currentScreen;
      if (s === 'menu') navList('menu');
      else if (s === 'pause') navList('pause');
      else if (s === 'result') navList('result');
      else if (s === 'select') navSelect();
      else if (s === 'help') {
        var input = UI.input;
        if (input && typeof input.consume === 'function') {
          if (input.consume('cancel') || input.consume('confirm')) emit('ui:help-close');
        }
      }
    }
  };

  GAME.UI = UI;

})(typeof window !== 'undefined' ? window : this);
