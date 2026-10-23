import { app, dialog, shell } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { AppInfo, AppPaths, Settings, SettingsPatch, ThemeTokens } from '../../shared/types';
import type { IpcHub } from './ipc';
import type { Logger } from './logger';
import type { SettingsService } from './settings';
import type { WindowManager } from './windows';
import type { OverlayManager } from './overlay';
import type { PluginHost } from './plugin-host';
import type { ShortcutManager } from './shortcuts';
import type { WallpaperService } from './wallpapers';
import type { ThemeService } from './themes';
import { ToolkitError } from './errors';

export interface CoreServiceDeps {
  paths: AppPaths;
  logger: Logger;
  settings: SettingsService;
  ipc: IpcHub;
  windows: WindowManager;
  overlay: OverlayManager;
  plugins: PluginHost;
  shortcuts: ShortcutManager;
  wallpapers: WallpaperService;
  themes: ThemeService;
}

export class CoreService {
  constructor(private deps: CoreServiceDeps) {}

  register() {
    const { ipc, settings, plugins, windows, shortcuts, paths } = this.deps;

    ipc.handle('core', 'settings.get', () => settings.get());
    ipc.handle('core', 'settings.patch', (args) => {
      if (!args || typeof args !== 'object') throw new ToolkitError('BAD_ARGS', '缺少设置内容');
      return settings.patch(args as SettingsPatch);
    });
    ipc.handle('core', 'settings.reset', (args) => {
      const section = (args as { section?: keyof Settings } | undefined)?.section;
      return settings.reset(section);
    });
    ipc.handle('core', 'settings.export', () =>
      windows.withNativeDialog(async () => {
        const result = await dialog.showSaveDialog(windows.panel ?? undefined!, {
          title: '导出设置',
          defaultPath: path.join(app.getPath('documents'), '便捷工具设置.json'),
          filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (result.canceled || !result.filePath) return null;
        await fsp.writeFile(result.filePath, JSON.stringify(settings.get(), null, 2), 'utf8');
        return result.filePath;
      })
    );
    ipc.handle('core', 'settings.import', () =>
      windows.withNativeDialog(async () => {
        const result = await dialog.showOpenDialog(windows.panel ?? undefined!, {
          title: '导入设置',
          properties: ['openFile'],
          filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (result.canceled || !result.filePaths[0]) return null;
        const raw = JSON.parse(await fsp.readFile(result.filePaths[0], 'utf8')) as Settings;
        return settings.replace(raw);
      })
    );
    ipc.handle('core', 'settings.pickDir', (args) =>
      windows.withNativeDialog(async () => {
        const kind = (args as { kind?: string })?.kind;
        const result = await dialog.showOpenDialog(windows.panel ?? undefined!, {
          title: kind === 'recorder' ? '选择录制保存目录' : '选择截图保存目录',
          properties: ['openDirectory', 'createDirectory'],
        });
        if (result.canceled || !result.filePaths[0]) return null;
        const section = kind === 'recorder' ? 'recorder' : 'capture';
        settings.patch({ [section]: { saveDir: result.filePaths[0] } } as SettingsPatch);
        return result.filePaths[0];
      })
    );

    ipc.handle('core', 'app.info', (): AppInfo => ({
      name: '便捷工具',
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      locale: app.getLocale(),
      isPackaged: app.isPackaged,
      paths,
    }));
    ipc.handle('core', 'app.openPath', (args) => {
      const kind = String((args as { kind?: string })?.kind ?? 'userData');
      const map: Record<string, string> = {
        userData: paths.userData,
        screenshots: settings.get().capture.saveDir || paths.screenshots,
        recordings: settings.get().recorder.saveDir || paths.recordings,
        plugins: paths.plugins,
        overrides: paths.overrides,
        wallpapers: path.join(paths.userData, 'wallpapers'),
        logs: paths.logs,
        backups: paths.backups,
        resources: paths.resourcesDir,
      };
      const target = map[kind];
      if (!target) throw new ToolkitError('BAD_ARGS', `未知路径：${kind}`);
      fs.mkdirSync(target, { recursive: true });
      return shell.openPath(target);
    });
    ipc.handle('core', 'app.quit', () => {
      app.quit();
      return true;
    });
    ipc.handle('core', 'app.relaunch', () => {
      app.relaunch();
      app.exit(0);
      return true;
    });
    ipc.handle('core', 'app.setLoginItem', (args) => {
      const enabled = !!(args as { enabled?: boolean })?.enabled;
      app.setLoginItemSettings({
        openAtLogin: enabled,
        path: process.execPath,
        args: app.isPackaged ? [] : [paths.appRoot],
      });
      return enabled;
    });
    ipc.handle('core', 'app.openExternal', (args) => {
      const url = String((args as { url?: string })?.url ?? '');
      if (!/^https?:/i.test(url)) throw new ToolkitError('BAD_ARGS', '仅支持 http/https 链接');
      return shell.openExternal(url);
    });

    ipc.handle('core', 'panel.open', (args) => {
      const pluginId = (args as { pluginId?: string } | undefined)?.pluginId;
      windows.openPanel(pluginId);
      return true;
    });
    ipc.handle('core', 'panel.toggle', () => {
      windows.togglePanel();
      return true;
    });

    ipc.handle('core', 'plugin.call', (args) => {
      const request = args as { pluginId?: string; method?: string; args?: unknown };
      if (!request?.pluginId || !request?.method) throw new ToolkitError('BAD_ARGS', '插件调用参数缺失');
      return plugins.call(request.pluginId, request.method, request.args, {
        kind: 'panel',
        webContentsId: -1,
      });
    });

    ipc.handle('plugin', 'call', (args) => {
      const request = args as { pluginId?: string; method?: string; args?: unknown };
      if (!request?.pluginId || !request?.method) throw new ToolkitError('BAD_ARGS', '插件调用参数缺失');
      return plugins.call(request.pluginId, request.method, request.args, { kind: 'panel', webContentsId: -1 });
    });

    ipc.handle('core', 'plugins.list', () => plugins.list());
    ipc.handle('core', 'plugins.setEnabled', (args) => {
      const request = args as { id?: string; enabled?: boolean };
      if (!request?.id) throw new ToolkitError('BAD_ARGS', '缺少插件 ID');
      return plugins.setEnabled(request.id, !!request.enabled);
    });
    ipc.handle('core', 'plugins.reload', (args) => {
      const id = String((args as { id?: string })?.id ?? '');
      return plugins.reload(id);
    });
    ipc.handle('core', 'plugins.files', (args) => plugins.files(String((args as { id?: string })?.id ?? '')));
    ipc.handle('core', 'plugins.readFile', (args) => {
      const request = args as { id?: string; path?: string };
      return plugins.readFile(String(request?.id ?? ''), String(request?.path ?? ''));
    });
    ipc.handle('core', 'plugins.writeFile', (args) => {
      const request = args as { id?: string; path?: string; content?: string };
      return plugins.writeFile(String(request?.id ?? ''), String(request?.path ?? ''), String(request?.content ?? ''));
    });
    ipc.handle('core', 'plugins.restore', (args) => {
      const request = args as { id?: string; path?: string };
      return plugins.restore(String(request?.id ?? ''), request?.path);
    });
    ipc.handle('core', 'plugins.create', (args) => {
      const request = args as { id?: string; name?: string; description?: string };
      return plugins.createPlugin({
        id: String(request?.id ?? ''),
        name: String(request?.name ?? ''),
        description: request?.description,
      });
    });
    ipc.handle('core', 'plugins.delete', (args) => plugins.deletePlugin(String((args as { id?: string })?.id ?? '')));
    ipc.handle('core', 'plugins.import', () => plugins.importPlugin());
    ipc.handle('core', 'plugins.openDir', (args) => {
      plugins.openPluginDir(String((args as { id?: string })?.id ?? ''));
      return true;
    });
    ipc.handle('core', 'plugins.acceptHMR', () => true);

    ipc.handle('core', 'commands.list', () => plugins.listCommands());
    ipc.handle('core', 'commands.run', (args) => {
      const request = args as { id?: string; args?: unknown };
      return plugins.runCommand(String(request?.id ?? ''), request?.args);
    });
    ipc.handle('core', 'shortcuts.status', () => shortcuts.getStatus());

    ipc.handle('core', 'ball.getVisible', () => !!windows.ball?.isVisible());
    ipc.handle('core', 'ball.setVisible', (args) => {
      const visible = !!(args as { visible?: boolean })?.visible;
      windows.setBallVisible(visible);
      settings.patch({ general: { showBall: visible } });
      return visible;
    });

    ipc.handle('core', 'shell.openPath', (args) => {
      const target = String((args as { path?: string })?.path ?? '');
      if (!target) throw new ToolkitError('BAD_ARGS', '缺少路径');
      return shell.openPath(target);
    });
    ipc.handle('core', 'shell.showItemInFolder', (args) => {
      const target = String((args as { path?: string })?.path ?? '');
      if (!target) throw new ToolkitError('BAD_ARGS', '缺少路径');
      shell.showItemInFolder(target);
      return true;
    });
    ipc.handle('core', 'shell.openExternal', (args) => {
      const url = String((args as { url?: string })?.url ?? '');
      if (!/^https?:/i.test(url)) throw new ToolkitError('BAD_ARGS', '仅支持 http/https 链接');
      return shell.openExternal(url);
    });

    ipc.handle('core', 'log.renderer', (args) => {
      const request = args as { pluginId?: string; level?: string; message?: string; stack?: string };
      const scope = request?.pluginId ? `plugin:${request.pluginId}` : 'renderer';
      const message = `${request?.message ?? ''}${request?.stack ? `\n${request.stack}` : ''}`;
      const logger = this.deps.logger;
      if (request?.level === 'warn') logger.warn(`[${scope}]`, message);
      else if (request?.level === 'info') logger.info(`[${scope}]`, message);
      else logger.error(`[${scope}]`, message);
      return true;
    });

    /* ---------------------------------------------------------- 个性化 */

    ipc.handle('core', 'wallpapers.list', () => this.deps.wallpapers.list());
    ipc.handle('core', 'wallpapers.current', () => this.deps.wallpapers.current());
    ipc.handle('core', 'wallpapers.import', () => this.deps.wallpapers.importFromDialog());
    ipc.handle('core', 'wallpapers.download', (args) => {
      const request = args as { url?: string; name?: string };
      if (!request?.url) throw new ToolkitError('BAD_ARGS', '缺少壁纸下载地址');
      return this.deps.wallpapers.download(request.url, request.name);
    });
    ipc.handle('core', 'wallpapers.apply', (args) => {
      const request = args as { selector?: string; opacity?: number };
      return this.deps.wallpapers.apply(String(request?.selector ?? ''), request?.opacity);
    });
    ipc.handle('core', 'wallpapers.remove', (args) => {
      const request = args as { selector?: string };
      return this.deps.wallpapers.remove(String(request?.selector ?? ''));
    });
    ipc.handle('core', 'wallpapers.setDesktop', (args) => {
      const request = args as { selector?: string };
      return this.deps.wallpapers.setDesktop(String(request?.selector ?? ''));
    });

    ipc.handle('core', 'themes.list', () => this.deps.themes.list());
    ipc.handle('core', 'themes.apply', (args) => {
      const id = String((args as { id?: string })?.id ?? '');
      const theme = this.deps.themes.get(id);
      if (!theme) throw new ToolkitError('THEME_NOT_FOUND', `主题不存在：${id}`);
      return this.deps.settings.patch({
        appearance: {
          accent: theme.tokens.accent,
          panelOpacity: theme.tokens.panelOpacity,
          blur: theme.tokens.blur,
          animation: theme.tokens.animation,
          wallpaper: theme.tokens.wallpaper,
          wallpaperOpacity: theme.tokens.wallpaperOpacity,
          ballEdgeHide: theme.tokens.ballEdgeHide,
          showDock: theme.tokens.showDock,
        },
      });
    });
    ipc.handle('core', 'themes.save', (args) => {
      const request = args as { name?: string; tokens?: ThemeTokens };
      const name = String(request?.name ?? '').trim();
      if (!name) throw new ToolkitError('BAD_ARGS', '缺少主题名称');
      const tokens: ThemeTokens =
        request?.tokens ?? {
          accent: this.deps.settings.get().appearance.accent,
          panelOpacity: this.deps.settings.get().appearance.panelOpacity,
          blur: this.deps.settings.get().appearance.blur,
          animation: this.deps.settings.get().appearance.animation,
          wallpaper: this.deps.settings.get().appearance.wallpaper,
          wallpaperOpacity: this.deps.settings.get().appearance.wallpaperOpacity,
          ballEdgeHide: this.deps.settings.get().appearance.ballEdgeHide,
          showDock: this.deps.settings.get().appearance.showDock,
        };
      return this.deps.themes.save(name, tokens);
    });
    ipc.handle('core', 'themes.delete', (args) => {
      const id = String((args as { id?: string })?.id ?? '');
      return this.deps.themes.delete(id);
    });

    /* ---------------------------------------------------------- 编辑器文件自由化 */

    ipc.handle('core', 'plugins.createFile', (args) => {
      const request = args as { id?: string; path?: string; content?: string };
      return this.deps.plugins.createFile(String(request?.id ?? ''), String(request?.path ?? ''), request?.content);
    });
    ipc.handle('core', 'plugins.deleteFile', (args) => {
      const request = args as { id?: string; path?: string };
      return this.deps.plugins.deleteFile(String(request?.id ?? ''), String(request?.path ?? ''));
    });
    ipc.handle('core', 'plugins.restoreDeleted', (args) => {
      const request = args as { id?: string; path?: string };
      return this.deps.plugins.restoreDeletedFile(String(request?.id ?? ''), String(request?.path ?? ''));
    });

    ipc.handle('core', 'overlay.pickRegion', () => this.deps.overlay.pickRegion());
  }
}





