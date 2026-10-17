import { ipcMain, type WebContents } from 'electron';
import { IPC } from '../../shared/defaults';
import type { CallResult } from '../../shared/types';
import { toTkError } from './errors';
import type { Logger } from './logger';

export type Handler = (args: unknown, meta: ClientMeta) => unknown | Promise<unknown>;

export type ClientKind = 'panel' | 'ball' | 'plugin-window' | 'overlay';

export interface ClientMeta {
  kind: ClientKind;
  pluginId?: string;
  windowKey?: string;
  webContentsId: number;
}

interface ClientRecord {
  webContents: WebContents;
  meta: ClientMeta;
}

/** 统一 IPC 路由器：服务名 + 方法名，自动错误封装。 */
export class IpcHub {
  private handlers = new Map<string, Map<string, Handler>>();
  private clients = new Map<number, ClientRecord>();

  constructor(private logger: Logger) {}

  handle(service: string, method: string, handler: Handler, replace = true): () => void {
    let bucket = this.handlers.get(service);
    if (!bucket) {
      bucket = new Map();
      this.handlers.set(service, bucket);
    }
    if (!replace && bucket.has(method)) {
      throw new Error(`IPC 方法重复注册: ${service}.${method}`);
    }
    bucket.set(method, handler);
    return () => {
      const current = this.handlers.get(service);
      if (current?.get(method) === handler) current.delete(method);
    };
  }

  removeService(service: string) {
    this.handlers.delete(service);
  }

  async call(service: string, method: string, args: unknown, meta: ClientMeta): Promise<CallResult> {
    const handler = this.handlers.get(service)?.get(method);
    if (!handler) {
      return { ok: false, error: { code: 'NO_HANDLER', message: `未注册的方法：${service}.${method}` } };
    }
    try {
      const data = await handler(args, meta);
      return { ok: true, data: data ?? null };
    } catch (err) {
      return { ok: false, error: toTkError(err) };
    }
  }

  registerClient(webContents: WebContents, meta: Omit<ClientMeta, 'webContentsId'>): ClientMeta {
    const full: ClientMeta = { ...meta, webContentsId: webContents.id };
    this.clients.set(webContents.id, { webContents, meta: full });
    webContents.once('destroyed', () => this.clients.delete(webContents.id));
    return full;
  }

  unregisterClient(id: number) {
    this.clients.delete(id);
  }

  getClient(id: number): ClientMeta | undefined {
    return this.clients.get(id)?.meta;
  }

  private dispatch(record: ClientRecord, topic: string, payload: unknown, extra?: Record<string, unknown>) {
    if (record.webContents.isDestroyed()) return;
    try {
      record.webContents.send(IPC.event, { topic, payload, ...extra });
    } catch (err) {
      this.logger.warn('[ipc] 发送事件失败', topic, err);
    }
  }

  sendTo(kind: ClientKind, topic: string, payload?: unknown, extra?: Record<string, unknown>) {
    for (const record of this.clients.values()) {
      if (record.meta.kind === kind) this.dispatch(record, topic, payload, extra);
    }
  }

  broadcast(topic: string, payload?: unknown, filter?: (meta: ClientMeta) => boolean) {
    for (const record of this.clients.values()) {
      if (filter && !filter(record.meta)) continue;
      this.dispatch(record, topic, payload);
    }
  }

  /** 插件事件：面板（由其转发给对应 iframe）与插件独立窗口都能收到 */
  broadcastPlugin(pluginId: string, topic: string, payload?: unknown) {
    for (const record of this.clients.values()) {
      if (record.meta.kind === 'panel') {
        this.dispatch(record, topic, payload, { pluginId });
      } else if (record.meta.kind === 'plugin-window' && record.meta.pluginId === pluginId) {
        this.dispatch(record, topic, payload, { pluginId });
      }
    }
  }

  installIpcMain(onCall: (args: any, meta: ClientMeta) => Promise<CallResult>) {
    ipcMain.handle(IPC.call, (event, request) => {
      const meta = this.getClient(event.sender.id) ?? { kind: 'panel', webContentsId: event.sender.id };
      return onCall(request, meta);
    });
  }

  dispose() {
    ipcMain.removeHandler(IPC.call);
    this.handlers.clear();
    this.clients.clear();
  }
}
