const regex = /(?:^|\.)feildmaster\.com$/;

export default function isTrusted(origin = '') {
  return origin.startsWith('http://localhost:') ||
    regex.test(origin);
}
