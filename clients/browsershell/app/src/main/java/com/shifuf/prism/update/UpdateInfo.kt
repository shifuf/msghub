package com.shifuf.prism.update

import org.json.JSONObject
import java.net.URI

data class UpdateInfo(
    val versionCode: Int,
    val versionName: String,
    val title: String,
    val releaseNotes: List<String>,
    val apkUrl: String,
    val sha256: String,
    val mandatory: Boolean
) {
    fun isNewerThan(currentVersionCode: Int): Boolean = versionCode > currentVersionCode

    companion object {
        fun parse(raw: String): UpdateInfo {
            val json = JSONObject(raw)
            val code = json.optInt("versionCode", -1)
            val name = json.optString("versionName").trim()
            val title = json.optString("title").trim().ifBlank { "棱镜更新" }
            val apk = json.optString("apkUrl").trim()
            val hash = json.optString("sha256").trim().lowercase()
            require(code > 0 && name.isNotBlank()) { "更新清单缺少版本信息" }
            validateUrl(apk)
            require(!apk.contains("...")) { "APK 地址尚未配置" }
            require(hash.matches(Regex("[0-9a-f]{64}"))) { "APK SHA-256 尚未配置或格式错误" }
            val notes = json.optJSONArray("releaseNotes")?.let { array ->
                (0 until array.length()).mapNotNull { array.optString(it).trim().takeIf(String::isNotBlank) }
            }.orEmpty()
            return UpdateInfo(code, name, title, notes, apk, hash, json.optBoolean("mandatory", false))
        }

        fun validateUrl(url: String) {
            val uri = runCatching { URI(url) }.getOrNull()
            require(uri != null && uri.scheme.equals("https", true) && !uri.host.isNullOrBlank() &&
                uri.userInfo == null && uri.fragment == null) { "更新地址必须为有效的 HTTPS 直链" }
        }
    }
}
