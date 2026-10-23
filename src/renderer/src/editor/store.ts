/**
 * UI 编辑器状态仓库
 *
 * - 单一可变 project 快照 + 不可变快照对外暴露（useSyncExternalStore）；
 * - 每次结构/属性变更命令式提交历史，拖拽期间用 beginGesture/endGesture 合并为一步；
 * - 选择、悬浮、工具、缩放、平移、模式属于视图状态，不进历史。
 */
import { useSyncExternalStore } from 'react';
import type {
  UINode,
  UINodeStateKey,
  UINodeStyle,
  UIProject,
  UIScreen,
  UIEditorTool,
  UIInteraction,
} from '@shared/uieditor';
import {
  createNode,
  type CreateNodePatch,
  createProject,
  createScreen,
  ensureScreenRoot,
  insertNodes,
  newId,
  screenNodeIds,
  structuredCloneSafe,
  touchProject,
} from '@shared/uieditor-kit';

export type EditorMode = 'design' | 'prototype' | 'preview';
export type LeftTab = 'layers' | 'components' | 'templates' | 'screens' | 'assets';
export type RightTab = 'inspector' | 'tokens' | 'interactions';

export interface EditorSnapshot {
  project: UIProject;
  activeScreenId: string;
  selection: string[];
  hoverId: string | null;
  tool: UIEditorTool;
  mode: EditorMode;
  zoom: number;
  pan: { x: number; y: number };
  leftTab: LeftTab;
  rightTab: RightTab;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  historyLabel: string | null;
  previewScreenId: string | null;
  gridVisible: boolean;
  snapToGrid: boolean;
  snapToGuides: boolean;
  /** 编辑器扩展：外部注册的组件包版本号 */
  extensionVersion: number;
}

export interface EditorActions {
  init(project: UIProject): void;
  getProject(): UIProject;
  getActiveScreen(): UIScreen | null;
  getNode(id: string | null | undefined): UINode | null;
  subscribe(listener: () => void): () => void;
  getSnapshot(): EditorSnapshot;

  select(ids: string[]): void;
  toggleSelect(id: string, additive: boolean): void;
  hover(id: string | null): void;
  setTool(tool: UIEditorTool): void;
  setMode(mode: EditorMode): void;
  setZoom(zoom: number, anchor?: { x: number; y: number }): void;
  panBy(dx: number, dy: number): void;
  setPan(pan: { x: number; y: number }): void;
  setLeftTab(tab: LeftTab): void;
  setRightTab(tab: RightTab): void;
  setPreviewScreen(screenId: string | null): void;

  beginGesture(): void;
  endGesture(label?: string): void;
  abortGesture(): void;
  undo(): void;
  redo(): void;

  updateNode(id: string, patch: Partial<UINode> | ((node: UINode) => void), history?: boolean): void;
  updateStyle(id: string, patch: Partial<UINodeStyle>, history?: boolean): void;
  updateNodes(ids: string[], updater: (node: UINode) => void, history?: boolean): void;
  renameNode(id: string, name: string): void;

