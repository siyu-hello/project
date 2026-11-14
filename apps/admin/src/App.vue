<script setup>
import { computed, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { createApi } from './api';
import qrcode from 'qrcode-generator';

const token = ref(sessionStorage.getItem('session') || '');
const account = ref(null);
const mustChange = ref(false);
const error = ref('');
const notice = ref('');
const busy = ref(false);
const tab = ref('');
const passwordOpen = ref(false);

const login = reactive({ identifier: '', password: '' });
const passwords = reactive({ oldPassword: '', newPassword: '', confirm: '' });

const queue = ref([]), mine = ref([]), gifts = ref([]), accounts = ref([]), audits = ref([]), targets = ref([]);
const detail = ref(null);
const detailOpen = computed({ get: () => Boolean(detail.value), set: v => { if (!v) detail.value = null; } });
const codeView = reactive({ open: false, activity: null, kind: 'checkin', codes: {}, qr: '', code: '', secondsLeft: 0, timer: null });
const redeem = reactive({ code: '', result: null });
const publish = reactive({ id: '', title: '', type: 'POINT', points: 2, description: '', college: '', grade: '', capacity: 10, startsAt: '', endsAt: '', location: '', checkinMode: 'QR', evidenceUrl: '' });
const giftForm = reactive({ name: '', description: '', imageUrl: '', points: 1, stock: 10, enabled: true });
const giftEdit = reactive({ open: false, id: '', name: '', description: '', imageUrl: '', points: 1, stock: 0, enabled: true, reason: '' });
const create = reactive({ identifier: '', name: '', role: 'PUBLISHER', reason: '' });
const change = reactive({ id: '', role: 'PUBLISHER', enabled: true, reason: '' });
const csv = ref('');
const importReason = ref('');
const giftCreateOpen = ref(false);
const auditFilter = ref('');
const activityFilter = ref('');
const visibleActivities = computed(() => mine.value.filter(row => !activityFilter.value || row.status === activityFilter.value));
const uploading = reactive({ evidence: false, gift: false, giftEdit: false });

const clear = () => { token.value = ''; account.value = null; mustChange.value = false; queue.value = []; mine.value = []; gifts.value = []; accounts.value = []; audits.value = []; sessionStorage.removeItem('session'); };
const api = createApi({ getToken: () => token.value, onUnauthorized: clear });
const role = computed(() => account.value?.role || '');
const roleText = computed(() => ({ ADMIN: '管理员', PUBLISHER: '发布者', REDEEMER: '核销员' }[role.value] || '—'));
const title = computed(() => ({ ADMIN: '管理控制台', PUBLISHER: '发布者工作台', REDEEMER: '文创核销台' }[role.value] || '校园活动平台'));
const subtitle = computed(() => ({ ADMIN: '审核活动、维护礼品、管理账号与追溯全部操作', PUBLISHER: '发布活动、跟踪审核状态、投屏动态二维码', REDEEMER: '输入或扫描兑换码，完成文创核销' }[role.value] || ''));
const navItems = computed(() => ({
  ADMIN: [
    { key: 'review', label: '活动审核', icon: '📝' },
    { key: 'gifts', label: '礼品管理', icon: '🎁' },
    { key: 'redeem', label: '核销', icon: '🎟️' },
    { key: 'accounts', label: '账号管理', icon: '👥' },
    { key: 'import', label: '名单导入', icon: '📥' },
    { key: 'audits', label: '操作审计', icon: '🕘' }
  ],
  PUBLISHER: [
    { key: 'publish', label: '发布活动', icon: '✍️' },
    { key: 'mine', label: '我的活动', icon: '📚' }
  ],
  REDEEMER: [{ key: 'redeem', label: '核销', icon: '🎟️' }]
}[role.value] || []));

const stats = computed(() => {
  if (role.value === 'ADMIN') return [
    { label: '待审核活动', value: queue.value.length, icon: '📝' },
    { label: '在库礼品', value: gifts.value.length, icon: '🎁' },
    { label: '学生账号', value: accounts.value.filter(a => a.role === 'STUDENT').length, icon: '🎓' },
    { label: '发布者 / 核销员', value: accounts.value.filter(a => ['PUBLISHER', 'REDEEMER'].includes(a.role)).length, icon: '🧑‍💼' }
  ];
  if (role.value === 'PUBLISHER') return [
    { label: '活动总数', value: mine.value.length, icon: '📚' },
    { label: '已发布', value: mine.value.filter(a => a.status === 'PUBLISHED').length, icon: '✅' },
    { label: '待审核', value: mine.value.filter(a => a.status === 'PENDING' && a.reviewStatus !== 'REJECTED').length, icon: '⏳' },
    { label: '累计报名', value: mine.value.reduce((sum, a) => sum + (a.enrolled || 0), 0), icon: '🙋' }
  ];
  return [];
});

const fmt = v => v ? new Date(v).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' }) : '—';
const iso = v => v ? new Date(v).toISOString() : null;
const localInput = v => { const d = new Date(v), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
const typeText = a => a.type === 'MINUTE' ? '志愿时长' : `积分 ${a.points} 分`;
const statusText = a => ({ PENDING: a.reviewStatus === 'REJECTED' ? '已驳回待修改' : '待审核', PUBLISHED: '已发布', CANCELLED: '已取消' }[a.status] || a.status);
const tagType = a => a.status === 'PUBLISHED' ? 'success' : a.status === 'CANCELLED' ? 'info' : a.reviewStatus === 'REJECTED' ? 'danger' : 'warning';
const isImage = url => typeof url === 'string' && (url.startsWith('/uploads/') || /^https?:\/\//i.test(url));
const codeOf = v => v === 'MINUTE' ? 'M' : 'P';

const ACTION_LABELS = {
  ACCOUNT_CREATE: '创建账号', ACCOUNT_UPDATE: '修改账号', PASSWORD_CHANGE: '修改密码', PASSWORD_RESET: '重置密码', WECHAT_BIND: '绑定微信',
  ACTIVITY_CREATE: '发布活动', ACTIVITY_UPDATE: '修改活动', ACTIVITY_REVIEW: '审核活动', ACTIVITY_CANCEL: '取消活动',
  REGISTER: '学生报名', REGISTER_CANCEL: '取消报名', CHECKIN: '签到', CHECKOUT: '签退', NO_SHOW: '缺席结算',
  GIFT_CREATE: '新增礼品', GIFT_UPDATE: '修改礼品', GIFT_REDEEM: '兑换礼品', ORDER_REDEEM: '核销兑换码'
};
const ACTION_TAG = { ACCOUNT_CREATE: 'success', ACCOUNT_UPDATE: 'info', PASSWORD_CHANGE: 'warning', PASSWORD_RESET: 'warning', WECHAT_BIND: 'info', ACTIVITY_CREATE: 'primary', ACTIVITY_UPDATE: 'info', ACTIVITY_REVIEW: 'success', ACTIVITY_CANCEL: 'danger', REGISTER: 'success', REGISTER_CANCEL: 'info', CHECKIN: 'success', CHECKOUT: 'success', NO_SHOW: 'danger', GIFT_CREATE: 'success', GIFT_UPDATE: 'info', GIFT_REDEEM: 'primary', ORDER_REDEEM: 'success' };
const KEY_LABELS = { id: '编号', activityId: '活动', registrationId: '报名记录', orderId: '订单', title: '标题', type: '类型', points: '积分', status: '状态', decision: '审核结论', mustChangePassword: '需改密', giftId: '礼品', code: '兑换码', minutes: '分钟', reason: '原因', name: '名称', stock: '库存', enabled: '上架', college: '学院', grade: '年级', capacity: '名额', requestId: '请求号', bound: '已绑定' };
const auditLabel = action => ACTION_LABELS[action] || action;
const auditTag = action => ACTION_TAG[action] ?? 'info';
const auditGroup = action => action.startsWith('ACTIVITY') ? 'ACTIVITY' : ['REGISTER', 'REGISTER_CANCEL', 'CHECKIN', 'CHECKOUT', 'NO_SHOW'].includes(action) ? 'SIGNUP' : action.startsWith('GIFT') || action.startsWith('ORDER') ? 'GIFT' : 'ACCOUNT';
const auditRows = computed(() => auditFilter.value ? audits.value.filter(a => auditGroup(a.action) === auditFilter.value) : audits.value);
const auditFilters = [{ value: '', label: '全部' }, { value: 'ACTIVITY', label: '活动' }, { value: 'SIGNUP', label: '报名签到' }, { value: 'GIFT', label: '礼品核销' }, { value: 'ACCOUNT', label: '账号安全' }];
function prettyEntries(value) {
  if (!value) return [];
  let obj = value;
  try { if (typeof value === 'string') obj = JSON.parse(value); } catch { return [{ label: '内容', value: String(value) }]; }
  if (!obj || typeof obj !== 'object') return [{ label: '内容', value: String(obj) }];
  return Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => ({
    label: KEY_LABELS[k] || k,
    value: Array.isArray(v) ? v.join('、') : typeof v === 'object' ? JSON.stringify(v) : String(v)
  }));
}

function makeQr(text) {
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createDataURL(6, 3);
  } catch { return ''; }
}

async function run(fn) { error.value = ''; notice.value = ''; busy.value = true; try { await fn(); } catch (e) { error.value = e.message; } finally { busy.value = false; } }
function accept(result) {
  token.value = result.token; account.value = result.account; mustChange.value = Boolean(result.account.mustChangePassword);
  sessionStorage.setItem('session', result.token); tab.value = '';
}

async function doLogin() {
  await run(async () => {
    let result;
    try { result = await api('/auth/student/login', 'POST', login); }
    catch (e) { if (e.status === 401 || e.status === 403) result = await api('/auth/admin/login', 'POST', login); else throw e; }
    accept(result); login.password = '';
    if (!result.account.mustChangePassword) { await refresh(); pickTab(); }
  });
}
async function doPassword() {
  await run(async () => {
    if (passwords.newPassword !== passwords.confirm) throw new Error('两次输入的新密码不一致');
    const result = await api('/auth/password', 'POST', { oldPassword: passwords.oldPassword, newPassword: passwords.newPassword });
    accept(result); passwords.oldPassword = ''; passwords.newPassword = ''; passwords.confirm = '';
    await refresh(); pickTab(); notice.value = '密码已修改，旧会话已失效';
  });
}
async function changePassword() {
  await run(async () => {
    if (passwords.newPassword !== passwords.confirm) throw new Error('两次输入的新密码不一致');
    const result = await api('/auth/password', 'POST', { oldPassword: passwords.oldPassword, newPassword: passwords.newPassword });
    accept(result); passwordOpen.value = false;
    passwords.oldPassword = ''; passwords.newPassword = ''; passwords.confirm = '';
    await refresh(); pickTab(); ElMessage.success('密码已修改');
  });
}
async function refresh() {
  if (role.value === 'ADMIN') {
    queue.value = await api('/admin/activities');
    gifts.value = await api('/admin/gifts');
    accounts.value = await api('/admin/accounts');
    audits.value = await api('/admin/audits');
    targets.value = await api('/activities/targets');
  } else if (role.value === 'PUBLISHER') {
    mine.value = await api('/activities/mine');
    targets.value = await api('/activities/targets');
  }
}
function pickTab() { if (!navItems.value.some(item => item.key === tab.value)) tab.value = navItems.value[0]?.key || ''; }
async function switchTab(key) { tab.value = key; await run(refresh); }

async function logout() { try { await api('/auth/logout', 'POST'); } catch { /* ignore */ } clear(); }

// ---------- 发布者 ----------
function resetPublish() { Object.assign(publish, { id: '', title: '', type: 'POINT', points: 2, description: '', college: '', grade: '', capacity: 10, startsAt: '', endsAt: '', location: '', checkinMode: 'QR', evidenceUrl: '' }); }
async function submitActivity() {
  await run(async () => {
    if (!publish.evidenceUrl || uploading.evidence) throw new Error('请先上传活动凭证图片');
    const body = { title: publish.title, type: publish.type, college: publish.college, grade: publish.grade, capacity: Number(publish.capacity), startsAt: iso(publish.startsAt), endsAt: iso(publish.endsAt), location: publish.location, checkinMode: publish.type === 'MINUTE' ? 'BOTH' : publish.checkinMode, evidenceUrl: publish.evidenceUrl, description: publish.description };
    if (publish.type === 'POINT') body.points = Number(publish.points);
    if (publish.id) { await api('/activities/' + encodeURIComponent(publish.id), 'PATCH', body); notice.value = '已修改并重新提交审核'; }
    else { await api('/activities', 'POST', body); notice.value = '活动已提交，等待管理员审核'; }
    resetPublish(); await refresh();
  });
}
function editActivity(row) {
  if (row.status !== 'PENDING') { ElMessage.warning('仅待审核/已驳回的活动可修改'); return; }
  Object.assign(publish, { id: row.id, title: row.title, type: row.type, points: row.points ?? 2, description: row.description || '', college: row.college, grade: row.grade, capacity: row.capacity, startsAt: localInput(row.startsAt), endsAt: localInput(row.endsAt), location: row.location, checkinMode: row.checkinMode, evidenceUrl: /^\/uploads\//.test(row.evidenceUrl) ? row.evidenceUrl : '' });
  tab.value = 'publish';
}
async function cancelActivity(row) {
  try {
    const { value } = await ElMessageBox.prompt('活动取消后学生不可报名，已报名记录保留。请填写取消原因：', '取消活动', { inputValidator: v => Boolean(v && v.trim()) || '必须填写原因' });
    await run(async () => { await api('/activities/' + encodeURIComponent(row.id) + '/cancel', 'POST', { reason: value.trim() }); notice.value = '活动已取消'; await refresh(); activityFilter.value = 'CANCELLED'; });
  } catch (e) { if (e !== 'cancel' && e !== 'close') ElMessage.error(e.message || '操作已取消'); }
}

// ---------- 二维码 ----------
async function fetchCode(kind) {
  const activity = codeView.activity;
  if (!activity) return;
  try { codeView.codes[kind] = await api(`/activities/${activity.id}/${kind}-code`); return codeView.codes[kind]; }
  catch (e) { if (kind === 'checkout') codeView.codes[kind] = null; else throw e; }
}
function paintCode() {
  const current = codeView.codes[codeView.kind];
  if (!current) { codeView.code = ''; codeView.qr = ''; return; }
  if (current.code !== codeView.code || !codeView.qr) {
    codeView.code = current.code;
    codeView.qr = makeQr(`CAMPUS|${codeView.kind.toUpperCase()}|${codeView.activity.id}|${current.code}`);
  }
  codeView.secondsLeft = Math.max(0, Math.ceil((new Date(current.periodEndsAt).getTime() - Date.now()) / 1000));
}
async function openCode(row, kind = 'checkin') {
  codeView.open = true; codeView.activity = row; codeView.kind = kind; codeView.codes = {}; codeView.qr = ''; codeView.code = '';
  await fetchCode(kind); paintCode();
  if (codeView.timer) clearInterval(codeView.timer);
  codeView.timer = setInterval(async () => {
    if (!codeView.open) return;
    try { await fetchCode(codeView.kind); paintCode(); } catch { /* 静默重试 */ }
  }, 1000);
}
function switchCodeKind(kind) {
  codeView.kind = kind;
  codeView.qr = '';
  codeView.code = '';
  if (codeView.codes[kind]) paintCode();
  else run(async () => { await fetchCode(kind); paintCode(); });
}
function closeCode() { codeView.open = false; if (codeView.timer) { clearInterval(codeView.timer); codeView.timer = null; } }

// ---------- 管理员 ----------
async function review(row, approved) {
  try {
    let reason = '';
    if (!approved) {
      const r = await ElMessageBox.prompt('驳回必须填写原因，发布者修改后可重新提交：', '驳回活动', { inputValidator: v => Boolean(v && v.trim()) || '必须填写驳回原因' });
      reason = r.value.trim();
    }
    await run(async () => { await api('/admin/activities/' + encodeURIComponent(row.id) + '/review', 'POST', approved ? { decision: 'APPROVED' } : { decision: 'REJECTED', reason }); notice.value = approved ? '已通过并发布，学生端刷新即可看到' : '已驳回'; await refresh(); });
  } catch (e) { if (e !== 'cancel' && e !== 'close') ElMessage.error(e.message || '操作已取消'); }
}
async function saveGift() {
  await run(async () => {
    await api('/admin/gifts', 'POST', { ...giftForm, points: Number(giftForm.points), stock: Number(giftForm.stock) });
    notice.value = '礼品已创建'; Object.assign(giftForm, { name: '', description: '', imageUrl: '', points: 1, stock: 10, enabled: true });
    giftCreateOpen.value = false; await refresh();
  });
}
function openGift(row) { Object.assign(giftEdit, { open: true, id: row.id, name: row.name, description: row.description || '', imageUrl: row.imageUrl || '', points: row.points, stock: row.stock, enabled: Boolean(row.enabled), reason: '' }); }
async function saveGiftEdit() {
  await run(async () => {
    if (!giftEdit.reason.trim()) throw new Error('必须填写变更原因');
    await api('/admin/gifts/' + encodeURIComponent(giftEdit.id), 'PATCH', { name: giftEdit.name, description: giftEdit.description, imageUrl: giftEdit.imageUrl, points: Number(giftEdit.points), stock: Number(giftEdit.stock), enabled: giftEdit.enabled, reason: giftEdit.reason });
    giftEdit.open = false; notice.value = '礼品已更新并记录审计'; await refresh();
  });
}
async function toggleGift(row) {
  try {
    const { value } = await ElMessageBox.prompt(`确认${row.enabled ? '下架' : '上架'}「${row.name}」？请填写原因：`, '调整上下架', { inputValidator: v => Boolean(v && v.trim()) || '必须填写原因' });
    await run(async () => { await api('/admin/gifts/' + encodeURIComponent(row.id), 'PATCH', { enabled: !row.enabled, reason: value.trim() }); await refresh(); });
  } catch (e) { if (e !== 'cancel' && e !== 'close') ElMessage.error(e.message || '操作已取消'); }
}
async function doRedeem() {
  await run(async () => { redeem.result = await api('/redeemer/redeem', 'POST', { code: redeem.code.trim().toUpperCase() }); redeem.code = ''; });
}

// ---------- 账号与名单 ----------
async function readFile(event) { const file = event.target.files[0]; if (file) { if (file.size > 65536) { error.value = 'CSV不能超过64KB'; return; } csv.value = await file.text(); } }
async function doImport() { await run(async () => { const r = await api('/admin/roster/import', 'POST', { csv: csv.value, reason: importReason.value }); notice.value = `导入成功：新增 ${r.created} 个，已存在 ${r.existing} 个`; await refresh(); }); }
async function doCreate() { await run(async () => { await api('/admin/accounts', 'POST', create); notice.value = '账号已创建，请通过安全渠道告知初始密码'; await refresh(); }); }
function selectAccount(row) { Object.assign(change, { id: row.id, role: row.role, enabled: Boolean(row.enabled), reason: '' }); }
async function doChange() { await run(async () => { const { id, ...body } = change; await api('/admin/accounts/' + encodeURIComponent(id), 'PATCH', body); notice.value = '账号已更新'; await refresh(); }); }

// ---------- 图片上传 ----------
async function uploadImage(file, kind) {
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) { ElMessage.error('仅支持 PNG / JPEG / WebP / GIF 图片'); return; }
  if (file.size > 4 * 1024 * 1024) { ElMessage.error('图片不能超过 4MB'); return; }
  uploading[kind] = true;
  try {
    const response = await fetch('/api/uploads', { method: 'POST', headers: { 'Content-Type': file.type, Authorization: `Bearer ${token.value}` }, body: file });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.message || '图片上传失败');
    if (kind === 'evidence') publish.evidenceUrl = data.url;
    if (kind === 'gift') giftForm.imageUrl = data.url;
    if (kind === 'giftEdit') giftEdit.imageUrl = data.url;
    ElMessage.success('图片已上传');
  } catch (e) { ElMessage.error(e.message || '图片上传失败'); }
  finally { uploading[kind] = false; }
}
function pickImage(kind) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp,image/gif';
  input.onchange = () => { const file = input.files?.[0]; if (file) uploadImage(file, kind); };
  input.click();
}

