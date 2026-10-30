'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const profiles = require('../src/patch/definitions');
const { selectDefinition, transform, sha256 } = require('../src/patch/integrity');
const { hostDefinition, appDefinition, headerDefinition } = require('../src/patch/structuralPoints');
const { locateInstallation, installationTargets } = require('../src/codexLocator');
const { changeAll } = require('../src/patch/patcher');
const { backupPath } = require('../src/patch/backup');
const { receiptPath } = require('../src/patch/receipt');
const { restoreInstalled } = require('../src/uninstall');
const { recognize } = require('../src/patch/structuralInstallation');
const { assessInstallation } = require('../scripts/check-codex-compatibility');

const paths = ['out/extension.js', 'webview/assets/app-initial-abcdef.js', 'webview/assets/header-fedcba.js'];
async function fixtureBytes() {
  return Promise.all(['Host', 'App', 'Header'].map(name => fs.readFile(path.join(__dirname, `fixtures/structural${name}.js`))));
}
async function installation(t, { rename = false } = {}) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-structure-test-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'openai.chatgpt-99.123.456');
  await fs.mkdir(path.join(root, 'out'), { recursive: true });
  await fs.mkdir(path.join(root, 'webview/assets'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ publisher: 'openai', name: 'chatgpt', version: '99.123.456' }));
  const originals = (await fixtureBytes()).map((bytes, index) => {
    // Unrelated edits, generated identifiers and content-hashed asset names all
    // differ from every reviewed full-file profile.
    let source = bytes.toString();
    if (rename) source = source.replace(/\bgn\b/g, 'reactHooks').replace(/\bfn\b/g, 'deriveHistory')
      .replace(/\bBe\b/g, 'resolvedSummary');
    return Buffer.from(`${source}\n// unrelated release ${index}\n`);
  });
  for (const [index, relativePath] of paths.entries()) await fs.writeFile(path.join(root, relativePath), originals[index]);
  await fs.writeFile(path.join(root, 'webview/index.html'), '<script type="module" src="./assets/entry.js"></script>');
  await fs.writeFile(path.join(root, 'webview/assets/entry.js'), 'import "./app-initial-abcdef.js";import "./header-fedcba.js";');
  const profile = selectDefinition('99.123.456', process.platform, process.arch, profiles);
  const resolve = async restoration => {
    const definition = await locateInstallation(root, profile, restoration);
    return installationTargets(path.join(root, paths[0]), definition, restoration);
  };
  return { parent, root, originals, profile, resolve };
}

test('new versions, changed file hashes, asset names and generated identifiers apply without an allowlist entry', async t => {
  const f = await installation(t, { rename: true });
  const targets = await f.resolve();
  assert.equal(targets[0].definition.structural, true);
  assert.deepEqual(targets.map(target => path.relative(f.root, target.target)), paths);
  assert.deepEqual((await changeAll(targets, 'apply')).map(result => result.changed), [true, true, true]);
  const receipt = JSON.parse(await fs.readFile(receiptPath(targets[0].target), 'utf8'));
  assert.equal(receipt.version, '99.123.456');
  for (const [index, target] of targets.entries()) {
    assert.deepEqual(await fs.readFile(backupPath(target.target, target.definition)), f.originals[index]);
    assert.equal(sha256(await fs.readFile(target.target)), receipt.targets[index].patchedHashes[0]);
  }
  assert.deepEqual((await changeAll(await f.resolve(), 'apply')).map(result => result.changed), [false, false, false]);
  const restore = await f.resolve(true);
  assert.ok(restore.every(target => target.definition.receiptOnly && target.definition.points.length === 0));
  assert.deepEqual((await changeAll(restore, 'restore')).map(result => result.changed), [true, true, true]);
  assert.deepEqual((await changeAll(await f.resolve(true), 'restore')).map(result => result.changed), [false, false, false]);
  for (const [index, relativePath] of paths.entries()) assert.deepEqual(await fs.readFile(path.join(f.root, relativePath)), f.originals[index]);
  await changeAll(await f.resolve(), 'apply');
  assert.equal((await restoreInstalled(f.parent)).filter(result => result.changed).length, 3);
});

test('an interrupted mixture of original and patched files can reapply and restore', async t => {
  const f = await installation(t);
  await changeAll(await f.resolve(), 'apply');
  await fs.writeFile(path.join(f.root, paths[1]), f.originals[1]);
  assert.deepEqual((await changeAll(await f.resolve(), 'apply')).map(result => result.changed), [false, true, false]);
  await fs.writeFile(path.join(f.root, paths[2]), f.originals[2]);
  await changeAll(await f.resolve(true), 'restore');
  for (const [index, relativePath] of paths.entries()) assert.deepEqual(await fs.readFile(path.join(f.root, relativePath)), f.originals[index]);
});

