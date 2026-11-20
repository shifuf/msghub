package com.shifuf.prism.push

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.nio.file.Files
import java.nio.file.StandardCopyOption

data class DeviceReceipt(val receivedToken: String, val registrationId: String, val displayed: Boolean)

/** Durable receipt outbox. An acknowledged arrival stays briefly so tray evidence can upgrade it. */
class DeviceReceiptQueue(private val file: File) {
    companion object {
        private val processLock = Any()
        private const val MAX_ENTRIES = 1000
        private const val RETENTION_MILLIS = 7L * 24 * 60 * 60 * 1000
    }

    private fun <T> transaction(block: (JSONArray) -> T): T = synchronized(processLock) {
        file.parentFile?.mkdirs()
        RandomAccessFile(File(file.path + ".lock"), "rw").use { handle ->
            handle.channel.lock().use {
                val now = System.currentTimeMillis()
                var recovered = false
                val rows = if (file.exists()) runCatching { JSONArray(file.readText()) }.getOrElse {
                    file.copyTo(File(file.path + ".corrupt-$now-${java.util.UUID.randomUUID()}"))
                    recovered = true
                    JSONArray()
                } else JSONArray()
                val retained = JSONArray()
                for (i in 0 until rows.length()) {
                    val row = rows.optJSONObject(i) ?: continue
                    if (now - row.optLong("updatedAt", now) < RETENTION_MILLIS) retained.put(JSONObject(row.toString()))
                }
                val result = block(retained)
                while (retained.length() > MAX_ENTRIES) retained.remove(0)
                if (recovered || !file.exists() || retained.toString() != rows.toString()) write(retained)
                result
            }
        }
    }

    fun enqueue(receivedToken: String, registrationId: String) {
        if (receivedToken.isBlank()) return
        transaction { rows ->
            val existing = find(rows, receivedToken)
            if (existing == null) {
                rows.put(JSONObject()
                    .put("receivedToken", receivedToken)
                    .put("registrationId", registrationId)
                    .put("displayed", false)
                    .put("acknowledged", false)
                    .put("updatedAt", System.currentTimeMillis()))
            } else {
                if (existing.optString("registrationId").isBlank() && registrationId.isNotBlank()) {
                    existing.put("registrationId", registrationId)
                }
                existing.put("updatedAt", System.currentTimeMillis())
            }
        }
    }

    fun resolveRegistrationId(registrationId: String) {
        if (registrationId.isBlank()) return
        transaction { rows ->
            for (i in 0 until rows.length()) {
                val row = rows.getJSONObject(i)
                if (row.optString("registrationId").isBlank()) row.put("registrationId", registrationId)
            }
        }
    }

    fun markDisplayed(receivedToken: String, registrationId: String): Boolean {
        if (receivedToken.isBlank()) return false
        return transaction { rows ->
            val row = find(rows, receivedToken) ?: return@transaction false
            if (row.optBoolean("displayed")) return@transaction false
            if (registrationId.isNotBlank()) row.put("registrationId", registrationId)
            row.put("displayed", true)
            row.put("acknowledged", false)
            row.put("updatedAt", System.currentTimeMillis())
            true
        }
    }

    fun pending(): List<DeviceReceipt> = transaction { rows ->
        (0 until rows.length()).mapNotNull { rows.optJSONObject(it) }
            .filter { !it.optBoolean("acknowledged") && it.optString("registrationId").isNotBlank() }
            .map { DeviceReceipt(it.getString("receivedToken"), it.getString("registrationId"), it.optBoolean("displayed")) }
    }

    fun acknowledge(receipt: DeviceReceipt) = transaction { rows ->
        find(rows, receipt.receivedToken)?.takeIf {
            it.optString("registrationId") == receipt.registrationId && it.optBoolean("displayed") == receipt.displayed
        }?.put("acknowledged", true)
        Unit
    }

    private fun find(rows: JSONArray, token: String): JSONObject? =
        (0 until rows.length()).firstNotNullOfOrNull { rows.optJSONObject(it)?.takeIf { row -> row.optString("receivedToken") == token } }

    private fun write(rows: JSONArray) {
        val temp = File(file.path + ".tmp")
        java.io.FileOutputStream(temp).use { output ->
            output.write(rows.toString().toByteArray(Charsets.UTF_8))
            output.fd.sync()
        }
        Files.move(temp.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    }
}
