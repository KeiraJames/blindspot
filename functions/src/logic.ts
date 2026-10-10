/** Pure decision logic shared by the callable functions (unit-tested in logic.test.ts). */

export type Role = 'owner' | 'editor' | 'navigator';

const RANK: Record<Role, number> = { navigator: 1, editor: 2, owner: 3 };

export function isRole(v: unknown): v is Role {
  return v === 'owner' || v === 'editor' || v === 'navigator';
}

/** Owners can invite editors and navigators; editors can invite navigators. Nobody invites owners. */
export function canInvite(caller: Role | null | undefined, invited: Role): boolean {
  if (!caller || invited === 'owner') return false;
  if (caller === 'owner') return true;
  return caller === 'editor' && invited === 'navigator';
}

/** Accepting an invite never downgrades an existing member. */
export function mergeRole(existing: Role | null | undefined, incoming: Role): Role {
  if (!existing) return incoming;
  return RANK[existing] >= RANK[incoming] ? existing : incoming;
}

/** Effective role on a map: direct membership, else derived from the map's organization. */
export function effectiveMapRole(
  map: { members?: Record<string, Role>; orgId?: string | null },
  uid: string,
  orgMembers?: Record<string, Role> | null,
): Role | null {
  const direct = map.members?.[uid];
  if (direct) return direct;
  const viaOrg = map.orgId ? orgMembers?.[uid] : undefined;
  if (viaOrg === 'owner' || viaOrg === 'editor') return 'editor';
  if (viaOrg === 'navigator') return 'navigator';
  return null;
}

// No 0/O, 1/I/L: codes are read aloud and typed by screen-reader users.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function inviteCode(randomBytes: (n: number) => Uint8Array, length = 8): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const INVITE_MAX_USES = 25;

export function inviteUsable(invite: { expiresAt: number; uses: number; maxUses: number }, now: number): string | null {
  if (invite.expiresAt < now) return 'This invite has expired. Ask for a new code.';
  if (invite.uses >= invite.maxUses) return 'This invite has been used too many times. Ask for a new code.';
  return null;
}

export const TTS_MAX_CHARS = 400;

export function validateTtsText(text: unknown): string {
  if (typeof text !== 'string') throw new Error('text must be a string');
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) throw new Error('text is empty');
  if (t.length > TTS_MAX_CHARS) throw new Error(`text is longer than ${TTS_MAX_CHARS} characters`);
  return t;
}

export function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** New usage after spending `chars`, or null when it would exceed the daily limit. */
export function spendQuota(usage: { day?: string; chars?: number } | undefined, chars: number, limit: number, today: string): { day: string; chars: number } | null {
  const used = usage?.day === today ? (usage.chars ?? 0) : 0;
  if (used + chars > limit) return null;
  return { day: today, chars: used + chars };
}
