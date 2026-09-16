'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const definitions = require('../src/patch/definitions');
const { sha256, transform } = require('../src/patch/integrity');
const { assessBundle, reportMarkdown } = require('../scripts/check-codex-compatibility');

test('compatibility watch distinguishes reviewed, structurally compatible and incompatible bundles', async () => {
  const original = await fs.readFile(path.join(__dirname, 'fixtures/provider.js'));
  const profile = { ...definitions[0], originalHash: sha256(original), currentPatchedHashes: [], previousPatchedHashes: [] };
  assert.deepEqual(assessBundle(profile, original), { status: 'reviewed-original', hash: sha256(original) });
  const unrelatedChange = Buffer.concat([original, Buffer.from('\n// upstream unrelated change\n')]);
  const candidate = assessBundle(profile, unrelatedChange);
  assert.equal(candidate.status, 'structurally-compatible-review-required');
  assert.deepEqual(candidate.patched, transform(unrelatedChange, { ...profile, originalHash: sha256(unrelatedChange) }));
  const incompatible = assessBundle(profile, Buffer.from('not a Codex bundle'));
  assert.equal(incompatible.status, 'incompatible-review-required');
  assert.match(incompatible.reason, /patch point/);
});

test('compatibility watch report is reviewable and does not include bundle contents', () => {
  const markdown = reportMarkdown({ checkedAt: '2026-09-16T00:00:00.000Z', results: [{
    profile: 'win32/x64', version: '99.1.1', status: 'structurally-compatible-review-required', hash: 'a'.repeat(64)
  }] });
  assert.match(markdown, /win32\/x64/);
  assert.match(markdown, /99\.1\.1/);
  assert.doesNotMatch(markdown, /sendProviderRequest/);
});
