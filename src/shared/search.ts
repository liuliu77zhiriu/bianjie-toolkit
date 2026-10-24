/**
 * 流光搜索 · 数据契约
 * 搜索引擎与下载器共用的类型（主进程 / 渲染进程 / 测试）。
 */

export type SearchEngine = 'bing' | 'duckduckgo';

export interface SearchResult {
  id: string;
  title: string;
  url: string;
  /** 展示用的短链接（去协议/路径截断） */
  displayUrl: string;
  snippet: string;
  engine: SearchEngine;
  /** 链接看起来是可直接下载的文件时给出建议文件名 */
  downloadable?: boolean;
  suggestedName?: string;
}

export interface SearchResponse {
  query: string;
  engine: SearchEngine;
  page: number;
  results: SearchResult[];
  elapsedMs: number;
  hasMore: boolean;
}

export interface SearchSuggestion {
  text: string;
}

export interface SearchHistoryEntry {
  id: string;
  query: string;
  at: string;
  resultCount: number;
}

export interface SearchBookmark {
  id: string;
  title: string;
  url: string;
  snippet: string;
  createdAt: string;
}

export interface SearchSettings {
  engine: SearchEngine;
  resultCount: number;
  saveDir: string;
  concurrentDownloads: number;
  animations: boolean;
  historyEnabled: boolean;
  /** 搜索后是否自动聚焦结果 */
  autoFocusResults: boolean;
}

export type DownloadStatus = 'queued' | 'downloading' | 'paused' | 'completed' | 'error' | 'canceled';

export interface DownloadItem {
  id: string;
  url: string;
  name: string;
  filePath: string;
  status: DownloadStatus;
  receivedBytes: number;
  totalBytes: number;
  speed: number;
  error?: string;
  createdAt: string;
  completedAt?: string;
  mime?: string;
  /** 来源：搜索结果点击 / 手动粘贴 / 页面链接 */
  source?: string;
}

export interface DownloadStartOptions {
  url: string;
  name?: string;
  saveDir?: string;
  source?: string;
}

export interface DownloadProgressPayload {
  items: DownloadItem[];
  /** 最近变化的条目，便于 UI 播放动画 */
  changedId?: string;
}

export interface SearchSettingsPatch {
  engine?: SearchEngine;
  resultCount?: number;
  saveDir?: string;
  concurrentDownloads?: number;
  animations?: boolean;
  historyEnabled?: boolean;
  autoFocusResults?: boolean;
}

export interface SearchOpenOptions {
  query?: string;
  tab?: 'search' | 'downloads' | 'history' | 'bookmarks' | 'settings';
}

export interface SearchWindowState {
  open: boolean;
  maximized: boolean;
}

export interface SearchPaths {
  root: string;
  downloads: string;
  saveDir: string;
}
