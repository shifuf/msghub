package com.shifuf.prism.update

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import androidx.core.content.FileProvider
import com.shifuf.prism.BuildConfig
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

object AppUpdater {
    const val MANIFEST_URL = "https://files.shifuf.com/api/shares/3dbee7604cd35487ad62484879376dfb70659f331f4b3b72"
    private const val MAX_APK_BYTES = 512L * 1024 * 1024
    private val io = Executors.newSingleThreadExecutor { r -> Thread(r, "prism-update").apply { isDaemon = true } }
    private val main = Handler(Looper.getMainLooper())
    private val busy = AtomicBoolean(false)
    private fun prefs(context: Context) = context.getSharedPreferences("app_update", Context.MODE_PRIVATE)
    fun autoEnabled(context: Context): Boolean = prefs(context).getBoolean("auto", true)
    fun setAutoEnabled(context: Context, enabled: Boolean) { prefs(context).edit().putBoolean("auto", enabled).apply() }

    fun checkAutomatically(activity: Activity) {
        if (!autoEnabled(activity)) return
        val last = prefs(activity).getLong("last_check", 0)
        val now = System.currentTimeMillis()
        if (now >= last && now - last < 24L * 60 * 60 * 1000) return
        check(activity, showLatest = false)
    }

    fun check(activity: Activity, showLatest: Boolean = true) {
        if (!busy.compareAndSet(false, true)) {
            if (showLatest) toast(activity, "正在检查或下载更新，请稍候")
            return
        }
        prefs(activity).edit().putLong("last_check", System.currentTimeMillis()).apply()
        if (showLatest) toast(activity, "正在检查更新…")
        io.execute {
            val result = runCatching {
                val conn = open(MANIFEST_URL)
                try {
                    val bytes = java.io.ByteArrayOutputStream()
                    conn.inputStream.use { input ->
                        val buffer = ByteArray(8192)
                        while (true) {
                            val n = input.read(buffer)
                            if (n < 0) break
                            require(bytes.size() + n <= 256 * 1024) { "更新清单过大" }
                            bytes.write(buffer, 0, n)
                        }
                    }
                    UpdateInfo.parse(bytes.toString("UTF-8"))
                } finally { conn.disconnect() }
            }
            busy.set(false)
            main.post {
                if (!alive(activity)) return@post
                result.onSuccess { info ->
                    if (info.isNewerThan(BuildConfig.VERSION_CODE)) showUpdate(activity, info)
                    else if (showLatest) toast(activity, "当前已是最新版本")
                }.onFailure { if (showLatest) toast(activity, "检查更新失败：${it.message}") }
            }
        }
    }

    private fun showUpdate(activity: Activity, info: UpdateInfo) {
        val notes = info.releaseNotes.joinToString("\n") { "• $it" }.ifBlank { "暂无更新说明" }
        val dialog = androidx.appcompat.app.AlertDialog.Builder(activity)
            .setTitle(info.title)
            .setMessage("版本 ${info.versionName}\n\n$notes")
            .setPositiveButton("下载并安装") { _, _ -> download(activity, info) }
            .setCancelable(!info.mandatory)
        if (!info.mandatory) dialog.setNegativeButton("稍后", null)
        dialog.show()
    }

