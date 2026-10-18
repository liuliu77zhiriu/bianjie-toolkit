import { BrowserWindow, Menu, screen, type MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import { JsonStore } from './store';
import type { AppPaths, Settings } from '../../shared/types';
import type { Logger } from './logger';
import type { IpcHub } from './ipc';
import { IPC } from '../../shared/defaults';

const PANEL_WIDTH = 452;
const PANEL_HEIGHT = 652;

/** 贴边半隐藏时露在屏幕内的宽度（像素） */
const BALL_EDGE_STRIP = 14;
/** 完全展开时距离屏幕边缘的间距 */
const BALL_EDGE_MARGIN = 10;
/** 鼠标离开后重新藏回边缘的延迟 */
const BALL_DOCK_DELAY = 650;

type BallDockSide = 'left' | 'right';

interface WindowState {
  ball: { x: number; y: number };
  ballSide?: BallDockSide | null;
  panel: { x: number; y: number };
}

export interface BallMenuActions {
  openPanel: () => void;
  runCommand: (id: string) => void;
  openSettings: () => void;
  toggleBall: (visible: boolean) => void;
  quit: () => void;
}

export interface WindowDeps {
  paths: AppPaths;
  logger: Logger;
  ipc: IpcHub;
  settings: Settings;
  menuActions: BallMenuActions;
}

export class WindowManager {
  ball: BrowserWindow | null = null;
  panel: BrowserWindow | null = null;
  private state: JsonStore<WindowState>;
  private ballDragOffset: { x: number; y: number; originX: number; originY: number } | null = null;
  private ballDockSide: BallDockSide | null = null;
  private ballPopped = false;
  private ballHovering = false;
  private ballDockTimer: NodeJS.Timeout | null = null;
  private ballAnimTimer: NodeJS.Timeout | null = null;
  private panelCloseTimer: NodeJS.Timeout | null = null;
  private panelClosing = false;
  private panelReady = false;
  private pendingOpen: { toolId?: string } | null = null;
  private pendingPresent = false;
  private suppressBlur = 0;

  constructor(private deps: WindowDeps) {
    this.state = new JsonStore<WindowState>(path.join(deps.paths.userData, 'window-state.json'), {
      ball: { x: -9999, y: -9999 },
      ballSide: null,
      panel: { x: -9999, y: -9999 },
    });
  }

  get isPanelOpen() {
    return !!this.panel && this.panel.isVisible();
  }

  private attachConsole(win: BrowserWindow, tag: string) {
    win.webContents.on('console-message', ((...args: unknown[]) => {
      // Electron 兼容两种签名
      let level: number | undefined;
      let message = '';
      let line = 0;
      let source = '';
      const first = args[0] as { level?: string; message?: string; lineNumber?: number; sourceId?: string } | undefined;
      if (first && typeof first === 'object' && 'message' in first) {
        level = first.level === 'error' ? 3 : first.level === 'warning' ? 2 : 1;
        message = String(first.message ?? '');
        line = Number(first.lineNumber ?? 0);
        source = String(first.sourceId ?? '');
      } else {
        level = Number(args[1] ?? 1);
        message = String(args[2] ?? '');
        line = Number(args[3] ?? 0);
        source = String(args[4] ?? '');
      }
      if (level >= 3) this.deps.logger.error(`[${tag}:console] ${message} (${source}:${line})`);
      else if (level === 2) this.deps.logger.warn(`[${tag}:console] ${message} (${source}:${line})`);
    }) as never);
  }

  /* ------------------------------------------------------------ 悬浮球 */

  createBall() {
    if (this.ball) return this.ball;
    const size = this.deps.settings.appearance.ballSize + 16;
    const pos = this.resolveBallPosition(size);
    const win = new BrowserWindow({
      width: size,
      height: size,
      x: pos.x,
      y: pos.y,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: true,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      focusable: true,
      title: '便捷工具',
      webPreferences: {
        preload: path.join(this.deps.paths.preloadDir, 'ball.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    this.ball = win;
    this.deps.ipc.registerClient(win.webContents, { kind: 'ball' });
    this.attachConsole(win, 'ball');
    try {
      win.setAlwaysOnTop(true, 'screen-saver');
    } catch {
      /* ignore */
    }
    win.loadURL('tk://app/ball.html');
    win.once('ready-to-show', () => {
      if (this.deps.settings.general.showBall) win.show();
    });
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => this.restoreBallDockState(), 120);
    });
    win.on('closed', () => {
      this.ball = null;
    });
    win.webContents.on('render-process-gone', (_e, details) => {
      this.deps.logger.error('[ball] renderer gone', details.reason);
      if (!win.isDestroyed()) win.reload();
    });
    this.registerBallIpc();
    return win;
  }

  private resolveBallPosition(size: number): { x: number; y: number } {
    const saved = this.state.get().ball;
    const displays = screen.getAllDisplays();
    const valid =
      saved.x > -9999 &&
      saved.y > -9999 &&
      saved.x >= -size - 8 &&
      saved.y >= -size - 8 &&
      displays.some((d) => {
        const b = d.workArea;
        return saved.x >= b.x - size && saved.x < b.x + b.width && saved.y >= b.y - size && saved.y < b.y + b.height;
      });
    if (valid) return saved;
    const area = screen.getPrimaryDisplay().workArea;
    return { x: area.x + area.width - size - 18, y: area.y + Math.round(area.height * 0.42) };
  }

  private registerBallIpc() {
    const ipc = this.deps.ipc;
    ipc.handle('core', 'ball.click', () => {
      this.togglePanel();
      return true;
    });
    ipc.handle('core', 'ball.contextMenu', () => {
      this.showBallMenu();
      return true;
    });
    ipc.handle('core', 'ball.dragStart', () => {
      if (!this.ball) return false;
      this.clearBallDockTimer();
      this.cancelBallAnim();
      this.ballHovering = false;
      if (this.ballDockSide) {
        this.ballPopped = true;
        this.sendBallDocked();
      }
      const point = screen.getCursorScreenPoint();
      const [wx, wy] = this.ball.getPosition();
      this.ballDragOffset = { x: point.x - wx, y: point.y - wy, originX: point.x, originY: point.y };
      return true;
    });
    ipc.handle('core', 'ball.dragMove', (args) => {
      if (!this.ball || !this.ballDragOffset) return false;
      const { x, y } = args as { x: number; y: number };
      this.ball.setPosition(Math.round(x - this.ballDragOffset.x), Math.round(y - this.ballDragOffset.y));
      return true;
    });
    ipc.handle('core', 'ball.dragEnd', (args) => {
      if (!this.ball) return false;
      const { moved } = args as { x: number; y: number; moved: boolean };
      const [wx, wy] = this.ball.getPosition();
      this.cancelBallAnim();
      if (moved) {
        const bounds = this.ball.getBounds();
        const area = this.ballDisplay().workArea;
        const side: BallDockSide = wx + bounds.width / 2 < area.x + area.width / 2 ? 'left' : 'right';
        const nearEdge =
          side === 'left'
            ? wx <= area.x + 44
            : wx + bounds.width >= area.x + area.width - 44;
        if (this.deps.settings.appearance.ballEdgeHide && nearEdge) {
          this.setBallDock(side, false);
        } else {
          if (this.deps.settings.appearance.ballEdgeSnap) {
            const snapped = this.snapToEdges(wx, wy, bounds);
            this.ballDockSide = null;
            this.ballPopped = false;
            this.ball.setPosition(snapped.x, snapped.y);
          } else {
            this.ballDockSide = null;
            this.ballPopped = false;
          }
          this.persistBallState();
          this.sendBallDocked();
        }
      }
      this.ballDragOffset = null;
      if (!moved) this.togglePanel();
      return true;
    });
    ipc.handle('core', 'ball.dockState', () => ({
      docked: !!this.ballDockSide,
      popped: this.ballPopped,
      side: this.ballDockSide,
      strip: BALL_EDGE_STRIP,
    }));
    ipc.handle('core', 'ball.hover', (args) => {
      this.handleBallHover(!!(args as { hovering?: boolean })?.hovering);
      return true;
    });
    ipc.handle('core', 'ball.setVisible', (args) => {
      const visible = !!(args as { visible: boolean })?.visible;
      this.setBallVisible(visible);
      return visible;
    });
    ipc.handle('core', 'ball.moveBy', (args) => {
      if (!this.ball) return false;
      const { dx, dy } = args as { dx: number; dy: number };
      const [x, y] = this.ball.getPosition();
      this.ball.setPosition(Math.round(x + dx), Math.round(y + dy));
      return true;
    });
  }

  private snapToEdges(x: number, y: number, bounds: { width: number; height: number }) {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const area = display.workArea;
    const margin = 8;
    const threshold = 30;
    let nx = x;
    let ny = y;
    if (Math.abs(x - area.x) < threshold) nx = area.x + margin;
    if (Math.abs(x + bounds.width - (area.x + area.width)) < threshold) nx = area.x + area.width - bounds.width - margin;
    if (Math.abs(y - area.y) < threshold) ny = area.y + margin;
    if (Math.abs(y + bounds.height - (area.y + area.height)) < threshold) ny = area.y + area.height - bounds.height - margin;
    return {
      x: Math.max(area.x - 4, Math.min(area.x + area.width - bounds.width + 4, nx)),
      y: Math.max(area.y - 4, Math.min(area.y + area.height - bounds.height + 4, ny)),
    };
  }

  /* ------------------------------------------------------------ 贴边半隐藏 */

  private ballDisplay() {
    const win = this.ball;
    return win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
  }

  private dockedPosition(side: BallDockSide): { x: number; y: number } {
    const win = this.ball;
    if (!win) return { x: 0, y: 0 };
    const bounds = win.getBounds();
    const area = this.ballDisplay().workArea;
    const y = Math.max(area.y, Math.min(area.y + area.height - bounds.height, bounds.y));
    const x = side === 'left' ? area.x - (bounds.width - BALL_EDGE_STRIP) : area.x + area.width - BALL_EDGE_STRIP;
    return { x: Math.round(x), y: Math.round(y) };
  }

  private fullVisiblePosition(side: BallDockSide): { x: number; y: number } {
    const win = this.ball;
    if (!win) return { x: 0, y: 0 };
    const bounds = win.getBounds();
    const area = this.ballDisplay().workArea;
    const y = Math.max(area.y, Math.min(area.y + area.height - bounds.height, bounds.y));
    const x =
      side === 'left'
        ? area.x + BALL_EDGE_MARGIN
        : area.x + area.width - bounds.width - BALL_EDGE_MARGIN;
    return { x: Math.round(x), y: Math.round(y) };
  }

  private cancelBallAnim() {
    if (this.ballAnimTimer) {
      clearInterval(this.ballAnimTimer);
      this.ballAnimTimer = null;
    }
  }

  private animateBallTo(target: { x: number; y: number }, duration = 220) {
    const win = this.ball;
    if (!win || win.isDestroyed()) return;
    this.cancelBallAnim();
    const [sx, sy] = win.getPosition();
    const started = Date.now();
    this.ballAnimTimer = setInterval(() => {
      const current = this.ball;
      if (!current || current.isDestroyed()) {
        this.cancelBallAnim();
        return;
      }
      const t = Math.min(1, (Date.now() - started) / duration);
      const k = 1 - Math.pow(1 - t, 3);
      current.setPosition(Math.round(sx + (target.x - sx) * k), Math.round(sy + (target.y - sy) * k));
      if (t >= 1) {
        this.cancelBallAnim();
        this.persistBallState();
      }
    }, 15);
  }

  private persistBallState() {
    const win = this.ball;
    if (!win || win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    this.state.update((state) => {
      state.ball = { x, y };
      state.ballSide = this.ballDockSide;
    });
  }

  private sendBallDocked() {
    const win = this.ball;
    if (!win || win.isDestroyed()) return;
    win.webContents.send(IPC.event, {
      topic: 'ball:docked',
      payload: {
        docked: !!this.ballDockSide && !this.ballPopped,
        side: this.ballDockSide,
        strip: BALL_EDGE_STRIP,
      },
    });
  }

  private clearBallDockTimer() {
    if (this.ballDockTimer) {
      clearTimeout(this.ballDockTimer);
      this.ballDockTimer = null;
    }
  }

  /** 让悬浮球停靠到屏幕左/右边缘（只露出 BALL_EDGE_STRIP 像素）；传 null 取消停靠 */
  setBallDock(side: BallDockSide | null, animate = true) {
    const win = this.ball;
    if (!win || win.isDestroyed()) return;
    this.clearBallDockTimer();
    if (!side) {
      const previous = this.ballDockSide;
      this.ballDockSide = null;
      this.ballPopped = false;
      if (previous) {
        const target = this.fullVisiblePosition(previous);
        if (animate) this.animateBallTo(target);
        else {
          win.setPosition(target.x, target.y);
          this.persistBallState();
        }
      }
      this.sendBallDocked();
      return;
    }
    this.ballDockSide = side;
    this.ballPopped = false;
    const target = this.dockedPosition(side);
    if (animate) this.animateBallTo(target);
    else {
      win.setPosition(target.x, target.y);
      this.persistBallState();
    }
    this.sendBallDocked();
  }

  private popBallOut() {
    if (!this.ballDockSide || this.ballPopped) return;
    this.clearBallDockTimer();
    this.ballPopped = true;
    this.animateBallTo(this.fullVisiblePosition(this.ballDockSide));
    this.sendBallDocked();
  }

  private scheduleBallDock() {
    this.clearBallDockTimer();
    this.ballDockTimer = setTimeout(() => {
      this.ballDockTimer = null;
      if (this.ballHovering || !this.ballDockSide) return;
      this.ballPopped = false;
      this.dockBallSilently(this.ballDockSide);
    }, BALL_DOCK_DELAY);
  }

  private dockBallSilently(side: BallDockSide) {
    const win = this.ball;
    if (!win || win.isDestroyed()) return;
    this.ballDockSide = side;
    this.ballPopped = false;
    const target = this.dockedPosition(side);
    this.animateBallTo(target, 260);
    this.sendBallDocked();
  }

  private handleBallHover(hovering: boolean) {
    this.ballHovering = hovering;
    if (hovering) {
      this.clearBallDockTimer();
      this.popBallOut();
      return;
    }
    if (this.ballDockSide) {
      this.scheduleBallDock();
    }
  }

  private detectDockSideFromBounds(bounds: { x: number; y: number; width: number; height: number }): BallDockSide | null {
    const area = screen.getDisplayMatching(bounds).workArea;
    if (bounds.x + bounds.width >= area.x + area.width + 10) return 'right';
    if (bounds.x <= area.x - 10) return 'left';
    return null;
  }

  private detectNearEdgeSide(bounds: { x: number; y: number; width: number; height: number }): BallDockSide | null {
    const area = screen.getDisplayMatching(bounds).workArea;
    if (bounds.x <= area.x + 36) return 'left';
    if (bounds.x + bounds.width >= area.x + area.width - 36) return 'right';
    return null;
  }

  private restoreBallDockState() {
    const win = this.ball;
    if (!win || win.isDestroyed()) return;
    const saved = this.state.get();
    const settingOn = this.deps.settings.appearance.ballEdgeHide;
    let derived = saved.ballSide ?? this.detectDockSideFromBounds(win.getBounds());
    if (!derived && settingOn) derived = this.detectNearEdgeSide(win.getBounds());
    const side = settingOn ? derived : null;
    if (side) {
      this.ballDockSide = side;
      this.ballPopped = false;
      const target = this.dockedPosition(side);
      win.setPosition(target.x, target.y);
      this.persistBallState();
    } else if (saved.ballSide) {
      // 之前是贴边状态但用户关闭了开关：恢复到完整可见
      const previous = saved.ballSide;
      this.ballDockSide = null;
      const target = this.fullVisiblePosition(previous);
      win.setPosition(target.x, target.y);
      this.persistBallState();
    }
    setTimeout(() => this.sendBallDocked(), 180);
  }


  showBall() {
    const win = this.createBall();
    win.showInactive();
    try {
      win.setAlwaysOnTop(true, 'screen-saver');
    } catch {
      /* ignore */
    }
  }

  setBallVisible(visible: boolean) {
    if (visible) {
      this.showBall();
    } else {
      this.ball?.hide();
    }
    this.deps.ipc.broadcast('ball:visibility', { visible });
  }

  applyBallAppearance(settings: Settings) {
    this.deps.settings = settings;
    if (!this.ball) return;
    const size = settings.appearance.ballSize + 16;
    const bounds = this.ball.getBounds();
    this.ball.setBounds({ x: bounds.x, y: bounds.y, width: size, height: size });
    if (!settings.appearance.ballEdgeHide && this.ballDockSide) {
      this.setBallDock(null, false);
    } else if (settings.appearance.ballEdgeHide && !this.ballDockSide) {
      const near = this.detectNearEdgeSide(this.ball.getBounds());
      if (near) this.setBallDock(near, true);
    } else if (this.ballDockSide) {
      const target = this.dockedPosition(this.ballDockSide);
      this.ball.setPosition(target.x, target.y);
      this.persistBallState();
    }
    if (settings.general.showBall && !this.ball.isVisible()) this.ball.showInactive();
    this.sendBallDocked();
  }

  private showBallMenu() {
    const actions = this.deps.menuActions;
    const settings = this.deps.settings;
    const template: MenuItemConstructorOptions[] = [
      { label: '打开工具箱', click: actions.openPanel },
      { type: 'separator' },
      { label: '区域截图', accelerator: settings.shortcuts.screenshotRegion || undefined, click: () => actions.runCommand('screenshot.region') },
      { label: '全屏截图', accelerator: settings.shortcuts.screenshotFull || undefined, click: () => actions.runCommand('screenshot.full') },
      { label: '录制屏幕', accelerator: settings.shortcuts.recordToggle || undefined, click: () => actions.runCommand('recorder.toggle') },
      { type: 'separator' },
      { label: '设置', click: actions.openSettings },
      { label: '隐藏悬浮球', click: () => actions.toggleBall(false) },
      { label: '退出', click: actions.quit },
    ];
    Menu.buildFromTemplate(template).popup({ window: this.ball ?? undefined });
  }

  /* ------------------------------------------------------------ 主面板 */

  createPanel() {
    if (this.panel) return this.panel;
    const pos = this.resolvePanelPosition();
    const win = new BrowserWindow({
      width: PANEL_WIDTH,
      height: PANEL_HEIGHT,
      x: pos.x,
      y: pos.y,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      maximizable: false,
      minimizable: true,
      fullscreenable: false,
      show: false,
      skipTaskbar: false,
      alwaysOnTop: this.deps.settings.appearance.alwaysOnTop,
      title: '便捷工具',
      roundedCorners: true,
      webPreferences: {
        preload: path.join(this.deps.paths.preloadDir, 'panel.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        spellcheck: false,
      },
    });
    this.panel = win;
    this.deps.ipc.registerClient(win.webContents, { kind: 'panel' });
    this.attachConsole(win, 'panel');
    this.applyPanelMaterial(win);
    win.loadURL('tk://app/index.html');

    win.on('blur', () => {
      if (this.suppressBlur > 0) return;
      if (this.deps.settings.general.closePanelOnBlur) this.closePanel();
    });
    win.on('closed', () => {
      this.panel = null;
      this.panelReady = false;
      this.pendingOpen = null;
      this.pendingPresent = false;
    });
    win.webContents.on('render-process-gone', (_e, details) => {
      this.deps.logger.error('[panel] renderer gone', details.reason);
      this.panelReady = false;
      if (!win.isDestroyed()) win.reload();
    });

    const ipc = this.deps.ipc;
    ipc.handle('core', 'panel.close', () => {
      this.closePanel();
      return true;
    });
    ipc.handle('core', 'panel.hide', () => {
      this.hidePanelImmediate();
      return true;
    });
    ipc.handle('core', 'panel.minimize', () => {
      this.panel?.minimize();
      return true;
    });
    ipc.handle('core', 'panel.openTool', (args) => {
      const pluginId = (args as { pluginId?: string })?.pluginId;
      this.openPanel(pluginId);
      return true;
    });
    ipc.handle('core', 'panel.state', () => ({ open: this.isPanelOpen }));
    ipc.handle('core', 'panel.ready', () => {
      this.deps.logger.info('[panel] renderer ready');
      this.panelReady = true;
      if (this.pendingPresent && this.panel) {
        this.pendingPresent = false;
        this.presentPanel(this.panel);
      }
      return true;
    });
    return win;
  }

  private applyPanelMaterial(win: BrowserWindow) {
    try {
      win.setBackgroundMaterial(this.deps.settings.appearance.blur ? 'acrylic' : 'none');
    } catch {
      /* 部分系统不支持，退回纯 CSS 玻璃 */
    }
  }

  private resolvePanelPosition(): { x: number; y: number } {
    const display = this.ball ? screen.getDisplayMatching(this.ball.getBounds()) : screen.getPrimaryDisplay();
    const area = display.workArea;
    const gap = 14;
    let x: number;
    let y: number;
    if (this.ball && this.ball.isVisible()) {
      const b = this.ball.getBounds();
      const spaceRight = area.x + area.width - (b.x + b.width);
      const spaceLeft = b.x - area.x;
      x = spaceRight >= PANEL_WIDTH + gap ? b.x + b.width + gap : b.x - PANEL_WIDTH - gap;
      if (spaceLeft < PANEL_WIDTH + gap && spaceRight < PANEL_WIDTH + gap) x = area.x + area.width - PANEL_WIDTH - 18;
      y = b.y + b.height / 2 - PANEL_HEIGHT / 2;
    } else {
      x = area.x + area.width - PANEL_WIDTH - 24;
      y = area.y + Math.round((area.height - PANEL_HEIGHT) / 2);
    }
    x = Math.max(area.x + 8, Math.min(area.x + area.width - PANEL_WIDTH - 8, x));
    y = Math.max(area.y + 8, Math.min(area.y + area.height - PANEL_HEIGHT - 8, y));
    return { x: Math.round(x), y: Math.round(y) };
  }

  openPanel(toolId?: string) {
    const win = this.createPanel();
    if (this.panelCloseTimer) {
      clearTimeout(this.panelCloseTimer);
      this.panelCloseTimer = null;
    }
    this.panelClosing = false;
    this.pendingOpen = { toolId };
    if (this.panelReady) {
      this.presentPanel(win);
    } else {
      // 首次创建：等渲染层完成挂载（panel.ready）后再显示，避免透明空窗闪烁
      this.pendingPresent = true;
    }
  }

  private presentPanel(win: BrowserWindow) {
    if (win.isDestroyed()) return;
    if (!win.isVisible()) {
      const pos = this.resolvePanelPosition();
      win.setPosition(pos.x, pos.y);
      try {
        win.setOpacity(0);
      } catch {
        /* ignore */
      }
      win.show();
    }
    win.focus();
    if (win.isMinimized()) win.restore();
    let step = 0;
    const steps = 7;
    const timer = setInterval(() => {
      step += 1;
      const value = Math.min(1, step / steps);
      try {
        if (!win.isDestroyed()) win.setOpacity(value);
      } catch {
        /* ignore */
      }
      if (step >= steps) clearInterval(timer);
    }, 14);
    const toolId = this.pendingOpen?.toolId ?? null;
    this.pendingOpen = null;
    win.webContents.send(IPC.event, { topic: 'panel:opening', payload: { toolId } });
    setTimeout(() => {
      if (win.isDestroyed()) return;
      win.webContents.send(IPC.event, { topic: 'panel:open', payload: { toolId } });
    }, 30);
  }

  async hidePanelImmediate() {
    if (!this.panel) return;
    this.panelClosing = true;
    this.panel.hide();
    this.panel.setOpacity(1);
  }

  closePanel() {
    if (!this.panel || !this.panel.isVisible() || this.panelClosing) return;
    this.panelClosing = true;
    const win = this.panel;
    win.webContents.send(IPC.event, { topic: 'panel:closing', payload: null });
    if (this.panelCloseTimer) clearTimeout(this.panelCloseTimer);
    this.panelCloseTimer = setTimeout(() => {
      this.panelCloseTimer = null;
      if (win.isDestroyed()) return;
      win.hide();
      try {
        win.setOpacity(1);
      } catch {
        /* ignore */
      }
      this.panelClosing = false;
    }, 190);
  }

  togglePanel(toolId?: string) {
    if (this.isPanelOpen) this.closePanel();
    else this.openPanel(toolId);
  }

  applyPanelSettings(settings: Settings) {
    this.deps.settings = settings;
    if (!this.panel) return;
    try {
      this.panel.setAlwaysOnTop(settings.appearance.alwaysOnTop, 'floating');
    } catch {
      /* ignore */
    }
    this.applyPanelMaterial(this.panel);
  }

  async withNativeDialog<T>(fn: () => Promise<T>): Promise<T> {
    this.suppressBlur += 1;
    try {
      return await fn();
    } finally {
      this.suppressBlur = Math.max(0, this.suppressBlur - 1);
    }
  }

  destroy() {
    if (this.panelCloseTimer) clearTimeout(this.panelCloseTimer);
    this.panel?.destroy();
    this.ball?.destroy();
    this.panel = null;
    this.ball = null;
  }
}

export { PANEL_WIDTH, PANEL_HEIGHT };









