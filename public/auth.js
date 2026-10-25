import { projectId } from './firebase.js'; // First, validate firebase
import { authEvent } from './token.js';
import isTrusted from './trust.js';

const inputs = new URL(import.meta.url).searchParams;

const run = inputs.has('run');

function displayError(error, extra = error.details || '') {
  console.error(error);
  document.body.innerHTML = `Error: ${error}<br>${extra}`;
}

function handOffLink({
  code, state, redirect, origin, nonce,
}) {
  const { opener } = window;
  if (!opener || !nonce || !origin || !isTrusted(origin)) {
    displayError('Start linking from your account menu, this window was not opened for it');
    return;
  }
  let timeout;

  function onAck(ev) {
    if (ev.origin !== origin || !ev.data || ev.data.event !== 'Discord link received' || ev.data.nonce !== nonce) return;
    clearTimeout(timeout);
    window.removeEventListener('message', onAck);
    window.close();
  }

  window.addEventListener('message', onAck);
  timeout = setTimeout(() => {
    window.removeEventListener('message', onAck);
    displayError('The wallet page did not confirm the link, close this window and try again');
  }, 5000);
  document.body.textContent = 'Finishing up...';
  opener.postMessage({
    event: 'Discord link', code, state, redirect, nonce,
  }, origin);
}

function host() {
  const emulator = firebase.functions().emulatorOrigin;
  const region = firebase.functions().region;
  if (emulator) {
    return `${emulator}/${projectId()}/${region}`;
  }
  return `https://${region}-${projectId()}.cloudfunctions.net`;
}

export default function process(
  redirect = inputs.get('redirect'),
  type = inputs.get('type'),
  origin = inputs.get('origin') || sessionStorage.getItem('origin'),
  mode = sessionStorage.getItem('mode'),
  nonce = sessionStorage.getItem('nonce'),
) {
  if (!redirect && run && type) {
    redirect = `${location.origin}/${type}`;
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
    if (mode === 'link') {
      handOffLink({
        code, state, redirect, origin, nonce,
      });
      return;
    }
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
      displayError('Unknown State');
    }).catch(displayError);
  } else if (type && redirect) {
    location.href = `${host()}/auth-${type}-redirect?redirect=${encodeURIComponent(redirect)}`;
  } else {
    displayError('Malformed script');
  }
}

if (run) {
  process();
}
