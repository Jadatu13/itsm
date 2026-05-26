/**
 * Thin fetch wrapper that automatically adds the Authorization header
 * and redirects to /login on 401.
 */
export function apiFetch(url, options = {}) {
  const token = localStorage.getItem('token');
  const headers = {
    ...(options.body && !(options.body instanceof FormData)
      ? { 'Content-Type': 'application/json' }
      : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  return fetch(url, { ...options, headers }).then(res => {
    if (res.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('agent');
      window.location.href = '/login';
    }
    return res;
  });
}
