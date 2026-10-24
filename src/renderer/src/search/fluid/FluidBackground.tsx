/**
 * 流光搜索 · 实时交互流体背景
 *
 * 视觉：白色纸面（#f7f8fb）上缓慢呼吸的珠光流体带 —— 粉紫 / 青蓝 / 暖橙，
 *       中央一条 S 形波纹，边缘柔光，叠加极细的胶片颗粒，轻盈、通透、有质感。
 *
 * 实现要点（无第三方依赖、纯 Canvas 2D）：
 * - 单可见 canvas + 2 个离屏层：
 *     glow   （约 0.22 倍分辨率）—— 大尺度柔光色雾，天然模糊边缘；
 *     detail （约 0.5 倍分辨率）—— 多层正弦/贝塞尔流线（ribbon），丝滑流体带；
 *   两个离屏层绘制完成后以乘法混合放大贴回主画布，等效大半径模糊但每帧开销极低。
 * - 彩虹渐变按尺寸缓存（resize 时重建），每帧只做路径采样与 stroke；
 * - 柔光团使用一次性生成的 sprite 图集（径向渐变缓存），避免每帧 createRadialGradient / shadowBlur；
 * - DPR 上限 2（并按总像素预算收敛）、ResizeObserver 自适应、页面隐藏 / 窗口失焦 / 滚出视口时暂停；
 * - prefers-reduced-motion 与 `document.documentElement.dataset.motion === 'off'` 时降级为静态帧；
 * - 指针吸引 + 点击涟漪（window 监听，自身 pointer-events:none，不会阻挡搜索框点击）。
 */
import { useEffect, useRef } from 'react';
import type { JSX } from 'react';
import './fluid.css';

export type FluidVariant = 'hero' | 'ambient';

export interface FluidBackgroundProps {
  /** hero：集中在页面中央的横向流体带；ambient：整页低透明氛围 */
  variant?: FluidVariant;
  /** 追加 class，便于页面定位/偏移（容器默认 absolute inset:0） */
  className?: string;
}

/* ------------------------------------------------------------------ 数学与颜色 */

const TAU = Math.PI * 2;
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface Point {
  x: number;
  y: number;
}

/** 流场位移（指针吸引 / 涟漪） */
interface FieldOffset {
  dx: number;
  dy: number;
}

interface Ripple {
  x: number;
  y: number;
  born: number;
}

const rgba = (color: Rgb, alpha: number): string => `rgba(${color.r},${color.g},${color.b},${alpha})`;

/** 珠光调色板（在白色纸面上做乘法混合，呈现柔和的珠光色） */
const PALETTE = {
  amber: { r: 255, g: 190, b: 142 },
  peach: { r: 255, g: 210, b: 170 },
  rose: { r: 255, g: 170, b: 198 },
  blush: { r: 250, g: 182, b: 220 },
  lilac: { r: 210, g: 172, b: 255 },
  violet: { r: 174, g: 160, b: 255 },
  sky: { r: 152, g: 198, b: 255 },
  aqua: { r: 148, g: 224, b: 236 },
  mint: { r: 172, g: 234, b: 208 },
  white: { r: 255, g: 255, b: 255 },
} satisfies Record<string, Rgb>;

const SPRITE_COLORS: Rgb[] = [
  PALETTE.amber,
  PALETTE.peach,
  PALETTE.rose,
  PALETTE.blush,
  PALETTE.lilac,
  PALETTE.violet,
  PALETTE.sky,
  PALETTE.aqua,
  PALETTE.mint,
];

/** 按横向位置取柔和色相（用于沿波带铺柔光团） */
function hueIndexAt(u: number): number {
  return clamp(u, 0, 1) * (SPRITE_COLORS.length - 1);
}

/* ------------------------------------------------------------------ 配置 */

interface BandConfig {
  /** 波带中心线 y（相对高度） */
  center: number;
  /** 波带总宽度（相对高度） */
  thickness: number;
  /** 大尺度 S 波振幅（相对高度） */
  amplitude: number;
  /** 横向周期数（0.9 ≈ 一条 S 形） */
  period: number;
  phase: number;
  /** 时间流速 */
  speed: number;
  /** 整体不透明度 */
  alpha: number;
  /** 垂直方向流线条数 */
  streams: number;
  /** 柔光团尺寸倍数 */
  glow: number;
  /** 缓慢上下漂浮量（相对高度） */
  drift: number;
}

interface WashConfig {
  /** 位置（相对宽高） */
  x: number;
  y: number;
  /** 半径（相对画布长边） */
  radius: number;
  sprite: number;
  alpha: number;
  speed: number;
  phase: number;
}

