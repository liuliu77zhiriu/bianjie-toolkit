import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { PluginRuntimeInfo, Settings } from '@shared/types';
import { invoke, toast } from '../lib/bridge';
import { registerFrame } from './pluginBus';
import { Icon } from '../ui/Icon';

interface ToolFrameProps {
  plugin: PluginRuntimeInfo;
  settings: Settings;
  onOpenTool: (pluginId: string) => void;
  onClosePanel: () => void;
}

export function ToolFrame({ plugin, settings, onOpenTool, onClosePanel }: ToolFrameProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [token, setToken] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');

  const post = useCallback((msg: Record<string, unknown>) => {
    const frame = frameRef.current;
    if (!frame?.contentWindow) return;
    try {
      frame.contentWindow.postMessage({ __tk: 1, ...msg }, '*');
    } catch {
      /* ignore */
    }
  }, []);

  const sendInit = useCallback(() => {
    const current = settingsRef.current;
    post({
      kind: 'init',
      pluginId: plugin.id,
      host: { kind: 'panel' },
      theme: { accent: current.appearance.accent, animation: current.appearance.animation },
      settings: current,
    });
  }, [plugin.id, post]);

  useEffect(() => {
    const off = registerFrame({
      pluginId: plugin.id,
      post,
      reload: () => {
        setState('loading');
        setError('');
        setToken((value) => value + 1);
      },
    });
    return off;
  }, [plugin.id, post]);

  useEffect(() => {
    const handle = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || data.__tk !== 1) return;
      const kind = data.kind as string;
      if (kind === 'hello') {
        sendInit();
        return;
      }
      if (kind === 'invoke') {
        const id = data.id as string;
        invoke('core', 'plugin.call', {
          pluginId: plugin.id,
          method: data.method,
          args: data.args,
        })
          .then((result) => post({ kind: 'result', id, ok: true, data: result }))
          .catch((err: Error & { code?: string }) => {
            post({
              kind: 'result',
              id,
              ok: false,
              error: { code: err.code || 'PLUGIN_ERROR', message: err.message },
            });
          });
        return;
      }
      if (kind === 'send') {
        window.tk.plugin.send(plugin.id, String(data.topic ?? ''), data.payload);
        return;
      }
      if (kind === 'toast') {
        toast(String(data.message ?? ''), (data.type as 'info' | 'success' | 'error') || 'info');
        return;
      }
      if (kind === 'open-panel') {
        const target = typeof data.pluginId === 'string' ? data.pluginId : plugin.id;
        if (target && target !== plugin.id) onOpenTool(target);
        else onOpenTool(plugin.id);
        return;
      }
      if (kind === 'close-panel') {
        onClosePanel();
        return;
      }
      if (kind === 'log') {
        void invoke('core', 'log.renderer', {
          pluginId: plugin.id,
          level: data.level,
          message: data.message,
          stack: data.stack,
        }).catch(() => undefined);
      }
    };
    window.addEventListener('message', handle as EventListener);
    return () => window.removeEventListener('message', handle as EventListener);
  }, [plugin.id, post, sendInit, onOpenTool, onClosePanel]);

  useEffect(() => {
    post({ kind: 'settings', settings });
    post({ kind: 'theme', theme: { accent: settings.appearance.accent, animation: settings.appearance.animation } });
  }, [settings, post]);

  useEffect(() => {
    setState('loading');
    setError('');
    const timer = setTimeout(() => {
      setState((current) => (current === 'loading' ? 'error' : current));
    }, 10000);
    return () => clearTimeout(timer);
  }, [token, plugin.id]);

  const ui = plugin.manifest.ui || 'index.html';
  const url = `tk://plugin/${plugin.id}/${ui}?tkPlugin=${encodeURIComponent(plugin.id)}&embed=1&v=${token}`;

  if (state === 'error') {
    return (
      <div className="tool-host">
        <div className="tool-error">
          <Icon name="plugin" size={28} />
          <div className="err-title">插件界面加载失败</div>
          <div className="err-detail">{plugin.error || error || '界面资源缺失或插件已损坏，可在「设置 → 扩展 → 代码编辑」中检查。'}</div>
          <div className="tk-row">
            <button
              className="tk-btn sm"
              onClick={() => {
                setState('loading');
                setToken((value) => value + 1);
              }}
            >
              <Icon name="refresh" size={13} />
              重试
            </button>
            <button className="tk-btn sm ghost" onClick={() => onOpenTool('settings')}>
              打开设置
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tool-host">
      <iframe
        key={token}
        ref={frameRef}
        className={`tool-frame${state === 'ready' ? ' ready' : ''}`}
        title={plugin.manifest.name}
        data-plugin={plugin.id}
        src={url}
        sandbox="allow-scripts allow-forms allow-popups allow-modals"
        onLoad={() => {
          setState('ready');
          sendInit();
        }}
      />
      <div className={`tool-loading${state === 'ready' ? ' hidden' : ''}`}>
        <div className="spinner" />
        <div>正在加载 {plugin.manifest.name}…</div>
      </div>
    </div>
  );
}

export function ToolSkeleton({ style }: { style?: CSSProperties }) {
  return <div className="tool-host" style={style} />;
}
