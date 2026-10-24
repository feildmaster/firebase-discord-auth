const assert = require('node:assert/strict');
const { test } = require('node:test');
const { userFor } = require('../src/auth/link');

function fakeAuth(users = []) {
  const created = [];
  return {
    created,
    createUser: async (properties) => {
      created.push(properties);
      return { uid: `new-${created.length}`, ...properties };
    },
    getUserByEmail: async (email) => {
      const user = users.find((entry) => entry.email === email);
      if (user) return user;
      throw Object.assign(new Error('not found'), { code: 'auth/user-not-found' });
    },
  };
}

test('links to the account that has the same verified email', async () => {
  const auth = fakeAuth([{ uid: 'github-user', email: 'a@example.com', emailVerified: true }]);
  const user = await userFor(auth, { email: 'a@example.com', verified: true });
  assert.equal(user.uid, 'github-user');
  assert.equal(auth.created.length, 0);
});

test('creates a verified account when nobody has the email', async () => {
  const auth = fakeAuth();
  await userFor(auth, { email: 'a@example.com', verified: true });
  assert.deepEqual(auth.created, [{ email: 'a@example.com', emailVerified: true }]);
});

test('refuses to link to an account whose email was never verified', async () => {
  const auth = fakeAuth([{ uid: 'other', email: 'a@example.com', emailVerified: false }]);
  await assert.rejects(userFor(auth, { email: 'a@example.com', verified: true }), { code: 'already-exists' });
  assert.equal(auth.created.length, 0);
});

test('never links or claims an email that Discord has not verified', async () => {
  const auth = fakeAuth([{ uid: 'github-user', email: 'a@example.com', emailVerified: true }]);
  const user = await userFor(auth, { email: 'a@example.com', verified: false });
  assert.notEqual(user.uid, 'github-user');
  assert.deepEqual(auth.created, [{}]);
});

test('creates an account without an email when Discord gave none', async () => {
  const auth = fakeAuth();
  await userFor(auth, { email: undefined, verified: undefined });
  assert.deepEqual(auth.created, [{}]);
});

test('passes on errors other than a missing user', async () => {
  const auth = fakeAuth();
  auth.getUserByEmail = async () => { throw Object.assign(new Error('boom'), { code: 'auth/internal-error' }); };
  await assert.rejects(userFor(auth, { email: 'a@example.com', verified: true }), { message: 'boom' });
});
