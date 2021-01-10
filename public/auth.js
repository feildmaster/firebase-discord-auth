import { projectId } from './firebase.js'; // First, validate firebase
import { authEvent } from './token.js';

const inputs = new URL(import.meta.url).searchParams;

const run = inputs.has('run');

function displayError(error, extra = error.details || '') {
  console.error(error);
  document.body.innerHTML = `Error: ${error}<br>${extra}`;
  return Promise.resolve();
}

export default function process(
  redirect = inputs.get('redirect'),
  type = inputs.get('type'),
  origin = inputs.get('origin'),
) {
  if (!redirect && run && type) {
    redirect = `${location.origin}/${type}.html`;
  }
  if (!redirect && !type) {
    displayError('Malformed script');
    return;
  }
  const parameters = new URL(location.href).searchParams;

  const code = parameters.get('code');
  const error = parameters.get('error');

  if (error) {
    displayError(error, parameters.get('error_description'));
  } else if (code) {
    const state = parameters.get('state');
    const callable = firebase.functions().httpsCallable('auth-discord-token');
    callable({
      state, code, redirect,
    }).then(({data}) => {
      if (data === 'LINKED') { // Linking Discord
        return window.close();
      } else if (data.token) { // Signing in
        return authEvent(data.token, origin)
          .then((result) => {
            if (result.error) {
              displayError(result.error);
            } else if (result.login) {
              window.close();
            } else {
              displayError('Failed to login');
            }
          }).catch(displayError);
      }
      return displayError('Unknown State');
    }).catch(displayError);
  } else if (type && redirect) {
    const emulator = firebase.functions().emulatorOrigin;
    const region = firebase.functions().region;
    const host = emulator ?
      `${emulator}/${projectId()}/${region}` :
      `https://${region}-${projectId()}.cloudfunctions.net`;
    location.href = `${host}/auth-${type}-redirect?redirect=${encodeURIComponent(redirect)}`;
  } else {
    displayError('Malformed script');
  }
}

if (run) {
  process();
}
