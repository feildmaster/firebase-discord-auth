const regex = /(?:^|\.)feildmaster\.com$/;

export default function isTrusted(origin = '') {
  if (origin.startsWith('http://localhost:')) return true;
  const url = new URL(origin);
  return regex.test(url.host);
}
