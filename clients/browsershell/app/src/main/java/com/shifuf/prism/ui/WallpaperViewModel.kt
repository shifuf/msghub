package com.shifuf.prism.ui

import android.net.Uri
import androidx.lifecycle.ViewModel
import com.shifuf.prism.BrowserApp
import com.shifuf.prism.core.WallpaperStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class WallpaperViewModel : ViewModel() {
    enum class State { IDLE, SAVING, SAVED, FAILED }
    private val mutable = MutableStateFlow(State.IDLE)
    val state = mutable.asStateFlow()

    fun save(uri: Uri) {
        if (mutable.value == State.SAVING) return
        mutable.value = State.SAVING
        val app = BrowserApp.instance
        // Finish the atomic file transaction even if the settings screen is closed.
        app.appScope.launch {
            mutable.value = runCatching { WallpaperStore.save(app, uri, app.prefs) }
                .fold({ State.SAVED }, { State.FAILED })
        }
    }

    fun consumeResult() { mutable.value = State.IDLE }
}
