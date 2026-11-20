package com.shifuf.prism.qr

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanIntentResult
import com.journeyapps.barcodescanner.ScanOptions

class QrScanActivity : AppCompatActivity() {
    private val barcodeLauncher = registerForActivityResult(ScanContract()) { result: ScanIntentResult ->
        if (result.contents.isNullOrBlank()) {
            setResult(RESULT_CANCELED)
        } else {
            setResult(RESULT_OK, Intent().putExtra(EXTRA_RESULT, result.contents))
        }
        finish()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val options = ScanOptions()
            .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            .setPrompt("对准二维码")
            .setBeepEnabled(false)
            .setOrientationLocked(true)
            .setCaptureActivity(com.journeyapps.barcodescanner.CaptureActivity::class.java)
        barcodeLauncher.launch(options)
    }

    companion object {
        const val EXTRA_RESULT = "qr_result"
    }
}
