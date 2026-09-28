'use strict';
const bundles = require('./bundles.json');
const { buildPoints } = require('./pointBuilder');
// Compatibility data is independent from runtime patching. A reviewed PR may
// add one JSON variant; it cannot loosen a point matcher or hash check.
const reviewedBundles = bundles.map(bundle => ({ ...bundle,
  points: buildPoints(bundle.localBefore, bundle.cloudBefore) }));
const platforms = [
  ['linux', 'x64'], ['linux', 'arm64'], ['darwin', 'x64'],
  ['darwin', 'arm64'], ['win32', 'x64'], ['win32', 'arm64']
];
module.exports = platforms.map(([platform, arch]) => ({
  platform, arch, relativePath: 'out/extension.js', bundles: reviewedBundles
}));
