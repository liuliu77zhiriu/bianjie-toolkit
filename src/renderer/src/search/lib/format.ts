/** 流光搜索 · 展示格式化工具 */
import type { DownloadItem, DownloadStatus, SearchEngine } from '@shared/search';

const ENGINE_LABEL: Record<SearchEngine, string> = {
  bing: 'Bing',
  duckduckgo: 'DuckDuckGo',
};

export function engineLabel(engine?: SearchEngine): string {
  return engine ? ENGINE_LABEL[engine] ?? engine : '';
}

export function formatBytes(bytes: number | undefined | null): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const text = value >= 100 || index === 0 ? Math.round(value) : value.toFixed(1);
  return `${text} ${units[index]}`;
}

export function formatSpeed(bytesPerSecond: number | undefined | null): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return '';
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** URL -> host（去 www.） */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

/** 展示用短链接：host + 截断路径 */
export function prettyUrl(url: string, max = 72): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, '');
    const path = `${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}`;
    const full = `${host}${path}`;
    return full.length > max ? `${full.slice(0, max - 1)}…` : full;
  } catch {
    return url.length > max ? `${url.slice(0, max - 1)}…` : url;
  }
}

/** 最近时间：刚刚 / N 分钟前 / N 小时前 / 昨天 HH:mm / M月D日 */
export function formatRelative(iso: string | undefined | null): string {
  if (!iso) return '';
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return '';
  const diff = Date.now() - time;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;

  const date = new Date(time);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (time >= startOfToday - 86_400_000) return `昨天 ${clock}`;
  const sameYear = date.getFullYear() === today.getFullYear();
  const day = `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
  return sameYear ? `${day} ${clock}` : `${date.getFullYear()} 年 ${day}`;
}

export function formatClock(iso: string | undefined | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** 0..1 进度（总量未知时 0） */
export function progressOf(item: DownloadItem): number {
  if (!item.totalBytes || item.totalBytes <= 0) return 0;
  return Math.max(0, Math.min(1, item.receivedBytes / item.totalBytes));
}

export const DOWNLOAD_STATUS_LABEL: Record<DownloadStatus, string> = {
  queued: '排队中',
  downloading: '下载中',
  paused: '已暂停',
  completed: '已完成',
  error: '下载失败',
  canceled: '已取消',
};

export function fileExtOf(name: string): string {
  const match = /\.([a-z0-9]{1,6})$/i.exec(name ?? '');
  return match ? match[1].toUpperCase() : 'FILE';
}

/** 名称首字母占位（favicon 加载失败时使用） */
export function initialOf(text: string): string {
  const clean = (text ?? '').trim();
  if (!clean) return '?';
  const char = Array.from(clean)[0] ?? '?';
  return char.toUpperCase();
}

/** 根据字符串生成稳定的柔和色相（用于字母占位底色） */
export function hueOf(text: string): number {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash % 360;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function errorText(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err.trim()) return err.trim();
  return '操作失败，请稍后重试';
}