if (token.value) run(async () => {
  try { account.value = await api('/me'); }
  catch { clear(); return; }
  mustChange.value = Boolean(account.value.mustChangePassword);
  if (!mustChange.value) { await refresh(); pickTab(); }
});
</script>

<template>
  <div class="app">
    <!-- 登录 -->
    <div v-if="!token" class="auth">
      <div class="auth-glow a"></div>
      <div class="auth-wrap">
        <section class="auth-form">
          <div class="login-brand">校园活动 · 积分管理平台</div>
          <h1>登录工作台</h1>
          <p class="muted">管理员、发布者、核销员统一入口</p>
          <el-input v-model="login.identifier" size="large" placeholder="请输入账号" aria-label="账号" autocomplete="username" @keyup.enter="doLogin" />
          <el-input v-model="login.password" size="large" type="password" show-password placeholder="密码" aria-label="密码" autocomplete="current-password" @keyup.enter="doLogin" />
          <el-button type="primary" size="large" class="full" :loading="busy" @click="doLogin">登 录</el-button>
          <p v-if="error" class="error">{{ error }}</p>
          <p v-if="notice" class="ok">{{ notice }}</p>
          <p class="hint">发布者请在网页端发布活动；学生请使用微信小程序参与。</p>
        </section>
      </div>
    </div>

    <!-- 首次改密 -->
    <div v-else-if="mustChange" class="auth">
      <div class="auth-glow a"></div>
      <div class="auth-wrap">
        <section class="auth-form wide">
          <h2>首次登录 · 设置新密码</h2>
          <p class="muted">为保障账号安全，需要先修改初始密码才能进入工作台。</p>
          <el-input v-model="passwords.oldPassword" size="large" type="password" show-password placeholder="原密码" />
          <el-input v-model="passwords.newPassword" size="large" type="password" show-password placeholder="新密码（至少 10 个字符）" />
          <el-input v-model="passwords.confirm" size="large" type="password" show-password placeholder="再次输入新密码" />
          <el-button type="primary" size="large" class="full" :loading="busy" @click="doPassword">修改并进入</el-button>
          <p v-if="error" class="error">{{ error }}</p>
        </section>
      </div>
    </div>

    <!-- 主界面 -->
    <div v-else class="shell">
      <aside class="side">
        <div class="brand">
          <div class="brand-mark sm">校</div>
          <div><strong>校园活动</strong><span>管理中枢</span></div>
        </div>
        <nav class="nav">
          <button v-for="item in navItems" :key="item.key" class="nav-item" :class="{ active: tab === item.key }" @click="switchTab(item.key)">
            <span class="nav-ico">{{ item.icon }}</span><span>{{ item.label }}</span>
          </button>
        </nav>
        <div class="side-foot">
          <div class="me">
            <div class="avatar">{{ (account?.name || '?').slice(0, 1) }}</div>
            <div class="me-text"><strong>{{ account?.name }}</strong><span>{{ roleText }} · {{ account?.identifier }}</span></div>
          </div>
          <div class="foot-actions">
            <button class="ghost-btn" @click="passwordOpen = true">修改密码</button>
            <button class="ghost-btn" @click="logout">退出登录</button>
          </div>
        </div>
      </aside>

      <main class="main">
        <header class="topbar">
          <div><h1>{{ title }}</h1><p>{{ subtitle }}</p></div>
          <div class="top-actions">
            <span class="role-pill">{{ roleText }}</span>
            <el-button :loading="busy" @click="run(refresh)">刷新数据</el-button>
          </div>
        </header>

        <p v-if="error" class="banner error">{{ error }}</p>
        <p v-if="notice" class="banner ok">{{ notice }}</p>

        <section v-if="stats.length" class="stats">
          <div v-for="s in stats" :key="s.label" class="stat">
            <span class="stat-ico">{{ s.icon }}</span>
            <div><b>{{ s.value }}</b><span>{{ s.label }}</span></div>
          </div>
        </section>

        <!-- 管理员：活动审核 -->
        <section v-if="tab === 'review'" class="panel">
          <div class="panel-head"><div><h2>待审核活动</h2><p>通过后立即出现在符合学院与年级的学生活动列表中</p></div><span class="muted">共 {{ queue.length }} 条</span></div>
          <el-empty v-if="!queue.length" description="暂无待审核活动，发布者提交后会出现在这里" />
          <div class="act-grid">
            <article v-for="row in queue" :key="row.id" class="act-card">
              <div class="act-cover">
                <el-image v-if="isImage(row.evidenceUrl)" :src="row.evidenceUrl" :preview-src-list="[row.evidenceUrl]" fit="cover" class="cover-img" />
                <div v-else class="cover-ph"><span>📄</span><small>演示 / 文档凭证</small></div>
                <span class="type-badge" :class="row.type === 'MINUTE' ? 'green' : 'blue'">{{ typeText(row) }}</span>
              </div>
              <div class="act-body">
                <div class="between"><h3>{{ row.title }}</h3><el-tag :type="tagType(row)" size="small">{{ statusText(row) }}</el-tag></div>
                <p class="meta">发布者 {{ row.publisherName }} · {{ row.college }} {{ row.grade }} 级</p>
                <p class="meta">{{ fmt(row.startsAt) }} — {{ fmt(row.endsAt) }}</p>
                <p class="meta">名额 {{ row.capacity }} · {{ row.location }} · {{ row.checkinMode === 'BOTH' ? '签到 + 签退' : '仅签到' }}</p>
                <p class="desc">{{ row.description || '（志愿时长活动无分值说明）' }}</p>
                <div class="actions">
                  <el-button type="success" @click="review(row, true)">通过并发布</el-button>
                  <el-button type="danger" plain @click="review(row, false)">驳回</el-button>
                  <el-button @click="detail = row">查看详情</el-button>
                </div>
              </div>
            </article>
          </div>
        </section>

        <!-- 管理员：礼品 -->
        <section v-if="tab === 'gifts'" class="panel">
          <div class="panel-head"><div><h2>文创礼品</h2><p>礼品图片会展示在小程序商城，缺图时使用占位图</p></div><el-button type="primary" @click="giftCreateOpen = !giftCreateOpen">{{ giftCreateOpen ? '收起表单' : '新增礼品' }}</el-button></div>
          <el-card v-if="giftCreateOpen" shadow="never" class="form-card">
            <div class="gift-form">
              <div class="gift-form-media" @click="pickImage('gift')">
                <img v-if="giftForm.imageUrl" :src="giftForm.imageUrl" alt="" />
                <div v-else class="upload-ph"><span>{{ uploading.gift ? '上传中…' : '＋' }}</span><small>上传礼品图片</small></div>
              </div>
              <div class="gift-form-fields">
                <el-form label-position="top" @submit.prevent="saveGift">
                  <div class="two">
                    <el-form-item label="礼品名称"><el-input v-model="giftForm.name" maxlength="100" /></el-form-item>
                    <el-form-item label="所需积分"><el-input-number v-model="giftForm.points" :min="1" :max="9999" /></el-form-item>
                    <el-form-item label="库存"><el-input-number v-model="giftForm.stock" :min="0" :max="9999" /></el-form-item>
                    <el-form-item label="立即上架"><el-switch v-model="giftForm.enabled" /></el-form-item>
                  </div>
                  <el-form-item label="礼品说明"><el-input v-model="giftForm.description" type="textarea" :rows="2" maxlength="500" /></el-form-item>
                  <el-button type="primary" native-type="submit" :loading="busy">创建礼品</el-button>
                </el-form>
              </div>
            </div>
          </el-card>
          <div class="gift-grid">
            <article v-for="row in gifts" :key="row.id" class="gift-card">
              <div class="gift-media">
                <img v-if="row.imageUrl" :src="row.imageUrl" alt="" />
                <div v-else class="gift-ph">🎁</div>
                <span class="stock-badge" :class="row.stock > 0 ? 'green' : 'gray'">{{ row.stock > 0 ? '库存 ' + row.stock : '已兑完' }}</span>
              </div>
              <div class="gift-body">
                <div class="between"><h3>{{ row.name }}</h3><el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{ row.enabled ? '已上架' : '已下架' }}</el-tag></div>
                <p class="meta">{{ row.description || '暂无说明' }}</p>
                <div class="between">
                  <span class="points">{{ row.points }} 积分</span>
                  <div class="mini-actions"><el-button size="small" @click="openGift(row)">编辑</el-button><el-button size="small" :type="row.enabled ? 'warning' : 'success'" plain @click="toggleGift(row)">{{ row.enabled ? '下架' : '上架' }}</el-button></div>
                </div>
              </div>
            </article>
          </div>
        </section>

        <!-- 管理员 / 核销员：核销 -->
        <section v-if="tab === 'redeem'" class="panel">
          <div class="redeem-wrap">
            <div class="redeem-card">
              <div class="ticket-mark">🎟️</div>
              <h2>兑换码核销</h2>
              <p class="muted">输入学生出示的 12 位兑换码，不区分大小写；同一码只能核销一次。</p>
              <el-input v-model="redeem.code" size="large" maxlength="12" placeholder="例如 A1B2C3D4E5F6" class="code-input" @keyup.enter="doRedeem" />
              <el-button type="primary" size="large" class="full" :loading="busy" :disabled="redeem.code.trim().length !== 12" @click="doRedeem">核销</el-button>
              <div v-if="redeem.result" class="redeem-ok">
                <strong>核销成功</strong>
                <p>{{ redeem.result.giftName }} · {{ redeem.result.code }}</p>
                <p class="muted">{{ fmt(redeem.result.redeemedAt) }}</p>
              </div>
            </div>
          </div>
        </section>

        <!-- 管理员：账号 -->
        <section v-if="tab === 'accounts'" class="panel">
          <div class="panel-head"><div><h2>账号管理</h2><p>点击表格行可载入下方修改表单；管理员账号不可在此回收</p></div></div>
          <div class="table-card">
            <el-table :data="accounts" @row-click="selectAccount" class="nice-table">
              <el-table-column prop="identifier" label="账号 / 学号" width="150" />
              <el-table-column prop="name" label="姓名" width="120" />
              <el-table-column label="角色" width="110"><template #default="{ row }"><el-tag size="small" :type="row.role === 'ADMIN' ? 'danger' : row.role === 'STUDENT' ? '' : 'success'">{{ row.role }}</el-tag></template></el-table-column>
              <el-table-column label="状态" width="90"><template #default="{ row }"><span :class="row.enabled ? 'dot on' : 'dot off'"></span>{{ row.enabled ? '启用' : '停用' }}</template></el-table-column>
              <el-table-column prop="noShowCount" label="旷次数" width="90" />
              <el-table-column label="禁报至" width="190"><template #default="{ row }">{{ row.bannedUntil ? fmt(row.bannedUntil) : '—' }}</template></el-table-column>
            </el-table>
          </div>
          <div class="two-panels">
            <el-card shadow="never" class="form-card"><h3>开通独立角色账号</h3>
              <el-form label-position="top" @submit.prevent="doCreate">
                <el-form-item label="账号"><el-input v-model="create.identifier" /></el-form-item>
                <el-form-item label="姓名"><el-input v-model="create.name" /></el-form-item>
                <el-form-item label="角色"><el-select v-model="create.role"><el-option label="发布者" value="PUBLISHER" /><el-option label="核销员" value="REDEEMER" /></el-select></el-form-item>
                <el-form-item label="原因"><el-input v-model="create.reason" /></el-form-item>
                <el-button native-type="submit" type="primary" :loading="busy">创建账号</el-button>
              </el-form>
            </el-card>
            <el-card shadow="never" class="form-card"><h3>修改所选账号</h3>
              <p class="muted">尚未选择账号时表单不可编辑。</p>
              <el-form label-position="top" @submit.prevent="doChange">
                <el-form-item label="账号 ID"><el-input v-model="change.id" readonly /></el-form-item>
                <el-form-item label="角色"><el-select v-model="change.role"><el-option v-for="r in ['PUBLISHER', 'REDEEMER', 'REVOKED']" :key="r" :value="r" :label="r" /></el-select></el-form-item>
                <el-form-item label="启用"><el-switch v-model="change.enabled" /></el-form-item>
                <el-form-item label="变更原因"><el-input v-model="change.reason" /></el-form-item>
                <el-button native-type="submit" type="primary" :loading="busy" :disabled="!change.id">保存</el-button>
              </el-form>
            </el-card>
          </div>
        </section>

        <!-- 管理员：导入 -->
        <section v-if="tab === 'import'" class="panel">
          <div class="panel-head"><div><h2>学生名单导入</h2><p>UTF-8 CSV，表头：学号,姓名,学院,年级；最多 20 行，缺列或文件内重复将整批拒绝</p></div></div>
          <el-card shadow="never" class="form-card">
            <label class="dropzone">
              <input type="file" accept=".csv,text/csv" @change="readFile" />
              <span class="drop-ico">📥</span>
              <strong>点击选择 CSV 文件</strong>
              <small>文件不超过 64KB · 导入后学生初始密码由管理员另行告知</small>
            </label>
            <el-form label-position="top" @submit.prevent="doImport">
              <el-form-item label="导入原因（写入审计）"><el-input v-model="importReason" /></el-form-item>
              <el-form-item label="文件预览"><el-input v-model="csv" type="textarea" :rows="8" /></el-form-item>
              <el-button type="primary" native-type="submit" :loading="busy" :disabled="!csv.trim()">整批导入</el-button>
            </el-form>
          </el-card>
        </section>

        <!-- 管理员：审计 -->
        <section v-if="tab === 'audits'" class="panel">
          <div class="panel-head"><div><h2>操作审计</h2><p>所有关键操作留痕，展开行可查看变更前后内容</p></div><span class="muted">共 {{ auditRows.length }} 条</span></div>
          <div class="chip-row">
            <button v-for="f in auditFilters" :key="f.value" class="chip" :class="{ on: auditFilter === f.value }" @click="auditFilter = f.value">{{ f.label }}</button>
          </div>
          <div class="table-card">
            <el-table :data="auditRows" class="nice-table">
              <el-table-column type="expand">
                <template #default="{ row }">
                  <div class="audit-detail">
                    <div class="kv"><span>变更前</span><div><template v-if="prettyEntries(row.beforeValue).length"><i v-for="(item, i) in prettyEntries(row.beforeValue)" :key="i">{{ item.label }}：{{ item.value }}</i></template><em v-else>—</em></div></div>
                    <div class="kv"><span>变更后</span><div><template v-if="prettyEntries(row.afterValue).length"><i v-for="(item, i) in prettyEntries(row.afterValue)" :key="i">{{ item.label }}：{{ item.value }}</i></template><em v-else>—</em></div></div>
                    <p class="muted">操作人 {{ row.actorName }}（{{ row.actorIdentifier || row.actorId }}） → 目标 {{ row.targetName }}（{{ row.targetIdentifier || row.targetId }}）</p>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="时间" width="180"><template #default="{ row }">{{ fmt(row.occurredAt) }}</template></el-table-column>
              <el-table-column label="操作人" width="150"><template #default="{ row }"><div class="cell-user"><strong>{{ row.actorName }}</strong><span>{{ row.actorIdentifier }}</span></div></template></el-table-column>
              <el-table-column label="操作" width="120"><template #default="{ row }"><el-tag size="small" :type="auditTag(row.action)">{{ auditLabel(row.action) }}</el-tag></template></el-table-column>
              <el-table-column prop="reason" label="原因" min-width="180" />
              <el-table-column label="目标" width="150"><template #default="{ row }"><div class="cell-user"><strong>{{ row.targetName }}</strong><span>{{ row.targetIdentifier }}</span></div></template></el-table-column>
            </el-table>
          </div>
        </section>

        <!-- 发布者：发布活动 -->
        <section v-if="tab === 'publish'" class="panel">
          <div class="panel-head"><div><h2>{{ publish.id ? '修改活动并重新提交' : '新建活动' }}</h2><p>提交后进入待审核；类型与分值创建后不可修改，志愿时长活动固定签到 + 签退</p></div></div>
          <el-card shadow="never" class="form-card">
            <el-form label-position="top" @submit.prevent="submitActivity">
              <div class="form-grid">
                <div class="form-col">
                  <el-form-item label="活动标题"><el-input v-model="publish.title" maxlength="200" placeholder="例如 校园清洁志愿行动" /></el-form-item>
                  <el-form-item label="活动类型">
                    <el-select v-model="publish.type" :disabled="Boolean(publish.id)">
                      <el-option label="积分活动" value="POINT" /><el-option label="志愿时长" value="MINUTE" />
                    </el-select>
                  </el-form-item>
                  <el-form-item v-if="publish.type === 'POINT'" label="积分分值（1–5）"><el-input-number v-model="publish.points" :min="1" :max="5" :disabled="Boolean(publish.id)" /></el-form-item>
                  <el-form-item label="面向学院">
                    <el-select v-model="publish.college" filterable allow-create placeholder="选择或输入学院">
                      <el-option v-for="t in targets" :key="'c' + t.college + t.grade" :label="t.college + ' · ' + t.grade + ' 级（' + t.students + ' 人）'" :value="t.college" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="面向年级">
                    <el-select v-model="publish.grade" filterable allow-create placeholder="选择或输入年级">
                      <el-option v-for="t in targets" :key="'g' + t.college + t.grade" :label="t.grade + ' 级 · ' + t.college" :value="t.grade" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="人数上限（1–20）"><el-input-number v-model="publish.capacity" :min="1" :max="20" /></el-form-item>
                  <p class="tip">提示：学院与年级需和学生名单完全一致，否则该学生看不到此活动。优先从候选中选择。</p>
                </div>
                <div class="form-col">
                  <div class="two">
                    <el-form-item label="开始时间"><el-date-picker v-model="publish.startsAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" placeholder="选择开始时间" /></el-form-item>
                    <el-form-item label="结束时间"><el-date-picker v-model="publish.endsAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" placeholder="选择结束时间" /></el-form-item>
                  </div>
                  <el-form-item label="活动地点"><el-input v-model="publish.location" placeholder="例如 主楼南门集合" /></el-form-item>
                  <el-form-item label="签到方式">
                    <el-select :model-value="publish.type === 'MINUTE' ? 'BOTH' : publish.checkinMode" :disabled="publish.type === 'MINUTE'" @update:model-value="publish.checkinMode = $event">
                      <el-option label="仅签到（二维码）" value="QR" /><el-option label="签到 + 签退（二维码）" value="BOTH" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="组织与盖章凭证（上传图片）">
                    <div class="upload-box" :class="{ empty: !publish.evidenceUrl }" @click="pickImage('evidence')">
                      <img v-if="isImage(publish.evidenceUrl)" :src="publish.evidenceUrl" alt="" />
                      <div v-else class="upload-ph"><span>{{ uploading.evidence ? '上传中…' : '＋' }}</span><small>{{ uploading.evidence ? '正在上传' : '点击上传活动凭证图片' }}</small></div>
                    </div>
                    <small class="muted">支持 PNG / JPEG / WebP / GIF，不超过 4MB；审核通过后作为活动凭证留存。</small>
                  </el-form-item>
                  <el-form-item v-if="publish.type === 'POINT'" label="分值说明（5 分活动至少 20 字）"><el-input v-model="publish.description" type="textarea" :rows="4" maxlength="2000" show-word-limit /></el-form-item>
                </div>
              </div>
              <div class="actions">
                <el-button type="primary" native-type="submit" :loading="busy">{{ publish.id ? '保存并重新提交' : '提交审核' }}</el-button>
                <el-button v-if="publish.id" @click="resetPublish">取消编辑</el-button>
              </div>
            </el-form>
          </el-card>
        </section>

        <!-- 发布者：我的活动 -->
        <section v-if="tab === 'mine'" class="panel">
          <div class="panel-head"><div><h2>我的活动</h2><p>已发布活动可投屏动态二维码，供学生现场扫码签到 / 签退</p></div><el-button @click="tab = 'publish'">发布新活动</el-button></div>
          <div class="chip-row">
            <button v-for="filter in [{ value: '', label: '全部' }, { value: 'PENDING', label: '待审核' }, { value: 'PUBLISHED', label: '已发布' }, { value: 'CANCELLED', label: '已取消' }]"
              :key="filter.value" class="chip" :class="{ on: activityFilter === filter.value }" @click="activityFilter = filter.value">{{ filter.label }}</button>
          </div>
          <el-empty v-if="!visibleActivities.length" description="此状态下暂无活动" />
          <div class="act-grid">
            <article v-for="row in visibleActivities" :key="row.id" class="act-card">
              <div class="act-cover">
                <el-image v-if="isImage(row.evidenceUrl)" :src="row.evidenceUrl" :preview-src-list="[row.evidenceUrl]" fit="cover" class="cover-img" />
                <div v-else class="cover-ph"><span>📄</span><small>演示 / 文档凭证</small></div>
                <span class="type-badge" :class="row.type === 'MINUTE' ? 'green' : 'blue'">{{ typeText(row) }}</span>
              </div>
              <div class="act-body">
                <div class="between"><h3>{{ row.title }}</h3><el-tag :type="tagType(row)" size="small">{{ statusText(row) }}</el-tag></div>
                <p class="meta">{{ row.college }} {{ row.grade }} 级 · 名额 {{ row.enrolled }}/{{ row.capacity }}（剩余 {{ row.remainingCapacity }}）</p>
                <p class="meta">{{ fmt(row.startsAt) }} — {{ fmt(row.endsAt) }} · {{ row.location }}</p>
                <p v-if="row.cancelReason" class="reason">取消原因：{{ row.cancelReason }}</p>
                <p v-if="row.reviewReason" class="reason">驳回原因：{{ row.reviewReason }}</p>
                <div class="actions">
                  <el-button v-if="row.status === 'PUBLISHED'" type="primary" @click="openCode(row, 'checkin')">投屏签到码</el-button>
                  <el-button v-if="row.status === 'PUBLISHED' && row.checkinMode === 'BOTH'" @click="openCode(row, 'checkout')">投屏签退码</el-button>
                  <el-button v-if="row.status === 'PENDING'" @click="editActivity(row)">修改重提</el-button>
                  <el-button v-if="row.status !== 'CANCELLED'" type="danger" plain @click="cancelActivity(row)">取消活动</el-button>
                  <el-button @click="detail = row">查看详情</el-button>
                </div>
              </div>
            </article>
          </div>
        </section>

        <footer class="foot">校园活动积分与文创兑换平台 · 本地演示环境</footer>
      </main>
    </div>

    <!-- 动态二维码弹窗 -->
    <el-dialog v-model="codeView.open" title="动态二维码" width="460px" @closed="closeCode">
      <div class="qr-dialog">
        <div class="qr-tabs" v-if="codeView.activity?.type === 'MINUTE'">
          <button :class="{ on: codeView.kind === 'checkin' }" @click="switchCodeKind('checkin')">签到码</button>
          <button :class="{ on: codeView.kind === 'checkout' }" @click="switchCodeKind('checkout')">签退码</button>
        </div>
        <p class="qr-title">{{ codeView.activity?.title }} · {{ codeView.kind === 'checkin' ? '签到' : '签退' }}</p>
        <div class="qr-frame">
          <img v-if="codeView.qr" :src="codeView.qr" alt="动态二维码" />
          <div v-else class="qr-loading">生成中…</div>
        </div>
        <p class="qr-code">动态码 <strong>{{ codeView.code }}</strong> · {{ codeView.secondsLeft }} 秒后刷新</p>
        <p class="muted center">学生打开小程序活动详情，使用「扫码签到 / 扫码签退」扫描此二维码；二维码每 10 秒自动刷新，截图转发会失效。</p>
      </div>
    </el-dialog>

    <!-- 详情 -->
    <el-dialog v-model="detailOpen" :title="detail?.title || '活动详情'" width="640px">
      <div v-if="detail" class="detail-body">
        <div class="detail-cover" v-if="isImage(detail.evidenceUrl)"><el-image :src="detail.evidenceUrl" :preview-src-list="[detail.evidenceUrl]" fit="cover" /></div>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="类型">{{ typeText(detail) }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ statusText(detail) }}</el-descriptions-item>
          <el-descriptions-item label="面向">{{ detail.college }} {{ detail.grade }} 级</el-descriptions-item>
          <el-descriptions-item label="名额">{{ detail.enrolled }} / {{ detail.capacity }}</el-descriptions-item>
          <el-descriptions-item label="时间" :span="2">{{ fmt(detail.startsAt) }} — {{ fmt(detail.endsAt) }}</el-descriptions-item>
          <el-descriptions-item label="地点" :span="2">{{ detail.location || '—' }}</el-descriptions-item>
          <el-descriptions-item label="签到方式">{{ detail.checkinMode === 'BOTH' ? '签到 + 签退' : '仅签到' }}</el-descriptions-item>
          <el-descriptions-item label="凭证">{{ isImage(detail.evidenceUrl) ? '图片凭证' : (detail.evidenceUrl || '—') }}</el-descriptions-item>
        </el-descriptions>
        <p class="desc-block">{{ detail.description || '（无分值说明）' }}</p>
        <div v-if="detail.reviews?.length" class="review-history">
          <h4>审核历史</h4>
          <p v-for="r in detail.reviews" :key="r.id" class="muted">{{ fmt(r.decidedAt) }} · {{ r.decision === 'APPROVED' ? '通过' : '驳回' }} · {{ r.reason || '—' }}</p>
        </div>
      </div>
    </el-dialog>

    <!-- 礼品编辑 -->
    <el-dialog v-model="giftEdit.open" title="编辑礼品" width="520px">
      <div class="gift-form">
        <div class="gift-form-media" @click="pickImage('giftEdit')">
          <img v-if="giftEdit.imageUrl" :src="giftEdit.imageUrl" alt="" />
          <div v-else class="upload-ph"><span>{{ uploading.giftEdit ? '上传中…' : '＋' }}</span><small>上传礼品图片</small></div>
        </div>
        <div class="gift-form-fields">
          <el-form label-position="top">
            <el-form-item label="名称"><el-input v-model="giftEdit.name" maxlength="100" /></el-form-item>
            <el-form-item label="说明"><el-input v-model="giftEdit.description" type="textarea" :rows="2" maxlength="500" /></el-form-item>
            <div class="two">
              <el-form-item label="所需积分"><el-input-number v-model="giftEdit.points" :min="1" :max="9999" /></el-form-item>
              <el-form-item label="库存"><el-input-number v-model="giftEdit.stock" :min="0" :max="9999" /></el-form-item>
            </div>
            <el-form-item label="上架"><el-switch v-model="giftEdit.enabled" /></el-form-item>
            <el-form-item label="变更原因（必填，写入审计）"><el-input v-model="giftEdit.reason" /></el-form-item>
          </el-form>
        </div>
      </div>
      <template #footer><el-button @click="giftEdit.open = false">取消</el-button><el-button type="primary" :loading="busy" @click="saveGiftEdit">保存</el-button></template>
    </el-dialog>

    <!-- 修改密码 -->
    <el-dialog v-model="passwordOpen" title="修改密码" width="420px">
      <el-form label-position="top">
        <el-form-item label="原密码"><el-input v-model="passwords.oldPassword" type="password" show-password /></el-form-item>
        <el-form-item label="新密码（至少 10 个字符）"><el-input v-model="passwords.newPassword" type="password" show-password /></el-form-item>
        <el-form-item label="确认新密码"><el-input v-model="passwords.confirm" type="password" show-password /></el-form-item>
      </el-form>
      <template #footer><el-button @click="passwordOpen = false">取消</el-button><el-button type="primary" :loading="busy" @click="changePassword">确认修改</el-button></template>
    </el-dialog>
  </div>
