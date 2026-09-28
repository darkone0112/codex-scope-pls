'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const definitions = require('../src/patch/definitions');
const { sha256, transform } = require('../src/patch/integrity');
const { assessBundle, deriveBundle, reportMarkdown } = require('../scripts/check-codex-compatibility');
const { addBundle } = require('../scripts/add-codex-bundle');

test('compatibility watch distinguishes reviewed, structurally compatible and incompatible bundles', async () => {
  const original = await fs.readFile(path.join(__dirname, 'fixtures/provider.js'));
  const bundle = { ...definitions[0].bundles[0], originalHash: sha256(original), currentPatchedHashes: [], previousPatchedHashes: [] };
  const profile = { ...definitions[0], bundles: [bundle] };
  assert.deepEqual(assessBundle(profile, original), { status: 'reviewed-original', hash: sha256(original) });
  const unrelatedChange = Buffer.concat([original, Buffer.from('\n// upstream unrelated change\n')]);
  const candidate = assessBundle(profile, unrelatedChange);
  assert.equal(candidate.status, 'structurally-compatible-review-required');
  assert.deepEqual(candidate.patched, transform(unrelatedChange, { ...bundle, originalHash: sha256(unrelatedChange) }));
  const incompatible = assessBundle(profile, Buffer.from('not a Codex bundle'));
  assert.equal(incompatible.status, 'incompatible-review-required');
  assert.match(incompatible.reason, /local request boundary/);
});

test('compatibility watch derives one narrow proposal with its resulting patch hash', async () => {
  const original = await fs.readFile(path.join(__dirname, 'fixtures/provider.js'));
  const { candidate, patched } = deriveBundle(original, '99.1.1');
  assert.deepEqual(candidate.reviewedVersions, ['99.1.1']);
  assert.equal(candidate.originalHash, sha256(original));
  assert.deepEqual(candidate.currentPatchedHashes, [sha256(patched)]);
  assert.equal(candidate.previousPatchedHashes.length, 0);
  assert.match(candidate.localBefore, /^sendProviderRequest\(e,r,n,o,i,s\)\{/);
  assert.equal(candidate.cloudBefore, 'async fetchHttp(e,r,n){try{');
  assert.throws(() => deriveBundle(Buffer.concat([original, original]), '99.1.1'), /exactly one/);
});

test('compatibility watch report is reviewable and does not include bundle contents', () => {
  const markdown = reportMarkdown({ checkedAt: '2026-09-16T00:00:00.000Z', results: [{
    profile: 'win32/x64', version: '99.1.1', status: 'structurally-compatible-review-required', hash: 'a'.repeat(64)
  }] });
  assert.match(markdown, /win32\/x64/);
  assert.match(markdown, /99\.1\.1/);
  assert.doesNotMatch(markdown, /sendProviderRequest/);
});

test('compatibility proposal writer accepts only a new bounded data entry', async t => {
  const original = await fs.readFile(path.join(__dirname, 'fixtures/provider.js'));
  const { candidate } = deriveBundle(original, '99.1.1');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-watch-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const bundles = path.join(directory, 'bundles.json');
  await fs.writeFile(bundles, '[]\n');
  addBundle(candidate, bundles);
  assert.deepEqual(JSON.parse(await fs.readFile(bundles, 'utf8')), [candidate]);
  assert.throws(() => addBundle(candidate, bundles), /already reviewed/);
  await fs.writeFile(bundles, '[]\n');
  assert.throws(() => addBundle({ ...candidate, originalHash: 'invalid' }, bundles), /Invalid compatibility proposal/);
});
