package com.shifuf.prism.push

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.util.Log

/** A persisted, network-constrained wakeup for outbox work after the app process has gone away. */
class DeviceSyncJobService : JobService() {
    private var running: JobParameters? = null

    override fun onStartJob(params: JobParameters): Boolean {
        running = params
        DevicePlatformClient.retryPending(this) { retry ->
            if (running === params) {
                running = null
                jobFinished(params, retry)
            }
        }
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean {
        if (running === params) running = null
        return true
    }

    companion object {
        private const val JOB_ID = 0x50524456
        private const val RETRY_MILLIS = 30_000L

        fun schedule(context: Context) {
            val app = context.applicationContext
            runCatching {
                val job = JobInfo.Builder(JOB_ID, ComponentName(app, DeviceSyncJobService::class.java))
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setMinimumLatency(RETRY_MILLIS)
                    .setBackoffCriteria(RETRY_MILLIS, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
                    .setPersisted(true)
                    .build()
                check(app.getSystemService(JobScheduler::class.java).schedule(job) == JobScheduler.RESULT_SUCCESS)
            }.onFailure { Log.w("PrismDeviceJob", "Could not schedule device synchronization: ${it.javaClass.simpleName}") }
        }
    }
}
