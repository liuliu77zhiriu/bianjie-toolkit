import { app, BrowserWindow, Notification, clipboard, desktopCapturer, dialog, ipcMain, nativeImage, net, powerSaveBlocker, screen, session, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { APP_ID } from '../shared/defaults';
import { buildPaths } from './core/paths';
import { Logger, setPackagedFlag } from './core/logger';
import { SettingsService } from './core/settings';
import { IpcHub } from './core/ipc';
import { WindowManager } from './core/windows';
import { OverlayManager } from './core/overlay';
import { PluginHost } from './core/plugin-host';
import { ShortcutManager } from './core/shortcuts';
import { TrayManager } from './core/tray';
import { CoreService } from './core/core-service';
import { TkProtocol, registerScheme } from './core/protocol';
import { SettingsWindowManager } from './core/settings-window';
import { WallpaperService } from './core/wallpapers';
import { ThemeService } from './core/themes';
import { UIEditorService } from './core/uieditor/service';
import { UIEditorWindowManager } from './core/uieditor/window';
import { SearchService } from './core/search/search-service';
import { DownloadService } from './core/search/download-service';
import { SearchWindowManager } from './core/search/window';
import { createMediaApi } from './core/media';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

registerScheme();
setPackagedFlag(app.isPackaged);

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_ID);
}

const appRoot = app.isPackaged ? app.getAppPath() : path.resolve(__dirname, '../..');
const pathsRef = buildPaths(appRoot);

let logger: Logger;
let settings: SettingsService;
let ipc: IpcHub;
let windows: WindowManager;
let overlay: OverlayManager;
let plugins: PluginHost;
let shortcuts: ShortcutManager;
let tray: TrayManager;
let protocol: TkProtocol;
let media: ReturnType<typeof createMediaApi>;
let settingsWindow: SettingsWindowManager;
let wallpapers: WallpaperService;
let themes: ThemeService;
let uieditor: UIEditorService;
let uieditorWindow: UIEditorWindowManager;
let search: SearchService;
let downloads: DownloadService;
let searchWindow: SearchWindowManager;
let quitting = false;

function notify(opts: { title: string; body?: string }) {
  try {
    if (!Notification.isSupported()) return;
    const icon = path.join(pathsRef.resourcesDir, 'icons', 'app.png');
    new Notification({ title: opts.title, body: opts.body, icon: fs.existsSync(icon) ? icon : undefined }).show();
  } catch (err) {
    logger?.warn('[notify] 失败', err);
  }
}

function applyAutostart(enabled: boolean) {
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: [] });
  } catch (err) {
    logger?.warn('[autostart] 设置失败', err);
  }
}

