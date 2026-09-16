'use strict';
// Development/CI-only inspector. It never executes a downloaded VSIX or
// changes this repository, the installed Codex extension, or its definitions.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const definitions = require('../src/patch/definitions');
const { sha256, transform } = require('../src/patch/integrity');

const GALLERY_QUERY = 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery';
// Codex archives embed a native executable for each host and can be large.
// The ceiling still bounds a malformed or unexpectedly redirected download.
const MAX_VSIX_BYTES = 600 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 25 * 1024 * 1024;
const targetPlatforms = new Map([
  ['linux/x64', 'linux-x64'], ['linux/arm64', 'linux-arm64'],
  ['darwin/x64', 'darwin-x64'], ['darwin/arm64', 'darwin-arm64'],
  ['win32/x64', 'win32-x64'], ['win32/arm64', 'win32-arm64']
]);

function profileKey(profile) { return `${profile.platform}/${profile.arch}`; }
function isMarketplaceUrl(value) {
  const url = new URL(value);
  return url.protocol === 'https:' && (url.hostname === 'marketplace.visualstudio.com' ||
    url.hostname === 'openai.gallery.vsassets.io' || url.hostname === 'openai.gallerycdn.vsassets.io');
}
async function fetchOfficial(url, options = {}) {
  let next = url;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    if (!isMarketplaceUrl(next)) throw new Error('Refusing a non-official Marketplace URL');
    const response = await fetch(next, { ...options, redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Marketplace redirect without a location');
      next = new URL(location, next).toString();
      continue;
    }
    if (!response.ok) throw new Error(`Marketplace request failed (${response.status})`);
    const size = Number(response.headers.get('content-length') || 0);
    if (size > MAX_VSIX_BYTES) throw new Error('Marketplace VSIX exceeds size limit');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_VSIX_BYTES) throw new Error('Marketplace VSIX exceeds size limit');
    return bytes;
  }
  throw new Error('Too many Marketplace redirects');
}
function unzip(archive, entry) {
  const result = spawnSync('unzip', ['-p', archive, entry], { encoding: null, maxBuffer: MAX_EXTRACTED_BYTES });
  if (result.status !== 0) throw new Error(`Cannot read VSIX entry: ${entry}`);
  return result.stdout;
}
function attribute(tag, name) {
  const match = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(tag);
  return match?.[1];
}
function verifyManifest(bytes, version, targetPlatform) {
  const text = bytes.toString('utf8');
  const identity = text.match(/<Identity\b[^>]*>/i)?.[0];
  const publisher = attribute(identity || '', 'Publisher');
  const manifestVersion = attribute(identity || '', 'Version');
  if (!identity || publisher?.toLowerCase() !== 'openai' || manifestVersion !== version) {
    throw new Error(`Official VSIX manifest identity mismatch (publisher=${publisher || 'missing'}, version=${manifestVersion || 'missing'})`);
  }
  if (!text.includes(`TargetPlatform="${targetPlatform}"`)) {
    throw new Error('Official VSIX manifest target platform does not match');
  }
}
function latestVersion(versions, targetPlatform) {
  const candidates = versions.filter(version => version.targetPlatform === targetPlatform &&
    typeof version.version === 'string' && /^\d[0-9A-Za-z.-]*$/.test(version.version));
  candidates.sort((left, right) => right.version.localeCompare(left.version, undefined, { numeric: true }));
  return candidates[0];
}
function vsixUrl(version) {
  const asset = version.files?.find(file => file.assetType === 'Microsoft.VisualStudio.Services.VSIXPackage');
  if (!asset?.source) throw new Error('Marketplace response has no VSIX asset');
  return asset.source;
}
function assessBundle(profile, bytes) {
  const hash = sha256(bytes);
  if (hash === profile.originalHash) return { status: 'reviewed-original', hash };
  if ([...(profile.currentPatchedHashes || []), ...(profile.previousPatchedHashes || [])].includes(hash)) {
    return { status: 'unexpected-patched-bytes', hash };
  }
  const candidate = { ...profile, originalHash: hash };
  try {
    const patched = transform(bytes, candidate);
    return { status: 'structurally-compatible-review-required', hash, patched };
  } catch (error) {
    return { status: 'incompatible-review-required', hash, reason: error.message };
  }
}
function syntaxCheck(bytes) {
  const file = path.join(os.tmpdir(), `codex-scope-pls-${process.pid}-${Date.now()}.js`);
  try {
    require('node:fs').writeFileSync(file, bytes, { mode: 0o600 });
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`Patched bundle syntax check failed: ${result.stderr.trim()}`);
  } finally {
    require('node:fs').rmSync(file, { force: true });
  }
}
async function queryVersions() {
  const body = JSON.stringify({ filters: [{ criteria: [{ filterType: 7, value: 'openai.chatgpt' }],
    pageNumber: 1, pageSize: 1, sortBy: 4, sortOrder: 2 }], flags: 914 });
  const bytes = await fetchOfficial(GALLERY_QUERY, { method: 'POST', headers: {
    'content-type': 'application/json', accept: 'application/json;api-version=7.2-preview.1'
  }, body });
  const extension = JSON.parse(bytes.toString('utf8')).results?.[0]?.extensions?.[0];
  if (extension?.publisher?.publisherName !== 'openai' || extension.extensionName !== 'chatgpt' || !Array.isArray(extension.versions)) {
    throw new Error('Marketplace response is not the OpenAI Codex extension');
  }
  return extension.versions;
}
function reportMarkdown(report) {
  const rows = report.results.map(result => `| ${result.profile} | ${result.version} | ${result.status} | \`${result.hash || 'n/a'}\` |`);
  return ['# Codex compatibility watch', '', `Checked: ${report.checkedAt}`, '', '| Profile | Marketplace version | Result | Bundle SHA-256 |', '| --- | --- | --- | --- |', ...rows, '',
    'A review is required before changing trusted hashes or patch definitions. Downloaded VSIX files were inspected only; no executable was run.'].join('\n');
}
async function inspectMarketplace() {
  const versions = await queryVersions();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-scope-pls-marketplace-'));
  try {
    const results = [];
    for (const profile of definitions) {
      const targetPlatform = targetPlatforms.get(profileKey(profile));
      const version = latestVersion(versions, targetPlatform);
      if (!version) throw new Error(`Marketplace has no version for ${targetPlatform}`);
      process.stderr.write(`Inspecting ${targetPlatform} ${version.version}\n`);
      const archive = path.join(directory, `${targetPlatform}.vsix`);
      await fs.writeFile(archive, await fetchOfficial(vsixUrl(version)));
      verifyManifest(unzip(archive, 'extension.vsixmanifest'), version.version, targetPlatform);
      const assessed = assessBundle(profile, unzip(archive, 'extension/out/extension.js'));
      if (assessed.patched) syntaxCheck(assessed.patched);
      results.push({ profile: profileKey(profile), targetPlatform, version: version.version,
        status: assessed.status, hash: assessed.hash, reason: assessed.reason });
    }
    const report = { checkedAt: new Date().toISOString(), results };
    report.requiresReview = results.some(result => result.status !== 'reviewed-original');
    return report;
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
async function main() {
  const report = await inspectMarketplace();
  const output = process.argv.indexOf('--report');
  if (output !== -1 && process.argv[output + 1]) {
    await fs.writeFile(process.argv[output + 1], JSON.stringify(report, null, 2));
    await fs.writeFile(`${process.argv[output + 1]}.md`, reportMarkdown(report));
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { assessBundle, reportMarkdown, verifyManifest };
