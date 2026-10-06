'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const definitions = require('../src/patch/definitions');
const { sha256, transform } = require('../src/patch/integrity');
const bundle = definitions[0].bundles[2];
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name));

// A small hook adapter retains component caches across preference changes.
// Actual reviewed Codex functions calculate preview, totals, tabs and search.
function hooks(window) {
  let frame;
  const frames = new Map();
  const cell = initial => {
    const index = frame.index++;
    if (!(index in frame.cells)) frame.cells[index] = initial();
    return frame.cells[index];
  };
  const react = {
    c: count => cell(() => Array(count).fill(Symbol.for('react.memo_cache_sentinel'))),
    useRef: value => cell(() => ({ current: value })),
    useMemo: (calculate, deps) => {
      const memo = cell(() => ({}));
      if (!memo.deps || !deps.every((value, index) => Object.is(value, memo.deps[index]))) {
        memo.value = calculate(); memo.deps = deps;
      }
      return memo.value;
    },
    useSyncExternalStore: (subscribe, snapshot) => {
      const subscription = cell(() => { const item = { changes: 0 }; item.dispose = subscribe(() => item.changes++); return item; });
      void subscription;
      return snapshot();
    },
    useState: initial => {
      const state = cell(() => ({ value: typeof initial === 'function' ? initial() : initial }));
      return [state.value, value => { state.value = typeof value === 'function' ? value(state.value) : value; }];
    },
    useDeferredValue: value => value,
    useEffect: () => cell(() => ({}))
  };
  return { react, render: (component, ...args) => {
    frame = frames.get(component) ?? { cells: [], index: 0 }; frames.set(component, frame); frame.index = 0;
    return component(...args);
  } };
}
function walk(node, predicate) {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(item => walk(item, predicate));
  if (typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...walk(node.props?.children, predicate),
    ...walk(node.props?.triggerButton, predicate)];
}

