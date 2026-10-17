/**
 * ★ 媒体能力的纯函数工具（capture-dev）。
 *
 * 这里只放不依赖 Electron / Node 的逻辑：文件名、DPI 换算、裁剪、码率、
 * MediaRecorder 编码候选等。主进程与录制页共享，也便于用 Node 直接跑单测。
 */

import type { AudioSource, CaptureFormat, Rect } from '../../../shared/types';

export interface Size {
  width: number;
  height: number;
}

export type VideoFormat = 'mp4' | 'webm';
export type RecorderFormatPref = 'auto' | 'mp4' | 'webm';

export const CAPTURE_FILE_PREFIX = '截图';
export const RECORDING_FILE_PREFIX = '录制';

export const FPS_OPTIONS = [24, 30, 60] as const;
export const COUNTDOWN_OPTIONS = [0, 3, 5] as const;

export function pad(value: number, length = 2): string {
  const text = Math.max(0, Math.floor(value)).toString();
  return text.length >= length ? text : '0'.repeat(length - text.length) + text;
}

/** yyyyMMdd_HHmmss_SSS（本地时间） */
export function formatStamp(date: Date = new Date()): string {
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}` +
    `_${pad(date.getMilliseconds(), 3)}`
  );
}

/** 截图_yyyyMMdd_HHmmss_SSS.png */
export function captureFileName(format: CaptureFormat, date: Date = new Date()): string {
  return `${CAPTURE_FILE_PREFIX}_${formatStamp(date)}.${format}`;
}

/** 录制_yyyyMMdd_HHmmss_SSS.mp4 */
export function recordingFileName(format: VideoFormat, date: Date = new Date()): string {
  return `${RECORDING_FILE_PREFIX}_${formatStamp(date)}.${format}`;
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** 把 DIP 矩形裁剪进显示器范围（overlay 已裁剪，这里再兜底一次）。 */
export function clampRect(rect: Rect, bounds: Size): Rect {
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const x = clampNumber(Math.round(rect.x), 0, Math.max(0, bounds.width - 1));
  const y = clampNumber(Math.round(rect.y), 0, Math.max(0, bounds.height - 1));
  return {
    x,
    y,
    width: Math.max(1, Math.min(width, bounds.width - x)),
    height: Math.max(1, Math.min(height, bounds.height - y)),
  };
}

/**
 * 区域截图坐标换算：DIP 矩形 → 全屏原图像素矩形。
 *
 * 优先使用“原图宽度 / 显示器 DIP 宽度”作为实际缩放（desktopCapturer 的
 * thumbnailSize 是物理像素，本机 125% 缩放下即 scaleFactor=1.25），这样即使
 * 系统把缩略图限制在别的尺寸也能正确裁剪。
 */
export function computePixelCrop(
  rect: Rect,
  displaySize: Size,
  imageSize: Size
): Rect {
  const scaleX = imageSize.width / Math.max(1, displaySize.width);
  const scaleY = imageSize.height / Math.max(1, displaySize.height);
  const left = Math.round(rect.x * scaleX);
  const top = Math.round(rect.y * scaleY);
  const right = Math.round((rect.x + rect.width) * scaleX);
  const bottom = Math.round((rect.y + rect.height) * scaleY);
  const x = clampNumber(left, 0, Math.max(0, imageSize.width - 1));
  const y = clampNumber(top, 0, Math.max(0, imageSize.height - 1));
  return {
    x,
    y,
    width: Math.max(1, Math.min(imageSize.width - x, Math.round(right - left))),
    height: Math.max(1, Math.min(imageSize.height - y, Math.round(bottom - top))),
  };
}

/** preview 最大边长（长边 480）。 */
export function fitPreviewSize(size: Size, maxEdge = 480): Size {
  const width = Math.max(1, Math.round(size.width));
  const height = Math.max(1, Math.round(size.height));
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const ratio = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

export function normalizeFps(value: unknown, fallback = 30): number {
  const n = typeof value === 'number' ? value : Number(value);
  return (FPS_OPTIONS as readonly number[]).includes(n) ? n : fallback;
}

export function normalizeQuality(value: unknown, fallback = 85): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(clampNumber(n, 1, 100));
}

export function normalizeCountdown(value: unknown, fallback = 3): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(clampNumber(n, 0, 10));
}

export function normalizeAudio(value: unknown, fallback: AudioSource = 'system'): AudioSource {
  const options: AudioSource[] = ['none', 'system', 'mic', 'system+mic'];
  return options.includes(value as AudioSource) ? (value as AudioSource) : fallback;
}

export function needsSystemAudio(audio: AudioSource): boolean {
  return audio === 'system' || audio === 'system+mic';
}

export function needsMic(audio: AudioSource): boolean {
  return audio === 'mic' || audio === 'system+mic';
}

/**
 * 按分辨率 / 帧率 / 画质估算视频码率（bps）。
 * 屏幕内容压缩率高，bpp 控制在 0.015 ~ 0.09 之间，避免录屏文件过大。
 */
export function videoBitrate(opts: {
  width?: number;
  height?: number;
  fps?: number;
  quality?: number;
  max?: number;
}): number {
  const width = Math.max(320, Math.round(opts.width || 1920));
  const height = Math.max(180, Math.round(opts.height || 1080));
  const fps = Math.max(1, Math.min(120, Math.round(opts.fps || 30)));
  const quality = normalizeQuality(opts.quality, 85);
  const bpp = 0.015 + (quality / 100) * 0.075;
  const raw = width * height * fps * bpp;
  const cap = opts.max ?? 30_000_000;
  return Math.round(clampNumber(raw, 300_000, cap));
}

/**
 * MediaRecorder MIME 候选。优先 MP4/H.264（Chromium 140 已支持），
 * 不支持时退回 WebM/VP9+Opus。
 */
export function mimeCandidates(pref: RecorderFormatPref, hasAudio: boolean): string[] {
  const mp4 = hasAudio
    ? [
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4;codecs=avc1.4D401F,mp4a.40.2',
        'video/mp4;codecs=avc1,mp4a.40.2',
        'video/mp4',
      ]
    : [
        'video/mp4;codecs=avc1.42E01E',
        'video/mp4;codecs=avc1.4D401F',
        'video/mp4;codecs=avc1',
        'video/mp4',
      ];
  const webm = hasAudio
    ? [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9',
        'video/webm',
      ]
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  if (pref === 'webm') return webm;
  if (pref === 'mp4') return [...mp4, ...webm];
  return [...mp4, ...webm];
}

export function extFromMime(mime: string): VideoFormat {
  return String(mime || '').toLowerCase().includes('mp4') ? 'mp4' : 'webm';
}

/** 00:12 / 01:23:45 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round((Number.isFinite(ms) ? ms : 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

/** 人类可读体积：1.2 MB / 820 KB */
export function formatBytes(bytes: number): string {
  const value = Math.max(0, NumberFiniteOr(bytes, 0));
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${Math.round(value)} B`;
}

function NumberFiniteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
