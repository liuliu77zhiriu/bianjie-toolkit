/**
 * 流光搜索 · 搜索服务（主进程）
 *
 * - 设置 / 历史 / 书签持久化在 userData/search/（原子写 JSON）
 * - 搜索：Bing RSS 优先，失败降级 DuckDuckGo HTML；可用 endpoint 覆盖便于本地测试
 * - 建议：DuckDuckGo autocomplete
 * - 无 Electron 依赖：fetch / 日志 / 广播全部注入，便于 node:test 直接测试
 */
import fs from 'node:fs';
import path from 'node:path';
import type {
  SearchBookmark,
  SearchEngine,
  SearchHistoryEntry,
  SearchPaths,
  SearchResponse,
  SearchResult,
  SearchSettings,
  SearchSettingsPatch,
  SearchSuggestion,
} from '../../../shared/search';
import type { AppPaths } from '../../../shared/types';
import type { Logger } from '../logger';
import { ToolkitError } from '../errors';
import {
  buildBingUrl,
  buildDuckDuckGoUrl,
  buildSuggestUrl,
  displayUrlOf,
  hasMoreResults,
  isDownloadableUrl,
  parseBingRss,
  parseDuckDuckGoHtml,
  parseSuggestions,
  resultIdOf,
  suggestedFileName,
} from './parse';

export type SearchFetch = typeof fetch;

export interface SearchEndpoints {
  /** Bing RSS 端点（默认 https://www.bing.com/search） */
  bing?: string;
  /** DuckDuckGo HTML 端点（默认 https://html.duckduckgo.com/html/） */
  duckduckgo?: string;
  /** DuckDuckGo autocomplete 端点（默认 https://duckduckgo.com/ac/） */
  suggest?: string;
}

export interface SearchServiceDeps {
  paths: AppPaths;
  logger: Logger;
  /** 主进程传 (input, init) => net.fetch(input, init)；缺省用全局 fetch */
  fetchImpl?: SearchFetch;
  endpoints?: SearchEndpoints;
  /** 设置变更广播（Lead 接 ipc.broadcast，topic 固定 'search:settings'） */
  broadcast?: (topic: string, payload?: unknown) => void;
  now?: () => Date;
  /** 单次网络请求超时（默认 12s） */
  timeoutMs?: number;
}

export interface SearchOptions {
  engine?: SearchEngine;
  /** 1-based 页码 */
  page?: number;
  resultCount?: number;
  /** 覆盖本次搜索主引擎的端点（本地 RSS 测试 / 自定义镜像） */
  endpoint?: string;
}

export interface SuggestOptions {
  endpoint?: string;
  limit?: number;
}

export const SEARCH_RESULT_COUNT_MIN = 5;
export const SEARCH_RESULT_COUNT_MAX = 50;
export const SEARCH_CONCURRENCY_MIN = 1;
export const SEARCH_CONCURRENCY_MAX = 6;
const HISTORY_LIMIT = 200;
const BOOKMARK_LIMIT = 300;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const ACCEPT_LANGUAGE = 'zh-CN,zh;q=0.9,en;q=0.8';

const DEFAULT_SETTINGS: SearchSettings = {
  engine: 'bing',
  resultCount: 10,
  saveDir: '',
  concurrentDownloads: 2,
  animations: true,
  historyEnabled: true,
  autoFocusResults: false,
};

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function isSearchEngine(value: unknown): value is SearchEngine {
  return value === 'bing' || value === 'duckduckgo';
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isHistoryEntry(value: unknown): value is SearchHistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.query === 'string' && typeof record.at === 'string';
}

function isBookmark(value: unknown): value is SearchBookmark {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.url === 'string' && typeof record.title === 'string';
}

export class SearchService {
  private readonly rootDir: string;
  private readonly downloadsDir: string;
  private readonly settingsFile: string;
  private readonly historyFile: string;
  private readonly bookmarksFile: string;
  private readonly fetchImpl: SearchFetch;
  private readonly now: () => Date;
  private readonly timeoutMs: number;
  private settings: SearchSettings;
  private history: SearchHistoryEntry[];
  private bookmarks: SearchBookmark[];

