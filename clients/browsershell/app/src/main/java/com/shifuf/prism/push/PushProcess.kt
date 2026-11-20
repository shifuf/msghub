package com.shifuf.prism.push

import android.app.ActivityManager
import android.app.Application
import android.content.Context
import android.os.Process

object PushProcess {
    fun isPushCoreProcess(context: Context): Boolean {
        val name = currentProcessName(context) ?: return false
        return name.endsWith(":pushcore")
    }

    fun isMainProcess(context: Context): Boolean = !isPushCoreProcess(context)

    fun currentProcessName(context: Context): String? {
        if (android.os.Build.VERSION.SDK_INT >= 28) {
            return Application.getProcessName()
        }
        val pid = Process.myPid()
        val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        return am.runningAppProcesses?.firstOrNull { it.pid == pid }?.processName
    }
}
