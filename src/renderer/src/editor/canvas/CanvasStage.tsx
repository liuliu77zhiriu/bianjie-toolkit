/**
 * UI 编辑器 · 画布舞台
 *
 * 负责：
 * - 渲染当前屏幕画板（工作台网格、标尺、画板背景/圆角/阴影、递归节点树、画板外裁剪）；
 * - 视图控制：滚轮平移、Ctrl/Cmd+滚轮以鼠标为中心缩放（0.1~4）、空格/中键拖拽平移、
 *   Ctrl+0 适配、Ctrl+1 100%、底部缩放控件、ResizeObserver 自动适配/居中；
 * - 选择与编辑：单击/Shift 多选、空白点击取消、框选、拖拽移动（8px 网格 + 参考线吸附 + 间距）、
 *   8 向缩放手柄 + 旋转手柄（15° 吸附）、Alt 拖拽复制、双击内联编辑；
 * - 创建工具：frame/rect/ellipse/line/text/image 等拖拽绘制，image 创建后回调 onRequestImage；
 * - 右键菜单：复制/粘贴/删除/置顶/置底/隐藏/锁定；Esc 取消拖拽或退出内联编辑。
 *
 * 性能：指针拖拽全部经 requestAnimationFrame 合并，每帧最多一次 store 提交；
 * 节点渲染交给 NodeView（React.memo），选择/悬停/缩放不会触发节点树重绘。
 */
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import type { UIEditorTool, UINode, UINodeType, UIProject } from '@shared/uieditor';
import { editorStore, useEditorSnapshot, type EditorSnapshot } from '../store';
import { NodeView } from './NodeView';
import './canvas.css';

/* ------------------------------------------------------------------ 类型 */

interface Point {
  x: number;
  y: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PendingPoint extends Point {
  shift: boolean;
  alt: boolean;
}

type ResizeDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const RESIZE_DIRS: ResizeDir[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

interface SnapLine {
  pos: number;
  rect: Rect | null;
}

interface SnapData {
  xs: SnapLine[];
  ys: SnapLine[];
  siblings: Rect[];
}

interface Guide {
  axis: 'v' | 'h';
  pos: number;
}

interface Measure {
  axis: 'h' | 'v';
  from: number;
  to: number;
  at: number;
  label: string;
}

interface OverlayState {
  marquee: Rect | null;
  create: Rect | null;
  guides: Guide[];
  measures: Measure[];
}

interface SelSpan {
  id: string;
  rect: Rect;
  locked: boolean;
}

interface InlineEditState {
  id: string;
  kind: 'text' | 'placeholder' | 'value' | 'label';
  rect: Rect;
  value: string;
}

interface MenuState {
  x: number;
  y: number;
  nodeId: string | null;
}

type CreateTool = Exclude<UIEditorTool, 'select' | 'hand'>;

type DragState =
  | { kind: 'pan'; startClient: Point; basePan: Point }
  | { kind: 'marquee'; start: Point; current: Point; additive: boolean }
  | {
      kind: 'create';
      type: UINodeType;
      start: Point;
      current: Point;
      parentId: string | null;
      origin: Point;
    }
  | {
      kind: 'move';
      startClient: Point;
      base: Array<{ id: string; x: number; y: number }>;
      baseMap: Map<string, { x: number; y: number }>;
      bbox: Rect;
      snap: SnapData;
      hasMoved: boolean;
    }
  | {
      kind: 'resize';
      id: string;
      dir: ResizeDir;
      startClient: Point;
      base: { x: number; y: number; w: number; h: number };
      ratio: number;
    }
  | {
      kind: 'rotate';
      id: string;
      center: Point;
      startAngle: number;
      baseRotation: number;
    };

const EMPTY_OVERLAY: OverlayState = { marquee: null, create: null, guides: [], measures: [] };
const RULER_STEPS = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];

/* ------------------------------------------------------------------ 纯函数工具 */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function unionRects(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const rect of rects) {
    x1 = Math.min(x1, rect.x);
    y1 = Math.min(y1, rect.y);
    x2 = Math.max(x2, rect.x + rect.w);
    y2 = Math.max(y2, rect.y + rect.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function sameSelSpans(a: SelSpan[], b: SelSpan[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left.id !== right.id || left.locked !== right.locked) return false;
    if (
      Math.abs(left.rect.x - right.rect.x) > 0.01 ||
      Math.abs(left.rect.y - right.rect.y) > 0.01 ||
      Math.abs(left.rect.w - right.rect.w) > 0.01 ||
      Math.abs(left.rect.h - right.rect.h) > 0.01
    ) {
      return false;
    }
  }
  return true;
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.x - b.x) < 0.01 &&
    Math.abs(a.y - b.y) < 0.01 &&
    Math.abs(a.w - b.w) < 0.01 &&
    Math.abs(a.h - b.h) < 0.01
  );
}

function angleDeg(center: Point, point: Point): number {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
}

/** 去掉“祖先也在集合里”的节点，避免同一子树被移动两次 */
function topLevelIds(ids: string[], nodes: Record<string, UINode>): string[] {
  const set = new Set(ids);
  return ids.filter((id) => {
    let parent = nodes[id]?.parentId ?? null;
    while (parent) {
      if (set.has(parent)) return false;
      parent = nodes[parent]?.parentId ?? null;
    }
    return true;
  });
}

/** 未渲染到 DOM（如刚复制的节点）时的几何兜底，忽略旋转 */
function fallbackRect(id: string, nodes: Record<string, UINode>): Rect | null {
  const node = nodes[id];
  if (!node) return null;
  let x = 0;
  let y = 0;
  let current: UINode | undefined = node;
  while (current) {
    x += current.style.x;
    y += current.style.y;
    current = current.parentId ? nodes[current.parentId] : undefined;
  }
  return { x, y, w: node.style.width, h: node.style.height };
}

function screenOf(snapshot: EditorSnapshot) {
  return snapshot.project.screens.find((item) => item.id === snapshot.activeScreenId) ?? null;
}

function boardNodeIdOf(snapshot: EditorSnapshot): string | null {
  const screen = screenOf(snapshot);
  if (!screen) return null;
  const nodes = snapshot.project.nodes;
  for (const id of screen.rootIds) {
    const node = nodes[id];
    if (node && node.type === 'frame' && node.name === '画板') return id;
  }
  // 兜底：与屏幕尺寸一致的根 frame（用户可能重命名了画板）
  for (const id of screen.rootIds) {
    const node = nodes[id];
    if (
      node &&
      node.type === 'frame' &&
      Math.abs(node.style.width - screen.width) < 1 &&
      Math.abs(node.style.height - screen.height) < 1
    ) {
      return id;
    }
  }
  return null;
}

function tickStep(zoom: number): number {
  for (const step of RULER_STEPS) if (step * zoom >= 64) return step;
  return RULER_STEPS[RULER_STEPS.length - 1];
}

