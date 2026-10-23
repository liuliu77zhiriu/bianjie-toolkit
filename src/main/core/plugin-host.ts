import { BrowserWindow, app, clipboard, dialog, ipcMain, nativeImage, Notification, shell, screen, desktopCapturer } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as acorn from 'acorn';
import type {
  AppPaths,
  CommandInfo,
  MediaApi,
  PluginCommandDef,
  PluginEditResult,
  PluginFileEntry,
  PluginFilesPayload,
  PluginManifest,
  PluginRuntimeInfo,
  PluginWindowHandle,
  PluginWindowOptions,
  RegionPickResult,
} from '../../shared/types';
import type { IpcHub, ClientMeta } from './ipc';
import type { Logger } from './logger';
import type { SettingsService } from './settings';
import type { WindowManager } from './windows';
import type { OverlayManager } from './overlay';
import { JsonStore } from './store';
import { ToolkitError } from './errors';

const ID_RE = /^[a-z][a-z0-9-]{1,31}$/;
const TEXT_EXT = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.tsx',
  '.json',
  '.html',
  '.htm',
  '.css',
  '.svg',
  '.txt',
  '.md',
  '.py',
  '.yml',
  '.yaml',
  '.xml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.sh',
  '.bat',
  '.cmd',
  '.ps1',
  '.sql',
  '.csv',
  '.log',
]);
const MAX_EDIT_BYTES = 2 * 1024 * 1024;
/** 覆盖层目录下的墓碑清单：记录被用户删除的内置/基座文件（相对路径数组）。 */
const TOMBSTONE_FILE = '.deleted.json';
const RESERVED_SEGMENT_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const WINDOWS_FORBIDDEN_RE = /[<>:"|?*\u0000-\u001f\u007f]/;

/** 统一相对路径：去首尾斜杠、反斜杠转正斜杠。 */
function normalizeRelPath(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

/** 校验“新建文件”路径：允许子目录与任意可编辑文本扩展名，拒绝 .. / 非法字符 / Windows 保留名。 */
function assertCreatableRelPath(raw: string): string {
  const rel = normalizeRelPath(raw);
  if (!rel) throw new ToolkitError('BAD_PATH', '请输入文件名');
  if (rel.length > 240) throw new ToolkitError('BAD_PATH', '文件路径过长（最多 240 个字符）');
  if (WINDOWS_FORBIDDEN_RE.test(rel)) throw new ToolkitError('BAD_PATH', '文件路径不能包含 < > : " | ? * 等字符');
  if (/^[a-zA-Z]:/.test(rel)) throw new ToolkitError('BAD_PATH', '请使用相对插件目录的路径，例如 lib/helpers.js');
  if (rel.includes('..')) throw new ToolkitError('BAD_PATH', '文件路径不能包含 ..');
  const segments = rel.split('/');
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') {
      throw new ToolkitError('BAD_PATH', '文件路径不能包含空目录名或 ..');
    }
    if (segment.length > 80) throw new ToolkitError('BAD_PATH', '目录或文件名过长（单个最多 80 个字符）');
    if (segment.startsWith('.')) throw new ToolkitError('BAD_PATH', '文件名不能以 . 开头');
    if (/[. ]$/.test(segment)) throw new ToolkitError('BAD_PATH', '目录或文件名不能以空格或 . 结尾');
    if (RESERVED_SEGMENT_RE.test(segment)) throw new ToolkitError('BAD_PATH', `不能使用系统保留名称：${segment}`);
  }
  const base = segments[segments.length - 1];
  const ext = path.extname(base).toLowerCase();
  if (!ext) throw new ToolkitError('BAD_PATH', '文件名需要包含扩展名，例如 helpers.js');
  if (!/^\.[a-z0-9]{1,12}$/i.test(ext)) throw new ToolkitError('BAD_PATH', '扩展名只能由字母或数字组成（最长 12 位）');
  return segments.join('/');
}

/** 新建文件时的初始内容：按扩展名给出最小可用模板，未知扩展名保持空文件。 */
function textTemplateFor(rel: string): string {
  const ext = path.extname(rel).toLowerCase();
  const base = path.basename(rel);
  switch (ext) {
    case '.js':
    case '.mjs':
    case '.cjs':
      return `/** ${base} */\n`;
    case '.jsx':
    case '.ts':
    case '.tsx':
      return `/** ${base} */\n\n`;
    case '.html':
    case '.htm':
      return `<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8" />\n<title>${base.replace(/\.html?$/i, '')}</title>\n</head>\n<body>\n\n</body>\n</html>\n`;
    case '.css':
      return `/* ${base} */\n`;
    case '.json':
      return '{}\n';
    case '.md':
      return `# ${base.replace(/\.md$/i, '')}\n`;
    default:
      return '';
  }
}

/** 文件语言（供前端选择高亮/标签）。 */
function languageOfExt(ext: string): PluginFileEntry['language'] {
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs' || ext === '.jsx' || ext === '.ts' || ext === '.tsx') {
    return 'javascript';
  }
  if (ext === '.json') return 'json';
  if (ext === '.html' || ext === '.htm') return 'html';
  if (ext === '.css') return 'css';
  return 'text';
}

interface CommandEntry {
  def: PluginCommandDef;
  pluginId: string;
  pluginName: string;
  run: (args?: unknown) => unknown | Promise<unknown>;
}

/** 插件作用域 KV 存储：遵循 docs/PLUGIN_SDK.md 的 get(key, fallback)/set/delete/all/clear 契约。 */
class PluginStore {
  constructor(private store: JsonStore<Record<string, unknown>>) {}

  get<T = unknown>(key: string, fallback?: T): T {
    const all = this.store.get();
    if (Object.prototype.hasOwnProperty.call(all, key)) return (all as Record<string, unknown>)[key] as T;
    return fallback as T;
  }

  set(key: string, value: unknown): void {
    if (!key) return;
    this.store.update((draft) => {
      draft[key] = value;
    });
  }

  delete(key: string): void {
    this.store.update((draft) => {
      delete draft[key];
    });
  }

  all(): Record<string, unknown> {
    return this.store.get();
  }

  clear(): void {
    this.store.replace({});
  }

  flush(): void {
    this.store.flush();
  }
}

interface PluginRecord {
  id: string;
  manifest: PluginManifest;
  source: 'builtin' | 'user';
  baseDir: string;
  overrideDir: string;
  enabled: boolean;
  loaded: boolean;
  /** plugin.json 缺失/无效（例如被用户以墓碑删除）：保留记录以便在编辑器中恢复，但不加载 */
  manifestMissing?: boolean;
  error?: string;
  module?: { activate?: (ctx: PluginContext) => unknown; deactivate?: () => unknown };
  cleanup: Array<() => void>;
  ipcHandlers: Map<string, (args: unknown, meta: ClientMeta) => unknown>;
  eventHandlers: Map<string, Set<(payload: unknown) => void>>;
  commands: Map<string, CommandEntry>;
  windows: Map<string, { win: BrowserWindow; forceClose: boolean; opts: PluginWindowOptions }>;
  store?: PluginStore;
}

