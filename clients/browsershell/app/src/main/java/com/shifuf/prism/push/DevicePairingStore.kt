package com.shifuf.prism.push

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.content.Context
import android.util.Base64
import java.nio.ByteBuffer
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Device API credentials stay inside the app's private preferences and never enter diagnostics. */
class DevicePairingStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("msg_device_pairing", Context.MODE_PRIVATE)
    @Volatile private var decryptedToken: String? = null

    val token: String get() {
        decryptedToken?.let { return it }
        val encrypted = encryptedToken
        if (encrypted.isBlank()) return ""
        return runCatching { decrypt(encrypted) }.onFailure { revoke() }.getOrDefault("").also {
            if (it.isNotBlank()) decryptedToken = it
        }
    }
    val deviceId: String get() = prefs.getString(KEY_ID, "").orEmpty()
    val hasEncryptedToken: Boolean get() = encryptedToken.isNotBlank()
    val isPaired: Boolean get() = encryptedToken.isNotBlank() && token.isNotBlank() && deviceId.isNotBlank()
    var heartbeatPending: Boolean
        get() = prefs.getBoolean(KEY_HEARTBEAT_PENDING, false)
        set(value) { prefs.edit().putBoolean(KEY_HEARTBEAT_PENDING, value).apply() }
    var status: String
        get() = prefs.getString(KEY_STATUS, "").orEmpty()
        set(value) { prefs.edit().putString(KEY_STATUS, value.take(160)).apply() }

    fun save(id: String, token: String) {
        require(id.isNotBlank() && token.isNotBlank())
        val encrypted = encrypt(token)
        check(prefs.edit().putString(KEY_ID, id).putString(KEY_TOKEN, encrypted).putBoolean(KEY_HEARTBEAT_PENDING, true).commit())
        decryptedToken = token
    }

    fun clear() {
        decryptedToken = null
        prefs.edit().remove(KEY_ID).remove(KEY_TOKEN).putBoolean(KEY_HEARTBEAT_PENDING, false).commit()
    }

    fun revoke() {
        clear()
        prefs.edit().putString(KEY_STATUS, "设备关联已失效，请重新配对").commit()
    }

    fun pairingLabel(): String = when {
        hasEncryptedToken && deviceId.isNotBlank() -> "已关联 · ${deviceId.take(8)}"
        encryptedToken.isNotBlank() -> "设备凭证不可用，请重新关联"
        status.isNotBlank() -> status.take(32)
        else -> "输入网页配对码"
    }

    private val encryptedToken get() = prefs.getString(KEY_TOKEN, "").orEmpty()

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val iv = cipher.iv
        val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(ByteBuffer.allocate(iv.size + encrypted.size).put(iv).put(encrypted).array(), Base64.NO_WRAP)
    }

    private fun decrypt(encoded: String): String {
        if (encoded.isBlank()) return ""
        val combined = Base64.decode(encoded, Base64.NO_WRAP)
        require(combined.size > GCM_IV_BYTES) { "Encrypted device token is malformed" }
        val buffer = ByteBuffer.wrap(combined)
        val iv = ByteArray(GCM_IV_BYTES).also(buffer::get)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
        return String(cipher.doFinal(ByteArray(buffer.remaining()).also(buffer::get)), Charsets.UTF_8)
    }

    private fun secretKey(): SecretKey {
        val store = KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEY_STORE)
        generator.init(KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build())
        return generator.generateKey()
    }

    companion object {
        private const val KEY_ID = "device_id"
        private const val KEY_TOKEN = "device_token"
        private const val KEY_STATUS = "status"
        private const val KEY_HEARTBEAT_PENDING = "heartbeat_pending"
        private const val ANDROID_KEY_STORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "com.shifuf.prism.device-pairing"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val GCM_IV_BYTES = 12
        private const val GCM_TAG_BITS = 128
    }
}
