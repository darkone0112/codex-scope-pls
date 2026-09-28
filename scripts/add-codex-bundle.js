'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { buildPoints } = require('../src/patch/pointBuilder');
const hash = /^[a-f0-9]{64}$/;
function validate(proposal) {
  if (!Array.isArray(proposal.reviewedVersions) || proposal.reviewedVersions.length < 1 || proposal.reviewedVersions.length > 6 ||
    !proposal.reviewedVersions.every(version => /^\d[0-9A-Za-z.-]{0,127}$/.test(version)) ||
    !hash.test(proposal.originalHash) || !Array.isArray(proposal.currentPatchedHashes) ||
    proposal.currentPatchedHashes.length !== 1 || !proposal.currentPatchedHashes.every(value => hash.test(value)) ||
    !Array.isArray(proposal.previousPatchedHashes) || proposal.previousPatchedHashes.length !== 0 ||
    typeof proposal.localBefore !== 'string' || proposal.localBefore.length > 4096 ||
    typeof proposal.cloudBefore !== 'string' || proposal.cloudBefore.length > 256) {
    throw new Error('Invalid compatibility proposal');
  }
  buildPoints(proposal.localBefore, proposal.cloudBefore);
}
function addBundle(proposal, file = path.join(__dirname, '../src/patch/bundles.json')) {
  validate(proposal);
  const bundles = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (bundles.some(bundle => bundle.originalHash === proposal.originalHash)) throw new Error('Bundle hash already reviewed');
  bundles.push(proposal);
  fs.writeFileSync(file, `${JSON.stringify(bundles, null, 2)}\n`);
}
if (require.main === module) {
  const proposalFile = process.argv[2];
  if (!proposalFile) throw new Error('Expected proposal JSON path');
  addBundle(JSON.parse(fs.readFileSync(proposalFile, 'utf8')));
}
module.exports = { addBundle, validate };