export interface PluginHostDeps {
  paths: AppPaths;
  logger: Logger;
  settings: SettingsService;
  ipc: IpcHub;
  windows: WindowManager;
  overlay: OverlayManager;
  media: MediaApi;
  uieditor?: { openWindow: (projectId?: string) => void };
}

type PluginContext = Record<string, unknown> & {
  ipc: {
    handle: (method: string, fn: (args: unknown, meta: ClientMeta) => unknown) => void;
    unhandle: (method: string) => void;
  };
  events: { broadcast: (topic: string, payload?: unknown) => void; on: (topic: string, fn: (payload: unknown) => void) => () => void };
  commands: { register: (def: PluginCommandDef & { run: (args?: unknown) => unknown }) => () => void; run: (id: string, args?: unknown) => unknown };
  windows: Record<string, unknown>;
  uieditor: { open: (projectId?: string) => void };
  store: PluginStore;
};

export class PluginHost {
  private records = new Map<string, PluginRecord>();
  private started = false;
  private commandsChangedListeners = new Set<() => void>();
  private dynamicImport = new Function('u', 'return import(u)') as (u: string) => Promise<{ default?: unknown }>;
  private callbacks = new Set<() => void>();
  private quitting = false;

  constructor(private deps: PluginHostDeps) {}

  /* ---------------------------------------------------------------- 发现与加载 */

  async start() {
    this.started = true;
    await this.discover();
    this.installIpcMain();
    for (const record of this.records.values()) {
      if (record.enabled) {
        await this.activate(record);
      }
    }
    this.emitPluginsChanged();
  }

  async stop() {
    for (const record of this.records.values()) {
      await this.deactivate(record);
    }
    this.records.clear();
  }

  /** 重新扫描并重载所有插件（用于安装/发布新插件后恢复命令与状态） */
  async restart() {
    await this.stop();
    this.started = true;
    await this.discover();
    for (const record of this.records.values()) {
      if (record.enabled) await this.activate(record);
    }
    this.emitPluginsChanged();
  }

  /** 应用退出时调用：允许插件窗口真正关闭（hideOnClose 不再拦截） */
  markQuitting() {
    this.quitting = true;
  }

  onChanged(cb: () => void) {
    this.callbacks.add(cb);
    return () => this.callbacks.delete(cb);
  }

  private emitPluginsChanged() {
    for (const cb of this.callbacks) {
      try {
        cb();
      } catch (err) {
        this.deps.logger.warn('[plugins] change listener error', err);
      }
    }
    this.deps.ipc.broadcast('plugins:changed', this.list());
  }

  private emitCommandsChanged() {
    for (const cb of this.commandsChangedListeners) {
      try {
        cb();
      } catch (err) {
        this.deps.logger.warn('[commands] listener error', err);
      }
    }
  }

  async discover() {
    const { paths, logger } = this.deps;
    const found = new Map<string, PluginRecord>();
    const disabled = new Set(this.deps.settings.get().plugins.disabled);

    const scan = async (root: string, source: 'builtin' | 'user') => {
      let entries: fs.Dirent[] = [];
      try {
        entries = await fsp.readdir(root, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        if (source === 'builtin' && !ID_RE.test(entry.name)) continue;
        const baseDir = path.join(root, entry.name);
        const manifest = await this.readManifest(baseDir, entry.name);
        if (!manifest) {
          // 清单被用户以墓碑删除时，保留一条错误记录，避免插件从列表消失后无法恢复。
          if (ID_RE.test(entry.name) && this.isTombstoned(entry.name, 'plugin.json')) {
            const fallback = this.normalizeManifest({ id: entry.name, name: entry.name }, entry.name);
            if (fallback) {
              found.set(fallback.id, {
                id: fallback.id,
                manifest: fallback,
                source,
                baseDir,
                overrideDir: path.join(paths.overrides, fallback.id),
                enabled: !disabled.has(fallback.id),
                loaded: false,
                manifestMissing: true,
                error: '插件清单 plugin.json 已被删除，可在代码编辑器的“已删除文件”中恢复',
                cleanup: [],
                ipcHandlers: new Map(),
                eventHandlers: new Map(),
                commands: new Map(),
                windows: new Map(),
              });
              logger.warn(`[plugins] 插件清单被墓碑删除，保留待恢复记录: ${baseDir}`);
              continue;
            }
          }
          logger.warn(`[plugins] 跳过无效插件目录: ${baseDir}`);
          continue;
        }
        if (found.has(manifest.id)) {
          if (source === 'builtin') continue;
          logger.warn(`[plugins] 用户插件覆盖同名内置插件: ${manifest.id}`);
        }
        const overrideDir = path.join(paths.overrides, manifest.id);
        const record: PluginRecord = {
          id: manifest.id,
          manifest,
          source,
          baseDir,
          overrideDir,
          enabled: !disabled.has(manifest.id),
          loaded: false,
          cleanup: [],
          ipcHandlers: new Map(),
          eventHandlers: new Map(),
          commands: new Map(),
          windows: new Map(),
        };
        found.set(manifest.id, record);
      }
    };

    await scan(path.join(paths.resourcesDir, 'plugins'), 'builtin');
    await scan(paths.plugins, 'user');

    // 保留运行中的插件记录（热重载时避免状态丢失）
    for (const [id, existing] of this.records) {
      if (!found.has(id)) {
        await this.deactivate(existing);
      }
    }
    this.records = found;
  }

  private async readManifest(dir: string, id?: string): Promise<PluginManifest | null> {
    // 清单被墓碑删除时视为无效（不绕过墓碑），插件会进入错误态并可在编辑器中恢复。
    if (id && this.isTombstoned(id, 'plugin.json')) return null;
    const candidates: string[] = [];
    if (id) candidates.push(path.join(this.deps.paths.overrides, id, 'plugin.json'));
    candidates.push(path.join(dir, 'plugin.json'));
    for (const file of candidates) {
      try {
        const raw = JSON.parse(await fsp.readFile(file, 'utf8')) as Partial<PluginManifest>;
        return this.normalizeManifest(raw, id ?? path.basename(dir));
      } catch {
        /* try next */
      }
    }
    return null;
  }

  private normalizeManifest(raw: Partial<PluginManifest>, fallbackId: string): PluginManifest | null {
    const id = String(raw?.id ?? fallbackId).trim();
    if (!ID_RE.test(id)) return null;
    const name = String(raw?.name ?? id).slice(0, 40);
    const manifest: PluginManifest = {
      id,
      name,
      description: typeof raw?.description === 'string' ? raw.description.slice(0, 120) : '',
      version: typeof raw?.version === 'string' ? raw.version : '1.0.0',
      icon: typeof raw?.icon === 'string' ? raw.icon : undefined,
      accent: typeof raw?.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.accent) ? raw.accent : undefined,
      order: typeof raw?.order === 'number' ? raw.order : 100,
      entry: typeof raw?.entry === 'string' ? raw.entry : 'main.js',
      ui: typeof raw?.ui === 'string' ? raw.ui : 'index.html',
      builtin: this.records.get(id)?.source !== 'user' && raw?.builtin !== false,
      hidden: raw?.hidden === true,
    };
    if (manifest.entry && manifest.entry.includes('..')) return null;
    if (manifest.ui && manifest.ui.includes('..')) return null;
    return manifest;
  }