  addNode(type: UINode['type'], at?: { x: number; y: number; parentId?: string | null }, preset?: CreateNodePatch): string | null;
  insertNodes(nodes: UINode[], parentId?: string | null, offset?: { x: number; y: number }): string | null;
  deleteSelection(): void;
  duplicateSelection(): void;
  copySelection(): void;
  paste(): void;
  groupSelection(): void;
  ungroupSelection(): void;
  reorderNode(id: string, direction: 'front' | 'back' | 'forward' | 'backward'): void;
  moveSelectionBy(dx: number, dy: number, history?: boolean): void;
  resizeNode(id: string, rect: { x: number; y: number; width: number; height: number }, history?: boolean): void;
  alignSelection(kind: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'): void;
  distributeSelection(axis: 'horizontal' | 'vertical'): void;
  setNodeState(id: string, state: UINodeStateKey, patch: Partial<UINodeStyle> | null): void;
  setInteraction(id: string, interaction: UIInteraction | null): void;

  setProjectName(name: string): void;
  setProjectDescription(description: string): void;
  setProjectSettings(patch: Partial<UIProject['settings']>): void;
  addScreen(name?: string, width?: number, height?: number, background?: string): string;
  renameScreen(id: string, name: string): void;
  deleteScreen(id: string): void;
  duplicateScreen(id: string): void;
  setActiveScreen(id: string): void;
  setScreenSize(id: string, width: number, height: number): void;
  setScreenBackground(id: string, background: string): void;

  setTokens(tokens: UIProject['tokens']): void;
  markSaved(): void;
  replaceProject(project: UIProject): void;
  notifyExtensions(): void;
}

interface EditorState {
  project: UIProject;
  activeScreenId: string;
  selection: string[];
  hoverId: string | null;
  tool: UIEditorTool;
  mode: EditorMode;
  zoom: number;
  pan: { x: number; y: number };
  leftTab: LeftTab;
  rightTab: RightTab;
  dirty: boolean;
  previewScreenId: string | null;
  extensionVersion: number;
}

const HISTORY_LIMIT = 80;

class EditorStore implements EditorActions {
  private state: EditorState = {
    project: createProject(),
    activeScreenId: '',
    selection: [],
    hoverId: null,
    tool: 'select',
    mode: 'design',
    zoom: 1,
    pan: { x: 0, y: 0 },
    leftTab: 'layers',
    rightTab: 'inspector',
    dirty: false,
    previewScreenId: null,
    extensionVersion: 0,
  };
  private listeners = new Set<() => void>();
  private snapshot: EditorSnapshot;
  private past: UIProject[] = [];
  private future: UIProject[] = [];
  private lastLabel: string | null = null;
  private gesture: UIProject | null = null;
  private clipboard: UINode[] | null = null;
  private clipboardScreenId: string | null = null;

  constructor() {
    this.resetProject(createProject(), true);
    this.snapshot = this.buildSnapshot();
  }

  private resetProject(project: UIProject, first = false) {
    const screen = project.screens[0];
    this.state.project = project;
    this.state.activeScreenId = screen?.id ?? '';
    this.state.selection = [];
    this.state.dirty = false;
    this.state.previewScreenId = null;
    if (first) {
      this.state.extensionVersion = 0;
    }
    this.past = [];
    this.future = [];
    this.lastLabel = null;
  }

  private buildSnapshot(): EditorSnapshot {
    return {
      ...this.state,
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
      historyLabel: this.lastLabel,
      gridVisible: this.state.project.settings.showGrid,
      snapToGrid: this.state.project.settings.snapToGrid,
      snapToGuides: this.state.project.settings.snapToGuides,
    };
  }

  private emit() {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }

  private cloneProject(): UIProject {
    return structuredCloneSafe(this.state.project);
  }

  private pushHistory(label: string | null) {
    this.past.push(this.cloneProject());
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
    this.lastLabel = label;
  }

  /* ------------------------------------------------------------ 基础 */

  init(project: UIProject) {
    this.resetProject(structuredCloneSafe(project), true);
    this.emit();
  }

  getProject() {
    return this.state.project;
  }

  getActiveScreen() {
    return this.state.project.screens.find((screen) => screen.id === this.state.activeScreenId) ?? null;
  }

  getNode(id: string | null | undefined) {
    return id ? this.state.project.nodes[id] ?? null : null;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): EditorSnapshot => this.snapshot;

  select(ids: string[]) {
    this.state.selection = [...new Set(ids)].filter((id) => !!this.state.project.nodes[id]);
    this.emit();
  }

  toggleSelect(id: string, additive: boolean) {
    if (!additive) {
      this.state.selection = [id];
    } else {
      const index = this.state.selection.indexOf(id);
      if (index >= 0) this.state.selection.splice(index, 1);
      else this.state.selection.push(id);
    }
    this.emit();
  }