interface VariantConfig {
  base: string;
  speed: number;
  glowAlpha: number;
  detailAlpha: number;
  glowScale: number;
  detailScale: number;
  bands: BandConfig[];
  washes: WashConfig[];
  /** 指针影响半径（相对画布短边） */
  pointerRadius: number;
  /** 指针吸附强度 */
  pointerPull: number;
  /** 涟漪位移幅度（px） */
  rippleAmp: number;
  /** 涟漪扩散速度（px/s） */
  rippleSpeed: number;
}

const HERO_CONFIG: VariantConfig = {
  base: '#f7f8fb',
  speed: 1,
  glowAlpha: 0.82,
  detailAlpha: 1,
  glowScale: 0.22,
  detailScale: 0.5,
  pointerRadius: 0.36,
  pointerPull: 1,
  rippleAmp: 26,
  rippleSpeed: 420,
  bands: [
    { center: 0.5, thickness: 0.32, amplitude: 0.142, period: 0.86, phase: 0.2, speed: 0.11, alpha: 0.9, streams: 38, glow: 3.2, drift: 0.014 },
    { center: 0.425, thickness: 0.16, amplitude: 0.19, period: 1.18, phase: 2.1, speed: 0.15, alpha: 0.6, streams: 22, glow: 2.1, drift: 0.01 },
    { center: 0.6, thickness: 0.075, amplitude: 0.1, period: 1.7, phase: 3.4, speed: 0.21, alpha: 0.4, streams: 14, glow: 1.35, drift: 0.007 },
  ],
  washes: [
    { x: 0.1, y: 0.32, radius: 0.5, sprite: 1, alpha: 0.26, speed: 0.05, phase: 0.4 },
    { x: 0.42, y: 0.46, radius: 0.52, sprite: 4, alpha: 0.24, speed: 0.043, phase: 2.1 },
    { x: 0.68, y: 0.56, radius: 0.48, sprite: 6, alpha: 0.2, speed: 0.052, phase: 3.6 },
    { x: 0.9, y: 0.66, radius: 0.5, sprite: 7, alpha: 0.26, speed: 0.058, phase: 4.4 },
    { x: 0.56, y: 0.86, radius: 0.4, sprite: 8, alpha: 0.12, speed: 0.07, phase: 1.2 },
  ],
};

const AMBIENT_CONFIG: VariantConfig = {
  base: '#f7f8fb',
  speed: 0.7,
  glowAlpha: 0.9,
  detailAlpha: 0.95,
  glowScale: 0.17,
  detailScale: 0.38,
  pointerRadius: 0.46,
  pointerPull: 0.7,
  rippleAmp: 16,
  rippleSpeed: 300,
  bands: [
    { center: 0.26, thickness: 0.52, amplitude: 0.075, period: 0.6, phase: 0.6, speed: 0.07, alpha: 0.42, streams: 22, glow: 3.8, drift: 0.018 },
    { center: 0.54, thickness: 0.46, amplitude: 0.062, period: 0.78, phase: 2.5, speed: 0.085, alpha: 0.34, streams: 20, glow: 3.4, drift: 0.016 },
    { center: 0.8, thickness: 0.5, amplitude: 0.052, period: 0.54, phase: 4.1, speed: 0.062, alpha: 0.26, streams: 18, glow: 3.1, drift: 0.02 },
  ],
  washes: [
    { x: 0.2, y: 0.18, radius: 0.5, sprite: 1, alpha: 0.28, speed: 0.045, phase: 0.7 },
    { x: 0.78, y: 0.28, radius: 0.46, sprite: 6, alpha: 0.28, speed: 0.05, phase: 2.2 },
    { x: 0.5, y: 0.58, radius: 0.54, sprite: 4, alpha: 0.26, speed: 0.038, phase: 3.9 },
    { x: 0.16, y: 0.86, radius: 0.44, sprite: 8, alpha: 0.2, speed: 0.06, phase: 5.2 },
    { x: 0.86, y: 0.82, radius: 0.42, sprite: 7, alpha: 0.2, speed: 0.055, phase: 1.4 },
  ],
};

function configFor(variant: FluidVariant): VariantConfig {
  return variant === 'ambient' ? AMBIENT_CONFIG : HERO_CONFIG;
}

/* ------------------------------------------------------------------ 柔光 sprite 图集（一次性缓存） */

const SPRITE_SIZE = 128;
const SPRITE_PAD = 8;

function buildSpriteAtlas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = (SPRITE_SIZE + SPRITE_PAD * 2) * SPRITE_COLORS.length;
  canvas.height = SPRITE_SIZE + SPRITE_PAD * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  SPRITE_COLORS.forEach((color, index) => {
    const originX = index * (SPRITE_SIZE + SPRITE_PAD * 2) + SPRITE_PAD;
    const originY = SPRITE_PAD;
    const cx = originX + SPRITE_SIZE / 2;
    const cy = originY + SPRITE_SIZE / 2;
    const radius = SPRITE_SIZE / 2;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, rgba(color, 0.95));
    gradient.addColorStop(0.28, rgba(color, 0.62));
    gradient.addColorStop(0.55, rgba(color, 0.26));
    gradient.addColorStop(0.78, rgba(color, 0.08));
    gradient.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(originX, originY, SPRITE_SIZE, SPRITE_SIZE);
  });
  return canvas;
}

