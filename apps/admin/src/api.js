export function createApi({ getToken, onUnauthorized, fetcher = fetch, base = '/api' }) {
  return async (path, method = 'GET', body) => {
    const token = getToken();
    const response = await fetcher(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json();
    if (response.status === 401) onUnauthorized();
    if (!response.ok) throw new Error(value.message + (value.details?.remainingSeconds ? `，剩余${value.details.remainingSeconds}秒` : value.details ? `：${JSON.stringify(value.details)}` : ''));
    return value;
  };
}
