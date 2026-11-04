<script setup>
import { ref, reactive } from 'vue';
import { createApi } from './api';
const token = ref(sessionStorage.getItem('session') || '');
const account = ref(null), accounts = ref([]), audits = ref([]), error = ref(''), notice = ref(''), busy = ref(false);
const login = reactive({ identifier: '', password: '' });
const passwords = reactive({ oldPassword: '', newPassword: '' });
const create = reactive({ identifier: '', name: '', role: 'PUBLISHER', reason: '' });
const change = reactive({ id: '', role: 'PUBLISHER', enabled: true, activityId: '', reason: '' });
const csv = ref(''), importReason = ref(''), tab = ref('accounts');
function clear() { token.value = ''; account.value = null; accounts.value = []; audits.value = []; sessionStorage.removeItem('session'); }
const api = createApi({ getToken: () => token.value, onUnauthorized: clear });
function accept(result) { token.value = result.token; account.value = result.account; sessionStorage.setItem('session', result.token); }
async function run(fn) { error.value = ''; notice.value = ''; busy.value = true; try { await fn(); } catch (e) { error.value = e.message; } finally { busy.value = false; } }
async function refresh() { accounts.value = await api('/admin/accounts'); audits.value = await api('/admin/audits'); }
async function doLogin() { await run(async () => { accept(await api('/auth/admin/login', 'POST', login)); login.password = ''; if (!account.value.mustChangePassword) await refresh(); }); }
async function doPassword() { await run(async () => { accept(await api('/auth/password', 'POST', passwords)); passwords.oldPassword = ''; passwords.newPassword = ''; await refresh(); notice.value = '密码已修改，旧会话已失效'; }); }
async function readFile(event) { const file = event.target.files[0]; if (file) { if (file.size > 65536) { error.value = 'CSV不能超过64KB'; return; } csv.value = await file.text(); } }
async function doImport() { await run(async () => { const r = await api('/admin/roster/import', 'POST', { csv: csv.value, reason: importReason.value }); notice.value = `导入成功：新增${r.created}个，已存在${r.existing}个`; await refresh(); }); }
async function doCreate() { await run(async () => { await api('/admin/accounts', 'POST', create); notice.value = '账号已创建，请通过安全渠道告知环境配置的初始密码'; await refresh(); }); }
async function doChange() { await run(async () => { const { id, ...body } = change; await api('/admin/accounts/' + encodeURIComponent(id), 'PATCH', body); notice.value = '账号已更新，旧会话从下一请求起按最新权限验证'; await refresh(); }); }
function select(row) { Object.assign(change, { id: row.id, role: row.role, enabled: row.enabled, activityId: row.activityId || '', reason: '' }); }
if (token.value) run(async () => { account.value = await api('/me'); if (!account.value.mustChangePassword) await refresh(); });
</script>
<template>
  <main>
    <header><div><small>校园活动平台</small><h1>身份与账号管理</h1></div><el-button v-if="account" @click="run(async () => { await api('/auth/logout', 'POST'); clear(); })">退出登录</el-button></header>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <el-alert v-if="notice" :title="notice" type="success" :closable="false" show-icon />
    <el-card v-if="!account" class="login"><h2>管理员登录</h2><el-form label-position="top" @submit.prevent="doLogin"><el-form-item label="账号"><el-input v-model="login.identifier" autocomplete="username" /></el-form-item><el-form-item label="密码"><el-input v-model="login.password" type="password" autocomplete="current-password" show-password /></el-form-item><el-button type="primary" native-type="submit" :loading="busy">登录</el-button></el-form></el-card>
    <el-card v-else-if="account.mustChangePassword" class="login"><h2>首次登录 · 修改密码</h2><p>完成改密后才能管理账号。</p><el-form label-position="top" @submit.prevent="doPassword"><el-form-item label="原密码"><el-input v-model="passwords.oldPassword" type="password" autocomplete="current-password" /></el-form-item><el-form-item label="新密码（至少10字符）"><el-input v-model="passwords.newPassword" type="password" autocomplete="new-password" /></el-form-item><el-button type="primary" native-type="submit" :loading="busy">修改并进入后台</el-button></el-form></el-card>
    <el-tabs v-else v-model="tab">
      <el-tab-pane label="账号管理" name="accounts">
        <el-table :data="accounts" @row-click="select"><el-table-column prop="identifier" label="账号 / 学号"/><el-table-column prop="name" label="姓名"/><el-table-column prop="role" label="单一角色"/><el-table-column label="状态"><template #default="{row}">{{ row.enabled ? '启用' : '停用' }}</template></el-table-column><el-table-column prop="authorizationExpiresAt" label="授权到期（UTC）"/></el-table>
        <div class="grid"><el-card><h2>开通独立角色账号</h2><el-form label-position="top" @submit.prevent="doCreate"><el-form-item label="账号"><el-input v-model="create.identifier"/></el-form-item><el-form-item label="姓名"><el-input v-model="create.name"/></el-form-item><el-form-item label="角色"><el-select v-model="create.role"><el-option label="发布者" value="PUBLISHER"/><el-option label="核销员" value="REDEEMER"/></el-select></el-form-item><el-form-item label="原因"><el-input v-model="create.reason"/></el-form-item><el-button native-type="submit" type="primary" :loading="busy">创建账号</el-button></el-form></el-card>
        <el-card><h2>修改所选账号</h2><p>点击上表选择账号；不删除历史数据。</p><el-form label-position="top" @submit.prevent="doChange"><el-form-item label="账号ID"><el-input v-model="change.id" readonly/></el-form-item><el-form-item label="角色"><el-select v-model="change.role"><el-option v-for="r in ['STUDENT','PUBLISHER','REDEEMER','REVOKED']" :key="r" :value="r" :label="r"/></el-select></el-form-item><el-form-item label="启用"><el-switch v-model="change.enabled"/></el-form-item><el-form-item label="临时核销活动ID（留空为长期）"><el-input v-model="change.activityId"/></el-form-item><el-form-item label="变更原因"><el-input v-model="change.reason"/></el-form-item><el-button native-type="submit" type="primary" :loading="busy" :disabled="!change.id">保存</el-button></el-form></el-card></div>
      </el-tab-pane>
      <el-tab-pane label="CSV名单导入" name="import"><el-card><h2>学生名单</h2><p>UTF-8 CSV，表头：学号,姓名,学院,年级。最多20行，缺列或重复将整批拒绝。初始密码由管理员通过安全渠道另行告知。</p><input type="file" accept=".csv,text/csv" @change="readFile"><el-form label-position="top" @submit.prevent="doImport"><el-form-item label="导入原因"><el-input v-model="importReason"/></el-form-item><el-form-item label="文件预览"><el-input v-model="csv" type="textarea" :rows="8"/></el-form-item><el-button type="primary" native-type="submit" :loading="busy">整批导入</el-button></el-form></el-card></el-tab-pane>
      <el-tab-pane label="操作审计" name="audits"><el-table :data="audits"><el-table-column prop="occurredAt" label="时间（UTC）"/><el-table-column prop="actorId" label="操作人"/><el-table-column prop="targetId" label="目标账号"/><el-table-column prop="action" label="操作"/><el-table-column prop="reason" label="原因"/><el-table-column prop="beforeValue" label="变更前"/><el-table-column prop="afterValue" label="变更后"/></el-table></el-tab-pane>
    </el-tabs>
  </main>
</template>
<style>
body{margin:0;background:#f4f7fb;color:#17263d;font-family:system-ui,sans-serif}main{max-width:1180px;margin:auto;padding:32px}header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}h1{margin:6px 0;font-size:28px}h2{font-size:20px}.login{max-width:440px;margin:48px auto}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:24px}.el-alert{margin-bottom:18px}.el-select{width:100%}p{line-height:1.7;color:#596a7f}@media(max-width:700px){main{padding:16px}.grid{grid-template-columns:1fr}}
</style>
