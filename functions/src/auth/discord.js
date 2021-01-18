const admin = require('firebase-admin');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const functions = require('firebase-functions');
const needle = require('needle');
const { AuthorizationCode } = require('simple-oauth2');
const database = require('../util/database');

const discordAPI = 'https://discord.com/api/';
const provider = 'discord.com';
const defaultScope = 'identify email';

function authClient() {
  return new AuthorizationCode({
    client: {
      id: functions.config().discord.cid,
      secret: functions.config().discord.secret,
    },
    auth: {
      tokenHost: discordAPI,
      tokenPath: 'oauth2/token',
      revokePath: 'oauth2/token/revoke',
      authorizePath: 'oauth2/authorize',
    },
  });
}

exports.redirect = functions.https.onRequest((req, res) => {
  if (!req.query.redirect) {
    res.status(400).send('INVALID URI');
    return;
  }
  const oauth = authClient();
  const state = crypto.randomBytes(20).toString('hex');
  res.cookie('state', state.toString(), {
    maxAge: 3600000,
    secure: true,
    httpOnly: true,
  });
  const url = oauth.authorizeURL({
    redirect_uri: req.query.redirect,
    scope: req.query.scope || defaultScope,
    state,
  });
  res.redirect(url);
});

exports.token = functions.https.onCall((data = {}, context) => {
  if (!(data && data.state && data.code && data.redirect)) {
    throw new functions.https.HttpsError('invalid-argument');
  }
  /* - This function is unable to get cookies
  // Parse cookies
  const req = context.rawRequest;
  cookieParser()(req, null, () => {});
  if (!req.cookies.state || req.cookies.state !== data.state) {
    throw new functions.https.HttpsError('permission-denied');
  }
  // */

  return getDiscordData({
    code: data.code,
    redirect_uri: data.redirect,
    scope: data.scope || defaultScope,
  })
    .then((discord) => {
      if (context.auth) return linkToFirebase(discord, context.auth.uid);
      return loginToFirebase(discord);
    })
    .catch(httpsError);
});

function linkToFirebase(discordInfo, uid) {
  return admin.auth().getUser(uid).then(async (user) => {
    if (!user) throw new functions.https.HttpsError('aborted'); // Should be impossible

    const { id } = discordInfo;
    const oAuth = await database.getByProvider(provider, id) || await database.getByUID(provider, uid);
    if (!oAuth) {
      return registerUser(discordInfo, user);
    }
    if (oAuth.UID !== uid ||
      oAuth.providerUID !== id) {
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
    .then(token => ({ token }));
}

function getOrCreateUser(discordInfo, oAuth) {
  if (!oAuth) {
    const { email } = discordInfo;
    return admin.auth().createUser({ email })
      .then(registerUser.bind(null, discordInfo));
  } else {
    return admin.auth().getUser(oAuth.UID);
  }
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
    return admin.auth().updateUser(user.uid, updates)
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
  return `https://cdn.discordapp.com/avatars/${discriminator % 5}.png`;
}

function httpsError(err) {
  if (err instanceof functions.https.HttpsError) {
    throw err;
  }
  console.error('ERROR:', err); // eslint-disable-line no-console
  throw new functions.https.HttpsError('unknown', err);
}

function getDiscordData(obj) {
  return authClient()
    .getToken(obj)
    .then(getUserData)
    .catch(() => {
      throw new functions.https.HttpsError('permission-denied');
    });
}

function getUserData({
  token: {
    token_type = 'Bearer',
    access_token = '',
  }
}) {
  return needle('get', `${discordAPI}users/@me`, {
    headers: {
      'Authorization': `${token_type} ${access_token}`
    },
  }).then(({body}) => body);
}