  hover(id: string | null) {
    if (this.state.hoverId === id) return;
    this.state.hoverId = id;
    this.emit();
  }

  setTool(tool: UIEditorTool) {
    this.state.tool = tool;
    this.emit();
  }

  setMode(mode: EditorMode) {
    this.state.mode = mode;
    this.emit();
  }

  setZoom(zoom: number, _anchor?: { x: number; y: number }) {
    this.state.zoom = Math.min(4, Math.max(0.1, Math.round(zoom * 100) / 100));
    this.emit();
  }

  panBy(dx: number, dy: number) {
    this.state.pan = { x: this.state.pan.x + dx, y: this.state.pan.y + dy };
    this.emit();
  }

  setPan(pan: { x: number; y: number }) {
    this.state.pan = pan;
    this.emit();
  }

  setLeftTab(tab: LeftTab) {
    this.state.leftTab = tab;
    this.emit();
  }

  setRightTab(tab: RightTab) {
    this.state.rightTab = tab;
    this.emit();
  }

  setPreviewScreen(screenId: string | null) {
    this.state.previewScreenId = screenId;
    this.emit();
  }

  /* ------------------------------------------------------------ 历史 */

  beginGesture() {
    if (this.gesture) return;
    this.gesture = this.cloneProject();
  }

  endGesture(label = '编辑') {
    if (!this.gesture) return;
    this.past.push(this.gesture);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
    this.lastLabel = label;
    this.gesture = null;
    this.state.dirty = true;
    touchProject(this.state.project);
    this.emit();
  }

  abortGesture() {
    if (!this.gesture) return;
    this.state.project = this.gesture;
    this.gesture = null;
    this.emit();
  }

  undo() {
    const previous = this.past.pop();
    if (!previous) return;
    this.future.push(this.cloneProject());
    this.state.project = previous;
    this.state.selection = this.state.selection.filter((id) => !!previous.nodes[id]);
    this.state.dirty = true;
    this.emit();
  }

  redo() {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.cloneProject());
    this.state.project = next;
    this.state.selection = this.state.selection.filter((id) => !!next.nodes[id]);
    this.state.dirty = true;
    this.emit();
  }

  /* ------------------------------------------------------------ 节点编辑 */

  private mutate(fn: (project: UIProject) => void, history = true, label = '编辑') {
    if (history) this.pushHistory(label);
    fn(this.state.project);
    touchProject(this.state.project);
    this.state.dirty = true;
    this.emit();
  }

  updateNode(id: string, patch: Partial<UINode> | ((node: UINode) => void), history = true) {
    const node = this.state.project.nodes[id];
    if (!node) return;
    const apply = () => {
      if (typeof patch === 'function') patch(node);
      else {
        const { style, ...rest } = patch;
        Object.assign(node, rest);
        if (style) node.style = { ...node.style, ...style };
      }
    };
    if (history) this.mutate(apply, true, '修改节点');
    else {
      apply();
      this.state.dirty = true;
      touchProject(this.state.project);
      this.emit();
    }
  }

  updateStyle(id: string, patch: Partial<UINodeStyle>, history = true) {
    const node = this.state.project.nodes[id];
    if (!node) return;
    const apply = () => {
      node.style = { ...node.style, ...patch, radius: patch.radius ? ([...patch.radius] as [number, number, number, number]) : node.style.radius };
    };
    if (history) this.mutate(apply, true, '调整样式');
    else {
      apply();
      this.state.dirty = true;
      touchProject(this.state.project);
      this.emit();
    }
  }

  updateNodes(ids: string[], updater: (node: UINode) => void, history = true) {
    const apply = () => {
      for (const id of ids) {
        const node = this.state.project.nodes[id];
        if (node) updater(node);
      }
    };
    if (history) this.mutate(apply, true, '批量修改');
    else {
      apply();
      this.state.dirty = true;
      touchProject(this.state.project);
      this.emit();
    }
  }

