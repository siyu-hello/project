import { createApp } from './app.mjs';
import { MysqlStore } from './store.mjs';
import { IdentityService } from './identity.mjs';
import { WechatIdentity } from './wechat.mjs';
const store = await MysqlStore.connect(process.env.DATABASE_URL);
const service = new IdentityService(store, new WechatIdentity({ appId: process.env.WECHAT_APP_ID, secret: process.env.WECHAT_APP_SECRET }), { initialPassword: process.env.INITIAL_ACCOUNT_PASSWORD });
const app = await createApp(service, { corsOrigin: process.env.ADMIN_ORIGIN });
await app.listen(Number(process.env.PORT || 3000), '0.0.0.0');
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { await app.close(); await store.close(); process.exit(0); });
