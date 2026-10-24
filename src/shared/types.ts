/**
 * 主进程 / 渲染进程 / 插件后端共享的类型定义。
 * 修改这里时请同步 docs/ARCHITECTURE.md 与 docs/PLUGIN_SDK.md。
 */

/* ------------------------------------------------------------------ 基础 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TkError {
  code: string;
  message: string;
  detail?: string;
}

export type CallResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: TkError };

export interface AppPaths {
  userData: string;
  screenshots: string;
  recordings: string;
  logs: string;
  plugins: string;
  overrides: string;
  backups: string;
  temp: string;
  appRoot: string;
  rendererDir: string;
  preloadDir: string;
  resourcesDir: string;
}

/* ------------------------------------------------------------------ 设置 */

export type AnimationLevel = 'full' | 'lite' | 'off';
export type AudioSource = 'none' | 'system' | 'mic' | 'system+mic';
export type CaptureFormat = 'png' | 'jpg';

export interface Settings {
  version: number;
  general: {
    launchAtLogin: boolean;
    showBall: boolean;
    closePanelOnBlur: boolean;
    rememberPanelSize: boolean;
  };
  appearance: {
    accent: string;
    panelOpacity: number;
    blur: boolean;
    animation: AnimationLevel;
    ballSize: number;
    ballOpacity: number;
    ballAutoHide: boolean;
    ballEdgeSnap: boolean;
    /** 贴边半隐藏：鼠标靠近时自动弹出，离开后藏回边缘 */
    ballEdgeHide: boolean;
    alwaysOnTop: boolean;
    showDock: boolean;
    /** 壁纸选择器：'' | 'builtin:<id>' | 'user:<filename>' */
    wallpaper: string;
    /** 面板内壁纸可见度 0.05 ~ 0.8 */
    wallpaperOpacity: number;
  };
  shortcuts: {
    togglePanel: string;
    screenshotRegion: string;
    screenshotFull: string;
    recordToggle: string;
    memo: string;
  };
  capture: {
    saveDir: string;
    format: CaptureFormat;
    copyToClipboard: boolean;
    showPanelAfter: boolean;
    playSound: boolean;
  };
  recorder: {
    saveDir: string;
    fps: number;
    quality: number;
    audio: AudioSource;
    countdown: number;
    format: 'auto' | 'mp4' | 'webm';
    maxDurationMin: number;
  };
  data: {
    autoBackup: boolean;
    backupKeepDays: number;
  };
  plugins: {
    disabled: string[];
  };
}

export type SettingsSection = keyof Omit<Settings, 'version'>;

export type SettingsPatch = {
  [K in SettingsSection]?: Partial<Settings[K]>;
};

/* ------------------------------------------------------------------ 个性化 */

export interface WallpaperItem {
  /** 唯一 id：内置为 manifest id，用户为文件名 */
  id: string;
  name: string;
  /** 写入设置的选择器：builtin:<id> / user:<filename> */
  selector: string;
  source: 'builtin' | 'user';
  /** tk://file/... 可直接给 img / CSS 使用 */
  url: string;
  /** 磁盘绝对路径（仅主进程语义） */
  file: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
}

export interface WallpaperCurrent {
  selector: string;
  url: string;
  opacity: number;
  name: string;
}

export interface ThemeTokens {
  accent: string;
  panelOpacity: number;
  blur: boolean;
  animation: AnimationLevel;
  wallpaper: string;
  wallpaperOpacity: number;
  ballEdgeHide: boolean;
  showDock: boolean;
}

export interface ThemePreset {
  id: string;
  name: string;
  description?: string;
  builtin: boolean;
  tokens: ThemeTokens;
}

/* ------------------------------------------------------------------ 插件 */

export interface PluginCommandDef {
  id: string;
  label: string;
  description?: string;
  defaultAccelerator?: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  description?: string;
  version: string;
  icon?: string;
  accent?: string;
  order?: number;
  entry?: string;
  ui?: string;
  builtin?: boolean;
  hidden?: boolean;
}

export type PluginSourceKind = 'builtin' | 'user';

export interface PluginRuntimeInfo {
  id: string;
  manifest: PluginManifest;
  source: PluginSourceKind;
  enabled: boolean;
  loaded: boolean;
  error?: string;
  customized: boolean;
  overriddenFiles: string[];
  hasUI: boolean;
  commands: PluginCommandDef[];
}

export interface PluginCommandInfo extends PluginCommandDef {
  pluginId: string;
  pluginName: string;
  accelerator?: string;
}

export interface PluginFileEntry {
  path: string;
  size: number;
  overridden: boolean;
  editable: boolean;
  language: 'javascript' | 'json' | 'html' | 'css' | 'text';
}

export interface PluginFilesPayload {
  id: string;
  manifest: PluginManifest;
  files: PluginFileEntry[];
  /** 被用户删除（墓碑标记）的基座文件，可恢复 */
  deletedFiles?: string[];
  baseDir: string;
  overrideDir: string;
  customized: boolean;
  errors?: string[];
}

export interface PluginEditResult {
  ok: boolean;
  error?: TkError;
  reloaded?: boolean;
}

export interface PluginWindowOptions {
  key: string;
  page?: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  frame?: boolean;
  transparent?: boolean;
  alwaysOnTop?: boolean;
  skipTaskbar?: boolean;
  resizable?: boolean;
  focusable?: boolean;
  position?: 'center' | 'top-right' | 'bottom-right' | { x: number; y: number };
  hideOnClose?: boolean;
  show?: boolean;
  /** 打开时是否抢占焦点（默认 false，避免打断输入/导致面板失焦关闭） */
  focusOnOpen?: boolean;
}

