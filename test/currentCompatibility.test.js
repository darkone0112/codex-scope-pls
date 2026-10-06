'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const definitions = require('../src/patch/definitions');
const { sha256, transform } = require('../src/patch/integrity');

const current = definitions[0].bundles[4];
const scope = (mode = 'workspace') => JSON.stringify({
  mode, roots: ['/a'], platform: 'linux', showCloudChats: false
});
const document = mode => ({ querySelector: () => ({ content: scope(mode) }) });

test('current Codex host renders its scope meta tag with the installed bundle HTML escape helper', () => {
  const source = fs.readFileSync(path.join(__dirname, 'fixtures/modernViewHost.js'));
  const definition = { originalHash: sha256(source), points: current.points.slice(0, 1) };
  const vscode = { workspace: { workspaceFolders: [{ uri: { scheme: 'file', fsPath: '/a' } }],
    getConfiguration: () => ({ get: key => key === 'mode' ? 'workspace' : false }) } };
  const Host = run(transform(source, definition), { process,
    require: name => name === 'vscode' ? vscode : require(name) });
  const tag = new Host().webviewMetaTags({});
  assert.match(tag, /<meta name="codex-scope-pls-view"/);
  assert.match(tag, /&quot;mode&quot;:&quot;workspace&quot;/);
});

function run(source, globals) {
  const sandbox = { module: { exports: {} }, ...globals };
  vm.runInNewContext(source.toString(), sandbox);
  return sandbox.module.exports;
}

test('current Codex row boundary filters display using its summary without changing entries', () => {
  const source = fs.readFileSync(path.join(__dirname, 'fixtures/modernRows.js'));
  const definition = { originalHash: sha256(source), points: current.presentation.points.slice(0, 1) };
  const stock = run(source);
  const patched = run(transform(source, definition));
  const own = Object.freeze({ kind: 'local', conversationId: 'own' });
  const other = Object.freeze({ kind: 'local', conversationId: 'other' });
  assert.equal(stock(other, { cwd: '/other' }, null, document()), other);
  assert.equal(patched(other, { cwd: '/other' }, null, document()), null);
  assert.equal(patched(own, { cwd: '/a' }, null, document()), own);
  assert.equal(patched(other, { cwd: '/other' }, null, document('all')), other);
  assert.equal(patched(Object.freeze({ kind: 'remote' }), null, null, document()), null);
});

test('current Codex history boundary filters derived rows before preview and counts', () => {
  const source = fs.readFileSync(path.join(__dirname, 'fixtures/modernHeader.js'));
  const definition = { originalHash: sha256(source), points: current.presentation.additionalTargets[0].points.slice(0, 1) };
  const react = { useMemo: callback => callback(), useRef: value => ({ current: value }),
    useSyncExternalStore: (_subscribe, snapshot) => snapshot() };
  const entries = Object.freeze([
    Object.freeze({ kind: 'local', key: 'own', conversation: Object.freeze({ id: 'own', cwd: '/a' }) }),
    Object.freeze({ kind: 'local', key: 'other', conversation: Object.freeze({ id: 'other', cwd: '/other' }) }),
    Object.freeze({ kind: 'remote', key: 'cloud', task: Object.freeze({ id: 'cloud' }) })
  ]);
  const globals = mode => ({ document: document(mode), window: {}, gn: react,
    Ne: () => [], o: () => [], tt: null, _: () => null, yt: null, Ie: () => false,
    mn: values => values, pn: ({ tasks }) => tasks, Ae: null });
  assert.equal(run(source, globals())(entries, [], null).length, 3);
  assert.deepEqual(Array.from(run(transform(source, definition), globals())(entries, [], null), entry => entry.key), ['own']);
  assert.deepEqual(Array.from(run(transform(source, definition), globals('all'))(entries, [], null), entry => entry.key), ['own', 'other']);
  assert.equal(entries.length, 3);
});
