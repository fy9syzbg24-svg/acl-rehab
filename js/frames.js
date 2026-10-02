// Single frame exercise pictures (Rehab Test v3).
//
// Most program pictures are a 2 x 2 grid of four numbered steps, a side by side pair, or a photo with blank margin.
// The picture beats the name for recognising an exercise, so lists and the player show ONE frame, big. The file is
// never touched: a frame is a crop VIEWPORT (an img scaled and offset inside an overflow hidden tile) at display time.
// FRAMES holds each crop as fractions of the original file (x, y, w, h from the top left) and `aspect`, the crop's
// width over height in pixels. Crops sit inside the chosen quadrant, inset so the printed step number and the corner
// logo stay out of view. The tile behind is white in light AND dark mode (the pictures are white; never inverted).
//
// Use: import { frameHtml } from './frames.js'; el.innerHTML = frameHtml(ex.img, { size: 72, alt: ex.title });
// A source not listed here (or a -thumb file of a listed one) still works: an unknown source shows the whole picture,
// contained; a known one's -thumb maps to its original so the crop stays sharp.

export const FRAMES = {
  'img/program/ex-01.png': { x: 0.6172, y: 0.6458, w: 0.2953, h: 0.3125, aspect: 1.680 }, // step 4 of 4: bridge held with the band pushed out
  'img/program/ex-02.png': { x: 0.6031, y: 0.3139, w: 0.3109, h: 0.3972, aspect: 1.392 }, // right frame: bridge with the leg extended
  'img/program/ex-03.png': { x: 0.5563, y: 0.5167, w: 0.3563, h: 0.4722, aspect: 1.341 }, // step 4 of 4: close up, band under tension
  'img/program/ex-04.png': { x: 0.5689, y: 0.5487, w: 0.3522, h: 0.4256, aspect: 1.096 }, // step 4 of 4: bridge held, heels together
  'img/program/ex-05.png': { x: 0.6937, y: 0.2944, w: 0.1453, h: 0.4361, aspect: 0.592 }, // right frame: standing with the chair behind
  'img/program/ex-06.png': { x: 0.5938, y: 0.2611, w: 0.2188, h: 0.4403, aspect: 0.883 }, // right frame: band stretched, foot out
  'img/program/ex-07.png': { x: 0.5508, y: 0.0347, w: 0.2578, h: 0.4583, aspect: 1.000 }, // step 2 of 4: foot lifted against the band, no printed numbers
  'img/program/ex-08.png': { x: 0.6250, y: 0.5111, w: 0.2734, h: 0.4778, aspect: 1.017 }, // step 4 of 4: curl with the band taut
  'img/program/ex-09.jpeg': { x: 0.0547, y: 0.6319, w: 0.2031, h: 0.3611, aspect: 1.000 }, // step 3 of 4: on the toes, band at the ankle
  'img/program/ex-10.png': { x: 0.1016, y: 0.0069, w: 0.2734, h: 0.4861, aspect: 1.000 }, // step 1 of 4: both heels up, metronome phone
  'img/program/ex-11.png': { x: 0.5859, y: 0.5347, w: 0.2500, h: 0.4444, aspect: 1.000 }, // step 4 of 4: ball in the air, standing on foam
  'img/program/ex-12.png': { x: 0.6602, y: 0.0500, w: 0.1758, h: 0.4153, aspect: 0.753 }, // step 2 of 4: reaching foot to a cone
  'img/program/ex-13.png': { x: 0.6250, y: 0.0111, w: 0.2031, h: 0.4681, aspect: 0.772 }, // step 2 of 4: close up, foot on the step
  'img/program/ex-14.png': { x: 0.6797, y: 0.3000, w: 0.1211, h: 0.3944, aspect: 0.546 }, // right frame: one foot on the step
  'img/program/ex-15.png': { x: 0.1172, y: 0.5764, w: 0.2422, h: 0.4028, aspect: 1.069 }, // step 3 of 4: knees bent, foot on the step
  'img/program/ex-16.png': { x: 0.6875, y: 0.6319, w: 0.1250, h: 0.3403, aspect: 0.653 }, // step 4 of 4: wall squat with the ball
  'img/program/ex-18.png': { x: 0.2227, y: 0.0417, w: 0.5547, h: 0.9306, aspect: 1.060 }, // whole content box: both poses and the arrows
  'img/program/ex-19.png': { x: 0.2656, y: 0.0556, w: 0.4688, h: 0.8889, aspect: 0.938 }, // content box: the loaded lunge
  'img/program/ex-25.jpg': { x: 0.1758, y: 0.0000, w: 0.6570, h: 0.9333, aspect: 1.251 }, // content box, cut short of the corner logo
  'img/program/ex-26.jpg': { x: 0.4336, y: 0.1597, w: 0.2148, h: 0.7361, aspect: 0.519 }, // content box: one leg lifted against the ball
  'img/ex/bfr-knee-extension.jpg': { x: 0.3653, y: 0.0872, w: 0.6216, h: 0.9128, aspect: 1.210 }, // knee to foot, leg straight
  'img/ex/clamshell-side-plank.jpg': { x: 0.0333, y: 0.0296, w: 0.6333, h: 0.9585, aspect: 1.175 }, // hips, band and knees; face cut
  'img/ex/hip-abduction-60.jpg': { x: 0.0300, y: 0.1423, w: 0.5700, h: 0.7473, aspect: 1.357 }, // legs and band, trimmed of margin
  'img/ex/kettlebell-deadlift-hold-2.png': { x: 0.4464, y: 0.1587, w: 0.3571, h: 0.8069, aspect: 0.787 }, // right pose: hinged hold on the bell
  'img/ex/prone-hamstring-curl.jpg': { x: 0.0667, y: 0.0237, w: 0.6067, h: 0.8057, aspect: 1.338 }, // feet up holding the weight
  'img/ex/standing-hip-abduction.jpg': { x: 0.2825, y: 0.0000, w: 0.4599, h: 1.0000, aspect: 0.818 }, // figure, cut to skip the wall charts
};

