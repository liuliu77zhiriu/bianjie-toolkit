/**
 * 隐藏录制页逻辑（capture-dev）。
 *
 * 流程：主进程加载本页 → 页面就绪后发 recorderHost.ready → 主进程完成倒计时后
 * 用 executeJavaScript(code, true) 调起 `window.__tkRecorderStart(config)`
 * （userGesture=true 才能满足 getDisplayMedia 的用户激活要求）→
 * getDisplayMedia(来源由主进程 setDisplayMediaRequestHandler 指定) → 可选麦克风
 * + AudioContext 混音 → MediaRecorder(优先 MP4/H.264) → 分片按序回传主进程落盘。
 */

import {
  extFromMime,
  mimeCandidates,
  needsMic,
  needsSystemAudio,
  videoBitrate,
  type RecorderFormatPref,
} from '../../../main/core/media/geometry';
import type { AudioSource } from '../../../shared/types';

interface RecorderConfig {
  sourceId: string;
  kind: 'screen' | 'window';
  displayId?: string | null;
  audio: AudioSource;
  fps: number;
  quality: number;
  formatPref: RecorderFormatPref;
}

interface StartResult {
  ok: boolean;
  error?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  format?: 'mp4' | 'webm';
}

interface RecorderHostBridge {
  ready(info?: unknown): void;
  chunk(buffer: ArrayBuffer): void;
  state(state: unknown): void;
  stopped(result: unknown): void;
  error(message: string): void;
  onStop(cb: () => void): () => void;
  onCommand(cb: (command: unknown) => void): () => void;
}

declare global {
  interface Window {
    recorderHost?: RecorderHostBridge;
    __tkRecorderStart?: (config: RecorderConfig) => Promise<StartResult>;
  }
}

const host = window.recorderHost;
const root = document.getElementById('recorder-root');

function readableError(err: unknown): string {
  if (err instanceof Error) {
    const name = err.name ? `${err.name}: ` : '';
    return `${name}${err.message || String(err)}`;
  }
  return String(err);
}

let displayStream: MediaStream | null = null;
let micStream: MediaStream | null = null;
let mixedStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let recorder: MediaRecorder | null = null;
let recordingStartedAt = 0;
let chunkChain: Promise<void> = Promise.resolve();
let stopping = false;
let offStop: (() => void) | null = null;
let started = false;
/** 定时 requestData()，保证 MP4 也按分片实时回传主进程（避免整段驻留内存） */
let chunkFlushTimer: number | null = null;
let chunkCount = 0;
let chunkBytes = 0;

declare global {
  interface Window {
    __tkRecorderDebug?: () => Record<string, unknown>;
  }
}

function chooseMime(pref: RecorderFormatPref, hasAudio: boolean): string {
  const candidates = mimeCandidates(pref, hasAudio);
  for (const mime of candidates) {
    try {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) return mime;
    } catch {
      /* try next */
    }
  }
  return '';
}

function setStatus(text: string): void {
  if (!root) return;
  root.textContent = text;
  root.setAttribute('data-status', text);
}

async function cleanupTracks(): Promise<void> {
  if (chunkFlushTimer !== null) {
    clearInterval(chunkFlushTimer);
    chunkFlushTimer = null;
  }
  if (offStop) {
    try {
      offStop();
    } catch {
      /* ignore */
    }
    offStop = null;
  }
  for (const stream of [mixedStream, displayStream, micStream]) {
    if (!stream) continue;
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        /* ignore */
      }
    }
  }
  mixedStream = null;
  displayStream = null;
  micStream = null;
  if (audioContext) {
    try {
      await audioContext.close();
    } catch {
      /* ignore */
    }
    audioContext = null;
  }
}

/** 混音：系统声音 + 麦克风 → MediaStreamDestination 的单个音轨。 */
async function buildAudioTracks(config: RecorderConfig): Promise<MediaStreamTrack[]> {
  const hasSystem = needsSystemAudio(config.audio);
  const hasMic = needsMic(config.audio);
  const systemTracks = displayStream ? displayStream.getAudioTracks() : [];
  let micTracks: MediaStreamTrack[] = [];

  if (hasMic) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      micTracks = micStream.getAudioTracks();
    } catch (err) {
      if (!hasSystem) throw new Error(`无法访问麦克风：${readableError(err)}`);
      host?.error(`麦克风不可用，本次仅录制系统声音（${readableError(err)}）`);
    }
  }

  if (systemTracks.length && micTracks.length) {
    try {
      audioContext = new AudioContext();
      await audioContext.resume();
      if (audioContext.state !== 'running') {
        throw new Error('音频混音上下文未能启动');
      }
      const destination = audioContext.createMediaStreamDestination();
      const systemSource = audioContext.createMediaStreamSource(new MediaStream(systemTracks));
      const micSource = audioContext.createMediaStreamSource(new MediaStream(micTracks));
      systemSource.connect(destination);
      micSource.connect(destination);
      const mixed = destination.stream.getAudioTracks()[0];
      return mixed ? [mixed] : [...systemTracks, ...micTracks].slice(0, 1);
    } catch (err) {
      host?.error(`音频混音失败，回退为系统声音（${readableError(err)}）`);
      return systemTracks.length ? [systemTracks[0]] : micTracks.length ? [micTracks[0]] : [];
    }
  }
  if (systemTracks.length) return [systemTracks[0]];
  if (micTracks.length) return [micTracks[0]];
  return [];
}

