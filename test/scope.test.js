'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { codexScopePlsFilter: filter } = require('../src/workspaceScope');
function api(roots = [], mode = 'workspace') {
  return { env: {}, workspace: {
    workspaceFolders: roots.map(fsPath => ({ uri: { scheme: 'file', fsPath } })),
    getConfiguration: section => ({ get: () => section === 'codexScopePls' ? mode : undefined })
  } };
}
test('single workspace root, normalization and unchanged pagination fields', () => {
  const params = { cursor: 'next', limit: 5, archived: true, cwd: '/other', searchTerm: 'title' };
  assert.deepEqual(filter(params, api(['/repo/a/../a/'])), { ...params, cwd: ['/repo/a'] });
  assert.equal(params.cwd, '/other');
});
test('multi-root union, deduplication, and independent windows', () => {
  assert.deepEqual(filter({}, api(['/a', '/b', '/a'])).cwd, ['/a', '/b']);
  assert.deepEqual(filter({}, api(['/b'])).cwd, ['/b']);
});
test('all and no workspace preserve the original params object', () => {
  const params = { cwd: '/stock' };
  assert.equal(filter(params, api(['/a'], 'all')), params);
  assert.equal(filter(params, api()), params);
});
test('invalid modes, virtual roots, remote hosts and custom CLI refuse scope', () => {
  assert.throws(() => filter({}, api(['/a'], 'invalid')), /invalid mode/);
  const vscode = api(['/a']);
  vscode.workspace.workspaceFolders[0].uri.scheme = 'vscode-remote';
  assert.throws(() => filter({}, vscode), /unsupported workspace URI/);
  const remote = api(['/a']); remote.env.remoteName = 'ssh-remote';
  assert.throws(() => filter({}, remote), /unsupported remote/);
  const custom = api(['/a']); custom.workspace.getConfiguration = () => ({ get: key => key === 'mode' ? 'workspace' : '/bin/custom' });
  assert.throws(() => filter({}, custom), /custom CLI/);
});
test('filesystem root is preserved', () => {
  assert.deepEqual(filter({}, api(['/'])).cwd, ['/']);
});
