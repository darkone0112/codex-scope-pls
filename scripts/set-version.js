'use strict';
const fs = require('node:fs');
const next = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(next || '')) throw new Error('Expected a numeric semantic version');
const file = require.resolve('../package.json');
const pkg = require(file);
pkg.version = next;
fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
