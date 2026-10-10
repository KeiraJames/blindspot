/**
 * PathSense Cloud Functions. CPU only: no ML runs here (PRD §5). Responsibilities:
 * - invites (create / accept) for maps and organizations,
 * - validating published map versions before navigators can load them,
 * - keeping organization membership mirrored onto org maps for queries,
 * - cleaning up a deleted map's subcollections and files,
 * - proxying ElevenLabs text-to-speech so the API key never ships in the app.
 */
import { randomBytes } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onDocumentCreated, onDocumentDeleted, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineInt, defineSecret, defineString } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import type { MapGraph } from '../../src/lib/graph/types';
import { validateGraph } from '../../src/lib/graph/validate';
import {
  canInvite,
  dayKey,
  effectiveMapRole,
  INVITE_MAX_USES,
  INVITE_TTL_MS,
  inviteCode,
  inviteUsable,
  isRole,
  mergeRole,
  spendQuota,
  validateTtsText,
  type Role,
} from './logic';

initializeApp();
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

const db = getFirestore();

const ELEVENLABS_API_KEY = defineSecret('ELEVENLABS_API_KEY');
const ELEVENLABS_VOICE_IDS = defineString('ELEVENLABS_VOICE_IDS', { default: '21m00Tcm4TlvDq8ikWAM' });
const ELEVENLABS_MODEL = defineString('ELEVENLABS_MODEL', { default: 'eleven_flash_v2_5' });
const TTS_DAILY_CHAR_LIMIT = defineInt('TTS_DAILY_CHAR_LIMIT', { default: 20000 });

type MapDoc = {
  name: string;
  ownerId: string;
  orgId?: string | null;
  members: Record<string, Role>;
  memberUids: string[];
  orgMemberUids?: string[];
  latestVersion?: number | null;
};

type OrgDoc = { name: string; ownerId: string; members: Record<string, Role>; memberUids: string[] };

function requireAuth(uid: string | undefined): string {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  return uid;
}

async function orgMembers(orgId: string | null | undefined): Promise<Record<string, Role> | null> {
  if (!orgId) return null;
  const snap = await db.doc(`orgs/${orgId}`).get();
  return (snap.data() as OrgDoc | undefined)?.members ?? null;
}

// ---- Invites ------------------------------------------------------------------------------

export const createInvite = onCall(async (req) => {
  const uid = requireAuth(req.auth?.uid);
  const { mapId, orgId, role } = (req.data ?? {}) as { mapId?: string; orgId?: string; role?: unknown };
  if (!isRole(role)) throw new HttpsError('invalid-argument', 'Unknown role.');
  if (Boolean(mapId) === Boolean(orgId)) throw new HttpsError('invalid-argument', 'Give exactly one of mapId or orgId.');

  let callerRole: Role | null = null;
  if (mapId) {
    const map = (await db.doc(`maps/${mapId}`).get()).data() as MapDoc | undefined;
    if (!map) throw new HttpsError('not-found', 'Map not found.');
    callerRole = effectiveMapRole(map, uid, await orgMembers(map.orgId));
  } else {
    const org = (await db.doc(`orgs/${orgId}`).get()).data() as OrgDoc | undefined;
    if (!org) throw new HttpsError('not-found', 'Organization not found.');
    callerRole = org.members[uid] ?? null;
  }
  if (!canInvite(callerRole, role)) throw new HttpsError('permission-denied', 'You cannot invite people with that role.');

  const expiresAt = Date.now() + INVITE_TTL_MS;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = inviteCode((n) => new Uint8Array(randomBytes(n)));
    try {
      await db.doc(`invites/${code}`).create({
        ...(mapId ? { mapId } : { orgId }),
        role,
        createdBy: uid,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(expiresAt),
        uses: 0,
        maxUses: INVITE_MAX_USES,
      });
      return { code, role, expiresAt };
    } catch (e) {
      if ((e as { code?: number }).code !== 6) throw e; // 6 = ALREADY_EXISTS: try another code
    }
  }
  throw new HttpsError('resource-exhausted', 'Could not create an invite code. Try again.');
});

