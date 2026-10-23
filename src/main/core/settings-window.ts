import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import type { Settings } from '../../shared/types';
import type { IpcHub } from './ipc';
import type { Logger } from './logger';
import { IPC } from '../../shared/defaults';

const WINDOW_WIDTH = 920;
const WINDOW_HEIGHT = 720;

export interface SettingsWindowDeps {
  paths: { preloadDir: string };
  logger: Logger;
  ipc: IpcHub;
  getSettings: () => Settings;
  getReferenceWindow: () => BrowserWindow | null;
}

/**
 * 独立设置窗口：侧边栏 + 内容区，单实例、隐藏复用。
 * 与主面板分离，避免小面板里塞设置；关闭时只隐藏，退出时销毁。
 */
export class SettingsWindowManager {
  win: BrowserWindow | null = null;
  private ready = false;
  private pendingTab: string | null = null;
  private forceClose = false;

  constructor(private deps: SettingsWindowDeps) {}

  private create(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const display = this.referenceDisplay();
    const area = display.workArea;
    const width = Math.min(WINDOW_WIDTH, area.width - 40);
    const height = Math.min(WINDOW_HEIGHT, area.height - 40);
    const win = new BrowserWindow({
      width,
      height,
      x: Math.round(area.x + (area.width - width) / 2),
      y: Math.round(area.y + (area.height - height) / 2),
      minWidth: 760,
      minHeight: 560,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: true,
      maximizable: true,
      minimizable: true,
      fullscreenable: false,
      show: false,
      skipTaskbar: false,
      alwaysOnTop: false,
      title: '设置 · 便捷工具',
      icon: path.join(path.dirname(this.deps.paths.preloadDir), '..', 'resources', 'icons', 'app.png'),
      roundedCorners: true,
      thickFrame: true,
      webPreferences: {
        preload: path.join(this.deps.paths.preloadDir, 'settings.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        spellcheck: false,
      },
    });
    this.win = win;
    this.ready = false;
    this.deps.ipc.registerClient(win.webContents, { kind: 'settings' });
    this.applyMaterial(win);
    win.loadURL('tk://app/settings.html');
    win.once('ready-to-show', () => {
      if (this.forceClose) return;
      win.show();
      win.focus();
    });
    win.on('close', (event) => {
      if (this.forceClose) return;
      event.preventDefault();
      win.hide();
      this.notifyHidden();
    });
    win.on('closed', () => {
      this.win = null;
      this.ready = false;
    });
    win.webContents.on('render-process-gone', (_e, details) => {
      this.deps.logger.error('[settings-window] renderer gone', details.reason);
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
        /* fall through */
      }
    }
    return screen.getPrimaryDisplay();
  }

  private applyMaterial(win: BrowserWindow) {
    try {
      const settings = this.deps.getSettings();
      win.setBackgroundMaterial(settings.appearance.blur ? 'acrylic' : 'none');
    } catch {
      /* ignore */
    }
  }

  private notifyHidden() {
    try {
      this.win?.webContents.send(IPC.event, { topic: 'settings:hidden', payload: null });
    } catch {
      /* ignore */
    }
  }

  private deliverTab(tab: string | null) {
    if (!this.win || this.win.isDestroyed()) return;
    const payload = { tab: tab ?? 'general' };
    this.win.webContents.send(IPC.event, { topic: 'settings:tab', payload });
    this.win.webContents.send(IPC.event, { topic: 'settings:shown', payload });
  }

  open(tab?: string) {
    this.pendingTab = tab ?? null;
    const win = this.create();
    if (!win.isVisible()) {
      const display = this.referenceDisplay();
      const area = display.workArea;
      const [width, height] = win.getSize();
      win.setPosition(
        Math.round(area.x + (area.width - width) / 2),
        Math.round(area.y + (area.height - height) / 2)
      );
    }
    win.show();
    win.focus();
    if (this.ready) this.deliverTab(this.pendingTab);
  }

  close() {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.hide();
    this.notifyHidden();
  }

  minimize() {
    this.win?.minimize();
  }

  applySettings(_settings: Settings) {
    if (!this.win || this.win.isDestroyed()) return;
    this.applyMaterial(this.win);
  }

  destroy() {
    this.forceClose = true;
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
    this.ready = false;
  }

  /** 注册窗口自身的 IPC（打开/关闭/最小化/渲染层就绪） */
  registerIpc() {
    const ipc = this.deps.ipc;
    ipc.handle('core', 'settings.openWindow', (args) => {
      const tab = (args as { tab?: string } | undefined)?.tab;
      this.open(tab);
      return true;
    });
    ipc.handle('core', 'settings.closeWindow', () => {
      this.close();
      return true;
    });
    ipc.handle('core', 'settings.minimizeWindow', () => {
      this.minimize();
      return true;
    });
    ipc.handle('core', 'settings.windowReady', () => {
      this.ready = true;
      this.deliverTab(this.pendingTab);
      this.pendingTab = null;
      return true;
    });
    ipc.handle('core', 'settings.windowState', () => ({
      open: !!this.win?.isVisible(),
    }));
  }
}