</template>

<style>
:root {
  --ink: #101a2e; --muted: #6b7a90; --line: #e6ecf5; --bg: #f2f5fb;
  --brand: #2f6fed; --brand-2: #5b8dff; --violet: #7c5cff;
  --green: #16a34a; --orange: #f59e0b; --red: #dc2626;
}
* { box-sizing: border-box; }
html, body, #app { height: 100%; margin: 0; }
body { background: var(--bg); color: var(--ink); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif; }
.app { min-height: 100vh; }
h1, h2, h3, h4, p { margin: 0; }
.muted { color: var(--muted); font-size: 13px; }
.error { color: #c0392b; font-size: 13px; margin-top: 8px; }
.ok { color: #15803d; font-size: 13px; margin-top: 8px; }
.center { text-align: center; }
.full { width: 100%; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.between { display: flex; align-items: center; justify-content: space-between; gap: 12px; }

/* 登录 */
.auth { position: relative; min-height: 100vh; display: grid; place-items: center; overflow: hidden; background: radial-gradient(1200px 600px at 10% 10%, #1b2d55 0%, #0d1729 55%, #0a1220 100%); padding: 32px; }
.auth-glow { position: absolute; width: 520px; height: 520px; border-radius: 50%; filter: blur(120px); opacity: .5; }
.auth-glow.a { background: #2f6fed; top: -180px; left: -120px; }
.auth-wrap { position: relative; z-index: 1; width: min(440px, 100%); border-radius: 26px; overflow: hidden; box-shadow: 0 40px 90px rgba(0, 0, 0, .5); background: rgba(255, 255, 255, .04); border: 1px solid rgba(255, 255, 255, .1); backdrop-filter: blur(10px); }
.brand-mark { width: 54px; height: 54px; border-radius: 16px; display: grid; place-items: center; background: linear-gradient(140deg, #5b8dff, #2f6fed); color: #fff; font-size: 26px; font-weight: 800; box-shadow: 0 10px 30px rgba(47, 111, 237, .5); }
.brand-mark.sm { width: 40px; height: 40px; border-radius: 12px; font-size: 20px; }
.auth-form { padding: 52px 44px; background: #fff; display: flex; flex-direction: column; gap: 16px; }
.auth-form h1, .auth-form h2 { font-size: 26px; }
.login-brand { color: var(--brand); font-size: 13px; font-weight: 700; }
.auth-form .el-input__wrapper { padding: 8px 14px; border-radius: 12px; }
.auth-form .el-button { height: 46px; border-radius: 12px; font-size: 16px; letter-spacing: 4px; }
.auth-form.wide { border-radius: 26px; }
.hint { font-size: 12px; color: #8a97a8; margin-top: auto; }

/* 布局 */
.shell { display: grid; grid-template-columns: 250px 1fr; min-height: 100vh; }
.side { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; padding: 24px 16px; color: #c7d4ea; background: linear-gradient(180deg, #0d1830 0%, #14233f 100%); }
.brand { display: flex; align-items: center; gap: 12px; padding: 4px 10px 22px; }
.brand strong { display: block; color: #fff; font-size: 17px; letter-spacing: 1px; }
.brand span { display: block; color: #7f93b3; font-size: 11px; letter-spacing: 3px; margin-top: 2px; }
.nav { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.nav-item { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 0; border-radius: 12px; background: transparent; color: #b8c7de; font-size: 14px; cursor: pointer; text-align: left; transition: .18s; }
.nav-item:hover { background: rgba(255, 255, 255, .06); color: #fff; }
.nav-item.active { background: linear-gradient(100deg, #2f6fed, #4f7df0); color: #fff; box-shadow: 0 10px 24px rgba(47, 111, 237, .35); }
.nav-ico { width: 22px; text-align: center; }
.side-foot { margin-top: auto; border-top: 1px solid rgba(255, 255, 255, .08); padding-top: 16px; }
.me { display: flex; gap: 12px; align-items: center; padding: 0 6px 14px; }
.avatar { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; background: linear-gradient(140deg, #5b8dff, #7c5cff); color: #fff; font-weight: 700; }
.me-text strong { display: block; color: #fff; font-size: 14px; }
.me-text span { display: block; color: #8194b4; font-size: 11px; margin-top: 3px; }
.foot-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.ghost-btn { border: 1px solid rgba(255, 255, 255, .14); background: transparent; color: #c7d4ea; border-radius: 10px; padding: 8px; font-size: 12px; cursor: pointer; transition: .18s; }
.ghost-btn:hover { background: rgba(255, 255, 255, .1); color: #fff; }

.main { padding: 30px 38px 50px; display: flex; flex-direction: column; gap: 20px; min-width: 0; }
.topbar { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
.topbar h1 { font-size: 26px; letter-spacing: .5px; }
.topbar p { color: var(--muted); font-size: 13px; margin-top: 6px; }
.top-actions { display: flex; align-items: center; gap: 12px; }
.role-pill { padding: 6px 14px; border-radius: 999px; background: #e8f0ff; color: #2f6fed; font-size: 12px; font-weight: 600; }
.banner { padding: 12px 16px; border-radius: 12px; font-size: 13px; margin: 0; }
.banner.error { background: #fdecec; color: #b33636; }
.banner.ok { background: #e9f9ef; color: #15803d; }

.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.stat { background: #fff; border-radius: 16px; padding: 18px 20px; display: flex; gap: 14px; align-items: center; box-shadow: 0 6px 22px rgba(16, 26, 46, .05); }
.stat-ico { width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; background: #eef4ff; font-size: 20px; }
.stat b { display: block; font-size: 24px; line-height: 1.1; }
.stat span { font-size: 12px; color: var(--muted); }

.panel { display: flex; flex-direction: column; gap: 16px; }
.panel-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
.panel-head h2 { font-size: 19px; }
.panel-head p { color: var(--muted); font-size: 12px; margin-top: 4px; }
.chip-row { display: flex; gap: 8px; flex-wrap: wrap; }
.chip { border: 1px solid var(--line); background: #fff; color: #55637a; border-radius: 999px; padding: 7px 16px; font-size: 13px; cursor: pointer; }
.chip.on { background: var(--brand); border-color: var(--brand); color: #fff; }

.act-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 18px; }
.act-card { background: #fff; border-radius: 18px; overflow: hidden; box-shadow: 0 10px 30px rgba(16, 26, 46, .06); display: flex; flex-direction: column; }
.act-cover { position: relative; height: 150px; background: linear-gradient(140deg, #dbe7ff, #eef3ff); }
.cover-img { width: 100%; height: 100%; }
.cover-ph { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; color: #7c8db0; font-size: 26px; }
.cover-ph small { font-size: 11px; color: #9aa9c4; }
.type-badge { position: absolute; left: 14px; bottom: 12px; padding: 5px 12px; border-radius: 999px; font-size: 12px; color: #fff; background: linear-gradient(120deg, #2f6fed, #5b8dff); }
.type-badge.green { background: linear-gradient(120deg, #16a34a, #34c46b); }
.act-body { padding: 16px 18px 18px; display: flex; flex-direction: column; gap: 8px; }
.act-body h3 { font-size: 16px; }
.meta { color: var(--muted); font-size: 12px; }
.desc { color: #55637a; font-size: 13px; line-height: 1.65; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.reason { color: #c0392b; font-size: 12px; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }

.gift-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 18px; }
.gift-card { background: #fff; border-radius: 18px; overflow: hidden; box-shadow: 0 10px 30px rgba(16, 26, 46, .06); }
.gift-media { position: relative; height: 150px; background: linear-gradient(150deg, #f2f6ff, #e6eeff); }
.gift-media img { width: 100%; height: 100%; object-fit: cover; display: block; }
.gift-ph { width: 100%; height: 100%; display: grid; place-items: center; font-size: 46px; }
.stock-badge { position: absolute; right: 12px; top: 12px; padding: 4px 10px; border-radius: 999px; font-size: 11px; color: #fff; background: rgba(16, 26, 46, .55); }
.stock-badge.green { background: rgba(22, 163, 74, .85); }
.stock-badge.gray { background: rgba(107, 122, 144, .8); }
.gift-body { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 8px; }
.gift-body h3 { font-size: 15px; }
.points { color: #e0730b; font-weight: 700; font-size: 14px; }
.mini-actions { display: flex; gap: 6px; }

.form-card { border-radius: 16px; border: 1px solid var(--line); }
.form-card h3 { font-size: 15px; margin-bottom: 12px; }
.form-card .el-form-item { margin-bottom: 14px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 26px; }
.form-col { display: flex; flex-direction: column; }
.tip { background: #fff7e6; border: 1px solid #f3d9a8; color: #8a5a00; border-radius: 10px; padding: 10px 12px; font-size: 12px; line-height: 1.6; }
.two-panels { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.table-card { background: #fff; border-radius: 16px; padding: 6px 10px; box-shadow: 0 10px 30px rgba(16, 26, 46, .05); overflow: hidden; }
.nice-table { --el-table-border-color: #eef2f9; --el-table-header-bg-color: #f8faff; }
.nice-table .el-table__row { cursor: pointer; }
.cell-user strong { display: block; font-size: 13px; }
.cell-user span { display: block; font-size: 11px; color: var(--muted); }
.dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px; }
.dot.on { background: #22c55e; }
.dot.off { background: #b6c0cf; }
.audit-detail { padding: 12px 20px; background: #fbfcff; display: flex; flex-direction: column; gap: 10px; }
.kv { display: flex; gap: 14px; font-size: 12px; }
.kv > span { width: 52px; color: var(--muted); flex: none; }
.kv > div { display: flex; gap: 8px; flex-wrap: wrap; }
.kv i { font-style: normal; background: #eef4ff; color: #31558f; border-radius: 8px; padding: 3px 9px; }
.kv em { color: #9aa7ba; font-style: normal; }

.dropzone { display: flex; flex-direction: column; align-items: center; gap: 8px; border: 1.5px dashed #c7d6ee; border-radius: 14px; padding: 26px; background: #f8fbff; cursor: pointer; margin-bottom: 16px; transition: .2s; }
.dropzone:hover { border-color: var(--brand); background: #f1f6ff; }
.dropzone input { display: none; }
.drop-ico { font-size: 28px; }
.dropzone small { color: var(--muted); font-size: 12px; }

.upload-box { width: 100%; height: 170px; border-radius: 14px; border: 1.5px dashed #c7d6ee; background: #f8fbff; display: grid; place-items: center; cursor: pointer; overflow: hidden; transition: .2s; }
.upload-box:hover { border-color: var(--brand); }
.upload-box img { width: 100%; height: 100%; object-fit: cover; }
.upload-ph { display: flex; flex-direction: column; align-items: center; gap: 6px; color: #7c8db0; }
.upload-ph span { font-size: 30px; line-height: 1; }
.upload-ph small { font-size: 12px; }

.gift-form { display: grid; grid-template-columns: 200px 1fr; gap: 20px; }
.gift-form-media { height: 200px; border-radius: 14px; overflow: hidden; background: #f4f7fd; border: 1.5px dashed #c7d6ee; display: grid; place-items: center; cursor: pointer; }
.gift-form-media img { width: 100%; height: 100%; object-fit: cover; }
.gift-form-fields { min-width: 0; }

.redeem-wrap { display: grid; place-items: center; padding: 30px 0; }
.redeem-card { width: min(520px, 100%); background: #fff; border-radius: 22px; padding: 36px; text-align: center; display: flex; flex-direction: column; gap: 14px; box-shadow: 0 18px 50px rgba(16, 26, 46, .1); }
.ticket-mark { font-size: 40px; }
.redeem-card h2 { font-size: 22px; }
.code-input .el-input__wrapper { font-size: 22px; letter-spacing: 4px; text-align: center; }
.redeem-ok { background: #eaf9f0; border-radius: 14px; padding: 16px; color: #15803d; }
.redeem-ok p { margin-top: 4px; }

.qr-dialog { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.qr-title { font-weight: 600; }
.qr-tabs { display: flex; gap: 8px; background: #f1f5fc; padding: 4px; border-radius: 999px; }
.qr-tabs button { border: 0; background: transparent; padding: 7px 18px; border-radius: 999px; cursor: pointer; color: #55637a; font-size: 13px; }
.qr-tabs button.on { background: #fff; color: var(--brand); box-shadow: 0 2px 8px rgba(16, 26, 46, .1); }
.qr-frame { width: 280px; height: 280px; border-radius: 18px; padding: 14px; background: #fff; border: 1px solid var(--line); display: grid; place-items: center; }
.qr-frame img { width: 100%; height: 100%; image-rendering: pixelated; }
.qr-code { font-size: 13px; color: var(--muted); }
.qr-code strong { color: var(--ink); letter-spacing: 3px; font-size: 16px; }

.detail-body { display: flex; flex-direction: column; gap: 14px; }
.detail-cover { height: 200px; border-radius: 14px; overflow: hidden; }
.detail-cover .el-image { width: 100%; height: 100%; }
.desc-block { background: #f8faff; border-radius: 12px; padding: 14px; color: #4a5a74; line-height: 1.7; font-size: 13px; }
.review-history h4 { margin-bottom: 6px; }

.foot { margin-top: auto; text-align: center; color: #9aa7ba; font-size: 12px; padding-top: 10px; }

@media (max-width: 980px) {
  .shell { grid-template-columns: 1fr; }
  .side { position: static; height: auto; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 10px; padding: 14px; }
  .brand { padding: 0 8px; }
  .nav { flex-direction: row; overflow-x: auto; margin: 0; }
  .nav-item { white-space: nowrap; padding: 9px 12px; }
  .side-foot { margin: 0 0 0 auto; border: 0; padding: 0; display: flex; align-items: center; gap: 8px; }
  .me { padding: 0; }
  .foot-actions { display: flex; }
  .main { padding: 20px; }
  .stats, .form-grid, .two-panels, .gift-form { grid-template-columns: 1fr; }
}
@media (max-width: 760px) {
  .topbar { flex-direction: column; align-items: flex-start; }
}

:root {
  --ink: #182d2a;
  --muted: #536963;
  --bg: #f1f6f4;
  --line: #dce9e3;
  --brand: #17695d;
  --brand-2: #27816e;
  --el-color-primary: #17695d;
  --el-color-primary-light-3: #448e82;
  --el-color-primary-light-9: #e9f5ef;
  --el-color-primary-dark-2: #104e45;
}
.side { background: linear-gradient(175deg, #102c29, #173e38); }
.nav-item.active, .brand-mark { background: #237a6b; box-shadow: none; }
.auth { background: radial-gradient(ellipse at top left, #24584e, #102c29 72%); }
.panel-head h2 { font-size: 24px; letter-spacing: -.02em; }
.audit-detail { overflow-wrap: anywhere; }
</style>