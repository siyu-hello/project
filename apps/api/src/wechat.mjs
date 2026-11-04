import { DomainError } from './security.mjs';
export class WechatIdentity {
  constructor({ appId, secret, fetcher = fetch }) { this.appId = appId; this.secret = secret; this.fetcher = fetcher; }
  async exchange(code) {
    if (!this.appId || !this.secret) throw new DomainError(503, '微信登录尚未配置');
    const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.search = new URLSearchParams({ appid: this.appId, secret: this.secret, js_code: code, grant_type: 'authorization_code' });
    let response, body;
    try { response = await this.fetcher(url, { signal: AbortSignal.timeout(8000) }); body = await response.json(); }
    catch { throw new DomainError(502, '微信身份服务暂时不可用'); }
    if (!response.ok || body.errcode || typeof body.openid !== 'string' || !body.openid) throw new DomainError(401, '微信登录凭证无效，请重新登录');
    return body.openid; // session_key is deliberately neither persisted nor returned.
  }
}
