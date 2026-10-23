/* ============================================================
 * 便捷工具 · UI 编辑器：组件预设 / 页面模板 / 导出器测试（node:test）
 *
 * 用 esbuild 把 shared + main 的纯 TS 模块打包成 CJS，再在 Node 里断言：
 *  - 29 个组件预设结构合法、instantiatePreset 重新生成 id 并重映射父子引用
 *  - 7 个页面模板的屏幕 / 节点树 / 尺寸 / 节点数 / 独立性
 *  - 自包含 HTML 导出的屏幕、文本转义（脚本注入不可执行）、交互 data-action、无外部资源
 *  - JSON round-trip、React/TSX（esbuild 语法校验）、单屏片段
 * 不启动 Electron / 不构建应用。
 * ============================================================ */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const TEMPLATE_SIZES = {
  blank: [960, 640],
  login: [960, 640],
  dashboard: [1280, 800],
  settings: [960, 640],
  media: [1100, 700],
  'mobile-profile': [390, 844],
  kanban: [1280, 800],
};

let apiPromise = null;
let tempWork = null;

/** 用 esbuild 打包所有被测纯函数模块，返回 CJS 导出的 API。 */
function loadApi() {
  if (!apiPromise) {
    apiPromise = (async () => {
      const { build } = await import('esbuild');
      const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-uieditor-export-'));
      tempWork = work;
      const entry = path.join(work, 'entry.ts');
      const modules = [
        'src/shared/uieditor',
        'src/shared/uieditor-kit',
        'src/shared/uieditor-presets',
        'src/shared/uieditor-templates',
        'src/main/core/uieditor/export',
      ].map((relative) => JSON.stringify(path.join(repoRoot, relative).replace(/\\/g, '/')));
      fs.writeFileSync(entry, modules.map((modulePath) => `export * from ${modulePath};`).join('\n'), 'utf8');
      const outfile = path.join(work, 'api.cjs');
      await build({
        entryPoints: [entry],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        outfile,
        logLevel: 'silent',
      });
      const require = createRequire(import.meta.url);
      return require(outfile);
    })();
  }
  return apiPromise;
}

