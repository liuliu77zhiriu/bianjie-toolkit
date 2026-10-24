/** 流光搜索 · 搜索历史页 */
import { useMemo, useState } from 'react';
import type { SearchHistoryEntry } from '@shared/search';
import { Icon } from '../components/Icon';
import { searchApi } from '../lib/api';
import { formatRelative } from '../lib/format';
import { useConfirm } from '../lib/confirm';
import { toast } from '../lib/toast';

export interface HistoryPageProps {
  items: SearchHistoryEntry[];
  loading: boolean;
  onSearch: (query: string) => void;
  onHistoryChange: (items: SearchHistoryEntry[]) => void;
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '更早';
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const time = date.getTime();
  if (time >= startOfToday) return '今天';
  if (time >= startOfToday - 86_400_000) return '昨天';
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

export function HistoryPage({ items, loading, onSearch, onHistoryChange }: HistoryPageProps) {
  const confirm = useConfirm();
  const [filter, setFilter] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const groups = useMemo(() => {
    const keyword = filter.trim().toLowerCase();
    const filtered = keyword
      ? items.filter((item) => item.query.toLowerCase().includes(keyword))
      : items;
    const result: Array<{ label: string; entries: SearchHistoryEntry[] }> = [];
    for (const entry of filtered) {
      const label = dayLabel(entry.at);
      const last = result[result.length - 1];
      if (last && last.label === label) last.entries.push(entry);
      else result.push({ label, entries: [entry] });
    }
    return result;
  }, [items, filter]);

  const clearAll = async () => {
    if (!items.length) return;
    const ok = await confirm({
      title: '清空搜索历史',
      message: `确定清空全部 ${items.length} 条搜索历史吗？此操作无法撤销。`,
      confirmText: '清空',
      danger: true,
    });
    if (!ok) return;
    try {
      const next = await searchApi.clearHistory();
      onHistoryChange(next);
      toast('搜索历史已清空', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : '清空失败', 'error');
    }
  };

  const removeOne = async (entry: SearchHistoryEntry) => {
    if (busyId) return;
    setBusyId(entry.id);
    try {
      const next = await searchApi.removeHistory(entry.id);
      onHistoryChange(next);
      toast('已删除这条记录', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : '删除失败', 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="s-page s-history-page">
      <div className="s-page-head">
        <div className="s-page-heading">
          <h2>搜索历史</h2>
          <p>共 {items.length} 条记录 · 点击可直接重新搜索</p>
        </div>
        <div className="s-page-head-actions">
          <div className="s-filter">
            <Icon name="search" size={13} />
            <input
              value={filter}
              placeholder="在历史中筛选"
              aria-label="筛选搜索历史"
              onChange={(event) => setFilter(event.currentTarget.value)}
            />
          </div>
          <button type="button" className="s-btn ghost danger-text" disabled={!items.length} onClick={() => void clearAll()}>
            <Icon name="trash" size={14} />
            清空历史
          </button>
        </div>
      </div>

      {loading && !items.length ? (
        <div className="s-loading-block">
          <span className="s-spinner dark" />
          正在读取历史…
        </div>
      ) : null}

      {!loading && !items.length && !filter ? (
        <div className="s-empty large">
          <span className="s-empty-icon">
            <Icon name="history" size={24} />
          </span>
          <div className="s-empty-title">还没有搜索历史</div>
          <div className="s-empty-desc">开启「记录搜索历史」后，搜索过的关键词会出现在这里</div>
        </div>
      ) : null}

      {items.length > 0 && !groups.length ? (
        <div className="s-empty">
          <div className="s-empty-title">没有匹配「{filter}」的历史</div>
          <div className="s-empty-desc">换一个关键词试试</div>
        </div>
      ) : null}

      {groups.map((group) => (
        <section key={group.label} className="s-history-group">
          <div className="s-group-label">{group.label}</div>
          <div className="s-history-list">
            {group.entries.map((entry) => (
              <div key={entry.id} className={`s-history-row${busyId === entry.id ? ' busy' : ''}`}>
                <button type="button" className="s-history-main" onClick={() => onSearch(entry.query)} title={`重新搜索「${entry.query}」`}>
                  <span className="s-history-icon">
                    <Icon name="clock" size={15} />
                  </span>
                  <span className="s-history-text">{entry.query}</span>
                  <span className="s-history-meta">
                    {entry.resultCount > 0 ? `${entry.resultCount} 条结果` : '无结果'}
                    <span className="s-dot-sep" />
                    {formatRelative(entry.at)}
                  </span>
                  <span className="s-history-go">
                    <Icon name="arrowRight" size={14} />
                  </span>
                </button>
                <button
                  type="button"
                  className="s-icon-btn danger"
                  title="删除这条记录"
                  aria-label="删除这条记录"
                  disabled={busyId === entry.id}
                  onClick={() => void removeOne(entry)}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