  /* ---------------------------------------------------------------- 激活 / 停用 */

  private async activate(record: PluginRecord) {
    if (record.loaded) return;
    if (record.enabled === false) return;
    // 清单被墓碑删除 / 无效时不加载，但保留错误态与恢复入口
    if (record.manifestMissing) {
      record.loaded = false;
      return;
    }
    try {
      const entryRel = record.manifest.entry || 'main.js';
      const entryFile = this.resolveFile(record.id, entryRel);
      if (!entryFile) throw new ToolkitError('PLUGIN_ENTRY_MISSING', `插件入口不存在：${entryRel}`);
      const mod = await this.dynamicImport(`${pathToFileURL(entryFile).href}?v=${Date.now()}`);
      const plugin = (mod.default ?? mod) as PluginRecord['module'];
      record.module = plugin;
      if (typeof plugin?.activate !== 'function') {
        throw new ToolkitError('PLUGIN_INVALID', '插件缺少 activate(ctx) 导出');
      }
      const ctx = this.createContext(record);
      await plugin.activate(ctx);
      record.loaded = true;
      record.error = undefined;
      this.deps.logger.info(`[plugins] 已加载 ${record.id} v${record.manifest.version} (${record.source})`);
    } catch (err) {
      record.loaded = false;
      record.error = err instanceof Error ? err.message : String(err);
      this.deps.logger.error(`[plugins] 加载失败 ${record.id}:`, err);
    }
    this.emitPluginsChanged();
  }

  private async deactivate(record: PluginRecord) {
    try {
      await record.module?.deactivate?.();
    } catch (err) {
      this.deps.logger.warn(`[plugins] deactivate 出错 ${record.id}:`, err);
    }
    for (const cleanup of record.cleanup.splice(0)) {
      try {
        cleanup();
      } catch {
        /* ignore */
      }
    }
    for (const entry of record.windows.values()) {
      try {
        if (!entry.win.isDestroyed()) entry.win.destroy();
      } catch {
        /* ignore */
      }
    }
    record.windows.clear();
    record.ipcHandlers.clear();
    record.eventHandlers.clear();
    record.commands.clear();
    try {
      record.store?.flush();
    } catch {
      /* ignore */
    }
    record.loaded = false;
    record.module = undefined;
    this.emitCommandsChanged();
  }

  private createContext(record: PluginRecord): PluginContext {
    const { paths, ipc, settings, logger, windows, overlay, media, uieditor } = this.deps;
    const pluginId = record.id;
    const dataDir = path.join(paths.userData, 'plugin-data');
    fs.mkdirSync(dataDir, { recursive: true });
    record.store =
      record.store ??
      new PluginStore(
        new JsonStore<Record<string, unknown>>(path.join(dataDir, `${record.id}.json`), {}, { logger })
      );

    const contextMenus: Array<() => void> = [];
    void contextMenus;
    const commandEntries: Array<() => void> = [];

    const ctx: PluginContext = {
      plugin: {
        id: record.id,
        name: record.manifest.name,
        version: record.manifest.version,
        dir: record.baseDir,
        dataDir,
      },
      log: {
        info: (...args: unknown[]) => logger.info(`[${record.id}]`, ...args),
        warn: (...args: unknown[]) => logger.warn(`[${record.id}]`, ...args),
        error: (...args: unknown[]) => logger.error(`[${record.id}]`, ...args),
        debug: (...args: unknown[]) => logger.debug(`[${record.id}]`, ...args),
      },
      paths,
      uieditor: {
        open: (projectId?: string) => uieditor?.openWindow(projectId),
      },
      store: record.store,
      ipc: {
        handle: (method, fn) => {
          record.ipcHandlers.set(String(method), fn);
        },
        unhandle: (method) => {
          record.ipcHandlers.delete(String(method));
        },
      },
      events: {
        broadcast: (topic, payload) => ipc.broadcastPlugin(pluginId, String(topic), payload),
        on: (topic, fn) => {
          const key = String(topic);
          const set = record.eventHandlers.get(key) ?? new Set();
          set.add(fn);
          record.eventHandlers.set(key, set);
          return () => set.delete(fn);
        },
      },
      commands: {
        register: (def) => {
          const id = String(def.id);
          const entry: CommandEntry = {
            def: { ...def, id },
            pluginId,
            pluginName: record.manifest.name,
            run: def.run,
          };
          record.commands.set(id, entry);
          // 全局命令注册表由 listCommands 聚合
          this.emitCommandsChanged();
          const dispose = () => {
            record.commands.delete(id);
            this.emitCommandsChanged();
          };
          commandEntries.push(dispose);
          return dispose;
        },
        run: (id, args) => this.runCommand(String(id), args),
      },
      windows: {
        open: (opts: PluginWindowOptions) => this.openPluginWindow(record, { ...opts, key: String(opts?.key || 'main') }),
        close: (key: string) => this.closePluginWindow(record, String(key)),
        send: (key: string, topic: string, payload?: unknown) => this.sendToPluginWindow(record, String(key), String(topic), payload),
        exists: (key: string) => record.windows.has(String(key)),
        list: () => Array.from(record.windows.keys()),
        show: (key: string) => {
          const entry = record.windows.get(String(key));
          if (entry && !entry.win.isDestroyed()) {
            entry.win.showInactive();
            entry.win.setAlwaysOnTop(true, 'floating');
          }
        },
        hide: (key: string) => {
          const entry = record.windows.get(String(key));
          if (entry && !entry.win.isDestroyed()) entry.win.hide();
        },
      },
      overlay: {
        pickRegion: (opts?: { hint?: string }): Promise<RegionPickResult | null> => overlay.pickRegion(opts),
      },
      panel: {
        show: (targetId?: string) => windows.openPanel(targetId ?? pluginId),
        close: () => windows.closePanel(),
        isOpen: () => windows.isPanelOpen,
        toggle: () => windows.togglePanel(),
      },
      dialogs: {
        save: (opts: { title?: string; defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }) =>
          windows.withNativeDialog(() =>
            dialog.showSaveDialog(windows.panel ?? undefined!, {
              title: opts?.title ?? '保存',
              defaultPath: opts?.defaultPath,
              filters: opts?.filters,
            })
          ),
        open: (opts: { title?: string; filters?: Array<{ name: string; extensions: string[] }>; multiple?: boolean }) =>
          windows.withNativeDialog(() =>
            dialog.showOpenDialog(windows.panel ?? undefined!, {
              title: opts?.title ?? '打开',
              filters: opts?.filters,
              properties: opts?.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
            })
          ),
        directory: (title?: string) =>
          windows.withNativeDialog(() =>
            dialog.showOpenDialog(windows.panel ?? undefined!, {
              title: title ?? '选择文件夹',
              properties: ['openDirectory', 'createDirectory'],
            })
          ),
      },
      shell: {
        openPath: (target: string) => shell.openPath(String(target)),
        showItemInFolder: (target: string) => shell.showItemInFolder(String(target)),
        openExternal: (url: string) => shell.openExternal(String(url)),
      },
      clipboard: {
        writeText: (text: string) => clipboard.writeText(String(text)),
        writeImage: (filePath: string) => {
          try {
            const image = nativeImage.createFromPath(String(filePath));
            if (!image.isEmpty()) clipboard.writeImage(image);
          } catch (err) {
            logger.warn('[clipboard] 写入图片失败', err);
          }
        },
      },
      notifications: {
        show: (opts: { title: string; body?: string; icon?: string }) => {
          try {
            if (!Notification.isSupported()) return;
            new Notification({ title: opts.title, body: opts.body, icon: opts.icon }).show();
          } catch (err) {
            logger.warn('[notify] 失败', err);
          }
        },
      },
      app: {
        get version() {
          return app.getVersion();
        },
        get name() {
          return app.getName();
        },
        get locale() {
          return app.getLocale();
        },
        get platform() {
          return process.platform;
        },
        get isPackaged() {
          return app.isPackaged;
        },
        quit: () => app.quit(),
        relaunch: () => {
          app.relaunch();
          app.exit(0);
        },
        setLoginItem: (enabled: boolean) => {
          try {
            app.setLoginItemSettings({ openAtLogin: !!enabled });
          } catch {
            /* ignore */
          }
        },
      },
      electron: {
        BrowserWindow,
        screen,
        dialog,
        shell,
        clipboard,
        Notification,
        app,
        nativeImage,
        desktopCapturer,
      },
      settings: {
        get: () => settings.get(),
        get appearance() {
          return settings.get().appearance;
        },
        get capture() {
          return settings.get().capture;
        },
        get recorder() {
          return settings.get().recorder;
        },
      },
      media,
    };

    record.cleanup.push(...commandEntries);
    void contextMenus;
    return ctx;
  }