function harness({ brokenInlineReact = false } = {}) {
  const model = { mode: 'workspace', cloud: false, group: false, filter: 'recent', pending: [], worktrees: [] };
  const tag = { content: JSON.stringify({ mode: model.mode, roots: ['/a'], platform: process.platform, showCloudChats: model.cloud, groupChatsByProject: model.group }) };
  const listeners = new Map();
  const window = { location: { origin: 'synthetic-vscode' }, Event: class { constructor(type) { this.type = type; } },
    addEventListener: (type, listener) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener: (type, listener) => listeners.get(type)?.delete(listener),
    dispatchEvent: event => { for (const listener of listeners.get(event.type) ?? []) listener(event); } };
  const document = { querySelector: () => tag };
  const runtime = hooks(window);
  const rows = Object.freeze([
    ...Array.from({ length: 5 }, (_, index) => Object.freeze({ id: `b${index}`, title: `b${index}`, cwd: '/b', createdAt: 1000 - index, updatedAt: 1000 - index })),
    ...Array.from({ length: 4 }, (_, index) => Object.freeze({ id: `a${index}`, title: `a${index}`, cwd: '/a', createdAt: 100 - index, updatedAt: 100 - index }))
  ]);
  const tasks = Object.freeze([Object.freeze({ id: 'cloud', title: 'cloud', created_at: 2,
    task_status_display: Object.freeze({ latest_turn_status_display: Object.freeze({ turn_status: 'in_progress' }) }) })]);
  const jsx = (type, props, key) => ({ type, props, key });
  const query = { data: tasks, isLoading: false, isError: false, isPending: false, refetch() { throw new Error('Unexpected request'); } };
  const intl = { formatMessage: (message, values) => ({ message: message.id, ...values }) };
  const sandbox = { window, document, console, Map, Symbol, CustomEvent: window.Event,
    // Codex's compiler runtime exposes c; it is not the React namespace.
    // The inline preview has only jt=g(), so our module helper obtains React via p().
    gn: runtime.react, wn: runtime.react, Mn: runtime.react, p: () => runtime.react,
    jt: Object.freeze({ c: runtime.react.c }),
    Cn: Object.freeze({ c: runtime.react.c }), jn: Object.freeze({ c: runtime.react.c }),
    J: { jsx, jsxs: jsx }, Z: { jsx, jsxs: jsx, Fragment: 'fragment' }, Q: { jsx, jsxs: jsx, Fragment: 'fragment' },
    hn: { default: (entries, key) => { const seen = new Set(); return entries.filter(entry => { const value = typeof key === 'function' ? key(entry) : entry[key]; if (seen.has(value)) return false; seen.add(value); return true; }); } },
    Mt: { default: (entries, key) => { const seen = new Set(); return entries.filter(entry => { const value = key(entry); if (seen.has(value)) return false; seen.add(value); return true; }); } },
    Be: () => model.worktrees, pt: 'pending', Ie: 'ids', be: 'updated_at',
    n: atom => atom === 'pending' ? model.pending : atom === 'filter' ? model.filter : null,
    f: () => new Map(), Me: () => false, L: () => false, me: () => false,
    ct: id => `remote:${id}`, et: id => `local:${id}`, $e: { error: message => assert.fail(message) },
    Pe: () => () => {}, a: () => ({ pathname: '/' }), Re: () => ({ cancelPendingWorktree() {} }), Xe: class extends Error {},
    _: entry => model.inProgress?.has(entry.id) ?? false, i: () => intl, o: () => ({ set: (_atom, value) => { model.filter = value; } }), Te: 'scope',
    ie: () => ({ authMethod: 'chatgpt' }), Pt: 'filter', Ft: 'environment', l: () => null, k: () => ({ data: [] }),
    ze: (title, search) => title.toLowerCase().includes(search), nt: entry => entry.title, bn: entry => entry.label,
    le: () => ({ data: rows }), te: () => query, Nn: 'unread', ft: () => false,
    K: { Section: 'section' }, c: 'message', ne: 'button', B: 'timestamp', Qt: 'typeFilter', qt: 'environmentFilter',
    Lt: 'search', Vt: 'empty', Sn: 'error', xn: 'loading', on: 'noSearchResults', ee: 'spinner',
    Ve: 'localRow', We: 'cloudRow', ht: 'worktreeRow', st: 'pendingRow', Tn: 'localTabRow', En: 'mixedRow',
    T: 'tooltip', ut: 'icon', ce: 'icon', St: 'clock', de: 'popover',
    xe: close => close, m: () => '', module: { exports: {} }, r0e: () => false, i0e: 'null',
    _m: { postMessage: () => assert.fail('display preferences must not send webview requests') }
  };
  const header = fixture('headerPresentation.js');
  const headerDefinition = { ...bundle.presentation.additionalTargets[0], originalHash: sha256(header) };
  if (brokenInlineReact) {
    headerDefinition.points = headerDefinition.points.map(point => point.name !== 'inline history group subscription' ? point : {
      ...point,
      after: point.after.replace('function codexScopePlsInlineReact(){return p()}\n', '')
        .replace('codexScopePlsInlineReact(),document', 'jt,document')
    });
  }
  vm.runInNewContext(transform(header, headerDefinition).toString(), sandbox);
  const messages = fixture('viewMessage.js');
  const messageDefinition = { originalHash: sha256(messages), points: bundle.presentation.points.filter(point => point.name === 'display preference notification') };
  vm.runInNewContext(transform(messages, messageDefinition).toString(), sandbox);
  const update = () => {
    const scope = { mode: model.mode, roots: ['/a'], platform: process.platform, showCloudChats: model.cloud, groupChatsByProject: model.group };
    assert.equal(sandbox.e0e({ origin: window.location.origin, source: null, data: { type: 'codex-scope-pls-view-scope', scope } }, window), null);
  };
  const merged = () => runtime.render(sandbox.fn, tasks, rows, null);
  const preview = () => runtime.render(sandbox.Et, { mergedTasks: merged(), tasksQuery: query });
  const menu = () => runtime.render(sandbox.vn, { cloudtasksQuery: query, localConversations: rows, onClose() {} });
  return { model, rows, tasks, sandbox, runtime, update, merged, preview, menu, tag, listeners, document, window };
}

test('actual header scopes before preview slicing, totals, tabs and search', () => {
  const h = harness();
  const preview = h.preview();
  assert.deepEqual(walk(preview, node => node.type === 'localRow').map(node => node.props.conversationId), ['a0', 'a1', 'a2']);
  assert.equal(walk(preview, node => node.type === 'message' && node.props.id === 'header.recentTasks.seeAll')[0].props.values.total, 4);
  h.model.filter = 'local';
  assert.equal(walk(h.menu(), node => node.type === 'localTabRow').length, 4);
  const search = walk(h.menu(), node => node.type === 'search')[0];
  search.props.onQueryChange('a2');
  const result = walk(h.menu(), node => node.type === 'localTabRow');
  assert.deepEqual(result.map(node => node.props.conversationId), ['a2']);
  assert.equal(h.rows.length, 9); assert.equal(h.tasks.length, 1);
});

