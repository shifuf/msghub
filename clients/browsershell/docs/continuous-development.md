# 棱镜浏览器持续开发待办

优先改善日常浏览中可见、可复测的问题。X 浏览器是功能对照，QQ Android 是视觉参考；棱镜仍使用自己的名称、图标、主题和交互。网页状态灯与音频嗅探已进入同一候选版本，Android 运行验收仍开着。下一批先修脚本自动执行范围，同时准备真实设备上的地址栏视觉检查。

## 参考与证据边界

- **X 浏览器**：以 [官方简介][x-intro]、[帮助目录][x-docs] 和官网链接的 [Google Play 商品页][x-play] 为准，Android 包名 `com.xbrowser.play`。功能描述来自公开文档；[v5.7.0 更新日志][x-release]（2026-11-12）可作为近期行为的线索。文档没有规定棱镜网页状态指示器的样式，也不能证明任何功能在每个渠道和设备上的实际可用性。
- **QQ 浏览器 Android 版**：参考 [QQ 浏览器手机版官网][qq-mobile] 和 [腾讯应用宝商品页][qq-android]，Android 包名为 `com.tencent.mtt`。2026-11-21 查阅时，应用宝列出 `20.8.0.0035`，标注于 2026-11-17 更新。[宣传图 2][qq-shot2] 的视频翻译场景可见圆角地址栏、居中的 `cgtn.com` 与刷新入口；[宣传图 3][qq-shot3] 仅在 AI 搜索场景示出后退、前进、菜单、主页和标签数。截图未展示展开的标签总览、菜单、错误页、深色主题或读屏表现。后续逐屏记录需注明 Android、浏览器版本、主题和页面。棱镜下一项地址栏改进优先显示主机名（含非默认端口），点按仍可编辑完整网址。
- **棱镜**：表中“现状”来自 `app/src/main` 的代码阅读。README 的版本和功能措辞有历史内容；判断实现范围以源码为准，判断安装或发布状态以对应的实测或交付证据为准。

## 当前候选版：网页状态指示器、音频嗅探与下载（设备验收待补）

让地址栏说明当前网页是在加载、已建立 HTTPS 加密连接、使用未加密 HTTP，还是遇到网络、证书或 HTTP 4xx／5xx 错误。入口与现有加载条分工：加载条显示进度，状态图标及说明帮助用户判断下一步。见 [本批设计](superpowers/specs/2026-11-21-webpage-status-indicator-design.md)；相关代码包括 [状态分类](../app/src/main/java/com/shifuf/prism/core/PageLoadStatus.kt)、[WebView 回调](../app/src/main/java/com/shifuf/prism/core/BrowserController.kt)、[标签状态](../app/src/main/java/com/shifuf/prism/core/TabManager.kt) 与 [地址栏](../app/src/main/java/com/shifuf/prism/MainActivity.kt)。

- [ ] 用可控测试页面覆盖普通 HTTPS、HTTP、404、503、网络断开和无效证书。检查状态、点击后的说明，以及错误时的“重试”和“返回主页”。HTTPS 文案只说明连接加密；无效证书应中止连接且不提供跳过校验的操作；HTTP 错误应保留网站返回的页面。
- [ ] 在两个标签间切换，依次触发刷新、重定向、返回、取消加载和子资源失败。确认地址栏只反映当前标签的主页面；旧回调不会覆盖新状态，取消或失败后加载进度不会卡住。
- [ ] 主页和地址编辑态不显示网页状态；确认窄屏、浅色／深色、大字体与读屏时仍可识别状态、访问说明并正常使用地址栏。
- [x] 2.2.4/code37（RC2）：19 组 JUnit，121 项通过，0 失败、错误、跳过；Debug 和 Release APK 构建成功，lint 0 错误、359 条警告。签名证书与已交付的 2.2.3 一致。RC2 修复了失败后恢复原页资源、地址含括号以及 WebView 规范化 `../` 后状态不结束的问题，替代最初的候选包。
- [ ] 按 [运行验收手册](browser-runtime-qa.md) 使用 ARM64 Android 设备检查网页状态、音频播放、双标签隔离、下载及覆盖升级。当前 ADB 没有在线设备，现有 x86_64 软件模拟器未能获得 ADB 连接。线上仍为 2.2.3/code36。