function drawSprite(
  ctx: CanvasRenderingContext2D,
  atlas: HTMLCanvasElement,
  index: number,
  x: number,
  y: number,
  size: number,
  alpha: number
): void {
  if (alpha <= 0.001 || size <= 1) return;
  const cell = SPRITE_SIZE + SPRITE_PAD * 2;
  const sx = index * cell;
  ctx.globalAlpha = alpha;
  ctx.drawImage(atlas, sx, SPRITE_PAD, SPRITE_SIZE, SPRITE_SIZE, x - size / 2, y - size / 2, size, size);
}

/* ------------------------------------------------------------------ 缓存渐变 */

interface CachedGradients {
  iris: CanvasGradient;
  cool: CanvasGradient;
}

function addStop(gradient: CanvasGradient, offset: number, color: Rgb, alpha: number): void {
  gradient.addColorStop(clamp(offset, 0, 1), rgba(color, alpha));
}

function buildDetailGradients(ctx: CanvasRenderingContext2D, width: number): CachedGradients {
  const iris = ctx.createLinearGradient(0, 0, width, 0);
  addStop(iris, 0, PALETTE.amber, 0);
  addStop(iris, 0.07, PALETTE.peach, 0.62);
  addStop(iris, 0.2, PALETTE.rose, 0.9);
  addStop(iris, 0.36, PALETTE.blush, 0.92);
  addStop(iris, 0.5, PALETTE.lilac, 0.86);
  addStop(iris, 0.64, PALETTE.violet, 0.62);
  addStop(iris, 0.8, PALETTE.sky, 0.82);
  addStop(iris, 0.92, PALETTE.aqua, 0.6);
  addStop(iris, 1, PALETTE.mint, 0);

  const cool = ctx.createLinearGradient(0, 0, width, 0);
  addStop(cool, 0, PALETTE.mint, 0);
  addStop(cool, 0.12, PALETTE.aqua, 0.55);
  addStop(cool, 0.3, PALETTE.sky, 0.8);
  addStop(cool, 0.48, PALETTE.violet, 0.55);
  addStop(cool, 0.66, PALETTE.blush, 0.7);
  addStop(cool, 0.82, PALETTE.rose, 0.78);
  addStop(cool, 0.94, PALETTE.peach, 0.4);
  addStop(cool, 1, PALETTE.amber, 0);

  return { iris, cool };
}

function buildPaperGradient(ctx: CanvasRenderingContext2D, width: number, height: number): CanvasGradient {
  const gradient = ctx.createLinearGradient(0, 0, width * 0.35, height);
  gradient.addColorStop(0, 'rgba(255, 251, 246, 0.9)');
  gradient.addColorStop(0.42, 'rgba(255, 255, 255, 0.28)');
  gradient.addColorStop(1, 'rgba(242, 246, 252, 0.75)');
  return gradient;
}

function buildGlossGradient(ctx: CanvasRenderingContext2D, width: number, height: number): CanvasGradient {
  const gradient = ctx.createLinearGradient(width * 0.5, 0, width * 0.5, height * 0.62);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.34)');
  gradient.addColorStop(0.45, 'rgba(255, 255, 255, 0.1)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  return gradient;
}

/* ------------------------------------------------------------------ 引擎 */

interface Engine {
  variant: FluidVariant;
  config: VariantConfig;
  container: HTMLDivElement;
  canvas: HTMLCanvasElement;
  mainCtx: CanvasRenderingContext2D;
  glowCanvas: HTMLCanvasElement;
  glowCtx: CanvasRenderingContext2D;
  detailCanvas: HTMLCanvasElement;
  detailCtx: CanvasRenderingContext2D;
  atlas: HTMLCanvasElement;
  gradients: CachedGradients | null;
  paper: CanvasGradient | null;
  gloss: CanvasGradient | null;
  width: number;
  height: number;
  dpr: number;
  time: number;
  pointer: { x: number; y: number; tx: number; ty: number; strength: number; target: number };
  ripples: Ripple[];
  raf: number;
  running: boolean;
  paused: boolean;
  visible: boolean;
  windowBlurred: boolean;
  staticMode: boolean;
  lastFrame: number;
  disposed: boolean;
}

/** 主画布最大 backing store 像素数：4K/高 DPR 屏幕下自动降采样，避免合成器压力 */
const MAX_BACKING_PIXELS = 1_200_000;

