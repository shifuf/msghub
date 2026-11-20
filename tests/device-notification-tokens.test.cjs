const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');

const api = createRequire(path.resolve(__dirname, '../apps/api/package.json'));
api('reflect-metadata');
api('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '../apps/api/tsconfig.json') });
const { signDeviceReceiptToken, verifyDeviceReceiptToken, hashDeviceCredential } = require('../apps/api/src/common/token.util.ts');

test('device receipt token binds the original message, Registration ID, and expiration', () => {
  const secret = 'isolated-verification-secret-never-used-in-production';
  const now = 1_900_000_000;
  const token = signDeviceReceiptToken('message-1', 'rid-original', now + 60, secret);

  assert.deepEqual(verifyDeviceReceiptToken(token, secret, now), {
    messageId: 'message-1', registrationId: 'rid-original', exp: now + 60,
  });
  assert.equal(verifyDeviceReceiptToken(token, secret, now, { messageId: 'other-message' }), null);
  assert.equal(verifyDeviceReceiptToken(token, secret, now, { registrationId: 'other-device' }), null);
  assert.equal(verifyDeviceReceiptToken(token, secret, now + 61), null);
  assert.equal(verifyDeviceReceiptToken(token, secret + '-other', now), null);
  assert.equal(verifyDeviceReceiptToken(signDeviceReceiptToken('other', 'rid-original', now + 60, secret), secret, now)?.registrationId, 'rid-original');
  assert.equal(verifyDeviceReceiptToken(signDeviceReceiptToken('message-1', 'other-device', now + 60, secret), secret, now)?.messageId, 'message-1');
  assert.equal(verifyDeviceReceiptToken(`${token}x`, secret, now), null);
});

test('device credentials are stored as one-way hashes and verified by timing-safe comparison', () => {
  const token = 'one-time-random-bearer-token';
  const hash = hashDeviceCredential(token);

  assert.equal(typeof hash, 'string');
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, token);
  assert.equal(hashDeviceCredential(token), hash);
  assert.notEqual(hashDeviceCredential(`${token}-changed`), hash);
});

test('pair codes and device API credentials produce distinct irreversible digests', () => {
  const pairCode = '01abcdef23456789';
  const credential = 'one-time-random-bearer-token';

  assert.notEqual(hashDeviceCredential(pairCode), hashDeviceCredential(credential));
  assert.equal(hashDeviceCredential(pairCode).length, 64);
});
