/**
 * 壁纸服务。
 *
 * - 内置壁纸：`resources/wallpapers/`（图片 + manifest.json，随安装包分发）
 * - 用户壁纸：`<userData>/wallpapers/`（导入 / URL 下载，文件名即 id）
 * - 选择器：'' | 'builtin:<id>' | 'user:<filename>'，存于 settings.appearance.wallpaper
 * - 预览地址：`tk://file/<base64url(路径)>`，渲染层可直接给 <img src> / CSS 用
 *   （由 main/core/protocol.ts 的白名单文件服务处理）
 *
 * 本文件不负责 IPC 接线；由 core-service 注册 `wallpapers.*` 方法。
 */
import { type BrowserWindow, dialog, nativeImage, net } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  AppPaths,
  Settings,
  SettingsPatch,
  WallpaperCurrent,
  WallpaperItem,
} from '../../shared/types';
import { ToolkitError } from './errors';
import type { Logger } from './logger';
import type { SettingsService } from './settings';

const execFileAsync = promisify(execFile);

export interface WallpaperDeps {
  paths: AppPaths;
  logger: Logger;
  settings: SettingsService;
  getParentWindow: () => BrowserWindow | null;
}

/** manifest.json 中的一条内置壁纸记录。 */
export interface BuiltinWallpaperEntry {
  id: string;
  name: string;
  file: string;
  description?: string;
}

/** 允许作为壁纸的图片扩展名（小写，含点）。 */
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.avif']);

/** 下载 / 导入的单张图片体积上限。 */
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

/** 下载超时（毫秒）。 */
const DOWNLOAD_TIMEOUT_MS = 20_000;

const MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};

const BUILTIN_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SELECTOR_BUILTIN_RE = /^builtin:([a-z0-9][a-z0-9_-]{0,63})$/i;
const SELECTOR_USER_RE = /^user:(.+)$/;

function isImageExt(ext: string): boolean {
  return IMAGE_EXTS.has(ext.toLowerCase());
}

/** 绝对路径 -> `tk://file/...`（base64url，UTF-8），与 protocol.ts 的解码逻辑对应。 */
export function encodeTkFilePath(absPath: string): string {
  return `tk://file/${Buffer.from(absPath, 'utf8').toString('base64url')}`;
}

