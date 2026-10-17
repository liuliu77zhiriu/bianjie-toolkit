/* ============================================================
 * 便捷工具 · 生产力插件单元测试（node:test）
 * 覆盖：备忘录 CRUD/排序/置顶/持久化/命令，计时器权威计时/计次/
 *       倒计时结束通知/迷你窗/重启安全恢复/命令。
 * 不依赖 Electron 与真实 UI，全部使用 mock ctx。
 * ============================================================ */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import memoPlugin from '../resources/plugins/memo/main.js';
import timerPlugin from '../resources/plugins/timer/main.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function createHarness(pluginId, pluginName, storeMap = new Map(), options = {}) {
  const wholeStore = options.storeStyle === 'whole';
  const record = {
    broadcast: [],
    windows: [],
    windowCloses: [],
    windowHides: [],
    notifications: [],
    panelShows: [],
    flushes: 0,
  };
  const ipc = new Map();
  const commands = new Map();
  const store = {
    // whole = 内核 JsonStore 的整对象 get() 契约；默认模拟文档的 get(key, fallback)
    get(...args) {
      if (wholeStore) {
        const all = {};
        for (const [key, value] of storeMap) all[key] = clone(value);
        return clone(all);
      }
      const [key, fallback] = args;
      if (!storeMap.has(key)) return fallback;
      return clone(storeMap.get(key));
    },
    set(key, value) {
      storeMap.set(key, clone(value));
    },
    delete(key) {
      return storeMap.delete(key);
    },
    all() {
      const out = {};
      for (const [key, value] of storeMap) out[key] = clone(value);
      return out;
    },
    clear() {
      storeMap.clear();
    },
    flush() {
      record.flushes += 1;
    },
  };

  const ctx = {
    plugin: { id: pluginId, name: pluginName, version: '1.0.0', dir: '', dataDir: '' },
    log: Object.assign(() => {}, { warn() {}, error() {}, info() {} }),
    paths: {},
    store,
    ipc: {
      handle(method, handler) {
        ipc.set(method, handler);
      },
      unhandle(method) {
        ipc.delete(method);
      },
    },
    events: {
      broadcast(topic, payload) {
        record.broadcast.push({ topic, payload: clone(payload) });
      },
      on() {
        return () => {};
      },
    },
    commands: {
      register(command) {
        commands.set(command.id, command);
        return () => commands.delete(command.id);
      },
      run(id, args) {
        const command = commands.get(id);
        return command ? command.run(args) : undefined;
      },
    },
    windows: {
      async open(options) {
        record.windows.push(clone(options));
        return { key: options.key, visible: true };
      },
      async close(key) {
        record.windowCloses.push(key);
      },
      hide(key) {
        record.windowHides.push(key);
      },
      send() {},
      async exists() {
        return record.windows.some((win) => win.key === 'mini');
      },
      async list() {
        return record.windows.map((win) => win.key);
      },
    },
    notifications: {
      show(payload) {
        record.notifications.push(clone(payload));
      },
    },
    panel: {
      async show(pluginIdArg) {
        record.panelShows.push(pluginIdArg || pluginId);
      },
      async close() {},
      async isOpen() {
        return false;
      },
    },
  };

  async function call(method, args) {
    const handler = ipc.get(method);
    if (!handler) throw new Error('未注册的 IPC 方法：' + method);
    return handler(args, { sender: 'unit-test' });
  }

  return { ctx, record, storeMap, ipc, commands, call };
}

async function waitFor(predicate, timeoutMs = 3000, intervalMs = 20) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(intervalMs);
  }
  return predicate();
}

function tickPayloads(record) {
  return record.broadcast.filter((item) => item.topic === 'timer:tick').map((item) => item.payload);
}

/* ============================================================
 * 备忘录
 * ============================================================ */

