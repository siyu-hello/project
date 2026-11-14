# 校园活动平台 · 积分与文创兑换

Epic 1–7 全部 18 个故事的可运行实现：身份与权限、活动发布与审核、报名与名额、动态二维码签到与签退、双账户账本、缺席结算与禁报、文创礼品兑换/核销/过期返还。

界面：后台为深色侧栏 + 卡片式工作台；小程序为渐变主视觉 + 活动流首页 / 文创商城 / 个人中心，现场签到签退统一扫描 10 秒动态二维码。

## 技术栈

- Node.js 24（原生 ESM，无转译器）+ NestJS 12 + Express 5
- Prisma 8 preview 的 MySQL 驱动（`@prisma/orm-mysql`），全部业务写入走参数化 raw SQL + 事务
- MySQL 8（`DATETIME(3)`、原生 `JSON`、CHECK、唯一约束）
- 后台：Vue 3 + Vite 7 + Element Plus
- 学生端：微信原生小程序（`apps/miniprogram`，无需构建）

## 目录

```
apps/api        API、领域服务、迁移（prisma/migrations）、种子
apps/admin      管理后台 / 发布者工作台 / 核销台（同一 SPA，按角色显示）
apps/miniprogram 微信小程序（学生、核销员）
tests           tests/e2e.mjs（HTTP 全流程）、tests/domain.mjs（时长/禁报/过期）
scripts         本机启动与演示数据脚本
```

## 启动（本机）

前置：Node 24.11+、MySQL 8。`.env` 需包含 `DATABASE_URL`、`ADMIN_IDENTIFIER`、`ADMIN_INITIAL_PASSWORD`、`INITIAL_ACCOUNT_PASSWORD`、`CHECKIN_SECRET`、`ADMIN_ORIGIN`、`PORT`。

```sh
npm ci
npm run db:migrate      # 001 身份 + 002 活动/报名/签到/礼品，幂等
npm run db:seed         # 初始化管理员（已存在则不改密码）
npm run demo:seed       # 可选：演示账号、活动、礼品、当场可签到/签退的演示活动
npm start --workspace apps/api       # API :3000
npm run dev --workspace apps/admin   # 后台 :5173（/api 代理到 3000）
```

- 后台：<http://127.0.0.1:5173>
- API 健康检查：<http://127.0.0.1:3000/health>
- 小程序：微信开发者工具导入 `apps/miniprogram`，在 `utils/api.js` 的 `DEFAULT_BASE` 配置可访问的 API。模拟器可用 `http://127.0.0.1:3000`。真机发布版需配置设备可访问的 HTTPS API 域名，并在微信后台配置合法域名。
- 图片上传：后台发布活动凭证、维护礼品图片时直接选图，文件保存到仓库 `uploads/`（已 gitignore），通过 `/uploads/<文件名>` 访问；后台 Vite 已代理 `/uploads`，小程序用 `api.assetUrl()` 拼接当前服务器地址。

生产用 Docker Compose：`docker compose up --build` 会自动迁移、初始化管理员并启动 API 与后台（后台 8080）。本次验证环境未安装 Docker，Compose 未实跑。

## 演示账号

| 角色 | 账号 | 密码 | 入口 |
|---|---|---|---|
| 管理员 | `admin` | `AdminCampus2026`（已重置，登录后可在左下角修改） | 后台 |
| 发布者 | `pub1` | `123456` | 后台「发布活动 / 我的活动」 |
| 核销员 | `red1` | `123456` | 后台「核销」或小程序核销页 |
| 学生 | `S2026001` | `123456` | 小程序（也支持微信一键登录） |

`npm run demo:seed` 会幂等补齐上述账号、4 场常规活动、1 场待审核活动、3 种带图片的礼品，并刷新「即时签到演示 / 现场签退演示」两场活动的相对时间与 S2026001 的报名状态，便于现场演示扫码签到入账与扫码签退计时。演示图片位于 `samples/images/`，脚本会复制到 `uploads/` 并写入凭证/礼品图片字段。

### 小程序导航

| 页面 | 内容 |
|---|---|
| 活动（首页） | 面向本人学院年级的可报名活动，支持筛选、排序、下拉刷新，前台每 15 秒更新 |
| 商城 | 文创礼品图片卡片、积分余额、兑换与订单入口 |
| 我的 | 个人信息、可用积分/志愿时长、积分明细/订单/商城快捷入口、我的报名与签到签退入口 |

签到与签退都在活动详情页完成：点击「扫码签到 / 扫码签退」扫描现场投屏的动态二维码；扫码不可用时保留 6 位动态码手动输入作为兜底。二维码内容为 `CAMPUS|CHECKIN|活动ID|6位码`（签退为 `CHECKOUT`），10 秒轮换，截图或转发旧码会失效。

兑换成功后，小程序会打开订单并出示兑换二维码。学生也可以在「我的订单」再次出示，核销员用小程序扫码，网页核销台可手动输入 12 位码。

## 功能与规则

