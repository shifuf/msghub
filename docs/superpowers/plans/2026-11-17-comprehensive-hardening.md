# MsgHub 与 BrowserShell 全面修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复审查报告 28 个问题主题，交付可靠的通知/回执、恢复、备份、质量门禁与相关管理功能。

**Architecture:** 保留 NestJS/Prisma/Postgres/BullMQ/Vue 和 Android Kotlin 架构。用显式状态、原子数据库操作、稳定任务标识、服务端已读和兼容接口渐进修复。用户已明确授权全部处理和并行开发，按现有报告执行，不再请求流程确认。

**Tech Stack:** TypeScript、Node、Vue、PostgreSQL、Redis、Kotlin/Gradle。

**Spec:** `docs/全面审查报告-2026-11-17.md` 与用户要求“全部处理”，浏览器路径 `F:\浏览器\BrowserShell`。

## Global Constraints

- 不发送真实通知、不重置现有凭据、不操作真实业务数据库；集成验证使用临时隔离数据库。
- 不回退现有未提交内容。消息平台在专用修复分支工作，浏览器非 Git 文件在修改前备份。
- 主线程独占 Prisma schema、迁移、根依赖/锁文件、Docker、备份与模板管理；子任务需要字段/依赖时发送明确申请。
- UI/接口保持兼容，等待时间新增 Minutes 别名但保留历史 Hours 的分钟语义。
- 不把 SMTP 接受当作已读，不宣称外部网络 exactly-once；不把附条件的多租户/短信当作无需求即必须新增。

## Review Focus

- 发出外部请求后数据库/进程失败：需要保留可审计的不确定状态，不盲目重复发送。
- 改密与 SSE 长连接：旧会话和非管理员票据不能绕过鉴权。
- 备份同名对象、重复导入、缺失引用：必须拒绝/明确映射，不降级全局。
- 浏览器离线点击、重复推送、多条设备消息：回执应持久重试且不能泄露令牌到不可信地址。
- 取消/恢复/清理和 worker 并发：只按状态条件推进，不能清理活跃投递。

## Tasks

### 1. 安全与认证（agent）
- [ ] 为弱密钥、旧会话、结构化异常、IP 映射地址编写失败用例。
- [ ] 修复 auth、realtime 鉴权、common/http-exception.filter、common/env、adapters/http.util、main、限流、活动清理。
- [ ] SSE 使用短期票据；与前端约定 POST `/admin/realtime/ticket` 返回 `{ticket,expiresIn}`，GET stream 使用 `ticket`。
- [ ] 增加可选 TOTP 与会话撤销（字段由主线程协调）；出站请求使用经过验证的 DNS 地址，限制响应大小。
- [ ] 运行针对性回归与 API 构建并交审。

### 2. 投递、定时与配额（agent）
- [ ] 将对应复现转成真实期望的失败测试。
- [ ] 负责 messages、queue、schedules、email-policy、channels、projects、quiet-hours、token.util、idempotency 与 openapi。
- [ ] 修复异常兜底、原子配额、租约恢复、取消竞争、错过执行、清理/CSV、模板变量、已读/兜底语义、时间别名。
- [ ] 定时任务编辑/暂停/恢复、分页；持久待发送恢复、稳定 jobId 和幂等所有者；不产生真实健康测试通知。
- [ ] 清理预览、保留策略、接入 dry-run 和发送时间线；运行回归与构建并交审。

### 3. Web 与 Android 通知（agent）
- [ ] 修复 HTML 预览隔离、类型错误、通知已读和状态变更提醒。
- [ ] 负责 web/src、web/package.json（只改 scripts，不改依赖）、API dashboard/realtime.service 的同步协议需协商。
- [ ] 接入短期 SSE 票据、断线补拉、服务端 readAt、分页通知游标。
- [ ] 检查 BrowserShell push/界面回执链，备份后修复离线重试、重复点击、来源校验与状态展示；不修改不相关浏览功能。
- [ ] 增加新后端能力对应的管理入口（备份预览、任务控制、保留策略、模板版本等由主线程发契约）。
- [ ] Web 类型/构建/行为测试，Android 单元测试和打包，交审。

### 4. 数据、备份、模板与运维（主线程）
- [ ] 统一新增字段与向前迁移，处理全局唯一索引并保留重复数据审计副本。
- [ ] 重写版本化备份：稳定 ID、严格引用、事务、dry-run、幂等任务、伙伴链接、完整兜底配置、脱敏/密码加密。
- [ ] 模板版本历史/回滚与草稿发布、必要变量 schema；协调投递验证。
- [ ] 统一 seed、锁定 Docker 构建、初始化检查、health readiness、清理/查询聚合。
- [ ] 升级受影响依赖并添加 test/typecheck/lint/CI，复核剩余依赖公告。

### 5. 整合与验收
- [ ] 审核每个任务 diff，修复接口不匹配，审查新增安全边界。
- [ ] 运行后端全部测试、Web typecheck/build、浏览器测试/build、Prisma validate、依赖审计。
- [ ] 准备隔离 PostgreSQL/Redis 进行迁移、并发、幂等、备份 roundtrip、重启恢复测试；不可用的环境明确记录。
- [ ] 将 28 项逐条更新为已修复/验证状态，记录新功能入口、升级步骤与真正未验证的限制。
