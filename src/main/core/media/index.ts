/**
 * ★ 媒体能力入口（capture-dev）：截图 / 来源枚举 / 录屏。
 *
 * Lead 的 plugin-host / main 入口只调用 `createMediaApi(deps)` 并注入 `ctx.media`，
 * 所有实现细节都在本目录内：
 *   - geometry.ts  纯函数（文件名、DPI 换算、码率、编码候选），可被 Node 单测
 *   - screenshot.ts desktopCapturer + screen 截图与保存
 *   - recording.ts  隐藏窗口 + MediaRecorder 录屏引擎（分片直接落盘）
 */

import * as electronModule from 'electron';
import type {
  AppPaths,
  CaptureOptions,
  CaptureResult,
  MediaApi,
  MediaDeps,
  MediaSource,
  RecordingResult,
  RecordingState,
  StartRecordingOptions,
} from '../../../shared/types';
import { captureFullscreen, captureRegion, captureWindow, listSources, type ScreenshotDeps } from './screenshot';
import { getRecordingEngine, type RecordingDeps } from './recording';

export type { MediaDeps };

export function createMediaApi(deps: MediaDeps): MediaApi {
  // 主进程入口可能只传了部分 Electron 模块（并做了类型断言），这里用真实模块兜底，
  // 保证 session / ipcMain / powerSaveBlocker 等录屏必需能力始终可用。
  const electron = {
    ...(electronModule as unknown as Record<string, unknown>),
    ...((deps.electron as unknown as Record<string, unknown>) || {}),
  } as unknown as MediaDeps['electron'];

  const screenshotDeps: ScreenshotDeps = {
    settings: deps.settings,
    paths: deps.paths,
    log: deps.log,
    electron,
    hidePanel: deps.hidePanel,
    showPanel: deps.showPanel,
  };

  const recordingDeps: RecordingDeps = {
    settings: deps.settings,
    paths: deps.paths,
    log: deps.log,
    electron,
    hidePanel: deps.hidePanel,
    showPanel: deps.showPanel,
  };

  // 引擎内部绑定 ipcMain 监听，必须是全进程单例（避免重复注册）。
  const engine = getRecordingEngine(recordingDeps);

  return {
    async listSources(opts?: {
      kinds?: Array<'screen' | 'window'>;
      thumbnailWidth?: number;
    }): Promise<MediaSource[]> {
      return listSources(screenshotDeps, opts);
    },
    async captureFullscreen(opts?: CaptureOptions): Promise<CaptureResult> {
      return captureFullscreen(screenshotDeps, opts ?? {});
    },
    async captureWindow(opts: CaptureOptions & { sourceId: string }): Promise<CaptureResult> {
      return captureWindow(screenshotDeps, opts);
    },
    async captureRegion(
      opts: CaptureOptions & { rect: { x: number; y: number; width: number; height: number }; displayId?: string }
    ): Promise<CaptureResult> {
      return captureRegion(screenshotDeps, opts);
    },
    async startRecording(opts: StartRecordingOptions): Promise<{ id: string }> {
      return engine.start(opts);
    },
    async stopRecording(id: string): Promise<RecordingResult> {
      return engine.stop(id);
    },
    async cancelRecording(id: string): Promise<void> {
      return engine.cancel(id);
    },
    async getRecordingState(id: string): Promise<RecordingState> {
      return engine.getRecordingState(id);
    },
    onState(cb: (state: RecordingState) => void): () => void {
      return engine.onState(cb);
    },
  };
}

export type { AppPaths };
