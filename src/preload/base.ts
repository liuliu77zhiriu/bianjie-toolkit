import { ipcRenderer } from 'electron';
import { IPC } from '../shared/defaults';

export interface BridgeErrorShape {
  code: string;
  message: string;
  detail?: string;
}

export class BridgeError extends Error {
  code: string;
  detail?: string;
  constructor(error: BridgeErrorShape) {
    super(error.message);
    this.name = 'BridgeError';
    this.code = error.code;
    this.detail = error.detail;
  }
}

export async function invoke<T = unknown>(service: string, method: string, args?: unknown): Promise<T> {
  const result = (await ipcRenderer.invoke(IPC.call, { service, method, args })) as
    | { ok: true; data: T }
    | { ok: false; error: BridgeErrorShape };
  if (!result || typeof result !== 'object') return undefined as T;
  if (!result.ok) throw new BridgeError(result.error);
  return result.data;
}

export function makeEventBus() {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const anyListeners = new Set<(msg: { topic: string; payload?: unknown; pluginId?: string }) => void>();
  const off = (topic: string, fn: (payload: unknown) => void) => {
    listeners.get(topic)?.delete(fn);
  };
  const on = (topic: string, fn: (payload: unknown) => void) => {
    let set = listeners.get(topic);
    if (!set) {
      set = new Set();
      listeners.set(topic, set);
    }
    set.add(fn);
    return () => off(topic, fn);
  };
  const onAny = (fn: (msg: { topic: string; payload?: unknown; pluginId?: string }) => void) => {
    anyListeners.add(fn);
    return () => anyListeners.delete(fn);
  };
  ipcRenderer.on(IPC.event, (_event, msg: { topic?: string; payload?: unknown; pluginId?: string }) => {
    if (!msg?.topic) return;
    const normalized = { topic: msg.topic, payload: msg.payload, pluginId: msg.pluginId };
    for (const fn of anyListeners) {
      try {
        fn(normalized);
      } catch {
        /* ignore */
      }
    }
    for (const fn of listeners.get(msg.topic) ?? []) {
      try {
        fn(msg.payload);
      } catch {
        /* ignore */
      }
    }
  });
  return { on, off, onAny };
}

