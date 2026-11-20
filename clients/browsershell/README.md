# BrowserShell / 棱镜浏览器

这里保存 `F:\浏览器\BrowserShell` 的 Android 源码，便于消息平台与接收端一起审阅。`source-manifest.json` 记录当前源码的版本和逐文件 SHA-256；它不是线上更新清单。本次同步的是 2.2.4/code37 候选源码，线上 APK 仍为 2.2.3/code36，等待 Android 设备上的浏览和覆盖升级验收。

同步使用明确的文件目录清单，不收集 `.work`、构建缓存、日志、APK、设备凭据、`keystore.properties`、`jpush.properties`、`local.properties` 或签名私钥：

```powershell
python scripts/sync-browsershell-source.py --source F:\浏览器\BrowserShell
```

构建需要 JDK 17、Android SDK 35，执行 `gradlew :app:testDebugUnitTest :app:assembleDebug :app:lintDebug`。发布构建还需要在本机提供 gitignored 的 `keystore.properties`，继续使用已有签名；新建密钥无法覆盖安装正式版本。JPush AppKey 是客户端应用标识，服务端 Master Secret 不得放入客户端。

网页状态、导航和音频嗅探的设备检查见 [运行验收手册](docs/browser-runtime-qa.md)。[持续开发清单](docs/continuous-development.md) 记录参考范围与待验证项。

APK 仍通过原统一文件平台的固定文件与更新清单发布。消息平台不提供新的 APK 下载入口。设备关联、通知权限和到达回执说明见 [Android 交付记录](../../docs/browser-delivery-2.2.3.md)。
