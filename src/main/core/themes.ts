/**
 * 主题服务。
 *
 * - 内置主题：来自 shared/defaults 的 THEME_PRESETS（随代码分发，不可删除）
 * - 自定义主题：`<userData>/themes.json`，最多 30 个，id 形如 `custom:<timestamp>`
 * - tokens 与 settings.appearance 的对应字段同名；应用主题由 core-service 接线
 *   （读取 get(id).tokens 后 settings.patch）
 *
 * 本文件不负责 IPC 接线；由 core-service 注册 `themes.*` 方法。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { AnimationLevel, AppPaths, ThemePreset, ThemeTokens } from '../../shared/types';
import { DEFAULT_SETTINGS, THEME_PRESETS } from '../../shared/defaults';
import { ToolkitError } from './errors';
import type { Logger } from './logger';

/** 自定义主题数量上限。 */
const CUSTOM_LIMIT = 30;

const NAME_MAX = 40;

const ANIMATION_VALUES: AnimationLevel[] = ['full', 'lite', 'off'];

const WALLPAPER_SELECTOR_RE = /^(?:builtin:[a-z0-9][a-z0-9_-]{0,63}|user:[^\\/:*?"<>|\u0000-\u001f]{1,120})$/;

const FALLBACK_TOKENS: ThemeTokens = {
  accent: DEFAULT_SETTINGS.appearance.accent.toLowerCase(),
  panelOpacity: DEFAULT_SETTINGS.appearance.panelOpacity,
  blur: DEFAULT_SETTINGS.appearance.blur,
  animation: DEFAULT_SETTINGS.appearance.animation,
  wallpaper: DEFAULT_SETTINGS.appearance.wallpaper,
  wallpaperOpacity: DEFAULT_SETTINGS.appearance.wallpaperOpacity,
  ballEdgeHide: DEFAULT_SETTINGS.appearance.ballEdgeHide,
  showDock: DEFAULT_SETTINGS.appearance.showDock,
};

interface StoredTheme {
  id: string;
  name: string;
  createdAt: number;
  tokens: ThemeTokens;
}

interface ThemeStoreFile {
  version: number;
  themes: StoredTheme[];
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** 校验并规范化主题 tokens（任何非法字段回退到默认值，不抛错）。 */
export function sanitizeThemeTokens(input: unknown): ThemeTokens {
  const raw = (input && typeof input === 'object' ? input : {}) as Partial<ThemeTokens>;
  const accent =
    typeof raw.accent === 'string' && /^#[0-9a-f]{6}$/i.test(raw.accent.trim())
      ? raw.accent.trim().toLowerCase()
      : FALLBACK_TOKENS.accent;
  const wallpaper =
    typeof raw.wallpaper === 'string' && (raw.wallpaper.trim() === '' || WALLPAPER_SELECTOR_RE.test(raw.wallpaper.trim()))
      ? raw.wallpaper.trim()
      : FALLBACK_TOKENS.wallpaper;
  const animation = ANIMATION_VALUES.includes(raw.animation as AnimationLevel)
    ? (raw.animation as AnimationLevel)
    : FALLBACK_TOKENS.animation;
  return {
    accent,
    panelOpacity: clamp(Number(raw.panelOpacity), 0.55, 1, FALLBACK_TOKENS.panelOpacity),
    blur: asBool(raw.blur, FALLBACK_TOKENS.blur),
    animation,
    wallpaper,
    wallpaperOpacity: clamp(Number(raw.wallpaperOpacity), 0.05, 0.8, FALLBACK_TOKENS.wallpaperOpacity),
    ballEdgeHide: asBool(raw.ballEdgeHide, FALLBACK_TOKENS.ballEdgeHide),
    showDock: asBool(raw.showDock, FALLBACK_TOKENS.showDock),
  };
}

function clonePreset(preset: ThemePreset): ThemePreset {
  return { ...preset, tokens: { ...preset.tokens } };
}

export class ThemeService {
  private readonly file: string;
  private customs: StoredTheme[] = [];

  constructor(
    private paths: AppPaths,
    private logger: Logger
  ) {
    this.file = path.join(paths.userData, 'themes.json');
    this.load();
  }

  /* ---------------------------------------------------------------- 查询 */

  list(): ThemePreset[] {
    const builtins = THEME_PRESETS.map(clonePreset);
    const customs = this.customs.map((theme) => this.toPreset(theme));
    return [...builtins, ...customs];
  }

  get(id: string): ThemePreset | undefined {
    const key = String(id ?? '').trim();
    if (!key) return undefined;
    return this.list().find((theme) => theme.id === key);
  }

  /* ---------------------------------------------------------------- 写入 */

  /** 保存自定义主题（同名不覆盖，返回最新列表，最新的在最前）。 */
  save(name: string, tokens: ThemeTokens): ThemePreset[] {
    const cleanName = this.normalizeName(name);
    const stored: StoredTheme = {
      id: this.nextId(),
      name: cleanName,
      createdAt: Date.now(),
      tokens: sanitizeThemeTokens(tokens),
    };
    this.customs = [stored, ...this.customs].slice(0, CUSTOM_LIMIT);
    this.persist();
    this.logger.info('[themes] 已保存主题', stored.id, stored.name);
    return this.list();
  }

  /** 删除自定义主题；内置主题不允许删除。 */
  delete(id: string): ThemePreset[] {
    const key = String(id ?? '').trim();
    if (!key.startsWith('custom:')) {
      throw new ToolkitError('BAD_ARGS', '仅支持删除自定义主题');
    }
    const before = this.customs.length;
    this.customs = this.customs.filter((theme) => theme.id !== key);
    if (this.customs.length === before) {
      throw new ToolkitError('THEME_NOT_FOUND', '主题不存在或已被删除');
    }
    this.persist();
    this.logger.info('[themes] 已删除主题', key);
    return this.list();
  }

  /* ---------------------------------------------------------------- 持久化 */

  private load(): void {
    try {
      if (!fs.existsSync(this.file)) return;
      const raw = fs.readFileSync(this.file, 'utf8');
      if (!raw.trim()) return;
      const parsed = JSON.parse(raw) as Partial<ThemeStoreFile> | null;
      const list = Array.isArray(parsed?.themes) ? parsed!.themes : [];
      const seen = new Set<string>();
      const customs: StoredTheme[] = [];
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const record = item as Partial<StoredTheme>;
        const id = typeof record.id === 'string' ? record.id.trim() : '';
        if (!id.startsWith('custom:') || seen.has(id)) continue;
        const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim().slice(0, NAME_MAX) : '我的主题';
        seen.add(id);
        customs.push({
          id,
          name,
          createdAt: typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : 0,
          tokens: sanitizeThemeTokens(record.tokens),
        });
        if (customs.length >= CUSTOM_LIMIT) break;
      }
      this.customs = customs;
    } catch (err) {
      this.logger.warn('[themes] 读取自定义主题失败，已忽略', err);
      this.customs = [];
    }
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const payload: ThemeStoreFile = { version: 1, themes: this.customs };
      const tmp = `${this.file}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (err) {
      this.logger.error('[themes] 写入自定义主题失败', err);
      throw new ToolkitError('STORE_FAILED', '主题保存失败，请检查用户数据目录权限');
    }
  }

  /* ---------------------------------------------------------------- 工具 */

  private normalizeName(name: string): string {
    const trimmed = String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, NAME_MAX);
    return trimmed || `我的主题 ${this.customs.length + 1}`;
  }

  private nextId(): string {
    let id = `custom:${Date.now()}`;
    let suffix = 1;
    while (this.customs.some((theme) => theme.id === id)) {
      id = `custom:${Date.now()}-${suffix}`;
      suffix += 1;
    }
    return id;
  }

  private toPreset(theme: StoredTheme): ThemePreset {
    return {
      id: theme.id,
      name: theme.name,
      description: theme.createdAt ? `保存于 ${this.formatDate(theme.createdAt)}` : '自定义主题',
      builtin: false,
      tokens: { ...theme.tokens },
    };
  }

  private formatDate(timestamp: number): string {
    try {
      const date = new Date(timestamp);
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      const hh = String(date.getHours()).padStart(2, '0');
      const mi = String(date.getMinutes()).padStart(2, '0');
      return `${mm}/${dd} ${hh}:${mi}`;
    } catch {
      return '自定义主题';
    }
  }
}
