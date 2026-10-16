import * as ort from './ort/ort.webgpu.min.mjs';
import { checkSize, tilePlan, inputTile, extendTransparentColors, StripeBlender, applyAlpha } from './core.mjs';

const notify = (phase, progress, detail) => self.postMessage({ type: 'progress', phase, progress, detail });
const modelLabels = { art: '插画精细模型', photo: '照片纹理模型', scan: '扫描印刷模型' };
const denoiseFiles = { none: '', light: '-light', medium: '-clean' };
let manifest;
async function digest(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
}
export async function inspectAsset(bytes, entry) {
  const sha256 = await digest(bytes);
  if (bytes.byteLength === entry.bytes && sha256 === entry.sha256) return 'stored';
  if (entry.compression === 'gzip' && bytes.byteLength === entry.decodedBytes && sha256 === entry.decodedSha256) return 'decoded';
  return 'invalid';
}
async function asset(file) {
  manifest ??= await fetch(new URL('./assets.json', import.meta.url)).then(r => { if (!r.ok) throw new Error('无法加载模型清单。'); return r.json(); });
  const entry = manifest.assets.find(item => item.file === file);
  if (!entry) throw new Error('未找到所需模型。');
  const url = new URL(`./${file}?v=${entry.sha256.slice(0, 12)}`, import.meta.url).href;
  let cache;
  try { cache = await caches.open(`nyokore-upscaler-${manifest.version}`); } catch { /* Browser storage can be disabled. */ }
  const cached = await cache?.match(url);
  let bytes = cached ? await cached.arrayBuffer() : null;
  if (!bytes) {
    const response = await fetch(url);
    if (!response.ok) throw new Error('模型下载失败，请检查网络后重试。');
    bytes = await response.arrayBuffer();
  }
  const state = await inspectAsset(bytes, entry);
  if (state === 'invalid') {
    await cache?.delete(url);
    throw new Error('模型文件不完整，请重试下载。');
  }
  if (!cached && cache) { try { await cache.put(url, new Response(bytes)); } catch { /* Processing does not require persistent storage. */ } }
  // Static servers may attach Content-Encoding: gzip to .gz files. Fetch then
  // exposes the already-decoded ONNX bytes, so accept the decoded manifest hash.
  if (state === 'decoded') return new Uint8Array(bytes);
  if (entry.compression === 'gzip') {
    if (typeof DecompressionStream !== 'function') throw new Error('当前浏览器不支持本地模型解压，请升级浏览器后重试。');
    const decoded = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    const decodedDigest = await digest(decoded);
    if (decoded.byteLength !== entry.decodedBytes || decodedDigest !== entry.decodedSha256) throw new Error('模型解压后校验失败，请重试下载。');
    return new Uint8Array(decoded);
  }
  return new Uint8Array(bytes);
}
async function initialize() {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.logLevel = 'error';
  ort.env.wasm.wasmPaths = new URL('./ort/', import.meta.url).href;
  notify('加载本地引擎', 0, '首次使用需要下载免费模型与引擎，之后会优先读取浏览器缓存。');
  const parts = await Promise.all([asset('ort/runtime-0.bin'), asset('ort/runtime-1.bin')]);
  const wasm = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) { wasm.set(part, offset); offset += part.length; }
  ort.env.wasm.wasmBinary = wasm;
}
async function renderPass(pixels, width, height, style, denoise, pass, passes) {
  notify('加载精扩模型', pass / passes * 95, `${modelLabels[style]} · 第 ${pass + 1} / ${passes} 阶段`);
  let modelBytes = await asset(`models/${style}${denoiseFiles[denoise]}.onnx.bin`);
  let gpu = !!self.navigator.gpu;
  if (gpu) { try { gpu = !!(await self.navigator.gpu.requestAdapter()); } catch { gpu = false; } }
  let session, gpuError;
  if (gpu) { try { session = await ort.InferenceSession.create(modelBytes, { executionProviders: ['webgpu', 'wasm'], logSeverityLevel: 3 }); } catch (error) { gpuError = error; gpu = false; } }
  if (!session) { try { session = await ort.InferenceSession.create(modelBytes, { executionProviders: ['wasm'], logSeverityLevel: 3 }); } catch (error) { throw gpuError || error; } }
  modelBytes = null;
  const tile = style === 'art' ? (gpu ? 128 : 64) : (gpu ? 112 : 64);
  const plan = tilePlan(width, height, tile);
  const blender = new StripeBlender(width * 2, height * 2, plan.valid * 2);
  let done = 0;
  try {
    for (let row = 0; row < plan.rows; row++) {
      for (let column = 0; column < plan.columns; column++) {
        const x = column * plan.step, y = row * plan.step;
        const tensor = new ort.Tensor('float32', inputTile(pixels, width, height, x, y, tile, style === 'photo'), [1, 3, tile, tile]);
        let result;
        try {
          result = await session.run({ x: tensor });
          const out = result.y;
          if (!out || out.dims[2] !== plan.valid * 2 || out.dims[3] !== plan.valid * 2) throw new Error('模型返回了不支持的尺寸。');
          blender.add(out.data, x * 2, y * 2, plan.valid * 2);
        } finally { tensor.dispose(); if (result) Object.values(result).forEach(t => t.dispose()); }
        done++;
        notify('正在精扩', (pass + done / plan.total) / passes * 95, `${gpu ? 'GPU 优先' : '兼容计算'} · 第 ${pass + 1} / ${passes} 阶段 · ${done} / ${plan.total} 分块`);
      }
      blender.flush(row + 1 === plan.rows ? height * 2 : (row + 1) * plan.step * 2);
    }
  } finally { await session.release(); }
  return blender.output;
}
self.onmessage = async event => {
  try {
    const { pixels, width, height, scale, style, denoise } = event.data;
    const error = checkSize(width, height, scale);
    if (error) throw new Error(error);
    if (!(pixels instanceof Uint8ClampedArray) || pixels.length !== width * height * 4 || !['art', 'photo', 'scan'].includes(style) || !['none', 'light', 'medium'].includes(denoise)) throw new Error('图片数据无效。');
    let alpha = null;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 255) { alpha = new Uint8ClampedArray(width * height); break; }
    if (alpha) {
      for (let i = 0; i < alpha.length; i++) alpha[i] = pixels[i * 4 + 3];
      extendTransparentColors(pixels, width, height);
    }
    await initialize();
    const passes = scale === 4 ? 2 : 1;
    const enhancedScale = scale === 1 ? 2 : scale;
    let output = pixels;
    for (let pass = 0; pass < passes; pass++) output = await renderPass(output, width * 2 ** pass, height * 2 ** pass, style, pass === 0 ? denoise : 'none', pass, passes);
    notify('整理透明边缘', 96, '正在生成 PNG 图片…');
    if (alpha) applyAlpha(output, alpha, width, height, enhancedScale);
    const canvas = new OffscreenCanvas(width * scale, height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器无法创建输出画布。');
    if (scale === 1) {
      const enhanced = new OffscreenCanvas(width * enhancedScale, height * enhancedScale);
      const enhancedContext = enhanced.getContext('2d');
      if (!enhancedContext) throw new Error('当前浏览器无法创建清晰化画布。');
      enhancedContext.putImageData(new ImageData(output, enhanced.width, enhanced.height), 0, 0);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(enhanced, 0, 0, canvas.width, canvas.height);
    } else context.putImageData(new ImageData(output, canvas.width, canvas.height), 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    self.postMessage({ type: 'done', blob, width: canvas.width, height: canvas.height });
  } catch (error) {
    console.error('Image upscale failed', error);
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
