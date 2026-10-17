/**
 * 隐藏录制窗口的 preload（capture-dev 负责）。
 *
 * 暴露 window.recorderHost，供 dist/renderer/recorder.html 使用：
 *   window.recorderHost.ready(info?)          页面脚本就绪
 *   window.recorderHost.chunk(arrayBuffer)    MediaRecorder 分片（主进程顺序落盘）
 *   window.recorderHost.state(state)          录制页状态（phase/error 等）
 *   window.recorderHost.stopped(result)       已停止（含 durationMs）
 *   window.recorderHost.error(message)        可读错误
 *   window.recorderHost.onStop(cb)            主进程要求停止 → 返回取消订阅函数
 *   window.recorderHost.onCommand(cb)         兼容旧的 recorderStart 指令
 */
import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/defaults';

type Listener = () => void;

const bridge = {
  ready: (info?: unknown) => ipcRenderer.send(IPC.recorderReady, info ?? null),
  chunk: (buffer: ArrayBuffer) => ipcRenderer.send(IPC.recorderChunk, buffer),
  state: (state: unknown) => ipcRenderer.send(IPC.recorderState, state),
  stopped: (result: unknown) => ipcRenderer.send(IPC.recorderStopped, result),
  error: (message: string) => ipcRenderer.send(IPC.recorderError, String(message)),
  onStop(cb: Listener): () => void {
    const handler = () => {
      try {
        cb();
      } catch (err) {
        console.error('[recorder] onStop 回调异常', err);
      }
    };
    ipcRenderer.on(IPC.recorderStop, handler);
    return () => ipcRenderer.removeListener(IPC.recorderStop, handler);
  },
  onCommand(cb: (command: unknown) => void): () => void {
    const handler = (_event: unknown, command: unknown) => {
      try {
        cb(command);
      } catch (err) {
        console.error('[recorder] onCommand 回调异常', err);
      }
    };
    ipcRenderer.on(IPC.recorderStart, handler);
    return () => ipcRenderer.removeListener(IPC.recorderStart, handler);
  },
};

contextBridge.exposeInMainWorld('recorderHost', bridge);
