# 校园活动平台 · 身份与权限

本次实现 Epic 1：管理员登录及首次改密、CSV 学生名单导入、独立角色账号管理、微信首次绑定与后续一键登录、每请求数据库授权、审计和本人首页查询。仓库原有 scripts/ 菜单保留。

## 启动

需要 Node **24.11+（24 LTS）**、MySQL **8.4**；容器方式需要 Docker Compose v2。

```sh
cp .env.example .env
# 编辑数据库凭据、管理员初始密码、角色账号初始密码及微信配置
docker compose up --build
```

后台 http://localhost:8080；API http://localhost:3000。Compose 等待数据库就绪后幂等执行迁移、创建初始管理员，再启动 API。已有管理员不会被环境配置重置密码。MySQL 命名卷持久化，默认不清理账号、审计或业务历史；留存至少两个学期需要部署方备份和保留卷。数据库密码放入 URL 前须 URL 编码；示例使用 URL 安全字符以简化 Compose 配置。

本地开发（PowerShell 用 Copy-Item .env.example .env）：

```sh
npm ci
npm run db:migrate
npm run db:seed
npm start --workspace apps/api
# 另一个终端
npm run dev --workspace apps/admin
```

本地 .env 的 DATABASE_URL 应指向已创建的 MySQL 数据库；后台开发地址 http://localhost:5173，将 ADMIN_ORIGIN 改为此值。API 不信任任意 X-Forwarded-For，失败来源 IP 是直接连接地址；代理部署时记录代理地址。

## 使用

1. 用 ADMIN_IDENTIFIER、ADMIN_INITIAL_PASSWORD 登录后台，首次先改成至少10字符的新密码。改密撤销所有旧管理员会话。
2. 上传 UTF-8 CSV，表头必须且仅有 学号,姓名,学院,年级，不需要密码列。1–20行，缺列、重复、空字段、格式错误或累计超容量均整批拒绝；已存在学生返回计数。保留学号前导零。
3. 管理员告知 INITIAL_ACCOUNT_PASSWORD，学生用微信身份、学号、初始密码首次绑定，以后一键登录。密码只在创建时生成 scrypt 哈希，更换环境配置不会改动既有账号。
4. 后台可开通独立发布者或核销员、回收单一角色或停用。学生池累计最多20个，发布者和核销员池累计最多10个；停用或回收仍占原池名额，保留历史，不能借回收无限扩容。学生不能改成职员账号。
5. 临时核销授权填写已存在活动ID，服务端取结束时间，每请求还查活动当前结束时间，活动结束立即拒绝。活动创建不属于本史诗，初始没有活动可选。

CSV格式示例（不会自动导入）：

```csv
学号,姓名,学院,年级
20260001,张三,计算机与大数据学院,26
```

## 微信接入

微信开发者工具导入 apps/miniprogram/，将 project.config.json 的 touristappid 换为真实 AppID，设置 app.js 的 apiBase 为部署后 HTTPS API 地址，在微信后台配置合法 request 域名，服务端 .env 配置同一 AppID 和 Secret。开发工具可用 localhost 并关闭合法域名校验；真机必须使用可访问的 HTTPS 域名。

生产代码只调用官方 code2session，没有开发code、伪造openid或mock登录后门。仅测试依赖注入替换交换服务，不连接线上微信。session_key 不保存、不返回；Secret只在服务端。同一微信可绑定多个独立账号，一键登录时选择账号；每个会话只携带一个账号，权限不合并。已绑定账号不能凭初始密码被另一微信重新绑定。

管理员和绑定凭据连续错5次锁10分钟，数据库记录失败时间和IP，客户端显示剩余秒数。密码 scrypt 加盐；2小时随机会话仅存 SHA-256 哈希。每请求查会话与最新账号角色、状态和授权期限。请求内容与异常详情日志关闭，审计也不包含密码、token、微信密钥。

## 接口与查询边界

