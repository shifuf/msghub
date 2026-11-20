package com.shifuf.prism.update

import org.junit.Assert.*
import org.junit.Test

class UpdateInfoTest {
    @Test fun parsesManifestAndDetectsNewerVersion() {
        val info = UpdateInfo.parse("""{"versionCode":32,"versionName":"2.1.2","title":"棱镜 2.1.2","releaseNotes":["修复","优化"],"apkUrl":"https://files.shifuf.com/api/public/files/abc","sha256":"${"a".repeat(64)}","mandatory":false}""")
        assertEquals(32, info.versionCode)
        assertTrue(info.isNewerThan(31))
        assertFalse(info.isNewerThan(32))
        assertFalse(info.isNewerThan(33))
        assertEquals(listOf("修复", "优化"), info.releaseNotes)
    }

    @Test fun rejectsPlaceholderOrUnsafeManifest() {
        assertThrows(IllegalArgumentException::class.java) {
            UpdateInfo.parse("""{"versionCode":32,"versionName":"2.1.2","apkUrl":"https://files.shifuf.com/api/public/files/...","sha256":"..."}""")
        }
        assertThrows(IllegalArgumentException::class.java) {
            UpdateInfo.parse("""{"versionCode":32,"versionName":"2.1.2","apkUrl":"http://example.com/a.apk","sha256":"${"a".repeat(63)}g"}""")
        }
    }

    @Test fun rejectsMalformedOrCredentialBearingUrls() {
        listOf("https:///no-host", "http://files.shifuf.com/a.apk", "https://user:pass@files.shifuf.com/a.apk", "https://files.shifuf.com/a.apk#fragment")
            .forEach { url -> assertThrows(IllegalArgumentException::class.java) { UpdateInfo.validateUrl(url) } }
        UpdateInfo.validateUrl("https://files.shifuf.com/api/public/files/abc?download=1")
    }
}
