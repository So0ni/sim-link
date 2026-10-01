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
    private const val SMS = 103
    private val smsDispatch = SmsSyncDispatch()

    private fun builder(context: Context, id: Int) = JobInfo.Builder(id, ComponentName(context, UploadJobService::class.java))
        .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(true)
        .setBackoffCriteria(30000, JobInfo.BACKOFF_POLICY_EXPONENTIAL)

    private fun ensurePeriodic(context: Context): Boolean {
        HeartbeatAlarm.ensure(context)
        val jobs = context.getSystemService(JobScheduler::class.java)
        return jobs.getPendingJob(PERIODIC) != null ||
            jobs.schedule(builder(context, PERIODIC).setPeriodic(15 * 60 * 1000L).build()) == JobScheduler.RESULT_SUCCESS
    }

    fun scheduleSms(context: Context): Boolean {
        // Independent ID: an ordinary pending/running heartbeat must not suppress SMS urgency.
        val periodic = ensurePeriodic(context)
        val immediate = smsDispatch.request { enqueueSms(context) }
        if (!immediate || !periodic) SyncDiagnostics.record(SyncDiagnostics.Phase.SMS_SCHEDULE_REJECTED)
        return immediate && periodic
    }

    private fun enqueueSms(context: Context): Boolean {
        val jobs = context.getSystemService(JobScheduler::class.java)
        return scheduleSmsWithFallback({
            val accepted = jobs.schedule(builder(context, SMS).setExpedited(true).build()) == JobScheduler.RESULT_SUCCESS
            if (!accepted) SyncDiagnostics.record(SyncDiagnostics.Phase.SMS_EXPEDITED_REJECTED)
            accepted
        }, {
            jobs.schedule(builder(context, SMS).build()) == JobScheduler.RESULT_SUCCESS
        })
    }

    internal fun started(id: Int) { if (id == SMS) smsDispatch.started() }
    internal fun stopped(id: Int) { if (id == SMS) smsDispatch.stopped() }
    internal fun finished(id: Int, retry: Boolean, finish: (Boolean) -> Unit) {
        if (id != SMS) { finish(retry); return }
        smsDispatch.finished(retry, finish)
    }

    fun schedule(context: Context): Boolean {
        val jobs = context.getSystemService(JobScheduler::class.java)
        var ok = ensurePeriodic(context)
        // Ordinary UI/receipt requests leave an existing job alone; periodic work remains the fallback.
        if (jobs.getPendingJob(IMMEDIATE) == null) ok = (jobs.schedule(builder(context, IMMEDIATE).setMinimumLatency(1000).build()) == JobScheduler.RESULT_SUCCESS) && ok
        return ok
    }
    fun cancel(context: Context) {
        HeartbeatAlarm.cancel(context)
        val jobs = context.getSystemService(JobScheduler::class.java)
        jobs.cancel(IMMEDIATE); jobs.cancel(PERIODIC); jobs.cancel(SMS)
    }
}
class UploadJobService : JobService() {
    private val running = mutableMapOf<Int, RequestCancellation>()
    override fun onStartJob(params: JobParameters): Boolean {
        SyncDiagnostics.job(params.jobId)
        SyncScheduler.started(params.jobId)
        SyncDiagnostics.record(if (params.isExpeditedJob) SyncDiagnostics.Phase.JOB_EXPEDITED_STARTED else SyncDiagnostics.Phase.JOB_STARTED)
        val cancellation = RequestCancellation()
        running[params.jobId] = cancellation
        NetworkIo.executor.execute {
            val retry = try { SyncRunner(applicationContext).run(cancellation) } catch (_: Exception) { true }
            mainExecutor.execute {
                if (running[params.jobId] === cancellation) {
                    running.remove(params.jobId)
                    SyncScheduler.finished(params.jobId, retry) { jobFinished(params, it) }
                }
            }
        }
        return true
    }
    override fun onStopJob(params: JobParameters): Boolean {
        SyncDiagnostics.job(params.jobId, params.stopReason)
        running.remove(params.jobId)?.cancel()
        SyncScheduler.stopped(params.jobId)
        SyncDiagnostics.record(SyncDiagnostics.Phase.JOB_STOPPED)
        return true
    }
    override fun onDestroy() {
        running.forEach { (id, cancellation) -> cancellation.cancel(); SyncScheduler.stopped(id) }; running.clear()
        super.onDestroy()
    }
}
