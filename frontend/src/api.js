// Thin fetch wrapper. Token lives in localStorage; base URL is /api in dev (proxied) or VITE_API_URL in production.
export const API = (import.meta.env.VITE_API_URL || '') + '/api';
export const getToken = () => localStorage.getItem('gf_token');

export async function api(path, { method = 'GET', body, form } = {}) {
  let res;
  try {
    res = await fetch(API + path, {
    method,
    headers: { ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: form || (body ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new Error('Cannot reach the server. Please check your internet connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && getToken()) {
      localStorage.removeItem('gf_token');
      localStorage.removeItem('gf_user');
      location.href = '/login';
    }
    const err = new Error(data.error || (res.status >= 500 ? 'Something went wrong on our side. Please try again in a moment.' : 'The request could not be completed.'));
    err.data = data;
    throw err;
  }
  return data;
}

/** URL for images/PDF (authenticated through ?token because <img>/<iframe> cannot send headers). */
export const fileUrl = (p) => `${API}${p}${p.includes('?') ? '&' : '?'}token=${getToken()}`;
