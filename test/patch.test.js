'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const definitions = require('../src/patch/definitions');
const { sha256, transform, selectDefinition } = require('../src/patch/integrity');
const { backupPath, readBackup } = require('../src/patch/backup');
const { change, inspect } = require('../src/patch/patcher');
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-scope-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'extension.js');
  const original = await fs.readFile(path.join(__dirname, 'fixtures/provider.js'));
  const definition = { ...definitions[0], version: '99.1.1', originalHash: sha256(original) };
  await fs.writeFile(target, original);
  return { target, original, definition };
}
test('SHA-256 known vector and unsupported profile/build refusal', async t => {
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.throws(() => selectDefinition('future', 'linux', 'x64', definitions), /Invalid/);
  assert.throws(() => selectDefinition('99.1.1', 'freebsd', 'x64', definitions), /Unsupported/);
  const f = await fixture(t);
  await assert.rejects(change(f.target, definitions[0], 'apply'));
  assert.deepEqual(await fs.readFile(f.target), f.original);
});
test('exact-one match, missing and duplicated boundary refuse even with matching hash', async t => {
  const { original, definition } = await fixture(t);
  for (const bytes of [Buffer.from('unrecognized'), Buffer.concat([original, original])]) {
    assert.throws(() => transform(bytes, { ...definition, originalHash: sha256(bytes) }), /exactly one/);
  }
});
test('apply twice, verify backup selection, restore twice and reapply', async t => {
  const { target, original, definition } = await fixture(t);
  await fs.writeFile(`${target}.unrelated`, 'leave me');
  assert.equal((await change(target, definition, 'apply')).changed, true);
  assert.equal((await change(target, definition, 'apply')).changed, false);
  assert.deepEqual(await readBackup(target, definition), original);
  assert.equal((await inspect(target, definition)).isPatched, true);
  assert.equal((await change(target, definition, 'restore')).changed, true);
  assert.equal((await change(target, definition, 'restore')).changed, false);
  assert.deepEqual(await fs.readFile(target), original);
  assert.equal(await fs.readFile(`${target}.unrelated`, 'utf8'), 'leave me');
  assert.equal((await change(target, definition, 'apply')).changed, true);
});
test('missing or corrupted backup refuses idempotency and restoration', async t => {
  const { target, original, definition } = await fixture(t);
  await change(target, definition, 'apply');
  const patched = await fs.readFile(target);
  await fs.unlink(backupPath(target, definition));
  for (const action of ['apply', 'restore']) await assert.rejects(change(target, definition, action));
  await fs.writeFile(backupPath(target, definition), 'bad');
  await assert.rejects(change(target, definition, 'restore'), /Backup SHA/);
  assert.deepEqual(await fs.readFile(target), patched);
  await fs.writeFile(target, original);
  await assert.rejects(change(target, definition, 'apply'), /Backup SHA/);
  assert.deepEqual(await fs.readFile(target), original);
});
test('partially patched and modified targets remain untouched', async t => {
  const { target, definition } = await fixture(t);
  await change(target, definition, 'apply');
  for (const bytes of [Buffer.from('/* codex-scope-pls:1 */'), Buffer.concat([await fs.readFile(target), Buffer.from('x')])]) {
    await fs.writeFile(target, bytes);
    for (const action of ['apply', 'restore']) await assert.rejects(change(target, definition, action), /Unknown or partially/);
    assert.deepEqual(await fs.readFile(target), bytes);
  }
});
test('locks and symlinks fail closed', async t => {
  const { target, original, definition } = await fixture(t);
  await fs.writeFile(`${target}.codex-scope-pls.lock`, '');
  await assert.rejects(change(target, definition, 'apply'), { code: 'EEXIST' });
  await fs.unlink(`${target}.codex-scope-pls.lock`);
  await fs.rename(target, `${target}.original`);
  await fs.symlink(`${target}.original`, target);
  await assert.rejects(change(target, definition, 'apply'), /linked file/);
  assert.deepEqual(await fs.readFile(`${target}.original`), original);
});
test('patched boundary executes with a mock local server; other methods keep identity', async t => {
  const { original, definition } = await fixture(t);
  let roots = ['/a', '/b']; let mode = 'workspace';
  const vscode = { env: {}, workspace: {
    getConfiguration: section => ({ get: () => section === 'codexScopePls' ? mode : undefined }),
    get workspaceFolders() { return roots.map(fsPath => ({ uri: { scheme: 'file', fsPath } })); }
  } };
  const context = { module: { exports: {} }, oG: () => false,
    require: name => name === 'vscode' ? vscode : require(name) };
  // Only synthetic fixture code runs in a test VM; production never evaluates JS.
  vm.runInNewContext(transform(original, definition).toString(), context);
  const provider = new context.module.exports();
  const params = { limit: 10, cursor: 'page2' };
  const listed = provider.sendProviderRequest('ui', 'id', 'thread/list', params, false, false);
  assert.deepEqual(Array.from(listed.params.cwd), ['/a', '/b']);
  assert.equal(listed.params.cursor, 'page2');
  for (const method of ['turn/start', 'thread/start', 'thread/read', 'thread/search', 'account/read']) {
    assert.equal(provider.sendProviderRequest('ui', 'id', method, params, false, false).params, params);
  }
  roots = ['/c'];
  assert.deepEqual(Array.from(provider.sendProviderRequest('ui', 'id', 'thread/list', params, false, false).params.cwd), ['/c']);
  mode = 'all';
  assert.equal(provider.sendProviderRequest('ui', 'id', 'thread/list', params, false, false).params, params);
});
test('replacement failure preserves original and backup, cleaning only owned temp/lock', async t => {
  const { target, original, definition } = await fixture(t);
  const rename = t.mock.method(fs, 'rename', async () => { throw Object.assign(new Error('simulated rename failure'), { code: 'EACCES' }); });
  await assert.rejects(change(target, definition, 'apply'), { code: 'EACCES' });
  rename.mock.restore();
  assert.deepEqual(await fs.readFile(target), original);
  assert.deepEqual(await readBackup(target, definition), original);
  assert.deepEqual((await fs.readdir(path.dirname(target))).sort(), [path.basename(target), path.basename(backupPath(target, definition))].sort());
});
test('backup from a different version is never selected', async t => {
  const { target, original, definition } = await fixture(t);
  await fs.writeFile(backupPath(target, { ...definition, version: '0.0.0' }), original);
  await fs.writeFile(target, transform(original, definition));
  await assert.rejects(change(target, definition, 'restore'), { code: 'ENOENT' });
});
test('exact previous patch upgrades with the same original backup and restores both points', async t => {
  const { target, original, definition } = await fixture(t);
  const oldDefinition = { ...definition, points: [definition.points[0]], previousPatchedHashes: [] };
  await change(target, oldDefinition, 'apply');
  const previous = await fs.readFile(target);
  const nextDefinition = { ...definition, previousPatchedHashes: [sha256(previous)] };
  const state = await inspect(target, nextDefinition);
  assert.equal(state.isPreviousPatch, true);
  assert.equal((await change(target, nextDefinition, 'apply')).changed, true);
  assert.deepEqual(await readBackup(target, nextDefinition), original);
  assert.equal((await change(target, nextDefinition, 'apply')).changed, false);
  await change(target, nextDefinition, 'restore');
  assert.deepEqual(await fs.readFile(target), original);
  await fs.writeFile(target, previous);
  await change(target, nextDefinition, 'restore');
  assert.deepEqual(await fs.readFile(target), original);
});
test('previous patch hash does not permit missing backup or one-byte modifications', async t => {
  const { target, original, definition } = await fixture(t);
  const previous = transform(original, { ...definition, points: [definition.points[0]] });
  const nextDefinition = { ...definition, previousPatchedHashes: [sha256(previous)] };
  await fs.writeFile(target, previous);
  await assert.rejects(change(target, nextDefinition, 'apply'), { code: 'ENOENT' });
  await fs.writeFile(backupPath(target, nextDefinition), original);
  await fs.writeFile(target, Buffer.concat([previous, Buffer.from(' ')]));
  await assert.rejects(change(target, nextDefinition, 'apply'), /Unknown or partially/);
});
test('each patch point must match exactly once even if the others match', async t => {
  const { original, definition } = await fixture(t);
  for (const point of definition.points) {
    for (const replacement of ['', point.before + point.before]) {
      const malformed = Buffer.from(original.toString().replace(point.before, () => replacement));
      assert.throws(() => transform(malformed, { ...definition, originalHash: sha256(malformed) }), /exactly one/);
    }
  }
});
