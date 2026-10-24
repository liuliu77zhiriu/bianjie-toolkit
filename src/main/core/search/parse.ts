/**
 * 流光搜索 · 纯函数解析层
 *
 * 只做字符串/JSON → 结构化数据的转换，禁止任何 Electron / fs / 网络依赖，
 * 便于在 node:test 中直接单测（search-service / download-service 复用这里的工具）。
 */
import type { SearchSuggestion } from '../../../shared/search';

/** 默认端点（可用 deps.endpoints / per-call endpoint 覆盖，便于本地 HTTP 测试）。 */
export const BING_ENDPOINT = 'https://www.bing.com/search';
export const DUCKDUCKGO_ENDPOINT = 'https://html.duckduckgo.com/html/';
export const SUGGEST_ENDPOINT = 'https://duckduckgo.com/ac/';

/** 解析后的单条搜索结果（尚未附加 engine / id / displayUrl）。 */
export interface ParsedSearchItem {
  title: string;
  url: string;
  snippet: string;
}

/** 常见可直接下载的文件扩展名。 */
const DOWNLOAD_EXTENSIONS = new Set([
  '.zip',
  '.rar',
  '.7z',
  '.tar',
  '.gz',
  '.tgz',
  '.bz2',
  '.xz',
  '.zst',
  '.exe',
  '.msi',
  '.msix',
  '.dmg',
  '.pkg',
  '.deb',
  '.rpm',
  '.apk',
  '.iso',
  '.img',
  '.pdf',
  '.epub',
  '.mobi',
  '.azw3',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.odt',
  '.ods',
  '.csv',
  '.mp4',
  '.mkv',
  '.avi',
  '.mov',
  '.webm',
  '.flv',
  '.wmv',
  '.mp3',
  '.flac',
  '.wav',
  '.ogg',
  '.m4a',
  '.aac',
  '.opus',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.tif',
  '.tiff',
  '.psd',
  '.ai',
  '.sketch',
  '.fig',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.eot',
  '.bin',
  '.jar',
  '.whl',
  '.ipa',
  '.torrent',
  '.sqlite',
  '.db',
]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  middot: '·',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
  laquo: '«',
  raquo: '»',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  deg: '°',
  times: '×',
  divide: '÷',
  plusmn: '±',
  frac12: '½',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  sect: '§',
  para: '¶',
  dagger: '†',
  permil: '‰',
  prime: '′',
  Prime: '″',
  larr: '←',
  rarr: '→',
  uarr: '↑',
  darr: '↓',
  harr: '↔',
  check: '✓',
  cross: '✗',
};

function codePointToText(value: number): string {
  if (!Number.isFinite(value) || value <= 0 || value > 0x10ffff) return '';
  try {
    return String.fromCodePoint(value);
  } catch {
    return '';
  }
}

