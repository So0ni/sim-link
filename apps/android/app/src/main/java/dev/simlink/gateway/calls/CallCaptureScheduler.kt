package dev.simlink.gateway.calls

import android.app.job.*
import android.content.*
import java.util.concurrent.Executors

/** Local capture has no network constraint and cannot occupy the SMS persistence executor. */
object CallCaptureScheduler {
    private const val JOB=105
    internal val executor=Executors.newSingleThreadExecutor()
    private val capturing=java.util.concurrent.atomic.AtomicBoolean(false)
    fun wake(context: Context) {
        request(context)
        if(!capturing.compareAndSet(false,true))return
        executor.execute {
            try { runCatching { CallCollector(context.applicationContext).collect() } }
            finally { capturing.set(false) }
        }
    }
    fun cancel(context: Context) {
        context.getSystemService(JobScheduler::class.java).cancel(JOB)
        context.getSharedPreferences("call_capture",Context.MODE_PRIVATE).edit().remove("remaining").apply()
    }
    @Synchronized fun request(context: Context, fromPhone: Boolean=false) {
        if(CallStore(context).settings()?.enabled!=true)return
        val prefs=context.getSharedPreferences("call_capture",Context.MODE_PRIVATE)
        if(fromPhone)prefs.edit().putInt("remaining",3).commit()
        val jobs=context.getSystemService(JobScheduler::class.java)
        if(jobs.getPendingJob(JOB)!=null)return
        jobs.schedule(JobInfo.Builder(JOB,ComponentName(context,CallCaptureJob::class.java))
            .setPersisted(true).setMinimumLatency(2000).setBackoffCriteria(30000,JobInfo.BACKOFF_POLICY_LINEAR).build())
    }
}
