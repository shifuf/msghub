package com.shifuf.prism.core

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build

/** Decode within a bounded size, then replace the wallpaper only after a successful write. */
object WallpaperStore {
    private val mutableRevision = kotlinx.coroutines.flow.MutableStateFlow(0L)
    val revision = mutableRevision as kotlinx.coroutines.flow.StateFlow<Long>

    @Synchronized
    fun save(context: Context, uri: Uri, prefs: PreferenceStore) {
        val resolver = context.contentResolver
        val bitmap = if (Build.VERSION.SDK_INT >= 28) {
            ImageDecoder.decodeBitmap(ImageDecoder.createSource(resolver, uri)) { decoder, info, _ ->
                val scale = (maxOf(info.size.width, info.size.height) / 1440f).coerceAtLeast(1f)
                decoder.setTargetSize((info.size.width / scale).toInt().coerceAtLeast(1),
                    (info.size.height / scale).toInt().coerceAtLeast(1))
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            }
        } else {
            val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
            require(options.outWidth > 0 && options.outHeight > 0) { "无法读取图片" }
            var sample = 1
            while (maxOf(options.outWidth, options.outHeight) / sample > 1440) sample *= 2
            resolver.openInputStream(uri)?.use {
                BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
            } ?: error("无法读取图片")
        }
        val file = android.util.AtomicFile(prefs.homeWallpaperFile())
        var stream: java.io.FileOutputStream? = null
        try {
            stream = file.startWrite()
            check(bitmap.compress(Bitmap.CompressFormat.JPEG, 85, stream)) { "图片保存失败" }
            file.finishWrite(stream)
            prefs.homeWallpaperPath = prefs.homeWallpaperFile().absolutePath
            mutableRevision.value += 1
        } catch (error: Exception) {
            file.failWrite(stream)
            throw error
        } finally {
            bitmap.recycle()
        }
    }
}