/** 设备像素比：上限 2，并按总像素预算收敛（仍满足 DPR≤2） */
function resolveDpr(width: number, height: number): number {
  const deviceDpr = clamp(window.devicePixelRatio || 1, 1, 2);
  const pixels = width * height * deviceDpr * deviceDpr;
  if (pixels <= MAX_BACKING_PIXELS) return deviceDpr;
  return Math.max(1, Math.min(deviceDpr, Math.sqrt(MAX_BACKING_PIXELS / Math.max(1, width * height))));
}

function createEngine(container: HTMLDivElement, canvas: HTMLCanvasElement, variant: FluidVariant): Engine | null {
  // 背景始终铺满不透明底色，alpha:false 让合成器少做一次图层混合；
  // willReadFrequently 走软件光栅，避免大尺寸 2D canvas 在录制/截图时触发 GPU 合成器崩溃。
  const mainCtx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  const glowCanvas = document.createElement('canvas');
  const detailCanvas = document.createElement('canvas');
  const glowCtx = glowCanvas.getContext('2d', { alpha: true, willReadFrequently: true });
  const detailCtx = detailCanvas.getContext('2d', { alpha: true, willReadFrequently: true });
  if (!mainCtx || !glowCtx || !detailCtx) return null;

  return {
    variant,
    config: configFor(variant),
    container,
    canvas,
    mainCtx,
    glowCanvas,
    glowCtx,
    detailCanvas,
    detailCtx,
    atlas: buildSpriteAtlas(),
    gradients: null,
    paper: null,
    gloss: null,
    width: 0,
    height: 0,
    dpr: 1,
    time: 0,
    pointer: { x: 0, y: 0, tx: 0, ty: 0, strength: 0, target: 0 },
    ripples: [],
    raf: 0,
    running: false,
    paused: false,
    visible: true,
    windowBlurred: false,
    staticMode: false,
    lastFrame: 0,
    disposed: false,
  };
}

function prepareOffscreen(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scale: number
): void {
  const targetWidth = Math.max(2, Math.round(width * scale));
  const targetHeight = Math.max(2, Math.round(height * scale));
  if (canvas.width !== targetWidth) canvas.width = targetWidth;
  if (canvas.height !== targetHeight) canvas.height = targetHeight;
  ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
}

function resize(engine: Engine): void {
  if (engine.disposed) return;
  const rect = engine.container.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const dpr = resolveDpr(width, height);
  if (width === engine.width && height === engine.height && dpr === engine.dpr) return;

  engine.width = width;
  engine.height = height;
  engine.dpr = dpr;

  engine.canvas.width = Math.max(2, Math.round(width * dpr));
  engine.canvas.height = Math.max(2, Math.round(height * dpr));
  engine.mainCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  engine.mainCtx.imageSmoothingEnabled = true;
  engine.mainCtx.imageSmoothingQuality = 'high';

  prepareOffscreen(engine.glowCanvas, engine.glowCtx, width, height, engine.config.glowScale);
  prepareOffscreen(engine.detailCanvas, engine.detailCtx, width, height, engine.config.detailScale);

  engine.gradients = buildDetailGradients(engine.detailCtx, width);
  engine.paper = buildPaperGradient(engine.mainCtx, width, height);
  engine.gloss = buildGlossGradient(engine.mainCtx, width, height);

  if (engine.staticMode) drawStaticFrame(engine);
  else if (!engine.running) drawStaticFrame(engine);
}

/* ------------------------------------------------------------------ 运动场（指针吸引 + 点击涟漪） */

function bandCenterY(engine: Engine, band: BandConfig, u: number): number {
  const { height, time } = engine;
  const drift = Math.sin(time * 0.08 + band.phase) * band.drift * height;
  const amplitude = band.amplitude * height;
  const primary = Math.sin(u * TAU * band.period + time * band.speed + band.phase) * amplitude;
  const secondary =
    Math.sin(u * TAU * band.period * 1.83 - time * band.speed * 1.35 + band.phase * 1.7) * amplitude * 0.34;
  const tertiary =
    Math.sin(u * TAU * band.period * 3.1 + time * band.speed * 0.7 + band.phase * 2.4) * amplitude * 0.16;
  return band.center * height + drift + primary + secondary + tertiary;
}

