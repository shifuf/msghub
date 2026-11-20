# 2.2.3 设备关联与到达回执交付

本地构建完成，发布由消息平台主任务统一执行。版本 `2.2.3 / code36`，包名 `com.shifuf.prism`，保留原正式签名。Android 子任务未向业务设备发送推送，也未发布 APK 或清单。

## 本地交付物

- APK：`F:\浏览器\BrowserShell\dist\prism-2.2.3.apk`
- 校验文件：`F:\浏览器\BrowserShell\dist\prism-2.2.3.apk.sha256`
- 大小：8,228,472 字节。
- APK SHA256：`10a63da97f1b7fb5e5fcb32301108fe66881c26c25c5682063017f4d0c47a888`
- 签名证书 SHA256：`ee3e1b62afd6605720f059f8ed7d1129f503f515f976360395e5d156ce66c14d`

## 本轮变化

1. 设置新增“关联消息设备”和“通知权限”。网页一次性 16 位十六进制配对码通过固定消息平台交换设备凭据；凭据经 AndroidKeyStore AES/GCM 加密保存。首次请求 Android 13+ 通知权限后记录已请求，避免重启反复弹出；拒绝后提供系统设置入口。
2. SDK 实际回调到达后先持久化 `displayed=false` 回执，按自身 RID 读取独立的 `receivedToken` 或 JSON 字符串 `receivedTokens`。已读和会话凭据不充当到达签名。
3. 只有系统活动通知中的确切通知 ID 才将状态升级为 true。极光 notification 不补本地通知，custom 消息保持原本地通知路径。推送开关关闭时不产生新到达证据，重新检查连接不擅自开启开关。
4. 回执 outbox 使用文件锁、fsync、原子替换和幂等单调更新；旧 false 确认不会清除新的 true 证据。落盘/托盘观察与慢 HTTP 请求使用独立执行器，广播只进行一次 goAsync。离线回执在进程内指数重试，并以持久化、需网络的 JobScheduler 任务恢复；应用启动/前台、网络变化、开机/解锁和 SDK 状态变化也触发恢复。
5. 将 JPush 初始化提前到浏览器重负载初始化之前；注册、连接、通知权限和渠道状态可发送设备心跳。401 撤销本地关联。日志和诊断不显示 RID、设备 token、消息签名或正文；设备凭据只发送到固定 HTTPS API，并禁止跟随 HTTP 重定向。

## 验证证据

最终源码运行：

```text
.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:assembleRelease :app:lintDebug --console=plain
BUILD SUCCESSFUL in 2m 18s
106 actionable tasks: 29 executed, 77 up-to-date
```

- 54 项单元测试，0 失败、0 错误、0 跳过。包括协议/签名隔离、JSON 字符串多 RID 签名选择、配对码格式、通知权限策略、持久化队列重开、状态单调性、损坏恢复、陈旧确认以及网络线程阻塞时回执仍能落盘。
- lint 0 错误、365 警告；未宣称工程无警告。原交付记录为 362 警告，本轮新增警告主要是凭据撤销使用的同步落盘和冗余 SDK 条件。
- `aapt dump badging` 确认包名、versionCode36/versionName2.2.3、minSdk26/targetSdk35；`apksigner verify --verbose --print-certs` 通过，证书与旧正式包一致。
- APK ZIP 1005 项，未混入 `.work`、源码备份、构建日志、签名密钥、keystore.properties、运行时回执或设备凭据数据。
- 主任务对 DevicePlatformClient、DeviceSyncJobService、DeviceReceiptQueue 和 PrismPushMessageReceiver 做了独立只读审阅，确认固定 API/禁跳转、持久化队列、陈旧确认保护、单次 goAsync、实际托盘判断及推送开关处理。
- 验证日志：`.work/notify-20261120/android-delivery-verification.log`。源快照：`.work/notify-20261120/source-before.zip`。测试前失败与通过记录分别为 `android-receipt-regression-red.log` 和 `android-receipt-regression-green.log`。

当前没有连接的可运行 Android 设备。普通模拟器启动缺少 Android Emulator Hypervisor Driver；软件模拟器持续 adb offline，已停止本任务启动的实例。此包没有完成新版本真实设备上的配对、通知栏、系统后台调度或极光端到端运行验收；构建和单元测试不能证明目标手机收到消息。

## 心跳含义

心跳按事件触发，没有每 30 秒或每 90 秒唤醒的周期任务。事件包括配对、SDK 初始化/注册/连接变化、恢复连接、推送开关、应用和设置/消息中心进入前台、默认网络可用、开机/更新/解锁。后台任务用于重试尚未确认的请求。

服务端 `lastSeen` 表示最近报告时间，不能因为后台 90 秒无新报告就断言设备离线。适合展示“最近报告时间”与“上次报告的极光连接/通知权限”；缺少近期报告时显示“状态待刷新”。

## 统一发布身份

后续发布应对原 APK 文件覆盖更新，保留下载与分享身份；先上传并从公开地址下载校验实际 APK，再以当前 expectedVersion 编辑原 update.json：

- APK fileId：`cmwjiknlk00btp701r9ywlpgf`（发布前 revision4）。
- update.json fileId：`cmwjeiabq00aup70123qkc1bb`（发布前 revision8）。
- 固定 APK URL：`https://files.shifuf.com/api/public/files/cmwjiknlk00btp701r9ywlpgf`。
- 原清单分享：`https://files.shifuf.com/api/shares/3dbee7604cd35487ad62484879376dfb70659f331f4b3b72`。
- 清单沿用现有 mandatory=true 策略，版本和 sha256 使用本次实际值。消息平台不承载 APK 下载。

以上发布信息为交付时计划，不能作为已经发布的证明。实际公开 revision、哈希与部署验收由主任务记录。
