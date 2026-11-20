# 网页状态与音频嗅探运行验收

使用 [本地测试夹具](../tools/browser-qa-fixtures.py) 验收网页状态、导航回调和音频嗅探。夹具仅监听电脑的 `127.0.0.1`，只依赖 Python 标准库，测试音频在启动时合成。

## 没有 Android 设备时

在项目根目录启动服务，保持终端运行：

```powershell
python .\tools\browser-qa-fixtures.py
```

电脑浏览器打开 `http://127.0.0.1:18765/` 可查看页面和播放样本；也可用 HTTP 客户端核对状态、重定向和类型：

```powershell
curl.exe -i http://127.0.0.1:18765/status/503
curl.exe -i -L --data "fixture=redirect" http://127.0.0.1:18765/post-redirect
curl.exe -I http://127.0.0.1:18765/media/stream
```

分别应看到有响应正文的 503、`307` 后保留 POST 和表单数据的 `503`、以及无文件后缀但类型为 `audio/wav` 的资源。电脑端检查只能证明夹具可用，无法验证安装、Android WebView 回调、界面状态、播放器或下载行为。

## 有测试机或模拟器时

使用本次变更构建出的 APK。本项目 debug 与正式版共用包名 `com.shifuf.prism`，不同签名无法覆盖安装；遇到签名或版本冲突，换用干净的测试设备，避免卸载设备上的正式版或清除它的数据。将变量替换为 `adb devices -l` 中状态为 `device` 的测试设备序列号：

```powershell
adb devices -l
$prismQaDevice = "emulator-5554"
adb -s $prismQaDevice install -r .\app\build\outputs\apk\debug\app-debug.apk
adb -s $prismQaDevice reverse tcp:18765 tcp:18765
```

在棱镜打开 `http://127.0.0.1:18765/`。若通过 `--port` 改端口，同步修改 reverse 和网址。

| 操作 | 检查点 |
| --- | --- |
| 依次打开 `HTTP 200`、`HTTP 404` 和 `HTTP 503` | 200 提示 HTTP 未加密。404 和 503 保留夹具正文；状态说明显示对应错误码。点开说明测试重试和返回主页。 |
| 从首页点 `HTTP 204 (no content)`；再点 `Open HTTP attachment` 并取消下载 | 两次都应保留原页面及其地址、状态，进度结束，无新下载。 |
| 打开 `HTTP 200 with a broken image` | 图片请求返回 404，主页面仍显示 HTTP 200 对应的连接状态。 |
| 打开 `Same document history`，点 `Push state`、`Add fragment`，连续按两次 Android 返回 | 地址依次加入新路径及查询参数、添加片段，再逐步退回 `/spa`。HTTP 状态保持稳定。 |
| 打开 `POST navigation`，分别点 `POST to this URL` 和 `POST through HTTP 307`（两次之间回到表单页） | 不改地址的 POST 和经 307 保留 POST 的请求最终都显示 503，不被加载完成覆盖；正文分别标出收到的路径与 `same`／`redirect`。 |
| 在两个标签分别打开 200 与 503，相互切换再刷新；随后停止夹具并重载 200 页，重启夹具后点重试 | 同一时间只显示活动标签的状态。停止服务是主页面网络错误，重试成功后恢复 HTTP 状态。 |
| 打开 `Audio: direct and typed`，播放两段 WAV，再从菜单或设置打开资源嗅探 | `track.wav?fixture=direct` 和无后缀的 `stream` 都列为 WAV；普通脚本、图片、页面不入列表。重播或拖动进度不会增加同一 URL 的条目。从嗅探页试外置播放与下载，确认 `audio/wav` 可打开、扩展名正确；没有支持 HTTP WAV 的外置应用时应有明确提示。 |
| 两个标签打开完全相同的 `/tabs`，分别点 `Play cue A`、`Play cue B`；切换并打开资源嗅探，再关闭一个标签 | 各标签只显示各自的 `cue-a.wav` 或 `cue-b.wav`。关闭一个标签不会清空另一个。另将保留的标签导航到 `/audio` 或重载 `/tabs`，确认旧资源不混入新文档。 |
| 从有媒体记录的标签打开无法连接的地址，或停止夹具后重载同一页，然后打开资源嗅探 | 列表隐藏旧媒体，另一标签的列表不变。用 204 或附件取消对照，应回到原网页并仍可查看它的媒体；已失效的嗅探选项不能继续下载。 |

结束时在电脑终端按 Ctrl+C。使用完毕可移除这条转发：

```powershell
adb -s $prismQaDevice reverse --remove tcp:18765
```

本夹具不提供 TLS 或视频。另用可控的有效 HTTPS 和无效证书页面，确认加密状态和证书错误，且无绕过校验入口；从已有网页导航到被拒绝的证书站点，如果旧网页仍在屏幕上，按返回应恢复该网页的地址和状态，不应直接退出或跨过它。用已知可播放的视频直链检查原有视频嗅探、外置播放和下载。记录设备型号、Android / WebView 版本、APK 版本、可用播放器、各项结果及发现的问题。未在设备上完成的项目保持待验收；此流程不涉及推送或发布。
