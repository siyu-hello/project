---
title: '身份与权限'
type: feature
created: '2026-11-04'
status: done
baseline_commit: '6d1b64e8f684afd08e1d6eaf15346718d3464b17'
route: dispatch
review_loop_iteration: 0
context: [project-context.md, _bmad-output/implementation-artifacts/epic-1-context.md]
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

实现故事 1.1–1.3：学生微信登录与首页、管理员登录、名单导入及独立角色账号管理，提供可运行源码和测试。

## Boundaries & Constraints

采用 Node 24、NestJS 12、Prisma 8、MySQL 8.4、Vue 3.5/Vite 7/Element Plus 和原生微信小程序。Prisma 8 当前为候选版，锁定可安装版本。数据时间存 UTC。

学生最多20个；发布者与核销员合计最多10个，独立账号、单一角色。每请求查库验证会话、当前角色、停用及授权期限；管理员首次登录必须改密。历史数据保留，不删除账号。日志不含密码、会话和微信密钥。

用户决定：首次通过微信 code2session 确认微信身份，学生输入学号和管理员设置的简单初始密码绑定已有账号，不使用激活码；后续微信一键登录。发布者和核销员以各自独立账号标识与初始密码绑定。密码仅存哈希，绑定凭据失败连续5次锁10分钟；已绑定账号不能凭初始密码被另一微信重新绑定，绑定与唯一性校验同事务完成。开发初始密码由环境配置提供，管理员负责告知，不增加名单必填列。

本次首页提供本人账户汇总及可报名活动的查询契约；活动创建、签到、兑换、流水入账留给后续史诗，不伪造演示数据为真实业务结果。

## I/O & Edge-Case Matrix

| 场景 | 预期 |
|---|---|
| 未开通的微信 | 拒绝登录，不创建账号 |
| 首次微信＋学号＋正确初始密码 | 绑定已开通账号，后续一键登录 |
| 密码错误或账号已绑定其他微信 | 拒绝绑定，不改变原绑定 |
| 密码连续错5次 | 锁10分钟，记录时间/IP |
| 名单缺列、重复或超过容量 | 整批拒绝；已存在学号计数返回 |
| 未登录、跨角色、跨学生 | 无业务数据；未登录401，越权403 |
| 学生追加角色 | 拒绝，要求分别建号 |
| 停用或临时授权到期 | 旧会话立即403 |
| 管理员回收自己 | 拒绝，保留管理入口 |

</frozen-after-approval>

## Code Map

- `project-context.md`：实现约束。
- `_bmad-output/planning-artifacts/PRD.md`：FR-1/2/3/32和NFR。
- `_bmad-output/planning-artifacts/architecture.md`：AD-6每请求授权。
- 仓库无业务代码；`scripts/`为已有菜单，保留。

## Tasks & Acceptance

- [x] `apps/api/`：身份、账号、授权、审计和查询模块。
- [x] `apps/api/prisma/`：模型、迁移、初始化管理员；容量与导入同事务。
- [x] `apps/admin/`：登录、改密、CSV名单导入、账号管理。
- [x] `apps/miniprogram/`：微信登录、绑定及按角色显示首页。
- [x] `tests/`：矩阵单元/API测试、MySQL事务并发及客户端关键流程。
- [x] `compose.yaml`、`.env.example`、`README.md`：启动、配置、测试和微信接入。
- [x] 更新 sprint 状态与真实实施决策记录，不虚构人工否决记录。

Given 合法20人名单，When 导入并登录，Then 每人仅见本人数据。

Given 首次管理员会话，When 请求管理接口，Then 改密前拒绝，改密后可用。

Given 非法导入或并发超容量，When 请求完成，Then 无部分写入且容量不超限。

Given 角色变化，When 使用旧会话，Then 按最新角色与有效期授权，审计保留操作人、原因及前后值。

## Implementation Notes

- 锁定 NestJS12.3.3、Prisma CLI8.0.0-rc.30/MySQL库8.0.0-rc.22、Vue3.5.44、Vite7.3.7。Prisma8 MySQL官方仍为early preview，不支持ORM写入和SQL builder行锁；使用其参数化raw SQL与transaction。容量条件UPDATE、容量行与账号行no-op UPDATE在数据库串行化，无进程内锁。实际DDL含JSON、UTC DATETIME(3)、唯一约束、外键与CHECK。
- Prisma8契约包含8张表完整字段并已emit；SQL迁移为DDL权威，未启用preview schema marker（verifyMarker:false），后续迁移须同步契约。未降级Prisma7。
- 同一微信允许绑定多个独立账号，选择账号后每个会话仍只有一个角色。回收/停用保留原账号池占用，避免通过多次回收绕过容量；历史账号与审计不删除。
- 微信生产实现只调用code2session，测试依赖注入替代交换服务，无开发登录后门。小程序角色入口明确标注后续史诗能力；首页查询真实空表返回0/空列表。
- 部署提供Compose、环境模板和幂等初始化；原有scripts菜单未修改。没有人工否决记录。

## Spec Change Log

- 2026-11-04：用户要求停止后续测试、完成BMAD收尾；保留已有测试文件与实际结果，不再执行构建、测试或审计。冻结意图未修改。

## Review Triage Log

