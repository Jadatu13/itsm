export async function portalFetch(path, opts = {}) {
  const token = sessionStorage.getItem('portal_preview_token') || localStorage.getItem('portal_token');
  return fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
}
