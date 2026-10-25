const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const { afterEach, beforeEach, test } = require('node:test');

const PROVIDER = 'discord.com';

const discordUser = (overrides = {}) => ({
  id: '555',
  username: 'discordname',
  avatar: 'abc123',
  discriminator: '0',
  email: 'person@example.com',
  verified: true,
  ...overrides,
});

let users;
let links;
let calls;
let original;
let originalFetch;
let discord;
let tokenOk;
let currentDiscordUser;

const notFound = () => Object.assign(new Error('not found'), { code: 'auth/user-not-found' });

beforeEach(() => {
  users = new Map();
  links = [];
  calls = { createUser: [], createCustomToken: [], getUserByEmail: [] };
  tokenOk = true;
  currentDiscordUser = discordUser();
  let created = 0;

  const auth = {
    getUser: async (uid) => {
      if (!users.has(uid)) throw notFound();
      return { ...users.get(uid) };
    },
    getUserByEmail: async (email) => {
      calls.getUserByEmail.push(email);
      const found = [...users.values()].find((user) => user.email === email);
      if (!found) throw notFound();
      return { ...found };
    },
    createUser: async (properties) => {
      calls.createUser.push(properties);
      created += 1;
      const user = { uid: `created-${created}`, ...properties };
      users.set(user.uid, user);
      return { ...user };
    },
    updateUser: async (uid, updates) => {
      const user = { ...users.get(uid), ...updates };
      users.set(uid, user);
      return { ...user };
    },
    setCustomUserClaims: async (uid, claims) => {
      users.set(uid, { ...users.get(uid), customClaims: claims });
    },
    createCustomToken: async (uid) => {
      calls.createCustomToken.push(uid);
      return `token-for-${uid}`;
    },
  };

  const database = {
    getByProvider: async (provider, id) => links.find((link) => link.provider === provider && link.providerUID === id) || null,
    getByUID: async (provider, uid) => links.find((link) => link.provider === provider && link.UID === uid) || null,
    addNewProvider: async (entry) => { links.push({ ...entry }); },
  };

  original = Module._load;
  Module._load = function load(request, ...rest) {
    if (request === 'firebase-admin') return { auth: () => auth };
    if (request === '../util/database') return database;
    return original.call(this, request, ...rest);
  };

  originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/oauth2/token')) {
      return tokenOk
        ? { ok: true, status: 200, json: async () => ({ token_type: 'Bearer', access_token: 'discord-access' }) }
        : { ok: false, status: 400, json: async () => ({}) };
    }
    if (String(url).endsWith('/users/@me')) {
      return { ok: true, status: 200, json: async () => currentDiscordUser };
    }
    throw new Error(`Unexpected request to ${url}`);
  };

  process.env.DISCORD_CLIENT_ID = 'client-id';
  process.env.DISCORD_CLIENT_SECRET = 'client-secret';
  Object.keys(require.cache)
    .filter((key) => key.includes(`${path.sep}src${path.sep}`))
    .forEach((key) => delete require.cache[key]);
  discord = require('../src/auth/discord');
});

afterEach(() => {
  Module._load = original;
  globalThis.fetch = originalFetch;
});

const request = { state: 'state', code: 'code', redirect: 'https://auth.feildmaster.com/discord' };
const call = (context = {}, data = request) => discord.token.run(data, context);
const addUser = (user) => users.set(user.uid, user);

test('linking attaches Discord to the signed-in account and says so', async () => {
  addUser({ uid: 'google-user', email: 'me@example.com', emailVerified: true });

  const result = await call({ auth: { uid: 'google-user' } });

  assert.equal(result, 'LINKED');
  assert.deepEqual(links, [{ provider: PROVIDER, providerUID: '555', UID: 'google-user' }]);
  assert.equal(users.get('google-user').customClaims[PROVIDER], true, 'the claim the wallet reads is set');
});

test('linking never creates an account or hands out a sign-in token', async () => {
  addUser({ uid: 'google-user' });

  await call({ auth: { uid: 'google-user' } });

  assert.deepEqual(calls.createUser, []);
  assert.deepEqual(calls.createCustomToken, []);
});

test('linking ignores email addresses, so a different email still links', async () => {
  addUser({ uid: 'google-user', email: 'mine@example.com', emailVerified: true });
  addUser({ uid: 'someone-else', email: 'person@example.com', emailVerified: true });

  await call({ auth: { uid: 'google-user' } });

  assert.deepEqual(links, [{ provider: PROVIDER, providerUID: '555', UID: 'google-user' }]);
  assert.deepEqual(calls.getUserByEmail, [], 'the email was never looked up');
});

test('linking keeps the claims the account already has', async () => {
  addUser({ uid: 'u', customClaims: { admin: true } });

  await call({ auth: { uid: 'u' } });

  assert.deepEqual(users.get('u').customClaims, { admin: true, [PROVIDER]: true });
});

