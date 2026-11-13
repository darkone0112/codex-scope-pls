'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { rowDefinition, headerDefinition } = require('../src/patch/structuralPoints');
const { recognize } = require('../src/patch/structuralInstallation');
const { transform } = require('../src/patch/integrity');
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name));

test('local-only row guards run after hooks and preserve rendered entries and source summaries', () => {
  const bytes = fixture('localOnlyRow.js');
  const scope = { mode: 'workspace', roots: ['/a'], platform: 'linux', showCloudChats: false };
  let hookCalls = 0, renders = 0;
  const sandbox = { module: { exports: {} }, document: { querySelector: () => ({ content: JSON.stringify(scope) }) },
    Compiler: { c: n => Array(n) }, store: () => null, selector: null, key: null,
    hooks: () => hookCalls++, render: entry => { renders++; return entry; } };
  vm.runInNewContext(transform(bytes, rowDefinition(bytes)).toString(), sandbox);
  const row = sandbox.module.exports;
  const own = Object.freeze({ conversationId: 'own', summary: Object.freeze({ cwd: '/a' }) });
  const other = Object.freeze({ conversationId: 'other', summary: Object.freeze({ cwd: '/b' }) });
  assert.equal(row({ entry: own }), own);
  assert.equal(row({ entry: other }), null);
  assert.equal(row({ entry: { conversationId: 'missing-cwd' } }), null);
  const pending = Object.freeze({ pendingWorktree: { sourceWorkspaceRoot: '/b' } });
  assert.equal(row({ entry: pending }), pending);
  assert.equal(hookCalls, 4);
  assert.equal(renders, 2);
  scope.mode = 'all';
  assert.equal(row({ entry: other }), other);
  scope.mode = 'workspace'; scope.roots = [];
  assert.equal(row({ entry: other }), other);
  assert.equal(hookCalls, 6);
  assert.equal(other.summary.cwd, '/b');
});

test('local-only row refuses changed bindings, malformed cache bounds, and competing renderers', () => {
  const source = fixture('localOnlyRow.js').toString();
  for (const changed of [source.replace('??Ce', '||Ce'), source.replace('.c)(150)', '.c)(149)'),
    source.replace('Se=n.conversationId', 'Se=n.threadId').replaceAll('conversationId', 'threadId'),
    source.replace('mt(n)', 'mt({})')]) assert.throws(() => rowDefinition(Buffer.from(changed)));
  const shifted = source.replace(/\[(14[7-9])\]/g, (_, slot) => `[${Number(slot) + 5}]`).replace('.c)(150)', '.c)(155)');
  assert.doesNotThrow(() => rowDefinition(Buffer.from(shifted)));
  assert.throws(() => rowDefinition(Buffer.concat([Buffer.from(source), fixture('structuralApp.js')])), /final row boundary/);
});

test('local-only history refuses a changed progress projection or duplicate derived hook', () => {
  const source = fixture('localOnlyHeader.js').toString();
  assert.doesNotThrow(() => headerDefinition(Buffer.from(source)));
  assert.throws(() => headerDefinition(Buffer.from(source.replace('function Kt(e){return{hostId:e.hostId,threadId:e.conversationId}}',
    'function Kt(e){return{hostId:e.hostId,threadId:e.id}}'))));
  const hook = source.split('\n').find(line => line.startsWith('function Pt('));
  assert.throws(() => headerDefinition(Buffer.from(source + hook.replace('function Pt(', 'function Duplicate('))), /derived history hook/);
});

test('an unrecognized role produces bounded diagnostics even with many candidate modules', () => {
  const assets = Array.from({ length: 100 }, (_, i) => ({ relativePath: `webview/assets/noise-${i}.js`,
    bytes: Buffer.from('const summary=entry.summary??null;') }));
  assets.push({ relativePath: 'webview/assets/events.js', bytes: fixture('splitNotification.js') },
    { relativePath: 'webview/assets/history.js', bytes: fixture('localOnlyHeader.js') });
  assert.throws(() => recognize(fixture('structuralHost.js'), assets), error => {
    assert.match(error.message, /Unrecognized Codex rows role/);
    assert.match(error.message, /97 more candidate failures/);
    assert.ok(error.message.length < 900);
    return true;
  });
});