test('备忘录：新增 / 更新 / 排序 / 置顶 / 搜索 / 删除', async (t) => {
  const harness = createHarness('memo', '备忘录');
  const { ctx, call } = harness;
  memoPlugin.activate(ctx);
  t.after(() => memoPlugin.deactivate());

  const empty = await call('memo.list', {});
  assert.deepEqual(empty.notes, []);
  assert.equal(empty.total, 0);

  const first = await call('memo.save', { title: '第一条', content: '早餐清单：牛奶' });
  assert.equal(first.created, true);
  assert.ok(first.note.id);
  assert.equal(first.note.pinned, false);
  assert.equal(first.note.createdAt, first.note.updatedAt);

  await sleep(5);
  const second = await call('memo.save', { title: '第二条', content: '周会纪要' });
  await sleep(5);
  const third = await call('memo.save', { title: '第三条', content: '买咖啡豆' });

  let list = await call('memo.list', {});
  assert.deepEqual(
    list.notes.map((note) => note.title),
    ['第三条', '第二条', '第一条']
  );
  assert.equal(list.total, 3);

  // 更新不改变 createdAt，并让记录排到最前
  await sleep(5);
  const updated = await call('memo.save', {
    id: first.note.id,
    title: '第一条（已更新）',
    content: '早餐清单：牛奶 + 面包',
  });
  assert.equal(updated.created, false);
  assert.equal(updated.note.id, first.note.id);
  assert.equal(updated.note.createdAt, first.note.createdAt);
  assert.ok(updated.note.updatedAt > first.note.updatedAt);

  list = await call('memo.list', {});
  assert.equal(list.notes[0].id, first.note.id);

  // 置顶优先（置顶不改变 updatedAt）
  const pinned = await call('memo.togglePin', { id: third.note.id });
  assert.equal(pinned.note.pinned, true);
  list = await call('memo.list', {});
  assert.equal(list.notes[0].id, third.note.id);
  assert.equal(list.notes[0].pinned, true);
  assert.equal(list.notes[1].pinned, false);

  // 搜索命中标题或内容
  const byTitle = await call('memo.list', { query: '第二条' });
  assert.equal(byTitle.notes.length, 1);
  assert.equal(byTitle.notes[0].id, second.note.id);
  const byContent = await call('memo.list', { query: '咖啡' });
  assert.equal(byContent.notes.length, 1);
  assert.equal(byContent.notes[0].id, third.note.id);

  // 删除
  const removed = await call('memo.delete', { id: second.note.id });
  assert.equal(removed.ok, true);
  list = await call('memo.list', {});
  assert.equal(list.notes.length, 2);
  assert.ok(!list.notes.some((note) => note.id === second.note.id));

  const missing = await call('memo.delete', { id: 'not-exist' });
  assert.equal(missing.ok, false);
});

test('备忘录：空草稿不落库，数据持久化跨重启', async (t) => {
  const storeMap = new Map();
  const firstHarness = createHarness('memo', '备忘录', storeMap);
  memoPlugin.activate(firstHarness.ctx);
  t.after(() => memoPlugin.deactivate());

  const blank = await firstHarness.call('memo.save', { title: '   ', content: '' });
  assert.equal(blank.note, null);
  assert.equal((await firstHarness.call('memo.list', {})).total, 0);

  const saved = await firstHarness.call('memo.save', { title: '持久化', content: '重启后仍在' });
  assert.ok(saved.note.id);

  memoPlugin.deactivate();

  const secondHarness = createHarness('memo', '备忘录', storeMap);
  memoPlugin.activate(secondHarness.ctx);
  const list = await secondHarness.call('memo.list', {});
  assert.equal(list.total, 1);
  assert.equal(list.notes[0].id, saved.note.id);
  assert.equal(list.notes[0].content, '重启后仍在');
  memoPlugin.deactivate();
});