  renameNode(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.mutate(() => {
      const node = this.state.project.nodes[id];
      if (node) node.name = trimmed;
    }, true, '重命名');
  }

  setNodeState(id: string, state: UINodeStateKey, patch: Partial<UINodeStyle> | null) {
    this.mutate(() => {
      const node = this.state.project.nodes[id];
      if (!node) return;
      if (!patch) {
        if (node.states) delete node.states[state];
      } else {
        node.states = node.states ?? {};
        node.states[state] = { ...(node.states[state] ?? {}), ...patch };
      }
    }, true, '状态样式');
  }

  setInteraction(id: string, interaction: UIInteraction | null) {
    this.mutate(() => {
      const node = this.state.project.nodes[id];
      if (!node) return;
      if (!interaction || interaction.action === 'none') delete node.interaction;
      else node.interaction = interaction;
    }, true, '交互');
  }

  /* ------------------------------------------------------------ 结构操作 */

  private placeNewNode(type: UINode['type'], at?: { x: number; y: number; parentId?: string | null }, preset?: CreateNodePatch) {
    const screen = this.getActiveScreen();
    if (!screen) return null;
    const parentId = at?.parentId ?? null;
    const node = createNode(type, {
      ...preset,
      style: { ...(preset?.style ?? {}) },
    });
    if (at) {
      node.style.x = at.x;
      node.style.y = at.y;
    }
    const inserted = insertNodes(this.state.project, screen.id, [node], parentId);
    this.state.selection = [inserted.rootId];
    return inserted.rootId;
  }

  addNode(type: UINode['type'], at?: { x: number; y: number; parentId?: string | null }, preset?: CreateNodePatch) {
    let created: string | null = null;
    this.mutate(() => {
      created = this.placeNewNode(type, at, preset);
    }, true, '添加节点');
    if (created) this.state.selection = [created];
    this.emit();
    return created;
  }

  insertNodes(nodes: UINode[], parentId?: string | null, offset?: { x: number; y: number }) {
    const screen = this.getActiveScreen();
    if (!screen || !nodes.length) return null;
    let rootId: string | null = null;
    this.mutate(() => {
      const inserted = insertNodes(this.state.project, screen.id, structuredCloneSafe(nodes), parentId ?? null, offset);
      rootId = inserted.rootId;
      this.state.selection = [inserted.rootId];
    }, true, '插入组件');
    this.emit();
    return rootId;
  }

  deleteSelection() {
    const ids = this.state.selection.filter((id) => id !== this.getScreenRootId());
    if (!ids.length) return;
    this.mutate(() => {
      for (const id of ids) this.removeSubtree(id);
      this.state.selection = [];
    }, true, '删除');
    this.emit();
  }

  private getScreenRootId(): string | null {
    const screen = this.getActiveScreen();
    return screen?.rootIds[0] ?? null;
  }

  private removeSubtree(id: string) {
    const node = this.state.project.nodes[id];
    if (!node) return;
    for (const child of [...node.children]) this.removeSubtree(child);
    if (node.parentId) {
      const parent = this.state.project.nodes[node.parentId];
      if (parent) parent.children = parent.children.filter((child) => child !== id);
    } else {
      const screen = this.getActiveScreen();
      if (screen) screen.rootIds = screen.rootIds.filter((root) => root !== id);
    }
    delete this.state.project.nodes[id];
  }

  private collectSubtreeIds(id: string): string[] {
    const ids: string[] = [];
    const visit = (nodeId: string) => {
      const node = this.state.project.nodes[nodeId];
      if (!node) return;
      ids.push(nodeId);
      for (const child of node.children) visit(child);
    };
    visit(id);
    return ids;
  }