2026-11-04 实施交接后修复：改密错误按既有5错/10分钟策略持久化失败时间与IP，表单错误400不撤销有效会话；所有会话签发统一检查锁定与活动当前结束时间；名单按不可变pool识别已回收学生且每人独立盐；初始化管理员拒绝非管理员标识冲突；小程序403保留退出入口，绑定401保留表单；同微信多账号返回本人标识并拒绝外来accountId；补活动列表全部排除条件与回归用例；API运行镜像安装排除开发依赖。

仅针对改动文件执行的客户端5/5、MySQL集成10/10已在用户停止验证指示到达前结束。收到“不要测了，完成BMAD内容”后停止所有后续测试、构建、审计；之后仅补充一条保留学号断言及本记录，未再执行验证。Docker安装参数变更未实际构建，整体修复未进行新的全量验证。

| 编号 | 判定 | 证据与处置 |
|---|---|---|
| B1 | medium | changePassword 的错误原密码直接抛401，未累计失败；已登录会话可无限猜测。patch：复用失败计数、锁定和审计。 |
| B2 | medium | loginWechat 一键路径只调用 assertActive，未检查 lockedUntil；五次失败后仍可签发会话。patch：统一登录锁定检查。 |
| B3 | medium | 两个登录路径均未查询活动当前 endsAt；提前结束后仍返回成功，authenticate 才403。patch：签发前检查当前活动。 |
| B4 | medium | importRoster 按 role 排除已存在学生，REVOKED 学生被误判冲突。patch：按不可变 pool 判断。 |
| B5 | low | 导入前只生成一次加盐哈希，整批共用盐。patch：每个新账号独立生成哈希。 |
| B6 | medium | seedAdmin 遇任意同标识账号静默退出，错误配置会误报初始化成功。patch：验证已存在账号为管理员。 |
| B7 | medium | 管理端所有401都清空会话，改密原密码输错导致退出。patch：错误原密码使用表单错误状态，保留有效会话。 |
| B8 | medium | 小程序首页错误时 account 为null，切换按钮也被隐藏；无恢复入口。patch：按钮置于账号条件外。 |
| B9 | low | 过期会话确实未清理，但TTL校验拒绝使用，30人规模下未显示日常存储或查询故障；拒绝增加清理分支与迁移，后续有容量证据再处理。 |
| B10 | medium | 同微信两个同角色账号的选项仅显示相同角色，无法区分。patch：显示本人账号标识并测试选择。 |
| E1 | medium | 与B8同根因：停用、回收、到期时首页无退出入口。合并B8修复，保留本行证据。 |
| E2 | medium | 小程序request在绑定401时reLaunch，丢失登录页错误与输入。patch：登录接口401保留当前页面。 |
| E3 | medium | 与B4同根因：回收学生role不再为STUDENT，导入整批冲突。合并B4修复。 |
| E4 | medium | 与B3同根因：activity结束提前于账号快照时登录仍成功。合并B3修复。 |
| V1 | medium | 测试标题虽称账号选择，但从未返回selectAccount或提交accountId；缺少同微信多账号选择及外来账号拒绝。patch：补客户端与MySQL断言。 |
| V2 | medium | 活动查询仅测试空表和单条匹配数据，删掉任一过滤条件仍可通过。patch：补混合候选数据、逐条件排除及精确ID断言。 |
| P1 | medium | API镜像在设置NODE_ENV前执行npm ci，默认包含存在告警的CLI开发依赖；生产审计省略dev不能证明镜像已排除。patch：运行镜像安装显式加入--omit=dev。 |

以上patch均已完成源码修正；B9为拒绝项，没有另行延期的评审条目。用户停止指示优先于技能复测要求，本次按用户要求完成收尾；sprint故事保留review，供人工验收。

## Verification

2026-11-04实际执行：Node24.19.0/Windows、本机隔离MySQL8.4.13，datadir在工作区忽略目录、端口13306，测试后关闭独立实例，不改用户原服务。

- `npm run build`：API所有mjs语法检查、Vue/Vite生产构建通过；Element Plus整包约971KB，存在chunk>500KB提示。
- `npm test`：7/7通过，覆盖密码、CSV、授权、微信适配与后台/小程序关键流程。
- `TEST_DATABASE_URL=.../identity_test npm run test:mysql`：9/9通过，无跳过。真实Nest HTTP + MySQL事务测试覆盖首次改密、失败锁定/IP/时间、非法导入零部分写、19人后并发争末位、20人逐个绑定/本人隔离、两微信并发抢绑、11个职员并发上限10、即时角色/停用/活动到期、审计与独立连接持久化。
- Prisma8 `contract emit`通过；迁移、初始化管理员在真实MySQL执行。
- `npm audit --omit=dev`：0漏洞。开发依赖Prisma CLI/Composer传递链仍有17项告警（5 moderate/12 high），未做破坏性强制升级。
- 未执行：Docker/Compose实际启动（未安装Docker）；真实微信code2session/开发者工具/真机（未提供凭据和工具）；浏览器端视觉验收。全平台NFR-3账本库存仍属后续史诗。

安装锁定依赖后执行构建、单元/API及MySQL集成测试；记录实际结果。验证NFR-1账号容量与持久化、NFR-2隔离与敏感字段、身份模块事务一致性；全平台NFR-3账本库存验收留待后续。微信真机与Docker运行无法执行时明确列出限制。
