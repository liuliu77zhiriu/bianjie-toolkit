/**
 * ★ 截图实现（capture-dev）：desktopCapturer + screen。
 *
 * DPI 约定（本机 125% 缩放实测）：
 * - desktopCapturer 的 thumbnailSize 是物理像素，坐标换算用 display.scaleFactor；
 * - 全屏截图请求 physical = size * scaleFactor，返回图像即该显示器完整像素；
 * - 区域截图 = 全屏原图 nativeImage.crop(rect * 实际缩放)；
 * - 窗口截图请求 3840x2160 的大缩略图（Chromium 会保持宽高比缩放）。
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import type { DesktopCapturerSource, Display, NativeImage } from 'electron';
import type {
  AppPaths,
  CaptureFormat,
  CaptureOptions,
  CaptureResult,
  MediaDeps,
  MediaSource,
  Rect,
} from '../../../shared/types';
import { ToolkitError } from '../errors';
import { captureFileName, clampRect, computePixelCrop, fitPreviewSize } from './geometry';

export interface ScreenshotDeps {
  settings: MediaDeps['settings'];
  paths: AppPaths;
  log: MediaDeps['log'];
  electron: MediaDeps['electron'];
  hidePanel: () => Promise<void>;
  showPanel: () => Promise<void>;
}

type CapturerSource = DesktopCapturerSource;

const WINDOW_THUMB = { width: 3840, height: 2160 };
const PREVIEW_MAX_EDGE = 480;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readableError(err: unknown): string {
  if (err instanceof ToolkitError) return err.message;
  if (err instanceof Error) return err.message || String(err);
  return String(err);
}

async function ensureDir(dir: string): Promise<string> {
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

/** 保存目录：设置优先，为空回退到默认「图片/便捷工具截图」。 */
async function resolveCaptureDir(deps: ScreenshotDeps): Promise<string> {
  const configured = String(deps.settings.get().capture.saveDir || '').trim();
  if (configured) {
    try {
      return await ensureDir(configured);
    } catch (err) {
      deps.log.warn('[media] 截图目录不可用，回退默认目录', configured, err);
    }
  }
  try {
    return await ensureDir(deps.paths.screenshots);
  } catch (err) {
    throw new ToolkitError('CAPTURE_DIR_FAILED', `无法创建截图目录：${readableError(err)}`);
  }
}

/** 同名文件兜底：截图_..._123.png → 截图_..._123_1.png */
async function uniquePath(dir: string, filename: string): Promise<string> {
  const ext = path.extname(filename);
  const base = filename.slice(0, Math.max(0, filename.length - ext.length));
  for (let index = 0; index < 200; index += 1) {
    const candidate = path.join(dir, index === 0 ? filename : `${base}_${index}${ext}`);
    try {
      await fsp.access(candidate);
    } catch {
      return candidate;
    }
  }
  return path.join(dir, `${base}_${Date.now()}${ext}`);
}

async function writeAtomic(file: string, data: Buffer): Promise<void> {
  const temp = `${file}.tmp-${process.pid}`;
  try {
    await fsp.writeFile(temp, data);
    await fsp.rename(temp, file);
  } catch (err) {
    await fsp.rm(temp, { force: true }).catch(() => undefined);
    throw err;
  }
}

/* ------------------------------------------------------------------ 来源枚举 */

export async function listSources(
  deps: ScreenshotDeps,
  opts?: { kinds?: Array<'screen' | 'window'>; thumbnailWidth?: number }
): Promise<MediaSource[]> {
  const kinds = opts?.kinds && opts.kinds.length ? opts.kinds : (['screen', 'window'] as const);

  let thumbnailWidth = Math.round(Number(opts?.thumbnailWidth) || 320);
  if (!Number.isFinite(thumbnailWidth)) thumbnailWidth = 320;
  thumbnailWidth = Math.min(960, Math.max(64, thumbnailWidth));

  let sources: Awaited<ReturnType<MediaDeps['electron']['desktopCapturer']['getSources']>> = [];
  try {
    sources = await deps.electron.desktopCapturer.getSources({
      types: kinds as Array<'screen' | 'window'>,
      thumbnailSize: { width: thumbnailWidth, height: thumbnailWidth },
      fetchWindowIcons: true,
    });
  } catch (err) {
    throw new ToolkitError('LIST_SOURCES_FAILED', `无法枚举截图来源：${readableError(err)}`);
  }

  const list: MediaSource[] = [];
  for (const source of sources) {
    const kind: 'screen' | 'window' = String(source.id || '').startsWith('screen:') ? 'screen' : 'window';
    if (!kinds.includes(kind)) continue;
    let thumbnail = '';
    try {
      if (!source.thumbnail || source.thumbnail.isEmpty()) continue;
      thumbnail = source.thumbnail.toDataURL();
    } catch {
      continue;
    }
    let appIcon: string | undefined;
    try {
      if (source.appIcon && !source.appIcon.isEmpty()) appIcon = source.appIcon.toDataURL();
    } catch {
      appIcon = undefined;
    }
    list.push({
      id: source.id,
      name: source.name || (kind === 'screen' ? '屏幕' : '窗口'),
      kind,
      displayId: kind === 'screen' ? String(source.display_id || '') || undefined : undefined,
      thumbnail,
      appIcon,
    });
  }

  // 屏幕在前，窗口按名称排序，保证 UI 稳定。
  return list.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'screen' ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
}

