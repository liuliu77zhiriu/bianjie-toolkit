import { app, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import type { AppPaths } from '../../shared/types';

function ensureDir(dir: string): string {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  return dir;
}

function defaultPictures(): string {
  try {
    return app.getPath('pictures');
  } catch {
    return app.getPath('userData');
  }
}

function defaultVideos(): string {
  try {
    return app.getPath('videos');
  } catch {
    return app.getPath('userData');
  }
}

export function buildPaths(appRoot: string): AppPaths {
  const userData = app.getPath('userData');
  const paths: AppPaths = {
    userData,
    screenshots: ensureDir(path.join(defaultPictures(), '便捷工具截图')),
    recordings: ensureDir(path.join(defaultVideos(), '便捷工具录制')),
    logs: ensureDir(path.join(userData, 'logs')),
    plugins: ensureDir(path.join(userData, 'plugins')),
    overrides: ensureDir(path.join(userData, 'overrides')),
    backups: ensureDir(path.join(userData, 'backups')),
    temp: ensureDir(path.join(userData, 'temp')),
    appRoot,
    rendererDir: path.join(appRoot, 'dist', 'renderer'),
    preloadDir: path.join(appRoot, 'dist', 'preload'),
    resourcesDir: path.join(appRoot, 'resources'),
  };
  return paths;
}

export function resolveCaptureDir(paths: AppPaths, configured: string): string {
  if (configured && configured.trim()) return ensureDir(configured.trim());
  return paths.screenshots;
}

export function resolveRecordDir(paths: AppPaths, configured: string): string {
  if (configured && configured.trim()) return ensureDir(configured.trim());
  return paths.recordings;
}

export function openPathSafe(target: string): void {
  if (!target) return;
  try {
    void shell.openPath(path.resolve(target));
  } catch {
    /* ignore */
  }
}
