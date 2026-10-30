'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { readRegular, readBackup } = require('./backup');
const { sha256 } = require('./integrity');
const { readReceipt } = require('./receipt');
const { hostDefinition, notificationDefinition, rowDefinition, headerDefinition, combineDefinitions } = require('./structuralPoints');
const { discoverModules } = require('./moduleGraph');

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
    presentation: { ...targets[1], additionalTargets: targets.slice(2) } };
}
const roleChecks = [
  { role: 'notifications', candidate: bytes => bytes.includes('chunked-message-ack'), build: notificationDefinition },
  { role: 'rows', candidate: bytes => bytes.includes('summary') && /\bswitch\s*\(/.test(bytes.toString('utf8')), build: rowDefinition },
  { role: 'history', candidate: bytes => bytes.includes('pendingThreadStarts'), build: headerDefinition }
];
function roleMatches(assets, cache = new Map()) {
  const roles = new Map(roleChecks.map(check => [check.role, []]));
  const failures = new Map(roleChecks.map(check => [check.role, []]));
  for (const asset of assets) {
    if (!cache.has(asset.relativePath)) {
      const results = [];
      for (const { role, candidate, build } of roleChecks) {
        if (!candidate(asset.bytes)) continue;
        try { results.push({ role, definition: build(asset.bytes) }); }
        catch (error) { results.push({ role, error: error.message }); }
      }
      cache.set(asset.relativePath, results);
    }
    for (const result of cache.get(asset.relativePath)) {
      if (result.error) failures.get(result.role).push(`${asset.relativePath}: ${result.error}`);
      else roles.get(result.role).push({ ...asset, definition: result.definition });
    }
  }
  for (const [role, matches] of roles) {
    if (matches.length > 1) throw new Error(`Ambiguous Codex ${role} role (matched ${matches.length})`);
  }
  return { roles, failures };
}
async function discoverRoleModules(read) {
  const cache = new Map();
  return discoverModules(read, assets => [...roleMatches(assets, cache).roles.values()].every(matches => matches.length === 1),
    bytes => roleChecks.some(check => check.candidate(bytes)));
}
// Also used by the Marketplace watcher: detection and syntax validation are
// identical to runtime, with no installed-file writes or vendor execution.
function recognize(host, assets) {
  const hostTarget = { ...hostDefinition(host), relativePath: 'out/extension.js', roles: ['host'] };
  const { roles, failures } = roleMatches(assets);
  const targets = new Map();
  for (const [role, matches] of roles) {
    if (matches.length !== 1) throw new Error(`Unrecognized Codex ${role} role (matched ${matches.length}). ${failures.get(role).join('; ')}`);
    const match = matches[0];
    if (!targets.has(match.relativePath)) targets.set(match.relativePath, { bytes: match.bytes, definitions: [], roles: [] });
    targets.get(match.relativePath).definitions.push(match.definition);
    targets.get(match.relativePath).roles.push(role);
  }
  return [hostTarget, ...Array.from(targets, ([relativePath, target]) => ({
    ...combineDefinitions(target.bytes, target.definitions), relativePath, roles: target.roles
  }))];
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
    for (const target of targets) {
      const previous = receipt.value.targets.find(item => item.relativePath === target.relativePath);
      if (!previous || previous.originalHash !== target.originalHash) throw new Error('Installation receipt original identity mismatch');
      target.previousPatchedHashes = previous.patchedHashes.filter(hash => !target.currentPatchedHashes.includes(hash));
    }
    return withReceipt(profile, targets, receipt.bytes);
  }
  const bytes = await readTarget(root, profile.relativePath);
  const assets = await discoverRoleModules(relativePath => readTarget(root, relativePath));
  return withReceipt(profile, recognize(bytes, assets));
}
function withReceipt(profile, targets, previous) {
  const value = { schema: 2, version: profile.version, targets: targets.map(target => ({
    relativePath: target.relativePath, originalHash: target.originalHash,
    roles: target.roles,
    patchedHashes: [...new Set([...target.currentPatchedHashes, ...target.previousPatchedHashes])]
  })) };
  return combine(profile, targets, { receipt: { value, previous } });
}
module.exports = { structuralInstallation, recognize, discoverRoleModules };
