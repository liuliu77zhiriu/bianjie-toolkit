/**
 * 个性化：主题预设 / 壁纸库 / 设计器。
 *
 * 所有数据来自 core IPC：
 *   wallpapers.list / current / import / download / apply / remove / setDesktop
 *   themes.list / apply / save / delete
 *   settings.get / settings.patch（经 lib/bridge 的 useSettings / patchSettings）
 *
 * 接线（core-service）由 Lead 负责；本组件只依赖上述方法名。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type {
  AnimationLevel,
  Settings,
  ThemePreset,
  ThemeTokens,
  WallpaperCurrent,
  WallpaperItem,
} from '@shared/types';
import { ACCENT_PRESETS, ANIMATION_OPTIONS } from '@shared/defaults';
import { formatBytes, invoke, toast, useSettings } from '../../lib/bridge';
import { Icon } from '../../ui/Icon';
import {
  errorMessage,
  Group,
  Row,
  Segmented,
  Slider,
  Switch,
  useConfirm,
  usePatcher,
  type SegmentedOption,
} from './common';
import './personalize.css';

/* ------------------------------------------------------------------ 工具 */

function accentRgb(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return '76, 141, 255';
  const value = parseInt(match[1], 16);
  return `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** 当前设置 -> 主题 tokens（只取 ThemeTokens 覆盖的字段）。 */
function tokensFromSettings(settings: Settings): ThemeTokens {
  const a = settings.appearance;
  return {
    accent: a.accent,
    panelOpacity: a.panelOpacity,
    blur: a.blur,
    animation: a.animation,
    wallpaper: a.wallpaper,
    wallpaperOpacity: a.wallpaperOpacity,
    ballEdgeHide: a.ballEdgeHide,
    showDock: a.showDock,
  };
}

/** 主题 tokens 是否与当前外观一致（用于「使用中」标记）。 */
function matchesAppearance(tokens: ThemeTokens, appearance: Settings['appearance']): boolean {
  return (
    tokens.accent.toLowerCase() === appearance.accent.toLowerCase() &&
    Math.abs(tokens.panelOpacity - appearance.panelOpacity) < 0.005 &&
    tokens.blur === appearance.blur &&
    tokens.animation === appearance.animation &&
    tokens.wallpaper === appearance.wallpaper &&
    Math.abs(tokens.wallpaperOpacity - appearance.wallpaperOpacity) < 0.005 &&
    tokens.ballEdgeHide === appearance.ballEdgeHide &&
    tokens.showDock === appearance.showDock
  );
}

function wallpaperMeta(item: WallpaperItem): string {
  const dims = item.width && item.height ? `${item.width}×${item.height}` : '';
  const size = item.sizeBytes ? formatBytes(item.sizeBytes) : '';
  return [dims, size].filter(Boolean).join(' · ');
}

const ANIMATION_SEGMENTS: ReadonlyArray<SegmentedOption<AnimationLevel>> = ANIMATION_OPTIONS.map((item) => ({
  value: item.value,
  label: item.label,
  hint: item.hint,
}));

const WALL_TABS: ReadonlyArray<SegmentedOption<'builtin' | 'user'>> = [
  { value: 'builtin', label: '内置壁纸' },
  { value: 'user', label: '我的壁纸' },
];

function Hint({ children }: { children: ReactNode }) {
  return <span className="pz-hint">{children}</span>;
}

/* ------------------------------------------------------------------ 主题卡片 */

function ThemeCard({
  theme,
  active,
  thumb,
  busy,
  onApply,
  onDelete,
}: {
  theme: ThemePreset;
  active: boolean;
  thumb: string | null;
  busy: boolean;
  onApply: () => void;
  onDelete: () => void;
}) {
  const style = {
    '--pz-accent': theme.tokens.accent,
    '--pz-accent-rgb': accentRgb(theme.tokens.accent),
  } as CSSProperties;
  const thumbStyle = thumb ? ({ backgroundImage: `url("${thumb}")` } as CSSProperties) : undefined;
  return (
    <div className={`pz-theme-card${active ? ' active' : ''}`}>
      <button
        type="button"
        className="pz-theme-main"
        style={style}
        onClick={onApply}
        disabled={busy}
        aria-pressed={active}
        title={`应用主题「${theme.name}」`}
      >
        <span className="pz-theme-thumb" style={thumbStyle} aria-hidden="true" />
        <span className="pz-theme-body">
          <span className="pz-theme-name-row">
            <span className="pz-theme-dot" aria-hidden="true" />
            <span className="pz-theme-name">{theme.name}</span>
          </span>
          <span className="pz-theme-desc">{theme.description ?? (theme.builtin ? '内置主题' : '自定义主题')}</span>
        </span>
        <span className="pz-theme-tags">
          {theme.builtin ? null : <span className="pz-tag">我的</span>}
          {active ? (
            <span className="pz-tag accent">
              <Icon name="check" size={10} /> 使用中
            </span>
          ) : null}
        </span>
      </button>
      {theme.builtin ? null : (
        <button
          type="button"
          className="pz-theme-del"
          title={`删除主题「${theme.name}」`}
          aria-label={`删除主题「${theme.name}」`}
          onClick={onDelete}
          disabled={busy}
        >
          <Icon name="trash" size={12} />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ 壁纸卡片 */

function WallpaperCard({
  item,
  active,
  busy,
  onApply,
  onSetDesktop,
  onRemove,
}: {
  item: WallpaperItem;
  active: boolean;
  busy: boolean;
  onApply: () => void;
  onSetDesktop: () => void;
  onRemove: () => void;
}) {
  const meta = wallpaperMeta(item);
  return (
    <div className={`pz-wall-card${active ? ' active' : ''}${busy ? ' busy' : ''}`}>
      <div
        className="pz-wall-thumb"
        style={{ backgroundImage: `url("${item.url}")` }}
        role="button"
        tabIndex={0}
        aria-label={`应用壁纸「${item.name}」`}
        title={active ? '当前使用中' : `应用「${item.name}」`}
        onClick={onApply}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onApply();
          }
        }}
      >
        {active ? (
          <span className="pz-wall-active">
            <Icon name="check" size={10} /> 使用中
          </span>
        ) : null}
        <span className="pz-wall-hover">应用</span>
      </div>
      <div className="pz-wall-info">
        <div className="pz-wall-text">
          <span className="pz-wall-name" title={item.name}>
            {item.name}
          </span>
          <span className="pz-wall-meta">{meta || (item.source === 'builtin' ? '内置' : '我的壁纸')}</span>
        </div>
        <div className="pz-wall-actions">
          <button type="button" className="tk-btn sm" onClick={onApply} disabled={busy || active}>
            {active ? '使用中' : '应用'}
          </button>
          <button
            type="button"
            className="tk-icon-btn"
            title="设为 Windows 桌面壁纸"
            aria-label="设为 Windows 桌面壁纸"
            onClick={onSetDesktop}
            disabled={busy}
          >
            <Icon name="monitor" size={13} />
          </button>
          {item.source === 'user' ? (
            <button
              type="button"
              className="tk-icon-btn danger"
              title="删除壁纸"
              aria-label="删除壁纸"
              onClick={onRemove}
              disabled={busy}
            >
              <Icon name="trash" size={13} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 主体 */

export function PersonalizeTab({ onOpenEditor }: { onOpenEditor: (pluginId: string) => void }) {
  const settings = useSettings();
  const patch = usePatcher();
  const confirm = useConfirm();

  const [wallpapers, setWallpapers] = useState<WallpaperItem[] | null>(null);
  const [current, setCurrent] = useState<WallpaperCurrent | null>(null);
  const [themes, setThemes] = useState<ThemePreset[] | null>(null);
  const [wallTab, setWallTab] = useState<'builtin' | 'user'>('builtin');
  const [busy, setBusy] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [themeName, setThemeName] = useState('');
  const [designerName, setDesignerName] = useState('');
  const [accentDraft, setAccentDraft] = useState('#4C8DFF');

  const accentTimer = useRef<number | null>(null);
  const alive = useRef(true);
  /** 同步忙碌锁：避免 state 尚未刷新时连点导致重复下载 / 重复应用。 */
  const busyRef = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (accentTimer.current) window.clearTimeout(accentTimer.current);
    };
  }, []);

  /* ---------------------------------------------------------- 数据读取 */

  const refreshWallpapers = useCallback(async (silent = false) => {
    try {
      const list = await invoke<WallpaperItem[]>('core', 'wallpapers.list');
      if (!alive.current) return;
      setWallpapers(list);
      setLoadError(null);
    } catch (err) {
      if (!alive.current) return;
      if (!silent) setLoadError(errorMessage(err));
    }
  }, []);

  const refreshCurrent = useCallback(async () => {
    try {
      const value = await invoke<WallpaperCurrent | null>('core', 'wallpapers.current');
      if (alive.current) setCurrent(value ?? null);
    } catch {
      /* 当前壁纸读取失败不阻塞页面 */
    }
  }, []);

  const refreshThemes = useCallback(async (silent = false) => {
    try {
      const list = await invoke<ThemePreset[]>('core', 'themes.list');
      if (!alive.current) return;
      setThemes(list);
      setLoadError(null);
    } catch (err) {
      if (!alive.current) return;
      if (!silent) setLoadError(errorMessage(err));
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setLoadError(null);
    await Promise.all([refreshWallpapers(), refreshCurrent(), refreshThemes()]);
  }, [refreshWallpapers, refreshCurrent, refreshThemes]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  // 设置变化（应用壁纸 / 主题 / 透明度）后同步当前壁纸
  const activeSelector = settings?.appearance.wallpaper ?? '';
  useEffect(() => {
    void refreshCurrent();
  }, [activeSelector, refreshCurrent]);

  const accentFromSettings = settings?.appearance.accent ?? '#4C8DFF';
  useEffect(() => {
    setAccentDraft(accentFromSettings);
  }, [accentFromSettings]);

  /* ---------------------------------------------------------- 派生数据 */

  const builtinWallpapers = useMemo(
    () => (wallpapers ?? []).filter((item) => item.source === 'builtin'),
    [wallpapers]
  );
  const userWallpapers = useMemo(() => (wallpapers ?? []).filter((item) => item.source === 'user'), [wallpapers]);
  const visibleWallpapers = wallTab === 'builtin' ? builtinWallpapers : userWallpapers;
  const wallpaperBySelector = useMemo(
    () => new Map((wallpapers ?? []).map((item) => [item.selector, item] as const)),
    [wallpapers]
  );

  const activeTheme = useMemo(() => {
    if (!settings || !themes) return null;
    return themes.find((theme) => matchesAppearance(theme.tokens, settings.appearance)) ?? null;
  }, [settings, themes]);

  /* ---------------------------------------------------------- 壁纸操作 */

  const run = useCallback(async (key: string, fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(null);
    }
  }, []);

  const applyWallpaper = (item: WallpaperItem) => {
    if (busyRef.current) return;
    void run(`apply:${item.selector}`, async () => {
      await invoke<Settings>('core', 'wallpapers.apply', { selector: item.selector });
      setCurrent({
        selector: item.selector,
        url: item.url,
        name: item.name,
        opacity: settings?.appearance.wallpaperOpacity ?? 0.38,
      });
      toast(`已应用壁纸「${item.name}」`, 'success');
    });
  };

  const clearWallpaper = () => {
    if (busyRef.current || !current) return;
    void run('clear', async () => {
      await invoke<Settings>('core', 'wallpapers.apply', { selector: '' });
      setCurrent(null);
      toast('已清除壁纸', 'success');
    });
  };

  const commitOpacity = (value: number) => {
    setCurrent((prev) => (prev ? { ...prev, opacity: value } : prev));
    void patch({ appearance: { wallpaperOpacity: value } });
  };

  const importWallpapers = () => {
    if (busyRef.current) return;
    void run('import', async () => {
      const imported = await invoke<WallpaperItem[]>('core', 'wallpapers.import');
      if (!imported.length) return; // 用户取消
      await refreshWallpapers(true);
      setWallTab('user');
      toast(`已导入 ${imported.length} 张壁纸`, 'success');
    });
  };

  const downloadAndApply = () => {
    if (busyRef.current) return;
    const url = downloadUrl.trim();
    if (!url) {
      setUrlError('请先粘贴图片链接');
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      setUrlError('仅支持 http / https 链接');
      return;
    }
    setUrlError(null);
    void run('download', async () => {
      try {
        const item = await invoke<WallpaperItem>('core', 'wallpapers.download', { url });
        await refreshWallpapers(true);
        setWallTab('user');
        await invoke<Settings>('core', 'wallpapers.apply', { selector: item.selector });
        setDownloadUrl('');
        toast(`已下载并应用「${item.name}」`, 'success');
      } catch (err) {
        setUrlError(errorMessage(err));
        throw err;
      }
    });
  };

  const removeWallpaper = async (item: WallpaperItem) => {
    const ok = await confirm({
      title: '删除壁纸',
      message: `确定删除「${item.name}」吗？文件会从「我的壁纸」中移除。`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    void run(`remove:${item.selector}`, async () => {
      const list = await invoke<WallpaperItem[]>('core', 'wallpapers.remove', { selector: item.selector });
      setWallpapers(list);
      await refreshCurrent();
      toast('壁纸已删除', 'success');
    });
  };

  const setDesktop = async (item: WallpaperItem) => {
    const ok = await confirm({
      title: '设为 Windows 桌面壁纸',
      message: `将「${item.name}」设置为系统桌面壁纸？\n这会替换你当前的 Windows 桌面背景。`,
      confirmText: '设为桌面',
    });
    if (!ok) return;
    void run(`desktop:${item.selector}`, async () => {
      const result = await invoke<{ ok: boolean; error?: string }>('core', 'wallpapers.setDesktop', {
        selector: item.selector,
      });
      if (result?.ok) toast('已设为 Windows 桌面壁纸', 'success');
      else toast(result?.error ?? '设置桌面壁纸失败', 'error');
    });
  };

  /* ---------------------------------------------------------- 主题操作 */

  const applyTheme = (theme: ThemePreset) => {
    if (busyRef.current) return;
    void run(`theme:${theme.id}`, async () => {
      await invoke<Settings>('core', 'themes.apply', { id: theme.id });
      toast(`已应用主题「${theme.name}」`, 'success');
    });
  };

  const saveTheme = async (name: string, from: 'theme' | 'designer'): Promise<boolean> => {
    if (!settings) return false;
    const themeNameValue = name.trim();
    if (!themeNameValue) {
      toast('请输入主题名称', 'error');
      return false;
    }
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(`save-theme:${from}`);
    try {
      const list = await invoke<ThemePreset[]>('core', 'themes.save', {
        name: themeNameValue,
        tokens: tokensFromSettings(settings),
      });
      if (!alive.current) return true;
      setThemes(list);
      if (from === 'theme') setThemeName('');
      else setDesignerName('');
      toast(`已保存主题「${themeNameValue}」`, 'success');
      return true;
    } catch (err) {
      toast(errorMessage(err), 'error');
      return false;
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(null);
    }
  };

  const removeTheme = async (theme: ThemePreset) => {
    const ok = await confirm({
      title: '删除主题',
      message: `确定删除自定义主题「${theme.name}」吗？`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    void run(`delete-theme:${theme.id}`, async () => {
      const list = await invoke<ThemePreset[]>('core', 'themes.delete', { id: theme.id });
      setThemes(list);
      toast('主题已删除', 'success');
    });
  };

  /* ---------------------------------------------------------- 设计器 */

  const commitAccent = (value: string) => {
    setAccentDraft(value);
    if (accentTimer.current) window.clearTimeout(accentTimer.current);
    accentTimer.current = window.setTimeout(() => {
      accentTimer.current = null;
      void patch({ appearance: { accent: value } });
    }, 180);
  };

  /* ---------------------------------------------------------- 渲染 */

  if (!settings) {
    return <div className="settings-loading">正在读取设置…</div>;
  }

  const appearance = settings.appearance;

  return (
    <>
      <div className="pz-hero">
        <div className="pz-hero-mark" aria-hidden="true">
          <Icon name="sparkle" size={18} />
        </div>
        <div className="pz-hero-text">
          <strong>把工具箱变成你自己的样子</strong>
          <span>壁纸、主题与面板质感都会实时生效；最多可保存 30 套自定义主题。</span>
        </div>
        <button type="button" className="tk-btn sm" onClick={() => onOpenEditor('memo')}>
          <Icon name="code" size={13} />
          打开插件编辑器
        </button>
      </div>

      {loadError ? (
        <div className="pz-error">
          <Icon name="info" size={14} />
          <span>{loadError}</span>
          <button type="button" className="tk-btn sm" onClick={() => void refreshAll()}>
            重试
          </button>
        </div>
      ) : null}

      {/* ---------------------------------------------------------- 主题 */}
      <Group title="主题" actions={<Hint>点击卡片应用到整个工具箱</Hint>}>
        {themes === null ? (
          <div className="pz-loading">正在读取主题…</div>
        ) : (
          <div className="pz-theme-grid">
            {themes.map((theme) => {
              const thumbWallpaper = wallpaperBySelector.get(theme.tokens.wallpaper);
              return (
                <ThemeCard
                  key={theme.id}
                  theme={theme}
                  active={activeTheme?.id === theme.id}
                  thumb={thumbWallpaper?.url ?? null}
                  busy={busy !== null}
                  onApply={() => applyTheme(theme)}
                  onDelete={() => void removeTheme(theme)}
                />
              );
            })}
          </div>
        )}
        <div className="pz-save-row">
          <input
            className="tk-input pz-name-input"
            placeholder="给当前设计起个名字，例如「我的极光」"
            value={themeName}
            maxLength={40}
            aria-label="新主题名称"
            onChange={(event) => setThemeName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void saveTheme(themeName, 'theme');
            }}
          />
          <button
            type="button"
            className="tk-btn sm primary"
            disabled={busy !== null || !themeName.trim()}
            onClick={() => void saveTheme(themeName, 'theme')}
          >
            {busy === 'save-theme:theme' ? '保存中…' : '保存当前为主题'}
          </button>
        </div>
      </Group>

      {/* ---------------------------------------------------------- 壁纸 */}
      <Group title="壁纸" actions={<Hint>只影响工具箱面板，不改变系统桌面</Hint>}>
        <div className="pz-current">
          <div
            className={`pz-current-preview${current ? '' : ' empty'}`}
            style={current ? { backgroundImage: `url("${current.url}")` } : undefined}
          >
            {current ? (
              <>
                <span className="pz-current-shade" aria-hidden="true" />
                <span className="pz-current-caption">
                  <span className="pz-current-name">{current.name}</span>
                  <span className="pz-current-selector">{current.selector}</span>
                </span>
              </>
            ) : (
              <span className="pz-current-empty">
                <Icon name="image" size={24} />
                <span>还没有选择壁纸</span>
                <span className="pz-current-empty-hint">从下方内置壁纸开始，或导入自己的图片</span>
              </span>
            )}
          </div>
          <div className="pz-current-side">
            <div className="pz-current-head">
              <div className="pz-current-label">当前壁纸</div>
              <div className="pz-current-tip">{current ? '已应用到主面板背景' : '未启用壁纸'}</div>
            </div>
            <div className="pz-opacity">
              <div className="pz-opacity-head">
                <span>壁纸可见度</span>
                <span className="pz-opacity-value">{percent(appearance.wallpaperOpacity)}</span>
              </div>
              <Slider
                min={0.05}
                max={0.8}
                step={0.01}
                value={appearance.wallpaperOpacity}
                format={percent}
                onCommit={commitOpacity}
                ariaLabel="壁纸可见度"
                minLabel="更淡"
                maxLabel="更明显"
              />
              <div className="pz-opacity-hint">数值越低，壁纸在玻璃面板下越含蓄。</div>
            </div>
            <div className="pz-current-actions">
              <button type="button" className="tk-btn sm" onClick={importWallpapers} disabled={busy !== null}>
                {busy === 'import' ? '导入中…' : '导入本地图片'}
              </button>
              <button
                type="button"
                className="tk-btn sm ghost"
                onClick={clearWallpaper}
                disabled={busy !== null || !current}
              >
                清除壁纸
              </button>
            </div>
          </div>
        </div>

        <div className="pz-wall-tabs">
          <Segmented options={WALL_TABS} value={wallTab} onChange={setWallTab} ariaLabel="壁纸分组" />
          <span className="pz-count">
            {wallTab === 'builtin' ? `内置 ${builtinWallpapers.length} 张` : `我的 ${userWallpapers.length} 张`}
          </span>
        </div>

        {wallpapers === null ? (
          <div className="pz-loading">正在读取壁纸…</div>
        ) : visibleWallpapers.length === 0 ? (
          <div className="tk-empty pz-empty">
            <Icon name="image" size={22} />
            <span>{wallTab === 'builtin' ? '内置壁纸资源缺失' : '还没有导入自己的壁纸'}</span>
            {wallTab === 'user' ? (
              <button type="button" className="tk-btn sm" onClick={importWallpapers} disabled={busy !== null}>
                <Icon name="plus" size={12} /> 导入本地图片
              </button>
            ) : null}
          </div>
        ) : (
          <div className="pz-wall-grid">
            {visibleWallpapers.map((item) => (
              <WallpaperCard
                key={item.selector}
                item={item}
                active={current?.selector === item.selector}
                busy={
                  busy === `apply:${item.selector}` ||
                  busy === `remove:${item.selector}` ||
                  busy === `desktop:${item.selector}`
                }
                onApply={() => applyWallpaper(item)}
                onSetDesktop={() => void setDesktop(item)}
                onRemove={() => void removeWallpaper(item)}
              />
            ))}
          </div>
        )}

        <div className="pz-download">
          <div className="pz-download-field">
            <Icon name="download" size={14} />
            <input
              className="pz-download-input"
              placeholder="粘贴图片直链，下载后自动应用（≤30MB，仅图片）"
              value={downloadUrl}
              spellCheck={false}
              aria-label="壁纸下载链接"
              onChange={(event) => {
                setDownloadUrl(event.currentTarget.value);
                if (urlError) setUrlError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') downloadAndApply();
              }}
            />
            <button
              type="button"
              className="tk-btn sm primary"
              onClick={downloadAndApply}
              disabled={busy !== null || !downloadUrl.trim()}
            >
              {busy === 'download' ? '下载中…' : '下载并应用'}
            </button>
          </div>
          {urlError ? <div className="pz-inline-error">{urlError}</div> : null}
        </div>
      </Group>

      {/* ---------------------------------------------------------- 设计器 */}
      <Group title="设计器" actions={<Hint>所有改动实时保存</Hint>}>
        <Row title="强调色" desc="按钮、开关、选中态与边缘冷光都跟随强调色" stacked>
          <div className="accent-grid pz-accent-grid">
            {ACCENT_PRESETS.map((preset) => {
              const active = accentDraft.toLowerCase() === preset.value.toLowerCase();
              return (
                <button
                  key={preset.value}
                  type="button"
                  className={`accent-swatch${active ? ' active' : ''}`}
                  style={{ '--dot': preset.value, '--dot-rgb': accentRgb(preset.value) } as CSSProperties}
                  aria-pressed={active}
                  onClick={() => commitAccent(preset.value)}
                >
                  <span className="accent-dot" />
                  <span className="accent-name">{preset.name}</span>
                </button>
              );
            })}
            <label className="pz-color-field" title="自定义强调色">
              <input
                type="color"
                value={accentDraft}
                aria-label="自定义强调色"
                onChange={(event) => commitAccent(event.currentTarget.value)}
              />
              <span className="pz-color-preview" style={{ background: accentDraft }} />
              <span className="accent-name">自定义</span>
            </label>
          </div>
        </Row>

        <Row title="面板不透明度" desc="数值越低越透，配合毛玻璃更通透" stacked>
          <Slider
            min={0.55}
            max={1}
            step={0.01}
            value={appearance.panelOpacity}
            format={percent}
            onCommit={(next) => void patch({ appearance: { panelOpacity: next } })}
            ariaLabel="面板不透明度"
            minLabel="更透"
            maxLabel="更实"
          />
        </Row>
        <Row title="毛玻璃背景" desc="使用 Windows 11 亚克力材质；关闭后为纯色深底">
          <Switch
            checked={appearance.blur}
            onChange={(next) => void patch({ appearance: { blur: next } }, next ? '已开启毛玻璃' : '已关闭毛玻璃')}
            label="毛玻璃背景"
          />
        </Row>
        <Row
          title="动画强度"
          desc={ANIMATION_OPTIONS.find((item) => item.value === appearance.animation)?.hint ?? ''}
          stacked
        >
          <Segmented
            options={ANIMATION_SEGMENTS}
            value={appearance.animation}
            ariaLabel="动画强度"
            onChange={(next) => void patch({ appearance: { animation: next } }, '动画强度已更新')}
          />
        </Row>
        <Row title="悬浮球尺寸" desc="桌面悬浮球直径" stacked>
          <Slider
            min={40}
            max={76}
            step={1}
            value={appearance.ballSize}
            format={(next) => `${Math.round(next)} px`}
            onCommit={(next) => void patch({ appearance: { ballSize: next } })}
            ariaLabel="悬浮球尺寸"
            minLabel="40 px"
            maxLabel="76 px"
          />
        </Row>
        <Row title="悬浮球透明度" desc="数值越低越不干扰视线" stacked>
          <Slider
            min={0.35}
            max={1}
            step={0.01}
            value={appearance.ballOpacity}
            format={percent}
            onCommit={(next) => void patch({ appearance: { ballOpacity: next } })}
            ariaLabel="悬浮球透明度"
            minLabel="半透明"
            maxLabel="不透明"
          />
        </Row>
        <Row title="贴边半隐藏" desc="停靠屏幕左右边缘时只露出一小条，鼠标靠近自动弹出">
          <Switch
            checked={appearance.ballEdgeHide}
            onChange={(next) =>
              void patch({ appearance: { ballEdgeHide: next } }, next ? '鼠标靠近时自动弹出' : '已关闭贴边半隐藏')
            }
            label="贴边半隐藏"
          />
        </Row>
        <Row title="显示底部 Dock" desc="在面板底部显示快捷导航栏">
          <Switch
            checked={appearance.showDock}
            onChange={(next) => void patch({ appearance: { showDock: next } })}
            label="显示底部 Dock"
          />
        </Row>

        <div className="pz-designer-foot">
          <input
            className="tk-input pz-name-input"
            placeholder="为这套设计命名，保存为「我的主题」"
            value={designerName}
            maxLength={40}
            aria-label="设计器主题名称"
            onChange={(event) => setDesignerName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void saveTheme(designerName, 'designer');
            }}
          />
          <button
            type="button"
            className="tk-btn sm primary"
            disabled={busy !== null || !designerName.trim()}
            onClick={() => void saveTheme(designerName, 'designer')}
          >
            {busy === 'save-theme:designer' ? '保存中…' : '保存为我的主题'}
          </button>
        </div>
      </Group>
    </>
  );
}

