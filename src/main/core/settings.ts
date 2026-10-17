import { EventEmitter } from 'node:events';
import path from 'node:path';
import { DEFAULT_SETTINGS, SETTINGS_VERSION, ACCENT_PRESETS } from '../../shared/defaults';
import type { Settings, SettingsPatch } from '../../shared/types';
import { JsonStore, deepMerge } from './store';
import type { Logger } from './logger';
import type { AppPaths } from '../../shared/types';

const ACCENT_VALUES = new Set(ACCENT_PRESETS.map((p) => p.value.toLowerCase()));

export class SettingsService extends EventEmitter {
  private store: JsonStore<Settings>;
  private current: Settings;

  constructor(paths: AppPaths, private logger: Logger) {
    super();
    this.store = new JsonStore<Settings>(path.join(paths.userData, 'settings.json'), DEFAULT_SETTINGS, {
      logger,
    });
    this.current = this.sanitize(this.store.get());
    this.store.replace(this.current);
  }

  get(): Settings {
    return structuredClone(this.current);
  }

  getSection<K extends keyof Settings>(key: K): Settings[K] {
    return structuredClone(this.current[key]);
  }

  patch(patch: SettingsPatch): Settings {
    const merged = deepMerge(
      this.current as unknown as Record<string, unknown>,
      patch as Record<string, unknown>
    ) as unknown as Settings;
    const next = this.sanitize(merged);
    const changed = JSON.stringify(next) !== JSON.stringify(this.current);
    this.current = next;
    this.store.replace(next);
    if (changed) {
      this.emit('change', this.get(), patch);
    }
    return this.get();
  }

  reset(section?: keyof Settings): Settings {
    if (!section) {
      this.current = structuredClone(DEFAULT_SETTINGS);
    } else {
      const defaults = structuredClone(DEFAULT_SETTINGS);
      (this.current as unknown as Record<string, unknown>)[section] = defaults[section];
    }
    this.current = this.sanitize(this.current);
    this.store.replace(this.current);
    this.emit('change', this.get(), null);
    return this.get();
  }

  replace(next: Settings): Settings {
    this.current = this.sanitize(deepMerge(structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>) as unknown as Settings);
    this.store.replace(this.current);
    this.emit('change', this.get(), null);
    return this.get();
  }

  private sanitize(input: Settings): Settings {
    const s = structuredClone(DEFAULT_SETTINGS);
    const raw = input as unknown as Record<string, any>;
    if (!raw || typeof raw !== 'object') return s;
    s.version = SETTINGS_VERSION;

    const num = (v: unknown, min: number, max: number, fallback: number): number =>
      typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
    const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
    const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);

    const general = raw.general ?? {};
    Object.assign(s.general, {
      launchAtLogin: bool(general.launchAtLogin, s.general.launchAtLogin),
      showBall: bool(general.showBall, s.general.showBall),
      closePanelOnBlur: bool(general.closePanelOnBlur, s.general.closePanelOnBlur),
      rememberPanelSize: bool(general.rememberPanelSize, s.general.rememberPanelSize),
    });

    const appearance = raw.appearance ?? {};
    const accent = str(appearance.accent, s.appearance.accent).toLowerCase();
    Object.assign(s.appearance, {
      accent: ACCENT_VALUES.has(accent) || /^#[0-9a-f]{6}$/.test(accent) ? accent : s.appearance.accent,
      panelOpacity: num(appearance.panelOpacity, 0.55, 1, s.appearance.panelOpacity),
      blur: bool(appearance.blur, s.appearance.blur),
      animation: ['full', 'lite', 'off'].includes(appearance.animation)
        ? appearance.animation
        : s.appearance.animation,
      ballSize: num(appearance.ballSize, 40, 76, s.appearance.ballSize),
      ballOpacity: num(appearance.ballOpacity, 0.35, 1, s.appearance.ballOpacity),
      ballAutoHide: bool(appearance.ballAutoHide, s.appearance.ballAutoHide),
      ballEdgeSnap: bool(appearance.ballEdgeSnap, s.appearance.ballEdgeSnap),
      alwaysOnTop: bool(appearance.alwaysOnTop, s.appearance.alwaysOnTop),
      showDock: bool(appearance.showDock, s.appearance.showDock),
    });

    const shortcuts = raw.shortcuts ?? {};
    for (const key of Object.keys(s.shortcuts) as Array<keyof Settings['shortcuts']>) {
      const value = str(shortcuts[key], s.shortcuts[key]).trim();
      s.shortcuts[key] = value.length <= 40 ? value : s.shortcuts[key];
    }

    const capture = raw.capture ?? {};
    // 留空表示使用默认目录
    const captureDir = str(capture.saveDir, s.capture.saveDir).trim();
    Object.assign(s.capture, {
      saveDir: captureDir.length <= 400 ? captureDir : '',
      format: capture.format === 'jpg' ? 'jpg' : 'png',
      copyToClipboard: bool(capture.copyToClipboard, s.capture.copyToClipboard),
      showPanelAfter: bool(capture.showPanelAfter, s.capture.showPanelAfter),
      playSound: bool(capture.playSound, s.capture.playSound),
    });

    const recorder = raw.recorder ?? {};
    const recordDir = str(recorder.saveDir, s.recorder.saveDir).trim();
    const fps = [24, 30, 60].includes(recorder.fps) ? recorder.fps : s.recorder.fps;
    Object.assign(s.recorder, {
      saveDir: recordDir.length <= 400 ? recordDir : '',
      fps,
      quality: num(recorder.quality, 30, 100, s.recorder.quality),
      audio: ['none', 'system', 'mic', 'system+mic'].includes(recorder.audio)
        ? recorder.audio
        : s.recorder.audio,
      countdown: num(recorder.countdown, 0, 10, s.recorder.countdown),
      format: ['auto', 'mp4', 'webm'].includes(recorder.format) ? recorder.format : s.recorder.format,
      maxDurationMin: num(recorder.maxDurationMin, 0, 240, s.recorder.maxDurationMin),
    });

    const data = raw.data ?? {};
    Object.assign(s.data, {
      autoBackup: bool(data.autoBackup, s.data.autoBackup),
      backupKeepDays: num(data.backupKeepDays, 1, 365, s.data.backupKeepDays),
    });

    const plugins = raw.plugins ?? {};
    const disabled = Array.isArray(plugins.disabled)
      ? (plugins.disabled.filter((x: unknown): x is string => typeof x === 'string') as string[])
      : [];
    s.plugins.disabled = Array.from(new Set(disabled)).slice(0, 100);

    return s;
  }
}

