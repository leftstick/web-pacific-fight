/* =============================================================================
 * data/stages.js ── 3 个像素舞台（视差 3 层）
 *  ruins 废墟都市 / lava 熔岩深渊 / space 太空站
 * ========================================================================== */

export const STAGES = [
  {
    id: 'ruins',
    name: '废墟都市',
    sub: '雨夜 · 第 7 区',
    sky: ['#070d16', '#0d1a29', '#14283a', '#1b3547'],
    far: '#0b1620', mid: '#122430', near: '#1a3140',
    ground: '#253744', ground2: '#192831', line: '#33505f',
    accent: '#6fd0ff', glow: '#9fe8ff',
    stars: 40, moon: true, weather: 'rain', groundFx: 'rubble'
  },
  {
    id: 'lava',
    name: '熔岩深渊',
    sub: '地心 · 熔炉层',
    sky: ['#150608', '#260a0c', '#3a1010', '#541a12'],
    far: '#1c0809', mid: '#2b0d0e', near: '#3d1412',
    ground: '#3a1a16', ground2: '#26100e', line: '#6b2a1c',
    accent: '#ff7a3c', glow: '#ffc14d',
    stars: 0, moon: false, weather: 'ember', groundFx: 'cracks'
  },
  {
    id: 'space',
    name: '太空站',
    sub: '轨道 · 观景甲板',
    sky: ['#04060f', '#080c1c', '#0d1428', '#131c36'],
    far: '#0a1020', mid: '#101a2c', near: '#182538',
    ground: '#1e2c40', ground2: '#141e2e', line: '#3a5573',
    accent: '#8a7bff', glow: '#b9b0ff',
    stars: 90, moon: false, weather: 'none', groundFx: 'panel'
  }
];
