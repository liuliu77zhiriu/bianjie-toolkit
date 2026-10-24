/**
 * 流光搜索 · 应用外壳
 *
 * 职责：窗口标题栏 / 左侧导航 / 页面切换 / 数据加载与事件订阅 / 全局快捷键。
 * 启动顺序：先注册 search:downloads、search:open、search:window-state 监听，
 * 再调用 window.tk.searchWindow.ready()（主进程会在 ready 后补发 search:open）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DownloadItem,
  DownloadProgressPayload,
  SearchBookmark,
  SearchHistoryEntry,
  SearchOpenOptions,
  SearchPaths,
  SearchResponse,
  SearchResult,
  SearchSettings,
  SearchSettingsPatch,
} from '@shared/search';
import FluidBackground from './fluid/FluidBackground';import { Sidebar, type SearchTab } from './components/Sidebar';
import { WindowChrome } from './components/WindowChrome';
import { BookmarksPage } from './pages/BookmarksPage';
import { DownloadsPage } from './pages/DownloadsPage';
import { HistoryPage } from './pages/HistoryPage';
import { SearchPage } from './pages/SearchPage';
import { SettingsPage } from './pages/SettingsPage';
import { downloadsApi, on, searchApi } from './lib/api';
import { ConfirmProvider } from './lib/confirm';
import { errorText } from './lib/format';
import { ToastHost, toast } from './lib/toast';

const FALLBACK_SETTINGS: SearchSettings = {
  engine: 'bing',
  resultCount: 20,
  saveDir: '',
  concurrentDownloads: 2,
  animations: true,
  historyEnabled: true,
  autoFocusResults: true,
};

function mergeDownloads(previous: DownloadItem[], created: DownloadItem[]): DownloadItem[] {
  const ids = new Set(created.map((item) => item.id));
  const rest = previous.filter((item) => !ids.has(item.id));
  return [...created, ...rest];
}

export function SearchApp() {
  return (
    <ConfirmProvider>
      <SearchAppContent />
    </ConfirmProvider>
  );
}

function SearchAppContent() {
  const [tab, setTab] = useState<SearchTab>('search');
  const [maximized, setMaximized] = useState(false);

  const [query, setQuery] = useState('');
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [settings, setSettings] = useState<SearchSettings>(FALLBACK_SETTINGS);
  const [paths, setPaths] = useState<SearchPaths | null>(null);

  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  const [bookmarks, setBookmarks] = useState<SearchBookmark[]>([]);
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [changedId, setChangedId] = useState<string>('');

  const [historyLoading, setHistoryLoading] = useState(true);
  const [bookmarksLoading, setBookmarksLoading] = useState(true);
  const [downloadsLoading, setDownloadsLoading] = useState(true);

  const heroInputRef = useRef<HTMLInputElement | null>(null);
  const requestSeq = useRef(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const report = useCallback((err: unknown) => {
    const message = errorText(err);
    toast(message, 'error');
  }, []);

  /* ---------------------------------------------------------- 数据加载 */

  const refreshHistory = useCallback(async (silent = true) => {
    setHistoryLoading(true);
    try {
      const list = await searchApi.history();
      setHistory(Array.isArray(list) ? list : []);
    } catch (err) {
      if (!silent) report(err);
      else console.warn('[search] history load failed', err);
    } finally {
      setHistoryLoading(false);
    }
  }, [report]);

  const refreshBookmarks = useCallback(async (silent = true) => {
    setBookmarksLoading(true);
    try {
      const list = await searchApi.bookmarks();
      setBookmarks(Array.isArray(list) ? list : []);
    } catch (err) {
      if (!silent) report(err);
      else console.warn('[search] bookmarks load failed', err);
    } finally {
      setBookmarksLoading(false);
    }
  }, [report]);

  const refreshDownloads = useCallback(async (silent = true) => {
    setDownloadsLoading(true);
    try {
      const list = await downloadsApi.list();
      setDownloads(Array.isArray(list) ? list : []);
    } catch (err) {
      if (!silent) report(err);
      else console.warn('[search] downloads load failed', err);
    } finally {
      setDownloadsLoading(false);
    }
  }, [report]);

  /* ---------------------------------------------------------- 搜索 */

  const runSearch = useCallback(
    async (raw: string, page = 1) => {
      const text = raw.trim();
      if (!text) return;
      const seq = ++requestSeq.current;
      setQuery(text);
      setTab('search');
      setSearchError(null);
      if (page <= 1) {
        setResponse(null);
        setLoading(true);
        setLoadingMore(false);
      } else {
        setLoadingMore(true);
      }
      try {
        const result = await searchApi.search(text, page);
        if (seq !== requestSeq.current) return;
        const normalized: SearchResponse = {
          ...result,
          query: result.query || text,
          page: result.page && result.page > 0 ? result.page : page,
          results: Array.isArray(result.results) ? result.results : [],
        };
        if (page > 1) {
          setResponse((previous) =>
            previous
              ? {
                  ...normalized,
                  results: [...previous.results, ...normalized.results],
                  page: Math.max(normalized.page, previous.page),
                }
              : normalized
          );
        } else {
          setResponse(normalized);
        }
        void refreshHistory(true);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        if (page <= 1) setResponse(null);
        setSearchError(errorText(err));
        report(err);
      } finally {
        if (seq === requestSeq.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [refreshHistory, report]
  );

  const runSearchRef = useRef(runSearch);
  useEffect(() => {
    runSearchRef.current = runSearch;
  }, [runSearch]);

  const submitSearch = useCallback(
    (text: string) => {
      void runSearch(text, 1).then(() => {
        if (!settingsRef.current.autoFocusResults) return;
        window.requestAnimationFrame(() => {
          const target = document.querySelector<HTMLElement>('.s-result-title, .s-error-card .s-btn');
          target?.focus();
        });
      });
    },
    [runSearch]
  );

  const loadMore = useCallback(() => {
    if (!response || loadingMore) return;
    void runSearch(response.query, (response.page || 1) + 1);
  }, [response, loadingMore, runSearch]);

  const backToHome = useCallback(() => {
    requestSeq.current += 1;
    setResponse(null);
    setSearchError(null);
    setLoading(false);
    setLoadingMore(false);
    window.requestAnimationFrame(() => heroInputRef.current?.focus());
  }, []);

  /* ---------------------------------------------------------- 启动与事件 */

  useEffect(() => {
    const offs: Array<() => void> = [];

    offs.push(
      on('search:downloads', (payload) => {
        const data = payload as DownloadProgressPayload | null;
        if (data && Array.isArray(data.items)) {
          setDownloads(data.items);
          if (data.changedId) setChangedId(data.changedId);
        }
      })
    );

    offs.push(
      on('search:open', (payload) => {
        const options = (payload ?? {}) as SearchOpenOptions;
        if (options.tab) setTab(options.tab);
        const text = options.query?.trim();
        if (text) void runSearchRef.current(text, 1);
      })
    );

    offs.push(
      on('search:window-state', (payload) => {
        setMaximized(!!(payload as { maximized?: boolean } | null)?.maximized);
      })
    );

    const bootstrap = async () => {
      try {
        const nextSettings = await searchApi.getSettings();
        if (nextSettings) setSettings(nextSettings);
      } catch (err) {
        console.warn('[search] settings load failed', err);
      }
      try {
        const nextPaths = await searchApi.paths();
        if (nextPaths) setPaths(nextPaths);
      } catch (err) {
        console.warn('[search] paths load failed', err);
      }
      await Promise.allSettled([refreshHistory(true), refreshBookmarks(true), refreshDownloads(true)]);
    };
    void bootstrap();

    // 事件先注册，再通知主进程渲染层就绪（主进程会补发 search:open / window-state）
    window.tk.searchWindow?.ready();

    return () => {
      offs.forEach((off) => off());
    };
  }, [refreshBookmarks, refreshDownloads, refreshHistory]);

  // 下载条目高亮 1.4s 后自动熄灭
  useEffect(() => {
    if (!changedId) return;
    const timer = window.setTimeout(() => setChangedId(''), 1400);
    return () => window.clearTimeout(timer);
  }, [changedId]);

  // Ctrl/Cmd+K、Ctrl/Cmd+L 聚焦搜索；Esc 返回首屏
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && (event.key.toLowerCase() === 'k' || event.key.toLowerCase() === 'l')) {
        event.preventDefault();
        if (tab !== 'search') setTab('search');
        window.setTimeout(() => heroInputRef.current?.focus(), 50);
        return;
      }
      if (event.key === 'Escape' && tab === 'search' && response) {
        if (event.defaultPrevented) return;
        event.preventDefault();
        backToHome();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tab, response, backToHome]);

  /* ---------------------------------------------------------- 交互动作 */

  const openUrl = useCallback(
    async (url: string) => {
      try {
        await searchApi.openUrl(url);
      } catch (err) {
        report(err);
      }
    },
    [report]
  );

  const openResult = useCallback(
    (result: SearchResult) => {
      void openUrl(result.url);
    },
    [openUrl]
  );

  const downloadResult = useCallback(
    async (result: SearchResult) => {
      try {
        const created = await downloadsApi.start({
          url: result.url,
          name: result.suggestedName,
          source: 'search',
        });
        if (created.length) setDownloads((previous) => mergeDownloads(previous, created));
        toast('已加入下载队列', 'success');
      } catch (err) {
        report(err);
      }
    },
    [report]
  );

  const toggleBookmark = useCallback(
    async (result: SearchResult) => {
      try {
        const existing = bookmarks.find((item) => item.url === result.url);
        if (existing) {
          const next = await searchApi.removeBookmark(existing.id);
          setBookmarks(next);
          toast('已取消收藏', 'success');
        } else {
          const next = await searchApi.addBookmark(result);
          setBookmarks(next);
          toast('已收藏到书签', 'success');
        }
      } catch (err) {
        report(err);
      }
    },
    [bookmarks, report]
  );

  const updateSettings = useCallback((next: SearchSettings) => {
    setSettings(next);
  }, []);

  const applySettingsPatch = useCallback(
    async (patch: SearchSettingsPatch) => {
      try {
        const next = await searchApi.patchSettings(patch);
        setSettings(next);
      } catch (err) {
        report(err);
      }
    },
    [report]
  );

  const activeDownloadCount = useMemo(
    () => downloads.filter((item) => item.status === 'downloading' || item.status === 'queued').length,
    [downloads]
  );

  useEffect(() => {
    document.documentElement.dataset.motion = settings.animations ? 'on' : 'off';
    document.documentElement.dataset.forceMotion = settings.animations ? 'on' : 'off';
  }, [settings.animations]);

  const historyForSearch = settings.historyEnabled ? history : [];

  return (
    <div className="s-window" data-animations={settings.animations ? 'on' : 'off'}>
      <WindowChrome
        query={query}
        engine={settings.engine}
        maximized={maximized}
        onQueryChange={setQuery}
        onSubmit={submitSearch}
        onMinimize={() => window.tk.searchWindow?.minimize()}
        onToggleMaximize={() => window.tk.searchWindow?.toggleMaximize()}
        onClose={() => window.tk.searchWindow?.close()}
      />

      <div className="s-body">
        <Sidebar active={tab} onChange={setTab} badge={activeDownloadCount} />
        <main className="s-main" key={tab}>
          {tab === 'search' ? (
            <SearchPage
              query={query}
              response={response}
              loading={loading}
              loadingMore={loadingMore}
              error={searchError}
              bookmarks={bookmarks}
              history={historyForSearch}
              animations={settings.animations}
              inputRef={heroInputRef}
              onQueryChange={setQuery}
              onSubmit={submitSearch}
              onLoadMore={loadMore}
              onBack={backToHome}
              onOpenResult={openResult}
              onDownloadResult={(result) => void downloadResult(result)}
              onToggleBookmark={(result) => void toggleBookmark(result)}
            />
          ) : null}

          {tab === 'downloads' ? (
            <DownloadsPage
              items={downloads}
              settings={settings}
              paths={paths}
              changedId={changedId}
              loading={downloadsLoading}
              onItemsChange={setDownloads}
              onSettingsChange={updateSettings}
            />
          ) : null}

          {tab === 'history' ? (
            <HistoryPage
              items={history}
              loading={historyLoading}
              onSearch={submitSearch}
              onHistoryChange={setHistory}
            />
          ) : null}

          {tab === 'bookmarks' ? (
            <BookmarksPage
              items={bookmarks}
              loading={bookmarksLoading}
              onOpen={(url) => void openUrl(url)}
              onBookmarksChange={setBookmarks}
            />
          ) : null}

          {tab === 'settings' ? (
            <SettingsPage
              settings={settings}
              paths={paths}
              onSettingsChange={updateSettings}
              onHistoryChange={setHistory}
            />
          ) : null}
        </main>
      </div>

      <ToastHost />
    </div>
  );
}


