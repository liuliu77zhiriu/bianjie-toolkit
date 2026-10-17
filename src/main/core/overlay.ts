import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import type { AppPaths, Rect, RegionPickResult } from '../../shared/types';
import type { IpcHub } from './ipc';
import type { Logger } from './logger';

interface OverlaySession {
  id: string;
  windows: Map<number, { win: BrowserWindow; displayId: string; scaleFactor: number; size: { width: number; height: number } }>;
  resolve: (value: RegionPickResult | null) => void;
  timer: NodeJS.Timeout;
  settled: boolean;
}

export interface OverlayDeps {
  paths: AppPaths;
  ipc: IpcHub;
  logger: Logger;
  hidePanel: () => Promise<void>;
}

/** 区域框选遮罩：每个显示器一块全屏透明窗口。 */
export class OverlayManager {
  private session: OverlaySession | null = null;
  private handlersReady = false;

  constructor(private deps: OverlayDeps) {}

  private ensureHandlers() {
    if (this.handlersReady) return;
    this.handlersReady = true;
    const { ipc } = this.deps;

    ipc.handle('core', 'overlay.init', (_args, meta) => {
      const entry = this.session?.windows.get(meta.webContentsId);
      if (!entry) {
        this.deps.logger.warn('[overlay] init 未找到窗口映射', meta.webContentsId, Array.from(this.session?.windows.keys() || []));
        return null;
      }
      return {
        displayId: entry.displayId,
        bounds: { x: 0, y: 0, width: entry.size.width, height: entry.size.height },
        scaleFactor: entry.scaleFactor,
      };
    });

    ipc.handle('core', 'overlay.select', (args, meta) => {
      const session = this.session;
      const entry = session?.windows.get(meta.webContentsId);
      if (!session || !entry) return false;
      const input = args as { rect?: Rect } | undefined;
      const rect = input?.rect;
      if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y)) {
        this.finish(null);
        return false;
      }
      const x = Math.max(0, Math.round(rect.x));
      const y = Math.max(0, Math.round(rect.y));
      const width = Math.min(entry.size.width - x, Math.round(rect.width));
      const height = Math.min(entry.size.height - y, Math.round(rect.height));
      if (width < 3 || height < 3) {
        this.finish(null);
        return false;
      }
      this.finish({
        displayId: entry.displayId,
        rect: { x, y, width, height },
        scaleFactor: entry.scaleFactor,
      });
      return true;
    });

    ipc.handle('core', 'overlay.cancel', () => {
      this.finish(null);
      return true;
    });
  }

  private attachConsole(win: BrowserWindow) {
    win.webContents.on('console-message', ((...args: unknown[]) => {
      const first = args[0] as { level?: string; message?: string; lineNumber?: number; sourceId?: string } | undefined;
      if (first && typeof first === 'object' && 'message' in first) {
        const level = first.level === 'error' ? 3 : first.level === 'warning' ? 2 : 1;
        this.deps.logger.info('[overlay:console]', String(first.message));
        void level;
      }
    }) as never);
  }

  async pickRegion(opts?: { hint?: string }): Promise<RegionPickResult | null> {
    this.ensureHandlers();
    if (this.session) return null;
    try {
      await this.deps.hidePanel();
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 170));

    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    const windows = new Map<number, { win: BrowserWindow; displayId: string; scaleFactor: number; size: { width: number; height: number } }>();

    const session: OverlaySession = {
      id: `overlay-${Date.now()}`,
      windows,
      resolve: () => {},
      timer: setTimeout(() => this.finish(null), 120000),
      settled: false,
    };

    const promise = new Promise<RegionPickResult | null>((resolve) => {
      session.resolve = resolve;
    });
    this.session = session;

    for (const display of displays) {
      const { x, y, width, height } = display.bounds;
      const win = new BrowserWindow({
        x,
        y,
        width,
        height,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        hasShadow: false,
        enableLargerThanScreen: true,
        show: false,
        focusable: true,
        title: '区域截图',
        webPreferences: {
          preload: path.join(this.deps.paths.preloadDir, 'overlay.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          backgroundThrottling: false,
        },
      });
      const wcId = win.webContents.id;
      windows.set(wcId, {
        win,
        displayId: String(display.id),
        scaleFactor: display.scaleFactor,
        size: { width, height },
      });
      this.deps.ipc.registerClient(win.webContents, { kind: 'overlay' });
      try {
        win.setAlwaysOnTop(true, 'screen-saver');
        win.setVisibleOnAllWorkspaces(true);
      } catch {
        /* ignore */
      }
      this.attachConsole(win);
      const query = new URLSearchParams({
        displayId: String(display.id),
        w: String(width),
        h: String(height),
        scale: String(display.scaleFactor),
        hint: opts?.hint ?? '拖拽选择区域 · Esc 取消',
      });
      void win.loadURL(`tk://app/overlay.html?${query.toString()}`);
      win.once('ready-to-show', () => {
        if (session.settled || win.isDestroyed()) return;
        win.show();
        // Windows 会把窗口夹到工作区（任务栏高度），显示后再校正为整屏，保证底部可框选
        try {
          win.setBounds(display.bounds);
        } catch {
          /* ignore */
        }
        if (display.id === primary.id) {
          win.focus();
        }
      });
      win.on('closed', () => {
        windows.delete(wcId);
      });
    }

    return promise;
  }

  finish(result: RegionPickResult | null) {
    const session = this.session;
    if (!session || session.settled) return;
    session.settled = true;
    this.session = null;
    clearTimeout(session.timer);
    try {
      for (const { win } of session.windows.values()) {
        try {
          if (!win.isDestroyed()) win.destroy();
        } catch {
          /* ignore */
        }
      }
    } finally {
      session.resolve(result);
    }
  }

  get active() {
    return !!this.session;
  }
}





