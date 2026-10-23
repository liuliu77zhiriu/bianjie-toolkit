/**
 * 页面管理（左侧「页面」页）
 *
 * 屏幕列表（缩略比例、名称、尺寸、当前页高亮）+ 新建 / 重命名 / 复制 / 删除，
 * 底部小表单编辑当前页尺寸与背景。
 */
import { useState } from 'react';
import type { UIScreen } from '@shared/uieditor';
import { editorStore, type EditorSnapshot } from '../store';
import { ColorInput, EmptyState, FieldRow, Glyph, NumberInput, useLiveGesture } from './controls';

export function ScreenPanel({ snapshot }: { snapshot: EditorSnapshot }) {
  const { project } = snapshot;
  const screens = project.screens;
  const active = screens.find((screen) => screen.id === snapshot.activeScreenId) ?? screens[0] ?? null;
  const backgroundGesture = useLiveGesture('画板背景');
  const [error, setError] = useState<string | null>(null);
  // Electron 不支持 window.prompt，改为行内重命名
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  if (!active) {
    return <EmptyState icon="screen" title="还没有页面" hint="新建一个页面开始设计。" />;
  }

  const beginRename = (screen: UIScreen) => {
    setEditingId(screen.id);
    setDraftName(screen.name);
  };

  const commitRename = () => {
    if (editingId) {
      const trimmed = draftName.trim();
      if (trimmed) editorStore.renameScreen(editingId, trimmed);
    }
    setEditingId(null);
  };

  const createScreen = () => {
    const name = `页面 ${screens.length + 1}`;
    const id = editorStore.addScreen(name);
    setEditingId(id);
    setDraftName(name);
    setError(null);
  };

  const remove = (id: string, name: string) => {
    if (screens.length <= 1) {
      setError('至少保留一个页面');
      return;
    }
    if (window.confirm(`删除页面「${name}」及其中的全部节点？`)) {
      editorStore.deleteScreen(id);
      setError(null);
    }
  };

  const thumbSize = (width: number, height: number): { width: number; height: number } => {
    const ratio = height > 0 ? width / height : 1;
    const thumbHeight = 34;
    const thumbWidth = Math.round(Math.min(62, Math.max(20, thumbHeight * ratio)));
    return { width: thumbWidth, height: thumbHeight };
  };

  return (
    <div className="up-screens">
      <div className="up-lib-head">
        <span className="up-panel-label">页面列表</span>
        <div className="up-layers-actions">
          <span className="up-lib-count">{screens.length} 页</span>
          <button type="button" className="up-btn sm primary" title="新建页面" onClick={createScreen}>
            <Glyph name="plus" size={12} />
            <span>新建</span>
          </button>
        </div>
      </div>

      {error ? <div className="up-alert">{error}</div> : null}

      <div className="up-scroll up-screen-scroll">
        <div className="up-screen-list" role="listbox" aria-label="页面列表">
          {screens.map((screen) => {
            const activeRow = screen.id === active.id;
            const size = thumbSize(screen.width, screen.height);
            return (
              <div
                key={screen.id}
                role="option"
                aria-selected={activeRow}
                tabIndex={0}
                className={`up-screen-row${activeRow ? ' active' : ''}`}
                onClick={() => editorStore.setActiveScreen(screen.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    editorStore.setActiveScreen(screen.id);
                  }
                }}
                onDoubleClick={() => beginRename(screen)}
              >
                <span
                  className="up-screen-thumb"
                  style={{
                    width: size.width,
                    height: size.height,
                    background: screen.background,
                  }}
                  aria-hidden="true"
                >
                  <span className="up-screen-thumb-glow" />
                </span>
                <span className="up-screen-info">
                  {editingId === screen.id ? (
                    <input
                      className="up-screen-rename"
                      autoFocus
                      value={draftName}
                      aria-label={`重命名页面 ${screen.name}`}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => setDraftName(event.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          commitRename();
                        } else if (event.key === 'Escape') {
                          setEditingId(null);
                        }
                      }}
                    />
                  ) : (
                    <span className="up-screen-name" title={screen.name} onDoubleClick={() => beginRename(screen)}>
                      {screen.name}
                    </span>
                  )}
                  <span className="up-screen-size">
                    {Math.round(screen.width)} × {Math.round(screen.height)}
                  </span>
                </span>
                <span className="up-screen-actions">
                  <button
                    type="button"
                    className="up-icon-btn"
                    title="重命名页面"
                    aria-label={`重命名 ${screen.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      beginRename(screen);
                    }}
                  >
                    <Glyph name="edit" size={12} />
                  </button>
                  <button
                    type="button"
                    className="up-icon-btn"
                    title="复制页面"
                    aria-label={`复制 ${screen.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      editorStore.duplicateScreen(screen.id);
                    }}
                  >
                    <Glyph name="copy" size={12} />
                  </button>
                  <button
                    type="button"
                    className="up-icon-btn danger"
                    title={screens.length <= 1 ? '至少保留一个页面' : '删除页面'}
                    aria-label={`删除 ${screen.name}`}
                    disabled={screens.length <= 1}
                    onClick={(event) => {
                      event.stopPropagation();
                      remove(screen.id, screen.name);
                    }}
                  >
                    <Glyph name="trash" size={12} />
                  </button>
                </span>
              </div>
            );
          })}
        </div>

        <section className="up-screen-form" aria-label="当前页面设置">
          <div className="up-group-title">
            <span>当前页面</span>
            <span className="up-group-count">{active.name}</span>
          </div>
          <FieldRow label="宽度">
            <NumberInput
              value={active.width}
              min={120}
              max={4096}
              step={10}
              suffix="px"
              ariaLabel="页面宽度"
              onCommit={(width) => editorStore.setScreenSize(active.id, width, active.height)}
            />
          </FieldRow>
          <FieldRow label="高度">
            <NumberInput
              value={active.height}
              min={120}
              max={4096}
              step={10}
              suffix="px"
              ariaLabel="页面高度"
              onCommit={(height) => editorStore.setScreenSize(active.id, active.width, height)}
            />
          </FieldRow>
          <FieldRow label="背景">
            <ColorInput
              value={active.background}
              ariaLabel="页面背景色"
              onChange={(value) => backgroundGesture.run(() => editorStore.setScreenBackground(active.id, value))}
            />
          </FieldRow>
          <div className="up-form-hint">
            <Glyph name="info" size={12} />
            <span>画板根节点的尺寸会随页面尺寸同步。</span>
          </div>
        </section>
      </div>
    </div>
  );
}