function sampleField(engine: Engine, x: number, y: number): FieldOffset {
  const config = engine.config;
  const pointer = engine.pointer;
  let dx = 0;
  let dy = 0;

  if (pointer.strength > 0.002) {
    const rx = pointer.x - x;
    const ry = pointer.y - y;
    const distanceSq = rx * rx + ry * ry;
    const radius = config.pointerRadius * Math.max(260, Math.min(engine.width, engine.height) * 1.05);
    const falloff = Math.exp(-distanceSq / (2 * radius * radius)) * pointer.strength * config.pointerPull;
    dx += rx * 0.17 * falloff;
    dy += ry * 0.28 * falloff;
    const distance = Math.sqrt(distanceSq) + 1;
    // 轻微涡旋，让吸引更「流体」
    dx += (-ry / distance) * 15 * falloff;
    dy += (rx / distance) * 8 * falloff;
  }

  for (const ripple of engine.ripples) {
    const age = engine.time - ripple.born;
    if (age < 0 || age > 2.6) continue;
    const rx = x - ripple.x;
    const ry = y - ripple.y;
    const distance = Math.sqrt(rx * rx + ry * ry) + 0.5;
    const front = 26 + age * config.rippleSpeed;
    const ringWidth = 64 + age * 96;
    const ring = Math.exp(-Math.pow((distance - front) / ringWidth, 2));
    const decay = Math.pow(1 - age / 2.6, 2);
    const wave = Math.sin((distance - front) * 0.03) * ring * decay * config.rippleAmp;
    dx += (rx / distance) * wave;
    dy += (ry / distance) * wave;
  }

  return { dx, dy };
}

/* ------------------------------------------------------------------ 绘制：柔光层 */

function drawGlow(engine: Engine): void {
  const context = engine.glowCtx;
  const config = engine.config;
  const { width, height, time, pointer } = engine;
  context.setTransform(engine.glowCanvas.width / width, 0, 0, engine.glowCanvas.height / height, 0, 0);
  context.clearRect(0, 0, width, height);
  context.globalCompositeOperation = 'source-over';
  context.globalAlpha = 1;

  const maxSide = Math.max(width, height);

  // 环境色雾（缓慢漂移 + 指针轻微牵引）
  for (const wash of config.washes) {
    const driftX = Math.sin(time * wash.speed + wash.phase);
    const driftY = Math.cos(time * wash.speed * 0.82 + wash.phase * 1.3);
    const baseX = (wash.x + driftX * 0.035) * width;
    const baseY = (wash.y + driftY * 0.04) * height;
    const pull = pointer.strength * 0.055;
    const x = baseX + (pointer.x - baseX) * pull;
    const y = baseY + (pointer.y - baseY) * pull;
    const size = wash.radius * maxSide * 2;
    drawSprite(context, engine.atlas, wash.sprite, x, y, size, wash.alpha);
  }

  // 沿波带铺高光团，形成柔和的彩虹光带
  for (const band of config.bands) {
    const count = 9;
    for (let index = 0; index < count; index += 1) {
      const u = (index + 0.5) / count;
      const x = -0.1 * width + u * width * 1.2;
      const baseY = bandCenterY(engine, band, x / width);
      const field = sampleField(engine, x, baseY);
      const y = baseY + field.dy * 0.7;
      const size = band.thickness * height * band.glow * (0.88 + 0.24 * Math.sin(time * 0.45 + index * 0.9));
      const edge = Math.sin(Math.PI * u);
      const alpha = band.alpha * 0.21 * (0.25 + 0.75 * edge);
      const hue = hueIndexAt(u);
      const low = Math.floor(hue);
      const high = Math.min(SPRITE_COLORS.length - 1, low + 1);
      const mix = hue - low;
      drawSprite(context, engine.atlas, low, x + field.dx * 0.4, y, size, alpha * (1 - mix * 0.45));
      if (high !== low) drawSprite(context, engine.atlas, high, x + field.dx * 0.4, y, size * 0.96, alpha * mix * 0.75);
    }
  }

  // 指针柔光
  if (pointer.strength > 0.01) {
    drawSprite(context, engine.atlas, 3, pointer.x, pointer.y, Math.min(width, height) * 0.62, 0.16 * pointer.strength);
    drawSprite(context, engine.atlas, 7, pointer.x, pointer.y, Math.min(width, height) * 0.42, 0.12 * pointer.strength);
  }

  // 点击涟漪的柔光晕
  for (const ripple of engine.ripples) {
    const age = time - ripple.born;
    if (age < 0 || age > 2.6) continue;
    const fade = Math.max(0, 1 - age / 2.6);
    const size = 160 + age * 520;
    drawSprite(context, engine.atlas, 3, ripple.x, ripple.y, size, 0.16 * fade * fade);
    drawSprite(context, engine.atlas, 7, ripple.x, ripple.y, size * 0.8, 0.12 * fade * fade);
  }

  context.globalAlpha = 1;
}

/* ------------------------------------------------------------------ 绘制：流体带细节层 */

