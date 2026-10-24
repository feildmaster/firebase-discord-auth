const admin = require('firebase-admin');
const crypto = require('crypto');
const functions = require('firebase-functions/v1');
const { defineSecret, defineString } = require('firebase-functions/params');
const database = require('../util/database');
const { userFor } = require('./link');

const clientId = defineString('DISCORD_CLIENT_ID');
const clientSecret = defineSecret('DISCORD_CLIENT_SECRET');

const discordAPI = 'https://discord.com/api';
const provider = 'discord.com';
const defaultScope = 'identify email';
const STATE_MAX_AGE_MS = 3600000;

function authorizeURL(redirect, scope, state) {
  const query = new URLSearchParams({
    client_id: clientId.value(),
    redirect_uri: redirect,
    response_type: 'code',
    scope,
    state,
  });
  return `${discordAPI}/oauth2/authorize?${query}`;
}

exports.redirect = functions.https.onRequest((req, res) => {
  if (!req.query.redirect) {
    res.status(400).send('INVALID URI');
    return;
  }
  const state = crypto.randomBytes(20).toString('hex');
  res.cookie('state', state, {
    maxAge: STATE_MAX_AGE_MS,
    secure: true,
    httpOnly: true,
  });
  res.redirect(authorizeURL(req.query.redirect, req.query.scope || defaultScope, state));
});

exports.token = functions
  .runWith({ secrets: [clientSecret] })
  .https.onCall((data = {}, context) => {
    if (!(data && data.state && data.code && data.redirect)) {
      throw new functions.https.HttpsError('invalid-argument');
    }

    return getDiscordData({
      code: data.code,
      redirect_uri: data.redirect,
    })
      .then((discord) => {
        if (context.auth) return linkToFirebase(discord, context.auth.uid);
        return loginToFirebase(discord);
      })
      .catch(httpsError);
  });

function linkToFirebase(discordInfo, uid) {
  return admin.auth().getUser(uid).then(async (user) => {
    if (!user) throw new functions.https.HttpsError('aborted');

    const { id } = discordInfo;
    const oAuth = await database.getByProvider(provider, id) || await database.getByUID(provider, uid);
    if (!oAuth) {
      return registerUser(discordInfo, user);
    }
    if (oAuth.UID !== uid
      || oAuth.providerUID !== id) {
      throw new functions.https.HttpsError('already-exists', 'Already linked to another account');
    }
    return updateUser(discordInfo, user);
  })
    .then(updateClaims)
    .then(() => 'LINKED');
}

function loginToFirebase(discordInfo) {
  const { id } = discordInfo;
  return database.getByProvider(provider, id)
    .then(getOrCreateUser.bind(null, discordInfo))
    .then(updateClaims)
    .then(updateUser.bind(null, discordInfo))
    .then(({ uid }) => admin.auth().createCustomToken(uid))
    .then((token) => ({ token }));
}

function getOrCreateUser(discordInfo, oAuth) {
  if (!oAuth) {
    const { email, verified } = discordInfo;
    return userFor(admin.auth(), { email, verified })
      .then(registerUser.bind(null, discordInfo));
  }
  return admin.auth().getUser(oAuth.UID);
}

function registerUser({ id }, user) {
  return database.addNewProvider({
    provider,
    providerUID: id,
    UID: user.uid,
  }).then(() => user);
}

function updateUser(discordInfo, user) {
  const updates = {};
  if (!user.displayName) {
    updates.displayName = discordInfo.username;
  }
  if (!user.photoURL) {
    updates.photoURL = getAvatar(discordInfo);
  }
  if (Object.keys(updates).length) {
    return admin.auth().updateUser(user.uid, updates);
  }
  return user;
}

function updateClaims(user) {
  const claims = user.customClaims || {};
  if (claims[provider]) return user;
  claims[provider] = true;
  return admin.auth().setCustomUserClaims(user.uid, claims)
    .then(() => user);
}

function getAvatar({
  id, avatar, discriminator,
}) {
  if (avatar) {
    return `https://cdn.discordapp.com/avatars/${id}/${avatar}.png`;
  }
  const index = discriminator && discriminator !== '0'
    ? discriminator % 5
    : Number((BigInt(id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

function httpsError(err) {
  if (err instanceof functions.https.HttpsError) {
    throw err;
  }
  console.error('ERROR:', err); // eslint-disable-line no-console
  throw new functions.https.HttpsError('unknown', err);
}

async function getDiscordData({ code, redirect_uri: redirectUri }) {
  try {
    const tokenResponse = await fetch(`${discordAPI}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId.value(),
        client_secret: clientSecret.value(),
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenResponse.ok) throw new Error(`Discord token request failed (${tokenResponse.status})`);

    const { token_type: type = 'Bearer', access_token: token = '' } = await tokenResponse.json();
    const userResponse = await fetch(`${discordAPI}/users/@me`, {
      headers: { Authorization: `${type} ${token}` },
    });
    if (!userResponse.ok) throw new Error(`Discord user request failed (${userResponse.status})`);
    return await userResponse.json();
  } catch (error) {
    console.error('Discord request failed:', error.message); // eslint-disable-line no-console
    throw new functions.https.HttpsError('permission-denied');
  }
}