  constructor(private deps: SearchServiceDeps) {
    this.rootDir = path.join(deps.paths.userData, 'search');
    this.downloadsDir = path.join(this.rootDir, 'downloads');
    this.settingsFile = path.join(this.rootDir, 'settings.json');
    this.historyFile = path.join(this.rootDir, 'history.json');
    this.bookmarksFile = path.join(this.rootDir, 'bookmarks.json');
    this.fetchImpl = deps.fetchImpl ?? ((input, init) => fetch(input, init));
    this.now = deps.now ?? (() => new Date());
    this.timeoutMs = clampInt(deps.timeoutMs ?? 12_000, 12_000, 1_000, 60_000);
    fs.mkdirSync(this.rootDir, { recursive: true });
    fs.mkdirSync(this.downloadsDir, { recursive: true });
    // 构造内同步加载（文件很小），保证 IPC 首次调用即为就绪状态
    this.settings = this.loadSettings();
    this.history = this.loadList(this.historyFile, isHistoryEntry);
    this.bookmarks = this.loadList(this.bookmarksFile, isBookmark);
  }

  /** 兼容 Lead 的显式异步初始化调用；构造时已同步完成加载，这里幂等返回。 */
  async init(): Promise<void> {
    fs.mkdirSync(this.rootDir, { recursive: true });
    fs.mkdirSync(this.downloadsDir, { recursive: true });
  }

  /* ---------------------------------------------------------------- 设置 */

  getSettings(): SearchSettings {
    return { ...this.settings };
  }

  patchSettings(patch: SearchSettingsPatch): SearchSettings {
    const source = (patch && typeof patch === 'object' ? patch : {}) as SearchSettingsPatch;
    const next: SearchSettings = { ...this.settings };
    if (isSearchEngine(source.engine)) next.engine = source.engine;
    if (source.resultCount !== undefined) {
      next.resultCount = clampInt(source.resultCount, next.resultCount, SEARCH_RESULT_COUNT_MIN, SEARCH_RESULT_COUNT_MAX);
    }
    if (source.concurrentDownloads !== undefined) {
      next.concurrentDownloads = clampInt(
        source.concurrentDownloads,
        next.concurrentDownloads,
        SEARCH_CONCURRENCY_MIN,
        SEARCH_CONCURRENCY_MAX
      );
    }
    if (typeof source.animations === 'boolean') next.animations = source.animations;
    if (typeof source.historyEnabled === 'boolean') next.historyEnabled = source.historyEnabled;
    if (typeof source.autoFocusResults === 'boolean') next.autoFocusResults = source.autoFocusResults;
    if (typeof source.saveDir === 'string') next.saveDir = this.normalizeSaveDir(source.saveDir);
    this.settings = next;
    this.writeJson(this.settingsFile, this.settings);
    this.deps.broadcast?.('search:settings', this.getSettings());
    return this.getSettings();
  }

  pathsInfo(): SearchPaths {
    return { root: this.rootDir, downloads: this.downloadsDir, saveDir: this.effectiveSaveDir() };
  }

  /** 生效的下载目录：设置为空时回退到 userData/search/downloads（Lead 可在启动时写入系统下载目录）。 */
  private effectiveSaveDir(): string {
    return this.settings.saveDir || this.downloadsDir;
  }

