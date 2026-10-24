const domains = [
  'feildmaster',
];

export default function isTrusted(origin = '') {
  const { hostname } = new URL(origin);
  if (hostname === 'localhost' || hostname === '') return true;
  const [_, domain] = hostname.split('.').reverse();
  return domains.includes(domain);
}