async function bootstrap() {
  logger = new Logger(pathsRef.logs);
  logger.info('==============================================');
  logger.info(`便捷工具启动 v${app.getVersion()} electron=${process.versions.electron} node=${process.versions.node}`);
  logger.info(`appRoot=${appRoot} userData=${pathsRef.userData}`);

  settings = new SettingsService(pathsRef, logger);
  ipc = new IpcHub(logger);
  ipc.installIpcMain(async (request, meta) => {
    const { service, method, args } = request ?? {};
    if (!service || !method) return { ok: false, error: { code: 'BAD_REQUEST', message: '非法请求' } };
    return ipc.call(String(service), String(method), args, meta);
  });

  protocol = new TkProtocol(pathsRef, logger);
  protocol.install();

  windows = new WindowManager({
    paths: pathsRef,
    logger,
    ipc,
    settings: settings.get(),
    openSettingsWindow: (tab) => settingsWindow.open(tab),
    menuActions: {
      openPanel: () => windows.openPanel(),
      runCommand: (id) => {
        void plugins.runCommand(id).catch((err) => logger.warn('[menu] 命令失败', id, err));
      },
      openSettings: () => settingsWindow.open('general'),
      toggleBall: (visible) => {
        windows.setBallVisible(visible);
        settings.patch({ general: { showBall: visible } });
      },
      quit: () => app.quit(),
    },
  });

  settingsWindow = new SettingsWindowManager({
    paths: { preloadDir: pathsRef.preloadDir },
    logger,
    ipc,
    getSettings: () => settings.get(),
    getReferenceWindow: () => windows.panel ?? windows.ball,
  });
  settingsWindow.registerIpc();

  wallpapers = new WallpaperService({
    paths: pathsRef,
    logger,
    settings,
    getParentWindow: () => settingsWindow.win ?? windows.panel ?? null,
  });
  themes = new ThemeService(pathsRef, logger);
  uieditor = new UIEditorService({
    paths: pathsRef,
    logger,
    getParentWindow: () => uieditorWindow?.win ?? windows.panel ?? windows.ball,
    reloadPlugins: async () => {
      await plugins.restart();
    },
  });
  uieditorWindow = new UIEditorWindowManager({
    paths: { preloadDir: pathsRef.preloadDir },
    logger,
    ipc,
    getReferenceWindow: () => windows.panel ?? windows.ball,
  });
  uieditorWindow.registerIpc();

  const searchSaveDir = path.join(app.getPath('downloads'), '流光搜索');
  fs.mkdirSync(searchSaveDir, { recursive: true });
  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => net.fetch(input as never, init as never)) as typeof fetch;
  search = new SearchService({
    paths: pathsRef,
    logger,
    fetchImpl,
    broadcast: (topic, payload) => ipc.broadcast(topic, payload),
  });
  await search.init();
  if (!search.getSettings().saveDir) {
    search.patchSettings({ saveDir: searchSaveDir });
  }
  downloads = new DownloadService({
    paths: pathsRef,
    logger,
    fetchImpl,
    getSaveDir: () => search.getSettings().saveDir || searchSaveDir,
    getConcurrency: () => search.getSettings().concurrentDownloads,
    broadcast: (topic, payload) => ipc.broadcast(topic, payload),
    openFile: (filePath) => shell.openPath(filePath),
    openFolder: (dir) => shell.openPath(dir),
  });
  await downloads.init();
  searchWindow = new SearchWindowManager({
    paths: { preloadDir: pathsRef.preloadDir, resourcesDir: pathsRef.resourcesDir },
    logger,
    ipc,
    getReferenceWindow: () => windows.panel ?? windows.ball,
  });
  searchWindow.registerIpc();

  overlay = new OverlayManager({
    paths: pathsRef,
    ipc,
    logger,
    hidePanel: () => windows.hidePanelImmediate(),
  });

  media = createMediaApi({
    settings: {
      get: () => settings.get(),
      onChange: (cb) => {
        const handler = (next: unknown) => cb(next as ReturnType<SettingsService['get']>);
        settings.on('change', handler);
        return () => settings.off('change', handler);
      },
    },
    paths: pathsRef,
    log: logger,
    notify,
    electron: {
      app,
      BrowserWindow,
      desktopCapturer,
      screen,
      nativeImage,
      clipboard,
      dialog,
      shell,
      Notification,
      session,
      ipcMain,
      powerSaveBlocker,
    } as unknown as typeof import('electron'),
    hidePanel: () => windows.hidePanelImmediate(),
    showPanel: async () => {
      windows.openPanel();
    },
  });

  plugins = new PluginHost({
    paths: pathsRef,
    logger,
    settings,
    ipc,
    windows,
    overlay,
    media,
    uieditor: { openWindow: (projectId?: string) => uieditorWindow.open(projectId) },
  });
  protocol.setPluginResolver((pluginId, relativePath) => plugins.resolveFile(pluginId, relativePath));

  shortcuts = new ShortcutManager({ settings, logger, plugins, windows });

  new CoreService({ paths: pathsRef, logger, settings, ipc, windows, overlay, plugins, shortcuts, wallpapers, themes, uieditor, search, downloads }).register();

  settings.on('change', (next: ReturnType<SettingsService['get']>) => {
    try {
      windows.applyPanelSettings(next);
      windows.applyBallAppearance(next);
      settingsWindow.applySettings(next);
      applyAutostart(next.general.launchAtLogin);
      shortcuts.apply(next);
      protocol.setAllowedRoots([
        pathsRef.userData,
        pathsRef.screenshots,
        pathsRef.recordings,
        pathsRef.temp,
        pathsRef.resourcesDir,
        next.capture.saveDir,
        next.recorder.saveDir,
      ]);
      ipc.broadcast('settings:changed', next);
      tray?.rebuild();
    } catch (err) {
      logger.error('[settings] 应用失败', err);
    }
  });

  plugins.onChanged(() => tray?.rebuild());
  plugins.onCommandsChanged(() => tray?.rebuild());

  await plugins.start();

  tray = new TrayManager({
    paths: pathsRef,
    logger,
    getSettings: () => settings.get(),
    commands: () => plugins.listCommands(),
    togglePanel: () => windows.togglePanel(),
    openSettings: () => settingsWindow.open('general'),
    runCommand: (id) => {
      void plugins.runCommand(id).catch((err) => logger.warn('[tray] 命令失败', id, err));
    },
    setBallVisible: (visible) => {
      windows.setBallVisible(visible);
      settings.patch({ general: { showBall: visible } });
    },
    isBallVisible: () => !!windows.ball?.isVisible(),
    quit: () => app.quit(),
  });
  tray.create();

  shortcuts.apply(settings.get());
  applyAutostart(settings.get().general.launchAtLogin);

  // 主面板按需创建，降低常驻内存与启动开销
  windows.createBall();
  if (settings.get().general.showBall) windows.showBall();

  logger.info('[main] 启动完成');

  if (process.env.TK_TEST === '1') {
    try {
      const scenario = await import('./testing/scenario');
      await scenario.runSmoke({
        app,
        appRoot,
        paths: pathsRef,
        logger,
        settings,
        ipc,
        windows,
        overlay,
        plugins,
        media,
        shortcuts,
        settingsWindow,
        uieditor,
        uieditorWindow,
        search,
        downloads,
        searchWindow,
      });
    } catch (err) {
      logger.error('[test] 冒烟测试异常', err);
    }
  }
}

