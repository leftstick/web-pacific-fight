/* =============================================================================
 * physics.js  ──  物理世界（Ammo.js 封装 + 无 Ammo 时的极简回退积分）
 * 依赖：config.js（GAME.CONFIG / GAME.U）
 * 加载方式：普通 <script>，挂载 window.GAME.Physics
 *
 * ---------------------------------------------------------------------------
 * 设计要点：
 *  · Ammo.js（asm.js 构建）由 index.html 以经典 <script> 引入；
 *    window.Ammo 是一个「函数」，调用后返回 Promise。本模块在 init() 内
 *    （即运行期）才去获取与使用它，绝不在模块顶层求值期间引用 Ammo 或 THREE。
 *  · 处理三种加载情形：已加载（window.Ammo 已存在）、仍在加载（轮询等待）、
 *    完全缺失（等待超时）。
 *  · Ammo 不可用时：available=false、world=null，动态碎片改用极简欧拉积分，
 *    使碎片视觉仍然可用；击退退化为等价的纯数学校验。
 * ---------------------------------------------------------------------------
 * ========================================================================== */
(function (global) {
  'use strict';

  var GAME = global.GAME;
  if (!GAME) { console.error('[Physics] 缺少 GAME，请先加载 config.js'); return; }

  /* ------------------------- 内部实现常量 ------------------------- */
  /* 以下为 config 未定义的实现细节，故在此集中定义（不硬编码 config 已有值） */
  var STEP = 1 / 60;             // 固定物理步长（秒）
  var MAX_SUB = 4;               // 每帧最多子步数，防止卡顿后螺旋
  var AMMO_WAIT_MS = 8000;       // 等待 window.Ammo 出现的最长时间
  var MASS_REF = 1000;           // 击退质量归一化基准（与 def.hp * def.defense 同量纲）
  var PROBE_RADIUS = 1.0;        // 击退探针球半径
  var MIN_PROBE_MASS = 0.4;      // 探针质量下限
  var MAX_PROBE_MASS = 6.0;      // 探针质量上限
  var FALLBACK_RESTITUTION = 0.05; // 回退积分的弹性系数
  var FALLBACK_FRICTION = 0.86;    // 触地后的水平阻尼
  var GROUND_FRICTION = 0.9;       // 地面摩擦（≈0.9）
  var GROUND_RESTITUTION = 0.05;   // 地面弹性（≈0.05）
  var WALL_FRICTION = 0.4;         // 边界墙摩擦

  /* 已解析出的 Ammo 模块对象（仅在函数内赋值/使用，顶层不引用 Ammo 名称） */
  var ammoLib = null;

  function nowMs() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ---------------------------------------------------------------------------
   * 等待 window.Ammo 出现：处理「脚本仍在加载」的情形；超时返回 null
   * ------------------------------------------------------------------------ */
  function waitForAmmoGlobal() {
    return new Promise(function (resolve) {
      if (typeof global.Ammo !== 'undefined' && global.Ammo !== null) return resolve(global.Ammo);
      if (typeof setTimeout === 'undefined') return resolve(null);
      var start = nowMs();
      var timer = setInterval(function () {
        if (typeof global.Ammo !== 'undefined' && global.Ammo !== null) {
          clearInterval(timer);
          resolve(global.Ammo);
        } else if (nowMs() - start > AMMO_WAIT_MS) {
          clearInterval(timer);
          resolve(null);
        }
      }, 16);
    });
  }

  /* ---------------------------------------------------------------------------
   * 把 window.Ammo 归一成可用的 Ammo 模块对象，never reject（失败解析为 null）
   *   · A 为函数（asm.js 构建）→ 调用并等待其返回的 Promise
   *   · A 已是对象 → 直接使用
   * ------------------------------------------------------------------------ */
  function acquireAmmo(A) {
    return new Promise(function (resolve) {
      if (A === undefined || A === null) return resolve(null);
      if (typeof A === 'function') {
        var ret;
        try { ret = A(); } catch (e) { return resolve(null); }
        if (ret && typeof ret.then === 'function') {
          ret.then(function (mod) {
            resolve(pickModule(mod, A));
          }, function () { resolve(null); });
        } else {
          resolve(pickModule(ret, A));
        }
      } else {
        resolve(pickModule(A, A));
      }
    });
  }

  /* 选择真正带有物理类的模块对象；没有核心类则视为不可用 */
  function pickModule(a, b) {
    var has = function (m) { return m && m.btDiscreteDynamicsWorld && m.btBoxShape && m.btRigidBody; };
    if (has(a)) return a;
    if (has(b)) return b;
    return null;
  }

  /* ===========================================================================
   * Physics 主体
   * ======================================================================== */
  var Physics = {
    /* --- 对外可见状态 --- */
    available: false,        // 是否成功启用真实 Ammo 物理
    world: null,             // Ammo 世界（未启用时为 null）

    /* --- 内部状态 --- */
    _three: null,
    _arena: null,
    _grav: -9.8,
    _debrisLife: 6.0,
    _handles: [],            // 已注册的刚体句柄
    _probes: {},             // 每单位一个轻量击退探针（不参与公共查询）
    _acc: 0,                 // 固定步长累加器
    _stepCount: 0,
    _substepCount: 0,
    _cfg: null, _dispatcher: null, _solver: null,

    /* =======================================================================
     * init(opts) -> Promise<boolean>
     *   opts {three, arena, gravity}；Ammo 就绪返回 true，不可用返回 false。
     *   永不 reject。
     * ==================================================================== */
    init: function (opts) {
      var self = this;
      opts = opts || {};
      this._three = opts.three || this._three || null;
      this._arena = opts.arena || this._arena || (GAME.CONFIG && GAME.CONFIG.arena) || null;

      /* 重力：优先 opts.gravity，其次 arena.gravity（来自 config） */
      if (opts.gravity !== undefined && opts.gravity !== null) this._grav = opts.gravity;
      else if (this._arena && this._arena.gravity !== undefined) this._grav = this._arena.gravity;

      /* 碎片寿命：来自 CONFIG.combat.destructible.debrisLife */
      var C = GAME.CONFIG && GAME.CONFIG.combat;
      if (C && C.destructible && C.destructible.debrisLife !== undefined) this._debrisLife = C.destructible.debrisLife;

      this._acc = 0;
      this._stepCount = 0;
      this._substepCount = 0;

      return waitForAmmoGlobal()
        .then(function (A) { return acquireAmmo(A); })
        .then(function (mod) {
          if (!mod) { self.available = false; self.world = null; return false; }
          ammoLib = mod;
          try {
            self.initWorld();
            self.available = true;
          } catch (e) {
            console.warn('[Physics] Ammo 世界初始化失败，转入回退模式：', e);
            try { self._disposeWorld(); } catch (e2) {}
            self.available = false;
            self.world = null;
            return false;
          }
          return true;
        })
        .catch(function (e) {
          console.warn('[Physics] init 异常，转入回退模式：', e);
          self.available = false; self.world = null;
          return false;
        });
    },

    /* =======================================================================
     * initWorld()  ──  构建 Ammo 世界与地面/边界墙（无 Ammo 时返回 null）
     * ==================================================================== */
    initWorld: function () {
      if (!ammoLib) { this.world = null; return null; }
      var Ammo = ammoLib;

      /* 先清理旧世界（含探针） */
      this._disposeWorld();

      var cfg = new Ammo.btDefaultCollisionConfiguration();
      var dispatcher = new Ammo.btCollisionDispatcher(cfg);
      var broadphase = new Ammo.btDbvtBroadphase();
      var solver = new Ammo.btSequentialImpulseConstraintSolver();
      var world = new Ammo.btDiscreteDynamicsWorld(dispatcher, broadphase, solver, cfg);
      world.setGravity(this._toVec(0, this._grav, 0));

      this._cfg = cfg;
      this._dispatcher = dispatcher;
      this._broadphase = broadphase;
      this._solver = solver;
      this.world = world;

      /* --- 地面：y=0 顶面，尺寸取自 arena.width / arena.depth --- */
      var aw = (this._arena && this._arena.width) || 96;
      var ad = (this._arena && this._arena.depth) || 30;
      this.addStaticBox(
        { x: 0, y: -1, z: 0 },
        { x: aw / 2, y: 1, z: ad / 2 },
        { kind: 'ground', friction: GROUND_FRICTION, restitution: GROUND_RESTITUTION }
      );

      /* --- 两堵不可见的边界墙：内侧面位于 x = ±arena.width/2 --- */
      var wallT = 1;
      var wallH = 40;
      var wallX = aw / 2 + wallT;
      this.addStaticBox(
        { x: -wallX, y: wallH / 2, z: 0 },
        { x: wallT, y: wallH / 2, z: ad / 2 },
        { kind: 'wall', friction: WALL_FRICTION, restitution: GROUND_RESTITUTION }
      );
      this.addStaticBox(
        { x: wallX, y: wallH / 2, z: 0 },
        { x: wallT, y: wallH / 2, z: ad / 2 },
        { kind: 'wall', friction: WALL_FRICTION, restitution: GROUND_RESTITUTION }
      );

      return world;
    },

    /* =======================================================================
     * addStaticBox(center, halfExtents, userData) -> handle（无 Ammo 时返回 null）
     *   halfExtents 为半尺寸；userData 可含 friction / restitution 覆盖默认值。
     * ==================================================================== */
    addStaticBox: function (center, halfExtents, userData) {
      if (!ammoLib || !this.world) return null;
      var Ammo = ammoLib;
      var he = halfExtents || { x: 1, y: 1, z: 1 };
      var c = center || { x: 0, y: 0, z: 0 };
      var hx = Math.max(0.01, he.x || 0), hy = Math.max(0.01, he.y || 0), hz = Math.max(0.01, he.z || 0);

      var shape = new Ammo.btBoxShape(this._toVec(hx, hy, hz));
      var tr = new Ammo.btTransform();
      tr.setIdentity();
      tr.setOrigin(this._toVec(c.x, c.y, c.z));
      var ms = new Ammo.btDefaultMotionState(tr);
      var info = new Ammo.btRigidBodyConstructionInfo(0, ms, shape);
      var body = new Ammo.btRigidBody(info);
      body.setFriction((userData && userData.friction !== undefined) ? userData.friction : GROUND_FRICTION);
      body.setRestitution((userData && userData.restitution !== undefined) ? userData.restitution : GROUND_RESTITUTION);
      this.world.addRigidBody(body);

      Ammo.destroy(info);
      Ammo.destroy(tr);

      var handle = {
        body: body,
        shape: shape,
        motionState: ms,
        kind: 'static',
        userData: userData || null,
        half: { x: hx, y: hy, z: hz },
        mesh: null,
        syncMesh: false
      };
      this._handles.push(handle);
      return handle;
    },

    /* =======================================================================
     * addDynamicBox(size, position, mass, userData) -> handle
     *   size 为「整体尺寸」(x,y,z 全长)，内部换算为半尺寸。
     *   kind:'dynamic'，life = CONFIG.combat.destructible.debrisLife（到点自动回收）。
     *   无 Ammo 时返回带 pos/vel 的轻量句柄，交给回退积分器。
     * ==================================================================== */
    addDynamicBox: function (size, position, mass, userData) {
      var sz = size || { x: 1, y: 1, z: 1 };
      var pos = position || { x: 0, y: 0, z: 0 };
      var half = { x: Math.max(0.01, (sz.x || 1) * 0.5), y: Math.max(0.01, (sz.y || 1) * 0.5), z: Math.max(0.01, (sz.z || 1) * 0.5) };
      var m = (mass && mass > 0) ? mass : 1;
      var initVel = (userData && userData.velocity) || null;

      /* 无 Ammo：轻量回退句柄（仅维护位置/速度/尺寸） */
      if (!ammoLib || !this.world) {
        var fh = {
          body: null, mesh: null, size: sz, half: half,
          userData: userData || null, kind: 'dynamic', life: this._debrisLife,
          pos: { x: pos.x, y: pos.y, z: pos.z },
          vel: { x: initVel ? initVel.x : 0, y: initVel ? initVel.y : 0, z: initVel ? initVel.z : 0 },
          syncMesh: false
        };
        this._handles.push(fh);
        return fh;
      }

      var Ammo = ammoLib;
      var shape = new Ammo.btBoxShape(this._toVec(half.x, half.y, half.z));
      var tr = new Ammo.btTransform();
      tr.setIdentity();
      tr.setOrigin(this._toVec(pos.x, pos.y, pos.z));
      var ms = new Ammo.btDefaultMotionState(tr);
      var inertia = this._toVec(0, 0, 0);
      if (m > 0) shape.calculateLocalInertia(m, inertia);
      var info = new Ammo.btRigidBodyConstructionInfo(m, ms, shape, inertia);
      var body = new Ammo.btRigidBody(info);
      body.setFriction((userData && userData.friction !== undefined) ? userData.friction : GROUND_FRICTION);
      body.setRestitution((userData && userData.restitution !== undefined) ? userData.restitution : FALLBACK_RESTITUTION);
      this.world.addRigidBody(body);

      if (initVel) body.setLinearVelocity(this._toVec(initVel.x || 0, initVel.y || 0, initVel.z || 0));

      Ammo.destroy(info);
      Ammo.destroy(tr);

      var handle = {
        body: body, mesh: null, size: sz, half: half,
        userData: userData || null, kind: 'dynamic', life: this._debrisLife,
        shape: shape, motionState: ms, inertia: inertia,
        syncMesh: false
      };
      this._handles.push(handle);
      return handle;
    },

    /* 挂接渲染网格；若可读取当前变换则立即同步一次 */
    attachMesh: function (handle, mesh) {
      if (!handle) return handle;
      handle.mesh = mesh || null;
      handle.syncMesh = true;
      this._syncHandle(handle);
      return handle;
    },

    /* =======================================================================
     * syncBodies()  ──  把刚体世界变换写入网格（motionState.getWorldTransform）
     * ==================================================================== */
    syncBodies: function () {
      for (var i = 0; i < this._handles.length; i++) {
        this._syncHandle(this._handles[i]);
      }
    },

    /* 单个句柄同步：Ammo 走 motionState；回退走 pos */
    _syncHandle: function (h) {
      if (!h || !h.mesh) return;
      var mesh = h.mesh;
      if (this.available && h.body && h.motionState) {
        var tr = h.motionState.getWorldTransform();
        var o = tr.getOrigin();
        var r = tr.getRotation();
        if (mesh.position && mesh.position.set) mesh.position.set(o.x(), o.y(), o.z());
        if (mesh.quaternion && mesh.quaternion.set) mesh.quaternion.set(r.x(), r.y(), r.z(), r.w());
      } else if (h.pos) {
        if (mesh.position && mesh.position.set) mesh.position.set(h.pos.x, h.pos.y, h.pos.z);
      }
    },

    /* =======================================================================
     * removeBody(handle) ── 从世界移除并销毁形状/惯性/运动状态（杜绝 Ammo 泄漏）
     * ==================================================================== */
    removeBody: function (handle) {
      if (!handle) return false;
      if (ammoLib && this.world && handle.body) {
        var Ammo = ammoLib;
        try { this.world.removeRigidBody(handle.body); } catch (e) { /* 已移除 */ }
        Ammo.destroy(handle.body);
        if (handle.motionState) Ammo.destroy(handle.motionState);
        if (handle.shape) Ammo.destroy(handle.shape);
        if (handle.inertia) Ammo.destroy(handle.inertia);
      }
      var i = this._handles.indexOf(handle);
      if (i >= 0) this._handles.splice(i, 1);
      return true;
    },

    /* =======================================================================
     * step(dt)  ──  固定 1/60 累加器（最多 4 子步），应用配置重力；
     *              Ammo 缺失时对碎片做回退积分；始终推进碎片寿命。
     * ==================================================================== */
    step: function (dt) {
      if (!(dt > 0)) return;
      this._acc += dt;
      var n = 0;
      while (this._acc >= STEP && n < MAX_SUB) {
        this._substep(STEP);
        this._acc -= STEP;
        n++;
      }
      if (n >= MAX_SUB) this._acc = 0;    // 丢弃积压，防止追帧螺旋
      this._stepCount++;
      this._updateDebrisLife(dt);
    },

    /* 单个物理子步 */
    _substep: function (h) {
      if (this.available && this.world) {
        this.world.stepSimulation(h, 1, h);   // 固定步长，重力由世界施加
        this._substepCount++;
        return;
      }
      /* 无 Ammo：极简欧拉积分，仅驱动动态碎片的视觉 */
      var g = this._grav;
      for (var i = 0; i < this._handles.length; i++) {
        var d = this._handles[i];
        if (d.kind !== 'dynamic' || !d.pos) continue;
        d.vel.y += g * h;
        d.pos.x += d.vel.x * h;
        d.pos.y += d.vel.y * h;
        d.pos.z += d.vel.z * h;
        var floor = d.half ? d.half.y : 0;
        if (d.pos.y < floor) {
          d.pos.y = floor;
          if (d.vel.y < 0) d.vel.y = -d.vel.y * FALLBACK_RESTITUTION;
          if (Math.abs(d.vel.y) < 0.4) d.vel.y = 0;   // 抑制无限微弹跳
          d.vel.x *= FALLBACK_FRICTION;
          d.vel.z *= FALLBACK_FRICTION;
        }
      }
      this._substepCount++;
    },

    /* 碎片寿命：到点回收；存在 userData.onExpire 则回调 */
    _updateDebrisLife: function (dt) {
      for (var i = this._handles.length - 1; i >= 0; i--) {
        var h = this._handles[i];
        if (h.kind !== 'dynamic') continue;
        h.life -= dt;
        if (h.life <= 0) {
          if (h.userData && typeof h.userData.onExpire === 'function') {
            try { h.userData.onExpire(h); } catch (e) { console.error('[Physics] onExpire 异常', e); }
          }
          this.removeBody(h);
        }
      }
    },

    /* =======================================================================
     * raycast(from, to, filter) -> {hit, point, normal, distance, body, handle, userData}
     *   filter 为可选谓词 (handle) => bool；命中对象未通过谓词时视为未命中。
     * ==================================================================== */
    raycast: function (from, to, filter) {
      var miss = { hit: false, point: null, normal: null, distance: 0, body: null, handle: null, userData: null };
      if (!ammoLib || !this.world || !from || !to) return miss;
      var Ammo = ammoLib;

      var fv = this._toVec(from.x, from.y, from.z);
      var tv = this._toVec(to.x, to.y, to.z);
      var cb = new Ammo.ClosestRayResultCallback(fv, tv);
      this.world.rayTest(fv, tv, cb);

      var out = miss;
      if (cb.hasHit()) {
        var pt = cb.get_m_hitPointWorld();
        var nm = cb.get_m_hitNormalWorld();
        var body = cb.get_m_collisionObject();
        var handle = this._findHandleByBody(body);
        if (!filter || filter(handle, body) !== false) {
          var px = pt.x(), py = pt.y(), pz = pt.z();
          var dx = px - from.x, dy = py - from.y, dz = pz - from.z;
          out = {
            hit: true,
            point: { x: px, y: py, z: pz },
            normal: { x: nm.x(), y: nm.y(), z: nm.z() },
            distance: Math.sqrt(dx * dx + dy * dy + dz * dz),
            body: body,
            handle: handle || null,
            userData: handle ? handle.userData : null
          };
        }
      }

      Ammo.destroy(cb);
      Ammo.destroy(fv);
      Ammo.destroy(tv);
      return out;
    },

    /* =======================================================================
     * querySphere(center, radius) -> [userData, ...]
     *   以句柄包围球近似判定：中心距 <= radius + 句柄包围球半径。
     * ==================================================================== */
    querySphere: function (center, radius) {
      var out = [];
      if (!center) return out;
      var r = radius || 0;
      for (var i = 0; i < this._handles.length; i++) {
        var h = this._handles[i];
        if (!h.userData) continue;
        var o = this._handleOrigin(h);
        if (!o) continue;
        var br = h.half ? Math.max(h.half.x, h.half.y, h.half.z) : 0;
        var dx = o.x - center.x, dy = o.y - center.y, dz = o.z - center.z;
        var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d <= r + br) out.push(h.userData);
      }
      return out;
    },

    /* =======================================================================
     * knockback(unit, dir{x,y,z}, force) -> {x,y,z}
     *
     * 【击退数学说明】
     *   每个单位维护一个轻量动态球探针（btSphereShape）。调用时：
     *     1) 把探针「传送」到 unit.getHitCenter()（setWorldTransform）；
     *     2) 清零线/角速度后施加中央冲量 impulse = dir * force；
     *     3) 读回 resulting linear velocity（getLinearVelocity）；
     *     4) 把探针重置到世界外（y=-1000），避免干扰其它查询。
     *   探针质量 = clamp((def.hp * def.defense) / MASS_REF)，因此
     *     所得速度 = impulse / 探针质量 ≈ force * MASS_REF / (def.hp * def.defense)，
     *   即「击退幅度与单位质量成反比」——重装单位更难被击飞。
     *   Ammo 不可用时退化为同一条纯数学公式，保证行为一致。
     * ==================================================================== */
    knockback: function (unit, dir, force) {
      var out = { x: 0, y: 0, z: 0 };
      if (!unit) return out;
      var d = dir || { x: 0, y: 0, z: 0 };
      var len = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
      if (len < 1e-6) return out;
      var nx = d.x / len, ny = d.y / len, nz = d.z / len;

      var def = unit.def || {};
      var unitMass = Math.max(1, (def.hp || 1000) * (def.defense || 1));

      /* 无 Ammo：纯数学等价公式 */
      if (!this.available || !this.world || !ammoLib) {
        var sc = force * MASS_REF / unitMass;
        out.x = nx * sc; out.y = ny * sc; out.z = nz * sc;
        return out;
      }

      var Ammo = ammoLib;
      var probe = this._getProbe(unit, unitMass);
      if (!probe) {
        var sc2 = force * MASS_REF / unitMass;
        out.x = nx * sc2; out.y = ny * sc2; out.z = nz * sc2;
        return out;
      }

      var ctr = (unit.getHitCenter && unit.getHitCenter()) || unit.position || { x: 0, y: 0, z: 0 };

      /* 1) 传送探针到受击中心 */
      var tr = new Ammo.btTransform();
      tr.setIdentity();
      tr.setOrigin(this._toVec(ctr.x, ctr.y, ctr.z));
      probe.body.setWorldTransform(tr);
      probe.body.activate();
      Ammo.destroy(tr);

      /* 2) 清零速度后施加冲量 */
      probe.body.setLinearVelocity(this._toVec(0, 0, 0));
      probe.body.setAngularVelocity(this._toVec(0, 0, 0));
      var imp = this._toVec(nx * force, ny * force, nz * force);
      probe.body.applyCentralImpulse(imp);
      Ammo.destroy(imp);

      /* 3) 读回结果速度 */
      var lv = probe.body.getLinearVelocity();
      out.x = lv.x(); out.y = lv.y(); out.z = lv.z();

      /* 4) 重置探针 */
      var rtr = new Ammo.btTransform();
      rtr.setIdentity();
      rtr.setOrigin(this._toVec(0, -1000, 0));
      probe.body.setWorldTransform(rtr);
      Ammo.destroy(rtr);
      probe.body.setLinearVelocity(this._toVec(0, 0, 0));
      probe.body.setAngularVelocity(this._toVec(0, 0, 0));

      return out;
    },

    /* 取得（或惰性创建）某单位的击退探针 */
    _getProbe: function (unit, unitMass) {
      if (!ammoLib || !this.world) return null;
      var key = (unit.id !== undefined && unit.id !== null) ? String(unit.id) : 'anon';
      var p = this._probes[key];
      if (p) return p;

      var Ammo = ammoLib;
      var mass = clamp(unitMass / MASS_REF, MIN_PROBE_MASS, MAX_PROBE_MASS);
      var shape = new Ammo.btSphereShape(PROBE_RADIUS);
      var tr = new Ammo.btTransform();
      tr.setIdentity();
      tr.setOrigin(this._toVec(0, -1000, 0));
      var ms = new Ammo.btDefaultMotionState(tr);
      var inertia = this._toVec(0, 0, 0);
      shape.calculateLocalInertia(mass, inertia);
      var info = new Ammo.btRigidBodyConstructionInfo(mass, ms, shape, inertia);
      var body = new Ammo.btRigidBody(info);
      /* 传送体禁用休眠，保证每次传送后可立即响应冲量 */
      var disableDeact = (Ammo.DISABLE_DEACTIVATION !== undefined) ? Ammo.DISABLE_DEACTIVATION : 4;
      body.setActivationState(disableDeact);
      body.setFriction(WALL_FRICTION);
      body.setRestitution(GROUND_RESTITUTION);
      this.world.addRigidBody(body);

      Ammo.destroy(info);
      Ammo.destroy(tr);

      p = { body: body, shape: shape, motionState: ms, inertia: inertia, mass: mass };
      this._probes[key] = p;
      return p;
    },

    /* =======================================================================
     * isOnGround(position) -> bool
     * ==================================================================== */
    isOnGround: function (position) {
      if (!position) return false;
      if (this.available && this.world && ammoLib) {
        var Ammo = ammoLib;
        var fv = this._toVec(position.x, position.y + 0.5, position.z);
        var tv = this._toVec(position.x, position.y - 1.0, position.z);
        var cb = new Ammo.ClosestRayResultCallback(fv, tv);
        this.world.rayTest(fv, tv, cb);
        var hit = cb.hasHit();
        Ammo.destroy(cb);
        Ammo.destroy(fv);
        Ammo.destroy(tv);
        return hit;
      }
      /* 回退：以地面高度近似判定 */
      return position.y <= 0.25;
    },

    /* 设置重力（写入 Ammo 世界） */
    setGravity: function (g) {
      this._grav = g;
      if (ammoLib && this.world) {
        this.world.setGravity(this._toVec(0, g, 0));
      }
    },

    /* 运行统计 */
    getStats: function () {
      var s = 0, d = 0, de = 0;
      for (var i = 0; i < this._handles.length; i++) {
        if (this._handles[i].kind === 'static') s++;
        else { d++; de++; }
      }
      var probeCount = 0;
      for (var k in this._probes) if (this._probes.hasOwnProperty(k)) probeCount++;
      return {
        available: this.available,
        worldReady: !!this.world,
        gravity: this._grav,
        bodies: this._handles.length,
        staticBodies: s,
        dynamicBodies: d,
        debris: de,
        probes: probeCount,
        steps: this._stepCount,
        substeps: this._substepCount,
        accumulator: this._acc
      };
    },

    /* =======================================================================
     * reset()  ──  清空全部刚体/探针，重建世界（地面与边界墙）
     * ==================================================================== */
    reset: function () {
      this._removeAllBodies();
      this._disposeProbes();
      this._acc = 0;
      this._stepCount = 0;
      this._substepCount = 0;
      if (ammoLib) {
        this.initWorld();
        this.available = true;
      } else {
        this.available = false;
        this.world = null;
      }
      return this;
    },

    /* =======================================================================
     * dispose()  ──  释放全部资源（刚体、探针、世界、求解器、配置）
     * ==================================================================== */
    dispose: function () {
      this._removeAllBodies();
      this._disposeProbes();
      this._disposeWorld();
      this.available = false;
      this.world = null;
      this._acc = 0;
    },

    /* ------------------------- 内部辅助 ------------------------- */

    /* 创建并销毁一个临时 btVector3（用于各种 Ammo 调用） */
    _toVec: function (x, y, z) {
      return new ammoLib.btVector3(x, y, z);
    },

    /* 通过刚体指针反查句柄 */
    _findHandleByBody: function (body) {
      if (!body) return null;
      for (var i = 0; i < this._handles.length; i++) {
        if (this._handles[i].body === body) return this._handles[i];
      }
      return null;
    },

    /* 取得句柄当前原点（Ammo 走 motionState，回退走 pos） */
    _handleOrigin: function (h) {
      if (this.available && h.body && h.motionState) {
        var o = h.motionState.getWorldTransform().getOrigin();
        return { x: o.x(), y: o.y(), z: o.z() };
      }
      if (h.pos) return h.pos;
      return null;
    },

    _removeAllBodies: function () {
      for (var i = this._handles.length - 1; i >= 0; i--) {
        this.removeBody(this._handles[i]);
      }
      this._handles.length = 0;   // 双保险
    },

    _disposeProbes: function () {
      if (!this._probes) { this._probes = {}; return; }
      var Ammo = ammoLib;
      for (var k in this._probes) {
        if (!this._probes.hasOwnProperty(k)) continue;
        var p = this._probes[k];
        if (Ammo) {
          if (this.world && p.body) { try { this.world.removeRigidBody(p.body); } catch (e) {} }
          if (p.body) Ammo.destroy(p.body);
          if (p.motionState) Ammo.destroy(p.motionState);
          if (p.shape) Ammo.destroy(p.shape);
          if (p.inertia) Ammo.destroy(p.inertia);
        }
      }
      this._probes = {};
    },

    /* 销毁 Ammo 世界及其组件（不动句柄；句柄应已由 _removeAllBodies 处理） */
    _disposeWorld: function () {
      var Ammo = ammoLib;
      if (!Ammo) { this.world = null; return; }
      if (this.world) { try { Ammo.destroy(this.world); } catch (e) {} }
      if (this._solver) { try { Ammo.destroy(this._solver); } catch (e) {} }
      if (this._broadphase) { try { Ammo.destroy(this._broadphase); } catch (e) {} }
      if (this._dispatcher) { try { Ammo.destroy(this._dispatcher); } catch (e) {} }
      if (this._cfg) { try { Ammo.destroy(this._cfg); } catch (e) {} }
      this.world = null;
      this._solver = null;
      this._broadphase = null;
      this._dispatcher = null;
      this._cfg = null;
    }
  };

  GAME.Physics = Physics;

})(typeof window !== 'undefined' ? window : this);
