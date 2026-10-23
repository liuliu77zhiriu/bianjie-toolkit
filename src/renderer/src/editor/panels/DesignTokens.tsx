/**
 * 设计令牌（右侧「设计」页）
 *
 * - 颜色 / 间距 / 圆角 / 文字样式四组，读取 project.tokens；
 * - 点击令牌应用到选中节点：颜色可分别应用为填充 / 文字色 / 描边，间距应用到 gap+padding，
 *   圆角应用到四个角，文字样式应用到字号 / 字重 / 颜色 / 行高；
 * - 编辑令牌走本地草稿 + 400ms 防抖 setTokens（一次连续编辑只进一次历史），卸载前 flush。
 */
import { useEffect, useRef, useState } from 'react';
import type { UIDesignTokens, UISpacingToken, UITextToken, UIColorToken } from '@shared/uieditor';
import { newId, structuredCloneSafe } from '@shared/uieditor-kit';
import { editorStore, selectedNodes, type EditorSnapshot } from '../store';
import {
  ColorInput,
  FieldRow,
  Glyph,
  NumberInput,
  Section,
  Select,
  TextInput,
  applyStylePatch,
} from './controls';

const WEIGHT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '300', label: '300' },
  { value: '400', label: '400' },
  { value: '500', label: '500' },
  { value: '600', label: '600' },
  { value: '700', label: '700' },
  { value: '800', label: '800' },
];

type ColorTarget = 'fill' | 'color' | 'stroke';