test('备忘录：memo.new 命令打开面板并携带新建意图', async (t) => {
  const harness = createHarness('memo', '备忘录');
  memoPlugin.activate(harness.ctx);
  t.after(() => memoPlugin.deactivate());

  const command = harness.commands.get('memo.new');
  assert.ok(command, '应注册 memo.new 命令');
  assert.equal(command.label, '新建备忘录');

  await command.run();
  assert.deepEqual(harness.record.panelShows, ['memo']);
  assert.deepEqual(
    harness.record.broadcast.map((item) => item.topic),
    ['memo:new']
  );

  assert.deepEqual(await harness.call('memo.takeIntent'), { create: true });
  assert.deepEqual(await harness.call('memo.takeIntent'), { create: false });
});

/* ============================================================
 * 计时器
 * ============================================================ */

test('计时器：秒表 start → pause → resume，elapsed 单调递增且自动弹出迷你窗', async (t) => {
  const harness = createHarness('timer', '计时器');
  timerPlugin.activate(harness.ctx);
  t.after(() => timerPlugin.deactivate());

  const idle = await harness.call('timer.getState');
  assert.equal(idle.phase, 'idle');
  assert.equal(idle.mode, 'stopwatch');
  assert.equal(idle.elapsedMs, 0);

  await harness.call('timer.start', { mode: 'stopwatch' });
  let state = await harness.call('timer.getState');
  assert.equal(state.phase, 'running');
  assert.equal(state.mode, 'stopwatch');
  assert.equal(state.remainingMs, null);

  // 开始即自动打开桌面迷你窗
  const mini = harness.record.windows.find((win) => win.key === 'mini');
  assert.ok(mini, '开始后应打开 mini 窗口');
  assert.equal(mini.page, 'mini.html');
  assert.equal(mini.frame, false);
  assert.equal(mini.transparent, true);
  assert.equal(mini.alwaysOnTop, true);
  assert.equal(mini.skipTaskbar, true);
  assert.equal(mini.hideOnClose, true);
  assert.equal(mini.position, 'top-right');

  await sleep(260);
  const paused1 = await harness.call('timer.pause');
  assert.equal(paused1.phase, 'paused');
  assert.ok(paused1.elapsedMs >= 150, '暂停时应累计已计时时间');
  const pausedAt = paused1.elapsedMs;

  // 暂停期间计时静止，迷你窗保持显示（不关闭）
  await sleep(80);
  const stillPaused = await harness.call('timer.getState');
  assert.equal(stillPaused.phase, 'paused');
  assert.equal(stillPaused.elapsedMs, pausedAt);
  assert.deepEqual(harness.record.windowCloses, []);

  // 迷你窗「关闭」应走 hideMini（只隐藏，不销毁）
  await harness.call('timer.hideMini');
  assert.deepEqual(harness.record.windowHides, ['mini']);
  assert.deepEqual(harness.record.windowCloses, []);

  await harness.call('timer.resume');
  await sleep(260);
  const lap = await harness.call('timer.lap');
  assert.equal(lap.phase, 'running');
  assert.equal(lap.laps.length, 1);
  assert.ok(lap.laps[0].totalMs >= pausedAt);
  assert.equal(lap.lap.index, 1);

  const paused2 = await harness.call('timer.pause');
  assert.ok(paused2.elapsedMs > pausedAt, '继续后累计时间应更大');

  // 运行期间的 tick 广播 elapsed 单调不减
  const runningTicks = tickPayloads(harness.record).filter((payload) => payload.phase === 'running');
  assert.ok(runningTicks.length >= 2, '应有多次运行态 tick');
  for (let i = 1; i < runningTicks.length; i += 1) {
    assert.ok(
      runningTicks[i].elapsedMs >= runningTicks[i - 1].elapsedMs,
      'elapsedMs 应单调递增'
    );
  }
  assert.ok(runningTicks.some((payload) => payload.remainingMs === null));

  // 重置后归零、清空计次
  const reset = await harness.call('timer.reset');
  assert.equal(reset.phase, 'idle');
  assert.equal(reset.elapsedMs, 0);
  assert.deepEqual(reset.laps, []);

  // 暂停状态下不允许计次
  await assert.rejects(() => harness.call('timer.lap'));
});

