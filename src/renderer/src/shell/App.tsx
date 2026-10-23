import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { PluginRuntimeInfo, Settings } from '@shared/types';
import {
  invoke,
  on,
  onAny,
  runCommand,
  toast,
  useCommands,
  useElasticScroll,
  usePlugins,
  useSettings,
  useWallpaper,
} from '../lib/bridge';
import { Header } from './Header';
import { Dock, type DockItem } from './Dock';
import { HomePage } from './HomePage';
import { Toaster } from './Toaster';
import { ToolFrame } from './ToolFrame';
import {
  dispatchPluginEvent,
  notifyPanelVisibility,
  reloadPluginFrame,
} from './pluginBus';
import { Icon } from '../ui/Icon';

type View = { kind: 'home' } | { kind: 'tool'; pluginId: string };

const DOCK_DEFS: Array<DockItem & { plugin?: boolean; always?: boolean }> = [
  { id: 'home', label: '首页', icon: 'home', always: true },
  { id: 'screenshot', label: '截图', icon: 'camera', plugin: true },
  { id: 'memo', label: '备忘录', icon: 'note', plugin: true },
  { id: 'timer', label: '计时器', icon: 'timer', plugin: true },
  { id: 'settings', label: '设置', icon: 'settings', always: true },
];

function accentRgb(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return '76, 141, 255';
  const value = parseInt(match[1], 16);
  return `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`;
}

function viewKey(view: View): string {
  if (view.kind === 'home') return 'home';
  return `tool:${view.pluginId}`;
}