export const acceptInvite = onCall(async (req) => {
  const uid = requireAuth(req.auth?.uid);
  const code = String((req.data as { code?: unknown } | undefined)?.code ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6,12}$/.test(code)) throw new HttpsError('invalid-argument', 'That code is not valid.');

  return db.runTransaction(async (tx) => {
    const inviteRef = db.doc(`invites/${code}`);
    const invite = (await tx.get(inviteRef)).data() as
      | { mapId?: string; orgId?: string; role: Role; expiresAt: Timestamp; uses: number; maxUses: number }
      | undefined;
    if (!invite) throw new HttpsError('not-found', 'That code is not valid.');
    const problem = inviteUsable({ expiresAt: invite.expiresAt.toMillis(), uses: invite.uses, maxUses: invite.maxUses }, Date.now());
    if (problem) throw new HttpsError('failed-precondition', problem);

    const targetRef = invite.mapId ? db.doc(`maps/${invite.mapId}`) : db.doc(`orgs/${invite.orgId}`);
    const target = (await tx.get(targetRef)).data() as { members: Record<string, Role> } | undefined;
    if (!target) throw new HttpsError('not-found', 'The shared map no longer exists.');

    const role = mergeRole(target.members[uid], invite.role);
    tx.update(targetRef, {
      [`members.${uid}`]: role,
      memberUids: FieldValue.arrayUnion(uid),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.update(inviteRef, { uses: FieldValue.increment(1) });
    return invite.mapId ? { mapId: invite.mapId } : { orgId: invite.orgId };
  });
});

// ---- Publishing ---------------------------------------------------------------------------

/**
 * Validates every new map version. Only valid versions become the map's latestVersion, so a
 * navigator never downloads a graph with dangling edges or impossible floor transitions.
 */
export const validateVersion = onDocumentCreated('maps/{mapId}/versions/{versionId}', async (event) => {
  const snap = event.data;
  if (!snap) return;
  const { mapId } = event.params;
  const data = snap.data() as { number: number; graphJson: string };

  let graph: MapGraph;
  try {
    graph = JSON.parse(data.graphJson) as MapGraph;
    if (graph.schemaVersion !== 1 || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error('bad schema');
  } catch {
    await snap.ref.update({ status: 'invalid', issues: [{ severity: 'error', code: 'empty', message: 'The map data could not be read.' }], validatedAt: FieldValue.serverTimestamp() });
    return;
  }

  const result = validateGraph(graph);
  await snap.ref.update({
    status: result.ok ? 'valid' : 'invalid',
    issues: result.issues.slice(0, 50).map(({ severity, code, message }) => ({ severity, code, message })),
    stats: { nodes: graph.nodes.length, edges: graph.edges.length, floors: graph.floors.length, components: result.components.length },
    validatedAt: FieldValue.serverTimestamp(),
  });
  if (!result.ok) {
    logger.info('Rejected map version', { mapId, number: data.number, errors: result.issues.filter((i) => i.severity === 'error').length });
    return;
  }
  await db.runTransaction(async (tx) => {
    const mapRef = db.doc(`maps/${mapId}`);
    const map = (await tx.get(mapRef)).data() as MapDoc | undefined;
    if (!map) return;
    if ((map.latestVersion ?? 0) >= data.number) return; // a newer version already won
    tx.update(mapRef, { latestVersion: data.number, latestVersionAt: FieldValue.serverTimestamp() });
  });
});

// ---- Organizations ------------------------------------------------------------------------

/** Mirror org members onto every org map so `array-contains` queries and list rules work. */
export const syncOrgMembers = onDocumentWritten('orgs/{orgId}', async (event) => {
  const { orgId } = event.params;
  const after = event.data?.after.data() as OrgDoc | undefined;
  const uids = after ? Object.keys(after.members ?? {}) : [];
  const maps = await db.collection('maps').where('orgId', '==', orgId).get();
  const writer = db.bulkWriter();
  for (const m of maps.docs) {
    const current = (m.data() as MapDoc).orgMemberUids ?? [];
    if (!after) writer.update(m.ref, { orgId: null, orgMemberUids: [] });
    else if (current.length !== uids.length || current.some((u) => !uids.includes(u))) writer.update(m.ref, { orgMemberUids: uids });
  }
  if (after && (after.memberUids?.length !== uids.length || after.memberUids.some((u) => !uids.includes(u)))) {
    writer.update(event.data!.after.ref, { memberUids: uids });
  }
  await writer.close();
});

/** When a map joins or leaves an organization, copy that org's member list onto it. */
export const syncMapOrg = onDocumentWritten('maps/{mapId}', async (event) => {
  const after = event.data?.after;
  if (!after?.exists) return;
  const map = after.data() as MapDoc;
  const before = event.data?.before.data() as MapDoc | undefined;
  if (before && (before.orgId ?? null) === (map.orgId ?? null) && map.orgMemberUids !== undefined) return;
  const uids = map.orgId ? Object.keys((await orgMembers(map.orgId)) ?? {}) : [];
  const current = map.orgMemberUids ?? [];
  if (current.length === uids.length && current.every((u) => uids.includes(u))) return;
  await after.ref.update({ orgMemberUids: uids });
});

/** Remove versions, drafts, scans and stored files of a deleted map. */
export const cleanupMap = onDocumentDeleted('maps/{mapId}', async (event) => {
  const { mapId } = event.params;
  await db.recursiveDelete(db.doc(`maps/${mapId}`));
  await getStorage().bucket().deleteFiles({ prefix: `maps/${mapId}/` }).catch((e) => logger.warn('Storage cleanup failed', { mapId, e: String(e) }));
});

// ---- Voice --------------------------------------------------------------------------------

/**
 * ElevenLabs proxy. Holds the API key, restricts voices to an allowlist (one consistent guide
 * voice) and enforces a per-user daily character quota. Returns MP3 as base64.
 */
export const tts = onCall({ secrets: [ELEVENLABS_API_KEY], timeoutSeconds: 20, memory: '256MiB', concurrency: 40 }, async (req) => {
  const uid = requireAuth(req.auth?.uid);
  const { text: rawText, voiceId } = (req.data ?? {}) as { text?: unknown; voiceId?: unknown };
  let text: string;
  try {
    text = validateTtsText(rawText);
  } catch (e) {
    throw new HttpsError('invalid-argument', (e as Error).message);
  }
  const allowed = ELEVENLABS_VOICE_IDS.value().split(',').map((v) => v.trim()).filter(Boolean);
  const voice = typeof voiceId === 'string' && allowed.includes(voiceId) ? voiceId : allowed[0];
  if (!voice) throw new HttpsError('failed-precondition', 'No voice is configured.');

  const usageRef = db.doc(`usage/${uid}`);
  await db.runTransaction(async (tx) => {
    const usage = (await tx.get(usageRef)).data() as { day?: string; chars?: number } | undefined;
    const next = spendQuota(usage, text.length, TTS_DAILY_CHAR_LIMIT.value(), dayKey(new Date()));
    if (!next) throw new HttpsError('resource-exhausted', 'Daily voice limit reached. The built-in voice will be used.');
    tx.set(usageRef, next, { merge: true });
  });

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'xi-api-key': ELEVENLABS_API_KEY.value(), 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: ELEVENLABS_MODEL.value(),
      voice_settings: { stability: 0.6, similarity_boost: 0.75, style: 0, use_speaker_boost: true },
    }),
  });
  if (!res.ok) {
    logger.warn('ElevenLabs error', { status: res.status, body: (await res.text()).slice(0, 300) });
    throw new HttpsError('unavailable', 'Voice service unavailable.');
  }
  const audio = Buffer.from(await res.arrayBuffer()).toString('base64');
  return { audio, contentType: res.headers.get('content-type') ?? 'audio/mpeg' };
});
