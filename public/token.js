import isTrusted from './trust.js';

if (!window.firebase) throw new Error('firebase not loaded');

const inputs = new URL(import.meta.url).searchParams;
const eventName = 'Auth result';
let resolve;

export function authEvent(
  token,
  origin = inputs.get('origin'),
) {
  if (!token) return Promise.reject(new Error('Missing token'));
  const w = window.opener;
  if (!w) return Promise.reject(new Error('No opener detected'));
  let timeout;
  return new Promise((res, rej) => {
    resolve = res;
    timeout = setTimeout(() => rej('Failed to detect login.'), 1000);

    w.postMessage({
      token,
    }, origin || w.location.origin);
  }).then((result) => {
    clearTimeout(timeout);
    return result;
  }).catch((err) => {
    clearTimeout(timeout);
    throw err;
  });
}

if (inputs.has('listen') || inputs.has('trust')) {
  console.debug('listening to token events');
  window.addEventListener('message', (ev) => {
    console.debug(ev);
    if (!ev.data || inputs.has('trust') ?
    inputs.get('trust') !== ev.origin :
    !isTrusted(ev.origin)) return;
    const token = ev.data.token;
    if (!token) return;
    firebase.auth()
      .signInWithCustomToken(token)
      .then(_ => '') // ignore the user
      .catch(e => e) // Catch errors
      .then((error = '') => {
        const data = {
          event: eventName,
          login: error === '',
        };
        if (error) {
          console.error(error);
          data.error = error.stack || error; // Pass error (if any)
        }
        console.debug(data);
        ev.source.postMessage(data, ev.origin); // Give a reply
      });
  });
} else {
  window.addEventListener('message', (ev) => {
    if (!resolve ||
      !ev.data ||
      !isTrusted(ev.origin) ||
      ev.data.login === undefined ||
      ev.data.event !== eventName) return;

    resolve(ev.data);
    resolve = null;
  });
}