  copySelection() {
    const ids = this.state.selection.filter((id) => id !== this.getScreenRootId());
    const nodes: UINode[] = [];
    for (const id of ids) {
      for (const nodeId of this.collectSubtreeIds(id)) {
        const node = this.state.project.nodes[nodeId];
        if (node) nodes.push(structuredCloneSafe(node));
      }
    }
    this.clipboard = nodes;
    this.clipboardScreenId = this.state.activeScreenId;
  }

  paste() {
    if (!this.clipboard?.length) return;
    const nodes = this.clipboard.map((node) => structuredCloneSafe(node));
    const roots = nodes.filter((node) => !node.parentId || !nodes.some((item) => item.id === node.parentId));
    const screenId = this.state.activeScreenId;
    this.mutate(() => {
      // 只插入根节点，子节点由 insertNodes 的 id 映射一并复制
      const inserted = insertNodes(this.state.project, screenId, nodes, null, { x: 24, y: 24 });
      this.state.selection = [inserted.rootId];
    }, true, '粘贴');
    this.emit();
  }

  duplicateSelection() {
    const ids = this.state.selection.filter((id) => id !== this.getScreenRootId());
    if (!ids.length) return;
    const screen = this.getActiveScreen();
    if (!screen) return;
    const nodes: UINode[] = [];
    for (const id of ids) {
      const collected = this.collectSubtreeIds(id);
      for (const nodeId of collected) nodes.push(structuredCloneSafe(this.state.project.nodes[nodeId]));
    }
    this.mutate(() => {
      const inserted = insertNodes(this.state.project, screen.id, nodes, null, { x: 20, y: 20 });
      this.state.selection = [inserted.rootId];
    }, true, '复制');
    this.emit();
  }

  groupSelection() {
    const ids = this.state.selection.filter((id) => id !== this.getScreenRootId());
    if (ids.length < 2) return;
    const nodes = ids.map((id) => this.state.project.nodes[id]).filter(Boolean);
    const parentId = nodes[0].parentId;
    if (!parentId || nodes.some((node) => node.parentId !== parentId)) return;
    const parent = this.state.project.nodes[parentId];
    if (!parent) return;
    const minX = Math.min(...nodes.map((node) => node.style.x));
    const minY = Math.min(...nodes.map((node) => node.style.y));
    const maxX = Math.max(...nodes.map((node) => node.style.x + node.style.width));
    const maxY = Math.max(...nodes.map((node) => node.style.y + node.style.height));
    this.mutate(() => {
      const group = createNode('frame', {
        name: '分组',
        style: {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
          fill: 'rgba(0,0,0,0)',
          stroke: 'rgba(255,255,255,0.04)',
          radius: [8, 8, 8, 8],
        },
      });
      group.parentId = parentId;
      this.state.project.nodes[group.id] = group;
      for (const node of nodes) {
        parent.children = parent.children.filter((child) => child !== node.id);
        node.parentId = group.id;
        node.style.x -= minX;
        node.style.y -= minY;
        group.children.push(node.id);
      }
      parent.children.push(group.id);
      this.state.selection = [group.id];
    }, true, '分组');
    this.emit();
  }

  ungroupSelection() {
    const groups = this.state.selection.map((id) => this.state.project.nodes[id]).filter((node) => node && node.type === 'frame' && node.children.length > 0);
    if (!groups.length) return;
    this.mutate(() => {
      const newSelection: string[] = [];
      for (const group of groups) {
        if (!group.parentId) continue;
        const parent = this.state.project.nodes[group.parentId];
        if (!parent) continue;
        const index = parent.children.indexOf(group.id);
        const children = [...group.children];
        parent.children.splice(index, 1, ...children);
        for (const childId of children) {
          const child = this.state.project.nodes[childId];
          if (!child) continue;
          child.parentId = group.parentId;
          child.style.x += group.style.x;
          child.style.y += group.style.y;
          newSelection.push(childId);
        }
        delete this.state.project.nodes[group.id];
      }
      this.state.selection = newSelection;
    }, true, '取消分组');
    this.emit();
  }

