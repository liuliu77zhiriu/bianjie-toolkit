/**
 * 流光搜索 · 下载器服务（主进程）
 *
 * - 并发队列（默认 2）、流式写盘、实时进度/速度
 * - 暂停 / 继续（HTTP Range 续传，服务端不支持时自动从头开始）、取消、重试
 * - 完成 / 失败历史持久化到 userData/search/downloads.json（原子写）
 * - 无 Electron 依赖：fetch、广播、打开文件/文件夹全部注入，便于 node:test 直接测试
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { DownloadItem, DownloadProgressPayload, DownloadStartOptions } from '../../../shared/search';
import type { AppPaths } from '../../../shared/types';
import type { Logger } from '../logger';
import { ToolkitError } from '../errors';
import { extractContentDispositionFilename, sanitizeFileName, suggestedFileName } from './parse';

export type DownloadFetch = typeof fetch;

export interface DownloadServiceDeps {
  paths: AppPaths;
  logger: Logger;
  fetchImpl: DownloadFetch;
  /** 下载保存目录（Lead 接 search.getSettings().saveDir || search.pathsInfo().downloads） */
  getSaveDir: () => string;
  /** 最大并发数（Lead 接 settings.concurrentDownloads），默认 2，限幅 1–6 */
  getConcurrency?: () => number;
  /** 广播每次进度/状态变化：topic 'search:downloads'，payload DownloadProgressPayload */
  broadcast?: (topic: string, payload?: unknown) => void;
  openFile?: (filePath: string) => unknown;
  openFolder?: (dir: string) => unknown;
  now?: () => Date;
  /** 完成后保留的历史条数（默认 200） */
  maxHistory?: number;
}

interface DownloadRuntime {
  controller: AbortController | null;
  paused: boolean;
  canceled: boolean;
  /** 正在执行的下载任务（暂停后立即 resume 时用于等待旧任务收尾） */
  finished: Promise<void> | null;
  lastBroadcastAt: number;
  lastSampleAt: number;
  lastSampleBytes: number;
  speed: number;
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const DEFAULT_CONCURRENCY = 2;
const MAX_CONCURRENCY = 6;
const HISTORY_LIMIT = 200;
/** 进度广播节流间隔（ms） */
const PROGRESS_INTERVAL = 120;

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function clampConcurrency(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_CONCURRENCY;
  return Math.min(MAX_CONCURRENCY, Math.max(1, Math.round(numeric)));
}

function normalizeDownloadUrl(raw: unknown): string {
  const value = String(raw ?? '').trim();
  const normalized = value.startsWith('//') ? `https:${value}` : value;
  if (!/^https?:\/\//i.test(normalized)) throw new ToolkitError('BAD_URL', '仅支持 http/https 下载地址');
  try {
    void new URL(normalized);
  } catch {
    throw new ToolkitError('BAD_URL', '下载地址格式不正确');
  }
  return normalized;
}

function deriveDownloadName(url: string, explicit?: string): string {
  const provided = typeof explicit === 'string' ? explicit.trim() : '';
  if (provided) return sanitizeFileName(provided);
  const suggested = suggestedFileName(url);
  if (suggested) return sanitizeFileName(suggested);
  try {
    const base = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '');
    if (base) return sanitizeFileName(base);
  } catch {
    /* ignore */
  }
  return 'download';
}

function parseContentRangeTotal(header: string | null): number {
  const match = /\/(\d+)\s*$/.exec(String(header ?? ''));
  return match ? Number(match[1]) : 0;
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const record = err as { name?: string; code?: string; message?: string };
  if (record.name === 'AbortError') return true;
  if (record.code === 'ABORT_ERR') return true;
  return typeof record.message === 'string' && /aborted|AbortError/i.test(record.message);
}

function writeChunk(stream: fs.WriteStream, chunk: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(chunk, (err) => (err ? reject(err) : resolve()));
  });
}

function endStream(stream: fs.WriteStream): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    stream.once('error', done);
    try {
      stream.end(done);
    } catch {
      done();
    }
  });
}