function drawBandStreams(engine: Engine, band: BandConfig): void {
  const context = engine.detailCtx;
  const gradients = engine.gradients;
  if (!gradients) return;

  const { width, height, time } = engine;
  const streams = band.streams;
  const halfWidth = (band.thickness * height) / 2;
  const samples = clamp(Math.round(width / 24), 28, 92);
  const pad = width * 0.06;
  const baseLineWidth = Math.max(1.4, ((halfWidth * 2) / streams) * 1.95);

  context.lineCap = 'round';
  context.lineJoin = 'round';

  for (let stream = 0; stream < streams; stream += 1) {
    const t = streams <= 1 ? 0.5 : stream / (streams - 1);
    const offset = t * 2 - 1;
    const profile = Math.pow(Math.sin(Math.PI * t), 1.45);
    const shimmer = 0.84 + 0.16 * Math.sin(time * 0.85 + offset * 3.1 + band.phase);
    const alpha = band.alpha * profile * 0.152 * shimmer;

    context.globalAlpha = alpha;
    context.lineWidth = baseLineWidth * (0.8 + 0.34 * (1 - Math.abs(offset)));
    context.strokeStyle = offset <= 0 ? gradients.iris : gradients.cool;

    context.beginPath();
    for (let index = 0; index <= samples; index += 1) {
      const u = index / samples;
      const x = -pad + u * (width + pad * 2);
      const nx = x / width;
      const baseY = bandCenterY(engine, band, nx);
      const field = sampleField(engine, x, baseY);
      // 细密褶皱，模拟丝绸的丝缕质感
      const wrinkle =
        Math.sin(nx * TAU * 5.2 + time * 0.6 + stream * 0.17) * 1.4 +
        Math.sin(nx * TAU * 9.4 - time * 0.42 + stream * 0.31) * 0.7;
      const y =
        baseY +
        offset * halfWidth * (1 - 0.07 * Math.cos(nx * 6.4 + time * 0.3)) +
        field.dy * 0.92 +
        wrinkle;
      const px = x + field.dx * 0.85;
      if (index === 0) context.moveTo(px, y);
      else context.lineTo(px, y);
    }
    context.stroke();
  }
}

function drawDetail(engine: Engine): void {
  const context = engine.detailCtx;
  const { width, height } = engine;
  context.setTransform(engine.detailCanvas.width / width, 0, 0, engine.detailCanvas.height / height, 0, 0);
  context.clearRect(0, 0, width, height);
  context.globalCompositeOperation = 'source-over';
  context.globalAlpha = 1;

  for (const band of engine.config.bands) drawBandStreams(engine, band);

  // 流体带内部更细的丝线（少量、细、低透明），增加「珠光纤维」层次
  const gradients = engine.gradients;
  if (!gradients) return;
  context.lineCap = 'round';
  for (let thread = 0; thread < 5; thread += 1) {
    const band = engine.config.bands[thread % engine.config.bands.length];
    const offset = ((thread + 0.5) / 5 - 0.5) * band.thickness * height * 0.72;
    const samples = clamp(Math.round(width / 34), 24, 70);
    context.globalAlpha = 0.1;
    context.lineWidth = 1;
    context.strokeStyle = thread % 2 === 0 ? gradients.cool : gradients.iris;
    context.beginPath();
    for (let index = 0; index <= samples; index += 1) {
      const u = index / samples;
      const x = -width * 0.03 + u * width * 1.06;
      const nx = x / width;
      const baseY = bandCenterY(engine, band, nx);
      const field = sampleField(engine, x, baseY);
      const y = baseY + offset + field.dy * 0.98 + Math.sin(nx * TAU * 3 + thread) * 1.2;
      const px = x + field.dx * 0.9;
      if (index === 0) context.moveTo(px, y);
      else context.lineTo(px, y);
    }
    context.stroke();
  }
  context.globalAlpha = 1;
}

/* ------------------------------------------------------------------ 绘制：主画布（合成 + 玻璃高光） */