test('计时器：短倒计时结束触发 timer:finished 与系统通知', async (t) => {
  const harness = createHarness('timer', '计时器');
  timerPlugin.activate(harness.ctx);
  t.after(() => timerPlugin.deactivate());

  const started = await harness.call('timer.start', { mode: 'countdown', durationMs: 150 });
  assert.equal(started.mode, 'countdown');
  assert.equal(started.phase, 'running');
  assert.equal(started.durationMs, 150);
  assert.equal(started.remainingMs, 150);

  const finished = await waitFor(() =>
    harness.record.broadcast.some((item) => item.topic === 'timer:finished')
  );
  assert.equal(finished, true, '应在倒计时结束后广播 timer:finished');

  const event = harness.record.broadcast.find((item) => item.topic === 'timer:finished');
  assert.equal(event.payload.mode, 'countdown');
  assert.equal(event.payload.durationMs, 150);

  const state = await harness.call('timer.getState');
  assert.equal(state.phase, 'finished');
  assert.equal(state.remainingMs, 0);
  assert.equal(state.elapsedMs, 150);

  assert.equal(harness.record.notifications.length, 1);
  assert.equal(harness.record.notifications[0].title, '倒计时结束');

  // 倒计时 tick 携带 remainingMs
  const countdownTicks = tickPayloads(harness.record).filter((payload) => payload.mode === 'countdown');
  assert.ok(countdownTicks.length >= 1);
  assert.ok(countdownTicks.every((payload) => typeof payload.remainingMs === 'number'));

  // 结束后再次开始会从头计时
  const again = await harness.call('timer.start');
  assert.equal(again.phase, 'running');
  assert.equal(again.elapsedMs, 0);
  await harness.call('timer.reset');
});

test('计时器：运行中重启 → 安全暂停并保留已计时间', async (t) => {
  const storeMap = new Map();
  const firstHarness = createHarness('timer', '计时器', storeMap);
  timerPlugin.activate(firstHarness.ctx);
  t.after(() => timerPlugin.deactivate());

  await firstHarness.call('timer.start', { mode: 'stopwatch' });
  await sleep(60);

  // 模拟崩溃前的持久化快照（phase = running）
  const snapshot = firstHarness.ctx.store.get('timer.state');
  assert.equal(snapshot.phase, 'running');
  assert.equal(snapshot.mode, 'stopwatch');

  // 正常退出会清理 interval 并把状态写成暂停态；这里再塞回运行态快照模拟“进程被杀”
  timerPlugin.deactivate();
  firstHarness.ctx.store.set('timer.state', snapshot);

  const secondHarness = createHarness('timer', '计时器', storeMap);
  timerPlugin.activate(secondHarness.ctx);
  const restored = await secondHarness.call('timer.getState');
  assert.equal(restored.phase, 'paused', '运行中重启后应安全暂停');
  assert.ok(restored.elapsedMs > 0, '应保留已计时间');
  assert.ok(restored.elapsedMs <= 5500, '不应把关闭期间的漫长时间计入');

  // 恢复后不会自行继续跑
  const before = secondHarness.record.broadcast.length;
  await sleep(320);
  assert.equal(secondHarness.record.broadcast.length, before, '恢复为暂停后不应有 tick 广播');

  const resumed = await secondHarness.call('timer.resume');
  assert.equal(resumed.phase, 'running');
  assert.ok(resumed.elapsedMs >= restored.elapsedMs);
});

