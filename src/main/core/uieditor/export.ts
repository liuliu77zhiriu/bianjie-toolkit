/**
 * UI 编辑器 · 导出器（纯函数，无 Electron 依赖）
 *
 * - exportStandaloneHtml：自包含 HTML（内联 CSS/JS、多屏切换、交互、缩放适配、无外部资源）
 * - exportProjectJson：工程 JSON
 * - exportReactComponent：React + TSX 组件（内联 style 对象 + 状态 CSS）
 * - exportScreenSnippet：单屏 HTML + CSS 片段
 *
 * 画布与导出共用 @shared/uieditor-render 的 nodeCss / nodeTextCss / iconSvg，
 * 保证设计态与运行态尽量一致。
 */
import type {
  UIInteraction,
  UINode,
  UINodeStateKey,
  UIProject,
  UIScreen,
} from '../../../shared/uieditor';
import { iconSvg, nodeCss, nodeTextCss, type CssObject } from '../../../shared/uieditor-render';

export interface StandaloneHtmlOptions {
  screenIds?: string[];
  title?: string;
}

export interface ReactExportResult {
  tsx: string;
  css: string;
  html?: string;
}

/* ------------------------------------------------------------------ 基础工具 */

const ACCENT = '#4C8DFF';
const ACCENT_SOFT = '#7FB0FF';
const MUTED = '#8A94A6';
const PLACEHOLDER = 'rgba(182,188,201,0.55)';
const FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',system-ui,sans-serif";

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** HTML 文本 / 属性转义（含引号，防止脚本注入与属性逃逸）。 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (match) => HTML_ESCAPES[match]);
}

function kebabCase(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** CSS 对象 → 声明串；自动过滤 undefined / NaN / 空值，避免导出出现 "undefined"。 */
function styleToDecl(css: CssObject, important = false): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(css)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'number' && !Number.isFinite(value)) continue;
    if (typeof value === 'string' && value.length === 0) continue;
    const suffix = important ? ' !important' : '';
    parts.push(`${kebabCase(key)}:${String(value)}${suffix}`);
  }
  return parts.join(';');
}