| 接口 | 权限与结果 |
|---|---|
| POST /auth/admin/login | 管理员账密，首次只允许身份查询、改密、退出 |
| POST /auth/wechat/login | code；首次另带identifier/password；多个绑定返回账号选择，以新code和accountId重试 |
| GET /me | 本人账号白名单字段 |
| POST /auth/password | 管理员oldPassword/newPassword |
| POST /auth/logout | 撤销当前会话 |
| GET /students/me/home | 本人积分、志愿分钟聚合及匹配学院年级活动 |
| GET /students/:id/home | 只允许本人，跨学生403 |
| GET/POST /admin/accounts | 管理员查询或创建独立发布者/核销员 |
| PATCH /admin/accounts/:id | 更新role、enabled、activityId，reason必填 |
| POST /admin/roster/import | 管理员提交csv、reason |
| GET /admin/audits | 操作人、原因、前后值与UTC时间 |

受保护接口使用 Authorization: Bearer token。未登录401，越权、停用或到期403，锁定423。管理员不能停用或回收自己。

首页余额来自 ledger_entry.amount 按 studentId/unit 聚合，积分和分钟分开，不设另一套余额。列表查询 PUBLISHED、本人学院年级、尚未开始且未满的活动。真实空表返回0和空列表，无演示数据。活动、签到、兑换、流水入账和完整报名资格判定留到后续史诗，本次只建立查询侧结构与契约。

## Prisma 8 实施决策

锁定 CLI prisma@8.0.0-rc.30、MySQL库 @prisma/orm-mysql@8.0.0-rc.22、NestJS12.3.3、Vue3.5.44、Vite7.3.7，完整依赖在 package-lock.json。

Prisma8 MySQL 当前early preview，支持读取、raw SQL和事务，拒绝ORM写入和SQL builder行锁。依据[官方支持说明](https://www.prisma.io/docs/orm/supported-databases)，使用 Prisma8 db.raw.sql 参数化写入与 db.transaction；容量以条件UPDATE同事务预留，容量行no-op UPDATE串行化导入，账号行no-op UPDATE串行化绑定与失败计数，唯一约束去重。未降级Prisma7，未使用进程内锁。

apps/api/prisma/contract.prisma 是8张表完整字段契约，生成JSON/类型已入库，可 npm run contract:emit --workspace apps/api 重建。JSON/BOOLEAN使用Raw原生类型。实际DDL以 prisma/migrations/001_identity.sql 为准（外键、CHECK、原生JSON、DATETIME(3)、二进制标识比较），通过Prisma raw SQL幂等执行并记录schema_migration。未采用preview的schema签名验证，运行时 verifyMarker:false；后续变更必须同步SQL迁移与契约。时间写入和读取UTC，响应ISO时间，业务展示按Asia/Shanghai换算。

## 验证

```sh
npm run build
npm test
# 专门测试空库，库名必须以_test结尾；测试会清空该库身份相关表！
# PowerShell: $env:TEST_DATABASE_URL='mysql://user:password@localhost:3306/campus_test'
TEST_DATABASE_URL=mysql://user:password@localhost:3306/campus_test npm run test:mysql
npm audit --omit=dev
```

测试覆盖密码/会话、CSV矩阵、微信错误、客户端绑定和角色查询、真实Nest HTTP、强制改密、失败锁定、20人本人隔离、并发容量、11职员并发争10名额、两微信抢绑、旧会话授权、审计与独立连接持久化。测试fixture只写_test库，应用启动不写测试业务数据。

实际环境：Windows、Node24.19.0、隔离MySQL8.4.13端口13306；构建、单元/客户端、真实MySQL API集成均执行。Docker不可用，Compose构建启动未执行；未提供真实微信AppID/Secret、开发者工具与真机，真实微信及端到端视觉验收未执行。生产依赖审计0漏洞，开发依赖的Prisma CLI/Composer传递链仍有17项告警（5 moderate/12 high），没有冒充已清零。