export class DownloadService {
  private readonly historyFile: string;
  private readonly defaultSaveDir: string;
  private readonly now: () => Date;
  private readonly maxHistory: number;
  private readonly items = new Map<string, DownloadItem>();
  private readonly runtimes = new Map<string, DownloadRuntime>();
  /** 创建顺序（从旧到新）；对外 list() 返回新到旧 */
  private order: string[] = [];
  private readonly reserved = new Set<string>();

  constructor(private deps: DownloadServiceDeps) {
    this.defaultSaveDir = path.join(deps.paths.userData, 'search', 'downloads');
    this.historyFile = path.join(deps.paths.userData, 'search', 'downloads.json');
    this.now = deps.now ?? (() => new Date());
    this.maxHistory = Math.max(1, Math.floor(deps.maxHistory ?? HISTORY_LIMIT));
    fs.mkdirSync(path.dirname(this.historyFile), { recursive: true });
    fs.mkdirSync(this.defaultSaveDir, { recursive: true });
    this.loadHistory();
  }

  async init(): Promise<void> {
    fs.mkdirSync(path.dirname(this.historyFile), { recursive: true });
    fs.mkdirSync(this.defaultSaveDir, { recursive: true });
  }

  /** 全部任务，新→旧（UI 直接渲染；队列调度用内部 order 顺序）。 */
  list(): DownloadItem[] {
    return this.order
      .slice()
      .reverse()
      .map((id) => this.items.get(id))
      .filter((item): item is DownloadItem => !!item)
      .map((item) => clone(item));
  }

  get(id: string): DownloadItem {
    return clone(this.requireItem(id));
  }

  /* ---------------------------------------------------------------- 入队 / 调度 */

  async start(options: DownloadStartOptions): Promise<DownloadItem> {
    const source = (options && typeof options === 'object' ? options : {}) as DownloadStartOptions;
    const url = normalizeDownloadUrl(source.url);
    const saveDir = this.resolveSaveDir(source.saveDir);
    const desiredName = deriveDownloadName(url, source.name);
    const filePath = this.reservePath(saveDir, desiredName);
    const item: DownloadItem = {
      id: newId('dl'),
      url,
      name: path.basename(filePath),
      filePath,
      status: 'queued',
      receivedBytes: 0,
      totalBytes: 0,
      speed: 0,
      createdAt: this.now().toISOString(),
      mime: undefined,
      source: typeof source.source === 'string' && source.source.trim() ? source.source.trim() : undefined,
    };
    this.items.set(item.id, item);
    this.runtimes.set(item.id, this.createRuntime());
    this.order.push(item.id);
    this.broadcast(item.id);
    this.pump();
    return clone(item);
  }

  private pump(): void {
    const limit = clampConcurrency(this.deps.getConcurrency?.());
    let active = 0;
    for (const id of this.order) {
      const item = this.items.get(id);
      if (item?.status === 'downloading') active += 1;
    }
    for (const id of this.order) {
      if (active >= limit) break;
      const item = this.items.get(id);
      if (!item || item.status !== 'queued') continue;
      // run() 在首个 await 前同步把状态切到 downloading，避免重复调度
      const runtime = this.runtimeOf(id);
      const promise = this.run(item, runtime);
      runtime.finished = promise.catch(() => undefined);
      active += 1;
    }
  }

  private async run(item: DownloadItem, runtime: DownloadRuntime): Promise<void> {
    const controller = new AbortController();
    runtime.controller = controller;
    runtime.canceled = false;
    runtime.paused = false;
    item.status = 'downloading';
    item.error = undefined;
    item.speed = 0;
    this.broadcast(item.id);
    try {
      await this.transfer(item, runtime, controller);
    } catch (err) {
      this.applyFailure(item, runtime, err);
    } finally {
      runtime.controller = null;
      runtime.speed = 0;
      runtime.lastSampleAt = 0;
      runtime.lastSampleBytes = 0;
      if (runtime.canceled) await this.removePartial(item);
      this.persistHistory();
      this.broadcast(item.id);
      this.pump();
    }
  }

