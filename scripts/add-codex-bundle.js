'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { hostPoints, rowPoints, historyPoints, headerPoints } = require('../src/patch/presentationPoints');
const hash = /^[a-f0-9]{64}$/;
function validate(proposal) {
  if (!Array.isArray(proposal.reviewedVersions) || proposal.reviewedVersions.length < 1 || proposal.reviewedVersions.length > 6 ||
    !proposal.reviewedVersions.every(version => /^\d[0-9A-Za-z.-]{0,127}$/.test(version)) ||
    !hash.test(proposal.originalHash) || !Array.isArray(proposal.currentPatchedHashes) ||
    proposal.currentPatchedHashes.length !== 1 || !proposal.currentPatchedHashes.every(value => hash.test(value)) ||
    !Array.isArray(proposal.previousPatchedHashes) || proposal.previousPatchedHashes.length !== 0 ||
    !proposal.presentation ||
    !/^webview\/assets\/[A-Za-z0-9-]+\.js$/.test(proposal.presentation.relativePath) ||
    !hash.test(proposal.presentation.originalHash) ||
    !Array.isArray(proposal.presentation.currentPatchedHashes) ||
    proposal.presentation.currentPatchedHashes.length !== 1 ||
    !proposal.presentation.currentPatchedHashes.every(value => hash.test(value)) ||
    !Array.isArray(proposal.presentation.previousPatchedHashes) || proposal.presentation.previousPatchedHashes.length !== 0 ||
    typeof proposal.presentation.rowBefore !== 'string' || proposal.presentation.rowBefore.length > 4096 ||
    !Array.isArray(proposal.presentation.additionalTargets) || proposal.presentation.additionalTargets.length !== 1) {
    throw new Error('Invalid compatibility proposal');
  }
  hostPoints(proposal);
  rowPoints(proposal.presentation.rowBefore);
  historyPoints(proposal.presentation);
  const header = proposal.presentation.additionalTargets[0];
  if (!/^webview\/assets\/header-[a-f0-9]+\.js$/.test(header.relativePath) || !hash.test(header.originalHash) ||
    !Array.isArray(header.currentPatchedHashes) || header.currentPatchedHashes.length !== 1 ||
    !header.currentPatchedHashes.every(value => hash.test(value)) ||
    !Array.isArray(header.previousPatchedHashes) || header.previousPatchedHashes.length !== 0) {
    throw new Error('Invalid header presentation proposal');
  }
  headerPoints(header);
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
