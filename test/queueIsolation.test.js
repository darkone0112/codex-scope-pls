'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const definitions = require('../src/patch/definitions');
const { sha256, transform } = require('../src/patch/integrity');
const { changeAll } = require('../src/patch/patcher');
const { backupPath } = require('../src/patch/backup');
const { installationTargets } = require('../src/codexLocator');
const { codexScopePlsViewScope } = require('../src/viewScope');
const { codexScopePlsVisible, codexScopePlsReadViewScope } = require('../src/viewVisibility');
const reviewed = definitions[0].bundles[2];
const api = (roots, mode = 'workspace', showCloudChats = false) => ({ workspace: {
  workspaceFolders: roots.map(fsPath => ({ uri: { scheme: 'file', fsPath } })),
  getConfiguration: section => { assert.equal(section, 'codexScopePls'); return {
    get: key => key === 'mode' ? mode : showCloudChats
  }; }
} });

test('GUI visibility preserves stock data, exact roots, multiple folders and empty windows', () => {
  const scope = codexScopePlsViewScope(api(['/a', '/b', '/a']));
  const entry = Object.freeze({ kind: 'local', conversationId: 'synthetic' });
  for (const cwd of ['/a', '/b', '/a/']) assert.equal(codexScopePlsVisible(entry, { cwd }, scope), true);
  for (const cwd of ['/other', '/a/child', '/a-sibling']) assert.equal(codexScopePlsVisible(entry, { cwd }, scope), false);
  assert.equal(codexScopePlsVisible(entry, { cwd: '/other' }, codexScopePlsViewScope(api(['/a'], 'all'))), true);
  assert.equal(codexScopePlsVisible(entry, { cwd: '/other' }, codexScopePlsViewScope(api([]))), true);
  assert.equal(codexScopePlsVisible({ kind: 'remote' }, null, scope), false);
  assert.equal(codexScopePlsVisible({ kind: 'remote' }, null, codexScopePlsViewScope(api(['/a'], 'workspace', true))), true);
  assert.equal(codexScopePlsVisible({ kind: 'local' }, null, scope), true);
  assert.equal(codexScopePlsVisible(entry, null, scope), false);
  assert.equal(codexScopePlsReadViewScope({ querySelector: () => ({ content: 'bad JSON' }) }), null);
});

test('host patch changes display results while backend requests, responses and source lists stay intact', async () => {
  const original = await fs.readFile(path.join(__dirname, 'fixtures/viewHost.js'));
  const definition = { ...reviewed, originalHash: sha256(original) };
  const source = transform(original, definition);
  const sandbox = { module: { exports: {} }, process, ph: text => text.replace(/"/g, '&quot;'),
    require: name => name === 'vscode' ? api(['/a']) : require(name) };
  vm.runInNewContext(source.toString(), sandbox);
  const host = new sandbox.module.exports();
  const threads = Object.freeze([Object.freeze({ cwd: '/a' }), Object.freeze({ cwd: '/other' })]);
  host.requestThreadList = async () => ({ data: threads });
  assert.deepEqual(Array.from(await host.provideChatSessionItems()), [threads[0]]);
  assert.equal(threads.length, 2);
  host.findPanelByWebview = () => null;
  assert.match(host.webviewMetaTags({}), /codex-scope-pls-view/);
  const params = Object.freeze({ ancestorThreadId: 'parent', cursor: 'next', cwd: '/original' });
  for (const method of ['thread/list', 'thread/read', 'thread/resume', 'thread/queue/list', 'turn/start', 'turn/steer', 'fs/getMetadata']) {
    assert.equal(host.sendProviderRequest('ui', 'id', method, params).params, params);
  }
  const request = Object.freeze({ method: 'GET', url: '/wham/tasks/list' });
  assert.equal((await host.fetchHttp('id', request)).forwarded, request);
});

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-view-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const host = await fs.readFile(path.join(__dirname, 'fixtures/viewHost.js'));
  const hostDefinition = { ...reviewed, version: '99.1.1', originalHash: sha256(host), previousPatchedHashes: [] };
  const history = await fs.readFile(path.join(__dirname, 'fixtures/historyRows.js'));
  const row = Buffer.concat([Buffer.from('function render(n,Fe,Te,document){const t=[],wt=n=>n,Tt=n=>n;' +
    reviewed.presentation.rowBefore + '\nmodule.exports=render;\n'), history,
    await fs.readFile(path.join(__dirname, 'fixtures/viewMessage.js'))]);
  const viewDefinition = { ...reviewed.presentation, version: '99.1.1', originalHash: sha256(row) };
  const header = await fs.readFile(path.join(__dirname, 'fixtures/headerPresentation.js'));
  const headerDefinition = { ...reviewed.presentation.additionalTargets[0], version: '99.1.1', originalHash: sha256(header) };
  hostDefinition.currentPatchedHashes = [sha256(transform(host, hostDefinition))];
  viewDefinition.currentPatchedHashes = [sha256(transform(row, viewDefinition))];
  headerDefinition.currentPatchedHashes = [sha256(transform(header, headerDefinition))];
  viewDefinition.additionalTargets = [headerDefinition];
  hostDefinition.presentation = viewDefinition;
  const targets = [
    { target: path.join(directory, 'out/extension.js'), definition: hostDefinition },
    { target: path.join(directory, viewDefinition.relativePath), definition: viewDefinition },
    { target: path.join(directory, headerDefinition.relativePath), definition: headerDefinition }
  ];
  for (const item of targets) await fs.mkdir(path.dirname(item.target), { recursive: true });
  await fs.writeFile(targets[0].target, host);
  await fs.writeFile(targets[1].target, row);
  await fs.writeFile(targets[2].target, header);
  return { targets, host, row, header };
}

