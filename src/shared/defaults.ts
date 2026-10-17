import type { Settings } from './types';

export const APP_NAME = '便捷工具';
export const APP_ID = 'com.bianjie.toolkit';
export const SETTINGS_VERSION = 1;

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  general: {
    launchAtLogin: false,
    showBall: true,
    closePanelOnBlur: false,
    rememberPanelSize: false,
  },
  appearance: {
    accent: '#4C8DFF',
    panelOpacity: 0.86,
    blur: true,
    animation: 'full',
    ballSize: 56,
    ballOpacity: 1,
    ballAutoHide: true,
    ballEdgeSnap: true,
    alwaysOnTop: false,
    showDock: true,
  },
  shortcuts: {
    togglePanel: 'Alt+Space',
    screenshotRegion: 'Alt+A',
    screenshotFull: 'Alt+S',
    recordToggle: 'Alt+R',
    memo: 'Alt+M',
  },
  capture: {
    saveDir: '',
    format: 'png',
    copyToClipboard: true,
    showPanelAfter: true,
    playSound: false,
  },
  recorder: {
    saveDir: '',
    fps: 30,
    quality: 85,
    audio: 'system',
    countdown: 3,
    format: 'auto',
    maxDurationMin: 0,
  },
  data: {
    autoBackup: true,
    backupKeepDays: 14,
  },
  plugins: {
    disabled: [],
  },
};

export const ACCENT_PRESETS = [
  { name: '星蓝', value: '#4C8DFF' },
  { name: '青岚', value: '#46D7D1' },
  { name: '极光', value: '#8A7BFF' },
  { name: '琥珀', value: '#FFB454' },
  { name: '玫红', value: '#FF6B9A' },
];

export const ANIMATION_OPTIONS = [
  { value: 'full', label: '完整', hint: 'Q 弹与弹性滑动' },
  { value: 'lite', label: '轻量', hint: '仅保留必要过渡' },
  { value: 'off', label: '关闭', hint: '完全禁用动画' },
] as const;

export const IPC = {
  call: 'tk:call',
  pluginCall: 'tk:plugin-call',
  pluginEvent: 'tk:plugin-event',
  event: 'tk:event',
  ballClick: 'tk:ball:click',
  ballContextMenu: 'tk:ball:context-menu',
  ballDragStart: 'tk:ball:drag-start',
  ballDragMove: 'tk:ball:drag-move',
  ballDragEnd: 'tk:ball:drag-end',
  ballHover: 'tk:ball:hover',
  ballHide: 'tk:ball:hide',
  ballShow: 'tk:ball:show',
  panelReady: 'tk:panel:ready',
  panelClose: 'tk:panel:close',
  panelHide: 'tk:panel:hide',
  panelMinimize: 'tk:panel:minimize',
  panelOpenTool: 'tk:panel:open-tool',
  panelSetHeight: 'tk:panel:set-height',
  panelGetState: 'tk:panel:get-state',
  overlayInit: 'tk:overlay:init',
  overlaySelect: 'tk:overlay:select',
  overlayCancel: 'tk:overlay:cancel',
  overlayHover: 'tk:overlay:hover',
  recorderReady: 'tk:recorder:ready',
  recorderStart: 'tk:recorder:start',
  recorderChunk: 'tk:recorder:chunk',
  recorderStop: 'tk:recorder:stop',
  recorderStopped: 'tk:recorder:stopped',
  recorderState: 'tk:recorder:state',
  recorderError: 'tk:recorder:error',
} as const;
