import { Icon, PluginGlyph, pluginAccent } from '../ui/Icon';
import type { CSSProperties } from 'react';
import type { CommandInfo, PluginRuntimeInfo } from '@shared/types';
import { formatHotkey, greeting, todayLabel } from '../lib/bridge';

interface HomePageProps {
  plugins: PluginRuntimeInfo[];
  commands: CommandInfo[];
  onOpenTool: (pluginId: string) => void;
  onOpenSettings: (tab?: string) => void;
  onQuickAction: (commandId: string) => void;
}

export function HomePage({ plugins, commands, onOpenTool, onOpenSettings, onQuickAction }: HomePageProps) {
  const enabled = plugins.filter((p) => p.enabled && p.hasUI && !p.manifest.hidden);
  const tools = enabled.filter((plugin) => plugin.id !== 'uieditor');
  const quick = [
    { id: 'screenshot.region', label: '区域截图', icon: 'camera' as const, fallback: 'Alt+A' },
    { id: 'screenshot.full', label: '全屏截图', icon: 'monitor' as const, fallback: 'Alt+S' },
    { id: 'recorder.toggle', label: '录制屏幕', icon: 'record' as const, fallback: 'Alt+R' },
  ].map((item) => {
    const command = commands.find((c) => c.id === item.id);
    return { ...item, hint: command?.accelerator ? formatHotkey(command.accelerator) : item.fallback, available: !!command };
  });

  return (
    <div className="home-scroll tk-scroll">
      <div className="home-greeting">
        <div>
          <div className="greeting-title">{greeting()}</div>
          <div className="greeting-sub">今天想先做点什么？</div>
        </div>
        <div className="greeting-date">{todayLabel()}</div>
      </div>

      <div className="quick-row">
        {quick.map((item) => (
          <button
            key={item.id}
            className="quick-btn"
            onClick={() => onQuickAction(item.id)}
            title={`${item.label} ${item.hint}`}
            disabled={!item.available}
          >
            <span className="quick-icon">
              <Icon name={item.icon} size={15} />
            </span>
            <span className="quick-label">{item.label}</span>
            <span className="quick-kbd">{item.hint}</span>
          </button>
        ))}
      </div>

      <div className="section-head">
        <span className="section-title">全部工具</span>
        <span className="section-more-group">
          <button className="section-more" onClick={() => onOpenSettings('personalize')}>
            个性化
          </button>
          <button className="section-more" onClick={() => onOpenSettings('plugins')}>
            管理插件
          </button>
        </span>
      </div>

      <div className="tool-grid">
        {tools.map((plugin, index) => {
          const accent = pluginAccent(plugin);
          return (
            <button
              key={plugin.id}
              className="tool-card tk-fade-in"
              style={
                {
                  '--card-accent': accent,
                  animationDelay: `${index * 28}ms`,
                } as CSSProperties
              }
              onClick={() => onOpenTool(plugin.id)}
            >
              <span className="tool-icon">
                <PluginGlyph plugin={plugin} size={19} />
              </span>
              <span className="tool-name">{plugin.manifest.name}</span>
              <span className="tool-desc">{plugin.manifest.description || '点击打开'}</span>
              <span className="tool-foot">
                {plugin.error ? (
                  <>
                    <span className="tool-error-dot" />
                    加载失败 · 点击查看
                  </>
                ) : plugin.customized ? (
                  <>已自定义</>
                ) : (
                  <>v{plugin.manifest.version}</>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {!enabled.length ? (
        <div className="tk-empty">
          <Icon name="plugin" size={26} />
          <div>还没有启用的工具，去扩展中心看看吧</div>
        </div>
      ) : null}

      <div className="home-bottom-row">
        <button className="studio-card compact" onClick={() => onOpenTool('uieditor')} title="打开 UI 编辑器（可视化设计工作台）">
          <span className="studio-icon">
            <Icon name="sparkle" size={16} />
          </span>
          <span className="studio-copy">
            <b>UI 编辑器</b>
            <i>可视化设计 · 可导出</i>
          </span>
          <span className="studio-arrow">
            <Icon name="chevron-right" size={14} />
          </span>
        </button>
        <button className="studio-card compact search-entry" onClick={() => onOpenTool('search')} title="打开流光搜索（搜索引擎与下载器）">
          <span className="studio-icon">
            <Icon name="search" size={15} />
          </span>
          <span className="studio-copy">
            <b>流光搜索</b>
            <i>搜索 · 下载</i>
          </span>
          <span className="studio-arrow">
            <Icon name="chevron-right" size={14} />
          </span>
        </button>
        <button className="home-extend" onClick={() => onOpenSettings('plugins')}>
          <span className="home-extend-icon">
            <Icon name="plus" size={14} />
          </span>
          <span className="home-extend-text">
            <b>扩展工具箱</b>
            <small>新建或导入插件</small>
          </span>
          <Icon name="chevron-right" size={14} />
        </button>
      </div>

      <div className="home-foot">
        <Icon name="bolt" size={12} />
        <span>Alt + Space 唤起 / 隐藏 · 右键悬浮球打开菜单</span>
      </div>
    </div>
  );
}