test('inline preview resolves React outside its shadowing locals, including the empty startup state', () => {
  const h = harness();
  assert.equal(typeof h.sandbox.jt.c, 'function');
  assert.equal(h.sandbox.jt.useSyncExternalStore, undefined);
  assert.equal(h.sandbox.codexScopePlsInlineReact(), h.runtime.react);
  const empty = { mergedTasks: [], tasksQuery: { isLoading: true } };
  assert.equal(h.runtime.render(h.sandbox.Et, empty), null);
  h.preview();
  h.model.mode = 'all'; h.model.group = true; h.update();
  assert.equal(walk(h.preview(), node => node.type === 'localRow').length, 3);
});

test('0.3.3 namespace regression reproduces the logged crash with grouping disabled', () => {
  const h = harness({ brokenInlineReact: true });
  assert.equal(h.model.group, false);
  assert.throws(() => h.preview(), /react.useSyncExternalStore is not a function/);
});

test('live workspace and cloud preference notifications refresh the actual header memoized list', () => {
  const h = harness();
  assert.equal(h.merged().length, 4);
  h.model.mode = 'all'; h.update();
  assert.equal(h.merged().length, 9);
  h.model.cloud = true; h.update();
  assert.equal(h.merged().length, 10);
  h.model.mode = 'workspace'; h.update();
  assert.equal(h.merged().length, 5);
  h.model.cloud = false; h.update();
  assert.equal(h.merged().length, 4);
  const original = Object.freeze({ type: 'mcp-response', result: Object.freeze({ data: h.rows }) });
  assert.equal(h.sandbox.e0e({ origin: h.window.location.origin, source: null, data: original }, h.window), original);
  const prior = h.tag.content;
  h.sandbox.e0e({ origin: h.window.location.origin, source: null, data: { type: 'codex-scope-pls-view-scope', scope: { mode: 'invalid' } } }, h.window);
  assert.equal(h.tag.content, prior);
  h.sandbox.e0e({ origin: 'wrong-origin', source: null, data: { type: 'codex-scope-pls-view-scope', scope: { mode: 'all' } } }, h.window);
  assert.equal(h.tag.content, prior);
});

test('native history type controls, View all action and progress counts follow display scope', () => {
  const h = harness();
  h.model.inProgress = new Set(['b0', 'b1', 'a0']);
  const count = () => walk(h.runtime.render(h.sandbox.On), node =>
    node.type === 'button' && node.props['aria-label']?.message === 'codex.recentTasksMenu.trigger')[0].props['aria-label'].count;
  assert.equal(count(), 1);
  h.model.mode = 'all'; h.update(); assert.equal(count(), 3);
  h.model.mode = 'workspace'; h.model.cloud = true; h.update(); assert.equal(count(), 2);
  const filter = walk(h.menu(), node => node.type === 'typeFilter')[0];
  filter.props.onSelect('local');
  assert.equal(walk(h.menu(), node => node.type === 'localTabRow').length, 4);
  filter.props.onSelect('cloud');
  assert.equal(walk(h.menu(), node => node.type === 'cloudRow').length, 1);
  let opened = 0;
  h.window.addEventListener('open-recent-tasks-menu', () => opened++);
  const preview = h.preview();
  const viewAll = walk(preview, node => node.type === 'button' &&
    node.props.children?.props?.id === 'header.recentTasks.seeAll')[0];
  viewAll.props.onClick();
  assert.equal(opened, 1);
});

