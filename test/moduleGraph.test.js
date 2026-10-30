'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { discoverModules, assetPath } = require('../src/patch/moduleGraph');
const { recognize, discoverRoleModules } = require('../src/patch/structuralInstallation');
const { selectDefinition, sha256, transform } = require('../src/patch/integrity');
const { locateInstallation, installationTargets } = require('../src/codexLocator');
const { changeAll } = require('../src/patch/patcher');
const { backupPath } = require('../src/patch/backup');
const { receiptPath, validate } = require('../src/patch/receipt');
const { assessPackage } = require('../scripts/check-codex-compatibility');
const profiles = require('../src/patch/definitions');
const { parse } = require('../src/patch/structure');

async function fixtures() {
  const read = name => fs.readFile(path.join(__dirname, 'fixtures', name), 'utf8');
  const [host, app, header, splitHeader, notification] = await Promise.all([
    read('structuralHost.js'), read('structuralApp.js'), read('structuralHeader.js'), read('splitHeader.js'), read('splitNotification.js')
  ]);
  const row = parse(app).body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'row');
  return { host, app, header, splitHeader, notification, row: app.slice(row.start, row.end) };
}
function graphReader(files, reads = []) {
  return async file => {
    reads.push(file);
    if (!files.has(file)) throw new Error(`Missing graph fixture: ${file}`);
    return Buffer.from(files.get(file));
  };
}
async function layout(kind) {
  const f = await fixtures();
  const gui = kind === 'split' ? [
    ['webview/assets/nested/events.mjs', f.notification], ['webview/assets/items.js', f.row], ['webview/assets/history.js', f.splitHeader]
  ] : kind === 'single' ? [['webview/assets/everything.js', `${f.app}\n${f.header}`]] : [
    ['webview/assets/app-initial-abc.js', f.app], ['webview/assets/header-def.js', f.header]
  ];
  const files = new Map([['out/extension.js', f.host], ['webview/index.html', '<script src="./assets/boot.js" type="module"></script>'],
    ['webview/assets/boot.js', gui.map(([file]) => `import(${JSON.stringify('./' + file.slice('webview/assets/'.length))});`).join('\n')], ...gui]);
  return { files, gui };
}
async function temporaryInstallation(t, files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-graph-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [file, content] of files) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), content);
  }
  const profile = selectDefinition('99.8.7', process.platform, process.arch, profiles);
  const resolve = async restoration => installationTargets(path.join(root, 'out/extension.js'),
    await locateInstallation(root, profile, restoration), restoration);
  return { root, profile, resolve };
}

for (const [kind, count] of [['combined', 3], ['split', 4], ['single', 2]]) {
  test(`${kind} layout discovers roles without filename prefixes, patches and restores ${count} targets`, async t => {
    const { files } = await layout(kind);
    const reads = [];
    const modules = await discoverRoleModules(graphReader(files, reads));
    const targets = recognize(Buffer.from(files.get('out/extension.js')), modules);
    assert.equal(targets.length, count);
    assert.deepEqual(targets.flatMap(target => target.roles).sort(), ['history', 'host', 'notifications', 'rows']);
    assert.equal(reads[0], 'webview/index.html');
    const installed = await temporaryInstallation(t, files);
    let resolved = await installed.resolve();
    await changeAll(resolved, 'apply');
    assert.ok((await changeAll(await installed.resolve(), 'apply')).every(result => !result.changed));
    const record = JSON.parse(await fs.readFile(receiptPath(resolved[0].target), 'utf8'));
    assert.equal(record.schema, 2);
    assert.equal(record.targets.length, count);
    // A mixed state after interruption remains exactly recoverable.
    await fs.writeFile(resolved[1].target, files.get(path.relative(installed.root, resolved[1].target)));
    await changeAll(await installed.resolve(true), 'restore');
    for (const item of resolved) assert.equal(await fs.readFile(item.target, 'utf8'), files.get(path.relative(installed.root, item.target)));
    // Watcher and runtime discover the same layout through the same reader.
    assert.equal((await assessPackage(profiles[0], Buffer.from(files.get('out/extension.js')), graphReader(files), '99.8.7')).status, 'recognized-structure');
  });
}

test('cycles, re-exports, template-string dynamic imports and unrelated orphan files are handled deliberately', async () => {
  const { files, gui } = await layout('split');
  files.set('webview/assets/boot.js', 'export * from "./bridge.mjs";');
  files.set('webview/assets/bridge.mjs', 'import "./boot.js";' + gui.map(([file]) => `import(\`./${file.slice('webview/assets/'.length)}\`);`).join(''));
  files.set('webview/assets/orphan.js', files.get(gui[2][0]));
  const reads = [];
  assert.equal(recognize(Buffer.from(files.get('out/extension.js')), await discoverRoleModules(graphReader(files, reads))).length, 4);
  assert.equal(reads.filter(file => file === 'webview/assets/boot.js').length, 1);
  assert.ok(!reads.includes('webview/assets/orphan.js'));
});