## 后续优先级

| 批次 | 能力与棱镜现状 | 完成条件 | 参考与平台约束 |
|---|---|---|---|
| P1 · X-01 音频嗅探 | 2.2.4 候选版的 [ResourceSniffer](../app/src/main/java/com/shifuf/prism/core/ResourceSniffer.kt) 已支持常见 HTTP(S) 音频扩展名与明确的音频 MIME；[嗅探页](../app/src/main/java/com/shifuf/prism/ui/SnifferActivity.kt) 随标签和文档切换，按媒体类型发起外置播放和下载。 | 在 Android 用固定样本验证：音频与视频继续可用；图片、脚本和普通页面不入列表；切换标签后不会串页，相同文档重复 URL 只有一项；播放和下载使用正确类型。 | [X 官方简介][x-intro] 提到视频／音频。仅支持 WebView 可观察的资源；DRM 和分段合并另议，得到播放列表地址不代表已下载完整媒体。 |
| P1 · X-02 脚本运行与兼容 | [脚本管理](../app/src/main/java/com/shifuf/prism/ui/ScriptsActivity.kt) 支持导入、输入 URL 安装和订阅。当前 [解析器](../app/src/main/java/com/shifuf/prism/script/UserscriptParser.kt) 忽略 `@include`，没有 `@match` 的脚本会回退到全站；主机通配符还可能跨到路径。 | 先验证 `@include`／`@match` 有明确网页范围、`@exclude` 优先、无有效范围不自动运行。在受控样本上再覆盖启停、注入前仍处于正确文档、订阅更新及 GM 行为。帮助如实说明执行时机、存储、通知和网络限制。 | [X 油猴安装流程][x-install] 支持直接打开脚本 URL；[普通脚本说明][x-normal] 和 [GM API 参考][x-api] 描述更多入口与 API。依赖资源、菜单型脚本与完整 GM 行为仍待交付。 |
| P2 · X-03 广告规则覆盖 | [订阅引擎](../app/src/main/java/com/shifuf/prism/adblock/AdBlockEngine.kt) 支持 EasyList 子集、规则订阅与元素隐藏。 | 用固定规则和页面样本验收 URL 拦截、白名单、元素隐藏、订阅启停和更新；列出当前未支持的规则及最容易误匹配的场景。 | [X 广告拦截文档][x-adblock] 用于选案例；其兼容率和性能数字不作为棱镜的实测指标。 |
| P2 · X-04 外部下载与播放 | [下载页](../app/src/main/java/com/shifuf/prism/ui/DownloadsActivity.kt) 支持内置和 Android 系统下载；嗅探页已有外部播放器选择，未发现专用下载器绑定。 | 先用可控慢响应复现暂停、立即继续、重试旧任务时的写入冲突，再修内置下载线程与续传验证。外部下载器验证一次性选择、默认选择、交接失败回退和本地记录保留；用固定样本区分播放列表与完整文件。 | [X 下载器教程][x-download]、[M3U8 教程][x-hls]。高级格式能力取决于用户另行安装的应用、公开接口和版本。 |
| P2 · X-05 个性化与快捷手势 | [设置](../app/src/main/java/com/shifuf/prism/ui/SettingsActivity.kt) 有主题、主页外观和搜索引擎配置；现有边缘手势绑定前进／后退。 | 先选一种能力单独交付，例如可配置边缘手势。测试默认值、自定义、重启保留与恢复默认，并检查系统返回和页面横向滑动。自定义菜单与地址栏位置各自安排。 | [X 官方简介][x-intro] 描述自定义手势、菜单和搜索栏位置；Android 手势导航、输入法、横屏和大字体影响实际布局。 |
| P3 · X-06 隐私设置 | 无痕模式跳过部分历史、会话写入；现有 [WebView 回调](../app/src/main/java/com/shifuf/prism/core/BrowserController.kt) 可将外部应用链接交给系统处理。 | 分项定义书签／历史访问保护、剪贴板与跨应用跳转策略。优先选一项可观察的规则，例如外部跳转的本次允许、始终允许、拒绝；用受控链接测试选择结果及撤销。 | [X 官方简介][x-intro]、[更新日志][x-release]。Android 权限与 WebView 对网页行为的控制能力有边界；无痕模式的具体数据范围需据实表述。 |
| P3 · X-07 备份与同步 | 书签、历史、快捷方式和浏览会话各存在本地；未发现浏览数据云同步流程。 | 先做本地导出／导入验收，覆盖往返、同名或重复项、损坏文件和取消恢复。若后续做云同步，另定义数据范围、冲突、删除和离线行为。 | [X 书签同步助手][x-sync] 使用桌面扩展；跨设备同步还取决于账号、服务及相应设备软件。 |
| P3 · X-08 投屏 | 嗅探页可移交外部播放器；未发现棱镜内置 DLNA 流程。 | 若纳入范围，用实际接收设备验证发现、播放、停止、找不到设备时的反馈与外部播放器回退。 | [X 投屏教程][x-cast] 区分 DLNA 和第三方播放器方案；[Play 投屏扩展说明][x-cast-play] 提及渠道限制。评估时分别列出可用渠道、接收设备和用户需另装的应用。 |