  private async transfer(item: DownloadItem, runtime: DownloadRuntime, controller: AbortController): Promise<void> {
    const resumeFrom = item.receivedBytes > 0 && fs.existsSync(item.filePath) ? item.receivedBytes : 0;
    if (item.receivedBytes > 0 && !resumeFrom) item.receivedBytes = 0;
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Accept: '*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    };
    if (resumeFrom > 0) headers.Range = `bytes=${resumeFrom}-`;
    const response = await this.deps.fetchImpl(item.url, {
      headers,
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);
    }
    // 服务端给出的文件名优先（仅全新下载时生效，续传时保持原路径）
    if (item.receivedBytes === 0) {
      const serverName = extractContentDispositionFilename(response.headers.get('content-disposition'));
      const safeName = serverName ? sanitizeFileName(serverName) : '';
      if (safeName && safeName !== item.name) {
        this.releasePath(item.filePath);
        const nextPath = this.reservePath(path.dirname(item.filePath), safeName);
        item.filePath = nextPath;
        item.name = path.basename(nextPath);
      }
    }
    const contentType = response.headers.get('content-type');
    if (contentType) item.mime = contentType.split(';')[0]?.trim().toLowerCase() || item.mime;
    let append = false;
    if (resumeFrom > 0) {
      if (response.status === 206) {
        append = true;
        const total = parseContentRangeTotal(response.headers.get('content-range'));
        if (total > 0) item.totalBytes = total;
      } else {
        // 服务端不支持 Range：截断重下
        item.receivedBytes = 0;
        item.totalBytes = 0;
      }
    }
    const declared = Number(response.headers.get('content-length') ?? '') || 0;
    if (declared > 0) {
      item.totalBytes = append ? Math.max(item.totalBytes, item.receivedBytes + declared) : declared;
    }
    if (item.totalBytes < item.receivedBytes) item.totalBytes = item.receivedBytes;

    const stream = fs.createWriteStream(item.filePath, { flags: append ? 'a' : 'w' });
    try {
      await this.readResponseBody(response, stream, item, runtime);
    } finally {
      await endStream(stream);
    }

    if (runtime.paused) {
      item.status = 'paused';
      item.speed = 0;
      return;
    }
    if (runtime.canceled) {
      item.status = 'canceled';
      item.speed = 0;
      return;
    }
    if (item.totalBytes > 0 && item.receivedBytes < item.totalBytes) {
      // 连接提前结束：保留进度，允许「继续」用 Range 续传
      item.status = 'paused';
      item.error = '连接提前结束，可继续下载';
      item.speed = 0;
      return;
    }
    item.totalBytes = item.receivedBytes;
    item.status = 'completed';
    item.completedAt = this.now().toISOString();
    item.speed = 0;
  }