test('two recognized roles in the inspected graph are ambiguous; strings and comments are not imports', async () => {
  const { files, gui } = await layout('split');
  files.set('webview/assets/duplicate.js', files.get(gui[2][0]));
  files.set('webview/assets/boot.js', files.get('webview/assets/boot.js') + 'import "./duplicate.js";');
  await assert.rejects(discoverRoleModules(graphReader(files)), /Ambiguous.*history/);
  const read = graphReader(new Map([
    ['webview/index.html', '<!-- <script type="module" src="./assets/fake.js"></script> --><script type="module" src="./assets/a.js"></script>'],
    ['webview/assets/a.js', '// import "./absent.js"\nconst decoy="import(\'./also-absent.js\')";']
  ]));
  assert.equal((await discoverModules(read, () => true)).length, 1);
});

test('unsupported paths, missing modules and malformed modules fail before any patch', async () => {
  for (const source of ['import "../../../outside.js";', 'import "https://example.com/code.js";', 'import "./%2e%2e/escape.js";',
    'import "./missing.js";', 'import(']) {
    const files = new Map([['webview/index.html', '<script type="module" src="./assets/a.js"></script>'], ['webview/assets/a.js', source]]);
    await assert.rejects(discoverModules(graphReader(files), () => false));
  }
  assert.equal(assetPath('webview/assets/nested/a.mjs'), true);
  for (const file of ['webview/assets/../outside.js', 'webview/assets/a/../../outside.js', 'out/other.js', '/webview/assets/a.js', 'webview/assets/.hidden.js']) {
    assert.equal(assetPath(file), false, file);
  }
});

test('old three-file receipts restore without HTML and migrate using verified originals', async t => {
  const { files } = await layout('combined');
  const installed = await temporaryInstallation(t, files);
  const targets = await installed.resolve();
  const old = { schema: 1, version: installed.profile.version, targets: [] };
  for (const item of targets) {
    const original = await fs.readFile(item.target);
    const definition = { ...item.definition, points: item.definition.points.map(point => ({ ...point,
      after: point.after.replaceAll('entry.conversation?.conversationId ?? entry.conversation?.id', 'entry.conversation?.id')
        .replaceAll('conversation.conversationId ?? conversation.id', 'conversation.id') })) };
    const patched = transform(original, definition);
    await fs.writeFile(backupPath(item.target, item.definition), original);
    await fs.writeFile(item.target, patched);
    old.targets.push({ relativePath: path.relative(installed.root, item.target), originalHash: sha256(original), patchedHashes: [sha256(patched)] });
  }
  await fs.writeFile(receiptPath(targets[0].target), JSON.stringify(old));
  await fs.unlink(path.join(installed.root, 'webview/index.html'));
  assert.ok((await installed.resolve(true)).every(item => item.definition.receiptOnly));
  // Reapply upgrades the receipt and retains the exact older patch hashes.
  await changeAll(await installed.resolve(), 'apply');
  const migrated = JSON.parse(await fs.readFile(receiptPath(targets[0].target), 'utf8'));
  assert.equal(migrated.schema, 2);
  for (const [index, target] of migrated.targets.entries()) assert.ok(target.patchedHashes.includes(old.targets[index].patchedHashes[0]));
  await changeAll(await installed.resolve(true), 'restore');
  for (const item of targets) assert.equal(await fs.readFile(item.target, 'utf8'), files.get(path.relative(installed.root, item.target)));
});

test('receipt role corruption or path substitution is refused', async t => {
  const { files } = await layout('split');
  const installed = await temporaryInstallation(t, files);
  const targets = await installed.resolve();
  const receipt = targets[0].definition.receipt.value;
  assert.doesNotThrow(() => validate(receipt, installed.profile.version));
  for (const mutate of [r => r.targets[1].roles.push('history'), r => r.targets[1].roles = [],
    r => r.targets[1].relativePath = 'webview/assets/../escape.js', r => r.targets[0].roles = ['rows']]) {
    const broken = structuredClone(receipt); mutate(broken);
    assert.throws(() => validate(broken, installed.profile.version), /Invalid installation receipt/);
  }
});

test('a missing backup in a split installation refuses recovery without replacing any file', async t => {
  const { files } = await layout('split');
  const installed = await temporaryInstallation(t, files);
  const targets = await installed.resolve();
  await changeAll(targets, 'apply');
  const before = await Promise.all(targets.map(item => fs.readFile(item.target)));
  await fs.unlink(backupPath(targets.at(-1).target, targets.at(-1).definition));
  for (const restore of [false, true]) await assert.rejects(installed.resolve(restore));
  assert.deepEqual(await Promise.all(targets.map(item => fs.readFile(item.target))), before);
});