test('final GUI renderer hides rows without changing the original entry or summary', async t => {
  const { targets, row } = await fixture(t);
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(transform(row, targets[1].definition).toString(), sandbox);
  const entry = Object.freeze({ kind: 'local', conversationId: 'id' });
  const document = { querySelector: () => ({ content: JSON.stringify(codexScopePlsViewScope(api(['/a']))) }) };
  assert.equal(sandbox.module.exports(entry, { cwd: '/other' }, null, document), null);
  assert.equal(sandbox.module.exports(entry, { cwd: '/a' }, null, document), entry);
  assert.equal(sandbox.module.exports(Object.freeze({ kind: 'remote' }), null, null, document), null);
});

test('VS Code history calls filter local, cloud and pending rows directly, without the desktop renderer', async t => {
  const { targets, row } = await fixture(t);
  const stock = { module: { exports: {} } }, patched = { module: { exports: {} } };
  vm.runInNewContext(row.toString(), stock);
  vm.runInNewContext(transform(row, targets[1].definition).toString(), patched);
  const threads = Object.freeze({ a: Object.freeze({ cwd: '/a' }), b: Object.freeze({ cwd: '/b' }) });
  const entries = Object.freeze([
    Object.freeze({ kind: 'local', conversation: Object.freeze({ id: 'a' }) }),
    Object.freeze({ kind: 'local', conversation: Object.freeze({ id: 'b' }) }),
    Object.freeze({ kind: 'remote', task: Object.freeze({ id: 'cloud' }) }),
    Object.freeze({ kind: 'local', pendingThreadStart: Object.freeze({ task: Object.freeze({ cwd: '/b' }) }) }),
    Object.freeze({ kind: 'local', pendingWorktree: Object.freeze({ sourceWorkspaceRoot: '/b' }) })
  ]);
  const document = roots => ({ querySelector: () => ({
    content: JSON.stringify(codexScopePlsViewScope(api(roots)))
  }) });
  const reads = [];
  const readThreadState = id => { reads.push(id); return threads[id]; };
  const stockRows = stock.module.exports.history(entries, readThreadState, document(['/a']));
  assert.equal(stockRows.filter(Boolean).length, 5);
  assert.deepEqual(reads.splice(0), ['a', 'b']);
  const visible = roots => patched.module.exports.history(entries, readThreadState, document(roots)).filter(Boolean);
  assert.deepEqual(Array.from(visible(['/a']), item => item.conversationId), ['a']);
  assert.deepEqual(reads.splice(0), ['a', 'b'], 'existing state reads still run for hidden rows');
  const rowsB = visible(['/b']);
  assert.equal(rowsB.length, 3);
  assert.equal(rowsB[0].conversationId, 'b');
  assert.equal(rowsB[1], entries[3].pendingThreadStart);
  assert.equal(rowsB[2], entries[4].pendingWorktree);
  assert.equal(visible(['/a', '/b']).length, 4);
  assert.equal(visible([]).length, 4);
  assert.equal(entries.length, 5);
});