## 本轮证据与接手

每批更新一份短记录。有复现步骤和结果才勾选验收；命令、设备观察、安装产物及发布记录分别填写，未执行写“未运行”或“待补”。

```text
日期／批次／状态：        ／网页状态指示器／进行中
源码范围或版本：
自动检查（命令、退出码、失败数、日志）：
设备检查（机型、Android／WebView 版本、步骤、结果、截图）：
视觉参考（来源、QQ Android 版本、页面；未使用可留空）：
安装或发布（如适用，填写路径／版本、安装或发布证据）：
未覆盖或失败的用例：
接手下一步（待办编号、首个复现步骤、所需条件）：
```

[x-intro]: https://www.xbext.com/docs/introduction-of-xbrowser.html
[x-docs]: https://www.xbext.com/docs/
[x-play]: https://play.google.com/store/apps/details?id=com.xbrowser.play&hl=zh_CN
[x-release]: https://www.xbext.com/changelogs/changelog-v5-7/
[x-install]: https://www.xbext.com/docs/how-to-use-tampermonkey-user-script-in-xbrowser.html
[x-normal]: https://www.xbext.com/docs/how-to-use-normal-user-script-in-xbrowser.html
[x-api]: https://www.xbext.com/docs/user-script-api-reference.html
[x-adblock]: https://www.xbext.com/docs/ad-block-overview.html
[x-download]: https://www.xbext.com/tutorials/how-to-bind-a-third-party-downloader/
[x-hls]: https://www.xbext.com/tutorials/how-to-download-m3u8-to-mp4/
[x-sync]: https://www.xbext.com/tools/xbrowser-bookmark-sync/
[x-cast]: https://www.xbext.com/tutorials/how-to-cast-video-to-other-devices/
[x-cast-play]: https://www.xbext.com/docs/video-cast-for-google-play.html
[qq-mobile]: https://browser.qq.com/mobile/
[qq-android]: https://sj.qq.com/appdetail/com.tencent.mtt
[qq-shot2]: https://pp.myapp.com/ma_pic2/0/shot_11384_2_1794918994/0
[qq-shot3]: https://pp.myapp.com/ma_pic2/0/shot_11384_3_1794918994/0