  reorderNode(id: string, direction: 'front' | 'back' | 'forward' | 'backward') {
    const node = this.state.project.nodes[id];
    if (!node) return;
    this.mutate(() => {
      if (node.parentId) {
        const parent = this.state.project.nodes[node.parentId];
        if (!parent) return;
        const index = parent.children.indexOf(id);
        if (index < 0) return;
        parent.children.splice(index, 1);
        if (direction === 'front') parent.children.push(id);
        else if (direction === 'back') parent.children.unshift(id);
        else if (direction === 'forward') parent.children.splice(Math.min(parent.children.length, index + 1), 0, id);
        else parent.children.splice(Math.max(0, index - 1), 0, id);
      } else {
        const screen = this.getActiveScreen();
        if (!screen) return;
        const index = screen.rootIds.indexOf(id);
        if (index < 0) return;
        screen.rootIds.splice(index, 1);
        if (direction === 'front') screen.rootIds.push(id);
        else if (direction === 'back') screen.rootIds.unshift(id);
        else if (direction === 'forward') screen.rootIds.splice(Math.min(screen.rootIds.length, index + 1), 0, id);
        else screen.rootIds.splice(Math.max(0, index - 1), 0, id);
      }
    }, true, '调整层级');
  }

  moveSelectionBy(dx: number, dy: number, history = false) {
    const ids = this.state.selection.filter((id) => id !== this.getScreenRootId());
    if (!ids.length) return;
    const apply = () => {
      for (const id of ids) {
        const node = this.state.project.nodes[id];
        if (!node) continue;
        node.style.x += dx;
        node.style.y += dy;
      }
    };
    if (history) this.mutate(apply, true, '移动');
    else {
      apply();
      this.state.dirty = true;
      touchProject(this.state.project);
      this.emit();
    }
  }

  resizeNode(id: string, rect: { x: number; y: number; width: number; height: number }, history = false) {
    const node = this.state.project.nodes[id];
    if (!node) return;
    const apply = () => {
      node.style.x = rect.x;
      node.style.y = rect.y;
      node.style.width = Math.max(1, rect.width);
      node.style.height = Math.max(1, rect.height);
    };
    if (history) this.mutate(apply, true, '调整尺寸');
    else {
      apply();
      this.state.dirty = true;
      this.emit();
    }
  }

  /* ------------------------------------------------------------ 对齐 / 分布 */

  private absoluteRect(id: string) {
    const project = this.state.project;
    let x = 0;
    let y = 0;
    let node: UINode | undefined = project.nodes[id];
    const width = node?.style.width ?? 0;
    const height = node?.style.height ?? 0;
    while (node) {
      x += node.style.x;
      y += node.style.y;
      if (!node.parentId) break;
      node = project.nodes[node.parentId];
    }
    return { x, y, width, height };
  }

  alignSelection(kind: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') {
    const ids = this.state.selection.filter((id) => id !== this.getScreenRootId());
    if (ids.length < 1) return;
    const rects = ids.map((id) => ({ id, rect: this.absoluteRect(id) }));
    const left = Math.min(...rects.map((item) => item.rect.x));
    const right = Math.max(...rects.map((item) => item.rect.x + item.rect.width));
    const top = Math.min(...rects.map((item) => item.rect.y));
    const bottom = Math.max(...rects.map((item) => item.rect.y + item.rect.height));
    this.mutate(() => {
      for (const { id, rect } of rects) {
        const node = this.state.project.nodes[id];
        if (!node) continue;
        let targetX = rect.x;
        let targetY = rect.y;
        if (kind === 'left') targetX = left;
        else if (kind === 'right') targetX = right - rect.width;
        else if (kind === 'hcenter') targetX = (left + right) / 2 - rect.width / 2;
        else if (kind === 'top') targetY = top;
        else if (kind === 'bottom') targetY = bottom - rect.height;
        else if (kind === 'vcenter') targetY = (top + bottom) / 2 - rect.height / 2;
        node.style.x += targetX - rect.x;
        node.style.y += targetY - rect.y;
      }
    }, true, '对齐');
    this.emit();
  }

