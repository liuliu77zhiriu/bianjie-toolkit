/**
 * 插件独立窗口的桥：在 preload（隔离世界）中转发页面 SDK 的 postMessage 到主进程。
 * 页面侧统一使用 tk://plugin-sdk/sdk.js，无需区分 iframe / 独立窗口。
 */
import { ipcRenderer } from 'electron';
import { IPC } from '../shared/defaults';

function getArg(name: string): string {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
}

const pluginId = getArg('tk-plugin-id');
const windowKey = getArg('tk-window-key');

interface Envelope {
  __tk: 1;
  kind: string;
  id?: string;
  method?: string;
  args?: unknown;
  topic?: string;
  payload?: unknown;
  message?: string;
  type?: string;
  stack?: string;
  pluginId?: string;
  level?: string;
}

async function coreCall(service: string, method: string, args?: unknown): Promise<unknown> {
  const result = (await ipcRenderer.invoke(IPC.call, { service, method, args })) as
    | { ok: true; data: unknown }
    | { ok: false; error: { code: string; message: string; detail?: string } };
  if (!result || typeof result !== 'object') return null;
  if (!result.ok) {
    const err = new Error(result.error?.message || '调用失败');
    (err as unknown as { code?: string }).code = result.error?.code;
    throw err;
  }
  return result.data;
}

function postToPage(msg: Record<string, unknown>) {
  try {
    window.postMessage({ __tk: 1, ...msg }, '*');
  } catch {
    /* ignore */
  }
}

async function handleMessage(event: MessageEvent) {
  const data = event.data as Envelope;
  if (!data || data.__tk !== 1) return;
  try {
    switch (data.kind) {
      case 'hello': {
        const settings = (await coreCall('core', 'settings.get')) as {
          appearance?: { accent?: string; animation?: string };
        };
        postToPage({
          kind: 'init',
          pluginId,
          host: { kind: 'window', windowKey },
          theme: {
            accent: settings?.appearance?.accent,
            animation: settings?.appearance?.animation,
          },
          settings,
        });
        break;
      }
      case 'invoke': {
        try {
          const dataResult = await coreCall('core', 'plugin.call', {
            pluginId,
            method: data.method,
            args: data.args,
          });
          postToPage({ kind: 'result', id: data.id, ok: true, data: dataResult });
        } catch (err) {
          postToPage({
            kind: 'result',
            id: data.id,
            ok: false,
            error: {
              code: (err as { code?: string }).code || 'PLUGIN_ERROR',
              message: err instanceof Error ? err.message : String(err),
            },
          });
        }
        break;
      }
      case 'send':
        ipcRenderer.send(IPC.pluginEvent, {
          pluginId,
          topic: data.topic,
          payload: data.payload,
        });
        break;
      case 'open-panel':
        void coreCall('core', 'panel.openTool', { pluginId: data.pluginId || pluginId });
        break;
      case 'close-panel':
        void coreCall('core', 'panel.close');
        break;
      case 'log':
        void coreCall('core', 'log.renderer', {
          pluginId,
          level: data.level || 'error',
          message: data.message,
          stack: data.stack,
        });
        break;
      default:
        break;
    }
  } catch (err) {
    console.warn('[plugin-window] message handling failed', err);
  }
}

window.addEventListener('message', (event) => {
  void handleMessage(event as MessageEvent);
});

ipcRenderer.on(IPC.event, (_event, msg: { topic?: string; payload?: unknown }) => {
  if (!msg?.topic) return;
  if (msg.topic === 'settings:changed') {
    postToPage({ kind: 'settings', settings: msg.payload });
    const settings = msg.payload as { appearance?: { accent?: string; animation?: string } };
    postToPage({
      kind: 'theme',
      theme: { accent: settings?.appearance?.accent, animation: settings?.appearance?.animation },
    });
    return;
  }
  postToPage({ kind: 'event', topic: msg.topic, payload: msg.payload });
});

