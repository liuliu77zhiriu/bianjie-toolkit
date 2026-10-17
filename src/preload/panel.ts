import { contextBridge, ipcRenderer } from 'electron';
import { invoke, makeEventBus } from './base';
import type { PreloadInfo, TkBridge } from '../shared/types';
import { IPC } from '../shared/defaults';

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
    ready: () => void invoke('core', 'panel.ready'),
    close: () => void invoke('core', 'panel.close'),
    hide: () => void invoke('core', 'panel.hide'),
    minimize: () => void invoke('core', 'panel.minimize'),
    openTool: (pluginId: string) => void invoke('core', 'panel.openTool', { pluginId }),
    setHeight: () => undefined,
    getState: () => invoke('core', 'panel.state'),
  },
  ball: {
    click: () => void invoke('core', 'ball.click'),
    contextMenu: () => void invoke('core', 'ball.contextMenu'),
    dragStart: () => void invoke('core', 'ball.dragStart'),
    dragMove: (x: number, y: number) => void invoke('core', 'ball.dragMove', { x, y }),
    dragEnd: (x?: number, y?: number, moved?: boolean) => void invoke('core', 'ball.dragEnd', { x, y, moved }),
    setHover: () => undefined,
    hide: () => void invoke('core', 'ball.setVisible', { visible: false }),
    show: () => void invoke('core', 'ball.setVisible', { visible: true }),
  },
  overlay: {
    init: () => invoke('core', 'overlay.init'),
    select: (rect) => invoke('core', 'overlay.select', { rect }).then(() => undefined),
    cancel: () => void invoke('core', 'overlay.cancel'),
    setHovering: () => undefined,
  },
  plugin: {
    call: (pluginId: string, method: string, args?: unknown) => invoke('plugin', 'call', { pluginId, method, args }),
    send: (pluginId: string, topic: string, payload?: unknown) => {
      ipcRenderer.send(IPC.pluginEvent, { pluginId, topic, payload });
    },
  },
};

void IPC;
contextBridge.exposeInMainWorld('tk', bridge);