app.on('second-instance', () => {
  windows?.openPanel();
});

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = new Set([
      'media',
      'display-capture',
      'audioCapture',
      'videoCapture',
      'clipboard-read',
      'clipboard-sanitized-write',
    ]);
    callback(allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return ['media', 'display-capture', 'audioCapture', 'videoCapture'].includes(permission);
  });

  try {
    await bootstrap();
  } catch (err) {
    logger?.error('[main] 启动失败', err);
    try {
      fs.appendFileSync(
        path.join(app.getPath('userData'), 'logs', 'boot-crash.log'),
        `${new Date().toISOString()} ${err instanceof Error ? err.stack : String(err)}\n`
      );
    } catch {
      /* ignore */
    }
  }
});

app.on('window-all-closed', () => {
  // 托盘常驻应用：不退出
});

app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  // 退出兜底：任何插件/窗口清理卡住时，5 秒后强制结束，避免进程残留
  const forceTimer = setTimeout(() => {
    logger?.warn('[main] 退出清理超时，强制结束进程');
    app.exit(0);
  }, 5000);
  void (async () => {
    try {
      logger?.info('[main] 正在退出…');
      plugins?.markQuitting();
      shortcuts?.dispose();
      await Promise.race([
        plugins?.stop() ?? Promise.resolve(),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
      tray?.destroy();
      settingsWindow?.destroy();
      uieditorWindow?.destroy();
      searchWindow?.destroy();
      await downloads?.dispose();
      windows?.destroy();
      logger?.info('[main] 清理完成');
    } catch (err) {
      logger?.error('[main] 退出清理失败', err);
    } finally {
      // 不清理 forceTimer：即使 app.quit 被某个窗口拦截，也会在 5 秒内强制退出
      app.quit();
    }
  })();
});

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith('tk://app/') && !url.startsWith('tk://plugin/')) {
      event.preventDefault();
      if (/^https?:/i.test(url)) void shell.openExternal(url);
    }
  });
});

process.on('uncaughtException', (err) => {
  logger?.error('[main] uncaughtException', err);
});
process.on('unhandledRejection', (reason) => {
  logger?.error('[main] unhandledRejection', reason);
});
process.on('exit', () => {
  try {
    logger?.info('[main] process exit');
  } catch {
    /* ignore */
  }
});