  distributeSelection(axis: 'horizontal' | 'vertical') {
    const ids = this.state.selection.filter((id) => id !== this.getScreenRootId());
    if (ids.length < 3) return;
    const items = ids.map((id) => ({ id, rect: this.absoluteRect(id) })).sort((a, b) =>
      axis === 'horizontal' ? a.rect.x - b.rect.x : a.rect.y - b.rect.y
    );
    const start = axis === 'horizontal' ? Math.min(...items.map((item) => item.rect.x)) : Math.min(...items.map((item) => item.rect.y));
    const end = axis === 'horizontal'
      ? Math.max(...items.map((item) => item.rect.x + item.rect.width))
      : Math.max(...items.map((item) => item.rect.y + item.rect.height));
    const total = items.reduce((sum, item) => sum + (axis === 'horizontal' ? item.rect.width : item.rect.height), 0);
    const gap = (end - start - total) / (items.length - 1);
    this.mutate(() => {
      let cursor = start;
      for (const item of items) {
        const node = this.state.project.nodes[item.id];
        if (!node) continue;
        if (axis === 'horizontal') {
          node.style.x += cursor - item.rect.x;
          cursor += item.rect.width + gap;
        } else {
          node.style.y += cursor - item.rect.y;
          cursor += item.rect.height + gap;
        }
      }
    }, true, '分布');
    this.emit();
  }

  /* ------------------------------------------------------------ 工程 / 屏幕 */

  setProjectName(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.mutate(() => {
      this.state.project.name = trimmed;
    }, false);
    this.emit();
  }

  setProjectDescription(description: string) {
    this.mutate(() => {
      this.state.project.description = description;
    }, false);
    this.emit();
  }

  setProjectSettings(patch: Partial<UIProject['settings']>) {
    this.mutate(() => {
      this.state.project.settings = { ...this.state.project.settings, ...patch };
    }, false);
    this.emit();
  }

  addScreen(name = '新页面', width?: number, height?: number, background = '#07090F') {
    const current = this.getActiveScreen();
    this.pushHistory('新增页面');
    const screen = createScreen(this.state.project, name, width ?? current?.width ?? 960, height ?? current?.height ?? 640, background);
    ensureScreenRoot(this.state.project, screen.id);
    this.state.activeScreenId = screen.id;
    this.state.selection = [];
    this.state.dirty = true;
    touchProject(this.state.project);
    this.emit();
    return screen.id;
  }

  renameScreen(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const screen = this.state.project.screens.find((item) => item.id === id);
    if (!screen) return;
    this.mutate(() => {
      screen.name = trimmed;
    }, false);
    this.emit();
  }

  deleteScreen(id: string) {
    if (this.state.project.screens.length <= 1) return;
    const screen = this.state.project.screens.find((item) => item.id === id);
    if (!screen) return;
    this.mutate(() => {
      const visit = (nodeId: string) => {
        const node = this.state.project.nodes[nodeId];
        if (!node) return;
        for (const child of [...node.children]) visit(child);
        delete this.state.project.nodes[nodeId];
      };
      for (const rootId of screen.rootIds) visit(rootId);
      this.state.project.screens = this.state.project.screens.filter((item) => item.id !== id);
      if (this.state.activeScreenId === id) {
        this.state.activeScreenId = this.state.project.screens[0]?.id ?? '';
        this.state.selection = [];
      }
    }, true, '删除页面');
    this.emit();
  }

