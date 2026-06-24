/**
 * Thin fetch wrapper for the customer portal. Adds the portal Authorization
 * header, sets JSON content-type only for non-FormData bodies, and redirects to
 * the portal login on 401.
 */
export async function portalFetch(path, opts = {}) {
  const token = sessionStorage.getItem('portal_preview_token') || localStorage.getItem('portal_token');
  const isFormData = opts.body instanceof FormData;
  const res = await fetch(path, {
    ...opts,
    headers: {
      ...(opts.body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401 && !path.includes('/auth/')) {
    localStorage.removeItem('portal_token');
    localStorage.removeItem('portal_contact');
    window.location.href = '/portal/login';
  }
  return res;
}