  /* ---------------------------------------------------------------- 插件窗口 */

  private async openPluginWindow(record: PluginRecord, opts: PluginWindowOptions): Promise<PluginWindowHandle> {
    const key = opts.key;
    const existing = record.windows.get(key);
    if (existing && !existing.win.isDestroyed()) {
      if (!existing.win.isVisible()) existing.win.showInactive();
      if (opts.focusOnOpen) existing.win.focus();
      return { key, id: existing.win.id };
    }
    const page = String(opts.page || 'index.html').replace(/^\/+/, '');
    const width = Math.max(80, Math.round(opts.width ?? 320));
    const height = Math.max(48, Math.round(opts.height ?? 240));
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const area = display.workArea;
    let x = Math.round(area.x + area.width - width - 18);
    let y = Math.round(area.y + 18);
    if (opts.position === 'center') {
      x = Math.round(area.x + (area.width - width) / 2);
      y = Math.round(area.y + (area.height - height) / 2);
    } else if (opts.position === 'bottom-right') {
      x = Math.round(area.x + area.width - width - 18);
      y = Math.round(area.y + area.height - height - 18);
    } else if (opts.position && typeof opts.position === 'object') {
      x = Math.round(opts.position.x);
      y = Math.round(opts.position.y);
    }
    if (typeof opts.x === 'number') x = Math.round(opts.x);
    if (typeof opts.y === 'number') y = Math.round(opts.y);

    const win = new BrowserWindow({
      width,
      height,
      x,
      y,
      frame: opts.frame === true,
      transparent: opts.transparent !== false,
      backgroundColor: '#00000000',
      resizable: opts.resizable === true,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: opts.skipTaskbar !== false,
      alwaysOnTop: opts.alwaysOnTop !== false,
      hasShadow: opts.transparent === false,
      show: false,
      focusable: opts.focusable !== false,
      title: record.manifest.name,
      webPreferences: {
        preload: path.join(this.deps.paths.preloadDir, 'plugin-window.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        additionalArguments: [`--tk-plugin-id=${record.id}`, `--tk-window-key=${key}`],
      },
    });
    if (!win.isDestroyed()) {
      try {
        win.setAlwaysOnTop(opts.alwaysOnTop !== false, 'floating');
      } catch {
        /* ignore */
      }
    }
    const entry = { win, forceClose: false, opts };
    record.windows.set(key, entry);
    this.deps.ipc.registerClient(win.webContents, { kind: 'plugin-window', pluginId: record.id, windowKey: key });

    win.once('ready-to-show', () => {
      if (win.isDestroyed() || opts.show === false) return;
      win.showInactive();
      if (opts.focusOnOpen && opts.focusable !== false) win.focus();
    });
    win.on('close', (event) => {
      if (entry.forceClose || this.quitting) return;
      if (opts.hideOnClose) {
        event.preventDefault();
        win.hide();
        this.deps.ipc.broadcastPlugin(record.id, 'window:hidden', { key });
      }
    });
    win.on('closed', () => {
      record.windows.delete(key);
      this.deps.ipc.broadcastPlugin(record.id, 'window:closed', { key });
    });
    const url = `tk://plugin/${record.id}/${page}?tkPlugin=${encodeURIComponent(record.id)}&tkWindow=${encodeURIComponent(key)}`;
    void win.loadURL(url);
    return { key, id: win.id };
  }

  private closePluginWindow(record: PluginRecord, key: string) {
    const entry = record.windows.get(key);
    if (!entry) return;
    entry.forceClose = true;
    try {
      entry.win.destroy();
    } catch {
      /* ignore */
    }
    record.windows.delete(key);
  }

  private sendToPluginWindow(record: PluginRecord, key: string, topic: string, payload?: unknown) {
    const entry = record.windows.get(key);
    if (!entry || entry.win.isDestroyed()) return;
    try {
      entry.win.webContents.send('tk:event', { topic, payload, pluginId: record.id });
    } catch {
      /* ignore */
    }
  }

  /* ---------------------------------------------------------------- IPC */

  private installIpcMain() {
    const electronIpc = require('electron').ipcMain as typeof import('electron').ipcMain;
    electronIpc.handle('tk:plugin-call', async (event, request: { pluginId: string; method: string; args?: unknown }) => {
      const meta = this.deps.ipc.getClient(event.sender.id) ?? { kind: 'panel', webContentsId: event.sender.id };
      try {
        const data = await this.call(request?.pluginId, request?.method, request?.args, meta);
        return { ok: true, data: data ?? null };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: err instanceof ToolkitError ? err.code : 'PLUGIN_ERROR',
            message: err instanceof Error ? err.message : String(err),
            detail: err instanceof Error ? err.stack : undefined,
          },
        };
      }
    });

