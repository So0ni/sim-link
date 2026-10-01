package dev.simlink.gateway.calls

import android.app.job.*
import android.content.Context

class CallCaptureJob: JobService() {
    @Volatile private var active: JobParameters? = null
    override fun onStartJob(params: JobParameters): Boolean {
        active=params
        CallCaptureScheduler.executor.execute {
            val more=runCatching { CallCollector(applicationContext).collect() }.getOrDefault(true)
            val prefs=getSharedPreferences("call_capture",Context.MODE_PRIVATE)
            val remaining=(prefs.getInt("remaining",0)-1).coerceAtLeast(0)
            prefs.edit().putInt("remaining",remaining).commit()
            mainExecutor.execute { if(active===params) { active=null; jobFinished(params,more || remaining>0) } }
        }
        return true
    }
    override fun onDestroy() { active=null;super.onDestroy() }
    override fun onStopJob(params: JobParameters): Boolean { if(active===params)active=null;return true }
}