export interface PluginWindowHandle {
  key: string;
  id: number;
}

/* ------------------------------------------------------------------ 媒体 */

export interface MediaSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  displayId?: string;
  thumbnail: string;
  appIcon?: string;
}

export interface CaptureResult {
  path: string;
  width: number;
  height: number;
  copied: boolean;
  preview?: string;
  format: CaptureFormat;
}

export interface CaptureOptions {
  displayId?: string;
  sourceId?: string;
  rect?: Rect;
  copy?: boolean;
  /** 截图前隐藏主面板，默认 true */
  hidePanel?: boolean;
}

export interface StartRecordingOptions {
  sourceId: string;
  kind: 'screen' | 'window';
  displayId?: string;
  fps?: number;
  quality?: number;
  audio?: AudioSource;
  countdown?: number;
  maxDurationSec?: number;
}

export type RecordingPhase = 'preparing' | 'countdown' | 'recording' | 'stopping' | 'done' | 'error' | 'cancelled';

export interface RecordingState {
  id: string;
  phase: RecordingPhase;
  startedAt: number;
  durationMs: number;
  path?: string;
  error?: string;
}

export interface RecordingResult {
  path: string;
  durationMs: number;
  sizeBytes: number;
  format: 'mp4' | 'webm';
}

export interface MediaApi {
  listSources(opts?: { kinds?: Array<'screen' | 'window'>; thumbnailWidth?: number }): Promise<MediaSource[]>;
  captureFullscreen(opts?: CaptureOptions): Promise<CaptureResult>;
  captureWindow(opts: CaptureOptions & { sourceId: string }): Promise<CaptureResult>;
  captureRegion(opts: CaptureOptions & { rect: Rect; displayId?: string }): Promise<CaptureResult>;
  startRecording(opts: StartRecordingOptions): Promise<{ id: string }>;
  stopRecording(id: string): Promise<RecordingResult>;
  cancelRecording(id: string): Promise<void>;
  getRecordingState(id: string): Promise<RecordingState>;
  onState(cb: (state: RecordingState) => void): () => void;
}

export interface MediaDeps {
  settings: {
    get(): Settings;
    onChange(cb: (settings: Settings) => void): () => void;
  };
  paths: AppPaths;
  log: {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
  notify(opts: { title: string; body?: string }): void;
  electron: typeof import('electron');
  /** 隐藏/恢复主面板（截图流程使用） */
  hidePanel(): Promise<void>;
  showPanel(): Promise<void>;
}

/* ------------------------------------------------------------------ 区域框选 */

export interface RegionPickResult {
  displayId: string;
  rect: Rect;
  scaleFactor: number;
}

/* ------------------------------------------------------------------ 命令 */

export interface CommandInfo {
  id: string;
  label: string;
  description?: string;
  pluginId: string;
  pluginName: string;
  accelerator?: string;
  registeredAt: number;
}

/* ------------------------------------------------------------------ 应用信息 */

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  locale: string;
  isPackaged: boolean;
  paths: AppPaths;
  userDataSize?: number;
}

export interface BallState {
  visible: boolean;
  x: number;
  y: number;
  size: number;
}

/* ------------------------------------------------------------------ IPC */

export interface PreloadInfo {
  platform: string;
  versions: { electron: string; chrome: string; node: string; app: string };
  isPackaged: boolean;
}

export type EventListener = (payload: unknown) => void;

export interface TkEventMessage {
  topic: string;
  payload?: unknown;
  pluginId?: string;
}

export interface PreloadInfo {
  platform: string;
  versions: { electron: string; chrome: string; node: string; app: string };
  isPackaged: boolean;
}

/** window.tk —— preload 暴露给渲染进程的受控 API */
export interface TkBridge {
  info: PreloadInfo;
  invoke<T = unknown>(service: string, method: string, args?: unknown): Promise<T>;
  on(topic: string, listener: EventListener): () => void;
  onAny(listener: (msg: TkEventMessage) => void): () => void;
  panel: {
    ready(): void;
    close(): void;
    hide(): void;
    minimize(): void;
    openTool(pluginId: string): void;
    setHeight(height: number): void;
    getState(): Promise<{ open: boolean }>;
  };
  ball: {
    click(): void;
    contextMenu(): void;
    dragStart(): void;
    dragMove(x: number, y: number): void;
    dragEnd(x?: number, y?: number, moved?: boolean): void;
    setHover(hovering: boolean): void;
    hide(): void;
    show(): void;
  };
  overlay: {
    init(): Promise<{ displayId: string; bounds: Rect; scaleFactor: number; hint?: string }>;
    select(rect: Rect): Promise<void>;
    cancel(): void;
    setHovering(hover: boolean): void;
  };
  plugin: {
    call<T = unknown>(pluginId: string, method: string, args?: unknown): Promise<T>;
    send(pluginId: string, topic: string, payload?: unknown): void;
  };
  /** 仅设置窗口 preload 提供 */
  settingsWindow?: {
    ready(): void;
    close(): void;
    minimize(): void;
  };
  /** 仅流光搜索窗口 preload 提供 */
  searchWindow?: {
    ready(): void;
    close(): void;
    minimize(): void;
    toggleMaximize(): void;
  };
  /** 仅 UI 编辑器窗口 preload 提供 */
  editor?: {
    ready(): void;
    close(): void;
    minimize(): void;
    toggleMaximize(): void;
  };
}

declare global {
  interface Window {
    tk: TkBridge;
  }
}