/* ------------------------------------------------------------------ 原始图像获取 */

interface ScreenImage {
  image: NativeImage;
  display: Display;
}

function resolveDisplay(deps: ScreenshotDeps, displayId?: string): Display {
  const displays = deps.electron.screen.getAllDisplays();
  if (!displays.length) throw new ToolkitError('NO_DISPLAY', '没有检测到可用显示器');
  if (displayId) {
    const matched = displays.find((display) => String(display.id) === String(displayId));
    if (matched) return matched;
    throw new ToolkitError('DISPLAY_NOT_FOUND', '目标显示器已断开，请重试');
  }
  const primaryId = deps.electron.screen.getPrimaryDisplay().id;
  return displays.find((display) => display.id === primaryId) ?? displays[0];
}

async function captureScreenImage(deps: ScreenshotDeps, displayId?: string): Promise<ScreenImage> {
  const display = resolveDisplay(deps, displayId);
  const physical = {
    width: Math.max(1, Math.round(display.size.width * display.scaleFactor)),
    height: Math.max(1, Math.round(display.size.height * display.scaleFactor)),
  };

  let sources: Awaited<ReturnType<MediaDeps['electron']['desktopCapturer']['getSources']>> = [];
  try {
    sources = await deps.electron.desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: physical,
      fetchWindowIcons: false,
    });
  } catch (err) {
    throw new ToolkitError('CAPTURE_FAILED', `屏幕捕获失败：${readableError(err)}`);
  }

  const displays = deps.electron.screen.getAllDisplays();
  const displayIndex = displays.findIndex((item) => item.id === display.id);
  const matched =
    sources.find((source) => String(source.display_id) === String(display.id)) ??
    (sources.length === 1 ? sources[0] : undefined) ??
    (displayIndex >= 0 ? sources[displayIndex] : undefined) ??
    sources[0];

  if (!matched || !matched.thumbnail || matched.thumbnail.isEmpty()) {
    throw new ToolkitError('CAPTURE_FAILED', '未能获取屏幕画面，请确认系统允许屏幕捕获后重试');
  }
  return { image: matched.thumbnail, display };
}

/* ------------------------------------------------------------------ 保存与结果 */

function buildPreview(image: NativeImage): string | undefined {
  try {
    const size = image.getSize();
    const target = fitPreviewSize(size, PREVIEW_MAX_EDGE);
    if (target.width === size.width && target.height === size.height) return image.toDataURL();
    return image.resize({ width: target.width, height: target.height, quality: 'good' }).toDataURL();
  } catch {
    return undefined;
  }
}

async function saveCapture(
  deps: ScreenshotDeps,
  image: NativeImage,
  copyOverride?: boolean
): Promise<CaptureResult> {
  const settings = deps.settings.get();
  const format: CaptureFormat = settings.capture.format === 'jpg' ? 'jpg' : 'png';
  const dir = await resolveCaptureDir(deps);
  const target = await uniquePath(dir, captureFileName(format));

  let data: Buffer;
  try {
    data = format === 'jpg' ? image.toJPEG(92) : image.toPNG();
  } catch (err) {
    throw new ToolkitError('ENCODE_FAILED', `截图编码失败：${readableError(err)}`);
  }
  if (!data || !data.length) throw new ToolkitError('ENCODE_FAILED', '截图编码结果为空');

  try {
    await writeAtomic(target, data);
  } catch (err) {
    throw new ToolkitError('SAVE_FAILED', `保存截图失败：${readableError(err)}`);
  }

  const shouldCopy = copyOverride === undefined ? !!settings.capture.copyToClipboard : !!copyOverride;
  let copied = false;
  if (shouldCopy) {
    try {
      deps.electron.clipboard.writeImage(image);
      copied = true;
    } catch (err) {
      deps.log.warn('[media] 写入剪贴板失败', err);
    }
  }

  const size = image.getSize();
  return {
    path: target,
    width: size.width,
    height: size.height,
    copied,
    preview: buildPreview(image),
    format,
  };
}

