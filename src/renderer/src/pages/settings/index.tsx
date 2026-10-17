/**
 * 设置 / 插件管理 / 代码编辑器
 * 对外契约（App.tsx 依赖，必须保持）：
 *   export interface SettingsPageProps { initialTab?: string; onOpenEditor: (pluginId: string) => void }
 *   export function SettingsPage(props: SettingsPageProps): JSX.Element
 *   export function PluginEditorPage(props: { pluginId: string; onDone: () => void }): JSX.Element
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { useSettings } from '../../lib/bridge';
import { ConfirmProvider } from './common';
import { GeneralTab } from './GeneralTab';
import { AppearanceTab } from './AppearanceTab';
import { ShortcutsTab } from './ShortcutsTab';
import { CaptureTab } from './CaptureTab';
import { RecorderTab } from './RecorderTab';
import { PluginsTab } from './PluginsTab';
import { AboutTab } from './AboutTab';
import './settings.css';

/** CodeMirror 体积较大，按需加载，避免拖慢面板首屏。 */
const LazyEditorPage = lazy(() => import('./EditorPage').then((module) => ({ default: module.PluginEditorPage })));

export function PluginEditorPage({ pluginId, onDone }: { pluginId: string; onDone: () => void }) {
  return (
    <Suspense
      fallback={
        <div className="settings-shell">
          <div className="settings-loading">正在加载编辑器…</div>
        </div>
      }
    >
      <LazyEditorPage pluginId={pluginId} onDone={onDone} />
    </Suspense>
  );
}

export interface SettingsPageProps {
  initialTab?: string;
  onOpenEditor: (pluginId: string) => void;
}

type SettingsTabKey = 'general' | 'appearance' | 'shortcuts' | 'capture' | 'recorder' | 'plugins' | 'about';

const TABS: Array<{ key: SettingsTabKey; label: string }> = [
  { key: 'general', label: '通用' },
  { key: 'appearance', label: '外观' },
  { key: 'shortcuts', label: '快捷键' },
  { key: 'capture', label: '截图' },
  { key: 'recorder', label: '录制' },
  { key: 'plugins', label: '扩展' },
  { key: 'about', label: '关于' },
];

const TAB_ALIASES: Record<string, SettingsTabKey> = {
  general: 'general',
  通用: 'general',
  appearance: 'appearance',
  外观: 'appearance',
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
  plugin: 'plugins',
  extensions: 'plugins',
  extension: 'plugins',
  扩展: 'plugins',
  about: 'about',
  关于: 'about',
};

function normalizeTab(value?: string): SettingsTabKey {
  if (!value) return 'general';
  const raw = value.trim();
  return TAB_ALIASES[raw] ?? TAB_ALIASES[raw.toLowerCase()] ?? 'general';
}

export function SettingsPage({ initialTab, onOpenEditor }: SettingsPageProps) {
  const settings = useSettings();
  const [tab, setTab] = useState<SettingsTabKey>(() => normalizeTab(initialTab));

  useEffect(() => {
    setTab(normalizeTab(initialTab));
  }, [initialTab]);

  return (
    <ConfirmProvider>
      <div className="settings-shell">
        <div className="settings-tabs" role="tablist" aria-label="设置分类">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              className={`settings-tab${tab === item.key ? ' active' : ''}`}
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="settings-body tk-scroll">
          {tab === 'general' ? (
            settings ? (
              <GeneralTab settings={settings} />
            ) : (
              <div className="settings-loading">正在读取设置…</div>
            )
          ) : null}
          {tab === 'appearance' ? (
            settings ? (
              <AppearanceTab settings={settings} />
            ) : (
              <div className="settings-loading">正在读取设置…</div>
            )
          ) : null}
          {tab === 'shortcuts' ? (
            settings ? (
              <ShortcutsTab settings={settings} />
            ) : (
              <div className="settings-loading">正在读取设置…</div>
            )
          ) : null}
          {tab === 'capture' ? (
            settings ? (
              <CaptureTab settings={settings} />
            ) : (
              <div className="settings-loading">正在读取设置…</div>
            )
          ) : null}
          {tab === 'recorder' ? (
            settings ? (
              <RecorderTab settings={settings} />
            ) : (
              <div className="settings-loading">正在读取设置…</div>
            )
          ) : null}
          {tab === 'plugins' ? <PluginsTab onOpenEditor={onOpenEditor} /> : null}
          {tab === 'about' ? (
            settings ? (
              <AboutTab settings={settings} />
            ) : (
              <div className="settings-loading">正在读取设置…</div>
            )
          ) : null}
        </div>
      </div>
    </ConfirmProvider>
  );
}
