import { createApp } from './app.mjs';
import { MysqlStore } from './store.mjs';
import { IdentityService } from './identity.mjs';
import { WechatIdentity } from './wechat.mjs';
import { ActivityService } from './activities.mjs';
import { RegistrationService } from './registrations.mjs';
import { AttendanceService } from './attendance.mjs';
import { LedgerService } from './ledger.mjs';
import { GiftService } from './gifts.mjs';
import { startScheduler } from './scheduling.mjs';

const store = await MysqlStore.connect(process.env.DATABASE_URL);
const identity = new IdentityService(store, new WechatIdentity({ appId: process.env.WECHAT_APP_ID, secret: process.env.WECHAT_APP_SECRET }), { initialPassword: process.env.INITIAL_ACCOUNT_PASSWORD });
const checkinSecret = process.env.CHECKIN_SECRET || 'dev-checkin-secret';
const app = await createApp({
  identity,
  activities: new ActivityService(store, { checkinSecret }),
  registrations: new RegistrationService(store),
  attendance: new AttendanceService(store, { checkinSecret }),
  ledger: new LedgerService(store),
  gifts: new GiftService(store)
}, { corsOrigin: process.env.ADMIN_ORIGIN });
const stopScheduler = startScheduler(store);
await app.listen(Number(process.env.PORT || 3000), '0.0.0.0');
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { stopScheduler(); await app.close(); await store.close(); process.exit(0); });