| 能力 | 实现要点 |
|---|---|
| 发布活动 | 标题/类型/学院/年级/名额(1–20)/起止时间/地点/签到方式/凭证图片；结束早于开始、时长≤10 分钟、5 分活动说明<20 字、漏凭证均拒绝；志愿时长固定签到+签退且无分值；提交后类型与分值锁定；学院/年级候选项来自学生名单 |
| 审核 | 管理员看到凭证图片预览与分值说明；通过→已发布并记录审核人/时间/快照；驳回必须原因，发布者修改后回到待审核，历史审核保留 |
| 学生浏览 | 小程序活动页仅显示已发布、本人学院年级、未开始的活动；可按类型筛选、按时间排序、下拉刷新；待审核活动对任何人 404 |
| 报名 | 校验禁报、非发布、已开始、学院年级、重复报名、时间冲突、条件更新名额防超卖；取消在开始前可操作并释放名额；重新报名复用原记录 |
| 动态二维码 | 活动维度 HMAC 6 位码，每 10 秒换一次；后台「投屏签到码/签退码」渲染成二维码并显示倒计时；当前周期有效，上一周期返回「已失效」；同一周期多人共用 |
| 签到/签退 | 学生扫描现场动态二维码；开始前后 5 分钟内签到；志愿活动结束前后 5 分钟内扫描签退码，按实际签到/签退差值四舍五入到分钟；未签到直接签退、签退早于签到、扫错类型的码均拒绝 |
| 账本 | 唯一余额来源 `ledger_entry`：积分与分钟分单位聚合；完成即入账，`(studentId,unit,kind,sourceId)` 唯一保证重复触发不重复入账；明细分页 20 条 |
| 缺席/禁报 | 定时任务每 30 秒扫描「已报名未签到且开始 5 分钟后」；写 `no_show` 不改正报名状态；第 3 次触发禁报 = 触发时刻 + 7 天，禁报期内再旷按 `+7 + 3×(计数−3)` 顺延；到期自动清零；取消/活动取消不计旷 |
| 礼品 | 管理员新增/编辑库存/图片/上下架，库存、图片与上下架变更必须填原因并写审计；学生兑换按 `(studentId,giftId,requestId)` 幂等，扣分、减库存、生成兑换码同事务；库存/余额不足拒绝 |
| 核销 | 12 位兑换码一次性核销，记录核销员与时间；重复核销返回首次核销时间；已过期/不存在拒绝；核销员只有核销入口 |
| 审计 | 操作人/目标账号均关联姓名与账号，界面显示中文动作名、原因与变更前后字段，可按活动/报名签到/礼品核销/账号安全筛选 |
| 过期返还 | 订单 7 天未核销：置为已过期 + 返还积分流水 + 库存 +1，同事务且幂等（`expireOrders` 定时执行） |

时间统一以 UTC 存储、接口返回 ISO，界面按 `Asia/Shanghai` 展示。

## 主要接口

| 方法与路径 | 说明 |
|---|---|
| POST `/auth/admin/login`、`/auth/student/login`、`/auth/wechat/login` | 管理员、账号密码（发布者/核销员/学生）、微信 |
| GET `/me`、POST `/auth/password`、`/auth/logout` | 会话与改密 |
| GET `/activities`、`/activities/:id`、`/activities/mine` | 学生列表/详情、发布者列表 |
| POST `/activities`、PATCH `/activities/:id`、POST `/activities/:id/cancel` | 发布与修改、取消 |
| POST/DELETE `/activities/:id/registrations` | 报名/取消 |
| GET `/activities/:id/checkin-code`、`/checkout-code` | 发布者/管理员取当前 10 秒签到码 / 签退码 |
| POST `/activities/:id/checkin`、`/checkout` | 学生扫码签到、扫码签退（body 带 6 位动态码） |
| POST `/uploads` | 发布者/管理员上传 PNG/JPEG/WebP/GIF 凭证或礼品图片（≤4MB），返回 `/uploads/...` |
| GET `/activities/targets` | 发布者/管理员读取学生名单中的学院与年级候选项 |
| GET `/students/me/home`、`/registrations`、`/ledger?page=`、`/orders` | 学生首页、我的活动、账本、订单 |
| GET `/gifts`、POST `/gifts/:id/redeem` | 商城与兑换 |
| POST `/redeemer/redeem` | 核销码 |
| GET/POST `/admin/activities`、`/admin/activities/:id/review` | 审核队列与结论 |
| GET/POST `/admin/gifts`、PATCH `/admin/gifts/:id` | 礼品维护（原因必填） |
| GET/POST `/admin/accounts`、PATCH `/admin/accounts/:id`、POST `/admin/roster/import`、GET `/admin/audits` | 账号、名单、审计 |

## 验证

```sh
# 1) HTTP 全流程（需可写的测试库，会清空该库）
$env:DATABASE_URL='mysql://user:pass@127.0.0.1:3306/campus_e2e?allowPublicKeyRetrieval=true'
$env:E2E_BASE='http://127.0.0.1:3100'
node tests/e2e.mjs        # 61 项断言

# 2) 领域验收（时长、缺席、禁报公式、过期返还）
node --env-file=.env tests/domain.mjs     # 18 项断言

# 3) 客户端单元测试
npm test                  # 9 项断言
```

三套测试均针对真实 MySQL 执行并通过。覆盖：发布校验矩阵、审核通过/驳回、学生可见性、报名冲突/满员/复用、10 秒码过期、签到窗口边界、签退分钟数、扫码签退码校验、图片上传与静态访问、入账幂等、账本余额与分页、三次旷触发禁报与 +3 天顺延、到期清零、兑换幂等/并发扣减、重复核销、过期返还。

## 已知限制

- 未提供真实微信 AppID/Secret，`code2session` 与真机扫码未在真实微信环境验收；小程序页面在开发者工具中联调。
- 图片保存在本机 `uploads/` 磁盘并由 API 静态托管，未接入对象存储或 CDN；生产部署需挂载持久卷。
- 未执行 Docker Compose 与生产部署；本机以隔离 MySQL 实例（127.0.0.1:13306）验证。
- 活动取消后在「我的 → 已取消」同步，详情展示取消原因。活动变更不发送推送通知。申诉、冲正、统计报表不在本期范围（见 `_bmad-output/planning-artifacts/epics+stories.md` 顶部说明）。