function drawSheen(engine: Engine): void {
  const context = engine.mainCtx;
  const config = engine.config;
  const { width, height, time } = engine;

  context.globalCompositeOperation = 'screen';
  context.lineCap = 'round';

  // 主波带中央的玻璃高光丝
  const mainBand = config.bands[0];
  const samples = clamp(Math.round(width / 26), 30, 90);
  for (let index = 0; index < 3; index += 1) {
    const offset = (index - 1) * mainBand.thickness * height * 0.13;
    context.globalAlpha = index === 0 ? 0.2 : index === 1 ? 0.13 : 0.16;
    context.lineWidth = index === 0 ? Math.max(2, height * 0.006) : Math.max(1, height * 0.0022);
    context.strokeStyle = 'rgba(255,255,255,0.92)';
    context.beginPath();
    for (let sample = 0; sample <= samples; sample += 1) {
      const u = sample / samples;
      const x = -width * 0.04 + u * width * 1.08;
      const nx = x / width;
      const baseY = bandCenterY(engine, mainBand, nx);
      const field = sampleField(engine, x, baseY);
      const y = baseY + offset + field.dy * 1.02 + Math.sin(nx * TAU * 2.6 + time * 0.34) * 1.6;
      const px = x + field.dx * 0.95;
      if (sample === 0) context.moveTo(px, y);
      else context.lineTo(px, y);
    }
    context.stroke();
  }

  // 顶部玻璃反光
  if (engine.gloss) {
    context.globalAlpha = 1;
    context.fillStyle = engine.gloss;
    context.fillRect(0, 0, width, height);
  }

  // 点击涟漪：柔和的白色光环（在白色纸面上只在彩色区域显现，形成珍珠光泽）
  for (const ripple of engine.ripples) {
    const age = time - ripple.born;
    if (age < 0 || age > 2.6) continue;
    const fade = Math.max(0, 1 - age / 2.6);
    const radius = 22 + age * config.rippleSpeed;
    context.globalAlpha = 0.26 * fade * fade;
    context.lineWidth = Math.max(1, 2 * fade);
    context.strokeStyle = 'rgba(255,255,255,0.95)';
    context.beginPath();
    context.arc(ripple.x, ripple.y, radius, 0, TAU);
    context.stroke();
    context.globalAlpha = 0.12 * fade * fade;
    context.lineWidth = Math.max(1, 1.2 * fade);
    context.beginPath();
    context.arc(ripple.x, ripple.y, radius * 0.62, 0, TAU);
    context.stroke();
  }

  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-over';
}

function drawMain(engine: Engine): void {
  const { mainCtx, width, height, config } = engine;
  if (width < 2 || height < 2) return;

  mainCtx.globalCompositeOperation = 'source-over';
  mainCtx.globalAlpha = 1;
  mainCtx.fillStyle = config.base;
  mainCtx.fillRect(0, 0, width, height);
  if (engine.paper) {
    mainCtx.fillStyle = engine.paper;
    mainCtx.fillRect(0, 0, width, height);
  }

  drawGlow(engine);
  mainCtx.globalCompositeOperation = 'multiply';
  mainCtx.globalAlpha = config.glowAlpha;
  mainCtx.drawImage(engine.glowCanvas, 0, 0, width, height);

  drawDetail(engine);
  mainCtx.globalCompositeOperation = 'multiply';
  mainCtx.globalAlpha = config.detailAlpha;
  mainCtx.drawImage(engine.detailCanvas, 0, 0, width, height);

  drawSheen(engine);

  mainCtx.globalCompositeOperation = 'source-over';
  mainCtx.globalAlpha = 1;
}

/* ------------------------------------------------------------------ 时间推进 / 循环 */

function updatePointer(engine: Engine, dt: number): void {
  const pointer = engine.pointer;
  pointer.x = damp(pointer.x, pointer.tx, 11, dt);
  pointer.y = damp(pointer.y, pointer.ty, 11, dt);
  pointer.strength = damp(pointer.strength, pointer.target, 6.5, dt);
  if (pointer.strength < 0.0015 && pointer.target === 0) pointer.strength = 0;
}

function updateRipples(engine: Engine): void {
  if (!engine.ripples.length) return;
  engine.ripples = engine.ripples.filter((ripple) => engine.time - ripple.born < 2.6);
}

function drawFrame(engine: Engine, dt: number): void {
  if (engine.disposed || engine.width < 2 || engine.height < 2) return;
  engine.time += dt * engine.config.speed;
  updatePointer(engine, dt);
  updateRipples(engine);
  drawMain(engine);
}

function drawStaticFrame(engine: Engine): void {
  if (engine.disposed || engine.width < 2 || engine.height < 2) return;
  engine.time = 2.4;
  engine.pointer.strength = 0;
  engine.pointer.target = 0;
  engine.pointer.x = engine.width * 0.5;
  engine.pointer.y = engine.height * 0.5;
  engine.ripples = [];
  drawMain(engine);
}

function startLoop(engine: Engine): void {
  if (engine.running || engine.staticMode || engine.paused || engine.disposed) return;
  if (engine.width < 2 || engine.height < 2) return;
  engine.running = true;
  engine.lastFrame = 0;
  engine.raf = requestAnimationFrame((now) => loop(engine, now));
}

function stopLoop(engine: Engine): void {
  engine.running = false;
  if (engine.raf) cancelAnimationFrame(engine.raf);
  engine.raf = 0;
}

function loop(engine: Engine, now: number): void {
  if (!engine.running) return;
  const dt = engine.lastFrame > 0 ? clamp((now - engine.lastFrame) / 1000, 0, 0.05) : 1 / 60;
  engine.lastFrame = now;
  drawFrame(engine, dt);
  engine.raf = requestAnimationFrame((next) => loop(engine, next));
}

function syncPaused(engine: Engine): void {
  const paused = !engine.visible || engine.windowBlurred || (typeof document !== 'undefined' && document.hidden);
  if (paused === engine.paused) return;
  engine.paused = paused;
  if (paused) stopLoop(engine);
  else startLoop(engine);
}