async function beginRecording(config: RecorderConfig): Promise<StartResult> {
  if (recorder && recorder.state !== 'inactive') throw new Error('录制已经在进行中');
  if (!config || !config.sourceId) throw new Error('缺少录制来源');

  const hasSystem = needsSystemAudio(config.audio);
  const requestedFps = Math.max(1, Math.min(120, Number(config.fps) || 30));

  setStatus('正在请求捕获权限…');
  displayStream = await navigator.mediaDevices.getDisplayMedia({
    video: {
      frameRate: { ideal: requestedFps, max: requestedFps },
    },
    audio: hasSystem,
  });

  const videoTrack = displayStream.getVideoTracks()[0];
  if (!videoTrack) throw new Error('未能获取屏幕画面（捕获被拒绝）');

  // 用户从系统捕获浮层/来源关闭窗口时自动结束录制。
  videoTrack.addEventListener('ended', () => {
    if (recorder && recorder.state !== 'inactive') requestStop();
  });

  const videoSettings = videoTrack.getSettings();
  const tracks: MediaStreamTrack[] = [videoTrack];
  const audioTracks = await buildAudioTracks(config);
  if (audioTracks.length) tracks.push(...audioTracks);
  mixedStream = new MediaStream(tracks);

  const hasAudio = tracks.length > 1;
  const mime = chooseMime(config.formatPref, hasAudio);
  const options: MediaRecorderOptions = {
    videoBitsPerSecond: videoBitrate({
      width: videoSettings.width,
      height: videoSettings.height,
      fps: requestedFps,
      quality: config.quality,
    }),
  };
  if (hasAudio) options.audioBitsPerSecond = 128_000;
  if (mime) options.mimeType = mime;

  recorder = new MediaRecorder(mixedStream, options);
  chunkChain = Promise.resolve();
  recorder.ondataavailable = (event: BlobEvent) => {
    const blob = event.data;
    if (!blob || !blob.size) return;
    chunkCount += 1;
    chunkBytes += blob.size;
    chunkChain = chunkChain
      .then(async () => {
        const buffer = await blob.arrayBuffer();
        host?.chunk(buffer);
      })
      .catch((err) => {
        host?.error(`录制分片读取失败：${readableError(err)}`);
      });
  };
  recorder.onerror = (event: Event) => {
    const message = (event as unknown as { error?: { message?: string } })?.error?.message;
    host?.error(`录制器异常：${message || '未知错误'}`);
  };
  recorder.onstop = () => {
    void finalizeStop();
  };

  recorder.start(1000);
  // Chromium 的 MP4 muxer 不保证按 timeslice 回调 dataavailable，主动 requestData()
  // 触发分片，让主进程在录制过程中就持续落盘（长录制不会整段堆在渲染进程内存里）。
  chunkFlushTimer = window.setInterval(() => {
    if (!recorder || recorder.state !== 'recording') return;
    try {
      recorder.requestData();
    } catch {
      /* ignore */
    }
  }, 1200);
  recordingStartedAt = performance.now();
  started = true;
  offStop = host?.onStop(() => requestStop()) ?? null;
  setStatus('录制中');

  const actualMime = recorder.mimeType || mime || 'video/webm';
  const result: StartResult = {
    ok: true,
    mimeType: actualMime,
    format: extFromMime(actualMime),
    width: videoSettings.width || 0,
    height: videoSettings.height || 0,
    hasAudio,
  };
  host?.state({ phase: 'recording', startedAt: Date.now(), mimeType: actualMime });
  return result;
}

function requestStop(): void {
  if (stopping) return;
  stopping = true;
  setStatus('正在停止…');
  if (!recorder || recorder.state === 'inactive') {
    void finalizeStop();
    return;
  }
  try {
    recorder.stop();
  } catch (err) {
    host?.error(`停止录制失败：${readableError(err)}`);
    void finalizeStop();
  }
}

async function finalizeStop(): Promise<void> {
  const durationMs = started ? Math.max(0, Math.round(performance.now() - recordingStartedAt)) : 0;
  // 等所有分片按序送出（IPC 同源保序），再通知主进程收尾。
  await chunkChain.catch(() => undefined);
  await cleanupTracks();
  recorder = null;
  started = false;
  stopping = false;
  setStatus('已停止');
  host?.stopped({ durationMs });
}

window.__tkRecorderDebug = () => ({
  started,
  stopping,
  chunks: chunkCount,
  bytes: chunkBytes,
  state: recorder ? recorder.state : 'inactive',
  mime: recorder ? recorder.mimeType : null,
});

window.__tkRecorderStart = async (config: RecorderConfig): Promise<StartResult> => {
  try {
    return await beginRecording(config);
  } catch (err) {
    const message = readableError(err);
    await cleanupTracks();
    recorder = null;
    started = false;
    stopping = false;
    setStatus(`失败：${message}`);
    host?.error(message);
    return { ok: false, error: message };
  }
};

// 兼容主进程通过 IPC 发送的开始指令（当前主进程使用 executeJavaScript 手势方式）。
host?.onCommand((command) => {
  const config = (command as { config?: RecorderConfig })?.config ?? (command as RecorderConfig);
  if (!config || !config.sourceId) return;
  void window.__tkRecorderStart?.(config);
});

window.addEventListener('error', (event) => {
  host?.error(`录制页脚本异常：${event.message || '未知错误'}`);
});
window.addEventListener('unhandledrejection', (event) => {
  host?.error(`录制页未处理异常：${readableError(event.reason)}`);
});

host?.ready({ ok: true, secure: window.isSecureContext });
setStatus('待命');
