/* =============================================================================
 * core/pixel.js ── 像素字体与绘图小工具
 *  · 5×7 点阵字体：全部由代码绘制，不加载任何字体文件
 *  · 中文：Canvas 系统字体（不联网、不加载字体文件），在 640×360 下绘制后
 *    随整屏整数放大，天然呈现像素颗粒感
 * ========================================================================== */

/* 5×7 字模，用 | 分隔 7 行，每行 5 格 */
const RAW = {
  ' ': '.....|.....|.....|.....|.....|.....|.....',
  'A': '.###.|#...#|#...#|#####|#...#|#...#|#...#',
  'B': '####.|#...#|#...#|####.|#...#|#...#|####.',
  'C': '.####|#....|#....|#....|#....|#....|.####',
  'D': '####.|#...#|#...#|#...#|#...#|#...#|####.',
  'E': '#####|#....|#....|####.|#....|#....|#####',
  'F': '#####|#....|#....|####.|#....|#....|#....',
  'G': '.###.|#...#|#....|#.###|#...#|#...#|.###.',
  'H': '#...#|#...#|#...#|#####|#...#|#...#|#...#',
  'I': '#####|..#..|..#..|..#..|..#..|..#..|#####',
  'J': '..###|...#.|...#.|...#.|...#.|#..#.|.##..',
  'K': '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#',
  'L': '#....|#....|#....|#....|#....|#....|#####',
  'M': '#...#|##.##|#.#.#|#...#|#...#|#...#|#...#',
  'N': '#...#|##..#|#.#.#|#..##|#...#|#...#|#...#',
  'O': '.###.|#...#|#...#|#...#|#...#|#...#|.###.',
  'P': '####.|#...#|#...#|####.|#....|#....|#....',
  'Q': '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#',
  'R': '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
  'S': '.####|#....|#....|.###.|....#|....#|####.',
  'T': '#####|..#..|..#..|..#..|..#..|..#..|..#..',
  'U': '#...#|#...#|#...#|#...#|#...#|#...#|.###.',
  'V': '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..',
  'W': '#...#|#...#|#...#|#.#.#|#.#.#|##.##|#...#',
  'X': '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  'Y': '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..',
  'Z': '#####|....#|...#.|..#..|.#...|#....|#####',
  '0': '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.',
  '1': '..#..|.##..|..#..|..#..|..#..|..#..|.###.',
  '2': '.###.|#...#|....#|...#.|..#..|.#...|#####',
  '3': '####.|....#|....#|.###.|....#|....#|####.',
  '4': '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.',
  '5': '#####|#....|####.|....#|....#|#...#|.###.',
  '6': '..##.|.#...|#....|####.|#...#|#...#|.###.',
  '7': '#####|....#|...#.|..#..|.#...|.#...|.#...',
  '8': '.###.|#...#|#...#|.###.|#...#|#...#|.###.',
  '9': '.###.|#...#|#...#|.####|....#|...#.|.##..',
  '-': '.....|.....|.....|#####|.....|.....|.....',
  '+': '.....|..#..|..#..|#####|..#..|..#..|.....',
  '.': '.....|.....|.....|.....|.....|.##..|.##..',
  ':': '.....|.##..|.##..|.....|.##..|.##..|.....',
  '/': '....#|....#|...#.|..#..|.#...|#....|#....',
  '!': '..#..|..#..|..#..|..#..|..#..|.....|..#..',
  '%': '##..#|##.#.|...#.|..#..|.#...|.#.##|#..##',
  '?': '.###.|#...#|....#|...#.|..#..|.....|..#..',
  '<': '...#.|..#..|.#...|#....|.#...|..#..|...#.',
  '>': '.#...|..#..|...#.|....#|...#.|..#..|.#...',
  '*': '.....|..#..|#.#.#|.###.|#.#.#|..#..|.....',
  '(': '...#.|..#..|.#...|.#...|.#...|..#..|...#.',
  ')': '.#...|..#..|...#.|...#.|...#.|..#..|.#...',
  '=': '.....|.....|#####|.....|#####|.....|.....',
  ',': '.....|.....|.....|.....|.....|..#..|.#...',
  "'": '..#..|..#..|.....|.....|.....|.....|.....',
  '|': '..#..|..#..|..#..|..#..|..#..|..#..|..#..'
};

const GLYPHS = Object.create(null);
for (const k in RAW) GLYPHS[k] = RAW[k].split('|').join('');

/**
 * 绘制 5×7 点阵文本。
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} str
 * @param {number} x 左上角
 * @param {number} y 左上角
 * @param {{color?:string, scale?:number, align?:'left'|'center'|'right', shadow?:string}} [opt]
 */
export function text(ctx, str, x, y, opt = {}) {
  const scale = opt.scale || 1;
  const color = opt.color || '#eaf6ff';
  const s = String(str).toUpperCase();
  const cw = 6 * scale;
  let cx = x;
  if (opt.align === 'center') cx = Math.round(x - (s.length * cw - scale) / 2);
  else if (opt.align === 'right') cx = Math.round(x - (s.length * cw - scale));

  if (opt.shadow) drawGlyphs(ctx, s, cx + scale, y + scale, scale, opt.shadow);
  drawGlyphs(ctx, s, cx, y, scale, color);
  return s.length * cw;
}

function drawGlyphs(ctx, s, x, y, scale, color) {
  ctx.fillStyle = color;
  let cx = x;
  for (let i = 0; i < s.length; i++) {
    const g = GLYPHS[s[i]] || GLYPHS['?'];
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 5; c++) {
        if (g[r * 5 + c] === '#') ctx.fillRect(cx + c * scale, y + r * scale, scale, scale);
      }
    }
    cx += 6 * scale;
  }
}

/** 文本像素宽度 */
export function textWidth(str, scale = 1) {
  return String(str).length * 6 * scale - scale;
}

/**
 * 绘制中文（系统字体，不加载字体文件）。
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} str
 * @param {number} x
 * @param {number} y 顶部
 * @param {{size?:number, color?:string, align?:CanvasTextAlign, bold?:boolean, shadow?:string, alpha?:number}} [opt]
 */
export function cjk(ctx, str, x, y, opt = {}) {
  const size = opt.size || 10;
  ctx.save();
  ctx.globalAlpha = opt.alpha == null ? 1 : opt.alpha;
  ctx.font = (opt.bold ? 'bold ' : '') + size + 'px "PingFang SC","Microsoft YaHei","Heiti SC","Noto Sans CJK SC",sans-serif';
  ctx.textAlign = opt.align || 'left';
  ctx.textBaseline = 'top';
  if (opt.shadow) {
    ctx.fillStyle = opt.shadow;
    ctx.fillText(str, x + 1, y + 1);
  }
  ctx.fillStyle = opt.color || '#dff4ff';
  ctx.fillText(str, x, y);
  ctx.restore();
}

/** 矩形（整数对齐，避免半像素模糊） */
export function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** 描边矩形 */
export function frame(ctx, x, y, w, h, color, lw = 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w) - 1, Math.round(h) - 1);
}

/** 切角面板路径（像素风常见斜切边框） */
export function panelPath(ctx, x, y, w, h, cut = 5) {
  ctx.beginPath();
  ctx.moveTo(x + cut, y);
  ctx.lineTo(x + w - cut, y);
  ctx.lineTo(x + w, y + cut);
  ctx.lineTo(x + w, y + h - cut);
  ctx.lineTo(x + w - cut, y + h);
  ctx.lineTo(x + cut, y + h);
  ctx.lineTo(x, y + h - cut);
  ctx.lineTo(x, y + cut);
  ctx.closePath();
}