    electronIpc.on('tk:plugin-event', (event, request: { pluginId: string; topic: string; payload?: unknown }) => {
      const meta = this.deps.ipc.getClient(event.sender.id);
      if (!request?.pluginId || !request?.topic) return;
      if (meta?.kind === 'plugin-window' && meta.pluginId !== request.pluginId) return;
      const record = this.records.get(request.pluginId);
      const handlers = record?.eventHandlers.get(String(request.topic));
      if (!handlers) return;
      for (const fn of handlers) {
        try {
          const result = (fn as (payload: unknown) => unknown)(request.payload);
          if (result && typeof (result as Promise<unknown>).then === 'function') {
            (result as Promise<unknown>).catch((err) => this.deps.logger.warn(`[${request.pluginId}] event handler error`, err));
          }
        } catch (err) {
          this.deps.logger.warn(`[${request.pluginId}] event handler error`, err);
        }
      }
    });
  }

  async call(pluginId: string, method: string, args: unknown, meta: ClientMeta): Promise<unknown> {
    const record = this.records.get(String(pluginId));
    if (!record) throw new ToolkitError('PLUGIN_NOT_FOUND', `插件不存在：${pluginId}`);
    if (!record.loaded) throw new ToolkitError('PLUGIN_NOT_LOADED', record.error || `插件未加载：${pluginId}`);
    const handler = record.ipcHandlers.get(String(method));
    if (!handler) throw new ToolkitError('METHOD_NOT_FOUND', `插件方法不存在：${method}`);
    return await handler(args, meta);
  }

  fireEvent(pluginId: string, topic: string, payload: unknown, meta: ClientMeta) {
    const record = this.records.get(String(pluginId));
    if (!record) return;
    if (meta?.kind === 'plugin-window' && meta.pluginId !== pluginId) return;
    const handlers = record.eventHandlers.get(String(topic));
    if (!handlers) return;
    for (const fn of handlers) {
      try {
        fn(payload);
      } catch (err) {
        this.deps.logger.warn(`[${pluginId}] event handler error`, err);
      }
    }
  }

  /* ---------------------------------------------------------------- 命令 */

  listCommands(): CommandInfo[] {
    const settings = this.deps.settings.get();
    const accelMap: Record<string, string> = {
      'screenshot.region': settings.shortcuts.screenshotRegion,
      'screenshot.full': settings.shortcuts.screenshotFull,
      'recorder.toggle': settings.shortcuts.recordToggle,
    };
    const hiddenMemo = settings.shortcuts.memo;
    const memoCommand = this.findCommand('memo.new');
    if (memoCommand) accelMap['memo.new'] = hiddenMemo;
    const list: CommandInfo[] = [];
    for (const record of this.records.values()) {
      if (!record.enabled || !record.loaded) continue;
      for (const entry of record.commands.values()) {
        list.push({
          id: entry.def.id,
          label: entry.def.label,
          description: entry.def.description,
          pluginId: entry.pluginId,
          pluginName: entry.pluginName,
          accelerator: accelMap[entry.def.id] || entry.def.defaultAccelerator,
          registeredAt: Date.now(),
        });
      }
    }
    return list.sort((a, b) => a.id.localeCompare(b.id));
  }

  private findCommand(id: string): CommandEntry | undefined {
    for (const record of this.records.values()) {
      const entry = record.commands.get(id);
      if (entry) return entry;
    }
    return undefined;
  }

  async runCommand(id: string, args?: unknown): Promise<unknown> {
    const entry = this.findCommand(id);
    if (!entry) throw new ToolkitError('COMMAND_NOT_FOUND', `命令不存在或插件未启用：${id}`);
    try {
      const result = await entry.run(args);
      return result ?? null;
    } catch (err) {
      this.deps.logger.error(`[commands] 执行失败 ${id}:`, err);
      throw err;
    }
  }

  onCommandsChanged(cb: () => void) {
    this.commandsChangedListeners.add(cb);
    return () => this.commandsChangedListeners.delete(cb);
  }

  /* ---------------------------------------------------------------- 列表 / 文件 */

  list(): PluginRuntimeInfo[] {
    return Array.from(this.records.values())
      .map((record) => ({
        id: record.id,
        manifest: record.manifest,
        source: record.source,
        enabled: record.enabled,
        loaded: record.loaded,
        error: record.error,
        customized: this.hasOverride(record.id),
        overriddenFiles: this.listOverrides(record.id),
        hasUI: !!this.resolveFile(record.id, record.manifest.ui || 'index.html'),
        commands: Array.from(record.commands.values()).map((c) => ({
          id: c.def.id,
          label: c.def.label,
          description: c.def.description,
          defaultAccelerator: c.def.defaultAccelerator,
        })),
      }))
      .sort((a, b) => (a.manifest.order ?? 100) - (b.manifest.order ?? 100) || a.id.localeCompare(b.id));
  }

  private hasOverride(id: string): boolean {
    const dir = path.join(this.deps.paths.overrides, id);
    try {
      return fs.statSync(dir).isDirectory() && fs.readdirSync(dir).length > 0;
    } catch {
      return false;
    }
  }

  private listOverrides(id: string): string[] {
    const root = path.join(this.deps.paths.overrides, id);
    const result: string[] = [];
    const walk = (dir: string, prefix: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name === TOMBSTONE_FILE) continue;
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
        else result.push(rel);
      }
    };
    walk(root, '');
    return result.sort();
  }

  /* ---------------------------------------------------------------- 墓碑（删除即隐藏） */

  private tombstoneFile(id: string): string {
    return path.join(this.deps.paths.overrides, id, TOMBSTONE_FILE);
  }

  /** 读取墓碑列表；不存在或损坏时返回空数组（不影响插件加载）。 */
  private readTombstones(id: string): string[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(this.tombstoneFile(id), 'utf8'));
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    const unique = new Set<string>();
    for (const item of parsed) {
      if (typeof item !== 'string') continue;
      const rel = normalizeRelPath(item);
      if (!rel || rel.includes('..')) continue;
      if (!rel.split('/').every((segment) => !!segment && segment !== '.' && segment !== '..')) continue;
      unique.add(rel);
    }
    return Array.from(unique).sort();
  }

  private isTombstoned(id: string, rel: string): boolean {
    const target = normalizeRelPath(rel);
    if (!target) return false;
    return this.readTombstones(id).includes(target);
  }

  /** 原子写入墓碑清单；列表为空时直接删除文件，避免覆盖层里留下无意义空清单。 */
  private async writeTombstones(id: string, list: string[]): Promise<void> {
    const target = this.tombstoneFile(id);
    const unique = Array.from(new Set(list.map(normalizeRelPath).filter(Boolean))).sort();
    if (!unique.length) {
      await fsp.rm(target, { force: true });
      return;
    }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp-${process.pid}`;
    await fsp.writeFile(tmp, `${JSON.stringify(unique, null, 2)}\n`, 'utf8');
    await fsp.rename(tmp, target);
  }

  private async addTombstone(id: string, rel: string): Promise<void> {
    const target = normalizeRelPath(rel);
    if (!target) return;
    const list = this.readTombstones(id);
    if (list.includes(target)) return;
    await this.writeTombstones(id, [...list, target]);
  }

  /** 移除墓碑；返回是否真的移除了。 */
  private async removeTombstone(id: string, rel: string): Promise<boolean> {
    const target = normalizeRelPath(rel);
    if (!target) return false;
    const list = this.readTombstones(id);
    if (!list.includes(target)) return false;
    await this.writeTombstones(
      id,
      list.filter((item) => item !== target)
    );
    return true;
  }

  /** 删除覆盖层文件后清理变空的父目录（不会删除覆盖层根目录）。 */
  private async pruneOverrideDirs(dir: string, stopAt: string): Promise<void> {
    let current = path.resolve(dir);
    const stop = path.resolve(stopAt);
    while (current !== stop && current.startsWith(`${stop}${path.sep}`)) {
      try {
        if (fs.readdirSync(current).length > 0) return;
        await fsp.rmdir(current);
      } catch {
        return;
      }
      current = path.dirname(current);
    }
  }

  /** 原子写入覆盖层文件（临时文件 + rename）。 */
  private async writeOverrideFile(record: PluginRecord, rel: string, content: string): Promise<void> {
    const target = path.join(record.overrideDir, rel);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp-${process.pid}`;
    await fsp.writeFile(tmp, content, 'utf8');
    await fsp.rename(tmp, target);
  }

  resolveFile(id: string, relativePath: string): string | null {
    const record = this.records.get(id);
    if (!record) return null;
    const clean = relativePath.replace(/^\/+/, '').replace(/\\/g, '/');
    if (!clean || clean.includes('..')) return null;
    // 墓碑优先：被删除的文件对插件加载 / UI 资源 / 协议请求一律不可见。
    if (this.isTombstoned(record.id, clean)) return null;
    const candidates = [path.join(record.overrideDir, clean), path.join(record.baseDir, clean)];
    for (const candidate of candidates) {
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        /* next */
      }
    }
    return null;
  }

  getUiPath(id: string): string | null {
    const record = this.records.get(id);
    if (!record) return null;
    return this.resolveFile(id, record.manifest.ui || 'index.html');
  }

  getPlugin(id: string): PluginRecord | undefined {
    return this.records.get(id);
  }

  async setEnabled(id: string, enabled: boolean): Promise<PluginRuntimeInfo[]> {
    const record = this.records.get(String(id));
    if (!record) throw new ToolkitError('PLUGIN_NOT_FOUND', `插件不存在：${id}`);
    const settings = this.deps.settings.get();
    const disabled = new Set(settings.plugins.disabled);
    if (enabled) disabled.delete(record.id);
    else disabled.add(record.id);
    this.deps.settings.patch({ plugins: { disabled: Array.from(disabled) } });
    record.enabled = enabled;
    if (enabled) await this.activate(record);
    else await this.deactivate(record);
    this.emitPluginsChanged();
    return this.list();
  }

  async reload(id: string): Promise<PluginEditResult> {
    const record = this.records.get(String(id));
    if (!record) throw new ToolkitError('PLUGIN_NOT_FOUND', `插件不存在：${id}`);
    await this.deactivate(record);
    // 重新读取 manifest（可能被用户编辑；被墓碑删除时视为缺失）
    const manifest = await this.readManifest(record.baseDir, record.id);
    if (!manifest) {
      record.manifestMissing = true;
      record.loaded = false;
      record.error =
        '插件清单 plugin.json 缺失或无效（可能已被删除），可在代码编辑器的“已删除文件”中恢复';
      this.emitPluginsChanged();
      this.deps.ipc.broadcast('plugin:reloaded', { pluginId: record.id });
      return { ok: false, error: { code: 'PLUGIN_MANIFEST_MISSING', message: record.error } };
    }
    record.manifest = manifest;
    record.manifestMissing = false;
    if (record.enabled) await this.activate(record);
    this.emitPluginsChanged();
    this.deps.ipc.broadcast('plugin:reloaded', { pluginId: record.id });
    return { ok: !record.error, error: record.error ? { code: 'PLUGIN_ERROR', message: record.error } : undefined };
  }

  async files(id: string): Promise<PluginFilesPayload> {
    const record = this.records.get(String(id));
    if (!record) throw new ToolkitError('PLUGIN_NOT_FOUND', `插件不存在：${id}`);
    const tombstones = new Set(this.readTombstones(record.id));
    // 只把“基座文件确实还存在”的墓碑列为可恢复项，过滤历史遗留的失效记录
    const deletedFiles: string[] = [];
    for (const rel of tombstones) {
      try {
        if (fs.statSync(path.join(record.baseDir, rel)).isFile()) deletedFiles.push(rel);
      } catch {
        /* 基座已不存在：失效墓碑，忽略 */
      }
    }
    const files = new Map<string, PluginFileEntry>();
    const collect = (dir: string, prefix = '') => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          collect(path.join(dir, entry.name), rel);
        } else {
          if (tombstones.has(rel)) continue;
          const ext = path.extname(entry.name).toLowerCase();
          const stat = fs.statSync(path.join(dir, entry.name));
          files.set(rel, {
            path: rel,
            size: stat.size,
            overridden: fs.existsSync(path.join(record.overrideDir, rel)),
            editable: TEXT_EXT.has(ext) && stat.size <= MAX_EDIT_BYTES,
            language: languageOfExt(ext),
          });
        }
      }
    };
    collect(record.baseDir);
    // 只存在于覆盖层的文件（用户在编辑器里新建 / 覆盖后基座已不存在的文件）
    for (const rel of this.listOverrides(record.id)) {
      if (tombstones.has(rel)) continue;
      if (files.has(rel)) continue;
      const full = path.join(record.overrideDir, rel);
      const fullStat = (() => {
        try {
          return fs.statSync(full);
        } catch {
          return null;
        }
      })();
      if (!fullStat) continue;
      const ext = path.extname(rel).toLowerCase();
      const baseExists = fs.existsSync(path.join(record.baseDir, rel));
      files.set(rel, {
        path: rel,
        size: fullStat.size,
        overridden: true,
        // 覆盖层文件由编辑器写入，必然是文本；基座同名文件若扩展名未知则保守地只读
        editable: (TEXT_EXT.has(ext) || !baseExists) && fullStat.size <= MAX_EDIT_BYTES,
        language: languageOfExt(ext),
      });
    }
    return {
      id: record.id,
      manifest: record.manifest,
      files: Array.from(files.values()).sort((a, b) => a.path.localeCompare(b.path)),
      deletedFiles,
      baseDir: record.baseDir,
      overrideDir: record.overrideDir,
      customized: this.hasOverride(record.id),
    };
  }

  async readFile(id: string, rel: string): Promise<{ content: string; overridden: boolean; baseContent?: string }> {
    const record = this.records.get(String(id));
    if (!record) throw new ToolkitError('PLUGIN_NOT_FOUND', `插件不存在：${id}`);
    const safeRel = normalizeRelPath(rel);
    if (!safeRel || safeRel.includes('..')) throw new ToolkitError('BAD_PATH', '非法文件路径');
    if (this.isTombstoned(record.id, safeRel)) {
      throw new ToolkitError('FILE_DELETED', `文件已被删除：${safeRel}（可在“已删除文件”中恢复）`);
    }
    const overridePath = path.join(record.overrideDir, safeRel);
    const basePath = path.join(record.baseDir, safeRel);
    const read = async (file: string): Promise<string | null> => {
      try {
        const stat = await fsp.stat(file);
        if (!stat.isFile() || stat.size > MAX_EDIT_BYTES) return null;
        return await fsp.readFile(file, 'utf8');
      } catch {
        return null;
      }
    };
    const overridden = await read(overridePath);
    const baseContent = await read(basePath);
    const content = overridden ?? baseContent;
    if (content === null) throw new ToolkitError('FILE_NOT_FOUND', `文件不存在：${rel}`);
    return { content, overridden: overridden !== null, baseContent: baseContent ?? undefined };
  }

  async writeFile(id: string, rel: string, content: string): Promise<PluginEditResult> {
    const record = this.records.get(String(id));
    if (!record) throw new ToolkitError('PLUGIN_NOT_FOUND', `插件不存在：${id}`);
    const safeRel = String(rel || '').replace(/^\/+/, '').replace(/\\/g, '/');
    if (!safeRel || safeRel.includes('..')) throw new ToolkitError('BAD_PATH', '非法文件路径');
    if (Buffer.byteLength(content, 'utf8') > MAX_EDIT_BYTES) throw new ToolkitError('TOO_LARGE', '文件过大（>2MB）');
    const error = this.validateCode(safeRel, content);
    if (error) {
      return { ok: false, error: { code: 'SYNTAX', message: error } };
    }
    await this.backupOverride(record.id);
    // 写入即视为重新创建：清除该路径的墓碑，让文件重新可见
    await this.removeTombstone(record.id, safeRel);
    await this.writeOverrideFile(record, safeRel, content);
    record.manifest = (await this.readManifest(record.baseDir, record.id)) ?? record.manifest;
    const reload = record.enabled ? await this.reload(record.id) : { ok: false };
    this.emitPluginsChanged();
    return { ok: true, reloaded: record.loaded, error: reload.error };
  }

  /**
   * 新建文件（写入覆盖层，不修改内置基座）。
   * - 路径相对插件目录，支持子目录；content 为空时按扩展名生成最小模板；
   * - 目标已存在（覆盖层或未墓碑的基座文件）时抛 FILE_EXISTS；
   * - 成功后热重载插件（与保存行为一致）。
   */
  async createFile(id: string, relPath: string, content?: string): Promise<PluginEditResult> {
    const record = this.records.get(String(id));
    if (!record) throw new ToolkitError('PLUGIN_NOT_FOUND', `插件不存在：${id}`);
    const safeRel = assertCreatableRelPath(relPath);
    const tombstoned = this.isTombstoned(record.id, safeRel);
    // 已被墓碑删除的路径允许“重新创建”（覆盖层文件重新可见）
    if (!tombstoned && this.resolveFile(record.id, safeRel)) {
      throw new ToolkitError('FILE_EXISTS', `文件已存在：${safeRel}`);
    }
    const finalContent = typeof content === 'string' && content.length > 0 ? content : textTemplateFor(safeRel);
    if (Buffer.byteLength(finalContent, 'utf8') > MAX_EDIT_BYTES) throw new ToolkitError('TOO_LARGE', '文件过大（>2MB）');
    const syntax = this.validateCode(safeRel, finalContent);
    if (syntax) return { ok: false, error: { code: 'SYNTAX', message: syntax } };
    await this.backupOverride(record.id);
    await this.writeOverrideFile(record, safeRel, finalContent);
    await this.removeTombstone(record.id, safeRel);
    record.manifest = (await this.readManifest(record.baseDir, record.id)) ?? record.manifest;
    const reload = record.enabled ? await this.reload(record.id) : { ok: false };
    this.emitPluginsChanged();
    return { ok: true, reloaded: record.loaded, error: reload.error };
  }

  /**
   * 删除文件：
   * - 覆盖层存在同名文件 → 删除覆盖层文件（内置基座版本恢复可见；新建文件则彻底删除）；
   * - 否则基座文件存在 → 写入墓碑（隐藏，可从“已删除文件”恢复）；
   * - 二者都不存在（或已墓碑）→ FILE_NOT_FOUND。
   * 删除导致插件加载失败时不回滚用户操作，只在结果 error 里带回加载错误。
   */
  async deleteFile(id: string, relPath: string): Promise<PluginEditResult> {
    const record = this.records.get(String(id));
    if (!record) throw new ToolkitError('PLUGIN_NOT_FOUND', `插件不存在：${id}`);
    const safeRel = normalizeRelPath(relPath);
    if (!safeRel || safeRel.includes('..')) throw new ToolkitError('BAD_PATH', '非法文件路径');
    const overridePath = path.join(record.overrideDir, safeRel);
    const basePath = path.join(record.baseDir, safeRel);
    const isFile = (file: string) => {
      try {
        return fs.statSync(file).isFile();
      } catch {
        return false;
      }
    };
    const tombstoned = this.isTombstoned(record.id, safeRel);
    if (!tombstoned && isFile(overridePath)) {
      await this.backupOverride(record.id);
      await fsp.rm(overridePath, { force: true });
      await this.pruneOverrideDirs(path.dirname(overridePath), record.overrideDir);
      const reload = record.enabled ? await this.reload(record.id) : { ok: false };
      this.emitPluginsChanged();
      return { ok: true, reloaded: record.loaded, error: reload.error };
    }
    if (!tombstoned && isFile(basePath)) {
      await this.backupOverride(record.id);
      await this.addTombstone(record.id, safeRel);
      const reload = record.enabled ? await this.reload(record.id) : { ok: false };
      this.emitPluginsChanged();
      return { ok: true, reloaded: record.loaded, error: reload.error };
    }
    throw new ToolkitError(
      'FILE_NOT_FOUND',
      tombstoned ? `文件已被删除：${safeRel}（可从“已删除文件”恢复）` : `文件不存在：${safeRel}`
    );
  }

  /** 恢复被墓碑删除的文件（从墓碑清单移除并热重载）。 */
  async restoreDeletedFile(id: string, relPath: string): Promise<PluginEditResult> {
    const record = this.records.get(String(id));
    if (!record) throw new ToolkitError('PLUGIN_NOT_FOUND', `插件不存在：${id}`);
    const safeRel = normalizeRelPath(relPath);
    if (!safeRel || safeRel.includes('..')) throw new ToolkitError('BAD_PATH', '非法文件路径');
    const removed = await this.removeTombstone(record.id, safeRel);
    if (!removed) throw new ToolkitError('FILE_NOT_FOUND', `没有该文件的删除记录：${safeRel}`);
    const reload = record.enabled ? await this.reload(record.id) : { ok: false };
    this.emitPluginsChanged();
    return { ok: true, reloaded: record.loaded, error: reload.error };
  }

  private validateCode(rel: string, content: string): string | null {
    const ext = path.extname(rel).toLowerCase();
    try {
      if (ext === '.json') {
        JSON.parse(content);
      } else if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
        acorn.parse(content, {
          ecmaVersion: 'latest',
          sourceType: 'module',
          allowAwaitOutsideFunction: true,
          allowReturnOutsideFunction: false,
        });
      }
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `语法错误：${message}`;
    }
  }

  private async backupOverride(id: string) {
    if (!this.deps.settings.get().data.autoBackup) return;
    const source = path.join(this.deps.paths.overrides, id);
    if (!fs.existsSync(source)) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(this.deps.paths.backups, id, stamp);
    try {
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.cp(source, target, { recursive: true });
    } catch (err) {
      this.deps.logger.warn('[plugins] 备份覆盖层失败', err);
    }
  }

  async restore(id: string, rel?: string): Promise<PluginEditResult> {
    const record = this.records.get(String(id));
    if (!record) throw new ToolkitError('PLUGIN_NOT_FOUND', `插件不存在：${id}`);
    const overrideDir = record.overrideDir;
    const target = rel ? path.join(overrideDir, String(rel)) : overrideDir;
    try {
      await fsp.rm(target, { recursive: true, force: true });
      // 单文件恢复时同时清除该文件的墓碑（整体恢复会连 .deleted.json 一起删除）
      if (rel) await this.removeTombstone(record.id, String(rel));
    } catch (err) {
      throw new ToolkitError('RESTORE_FAILED', `恢复失败：${err instanceof Error ? err.message : String(err)}`);
    }
    const reload = record.enabled ? await this.reload(record.id) : { ok: false };
    this.emitPluginsChanged();
    return { ok: true, reloaded: record.loaded, error: reload.error };
  }

  async createPlugin(opts: { id: string; name: string; description?: string }): Promise<PluginRuntimeInfo> {
    const id = String(opts?.id || '').trim().toLowerCase();
    if (!ID_RE.test(id)) throw new ToolkitError('BAD_ID', '插件 ID 需为 2-32 位小写字母/数字/连字符，字母开头');
    const name = String(opts?.name || id).slice(0, 40);
    if (this.records.has(id)) throw new ToolkitError('PLUGIN_EXISTS', `插件 ID 已存在：${id}`);
    const dir = path.join(this.deps.paths.plugins, id);
    if (fs.existsSync(dir)) throw new ToolkitError('PLUGIN_EXISTS', `目录已存在：${dir}`);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(
      path.join(dir, 'plugin.json'),
      JSON.stringify(
        {
          id,
          name,
          description: opts.description || '自定义工具',
          version: '1.0.0',
          order: 90,
          entry: 'main.js',
          ui: 'index.html',
        },
        null,
        2
      ),
      'utf8'
    );
    await fsp.writeFile(
      path.join(dir, 'main.js'),
      `/** 自定义插件：${name} */\nexport default {\n  activate(ctx) {\n    ctx.ipc.handle('ping', async () => 'pong');\n  },\n  deactivate() {}\n};\n`,
      'utf8'
    );
    await fsp.writeFile(
      path.join(dir, 'index.html'),
      `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<link rel="stylesheet" href="tk://plugin-sdk/theme.css" />
</head>
<body>
  <div class="tk-page tk-scroll">
    <div class="tk-header"><div><h2 class="tk-title">${name}</h2><p class="tk-sub">自定义插件</p></div></div>
    <div class="tk-card"><p class="tk-hint">在设置 → 扩展 → 代码编辑 中修改本插件。</p></div>
    <button class="tk-btn primary" id="ping">测试连接</button>
  </div>
  <script src="tk://plugin-sdk/sdk.js"></script>
  <script src="app.js" type="module"></script>
</body>
</html>`,
      'utf8'
    );
    await fsp.writeFile(
      path.join(dir, 'app.js'),
      `await toolkit.ready();\ndocument.getElementById('ping').addEventListener('click', async () => {\n  toolkit.toast(await toolkit.invoke('ping'));\n});\n`,
      'utf8'
    );
    await fsp.writeFile(path.join(dir, 'style.css'), `/* ${name} 样式 */\n`, 'utf8');
    await fsp.writeFile(
      path.join(dir, 'icon.svg'),
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#8fb6ff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="9"/></svg>`,
      'utf8'
    );
    await this.discover();
    const record = this.records.get(id);
    if (record) await this.activate(record);
    this.emitPluginsChanged();
    return this.list().find((p) => p.id === id)!;
  }

  async deletePlugin(id: string): Promise<boolean> {
    const record = this.records.get(String(id));
    if (!record) throw new ToolkitError('PLUGIN_NOT_FOUND', `插件不存在：${id}`);
    if (record.source !== 'user') throw new ToolkitError('BUILTIN', '内置插件不可删除，只能禁用或恢复默认');
    await this.deactivate(record);
    await fsp.rm(record.baseDir, { recursive: true, force: true });
    await fsp.rm(record.overrideDir, { recursive: true, force: true });
    this.records.delete(record.id);
    this.emitPluginsChanged();
    return true;
  }

  async importPlugin(): Promise<PluginRuntimeInfo | null> {
    const result = await this.deps.windows.withNativeDialog(() =>
      dialog.showOpenDialog(this.deps.windows.panel ?? undefined!, {
        title: '选择插件目录（包含 plugin.json）',
        properties: ['openDirectory'],
      })
    );
    if (result.canceled || !result.filePaths[0]) return null;
    const sourceDir = result.filePaths[0];
    const manifest = await this.readManifest(sourceDir);
    if (!manifest) throw new ToolkitError('IMPORT_FAILED', '所选目录缺少有效的 plugin.json');
    const target = path.join(this.deps.paths.plugins, manifest.id);
    if (fs.existsSync(target)) throw new ToolkitError('PLUGIN_EXISTS', `插件已存在：${manifest.id}`);
    await fsp.cp(sourceDir, target, { recursive: true });
    await this.discover();
    const record = this.records.get(manifest.id);
    if (record) await this.activate(record);
    this.emitPluginsChanged();
    return this.list().find((p) => p.id === manifest.id) ?? null;
  }

  openPluginDir(id: string) {
    const record = this.records.get(String(id));
    if (!record) throw new ToolkitError('PLUGIN_NOT_FOUND', `插件不存在：${id}`);
    const target = record.source === 'builtin' ? record.overrideDir : record.baseDir;
    fs.mkdirSync(target, { recursive: true });
    void shell.openPath(target);
  }

  /** 在插件 UI 崩溃/热重载后通知面板刷新 iframe */
  notifyUiReload(pluginId: string) {
    this.deps.ipc.broadcast('plugin:reloaded', { pluginId });
  }
}