test('reused legacy host bytes do not force a missing or obsolete GUI profile', async t => {
  const f = await installation(t);
  const host = hostDefinition(f.originals[0]);
  const legacy = { ...host, reviewedVersions: ['99.123.456'] };
  for (const presentation of [undefined, { relativePath: 'webview/assets/app-initial-000.js', originalHash: '0'.repeat(64),
    currentPatchedHashes: [], previousPatchedHashes: [], additionalTargets: [] }]) {
    const profile = { ...f.profile, bundles: [{ ...legacy, presentation }] };
    const resolved = await locateInstallation(f.root, profile);
    assert.equal(resolved.structural, true);
    assert.equal(resolved.presentation.relativePath, paths[1]);
  }
});

test('unknown modifications, malformed receipts, unsafe paths and missing/corrupt backups refuse restoration', async t => {
  for (const fault of ['modified', 'missing-backup', 'corrupt-backup', 'missing-receipt', 'malformed', 'path', 'version']) {
    const f = await installation(t);
    const targets = await f.resolve();
    await changeAll(targets, 'apply');
    const host = targets[0].target;
    const receiptFile = receiptPath(host);
    if (fault === 'modified') await fs.appendFile(targets[1].target, '// outside modification');
    if (fault === 'missing-backup') await fs.unlink(backupPath(targets[1].target, targets[1].definition));
    if (fault === 'corrupt-backup') await fs.writeFile(backupPath(targets[1].target, targets[1].definition), 'bad backup');
    if (fault === 'missing-receipt') await fs.unlink(receiptFile);
    if (fault === 'malformed') await fs.writeFile(receiptFile, '{');
    if (['path', 'version'].includes(fault)) {
      const receipt = JSON.parse(await fs.readFile(receiptFile, 'utf8'));
      if (fault === 'path') receipt.targets[1].relativePath = '../../outside.js';
      else receipt.version = '88.1.1';
      await fs.writeFile(receiptFile, JSON.stringify(receipt));
    }
    const before = await Promise.all(targets.map(target => fs.readFile(target.target)));
    for (const restoration of [false, true]) await assert.rejects(f.resolve(restoration), undefined, fault);
    assert.deepEqual(await Promise.all(targets.map(target => fs.readFile(target.target))), before, fault);
  }
});

test('a broken last target, duplicate asset or changed origin check leaves every file untouched', async t => {
  for (const fault of ['header', 'duplicate', 'origin', 'syntax', 'symlink']) {
    const f = await installation(t);
    if (fault === 'header') await fs.writeFile(path.join(f.root, paths[2]), f.originals[2].toString().replace('pendingThreadStarts:', 'changedPendingThreads:'));
    if (fault === 'duplicate') {
      await fs.writeFile(path.join(f.root, 'webview/assets/header-aabbcc.js'), f.originals[2]);
      await fs.appendFile(path.join(f.root, 'webview/assets/entry.js'), 'import "./header-aabbcc.js";');
    }
    if (fault === 'origin') await fs.writeFile(path.join(f.root, paths[1]), f.originals[1].toString().replace('e.origin!==r', 'e.origin===r'));
    if (fault === 'syntax') await fs.appendFile(path.join(f.root, paths[0]), '{broken');
    if (fault === 'symlink') {
      await fs.rename(path.join(f.root, paths[2]), path.join(f.root, 'original-header.js'));
      await fs.symlink(path.join(f.root, 'original-header.js'), path.join(f.root, paths[2]));
    }
    const before = await Promise.all(paths.map(relativePath => fs.readFile(path.join(f.root, relativePath))));
    await assert.rejects(f.resolve(), undefined, fault);
    assert.deepEqual(await Promise.all(paths.map(relativePath => fs.readFile(path.join(f.root, relativePath)))), before);
    await assert.rejects(fs.stat(receiptPath(path.join(f.root, paths[0]))), { code: 'ENOENT' });
  }
});

test('structural host uses its own escaping and filters native display results only', async () => {
  const [bytes] = await fixtureBytes();
  const definition = hostDefinition(bytes);
  const vscode = { workspace: { workspaceFolders: [{ uri: { scheme: 'file', fsPath: '/a<&"' } }],
    getConfiguration: () => ({ get: key => key === 'mode' ? 'workspace' : false }) } };
  const sandbox = { module: { exports: {} }, process, Wge: 'version', Hge: 'session', Gge: 'flavor', Ah: value => value,
    require: name => name === 'vscode' ? vscode : require(name) };
  vm.runInNewContext(transform(bytes, definition).toString(), sandbox);
  const host = new sandbox.module.exports();
  host.findPanelByWebview = () => null;
  const tag = host.webviewMetaTags({});
  assert.match(tag, /&lt;&amp;\\&quot;/);
  assert.doesNotMatch(tag, /\/a<&/);
  const rows = Object.freeze([Object.freeze({ id: 'own', cwd: '/a<&"' }), Object.freeze({ id: 'other', cwd: '/b' })]);
  host.requestThreadList = async () => ({ data: rows });
  host.toThreadListSummary = row => row;
  host.toChatSessionItem = row => row;
  assert.deepEqual(Array.from(await host.provideChatSessionItems(), row => row.summary.id), ['own']);
  assert.equal(rows.length, 2);
});