  /* ---------------------------------------------------------------- 搜索 */

  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const startedAt = Date.now();
    const keyword = String(query ?? '').trim();
    if (!keyword) throw new ToolkitError('BAD_QUERY', '搜索关键词不能为空');
    const resultCount = clampInt(
      options.resultCount ?? this.settings.resultCount,
      this.settings.resultCount,
      SEARCH_RESULT_COUNT_MIN,
      SEARCH_RESULT_COUNT_MAX
    );
    const page = Math.max(1, Math.floor(Number(options.page) || 1));
    const requestedEngine: SearchEngine = isSearchEngine(options.engine) ? options.engine : this.settings.engine;
    const first = (page - 1) * resultCount + 1;
    // 降级顺序：先请求的引擎，失败后尝试另一个
    const attempts: SearchEngine[] = requestedEngine === 'bing' ? ['bing', 'duckduckgo'] : ['duckduckgo', 'bing'];
    const failures: string[] = [];
    for (const engine of attempts) {
      try {
        const endpoint = this.resolveEndpoint(engine, requestedEngine, options.endpoint);
        const raw =
          engine === 'bing'
            ? await this.fetchText(
                buildBingUrl(keyword, { count: resultCount, first, endpoint }),
                'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8'
              )
            : await this.fetchText(
                buildDuckDuckGoUrl(keyword, { endpoint }),
                'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'
              );
        const parsed = engine === 'bing' ? parseBingRss(raw) : parseDuckDuckGoHtml(raw);
        if (!parsed.length) {
          failures.push(`${engine}: 没有解析到结果`);
          continue;
        }
        const results = this.toSearchResults(parsed, engine);
        const response: SearchResponse = {
          query: keyword,
          engine,
          page,
          results,
          elapsedMs: Math.max(0, Date.now() - startedAt),
          hasMore: hasMoreResults(results.length, resultCount),
        };
        this.recordHistory(keyword, results.length);
        return response;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push(`${engine}: ${message}`);
        this.deps.logger.warn(`[search] ${engine} 搜索失败：${message}`);
      }
    }
    throw new ToolkitError('SEARCH_FAILED', `搜索失败，请稍后重试（${failures.join('；') || '未知错误'}）`);
  }

  async suggest(query: string, options: SuggestOptions = {}): Promise<SearchSuggestion[]> {
    const keyword = String(query ?? '').trim();
    if (!keyword) return [];
    const limit = clampInt(options.limit ?? 8, 8, 1, 20);
    const endpoint = options.endpoint ?? this.deps.endpoints?.suggest;
    try {
      const raw = await this.fetchText(buildSuggestUrl(keyword, endpoint), 'application/json,text/javascript;q=0.9,*/*;q=0.8');
      const parsed = JSON.parse(raw) as unknown;
      return parseSuggestions(parsed, limit);
    } catch (err) {
      // 联想词失败不影响输入体验，直接返回空列表
      this.deps.logger.warn('[search] 联想词失败', err);
      return [];
    }
  }

  private resolveEndpoint(engine: SearchEngine, requested: SearchEngine, override?: string): string | undefined {
    // 仅覆盖本次请求的主引擎端点；降级引擎仍用 deps 配置，便于测试两条链路
    if (engine === requested && typeof override === 'string' && override.trim()) return override.trim();
    return engine === 'bing' ? this.deps.endpoints?.bing : this.deps.endpoints?.duckduckgo;
  }

  private toSearchResults(items: ReturnType<typeof parseBingRss>, engine: SearchEngine): SearchResult[] {
    return items.map((item, index) => {
      const result: SearchResult = {
        id: resultIdOf(item.url, index),
        title: item.title || displayUrlOf(item.url),
        url: item.url,
        displayUrl: displayUrlOf(item.url),
        snippet: item.snippet,
        engine,
      };
      if (isDownloadableUrl(item.url)) {
        result.downloadable = true;
        const suggestedName = suggestedFileName(item.url, item.title);
        if (suggestedName) result.suggestedName = suggestedName;
      }
      return result;
    });
  }

  private async fetchText(url: string, accept: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept-Language': ACCEPT_LANGUAGE,
          Accept: accept,
        },
      });
      if (!response.ok) throw new ToolkitError('SEARCH_HTTP', `HTTP ${response.status}`);
      return await response.text();
    } finally {
      clearTimeout(timer);
    }
  }

  /* ---------------------------------------------------------------- 历史 */

  listHistory(): SearchHistoryEntry[] {
    return clone(this.history);
  }

  removeHistory(id: string): SearchHistoryEntry[] {
    const target = String(id ?? '');
    if (!target) return this.listHistory();
    const next = this.history.filter((entry) => entry.id !== target);
    if (next.length !== this.history.length) {
      this.history = next;
      this.writeJson(this.historyFile, this.history);
    }
    return this.listHistory();
  }

  clearHistory(): SearchHistoryEntry[] {
    this.history = [];
    this.writeJson(this.historyFile, this.history);
    return [];
  }

  private recordHistory(query: string, resultCount: number): void {
    if (!this.settings.historyEnabled) return;
    const at = this.now().toISOString();
    const latest = this.history[0];
    if (latest && latest.query === query) {
      latest.at = at;
      latest.resultCount = resultCount;
    } else {
      this.history.unshift({ id: newId('sh'), query, at, resultCount });
    }
    if (this.history.length > HISTORY_LIMIT) this.history = this.history.slice(0, HISTORY_LIMIT);
    this.writeJson(this.historyFile, this.history);
  }

  /* ---------------------------------------------------------------- 书签 */

  listBookmarks(): SearchBookmark[] {
    return clone(this.bookmarks);
  }

  addBookmark(input: { title?: string; url?: string; snippet?: string }): SearchBookmark {
    const source = (input && typeof input === 'object' ? input : {}) as {
      title?: string;
      url?: string;
      snippet?: string;
    };
    const url = String(source.url ?? '').trim();
    if (!/^https?:\/\//i.test(url)) throw new ToolkitError('BAD_URL', '书签地址必须是 http/https 链接');
    const existing = this.bookmarks.find((item) => item.url === url);
    if (existing) return clone(existing);
    const bookmark: SearchBookmark = {
      id: newId('sb'),
      title: String(source.title ?? '').trim() || displayUrlOf(url),
      url,
      snippet: String(source.snippet ?? '').trim(),
      createdAt: this.now().toISOString(),
    };
    this.bookmarks.unshift(bookmark);
    if (this.bookmarks.length > BOOKMARK_LIMIT) this.bookmarks = this.bookmarks.slice(0, BOOKMARK_LIMIT);
    this.writeJson(this.bookmarksFile, this.bookmarks);
    return clone(bookmark);
  }

  removeBookmark(id: string): SearchBookmark[] {
    const target = String(id ?? '');
    if (!target) return this.listBookmarks();
    const next = this.bookmarks.filter((item) => item.id !== target);
    if (next.length !== this.bookmarks.length) {
      this.bookmarks = next;
      this.writeJson(this.bookmarksFile, this.bookmarks);
    }
    return this.listBookmarks();
  }

  clearBookmarks(): SearchBookmark[] {
    this.bookmarks = [];
    this.writeJson(this.bookmarksFile, this.bookmarks);
    return [];
  }

  /* ---------------------------------------------------------------- 持久化 */

  private normalizeSaveDir(raw: unknown): string {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) return '';
    const dir = path.resolve(value);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      this.deps.logger.warn(`[search] 无法创建下载目录 ${dir}`, err);
    }
    return dir;
  }

  private loadSettings(): SearchSettings {
    const raw = this.readJson(this.settingsFile);
    const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<SearchSettings>;
    return {
      engine: isSearchEngine(source.engine) ? source.engine : DEFAULT_SETTINGS.engine,
      resultCount: clampInt(
        source.resultCount,
        DEFAULT_SETTINGS.resultCount,
        SEARCH_RESULT_COUNT_MIN,
        SEARCH_RESULT_COUNT_MAX
      ),
      // '' 表示尚未设置，由主进程启动时写入系统下载目录；pathsInfo().saveDir 返回生效路径
      saveDir: typeof source.saveDir === 'string' ? source.saveDir.trim() : '',
      concurrentDownloads: clampInt(
        source.concurrentDownloads,
        DEFAULT_SETTINGS.concurrentDownloads,
        SEARCH_CONCURRENCY_MIN,
        SEARCH_CONCURRENCY_MAX
      ),
      animations: typeof source.animations === 'boolean' ? source.animations : DEFAULT_SETTINGS.animations,
      historyEnabled:
        typeof source.historyEnabled === 'boolean' ? source.historyEnabled : DEFAULT_SETTINGS.historyEnabled,
      autoFocusResults:
        typeof source.autoFocusResults === 'boolean' ? source.autoFocusResults : DEFAULT_SETTINGS.autoFocusResults,
    };
  }

  private readJson(file: string): unknown {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      if (!raw.trim()) return null;
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  private loadList<T>(file: string, guard: (value: unknown) => value is T): T[] {
    const raw = this.readJson(file);
    if (!Array.isArray(raw)) return [];
    return raw.filter(guard).slice(0, Math.max(HISTORY_LIMIT, BOOKMARK_LIMIT));
  }

  /** 原子写 JSON：临时文件 + rename，避免半写文件损坏设置/历史。 */
  private writeJson(file: string, data: unknown): void {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
      fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
      fs.renameSync(temp, file);
    } catch (err) {
      this.deps.logger.warn(`[search] 写入失败 ${file}`, err);
    }
  }
}