/* ------------------------------------------------------------------ 交互 */

function bindInteraction(engine: Engine): () => void {
  const { pointer } = engine;

  const onPointerMove = (event: PointerEvent): void => {
    if (engine.disposed) return;
    const rect = engine.container.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const inside = x > -rect.width * 0.55 && x < rect.width * 1.55 && y > -rect.height * 0.55 && y < rect.height * 1.55;
    if (!inside) {
      pointer.target = 0;
      return;
    }
    pointer.tx = x;
    pointer.ty = y;
    pointer.target = 1;
    if (pointer.strength < 0.02) {
      pointer.x = x;
      pointer.y = y;
    }
  };

  const onPointerLeave = (): void => {
    pointer.target = 0;
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (engine.disposed || engine.staticMode || event.button !== 0) return;
    const rect = engine.container.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (x < -rect.width * 0.25 || x > rect.width * 1.25 || y < -rect.height * 0.25 || y > rect.height * 1.25) return;
    engine.ripples.push({ x, y, born: engine.time });
    if (engine.ripples.length > 8) engine.ripples.shift();
  };

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerdown', onPointerDown, { passive: true });
  window.addEventListener('blur', onPointerLeave);
  document.documentElement.addEventListener('pointerleave', onPointerLeave);

  return () => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('blur', onPointerLeave);
    document.documentElement.removeEventListener('pointerleave', onPointerLeave);
  };
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

function motionDisabledByPage(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.motion === 'off';
}

function applyMotionMode(engine: Engine): void {
  // 用户在本工具显式开启「动画效果」时优先于系统减少动画偏好；关闭时仍降级静态。
  const forced = document.documentElement.dataset.forceMotion === 'on';
  const staticMode = motionDisabledByPage() || (!forced && prefersReducedMotion());
  if (engine.staticMode !== staticMode) {
    engine.staticMode = staticMode;
  } else if (staticMode) {
    return;
  }
  if (staticMode) {
    stopLoop(engine);
    drawStaticFrame(engine);
    return;
  }
  engine.pointer.target = 0;
  engine.pointer.strength = 0;
  startLoop(engine);
}

/* ------------------------------------------------------------------ React 组件 */

export default function FluidBackground({ variant = 'hero', className }: FluidBackgroundProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return undefined;

    const engine = createEngine(container, canvas, variant);
    if (!engine) return undefined;

    const resizeEngine = (): void => {
      const before = { width: engine.width, height: engine.height, dpr: engine.dpr };
      resize(engine);
      const changed = engine.width !== before.width || engine.height !== before.height || engine.dpr !== before.dpr;
      if (!changed) return;
      if (engine.staticMode) drawStaticFrame(engine);
      else if (!engine.running) startLoop(engine);
    };

    const observer = new ResizeObserver(() => resizeEngine());
    observer.observe(container);

    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        engine.visible = entries.some((entry) => entry.isIntersecting);
        syncPaused(engine);
      },
      { threshold: 0.01 }
    );
    intersectionObserver.observe(container);

    const onVisibilityChange = (): void => syncPaused(engine);
    const onWindowBlur = (): void => {
      engine.windowBlurred = true;
      engine.pointer.target = 0;
      syncPaused(engine);
    };
    const onWindowFocus = (): void => {
      engine.windowBlurred = false;
      syncPaused(engine);
    };
    const onWindowResize = (): void => resizeEngine();

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('focus', onWindowFocus);
    window.addEventListener('resize', onWindowResize, { passive: true });
    window.addEventListener('orientationchange', onWindowResize, { passive: true });

    const unbindInteraction = bindInteraction(engine);

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotionQueryChange = (): void => applyMotionMode(engine);
    motionQuery.addEventListener('change', onMotionQueryChange);

    const mutationObserver = new MutationObserver(() => applyMotionMode(engine));
    mutationObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion', 'data-force-motion'] });

    resizeEngine();
    applyMotionMode(engine);

    return () => {
      engine.disposed = true;
      stopLoop(engine);
      unbindInteraction();
      observer.disconnect();
      intersectionObserver.disconnect();
      mutationObserver.disconnect();
      motionQuery.removeEventListener('change', onMotionQueryChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('focus', onWindowFocus);
      window.removeEventListener('resize', onWindowResize);
      window.removeEventListener('orientationchange', onWindowResize);
      engine.ripples = [];
    };
  }, [variant]);

  const classes = ['fluid-bg', `fluid-bg--${variant}`, className].filter(Boolean).join(' ');

  return (
    <div ref={containerRef} className={classes} aria-hidden="true">
      <canvas ref={canvasRef} className="fluid-bg__canvas" />
    </div>
  );
}


