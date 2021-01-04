const inputs = new URL(import.meta.url).searchParams;

const run = inputs.has('run');

function getProjectId() {
  return firebase.app().options.projectId;
}

function displayError(error, extra = '') {
  document.body.innerHTML = `Error: ${error}<br>${extra}`;
}

function process(
  redirect = inputs.get('redirect'),
  type = inputs.get('type'),
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
  } else if (!code && type && redirect) {
    const emulator = firebase.functions().emulatorOrigin;
    const region = firebase.functions().region;
    const host = emulator ?
      `${emulator}/${getProjectId()}/${region}` :
      `https://${region}-${getProjectId()}.cloudfunctions.net`;
    location.href = `${host}/auth-${type}-redirect?redirect=${encodeURIComponent(redirect)}`;
  } else if (!code) {
    displayError('Malformed script');
  } else {
    const state = parameters.get('state');
    const callable = firebase.functions().httpsCallable('auth-discord-token');
    callable({
      state, code, redirect,
    }).then(({data}) => {
      if (data === 'OK') { // Linking Discord
        return window.close();
      } else if (data.token) { // Signing in
        return firebase.auth().signInWithCustomToken(data.token)
          .then(() => window.close());
      }
      return displayError('Unknown State');
    }).catch(displayError);
  }
}

export default process;

if (run) {
  process();
}