function buildTicks(pan: number, zoom: number, length: number): Array<{ pos: number; coord: number }> {
  const step = tickStep(zoom);
  const ticks: Array<{ pos: number; coord: number }> = [];
  const startCoord = Math.floor(-pan / zoom / step) * step;
  for (let coord = startCoord; coord < (length - pan) / zoom + step; coord += step) {
    const pos = pan + coord * zoom;
    if (pos >= -step * zoom && pos <= length + 1) ticks.push({ pos, coord });
    if (ticks.length > 240) break;
  }
  return ticks;
}

function pickSnap(delta: number, lines: SnapLine[], start: number, size: number, threshold: number): { delta: number; line: number } | null {
  let best: { delta: number; line: number } | null = null;
  for (const line of lines) {
    const anchors = [start, start + size / 2, start + size];
    for (const anchor of anchors) {
      const diff = line.pos - (anchor + delta);
      if (Math.abs(diff) <= threshold && (!best || Math.abs(diff) < Math.abs(best.delta))) {
        best = { delta: diff, line: line.pos };
      }
    }
  }
  return best;
}

function computeMeasures(moving: Rect, siblings: Rect[]): Measure[] {
  const out: Measure[] = [];
  let right: { gap: number; from: number; to: number } | null = null;
  let left: { gap: number; from: number; to: number } | null = null;
  let bottom: { gap: number; from: number; to: number } | null = null;
  let top: { gap: number; from: number; to: number } | null = null;

  for (const other of siblings) {
    const verticalOverlap = Math.min(moving.y + moving.h, other.y + other.h) - Math.max(moving.y, other.y);
    const horizontalOverlap = Math.min(moving.x + moving.w, other.x + other.w) - Math.max(moving.x, other.x);
    if (verticalOverlap > 1) {
      if (other.x > moving.x) {
        const gap = other.x - (moving.x + moving.w);
        if (gap > 0.5 && (!right || gap < right.gap)) right = { gap, from: moving.x + moving.w, to: other.x };
      } else if (other.x + other.w < moving.x) {
        const gap = moving.x - (other.x + other.w);
        if (gap > 0.5 && (!left || gap < left.gap)) left = { gap, from: other.x + other.w, to: moving.x };
      }
    }
    if (horizontalOverlap > 1) {
      if (other.y > moving.y) {
        const gap = other.y - (moving.y + moving.h);
        if (gap > 0.5 && (!bottom || gap < bottom.gap)) bottom = { gap, from: moving.y + moving.h, to: other.y };
      } else if (other.y + other.h < moving.y) {
        const gap = moving.y - (other.y + other.h);
        if (gap > 0.5 && (!top || gap < top.gap)) top = { gap, from: other.y + other.h, to: moving.y };
      }
    }
  }

  const atY = moving.y + moving.h / 2;
  const atX = moving.x + moving.w / 2;
  if (right && right.gap <= 400) out.push({ axis: 'h', from: right.from, to: right.to, at: atY, label: String(Math.round(right.gap)) });
  if (left && left.gap <= 400) out.push({ axis: 'h', from: left.from, to: left.to, at: atY, label: String(Math.round(left.gap)) });
  if (bottom && bottom.gap <= 400) out.push({ axis: 'v', from: bottom.from, to: bottom.to, at: atX, label: String(Math.round(bottom.gap)) });
  if (top && top.gap <= 400) out.push({ axis: 'v', from: top.from, to: top.to, at: atX, label: String(Math.round(top.gap)) });
  return out;
}

/* ------------------------------------------------------------------ 组件 */

