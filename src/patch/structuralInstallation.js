'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { readRegular, readBackup } = require('./backup');
const { sha256 } = require('./integrity');
const { readReceipt } = require('./receipt');
const { hostDefinition, appDefinition, headerDefinition } = require('./structuralPoints');

async function readTarget(root, relativePath) {
  const target = path.join(root, relativePath);
  const directory = path.dirname(target);
  const real = await fs.realpath(directory);
  if (process.platform === 'win32' ? real.toLowerCase() !== directory.toLowerCase() : real !== directory) {
    throw new Error('Refusing symlinked Codex asset directory');
  }
  const bytes = await readRegular(target);
  if (bytes.length > 25 * 1024 * 1024) throw new Error('Codex target exceeds size limit');
  return bytes;
}
function combine(profile, targets, extra) {
  return { ...profile, ...targets[0], ...extra, structural: true, knownVersion: false,
    presentation: { ...targets[1], additionalTargets: [targets[2]] } };
}
// Also used by the Marketplace watcher: detection and syntax validation are
// identical to runtime, with no installed-file writes or vendor execution.
function recognize(host, assets) {
  const hostTarget = { ...hostDefinition(host), relativePath: 'out/extension.js' };
  function assetDefinition(prefix, marker, build) {
    const candidates = assets.filter(asset => new RegExp(`^webview/assets/${prefix}-[a-f0-9]+\\.js$`).test(asset.relativePath) &&
      asset.bytes.includes(marker));
    const accepted = [];
    const failures = [];
    for (const asset of candidates) {
      try { accepted.push({ ...build(asset.bytes), relativePath: asset.relativePath }); }
      catch (error) { failures.push(error.message); }
    }
    if (accepted.length !== 1 || candidates.length !== 1) throw new Error(`Unrecognized Codex ${prefix} structure (matched ${accepted.length}, candidates ${candidates.length}). ${failures.join('; ')}`);
    return accepted[0];
  }
  return [hostTarget, assetDefinition('app-initial', 'chunked-message-ack', appDefinition),
    assetDefinition('header', 'pendingThreadStarts', headerDefinition)];
}
async function structuralInstallation(root, profile, restoration = false) {
  const host = path.join(root, profile.relativePath);
  const receipt = await readReceipt(host, profile.version);
  if (receipt) {
    const originals = [];
    for (const target of receipt.value.targets) {
      const bytes = await readTarget(root, target.relativePath);
      const hash = sha256(bytes);
      if (hash !== target.originalHash && !target.patchedHashes.includes(hash)) throw new Error('Installation receipt target SHA-256 mismatch');
      originals.push(hash === target.originalHash ? bytes : await readBackup(path.join(root, target.relativePath), { ...target, version: profile.version }));
    }
    if (restoration) {
      const targets = receipt.value.targets.map(target => ({ ...target, points: [], currentPatchedHashes: target.patchedHashes,
        previousPatchedHashes: [], receiptOnly: true }));
      return combine(profile, targets);
    }
    const paths = receipt.value.targets.map(target => target.relativePath);
    const targets = recognize(originals[0], originals.slice(1).map((bytes, index) => ({ bytes, relativePath: paths[index + 1] })));
    for (const [index, target] of targets.entries()) {
      target.previousPatchedHashes = receipt.value.targets[index].patchedHashes.filter(hash => !target.currentPatchedHashes.includes(hash));
    }
    return withReceipt(profile, targets, receipt.bytes);
  }
  const bytes = await readTarget(root, profile.relativePath);
  const directory = path.join(root, 'webview/assets');
  const real = await fs.realpath(directory);
  if (process.platform === 'win32' ? real.toLowerCase() !== directory.toLowerCase() : real !== directory) throw new Error('Refusing symlinked Codex asset directory');
  const entries = await fs.readdir(directory);
  if (entries.filter(name => /^(app-initial|header)-[a-f0-9]+\.js$/.test(name)).length > 64) throw new Error('Too many Codex assets');
  const assets = [];
  let total = 0;
  for (const name of entries.filter(name => /^(app-initial|header)-[a-f0-9]+\.js$/.test(name))) {
    const relativePath = `webview/assets/${name}`;
    const content = await readTarget(root, relativePath);
    total += content.length;
    if (total > 100 * 1024 * 1024) throw new Error('Codex assets exceed size limit');
    assets.push({ relativePath, bytes: content });
  }
  return withReceipt(profile, recognize(bytes, assets));
}
function withReceipt(profile, targets, previous) {
  const value = { schema: 1, version: profile.version, targets: targets.map(target => ({
    relativePath: target.relativePath, originalHash: target.originalHash,
    patchedHashes: [...new Set([...target.currentPatchedHashes, ...target.previousPatchedHashes])]
  })) };
  return combine(profile, targets, { receipt: { value, previous } });
}
module.exports = { structuralInstallation, recognize };
