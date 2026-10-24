import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import type { IpcHub } from '../ipc';
import type { Logger } from '../logger';
import type { SearchOpenOptions } from '../../../shared/search';

export interface SearchWindowDeps {
  paths: { preloadDir: string; resourcesDir: string };
  logger: Logger;
  ipc: IpcHub;
  getReferenceWindow: () => BrowserWindow | null;
}

const DEFAULT_WIDTH = 1400;
const DEFAULT_HEIGHT = 860;

/**
 * 流光搜索独立窗口：白色玻璃 UI，搜索/下载器共用。
 * 与设置/UI 编辑器一致：单实例、关闭隐藏、退出销毁。
 */
export class SearchWindowManager {
  win: BrowserWindow | null = null;
  private ready = false;
  private pending: SearchOpenOptions | null = null;
  private forceClose = false;

  constructor(private deps: SearchWindowDeps) {}

  private create(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const display = this.referenceDisplay();
    const area = display.workArea;
    const width = Math.max(1080, Math.min(DEFAULT_WIDTH, area.width - 40));
    const height = Math.max(680, Math.min(DEFAULT_HEIGHT, area.height - 40));
    const win = new BrowserWindow({
      width,
      height,
      x: Math.round(area.x + (area.width - width) / 2),
      y: Math.round(area.y + (area.height - height) / 2),
      minWidth: 1080,
      minHeight: 680,
      frame: false,
      transparent: false,
      backgroundColor: '#F7F8FB',
      resizable: true,
      maximizable: true,
      minimizable: true,
      fullscreenable: false,
      show: false,
      skipTaskbar: false,
      alwaysOnTop: false,
      title: '流光搜索',
      icon: path.join(this.deps.paths.resourcesDir, 'icons', 'app.png'),
      roundedCorners: true,
      thickFrame: true,
      webPreferences: {
        preload: path.join(this.deps.paths.preloadDir, 'search.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: true,
        spellcheck: false,
      },
    });
    this.win = win;
    this.ready = false;
    this.deps.ipc.registerClient(win.webContents, { kind: 'search' });
    win.loadURL('tk://app/search.html');
    win.once('ready-to-show', () => {
      if (this.forceClose) return;
      win.show();
      win.focus();
    });
    win.on('close', (event) => {
      if (this.forceClose) return;
      event.preventDefault();
      win.hide();
      this.sendEvent('search:hidden', null);
    });
    win.on('closed', () => {
      this.win = null;
      this.ready = false;
    });
    const notifyState = () => this.sendEvent('search:window-state', { maximized: win.isMaximized() });
    win.on('maximize', notifyState);
    win.on('unmaximize', notifyState);
    win.webContents.on('render-process-gone', (_event, details) => {
      this.deps.logger.error('[search] renderer gone', details.reason);
      if (!win.isDestroyed()) {
        this.ready = false;
        win.reload();
      }
    });
    return win;
  }

  private referenceDisplay() {
    const reference = this.deps.getReferenceWindow();
    if (reference && !reference.isDestroyed()) {
      try {
        return screen.getDisplayMatching(reference.getBounds());
      } catch {
        /* ignore */
      }
    }
    return screen.getPrimaryDisplay();
  }

  private sendEvent(topic: string, payload: unknown) {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    try {
      win.webContents.send('tk:event', { topic, payload });
    } catch {
      /* ignore */
    }
  }

  private sendOpen() {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    this.sendEvent('search:open', this.pending ?? {});
    this.sendEvent('search:window-state', { maximized: win.isMaximized() });
  }

  open(options?: SearchOpenOptions) {
    this.pending = options ?? null;
    const win = this.create();
    if (!win.isVisible()) win.show();
    win.focus();
    if (this.ready) this.sendOpen();
    return true;
  }

  close() {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.hide();
    this.sendEvent('search:hidden', null);
  }

  minimize() {
    this.win?.minimize();
  }

  toggleMaximize() {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  }

  destroy() {
    this.forceClose = true;
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
    this.ready = false;
  }

  registerIpc() {
    const ipc = this.deps.ipc;
    ipc.handle('core', 'search.openWindow', (args) => {
      const options = (args as SearchOpenOptions | undefined) ?? undefined;
      this.open(options);
      return true;
    });
    ipc.handle('core', 'search.closeWindow', () => {
      this.close();
      return true;
    });
    ipc.handle('core', 'search.minimizeWindow', () => {
      this.minimize();
      return true;
    });
    ipc.handle('core', 'search.toggleMaximize', () => {
      this.toggleMaximize();
      return true;
    });
    ipc.handle('core', 'search.windowReady', () => {
      this.ready = true;
      this.sendOpen();
      return true;
    });
    ipc.handle('core', 'search.windowState', () => ({
      open: !!this.win?.isVisible(),
      maximized: !!this.win?.isMaximized(),
    }));
  }
}

