import { signDeviceReceiptToken } from '../common/token.util';

/** JPush extras are scalars. Leave payload headroom and never truncate a target map. */
export function addDeviceReceiptTokens(
  messageId: string,
  extra: Record<string, unknown>,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
): Record<string, unknown> {
  const clean = { ...extra };
  delete clean.receivedToken;
  delete clean.receivedTokens;
  const audience = clean._jpushAudience;
  const targets = audience && typeof audience === 'object' && !Array.isArray(audience)
    ? (audience as Record<string, unknown>).registration_id : undefined;
  if (!Array.isArray(targets) || !targets.length || !targets.every(rid => typeof rid === 'string' && rid.length > 0 && rid.length <= 512)) {
    return { ...clean, _deviceReceiptMode: 'unavailable_audience' };
  }
  const rids = [...new Set(targets as string[])];
  const tokens = Object.fromEntries(rids.map(rid => [rid, signDeviceReceiptToken(messageId, rid, nowSec + 7 * 86400, secret)]));
  const capability = rids.length === 1 ? { receivedToken: tokens[rids[0]] } : { receivedTokens: JSON.stringify(tokens) };
  if (Buffer.byteLength(JSON.stringify(capability), 'utf8') > 1536) return { ...clean, _deviceReceiptMode: 'unavailable_size' };
  return { ...clean, ...capability, _deviceReceiptMode: 'signed' };
}