export function CanvasStage({ onRequestImage }: { onRequestImage?: (nodeId: string) => void }): ReactElement {
  const snapshot = useEditorSnapshot();
  const { project, activeScreenId, selection, hoverId, tool, zoom, pan } = snapshot;
  const screen = screenOf(snapshot);
  const boardNodeId = boardNodeIdOf(snapshot);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const inlineEditRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const pendingRef = useRef<PendingPoint | null>(null);
  const rafRef = useRef<number | null>(null);
  const spaceRef = useRef(false);
  const manualViewRef = useRef(false);
  const fitRef = useRef<() => void>(() => undefined);
  const zoom100Ref = useRef<() => void>(() => undefined);
  const applyDragRef = useRef<((drag: DragState, point: PendingPoint) => void) | null>(null);
  const cancelDragRef = useRef<() => void>(() => undefined);
  const finishDragRef = useRef<() => void>(() => undefined);
  const requestImageRef = useRef(onRequestImage);
  const inlineEditRefState = useRef<InlineEditState | null>(null);
  const inlineCommittingRef = useRef(false);
  const menuRef = useRef<MenuState | null>(null);

  const [size, setSize] = useState({ w: 0, h: 0 });
  const [overlay, setOverlay] = useState<OverlayState>(EMPTY_OVERLAY);
  const [selSpans, setSelSpans] = useState<SelSpan[]>([]);
  const [hoverRect, setHoverRect] = useState<Rect | null>(null);
  const [inlineEdit, setInlineEdit] = useState<InlineEditState | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [cursor, setCursor] = useState<'default' | 'grab' | 'grabbing' | 'crosshair'>('default');
  const [hint, setHint] = useState<string | null>(null);
  const hintTimerRef = useRef<number | null>(null);

  inlineEditRefState.current = inlineEdit;
  menuRef.current = menu;

  useEffect(() => {
    requestImageRef.current = onRequestImage;
  }, [onRequestImage]);

  const showHint = (message: string) => {
    setHint(message);
    if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current);
    hintTimerRef.current = window.setTimeout(() => {
      hintTimerRef.current = null;
      setHint(null);
    }, 1600);
  };

  useEffect(
    () => () => {
      if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current);
    },
    []
  );

  /* ---------------------------------------------------------------- 坐标/测量 */

  const clientToContainer = (clientX: number, clientY: number): Point => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return { x: clientX, y: clientY };
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const clientToBoard = (clientX: number, clientY: number): Point => {
    const rect = rootRef.current?.getBoundingClientRect();
    const current = editorStore.getSnapshot();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - current.pan.x) / current.zoom,
      y: (clientY - rect.top - current.pan.y) / current.zoom,
    };
  };

  const measureElement = (element: Element): Rect | null => {
    const root = rootRef.current;
    if (!root) return null;
    const base = root.getBoundingClientRect();
    const current = editorStore.getSnapshot();
    const rect = element.getBoundingClientRect();
    return {
      x: (rect.left - base.left - current.pan.x) / current.zoom,
      y: (rect.top - base.top - current.pan.y) / current.zoom,
      w: rect.width / current.zoom,
      h: rect.height / current.zoom,
    };
  };

  const measureNode = (nodeId: string): Rect | null => {
    const root = rootRef.current;
    if (!root) return null;
    const element = root.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`);
    return element ? measureElement(element) : null;
  };

  const measureAll = (): Map<string, Rect> => {
    const map = new Map<string, Rect>();
    const root = rootRef.current;
    if (!root) return map;
    const base = root.getBoundingClientRect();
    const current = editorStore.getSnapshot();
    root.querySelectorAll<HTMLElement>('[data-node-id]').forEach((element) => {
      const id = element.dataset.nodeId;
      if (!id) return;
      const rect = element.getBoundingClientRect();
      map.set(id, {
        x: (rect.left - base.left - current.pan.x) / current.zoom,
        y: (rect.top - base.top - current.pan.y) / current.zoom,
        w: rect.width / current.zoom,
        h: rect.height / current.zoom,
      });
    });
    return map;
  };

  const hitNodeId = (target: EventTarget | null): string | null => {
    const element = (target as HTMLElement | null)?.closest?.('[data-node-id]') as HTMLElement | null;
    return element?.dataset.nodeId ?? null;
  };

  /* ---------------------------------------------------------------- 视图控制 */

  const fitToScreen = () => {
    const root = rootRef.current;
    const currentScreen = editorStore.getActiveScreen();
    if (!root || !currentScreen) return;
    const rect = root.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return;
    const padX = 64;
    const padTop = 64;
    const padBottom = 88;
    const availableWidth = Math.max(60, rect.width - padX * 2);
    const availableHeight = Math.max(60, rect.height - padTop - padBottom);
    const nextZoom = clamp(Math.min(availableWidth / currentScreen.width, availableHeight / currentScreen.height), 0.1, 1.5);
    const rounded = Math.round(nextZoom * 100) / 100;
    editorStore.setZoom(rounded);
    editorStore.setPan({
      x: Math.round((rect.width - currentScreen.width * rounded) / 2),
      y: Math.round(padTop + (availableHeight - currentScreen.height * rounded) / 2),
    });
  };
  fitRef.current = fitToScreen;

  const zoomAtPoint = (factor: number, clientX: number, clientY: number) => {
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const current = editorStore.getSnapshot();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;
    const nextZoom = clamp(current.zoom * factor, 0.1, 4);
    const rounded = Math.round(nextZoom * 100) / 100;
    const boardX = (mouseX - current.pan.x) / current.zoom;
    const boardY = (mouseY - current.pan.y) / current.zoom;
    editorStore.setZoom(rounded);
    editorStore.setPan({ x: mouseX - boardX * rounded, y: mouseY - boardY * rounded });
    manualViewRef.current = true;
  };

  const zoomTo100 = () => {
    const root = rootRef.current;
    const currentScreen = editorStore.getActiveScreen();
    if (!root || !currentScreen) return;
    const rect = root.getBoundingClientRect();
    editorStore.setZoom(1);
    editorStore.setPan({
      x: Math.round((rect.width - currentScreen.width) / 2),
      y: Math.round((rect.height - currentScreen.height) / 2),
    });
    manualViewRef.current = true;
  };
  zoom100Ref.current = zoomTo100;

  const zoomAtCenter = (factor: number) => {
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    zoomAtPoint(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

  /* 适配屏幕：切换屏幕时重置视图并适配 */
  useEffect(() => {
    manualViewRef.current = false;
    const handle = requestAnimationFrame(() => fitRef.current());
    return () => cancelAnimationFrame(handle);
  }, [activeScreenId]);

  /* 工具栏 / 快捷键约定：window 上派发 'uieditor:fit' 表示适配屏幕 */
  useEffect(() => {
    const onFit = () => {
      manualViewRef.current = false;
      fitRef.current();
    };
    window.addEventListener('uieditor:fit', onFit);
    return () => window.removeEventListener('uieditor:fit', onFit);
  }, []);

  /* 容器尺寸变化：自动适配 / 保持视图 */
  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSize((previous) =>
        Math.abs(previous.w - rect.width) < 0.5 && Math.abs(previous.h - rect.height) < 0.5
          ? previous
          : { w: rect.width, h: rect.height }
      );
      if (!manualViewRef.current) fitRef.current();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /* 滚轮：默认平移（Shift 横向），Ctrl/Cmd 以鼠标为中心缩放（rAF 合并） */
  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    let accum = { panX: 0, panY: 0, zoomY: 0, zooming: false, x: 0, y: 0 };
    let frame: number | null = null;

    const flush = () => {
      frame = null;
      const current = editorStore.getSnapshot();
      if (accum.zooming) {
        const factor = Math.exp(-accum.zoomY * 0.0015);
        const nextZoom = clamp(current.zoom * factor, 0.1, 4);
        const rounded = Math.round(nextZoom * 100) / 100;
        const root = rootRef.current;
        if (root) {
          const rect = root.getBoundingClientRect();
          const mouseX = accum.x - rect.left;
          const mouseY = accum.y - rect.top;
          const boardX = (mouseX - current.pan.x) / current.zoom;
          const boardY = (mouseY - current.pan.y) / current.zoom;
          editorStore.setZoom(rounded);
          editorStore.setPan({ x: mouseX - boardX * rounded, y: mouseY - boardY * rounded });
        }
      } else if (accum.panX !== 0 || accum.panY !== 0) {
        editorStore.panBy(-accum.panX, -accum.panY);
      }
      manualViewRef.current = true;
      setMenu(null);
      accum = { panX: 0, panY: 0, zoomY: 0, zooming: false, x: 0, y: 0 };
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        accum.zooming = true;
        accum.zoomY += event.deltaY;
      } else if (event.shiftKey) {
        accum.panX += event.deltaY !== 0 ? event.deltaY : event.deltaX;
      } else {
        accum.panX += event.deltaX;
        accum.panY += event.deltaY;
      }
      accum.x = event.clientX;
      accum.y = event.clientY;
      if (frame === null) frame = requestAnimationFrame(flush);
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', onWheel);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, []);

  /* 键盘：空格平移、Ctrl+0 适配、Ctrl+1 100%、Esc 取消拖拽 */
  useEffect(() => {
    const isEditable = (target: EventTarget | null): boolean => {
      const element = target as HTMLElement | null;
      if (!element) return false;
      const tag = element.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || element.isContentEditable;
    };
    const inCanvas = (): boolean => {
      const root = rootRef.current;
      return !!root && !!document.activeElement && root.contains(document.activeElement);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditable(event.target)) return;
      if (event.code === 'Space' && !event.repeat) {
        if (!inCanvas()) return;
        spaceRef.current = true;
        setCursor('grab');
        event.preventDefault();
        return;
      }
      if (!inCanvas()) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key === '0') {
        event.preventDefault();
        manualViewRef.current = false;
        fitRef.current();
        return;
      }
      if (mod && event.key === '1') {
        event.preventDefault();
        zoom100Ref.current();
        return;
      }
      if (event.key === 'Escape') {
        if (menuRef.current) setMenu(null);
        if (dragRef.current) cancelDragRef.current();
        else if (editorStore.getSnapshot().tool !== 'select') editorStore.setTool('select');
        return;
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        spaceRef.current = false;
        setCursor(dragRef.current?.kind === 'pan' ? 'grabbing' : 'default');
      }
    };

    const onBlur = () => {
      spaceRef.current = false;
      setCursor('default');
      // 窗口失焦时清除悬停覆盖层，避免留下残影
      editorStore.hover(null);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  /* 点击菜单外部关闭 */
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);

  /* 内联编辑：挂载后聚焦并全选 */
  useEffect(() => {
    if (!inlineEdit) return;
    const element = inlineEditRef.current;
    if (!element) return;
    element.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(element);
    const domSelection = window.getSelection();
    domSelection?.removeAllRanges();
    domSelection?.addRange(range);
  }, [inlineEdit?.id, inlineEdit?.kind]);

  /* 外部（工具栏/面板）只改了 zoom 而没有改 pan 时，以视口中心为锚点补偿 pan */
  const viewAnchorRef = useRef<{ zoom: number; pan: Point } | null>(null);
  useLayoutEffect(() => {
    const previous = viewAnchorRef.current;
    viewAnchorRef.current = { zoom, pan: { x: pan.x, y: pan.y } };
    if (!previous) return;
    if (Math.abs(previous.zoom - zoom) < 1e-6) return;
    if (Math.abs(previous.pan.x - pan.x) > 0.5 || Math.abs(previous.pan.y - pan.y) > 0.5) return;
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const boardX = (centerX - previous.pan.x) / previous.zoom;
    const boardY = (centerY - previous.pan.y) / previous.zoom;
    const nextPan = { x: centerX - boardX * zoom, y: centerY - boardY * zoom };
    if (Math.abs(nextPan.x - pan.x) < 0.5 && Math.abs(nextPan.y - pan.y) < 0.5) return;
    editorStore.setPan(nextPan);
  }, [zoom, pan.x, pan.y]);

  /* ---------------------------------------------------------------- 覆盖层测量 */

  const selectionKey = selection.join('|');

  useLayoutEffect(() => {
    const measure = () => {
      const spans: SelSpan[] = [];
      for (const id of selection) {
        const rect = measureNode(id);
        if (!rect) continue;
        const node = editorStore.getProject().nodes[id];
        spans.push({ id, rect, locked: !!node?.style.locked });
      }
      setSelSpans((previous) => (sameSelSpans(previous, spans) ? previous : spans));

      const hoverTarget = hoverId && !selection.includes(hoverId) ? measureNode(hoverId) : null;
      setHoverRect((previous) => (sameRect(previous, hoverTarget) ? previous : hoverTarget));
    };
    measure();
    // 窗口缩放 / 适配 / 字体就绪后，布局可能再变化一帧，下一帧补测一次（自愈）
    const handle = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(handle);
  }, [selectionKey, hoverId, zoom, pan.x, pan.y, snapshot.project.updatedAt, activeScreenId, size.w, size.h]);

  /* ---------------------------------------------------------------- 拖拽引擎 */

  const beginPointerCapture = (event: ReactPointerEvent) => {
    const root = rootRef.current;
    try {
      root?.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  };

  const releasePointerCapture = (event: ReactPointerEvent) => {
    const root = rootRef.current;
    try {
      root?.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  };

  const scheduleFlush = () => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const drag = dragRef.current;
      const point = pendingRef.current;
      if (drag && point) applyDragRef.current?.(drag, point);
    });
  };

  const applyDrag = (drag: DragState, point: PendingPoint) => {
    switch (drag.kind) {
      case 'pan': {
        editorStore.setPan({
          x: drag.basePan.x + (point.x - drag.startClient.x),
          y: drag.basePan.y + (point.y - drag.startClient.y),
        });
        return;
      }
      case 'marquee': {
        drag.current = clientToBoard(point.x, point.y);
        setOverlay({ ...EMPTY_OVERLAY, marquee: rectFromPoints(drag.start, drag.current) });
        return;
      }
      case 'create': {
        drag.current = clientToBoard(point.x, point.y);
        setOverlay({ ...EMPTY_OVERLAY, create: rectFromPoints(drag.start, drag.current) });
        return;
      }
      case 'move': {
        const current = editorStore.getSnapshot();
        const zoomNow = current.zoom;
        let dx = (point.x - drag.startClient.x) / zoomNow;
        let dy = (point.y - drag.startClient.y) / zoomNow;
        if (!drag.hasMoved && Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        drag.hasMoved = true;
        const settings = current.project.settings;
        const guides: Guide[] = [];
        const threshold = Math.min(10, 5 / zoomNow);
        if (settings.snapToGuides) {
          const snapX = pickSnap(dx, drag.snap.xs, drag.bbox.x, drag.bbox.w, threshold);
          if (snapX) {
            dx += snapX.delta;
            guides.push({ axis: 'v', pos: snapX.line });
          }
          const snapY = pickSnap(dy, drag.snap.ys, drag.bbox.y, drag.bbox.h, threshold);
          if (snapY) {
            dy += snapY.delta;
            guides.push({ axis: 'h', pos: snapY.line });
          }
        }
        if (guides.length === 0 && settings.snapToGrid && settings.gridSize > 0) {
          const grid = settings.gridSize;
          dx = Math.round((drag.bbox.x + dx) / grid) * grid - drag.bbox.x;
          dy = Math.round((drag.bbox.y + dy) / grid) * grid - drag.bbox.y;
        }
        dx = Math.round(dx * 2) / 2;
        dy = Math.round(dy * 2) / 2;
        const moving: Rect = { x: drag.bbox.x + dx, y: drag.bbox.y + dy, w: drag.bbox.w, h: drag.bbox.h };
        const measures = settings.snapToGuides ? computeMeasures(moving, drag.snap.siblings) : [];
        editorStore.updateNodes(
          drag.base.map((item) => item.id),
          (node) => {
            const base = drag.baseMap.get(node.id);
            if (!base) return;
            node.style.x = base.x + dx;
            node.style.y = base.y + dy;
          },
          false
        );
        setOverlay({ ...EMPTY_OVERLAY, guides, measures });
        return;
      }
      case 'resize': {
        const current = editorStore.getSnapshot();
        const zoomNow = current.zoom;
        const settings = current.project.settings;
        const dx = (point.x - drag.startClient.x) / zoomNow;
        const dy = (point.y - drag.startClient.y) / zoomNow;
        const minW = 4;
        const minH = 4;
        let w = drag.base.w;
        let h = drag.base.h;
        if (drag.dir.includes('e')) w = drag.base.w + dx;
        if (drag.dir.includes('w')) w = drag.base.w - dx;
        if (drag.dir.includes('s')) h = drag.base.h + dy;
        if (drag.dir.includes('n')) h = drag.base.h - dy;
        const corner = drag.dir.length === 2;
        if (point.shift && corner && drag.ratio > 0) {
          if (Math.abs(w - drag.base.w) >= Math.abs(h - drag.base.h)) h = w / drag.ratio;
          else w = h * drag.ratio;
        }
        if (settings.snapToGrid && settings.gridSize > 0) {
          const grid = settings.gridSize;
          w = Math.max(minW, Math.round(w / grid) * grid);
          h = Math.max(minH, Math.round(h / grid) * grid);
        }
        w = Math.max(minW, Math.round(w));
        h = Math.max(minH, Math.round(h));
        const x = drag.dir.includes('w') ? Math.round(drag.base.x + drag.base.w - w) : Math.round(drag.base.x);
        const y = drag.dir.includes('n') ? Math.round(drag.base.y + drag.base.h - h) : Math.round(drag.base.y);
        editorStore.updateStyle(drag.id, { x, y, width: w, height: h }, false);
        return;
      }
      case 'rotate': {
        const angle = angleDeg(drag.center, clientToBoard(point.x, point.y));
        let rotation = drag.baseRotation + (angle - drag.startAngle);
        if (!point.alt) rotation = Math.round(rotation / 15) * 15;
        editorStore.updateStyle(drag.id, { rotation: Math.round(rotation) }, false);
        return;
      }
      default:
        return;
    }
  };
  applyDragRef.current = applyDrag;

  const cancelDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingRef.current = null;
    dragRef.current = null;
    setOverlay(EMPTY_OVERLAY);
    if (drag.kind === 'move' || drag.kind === 'resize' || drag.kind === 'rotate') editorStore.abortGesture();
    setCursor('default');
  };
  cancelDragRef.current = cancelDrag;

  const completeMarquee = (drag: Extract<DragState, { kind: 'marquee' }>) => {
    const current = editorStore.getSnapshot();
    const boardId = boardNodeIdOf(current);
    const marquee = rectFromPoints(drag.start, drag.current);
    const measured = measureAll();
    const hitIds: string[] = [];
    measured.forEach((rect, id) => {
      if (id === boardId) return;
      const node = current.project.nodes[id];
      if (!node || node.style.visible === false || node.style.locked) return;
      if (rectsOverlap(rect, marquee)) hitIds.push(id);
    });
    const picked = topLevelIds(hitIds, current.project.nodes);
    const nextSelection = drag.additive ? Array.from(new Set([...current.selection, ...picked])) : picked;
    editorStore.select(nextSelection);
    setOverlay(EMPTY_OVERLAY);
  };

  const completeCreate = (drag: Extract<DragState, { kind: 'create' }>) => {
    const rect = rectFromPoints(drag.start, drag.current);
    const isLine = drag.type === 'line';
    const dragged = isLine ? rect.w >= 4 : rect.w >= 4 && rect.h >= 4;
    const style = dragged
      ? {
          style: {
            width: Math.max(4, Math.round(rect.w)),
            height: isLine ? 1 : Math.max(4, Math.round(rect.h)),
          },
        }
      : undefined;
    const x = Math.round((dragged ? rect.x : drag.start.x) - drag.origin.x);
    const y = Math.round((dragged ? rect.y : drag.start.y) - drag.origin.y);
    const createdId = editorStore.addNode(drag.type, { x, y, parentId: drag.parentId }, style);
    editorStore.setTool('select');
    if (createdId && drag.type === 'image' && requestImageRef.current) requestImageRef.current(createdId);
    setOverlay(EMPTY_OVERLAY);
  };

  const finishDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    if (pendingRef.current) applyDragRef.current?.(drag, pendingRef.current);
    pendingRef.current = null;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    dragRef.current = null;
    switch (drag.kind) {
      case 'pan':
        break;
      case 'marquee':
        completeMarquee(drag);
        break;
      case 'create':
        completeCreate(drag);
        break;
      case 'move':
        if (drag.hasMoved) editorStore.endGesture('移动');
        else editorStore.abortGesture();
        setOverlay(EMPTY_OVERLAY);
        break;
      case 'resize':
        editorStore.endGesture('调整尺寸');
        setOverlay(EMPTY_OVERLAY);
        break;
      case 'rotate':
        editorStore.endGesture('旋转');
        setOverlay(EMPTY_OVERLAY);
        break;
      default:
        break;
    }
    setCursor(spaceRef.current ? 'grab' : 'default');
  };

  /* ---------------------------------------------------------------- 拖拽启动 */

  const startMarquee = (event: ReactPointerEvent, current: EditorSnapshot) => {
    const additive = event.shiftKey;
    if (!additive && current.selection.length > 0) editorStore.select([]);
    if (current.hoverId) editorStore.hover(null);
    const start = clientToBoard(event.clientX, event.clientY);
    dragRef.current = { kind: 'marquee', start, current: start, additive };
    setOverlay({ ...EMPTY_OVERLAY, marquee: { x: start.x, y: start.y, w: 0, h: 0 } });
  };

  const canMoveNode = (node: UINode, nodes: Record<string, UINode>): boolean => {
    if (!node.parentId) return true;
    const parent = nodes[node.parentId];
    return !parent || parent.style.layout === 'free';
  };

  const collectSnapData = (current: EditorSnapshot, excluded: Set<string>): SnapData => {
    const measured = measureAll();
    const nodes = current.project.nodes;
    const currentScreen = screenOf(current);
    const boardId = boardNodeIdOf(current);
    const xs: SnapLine[] = [];
    const ys: SnapLine[] = [];
    const siblings: Rect[] = [];

    const hasSelectedAncestor = (id: string): boolean => {
      let parent = nodes[id]?.parentId ?? null;
      while (parent) {
        if (excluded.has(parent)) return true;
        parent = nodes[parent]?.parentId ?? null;
      }
      return false;
    };

    measured.forEach((rect, id) => {
      if (excluded.has(id) || hasSelectedAncestor(id)) return;
      if (id === boardId) return;
      const node = nodes[id];
      if (!node || node.style.visible === false) return;
      xs.push({ pos: rect.x, rect }, { pos: rect.x + rect.w / 2, rect }, { pos: rect.x + rect.w, rect });
      ys.push({ pos: rect.y, rect }, { pos: rect.y + rect.h / 2, rect }, { pos: rect.y + rect.h, rect });
      siblings.push(rect);
    });

    if (currentScreen) {
      xs.push({ pos: 0, rect: null }, { pos: currentScreen.width / 2, rect: null }, { pos: currentScreen.width, rect: null });
      ys.push({ pos: 0, rect: null }, { pos: currentScreen.height / 2, rect: null }, { pos: currentScreen.height, rect: null });
    }
    return { xs, ys, siblings };
  };

  const startMove = (event: ReactPointerEvent) => {
    const current = editorStore.getSnapshot();
    const nodes = current.project.nodes;
    const boardId = boardNodeIdOf(current);
    const ids = topLevelIds(
      current.selection.filter((id) => id !== boardId && nodes[id] && !nodes[id].style.locked),
      nodes
    );
    const movable = ids.filter((id) => canMoveNode(nodes[id], nodes));
    if (!movable.length) {
      dragRef.current = null;
      return;
    }
    const measured = measureAll();
    const rects = ids
      .map((id) => measured.get(id) ?? fallbackRect(id, nodes))
      .filter((rect): rect is Rect => !!rect);
    const bbox = unionRects(rects);
    if (!bbox) {
      dragRef.current = null;
      return;
    }
    const base = movable.map((id) => ({ id, x: nodes[id].style.x, y: nodes[id].style.y }));
    const baseMap = new Map(base.map((item) => [item.id, { x: item.x, y: item.y }]));
    if (current.hoverId) editorStore.hover(null);
    editorStore.beginGesture();
    dragRef.current = {
      kind: 'move',
      startClient: { x: event.clientX, y: event.clientY },
      base,
      baseMap,
      bbox,
      snap: collectSnapData(current, new Set(ids)),
      hasMoved: false,
    };
    setCursor('default');
  };

  const startCreate = (event: ReactPointerEvent, current: EditorSnapshot, createTool: CreateTool) => {
    const start = clientToBoard(event.clientX, event.clientY);
    const parentInfo = resolveCreateParent(event.target, current);
    if (current.hoverId) editorStore.hover(null);
    dragRef.current = {
      kind: 'create',
      type: createTool as UINodeType,
      start,
      current: start,
      parentId: parentInfo.parentId,
      origin: parentInfo.origin,
    };
    setOverlay({ ...EMPTY_OVERLAY, create: { x: start.x, y: start.y, w: 0, h: 0 } });
    setCursor('crosshair');
  };

  const resolveCreateParent = (target: EventTarget | null, current: EditorSnapshot): { parentId: string | null; origin: Point } => {
    const element = (target as HTMLElement | null)?.closest?.('[data-node-id]') as HTMLElement | null;
    const fallback = { parentId: null as string | null, origin: { x: 0, y: 0 } };
    if (!element) return fallback;
    const id = element.dataset.nodeId;
    if (!id || id === boardNodeIdOf(current)) return fallback;
    const node = current.project.nodes[id];
    if (!node || node.type !== 'frame' || node.style.locked || node.style.layout !== 'free') return fallback;
    const root = rootRef.current;
    if (!root) return fallback;
    const base = root.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    return {
      parentId: id,
      origin: {
        x: (rect.left - base.left - current.pan.x) / current.zoom + element.clientLeft,
        y: (rect.top - base.top - current.pan.y) / current.zoom + element.clientTop,
      },
    };
  };

  const startResize = (event: ReactPointerEvent, dir: ResizeDir) => {
    event.stopPropagation();
    event.preventDefault();
    const current = editorStore.getSnapshot();
    const nodeId = current.selection[0];
    const node = nodeId ? current.project.nodes[nodeId] : null;
    if (!nodeId || !node) return;
    const root = rootRef.current;
    root?.focus({ preventScroll: true });
    beginPointerCapture(event);
    editorStore.beginGesture();
    dragRef.current = {
      kind: 'resize',
      id: nodeId,
      dir,
      startClient: { x: event.clientX, y: event.clientY },
      base: { x: node.style.x, y: node.style.y, w: node.style.width, h: node.style.height },
      ratio: node.style.height > 0 ? node.style.width / node.style.height : 1,
    };
  };

  const startRotate = (event: ReactPointerEvent) => {
    event.stopPropagation();
    event.preventDefault();
    const current = editorStore.getSnapshot();
    const nodeId = current.selection[0];
    const node = nodeId ? current.project.nodes[nodeId] : null;
    if (!nodeId || !node) return;
    const rect = measureNode(nodeId);
    if (!rect) return;
    const root = rootRef.current;
    root?.focus({ preventScroll: true });
    beginPointerCapture(event);
    editorStore.beginGesture();
    const center = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    dragRef.current = {
      kind: 'rotate',
      id: nodeId,
      center,
      startAngle: angleDeg(center, clientToBoard(event.clientX, event.clientY)),
      baseRotation: node.style.rotation,
    };
  };

  /* ---------------------------------------------------------------- 指针事件 */

  const updateHover = (target: EventTarget | null) => {
    const current = editorStore.getSnapshot();
    const hoverTarget =
      current.tool === 'select' && !spaceRef.current
        ? (() => {
            const id = hitNodeId(target);
            if (!id || id === boardNodeIdOf(current)) return null;
            return id;
          })()
        : null;
    if (current.hoverId !== hoverTarget) editorStore.hover(hoverTarget);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button === 2) return;
    const root = rootRef.current;
    if (!root) return;
    root.focus({ preventScroll: true });
    if (menuRef.current) setMenu(null);
    const current = editorStore.getSnapshot();
    const activeTool = current.tool;

    if (event.button === 1 || spaceRef.current || activeTool === 'hand') {
      beginPointerCapture(event);
      dragRef.current = { kind: 'pan', startClient: { x: event.clientX, y: event.clientY }, basePan: { ...current.pan } };
      setCursor('grabbing');
      event.preventDefault();
      return;
    }

    if (activeTool !== 'select') {
      beginPointerCapture(event);
      startCreate(event, current, activeTool as CreateTool);
      return;
    }

    const hitId = hitNodeId(event.target);
    const node = hitId ? current.project.nodes[hitId] : null;
    const isBoard = !!hitId && hitId === boardNodeIdOf(current);
    if (!hitId || !node || isBoard) {
      beginPointerCapture(event);
      startMarquee(event, current);
      return;
    }
    if (node.style.locked) {
      showHint(`「${node.name}」已锁定，右键可解锁`);
      beginPointerCapture(event);
      startMarquee(event, current);
      return;
    }

    if (event.shiftKey) {
      editorStore.toggleSelect(hitId, true);
      return;
    }

    if (event.altKey) {
      if (!current.selection.includes(hitId)) editorStore.select([hitId]);
      editorStore.duplicateSelection();
      beginPointerCapture(event);
      startMove(event);
      return;
    }

    if (!current.selection.includes(hitId)) editorStore.select([hitId]);
    beginPointerCapture(event);
    startMove(event);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) {
      updateHover(event.target);
      return;
    }
    pendingRef.current = { x: event.clientX, y: event.clientY, shift: event.shiftKey, alt: event.altKey };
    scheduleFlush();
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    pendingRef.current = { x: event.clientX, y: event.clientY, shift: event.shiftKey, alt: event.altKey };
    finishDragRef.current();
    releasePointerCapture(event);
  };

  finishDragRef.current = finishDrag;

  const onPointerLeave = () => {
    if (dragRef.current) return;
    const current = editorStore.getSnapshot();
    if (current.hoverId) editorStore.hover(null);
  };

  /* ---------------------------------------------------------------- 双击 / 右键 / 菜单 */

  const startInlineEdit = (nodeId: string) => {
    const current = editorStore.getSnapshot();
    const node = current.project.nodes[nodeId];
    if (!node) return;
    let kind: InlineEditState['kind'] | null = null;
    if (node.type === 'input' || node.type === 'textarea') {
      kind = node.value ? 'value' : 'placeholder';
    } else if (node.type === 'badge') {
      kind = 'label';
    } else if (node.type === 'text' || node.type === 'button') {
      kind = 'text';
    }
    if (!kind) return;
    const rect = measureNode(nodeId);
    if (!rect) return;
    const editKind = kind;
    const initial =
      editKind === 'text'
        ? node.text
        : editKind === 'placeholder'
          ? node.placeholder
          : editKind === 'value'
            ? node.value
            : node.label ?? node.text;
    setMenu(null);
    inlineCommittingRef.current = false;
    setInlineEdit({ id: nodeId, kind: editKind, rect, value: initial ?? '' });
  };

  const commitInlineEdit = () => {
    if (inlineCommittingRef.current) return;
    const edit = inlineEditRefState.current;
    if (!edit) return;
    inlineCommittingRef.current = true;
    const element = inlineEditRef.current;
    const raw = element ? element.textContent ?? '' : edit.value;
    setInlineEdit(null);
    if (raw === edit.value) return;
    if (edit.kind === 'text') editorStore.updateNode(edit.id, { text: raw }, true);
    else if (edit.kind === 'placeholder') editorStore.updateNode(edit.id, { placeholder: raw }, true);
    else if (edit.kind === 'value') editorStore.updateNode(edit.id, { value: raw }, true);
    else editorStore.updateNode(edit.id, { label: raw }, true);
  };

  const cancelInlineEdit = () => {
    inlineCommittingRef.current = false;
    setInlineEdit(null);
  };

  const onDoubleClick = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = editorStore.getSnapshot();
    if (current.tool !== 'select') return;
    const nodeId = hitNodeId(event.target);
    if (!nodeId || nodeId === boardNodeIdOf(current)) return;
    const node = current.project.nodes[nodeId];
    if (!node) return;
    if (node.type === 'image') {
      if (requestImageRef.current) requestImageRef.current(nodeId);
      return;
    }
    startInlineEdit(nodeId);
  };

  const openContextMenu = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (inlineEditRefState.current) return;
    event.preventDefault();
    event.stopPropagation();
    const current = editorStore.getSnapshot();
    const hitId = hitNodeId(event.target);
    const boardId = boardNodeIdOf(current);
    const isNode = !!hitId && hitId !== boardId && !!current.project.nodes[hitId];
    if (isNode && hitId) {
      if (!current.selection.includes(hitId)) editorStore.select([hitId]);
    }
    const root = rootRef.current;
    const rect = root?.getBoundingClientRect();
    const width = rect?.width ?? 480;
    const height = rect?.height ?? 480;
    const point = clientToContainer(event.clientX, event.clientY);
    const menuWidth = 188;
    const menuHeight = isNode ? 268 : 92;
    setMenu({
      x: Math.round(clamp(point.x, 8, Math.max(8, width - menuWidth - 8))),
      y: Math.round(clamp(point.y, 8, Math.max(8, height - menuHeight - 8))),
      nodeId: isNode ? hitId : null,
    });
  };

  const runMenuAction = (action: () => void) => {
    action();
    setMenu(null);
  };

  const selectAll = () => {
    const current = editorStore.getSnapshot();
    const boardId = boardNodeIdOf(current);
    const screenNow = screenOf(current);
    const board = boardId ? current.project.nodes[boardId] : null;
    const ids = board ? [...board.children] : screenNow ? [...screenNow.rootIds] : [];
    editorStore.select(ids.filter((id) => current.project.nodes[id] && !current.project.nodes[id].style.locked));
  };

  /* ---------------------------------------------------------------- 渲染辅助 */

  const toContainerBox = (rect: Rect): CSSProperties => ({
    left: pan.x + rect.x * zoom,
    top: pan.y + rect.y * zoom,
    width: rect.w * zoom,
    height: rect.h * zoom,
  });

  const handlePosition = (rect: Rect, dir: ResizeDir): Point => {
    const left = pan.x + rect.x * zoom;
    const top = pan.y + rect.y * zoom;
    const width = rect.w * zoom;
    const height = rect.h * zoom;
    const centerX = left + width / 2;
    const centerY = top + height / 2;
    switch (dir) {
      case 'nw':
        return { x: left, y: top };
      case 'n':
        return { x: centerX, y: top };
      case 'ne':
        return { x: left + width, y: top };
      case 'e':
        return { x: left + width, y: centerY };
      case 'se':
        return { x: left + width, y: top + height };
      case 's':
        return { x: centerX, y: top + height };
      case 'sw':
        return { x: left, y: top + height };
      case 'w':
      default:
        return { x: left, y: centerY };
    }
  };

  const gridSize = project.settings.gridSize ?? 8;
  const gridVisible = snapshot.gridVisible && gridSize * zoom >= 3;
  const gridStyle: CSSProperties | undefined = gridVisible
    ? {
        backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.11) 1px, transparent 1px)',
        backgroundSize: `${gridSize * zoom}px ${gridSize * zoom}px`,
        backgroundPosition: `${pan.x}px ${pan.y}px`,
      }
    : undefined;

  const inlineEditNode = inlineEdit ? project.nodes[inlineEdit.id] : null;
  let canvasCursor: CSSProperties['cursor'] = 'default';
  if (cursor === 'grabbing') canvasCursor = 'grabbing';
  else if (cursor === 'grab') canvasCursor = 'grab';
  else if (tool === 'hand') canvasCursor = 'grab';
  else if (tool !== 'select') canvasCursor = 'crosshair';

  const singleSpan = selSpans.length === 1 ? selSpans[0] : null;
  const showHandles = !!singleSpan && !singleSpan.locked && !inlineEdit && tool === 'select';
  const rulerTopTicks = buildTicks(pan.x, zoom, size.w);
  const rulerLeftTicks = buildTicks(pan.y, zoom, size.h);

  /* ---------------------------------------------------------------- JSX */

  return (
    <div
      ref={rootRef}
      className="uc-canvas"
      tabIndex={-1}
      style={{ cursor: canvasCursor }}
      data-tool={tool}
      data-hover-id={hoverId ?? ''}
      data-selection={selectionKey}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerLeave}
      onDoubleClick={onDoubleClick}
      onContextMenu={openContextMenu}
    >
      {gridVisible ? <div className="uc-grid" style={gridStyle} /> : null}

      <div className="uc-viewport" style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})` }}>
        {screen ? (
          <div
            className="uc-board"
            style={{ width: screen.width, height: screen.height, background: screen.background }}
          >
            {(screen.rootIds ?? []).map((rootId) => {
              const node = project.nodes[rootId];
              return node ? <NodeView key={rootId} node={node} /> : null;
            })}
          </div>
        ) : null}
      </div>

      {screen ? (
        <div className="uc-board-label" style={{ left: pan.x, top: pan.y - 21 }}>
          <b>{screen.name}</b>
          <span>
            {screen.width} × {screen.height}
          </span>
        </div>
      ) : null}

      <div className="uc-overlay">
        {selSpans.map((span) => (
          <div
            key={span.id}
            className={`uc-sel${span.locked ? ' uc-sel--locked' : ''}`}
            style={toContainerBox(span.rect)}
          />
        ))}

        {hoverRect ? <div className="uc-hover" style={toContainerBox(hoverRect)} /> : null}

        {showHandles && singleSpan ? (
          <Fragment>
            {RESIZE_DIRS.map((dir) => {
              const point = handlePosition(singleSpan.rect, dir);
              return (
                <div
                  key={dir}
                  className={`uc-handle uc-handle--${dir}`}
                  style={{ left: point.x, top: point.y }}
                  onPointerDown={(event) => startResize(event, dir)}
                />
              );
            })}
            {(() => {
              const left = pan.x + singleSpan.rect.x * zoom;
              const top = pan.y + singleSpan.rect.y * zoom;
              const width = singleSpan.rect.w * zoom;
              const bottom = pan.y + (singleSpan.rect.y + singleSpan.rect.h) * zoom;
              return (
                <Fragment>
                  <div
                    className="uc-rotate-stem"
                    style={{ left: left + width / 2, top: top - 22 }}
                  />
                  <div
                    className="uc-rotate-handle"
                    style={{ left: left + width / 2, top: top - 24 }}
                    title="旋转（按住 Alt 可自由旋转，默认 15° 吸附）"
                    onPointerDown={startRotate}
                  />
                  <div
                    className="uc-sel-label"
                    style={{ left: left + width / 2, top: bottom + 7 }}
                    title={`位置 ${Math.round(singleSpan.rect.x)}, ${Math.round(singleSpan.rect.y)}`}
                  >
                    {singleSpan.rect.w >= 1 ? `${Math.round(singleSpan.rect.w)} × ${Math.round(singleSpan.rect.h)}` : ''}
                  </div>
                </Fragment>
              );
            })()}
          </Fragment>
        ) : null}

        {overlay.guides.map((guide, index) =>
          guide.axis === 'v' ? (
            <div key={`g-${index}-v`} className="uc-guide uc-guide--v" style={{ left: pan.x + guide.pos * zoom }} />
          ) : (
            <div key={`g-${index}-h`} className="uc-guide uc-guide--h" style={{ top: pan.y + guide.pos * zoom }} />
          )
        )}

        {overlay.measures.map((measure, index) => {
          if (measure.axis === 'h') {
            const left = pan.x + Math.min(measure.from, measure.to) * zoom;
            const width = Math.abs(measure.to - measure.from) * zoom;
            const top = pan.y + measure.at * zoom;
            return (
              <Fragment key={`m-${index}`}>
                <div className="uc-measure uc-measure--h" style={{ left, width: Math.max(1, width), top }} />
                <div className="uc-measure-label" style={{ left: left + width / 2, top }}>{measure.label}</div>
              </Fragment>
            );
          }
          const top = pan.y + Math.min(measure.from, measure.to) * zoom;
          const height = Math.abs(measure.to - measure.from) * zoom;
          const left = pan.x + measure.at * zoom;
          return (
            <Fragment key={`m-${index}`}>
              <div className="uc-measure uc-measure--v" style={{ top, height: Math.max(1, height), left }} />
              <div className="uc-measure-label" style={{ left, top: top + height / 2 }}>{measure.label}</div>
            </Fragment>
          );
        })}

        {overlay.marquee ? <div className="uc-marquee" style={toContainerBox(overlay.marquee)} /> : null}

        {overlay.create ? (
          <div className="uc-create-rect" style={toContainerBox(overlay.create)}>
            <span className="uc-create-hint">
              {Math.round(overlay.create.w)} × {Math.round(overlay.create.h)}
            </span>
          </div>
        ) : null}
      </div>

      {inlineEdit && inlineEditNode ? (
        <div
          className="uc-edit-layer"
          style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})` }}
        >
          <div
            ref={inlineEditRef}
            className="uc-inline-edit"
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            style={{
              left: inlineEdit.rect.x,
              top: inlineEdit.rect.y,
              width: Math.max(24, inlineEdit.rect.w),
              minHeight: Math.max(16, inlineEdit.rect.h),
              display: 'flex',
              alignItems: 'center',
              color: inlineEditNode.style.color,
              fontFamily: inlineEditNode.style.fontFamily,
              fontSize: `${inlineEditNode.style.fontSize}px`,
              fontWeight: inlineEditNode.style.fontWeight,
              lineHeight: inlineEditNode.style.lineHeight,
              letterSpacing: `${inlineEditNode.style.letterSpacing}px`,
              textAlign: inlineEditNode.style.textAlign,
              textTransform: inlineEditNode.style.textTransform === 'none' ? undefined : inlineEditNode.style.textTransform,
              textDecoration: inlineEditNode.style.textDecoration === 'none' ? undefined : inlineEditNode.style.textDecoration,
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                cancelInlineEdit();
                return;
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                event.stopPropagation();
                commitInlineEdit();
              }
            }}
            onBlur={() => commitInlineEdit()}
          >
            {inlineEdit.value}
          </div>
        </div>
      ) : null}

      {project.settings.showRulers && size.w > 0 && size.h > 0 ? (
        <div className="uc-rulers">
          <div className="uc-ruler uc-ruler-top">
            {rulerTopTicks.map((tick) => (
              <div key={`tx-${tick.coord}`} className="uc-tick" style={{ left: tick.pos }}>
                <span>{tick.coord}</span>
              </div>
            ))}
          </div>
          <div className="uc-ruler uc-ruler-left">
            {rulerLeftTicks.map((tick) => (
              <div key={`ty-${tick.coord}`} className="uc-tick" style={{ top: tick.pos }}>
                <span>{tick.coord}</span>
              </div>
            ))}
          </div>
          <div className="uc-ruler-corner" />
        </div>
      ) : null}

      <div className="uc-zoom" onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" className="uc-zoom-btn" title="缩小" onClick={() => zoomAtCenter(1 / 1.25)}>
          −
        </button>
        <button type="button" className="uc-zoom-btn uc-zoom-value" title="缩放到 100%（Ctrl+1）" onClick={zoomTo100}>
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" className="uc-zoom-btn" title="放大" onClick={() => zoomAtCenter(1.25)}>
          +
        </button>
        <span className="uc-zoom-sep" />
        <button type="button" className="uc-zoom-btn" title="适配屏幕（Ctrl+0）" onClick={fitToScreen}>
          适配
        </button>
      </div>

      {menu ? (
        <div
          className="uc-menu"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {menu.nodeId && project.nodes[menu.nodeId] ? (
            (() => {
              const node = project.nodes[menu.nodeId as string];
              return (
                <Fragment>
                  <div className="uc-menu-item" onClick={() => runMenuAction(() => editorStore.duplicateSelection())}>
                    复制
                    <kbd>Ctrl+D</kbd>
                  </div>
                  <div className="uc-menu-item is-danger" onClick={() => runMenuAction(() => editorStore.deleteSelection())}>
                    删除
                    <kbd>Del</kbd>
                  </div>
                  <div className="uc-menu-sep" />
                  <div className="uc-menu-item" onClick={() => runMenuAction(() => editorStore.reorderNode(node.id, 'front'))}>
                    置顶
                  </div>
                  <div className="uc-menu-item" onClick={() => runMenuAction(() => editorStore.reorderNode(node.id, 'back'))}>
                    置底
                  </div>
                  <div className="uc-menu-sep" />
                  <div className="uc-menu-item" onClick={() => runMenuAction(() => editorStore.updateStyle(node.id, { visible: false }))}>
                    隐藏
                  </div>
                  <div
                    className="uc-menu-item"
                    onClick={() => runMenuAction(() => editorStore.updateStyle(node.id, { locked: !node.style.locked }))}
                  >
                    {node.style.locked ? '解锁' : '锁定'}
                  </div>
                </Fragment>
              );
            })()
          ) : (
            <Fragment>
              <div className="uc-menu-item" onClick={() => runMenuAction(() => editorStore.paste())}>
                粘贴
                <kbd>Ctrl+V</kbd>
              </div>
              <div className="uc-menu-item" onClick={() => runMenuAction(selectAll)}>
                全选
                <kbd>Ctrl+A</kbd>
              </div>
            </Fragment>
          )}
        </div>
      ) : null}

      {inlineEdit && !inlineEditNode ? <div className="uc-inline-hint">节点已不存在</div> : null}

      {hint ? <div className="uc-hint">{hint}</div> : null}
    </div>
  );
}

export default CanvasStage;
