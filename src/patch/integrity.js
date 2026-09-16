'use strict';
const { createHash } = require('node:crypto');
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function count(text, needle) { return text.split(needle).length - 1; }
function transform(original, definition) {
  if (sha256(original) !== definition.originalHash) throw new Error('Original SHA-256 mismatch');
  let result = original.toString('utf8');
  if (!Buffer.from(result).equals(original)) throw new Error('Bundle is not UTF-8');
  for (const point of definition.points) {
    if (count(result, point.before) !== 1 || count(result, point.after) !== 0) {
      throw new Error(`Expected exactly one original patch point: ${point.name}`);
    }
    result = result.replace(point.before, () => point.after);
  }
  for (const point of definition.points) {
    if (count(result, point.before) !== 0 || count(result, point.after) !== 1) {
      throw new Error(`Patched point validation failed: ${point.name}`);
    }
  }
  return Buffer.from(result);
}
function selectDefinition(version, platform, arch, definitions) {
  // This value labels a local backup; it is not a compatibility gate. Keep it
  // safe for use in a sibling filename while allowing normal prerelease labels.
  if (typeof version !== 'string' || !/^\d[0-9A-Za-z.-]{0,127}$/.test(version)) {
    throw new Error('Invalid Codex extension version');
  }
  const matches = definitions.filter(d => d.platform === platform && d.arch === arch);
  if (matches.length !== 1) throw new Error('Unsupported Codex platform/architecture');
  // Record the installed version for diagnostics and backup identity. The
  // profile's full-bundle hash, checked by codexLocator, decides compatibility.
  return { ...matches[0], version, knownVersion: matches[0].reviewedVersions.includes(version) };
}
module.exports = { sha256, count, transform, selectDefinition };
