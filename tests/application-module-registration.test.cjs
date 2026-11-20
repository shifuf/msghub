const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('main API loads device and operations endpoints into the deployed application', () => {
  const root = fs.readFileSync(path.resolve(__dirname, '../apps/api/src/app.module.ts'), 'utf8');
  const modules = root.match(/imports:\s*\[([\s\S]*?)\],\s*providers:/)?.[1] || '';

  assert.match(root, /import\s+\{\s*DevicesModule\s*\}\s+from\s+['"]\.\/devices\/devices\.module['"]/);
  assert.match(root, /import\s+\{\s*OperationsModule\s*\}\s+from\s+['"]\.\/operations\/operations\.module['"]/);
  assert.match(modules, /\bDevicesModule\b/, 'device pairing, heartbeat, and receipt routes must be registered');
  assert.match(modules, /\bOperationsModule\b/, 'operations and backup routes must be registered');
});
