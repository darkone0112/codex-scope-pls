'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { codexScopePlsGroupHistoryRows: group } = require('../src/historyGroups');
const { codexScopePlsReadViewScope: read } = require('../src/viewVisibility');
const jsx = { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
const scope = { mode: 'all', groupChatsByProject: true, roots: [], platform: 'linux', showCloudChats: false };

test('grouping preserves every row, native action and source object, with exact cwd sections', () => {
  const entries = Object.freeze([
    { conversation: { cwd: '/one/app' } }, { conversation: { cwd: '/two/app' } },
    { pendingThreadStart: { task: { cwd: '/one/app/' } } },
    { pendingWorktree: { sourceWorkspaceRoot: '/one/app/child' } },
    { conversation: { cwd: null } }, { kind: 'remote', task: {} }, { cwd: '/' }
  ].map(Object.freeze));
  const rows = Object.freeze(entries.map((entry, index) => Object.freeze({ entry, index, onClick() {} })));
  const result = group(entries, rows, jsx, scope);
  assert.deepEqual(result.map(section => section.props['aria-label']), [
    '/one/app', '/two/app', '/one/app/child', 'Other local chats', 'Cloud chats', '/'
  ]);
  assert.deepEqual(result[0].props.children.slice(1), [rows[0], rows[2]]);
  const rendered = result.flatMap(section => section.props.children.slice(1));
  assert.equal(rendered.length, rows.length);
  assert.equal(new Set(rendered).size, rows.length);
  for (const row of rows) assert.ok(rendered.includes(row));
  assert.equal(result[0].props.children[1].onClick, rows[0].onClick);
  assert.equal(group(entries, rows, jsx, null), rows);
  assert.equal(group(entries, rows, jsx, { ...scope, mode: 'workspace' }), rows);
  assert.equal(group(entries, rows, jsx, { ...scope, groupChatsByProject: false }), rows);
});

test('Windows folder separators and drive roots have deterministic section identities', () => {
  const entries = [{ cwd: 'C:\\project\\' }, { cwd: 'C:/project' }, { cwd: 'C:\\' }];
  const result = group(entries, [1, 2, 3], jsx, { ...scope, platform: 'win32' });
  assert.deepEqual(result.map(section => section.props['aria-label']), ['C:/project', 'C:/']);
  assert.deepEqual(result[0].props.children.slice(1), [1, 2]);
});

test('absent grouping preferences preserve older snapshots and malformed values are rejected', () => {
  const parse = value => read({ querySelector: () => ({ content: JSON.stringify(value) }) });
  const { groupChatsByProject, ...old } = scope;
  assert.deepEqual(parse(old), old);
  assert.deepEqual(parse(scope), scope);
  assert.equal(parse({ ...scope, groupChatsByProject: 'true' }), null);
  assert.deepEqual(group([], [], jsx, scope), []);
});
