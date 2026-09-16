'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const definitions = require('../src/patch/definitions');
const { selectDefinition, sha256, transform } = require('../src/patch/integrity');
const { change } = require('../src/patch/patcher');
const { codexScopePlsFilter } = require('../src/workspaceScope');
const { locate } = require('../src/codexLocator');

const expectedProfiles = [
  'linux/x64', 'linux/arm64', 'darwin/x64', 'darwin/arm64',
  'win32/x64', 'win32/arm64'
];
test('only reviewed platform profiles are allowlisted; the exact bundle hash decides compatibility', () => {
  assert.deepEqual(definitions.map(d => `${d.platform}/${d.arch}`), expectedProfiles);
  for (const d of definitions) {
    const reviewed = selectDefinition('26.908.40401', d.platform, d.arch, definitions);
    assert.equal(reviewed.knownVersion, true);
    assert.equal(reviewed.version, '26.908.40401');
    const unlisted = selectDefinition('99.1.1-preview.1', d.platform, d.arch, definitions);
    assert.equal(unlisted.knownVersion, false);
    assert.equal(unlisted.version, '99.1.1-preview.1');
    assert.equal(d.originalHash, '820691c93be40e73f0929b633cddc694b41775050cd72283faba283e53941f4f');
    assert.throws(() => selectDefinition('99.1.1', d.platform, d.arch, [...definitions, d]), /Unsupported/);
  }
  assert.throws(() => selectDefinition('unsafe/name', 'linux', 'x64', definitions), /Invalid/);
  for (const [platform, arch] of [['freebsd', 'x64'], ['darwin', 'ia32'], ['linux', 'arm'], ['win32', 'ia32']]) {
    assert.throws(() => selectDefinition('99.1.1', platform, arch, definitions), /Unsupported/);
  }
});

test('an unlisted version is accepted only with an exact reviewed original or patch hash', async t => {
  const original = await fs.readFile(path.join(__dirname, 'fixtures/provider.js'));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-platform-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(directory, 'out'));
  const target = path.join(directory, 'out/extension.js');
  await fs.writeFile(target, original);
  const vscode = {
    env: {},
    extensions: { getExtension: () => ({ extensionPath: directory, packageJSON: { version: '99.1.1-preview.1' } }) },
    workspace: { workspaceFolders: [], getConfiguration: () => ({ get: () => undefined }) }
  };
  const profile = { ...definitions[0], originalHash: sha256(original), currentPatchedHashes: [], previousPatchedHashes: [] };
  profile.currentPatchedHashes = [sha256(transform(original, profile))];
  const located = await locate(vscode, false, [profile]);
  assert.equal(located.target, path.join(await fs.realpath(directory), 'out/extension.js'));
  assert.equal(located.definition.knownVersion, false);
  await fs.writeFile(target, transform(original, located.definition));
  assert.equal((await locate(vscode, false, [profile])).currentHash, located.definition.currentPatchedHashes[0]);
  await fs.writeFile(target, Buffer.concat([original, Buffer.from('x')]));
  await assert.rejects(locate(vscode, false, [profile]), /Unsupported Codex bundle SHA-256/);
});

for (const d of definitions) test(`${d.platform}/${d.arch}: fixture apply/restore`, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-platform-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(directory, 'out'));
  const target = path.join(directory, 'out/extension.js');
  const original = await fs.readFile(path.join(__dirname, 'fixtures/provider.js'));
  await fs.writeFile(target, original);
  // Production profiles must refuse this synthetic bundle on every platform.
  await assert.rejects(change(target, { ...d, version: '99.1.1' }, 'apply'));
  assert.deepEqual(await fs.readFile(target), original);
  const fixtureDefinition = { ...d, version: '99.1.1', originalHash: sha256(original) };
  await fs.chmod(target, 0o640);
  await change(target, fixtureDefinition, 'apply');
  assert.equal((await fs.stat(target)).mode & 0o777, 0o640);
  assert.equal((await change(target, fixtureDefinition, 'apply')).changed, false);
  await change(target, fixtureDefinition, 'restore');
  assert.deepEqual(await fs.readFile(target), original);
});

test('Linux and macOS paths preserve spaces, Unicode and case without alias guessing', () => {
  for (const roots of [
    ['/home/user/Project A/', '/home/user/Project B'],
    ['/Users/Developer/Project A/', '/Volumes/Work/Prójèct B']
  ]) {
    const vscode = { env: {}, workspace: {
      workspaceFolders: roots.map(fsPath => ({ uri: { scheme: 'file', fsPath } })),
      getConfiguration: section => ({ get: () => section === 'codexScopePls' ? 'workspace' : undefined })
    } };
    assert.deepEqual(codexScopePlsFilter({}, vscode).cwd, roots.map(root => root.replace(/\/$/, '')));
  }
});
