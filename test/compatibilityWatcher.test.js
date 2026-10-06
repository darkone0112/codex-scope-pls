'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const definitions = require('../src/patch/definitions');
const { sha256, transform } = require('../src/patch/integrity');
const { assessBundle, reportMarkdown } = require('../scripts/check-codex-compatibility');
const { addBundle } = require('../scripts/add-codex-bundle');

test('compatibility watch refuses transport-only and unreviewed GUI bundles', async () => {
  const original = await fs.readFile(path.join(__dirname, 'fixtures/provider.js'));
  const bundle = { ...definitions[0].bundles[0], originalHash: sha256(original) };
  const profile = { ...definitions[0], bundles: [bundle] };
  assert.equal(assessBundle(profile, original).status, 'gui-review-required');
  const changed = assessBundle(profile, Buffer.concat([original, Buffer.from(' ')]));
  assert.equal(changed.status, 'gui-review-required');
  assert.equal(changed.candidate, undefined, 'must not generate a backend patch proposal');
  const view = Buffer.from('synthetic GUI');
  const guiBundle = { ...bundle, presentation: { originalHash: sha256(view) } };
  const guiProfile = { ...profile, bundles: [guiBundle] };
  assert.equal(assessBundle(guiProfile, original).status, 'gui-review-required');
  assert.equal(assessBundle(guiProfile, original, Buffer.from('changed GUI')).status, 'gui-review-required');
  assert.equal(assessBundle(guiProfile, original, view).status, 'reviewed-original');
  const header = Buffer.from('synthetic header');
  guiBundle.presentation.additionalTargets = [{ originalHash: sha256(header) }];
  assert.equal(assessBundle(guiProfile, original, view).status, 'gui-review-required');
  assert.equal(assessBundle(guiProfile, original, view, [Buffer.from('changed header')]).status, 'gui-review-required');
  assert.equal(assessBundle(guiProfile, original, view, [header]).status, 'reviewed-original');
});

test('compatibility watch selects the GUI profile by package version when host bytes are reused', () => {
  const host = Buffer.from('same host');
  const view = Buffer.from('new view');
  const header = Buffer.from('new header');
  const originalHash = sha256(host);
  const profile = { bundles: [
    { reviewedVersions: ['old'], originalHash, currentPatchedHashes: [], previousPatchedHashes: [] },
    { reviewedVersions: ['new'], originalHash, currentPatchedHashes: [], previousPatchedHashes: [],
      presentation: { originalHash: sha256(view), additionalTargets: [{ originalHash: sha256(header) }] } }
  ] };
  assert.equal(assessBundle(profile, host, view, [header], 'new').status, 'reviewed-original');
  assert.equal(assessBundle(profile, host, view, [header], 'old').status, 'gui-review-required');
  assert.equal(assessBundle(profile, host, view, [header], 'unknown').status, 'gui-review-required');
  assert.equal(assessBundle(profile, host, Buffer.from('changed'), [header], 'new').status, 'gui-review-required');
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
  const reviewed = require('../src/patch/bundles.json')[2];
  const candidate = { ...reviewed, reviewedVersions: ['99.1.1'], previousPatchedHashes: [],
    presentation: { ...reviewed.presentation, previousPatchedHashes: [],
      additionalTargets: reviewed.presentation.additionalTargets.filter(target => target.kind !== 'restore-only')
        .map(target => ({ ...target, previousPatchedHashes: [] })) } };
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-watch-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const bundles = path.join(directory, 'bundles.json');
  await fs.writeFile(bundles, '[]\n');
  addBundle(candidate, bundles);
  assert.deepEqual(JSON.parse(await fs.readFile(bundles, 'utf8')), [candidate]);
  assert.throws(() => addBundle(candidate, bundles), /already reviewed/);
  await fs.writeFile(bundles, '[]\n');
  assert.throws(() => addBundle({ ...candidate, originalHash: 'invalid' }, bundles), /Invalid compatibility proposal/);
  assert.throws(() => addBundle({ ...candidate, presentation: undefined }, bundles), /Invalid compatibility proposal/);
});
