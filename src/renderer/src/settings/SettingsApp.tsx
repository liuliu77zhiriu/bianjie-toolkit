import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Icon, type IconName } from '../ui/Icon';
import { invoke, on, toast, useElasticScroll, useSettings, useWallpaper } from '../lib/bridge';
import { ConfirmProvider } from '../pages/settings/common';
import { GeneralTab } from '../pages/settings/GeneralTab';
import { AppearanceTab } from '../pages/settings/AppearanceTab';
import { PersonalizeTab } from '../pages/settings/PersonalizeTab';
import { ShortcutsTab } from '../pages/settings/ShortcutsTab';
import { CaptureTab } from '../pages/settings/CaptureTab';
import { RecorderTab } from '../pages/settings/RecorderTab';
import { PluginsTab } from '../pages/settings/PluginsTab';
import { AboutTab } from '../pages/settings/AboutTab';
import { PluginEditorPage } from '../pages/settings';

type TabKey =
  | 'general'
  | 'appearance'
  | 'personalize'
  | 'shortcuts'
  | 'capture'
  | 'recorder'
  | 'plugins'
  | 'about';

interface TabDef {
  key: TabKey;
  label: string;
  title: string;
  desc: string;
  icon: IconName;
}

const TABS: TabDef[] = [
  { key: 'general', label: '通用', title: '通用', desc: '启动、悬浮球与窗口行为', icon: 'settings' },
  { key: 'appearance', label: '外观', title: '外观', desc: '黑玻璃质感、动效与悬浮球外观', icon: 'palette' },
  { key: 'personalize', label: '个性化', title: '个性化', desc: '壁纸、UI 主题，以及设计你自己的工具箱', icon: 'sparkle' },
  { key: 'shortcuts', label: '快捷键', title: '快捷键', desc: '全局快捷键与冲突检测', icon: 'keyboard' },
  { key: 'capture', label: '截图', title: '截图', desc: '保存位置、格式与剪贴板行为', icon: 'camera' },
  { key: 'recorder', label: '录制', title: '录制', desc: '帧率、画质、声音与保存目录', icon: 'record' },
  { key: 'plugins', label: '扩展', title: '扩展', desc: '启停、管理并编辑你的工具插件', icon: 'plugin' },
  { key: 'about', label: '关于', title: '关于', desc: '版本、运行时数据与备份', icon: 'info' },
];

const TAB_ALIASES: Record<string, TabKey> = {
  general: 'general',
  通用: 'general',
  appearance: 'appearance',
  外观: 'appearance',
  personalize: 'personalize',
  personalization: 'personalize',
  theme: 'personalize',
  wallpaper: 'personalize',
  个性化: 'personalize',
  shortcuts: 'shortcuts',
  shortcut: 'shortcuts',
  快捷键: 'shortcuts',
  capture: 'capture',
  screenshot: 'capture',
  截图: 'capture',
  recorder: 'recorder',
  recording: 'recorder',
  录制: 'recorder',
  plugins: 'plugins',
  extension: 'plugins',
  extensions: 'plugins',
  扩展: 'plugins',
  about: 'about',
  关于: 'about',
};

function normalizeTab(value?: string): TabKey {
  if (!value) return 'general';
  const raw = String(value).trim();
  return TAB_ALIASES[raw] ?? TAB_ALIASES[raw.toLowerCase()] ?? 'general';
}

function accentRgb(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return '76, 141, 255';
  const value = parseInt(match[1], 16);
  return `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`;
}