    private fun download(activity: Activity, info: UpdateInfo) {
        if (!busy.compareAndSet(false, true)) { toast(activity, "更新任务正在进行中"); return }
        val app = activity.applicationContext
        val progress = android.app.ProgressDialog(activity).apply {
            setTitle("下载更新")
            setMessage("下载完成后将校验安装包")
            setProgressStyle(android.app.ProgressDialog.STYLE_HORIZONTAL)
            max = 100
            setCancelable(false)
            setButton(android.content.DialogInterface.BUTTON_NEGATIVE, "取消") { _, _ -> }
        }
        val cancelled = AtomicBoolean(false)
        progress.show()
        progress.getButton(android.content.DialogInterface.BUTTON_NEGATIVE).setOnClickListener {
            cancelled.set(true)
            progress.dismiss()
        }
        io.execute {
            val file = File(app.cacheDir, "prism-update.apk")
            val partial = File(app.cacheDir, "prism-update.apk.part")
            val result = runCatching {
                prefs(app).edit().remove("pending").apply()
                val conn = open(info.apkUrl)
                try {
                    val length = conn.contentLengthLong
                    require(length <= MAX_APK_BYTES) { "安装包过大" }
                    var count = 0L
                    var lastPercent = -1
                    conn.inputStream.use { input -> partial.outputStream().use { output ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            if (cancelled.get()) error("已取消下载")
                            val n = input.read(buffer)
                            if (n < 0) break
                            count += n
                            require(count <= MAX_APK_BYTES) { "安装包过大" }
                            output.write(buffer, 0, n)
                            val percent = if (length > 0) (count * 100 / length).toInt() else 0
                            if (percent != lastPercent) {
                                lastPercent = percent
                                main.post { if (alive(activity)) { progress.isIndeterminate = length <= 0; progress.progress = percent } }
                            }
                        }
                        output.fd.sync()
                    } }
                    require(length < 0 || count == length) { "下载未完成，请重试" }
                } finally { conn.disconnect() }
                validatePackage(app, partial, info.versionCode, info.sha256)
                require(!cancelled.get()) { "已取消下载" }
                java.nio.file.Files.move(partial.toPath(), file.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING)
                prefs(app).edit().putBoolean("pending", true).putInt("version", info.versionCode)
                    .putString("hash", info.sha256).apply()
                file
            }
            partial.delete()
            busy.set(false)
            main.post {
                if (alive(activity)) {
                    progress.dismiss()
                    result.onSuccess { openInstaller(activity, it) }
                        .onFailure { if (!cancelled.get()) toast(activity, "更新下载失败：${it.message}") }
                }
            }
        }
    }

    /** Called on return from system permission settings, or after activity recreation. */
    fun resumeInstallation(activity: Activity) {
        val sp = prefs(activity)
        if (!sp.getBoolean("pending", false) || !activity.packageManager.canRequestPackageInstalls()) return
        if (!busy.compareAndSet(false, true)) return
        val file = File(activity.cacheDir, "prism-update.apk")
        io.execute {
            val result = runCatching { validatePackage(activity, file, sp.getInt("version", 0), sp.getString("hash", "").orEmpty()) }
            busy.set(false)
            main.post {
                if (!alive(activity)) return@post
                result.onSuccess { openInstaller(activity, file) }.onFailure {
                    sp.edit().remove("pending").apply()
                    file.delete()
                    toast(activity, "更新文件已失效，请重新检查更新")
                }
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun validatePackage(context: Context, file: File, version: Int, expectedHash: String) {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) { val n = input.read(buffer); if (n < 0) break; digest.update(buffer, 0, n) }
        }
        require(digest.digest().joinToString("") { "%02x".format(it) }.equals(expectedHash, true)) { "文件 SHA-256 校验失败" }
        val pm = context.packageManager
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val archive = pm.getPackageArchiveInfo(file.absolutePath, flags) ?: error("不是有效的 APK")
        val installed = pm.getPackageInfo(context.packageName, flags)
        require(archive.packageName == context.packageName) { "安装包包名不匹配" }
        val archiveVersion = if (Build.VERSION.SDK_INT >= 28) archive.longVersionCode else archive.versionCode.toLong()
        val installedVersion = if (Build.VERSION.SDK_INT >= 28) installed.longVersionCode else installed.versionCode.toLong()
        require(archiveVersion == version.toLong() && archiveVersion > installedVersion) { "安装包版本不匹配或不是新版本" }
        require((archive.applicationInfo?.minSdkVersion ?: 0) <= Build.VERSION.SDK_INT) { "新版本不支持当前 Android 系统" }
        fun signers(pkg: android.content.pm.PackageInfo): Set<String> {
            val signatures = if (Build.VERSION.SDK_INT >= 28) pkg.signingInfo?.apkContentsSigners else pkg.signatures
            return signatures.orEmpty().map { it.toCharsString() }.toSet()
        }
        val current = signers(installed)
        require(current.isNotEmpty() && current == signers(archive)) { "安装包签名与当前应用不一致" }
    }

    private fun openInstaller(activity: Activity, file: File) {
        runCatching {
            if (!activity.packageManager.canRequestPackageInstalls()) {
                androidx.appcompat.app.AlertDialog.Builder(activity).setTitle("允许安装更新")
                    .setMessage("请在系统设置中允许棱镜安装应用，返回后会继续安装。")
                    .setPositiveButton("去设置") { _, _ ->
                        runCatching { activity.startActivity(Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:${activity.packageName}"))) }
                            .onFailure { toast(activity, "无法打开安装权限设置") }
                    }.setNegativeButton("取消", null).show()
                return
            }
            val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
            activity.startActivity(Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            })
            prefs(activity).edit().remove("pending").apply()
        }.onFailure { toast(activity, "无法启动安装器：${it.message}") }
    }

    private fun open(address: String): HttpURLConnection {
        var url = address
        repeat(6) {
            UpdateInfo.validateUrl(url)
            val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = 15_000
                readTimeout = 20_000
                instanceFollowRedirects = false
                setRequestProperty("Cache-Control", "no-cache")
                setRequestProperty("Accept-Encoding", "identity")
            }
            try {
                val code = conn.responseCode
                if (code == 200) return conn
                if (code in listOf(301, 302, 303, 307, 308)) {
                    val location = conn.getHeaderField("Location") ?: error("更新链接跳转地址为空")
                    url = URL(URL(url), location).toString()
                } else error("服务器返回 HTTP $code")
            } catch (e: Exception) { conn.disconnect(); throw e }
            conn.disconnect()
        }
        error("更新链接跳转次数过多")
    }

    private fun alive(activity: Activity) = !activity.isFinishing && !activity.isDestroyed
    private fun toast(context: Context, text: String) = Toast.makeText(context, text, Toast.LENGTH_LONG).show()
}
