/** 流光搜索 · 搜索页（hero + 建议 + 结果玻璃列表） */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SearchBookmark, SearchHistoryEntry, SearchResponse, SearchResult } from '@shared/search';
import FluidBackground from '../fluid/FluidBackground';
import { Icon } from '../components/Icon';
import { ResultCard, ResultSkeleton } from '../components/ResultList';
import { SearchBox } from '../components/SearchBox';
import { searchApi } from '../lib/api';
import { engineLabel, errorText } from '../lib/format';
import { toast } from '../lib/toast';

const QUICK_PROMPTS = ['玻璃拟态设计灵感', 'TypeScript 泛型', 'Electron 性能优化', '免费高清壁纸'];

export interface SearchPageProps {
  query: string;
  response: SearchResponse | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  bookmarks: SearchBookmark[];
  history: SearchHistoryEntry[];
  animations: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onQueryChange: (value: string) => void;
  onSubmit: (query: string) => void;
  onLoadMore: () => void;
  onBack: () => void;
  onOpenResult: (result: SearchResult) => void;
  onDownloadResult: (result: SearchResult) => void;
  onToggleBookmark: (result: SearchResult) => void;
}

export function SearchPage({
  query,
  response,
  loading,
  loadingMore,
  error,
  bookmarks,
  history,
  animations,
  inputRef,
  onQueryChange,
  onSubmit,
  onLoadMore,
  onBack,
  onOpenResult,
  onDownloadResult,
  onToggleBookmark,
}: SearchPageProps) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; result: SearchResult } | null>(null);
  const suggestTimer = useRef<number | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (suggestTimer.current) window.clearTimeout(suggestTimer.current);
    };
  }, []);

  // 输入建议：160ms 防抖，只在输入框有内容时请求
  useEffect(() => {
    const text = query.trim();
    if (suggestTimer.current) {
      window.clearTimeout(suggestTimer.current);
      suggestTimer.current = null;
    }
    if (text.length < 2) {
      setSuggestions([]);
      return;
    }
    suggestTimer.current = window.setTimeout(() => {
      suggestTimer.current = null;
      searchApi
        .suggest(text)
        .then((list) => {
          if (!alive.current) return;
          const unique = Array.from(new Set(list.filter((item) => item && item !== text)));
          setSuggestions(unique.slice(0, 7));
        })
        .catch(() => {
          if (alive.current) setSuggestions([]);
        });
    }, 160);
    return () => {
      if (suggestTimer.current) {
        window.clearTimeout(suggestTimer.current);
        suggestTimer.current = null;
      }
    };
  }, [query]);

  const bookmarkedUrls = useMemo(() => new Set(bookmarks.map((item) => item.url)), [bookmarks]);
  const compact = Boolean(response) || loading || Boolean(error);

  // 右键菜单：点击空白 / 滚动 / Esc 关闭
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const copyLink = useCallback(async (result: SearchResult) => {
    try {
      await navigator.clipboard.writeText(result.url);
      toast('链接已复制', 'success');
    } catch {
      toast('复制失败，请手动选择链接复制', 'error');
    }
  }, []);

  const menuX = menu ? Math.max(8, Math.min(menu.x, window.innerWidth - 216)) : 0;
  const menuY = menu ? Math.max(8, Math.min(menu.y, window.innerHeight - 208)) : 0;

  const recentChips = useMemo(() => {
    const seen = new Set<string>();
    const chips: string[] = [];
    for (const entry of history) {
      const text = entry.query?.trim();
      if (!text || seen.has(text.toLowerCase())) continue;
      seen.add(text.toLowerCase());
      chips.push(text);
      if (chips.length >= 5) break;
    }
    return chips;
  }, [history]);

  const openSearchPage = useCallback(async () => {
    if (!response?.query) return;
    try {
      await searchApi.openQuery(response.query);
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }, [response?.query]);

  return (
    <div className="s-page s-search-page">
      <section className={`s-hero${compact ? ' compact' : ''}`}>
        {animations ? (
          <FluidBackground variant="hero" className="s-hero-fluid" />
        ) : (
          <div className="s-hero-static" aria-hidden="true" />
        )}
        <div className="s-hero-inner">
          {!compact ? (
            <div className="s-hero-heading">
              <h1 className="s-hero-title">流光搜索</h1>
              <p className="s-hero-subtitle">在光里找到答案，也把文件带回家</p>
            </div>
          ) : null}

          <SearchBox
            variant="hero"
            value={query}
            onChange={onQueryChange}
            onSubmit={onSubmit}
            suggestions={suggestions}
            loading={loading}
            engineLabel={engineLabel(response?.engine ?? undefined)}
            inputRef={inputRef}
            onEscape={() => {
              if (response) onBack();
            }}
          />

          {!compact ? (
            <div className="s-hero-chips">
              <span className="s-chips-label">{recentChips.length ? '最近搜索' : '试试'}</span>
              <div className="s-chips">
                {(recentChips.length ? recentChips : QUICK_PROMPTS).map((text) => (
                  <button key={text} type="button" className="s-chip" onClick={() => onSubmit(text)}>
                    {recentChips.length ? <Icon name="history" size={11} /> : <Icon name="sparkle" size={11} />}
                    <span>{text}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {compact ? (
        <div className="s-results">
          <div className="s-results-head">
            <div className="s-results-meta">
              {response ? (
                <>
                  <span className="s-results-query">{response.query}</span>
                  <span className="s-results-count">
                    {response.results.length} 条结果
                    <span className="s-dot-sep" />
                    {response.elapsedMs} ms
                    <span className="s-dot-sep" />
                    {engineLabel(response.engine)}
                  </span>
                </>
              ) : (
                <span className="s-results-query">{loading ? '正在搜索…' : '搜索遇到问题'}</span>
              )}
            </div>
            <div className="s-results-actions">
              <button type="button" className="s-text-btn" title="在浏览器中查看全部结果" onClick={() => void openSearchPage()}>
                <Icon name="external" size={13} />
                在浏览器查看
              </button>
              <button type="button" className="s-text-btn" onClick={onBack}>
                <Icon name="close" size={13} />
                返回首页
              </button>
            </div>
          </div>

          {error && !loading ? (
            <div className="s-error-card">
              <span className="s-error-icon">
                <Icon name="alert" size={17} />
              </span>
              <div className="s-error-body">
                <div className="s-error-title">搜索失败</div>
                <div className="s-error-message">{error}</div>
              </div>
              <button type="button" className="s-btn primary" onClick={() => onSubmit(query)}>
                重试
              </button>
            </div>
          ) : null}

          {loading && !response
            ? Array.from({ length: 5 }).map((_, index) => <ResultSkeleton key={index} />)
            : null}

          {response && !loading && response.results.length === 0 ? (
            <div className="s-empty">
              <span className="s-empty-icon">
                <Icon name="search" size={22} />
              </span>
              <div className="s-empty-title">没有找到匹配的结果</div>
              <div className="s-empty-desc">换个关键词，或试试更短的描述</div>
            </div>
          ) : null}

          {(response?.results ?? []).map((result) => (
            <ResultCard
              key={result.id || result.url}
              result={result}
              bookmarked={bookmarkedUrls.has(result.url)}
              onOpen={onOpenResult}
              onDownload={onDownloadResult}
              onBookmark={onToggleBookmark}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ x: event.clientX, y: event.clientY, result });
              }}
            />
          ))}

          {response?.hasMore ? (
            <button type="button" className="s-load-more" onClick={onLoadMore} disabled={loadingMore}>
              {loadingMore ? <span className="s-spinner dark" /> : <Icon name="plus" size={14} />}
              {loadingMore ? '正在加载…' : '加载更多结果'}
            </button>
          ) : null}
        </div>
      ) : null}

      {menu ? (
        <div
          className="s-context-menu"
          style={{ left: menuX, top: menuY }}
          onMouseDown={(event) => event.stopPropagation()}
          role="menu"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onOpenResult(menu.result);
              setMenu(null);
            }}
          >
            <Icon name="external" size={14} />
            在浏览器中打开
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void copyLink(menu.result);
              setMenu(null);
            }}
          >
            <Icon name="link" size={14} />
            复制链接
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onDownloadResult(menu.result);
              setMenu(null);
            }}
          >
            <Icon name="download" size={14} />
            加入下载队列
          </button>
          <div className="s-context-sep" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onToggleBookmark(menu.result);
              setMenu(null);
            }}
          >
            <Icon name={bookmarkedUrls.has(menu.result.url) ? 'bookmarkFilled' : 'bookmark'} size={14} />
            {bookmarkedUrls.has(menu.result.url) ? '取消收藏' : '收藏此结果'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