export default function App() {
  const settings = useSettings();
  const plugins = usePlugins();
  const commands = useCommands();
  const wallpaper = useWallpaper();
  useElasticScroll();

  const [stack, setStack] = useState<View[]>([{ kind: 'home' }]);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [pageKey, setPageKey] = useState(0);
  const [opening, setOpening] = useState(false);
  const [closing, setClosing] = useState(false);
  const openTimer = useRef<number | null>(null);
  const current = stack[stack.length - 1];

  const currentPlugin: PluginRuntimeInfo | null =
    current.kind === 'tool' ? plugins.find((plugin) => plugin.id === current.pluginId) ?? null : null;

  const replayOpening = useCallback(() => {
    setClosing(false);
    setOpening(false);
    window.requestAnimationFrame(() => {
      setOpening(true);
      if (openTimer.current) window.clearTimeout(openTimer.current);
      openTimer.current = window.setTimeout(() => setOpening(false), 720);
    });
  }, []);

  const resetTo = useCallback((next: View[]) => {
    setDirection('forward');
    setStack(next);
    setPageKey((value) => value + 1);
  }, []);

  const navigate = useCallback((view: View, dir: 'forward' | 'back' = 'forward') => {
    setDirection(dir);
    setStack((previous) => [...previous, view]);
    setPageKey((value) => value + 1);
  }, []);

  const goBack = useCallback(() => {
    setDirection('back');
    setStack((previous) => (previous.length > 1 ? previous.slice(0, -1) : previous));
    setPageKey((value) => value + 1);
  }, []);

  const openSettings = useCallback((tab?: string) => {
    void invoke('core', 'settings.openWindow', { tab }).catch(() => toast('打开设置窗口失败', 'error'));
  }, []);

  const openTool = useCallback(
    (pluginId: string) => {
      if (pluginId === 'settings' || pluginId === 'settings:plugins') {
        openSettings(pluginId.includes(':') ? 'plugins' : undefined);
        return;
      }
      const plugin = plugins.find((item) => item.id === pluginId);
      if (!plugin) {
        toast('工具不存在，请检查插件设置', 'error');
        return;
      }
      if (!plugin.enabled) {
        toast(`「${plugin.manifest.name}」已禁用`, 'error');
        return;
      }
      if (!plugin.hasUI) {
        toast('该工具没有界面，可在设置中配置', 'error');
        return;
      }
      if (current.kind === 'tool' && current.pluginId === pluginId) return;
      navigate({ kind: 'tool', pluginId });
    },
    [plugins, navigate, current, openSettings]
  );

  const runQuickAction = useCallback((commandId: string) => {
    runCommand(commandId)
      .then(() => undefined)
      .catch((err: Error) => {
        toast(err.message || '操作失败，请稍后再试', 'error');
      });
  }, []);

  useEffect(() => {
    window.tk.panel.ready();
  }, []);

  useEffect(() => {
    const offOpening = on('panel:opening', (payload) => {
      replayOpening();
      const toolId = (payload as { toolId?: string } | null)?.toolId;
      if (toolId === 'settings') openSettings();
      else if (toolId) resetTo([{ kind: 'home' }, { kind: 'tool', pluginId: toolId }]);
      else resetTo([{ kind: 'home' }]);
    });
    const offShown = on('panel:open', () => {
      notifyPanelVisibility(true);
    });
    const offClosing = on('panel:closing', () => {
      setClosing(true);
      notifyPanelVisibility(false);
    });
    const offAny = onAny((msg) => {
      if (msg.pluginId) {
        dispatchPluginEvent(msg.pluginId, msg.topic, msg.payload);
        return;
      }
      if (msg.topic === 'plugin:reloaded') {
        const pluginId = (msg.payload as { pluginId?: string } | undefined)?.pluginId;
        if (pluginId) reloadPluginFrame(pluginId);
      }
    });
    return () => {
      offOpening();
      offShown();
      offClosing();
      offAny();
    };
  }, [replayOpening, resetTo, openSettings]);

  useEffect(() => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (stack.length > 1) goBack();
      else window.tk.panel.close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [stack.length, goBack]);

  useEffect(() => {
    if (current.kind === 'tool' && currentPlugin && !currentPlugin.enabled) {
      goBack();
    }
  }, [current, currentPlugin, goBack]);

  const dockItems = useMemo(
    () =>
      DOCK_DEFS.filter((item) => {
        if (item.always) return true;
        const plugin = plugins.find((p) => p.id === item.id);
        return !!plugin && plugin.enabled && plugin.hasUI;
      }).map(({ id, label, icon }) => ({ id, label, icon })),
    [plugins]
  );

  const activeDockId = useMemo(() => {
    if (current.kind === 'home') return 'home';
    return dockItems.some((item) => item.id === current.pluginId) ? current.pluginId : null;
  }, [current, dockItems]);

  const handleDock = useCallback(
    (id: string) => {
      if (id === 'home') resetTo([{ kind: 'home' }]);
      else if (id === 'settings') openSettings();
      else openTool(id);
    },
    [resetTo, openSettings, openTool]
  );

  if (!settings) {
    return (
      <div className="panel">
        <div className="boot">
          <div className="boot-logo">
            <Icon name="sparkle" size={24} />
          </div>
          <div>正在唤醒工具箱…</div>
        </div>
      </div>
    );
  }

  const accent = settings.appearance.accent;
  const panelStyle = {
    '--tk-accent': accent,
    '--tk-accent-rgb': accentRgb(accent),
    '--panel-opacity': settings.appearance.panelOpacity,
  } as CSSProperties;

  const header = (() => {
    if (current.kind === 'home') {
      return {
        title: '便捷工具',
        subtitle: '轻量 · 稳定 · 随手可用',
        showBrand: true,
        canBack: false,
        showSettings: true,
      };
    }
    return {
      title: currentPlugin?.manifest.name ?? '工具',
      subtitle: currentPlugin?.manifest.description ?? '',
      showBrand: false,
      canBack: true,
      showSettings: false,
    };
  })();

  const renderView = () => {
    if (current.kind === 'home') {
      return (
        <HomePage
          plugins={plugins}
          commands={commands}
          onOpenTool={openTool}
          onOpenSettings={openSettings}
          onQuickAction={runQuickAction}
        />
      );
    }
    if (current.kind === 'tool') {
      if (!currentPlugin) {
        return (
          <div className="tk-empty">
            <Icon name="plugin" size={26} />
            <div>插件未找到或未启用</div>
            <button className="tk-btn sm" onClick={() => openSettings('plugins')}>
              打开扩展中心
            </button>
          </div>
        );
      }
      return (
        <ToolFrame
          plugin={currentPlugin}
          settings={settings}
          onOpenTool={openTool}
          onClosePanel={() => window.tk.panel.close()}
        />
      );
    }
    return null;
  };

  return (
    <div
      className={`panel${opening ? ' opening' : ''}${closing ? ' closing' : ''}`}
      style={panelStyle}
      data-animation={settings.appearance.animation}
    >
      {wallpaper ? (
        <div
          className="panel-wallpaper"
          style={{ backgroundImage: `url("${wallpaper.url}")`, opacity: wallpaper.opacity }}
        />
      ) : null}
      <Header
        title={header.title}
        subtitle={header.subtitle}
        showBrand={header.showBrand}
        canBack={header.canBack}
        showSettings={header.showSettings}
        compact={current.kind === 'tool'}
        onBack={goBack}
        onSettings={() => openSettings()}
        onClose={() => window.tk.panel.close()}
      />
      <main className="panel-content">
        <div
          key={`${viewKey(current)}:${pageKey}`}
          className={`page ${direction === 'forward' ? 'anim-forward' : 'anim-back'}`}
        >
          {renderView()}
        </div>
      </main>
      <Dock items={dockItems} activeId={activeDockId} onSelect={handleDock} />
      <Toaster />
    </div>
  );
}


