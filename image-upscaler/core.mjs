// Tile geometry follows nunif/waifu2x (MIT). NYOKORE uses bounded scanline blending.
export const LIMITS = Object.freeze({ inputPixels: 4_000_000, outputPixels: 16_000_000, edge: 8192, bytes: 32 * 1024 * 1024 });
export function checkSize(width, height, scale = 2) {
  if (![width, height].every(v => Number.isSafeInteger(v) && v > 0)) return '无法读取图片尺寸。';
  if (![1, 2, 4].includes(scale)) return '请选择 1 倍、2 倍或 4 倍精扩。';
  if (width * height > LIMITS.inputPixels) return '原图最多 400 万像素，请先缩小图片后再导入。';
  if (width * scale > LIMITS.edge || height * scale > LIMITS.edge) return '精扩后的任一边不能超过 8192 px，请减小倍率或原图尺寸。';
  if (width * height * scale * scale > LIMITS.outputPixels) return '精扩结果最多 1600 万像素，请选择 2 倍或换用更小的原图。';
  return '';
}
export function outputName(name, scale) {
  // eslint-disable-next-line no-control-regex -- strip characters forbidden in downloaded filenames
  return `${name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'image'}_精扩${scale}倍.png`;
}
export function tilePlan(width, height, tile) {
  const valid = tile - 16, step = valid - 8;
  // Eight source pixels overlap. The model removes eight input pixels per edge.
  const columns = Math.max(1, Math.ceil((width - 8) / step));
  const rows = Math.max(1, Math.ceil((height - 8) / step));
  return { tile, valid, step, columns, rows, total: columns * rows };
}
export function borderIndex(index, size, reflect) {
  if (size === 1) return 0;
  if (!reflect) return Math.max(0, Math.min(size - 1, index));
  const period = 2 * (size - 1);
  const n = ((index % period) + period) % period;
  return n < size ? n : period - n;
}
export function inputTile(rgba, width, height, x, y, tile, reflect) {
  const plane = tile * tile, tensor = new Float32Array(plane * 3);
  for (let ty = 0; ty < tile; ty++) {
    const sy = borderIndex(y + ty - 8, height, reflect);
    for (let tx = 0; tx < tile; tx++) {
      const sx = borderIndex(x + tx - 8, width, reflect);
      const from = (sy * width + sx) * 4, to = ty * tile + tx;
      for (let c = 0; c < 3; c++) tensor[to + c * plane] = rgba[from + c] / 255;
    }
  }
  return tensor;
}
// Extend hidden RGB at transparent boundaries before neural inference; alpha stays intact.
export function extendTransparentColors(rgba, width, height, radius = 16) {
  const size = width * height, distance = new Uint8Array(size), queue = new Uint32Array(size);
  distance.fill(255);
  let head = 0, tail = 0;
  for (let i = 0; i < size; i++) {
    if (rgba[i * 4 + 3] > 0) {
      distance[i] = 0;
      if ((i % width > 0 && rgba[(i - 1) * 4 + 3] === 0) || (i % width + 1 < width && rgba[(i + 1) * 4 + 3] === 0) || (i >= width && rgba[(i - width) * 4 + 3] === 0) || (i + width < size && rgba[(i + width) * 4 + 3] === 0)) queue[tail++] = i;
    }
  }
  while (head < tail) {
    const from = queue[head++], d = distance[from] + 1;
    if (d > radius) continue;
    const neighbors = [from % width > 0 ? from - 1 : -1, from % width + 1 < width ? from + 1 : -1, from - width, from + width];
    for (const to of neighbors) if (to >= 0 && to < size && distance[to] === 255) {
      distance[to] = d;
      for (let c = 0; c < 3; c++) rgba[to * 4 + c] = rgba[from * 4 + c];
      queue[tail++] = to;
    }
  }
  return rgba;
}
export class StripeBlender {
  constructor(width, height, tileSize) {
    this.width = width; this.height = height; this.tileSize = tileSize; this.top = 0;
    this.rgb = new Float32Array(width * tileSize * 3);
    this.weight = new Float32Array(width * tileSize);
    this.output = new Uint8ClampedArray(width * height * 4);
  }
  add(data, x, y, size) {
    if (y !== this.top || size !== this.tileSize || data.length !== size * size * 3) throw new Error('分块尺寸不匹配。');
    const plane = size * size;
    for (let j = 0; j < size && y + j < this.height; j++) for (let i = 0; i < size && x + i < this.width; i++) {
      const w = Math.min(i + 1, size - i, 16) * Math.min(j + 1, size - j, 16) / 256;
      const dest = j * this.width + x + i, source = j * size + i;
      this.weight[dest] += w;
      for (let c = 0; c < 3; c++) this.rgb[dest * 3 + c] += data[source + c * plane] * w;
    }
  }
  flush(nextTop) {
    const count = Math.min(nextTop, this.height) - this.top;
    for (let j = 0; j < count; j++) for (let i = 0; i < this.width; i++) {
      const from = j * this.width + i, to = ((j + this.top) * this.width + i) * 4;
      if (this.weight[from] === 0) throw new Error('分块结果存在空隙。');
      for (let c = 0; c < 3; c++) this.output[to + c] = this.rgb[from * 3 + c] / this.weight[from] * 255;
      this.output[to + 3] = 255;
    }
    const shift = count * this.width;
    this.rgb.copyWithin(0, shift * 3); this.rgb.fill(0, Math.max(0, this.rgb.length - shift * 3));
    this.weight.copyWithin(0, shift); this.weight.fill(0, Math.max(0, this.weight.length - shift));
    this.top += count;
  }
}
function cubic(x) {
  x = Math.abs(x);
  if (x <= 1) return 1.5 * x ** 3 - 2.5 * x ** 2 + 1;
  if (x < 2) return -.5 * x ** 3 + 2.5 * x ** 2 - 4 * x + 2;
  return 0;
}
// Separable bicubic alpha avoids inventing opaque content and preserves soft transparency.
export function applyAlpha(output, alpha, width, height, scale) {
  const outWidth = width * scale, outHeight = height * scale;
  const horizontal = new Float32Array(outWidth * height);
  for (let x = 0; x < outWidth; x++) {
    const source = (x + .5) / scale - .5, base = Math.floor(source);
    for (let y = 0; y < height; y++) for (let k = -1; k <= 2; k++) horizontal[y * outWidth + x] += alpha[y * width + borderIndex(base + k, width, false)] * cubic(source - base - k);
  }
  for (let y = 0; y < outHeight; y++) {
    const source = (y + .5) / scale - .5, base = Math.floor(source);
    for (let x = 0; x < outWidth; x++) {
      let value = 0;
      for (let k = -1; k <= 2; k++) value += horizontal[borderIndex(base + k, height, false) * outWidth + x] * cubic(source - base - k);
      const to = (y * outWidth + x) * 4;
      output[to + 3] = value;
      if (output[to + 3] === 0) output.fill(0, to, to + 3);
    }
  }
}
