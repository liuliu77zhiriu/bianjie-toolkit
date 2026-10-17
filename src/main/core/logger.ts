import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export class Logger {
  private file: string;
  private stream: fs.WriteStream | null = null;
  private minLevel: LogLevel = 'debug';
  private writeTimer: NodeJS.Timeout | null = null;
  private queue: string[] = [];

  constructor(private dir: string, private scope = 'main') {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      /* ignore */
    }
    const day = new Date().toISOString().slice(0, 10);
    this.file = path.join(dir, `main-${day}.log`);
    this.open();
  }

  private open() {
    try {
      this.stream = fs.createWriteStream(this.file, { flags: 'a' });
      this.stream.on('error', () => {
        this.stream = null;
      });
    } catch {
      this.stream = null;
    }
  }

  setMinLevel(level: LogLevel) {
    this.minLevel = level;
  }

  private write(level: LogLevel, args: unknown[]) {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
    const time = new Date().toISOString();
    const text = args
      .map((a) => {
        if (typeof a === 'string') return a;
        if (a instanceof Error) return a.stack || a.message;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(' ');
    const line = `${time} [${level.toUpperCase()}] [${this.scope}] ${text}\n`;
    this.queue.push(line);
    if (level === 'error' || level === 'warn') {
      // 错误日志立即落盘，避免崩溃丢失
      this.flush();
    } else {
      this.scheduleFlush();
    }
    if (!app_isPackaged) {
      const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      fn(`[${level}] ${text}`);
    }
  }

  private scheduleFlush() {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.flush();
    }, 220);
  }

  private flush() {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    if (!this.queue.length) return;
    const text = this.queue.join('');
    this.queue = [];
    try {
      if (!this.stream) this.open();
      this.stream?.write(text);
    } catch {
      /* ignore */
    }
  }

  debug(...args: unknown[]) {
    this.write('debug', args);
  }
  info(...args: unknown[]) {
    this.write('info', args);
  }
  warn(...args: unknown[]) {
    this.write('warn', args);
  }
  error(...args: unknown[]) {
    this.write('error', args);
  }

  child(scope: string): Logger {
    const child = Object.create(this) as Logger;
    (child as unknown as { scope: string }).scope = `${this.scope}:${scope}`;
    return child;
  }

  dispose() {
    this.flush();
    try {
      this.stream?.end();
    } catch {
      /* ignore */
    }
    this.stream = null;
  }
}

// 避免循环 import electron/app：用全局标记，由入口设置
let app_isPackaged = false;
export function setPackagedFlag(value: boolean) {
  app_isPackaged = value;
}