after(() => {
  if (tempWork) fs.rmSync(tempWork, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ 校验工具 */

/** 校验一组「相对节点」（组件预设）：单一根、id 唯一、children/parentId 一致、无孤儿、根尺寸匹配。 */
function validateStandaloneNodes(nodes, width, height) {
  assert.ok(Array.isArray(nodes) && nodes.length >= 1, '预设应返回非空节点数组');
  const map = new Map(nodes.map((node) => [node.id, node]));
  assert.equal(map.size, nodes.length, '节点 id 必须唯一');

  const roots = nodes.filter((node) => node.parentId === null);
  assert.equal(roots.length, 1, '组件预设应当只有一个根节点（parentId = null）');
  assert.equal(roots[0].style.width, width, '根节点宽度应与预设声明一致');
  assert.equal(roots[0].style.height, height, '根节点高度应与预设声明一致');

  const seen = new Set();
  const visit = (node) => {
    assert.ok(!seen.has(node.id), `节点重复引用 / 存在环：${node.id}`);
    seen.add(node.id);
    for (const childId of node.children) {
      const child = map.get(childId);
      assert.ok(child, `children 引用了不存在的节点：${childId}`);
      assert.equal(child.parentId, node.id, '子节点 parentId 应指回父节点');
      visit(child);
    }
  };
  visit(roots[0]);
  assert.equal(seen.size, nodes.length, '存在未挂载的孤儿节点');
}

/** 校验工程中某个屏幕的节点树，返回可达节点集合。 */
function validateProjectScreen(project, screen) {
  const seen = new Set();
  const visit = (id, parentId) => {
    const node = project.nodes[id];
    assert.ok(node, `屏幕 ${screen.name} 引用了不存在的节点：${id}`);
    assert.equal(node.parentId, parentId, '节点 parentId 与父级不一致');
    assert.ok(!seen.has(id), `节点重复引用 / 存在环：${id}`);
    seen.add(id);
    for (const childId of node.children) visit(childId, id);
  };
  for (const rootId of screen.rootIds) visit(rootId, null);
  return seen;
}

/** 双屏 + 特殊字符 + 交互 + 图片 + 状态样式的测试工程。 */
function makeCustomProject(api) {
  const project = api.createProject('导出测试', 480, 320);
  const screen1 = project.screens[0];
  const screen2 = api.createScreen(project, '第二屏', 480, 320);

  const navButton = api.createNode('button', {
    text: '去第二屏',
    style: { x: 24, y: 24, width: 160, height: 44 },
    interaction: { event: 'click', action: 'navigate', screenId: screen2.id, transition: 'slide-left' },
  });
  const weirdText = api.createNode('text', {
    text: '100% "引号" <script>alert("x")</script> 你好 🎉\n第二行',
    style: { x: 20, y: 200, width: 440, height: 60 },
  });
  const image = api.createNode('image', {
    style: { x: 20, y: 120, width: 80, height: 60 },
    image: {
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      fit: 'cover',
      alt: '像素',
    },
  });
  const icon = api.createNode('icon', {
    style: { x: 120, y: 120, width: 24, height: 24 },
    icon: { name: 'home', color: '#7FB0FF' },
  });
  const toggle = api.createNode('toggle', {
    checked: true,
    style: { x: 300, y: 60, width: 44, height: 24 },
    interaction: { event: 'click', action: 'toggle' },
  });
  const hoverRect = api.createNode('rect', {
    style: { x: 300, y: 120, width: 60, height: 40, fill: '#111111' },
    states: { hover: { fill: '#333333' }, pressed: { fill: '#222222' } },
  });

  api.insertNodes(project, screen1.id, [navButton, weirdText, image, icon, toggle, hoverRect]);
  api.insertNodes(project, screen2.id, [
    api.createNode('text', { text: '第二屏内容', style: { x: 20, y: 20, width: 300, height: 40 } }),
    api.createNode('button', {
      text: '返回',
      style: { x: 20, y: 80, width: 100, height: 40 },
      interaction: { event: 'click', action: 'back' },
    }),
    api.createNode('button', {
      text: '打开文档',
      style: { x: 140, y: 80, width: 120, height: 40 },
      interaction: { event: 'click', action: 'url', url: 'https://example.com/docs' },
    }),
    api.createNode('button', {
      text: '复制链接',
      style: { x: 20, y: 140, width: 120, height: 40 },
      interaction: { event: 'click', action: 'copy' },
    }),
  ]);

  return { project, screen1, screen2 };
}

/* ------------------------------------------------------------------ 组件预设 */

test('组件预设：≥22 个、六分类齐全、节点树结构合法', async () => {
  const api = await loadApi();
  const presets = api.UI_COMPONENT_PRESETS;
  assert.ok(Array.isArray(presets));
  assert.ok(presets.length >= 22, `组件预设数量不足：${presets.length}`);

  const ids = new Set();
  const categories = new Set();
  for (const preset of presets) {
    assert.equal(typeof preset.id, 'string');
    assert.ok(preset.id.length > 0);
    assert.ok(!ids.has(preset.id), `预设 id 重复：${preset.id}`);
    ids.add(preset.id);

    assert.ok(preset.name && preset.name.length > 0);
    assert.ok(preset.icon && preset.icon.length > 0);
    assert.ok(preset.description && preset.description.length > 0);
    assert.ok(api.UI_COMPONENT_CATEGORIES.includes(preset.category), `未知分类：${preset.category}`);
    categories.add(preset.category);
    assert.ok(preset.width > 0 && preset.height > 0);

    const nodes = preset.create();
    assert.ok(Array.isArray(nodes));
    validateStandaloneNodes(nodes, preset.width, preset.height);

    // 每次 create() 都是新节点（id 不同）
    const again = preset.create();
    const firstIds = new Set(nodes.map((node) => node.id));
    assert.ok(again.some((node) => !firstIds.has(node.id)), `${preset.id} create() 未生成新 id`);
  }

  assert.deepEqual([...categories].sort(), [...api.UI_COMPONENT_CATEGORIES].sort(), '组件分类应覆盖全部六个分类');
  assert.equal(api.findPreset('__missing__'), undefined);
  assert.equal(api.findPreset('button')?.id, 'button');
});

test('instantiatePreset：深拷贝、重新生成 id、重映射 parentId / children', async () => {
  const api = await loadApi();
  assert.deepEqual(api.instantiatePreset('__missing__'), []);

  for (const preset of api.UI_COMPONENT_PRESETS) {
    const original = preset.create();
    const cloneA = api.instantiatePreset(preset.id);
    assert.equal(cloneA.length, original.length);
    validateStandaloneNodes(cloneA, preset.width, preset.height);

    const originalIds = new Set(original.map((node) => node.id));
    for (const node of cloneA) {
      assert.ok(!originalIds.has(node.id), `${preset.id} 实例化后仍保留旧 id：${node.id}`);
    }

    // 两次实例化互不共享节点对象 / id
    const cloneB = api.instantiatePreset(preset.id);
    const idsB = new Set(cloneB.map((node) => node.id));
    for (const node of cloneA) assert.ok(!idsB.has(node.id), '两次实例化的 id 不应相同');
    assert.notEqual(cloneA[0], cloneB[0]);
  }
});

/* ------------------------------------------------------------------ 页面模板 */

test('页面模板：≥7 个、屏幕与节点树合法、尺寸正确、节点数达标', async () => {
  const api = await loadApi();
  const templates = api.UIEDITOR_TEMPLATES;
  assert.ok(Array.isArray(templates));
  assert.ok(templates.length >= 7, `页面模板数量不足：${templates.length}`);

  const ids = new Set();
  for (const template of templates) {
    assert.ok(!ids.has(template.id), `模板 id 重复：${template.id}`);
    ids.add(template.id);
    assert.ok(['page', 'layout', 'component'].includes(template.category), `模板分类非法：${template.category}`);
    assert.ok(template.name && template.description);
    assert.match(template.accent, /^#[0-9a-fA-F]{6}$/);
    assert.ok(Array.isArray(template.tags) && template.tags.length > 0);

    const project = template.create();
    assert.equal(project.name, template.name);
    assert.ok(project.screens.length >= 1, `${template.id} 至少应有一个屏幕`);

    let total = 0;
    for (const screen of project.screens) {
      assert.ok(screen.rootIds.length >= 1, `${template.id} 屏幕缺少根节点`);
      assert.ok(screen.width > 0 && screen.height > 0);
      assert.equal(typeof screen.background, 'string');
      total += validateProjectScreen(project, screen).size;

      // 画板根 frame 与屏幕尺寸一致
      const board = project.nodes[screen.rootIds[0]];
      assert.ok(board);
      assert.equal(board.style.width, screen.width);
      assert.equal(board.style.height, screen.height);
    }

    assert.equal(total, Object.keys(project.nodes).length, `${template.id} 存在孤儿节点`);

    const [expectedWidth, expectedHeight] = TEMPLATE_SIZES[template.id] ?? [];
    assert.equal(project.screens[0].width, expectedWidth, `${template.id} 宽度不符`);
    assert.equal(project.screens[0].height, expectedHeight, `${template.id} 高度不符`);

    if (template.id === 'blank') {
      assert.ok(total <= 2, '空白模板应只有画板');
    } else {
      assert.ok(total >= 20, `${template.id} 节点数不足：${total}`);
      const texts = Object.values(project.nodes).filter((node) => node.type === 'text');
      assert.ok(texts.length >= 3, `${template.id} 缺少文本节点`);
      assert.ok(texts.some((node) => typeof node.text === 'string' && node.text.length > 0));
    }

    // 两次 create() 应是彼此独立的工程
    const second = template.create();
    assert.notEqual(second.id, project.id, `${template.id} create() 复用了工程 id`);
    assert.notEqual(second.screens[0].id, project.screens[0].id);
    assert.equal(Object.keys(second.nodes).length, Object.keys(project.nodes).length);
  }

  assert.equal(api.findTemplate('__missing__'), undefined);
  assert.ok(api.findTemplate('login'));
  assert.ok(api.findTemplate('dashboard'));
  assert.ok(api.findTemplate('settings'));
});

/* ------------------------------------------------------------------ HTML 导出 */

test('HTML 导出：自包含、多屏、文本转义、data-action 交互、无 undefined', async () => {
  const api = await loadApi();
  const { project, screen2 } = makeCustomProject(api);
  const html = api.exportStandaloneHtml(project);

  assert.match(html, /^<!doctype html>/);
  assert.ok(html.includes('<style>'));
  assert.ok(html.includes('</style>'));
  assert.ok(html.includes('id="uis-stage"'));
  assert.equal((html.match(/class="uis-screen/g) ?? []).length, 2, '应输出两个屏幕容器');

  // 交互：navigate / toggle + 可访问性
  assert.match(html, /data-action="navigate"/);
  assert.match(html, new RegExp(`data-screen="${screen2.id}"`));
  assert.match(html, /data-transition="slide-left"/);
  assert.match(html, /data-action="toggle"/);
  assert.match(html, /data-action="back"/);
  assert.match(html, /data-action="url"/);
  assert.match(html, /data-url="https:\/\/example\.com\/docs"/);
  assert.match(html, /data-action="copy"/);
  assert.match(html, /data-copy="复制链接"/);
  assert.match(html, /role="switch"/);
  assert.match(html, /role="button"/);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /data-ui-node="/);
  assert.match(html, /data-ui-type="button"/);

  // 文本 / 特殊字符转义（脚本注入不可执行）
  assert.ok(!html.includes('<script>alert('), '注入文本不应产生可执行 <script>');
  assert.ok(html.includes('&lt;script&gt;alert'), '应输出转义后的脚本文本');
  assert.ok(html.includes('100%'));
  assert.ok(html.includes('&quot;引号&quot;'));
  assert.ok(html.includes('🎉'));
  assert.ok(html.includes('第二行'));
  assert.ok(html.includes('第二屏内容'));

  // 图片 dataURL 原样输出 / 图标内联 SVG
  assert.match(html, /src="data:image\/png;base64,/);
  assert.match(html, /<svg[^>]*viewBox="0 0 24 24"/);

  // 状态样式
  assert.match(html, /:hover\{/);
  assert.match(html, /:active\{/);

  // 运行时：JSON 数据 + 事件委托 / 缩放
  assert.match(html, /application\/json" id="uis-data"/);
  assert.match(html, /JSON\.parse/);
  assert.match(html, /addEventListener\('click'/);
  assert.match(html, /addEventListener\('resize'/);
  assert.match(html, /historyStack/);
  assert.ok(!html.includes('onclick='), '不应使用内联 onclick 属性');

  // 无 undefined / [object Object] / 外部资源
  assert.ok(!html.includes('undefined'));
  assert.ok(!html.includes('[object Object]'));
  assert.ok(!/(?:src|href)="https?:\/\//.test(html), '不应引用外部网络资源');
  assert.ok(!html.includes('@import'));

  // script 标签数量守恒（注入文本不应新增标签）
  assert.equal((html.match(/<script/g) ?? []).length, 2);
  assert.equal((html.match(/<\/script>/g) ?? []).length, 2);

  // div / section 标签配平（嵌套结构完整闭合）
  assert.equal((html.match(/<div/g) ?? []).length, (html.match(/<\/div>/g) ?? []).length);
  assert.equal((html.match(/<section/g) ?? []).length, (html.match(/<\/section>/g) ?? []).length);

  // 运行时脚本语法合法（new Function 只编译不执行）
  const runtimeMatch = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(runtimeMatch, '应包含运行时脚本');
  assert.doesNotThrow(() => new Function(runtimeMatch[1]));

  // 单屏筛选 + 自定义标题
  const onlySecond = api.exportStandaloneHtml(project, { screenIds: [screen2.id] });
  assert.equal((onlySecond.match(/class="uis-screen/g) ?? []).length, 1);
  assert.ok(onlySecond.includes('第二屏内容'));
  assert.ok(!onlySecond.includes('去第二屏'));

  const titled = api.exportStandaloneHtml(project, { title: '自定义 <标题>' });
  assert.ok(titled.includes('<title>自定义 &lt;标题&gt;</title>'));
  assert.match(titled, /<meta name="generator" content="便捷工具 · UI 编辑器">/);
});

test('HTML 导出：全部页面模板可导出、无 undefined、无 [object Object]', async () => {
  const api = await loadApi();
  for (const template of api.UIEDITOR_TEMPLATES) {
    const project = template.create();
    const html = api.exportStandaloneHtml(project);
    assert.match(html, /^<!doctype html>/, template.id);
    assert.ok(html.length > 1000, `${template.id} 导出内容过短`);
    assert.match(html, /class="uis-screen/, template.id);
    assert.ok(html.includes(`data-w="${project.screens[0].width}"`), template.id);
    assert.ok(!html.includes('undefined'), `${template.id} 导出包含 undefined`);
    assert.ok(!html.includes('[object Object]'), `${template.id} 导出包含 [object Object]`);
    assert.match(html, /JSON\.parse/, template.id);
  }
});

/* ------------------------------------------------------------------ JSON 导出 */

test('JSON 导出：round-trip 保持工程结构', async () => {
  const api = await loadApi();
  const project = api.UIEDITOR_TEMPLATES.find((template) => template.id === 'dashboard').create();
  const json = api.exportProjectJson(project);
  assert.equal(typeof json, 'string');
  const parsed = JSON.parse(json);
  assert.deepEqual(parsed, JSON.parse(JSON.stringify(project)));
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.screens.length, project.screens.length);
  assert.deepEqual(Object.keys(parsed.nodes).sort(), Object.keys(project.nodes).sort());
  assert.equal(parsed.tokens.colors.length, project.tokens.colors.length);
  assert.ok(json.endsWith('\n'));
});

/* ------------------------------------------------------------------ React 导出 */

test('React 导出：TSX 语法合法、内联 style、状态 CSS、无 undefined', async () => {
  const api = await loadApi();
  const { transform } = await import('esbuild');
  const { project, screen1 } = makeCustomProject(api);
  const result = api.exportReactComponent(project, screen1.id);

  assert.equal(typeof result.tsx, 'string');
  assert.equal(typeof result.css, 'string');
  assert.match(result.tsx, /import type \{ CSSProperties \} from 'react';/);
  assert.match(result.tsx, /export default UIScreen[A-Za-z0-9_]*;/);
  assert.match(result.tsx, /style=\{\{/, '应输出内联 style 对象');
  assert.match(result.tsx, /className="uis-react-node/);
  assert.match(result.tsx, /data-ui-node="/);
  assert.ok(result.tsx.includes('去第二屏'));
  assert.ok(!result.tsx.includes('第二屏内容'), '单屏导出不应包含其它屏幕内容');
  assert.ok(!result.tsx.includes('undefined'), 'TSX 不应包含 undefined');
  assert.ok(!result.tsx.includes('[object Object]'));

  // 特殊字符以 JS 字符串字面量输出，不产生裸 <script> 标签
  assert.ok(!result.tsx.includes('<script>alert('));
  assert.ok(result.tsx.includes('100%'));

  // CSS：状态样式用 !important 覆盖内联样式
  assert.match(result.css, /:hover/);
  assert.ok(result.css.includes('!important'));

  // 生成的 TSX 能通过 esbuild 的 TSX 语法解析（无未闭合 / 非法 JSX）
  await transform(result.tsx, { loader: 'tsx', jsx: 'automatic' });

  assert.equal(typeof result.html, 'string');
  assert.ok(result.html.includes('uis-snippet'));

  // 默认导出第一个屏幕；每个模板的 React 导出都可解析
  const fallback = api.exportReactComponent(project);
  await transform(fallback.tsx, { loader: 'tsx', jsx: 'automatic' });
  for (const template of api.UIEDITOR_TEMPLATES) {
    const exported = api.exportReactComponent(template.create());
    assert.ok(exported.tsx.includes('export default'));
    assert.ok(!exported.tsx.includes('undefined'), `${template.id} React 导出包含 undefined`);
    await transform(exported.tsx, { loader: 'tsx', jsx: 'automatic' });
  }
});

/* ------------------------------------------------------------------ 单屏片段 */

test('单屏片段导出：注释 + style + 节点', async () => {
  const api = await loadApi();
  const project = api.UIEDITOR_TEMPLATES.find((template) => template.id === 'login').create();
  const screen = project.screens[0];
  const snippet = api.exportScreenSnippet(project, screen.id);

  assert.ok(snippet.startsWith('<!--'));
  assert.ok(snippet.includes('单屏片段导出'));
  assert.ok(snippet.includes('<style>'));
  assert.ok(snippet.includes('width:960px'));
  assert.ok(snippet.includes('height:640px'));
  assert.ok(snippet.includes('uis-snippet'));
  assert.ok(snippet.includes('欢迎回来'));
  assert.ok(snippet.includes('data-ui-node="'));
  assert.ok(!snippet.includes('undefined'));
  assert.ok(!snippet.includes('[object Object]'));

  // 未知 screenId 回退到第一个屏幕
  const fallback = api.exportScreenSnippet(project, '__missing__');
  assert.ok(fallback.includes('欢迎回来'));
});
