const functions = require('firebase-functions/v1');

const NOT_FOUND = 'auth/user-not-found';

async function findByEmail(auth, email) {
  try {
    return await auth.getUserByEmail(email);
  } catch (error) {
    if (error.code === NOT_FOUND) return null;
    throw error;
  }
}

exports.userFor = async (auth, { email, verified }) => {
  if (!email || verified !== true) return auth.createUser({});

  const existing = await findByEmail(auth, email);
  if (!existing) return auth.createUser({ email, emailVerified: true });
  if (!existing.emailVerified) {
    throw new functions.https.HttpsError('already-exists', 'That email belongs to an unverified account');
  }
  return existing;
};
