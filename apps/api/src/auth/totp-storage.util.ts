import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';

type SecretConfig = { get<T = string>(key: string): T | undefined };
function key(config: SecretConfig) {
  const master = config.get<string>('TOTP_ENCRYPTION_KEY') || config.get<string>('JWT_SECRET') || '';
  if (master.length < 32 || new Set(master).size < 12 || /change.me|dev.secret|example|placeholder/i.test(master)) throw new Error('TOTP 需要至少 32 字符的强加密密钥');
  return Buffer.from(hkdfSync('sha256', master, 'msghub-totp-v1', 'authenticated-secret-storage', 32));
}

export function sealTotp(secret: string, config: SecretConfig, context: string, expiresAt?: number): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(config), nonce);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ secret, expiresAt }), 'utf8'), cipher.final()]);
  return ['v1', nonce.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function openTotp(stored: string, config: SecretConfig, context: string, now = Date.now()): string {
  const [version, nonce, tag, ciphertext, extra] = stored.split('.');
  if (version !== 'v1' || !nonce || !tag || !ciphertext || extra !== undefined) throw new Error('TOTP 密钥格式无效');
  const decipher = createDecipheriv('aes-256-gcm', key(config), Buffer.from(nonce, 'base64url'));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  const payload = JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8'));
  if (typeof payload.secret !== 'string' || !/^[A-Z2-7]{16,64}$/.test(payload.secret)) throw new Error('TOTP 密钥无效');
  if (payload.expiresAt !== undefined && (!Number.isFinite(payload.expiresAt) || payload.expiresAt <= now)) throw new Error('TOTP 配置已过期');
  return payload.secret;
}