  duplicateScreen(id: string) {
    const screen = this.state.project.screens.find((item) => item.id === id);
    if (!screen) return;
    const copy = structuredCloneSafe(screen);
    copy.id = newId('screen');
    copy.name = `${screen.name} 副本`;
    const idMap = new Map<string, string>();
    const collect = (nodeId: string) => {
      const node = this.state.project.nodes[nodeId];
      if (!node) return;
      idMap.set(nodeId, newId(node.type));
      for (const child of node.children) collect(child);
    };
    for (const rootId of screen.rootIds) collect(rootId);
    const newNodes: Record<string, UINode> = {};
    const mapNode = (nodeId: string, parentId: string | null): string => {
      const node = this.state.project.nodes[nodeId];
      const newIdValue = idMap.get(nodeId)!;
      if (!node) return newIdValue;
      const clone: UINode = {
        ...structuredCloneSafe(node),
        id: newIdValue,
        parentId,
        children: node.children.map((child) => mapNode(child, newIdValue)),
        style: { ...node.style, radius: [...node.style.radius] as [number, number, number, number] },
      };
      newNodes[newIdValue] = clone;
      return newIdValue;
    };
    copy.rootIds = screen.rootIds.map((rootId) => mapNode(rootId, null));
    this.mutate(() => {
      Object.assign(this.state.project.nodes, newNodes);
      this.state.project.screens.push(copy);
      this.state.activeScreenId = copy.id;
      this.state.selection = [];
    }, true, '复制页面');
    this.emit();
  }

  setActiveScreen(id: string) {
    if (!this.state.project.screens.some((screen) => screen.id === id)) return;
    this.state.activeScreenId = id;
    this.state.selection = [];
    this.state.previewScreenId = null;
    this.emit();
  }

  setScreenSize(id: string, width: number, height: number) {
    const screen = this.state.project.screens.find((item) => item.id === id);
    if (!screen) return;
    this.mutate(() => {
      screen.width = Math.max(120, Math.round(width));
      screen.height = Math.max(120, Math.round(height));
      const root = this.state.project.nodes[screen.rootIds[0]];
      if (root && root.name === '画板') {
        root.style.width = screen.width;
        root.style.height = screen.height;
      }
    }, true, '画板尺寸');
    this.emit();
  }

  setScreenBackground(id: string, background: string) {
    const screen = this.state.project.screens.find((item) => item.id === id);
    if (!screen) return;
    this.mutate(() => {
      screen.background = background;
    }, false);
    this.emit();
  }

  setTokens(tokens: UIProject['tokens']) {
    this.mutate(() => {
      this.state.project.tokens = structuredCloneSafe(tokens);
    }, true, '设计令牌');
    this.emit();
  }

  replaceProject(project: UIProject) {
    this.resetProject(structuredCloneSafe(project), true);
    this.emit();
  }

  markSaved() {
    this.state.dirty = false;
    this.emit();
  }

  notifyExtensions() {
    this.state.extensionVersion += 1;
    this.emit();
  }
}

export const editorStore = new EditorStore();

export function useEditor<T>(selector: (snapshot: EditorSnapshot) => T): T {
  const snapshot = useSyncExternalStore(editorStore.subscribe, editorStore.getSnapshot, editorStore.getSnapshot);
  return selector(snapshot);
}

export function useEditorSnapshot(): EditorSnapshot {
  return useSyncExternalStore(editorStore.subscribe, editorStore.getSnapshot, editorStore.getSnapshot);
}

/* ------------------------------------------------------------------ 选择辅助 */

export function selectedNodes(snapshot: EditorSnapshot): UINode[] {
  return snapshot.selection.map((id) => snapshot.project.nodes[id]).filter(Boolean);
}

export function primaryNode(snapshot: EditorSnapshot): UINode | null {
  return snapshot.selection.length ? snapshot.project.nodes[snapshot.selection[0]] ?? null : null;
}

export function screenNodes(project: UIProject, screenId: string): UINode[] {
  return screenNodeIds(project, screenId).map((id) => project.nodes[id]).filter(Boolean);
}


