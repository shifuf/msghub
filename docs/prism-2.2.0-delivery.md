# 棱镜 2.2.0 与消息平台交付记录

## 已实现

- 原生页面和 HTML 主页统一 iOS18 风格，使用线性 SVG/同源 VectorDrawable；全局浅深主题、分组卡片、标题摘要、搜索、空状态和动画。
- 主页、浏览工具栏、菜单、多标签、设置、书签、历史、下载、脚本、规则、资源嗅探、网络日志、消息中心与公共弹窗全部覆盖。第三方网页和 Android 系统输入法由各自负责。
- 菜单按窗口与字体自动减列并滚动，横屏消息页收起大标题；聊天键盘显示时收起原文，保留消息区与输入框。
- 消息中心搜索/未读筛选/实时刷新/连接诊断；独立会话凭证、双向回复、已读、持久草稿、失败重试和相同 UUID 幂等提交。
- 修复回复去重吞消息、回执损坏与跨来源混淆、SDK 初始化/RID 恢复、JPush alias/RID/all 目标选择、旧消息重发目标丢失及排队期间变更 AppKey 的错误投递。

## 本地验证

- Android：33 项单元测试通过；Debug/签名 Release 构建与 lint 通过。已有警告仍保留，未通过禁用 lint 消除错误。
- 平台：后台 105 项、网页 18 项，共123通过，零跳过；真实隔离 PostgreSQL/Redis/Nest HTTP/JWT/并发幂等/迁移通过，lint、typecheck、生产 build 通过。
- 独立审查发现6项具体问题并全部修复，记录 `.work/global-20261117/review.md`。
- 模拟器：浅/深主页、工具面板、分组设置、消息中心、横屏、320dp＋1.6倍字体已检查。联调确认键盘空间不足后另做紧凑布局与编辑保护，最终复测另见末尾。

## 服务器部署

服务器 `175.178.69.4`，域名 `https://msg.shifuf.com`。所有项目文件操作均在用户指定 `/www/wwwroot/msg` 内。同步应用源码、新会话迁移和 Web 构建；Compose 只更新 api/web，postgres/redis 和已有数据卷保持原样，未覆盖 `.env`。

备份目录：`/www/wwwroot/msg/deployments/20261117-2200`，含 `source-before.tar.gz`、`database-before.dump`、`env-before`、镜像编号、构建/部署日志。旧镜像保留 `msg-api:before-messaging-20261117`、`msg-web:before-messaging-20261117`。迁移只增加回复表，回退应用可保留该表。

## 真实线上联调

仅创建指向测试模拟器的临时 JPush 渠道，原业务渠道配置保持。联调消息 `cmwjvjcyo00021z0dsak0tmad`：

1. 平台 JPush 返回成功，模拟器接收到包含会话凭证的通知。
2. APP 打开会话，原通知已读时间成功写入线上数据库。
3. APP 发送 `Prism-test`，服务器保存设备回复；管理员读取后有已读时间。
4. 管理员通过 JWT 接口回复“服务器回复已到达，双向会话联调通过。”；极光接受，APP 实际收到独立回复通知并显示。
5. APP 读取后管理员回复产生已读时间；原通知/回复各存一条，没有重复吞消息。
6. 临时测试渠道停用，保留联调历史；未向原业务设备群发。

## 使用与范围

正式包版本 2.2.0 / versionCode33，沿用原项目签名，可覆盖安装。APK 下载：`https://msg.shifuf.com/downloads/prism-2.2.0.apk`；SHA256 下载：同地址追加 `.sha256`。

已连接实体手机仍为2.1.2，只读检查显示 `stopped=true`、通知权限开启、无运行进程。用户安装新版后需要打开一次，在消息中心检查“推送已连接/通知已开启”，核对设置中的 RID 与业务渠道是否一致。本任务没有安装实体手机。

厂商离线通道与系统强制停止不在本次模拟器验收结论中；不能承诺强制停止后必达。新版通知支持会话，升级前已送出的历史通知没有会话凭证。现有 `files.shifuf.com` 更新清单属于另一服务，本次未修改，使用以上下载链接安装。

截图与完整构建日志保存在 `.work/global-20261117`，实施前源码备份为该目录 `android-before.zip`。

## 最终包与键盘复测

- 最终 Release SHA-256：`849e341d4f6a775e2c817f83727140ceb16c1d9dd2fa4a4ebd2e43b8e229a273`。
- 签名证书 SHA-256：`ee3e1b62afd6605720f059f8ed7d1129f503f515f976360395e5d156ce66c14d`；apksigner verify 通过。
- 最终 `keyboard-final-build.log`：106项构建任务成功，包含33项测试、Debug、Release和lint。
- 重新安装最终 Debug 到模拟器，键盘出现时原文隐藏、20sp会话标题、消息列表保留234px可见高度；详见 `chat-keyboard-fixed.png`。
- 输入 `Long-draft-1234567890-keep-all-characters`，等待状态轮询后文字仍完整；发送后线上数据库保存完整内容。发送期间继续输入的 `next-draft-stays` 保留，未被异步刷新清空。
- 最终APK已再次同步本地平台 public/downloads 与服务器同路径，并重新构建网页镜像；API与数据库无需再次更改。

最终在线验收：从公开下载地址完整下载APK并计算SHA256，与本地最终包一致；线上health的database/redis/worker全部up；数据库确认会话迁移已应用。本地隔离测试PG/Redis已停止。
