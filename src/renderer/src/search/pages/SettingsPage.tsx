/** 流光搜索 · 设置页（引擎 / 结果数 / 并发 / 体验 / 下载目录 / 数据） */
import { useState } from 'react';
import type { SearchEngine, SearchHistoryEntry, SearchPaths, SearchSettings, SearchSettingsPatch } from '@shared/search';
import { Icon } from '../components/Icon';
import { downloadsApi, searchApi } from '../lib/api';
import { errorText } from '../lib/format';
import { useConfirm } from '../lib/confirm';
import { toast } from '../lib/toast';

export interface SettingsPageProps {
  settings: SearchSettings;
  paths: SearchPaths | null;
  onSettingsChange: (settings: SearchSettings) => void;
  onHistoryChange: (items: SearchHistoryEntry[]) => void;
}

const ENGINES: Array<{ value: SearchEngine; name: string; desc: string; glyph: string }> = [
  { value: 'bing', name: 'Bing', desc: '结果稳定，中文支持好，默认引擎', glyph: 'B' },
  { value: 'duckduckgo', name: 'DuckDuckGo', desc: '更注重隐私，无需账号', glyph: 'D' },
];

const RESULT_COUNTS = [10, 20, 30];
const CONCURRENCY = [1, 2, 3, 4];

function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="s-switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

