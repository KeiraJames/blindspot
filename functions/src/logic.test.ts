import { describe, expect, it } from 'vitest';
import { canInvite, dayKey, effectiveMapRole, inviteCode, inviteUsable, mergeRole, spendQuota, validateTtsText } from './logic';

describe('roles', () => {
  it('limits who can invite whom', () => {
    expect(canInvite('owner', 'editor')).toBe(true);
    expect(canInvite('owner', 'navigator')).toBe(true);
    expect(canInvite('owner', 'owner')).toBe(false);
    expect(canInvite('editor', 'navigator')).toBe(true);
    expect(canInvite('editor', 'editor')).toBe(false);
    expect(canInvite('navigator', 'navigator')).toBe(false);
    expect(canInvite(null, 'navigator')).toBe(false);
  });

  it('never downgrades on accept', () => {
    expect(mergeRole('editor', 'navigator')).toBe('editor');
    expect(mergeRole('navigator', 'editor')).toBe('editor');
    expect(mergeRole(undefined, 'navigator')).toBe('navigator');
  });

  it('derives map roles from organizations', () => {
    const map = { members: { a: 'owner' as const }, orgId: 'o1' };
    expect(effectiveMapRole(map, 'a', { a: 'navigator' })).toBe('owner');
    expect(effectiveMapRole(map, 'b', { b: 'owner' })).toBe('editor');
    expect(effectiveMapRole(map, 'c', { c: 'navigator' })).toBe('navigator');
    expect(effectiveMapRole(map, 'd', {})).toBeNull();
    expect(effectiveMapRole({ members: {}, orgId: null }, 'b', { b: 'owner' })).toBeNull();
  });
});

describe('invites', () => {
  it('generates unambiguous codes', () => {
    const code = inviteCode((n) => Uint8Array.from({ length: n }, (_, i) => i * 37));
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
  });

  it('checks expiry and use count', () => {
    expect(inviteUsable({ expiresAt: 10, uses: 0, maxUses: 5 }, 5)).toBeNull();
    expect(inviteUsable({ expiresAt: 10, uses: 0, maxUses: 5 }, 11)).toMatch(/expired/);
    expect(inviteUsable({ expiresAt: 10, uses: 5, maxUses: 5 }, 5)).toMatch(/too many/);
  });
});

describe('tts', () => {
  it('validates text', () => {
    expect(validateTtsText('  Turn   left  ')).toBe('Turn left');
    expect(() => validateTtsText('')).toThrow();
    expect(() => validateTtsText('x'.repeat(401))).toThrow();
    expect(() => validateTtsText(42)).toThrow();
  });

  it('enforces a daily character quota that resets each day', () => {
    const today = dayKey(new Date('2026-10-10T12:00:00Z'));
    expect(today).toBe('2026-10-10');
    expect(spendQuota(undefined, 100, 1000, today)).toEqual({ day: today, chars: 100 });
    expect(spendQuota({ day: today, chars: 950 }, 100, 1000, today)).toBeNull();
    expect(spendQuota({ day: '2026-10-09', chars: 999 }, 100, 1000, today)).toEqual({ day: today, chars: 100 });
  });
});
