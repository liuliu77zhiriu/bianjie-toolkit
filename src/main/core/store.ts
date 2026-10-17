import fs from 'node:fs';
import path from 'node:path';

export interface StoreOptions {
  debounceMs?: number;
  logger?: { warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

/** 原子化 JSON 存储：写入临时文件再 rename，损坏时回退 .bak。 */
export class JsonStore<T extends object> {
  private data!: T;
  private timer: NodeJS.Timeout | null = null;
  private readonly file: string;
  private readonly backupFile: string;
  private loaded = false;

  constructor(file: string, private defaults: T, private options: StoreOptions = {}) {
    this.file = file;
    this.backupFile = `${file}.bak`;
    this.load();
  }

  private clone<V>(value: V): V {
    try {
      return structuredClone(value);
    } catch {
      return JSON.parse(JSON.stringify(value)) as V;
    }
  }

  private load() {
    const tryRead = (target: string): T | null => {
      try {
        if (!fs.existsSync(target)) return null;
        const raw = fs.readFileSync(target, 'utf8');
        if (!raw.trim()) return null;
        return JSON.parse(raw) as T;
      } catch (err) {
        this.options.logger?.warn(`[store] 读取失败 ${target}`, err);
        return null;
      }
    };

    let loaded = tryRead(this.file);
    if (!loaded) loaded = tryRead(this.backupFile);
    this.data = this.mergeDefaults(loaded);
    this.loaded = true;
  }

  private mergeDefaults(value: T | null): T {
    if (!value) return this.clone(this.defaults);
    if (Array.isArray(this.defaults) || typeof this.defaults !== 'object') {
      return value ?? this.clone(this.defaults);
    }
    return deepMerge(this.clone(this.defaults) as Record<string, unknown>, value as Record<string, unknown>) as T;
  }

  get(): T {
    return this.clone(this.data);
  }

  replace(next: T): T {
    this.data = deepMerge(this.clone(this.defaults) as Record<string, unknown>, next as Record<string, unknown>) as T;
    this.scheduleSave();
    return this.get();
  }

  set<K extends keyof T>(key: K, value: T[K]): void {
    this.data[key] = value;
    this.scheduleSave();
  }

  update(mutator: (draft: T) => void): T {
    mutator(this.data);
    this.scheduleSave();
    return this.get();
  }

  private scheduleSave() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.options.debounceMs ?? 120);
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.loaded) return;
    const dir = path.dirname(this.file);
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${this.file}.tmp-${process.pid}`;
      const text = JSON.stringify(this.data, null, 2);
      fs.writeFileSync(tmp, text, 'utf8');
      try {
        fs.copyFileSync(this.file, this.backupFile);
      } catch {
        /* 首次写无备份 */
      }
      fs.renameSync(tmp, this.file);
    } catch (err) {
      this.options.logger?.error(`[store] 写入失败 ${this.file}`, err);
    }
  }

  dispose(): void {
    this.flush();
  }
}

export function deepMerge<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value === undefined) continue;
    const prev = out[key];
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      prev &&
      typeof prev === 'object' &&
      !Array.isArray(prev)
    ) {
      out[key] = deepMerge(prev as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}