/** 截图前隐藏面板，失败时恢复，避免用户「面板消失且无结果」。 */
async function withHiddenPanel<T>(
  deps: ScreenshotDeps,
  opts: CaptureOptions | undefined,
  run: () => Promise<T>
): Promise<T> {
  const shouldHide = opts?.hidePanel !== false;
  if (shouldHide) {
    try {
      await deps.hidePanel();
    } catch {
      /* 面板可能本来就没开 */
    }
    // 等面板淡出动画（~190ms）结束，避免截进画面。
    await delay(200);
  }
  try {
    return await run();
  } catch (err) {
    if (shouldHide) {
      try {
        await deps.showPanel();
      } catch {
        /* ignore */
      }
    }
    if (err instanceof ToolkitError) throw err;
    throw new ToolkitError('CAPTURE_FAILED', `截图失败：${readableError(err)}`);
  }
}

/* ------------------------------------------------------------------ 对外接口 */

export async function captureFullscreen(
  deps: ScreenshotDeps,
  opts: CaptureOptions = {}
): Promise<CaptureResult> {
  return withHiddenPanel(deps, opts, async () => {
    const { image } = await captureScreenImage(deps, opts.displayId);
    return saveCapture(deps, image, opts.copy);
  });
}

export async function captureRegion(
  deps: ScreenshotDeps,
  opts: CaptureOptions & { rect: Rect; displayId?: string }
): Promise<CaptureResult> {
  if (!opts?.rect || !Number.isFinite(opts.rect.width) || !Number.isFinite(opts.rect.height)) {
    throw new ToolkitError('BAD_RECT', '区域截图缺少有效的选区');
  }
  return withHiddenPanel(deps, opts, async () => {
    const { image, display } = await captureScreenImage(deps, opts.displayId);
    const displaySize = { width: display.size.width, height: display.size.height };
    const dipRect = clampRect(opts.rect, displaySize);
    const imageSize = image.getSize();
    const crop = computePixelCrop(dipRect, displaySize, imageSize);
    let cropped: NativeImage;
    try {
      cropped = image.crop(crop);
    } catch (err) {
      throw new ToolkitError('CROP_FAILED', `区域裁剪失败：${readableError(err)}`);
    }
    if (!cropped || cropped.isEmpty()) {
      throw new ToolkitError('CROP_FAILED', '选区太小或超出屏幕范围');
    }
    return saveCapture(deps, cropped, opts.copy);
  });
}

export async function captureWindow(
  deps: ScreenshotDeps,
  opts: CaptureOptions & { sourceId: string }
): Promise<CaptureResult> {
  if (!opts?.sourceId) throw new ToolkitError('BAD_SOURCE', '缺少窗口来源');
  return withHiddenPanel(deps, opts, async () => {
    let sources: Awaited<ReturnType<MediaDeps['electron']['desktopCapturer']['getSources']>> = [];
    try {
      sources = await deps.electron.desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: WINDOW_THUMB,
        fetchWindowIcons: false,
      });
    } catch (err) {
      throw new ToolkitError('CAPTURE_FAILED', `窗口捕获失败：${readableError(err)}`);
    }
    const source = sources.find((item) => item.id === opts.sourceId);
    if (!source) throw new ToolkitError('SOURCE_NOT_FOUND', '目标窗口已关闭或不可见，请刷新后重试');
    if (!source.thumbnail || source.thumbnail.isEmpty()) {
      throw new ToolkitError('CAPTURE_FAILED', '该窗口暂时无法截取画面，请切换到前台后重试');
    }
    let image: NativeImage = source.thumbnail;
    try {
      const size = image.getSize();
      const longest = Math.max(size.width, size.height);
      // 部分系统对超长边有 4096 限制，超出时等比缩小。
      if (longest > 4096) {
        const ratio = 4096 / longest;
        image = image.resize({
          width: Math.max(1, Math.round(size.width * ratio)),
          height: Math.max(1, Math.round(size.height * ratio)),
          quality: 'better',
        });
      }
    } catch {
      /* 保留原图 */
    }
    return saveCapture(deps, image, opts.copy);
  });
}
