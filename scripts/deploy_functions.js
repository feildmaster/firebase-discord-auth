const { getInput } = require('./util/io');
const cache_file = require('./cache_file').writeTemp;
const exec = require('@actions/exec');

const serviceAccount = getInput('SERVICE_ACCOUNT');
const only = getInput('ONLY');

if (!serviceAccount) throw new Error('Missing service account');

const fileName = cache_file(serviceAccount);

exec('npx firebase-tools', [
  'deploy',
  '--only',
  `functions${only ? `:${only}` : ''}`,
], {
  env: {
    FIREBASE_DEPLOY_AGENT: 'github-actions',
    GOOGLE_APPLICATION_CREDENTIALS: fileName,
  },
}).catch(console.error);