  /**
   * 读取响应体并写盘。优先使用 WHATWG ReadableStream reader（Node fetch 与 Electron
   * net.fetch 都适用），兜底兼容 AsyncIterable 实现；暂停/取消时由 abort 打断。
   */
  private async readResponseBody(
    response: { body: unknown },
    stream: fs.WriteStream,
    item: DownloadItem,
    runtime: DownloadRuntime
  ): Promise<void> {
    const body = response.body as unknown;
    if (!body) return;
    const shouldStop = () => runtime.paused || runtime.canceled;
    const consume = async (chunk: unknown) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      if (!buffer.length) return;
      await writeChunk(stream, buffer);
      item.receivedBytes += buffer.length;
      this.sampleSpeed(item, runtime);
      this.maybeBroadcast(item, runtime, item.receivedBytes === buffer.length);
    };
    const webBody = body as {
      getReader?: () => {
        read: () => Promise<{ done: boolean; value?: Uint8Array }>;
        releaseLock?: () => void;
      };
    };
    if (typeof webBody.getReader === 'function') {
      const reader = webBody.getReader();
      try {
        for (;;) {
          if (shouldStop()) break;
          const { done, value } = await reader.read();
          if (done) break;
          if (value) await consume(value);
        }
      } finally {
        try {
          reader.releaseLock?.();
        } catch {
          /* ignore */
        }
      }
      return;
    }
    const asyncBody = body as AsyncIterable<Uint8Array>;
    if (typeof asyncBody[Symbol.asyncIterator] === 'function') {
      for await (const chunk of asyncBody) {
        if (shouldStop()) break;
        await consume(chunk);
      }
    }
  }

  private applyFailure(item: DownloadItem, runtime: DownloadRuntime, err: unknown): void {
    if (runtime.paused) {
      item.status = 'paused';
      item.speed = 0;
      return;
    }
    if (runtime.canceled || isAbortError(err)) {
      item.status = 'canceled';
      item.error = undefined;
      item.speed = 0;
      return;
    }
    item.status = 'error';
    item.error = err instanceof Error ? err.message : String(err);
    item.speed = 0;
    this.deps.logger.warn(`[download] 下载失败 ${item.url}`, err);
  }

  private sampleSpeed(item: DownloadItem, runtime: DownloadRuntime): void {
    const now = Date.now();
    if (!runtime.lastSampleAt || now - runtime.lastSampleAt < 250) return;
    const deltaBytes = item.receivedBytes - runtime.lastSampleBytes;
    const deltaMs = now - runtime.lastSampleAt;
    const instant = deltaMs > 0 ? (deltaBytes * 1000) / deltaMs : 0;
    runtime.speed = runtime.speed > 0 ? Math.round(runtime.speed * 0.6 + instant * 0.4) : instant;
    item.speed = Math.max(0, Math.round(runtime.speed));
    runtime.lastSampleAt = now;
    runtime.lastSampleBytes = item.receivedBytes;
  }

  /* ---------------------------------------------------------------- 操作 */

  pause(id: string): DownloadItem {
    const item = this.requireItem(id);
    const runtime = this.runtimeOf(id);
    if (item.status === 'queued') {
      item.status = 'paused';
      item.speed = 0;
      this.broadcast(item.id);
      return clone(item);
    }
    if (item.status !== 'downloading') return clone(item);
    runtime.paused = true;
    item.status = 'paused';
    item.speed = 0;
    runtime.controller?.abort();
    this.broadcast(item.id);
    return clone(item);
  }

  async resume(id: string): Promise<DownloadItem> {
    const item = this.requireItem(id);
    const runtime = this.runtimeOf(id);
    if (item.status !== 'paused' && item.status !== 'error' && item.status !== 'canceled') return clone(item);
    // 等待旧下载任务（正在 abort）完全收尾，避免两个写入流同时写一个文件
    if (runtime.finished) await runtime.finished;
    if (item.status !== 'paused' && item.status !== 'error' && item.status !== 'canceled') return clone(item);
    if (item.status !== 'paused') {
      // error/canceled 从头重下
      item.receivedBytes = 0;
      item.totalBytes = 0;
      item.completedAt = undefined;
    }
    runtime.paused = false;
    runtime.canceled = false;
    item.error = undefined;
    item.status = 'queued';
    item.speed = 0;
    this.broadcast(item.id);
    this.pump();
    return clone(item);
  }

  async retry(id: string): Promise<DownloadItem> {
    const item = this.requireItem(id);
    if (item.status === 'completed') return clone(item);
    return this.resume(id);
  }

  cancel(id: string): DownloadItem {
    const item = this.requireItem(id);
    const runtime = this.runtimeOf(id);
    if (item.status === 'completed' || item.status === 'canceled') return clone(item);
    runtime.canceled = true;
    runtime.paused = false;
    runtime.controller?.abort();
    item.status = 'canceled';
    item.error = undefined;
    item.speed = 0;
    this.broadcast(item.id);
    if (!runtime.finished) {
      // 没有正在执行的任务（queued/paused 尚未开始）：直接清理半成品
      void this.removePartial(item).then(() => {
        this.persistHistory();
        this.broadcast(item.id);
      });
    }
    return clone(item);
  }

  async remove(id: string, options: { deleteFile?: boolean } = {}): Promise<DownloadItem[]> {
    const item = this.requireItem(id);
    const runtime = this.runtimeOf(id);
    runtime.canceled = true;
    runtime.controller?.abort();
    if (runtime.finished) await runtime.finished.catch(() => undefined);
    const deleteFile = options?.deleteFile !== false;
    if (deleteFile) {
      try {
        await fsp.rm(item.filePath, { force: true });
      } catch (err) {
        this.deps.logger.warn(`[download] 删除文件失败 ${item.filePath}`, err);
      }
    }
    this.releasePath(item.filePath);
    this.items.delete(id);
    this.runtimes.delete(id);
    this.order = this.order.filter((value) => value !== id);
    this.persistHistory();
    this.broadcast(undefined);
    return this.list();
  }

  clearCompleted(): DownloadItem[] {
    for (const id of [...this.order]) {
      const item = this.items.get(id);
      if (!item) continue;
      if (item.status !== 'completed' && item.status !== 'error' && item.status !== 'canceled') continue;
      this.releasePath(item.filePath);
      this.items.delete(id);
      this.runtimes.delete(id);
    }
    this.order = this.order.filter((id) => this.items.has(id));
    this.persistHistory();
    this.broadcast(undefined);
    return this.list();
  }

  async openFile(id: string): Promise<boolean> {
    const item = this.requireItem(id);
    if (!this.deps.openFile) throw new ToolkitError('NO_OPENER', '当前环境不支持打开文件');
    if (!fs.existsSync(item.filePath)) throw new ToolkitError('FILE_MISSING', `文件不存在：${item.filePath}`);
    await this.deps.openFile(item.filePath);
    return true;
  }

  async openFolder(id: string): Promise<boolean> {
    const item = this.requireItem(id);
    const dir = path.dirname(item.filePath);
    if (!this.deps.openFolder) throw new ToolkitError('NO_OPENER', '当前环境不支持打开文件夹');
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      /* ignore */
    }
    await this.deps.openFolder(dir);
    return true;
  }

  /** 应用退出：中止进行中的任务并记录为「已中断」，不自动续传。 */
  async dispose(): Promise<void> {
    const pending: Array<Promise<void>> = [];
    const interrupted: DownloadItem[] = [];
    for (const id of this.order) {
      const item = this.items.get(id);
      const runtime = this.runtimes.get(id);
      if (!item || !runtime) continue;
      if (item.status !== 'downloading' && item.status !== 'queued' && item.status !== 'paused') continue;
      interrupted.push(item);
      runtime.canceled = true;
      runtime.controller?.abort();
      item.speed = 0;
      if (runtime.finished) pending.push(runtime.finished.catch(() => undefined));
    }
    await Promise.allSettled(pending);
    // abort 收尾时可能被标记为 canceled，这里统一回写为「中断错误」，以便历史中可见
    for (const item of interrupted) {
      if (item.status === 'completed') continue;
      item.status = 'error';
      item.error = '应用退出，下载已中断';
      item.speed = 0;
    }
    this.persistHistory();
  }

  /* ---------------------------------------------------------------- 内部工具 */

  private resolveSaveDir(override?: string): string {
    const explicit = typeof override === 'string' ? override.trim() : '';
    const fromSettings = String(this.deps.getSaveDir?.() ?? '').trim();
    const dir = explicit || fromSettings || this.defaultSaveDir;
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      this.deps.logger.warn(`[download] 无法创建保存目录 ${dir}`, err);
      throw new ToolkitError('BAD_DIR', `无法创建下载目录：${dir}`);
    }
    return dir;
  }

  private reservePath(dir: string, desiredName: string): string {
    const safe = sanitizeFileName(desiredName);
    const ext = path.extname(safe);
    const stem = ext ? safe.slice(0, -ext.length) : safe;
    let candidate = path.join(dir, safe);
    let counter = 0;
    while (fs.existsSync(candidate) || this.reserved.has(candidate.toLowerCase())) {
      counter += 1;
      candidate = path.join(dir, `${stem} (${counter})${ext}`);
    }
    this.reserved.add(candidate.toLowerCase());
    return candidate;
  }

  private releasePath(filePath: string): void {
    this.reserved.delete(String(filePath ?? '').toLowerCase());
  }

  private async removePartial(item: DownloadItem): Promise<void> {
    try {
      await fsp.rm(item.filePath, { force: true });
    } catch {
      /* ignore */
    }
    item.receivedBytes = 0;
    item.totalBytes = 0;
    item.speed = 0;
  }

  private requireItem(id: string): DownloadItem {
    const item = this.items.get(String(id ?? ''));
    if (!item) throw new ToolkitError('DOWNLOAD_NOT_FOUND', `下载任务不存在：${id}`);
    return item;
  }

  private runtimeOf(id: string): DownloadRuntime {
    let runtime = this.runtimes.get(id);
    if (!runtime) {
      runtime = this.createRuntime();
      this.runtimes.set(id, runtime);
    }
    return runtime;
  }

  private createRuntime(): DownloadRuntime {
    return {
      controller: null,
      paused: false,
      canceled: false,
      finished: null,
      lastBroadcastAt: 0,
      lastSampleAt: 0,
      lastSampleBytes: 0,
      speed: 0,
    };
  }

  private maybeBroadcast(item: DownloadItem, runtime: DownloadRuntime, force = false): void {
    const now = Date.now();
    if (!force && now - runtime.lastBroadcastAt < PROGRESS_INTERVAL) return;
    runtime.lastBroadcastAt = now;
    this.broadcast(item.id);
  }

  private broadcast(changedId?: string): void {
    if (!this.deps.broadcast) return;
    const payload: DownloadProgressPayload = { items: this.list(), changedId };
    try {
      this.deps.broadcast('search:downloads', payload);
    } catch (err) {
      this.deps.logger.warn('[download] 广播失败', err);
    }
  }

  /* ---------------------------------------------------------------- 历史持久化 */

  private loadHistory(): void {
    let raw: unknown = null;
    try {
      const text = fs.readFileSync(this.historyFile, 'utf8');
      if (text.trim()) raw = JSON.parse(text) as unknown;
    } catch {
      raw = null;
    }
    if (!Array.isArray(raw)) return;
    const loaded: DownloadItem[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as Partial<DownloadItem>;
      if (typeof record.id !== 'string' || typeof record.url !== 'string') continue;
      if (typeof record.filePath !== 'string' || typeof record.name !== 'string') continue;
      if (record.status !== 'completed' && record.status !== 'error') continue;
      loaded.push({
        id: record.id,
        url: record.url,
        name: record.name,
        filePath: record.filePath,
        status: record.status,
        receivedBytes: Number(record.receivedBytes) || 0,
        totalBytes: Number(record.totalBytes) || 0,
        speed: 0,
        error: typeof record.error === 'string' ? record.error : undefined,
        createdAt: typeof record.createdAt === 'string' ? record.createdAt : this.now().toISOString(),
        completedAt: typeof record.completedAt === 'string' ? record.completedAt : undefined,
        mime: typeof record.mime === 'string' ? record.mime : undefined,
        source: typeof record.source === 'string' ? record.source : undefined,
      });
    }
    const trimmed = loaded.slice(-this.maxHistory);
    for (const item of trimmed) {
      this.items.set(item.id, item);
      this.runtimes.set(item.id, this.createRuntime());
      this.order.push(item.id);
    }
  }

  /** 只持久化已结束（completed / error）的历史，进行中任务不跨重启恢复。 */
  private persistHistory(): void {
    try {
      const historyItems = this.order
        .map((id) => this.items.get(id))
        .filter((item): item is DownloadItem => !!item && (item.status === 'completed' || item.status === 'error'))
        .slice(-this.maxHistory)
        .map((item) => ({ ...item, speed: 0 }));
      fs.mkdirSync(path.dirname(this.historyFile), { recursive: true });
      const temp = `${this.historyFile}.${process.pid}.${Date.now().toString(36)}.tmp`;
      fs.writeFileSync(temp, `${JSON.stringify(historyItems, null, 2)}\n`, 'utf8');
      fs.renameSync(temp, this.historyFile);
    } catch (err) {
      this.deps.logger.warn('[download] 写入历史失败', err);
    }
  }
}
