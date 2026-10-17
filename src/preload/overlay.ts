import { contextBridge } from 'electron';
import { invoke, makeEventBus } from './base';
import type { PreloadInfo, TkBridge } from '../shared/types';

const events = makeEventBus();

const info: PreloadInfo = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    app: '1.0.0',
  },
  isPackaged: false,
};

const bridge: TkBridge = {
  info,
  invoke,
  on: events.on,
  onAny: events.onAny,
  panel: {
    ready: () => undefined,
    close: () => undefined,
    hide: () => undefined,
    minimize: () => undefined,
    openTool: () => undefined,
    setHeight: () => undefined,
    getState: () => invoke('core', 'panel.state'),
  },
  ball: {
    click: () => undefined,
    contextMenu: () => undefined,
    dragStart: () => undefined,
    dragMove: () => undefined,
    dragEnd: () => undefined,
    setHover: () => undefined,
    hide: () => undefined,
    show: () => undefined,
  },
  overlay: {
    init: () => invoke('core', 'overlay.init'),
    select: (rect) => invoke('core', 'overlay.select', { rect }).then(() => undefined),
    cancel: () => void invoke('core', 'overlay.cancel'),
    setHovering: () => undefined,
  },
  plugin: {
    call: () => Promise.reject(new Error('unsupported')),
    send: () => undefined,
  },
};

contextBridge.exposeInMainWorld('tk', bridge);
