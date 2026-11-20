package com.shifuf.prism.push

import org.json.JSONObject

/** Wire contract for the paired notification-device API. */
object DevicePlatformProtocol {
    const val BASE_URL = "https://msg.shifuf.com"

    fun isPairCode(value: String): Boolean = value.trim().matches(Regex("[0-9a-fA-F]{16}"))

    fun pairBody(
        code: String,
        registrationId: String,
        appKey: String,
        name: String?,
        appVersion: String?,
        osVersion: String?,
        notificationsEnabled: Boolean,
        channelEnabled: Boolean,
        connected: Boolean,
    ): JSONObject {
        require(isPairCode(code)) { "配对码需要 16 位十六进制字符" }
        require(registrationId.isNotBlank()) { "尚未获取推送 Registration ID" }
        require(appKey.isNotBlank()) { "推送应用配置不可用" }
        return JSONObject()
            .put("code", code.trim())
            .put("registrationId", registrationId)
            .put("appKey", appKey)
            .putOptional("name", name)
            .putOptional("appVersion", appVersion)
            .putOptional("osVersion", osVersion)
            .put("notificationsEnabled", notificationsEnabled)
            .put("channelEnabled", channelEnabled)
            .put("connected", connected)
    }

    fun heartbeatBody(
        registrationId: String,
        appKey: String,
        appVersion: String?,
        osVersion: String?,
        notificationsEnabled: Boolean,
        channelEnabled: Boolean,
        connected: Boolean,
    ): JSONObject {
        require(registrationId.isNotBlank()) { "尚未获取推送 Registration ID" }
        require(appKey.isNotBlank()) { "推送应用配置不可用" }
        return JSONObject()
            .put("registrationId", registrationId)
            .put("appKey", appKey)
            .putOptional("appVersion", appVersion)
            .putOptional("osVersion", osVersion)
            .put("notificationsEnabled", notificationsEnabled)
            .put("channelEnabled", channelEnabled)
            .put("connected", connected)
    }

    fun receiptBody(receivedToken: String, registrationId: String, displayed: Boolean): JSONObject {
        require(receivedToken.isNotBlank())
        require(registrationId.isNotBlank())
        return JSONObject()
            .put("receivedToken", receivedToken)
            .put("registrationId", registrationId)
            .put("displayed", displayed)
    }

    fun parsePairResponse(raw: String): Pair<String, String> {
        val envelope = JSONObject(raw)
        require(envelope.optBoolean("success", false)) { "消息平台未确认设备配对" }
        val data = envelope.getJSONObject("data")
        val id = data.getString("id").trim()
        val token = data.getString("token").trim()
        require(id.isNotEmpty() && token.isNotEmpty()) { "消息平台返回的设备凭证无效" }
        return id to token
    }

    fun isAcknowledged(raw: String): Boolean = runCatching {
        val envelope = JSONObject(raw)
        envelope.optBoolean("success", false) && envelope.getJSONObject("data").optBoolean("ok", false)
    }.getOrDefault(false)

    private fun JSONObject.putOptional(key: String, value: String?): JSONObject =
        if (value.isNullOrBlank()) this else put(key, value)
}