test('计时器：模式切换、自定义时长与命令注册', async (t) => {
  const harness = createHarness('timer', '计时器');
  timerPlugin.activate(harness.ctx);
  t.after(() => timerPlugin.deactivate());

  assert.ok(harness.commands.has('timer.toggle'));
  assert.ok(harness.commands.has('timer.reset'));
  assert.ok(harness.commands.has('timer.mini'));

  const countdown = await harness.call('timer.setMode', { mode: 'countdown', durationMs: 3 * 60 * 1000 });
  assert.equal(countdown.mode, 'countdown');
  assert.equal(countdown.phase, 'idle');
  assert.equal(countdown.durationMs, 180000);

  const custom = await harness.call('timer.setDuration', { durationMs: 90 * 1000 });
  assert.equal(custom.durationMs, 90000);
  assert.equal(custom.remainingMs, 90000);

  // 运行中修改时长应被拒绝
  await harness.call('timer.start');
  await assert.rejects(() => harness.call('timer.setDuration', { durationMs: 60000 }));

  // timer.toggle：运行 → 暂停 → 继续
  const paused = await harness.commands.get('timer.toggle').run();
  assert.equal(paused.phase, 'paused');
  const resumed = await harness.commands.get('timer.toggle').run();
  assert.equal(resumed.phase, 'running');

  // timer.mini 命令显示迷你窗
  await harness.commands.get('timer.mini').run();
  assert.ok(harness.record.windows.some((win) => win.key === 'mini'));

  const stopped = await harness.commands.get('timer.reset').run();
  assert.equal(stopped.phase, 'idle');
  assert.equal(stopped.elapsedMs, 0);
});

/* ============================================================
 * 与内核实际 JsonStore 的兼容性（get() 整对象契约）
 * 文档契约是 get(key, fallback)，内核 JsonStore.get() 无参数返回整对象，
 * 两个插件都做了双兼容，这里用无参数 get 的 mock 回归。
 * ============================================================ */

test('持久化：兼容内核 JsonStore 的整对象 get() 契约，停用时 flush 落盘', async (t) => {
  const storeMap = new Map();

  const memoHarness = createHarness('memo', '备忘录', storeMap, { storeStyle: 'whole' });
  memoPlugin.activate(memoHarness.ctx);
  t.after(() => memoPlugin.deactivate());

  const saved = await memoHarness.call('memo.save', { title: '整对象 store', content: '兼容性验证' });
  assert.ok(saved.note.id);
  const list = await memoHarness.call('memo.list', {});
  assert.equal(list.total, 1);
  assert.equal(list.notes[0].content, '兼容性验证');
  memoPlugin.deactivate();
  assert.ok(memoHarness.record.flushes >= 1, '停用时 memo 应 flush 存储');

  const memoReloaded = createHarness('memo', '备忘录', storeMap, { storeStyle: 'whole' });
  memoPlugin.activate(memoReloaded.ctx);
  assert.equal((await memoReloaded.call('memo.list', {})).total, 1);
  memoPlugin.deactivate();

  const timerHarness = createHarness('timer', '计时器', storeMap, { storeStyle: 'whole' });
  timerPlugin.activate(timerHarness.ctx);
  t.after(() => timerPlugin.deactivate());
  await timerHarness.call('timer.setMode', { mode: 'countdown', durationMs: 60000 });
  await timerHarness.call('timer.start');
  await sleep(40);
  const paused = await timerHarness.call('timer.pause');
  assert.equal(paused.phase, 'paused');
  timerPlugin.deactivate();
  assert.ok(timerHarness.record.flushes >= 1, '停用时 timer 应 flush 存储');

  const timerReloaded = createHarness('timer', '计时器', storeMap, { storeStyle: 'whole' });
  timerPlugin.activate(timerReloaded.ctx);
  const restored = await timerReloaded.call('timer.getState');
  assert.equal(restored.mode, 'countdown');
  assert.equal(restored.phase, 'paused');
  assert.equal(restored.durationMs, 60000);
  assert.ok(restored.elapsedMs >= paused.elapsedMs);
  timerPlugin.deactivate();
});