function styleObjectLiteral(css: CssObject): string {
  const entries = Object.entries(css).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (!entries.length) return '{}';
  const props = entries.map(([key, value]) => {
    const property = /^[a-zA-Z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
    const literal = typeof value === 'number' ? String(value) : JSON.stringify(value);
    return `${property}: ${literal}`;
  });
  return `{ ${props.join(', ')} }`;
}

function clampPercent(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function jsonLiteral(value: unknown): string {
  try {
    const text = JSON.stringify(value) ?? '""';
    // 转义 <，避免导出的源码/JSON 中出现可被误读的原始标签（JS 字符串语义不变）
    return text.replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  } catch {
    return '""';
  }
}

function jsonForScript(value: unknown): string {
  return jsonLiteral(value);
}

/* ------------------------------------------------------------------ CSS 上下文 */

interface RenderContext {
  rules: string[];
  classes: Map<string, string>;
  next: number;
}

function createRenderContext(): RenderContext {
  return { rules: [], classes: new Map<string, string>(), next: 0 };
}

function classFor(ctx: RenderContext, id: string): string {
  const existing = ctx.classes.get(id);
  if (existing) return existing;
  const cls = `u-${ctx.next++}`;
  ctx.classes.set(id, cls);
  return cls;
}

function textInnerCss(node: UINode): CssObject {
  return { ...nodeTextCss(node), height: '100%' };
}

function fieldCss(node: UINode, multiline: boolean): CssObject {
  const style = node.style;
  const css: CssObject = {
    width: '100%',
    height: '100%',
    margin: 0,
    border: '0',
    outline: 'none',
    background: 'transparent',
    color: style.color,
    fontFamily: style.fontFamily,
    fontSize: `${style.fontSize}px`,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
    letterSpacing: `${style.letterSpacing}px`,
    padding: multiline ? '10px 12px' : '0 12px',
    boxSizing: 'border-box',
    appearance: 'none',
  };
  if (multiline) css.resize = 'none';
  return css;
}

function stateCssRules(node: UINode, cls: string, important: boolean): string[] {
  const states = node.states;
  if (!states) return [];
  const mapping: Array<[UINodeStateKey, string]> = [
    ['hover', ':hover'],
    ['pressed', ':active'],
    ['active', '.is-active'],
    ['disabled', '.is-disabled'],
  ];
  const rules: string[] = [];
  for (const [key, selector] of mapping) {
    const patch = states[key];
    if (!patch) continue;
    const merged: UINode = { ...node, style: { ...node.style, ...patch } };
    const decl = styleToDecl(nodeCss(merged, { includePosition: false }), important);
    if (decl) rules.push(`.${cls}${selector}{${decl}}`);
  }
  return rules;
}

function interactionAttributes(node: UINode): string {
  const interaction: UIInteraction | undefined = node.interaction;
  if (!interaction || interaction.action === 'none') return '';
  const attrs: string[] = [` data-action="${escapeHtml(interaction.action)}"`];
  if (interaction.event) attrs.push(` data-event="${escapeHtml(interaction.event)}"`);
  if (interaction.screenId) attrs.push(` data-screen="${escapeHtml(interaction.screenId)}"`);
  if (interaction.url) attrs.push(` data-url="${escapeHtml(interaction.url)}"`);
  if (interaction.target) attrs.push(` data-target="${escapeHtml(interaction.target)}"`);
  if (interaction.transition) attrs.push(` data-transition="${escapeHtml(interaction.transition)}"`);
  if (interaction.action === 'copy') {
    attrs.push(` data-copy="${escapeHtml(node.text ?? node.label ?? node.value ?? node.name ?? '')}"`);
  }
  return attrs.join('');
}

/* ------------------------------------------------------------------ HTML 节点渲染 */

interface ContentResult {
  inner: string;
  rootClass?: string;
}

function contentHtml(ctx: RenderContext, node: UINode, cls: string): ContentResult {
  const style = node.style;
  switch (node.type) {
    case 'text':
    case 'button': {
      ctx.rules.push(`.${cls}-t{${styleToDecl(textInnerCss(node))}}`);
      const value = node.text ?? '';
      return {
        inner: `<div class="${cls}-t">${escapeHtml(value)}</div>`,
        rootClass: node.type === 'button' ? 'is-button' : undefined,
      };
    }
    case 'badge': {
      ctx.rules.push(`.${cls}-t{${styleToDecl(textInnerCss(node))}}`);
      return { inner: `<div class="${cls}-t">${escapeHtml(node.label ?? node.text ?? '')}</div>` };
    }
    case 'input': {
      ctx.rules.push(`.${cls}-field{${styleToDecl(fieldCss(node, false))}}`);
      ctx.rules.push(`.${cls}-field::placeholder{color:${PLACEHOLDER}}`);
      return {
        inner: `<input class="${cls}-field" type="text" value="${escapeHtml(node.value ?? '')}" placeholder="${escapeHtml(node.placeholder ?? '')}" aria-label="${escapeHtml(node.name)}" />`,
      };
    }
    case 'textarea': {
      ctx.rules.push(`.${cls}-field{${styleToDecl(fieldCss(node, true))}}`);
      ctx.rules.push(`.${cls}-field::placeholder{color:${PLACEHOLDER}}`);
      return {
        inner: `<textarea class="${cls}-field" placeholder="${escapeHtml(node.placeholder ?? '')}" aria-label="${escapeHtml(node.name)}">${escapeHtml(node.value ?? '')}</textarea>`,
      };
    }
    case 'toggle': {
      const height = Math.max(12, style.height);
      const knob = Math.max(8, Math.min(height - 6, height));
      ctx.rules.push(
        `.${cls}-knob{position:absolute;left:3px;top:50%;width:${knob}px;height:${knob}px;border-radius:999px;background:#fff;transform:translateY(-50%);transition:left .18s ease;box-shadow:0 1px 3px rgba(0,0,0,.45)}`
      );
      ctx.rules.push(`.${cls}.is-on .${cls}-knob{left:calc(100% - ${knob + 3}px)}`);
      if (node.checked) ctx.rules.push(`.${cls}:not(.is-on){background-color:rgba(255,255,255,0.12)}`);
      else ctx.rules.push(`.${cls}.is-on{background-color:${ACCENT}}`);
      return { inner: `<div class="${cls}-knob"></div>`, rootClass: node.checked ? 'is-on' : undefined };
    }
    case 'slider': {
      const percent = clampPercent(node.percent);
      ctx.rules.push(
        `.${cls}-fill{position:absolute;left:0;top:0;height:100%;width:${percent}%;border-radius:999px;background:${ACCENT};pointer-events:none}`
      );
      ctx.rules.push(
        `.${cls}-thumb{position:absolute;top:50%;left:${percent}%;width:14px;height:14px;border-radius:999px;background:#fff;transform:translate(-50%,-50%);box-shadow:0 2px 6px rgba(0,0,0,.45);pointer-events:none}`
      );
      return { inner: `<div class="${cls}-fill"></div><div class="${cls}-thumb"></div>` };
    }
    case 'progress': {
      const percent = clampPercent(node.percent);
      ctx.rules.push(
        `.${cls}-fill{position:absolute;left:0;top:0;height:100%;width:${percent}%;border-radius:999px;background:${ACCENT};pointer-events:none}`
      );
      return { inner: `<div class="${cls}-fill"></div>` };
    }
    case 'tabs': {
      const items = node.items ?? [];
      const active = node.value ? items.indexOf(node.value) : 0;
      const activeIndex = active >= 0 ? active : 0;
      ctx.rules.push(`.${cls}-tabs{position:absolute;inset:0;display:flex;align-items:center}`);
      ctx.rules.push(
        `.${cls}-tab{position:relative;flex:1 1 0;height:100%;display:flex;align-items:center;justify-content:center;font-size:${style.fontSize}px;color:${MUTED};white-space:nowrap;overflow:hidden}`
      );
      ctx.rules.push(`.${cls}-tab.is-on{color:${style.color};font-weight:600}`);
      ctx.rules.push(`.${cls}-tab.is-on::after{content:"";position:absolute;left:22%;right:22%;bottom:4px;height:2px;border-radius:999px;background:${ACCENT}}`);
      const tabs = items
        .map((item, index) => `<div class="${cls}-tab${index === activeIndex ? ' is-on' : ''}">${escapeHtml(item)}</div>`)
        .join('');
      return { inner: `<div class="${cls}-tabs">${tabs}</div>` };
    }
    case 'list': {
      const items = node.items ?? [];
      if (items.length) {
        ctx.rules.push(`.${cls}-list{position:absolute;inset:0;display:flex;flex-direction:column;padding:6px 14px}`);
        ctx.rules.push(
          `.${cls}-row{display:flex;align-items:center;flex:1 1 0;font-size:${style.fontSize}px;color:${style.color};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-bottom:1px solid rgba(255,255,255,0.06)}`
        );
        ctx.rules.push(`.${cls}-row:last-child{border-bottom:0}`);
        const rows = items.map((item) => `<div class="${cls}-row">${escapeHtml(item)}</div>`).join('');
        return { inner: `<div class="${cls}-list">${rows}</div>` };
      }
      return { inner: '' };
    }
    case 'image': {
      const src = node.image?.src ?? '';
      if (src) {
        ctx.rules.push(
          `.${cls}-img{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:${node.image?.fit ?? 'cover'}}`
        );
        return {
          inner: `<img class="${cls}-img" src="${escapeHtml(src)}" alt="${escapeHtml(node.image?.alt ?? node.name)}" />`,
        };
      }
      ctx.rules.push(`.${cls}-ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.35)}`);
      ctx.rules.push(`.${cls}-ph svg{width:38%;height:38%}`);
      return { inner: `<div class="${cls}-ph">${iconSvg('image', 'rgba(255,255,255,0.38)')}</div>` };
    }
    case 'avatar': {
      const src = node.image?.src ?? '';
      if (src) {
        ctx.rules.push(
          `.${cls}-img{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:${node.image?.fit ?? 'cover'}}`
        );
        return {
          inner: `<img class="${cls}-img" src="${escapeHtml(src)}" alt="${escapeHtml(node.image?.alt ?? node.name)}" />`,
        };
      }
      ctx.rules.push(`.${cls}-av{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:${style.color}}`);
      ctx.rules.push(`.${cls}-av svg{width:55%;height:55%}`);
      return { inner: `<div class="${cls}-av">${iconSvg('user', style.color)}</div>` };
    }
    case 'icon': {
      const color = node.icon?.color ?? style.color ?? '#E8ECF4';
      const name = node.icon?.name ?? 'sparkle';
      ctx.rules.push(`.${cls}-i{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:${color}}`);
      ctx.rules.push(`.${cls}-i svg{display:block;width:100%;height:100%}`);
      return { inner: `<div class="${cls}-i">${iconSvg(name, color)}</div>` };
    }
    default:
      return { inner: '' };
  }
}

function renderNodeHtml(ctx: RenderContext, project: UIProject, node: UINode | undefined, seen: Set<string>): string {
  if (!node || seen.has(node.id)) return '';
  seen.add(node.id);
  const cls = classFor(ctx, node.id);
  ctx.rules.push(`.${cls}{${styleToDecl(nodeCss(node))}}`);
  if (node.type === 'image' || node.type === 'avatar') ctx.rules.push(`.${cls}{overflow:hidden}`);
  ctx.rules.push(...stateCssRules(node, cls, false));

  const content = contentHtml(ctx, node, cls);
  const children = node.children
    .map((childId) => renderNodeHtml(ctx, project, project.nodes[childId], seen))
    .filter(Boolean)
    .join('\n');

  const classes = ['uis-node', cls];
  if (content.rootClass) classes.push(content.rootClass);
  if (!node.style.visible) classes.push('is-hidden');

  const attrs: string[] = [
    `class="${classes.join(' ')}"`,
    `data-ui-node="${escapeHtml(node.id)}"`,
    `data-ui-type="${escapeHtml(node.type)}"`,
  ];
  if (node.name) attrs.push(`aria-label="${escapeHtml(node.name)}"`);

  const interactive = Boolean(node.interaction && node.interaction.action !== 'none');
  if (node.type === 'toggle') {
    attrs.push('role="switch"', `aria-checked="${node.checked ? 'true' : 'false'}"`, 'tabindex="0"');
  } else if (interactive || node.type === 'button' || node.type === 'input' || node.type === 'textarea') {
    attrs.push('role="button"', 'tabindex="0"');
  }

  const body = [children, content.inner].filter(Boolean).join('\n');
  return `<div ${attrs.join(' ')}${interactionAttributes(node)}>${body}</div>`;
}

function renderScreenHtml(ctx: RenderContext, project: UIProject, screen: UIScreen, active: boolean): string {
  const seen = new Set<string>();
  const nodes = screen.rootIds
    .map((id) => renderNodeHtml(ctx, project, project.nodes[id], seen))
    .filter(Boolean)
    .join('\n');
  const style = `width:${screen.width}px;height:${screen.height}px;background:${escapeHtml(screen.background)}`;
  return [
    `<section class="uis-screen${active ? ' is-active' : ''}" data-screen-id="${escapeHtml(screen.id)}" data-w="${screen.width}" data-h="${screen.height}" aria-label="${escapeHtml(screen.name)}" aria-hidden="${active ? 'false' : 'true'}" style="${style}">`,
    nodes,
    `</section>`,
  ].join('\n');
}

/* ------------------------------------------------------------------ HTML 外壳 */

const BASE_CSS = `*{box-sizing:border-box}
html,body{margin:0;padding:0;width:100%;height:100%;background:#05060a;color:#e8ecf4;font-family:${FONT_STACK};overflow:hidden}
.uis-app{position:fixed;inset:0;display:flex;align-items:center;justify-content:center}
.uis-viewport{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden;background:radial-gradient(1200px 800px at 50% 28%,rgba(76,141,255,0.12),rgba(5,6,10,0) 70%),#05060a}
.uis-stage{position:relative;transform-origin:center center;transition:width .3s ease,height .3s ease}
.uis-screen{position:absolute;left:0;top:0;overflow:hidden;opacity:0;visibility:hidden;pointer-events:none;font-family:inherit;border-radius:14px;box-shadow:0 32px 90px rgba(0,0,0,.66),0 0 0 1px rgba(255,255,255,.06)}
.uis-screen.is-active{opacity:1;visibility:visible;pointer-events:auto;z-index:2}
.uis-screen.is-anim{animation:uis-screen-in .34s cubic-bezier(.2,.7,.2,1)}
.uis-node{box-sizing:border-box}
.uis-node.is-hidden{display:none!important}
.uis-node[data-action]{cursor:pointer}
.uis-node[role="button"]{cursor:pointer}
.uis-node:focus-visible{outline:2px solid #7FB0FF;outline-offset:2px}
.uis-field:focus{outline:1px solid rgba(127,176,255,.65);outline-offset:-1px}
@keyframes uis-screen-in{from{opacity:0;transform:translateY(10px) scale(.995)}to{opacity:1;transform:none}}
@keyframes uis-slide-left{from{opacity:0;transform:translateX(48px)}to{opacity:1;transform:none}}
@keyframes uis-slide-up{from{opacity:0;transform:translateY(48px)}to{opacity:1;transform:none}}
@keyframes uis-scale{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:none}}
.uis-stage[data-transition="slide-left"] .uis-screen.is-anim{animation-name:uis-slide-left}
.uis-stage[data-transition="slide-up"] .uis-screen.is-anim{animation-name:uis-slide-up}
.uis-stage[data-transition="scale"] .uis-screen.is-anim{animation-name:uis-scale}
.uis-stage[data-transition="none"] .uis-screen.is-anim{animation:none}
@media (prefers-reduced-motion:reduce){.uis-screen,.uis-stage{transition:none;animation:none!important}}`;

const RUNTIME_JS = `(function () {
  'use strict';
  var dataEl = document.getElementById('uis-data');
  var data = {};
  try { data = JSON.parse(dataEl ? dataEl.textContent || '{}' : '{}'); } catch (err) { data = {}; }
  var stage = document.getElementById('uis-stage');
  if (!stage) return;
  var screens = Array.prototype.slice.call(stage.querySelectorAll('.uis-screen'));
  var historyStack = [];
  var current = data.start || (screens[0] ? screens[0].getAttribute('data-screen-id') : '');
  function screenEl(id) {
    for (var i = 0; i < screens.length; i++) if (screens[i].getAttribute('data-screen-id') === id) return screens[i];
    return null;
  }
  function fit() {
    var scr = screenEl(current) || screens[0];
    if (!scr) return;
    var w = parseFloat(scr.getAttribute('data-w')) || 960;
    var h = parseFloat(scr.getAttribute('data-h')) || 640;
    stage.style.width = w + 'px';
    stage.style.height = h + 'px';
    var pad = Math.min(64, Math.max(16, Math.round(Math.min(window.innerWidth, window.innerHeight) * 0.06)));
    var scale = Math.min((window.innerWidth - pad * 2) / w, (window.innerHeight - pad * 2) / h, 1);
    if (!isFinite(scale) || scale <= 0) scale = 1;
    stage.style.transform = 'scale(' + scale + ')';
  }
  function activate(id) {
    current = id;
    for (var i = 0; i < screens.length; i++) {
      var el = screens[i];
      var on = el.getAttribute('data-screen-id') === id;
      el.classList.toggle('is-active', on);
      el.setAttribute('aria-hidden', on ? 'false' : 'true');
      if (on) {
        el.classList.remove('is-anim');
        void el.offsetWidth;
        el.classList.add('is-anim');
      }
    }
    fit();
  }
  function go(id, transition) {
    if (!id || id === current || !screenEl(id)) return;
    historyStack.push(current);
    stage.setAttribute('data-transition', transition || 'fade');
    activate(id);
    try { window.history.replaceState(null, '', '#' + id); } catch (err) {}
  }
  function back() {
    if (!historyStack.length) return;
    stage.setAttribute('data-transition', 'fade');
    activate(historyStack.pop());
  }
  function toggleNode(targetId) {
    var el = targetId ? document.querySelector('[data-ui-node="' + targetId + '"]') : null;
    if (!el) return;
    var type = el.getAttribute('data-ui-type');
    if (type === 'toggle' || el.getAttribute('role') === 'switch') {
      var on = el.getAttribute('aria-checked') !== 'true';
      el.setAttribute('aria-checked', on ? 'true' : 'false');
      el.classList.toggle('is-on', on);
      return;
    }
    var hidden = el.classList.toggle('is-hidden');
    el.setAttribute('aria-hidden', hidden ? 'true' : 'false');
  }
  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!target || !target.closest) return;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    var el = target.closest('[data-action]');
    if (!el) return;
    var action = el.getAttribute('data-action');
    if (action === 'navigate') go(el.getAttribute('data-screen'), el.getAttribute('data-transition'));
    else if (action === 'url') {
      var url = el.getAttribute('data-url');
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } else if (action === 'back') back();
    else if (action === 'toggle') toggleNode(el.getAttribute('data-target') || el.getAttribute('data-ui-node'));
    else if (action === 'copy') {
      var copyText = el.getAttribute('data-copy') || '';
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(copyText);
    }
    event.preventDefault();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    var target = event.target;
    if (!target || !target.closest) return;
    var el = target.closest('[data-action]');
    if (!el) return;
    event.preventDefault();
    el.click();
  });
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', fit);
  var fromHash = (window.location.hash || '').replace('#', '');
  activate(screenEl(fromHash) ? fromHash : current);
})();`;

function emptyPage(title: string, message: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>html,body{margin:0;height:100%;background:#05060a;color:#e8ecf4;font-family:${FONT_STACK}}body{display:flex;align-items:center;justify-content:center}.uis-empty{max-width:520px;padding:32px;border:1px solid rgba(255,255,255,.12);border-radius:16px;background:rgba(15,17,24,.82);text-align:center;line-height:1.7}.uis-empty strong{display:block;font-size:18px;margin-bottom:8px}</style>
</head>
<body>
<div class="uis-empty"><strong>${escapeHtml(message)}</strong>由「便捷工具 · UI 编辑器」导出</div>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ 导出：自包含 HTML */

export function exportStandaloneHtml(project: UIProject, options: StandaloneHtmlOptions = {}): string {
  const title = options.title ?? project.name ?? 'UI 设计稿';
  const requested = options.screenIds;
  const screens = requested && requested.length
    ? project.screens.filter((screen) => requested.includes(screen.id))
    : project.screens;

  if (!screens.length) {
    return emptyPage(title, project.screens.length ? '所选屏幕不存在' : '工程暂无屏幕');
  }

  const ctx = createRenderContext();
  const screensHtml = screens
    .map((screen, index) => renderScreenHtml(ctx, project, screen, index === 0))
    .join('\n');

  const interactions: Record<string, UIInteraction> = {};
  for (const node of Object.values(project.nodes)) {
    if (node.interaction && node.interaction.action !== 'none') interactions[node.id] = node.interaction;
  }

  const screenNames: Record<string, string> = {};
  for (const screen of screens) screenNames[screen.id] = screen.name;

  const runtimeData = {
    title,
    start: screens[0]?.id ?? '',
    screenNames,
    interactions,
  };

  const css = [BASE_CSS, ...ctx.rules].join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="便捷工具 · UI 编辑器">
<title>${escapeHtml(title)}</title>
<style>
${css}
</style>
</head>
<body>
<div class="uis-app">
  <main class="uis-viewport" aria-label="${escapeHtml(title)}">
    <div class="uis-stage" id="uis-stage" data-transition="fade">
${screensHtml}
    </div>
  </main>
</div>
<script type="application/json" id="uis-data">${jsonForScript(runtimeData)}</script>
<script>${RUNTIME_JS}</script>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ 导出：工程 JSON */

export function exportProjectJson(project: UIProject): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}

/* ------------------------------------------------------------------ 导出：React 组件 */

function componentName(screen: UIScreen, index: number): string {
  const words = screen.name
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  if (!words.length) return `UIScreen${index + 1}`;
  let base = `UIScreen${words.join('')}`;
  if (/^[0-9]/.test(base)) base = `UIScreen${base}`;
  return base;
}

function reactCssRules(ctx: RenderContext): string {
  return ctx.rules.join('\n');
}

function renderReactContent(ctx: RenderContext, node: UINode, cls: string, depth: number): string {
  const space = '  '.repeat(depth);
  const style = node.style;
  switch (node.type) {
    case 'text':
    case 'button':
    case 'badge': {
      const value = node.type === 'badge' ? node.label ?? node.text ?? '' : node.text ?? '';
      return `${space}<div style={${styleObjectLiteral(textInnerCss(node))}}>{${jsonLiteral(value)}}</div>`;
    }
    case 'input': {
      return `${space}<input defaultValue={${jsonLiteral(node.value ?? '')}} placeholder={${jsonLiteral(node.placeholder ?? '')}} aria-label={${jsonLiteral(node.name)}} style={${styleObjectLiteral(fieldCss(node, false))}} />`;
    }
    case 'textarea': {
      return `${space}<textarea defaultValue={${jsonLiteral(node.value ?? '')}} placeholder={${jsonLiteral(node.placeholder ?? '')}} aria-label={${jsonLiteral(node.name)}} style={${styleObjectLiteral(fieldCss(node, true))}} />`;
    }
    case 'toggle': {
      const height = Math.max(12, style.height);
      const knob = Math.max(8, Math.min(height - 6, height));
      return `${space}<div style={${styleObjectLiteral({
        position: 'absolute',
        left: '3px',
        top: '50%',
        width: `${knob}px`,
        height: `${knob}px`,
        borderRadius: '999px',
        background: '#fff',
        transform: 'translateY(-50%)',
        boxShadow: '0 1px 3px rgba(0,0,0,.45)',
      })}} />`;
    }
    case 'slider': {
      const percent = clampPercent(node.percent);
      const fill = `${space}<div style={${styleObjectLiteral({
        position: 'absolute',
        left: 0,
        top: 0,
        height: '100%',
        width: `${percent}%`,
        borderRadius: '999px',
        background: ACCENT,
      })}} />`;
      const thumb = `${space}<div style={${styleObjectLiteral({
        position: 'absolute',
        top: '50%',
        left: `${percent}%`,
        width: '14px',
        height: '14px',
        borderRadius: '999px',
        background: '#fff',
        transform: 'translate(-50%,-50%)',
        boxShadow: '0 2px 6px rgba(0,0,0,.45)',
      })}} />`;
      return `${fill}\n${thumb}`;
    }
    case 'progress': {
      const percent = clampPercent(node.percent);
      return `${space}<div style={${styleObjectLiteral({
        position: 'absolute',
        left: 0,
        top: 0,
        height: '100%',
        width: `${percent}%`,
        borderRadius: '999px',
        background: ACCENT,
      })}} />`;
    }
    case 'tabs': {
      const items = node.items ?? [];
      const active = node.value ? items.indexOf(node.value) : 0;
      const activeIndex = active >= 0 ? active : 0;
      const rows = items.map((item, index) => {
        const tabStyle: CssObject = {
          position: 'relative',
          flex: '1 1 0',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: `${style.fontSize}px`,
          color: index === activeIndex ? style.color : MUTED,
          fontWeight: index === activeIndex ? 600 : 400,
        };
        return `${space}  <div key={${index}} style={${styleObjectLiteral(tabStyle)}}>{${jsonLiteral(item)}}</div>`;
      });
      return [
        `${space}<div style={${styleObjectLiteral({ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center' })}}>`,
        ...rows,
        `${space}</div>`,
      ].join('\n');
    }
    case 'list': {
      const items = node.items ?? [];
      if (!items.length) return '';
      const rows = items.map((item, index) => {
        const rowStyle: CssObject = {
          display: 'flex',
          alignItems: 'center',
          flex: '1 1 0',
          fontSize: `${style.fontSize}px`,
          color: style.color,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        };
        if (index < items.length - 1) rowStyle.borderBottom = '1px solid rgba(255,255,255,0.06)';
        return `${space}  <div key={${index}} style={${styleObjectLiteral(rowStyle)}}>{${jsonLiteral(item)}}</div>`;
      });
      return [
        `${space}<div style={${styleObjectLiteral({ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', padding: '6px 14px' })}}>`,
        ...rows,
        `${space}</div>`,
      ].join('\n');
    }
    case 'image':
    case 'avatar': {
      const src = node.image?.src ?? '';
      if (src) {
        return `${space}<img src={${jsonLiteral(src)}} alt={${jsonLiteral(node.image?.alt ?? node.name)}} style={${styleObjectLiteral({
          position: 'absolute',
          inset: 0,
          display: 'block',
          width: '100%',
          height: '100%',
          objectFit: node.image?.fit ?? 'cover',
        })}} />`;
      }
      if (node.type === 'avatar') {
        return `${space}<div style={${styleObjectLiteral({ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: style.color })}} dangerouslySetInnerHTML={{ __html: ${jsonLiteral(iconSvg('user', style.color))} }} />`;
      }
      return `${space}<div style={${styleObjectLiteral({ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.38)' })}} dangerouslySetInnerHTML={{ __html: ${jsonLiteral(iconSvg('image', 'rgba(255,255,255,0.38)'))} }} />`;
    }
    case 'icon': {
      const color = node.icon?.color ?? style.color ?? '#E8ECF4';
      const name = node.icon?.name ?? 'sparkle';
      return `${space}<div style={${styleObjectLiteral({ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color })}} dangerouslySetInnerHTML={{ __html: ${jsonLiteral(iconSvg(name, color))} }} />`;
    }
    default:
      return '';
  }
}

function renderReactNode(ctx: RenderContext, project: UIProject, node: UINode | undefined, seen: Set<string>, depth: number): string {
  if (!node || seen.has(node.id)) return '';
  seen.add(node.id);
  const space = '  '.repeat(depth);
  const cls = classFor(ctx, node.id);
  ctx.rules.push(`.${cls}{${styleToDecl(nodeCss(node), false)}}`);
  ctx.rules.push(...stateCssRules(node, cls, true));

  const classes = ['uis-react-node', cls];
  if (node.checked && node.type === 'toggle') classes.push('is-on');
  const attrs: string[] = [
    `className="${classes.join(' ')}"`,
    `data-ui-node="${escapeHtml(node.id)}"`,
    `data-ui-type="${escapeHtml(node.type)}"`,
  ];
  if (node.name) attrs.push(`aria-label="${escapeHtml(node.name)}"`);
  if (node.type === 'toggle') {
    attrs.push('role="switch"', `aria-checked={${node.checked ? 'true' : 'false'}}`, 'tabIndex={0}');
  } else if (node.interaction && node.interaction.action !== 'none') {
    attrs.push('role="button"', 'tabIndex={0}');
  }
  const interaction = node.interaction;
  if (interaction && interaction.action !== 'none') {
    attrs.push(`data-action="${escapeHtml(interaction.action)}"`);
    if (interaction.event) attrs.push(`data-event="${escapeHtml(interaction.event)}"`);
    if (interaction.screenId) attrs.push(`data-screen="${escapeHtml(interaction.screenId)}"`);
    if (interaction.url) attrs.push(`data-url="${escapeHtml(interaction.url)}"`);
    if (interaction.target) attrs.push(`data-target="${escapeHtml(interaction.target)}"`);
  }

  const content = renderReactContent(ctx, node, cls, depth + 1);
  const children = node.children
    .map((childId) => renderReactNode(ctx, project, project.nodes[childId], seen, depth + 1))
    .filter(Boolean)
    .join('\n');
  const body = [content, children].filter(Boolean).join('\n');
  const nodeStyle = nodeCss(node);
  if (!node.style.visible) nodeStyle.display = 'none';
  const styleLiteral = styleObjectLiteral(nodeStyle);
  if (!body) {
    return `${space}<div ${attrs.join(' ')} style={${styleLiteral}} />`;
  }
  return `${space}<div ${attrs.join(' ')} style={${styleLiteral}}>
${body}
${space}</div>`;
}

export function exportReactComponent(project: UIProject, screenId?: string): ReactExportResult {
  const screen = project.screens.find((item) => item.id === screenId) ?? project.screens[0];
  if (!screen) {
    return {
      tsx: `/* 工程暂无屏幕 */\nexport default function UIScreenEmpty() {\n  return null;\n}\n`,
      css: '',
    };
  }

  const ctx = createRenderContext();
  const seen = new Set<string>();
  const children = screen.rootIds
    .map((id) => renderReactNode(ctx, project, project.nodes[id], seen, 3))
    .filter(Boolean)
    .join('\n');

  const name = componentName(screen, 0);
  const screenStyle = styleObjectLiteral({
    position: 'relative',
    width: `${screen.width}px`,
    height: `${screen.height}px`,
    overflow: 'hidden',
    borderRadius: '14px',
    background: screen.background,
    color: '#e8ecf4',
    fontFamily: FONT_STACK,
    boxSizing: 'border-box',
  });

  const tsx = `/* 由「便捷工具 · UI 编辑器」导出 · 屏幕：${screen.name}（${screen.width} × ${screen.height}） */
import type { CSSProperties } from 'react';

export const SCREEN_STYLE: CSSProperties = ${screenStyle};

export function ${name}() {
  return (
    <div className="uis-react-screen" style={SCREEN_STYLE} data-screen-id="${escapeHtml(screen.id)}" aria-label="${escapeHtml(screen.name)}">
${children}
    </div>
  );
}

export default ${name};
`;

  const css = [
    ':root{color-scheme:dark}',
    `.uis-react-screen{position:relative;overflow:hidden;box-sizing:border-box}`,
    `.uis-react-screen *{box-sizing:border-box}`,
    `.uis-react-node{transition:opacity .2s ease}`,
    `.uis-react-node:focus-visible{outline:2px solid ${ACCENT_SOFT};outline-offset:2px}`,
    `.uis-react-node[data-action]{cursor:pointer}`,
    `@media (prefers-reduced-motion:reduce){.uis-react-node{transition:none}}`,
    '#react-export-root{background:#05060a;min-height:100vh;display:flex;align-items:center;justify-content:center}',
    reactCssRules(ctx),
  ]
    .filter(Boolean)
    .join('\n');

  return {
    tsx,
    css: `${css}\n`,
    html: exportScreenSnippet(project, screen.id),
  };
}

/* ------------------------------------------------------------------ 导出：单屏片段 */

export function exportScreenSnippet(project: UIProject, screenId: string): string {
  const screen = project.screens.find((item) => item.id === screenId) ?? project.screens[0];
  if (!screen) return '<!-- 便捷工具 UI 编辑器：工程暂无屏幕，无法导出片段 -->\n';

  const ctx = createRenderContext();
  const seen = new Set<string>();
  const nodes = screen.rootIds
    .map((id) => renderNodeHtml(ctx, project, project.nodes[id], seen))
    .filter(Boolean)
    .join('\n');

  const header = [
    '<!-- ============================================================',
    '  便捷工具 UI 编辑器 · 单屏片段导出',
    `  屏幕：${screen.name} · ${screen.width} × ${screen.height}`,
    '  用法：把 <style> 与 .uis-snippet 容器一起粘贴到目标页面。',
    '  交互属性 data-action / data-screen / data-target 等已保留，',
    '  可自行用事件委托处理（参考完整 HTML 导出的运行时）。',
    '  ============================================================ -->',
  ].join('\n');

  const styles = [
    '<style>',
    `.uis-snippet{position:relative;width:${screen.width}px;height:${screen.height}px;overflow:hidden;border-radius:14px;background:${escapeHtml(screen.background)};color:#e8ecf4;font-family:${FONT_STACK}}`,
    '.uis-snippet .uis-node{box-sizing:border-box}',
    '.uis-snippet .uis-node[data-action]{cursor:pointer}',
    '.uis-snippet .uis-node:focus-visible{outline:2px solid #7FB0FF;outline-offset:2px}',
    ...ctx.rules,
    '</style>',
  ].join('\n');

  return `${header}\n${styles}\n<div class="uis-snippet" data-screen-id="${escapeHtml(screen.id)}" aria-label="${escapeHtml(screen.name)}">\n${nodes}\n</div>\n`;
}
