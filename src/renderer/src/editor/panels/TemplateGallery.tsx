/**
 * 模板库（左侧「模板」页）
 *
 * 读取 @shared/uieditor-templates 的 UIEDITOR_TEMPLATES，点击交给父组件
 * 的 onApplyTemplate(id)（由编辑器负责新建项目 / 保存旧项目）。
 */
import { useMemo, useState } from 'react';
import type { UIEditorTemplate } from '@shared/uieditor';
import { UIEDITOR_TEMPLATES } from '@shared/uieditor-templates';
import { EmptyState, Glyph } from './controls';

const TEMPLATES: UIEditorTemplate[] = UIEDITOR_TEMPLATES;

const CATEGORY_LABELS: Record<string, string> = {
  page: '整页',
  layout: '布局',
  component: '组件',
};

function templateThumb(template: UIEditorTemplate): string {
  const accent = template.accent || '#4C8DFF';
  return `radial-gradient(120% 90% at 15% 0%, ${accent}55, transparent 60%), linear-gradient(150deg, rgba(255,255,255,.08), rgba(5,8,14,.65))`;
}

export function TemplateGallery({ onApplyTemplate }: { onApplyTemplate: (templateId: string) => void }) {
  const [query, setQuery] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return TEMPLATES;
    return TEMPLATES.filter((template) =>
      [template.name, template.description, template.category, ...(template.tags ?? [])]
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    );
  }, [query]);

  const apply = (template: UIEditorTemplate) => {
    setPendingId(template.id);
    try {
      onApplyTemplate(template.id);
    } finally {
      // 父组件可能切换项目；短暂显示 pending 状态即可
      window.setTimeout(() => setPendingId(null), 300);
    }
  };

  return (
    <div className="up-templates">
      <div className="up-lib-head">
        <div className="up-search">
          <span className="up-search-icon">
            <Glyph name="search" size={13} />
          </span>
          <input
            type="text"
            value={query}
            placeholder="搜索模板…"
            aria-label="搜索模板"
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
        <span className="up-lib-count">{filtered.length} 个模板</span>
      </div>

      <div className="up-scroll up-lib-scroll">
        {filtered.length === 0 ? (
          <EmptyState icon="template" title="没有匹配的模板" hint="换个关键词，或清空搜索。" />
        ) : (
          <div className="up-template-list">
            {filtered.map((template) => (
              <article key={template.id} className="up-template-card">
                <button
                  type="button"
                  className="up-template-main"
                  title={`应用模板「${template.name}」`}
                  onClick={() => apply(template)}
                >
                  <span className="up-template-thumb" style={{ backgroundImage: templateThumb(template) }}>
                    <span className="up-template-category">
                      {CATEGORY_LABELS[template.category] ?? template.category}
                    </span>
                  </span>
                  <span className="up-template-meta">
                    <span className="up-template-name">{template.name}</span>
                    <span className="up-template-desc">{template.description || '暂无说明'}</span>
                    {template.tags?.length ? (
                      <span className="up-template-tags">
                        {template.tags.slice(0, 4).map((tag) => (
                          <span key={tag} className="up-tag">
                            {tag}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </span>
                </button>
                <button
                  type="button"
                  className="up-template-apply"
                  disabled={pendingId === template.id}
                  title="新建项目并应用该模板"
                  onClick={() => apply(template)}
                >
                  {pendingId === template.id ? '应用中…' : '应用'}
                </button>
              </article>
            ))}
          </div>
        )}
        <p className="up-lib-note">
          <Glyph name="info" size={12} />
          <span>应用模板会新建一个项目；当前项目请在编辑器中先保存。</span>
        </p>
      </div>
    </div>
  );
}
