import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  runTransaction,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
  deleteDoc,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-pathsense',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
afterAll(() => env?.cleanup());
beforeEach(() => env.clearFirestore());

const db = (uid?: string) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();

async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const a = ctx.firestore();
    await setDoc(doc(a, 'maps/m1'), {
      name: 'Dorm',
      ownerId: 'owner',
      orgId: null,
      members: { owner: 'owner', ed: 'editor', nav: 'navigator' },
      memberUids: ['owner', 'ed', 'nav'],
      latestVersion: 1,
      versionCounter: 1,
    });
    await setDoc(doc(a, 'maps/m1/versions/000001'), {
      number: 1,
      note: 'v1',
      graphJson: '{}',
      createdBy: 'owner',
      status: 'valid',
    });
    await setDoc(doc(a, 'orgs/o1'), {
      name: 'Campus',
      ownerId: 'boss',
      members: { boss: 'owner', staff: 'editor', student: 'navigator' },
      memberUids: ['boss', 'staff', 'student'],
    });
    await setDoc(doc(a, 'maps/m2'), {
      name: 'Library',
      ownerId: 'boss',
      orgId: 'o1',
      members: { boss: 'owner' },
      memberUids: ['boss'],
      orgMemberUids: ['boss', 'staff', 'student'],
      latestVersion: null,
    });
  });
}

const newMap = (uid: string, extra: Record<string, unknown> = {}) => ({
  name: 'New',
  description: '',
  ownerId: uid,
  orgId: null,
  members: { [uid]: 'owner' },
  memberUids: [uid],
  latestVersion: null,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...extra,
});

describe('maps', () => {
  beforeEach(seed);

  it('lets members read and outsiders not', async () => {
    await assertSucceeds(getDoc(doc(db('nav'), 'maps/m1')));
    await assertFails(getDoc(doc(db('stranger'), 'maps/m1')));
    await assertFails(getDoc(doc(db(), 'maps/m1')));
  });

  it('supports membership queries', async () => {
    await assertSucceeds(
      getDocs(query(collection(db('nav'), 'maps'), where('memberUids', 'array-contains', 'nav'))),
    );
    await assertSucceeds(
      getDocs(query(collection(db('student'), 'maps'), where('orgMemberUids', 'array-contains', 'student'))),
    );
    await assertFails(getDocs(collection(db('nav'), 'maps')));
  });

  it('only allows creating maps you own, with no server fields', async () => {
    await assertSucceeds(setDoc(doc(db('u'), 'maps/x'), newMap('u')));
    await assertFails(setDoc(doc(db('u'), 'maps/y'), newMap('someone-else')));
    await assertFails(setDoc(doc(db('u'), 'maps/z'), newMap('u', { latestVersion: 4 })));
    await assertFails(setDoc(doc(db('u'), 'maps/w'), newMap('u', { orgId: 'o1' })));
    await assertSucceeds(setDoc(doc(db('staff'), 'maps/v'), newMap('staff', { orgId: 'o1' })));
  });

  it('editors can rename but not change members or publish pointers', async () => {
    await assertSucceeds(updateDoc(doc(db('ed'), 'maps/m1'), { name: 'Renamed' }));
    await assertFails(updateDoc(doc(db('ed'), 'maps/m1'), { 'members.ed': 'owner' }));
    await assertFails(updateDoc(doc(db('ed'), 'maps/m1'), { latestVersion: 9 }));
    await assertFails(updateDoc(doc(db('nav'), 'maps/m1'), { name: 'Nope' }));
  });

  it('owners manage members but cannot remove themselves as owner', async () => {
    await assertSucceeds(
      updateDoc(doc(db('owner'), 'maps/m1'), {
        'members.new': 'navigator',
        memberUids: ['owner', 'ed', 'nav', 'new'],
      }),
    );
    await assertFails(updateDoc(doc(db('owner'), 'maps/m1'), { 'members.x': 'navigator' })); // memberUids out of sync
    await assertFails(updateDoc(doc(db('owner'), 'maps/m1'), { 'members.owner': 'editor' }));
    await assertFails(
      updateDoc(doc(db('owner'), 'maps/m1'), {
        'members.y': 'admin',
        memberUids: ['owner', 'ed', 'nav', 'y'],
      }),
    );
  });

  it('org editors get editor rights on org maps', async () => {
    await assertSucceeds(getDoc(doc(db('student'), 'maps/m2')));
    await assertSucceeds(updateDoc(doc(db('staff'), 'maps/m2'), { name: 'Main Library' }));
    await assertFails(updateDoc(doc(db('student'), 'maps/m2'), { name: 'Nope' }));
  });

  it('only the owner deletes', async () => {
    await assertFails(deleteDoc(doc(db('ed'), 'maps/m1')));
    await assertSucceeds(deleteDoc(doc(db('owner'), 'maps/m1')));
  });
});

describe('versions and drafts', () => {
  beforeEach(seed);

  const publish = (uid: string, n: number, extra: Record<string, unknown> = {}) =>
    runTransaction(db(uid), async (tx) => {
      const mapRef = doc(db(uid), 'maps/m1');
      await tx.get(mapRef);
      tx.update(mapRef, { versionCounter: n, updatedAt: serverTimestamp() });
      tx.set(doc(db(uid), `maps/m1/versions/${String(n).padStart(6, '0')}`), {
        number: n,
        note: 'update',
        graphJson: '{}',
        createdBy: uid,
        createdAt: serverTimestamp(),
        status: 'pending',
        ...extra,
      });
    });

  it('editors publish pending versions in sequence', async () => {
    await assertSucceeds(publish('ed', 2));
    await assertFails(publish('ed', 4)); // skips a number
    await assertFails(publish('ed', 3, { status: 'valid' })); // cannot self-validate
    await assertFails(publish('nav', 3));
  });

  it('versions are immutable', async () => {
    await assertFails(updateDoc(doc(db('owner'), 'maps/m1/versions/000001'), { note: 'edited' }));
    await assertFails(deleteDoc(doc(db('owner'), 'maps/m1/versions/000001')));
  });

  it('navigators read versions but not drafts', async () => {
    await assertSucceeds(getDoc(doc(db('nav'), 'maps/m1/versions/000001')));
    await assertFails(getDoc(doc(db('nav'), 'maps/m1/draft/current')));
    await assertSucceeds(
      setDoc(doc(db('ed'), 'maps/m1/draft/current'), {
        graphJson: '{}',
        updatedBy: 'ed',
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(doc(db('ed'), 'maps/m1/draft/other'), {
        graphJson: '{}',
        updatedBy: 'ed',
        updatedAt: serverTimestamp(),
      }),
    );
  });
});

describe('server-only collections', () => {
  it('blocks invites and usage writes', async () => {
    await assertFails(setDoc(doc(db('u'), 'invites/ABCDEFGH'), { role: 'owner' }));
    await assertFails(getDoc(doc(db('u'), 'invites/ABCDEFGH')));
    await assertFails(setDoc(doc(db('u'), 'usage/u'), { chars: 0 }));
    await assertSucceeds(getDoc(doc(db('u'), 'usage/u')));
  });
});
