/* ============================================================
 * 便捷工具 · 流光搜索后端测试（node:test）
 * 覆盖：Bing RSS / DuckDuckGo HTML 解析、引擎降级、联想词、
 *       设置限幅与持久化、历史/书签、1MB 流式下载进度、
 *       文件名清洗去重、暂停/继续（Range）、取消/重试/dispose、并发队列。
 *
 * 服务均为纯 TS（fetch/广播注入），测试用 esbuild 打包 + 本地 http server，
 * 不启动 Electron、不访问外网。
 * ============================================================ */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const tempDirs = [];

after(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function makeTempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

let harnessPromise = null;

/** 用 esbuild 打包 TS 服务为 CJS（纯 Node，无 Electron 依赖），返回解析后的模块。 */
function loadSearchModules() {
  if (!harnessPromise) {
    harnessPromise = (async () => {
      const { build } = await import('esbuild');
      const work = makeTempDir('tk-search-harness-');
      const entry = path.join(work, 'entry.ts');
      const toUrl = (relative) => path.join(repoRoot, relative).replace(/\\/g, '/');
      fs.writeFileSync(
        entry,
        [
          `export * as parse from ${JSON.stringify(toUrl('src/main/core/search/parse.ts'))};`,
          `export { SearchService } from ${JSON.stringify(toUrl('src/main/core/search/search-service.ts'))};`,
          `export { DownloadService } from ${JSON.stringify(toUrl('src/main/core/search/download-service.ts'))};`,
          '',
        ].join('\n'),
        'utf8'
      );
      const outfile = path.join(work, 'search-harness.cjs');
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
  return harnessPromise;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check, { timeout = 12_000, interval = 10, message = 'waitFor 超时' } = {}) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    try {
      const value = await check();
      if (value) return value;
    } catch (err) {
      lastError = err;
    }
    await delay(interval);
  }
  throw new Error(`${message}${lastError ? `（最后错误：${lastError.message}）` : ''}`);
}

/* ------------------------------------------------------------------ 测试用 HTTP 服务 */

async function startServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    req.on('error', () => undefined);
    res.on('error', () => undefined);
    requests.push({ url: req.url ?? '', headers: req.headers, method: req.method ?? 'GET' });
    Promise.resolve(handler(req, res, requests)).catch(() => {
      try {
        res.destroy();
      } catch {
        /* ignore */
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: async () => {
      try {
        server.closeAllConnections?.();
      } catch {
        /* ignore */
      }
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function makeData(size) {
  const data = Buffer.alloc(size);
  for (let index = 0; index < size; index += 1) data[index] = index % 251;
  return data;
}

/** 等待响应可写（drain / close / error 任一），避免多次 once() 泄漏监听器。 */
function waitWritable(res) {
  return new Promise((resolve) => {
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      res.off('drain', cleanup);
      res.off('close', cleanup);
      res.off('error', cleanup);
      resolve();
    };
    res.on('drain', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
  });
}

/** 流式返回 Buffer，支持 Range（ignoreRange=true 时忽略 Range 返回 200）。 */
async function streamData(req, res, data, options = {}) {
  const { chunkSize = 65_536, chunkDelay = 0, ignoreRange = false, headers = {} } = options;
  const range = ignoreRange ? null : req.headers.range;
  let start = 0;
  let end = data.length - 1;
  let status = 200;
  const extraHeaders = { ...headers };
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (match) {
      start = Number(match[1]);
      if (match[2]) end = Math.min(Number(match[2]), end);
      if (start >= data.length) {
        res.writeHead(416, { 'Content-Range': `bytes */${data.length}` });
        res.end();
        return;
      }
      status = 206;
      extraHeaders['Content-Range'] = `bytes ${start}-${end}/${data.length}`;
    }
  }
  res.writeHead(status, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': end - start + 1,
    'Accept-Ranges': ignoreRange ? 'none' : 'bytes',
    ...extraHeaders,
  });
  for (let offset = start; offset <= end; offset += chunkSize) {
    if (res.destroyed) return;
    const piece = data.subarray(offset, Math.min(offset + chunkSize, end + 1));
    if (!res.write(piece)) {
      await waitWritable(res);
    }
    if (chunkDelay) await delay(chunkDelay);
  }
  if (!res.writableEnded) res.end();
}

const RSS_XML = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel>
<title>alpha beta - Bing</title>
<item>
  <title><![CDATA[Alpha & Beta — 下载]]></title>
  <link>https://example.com/files/alpha.zip</link>
  <description><![CDATA[Download <b>alpha</b> &amp; more]]></description>
</item>
<item>
  <title>Plain &amp; Simple</title>
  <link>https://example.com/page.html</link>
  <description>a normal web page</description>
</item>
<item>
  <title>Document</title>
  <link><![CDATA[https://example.com/doc.pdf]]></link>
  <description>pdf file</description>
</item>
</channel></rss>`;

const DDG_HTML = `<!doctype html><html><body>
<div class="result results_links results_links_deep web-result">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fddg-one&amp;rut=xyz">DDG One &amp; Only</a>
    </h2>
    <a class="result__snippet" href="#">Snippet <b>one</b> text</a>
  </div>
</div>
<div class="result results_links results_links_deep web-result result--ad">
  <a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Sponsored Ad</a>
</div>
<div class="result results_links results_links_deep web-result">
  <h2 class="result__title"><a class="result__a" href="https://example.com/files/two.zip">Two ZIP</a></h2>
  <div class="result__snippet">Second result</div>
</div>
</body></html>`;

/** 标准测试路由：RSS / DDG / 建议 / 失败 / 文件下载。 */
function createRoutes(state) {
  const files = new Map();

  const getFile = (name, size) => {
    if (!files.has(name)) files.set(name, makeData(size));
    return files.get(name);
  };

  return async (req, res, requests) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;
    if (pathname === '/bing.rss') {
      await delay(5);
      res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
      res.end(RSS_XML);
      return;
    }
    if (pathname === '/ddg') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(DDG_HTML);
      return;
    }
    if (pathname === '/fail') {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('search backend failure');
      return;
    }
    if (pathname === '/suggest') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify([{ phrase: 'alpha' }, { phrase: 'alpha & beta' }, { phrase: 'alpha' }, { text: 'alpha zip' }]));
      return;
    }
    if (pathname === '/files/small.zip') {
      const data = getFile('small', 512);
      await streamData(req, res, data, { chunkSize: 128, chunkDelay: 2 });
      return;
    }
    if (pathname === '/files/report.zip') {
      const data = getFile('report', 256);
      await streamData(req, res, data, { chunkSize: 64, chunkDelay: 20 });
      return;
    }
    if (pathname === '/files/cd') {
      const data = getFile('cd', 128);
      await streamData(req, res, data, {
        chunkSize: 128,
        headers: { 'Content-Disposition': "attachment; filename*=UTF-8''%E6%B5%81%E5%85%89%E6%B5%8B%E8%AF%95.zip" },
      });
      return;
    }
    if (pathname === '/files/1mb.bin') {
      await streamData(req, res, getFile('1mb', 1024 * 1024), { chunkDelay: 4 });
      return;
    }
    if (pathname === '/files/resume.bin') {
      await streamData(req, res, getFile('resume', 2 * 1024 * 1024), { chunkDelay: 10 });
      return;
    }
    if (pathname === '/files/norange.bin') {
      await streamData(req, res, getFile('norange', 1024 * 1024), { chunkDelay: 8, ignoreRange: true });
      return;
    }
    if (pathname === '/files/conc.bin') {
      state.active += 1;
      state.maxActive = Math.max(state.maxActive, state.active);
      try {
        await streamData(req, res, getFile('conc', 512 * 1024), { chunkSize: 32 * 1024, chunkDelay: 15 });
      } finally {
        state.active -= 1;
      }
      return;
    }
    if (pathname === '/files/retry.bin') {
      state.retryHits += 1;
      if (state.retryHits === 1) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('first attempt fails');
        return;
      }
      await streamData(req, res, getFile('retry', 256));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  };
}

function makeSearchPaths() {
  const root = makeTempDir('tk-search-data-');
  return { root, paths: { userData: root } };
}

/* ------------------------------------------------------------------ parse.ts */

test('parse.ts：RSS / DDG HTML / 建议 / 链接 / 文件名校验', async () => {
  const { parse } = await loadSearchModules();

  const rssItems = parse.parseBingRss(RSS_XML);
  assert.equal(rssItems.length, 3);
  assert.equal(rssItems[0].title, 'Alpha & Beta — 下载');
  assert.equal(rssItems[0].url, 'https://example.com/files/alpha.zip');
  assert.equal(rssItems[0].snippet, 'Download alpha & more');
  assert.equal(rssItems[1].title, 'Plain & Simple');
  assert.equal(rssItems[2].url, 'https://example.com/doc.pdf');
  assert.deepEqual(parse.parseBingRss(''), []);

  const ddgItems = parse.parseDuckDuckGoHtml(DDG_HTML);
  assert.equal(ddgItems.length, 2, '广告结果应被过滤');
  assert.equal(ddgItems[0].url, 'https://example.com/ddg-one');
  assert.equal(ddgItems[0].title, 'DDG One & Only');
  assert.equal(ddgItems[0].snippet, 'Snippet one text');
  assert.equal(ddgItems[1].url, 'https://example.com/files/two.zip');
  assert.deepEqual(parse.parseDuckDuckGoHtml('<html></html>'), []);

  assert.deepEqual(parse.parseSuggestions([{ phrase: 'alpha' }, 'beta', 'alpha', { text: 'gamma' }], 10), [
    { text: 'alpha' },
    { text: 'beta' },
    { text: 'gamma' },
  ]);
  assert.deepEqual(parse.parseSuggestions({ suggestions: ['one', 'two'] }, 1), [{ text: 'one' }]);
  assert.deepEqual(parse.parseSuggestions('not-json', 5), []);

  assert.equal(parse.unwrapSearchRedirect('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1&rut=x'), 'https://example.com/a?b=1');
  assert.equal(parse.unwrapSearchRedirect('https://example.com/plain'), 'https://example.com/plain');
  assert.equal(parse.unwrapSearchRedirect('javascript:alert(1)'), '');

  assert.equal(parse.isDownloadableUrl('https://example.com/a.zip'), true);
  assert.equal(parse.isDownloadableUrl('https://example.com/a.pdf?x=1'), true);
  assert.equal(parse.isDownloadableUrl('https://example.com/page.html'), false);
  assert.equal(parse.fileExtensionOf('https://example.com/files/x.TAR.GZ'), '.gz');
  assert.equal(parse.suggestedFileName('https://example.com/files/Alpha%20One.zip'), 'Alpha One.zip');
  assert.equal(parse.suggestedFileName('https://example.com/page', 'some title'), undefined);

  assert.equal(parse.sanitizeFileName('a<b>c:d"e/f\\g|h?i*j'), 'a b c d e f g h i j');
  assert.equal(parse.sanitizeFileName('CON'), '_CON');
  assert.equal(parse.sanitizeFileName('...'), 'download');
  assert.equal(parse.sanitizeFileName(''), 'download');
  assert.ok(parse.sanitizeFileName('x'.repeat(300)).length <= 120);

  assert.equal(parse.escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(parse.decodeHtmlEntities('&lt;b&gt;&amp;&#39;&#x27;&nbsp;'), "<b>&'' ");
  assert.equal(
    parse.extractContentDispositionFilename("attachment; filename*=UTF-8''%E6%B5%81%E5%85%89.zip"),
    '流光.zip'
  );
  assert.equal(parse.extractContentDispositionFilename('attachment; filename="报告 2024.pdf"'), '报告 2024.pdf');

  assert.equal(parse.displayUrlOf('https://www.example.com/a/b/?q=1'), 'example.com/a/b?q=1');

  const bingUrl = parse.buildBingUrl('alpha beta', { count: 10, first: 21, endpoint: 'http://127.0.0.1:1/search' });
  const parsedBing = new URL(bingUrl);
  assert.equal(parsedBing.searchParams.get('q'), 'alpha beta');
  assert.equal(parsedBing.searchParams.get('format'), 'rss');
  assert.equal(parsedBing.searchParams.get('count'), '10');
  assert.equal(parsedBing.searchParams.get('first'), '21');
  assert.ok(parse.buildDuckDuckGoUrl('hello').includes('q=hello'));
  assert.ok(parse.buildSuggestUrl('he', 'http://127.0.0.1:1/suggest').startsWith('http://127.0.0.1:1/suggest?'));
  assert.equal(parse.hasMoreResults(10, 10), true);
  assert.equal(parse.hasMoreResults(3, 10), false);
});

/* ------------------------------------------------------------------ SearchService */

test('SearchService：Bing RSS 搜索 / 降级 / 设置限幅与持久化 / 历史 / 书签', async () => {
  const { SearchService } = await loadSearchModules();
  const state = { active: 0, maxActive: 0, retryHits: 0 };
  const server = await startServer(createRoutes(state));
  try {
    const { root, paths } = makeSearchPaths();
    const service = new SearchService({
      paths,
      logger: silentLogger,
      endpoints: { duckduckgo: `${server.origin}/ddg`, suggest: `${server.origin}/suggest` },
    });
    await service.init();
    assert.deepEqual(service.pathsInfo().saveDir, path.join(root, 'search', 'downloads'));
    assert.equal(service.getSettings().saveDir, '', 'saveDir 空表示使用默认目录');
    assert.equal(service.getSettings().engine, 'bing');
    assert.equal(service.getSettings().resultCount, 10);

    // 保存目录：设置后生效并持久化，空串回退默认目录
    const customDir = path.join(root, 'my-downloads');
    service.patchSettings({ saveDir: customDir });
    assert.equal(service.getSettings().saveDir, customDir);
    assert.equal(service.pathsInfo().saveDir, customDir);
    service.patchSettings({ saveDir: '' });
    assert.equal(service.pathsInfo().saveDir, path.join(root, 'search', 'downloads'));

    const first = await service.search('alpha beta', { endpoint: `${server.origin}/bing.rss`, resultCount: 10 });
    assert.equal(first.engine, 'bing');
    assert.equal(first.query, 'alpha beta');
    assert.equal(first.page, 1);
    assert.equal(first.results.length, 3);
    assert.equal(first.hasMore, false);
    assert.ok(first.elapsedMs >= 0);
    assert.equal(first.results[0].title, 'Alpha & Beta — 下载');
    assert.equal(first.results[0].displayUrl, 'example.com/files/alpha.zip');
    assert.equal(first.results[0].downloadable, true);
    assert.equal(first.results[0].suggestedName, 'alpha.zip');
    assert.equal(first.results[2].downloadable, true);
    assert.equal(first.results[1].downloadable, undefined);
    assert.ok(first.results.every((item) => item.engine === 'bing'));
    assert.equal(new Set(first.results.map((item) => item.id)).size, 3);

    const rssRequest = new URL(server.requests.at(-1).url, server.origin);
    assert.equal(rssRequest.searchParams.get('format'), 'rss');
    assert.equal(rssRequest.searchParams.get('count'), '10');
    assert.equal(rssRequest.searchParams.get('first'), '1');

    const second = await service.search('alpha beta', { endpoint: `${server.origin}/bing.rss`, resultCount: 5, page: 2 });
    assert.equal(second.page, 2);
    const pagedRequest = new URL(server.requests.at(-1).url, server.origin);
    assert.equal(pagedRequest.searchParams.get('first'), '6');
    assert.equal(pagedRequest.searchParams.get('count'), '5');

    // 历史：连续同 query 只更新时间戳
    const history = service.listHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].query, 'alpha beta');
    assert.equal(history[0].resultCount, 3);
    assert.ok(history[0].at.includes('T'));

    // 设置限幅
    const patched = service.patchSettings({ resultCount: 999, concurrentDownloads: 99, engine: 'nope' });
    assert.equal(patched.resultCount, 50);
    assert.equal(patched.concurrentDownloads, 6);
    assert.equal(patched.engine, 'bing');
    const clampedLow = service.patchSettings({ resultCount: 1, concurrentDownloads: 0, engine: 'duckduckgo' });
    assert.equal(clampedLow.resultCount, 5);
    assert.equal(clampedLow.concurrentDownloads, 1);
    assert.equal(clampedLow.engine, 'duckduckgo');

    // 书签：去重 / 非法地址 / 删除
    const bookmark = service.addBookmark({ title: 'Alpha', url: 'https://example.com/files/alpha.zip', snippet: 'dl' });
    assert.ok(bookmark.id.startsWith('sb_'));
    assert.equal(service.addBookmark({ url: 'https://example.com/files/alpha.zip' }).id, bookmark.id);
    assert.equal(service.listBookmarks().length, 1);
    assert.throws(() => service.addBookmark({ url: 'ftp://example.com/a.zip' }), /http\/https/);
    service.addBookmark({ title: 'Doc', url: 'https://example.com/doc.pdf' });
    assert.equal(service.listBookmarks().length, 2);
    assert.equal(service.removeBookmark(bookmark.id).length, 1);

    // 重启后设置 / 历史 / 书签仍在
    const reopened = new SearchService({ paths, logger: silentLogger });
    await reopened.init();
    assert.equal(reopened.getSettings().engine, 'duckduckgo');
    assert.equal(reopened.getSettings().resultCount, 5);
    assert.equal(reopened.getSettings().concurrentDownloads, 1);
    assert.equal(reopened.listHistory().length, 1);
    assert.equal(reopened.listBookmarks().length, 1);
    assert.equal(reopened.listBookmarks()[0].url, 'https://example.com/doc.pdf');

    // historyEnabled=false 不写历史
    service.patchSettings({ historyEnabled: false });
    await service.search('another', { endpoint: `${server.origin}/bing.rss` });
    assert.equal(service.listHistory().length, 1);
    service.clearHistory();
    assert.deepEqual(service.listHistory(), []);
    service.clearBookmarks();
    assert.deepEqual(service.listBookmarks(), []);

    // 降级：Bing 失败 → DuckDuckGo
    const fallbackPaths = makeSearchPaths();
    const fallback = new SearchService({
      paths: fallbackPaths.paths,
      logger: silentLogger,
      endpoints: { bing: `${server.origin}/fail`, duckduckgo: `${server.origin}/ddg` },
    });
    const fallbackResponse = await fallback.search('keyword');
    assert.equal(fallbackResponse.engine, 'duckduckgo');
    assert.equal(fallbackResponse.results.length, 2);
    assert.equal(fallbackResponse.results[0].url, 'https://example.com/ddg-one');
    assert.equal(fallbackResponse.results[1].downloadable, true);
    assert.equal(fallbackResponse.results[1].suggestedName, 'two.zip');

    // 显式 duckduckgo 失败 → 回退 Bing
    const reversePaths = makeSearchPaths();
    const reverse = new SearchService({
      paths: reversePaths.paths,
      logger: silentLogger,
      endpoints: { duckduckgo: `${server.origin}/fail`, bing: `${server.origin}/bing.rss` },
    });
    const reverseResponse = await reverse.search('keyword', { engine: 'duckduckgo' });
    assert.equal(reverseResponse.engine, 'bing');

    // 全部失败 → 抛错
    const broken = new SearchService({
      paths: makeSearchPaths().paths,
      logger: silentLogger,
      endpoints: { bing: `${server.origin}/fail`, duckduckgo: `${server.origin}/fail` },
    });
    await assert.rejects(() => broken.search('keyword'), (err) => err.code === 'SEARCH_FAILED');
    await assert.rejects(() => service.search('   '), (err) => err.code === 'BAD_QUERY');

    // 建议
    const suggestions = await service.suggest('al', { endpoint: `${server.origin}/suggest`, limit: 2 });
    assert.deepEqual(suggestions, [{ text: 'alpha' }, { text: 'alpha & beta' }]);
    assert.deepEqual(await service.suggest(''), []);
  } finally {
    await server.close();
  }
});

/* ------------------------------------------------------------------ DownloadService */

function makeDownloadService(DownloadService, extra = {}) {
  const root = makeTempDir('tk-download-');
  const saveDir = path.join(root, 'downloads');
  const events = [];
  const opened = [];
  const service = new DownloadService({
    paths: { userData: root },
    logger: silentLogger,
    fetchImpl: (input, init) => fetch(input, init),
    getSaveDir: () => saveDir,
    broadcast: (topic, payload) => events.push({ topic, payload }),
    openFile: (filePath) => opened.push({ kind: 'file', filePath }),
    openFolder: (dir) => opened.push({ kind: 'folder', dir }),
    ...extra,
  });
  return { service, root, saveDir, events, opened };
}

test('DownloadService：1MB 流式下载进度 / 文件名去重 / Content-Disposition / 历史 / 打开', async () => {
  const { DownloadService } = await loadSearchModules();
  const state = { active: 0, maxActive: 0, retryHits: 0 };
  const server = await startServer(createRoutes(state));
  const { service, root, saveDir, events, opened } = makeDownloadService(DownloadService);
  try {
    const oneMb = makeData(1024 * 1024);
    const item = await service.start({ url: `${server.origin}/files/1mb.bin`, source: 'search' });
    assert.ok(['queued', 'downloading'].includes(item.status));
    assert.equal(item.name, '1mb.bin');

    const completed = await waitFor(() => {
      const current = service.get(item.id);
      return current.status === 'completed' ? current : null;
    });
    assert.equal(completed.receivedBytes, oneMb.length);
    assert.equal(completed.totalBytes, oneMb.length);
    assert.equal(completed.speed, 0);
    assert.ok(completed.completedAt);
    assert.equal(completed.source, 'search');
    assert.ok(fs.existsSync(completed.filePath));
    assert.ok(fs.readFileSync(completed.filePath).equals(oneMb));

    const progressEvents = events.filter((event) => event.topic === 'search:downloads');
    assert.ok(progressEvents.length >= 2, '应至少广播 开始/完成 事件');
    assert.ok(progressEvents.some((event) => event.payload.changedId === item.id));
    assert.ok(
      progressEvents.some((event) => (event.payload.items ?? []).some((entry) => entry.id === item.id && entry.receivedBytes > 0)),
      '应有包含下载进度的广播'
    );

    // 历史原子落盘并可重新加载
    const historyFile = path.join(path.parse(saveDir).dir, 'search', 'downloads.json');
    await waitFor(() => fs.existsSync(historyFile));
    const persisted = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
    assert.ok(Array.isArray(persisted) && persisted.some((entry) => entry.id === item.id && entry.status === 'completed'));
    // 用同一 userData 重新构造服务 → 历史恢复
    const reloaded = new DownloadService({
      paths: { userData: root },
      logger: silentLogger,
      fetchImpl: (input, init) => fetch(input, init),
      getSaveDir: () => saveDir,
    });
    try {
      const restored = reloaded.list().find((entry) => entry.id === item.id);
      assert.ok(restored, '重启后历史仍在');
      assert.equal(restored.status, 'completed');
      assert.equal(restored.receivedBytes, oneMb.length);
    } finally {
      await reloaded.dispose();
    }

    // 同名去重：并发两个 report.zip
    const first = await service.start({ url: `${server.origin}/files/report.zip` });
    const second = await service.start({ url: `${server.origin}/files/report.zip` });
    assert.equal(first.name, 'report.zip');
    assert.equal(second.name, 'report (1).zip');
    const firstDone = await waitFor(() => {
      const current = service.get(first.id);
      return current.status === 'completed' ? current : null;
    });
    const secondDone = await waitFor(() => {
      const current = service.get(second.id);
      return current.status === 'completed' ? current : null;
    });
    assert.notEqual(firstDone.filePath, secondDone.filePath);

    // Content-Disposition 决定最终文件名
    const cd = await service.start({ url: `${server.origin}/files/cd`, name: 'placeholder.bin' });
    const cdDone = await waitFor(() => {
      const current = service.get(cd.id);
      return current.status === 'completed' ? current : null;
    });
    assert.equal(cdDone.name, '流光测试.zip');
    assert.ok(fs.existsSync(cdDone.filePath));

    // 打开文件 / 打开文件夹 / 删除（默认连文件一起删）
    assert.equal(await service.openFile(cdDone.id), true);
    assert.equal(await service.openFolder(cdDone.id), true);
    assert.deepEqual(opened[0], { kind: 'file', filePath: cdDone.filePath });
    const remaining = await service.remove(cdDone.id);
    assert.ok(!fs.existsSync(cdDone.filePath));
    assert.ok(!remaining.some((entry) => entry.id === cdDone.id));
    await assert.rejects(() => service.openFile(cdDone.id), (err) => err.code === 'DOWNLOAD_NOT_FOUND');

    // 无效地址
    await assert.rejects(() => service.start({ url: 'ftp://example.com/a.zip' }), (err) => err.code === 'BAD_URL');
    await assert.rejects(() => service.start({ url: 'not-a-url' }), (err) => err.code === 'BAD_URL');
  } finally {
    await service.dispose();
    await server.close();
  }
});

test('DownloadService：暂停/继续（Range 续传 + 服务端不支持 Range 时重下）', async () => {
  const { DownloadService } = await loadSearchModules();
  const state = { active: 0, maxActive: 0, retryHits: 0 };
  const server = await startServer(createRoutes(state));
  const { service } = makeDownloadService(DownloadService);
  try {
    const resumeData = makeData(2 * 1024 * 1024);
    const item = await service.start({ url: `${server.origin}/files/resume.bin` });
    await waitFor(() => service.get(item.id).receivedBytes > 400_000, { message: '等待下载进度' });
    const paused = await service.pause(item.id);
    assert.equal(paused.status, 'paused');
    assert.ok(paused.receivedBytes > 0);
    await waitFor(
      () => {
        const current = service.get(item.id);
        return current.status === 'paused' && fs.existsSync(current.filePath) && fs.statSync(current.filePath).size === current.receivedBytes;
      },
      { message: '等待暂停落盘' }
    );
    const partialBytes = service.get(item.id).receivedBytes;
    assert.ok(partialBytes > 0 && partialBytes < resumeData.length);

    await service.resume(item.id);
    const resumed = await waitFor(() => {
      const current = service.get(item.id);
      return current.status === 'completed' ? current : null;
    });
    assert.equal(resumed.receivedBytes, resumeData.length);
    assert.equal(resumed.totalBytes, resumeData.length);
    assert.ok(fs.readFileSync(resumed.filePath).equals(resumeData));
    // 服务端确实收到过 Range 续传请求
    const rangeRequest = server.requests.find(
      (request) => request.url.includes('/files/resume.bin') && String(request.headers.range ?? '').startsWith(`bytes=${partialBytes}-`)
    );
    assert.ok(rangeRequest, '续传应携带 Range 头');

    // 服务端忽略 Range（返回 200）时应自动从头重下
    const noRangeItem = await service.start({ url: `${server.origin}/files/norange.bin` });
    await waitFor(() => service.get(noRangeItem.id).receivedBytes > 300_000, { message: '等待 norange 进度' });
    await service.pause(noRangeItem.id);
    await waitFor(() => service.get(noRangeItem.id).status === 'paused', { message: '等待 norange 暂停' });
    await service.resume(noRangeItem.id);
    const noRangeDone = await waitFor(() => {
      const current = service.get(noRangeItem.id);
      return current.status === 'completed' ? current : null;
    });
    const noRangeData = makeData(1024 * 1024);
    assert.equal(noRangeDone.receivedBytes, noRangeData.length);
    assert.ok(fs.readFileSync(noRangeDone.filePath).equals(noRangeData));
    assert.ok(server.requests.some((request) => request.url.includes('/files/norange.bin') && request.headers.range));
  } finally {
    await service.dispose();
    await server.close();
  }
});

test('DownloadService：并发队列 / 取消 / 重试 / dispose', async () => {
  const { DownloadService } = await loadSearchModules();
  const state = { active: 0, maxActive: 0, retryHits: 0 };
  const server = await startServer(createRoutes(state));
  const { service, saveDir } = makeDownloadService(DownloadService, { getConcurrency: () => 1 });
  try {
    // 并发限制：同一时刻只允许 1 个下载
    const slowOne = await service.start({ url: `${server.origin}/files/conc.bin` });
    const slowTwo = await service.start({ url: `${server.origin}/files/conc.bin` });
    await delay(60);
    const statuses = [service.get(slowOne.id).status, service.get(slowTwo.id).status].sort();
    assert.deepEqual(statuses, ['downloading', 'queued']);
    assert.equal(
      server.requests.filter((request) => request.url.includes('/files/conc.bin')).length,
      1,
      '并发上限 1 时第二个请求不应发到服务端'
    );
    await waitFor(() => service.get(slowOne.id).status === 'completed');
    const secondDone = await waitFor(() => {
      const current = service.get(slowTwo.id);
      return current.status === 'completed' ? current : null;
    });
    assert.ok(fs.existsSync(secondDone.filePath));
    assert.equal(
      server.requests.filter((request) => request.url.includes('/files/conc.bin')).length,
      2,
      '前一个完成后应继续执行排队的任务'
    );

    // 取消：中断进行中的下载并清理半成品
    const cancelItem = await service.start({ url: `${server.origin}/files/resume.bin` });
    await waitFor(() => service.get(cancelItem.id).receivedBytes > 100_000, { message: '等待取消进度' });
    const canceled = service.cancel(cancelItem.id);
    assert.equal(canceled.status, 'canceled');
    await waitFor(() => !fs.existsSync(service.get(cancelItem.id).filePath), { message: '取消后应删除半成品' });
    await delay(50);

    // 重试：首次 500，重试后成功
    const retryItem = await service.start({ url: `${server.origin}/files/retry.bin` });
    await waitFor(() => service.get(retryItem.id).status === 'error', { message: '等待首次失败' });
    assert.match(service.get(retryItem.id).error ?? '', /500/);
    await service.retry(retryItem.id);
    const retried = await waitFor(() => {
      const current = service.get(retryItem.id);
      return current.status === 'completed' ? current : null;
    });
    assert.equal(retried.receivedBytes, 256);
    assert.ok(fs.readFileSync(retried.filePath).equals(makeData(256)));

    // 下载历史包含失败项
    const historyFile = path.join(saveDir, '..', 'search', 'downloads.json');
    await waitFor(() => fs.existsSync(historyFile));
    const persisted = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
    assert.ok(persisted.some((entry) => entry.id === retryItem.id && entry.status === 'completed'));

    // dispose：进行中的任务标记为已中断
    const disposeItem = await service.start({ url: `${server.origin}/files/resume.bin` });
    await waitFor(() => service.get(disposeItem.id).receivedBytes > 100_000, { message: '等待 dispose 进度' });
    await service.dispose();
    const interrupted = service.get(disposeItem.id);
    assert.equal(interrupted.status, 'error');
    assert.match(interrupted.error ?? '', /已中断/);
  } finally {
    await service.dispose();
    await server.close();
  }
});