test('0.3.0 GUI bytes migrate and restore using their original backup', async t => {
  const { targets, row } = await fixture(t);
  const definition = targets[1].definition;
  const previous = transform(row, { ...definition, points: definition.points.slice(0, 1) });
  definition.previousPatchedHashes = [sha256(previous)];
  await fs.writeFile(backupPath(targets[1].target, definition), row);
  await fs.writeFile(targets[1].target, previous);
  const installation = await installationTargets(targets[0].target, targets[0].definition);
  assert.equal(installation.length, 3);
  assert.equal((await changeAll(installation, 'apply'))[1].changed, true);
  assert.deepEqual(await fs.readFile(targets[1].target), transform(row, definition));
  await changeAll(installation, 'restore');
  assert.deepEqual(await fs.readFile(targets[1].target), row);
});

async function retiredSubmitFixture(t) {
  const { targets, host, row, header } = await fixture(t);
  const original = Buffer.from('export const composer = "stock";\n');
  const previous = Buffer.from('export const composer = "0.3.5 submission patch";\n');
  const definition = { ...reviewed.presentation.additionalTargets[1], version: '99.1.1',
    originalHash: sha256(original), currentPatchedHashes: [sha256(original)],
    previousPatchedHashes: [sha256(previous)] };
  assert.deepEqual(definition.points, []);
  assert.deepEqual(transform(original, definition), original);
  const target = path.join(path.dirname(path.dirname(targets[0].target)), definition.relativePath);
  targets[0].definition.presentation.additionalTargets.push(definition);
  targets.push({ target, definition });
  await fs.writeFile(target, previous);
  const oldHostDefinition = { ...targets[0].definition, points: targets[0].definition.points.map(point =>
    point.name === 'view scope metadata' ? { ...point, after: point.after.replace('view-meta:1', 'view-meta:2') } : point) };
  const oldHost = transform(host, oldHostDefinition);
  assert.notDeepEqual(oldHost, transform(host, targets[0].definition));
  targets[0].definition.previousPatchedHashes = [sha256(oldHost)];
  await fs.writeFile(targets[0].target, oldHost);
  await fs.writeFile(backupPath(targets[0].target, targets[0].definition), host);
  return { targets, originals: [host, row, header, original], previous, oldHost };
}

test('0.3.5 submission asset is restored while the three display targets migrate', async t => {
  const { targets, originals } = await retiredSubmitFixture(t);
  await fs.writeFile(backupPath(targets[3].target, targets[3].definition), originals[3]);
  const installation = await installationTargets(targets[0].target, targets[0].definition);
  assert.equal(installation.length, 4);
  assert.deepEqual((await changeAll(installation, 'apply')).map(result => result.changed), [true, true, true, true]);
  for (let index = 0; index < 3; index++) {
    assert.deepEqual(await fs.readFile(targets[index].target), transform(originals[index], targets[index].definition));
  }
  assert.deepEqual(await fs.readFile(targets[3].target), originals[3]);
  assert.deepEqual((await changeAll(installation, 'apply')).map(result => result.changed), [false, false, false, false]);
  await changeAll(installation, 'restore');
  for (let index = 0; index < targets.length; index++) {
    assert.deepEqual(await fs.readFile(targets[index].target), originals[index]);
  }
});

test('retired submission bytes require their original backup before any migration', async t => {
  const { targets, previous, oldHost } = await retiredSubmitFixture(t);
  const installation = await installationTargets(targets[0].target, targets[0].definition);
  await assert.rejects(changeAll(installation, 'apply'), { code: 'ENOENT' });
  assert.deepEqual(await fs.readFile(targets[0].target), oldHost);
  assert.deepEqual(await fs.readFile(targets[3].target), previous);
  await fs.writeFile(targets[3].target, Buffer.concat([previous, Buffer.from('x')]));
  await assert.rejects(installationTargets(targets[0].target, targets[0].definition), /webview SHA/);
  assert.deepEqual(await fs.readFile(targets[0].target), oldHost);
});