export function DesignTokens({ snapshot }: { snapshot: EditorSnapshot }) {
  const tokens = snapshot.project.tokens;
  const nodes = selectedNodes(snapshot);
  const selection = nodes.map((node) => node.id);

  const [draft, setDraft] = useState<UIDesignTokens>(() => structuredCloneSafe(tokens));
  const [error, setError] = useState<string | null>(null);

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const storeTokensRef = useRef(tokens);
  const timer = useRef<number | null>(null);
  const pending = useRef(false);

  // 外部（撤销 / 切换项目 / 其它面板）更新令牌时同步草稿
  useEffect(() => {
    if (storeTokensRef.current !== tokens) {
      storeTokensRef.current = tokens;
      const next = structuredCloneSafe(tokens);
      setDraft(next);
      draftRef.current = next;
    }
  }, [tokens]);

  const flush = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (!pending.current) return;
    pending.current = false;
    editorStore.setTokens(draftRef.current);
    storeTokensRef.current = draftRef.current;
  };

  useEffect(
    () => () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
      if (pending.current) {
        pending.current = false;
        editorStore.setTokens(draftRef.current);
      }
    },
    []
  );

  const schedule = (next: UIDesignTokens) => {
    setDraft(next);
    draftRef.current = next;
    pending.current = true;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 400);
  };

  const accent =
    tokens.colors.find((color) => color.id === 'c-accent')?.value ?? tokens.colors[0]?.value ?? '#4C8DFF';

  const requireSelection = (): boolean => {
    if (!selection.length) {
      setError('先在画布或图层中选中节点，再应用令牌。');
      return false;
    }
    setError(null);
    return true;
  };

  const applyColor = (value: string, target: ColorTarget) => {
    if (!requireSelection()) return;
    if (target === 'fill') applyStylePatch(selection, { fill: value });
    else if (target === 'color') applyStylePatch(selection, { color: value });
    else applyStylePatch(selection, { stroke: value });
  };

  const applySpacing = (value: number) => {
    if (!requireSelection()) return;
    applyStylePatch(selection, { gap: value, padding: value });
  };

  const applyRadius = (value: number) => {
    if (!requireSelection()) return;
    applyStylePatch(selection, { radius: [value, value, value, value] });
  };

  const applyText = (token: UITextToken) => {
    if (!requireSelection()) return;
    applyStylePatch(selection, {
      fontSize: token.fontSize,
      fontWeight: token.fontWeight,
      color: token.color,
      lineHeight: token.lineHeight,
    });
  };

  const updateColor = (id: string, patch: Partial<UIColorToken>) => {
    schedule({ ...draft, colors: draft.colors.map((item) => (item.id === id ? { ...item, ...patch } : item)) });
  };

  const updateSpacing = (id: string, patch: Partial<UISpacingToken>) => {
    schedule({ ...draft, spacing: draft.spacing.map((item) => (item.id === id ? { ...item, ...patch } : item)) });
  };

  const updateRadius = (id: string, patch: Partial<UISpacingToken>) => {
    schedule({ ...draft, radii: draft.radii.map((item) => (item.id === id ? { ...item, ...patch } : item)) });
  };

  const updateText = (id: string, patch: Partial<UITextToken>) => {
    schedule({ ...draft, text: draft.text.map((item) => (item.id === id ? { ...item, ...patch } : item)) });
  };

  const addColor = () => {
    schedule({ ...draft, colors: [...draft.colors, { id: newId('c'), name: '新颜色', value: '#4C8DFF' }] });
  };
  const addSpacing = () => {
    schedule({ ...draft, spacing: [...draft.spacing, { id: newId('s'), name: '新间距', value: 8 }] });
  };
  const addRadius = () => {
    schedule({ ...draft, radii: [...draft.radii, { id: newId('r'), name: '新圆角', value: 8 }] });
  };
  const addText = () => {
    schedule({
      ...draft,
      text: [
        ...draft.text,
        { id: newId('t'), name: '新文字样式', fontSize: 14, fontWeight: 400, color: '#E8ECF4', lineHeight: 1.5 },
      ],
    });
  };

  return (
    <div className="up-tokens up-scroll">
      <div className="up-token-hero">
        <span className="up-token-hero-swatch" style={{ background: accent }} aria-hidden="true" />
        <div className="up-token-hero-main">
          <span className="up-token-hero-title">{snapshot.project.name}</span>
          <span className="up-token-hero-sub">项目主色 · {accent}</span>
        </div>
        <span className="up-token-hero-count">{tokens.colors.length + tokens.spacing.length + tokens.radii.length + tokens.text.length} 项</span>
      </div>

      {error ? (
        <div className="up-alert">
          <span>{error}</span>
          <button type="button" className="up-alert-close" aria-label="关闭提示" onClick={() => setError(null)}>
            <Glyph name="close" size={11} />
          </button>
        </div>
      ) : null}
      {!selection.length ? (
        <div className="up-form-hint">
          <Glyph name="info" size={12} />
          <span>未选中节点：令牌修改仍会保存到项目，但无法应用到画布。</span>
        </div>
      ) : null}

      <Section
        title="颜色"
        actions={
          <button type="button" className="up-icon-btn" title="新增颜色令牌" aria-label="新增颜色令牌" onClick={addColor}>
            <Glyph name="plus" size={12} />
          </button>
        }
      >
        <div className="up-token-list">
          {draft.colors.map((token) => (
            <div key={token.id} className="up-token-row">
              <div className="up-token-line">
                <button
                  type="button"
                  className="up-token-swatch"
                  style={{ background: token.value }}
                  title={`应用「${token.name}」为填充色`}
                  aria-label={`应用颜色 ${token.name}`}
                  onClick={() => applyColor(token.value, 'fill')}
                />
                <input
                  className="up-token-name"
                  value={token.name}
                  aria-label="颜色令牌名称"
                  onChange={(event) => updateColor(token.id, { name: event.target.value })}
                />
                <div className="up-token-actions">
                  <button type="button" title="应用为文字颜色" aria-label="应用为文字颜色" onClick={() => applyColor(token.value, 'color')}>
                    字
                  </button>
                  <button type="button" title="应用为描边颜色" aria-label="应用为描边颜色" onClick={() => applyColor(token.value, 'stroke')}>
                    描
                  </button>
                  <button
                    type="button"
                    title="删除令牌"
                    aria-label={`删除颜色令牌 ${token.name}`}
                    onClick={() => schedule({ ...draft, colors: draft.colors.filter((item) => item.id !== token.id) })}
                  >
                    <Glyph name="trash" size={11} />
                  </button>
                </div>
              </div>
              <ColorInput
                value={token.value}
                ariaLabel={`颜色 ${token.name}`}
                onChange={(value) => updateColor(token.id, { value })}
              />
            </div>
          ))}
          {!draft.colors.length ? <div className="up-token-empty">还没有颜色令牌</div> : null}
        </div>
      </Section>

      <Section
        title="间距"
        actions={
          <button type="button" className="up-icon-btn" title="新增间距令牌" aria-label="新增间距令牌" onClick={addSpacing}>
            <Glyph name="plus" size={12} />
          </button>
        }
      >
        <div className="up-token-list">
          {draft.spacing.map((token) => (
            <div key={token.id} className="up-token-line" title={`应用 ${token.value}px 到 gap 与 padding`}>
              <button
                type="button"
                className="up-token-chip"
                title={`应用 ${token.value}px 到 gap / padding`}
                aria-label={`应用间距 ${token.value}`}
                onClick={() => applySpacing(token.value)}
              >
                {token.value}
              </button>
              <input
                className="up-token-name"
                value={token.name}
                aria-label="间距令牌名称"
                onChange={(event) => updateSpacing(token.id, { name: event.target.value })}
              />
              <NumberInput
                value={token.value}
                min={0}
                max={999}
                ariaLabel={`间距 ${token.name} 数值`}
                suffix="px"
                onCommit={(value) => updateSpacing(token.id, { value })}
              />
              <button
                type="button"
                className="up-token-del"
                title="删除令牌"
                aria-label={`删除间距令牌 ${token.name}`}
                onClick={() => schedule({ ...draft, spacing: draft.spacing.filter((item) => item.id !== token.id) })}
              >
                <Glyph name="trash" size={11} />
              </button>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="圆角"
        actions={
          <button type="button" className="up-icon-btn" title="新增圆角令牌" aria-label="新增圆角令牌" onClick={addRadius}>
            <Glyph name="plus" size={12} />
          </button>
        }
      >
        <div className="up-token-list">
          {draft.radii.map((token) => (
            <div key={token.id} className="up-token-line">
              <button
                type="button"
                className="up-token-chip radius"
                title={`应用 ${token.value}px 到四个圆角`}
                aria-label={`应用圆角 ${token.value}`}
                onClick={() => applyRadius(token.value)}
                style={{ borderRadius: Math.min(12, token.value) }}
              >
                {token.value}
              </button>
              <input
                className="up-token-name"
                value={token.name}
                aria-label="圆角令牌名称"
                onChange={(event) => updateRadius(token.id, { name: event.target.value })}
              />
              <NumberInput
                value={token.value}
                min={0}
                max={999}
                ariaLabel={`圆角 ${token.name} 数值`}
                suffix="px"
                onCommit={(value) => updateRadius(token.id, { value })}
              />
              <button
                type="button"
                className="up-token-del"
                title="删除令牌"
                aria-label={`删除圆角令牌 ${token.name}`}
                onClick={() => schedule({ ...draft, radii: draft.radii.filter((item) => item.id !== token.id) })}
              >
                <Glyph name="trash" size={11} />
              </button>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="文字样式"
        actions={
          <button type="button" className="up-icon-btn" title="新增文字样式令牌" aria-label="新增文字样式令牌" onClick={addText}>
            <Glyph name="plus" size={12} />
          </button>
        }
      >
        <div className="up-token-list">
          {draft.text.map((token) => (
            <div key={token.id} className="up-token-text">
              <div className="up-token-line">
                <button
                  type="button"
                  className="up-token-text-sample"
                  title="应用到选中节点"
                  aria-label={`应用文字样式 ${token.name}`}
                  onClick={() => applyText(token)}
                  style={{ fontSize: `${Math.min(20, token.fontSize)}px`, fontWeight: token.fontWeight, color: token.color }}
                >
                  Ag
                </button>
                <input
                  className="up-token-name"
                  value={token.name}
                  aria-label="文字样式名称"
                  onChange={(event) => updateText(token.id, { name: event.target.value })}
                />
                <button
                  type="button"
                  className="up-token-apply"
                  title="应用到选中节点"
                  aria-label={`应用文字样式 ${token.name}`}
                  onClick={() => applyText(token)}
                >
                  应用
                </button>
                <button
                  type="button"
                  className="up-token-del"
                  title="删除令牌"
                  aria-label={`删除文字样式 ${token.name}`}
                  onClick={() => schedule({ ...draft, text: draft.text.filter((item) => item.id !== token.id) })}
                >
                  <Glyph name="trash" size={11} />
                </button>
              </div>
              <div className="up-token-text-fields">
                <FieldRow label="字号">
                  <NumberInput
                    value={token.fontSize}
                    min={8}
                    max={200}
                    suffix="px"
                    ariaLabel="令牌字号"
                    onCommit={(value) => updateText(token.id, { fontSize: value })}
                  />
                </FieldRow>
                <FieldRow label="字重">
                  <Select
                    value={String(token.fontWeight)}
                    options={WEIGHT_OPTIONS}
                    ariaLabel="令牌字重"
                    onChange={(value) => updateText(token.id, { fontWeight: Number(value) })}
                  />
                </FieldRow>
                <FieldRow label="行高">
                  <NumberInput
                    value={token.lineHeight}
                    min={0.8}
                    max={4}
                    step={0.05}
                    precision={2}
                    ariaLabel="令牌行高"
                    onCommit={(value) => updateText(token.id, { lineHeight: value })}
                  />
                </FieldRow>
                <FieldRow label="颜色">
                  <ColorInput
                    value={token.color}
                    ariaLabel="令牌文字颜色"
                    onChange={(value) => updateText(token.id, { color: value })}
                  />
                </FieldRow>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <div className="up-form-hint">
        <Glyph name="info" size={12} />
        <span>令牌保存在项目文件中；点击令牌即可批量应用到选中节点。</span>
      </div>
    </div>
  );
}