/** 去掉路径 / 非法字符，得到安全、可读的文件名主干（不含扩展名）。 */
export function sanitizeWallpaperName(input: string, fallback = '壁纸'): string {
  const base = path
    .basename(String(input ?? '').replace(/\\/g, '/'))
    .replace(/\.[a-z0-9]{1,8}$/i, '');
  const safe = base
    // 控制字符与 Windows 文件名非法字符
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 64)
    .trim();
  return safe || fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class WallpaperService {
  private readonly deps: WallpaperDeps;
  private builtin: BuiltinWallpaperEntry[] | null = null;
  private readonly dimsCache = new Map<string, { width: number; height: number }>();

  constructor(deps: WallpaperDeps) {
    this.deps = deps;
    this.ensureUserDir();
  }

  /* ---------------------------------------------------------------- 目录 */

  private get builtinDir(): string {
    return path.join(this.deps.paths.resourcesDir, 'wallpapers');
  }

  private get userDir(): string {
    return path.join(this.deps.paths.userData, 'wallpapers');
  }

  private ensureUserDir(): string {
    try {
      fs.mkdirSync(this.userDir, { recursive: true });
    } catch (err) {
      this.deps.logger.warn('[wallpapers] 创建用户壁纸目录失败', err);
    }
    return this.userDir;
  }

  /* ---------------------------------------------------------------- 清单 */

  /** 读取并校验内置壁纸清单（按 manifest 顺序，跳过不存在的文件）。 */
  private loadBuiltin(): BuiltinWallpaperEntry[] {
    if (this.builtin) return this.builtin;
    const manifestPath = path.join(this.builtinDir, 'manifest.json');
    const out: BuiltinWallpaperEntry[] = [];
    try {
      const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
      if (!Array.isArray(raw)) throw new Error('manifest 不是数组');
      const seen = new Set<string>();
      for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const record = item as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id.trim().toLowerCase() : '';
        const file = typeof record.file === 'string' ? record.file.trim() : '';
        if (!BUILTIN_ID_RE.test(id) || seen.has(id)) continue;
        if (!file || file !== path.basename(file) || !isImageExt(path.extname(file))) continue;
        const abs = path.join(this.builtinDir, file);
        if (!this.isFile(abs)) continue;
        seen.add(id);
        out.push({
          id,
          name: typeof record.name === 'string' && record.name.trim() ? record.name.trim() : id,
          file,
          description: typeof record.description === 'string' ? record.description : undefined,
        });
      }
    } catch (err) {
      this.deps.logger.warn('[wallpapers] 读取内置壁纸清单失败', err);
    }
    this.builtin = out;
    return out;
  }

  /* ---------------------------------------------------------------- 列表 */

  async list(): Promise<WallpaperItem[]> {
    return [...this.listBuiltin(), ...this.listUser()];
  }

  private listBuiltin(): WallpaperItem[] {
    return this.loadBuiltin().map((entry) => {
      const file = path.join(this.builtinDir, entry.file);
      const stat = this.statSafe(file);
      return {
        id: entry.id,
        name: entry.name,
        selector: `builtin:${entry.id}`,
        source: 'builtin',
        url: encodeTkFilePath(file),
        file,
        ...this.dimensions(file),
        sizeBytes: stat?.size,
      } satisfies WallpaperItem;
    });
  }

  private listUser(): WallpaperItem[] {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this.userDir, { withFileTypes: true });
    } catch (err) {
      this.deps.logger.warn('[wallpapers] 读取用户壁纸目录失败', err);
      return [];
    }
    const files = entries
      .filter((entry) => entry.isFile() && isImageExt(path.extname(entry.name)))
      .map((entry) => {
        const file = path.join(this.userDir, entry.name);
        const stat = this.statSafe(file);
        return { name: entry.name, file, mtime: stat?.mtimeMs ?? 0 };
      })
      .sort((a, b) => b.mtime - a.mtime);
    return files.map(({ name, file }) => this.userItem(file, name));
  }

  private userItem(file: string, filename = path.basename(file)): WallpaperItem {
    const stat = this.statSafe(file);
    return {
      id: filename,
      name: path.basename(filename, path.extname(filename)),
      selector: `user:${filename}`,
      source: 'user',
      url: encodeTkFilePath(file),
      file,
      ...this.dimensions(file),
      sizeBytes: stat?.size,
    } satisfies WallpaperItem;
  }

  /* ---------------------------------------------------------------- 解析 / 当前 */

  /** 解析选择器；文件不存在或格式非法时返回 null。 */
  resolve(selector: string): { file: string; url: string; name: string } | null {
    const raw = typeof selector === 'string' ? selector.trim() : '';
    if (!raw) return null;

    const builtinMatch = SELECTOR_BUILTIN_RE.exec(raw);
    if (builtinMatch) {
      const id = builtinMatch[1].toLowerCase();
      const entry = this.loadBuiltin().find((item) => item.id === id);
      if (!entry) return null;
      const file = path.join(this.builtinDir, entry.file);
      if (!this.isFile(file)) return null;
      return { file, url: encodeTkFilePath(file), name: entry.name };
    }

    const userMatch = SELECTOR_USER_RE.exec(raw);
    if (userMatch) {
      const filename = this.safeUserFilename(userMatch[1]);
      if (!filename) return null;
      const file = path.join(this.userDir, filename);
      if (!this.isFile(file)) return null;
      return { file, url: encodeTkFilePath(file), name: path.basename(filename, path.extname(filename)) };
    }
    return null;
  }

  current(): WallpaperCurrent | null {
    const appearance = this.deps.settings.get().appearance;
    const selector = typeof appearance.wallpaper === 'string' ? appearance.wallpaper.trim() : '';
    if (!selector) return null;
    const resolved = this.resolve(selector);
    if (!resolved) return null;
    return {
      selector,
      url: resolved.url,
      name: resolved.name,
      opacity:
        typeof appearance.wallpaperOpacity === 'number' && Number.isFinite(appearance.wallpaperOpacity)
          ? appearance.wallpaperOpacity
          : 0.38,
    };
  }

  /* ---------------------------------------------------------------- 应用 */

  /** 校验并应用壁纸；opacity 省略时保留原值。传空字符串表示清除壁纸。 */
  apply(selector: string, opacity?: number): Settings {
    const raw = typeof selector === 'string' ? selector.trim() : '';
    if (!raw) {
      return this.deps.settings.patch({ appearance: { wallpaper: '' } });
    }
    const resolved = this.resolve(raw);
    if (!resolved) {
      throw new ToolkitError('WALLPAPER_NOT_FOUND', '壁纸不存在或已被删除，请重新选择');
    }
    const canonical = this.canonicalSelector(raw);
    if (!canonical) {
      throw new ToolkitError('BAD_ARGS', '壁纸选择器格式不正确');
    }
    const patch: SettingsPatch = { appearance: { wallpaper: canonical } };
    if (typeof opacity === 'number' && Number.isFinite(opacity)) {
      patch.appearance = { ...patch.appearance, wallpaperOpacity: clamp(opacity, 0.05, 0.8) };
    }
    return this.deps.settings.patch(patch);
  }

  private canonicalSelector(selector: string): string | null {
    const builtinMatch = SELECTOR_BUILTIN_RE.exec(selector);
    if (builtinMatch) {
      const id = builtinMatch[1].toLowerCase();
      return this.loadBuiltin().some((entry) => entry.id === id) ? `builtin:${id}` : null;
    }
    const userMatch = SELECTOR_USER_RE.exec(selector);
    if (userMatch) {
      const filename = this.safeUserFilename(userMatch[1]);
      return filename ? `user:${filename}` : null;
    }
    return null;
  }

  /* ---------------------------------------------------------------- 导入 */

  /** 多选本地图片，复制到用户壁纸目录；取消返回空数组。 */
  async importFromDialog(): Promise<WallpaperItem[]> {
    const dialogOptions = {
      title: '导入壁纸',
      buttonLabel: '导入',
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      filters: [
        { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'avif'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    };
    const parent = this.safeParentWindow();
    const result = parent
      ? await dialog.showOpenDialog(parent, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    if (result.canceled || !result.filePaths.length) return [];

    const imported: WallpaperItem[] = [];
    const errors: string[] = [];
    for (const source of result.filePaths) {
      try {
        imported.push(await this.importFile(source));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(message);
        this.deps.logger.warn('[wallpapers] 导入失败', source, message);
      }
    }
    if (!imported.length) {
      throw new ToolkitError(
        'IMPORT_FAILED',
        errors[0] ? `导入失败：${errors[0]}` : '未能导入所选图片'
      );
    }
    if (errors.length) this.deps.logger.warn('[wallpapers] 部分图片导入失败', errors.join(' | '));
    return imported;
  }

  private async importFile(source: string): Promise<WallpaperItem> {
    const ext = path.extname(source).toLowerCase();
    if (!isImageExt(ext)) throw new Error('仅支持 JPG / PNG / WebP / BMP / GIF / AVIF 图片');
    const stat = await fsp.stat(source).catch(() => null);
    if (!stat || !stat.isFile()) throw new Error('文件不存在或不可读');
    if (stat.size > MAX_IMAGE_BYTES) throw new Error('图片超过 30MB 限制');
    const buffer = await fsp.readFile(source);
    return this.saveBuffer(buffer, path.basename(source, ext), ext);
  }

  /* ---------------------------------------------------------------- 下载 */

  /** 从 http(s) 链接下载图片并保存为用户壁纸（20s 超时，仅 image/*，≤30MB）。 */
  async download(url: string, name?: string): Promise<WallpaperItem> {
    let parsed: URL;
    try {
      parsed = new URL(String(url ?? '').trim());
    } catch {
      throw new ToolkitError('BAD_ARGS', '请输入有效的图片链接');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new ToolkitError('BAD_ARGS', '仅支持 http / https 链接');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const response = await net.fetch(parsed.toString(), {
        signal: controller.signal,
        redirect: 'follow',
      });
      if (!response.ok) {
        throw new ToolkitError('DOWNLOAD_FAILED', `下载失败（HTTP ${response.status}）`);
      }
      const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (!contentType.startsWith('image/')) {
        throw new ToolkitError('DOWNLOAD_FAILED', '该链接不是图片（Content-Type 不是 image/*）');
      }
      const declared = Number(response.headers.get('content-length') ?? 0);
      if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
        throw new ToolkitError('DOWNLOAD_FAILED', '图片超过 30MB 限制');
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.byteLength) throw new ToolkitError('DOWNLOAD_FAILED', '下载内容为空');
      if (buffer.byteLength > MAX_IMAGE_BYTES) {
        throw new ToolkitError('DOWNLOAD_FAILED', '图片超过 30MB 限制');
      }

      const urlExt = path.extname(parsed.pathname).toLowerCase();
      const mimeExt = MIME_EXT[contentType];
      const ext = mimeExt ?? (isImageExt(urlExt) ? urlExt : '.jpg');
      const nameSource =
        name?.trim() || decodeURIComponent(path.basename(parsed.pathname)) || '下载壁纸';
      return this.saveBuffer(buffer, nameSource, ext);
    } catch (err) {
      if (err instanceof ToolkitError) throw err;
      if (controller.signal.aborted) {
        throw new ToolkitError('DOWNLOAD_TIMEOUT', '下载超时（20 秒），请检查网络后重试');
      }
      throw new ToolkitError(
        'DOWNLOAD_FAILED',
        `下载失败：${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /* ---------------------------------------------------------------- 保存 */

  /** 校验图片并写入用户壁纸目录（文件名去重）。 */
  private async saveBuffer(buffer: Buffer, nameHint: string, ext: string): Promise<WallpaperItem> {
    if (!isImageExt(ext)) throw new Error('不支持的图片格式');
    const image = nativeImage.createFromBuffer(buffer);
    if (image.isEmpty()) throw new Error('无法识别的图片格式或图片已损坏');
    const size = image.getSize();
    const base = sanitizeWallpaperName(nameHint);
    const target = await this.uniqueTarget(base, ext);
    await fsp.writeFile(target, buffer);
    if (size.width > 0 && size.height > 0) {
      this.dimsCache.set(this.dimsKey(target), { width: size.width, height: size.height });
    }
    this.deps.logger.info('[wallpapers] 已保存壁纸', target);
    return this.userItem(target);
  }

  private async uniqueTarget(base: string, ext: string): Promise<string> {
    this.ensureUserDir();
    const suffix = ext.toLowerCase();
    for (let index = 1; index < 1000; index += 1) {
      const filename = index === 1 ? `${base}${suffix}` : `${base}-${index}${suffix}`;
      const target = path.join(this.userDir, filename);
      if (!fs.existsSync(target)) return target;
    }
    return path.join(this.userDir, `${base}-${Date.now()}${suffix}`);
  }

  /* ---------------------------------------------------------------- 删除 */

  /** 删除用户壁纸；若正被使用则同时清空设置。内置壁纸不可删除。 */
  async remove(selector: string): Promise<WallpaperItem[]> {
    const userMatch = SELECTOR_USER_RE.exec(typeof selector === 'string' ? selector.trim() : '');
    if (!userMatch) throw new ToolkitError('BAD_ARGS', '只能删除自己导入的壁纸');
    const filename = this.safeUserFilename(userMatch[1]);
    if (!filename) throw new ToolkitError('BAD_ARGS', '壁纸文件名不合法');
    const target = path.join(this.userDir, filename);
    if (!this.isFile(target)) throw new ToolkitError('WALLPAPER_NOT_FOUND', '壁纸文件不存在');
    try {
      await fsp.unlink(target);
    } catch (err) {
      throw new ToolkitError(
        'DELETE_FAILED',
        `删除失败：${err instanceof Error ? err.message : String(err)}`
      );
    }
    this.dimsCache.delete(this.dimsKey(target));
    const currentSelector = this.deps.settings.get().appearance.wallpaper;
    if (currentSelector && currentSelector.toLowerCase() === `user:${filename}`.toLowerCase()) {
      this.deps.settings.patch({ appearance: { wallpaper: '' } });
    }
    this.deps.logger.info('[wallpapers] 已删除壁纸', target);
    return this.list();
  }

  /* ---------------------------------------------------------------- 设为桌面 */

  /** 调用 Windows SystemParametersInfoW 把壁纸设为系统桌面壁纸（无 UAC）。 */
  async setDesktop(selector: string): Promise<{ ok: boolean; error?: string }> {
    const resolved = this.resolve(selector);
    if (!resolved) return { ok: false, error: '壁纸文件不存在或已被删除' };
    if (process.platform !== 'win32') return { ok: false, error: '仅支持在 Windows 上设置桌面壁纸' };

    // 路径经 base64 嵌入脚本，避免中文 / 空格 / 引号转义问题；-EncodedCommand 再整体编码一次。
    const encodedPath = Buffer.from(resolved.file, 'utf8').toString('base64');
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `$bytes = [Convert]::FromBase64String('${encodedPath}')`,
      '$path = [Text.Encoding]::UTF8.GetString($bytes)',
      'if (-not (Test-Path -LiteralPath $path)) { exit 2 }',
      "Add-Type -TypeDefinition @'",
      'using System.Runtime.InteropServices;',
      'public static class TkWallpaper {',
      '  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]',
      '  public static extern int SystemParametersInfoW(int uAction, int uParam, string lpvParam, int fuWinIni);',
      '}',
      "'@",
      '$result = [TkWallpaper]::SystemParametersInfoW(20, 0, $path, 3)',
      'if ($result -eq 0) { exit 1 }',
      'exit 0',
    ].join('\n');
    const encodedScript = Buffer.from(script, 'utf16le').toString('base64');

    try {
      await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedScript],
        { timeout: 20_000, windowsHide: true, maxBuffer: 1024 * 1024 }
      );
      this.deps.logger.info('[wallpapers] 已设置桌面壁纸', resolved.file);
      return { ok: true };
    } catch (err) {
      const failure = err as { code?: number | string; killed?: boolean; message?: string };
      this.deps.logger.warn('[wallpapers] 设置桌面壁纸失败', failure?.message ?? err);
      if (failure?.killed) return { ok: false, error: '设置桌面壁纸超时' };
      if (failure?.code === 2 || /exit code: 2/i.test(failure?.message ?? '')) {
        return { ok: false, error: '壁纸文件不存在或不可访问' };
      }
      if (failure?.code === 1 || /exit code: 1/i.test(failure?.message ?? '')) {
        return { ok: false, error: '系统拒绝了壁纸设置请求（SystemParametersInfo 返回失败）' };
      }
      return { ok: false, error: '调用系统接口失败，请稍后重试' };
    }
  }

  /* ---------------------------------------------------------------- 工具 */

  private safeUserFilename(input: string): string | null {
    const raw = String(input ?? '').trim();
    if (!raw) return null;
    const flattened = raw.replace(/[\\/]+/g, '/');
    if (flattened !== raw) return null;
    const filename = path.basename(flattened);
    if (filename !== flattened || filename === '.' || filename === '..') return null;
    if (filename.includes('\u0000')) return null;
    if (!isImageExt(path.extname(filename))) return null;
    if (filename.length > 120) return null;
    return filename;
  }

  private statSafe(file: string): fs.Stats | null {
    try {
      return fs.statSync(file);
    } catch {
      return null;
    }
  }

  private isFile(file: string): boolean {
    return !!this.statSafe(file)?.isFile();
  }

  private dimsKey(file: string): string {
    const stat = this.statSafe(file);
    return stat ? `${file}:${stat.mtimeMs}:${stat.size}` : file;
  }

  /** 宽高由 nativeImage 读取（失败则省略），按文件 mtime + size 缓存。 */
  private dimensions(file: string): { width?: number; height?: number } {
    try {
      const key = this.dimsKey(file);
      const cached = this.dimsCache.get(key);
      if (cached) return { ...cached };
      const image = nativeImage.createFromPath(file);
      if (image.isEmpty()) return {};
      const { width, height } = image.getSize();
      if (width <= 0 || height <= 0) return {};
      this.dimsCache.set(key, { width, height });
      return { width, height };
    } catch {
      return {};
    }
  }

  private safeParentWindow(): BrowserWindow | null {
    try {
      const parent = this.deps.getParentWindow();
      return parent && !parent.isDestroyed() ? parent : null;
    } catch {
      return null;
    }
  }
}