// Original file key for a source string: drops a leading ./ or /, a query, a host prefix and a -thumb suffix.
const _index = new Map();
for (const key of Object.keys(FRAMES)) _index.set(key.replace(/\.[a-z]+$/i, ''), key);

function _norm(src) {
  let s = String(src || '');
  s = s.split('?')[0].split('#')[0];
  const at = s.indexOf('img/');
  return { prefix: at > 0 ? s.slice(0, at) : '', path: at >= 0 ? s.slice(at) : s.replace(/^\.?\//, '') };
}

function _keyOf(src) {
  const { path } = _norm(src);
  if (FRAMES[path]) return path;
  const base = path.replace(/\.[a-z]+$/i, '').replace(/-thumb$/, '');
  return _index.get(base) || null;
}

// The crop of a source, or null when the source is not one of the known pictures.
export function frameOf(src) {
  const k = _keyOf(src);
  return k ? FRAMES[k] : null;
}

export function hasFrame(src) {
  return !!_keyOf(src);
}

const _pct = (n) => (Math.round(n * 1e3) / 1e3) + '%';

// Two inline styles make the frame. frameViewport: a box inside the square tile, sized to the crop's aspect and
// centred (the crop contained in the tile), clipping everything else. frameStyle: the <img> inside that box, scaled
// so the crop fills the box exactly and offset so the crop starts at its corner. Percentages, so any tile size works.
// Unknown source: the viewport is the whole tile and the whole picture is contained in it.
const _base = 'position:absolute;max-width:none;max-height:none;border:0;margin:0;padding:0;'
  + 'user-select:none;-webkit-user-select:none;-webkit-user-drag:none;pointer-events:none;';

export function frameViewport(src) {
  const f = frameOf(src);
  if (!f) return 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden;';
  const cw = f.aspect >= 1 ? 100 : 100 * f.aspect;
  const ch = f.aspect >= 1 ? 100 / f.aspect : 100;
  return 'position:absolute;overflow:hidden;left:' + _pct((100 - cw) / 2) + ';top:' + _pct((100 - ch) / 2)
    + ';width:' + _pct(cw) + ';height:' + _pct(ch) + ';';
}

export function frameStyle(src) {
  const f = frameOf(src);
  if (!f) return _base + 'left:0;top:0;width:100%;height:100%;object-fit:contain;';
  return _base + 'left:' + _pct(-f.x / f.w * 100) + ';top:' + _pct(-f.y / f.h * 100)
    + ';width:' + _pct(100 / f.w) + ';height:' + _pct(100 / f.h) + ';';
}

const _esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// The tile. size: a number of points (a square) or any CSS length. whole: true shows the entire picture instead of
// the single frame (the "all four steps" view). cls: extra classes. alt: empty means decorative.
export function frameHtml(src, opts = {}) {
  const { size = 64, cls = '', alt = '', radius = 14, whole = false } = opts;
  const side = typeof size === 'number' ? size + 'px' : String(size);
  const k = _keyOf(src);
  const { prefix } = _norm(src);
  const url = k ? prefix + k : String(src || '');
  const imgStyle = whole ? frameStyle(null) : frameStyle(src);
  const vpStyle = whole ? frameViewport(null) : frameViewport(src);
  const tile = 'position:relative;display:inline-block;flex:none;box-sizing:border-box;overflow:hidden;isolation:isolate;'
    + 'vertical-align:middle;width:' + side + ';height:' + side + ';border-radius:' + radius + 'px;'
    + 'background:#fff;background-color:#fff;color-scheme:light;';
  const ring = 'position:absolute;inset:0;border-radius:inherit;pointer-events:none;box-shadow:inset 0 0 0 1px rgba(0,0,0,.07);';
  return '<span class="frame-tile' + (cls ? ' ' + _esc(cls) : '') + '" style="' + tile + '"'
    + (alt ? ' role="img" aria-label="' + _esc(alt) + '"' : ' aria-hidden="true"') + '>'
    + '<span style="' + vpStyle + '"><img src="' + _esc(url) + '" alt="" draggable="false" decoding="async" style="' + imgStyle + '"></span>'
    + '<span style="' + ring + '"></span></span>';
}
