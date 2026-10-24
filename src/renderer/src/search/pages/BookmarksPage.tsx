/** 流光搜索 · 书签页 */
import { useState } from 'react';
import type { SearchBookmark } from '@shared/search';
import { Favicon } from '../components/Favicon';
import { Icon } from '../components/Icon';
import { downloadsApi, searchApi } from '../lib/api';
import { formatRelative, prettyUrl } from '../lib/format';
import { useConfirm } from '../lib/confirm';
import { toast } from '../lib/toast';

export interface BookmarksPageProps {
  items: SearchBookmark[];
  loading: boolean;
  onOpen: (url: string) => void;
  onBookmarksChange: (items: SearchBookmark[]) => void;
}

export function BookmarksPage({ items, loading, onOpen, onBookmarksChange }: BookmarksPageProps) {
  const confirm = useConfirm();
  const [busyId, setBusyId] = useState<string | null>(null);

  const remove = async (bookmark: SearchBookmark) => {
    const ok = await confirm({
      title: '移除书签',
      message: `确定移除「${bookmark.title}」吗？`,
      confirmText: '移除',
      danger: true,
    });
    if (!ok) return;
    if (busyId) return;
    setBusyId(bookmark.id);
    try {
      const next = await searchApi.removeBookmark(bookmark.id);
      onBookmarksChange(next);
      toast('书签已移除', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : '移除失败', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const download = async (bookmark: SearchBookmark) => {
    try {
      await downloadsApi.start({ url: bookmark.url, source: 'bookmark' });
      toast('已加入下载队列', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : '加入下载失败', 'error');
    }
  };

  return (
    <div className="s-page s-bookmarks-page">
      <div className="s-page-head">
        <div className="s-page-heading">
          <h2>书签</h2>
          <p>收藏的搜索结果都会保留在这里，共 {items.length} 条</p>
        </div>
      </div>

      {loading && !items.length ? (
        <div className="s-loading-block">
          <span className="s-spinner dark" />
          正在读取书签…
        </div>
      ) : null}

      {!loading && !items.length ? (
        <div className="s-empty large">
          <span className="s-empty-icon">
            <Icon name="bookmark" size={24} />
          </span>
          <div className="s-empty-title">还没有书签</div>
          <div className="s-empty-desc">在搜索结果右侧点击书签图标，把有用的页面收进来</div>
        </div>
      ) : null}

      {items.length ? (
        <div className="s-bookmark-grid">
          {items.map((bookmark) => (
            <article key={bookmark.id} className={`s-bookmark-card${busyId === bookmark.id ? ' busy' : ''}`}>
              <div className="s-bookmark-head">
                <Favicon url={bookmark.url} label={bookmark.title} size={30} />
                <div className="s-bookmark-title-group">
                  <button
                    type="button"
                    className="s-bookmark-title"
                    title={bookmark.title}
                    onClick={() => onOpen(bookmark.url)}
                  >
                    {bookmark.title}
                  </button>
                  <span className="s-bookmark-url" title={bookmark.url}>
                    {prettyUrl(bookmark.url, 58)}
                  </span>
                </div>
              </div>
              {bookmark.snippet ? <p className="s-bookmark-snippet">{bookmark.snippet}</p> : null}
              <div className="s-bookmark-foot">
                <span className="s-bookmark-time">{formatRelative(bookmark.createdAt)}</span>
                <div className="s-bookmark-actions">
                  <button type="button" className="s-icon-btn" title="下载此链接" onClick={() => void download(bookmark)}>
                    <Icon name="download" size={14} />
                  </button>
                  <button type="button" className="s-icon-btn" title="在浏览器中打开" onClick={() => onOpen(bookmark.url)}>
                    <Icon name="external" size={14} />
                  </button>
                  <button
                    type="button"
                    className="s-icon-btn danger"
                    title="移除书签"
                    disabled={busyId === bookmark.id}
                    onClick={() => void remove(bookmark)}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