/** 解码 HTML/XML 实体（&amp; &#39; &#x27; 等），未知实体保持原样。 */
export function decodeHtmlEntities(text: string | null | undefined): string {
  return String(text ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => codePointToText(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec: string) => codePointToText(parseInt(dec, 10)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (match, name: string) => {
      const value = NAMED_ENTITIES[name] ?? NAMED_ENTITIES[name.toLowerCase()];
      return value ?? match;
    });
}

/** 转义文本供 HTML/XML 内联输出用。 */
export function escapeHtml(text: string | null | undefined): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 去掉标签并压缩空白（用于 RSS description / DDG 标题）。 */
export function stripHtml(html: string | null | undefined): string {
  return decodeHtmlEntities(
    String(html ?? '')
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** 查询参数编码（encodeURIComponent + 保留可读空格为 +）。 */
export function encodeQuery(query: string): string {
  return encodeURIComponent(String(query ?? '').trim()).replace(/%20/g, '+');
}

function appendQuery(base: string, params: Record<string, string | number>): string {
  const entries = Object.entries(params)
    .filter(([, value]) => value !== '' && value !== undefined && value !== null)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  const joiner = base.includes('?') ? '&' : '?';
  return entries.length ? `${base}${joiner}${entries.join('&')}` : base;
}

/** Bing RSS 搜索地址（endpoint 覆盖时自动拼 query/format/count/first）。 */
export function buildBingUrl(
  query: string,
  options: { count?: number; first?: number; endpoint?: string } = {}
): string {
  const base = (options.endpoint?.trim() || BING_ENDPOINT).trim();
  return appendQuery(base, {
    q: String(query ?? '').trim(),
    format: 'rss',
    count: Math.max(1, Math.floor(options.count ?? 10)),
    first: Math.max(1, Math.floor(options.first ?? 1)),
  });
}

/** DuckDuckGo HTML 搜索地址（endpoint 覆盖时自动拼 q）。 */
export function buildDuckDuckGoUrl(query: string, options: { endpoint?: string } = {}): string {
  const base = (options.endpoint?.trim() || DUCKDUCKGO_ENDPOINT).trim();
  return appendQuery(base, { q: String(query ?? '').trim(), kl: 'wt-wt' });
}

/** DuckDuckGo autocomplete 地址。 */
export function buildSuggestUrl(query: string, endpoint?: string): string {
  const base = (endpoint?.trim() || SUGGEST_ENDPOINT).trim();
  return appendQuery(base, { q: String(query ?? '').trim(), type: 'list' });
}

/* ------------------------------------------------------------------ Bing RSS */

function readXmlTag(block: string, tag: string): string | null {
  const cdata = new RegExp(`<${tag}\\b[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i');
  const plain = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = cdata.exec(block) ?? plain.exec(block);
  return match ? match[1] : null;
}

function readXmlText(block: string, tag: string): string {
  const raw = readXmlTag(block, tag);
  return raw === null ? '' : stripHtml(raw);
}

/** 解析 Bing 搜索 RSS（也兼容一般 RSS 2.0 结果流）。 */
export function parseBingRss(xml: string): ParsedSearchItem[] {
  const source = String(xml ?? '');
  if (!source.trim()) return [];
  const items: ParsedSearchItem[] = [];
  const blocks = source.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi);
  for (const block of blocks) {
    const inner = block[1] ?? '';
    const url = normalizeResultUrl(readXmlText(inner, 'link') || readXmlText(inner, 'guid'));
    if (!url) continue;
    const title = readXmlText(inner, 'title');
    const snippet = readXmlText(inner, 'description');
    if (!title && !snippet) continue;
    items.push({ title: title || displayUrlOf(url), url, snippet });
  }
  return items;
}

/* ------------------------------------------------------------------ DuckDuckGo HTML */

function getAttribute(attrs: string, name: string): string | null {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = attrs.match(pattern);
  if (!match) return null;
  return decodeHtmlEntities(match[1] ?? match[2] ?? match[3] ?? '');
}

function countMatches(attrs: string, token: string | RegExp): boolean {
  const raw = getAttribute(attrs, 'class') ?? '';
  if (token instanceof RegExp) return token.test(raw);
  return raw.split(/\s+/).includes(token);
}

interface AnchorMatch {
  attrs: string;
  inner: string;
  start: number;
  end: number;
}

function collectAnchors(html: string): AnchorMatch[] {
  const anchors: AnchorMatch[] = [];
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    anchors.push({
      attrs: match[1] ?? '',
      inner: match[2] ?? '',
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return anchors;
}

function normalizeResultUrl(raw: string | null | undefined): string {
  let value = decodeHtmlEntities(String(raw ?? '').trim());
  if (!value) return '';
  if (value.startsWith('//')) value = `https:${value}`;
  if (/^https?:\/\//i.test(value)) return value;
  return '';
}

function isResultLinkAttrs(attrs: string): boolean {
  return countMatches(attrs, 'result__a') || countMatches(attrs, 'result-link');
}

/**
 * 解析 DuckDuckGo HTML 结果页（html.duckduckgo.com）。
 * 兼容 `result__a` / `result-link` 两种版本，并把 /l/?uddg= 跳转链接还原成目标地址。
 */
export function parseDuckDuckGoHtml(html: string): ParsedSearchItem[] {
  const source = String(html ?? '');
  if (!source.trim()) return [];
  const anchors = collectAnchors(source);
  const results: ParsedSearchItem[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    const isResultLink = isResultLinkAttrs(anchor.attrs);
    if (!isResultLink) continue;
    if (countMatches(anchor.attrs, 'result--ad') || countMatches(anchor.attrs, /(^|\s)result--ad/)) continue;
    const href = getAttribute(anchor.attrs, 'href');
    const url = unwrapSearchRedirect(href);
    if (!url || seen.has(url)) continue;
    if (/duckduckgo\.com\/y\.js/i.test(url)) continue;
    // 摘要位于当前结果块内、下一个结果链接之前（可能还隔着其它 <a>/<div>）
    let nextStart = source.length;
    for (let next = index + 1; next < anchors.length; next += 1) {
      if (isResultLinkAttrs(anchors[next].attrs)) {
        nextStart = anchors[next].start;
        break;
      }
    }
    const region = source.slice(anchor.end, Math.min(nextStart, anchor.end + 8000));
    const title = stripHtml(anchor.inner);
    if (!title) continue;
    let snippet = '';
    const snippetMatch =
      /class=(?:"[^"]*(?:result__snippet|result-snippet)[^"]*"|'[^']*(?:result__snippet|result-snippet)[^']*')[^>]*>([\s\S]*?)<\/(?:a|div|span|td)>/i.exec(
        region
      );
    if (snippetMatch) snippet = stripHtml(snippetMatch[1]);
    seen.add(url);
    results.push({ title, url, snippet });
  }
  return results;
}

/** 把 DDG /l/?uddg=... 跳转链接还原为目标链接；其它链接原样（补全协议）返回。 */
export function unwrapSearchRedirect(raw: string | null | undefined): string {
  const value = decodeHtmlEntities(String(raw ?? '').trim());
  if (!value) return '';
  if (value.startsWith('//')) {
    const normalized = `https:${value}`;
    return unwrapSearchRedirect(normalized);
  }
  if (!/^https?:\/\//i.test(value)) return '';
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    const isDuckDuckGo = host === 'duckduckgo.com' || host.endsWith('.duckduckgo.com');
    if (isDuckDuckGo && /^\/l\/?$/i.test(parsed.pathname)) {
      const target = parsed.searchParams.get('uddg');
      if (target) {
        const decoded = target.trim();
        if (/^https?:\/\//i.test(decoded)) return decoded;
      }
    }
    return value;
  } catch {
    return value;
  }
}

/* ------------------------------------------------------------------ 联想词 */

/** 解析 DuckDuckGo autocomplete JSON（兼容 [{phrase}] / [string] / {suggestions:[]}）。 */
export function parseSuggestions(json: unknown, limit = 8): SearchSuggestion[] {
  const root = json as Record<string, unknown> | unknown[] | null | undefined;
  let list: unknown[] = [];
  if (Array.isArray(root)) list = root;
  else if (root && typeof root === 'object') {
    const candidate = (root as Record<string, unknown>).suggestions ?? (root as Record<string, unknown>).data;
    if (Array.isArray(candidate)) list = candidate;
  }
  const suggestions: SearchSuggestion[] = [];
  const seen = new Set<string>();
  const max = Math.max(1, Math.min(20, Math.floor(limit)));
  for (const item of list) {
    let text = '';
    if (typeof item === 'string') text = item;
    else if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      const phrase = record.phrase ?? record.text ?? record.value;
      if (typeof phrase === 'string') text = phrase;
    }
    const normalized = stripHtml(text);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push({ text: normalized });
    if (suggestions.length >= max) break;
  }
  return suggestions;
}

/* ------------------------------------------------------------------ 链接与文件名 */

/** 从 URL 取小写扩展名（含点）；无扩展名返回 ''。 */
export function fileExtensionOf(url: string): string {
  const value = normalizeResultUrl(url) || String(url ?? '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value);
    const base = decodePathTail(parsed.pathname);
    const dot = base.lastIndexOf('.');
    if (dot <= 0 || dot === base.length - 1) return '';
    return base.slice(dot).toLowerCase();
  } catch {
    const cleaned = value.split(/[?#]/)[0];
    const dot = cleaned.lastIndexOf('.');
    if (dot <= cleaned.lastIndexOf('/') || dot === cleaned.length - 1) return '';
    return cleaned.slice(dot).toLowerCase();
  }
}

function decodePathTail(pathname: string): string {
  const tail = pathname.split('/').filter(Boolean).pop() ?? '';
  try {
    return decodeURIComponent(tail);
  } catch {
    return tail;
  }
}

/** 链接是否看起来是可直接下载的文件（按扩展名判断）。 */
export function isDownloadableUrl(url: string): boolean {
  return DOWNLOAD_EXTENSIONS.has(fileExtensionOf(url));
}

const WINDOWS_RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * 清洗文件名：去掉非法字符/控制字符、首尾点与空格、Windows 保留名，
 * 压缩连续空格并限制长度（保留扩展名）。
 */
export function sanitizeFileName(raw: string | null | undefined, fallback = 'download'): string {
  let name = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  name = name.replace(/^[. ]+|[. ]+$/g, '');
  if (!name) name = fallback;
  if (WINDOWS_RESERVED_RE.test(name)) name = `_${name}`;
  if (name.length > 120) {
    const safeFallback = sanitizeFileName(fallback, 'download');
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && dot > name.length - 12 ? name.slice(dot) : '';
    const stem = ext ? name.slice(0, dot) : name;
    name = `${stem.slice(0, Math.max(1, 120 - ext.length))}${ext}`;
    if (!name || name === ext) name = safeFallback;
  }
  return name || 'download';
}

/**
 * 根据 URL / 标题推断建议下载文件名；非可下载链接返回 undefined。
 * 优先 URL 末段文件名，其次标题 + 扩展名。
 */
export function suggestedFileName(url: string, title?: string): string | undefined {
  const ext = fileExtensionOf(url);
  if (!DOWNLOAD_EXTENSIONS.has(ext)) return undefined;
  let base = '';
  try {
    base = decodePathTail(new URL(normalizeResultUrl(url) || url).pathname);
  } catch {
    base = String(url).split(/[?#]/)[0].split('/').pop() ?? '';
  }
  base = stripHtml(base);
  if (!base || !/\.[a-z0-9]{1,10}$/i.test(base)) {
    const stem = stripHtml(title ?? '').replace(/\.[a-z0-9]{1,10}$/i, '');
    base = `${stem || 'download'}${ext}`;
  }
  const safe = sanitizeFileName(base);
  return safe.toLowerCase().endsWith(ext) ? safe : `${safe}${ext}`;
}

/** 解析 Content-Disposition 中的文件名（支持 filename* RFC5987）。 */
export function extractContentDispositionFilename(header: string | null | undefined): string | null {
  const value = String(header ?? '');
  if (!value) return null;
  const extended = /filename\*\s*=\s*(?:UTF-8'')?("?)([^";]+)\1/i.exec(value);
  if (extended?.[2]) {
    try {
      return decodeURIComponent(extended[2].trim());
    } catch {
      return extended[2].trim();
    }
  }
  const plain = /filename\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;]+))/i.exec(value);
  if (!plain) return null;
  const name = (plain[1] ?? plain[2] ?? plain[3] ?? '').trim();
  return name || null;
}

/** 展示用短链接：去协议 / www / 末尾斜杠，最长 64 字符。 */
export function displayUrlOf(url: string): string {
  const value = String(url ?? '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value.startsWith('//') ? `https:${value}` : value);
    const host = parsed.hostname.replace(/^www\./i, '');
    const pathname = parsed.pathname.replace(/\/+$/, '');
    const text = `${host}${pathname}${parsed.search}`;
    return text.length > 64 ? `${text.slice(0, 63)}…` : text;
  } catch {
    return value.length > 64 ? `${value.slice(0, 63)}…` : value;
  }
}

/** 生成稳定且列表内唯一的结果 id。 */
export function resultIdOf(url: string, index: number): string {
  const hash = hashString(`${String(url ?? '')}|${index}`).toString(36);
  return `sr-${hash}-${index.toString(36)}`;
}

function hashString(value: string): number {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

/** 一页结果是否可能还有下一页（RSS 不返回总数，取满一页即认为有）。 */
export function hasMoreResults(receivedCount: number, resultCount: number): boolean {
  return receivedCount >= Math.max(1, resultCount);
}
