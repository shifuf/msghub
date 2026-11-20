# 会话收件箱与恢复验证（2026-11-20）

本记录覆盖会话 API、收件箱、历史分页、状态切换、实时更新，以及清理和敏感通知脱敏对活动会话的保护。实现尚未由本子任务提交或部署；生产构建、整仓验证和发布由主任务统一执行。

## 行为与接口

- `GET /api/admin/conversations` 使用管理员 JWT，支持 `status=open|closed|all`、`unread=true|false`、`search`、`page` 和 `pageSize`。列表按最后活动时间和 ID 倒序，返回当前筛选的总数、分页结果和所有会话的设备未读回复总数。
- `PATCH /api/admin/conversations/:id` 使用 `{status:'open'|'closed'}` 关闭或重开会话。关闭操作和新回复插入都锁定同一 `MessageLog` 行，先提交的关闭会阻止新 UUID 回复。已经保存的同 UUID、同内容重试仍返回原记录。
- `GET /api/admin/messages/:id/conversation?limit=50&before=<reply-id>` 返回一页历史，包含 `hasOlder` 和 `nextCursor`；既有 `/api/messages/:id/conversation` 别名继续可用。游标必须属于本会话，历史使用 `(createdAt,id)` 稳定排序。只标记本次返回的对端回复已读。
- 会话响应保留 `messageId/title/content/replies/canReply`，新增 `status/closedAt/activityAt/hasOlder/nextCursor`。公开读取、公开回复和管理员回复接口继续使用现有凭证和 UUID 契约。
- 管理员回复先保存，再调用服务商。设备回复为 `STORED`；管理员回复使用 `PENDING/ACCEPTED/FAILED/UNCERTAIN`。`ACCEPTED` 仅代表服务商受理。
- 会话读取把超过两分钟的 `PENDING` 回复改成 `UNCERTAIN`，保留内容和 UUID。近期 `PENDING` 与已经 `ACCEPTED` 的记录保持原状态。重复 UUID 不触发再次推送。
- `conversation` 实时事件仅包含回复、已读或状态的元数据，不携带内容、凭证或推送配置。收件箱和详情接收事件刷新，详情和列表另以十秒 HTTP 轮询补偿。侧栏未读数在初始化、SSE 事件、重连和十二秒全局补偿时从服务端重取；退出登录后的迟到响应被丢弃。
- 前端保留未确认回复的草稿和 UUID，关闭、重开、刷新和网络重试不会替换同一提交的 UUID。历史可继续向前分页加载。

## 清理与脱敏

`MessagesService.excludeActiveReferences` 同时服务于手动清空、清理预览、条件清理和自动消息保留期。已有活动但未关闭的会话根记录受保护；任何 `PENDING` 或 `UNCERTAIN` 回复也会阻止根记录删除，即使会话已关闭。原有排队通知、活动计划引用和 `DELIVERY_UNKNOWN:` 保护继续生效。

`RetentionService` 对敏感模板脱敏时使用同样的会话条件，并在写入时再次校验。活动会话和未解决回复的原文、目标快照及会话信息得以保留，设备仍可读取并继续回复。已关闭且没有未解决回复的记录可以按既有策略清理或脱敏。未解决记录不会因普通保留期自动消失。

## 本地证据

数据库全部使用显式的隔离连接 `postgresql://audit@127.0.0.1:56487/msghub_audit?schema=public`。测试使用假服务商适配器或不发送的设备回复路径，没有真实外发。

| 验证命令 | 结果 |
| --- | --- |
| `node --test tests/conversation-http.integration.test.cjs tests/conversation.test.cjs`（设置上述 `AUDIT_DATABASE_URL`） | 23 项通过，0 失败，0 跳过 |
| `node --test tests/conversation-retention.integration.test.cjs tests/delivery-database.integration.test.cjs tests/retention.test.cjs`（同上） | 10 项通过，0 失败，0 跳过 |
| `node --test apps/web/tests/notify.test.cjs apps/web/tests/conversation.test.cjs apps/web/tests/conversations-view.test.cjs` | 16 项通过，0 失败，0 跳过 |
| `node --test scripts/delivery-regression.test.cjs` | 34 项通过、1 项失败；清理相关测试均通过，失败的旧计划测试见下文 |
| `git diff --check` | 通过；仅有仓库既有换行转换提示 |

新增真实 PostgreSQL 回归先确认缺陷再修复：清理原本会匹配/删除 5 条记录，应仅删除 2 条；敏感脱敏原本会覆盖活动会话；修复后两种路径均保留活动和未解决记录。真实数据库另验证待处理回复转不确定、同 UUID 不重发，以及脱敏后设备继续读取和回复。前端新增回归先复现 SSE 漏事件后计数不恢复、退出后迟到响应写回计数，再验证修复。

上一次记录中的公开回复 500 在当前生成客户端和数据库结构下未复现：临时诊断副本及未改动的原 HTTP 测试均完整通过。没有针对该未复现错误增加推测性补丁，诊断副本已移除。

本子任务没有完成整仓 `check`、API 类型检查或生产构建；主任务要求统一串行执行。启动过的整合类型检查在主任务接管后中止，Web 分支当时已经结束，不能据此声称整个工作区通过。

共享投递回归失败项为 `scripts/delivery-regression.test.cjs` 中的 `overdue daily task skips missed occurrences`：计划模块新实现调用 `$transaction`，该旧测试的 Prisma 替身没有提供，错误位置为 `SchedulesService.executeOne`。同次运行另有替身缺少 `scheduleExecution.updateMany` 的计划 tick 警告。已交给主任务同步计划范围测试；本子任务未改动计划实现或该旧测试。

## 发布后待验证

1. 先确认会话表和 `conversationActivityAt/conversationClosedAt` 增量迁移已应用，历史会话活动时间已回填。
2. 使用两个管理员浏览器会话检查新回复、已读、关闭和重开能经认证 SSE 更新；断开 SSE 后检查列表、详情和侧栏计数由 HTTP 补偿恢复。
3. 用明确指定的测试设备验证一条新通知的双向回复、原始目标、已读及同 UUID 重试；把服务商受理与真机收到分别记录。
4. 使用清理预览检查开放且有活动的历史会话、已关闭但含 `PENDING/UNCERTAIN` 回复的会话不进入匹配范围。敏感模板脱敏策略同样保留这些记录。
5. 在发布后的实际页面核对搜索、未读筛选、分页、详情历史加载、草稿恢复、关闭和重开，以及侧栏未读入口。生产密钥、实际投递和厂商离线能力不属于本地假服务商测试的证据。
