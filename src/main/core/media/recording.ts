/**
 * ★ 录屏引擎（capture-dev）。
 *
 * 架构：主进程创建一个隐藏 BrowserWindow（专用内存 session 分区），页面调用
 * getDisplayMedia（由 setDisplayMediaRequestHandler 指定来源，系统声音用
 * audio:'loopback'）→ 麦克风另取 → AudioContext 混音 → MediaRecorder；
 * 分片通过 IPC 回主进程顺序写临时文件，stop 后原子移动到录制目录。
 *
 * 为什么用 executeJavaScript(code, true)：隐藏窗口没有用户手势，而
 * getDisplayMedia 需要 transient activation；主进程用 userGesture=true 调用
 * 页面导出的 __tkRecorderStart，实测可以正常开始捕获。
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { BrowserWindow, DesktopCapturerSource } from 'electron';
import type {
  AppPaths,
  AudioSource,
  MediaDeps,
  RecordingPhase,
  RecordingResult,
  RecordingState,
  StartRecordingOptions,
} from '../../../shared/types';
import { IPC } from '../../../shared/defaults';
import { ToolkitError } from '../errors';
import {
  extFromMime,
  normalizeAudio,
  normalizeCountdown,
  normalizeFps,
  normalizeQuality,
  recordingFileName,
} from './geometry';

export interface RecordingDeps {
  settings: MediaDeps['settings'];
  paths: AppPaths;
  log: MediaDeps['log'];
  electron: MediaDeps['electron'];
  hidePanel: () => Promise<void>;
  showPanel: () => Promise<void>;
}

interface PageStartResult {
  ok?: boolean;
  mimeType?: string;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  error?: string;
}

interface Session {
  id: string;
  phase: RecordingPhase;
  kind: 'screen' | 'window';
  opts: StartRecordingOptions;
  audio: AudioSource;
  fps: number;
  quality: number;
  countdownSec: number;
  maxDurationSec: number;
  startedAt: number;
  recordingStartedAt: number;
  durationMs: number;
  error?: string;
  path?: string;
  sizeBytes?: number;
  format: 'mp4' | 'webm';
  win: BrowserWindow | null;
  tempPath: string;
  stream: fs.WriteStream | null;
  writeChain: Promise<void>;
  bytes: number;
  timer: NodeJS.Timeout | null;
  maxTimer: NodeJS.Timeout | null;
  stopTimeout: NodeJS.Timeout | null;
  completed: boolean;
  cancelled: boolean;
  /** 正在收尾（防止 closed / stopped / 超时重复触发） */
  finalizing: boolean;
  pageReady: boolean;
  pageReadyWaiters: Array<() => void>;
  stopWaiters: Array<{ resolve: (result: RecordingResult) => void; reject: (error: unknown) => void }>;
  stopPromise?: Promise<RecordingResult>;
  result?: RecordingResult;
  blockerId: number | null;
  source: DesktopCapturerSource | null;
  sessionConfigured: boolean;
}

