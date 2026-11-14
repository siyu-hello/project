export function createApi({ getToken, onUnauthorized, fetcher = fetch, base = '/api' }) {
  return async (path, method = 'GET', body) => {
    const token = getToken();
    const response = await fetcher(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json();
    if (response.status === 401) onUnauthorized();
    if (!response.ok) {
      const details = value.details || null;
      let suffix = '';
      if (details?.remainingSeconds) suffix = `，剩余${Math.ceil(details.remainingSeconds / 60)}分钟`;
      else if (details?.remainingDays !== undefined) suffix = `，剩余${details.remainingDays}天`;
      else if (details?.required !== undefined && details?.available !== undefined) suffix = `，需要${details.required}分，当前${details.available}分`;
      else if (details?.redeemedAt) suffix = `，首次核销时间 ${new Date(details.redeemedAt).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })}`;
      else if (details?.conflict) suffix = `，与「${details.conflict.title}」时间冲突`;
      else if (details) suffix = `：${JSON.stringify(details)}`;
      const error = new Error(value.message + suffix);
      error.status = response.status;
      error.details = details;
      throw error;
    }
    return value;
  };
}