test('real workspace/cloud commands reach the display through configuration events without reloading', async () => {
  const h = harness();
  const commands = new Map(), configurationListeners = new Set(), folderListeners = new Set();
  let viewClosed;
  const disposable = { dispose() {} };
  const vscode = {
    ConfigurationTarget: { Workspace: 2, Global: 1 },
    workspace: {
      workspaceFolders: [{ uri: { scheme: 'file', fsPath: '/a' } }],
      getConfiguration: section => {
        assert.equal(section, 'codexScopePls');
        return { get: key => key === 'mode' ? h.model.mode : key === 'showCloudChats' ? h.model.cloud : h.model.group,
          update: async (key, value) => {
            if (key === 'mode') h.model.mode = value;
            else if (key === 'showCloudChats') h.model.cloud = value;
            else if (key === 'groupChatsByProject') h.model.group = value;
            for (const listener of configurationListeners) listener({ affectsConfiguration: setting => setting === `codexScopePls.${key}` });
          } };
      },
      onDidChangeConfiguration: listener => { configurationListeners.add(listener); return { dispose: () => configurationListeners.delete(listener) }; },
      onDidChangeWorkspaceFolders: listener => { folderListeners.add(listener); return { dispose: () => folderListeners.delete(listener) }; }
    },
    window: {
      createOutputChannel: () => ({ ...disposable, appendLine() {} }),
      showInformationMessage: () => assert.fail('preference changes must not ask for reload'),
      showWarningMessage: message => assert.fail(message)
    },
    extensions: { onDidChange: () => disposable },
    commands: {
      registerCommand: (name, callback) => { commands.set(name, callback); return disposable; },
      executeCommand: () => assert.fail('display preferences must not reload or change conversations')
    }
  };
  const original = fixture('viewHost.js');
  const hostDefinition = { ...bundle, originalHash: sha256(original) };
  const hostContext = { module: { exports: {} }, process, require: name => name === 'vscode' ? vscode : require(name),
    Ge: { Uri: { joinPath: (...parts) => parts.join('/') } } };
  vm.runInNewContext(transform(original, hostDefinition).toString(), hostContext);
  const host = new hostContext.module.exports(); host.subscriptions = []; host.extensionUri = '/fixture';
  const messages = [];
  await host.initializeWebview({ postMessage: message => {
    messages.push(message);
    assert.equal(h.sandbox.e0e({ origin: h.window.location.origin, source: null, data: message }, h.window), null);
    return Promise.resolve(true);
  } }, 'sidebar', callback => { viewClosed = callback; return disposable; });
  const extensionContext = { module: { exports: {} }, require: name => {
    if (name === 'vscode') return vscode;
    if (name === './codexLocator') return {};
    if (name === './patch/patcher') return {};
    if (name === './diagnostics') return { safeError: error => error.message };
    throw new Error(`Unexpected module: ${name}`);
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/extension.js'), 'utf8'), extensionContext);
  extensionContext.module.exports.activate({ subscriptions: [], globalState: { get: () => false } });
  assert.equal(h.merged().length, 4);
  await commands.get('codexScopePls.all')();
  assert.equal(h.merged().length, 9);
  await vscode.workspace.getConfiguration('codexScopePls').update('groupChatsByProject', true);
  assert.deepEqual(walk(h.menu(), node => node.type === 'h3').map(node => node.props.children), ['/b', '/a']);
  await commands.get('codexScopePls.toggleCloud')();
  assert.equal(h.merged().length, 10);
  await commands.get('codexScopePls.workspace')();
  assert.equal(h.merged().length, 5);
  await commands.get('codexScopePls.toggleCloud')();
  assert.equal(h.merged().length, 4);
  assert.equal(messages.length, 5);
  assert.equal(configurationListeners.size, 1);
  viewClosed();
  assert.equal(configurationListeners.size, 0);
  assert.equal(folderListeners.size, 0);
});

test('folder sections toggle live in the memoized menu, local tab, search and preview', () => {
  const h = harness();
  assert.equal(walk(h.menu(), node => node.type === 'h3').length, 0);
  h.model.group = true; h.update();
  assert.equal(walk(h.menu(), node => node.type === 'h3').length, 0, 'workspace mode stays flat');
  h.model.mode = 'all'; h.update();
  const ids = menu => walk(menu, node => node.type === 'mixedRow').map(node => node.props.item.key);
  const grouped = h.menu();
  assert.deepEqual(walk(grouped, node => node.type === 'h3').map(node => node.props.children), ['/b', '/a']);
  assert.equal(ids(grouped).length, 9);
  assert.equal(new Set(ids(grouped)).size, 9);
  assert.deepEqual(walk(h.preview(), node => node.type === 'h3').map(node => node.props.children), ['/b']);
  assert.equal(walk(h.preview(), node => node.type === 'localRow').length, 3, 'native preview limit is preserved');
  assert.equal(walk(h.preview(), node => node.props?.id === 'header.recentTasks.seeAll')[0].props.values.total, 9);
  h.model.group = false; h.update();
  assert.equal(walk(h.menu(), node => node.type === 'h3').length, 0, 'compiler cache refreshes with unchanged entries');
  h.model.group = true; h.model.cloud = true; h.update();
  assert.deepEqual(walk(h.menu(), node => node.type === 'h3').map(node => node.props.children), ['Cloud chats', '/b', '/a']);
  h.model.filter = 'local';
  assert.deepEqual(walk(h.menu(), node => node.type === 'h3').map(node => node.props.children), ['/b', '/a']);
  assert.equal(walk(h.menu(), node => node.type === 'localTabRow').length, 9);
  walk(h.menu(), node => node.type === 'search')[0].props.onQueryChange('a2');
  assert.deepEqual(walk(h.menu(), node => node.type === 'h3').map(node => node.props.children), ['/a']);
  assert.deepEqual(walk(h.menu(), node => node.type === 'localTabRow').map(node => node.props.conversationId), ['a2']);
});