test('linking never overwrites the name or picture the account already has', async () => {
  addUser({ uid: 'named', displayName: 'Real Name', photoURL: 'https://example.com/me.png' });

  await call({ auth: { uid: 'named' } });
  assert.equal(users.get('named').displayName, 'Real Name', 'on the first link');
  assert.equal(users.get('named').photoURL, 'https://example.com/me.png');

  await call({ auth: { uid: 'named' } });
  assert.equal(users.get('named').displayName, 'Real Name', 'and when linking again');
  assert.equal(users.get('named').photoURL, 'https://example.com/me.png');
});

test('linking a Discord account for the first time fills in a missing name and picture', async () => {
  addUser({ uid: 'blank' });

  await call({ auth: { uid: 'blank' } });

  assert.equal(users.get('blank').displayName, 'discordname');
  assert.equal(users.get('blank').photoURL, 'https://cdn.discordapp.com/avatars/555/abc123.png');
  assert.deepEqual(links, [{ provider: PROVIDER, providerUID: '555', UID: 'blank' }]);
  assert.equal(users.get('blank').customClaims[PROVIDER], true, 'the claim is still set after the profile update');
});

test('linking fills in only the part of the profile that is missing', async () => {
  addUser({ uid: 'half', displayName: 'Keep Me' });

  await call({ auth: { uid: 'half' } });

  assert.equal(users.get('half').displayName, 'Keep Me');
  assert.equal(users.get('half').photoURL, 'https://cdn.discordapp.com/avatars/555/abc123.png');
});

test('linking an already linked Discord account fills in a missing name and picture', async () => {
  addUser({ uid: 'blank' });
  links.push({ provider: PROVIDER, providerUID: '555', UID: 'blank' });

  await call({ auth: { uid: 'blank' } });

  assert.equal(users.get('blank').displayName, 'discordname');
  assert.equal(users.get('blank').photoURL, 'https://cdn.discordapp.com/avatars/555/abc123.png');
});

test('linking the same Discord account again succeeds without a duplicate', async () => {
  addUser({ uid: 'u' });
  links.push({ provider: PROVIDER, providerUID: '555', UID: 'u' });

  const result = await call({ auth: { uid: 'u' } });

  assert.equal(result, 'LINKED');
  assert.equal(links.length, 1);
});

test('a Discord account that belongs to another user is refused', async () => {
  addUser({ uid: 'me' });
  addUser({ uid: 'other' });
  links.push({ provider: PROVIDER, providerUID: '555', UID: 'other' });

  await assert.rejects(call({ auth: { uid: 'me' } }), { code: 'already-exists' });

  assert.equal(links.length, 1);
  assert.equal(links[0].UID, 'other', 'the existing link is untouched');
  assert.equal(users.get('me').customClaims, undefined);
});

test('an account that already has a different Discord is refused', async () => {
  addUser({ uid: 'me' });
  links.push({ provider: PROVIDER, providerUID: '999', UID: 'me' });

  await assert.rejects(call({ auth: { uid: 'me' } }), { code: 'already-exists' });

  assert.deepEqual(links, [{ provider: PROVIDER, providerUID: '999', UID: 'me' }]);
});

test('linking for a user that no longer exists fails without writing anything', async () => {
  await assert.rejects(call({ auth: { uid: 'ghost' } }));

  assert.deepEqual(links, []);
});

test('signing in with a known Discord account returns a token for its user', async () => {
  addUser({ uid: 'linked-user' });
  links.push({ provider: PROVIDER, providerUID: '555', UID: 'linked-user' });

  const result = await call({});

  assert.deepEqual(result, { token: 'token-for-linked-user' });
  assert.deepEqual(calls.createUser, []);
});

test('signing in with an unknown Discord account creates a user and remembers it', async () => {
  currentDiscordUser = discordUser({ email: undefined, verified: undefined });

  const result = await call({});

  assert.deepEqual(result, { token: 'token-for-created-1' });
  assert.deepEqual(links, [{ provider: PROVIDER, providerUID: '555', UID: 'created-1' }]);
});

test('signing in joins the account that has the same verified email', async () => {
  addUser({ uid: 'github-user', email: 'person@example.com', emailVerified: true });

  const result = await call({});

  assert.deepEqual(result, { token: 'token-for-github-user' });
  assert.deepEqual(links, [{ provider: PROVIDER, providerUID: '555', UID: 'github-user' }]);
  assert.deepEqual(calls.createUser, []);
});

test('a request without the pieces it needs is rejected before Discord is asked', async () => {
  await assert.rejects(call({ auth: { uid: 'u' } }, { code: 'code' }), { code: 'invalid-argument' });
  await assert.rejects(call({ auth: { uid: 'u' } }, null), { code: 'invalid-argument' });
});

test('a code that Discord does not accept is reported as permission denied', async () => {
  addUser({ uid: 'u' });
  tokenOk = false;

  await assert.rejects(call({ auth: { uid: 'u' } }), { code: 'permission-denied' });

  assert.deepEqual(links, []);
});