test('original submission asset stays untouched and creates no new backup', async t => {
  const { targets, originals } = await retiredSubmitFixture(t);
  await fs.writeFile(targets[0].target, originals[0]);
  await fs.writeFile(targets[3].target, originals[3]);
  const installation = await installationTargets(targets[0].target, targets[0].definition);
  assert.equal((await changeAll(installation, 'apply'))[3].changed, false);
  assert.deepEqual(await fs.readFile(targets[3].target), originals[3]);
  await assert.rejects(fs.stat(backupPath(targets[3].target, targets[3].definition)), { code: 'ENOENT' });
});

test('all display targets apply and restore together; unknown GUI bytes refuse before host mutation', async t => {
  const { targets, host, row, header } = await fixture(t);
  assert.equal((await changeAll(targets, 'apply')).every(result => result.changed), true);
  assert.equal((await changeAll(targets, 'apply')).every(result => !result.changed), true);
  await changeAll(targets, 'restore');
  assert.deepEqual(await fs.readFile(targets[0].target), host);
  assert.deepEqual(await fs.readFile(targets[1].target), row);
  assert.deepEqual(await fs.readFile(targets[2].target), header);
  await fs.writeFile(targets[2].target, 'changed header');
  await assert.rejects(installationTargets(targets[0].target, targets[0].definition), /webview SHA/);
  assert.deepEqual(await fs.readFile(targets[0].target), host);
  assert.deepEqual(await fs.readFile(targets[1].target), row);
  await fs.writeFile(targets[2].target, header);
  await fs.writeFile(targets[1].target, 'changed GUI');
  await assert.rejects(installationTargets(targets[0].target, targets[0].definition), /webview SHA/);
  assert.deepEqual(await fs.readFile(targets[0].target), host);
  await assert.rejects(installationTargets(targets[0].target, { ...targets[0].definition, presentation: undefined }), /restoration only/);
});

test('previous display revisions upgrade together, preserve originals and refuse a missing header backup', async t => {
  const { targets, host, row, header } = await fixture(t);
  const originals = [host, row, header];
  // Model earlier display points on every target, using fixture bytes only.
  for (let index = 0; index < targets.length; index++) {
    const { target, definition } = targets[index];
    const previous = transform(originals[index], { ...definition, points: definition.points.slice(0, 1) });
    definition.previousPatchedHashes = [sha256(previous)];
    await fs.writeFile(backupPath(target, definition), originals[index]);
    await fs.writeFile(target, previous);
  }
  const headerBackup = backupPath(targets[2].target, targets[2].definition);
  await fs.unlink(headerBackup);
  const prior = await Promise.all(targets.map(({ target }) => fs.readFile(target)));
  await assert.rejects(changeAll(targets, 'apply'), { code: 'ENOENT' });
  for (let index = 0; index < targets.length; index++) {
    assert.deepEqual(await fs.readFile(targets[index].target), prior[index]);
  }
  await fs.writeFile(headerBackup, header);
  assert.ok((await changeAll(targets, 'apply')).every(result => result.changed));
  assert.ok((await changeAll(targets, 'apply')).every(result => !result.changed));
  for (let index = 0; index < targets.length; index++) {
    assert.deepEqual(await fs.readFile(backupPath(targets[index].target, targets[index].definition)), originals[index]);
  }
  await changeAll(targets, 'restore');
  for (let index = 0; index < targets.length; index++) {
    assert.deepEqual(await fs.readFile(targets[index].target), originals[index]);
  }
});

test('header replacement failure rolls back host and app and preserves all original backups', async t => {
  const { targets, host, row, header } = await fixture(t);
  const originalRename = fs.rename;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (to === targets[2].target) throw Object.assign(new Error('synthetic failure'), { code: 'EACCES' });
    return originalRename(from, to);
  });
  await assert.rejects(changeAll(targets, 'apply'), { code: 'EACCES' });
  assert.deepEqual(await fs.readFile(targets[0].target), host);
  assert.deepEqual(await fs.readFile(targets[1].target), row);
  assert.deepEqual(await fs.readFile(targets[2].target), header);
  assert.deepEqual(await fs.readFile(backupPath(targets[0].target, targets[0].definition)), host);
  assert.deepEqual(await fs.readFile(backupPath(targets[1].target, targets[1].definition)), row);
  assert.deepEqual(await fs.readFile(backupPath(targets[2].target, targets[2].definition)), header);
});
