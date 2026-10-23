import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import type { IpcHub } from '../ipc';
import type { Logger } from '../logger';

const WINDOW_WIDTH = 1480;
const WINDOW_HEIGHT = 900;

export interface UIEditorWindowDeps {
  paths: { preloadDir: string };
  logger: Logger;
  ipc: IpcHub;
  getReferenceWindow: () => BrowserWindow | null;
}

/**
 * UI 编辑器独立窗口：大尺寸、可最大化，关闭时隐藏复用。
 * 与设置窗口同一套单例模式，避免重复创建导致内存增长。
 */
export class UIEditorWindowManager {
  win: BrowserWindow | null = null;
  private ready = false;
  private pendingProjectId: string | null = null;
  private forceClose = false;

  constructor(private deps: UIEditorWindowDeps) {}

  private create(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const display = this.referenceDisplay();
    const area = display.workArea;
    const width = Math.max(1080, Math.min(WINDOW_WIDTH, area.width - 40));
    const height = Math.max(640, Math.min(WINDOW_HEIGHT, area.height - 40));
    const win = new BrowserWindow({
      width,
      height,
      x: Math.round(area.x + (area.width - width) / 2),
      y: Math.round(area.y + (area.height - height) / 2),
      minWidth: 1080,
      minHeight: 640,
      frame: false,
      transparent: false,
      backgroundColor: '#080A0F',
      resizable: true,
      maximizable: true,
      minimizable: true,
      fullscreenable: true,
      fullscreen: false,
      show: false,
      skipTaskbar: false,
      alwaysOnTop: false,
      title: 'UI 编辑器 · 便捷工具',
      roundedCorners: true,
      thickFrame: true,
      webPreferences: {
        preload: path.join(this.deps.paths.preloadDir, 'editor.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        spellcheck: false,
      },
    });
    this.win = win;
    this.ready = false;
    this.deps.ipc.registerClient(win.webContents, { kind: 'editor' });
    win.loadURL('tk://app/editor.html');
    win.once('ready-to-show', () => {
      if (this.forceClose) return;
      win.maximize();
      win.show();
      win.focus();
    });
    win.on('close', (event) => {
      if (this.forceClose) return;
      event.preventDefault();
      win.hide();
      this.sendEvent('uieditor:hidden', null);
    });
    win.on('closed', () => {
      this.win = null;
      this.ready = false;
    });
    const notifyState = () => this.sendEvent('uieditor:window-state', { maximized: win.isMaximized() });
    win.on('maximize', notifyState);
    win.on('unmaximize', notifyState);
    win.webContents.on('render-process-gone', (_event, details) => {
      this.deps.logger.error('[uieditor] renderer gone', details.reason);
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
    this.sendEvent('uieditor:open', { projectId: this.pendingProjectId });
    this.sendEvent('uieditor:window-state', { maximized: win.isMaximized() });
  }

  open(projectId?: string | null) {
    this.pendingProjectId = projectId ?? null;
    const win = this.create();
    if (!win.isVisible()) {
      win.show();
      win.focus();
    } else {
      win.focus();
    }
    if (this.ready) this.sendOpen();
    return true;
  }

  openProject(projectId: string) {
    this.open(projectId);
  }

  close() {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.hide();
    this.sendEvent('uieditor:hidden', null);
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
    ipc.handle('core', 'uieditor.openWindow', (args) => {
      const projectId = (args as { projectId?: string } | undefined)?.projectId ?? null;
      this.open(projectId);
      return true;
    });
    ipc.handle('core', 'uieditor.closeWindow', () => {
      this.close();
      return true;
    });
    ipc.handle('core', 'uieditor.minimizeWindow', () => {
      this.minimize();
      return true;
    });
    ipc.handle('core', 'uieditor.toggleMaximize', () => {
      this.toggleMaximize();
      return true;
    });
    ipc.handle('core', 'uieditor.windowReady', () => {
      this.ready = true;
      this.sendOpen();
      return true;
    });
    ipc.handle('core', 'uieditor.windowState', () => ({
      open: !!this.win?.isVisible(),
      maximized: !!this.win?.isMaximized(),
    }));
  }
}