test('structural row guard and validated message parser preserve source data and stock messages', async () => {
  const [, bytes] = await fixtureBytes();
  const scope = { mode: 'workspace', roots: ['/a'], platform: 'linux', showCloudChats: false };
  const document = { querySelector: () => ({ content: JSON.stringify(scope) }) };
  const sandbox = { module: { exports: {} }, document, store: () => null, selector: null, key: null, Compiler: { c: count => Array(count) },
    E4e: () => false, T4e: value => typeof value.type === 'string', D4e: 'null' };
  vm.runInNewContext(transform(bytes, appDefinition(bytes)).toString(), sandbox);
  const { row, message } = sandbox.module.exports;
  const own = Object.freeze({ kind: 'local', conversationId: 'own', summary: Object.freeze({ cwd: '/a' }) });
  const other = Object.freeze({ kind: 'local', conversationId: 'other', summary: Object.freeze({ cwd: '/b' }) });
  assert.equal(row(own, null, document), own);
  assert.equal(row(other, null, document), null);
  scope.mode = 'all';
  assert.equal(row(other, null, document), other);
  const window = { location: { origin: 'vscode-test' } };
  const data = Object.freeze({ type: 'stock-message' });
  assert.equal(message({ origin: 'vscode-test', source: null, data }, window), data);
  assert.equal(message({ origin: 'other-origin', source: null, data }, window), null);
});

test('shifted row cache slots are derived, but invalid allocations and shadowed helper globals refuse', async () => {
  const [, bytes] = await fixtureBytes();
  const shifted = bytes.toString().replace(/\[(19[1-6])\]/g, (_, slot) => `[${Number(slot) + 20}]`).replace('.c)(197)', '.c)(217)');
  assert.doesNotThrow(() => appDefinition(Buffer.from(shifted)));
  assert.throws(() => appDefinition(Buffer.from(shifted.replace('.c)(217)', '.c)(210)'))), /cache access|allocation/);
  assert.throws(() => appDefinition(Buffer.from(bytes.toString().replace('function row(n,summary)', 'function row(n,summary,document)'))), /shadowed/);
  assert.throws(() => appDefinition(Buffer.from(bytes.toString().replace('store(selector,key)??Ae', 'store(selector,key)||Ae'))), /resolved row summary/);
});

test('a recorded prior patch revision upgrades with its original backup and remains recoverable', async t => {
  const f = await installation(t);
  let targets = await f.resolve();
  await changeAll(targets, 'apply');
  const host = targets[0].target, recordPath = receiptPath(host);
  const record = JSON.parse(await fs.readFile(recordPath, 'utf8'));
  const current = await fs.readFile(host);
  const prior = Buffer.concat([current, Buffer.from('\n// simulated prior Scope Pls patch revision')]);
  record.targets[0].patchedHashes = [sha256(prior)];
  await fs.writeFile(recordPath, JSON.stringify(record));
  await fs.writeFile(host, prior);
  targets = await f.resolve();
  assert.equal((await changeAll(targets, 'apply'))[0].changed, true);
  assert.deepEqual(await fs.readFile(host), current);
  const updated = JSON.parse(await fs.readFile(recordPath, 'utf8'));
  assert.deepEqual(updated.targets[0].patchedHashes, [sha256(current), sha256(prior)]);
  // Simulate interruption with the previous revision still on disk.
  await fs.writeFile(host, prior);
  await changeAll(await f.resolve(true), 'restore');
  assert.deepEqual(await fs.readFile(host), f.originals[0]);
});

test('a receipt changed after preparation aborts before any bundle replacement', async t => {
  const f = await installation(t);
  await changeAll(await f.resolve(), 'apply');
  const targets = await f.resolve();
  const before = await Promise.all(targets.map(target => fs.readFile(target.target)));
  const file = receiptPath(targets[0].target);
  const receipt = JSON.parse(await fs.readFile(file, 'utf8'));
  receipt.targets[0].patchedHashes.push('a'.repeat(64));
  await fs.writeFile(file, JSON.stringify(receipt));
  await assert.rejects(changeAll(targets, 'apply'), /receipt changed/);
  assert.deepEqual(await Promise.all(targets.map(target => fs.readFile(target.target))), before);
});

test('Marketplace assessment accepts unfamiliar hashes through the same structural checks', async () => {
  const [host, app, header] = await fixtureBytes();
  const assets = [{ relativePath: paths[1], bytes: app }, { relativePath: paths[2], bytes: header }];
  assert.equal(assessInstallation(profiles[0], host, assets, '99.1.1').status, 'recognized-structure');
  assert.equal(assessInstallation(profiles[0], Buffer.concat([host, Buffer.from('\n// new release')]), assets, '99.2.2').status, 'recognized-structure');
  assert.equal(assessInstallation(profiles[0], host, assets.slice(0, 1), '99.1.1').status, 'incompatible-structure');
  assert.throws(() => recognize(host, [assets[0], assets[1], { ...assets[1], relativePath: 'webview/assets/header-aa.js' }]), /matched 2/);
  assert.doesNotThrow(() => headerDefinition(header));
});
