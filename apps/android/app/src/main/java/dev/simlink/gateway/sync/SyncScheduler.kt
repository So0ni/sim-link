package dev.simlink.gateway.sync

import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.app.job.JobService
import android.app.job.JobParameters
import android.content.ComponentName
import android.content.Context
import dev.simlink.gateway.connection.RequestCancellation

object SyncScheduler {
    private const val IMMEDIATE = 101
    private const val PERIODIC = 102
    fun schedule(context: Context): Boolean {
        val jobs = context.getSystemService(JobScheduler::class.java)
        fun builder(id: Int) = JobInfo.Builder(id, ComponentName(context, UploadJobService::class.java))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(true)
            .setBackoffCriteria(30000, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
        var ok = true
        if (jobs.getPendingJob(PERIODIC) == null) ok = jobs.schedule(builder(PERIODIC).setPeriodic(15 * 60 * 1000L).build()) == JobScheduler.RESULT_SUCCESS
        // Do not replace an executing job when another SMS arrives. Periodic work closes the finish race.
        if (jobs.getPendingJob(IMMEDIATE) == null) ok = (jobs.schedule(builder(IMMEDIATE).setMinimumLatency(1000).build()) == JobScheduler.RESULT_SUCCESS) && ok
        return ok
    }
    fun cancel(context: Context) {
        val jobs = context.getSystemService(JobScheduler::class.java)
        jobs.cancel(IMMEDIATE); jobs.cancel(PERIODIC)
    }
}
class UploadJobService : JobService() {
    private val running = mutableMapOf<Int, RequestCancellation>()
    override fun onStartJob(params: JobParameters): Boolean {
        val cancellation = RequestCancellation()
        running[params.jobId] = cancellation
        NetworkIo.executor.execute {
            val retry = try { SyncRunner(applicationContext).run(cancellation) } catch (_: Exception) { true }
            mainExecutor.execute {
                if (running[params.jobId] === cancellation) {
                    running.remove(params.jobId)
                    jobFinished(params, retry)
                }
            }
        }
        return true
    }
    override fun onStopJob(params: JobParameters): Boolean {
        running.remove(params.jobId)?.cancel()
        return true
    }
    override fun onDestroy() {
        running.values.forEach { it.cancel() }; running.clear()
        super.onDestroy()
    }
}
