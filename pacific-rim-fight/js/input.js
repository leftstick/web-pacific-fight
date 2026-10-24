/* =============================================================================
 * input.js  ──  输入系统（键盘 + 手柄，自动热切换 + 动态按键提示）
 * 依赖：config.js（GAME.INPUT_CONFIG / GAME.CONFIG / GAME.U）
 * 加载方式：普通 <script>，挂载 window.GAME.Input
 *
 * 设计要点：
 *   1. 所有按键映射、死区、扳机阈值、设备切换静默时间全部读取 INPUT_CONFIG，绝不硬编码。
 *   2. update() 每帧调用一次：轮询手柄 + 锁存键盘边沿，供游戏/菜单读取。
 *   3. 键盘(Event.code) 与手柄可同时在线，通过 deviceSwitchIdle 平滑热切换，忽略摇杆抖动、不来回跳。
 *   4. 菜单方向（十字键/左摇杆，键盘同样支持）由本文件统一实现长按重复，先延迟后高速。
 *   5. refreshPrompts() 会把所有 data-prompt="<action>" 节点的文案替换成当前设备对应的按键提示。
 * ========================================================================== */
(function (global) {
  'use strict';

  var GAME = global.GAME;
  var U = GAME.U;
  var INPUT_CONFIG = GAME.INPUT_CONFIG;      // 按键映射与阈值（唯一来源）
  var CONFIG = GAME.CONFIG;
  var GP = INPUT_CONFIG.gamepad;

  /* ---- 从配置提取阈值（不硬编码） ---- */
  var DEADZONE = GP.deadzone;                // 摇杆死区
  var TRIGGER_THRESHOLD = GP.triggerThreshold; // 扳机模拟量阈值
  var AXIS_X = GP.axes.moveX;                // 移动水平轴
  var AXIS_Y = GP.axes.moveY;                // 移动垂直轴
  var SWITCH_IDLE = INPUT_CONFIG.deviceSwitchIdle; // 设备切换静默时间

  /* ---- 菜单长按重复节奏：优先读取配置，缺省用约定值 ---- */
  var MENU_REPEAT_CFG = INPUT_CONFIG.menuRepeat || {};
  var MENU_INITIAL = (typeof MENU_REPEAT_CFG.initial === 'number') ? MENU_REPEAT_CFG.initial : 0.35;
  var MENU_REPEAT_TIME = (typeof MENU_REPEAT_CFG.interval === 'number') ? MENU_REPEAT_CFG.interval : 0.12;

  /* ---- 动作分组 ---- */
  var MENU_ACTIONS = ['pause', 'confirm', 'cancel', 'menuUp', 'menuDown', 'menuLeft', 'menuRight'];
  /* setEnabled(false) 后仍生效的动作（保证菜单/调试可用） */
  var ALWAYS_ACTIONS = MENU_ACTIONS.concat(['debug']);
  var MENU_DIRS = ['menuUp', 'menuDown', 'menuLeft', 'menuRight'];

  /* 需要阻止浏览器默认行为的键（滚动/查找） */
  var PREVENT_CODES = { Space: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1 };

  /* ---- 键位索引（全部来自 INPUT_CONFIG） ---- */
  var KEY_MAP = INPUT_CONFIG.keyboard;        // action -> [code ...]
  var BTN_MAP = GP.buttons;                   // action -> button index
  var CODE_ACTIONS = {};                      // code -> [action ...]
  var ACTION_LIST = [];                       // 所有动作名（键盘 ∪ 手柄）

  /* 扳机按钮 -> 对应模拟量轴索引（部分手柄扳机在轴上） */
  var TRIGGER_AXIS_BY_BUTTON = {};

  /* 动作 -> prompts 表格里的字段名（仅用于文案映射） */
  var PROMPT_KEY = {
    left: 'move', right: 'move', forward: 'move', back: 'move',
    light: 'light', heavy: 'heavy', dodge: 'dodge', block: 'block',
    skill: 'skill', ultimate: 'ultimate', pause: 'pause',
    confirm: 'confirm', cancel: 'cancel',
    menuUp: 'menu', menuDown: 'menu', menuLeft: 'menu', menuRight: 'menu'
  };

  /* ---- 运行时状态 ---- */
  var rawKeys = {};          // code -> bool（键盘物理按键）
  var state = {};            // action -> bool（本帧合成状态）
  var pressed = {};          // action -> bool（本帧按下边沿，可被 consume 清除）
  var released = {};         // action -> bool（本帧抬起边沿）
  var latchPressed = {};     // 事件预锁存的按下（防帧内快速点按丢失）
  var latchReleased = {};
  var menuRep = {};          // 方向 -> { holding, timer, first }
  var boundTarget = null;
  var initialized = false;

  var activePadIndex = -1;
  var activePadRef = null;
  var stickX = 0, stickY = 0;        // 手柄左摇杆（已过死区，原始符号：上为负）
  var keyAxisX = 0, keyAxisY = 0;    // 键盘方向（右/前为正）
  var connectedPadCount = 0;

  var lastKeyboardInput = -1e9;
  var lastGamepadInput = -1e9;
  var lastSwitchTime = -1e9;
  var kbActivityFlag = false;

  var deviceChangeCallbacks = [];
  var i;                              // 复用循环变量

  /* ---------------- 小工具 ---------------- */
  function has(obj, k) { return Object.prototype.hasOwnProperty.call(obj, k); }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function nowSec() { return U.now(); }

  /* 读取手柄（navigator 不可用时安全返回 null） */
  function safeGetGamepads() {
    try {
      if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
      return navigator.getGamepads();
    } catch (e) { return null; }
  }

  function padButton(pad, idx) {
    try { return (pad && pad.buttons) ? (pad.buttons[idx] || null) : null; } catch (e) { return null; }
  }

  function padAxis(pad, idx) {
    try {
      if (!pad || !pad.axes) return 0;
      return (typeof pad.axes[idx] === 'number') ? pad.axes[idx] : 0;
    } catch (e) { return 0; }
  }

  function padTriggerValue(pad, idx) {
    var v = 0;
    var b = padButton(pad, idx);
    if (b && typeof b.value === 'number') v = b.value;
    var axIdx = TRIGGER_AXIS_BY_BUTTON[idx];
    if (axIdx != null) {
      var av = padAxis(pad, axIdx);
      if (av > v) v = av;                 // RT-as-axis 手柄
    }
    return clamp01(v);
  }

  /* 动作对应的按钮是否按下：按钮 pressed 或 扳机量超过阈值 */
  function buttonDown(pad, idx) {
    if (!pad) return false;
    var b = padButton(pad, idx);
    if (b && b.pressed) return true;
    return padTriggerValue(pad, idx) > TRIGGER_THRESHOLD;
  }

  /* 摇杆死区：过死区后重映射到 0..1，保证小幅度输入可用 */
  function applyDeadzone(v) {
    if (v == null || v !== v) return 0;
    if (v > -DEADZONE && v < DEADZONE) return 0;
    var s = v > 0 ? 1 : -1;
    return U.clamp(s * ((Math.abs(v) - DEADZONE) / (1 - DEADZONE)), -1, 1);
  }

  /* 手柄是否产生真实输入（过死区/按下/扳机过阈值），用于设备切换 */
  function padRealInput(pad) {
    if (!pad) return false;
    if (Math.abs(padAxis(pad, AXIS_X)) > DEADZONE) return true;
    if (Math.abs(padAxis(pad, AXIS_Y)) > DEADZONE) return true;
    var btns = pad && pad.buttons;
    if (btns) {
      for (i = 0; i < btns.length; i++) { if (btns[i] && btns[i].pressed) return true; }
    }
    for (var key in TRIGGER_AXIS_BY_BUTTON) {
      if (!has(TRIGGER_AXIS_BY_BUTTON, key)) continue;
      if (padAxis(pad, TRIGGER_AXIS_BY_BUTTON[key]) > TRIGGER_THRESHOLD) return true;
    }
    return false;
  }

  /* 手柄类型识别：PS / Xbox / 通用 */
  function detectKind(id) {
    if (!id) return 'generic';
    if (/054c|dualshock|dualsense|playstation|ps[0-9]/i.test(id)) return 'ps';
    if (/xinput|xbox|045e/i.test(id)) return 'xbox';
    return 'generic';
  }

  function syncPadInfo(pad) {
    if (!pad) return;
    Input.gamepadName = pad.id || null;
    Input.gamepadKind = detectKind(Input.gamepadName);
  }

  /* 当前设备是否允许该动作（禁用后仅菜单/调试生效） */
  function actionEnabled(a) {
    if (Input.enabled) return true;
    if (!Input.menuEnabled) return false;
    return ALWAYS_ACTIONS.indexOf(a) >= 0;
  }

  /* 当前设备对应的提示文案表 */
  function promptTable() {
    if (touchEnabled) return INPUT_CONFIG.prompts.touch || INPUT_CONFIG.prompts.keyboard;
    if (Input.device === 'keyboard') return INPUT_CONFIG.prompts.keyboard;
    if (Input.gamepadKind === 'ps') return INPUT_CONFIG.prompts.ps;
    return INPUT_CONFIG.prompts.gamepad;
  }

  /* ---------------- 键盘事件 ---------------- */
  function onKeyDown(e) {
    var code = e && e.code;
    if (!code) return;
    if (PREVENT_CODES[code] && e.preventDefault) e.preventDefault();

    var acts = CODE_ACTIONS[code];
    if (!acts) return;
    if (acts.indexOf('debug') >= 0 && e.preventDefault) e.preventDefault();

    kbActivityFlag = true;
    lastKeyboardInput = nowSec();

    if (rawKeys[code]) return;              // 忽略系统自动重复
    rawKeys[code] = true;

    for (i = 0; i < acts.length; i++) {
      latchPressed[acts[i]] = true;
      if (acts[i] === 'debug') toggleDebug();
    }
  }

  function onKeyUp(e) {
    var code = e && e.code;
    if (!code) return;
    var acts = CODE_ACTIONS[code];
    if (!acts) return;
    if (!rawKeys[code]) return;
    rawKeys[code] = false;
    for (i = 0; i < acts.length; i++) latchReleased[acts[i]] = true;
  }

  /* 失焦时清空所有按住的键，避免“按键粘滞” */
  function onBlur() {
    for (var code in rawKeys) {
      if (!has(rawKeys, code) || !rawKeys[code]) continue;
      var acts = CODE_ACTIONS[code];
      if (acts) for (i = 0; i < acts.length; i++) latchReleased[acts[i]] = true;
    }
    rawKeys = {};
  }

  function onGamepadConnected(e) {
    var pad = e && e.gamepad;
    if (!pad) return;
    syncPadInfo(pad);
    if (activePadIndex < 0) activePadIndex = (typeof pad.index === 'number') ? pad.index : 0;
    connectedPadCount = Math.max(connectedPadCount, 1);
  }

  function onGamepadDisconnected(e) {
    var pad = e && e.gamepad;
    if (!pad) return;
    if (connectedPadCount > 0) connectedPadCount--;
    if (activePadIndex === pad.index) {
      activePadIndex = -1;
      Input.gamepadName = null;
      Input.gamepadKind = 'generic';
    }
  }

  /* ---------------- F3 调试开关 ---------------- */
  function toggleDebug() {
    if (!CONFIG || !CONFIG.debug) return;
    CONFIG.debug.showHitboxes = !CONFIG.debug.showHitboxes;
    U.bus.emit('debug:toggle', { showHitboxes: CONFIG.debug.showHitboxes });
  }

  /* ---------------- 设备切换 ---------------- */
  function switchDevice(dev) {
    if (dev === Input.device) return;
    Input.device = dev;
    lastSwitchTime = nowSec();
    Input.refreshPrompts();
    var payload = { device: Input.device, kind: Input.gamepadKind, name: Input.gamepadName };
    U.bus.emit('input:device', payload);
    for (i = 0; i < deviceChangeCallbacks.length; i++) {
      try { deviceChangeCallbacks[i](payload); } catch (err) { console.error('[input] deviceChange', err); }
    }
  }

  /* ---------------- 构建索引 ---------------- */
  (function buildIndex() {
    var seen = {}, a, k;
    for (a in KEY_MAP) {
      if (!has(KEY_MAP, a)) continue;
      if (!seen[a]) { seen[a] = 1; ACTION_LIST.push(a); }
      var codes = KEY_MAP[a];
      for (i = 0; i < codes.length; i++) {
        k = codes[i];
        (CODE_ACTIONS[k] = CODE_ACTIONS[k] || []).push(a);
      }
    }
    for (a in BTN_MAP) {
      if (!has(BTN_MAP, a)) continue;
      if (!seen[a]) { seen[a] = 1; ACTION_LIST.push(a); }
    }
    var ta = GP.triggerAxes || {};
    if (typeof ta.l2 === 'number') TRIGGER_AXIS_BY_BUTTON[6] = ta.l2;   // 左扳机 LT -> 按钮 6
    if (typeof ta.r2 === 'number') TRIGGER_AXIS_BY_BUTTON[7] = ta.r2;   // 右扳机 RT -> 按钮 7
  })();

  /* =========================================================================
   * 触屏控制（虚拟摇杆 + 动作按键）
   *   - 仅在触屏设备且未连接手柄时启用
   *   - 触摸事件通过 pointer 统一处理，feed 到既有 state/pressed 合成
   *   - 摇杆输出 touchAxis，按键输出 touchDown，在 update() 中与键盘/手柄合并
   * ====================================================================== */
  var TOUCH_CFG = INPUT_CONFIG.touch || {};
  var touchSupported = (typeof window !== 'undefined') &&
    (('ontouchstart' in window) ||
     (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0));
  var touchEnabled = false;          // 是否当前启用触屏 UI
  var touchVisible = false;          // 战斗中是否显示
  var touchDown = {};                // action -> bool
  var touchAxis = { x: 0, y: 0 };    // 摇杆归一化输出（x 右正，y 前正）
  var touchEl = null, joyBase = null, joyKnob = null;
  var joyPointerId = null, joyOrigin = { x: 0, y: 0 }, joyActive = false;

  function isTouchDevice() { return touchSupported && !!(TOUCH_CFG.enabled); }

  /* 是否应该启用触屏（触屏设备 且 无可用手柄） */
  function shouldEnableTouch() {
    if (!isTouchDevice()) return false;
    return !Input.isConnected();
  }

  /* 构建触屏 DOM */
  function buildTouchDom() {
    if (touchEl) return;
    var doc = document;
    touchEl = doc.createElement('div');
    touchEl.id = 'touch-controls';
    touchEl.className = 'touch-controls';
    touchEl.style.display = 'none';
    touchEl.setAttribute('aria-hidden', 'true');

    /* 摇杆区（左半屏） */
    var joyArea = doc.createElement('div');
    joyArea.className = 'touch-joy-area';
    joyBase = doc.createElement('div');
    joyBase.className = 'touch-joy-base';
    joyKnob = doc.createElement('div');
    joyKnob.className = 'touch-joy-knob';
    joyArea.appendChild(joyBase);
    joyArea.appendChild(joyKnob);
    touchEl.appendChild(joyArea);

    /* 按键区（右半屏） */
    var btns = doc.createElement('div');
    btns.className = 'touch-btns';
    var defs = TOUCH_CFG.buttons || [];
    for (var i = 0; i < defs.length; i++) {
      var d = defs[i];
      var b = doc.createElement('button');
      b.type = 'button';
      b.className = 'touch-btn touch-btn-' + d.action;
      b.setAttribute('data-action', d.action);
      b.style.setProperty('--tb-size', (d.size || 56) + 'px');
      b.textContent = d.label || '';
      btns.appendChild(b);
    }
    /* 暂停键（右上角） */
    var pauseBtn = doc.createElement('button');
    pauseBtn.type = 'button';
    pauseBtn.className = 'touch-btn touch-btn-pause';
    pauseBtn.setAttribute('data-action', 'pause');
    pauseBtn.textContent = '⏸';
    btns.appendChild(pauseBtn);

    touchEl.appendChild(btns);
    doc.body.appendChild(touchEl);

    bindTouchEvents(joyArea, btns);
  }

  function bindTouchEvents(joyArea, btns) {
    var JOY_R = TOUCH_CFG.joystickRadius || 56;
    var JOY_DZ = TOUCH_CFG.joystickDeadzone || 14;

    /* ---- 摇杆 ---- */
    function onJoyDown(e) {
      if (joyPointerId !== null) return;
      e.preventDefault();
      joyPointerId = e.pointerId;
      joyActive = true;
      joyOrigin.x = e.clientX;
      joyOrigin.y = e.clientY;
      joyArea.setPointerCapture(e.pointerId);
      /* 底盘出现于触摸点 */
      joyBase.style.left = joyOrigin.x + 'px';
      joyBase.style.top = joyOrigin.y + 'px';
      joyBase.classList.add('on');
      joyKnob.classList.add('on');
      updateJoy(e.clientX, e.clientY);
    }
    function updateJoy(cx, cy) {
      var dx = cx - joyOrigin.x;
      var dy = cy - joyOrigin.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var clamped = Math.min(dist, JOY_R);
      var ang = Math.atan2(dy, dx);
      var kx = Math.cos(ang) * clamped;
      var ky = Math.sin(ang) * clamped;
      joyKnob.style.transform = 'translate(' + (joyOrigin.x + kx) + 'px,' + (joyOrigin.y + ky) + 'px)';
      if (dist <= JOY_DZ) {
        touchAxis.x = 0; touchAxis.y = 0;
      } else {
        touchAxis.x = kx / JOY_R;
        touchAxis.y = -ky / JOY_R;     // 屏幕 y 向下为正，游戏 y 向前为正
      }
    }
    function onJoyMove(e) {
      if (e.pointerId !== joyPointerId) return;
      e.preventDefault();
      updateJoy(e.clientX, e.clientY);
    }
    function onJoyUp(e) {
      if (e.pointerId !== joyPointerId) return;
      joyPointerId = null;
      joyActive = false;
      touchAxis.x = 0; touchAxis.y = 0;
      joyBase.classList.remove('on');
      joyKnob.classList.remove('on');
      try { joyArea.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    joyArea.addEventListener('pointerdown', onJoyDown, false);
    joyArea.addEventListener('pointermove', onJoyMove, false);
    joyArea.addEventListener('pointerup', onJoyUp, false);
    joyArea.addEventListener('pointercancel', onJoyUp, false);

    /* ---- 按键 ---- */
    var btnList = btns.querySelectorAll('.touch-btn');
    for (var k = 0; k < btnList.length; k++) {
      (function (btn) {
        var action = btn.getAttribute('data-action');
        var pid = null;
        function press(e) {
          e.preventDefault();
          pid = e.pointerId;
          btn.setPointerCapture(e.pointerId);
          btn.classList.add('pressed');
          if (!touchDown[action]) {
            touchDown[action] = true;
            latchPressed[action] = true;   // 边沿：仅首次按下触发
          }
        }
        function release(e) {
          if (e && pid !== null && e.pointerId !== pid) return;
          pid = null;
          btn.classList.remove('pressed');
          if (touchDown[action]) {
            touchDown[action] = false;
            latchReleased[action] = true;
          }
        }
        btn.addEventListener('pointerdown', press, false);
        btn.addEventListener('pointerup', release, false);
        btn.addEventListener('pointercancel', release, false);
        /* 注意：不监听 pointerleave，因为 setPointerCapture 会把后续事件锁定到本按钮，
           手指滑出不会误释放；pointerleave 在部分浏览器会提前触发导致丢输入。 */
      })(btnList[k]);
    }
  }

  /* 设置触屏 UI 可见性（战斗中显示，菜单时隐藏） */
  function setTouchVisible(v) {
    touchVisible = !!v;
    if (touchEl) touchEl.style.display = (touchEnabled && touchVisible) ? '' : 'none';
  }

  /* 启用/停用触屏模式（由设备检测驱动） */
  function setTouchEnabled(v) {
    if (touchEnabled === v) return;
    touchEnabled = v;
    if (v) {
      buildTouchDom();
      touchEl.style.display = touchVisible ? '' : 'none';
      /* 切换为键盘设备分支以便 getAxis 返回含 touch 的键盘轴 */
      if (Input.device !== 'gamepad') {
        Input.device = 'keyboard';
      }
    } else if (touchEl) {
      touchEl.style.display = 'none';
      /* 释放所有按下状态 */
      for (var a in touchDown) touchDown[a] = false;
      touchAxis.x = 0; touchAxis.y = 0;
    }
    U.bus.emit('input:touch', { enabled: v });
  }

  /* 刷新设备检测（每帧由 update 末尾调用） */
  function refreshTouchMode() {
    if (isTouchDevice()) {
      setTouchEnabled(shouldEnableTouch());
    } else {
      setTouchEnabled(false);
    }
  }

  /* =========================================================================
   * Input 单例
   * ====================================================================== */
  var Input = {
    device: INPUT_CONFIG.defaultDevice || 'keyboard', // 'keyboard' | 'gamepad'
    gamepadKind: 'generic',                           // 'xbox' | 'ps' | 'generic'
    gamepadName: null,                                // 手柄 id 字符串或 null
    enabled: true,
    menuEnabled: true,                                // 菜单在 setEnabled(false) 后仍然可用

    /* ---------------- 初始化 ---------------- */
    init: function (target) {
      if (typeof window === 'undefined') return Input;
      boundTarget = target || window;
      if (initialized) return Input;
      if (boundTarget.addEventListener) {
        boundTarget.addEventListener('keydown', onKeyDown, false);
        boundTarget.addEventListener('keyup', onKeyUp, false);
      }
      window.addEventListener('blur', onBlur, false);
      window.addEventListener('gamepadconnected', onGamepadConnected, false);
      window.addEventListener('gamepaddisconnected', onGamepadDisconnected, false);
      initialized = true;
      return Input;
    },

    /* ---------------- 每帧更新 ---------------- */
    update: function (dt) {
      dt = (typeof dt === 'number' && dt > 0) ? dt : 0.016;
      var a, j, p, d, acts, A;

      /* --- 1. 键盘合成状态 --- */
      var kbDown = {}, anyRawKey = false;
      for (a in KEY_MAP) {
        if (!has(KEY_MAP, a)) continue;
        var codes = KEY_MAP[a], down = false;
        for (j = 0; j < codes.length; j++) { if (rawKeys[codes[j]]) { down = true; break; } }
        kbDown[a] = down;
        if (down) anyRawKey = true;
      }

      /* --- 2. 轮询手柄 0..3 --- */
      var gps = safeGetGamepads();
      var pads = [], connected = 0;
      if (gps) {
        for (j = 0; j < 4; j++) { p = gps[j] || null; pads.push(p); if (p) connected++; }
      }
      connectedPadCount = connected;

      /* 选取最近活跃的手柄 */
      var foundActive = -1, firstConnected = -1;
      for (j = 0; j < pads.length; j++) {
        p = pads[j]; if (!p) continue;
        if (firstConnected < 0) firstConnected = j;
        if (foundActive < 0 && padRealInput(p)) foundActive = j;
      }
      if (foundActive >= 0) {
        if (activePadIndex !== foundActive) { activePadIndex = foundActive; syncPadInfo(pads[foundActive]); }
      } else if (activePadIndex < 0 || !pads[activePadIndex]) {
        if (firstConnected >= 0) { activePadIndex = firstConnected; syncPadInfo(pads[firstConnected]); }
        else {
          activePadIndex = -1;
          Input.gamepadName = null;
          Input.gamepadKind = 'generic';
        }
      }
      activePadRef = (activePadIndex >= 0 && pads[activePadIndex]) ? pads[activePadIndex] : null;

      /* 手柄动作状态 */
      var gpDown = {};
      for (a in BTN_MAP) {
        if (!has(BTN_MAP, a)) continue;
        gpDown[a] = activePadRef ? buttonDown(activePadRef, BTN_MAP[a]) : false;
      }

      /* 摇杆与键盘方向轴（P3 触屏：叠加 touchAxis） */
      stickX = activePadRef ? applyDeadzone(padAxis(activePadRef, AXIS_X)) : 0;
      stickY = activePadRef ? applyDeadzone(padAxis(activePadRef, AXIS_Y)) : 0;
      keyAxisX = (kbDown.right ? 1 : 0) - (kbDown.left ? 1 : 0);
      keyAxisY = (kbDown.forward ? 1 : 0) - (kbDown.back ? 1 : 0);
      if (touchEnabled) {
        keyAxisX = U.clamp(keyAxisX + touchAxis.x, -1, 1);
        keyAxisY = U.clamp(keyAxisY + touchAxis.y, -1, 1);
      }

      /* 活跃度采样（用于设备切换） */
      var gpActiveNow = false;
      for (j = 0; j < pads.length; j++) { if (pads[j] && padRealInput(pads[j])) { gpActiveNow = true; break; } }
      if (gpActiveNow) lastGamepadInput = nowSec();
      var kbActiveNow = kbActivityFlag || anyRawKey;
      if (kbActiveNow) lastKeyboardInput = nowSec();
      kbActivityFlag = false;

      /* --- 3. 合成状态与边沿 --- */
      var last = state;
      var next = {};
      var newPressed = {}, newReleased = {};
      for (j = 0; j < ACTION_LIST.length; j++) {
        A = ACTION_LIST[j];
        d = !!(kbDown[A] || gpDown[A] || (touchEnabled && touchDown[A]));
        next[A] = d;
        if (d && !last[A]) newPressed[A] = true;
        if (!d && last[A]) newReleased[A] = true;
      }
      state = next;

      /* 合并事件预锁存（帧内快速点按） */
      for (A in latchPressed) { if (has(latchPressed, A)) newPressed[A] = true; }
      for (A in latchReleased) { if (has(latchReleased, A)) newReleased[A] = true; }
      latchPressed = {};
      latchReleased = {};

      /* --- 4. 菜单方向长按重复（十字键/左摇杆/键盘，统一节奏） --- */
      var menuDirDown = {
        menuUp: !!(kbDown.menuUp || gpDown.menuUp) || stickY < 0,
        menuDown: !!(kbDown.menuDown || gpDown.menuDown) || stickY > 0,
        menuLeft: !!(kbDown.menuLeft || gpDown.menuLeft) || stickX < 0,
        menuRight: !!(kbDown.menuRight || gpDown.menuRight) || stickX > 0
      };
      for (j = 0; j < MENU_DIRS.length; j++) {
        A = MENU_DIRS[j];
        var st = menuRep[A] || (menuRep[A] = { holding: false, timer: 0, first: true });
        if (menuDirDown[A]) {
          if (!st.holding) { st.holding = true; st.timer = 0; st.first = true; newPressed[A] = true; }
          else {
            st.timer += dt;
            var th = st.first ? MENU_INITIAL : MENU_REPEAT_TIME;
            if (st.timer >= th) { st.timer -= th; st.first = false; newPressed[A] = true; }
          }
        } else { st.holding = false; st.timer = 0; st.first = true; }
      }

      pressed = newPressed;
      released = newReleased;

      /* --- 5. 设备热切换（静默门限 + 忽略抖动，避免来回跳） --- */
      var now = nowSec();
      if (Input.device === 'keyboard') {
        if (gpActiveNow && (now - lastKeyboardInput) >= SWITCH_IDLE && (now - lastSwitchTime) >= SWITCH_IDLE) {
          switchDevice('gamepad');
        }
      } else {
        if (kbActiveNow && (now - lastGamepadInput) >= SWITCH_IDLE && (now - lastSwitchTime) >= SWITCH_IDLE) {
          switchDevice('keyboard');
        }
      }

      /* --- 6. 触屏模式检测（每帧） --- */
      refreshTouchMode();
    },

    /* ---------------- 查询 ---------------- */
    isConnected: function () {
      var gps = safeGetGamepads();
      if (!gps) return false;
      for (i = 0; i < 4; i++) { if (gps[i]) return true; }
      return false;
    },

    isDown: function (a) { return actionEnabled(a) && !!state[a]; },
    justPressed: function (a) { return actionEnabled(a) && !!pressed[a]; },
    justReleased: function (a) { return actionEnabled(a) && !!released[a]; },

    consume: function (a) {
      if (pressed[a]) { pressed[a] = false; return true; }
      return false;
    },

    /* 方向轴：y > 0 表示向前，x > 0 表示向右 */
    getAxis: function () {
      if (!Input.enabled) return { x: 0, y: 0 };
      if (Input.device === 'gamepad' && activePadRef) return { x: stickX, y: -stickY };
      return { x: keyAxisX, y: keyAxisY };
    },

    /* 触屏相关（UI/主循环调用） */
    setTouchVisible: function (v) { setTouchVisible(v); return Input; },
    isTouchEnabled: function () { return touchEnabled; },
    isTouchDevice: function () { return isTouchDevice(); },

    /* 扳机量 0..1 */
    getTrigger: function (a) {
      if (!actionEnabled(a)) return 0;
      if (Input.device === 'keyboard') return state[a] ? 1 : 0;
      var idx = BTN_MAP[a];
      if (idx == null || !activePadRef) return state[a] ? 1 : 0;
      var b = padButton(activePadRef, idx);
      if (b && b.pressed) return 1;
      return padTriggerValue(activePadRef, idx);
    },

    getPromptGlyph: function (a) {
      var t = promptTable();
      var k = PROMPT_KEY[a] || a;
      var v = t[k];
      return (typeof v === 'string') ? v : '';
    },

    getPrompt: function (a) {
      var glyph = Input.getPromptGlyph(a);
      var name = INPUT_CONFIG.promptActionNames[a];
      if (glyph && name) return glyph + ' ' + name;
      return glyph || name || '';
    },

    deviceLabel: function () {
      var t = promptTable();
      if (t && typeof t.label === 'string') return t.label;
      return Input.device === 'keyboard' ? '键盘模式' : '手柄模式';
    },

    /* 把所有 data-prompt="<action>" 节点的文案替换为当前设备提示（UI 尚未创建时安全返回） */
    refreshPrompts: function () {
      if (typeof document === 'undefined' || !document.querySelectorAll) return;
      var nodes = document.querySelectorAll('[data-prompt]');
      for (i = 0; i < nodes.length; i++) {
        var a = nodes[i].getAttribute('data-prompt');
        if (a) nodes[i].textContent = Input.getPromptGlyph(a);
      }
    },

    setEnabled: function (b) { Input.enabled = !!b; return Input; },

    getActionList: function () { return ACTION_LIST.slice(); },

    onDeviceChange: function (fn) {
      if (typeof fn === 'function') deviceChangeCallbacks.push(fn);
      return fn;
    }
  };

  GAME.Input = Input;

})(typeof window !== 'undefined' ? window : this);
