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
    click: () => void invoke('core', 'ball.click'),
    contextMenu: () => void invoke('core', 'ball.contextMenu'),
    dragStart: () => void invoke('core', 'ball.dragStart'),
    dragMove: (x: number, y: number) => void invoke('core', 'ball.dragMove', { x, y }),
    dragEnd: (x?: number, y?: number, moved?: boolean) => void invoke('core', 'ball.dragEnd', { x, y, moved }),
    setHover: (hovering: boolean) => void invoke('core', 'ball.hover', { hovering }),
    hide: () => void invoke('core', 'ball.setVisible', { visible: false }),
    show: () => void invoke('core', 'ball.setVisible', { visible: true }),
  },
  overlay: {
    init: () => invoke('core', 'overlay.init'),
    select: () => Promise.resolve(),
    cancel: () => undefined,
    setHovering: () => undefined,
  },
  plugin: {
    call: () => Promise.reject(new Error('unsupported')),
    send: () => undefined,
  },
};

contextBridge.exposeInMainWorld('tk', bridge);

