/* ============================================================
 * 便捷工具 · 插件 UI SDK  (window.toolkit)
 * 用法：<script src="tk://plugin-sdk/sdk.js"></script>
 * 宿主：主面板 iframe（React）或插件独立窗口（preload 桥）
 * ============================================================ */
(function () {
  'use strict';

  var MARK = '__tk_sdk__';
  if (window[MARK]) return;
  window[MARK] = true;

  var isIframe = window.parent !== window;
  var hostWindow = isIframe ? window.parent : window;
  var ORIGIN = '*';
  var listeners = new Map();
  var pending = new Map();
  var seq = 0;
  var readyResolve;
  var ready = new Promise(function (resolve) {
    readyResolve = resolve;
  });
  var hostKind = isIframe ? 'panel' : 'window';
  var windowKey = null;
  var pluginId = null;
  var settings = {};

  function post(msg) {
    try {
      hostWindow.postMessage(Object.assign({ __tk: 1 }, msg), ORIGIN);
    } catch (err) {
      console.warn('[toolkit] postMessage failed', err);
    }
  }

  function makeError(payload) {
    var err = new Error((payload && payload.message) || '调用失败');
    err.code = (payload && payload.code) || 'UNKNOWN';
    err.detail = payload && payload.detail;
    return err;
  }

  function emit(topic, payload) {
    var list = listeners.get(topic);
    if (!list) return;
    list.slice().forEach(function (fn) {
      try {
        fn(payload);
      } catch (err) {
        console.error('[toolkit] listener error for "' + topic + '"', err);
      }
    });
  }

  function applyTheme(theme) {
    if (!theme) return;
    var root = document.documentElement;
    if (theme.accent) {
      root.style.setProperty('--tk-accent', theme.accent);
      var m = /^#?([0-9a-f]{6})$/i.exec(String(theme.accent));
      if (m) {
        var n = parseInt(m[1], 16);
        root.style.setProperty(
          '--tk-accent-rgb',
          [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(', ')
        );
      }
    }
    if (typeof theme.animation === 'string') {
      root.setAttribute('data-animation', theme.animation);
    }
  }

  function applySettings(next) {
    if (!next) return;
    settings = next;
    toolkit.env.settings = settings;
  }

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.__tk !== 1) return;
    if (isIframe && event.source !== hostWindow) return;
    switch (data.kind) {
      case 'init':
        pluginId = data.pluginId;
        hostKind = data.host && data.host.kind ? data.host.kind : hostKind;
        windowKey = data.host ? data.host.windowKey || null : null;
        toolkit.env.pluginId = pluginId;
        toolkit.env.host = { kind: hostKind, windowKey: windowKey };
        if (data.theme) applyTheme(data.theme);
        if (data.settings) applySettings(data.settings);
        readyResolve(toolkit.env);
        break;
      case 'settings':
        applySettings(data.settings);
        emit('settings:changed', data.settings);
        break;
      case 'theme':
        applyTheme(data.theme);
        emit('appearance', data.theme);
        break;
      case 'event':
        emit(data.topic, data.payload);
        break;
      case 'result':
        var p = pending.get(data.id);
        if (!p) return;
        pending.delete(data.id);
        clearTimeout(p.timer);
        if (data.ok) p.resolve(data.data);
        else p.reject(makeError(data.error));
        break;
      case 'panel:shown':
        emit('panel:shown', data.payload || {});
        break;
      case 'panel:hidden':
        emit('panel:hidden', data.payload || {});
        break;
      case 'plugin:reload':
        emit('plugin:reload', data.payload || {});
        break;
      default:
        break;
    }
  });

  function invoke(method, args, timeoutMs) {
    return ready.then(function () {
      return new Promise(function (resolve, reject) {
        var id = 'c' + ++seq;
        var timer = setTimeout(function () {
          pending.delete(id);
          reject(makeError({ code: 'TIMEOUT', message: '调用超时：' + method }));
        }, timeoutMs || 30000);
        pending.set(id, { resolve: resolve, reject: reject, timer: timer });
        post({ kind: 'invoke', id: id, method: method, args: args });
      });
    });
  }

  function send(topic, payload) {
    ready.then(function () {
      post({ kind: 'send', topic: topic, payload: payload });
    });
  }

  function on(topic, fn) {
    var list = listeners.get(topic) || [];
    list.push(fn);
    listeners.set(topic, list);
    return function off() {
      var current = listeners.get(topic) || [];
      var idx = current.indexOf(fn);
      if (idx >= 0) current.splice(idx, 1);
    };
  }

  function once(topic, fn) {
    var off = on(topic, function (payload) {
      off();
      fn(payload);
    });
    return off;
  }

  /* ---------------- 独立窗口内置 Toast（面板内交宿主统一渲染） ---------------- */
  var toastHost = null;
  function localToast(message, type) {
    if (!toastHost) {
      toastHost = document.createElement('div');
      toastHost.style.cssText =
        'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);display:flex;flex-direction:column;gap:8px;align-items:center;z-index:99999;pointer-events:none;font-family:var(--tk-font);';
      (document.body || document.documentElement).appendChild(toastHost);
    }
    var el = document.createElement('div');
    var color = type === 'error' ? '#ff8a9a' : type === 'success' ? '#7dffcf' : '#cfe1ff';
    el.style.cssText =
      'padding:8px 14px;border-radius:10px;font-size:12.5px;color:' +
      color +
      ';background:rgba(10,18,34,.92);border:1px solid rgba(140,180,255,.24);box-shadow:0 10px 30px rgba(0,0,0,.45);opacity:0;transform:translateY(6px);transition:all .22s cubic-bezier(.34,1.4,.5,1);';
    el.textContent = String(message);
    toastHost.appendChild(el);
    requestAnimationFrame(function () {
      el.style.opacity = '1';
      el.style.transform = 'none';
    });
    setTimeout(function () {
      el.style.opacity = '0';
      el.style.transform = 'translateY(6px)';
      setTimeout(function () {
        el.remove();
      }, 260);
    }, 2200);
  }

  function toast(message, type) {
    type = type || 'info';
    if (hostKind === 'panel') {
      post({ kind: 'toast', message: String(message), type: type });
    } else {
      localToast(message, type);
    }
  }

  /* ---------------- tk://file 链接 ---------------- */
  function fileUrl(absPath) {
    if (!absPath) return '';
    var bytes = new TextEncoder().encode(String(absPath));
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    var b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    return 'tk://file/' + b64;
  }

  /* ---------------- 平滑弹性滚动 ---------------- */
  function setupElasticScroll(el) {
    if (!el || el.__tkScroll) return;
    el.__tkScroll = true;
    var target = el.scrollTop;
    var current = target;
    var velocity = 0;
    var raf = 0;
    var MAX_OVER = 42;

    function maxScroll() {
      return Math.max(0, el.scrollHeight - el.clientHeight);
    }

    function frame() {
      var max = maxScroll();
      target = Math.max(-MAX_OVER, Math.min(max + MAX_OVER, target));
      var stiffness = 0.16;
      velocity += (target - current) * stiffness;
      velocity *= 0.76;
      current += velocity;
      if (Math.abs(velocity) < 0.02 && Math.abs(target - current) < 0.05) {
        current = target;
        el.scrollTop = current;
        raf = 0;
        return;
      }
      el.scrollTop = current;
      raf = requestAnimationFrame(frame);
    }

    function start() {
      if (!raf) raf = requestAnimationFrame(frame);
    }

    el.addEventListener(
      'wheel',
      function (e) {
        if (e.ctrlKey) return;
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
        e.preventDefault();
        target += e.deltaY;
        start();
      },
      { passive: false }
    );

    el.addEventListener(
      'scroll',
      function () {
        if (raf) return;
        target = current = el.scrollTop;
      },
      { passive: true }
    );

    // 内容尺寸变化时校正
    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(function () {
        target = Math.max(target, el.scrollTop);
      });
      ro.observe(el);
    }
  }

  function setupScrolls() {
    document.querySelectorAll('.tk-scroll, [data-tk-scroll]').forEach(setupElasticScroll);
  }

  /* ---------------- 全局错误上报 ---------------- */
  window.addEventListener('error', function (e) {
    try {
      post({ kind: 'log', level: 'error', message: String(e.message), stack: e.error && e.error.stack });
    } catch (_) {}
  });
  window.addEventListener('unhandledrejection', function (e) {
    try {
      post({
        kind: 'log',
        level: 'error',
        message: 'Unhandled rejection: ' + String(e.reason),
        stack: e.reason && e.reason.stack,
      });
    } catch (_) {}
  });

  /* ready 同时支持 toolkit.ready() 与 await toolkit.ready（thenable） */
  function readyFn() {
    return ready;
  }
  readyFn.then = function (onFulfilled, onRejected) {
    return ready.then(onFulfilled, onRejected);
  };
  readyFn.catch = function (onRejected) {
    return ready.catch(onRejected);
  };
  readyFn.finally = function (onFinally) {
    return ready.finally(onFinally);
  };

  var toolkit = {
    get env() {
      return {
        pluginId: pluginId,
        host: { kind: hostKind, windowKey: windowKey },
        settings: settings,
        platform: 'win32',
        versions: window.tkVersions || {},
      };
    },
    ready: readyFn,
    invoke: invoke,
    send: send,
    on: on,
    once: once,
    off: function (topic, fn) {
      var list = listeners.get(topic) || [];
      var idx = list.indexOf(fn);
      if (idx >= 0) list.splice(idx, 1);
    },
    toast: toast,
    fileUrl: fileUrl,
    openPanel: function (targetPluginId) {
      post({ kind: 'open-panel', pluginId: targetPluginId || pluginId });
    },
    closePanel: function () {
      post({ kind: 'close-panel' });
    },
    closeWindow: function () {
      window.close();
    },
    anchorDrag: function (el) {
      if (el) el.style.webkitAppRegion = 'drag';
    },
  };

  window.toolkit = toolkit;

  document.addEventListener('DOMContentLoaded', function () {
    setupScrolls();
    // 动态内容稍后再扫一遍
    setTimeout(setupScrolls, 120);
  });
  if (document.readyState !== 'loading') {
    setupScrolls();
    setTimeout(setupScrolls, 120);
  }

  post({ kind: 'hello' });
})();