const PAGE_READY_TIMEOUT = 15000;
const START_TIMEOUT = 25000;
const STOP_TIMEOUT = 10000;
const MAX_COMPLETED = 6;

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

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ToolkitError('TIMEOUT', message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/* ================================================================== 引擎 */

export class RecordingEngine {
  private active: Session | null = null;
  private completed = new Map<string, RecordingState & { result?: RecordingResult }>();
  private stateListeners = new Set<(state: RecordingState) => void>();
  private ipcBound = false;
  private sessionReady = false;

  constructor(private deps: RecordingDeps) {
    this.bindIpc();
    // display-media 处理器在每次开始录制时安装、结束录制时移除，避免长期占用全局 session。
  }

  private get electron() {
    return this.deps.electron;
  }

  /* ---------------------------------------------------------------- session */

  private ensureRecorderSession(): void {
    if (this.sessionReady) return;
    // 使用默认 session：tk:// 协议与主进程统一的权限策略都注册在默认 session 上，
    // 自建 partition 会拿不到 tk://（导致录制页加载失败）。
    const ses = this.electron.session.defaultSession;
    ses.setDisplayMediaRequestHandler(
      async (request, callback) => {
        try {
          const session = this.active;
          if (!session) {
            callback({});
            return;
          }
          const source = await this.resolveSource(session);
          if (!source) {
            callback({});
            return;
          }
          const wantSystem = session.audio === 'system' || session.audio === 'system+mic';
          callback({
            video: source,
            audio: request.audioRequested && wantSystem ? 'loopback' : undefined,
          });
        } catch (err) {
          this.deps.log.warn('[media] 选择录制来源失败', err);
          callback({});
        }
      },
      { useSystemPicker: false }
    );
    this.sessionReady = true;
  }

  private clearRecorderSession(): void {
    if (!this.sessionReady) return;
    this.sessionReady = false;
    try {
      this.electron.session.defaultSession.setDisplayMediaRequestHandler(null);
    } catch {
      /* ignore */
    }
  }

  private async resolveSource(session: Session): Promise<DesktopCapturerSource | null> {
    if (session.source && session.source.id === session.opts.sourceId) return session.source;
    const sources = await this.electron.desktopCapturer.getSources({
      types: [session.kind === 'window' ? 'window' : 'screen'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    });
    const matched = sources.find((source) => source.id === session.opts.sourceId) ?? null;
    session.source = matched;
    return matched;
  }

  /* ---------------------------------------------------------------- IPC */

  private bindIpc(): void {
    if (this.ipcBound) return;
    this.ipcBound = true;
    const ipcMain = this.electron.ipcMain;
    ipcMain.on(IPC.recorderReady, (event) => this.onPageReady(event.sender.id));
    ipcMain.on(IPC.recorderChunk, (event, data) => this.onChunk(event.sender.id, data));
    ipcMain.on(IPC.recorderState, (event, state) => this.onPageState(event.sender.id, state));
    ipcMain.on(IPC.recorderStopped, (event, result) => this.onPageStopped(event.sender.id, result));
    ipcMain.on(IPC.recorderError, (event, message) =>
      this.onPageError(event.sender.id, String(message || '录制页异常'))
    );
  }

  private sessionSenderMatches(session: Session, senderId: number): boolean {
    const win = session.win;
    if (!win || win.isDestroyed()) return false;
    try {
      return win.webContents.id === senderId;
    } catch {
      return false;
    }
  }

  private onPageReady(senderId: number): void {
    const session = this.active;
    if (!session || !this.sessionSenderMatches(session, senderId)) return;
    session.pageReady = true;
    for (const resolve of session.pageReadyWaiters.splice(0)) resolve();
  }

  private toBuffer(data: unknown): Buffer {
    if (Buffer.isBuffer(data)) return data;
    if (data instanceof ArrayBuffer) return Buffer.from(data);
    if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    return Buffer.alloc(0);
  }

  private onChunk(senderId: number, data: unknown): void {
    const session = this.active;
    if (!session || !this.sessionSenderMatches(session, senderId)) return;
    const buf = this.toBuffer(data);
    if (!buf.length) return;
    session.bytes += buf.length;
    const stream = session.stream;
    if (!stream || stream.destroyed) return;
    session.writeChain = session.writeChain
      .then(
        () =>
          new Promise<void>((resolve, reject) => {
            if (stream.destroyed) {
              resolve();
              return;
            }
            stream.write(buf, (err) => (err ? reject(err) : resolve()));
          })
      )
      .catch((err) => {
        this.deps.log.error('[media] 写入录制分片失败', err);
      });
  }

  private onPageState(senderId: number, state: unknown): void {
    const session = this.active;
    if (!session || !this.sessionSenderMatches(session, senderId)) return;
    const phase = (state as { phase?: unknown })?.phase;
    if (phase === 'error') {
      void this.fail(session, new ToolkitError('RECORDING_ERROR', '录制页报告错误'));
    }
  }

  private onPageStopped(senderId: number, result: unknown): void {
    const session = this.active;
    if (!session || !this.sessionSenderMatches(session, senderId)) return;
    const durationMs = Number((result as { durationMs?: unknown })?.durationMs);
    const duration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : session.durationMs;
    void this.finalize(session, duration);
  }

  private onPageError(senderId: number, message: string): void {
    const session = this.active;
    if (!session || !this.sessionSenderMatches(session, senderId)) return;
    void this.fail(session, new ToolkitError('RECORDING_ERROR', message));
  }

  /* ---------------------------------------------------------------- 状态广播 */

  private buildState(session: Session, extras: Record<string, unknown> = {}): RecordingState {
    const state: RecordingState & Record<string, unknown> = {
      id: session.id,
      phase: session.phase,
      startedAt: session.startedAt,
      durationMs: Math.max(0, Math.round(session.durationMs)),
      path: session.path,
      error: session.error,
    };
    if (session.sizeBytes !== undefined) state.sizeBytes = session.sizeBytes;
    state.format = session.format;
    return Object.assign(state, extras) as RecordingState;
  }

  private publish(session: Session, patch: Partial<Session> = {}, extras: Record<string, unknown> = {}): void {
    Object.assign(session, patch);
    session.durationMs =
      session.phase === 'recording' && session.recordingStartedAt
        ? Date.now() - session.recordingStartedAt
        : session.durationMs;
    const state = this.buildState(session, extras);
    for (const listener of this.stateListeners) {
      try {
        listener(state);
      } catch (err) {
        this.deps.log.warn('[media] 录制状态订阅回调异常', err);
      }
    }
  }

  onState(cb: (state: RecordingState) => void): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  /* ---------------------------------------------------------------- start */

  async start(opts: StartRecordingOptions): Promise<{ id: string }> {
    if (this.active && !this.active.completed) {
      throw new ToolkitError('RECORDING_BUSY', '已有录制正在进行，请先停止后再开始');
    }
    if (!opts || typeof opts.sourceId !== 'string' || !opts.sourceId.trim()) {
      throw new ToolkitError('BAD_SOURCE', '请选择要录制的屏幕或窗口');
    }
    try {
      this.ensureRecorderSession();
    } catch (err) {
      throw new ToolkitError('RECORDER_INIT_FAILED', `录制引擎初始化失败：${readableError(err)}`);
    }

    const settings = this.deps.settings.get();
    const kind: 'screen' | 'window' = opts.kind === 'window' ? 'window' : 'screen';
    const audio = normalizeAudio(opts.audio ?? settings.recorder.audio, settings.recorder.audio);
    const fps = normalizeFps(opts.fps ?? settings.recorder.fps, settings.recorder.fps);
    const quality = normalizeQuality(opts.quality ?? settings.recorder.quality, settings.recorder.quality);
    const countdownSec = normalizeCountdown(opts.countdown ?? settings.recorder.countdown, settings.recorder.countdown);

    let maxDurationSec = 0;
    if (Number.isFinite(Number(opts.maxDurationSec)) && Number(opts.maxDurationSec) > 0) {
      maxDurationSec = Math.min(4 * 3600, Math.round(Number(opts.maxDurationSec)));
    } else if (settings.recorder.maxDurationMin > 0) {
      maxDurationSec = Math.round(settings.recorder.maxDurationMin * 60);
    }

    const id = `rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const session: Session = {
      id,
      phase: 'preparing',
      kind,
      opts: { ...opts, kind },
      audio,
      fps,
      quality,
      countdownSec,
      maxDurationSec,
      startedAt: Date.now(),
      recordingStartedAt: 0,
      durationMs: 0,
      format: 'mp4',
      win: null,
      tempPath: '',
      stream: null,
      writeChain: Promise.resolve(),
      bytes: 0,
      timer: null,
      maxTimer: null,
      stopTimeout: null,
      completed: false,
      cancelled: false,
      finalizing: false,
      pageReady: false,
      pageReadyWaiters: [],
      stopWaiters: [],
      blockerId: null,
      source: null,
      sessionConfigured: false,
    };
    this.active = session;
    this.publish(session, { phase: 'preparing' });
    this.deps.log.info('[media] 开始准备录制', id, kind, audio, `${fps}fps`, `q${quality}`, `倒计时${countdownSec}s`);
    void this.run(session).catch((err) => void this.fail(session, err));
    return { id };
  }

  private async run(session: Session): Promise<void> {
    // 面板若还开着，先收起（避免录进面板）；失败也继续，不能因为面板影响录制。
    try {
      await this.deps.hidePanel();
    } catch {
      /* ignore */
    }
    await delay(220);
    if (session.cancelled || session.completed) return;

    await this.openTempStream(session);
    await this.openRecorderWindow(session);
    await this.waitPageReady(session);
    if (session.cancelled || session.completed) return;

    if (session.countdownSec > 0) {
      session.phase = 'countdown';
      for (let left = session.countdownSec; left > 0; left -= 1) {
        if (session.cancelled || session.completed) return;
        this.publish(session, { phase: 'countdown' }, { countdownLeft: left });
        await delay(1000);
      }
      if (session.cancelled || session.completed) return;
    }

    const info = await this.pageStart(session);
    if (session.cancelled || session.completed) return;
    if (!info || info.ok === false) {
      throw new ToolkitError('RECORDING_START_FAILED', info?.error || '录制初始化失败');
    }

    session.format = extFromMime(String(info.mimeType || ''));
    session.recordingStartedAt = Date.now();
    session.phase = 'recording';
    this.publish(session, { phase: 'recording' });

    try {
      session.blockerId = this.electron.powerSaveBlocker.start('prevent-display-sleep');
    } catch (err) {
      this.deps.log.warn('[media] 阻止休眠失败', err);
    }

    session.timer = setInterval(() => {
      const current = this.active;
      if (!current || current !== session || session.completed || session.cancelled) return;
      session.durationMs = Date.now() - session.recordingStartedAt;
      this.publish(session, {}, {});
    }, 1000);

    // 隐藏窗口理论上能持续出帧；若 4 秒仍无数据，切到「屏幕外可见」兜底。
    setTimeout(() => {
      if (session.cancelled || session.completed || session.bytes > 0) return;
      const win = session.win;
      if (!win || win.isDestroyed()) return;
      try {
        win.showInactive();
        this.deps.log.warn('[media] 隐藏录制窗口暂无数据，已切换离屏可见模式');
      } catch {
        /* ignore */
      }
    }, 4000);

    if (session.maxDurationSec > 0) {
      session.maxTimer = setTimeout(() => {
        this.deps.log.info('[media] 达到最长录制时长，自动停止', session.id);
        void this.stop(session.id).catch((err) => void this.fail(session, err));
      }, session.maxDurationSec * 1000);
    }
  }

  private async openTempStream(session: Session): Promise<void> {
    const baseDir = this.deps.paths.temp || this.deps.paths.userData;
    let dir = baseDir;
    try {
      dir = await ensureDir(path.join(baseDir, 'recordings'));
    } catch {
      dir = baseDir;
    }
    session.tempPath = path.join(dir, `${session.id}.part`);
    const stream = fs.createWriteStream(session.tempPath, { flags: 'w' });
    try {
      await new Promise<void>((resolve, reject) => {
        stream.once('open', () => resolve());
        stream.once('error', reject);
      });
    } catch (err) {
      stream.destroy();
      throw new ToolkitError('RECORDER_INIT_FAILED', `无法创建录制临时文件：${readableError(err)}`);
    }
    stream.on('error', (err) => this.deps.log.error('[media] 录制文件写入错误', err));
    session.stream = stream;
  }

  private async openRecorderWindow(session: Session): Promise<void> {
    const paths = this.deps.paths;
    // 构建脚本不同版本可能输出 recorder.cjs 或 recorder.js，两者都兼容。
    const preloadCandidates = [
      path.join(paths.preloadDir, 'recorder.cjs'),
      path.join(paths.preloadDir, 'recorder.js'),
    ];
    const preloadPath = preloadCandidates.find((candidate) => fs.existsSync(candidate)) ?? preloadCandidates[0];
    const win = new this.electron.BrowserWindow({
      show: false,
      width: 480,
      height: 360,
      x: -20000,
      y: -20000,
      frame: false,
      transparent: false,
      backgroundColor: '#070b16',
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      title: '便捷工具录制',
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
        devTools: false,
        spellcheck: false,
      },
    });
    session.win = win;
    session.sessionConfigured = true;

    try {
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    } catch {
      /* ignore */
    }
    win.webContents.on('render-process-gone', (_event, details) => {
      void this.fail(
        session,
        new ToolkitError('RENDERER_GONE', `录制进程异常退出（${details.reason || 'unknown'}）`)
      );
    });
    win.webContents.on('unresponsive', () => {
      this.deps.log.warn('[media] 录制页无响应', session.id);
    });
    win.on('closed', () => {
      session.win = null;
      if (session.completed || session.cancelled || session.finalizing) return;
      void this.fail(session, new ToolkitError('WINDOW_CLOSED', '录制窗口被意外关闭'));
    });

    const fallbackPage = path.join(paths.rendererDir, 'recorder.html');
    try {
      await win.loadURL('tk://app/recorder.html');
    } catch (err) {
      this.deps.log.warn('[media] tk:// 录制页加载失败，尝试本地文件', readableError(err));
      try {
        await win.loadFile(fallbackPage);
      } catch (err2) {
        throw new ToolkitError('RECORDER_PAGE_FAILED', `无法加载录制页：${readableError(err2)}`);
      }
    }
    if (session.cancelled || session.completed) return;
    if (win.isDestroyed()) throw new ToolkitError('RECORDER_PAGE_FAILED', '录制窗口已关闭');
  }

  private waitPageReady(session: Session): Promise<void> {
    if (session.pageReady) return Promise.resolve();
    return withTimeout(
      new Promise<void>((resolve) => {
        session.pageReadyWaiters.push(resolve);
      }),
      PAGE_READY_TIMEOUT,
      '录制页加载超时，请重试'
    );
  }

  private async pageStart(session: Session): Promise<PageStartResult> {
    const win = session.win;
    if (!win || win.isDestroyed()) throw new ToolkitError('RECORDER_PAGE_FAILED', '录制窗口已关闭');
    const config = {
      sourceId: session.opts.sourceId,
      kind: session.kind,
      displayId: session.opts.displayId ?? null,
      audio: session.audio,
      fps: session.fps,
      quality: session.quality,
      formatPref: this.deps.settings.get().recorder.format,
    };
    const code = `window.__tkRecorderStart(${JSON.stringify(config)})`;
    try {
      const info = await withTimeout(
        win.webContents.executeJavaScript(code, true) as Promise<PageStartResult>,
        START_TIMEOUT,
        '开始录制超时，请重试'
      );
      return info ?? { ok: false, error: '录制页未返回结果' };
    } catch (err) {
      throw new ToolkitError('RECORDING_START_FAILED', `开始录制失败：${readableError(err)}`);
    }
  }

  /* ---------------------------------------------------------------- stop / cancel */

  async stop(id: string): Promise<RecordingResult> {
    const session = this.active;
    if (!session || session.id !== id) {
      const done = this.completed.get(id);
      if (done?.result) return done.result;
      throw new ToolkitError('RECORDING_NOT_FOUND', '没有找到对应的录制');
    }
    if (session.phase === 'done' && session.result) return session.result;
    if (session.phase === 'error') {
      throw new ToolkitError('RECORDING_FAILED', session.error || '录制失败');
    }
    if (session.phase === 'cancelled') {
      throw new ToolkitError('RECORDING_CANCELLED', '录制已取消');
    }
    if (session.phase === 'preparing' || session.phase === 'countdown') {
      await this.cancel(id);
      throw new ToolkitError('RECORDING_NOT_STARTED', '录制尚未开始，已取消');
    }
    if (session.phase === 'stopping' && session.stopPromise) return session.stopPromise;

    if (session.timer) {
      clearInterval(session.timer);
      session.timer = null;
    }
    if (session.maxTimer) {
      clearTimeout(session.maxTimer);
      session.maxTimer = null;
    }
    session.phase = 'stopping';
    session.durationMs = Math.max(0, Date.now() - session.recordingStartedAt);
    this.publish(session, { phase: 'stopping' });

    const stopPromise = new Promise<RecordingResult>((resolve, reject) => {
      session.stopWaiters.push({ resolve, reject });
    });
    session.stopPromise = stopPromise;
    if (session.stopTimeout) clearTimeout(session.stopTimeout);
    session.stopTimeout = setTimeout(() => {
      this.deps.log.warn('[media] 录制页停止超时，使用已收到的数据收尾', session.id);
      void this.finalize(session, session.durationMs);
    }, STOP_TIMEOUT);

    try {
      session.win?.webContents.send(IPC.recorderStop);
    } catch (err) {
      this.deps.log.warn('[media] 发送停止指令失败', err);
      void this.finalize(session, session.durationMs);
    }
    return stopPromise;
  }

  async cancel(id: string): Promise<void> {
    const session = this.active;
    if (!session || session.id !== id) {
      if (this.completed.has(id)) return;
      throw new ToolkitError('RECORDING_NOT_FOUND', '没有找到对应的录制');
    }
    if (session.completed) return;
    const wasRecording = session.phase === 'recording' || session.phase === 'stopping';
    const durationMs = session.recordingStartedAt
      ? Math.max(0, Date.now() - session.recordingStartedAt)
      : session.durationMs;
    session.cancelled = true;
    session.completed = true;
    session.phase = 'cancelled';
    this.deps.log.info('[media] 取消录制', id);

    if (wasRecording) {
      try {
        session.win?.webContents.send(IPC.recorderStop);
      } catch {
        /* ignore */
      }
      await delay(300);
    }
    await this.releaseResources(session, true);
    session.durationMs = durationMs;
    this.publish(session, { phase: 'cancelled' });
    this.rejectStopWaiters(session, new ToolkitError('RECORDING_CANCELLED', '录制已取消'));
    this.rememberCompleted(session);
    if (this.active === session) this.active = null;
  }

  /* ---------------------------------------------------------------- 收尾 */

  private async finalize(session: Session, durationMs: number): Promise<void> {
    if (session.completed || session.finalizing || session.cancelled) {
      if (session.result) this.resolveStopWaiters(session, session.result);
      return;
    }
    session.finalizing = true;
    if (session.stopTimeout) {
      clearTimeout(session.stopTimeout);
      session.stopTimeout = null;
    }

    const size = await this.releaseResources(session, false);
    if (session.cancelled) {
      session.finalizing = false;
      return;
    }
    if (!size || size < 128) {
      session.finalizing = false;
      await this.fail(session, new ToolkitError('NO_DATA', '未捕获到任何画面数据（可能窗口已最小化或系统限制捕获），请重试'));
      return;
    }

    let finalPath = '';
    try {
      const settings = this.deps.settings.get();
      const configured = String(settings.recorder.saveDir || '').trim();
      let dir: string;
      try {
        dir = await ensureDir(configured || this.deps.paths.recordings);
      } catch (err) {
        this.deps.log.warn('[media] 录制目录不可用，回退默认目录', configured, err);
        dir = await ensureDir(this.deps.paths.recordings);
      }
      const target = await uniquePath(dir, recordingFileName(session.format));
      await this.moveFile(session.tempPath, target);
      finalPath = target;
    } catch (err) {
      session.finalizing = false;
      await this.fail(session, new ToolkitError('SAVE_FAILED', `保存录制失败：${readableError(err)}`));
      return;
    }

    session.completed = true;
    session.finalizing = false;
    session.format = session.format === 'webm' ? 'webm' : 'mp4';
    session.path = finalPath;
    session.durationMs = Math.max(0, Math.round(Number.isFinite(durationMs) ? durationMs : session.durationMs));
    session.sizeBytes = size;
    session.phase = 'done';
    session.result = {
      path: finalPath,
      durationMs: session.durationMs,
      sizeBytes: size,
      format: session.format,
    };
    this.publish(session, { phase: 'done' });
    this.resolveStopWaiters(session, session.result);
    this.rememberCompleted(session);
    if (this.active === session) this.active = null;
    this.deps.log.info(
      '[media] 录制完成',
      finalPath,
      `${Math.round(session.durationMs / 100) / 10}s`,
      `${Math.round(size / 1024)}KB`
    );
  }

  private async fail(session: Session, err: unknown): Promise<void> {
    if (session.completed) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.rejectStopWaiters(session, error);
      return;
    }
    if (session.finalizing) return;
    session.completed = true;
    session.finalizing = true;
    const message = readableError(err);
    this.deps.log.error('[media] 录制失败', message, err);
    if (session.stopTimeout) {
      clearTimeout(session.stopTimeout);
      session.stopTimeout = null;
    }
    await this.releaseResources(session, true);
    session.finalizing = false;
    session.phase = 'error';
    session.error = message;
    this.publish(session, { phase: 'error' });
    this.rejectStopWaiters(session, err instanceof Error ? err : new Error(message));
    this.rememberCompleted(session);
    if (this.active === session) this.active = null;
  }

  /** 清理定时器 / 窗口 / 写入流 / 休眠锁；返回写入文件大小。 */
  private async releaseResources(session: Session, removeTemp: boolean): Promise<number> {
    if (session.timer) {
      clearInterval(session.timer);
      session.timer = null;
    }
    if (session.maxTimer) {
      clearTimeout(session.maxTimer);
      session.maxTimer = null;
    }
    if (session.blockerId !== null) {
      try {
        if (this.electron.powerSaveBlocker.isStarted(session.blockerId)) {
          this.electron.powerSaveBlocker.stop(session.blockerId);
        }
      } catch {
        /* ignore */
      }
      session.blockerId = null;
    }
    const win = session.win;
    session.win = null;
    if (win && !win.isDestroyed()) {
      try {
        win.destroy();
      } catch {
        /* ignore */
      }
    }
    await session.writeChain.catch(() => undefined);
    let size = 0;
    const stream = session.stream;
    session.stream = null;
    if (stream) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), 3000);
        try {
          stream.end(() => {
            clearTimeout(timer);
            resolve();
          });
        } catch {
          clearTimeout(timer);
          resolve();
        }
      });
    }
    if (session.tempPath) {
      try {
        size = (await fsp.stat(session.tempPath)).size;
      } catch {
        size = session.bytes;
      }
      if (removeTemp) await fsp.rm(session.tempPath, { force: true }).catch(() => undefined);
    } else {
      size = session.bytes;
    }
    // 录制结束后释放全局 display-media 处理器，避免影响其它窗口。
    this.clearRecorderSession();
    return size;
  }

  private async moveFile(source: string, target: string): Promise<void> {
    if (!source) throw new Error('录制临时文件不存在');
    try {
      await fsp.rename(source, target);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'EXDEV') throw err;
    }
    // 跨磁盘：复制后删除临时文件。
    await fsp.copyFile(source, target);
    await fsp.rm(source, { force: true });
  }

  private resolveStopWaiters(session: Session, result: RecordingResult): void {
    for (const waiter of session.stopWaiters.splice(0)) {
      try {
        waiter.resolve(result);
      } catch {
        /* ignore */
      }
    }
  }

  private rejectStopWaiters(session: Session, error: unknown): void {
    for (const waiter of session.stopWaiters.splice(0)) {
      try {
        waiter.reject(error);
      } catch {
        /* ignore */
      }
    }
  }

  private rememberCompleted(session: Session): void {
    this.completed.set(session.id, {
      ...this.buildState(session, {}),
      result: session.result,
    } as RecordingState & { result?: RecordingResult });
    while (this.completed.size > MAX_COMPLETED) {
      const oldest = this.completed.keys().next().value;
      if (oldest === undefined) break;
      this.completed.delete(oldest);
    }
  }

  /* ---------------------------------------------------------------- 查询 */

  async getRecordingState(id: string): Promise<RecordingState> {
    const session = this.active;
    if (session && session.id === id) return this.buildState(session);
    const done = this.completed.get(id);
    if (done) return done;
    throw new ToolkitError('RECORDING_NOT_FOUND', '没有找到对应的录制');
  }

  get activeId(): string | null {
    return this.active?.id ?? null;
  }
}

/* ---------------------------------------------------------------- 单例 */

let sharedEngine: RecordingEngine | null = null;

export function getRecordingEngine(deps: RecordingDeps): RecordingEngine {
  if (!sharedEngine) sharedEngine = new RecordingEngine(deps);
  return sharedEngine;
}
