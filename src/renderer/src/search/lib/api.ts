/**
 * 流光搜索 · IPC 契约封装
 *
 * 所有主进程调用集中在这里，方法名以已实现的 core 路由为准：
 *   搜索：search.search / search.suggest / search.getSettings / search.patchSettings /
 *         search.history / search.clearHistory / search.removeHistory /
 *         search.bookmarks / search.addBookmark / search.removeBookmark /
 *         search.paths / search.pickDir / search.openExternal
 *   下载：downloads.list / downloads.start / downloads.pause / downloads.resume /
 *         downloads.cancel / downloads.retry / downloads.remove /
 *         downloads.clearCompleted / downloads.openFile / downloads.openFolder
 *   事件：search:downloads / search:open / search:window-state
 */
import type {
  DownloadItem,
  DownloadStartOptions,
  SearchBookmark,
  SearchHistoryEntry,
  SearchPaths,
  SearchResponse,
  SearchResult,
  SearchSettings,
  SearchSettingsPatch,
  SearchSuggestion,
} from '@shared/search';

/* ------------------------------------------------------------------ 基础 */

export function invoke<T = unknown>(service: string, method: string, args?: unknown): Promise<T> {
  return window.tk.invoke<T>(service, method, args);
}

export function on(topic: string, listener: (payload: unknown) => void): () => void {
  return window.tk.on(topic, listener);
}

/** 主进程 mutator 统一返回全量数组；这里做一次兼容归一。 */
function asItems(value: DownloadItem[] | DownloadItem | null | undefined): DownloadItem[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return [value];
  return [];
}

/* ------------------------------------------------------------------ 搜索 */

export const searchApi = {
  search(query: string, page = 1): Promise<SearchResponse> {
    return invoke<SearchResponse>('core', 'search.search', { query, page });
  },

  /** 主进程返回 string[]；兼容历史结构 { text }。 */
  async suggest(query: string): Promise<string[]> {
    const raw = await invoke<Array<string | SearchSuggestion>>('core', 'search.suggest', { query });
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => (typeof item === 'string' ? item : item?.text ?? ''))
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8);
  },

  getSettings(): Promise<SearchSettings> {
    return invoke<SearchSettings>('core', 'search.getSettings');
  },

  patchSettings(patch: SearchSettingsPatch): Promise<SearchSettings> {
    return invoke<SearchSettings>('core', 'search.patchSettings', patch);
  },

  history(): Promise<SearchHistoryEntry[]> {
    return invoke<SearchHistoryEntry[]>('core', 'search.history');
  },

  clearHistory(): Promise<SearchHistoryEntry[]> {
    return invoke<SearchHistoryEntry[]>('core', 'search.clearHistory');
  },

  removeHistory(id: string): Promise<SearchHistoryEntry[]> {
    return invoke<SearchHistoryEntry[]>('core', 'search.removeHistory', { id });
  },

  bookmarks(): Promise<SearchBookmark[]> {
    return invoke<SearchBookmark[]>('core', 'search.bookmarks');
  },

  /** 传完整 SearchResult，主进程兼容 { result } 包装。 */
  async addBookmark(result: SearchResult): Promise<SearchBookmark[]> {
    const next = await invoke<SearchBookmark[] | null>('core', 'search.addBookmark', { result });
    return Array.isArray(next) ? next : searchApi.bookmarks();
  },

  removeBookmark(id: string): Promise<SearchBookmark[]> {
    return invoke<SearchBookmark[]>('core', 'search.removeBookmark', { id });
  },

  paths(): Promise<SearchPaths> {
    return invoke<SearchPaths>('core', 'search.paths');
  },

  pickDir(): Promise<string | null> {
    return invoke<string | null>('core', 'search.pickDir');
  },

  /** 用系统默认浏览器打开结果链接（不要用 shell.openExternal）。 */
  openUrl(url: string): Promise<boolean> {
    return invoke<boolean>('core', 'search.openExternal', { url });
  },

  /** 打开搜索引擎结果页（可选能力）。 */
  openQuery(query: string): Promise<boolean> {
    return invoke<boolean>('core', 'search.openExternal', { query });
  },
};

/* ------------------------------------------------------------------ 下载 */

export const downloadsApi = {
  list(): Promise<DownloadItem[]> {
    return invoke<DownloadItem[]>('core', 'downloads.list');
  },

  async start(options: DownloadStartOptions): Promise<DownloadItem[]> {
    const created = await invoke<DownloadItem | DownloadItem[] | null>('core', 'downloads.start', options);
    return asItems(created);
  },

  async pause(id: string): Promise<DownloadItem[]> {
    return asItems(await invoke('core', 'downloads.pause', { id }));
  },

  async resume(id: string): Promise<DownloadItem[]> {
    return asItems(await invoke('core', 'downloads.resume', { id }));
  },

  async cancel(id: string): Promise<DownloadItem[]> {
    return asItems(await invoke('core', 'downloads.cancel', { id }));
  },

  async retry(id: string): Promise<DownloadItem[]> {
    return asItems(await invoke('core', 'downloads.retry', { id }));
  },

  async remove(id: string, deleteFile = false): Promise<DownloadItem[]> {
    return asItems(await invoke('core', 'downloads.remove', { id, deleteFile }));
  },

  async clearCompleted(): Promise<DownloadItem[]> {
    return asItems(await invoke('core', 'downloads.clearCompleted'));
  },

  openFile(id: string): Promise<boolean> {
    return invoke<boolean>('core', 'downloads.openFile', { id });
  },

  /** id 省略时打开下载保存目录。 */
  openFolder(id?: string): Promise<boolean> {
    return invoke<boolean>('core', 'downloads.openFolder', id ? { id } : {});
  },
};