export function SettingsPage({ settings, paths, onSettingsChange, onHistoryChange }: SettingsPageProps) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [clearing, setClearing] = useState(false);

  const patch = async (body: SearchSettingsPatch, message?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await searchApi.patchSettings(body);
      onSettingsChange(next);
      if (message) toast(message, 'success');
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const pickDir = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const dir = await searchApi.pickDir();
      if (dir) {
        const next = await searchApi.patchSettings({ saveDir: dir });
        onSettingsChange(next);
        toast('下载目录已更新', 'success');
      }
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const openDir = async () => {
    try {
      await downloadsApi.openFolder();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };

  const clearHistory = async () => {
    const ok = await confirm({
      title: '清空搜索历史',
      message: '确定清空全部搜索历史吗？此操作无法撤销。',
      confirmText: '清空',
      danger: true,
    });
    if (!ok) return;
    setClearing(true);
    try {
      const next = await searchApi.clearHistory();
      onHistoryChange(next);
      toast('搜索历史已清空', 'success');
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setClearing(false);
    }
  };

  const saveDir = settings.saveDir || paths?.saveDir || paths?.downloads || '';

  return (
    <div className="s-page s-settings-page">
      <div className="s-page-head">
        <div className="s-page-heading">
          <h2>设置</h2>
          <p>偏好会立即生效并自动保存</p>
        </div>
      </div>

      <div className="s-settings">
        <section className="s-card">
          <div className="s-card-head">
            <div className="s-card-title">
              <span className="s-card-icon">
                <Icon name="globe" size={15} />
              </span>
              搜索引擎
            </div>
            <span className="s-card-hint">下次搜索生效</span>
          </div>
          <div className="s-engine-grid" role="radiogroup" aria-label="搜索引擎">
            {ENGINES.map((engine) => {
              const active = settings.engine === engine.value;
              return (
                <button
                  key={engine.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`s-engine-card${active ? ' active' : ''}`}
                  disabled={busy}
                  onClick={() => void patch({ engine: engine.value }, `已切换到 ${engine.name}`)}
                >
                  <span className="s-engine-glyph" data-engine={engine.value}>
                    {engine.glyph}
                  </span>
                  <span className="s-engine-text">
                    <span className="s-engine-name">{engine.name}</span>
                    <span className="s-engine-desc">{engine.desc}</span>
                  </span>
                  <span className={`s-radio${active ? ' on' : ''}`}>{active ? <Icon name="check" size={11} /> : null}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="s-card">
          <div className="s-card-head">
            <div className="s-card-title">
              <span className="s-card-icon">
                <Icon name="search" size={15} />
              </span>
              搜索结果
            </div>
            <span className="s-card-hint">每页返回条数</span>
          </div>
          <div className="s-setting-row">
            <div className="s-setting-text">
              <span className="s-setting-label">结果数量</span>
              <span className="s-setting-desc">数量越多加载越慢，10–30 条最合适</span>
            </div>
            <div className="s-seg">
              {RESULT_COUNTS.map((count) => (
                <button
                  key={count}
                  type="button"
                  className={settings.resultCount === count ? 'active' : ''}
                  disabled={busy}
                  onClick={() => void patch({ resultCount: count })}
                >
                  {count}
                </button>
              ))}
            </div>
          </div>
          <div className="s-setting-row">
            <div className="s-setting-text">
              <span className="s-setting-label">下载并发数</span>
              <span className="s-setting-desc">同时进行的下载任务数量</span>
            </div>
            <div className="s-seg">
              {CONCURRENCY.map((count) => (
                <button
                  key={count}
                  type="button"
                  className={settings.concurrentDownloads === count ? 'active' : ''}
                  disabled={busy}
                  onClick={() => void patch({ concurrentDownloads: count })}
                >
                  {count}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="s-card">
          <div className="s-card-head">
            <div className="s-card-title">
              <span className="s-card-icon">
                <Icon name="sparkle" size={15} />
              </span>
              体验
            </div>
          </div>
          <div className="s-setting-row">
            <div className="s-setting-text">
              <span className="s-setting-label">动画效果</span>
              <span className="s-setting-desc">流光背景与页面过渡动画，关闭后更省电</span>
            </div>
            <Toggle
              checked={settings.animations}
              disabled={busy}
              label="动画效果"
              onChange={(next) => void patch({ animations: next }, next ? '已开启动画' : '已关闭动画')}
            />
          </div>
          <div className="s-setting-row">
            <div className="s-setting-text">
              <span className="s-setting-label">记录搜索历史</span>
              <span className="s-setting-desc">自动保存搜索过的关键词，方便再次查找</span>
            </div>
            <Toggle
              checked={settings.historyEnabled}
              disabled={busy}
              label="记录搜索历史"
              onChange={(next) => void patch({ historyEnabled: next }, next ? '已开启历史记录' : '已关闭历史记录')}
            />
          </div>
          <div className="s-setting-row">
            <div className="s-setting-text">
              <span className="s-setting-label">搜索后自动聚焦结果</span>
              <span className="s-setting-desc">搜索完成时把键盘焦点移到结果列表</span>
            </div>
            <Toggle
              checked={settings.autoFocusResults}
              disabled={busy}
              label="搜索后自动聚焦结果"
              onChange={(next) => void patch({ autoFocusResults: next })}
            />
          </div>
        </section>

        <section className="s-card">
          <div className="s-card-head">
            <div className="s-card-title">
              <span className="s-card-icon">
                <Icon name="folder" size={15} />
              </span>
              下载目录
            </div>
            <span className="s-card-hint">新任务保存到这里</span>
          </div>
          <div className="s-path-row">
            <span className="s-path-value" title={saveDir}>
              <Icon name="folder" size={13} />
              <span>{saveDir || '使用默认下载目录'}</span>
            </span>
            <div className="s-path-actions">
              <button type="button" className="s-btn ghost" disabled={busy} onClick={() => void pickDir()}>
                选择目录
              </button>
              <button type="button" className="s-btn ghost" onClick={() => void openDir()}>
                打开目录
              </button>
              {settings.saveDir ? (
                <button
                  type="button"
                  className="s-btn ghost"
                  disabled={busy}
                  onClick={() => void patch({ saveDir: '' }, '已恢复默认目录')}
                >
                  恢复默认
                </button>
              ) : null}
            </div>
          </div>
        </section>

        <section className="s-card">
          <div className="s-card-head">
            <div className="s-card-title">
              <span className="s-card-icon">
                <Icon name="trash" size={15} />
              </span>
              数据
            </div>
          </div>
          <div className="s-setting-row">
            <div className="s-setting-text">
              <span className="s-setting-label">清空搜索历史</span>
              <span className="s-setting-desc">只清除关键词记录，不影响书签和下载</span>
            </div>
            <button
              type="button"
              className="s-btn ghost danger-text"
              disabled={clearing}
              onClick={() => void clearHistory()}
            >
              {clearing ? '正在清空…' : '清空历史'}
            </button>
          </div>
          <div className="s-setting-row">
            <div className="s-setting-text">
              <span className="s-setting-label">下载保存位置</span>
              <span className="s-setting-desc s-mono">{paths?.downloads || '默认下载目录'}</span>
            </div>
            <button type="button" className="s-btn ghost" onClick={() => void openDir()}>
              打开
            </button>
          </div>
        </section>

        <p className="s-settings-foot">流光搜索 · 设置会自动同步到主进程，无需手动保存</p>
      </div>
    </div>
  );
}
