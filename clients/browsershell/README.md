# BrowserShell / 棱镜浏览器

这里保存与 `F:\浏览器\BrowserShell` 本次 2.2.3/code36 发布一致的 Android 源码，便于消息平台与接收端一起审阅和同步 GitHub `main`。`source-manifest.json` 记录每个同步源文件的 SHA-256；本地原工程继续位于原路径。

同步使用明确的文件目录清单，不收集 `.work`、构建缓存、日志、APK、设备凭据、`keystore.properties`、`jpush.properties`、`local.properties` 或签名私钥：

```powershell
python scripts/sync-browsershell-source.py --source F:\浏览器\BrowserShell
```

构建需要 JDK 17、Android SDK 35，执行 `gradlew :app:testDebugUnitTest :app:assembleDebug :app:lintDebug`。发布构建还需要在本机提供 gitignored 的 `keystore.properties`，继续使用已有签名；新建密钥无法覆盖安装正式版本。JPush AppKey 是客户端应用标识，服务端 Master Secret 不得放入客户端。

APK 仍通过原统一文件平台的固定文件与更新清单发布。消息平台不提供新的 APK 下载入口。设备关联、通知权限和到达回执说明见 [Android 交付记录](../../docs/browser-delivery-2.2.3.md)。
