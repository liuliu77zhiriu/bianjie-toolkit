/**
 * 组件库（左侧「组件」页）
 *
 * 读取 @shared/uieditor-presets 的 UI_COMPONENT_PRESETS / instantiatePreset，
 * 按分类分组展示；点击卡片把预设实例化后的节点数组插入当前屏幕画板中心。
 */
import { useMemo, useState } from 'react';
import type { UINode, UIScreen } from '@shared/uieditor';
import {
  instantiatePreset,
  UI_COMPONENT_PRESETS,
  type UIComponentPreset,
} from '@shared/uieditor-presets';
import { iconSvg } from '@shared/uieditor-render';
import { editorStore, useEditorSnapshot } from '../store';
import { EmptyState, Glyph } from './controls';

const PRESETS: UIComponentPreset[] = UI_COMPONENT_PRESETS;

const CATEGORY_LABELS: Record<string, string> = {
  basic: '基础',
  layout: '布局',
  input: '输入',
  form: '表单',
  data: '数据展示',
  display: '展示',
  navigation: '导航',
  feedback: '反馈',
  media: '媒体',
  text: '文字',
  other: '其他',
};

function categoryLabel(category?: string): string {
  if (!category) return '其他';
  return CATEGORY_LABELS[category] ?? category;
}

/** 把预设包围盒中心对齐到画板中心（insertNodes 只平移根节点）。 */
function centerOffset(nodes: UINode[], screen: UIScreen): { x: number; y: number } {
  const roots = nodes.filter(
    (node) => !node.parentId || !nodes.some((candidate) => candidate.id === node.parentId)
  );
  if (!roots.length) return { x: 0, y: 0 };
  const minX = Math.min(...roots.map((node) => node.style.x));
  const minY = Math.min(...roots.map((node) => node.style.y));
  const maxX = Math.max(...roots.map((node) => node.style.x + node.style.width));
  const maxY = Math.max(...roots.map((node) => node.style.y + node.style.height));
  return {
    x: Math.round(screen.width / 2 - (minX + maxX) / 2),
    y: Math.round(screen.height / 2 - (minY + maxY) / 2),
  };
}

function presetIcon(preset: UIComponentPreset): string {
  return iconSvg(preset.icon || 'sparkle', 'currentColor', 16);
}

export function ComponentLibrary() {
  const snapshot = useEditorSnapshot();
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return PRESETS;
    return PRESETS.filter((preset) =>
      [preset.name, preset.id, preset.category ?? '', preset.description ?? '']
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    );
  }, [query]);

  const grouped = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, UIComponentPreset[]>();
    for (const preset of filtered) {
      const key = preset.category || 'other';
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)!.push(preset);
    }
    return order.map((key) => ({ key, label: categoryLabel(key), items: map.get(key)! }));
  }, [filtered]);

  const activeScreen =
    snapshot.project.screens.find((screen) => screen.id === snapshot.activeScreenId) ?? null;

  const insert = (preset: UIComponentPreset) => {
    setError(null);
    try {
      const nodes = instantiatePreset(preset.id);
      if (!nodes || !nodes.length) {
        setError('该组件没有可插入的内容');
        return;
      }
      const offset = activeScreen ? centerOffset(nodes, activeScreen) : undefined;
      editorStore.insertNodes(nodes, null, offset);
    } catch (err) {
      setError(err instanceof Error ? err.message : '插入组件失败');
    }
  };

  return (
    <div className="up-components">
      <div className="up-lib-head">
        <div className="up-search">
          <span className="up-search-icon">
            <Glyph name="search" size={13} />
          </span>
          <input
            type="text"
            value={query}
            placeholder="搜索组件…"
            aria-label="搜索组件"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button
              type="button"
              className="up-search-clear"
              title="清空搜索"
              aria-label="清空搜索"
              onClick={() => setQuery('')}
            >
              <Glyph name="close" size={11} />
            </button>
          ) : null}
        </div>
        <span className="up-lib-count">{filtered.length} 个组件</span>
      </div>

      {error ? <div className="up-alert">{error}</div> : null}

      <div className="up-scroll up-lib-scroll">
        {grouped.length === 0 ? (
          <EmptyState icon="search" title="没有匹配的组件" hint="换个关键词试试，或清空搜索。" />
        ) : (
          grouped.map((group) => (
            <section key={group.key} className="up-preset-group">
              <div className="up-group-title">
                <span>{group.label}</span>
                <span className="up-group-count">{group.items.length}</span>
              </div>
              <div className="up-preset-grid">
                {group.items.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className="up-preset-card"
                    title={`插入「${preset.name}」到画板中心`}
                    onClick={() => insert(preset)}
                  >
                    <span
                      className="up-preset-icon"
                      aria-hidden="true"
                      dangerouslySetInnerHTML={{ __html: presetIcon(preset) }}
                    />
                    <span className="up-preset-name">{preset.name}</span>
                    <span className="up-preset-desc">{preset.description || group.label}</span>
                  </button>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