export function SettingsApp() {
  const settings = useSettings();
  const wallpaper = useWallpaper();
  const [tab, setTab] = useState<TabKey>('general');
  const [editorId, setEditorId] = useState<string | null>(null);
  useElasticScroll();

  useEffect(() => {
    if (window.tk.settingsWindow) window.tk.settingsWindow.ready();
    const offTab = on('settings:tab', (payload) => {
      const next = (payload as { tab?: string } | undefined)?.tab;
      setEditorId(null);
      setTab(normalizeTab(next));
    });
    return () => offTab();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !editorId) window.tk.settingsWindow?.close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editorId]);

  const openEditor = useCallback((pluginId: string) => setEditorId(pluginId), []);

  const activeTab = TABS.find((item) => item.key === tab) ?? TABS[0];
  const accent = settings?.appearance.accent ?? '#4C8DFF';
  const style = {
    '--tk-accent': accent,
    '--tk-accent-rgb': accentRgb(accent),
  } as CSSProperties;

  const content = useMemo(() => {
    if (!settings) return <div className="settings-loading">正在读取设置…</div>;
    switch (tab) {
      case 'general':
        return <GeneralTab settings={settings} />;
      case 'appearance':
        return <AppearanceTab settings={settings} />;
      case 'personalize':
        return <PersonalizeTab onOpenEditor={openEditor} />;
      case 'shortcuts':
        return <ShortcutsTab settings={settings} />;
      case 'capture':
        return <CaptureTab settings={settings} />;
      case 'recorder':
        return <RecorderTab settings={settings} />;
      case 'plugins':
        return <PluginsTab onOpenEditor={openEditor} />;
      case 'about':
        return <AboutTab settings={settings} />;
      default:
        return null;
    }
  }, [settings, tab, openEditor]);

  return (
    <ConfirmProvider>
      <div className="settings-window" style={style} data-animation={settings?.appearance.animation ?? 'full'}>
        {wallpaper ? (
          <div
            className="settings-wallpaper"
            style={{ backgroundImage: `url("${wallpaper.url}")`, opacity: wallpaper.opacity }}
          />
        ) : null}

        <header className="settings-titlebar">
          <span className="settings-brand-mark">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="3" y="3" width="8" height="8" rx="2.2" fill="#ffffff" fillOpacity="0.95" />
              <rect x="13" y="3" width="8" height="8" rx="2.2" fill="#ffffff" fillOpacity="0.55" />
              <rect x="3" y="13" width="8" height="8" rx="2.2" fill="#ffffff" fillOpacity="0.4" />
              <rect x="13" y="13" width="8" height="8" rx="2.2" fill="#ffffff" fillOpacity="0.92" />
            </svg>
          </span>
          <div className="settings-titlebar-text">
            <b>便捷工具</b>
            <span>设置</span>
          </div>
          <div className="settings-window-actions">
            <button
              className="settings-window-btn"
              title="最小化"
              onClick={() => window.tk.settingsWindow?.minimize()}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
            <button
              className="settings-window-btn close"
              title="关闭（Esc）"
              onClick={() => window.tk.settingsWindow?.close()}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        </header>

        <div className="settings-layout">
          <aside className="settings-sidebar">
            <nav className="settings-nav" role="tablist" aria-label="设置分类">
              {TABS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.key && !editorId}
                  className={`settings-nav-item${tab === item.key && !editorId ? ' active' : ''}`}
                  onClick={() => {
                    setEditorId(null);
                    setTab(item.key);
                  }}
                >
                  <span className="settings-nav-icon">
                    <Icon name={item.icon} size={16} />
                  </span>
                  <span>{item.label}</span>
                </button>
              ))}
            </nav>
            <div className="settings-sidebar-foot">
              <button
                className="settings-foot-link"
                onClick={() => void invoke('core', 'app.openPath', { kind: 'userData' }).catch(() => toast('打开目录失败', 'error'))}
              >
                <Icon name="folder" size={13} />
                数据目录
              </button>
              <span className="settings-version">v1.0.0</span>
            </div>
          </aside>

          <main className="settings-main">
            {editorId ? (
              <div className="settings-editor-view">
                <div className="settings-editor-head">
                  <button
                    className="tk-icon-btn"
                    onClick={() => setEditorId(null)}
                    title="返回扩展"
                    aria-label="返回扩展"
                  >
                    <Icon name="back" size={16} />
                  </button>
                  <div className="settings-editor-head-text">
                    <b>代码编辑</b>
                    <span>{editorId}</span>
                  </div>
                </div>
                <PluginEditorPage pluginId={editorId} onDone={() => setEditorId(null)} />
              </div>
            ) : (
              <>
                <div className="settings-page-head">
                  <div>
                    <h1 className="settings-page-title">{activeTab.title}</h1>
                    <p className="settings-page-desc">{activeTab.desc}</p>
                  </div>
                  <span className="settings-page-chip">{activeTab.label}</span>
                </div>
                <div className="settings-page-scroll tk-scroll">
                  <div className="settings-page-content">{content}</div>
                </div>
              </>
            )}
          </main>
        </div>
      </div>
    </ConfirmProvider>
  );
}
