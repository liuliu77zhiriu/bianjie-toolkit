import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type {
  AppInfo,
  CommandInfo,
  PluginRuntimeInfo,
  Settings,
  SettingsPatch,
  WallpaperCurrent,
  TkEventMessage,
} from '@shared/types';

export const tk = window.tk;

export function invoke<T = unknown>(service: string, method: string, args?: unknown): Promise<T> {
  return tk.invoke<T>(service, method, args);
}

export function on(topic: string, fn: (payload: unknown) => void): () => void {
  return tk.on(topic, fn);
}

export function onAny(fn: (msg: TkEventMessage) => void): () => void {
  return tk.onAny(fn);
}

/* ------------------------------------------------------------------ Toast */

export interface ToastItem {
  id: number;
  message: string;
  type: 'info' | 'success' | 'error';
}

let toastSeq = 0;
let toastItems: ToastItem[] = [];
const toastSubs = new Set<() => void>();

function emitToast() {
  for (const sub of toastSubs) sub();
}

export function toast(message: string, type: ToastItem['type'] = 'info', duration = 2400) {
  const id = ++toastSeq;
  toastItems = [...toastItems, { id, message, type }].slice(-4);
  emitToast();
  setTimeout(() => {
    toastItems = toastItems.filter((t) => t.id !== id);
    emitToast();
  }, duration);
}

export function useToasts(): ToastItem[] {
  return useSyncExternalStore(
    (cb) => {
      toastSubs.add(cb);
      return () => toastSubs.delete(cb);
    },
    () => toastItems
  );
}

/* ------------------------------------------------------------------ 数据 hooks */

export function useSettings(): Settings | null {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    let alive = true;
    invoke<Settings>('core', 'settings.get')
      .then((value) => {
        if (alive) setSettings(value);
      })
      .catch(() => undefined);
    const off = on('settings:changed', (payload) => {
      if (payload && typeof payload === 'object') setSettings(payload as Settings);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  return settings;
}

export function usePlugins(): PluginRuntimeInfo[] {
  const [plugins, setPlugins] = useState<PluginRuntimeInfo[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => {
      invoke<PluginRuntimeInfo[]>('core', 'plugins.list')
        .then((value) => {
          if (alive) setPlugins(value);
        })
        .catch(() => undefined);
    };
    load();
    const off = on('plugins:changed', load);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return plugins;
}

export function useCommands(): CommandInfo[] {
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => {
      invoke<CommandInfo[]>('core', 'commands.list')
        .then((value) => {
          if (alive) setCommands(value);
        })
        .catch(() => undefined);
    };
    load();
    const off = on('plugins:changed', load);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return commands;
}

export async function patchSettings(patch: SettingsPatch): Promise<Settings> {
  return invoke<Settings>('core', 'settings.patch', patch);
}

export async function runCommand(id: string): Promise<unknown> {
  return invoke('core', 'commands.run', { id });
}

/* ------------------------------------------------------------------ 弹性滚动 */

interface ScrollState {
  target: number;
  current: number;
  velocity: number;
  raf: number;
}

const scrollStates = new WeakMap<HTMLElement, ScrollState>();
const MAX_OVERSCROLL = 46;

function ensureElastic(el: HTMLElement) {
  if (scrollStates.has(el)) return;
  const state: ScrollState = {
    target: el.scrollTop,
    current: el.scrollTop,
    velocity: 0,
    raf: 0,
  };
  scrollStates.set(el, state);

  const maxScroll = () => Math.max(0, el.scrollHeight - el.clientHeight);

  const frame = () => {
    const max = maxScroll();
    state.target = Math.max(-MAX_OVERSCROLL, Math.min(max + MAX_OVERSCROLL, state.target));
    state.velocity += (state.target - state.current) * 0.17;
    state.velocity *= 0.76;
    state.current += state.velocity;
    if (Math.abs(state.velocity) < 0.02 && Math.abs(state.target - state.current) < 0.05) {
      state.current = state.target;
      el.scrollTop = state.current;
      state.raf = 0;
      return;
    }
    el.scrollTop = state.current;
    state.raf = requestAnimationFrame(frame);
  };

  const start = () => {
    if (!state.raf) state.raf = requestAnimationFrame(frame);
  };

  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) return;
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    event.preventDefault();
    state.target += event.deltaY;
    start();
  };

  const onScroll = () => {
    if (state.raf) return;
    state.target = state.current = el.scrollTop;
  };

  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('scroll', onScroll, { passive: true });
}

export function useElasticScroll() {
  useEffect(() => {
    const attach = () => {
      document.querySelectorAll<HTMLElement>('.tk-scroll, [data-tk-scroll]').forEach(ensureElastic);
    };
    attach();
    const observer = new MutationObserver(attach);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
}

/* ------------------------------------------------------------------ 格式化 */

export function formatHotkey(accel?: string): string {
  if (!accel) return '';
  return accel
    .replace(/CommandOrControl/gi, 'Ctrl')
    .replace(/Control/gi, 'Ctrl')
    .replace(/\+/g, ' + ')
    .replace(/Alt/gi, 'Alt')
    .replace(/Shift/gi, 'Shift');
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let index = 0;
  let value = bytes;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 100 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${String(hours).padStart(2, '0')}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

export function todayLabel(): string {
  const now = new Date();
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()];
  return `${now.getMonth() + 1} 月 ${now.getDate()} 日 · ${week}`;
}

export function useAppInfo(): AppInfo | null {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    invoke<AppInfo>('core', 'app.info')
      .then(setInfo)
      .catch(() => undefined);
  }, []);
  return info;
}

export function useUnmount(fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => () => ref.current(), []);
}

export function useStableCallback<T extends (...args: never[]) => unknown>(fn: T): T {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback(((...args: never[]) => ref.current(...args)) as T, []);
}
/** 当前壁纸（主进程解析 selector → tk://file URL）；随设置变化自动刷新。 */
export function useWallpaper(): WallpaperCurrent | null {
  const [wallpaper, setWallpaper] = useState<WallpaperCurrent | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      invoke<WallpaperCurrent | null>('core', 'wallpapers.current')
        .then((value) => {
          if (alive) setWallpaper(value ?? null);
        })
        .catch(() => undefined);
    };
    load();
    const off = on('settings:changed', load);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return wallpaper;
}
