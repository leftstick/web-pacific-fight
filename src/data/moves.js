/* =============================================================================
 * data/moves.js ── 招式帧数据工厂
 * 所有招式均为纯数据：startup / active / recovery / 伤害 / 硬直 / 推开距离 /
 * 打击等级 / 是否击倒 / 取消窗口 / 判定框。绘制与判定逻辑只读这些字段。
 * ========================================================================== */

/** 判定框：from~to 为招式内帧区间，x/y 为角色本地坐标（x 向前，y 向上，负值=高处） */
export function hb(from, to, x, y, w, h) {
  return { from, to, x, y, w, h };
}

/**
 * 创建招式数据。
 * level: 'mid' 中段(站/蹲防皆可) | 'low' 下段(必须蹲防) |
 *        'overhead' 中段(跳跃攻击，必须站防) | 'throw' 投技(不可防) | 'unblockable'
 */
export function makeMove(o) {
  const m = Object.assign({
    name: '',
    anim: 'light',        // 动画类别：light/heavy/low/air/special/super/throw/breath/slam
    startup: 6,
    active: 3,
    recovery: 12,
    damage: 30,
    hitstun: 14,
    blockstun: 9,
    push: 2.2,            // 命中推开距离（像素/帧的初速度）
    level: 'mid',
    knockdown: false,
    cancel: [],           // 可取消到的招式 key
    hitstop: 6,
    meterGain: 2,
    meterCost: 0,
    hitboxes: [],
    whiffSfx: 'whiff',
    hitSfx: 'hitLight',
    chip: 0.12,           // 防御时的削血比例
    armor: 0,             // 霸体：可硬吃几次攻击
    projectile: null,     // 发射物参数 {speed, w, h, life, damage, hitstun, level, color}
    spawnFrame: 0,        // 发射/机制触发帧（相对招式开始）
    mechanic: null        // 怪兽机制：projectile/strike/burrow/multi/trap/cloud/dash
  }, o);
  m.total = m.startup + m.active + m.recovery;
  return m;
}
