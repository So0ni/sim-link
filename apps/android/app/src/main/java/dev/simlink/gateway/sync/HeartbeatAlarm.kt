package dev.simlink.gateway.sync

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.PowerManager
import android.os.SystemClock
import dev.simlink.gateway.BuildConfig
import dev.simlink.gateway.connection.ConnectionStore
import dev.simlink.gateway.connection.GatewayApi
import dev.simlink.gateway.connection.RequestCancellation
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** A best-effort idle wakeup, never an exact alarm or a replacement for the SMS outbox. */
object HeartbeatAlarm {
    internal const val ACTION = "dev.simlink.gateway.HEARTBEAT"
    internal const val INTERVAL = 15 * 60 * 1000L
    internal val executor = Executors.newSingleThreadExecutor()
    private fun operation(context: Context) = PendingIntent.getBroadcast(context, 104,
        Intent(context, HeartbeatReceiver::class.java).setAction(ACTION), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    @Synchronized fun ensure(context: Context, reset: Boolean = false) {
        val prefs = context.getSharedPreferences("heartbeat_alarm", Context.MODE_PRIVATE)
        val now = SystemClock.elapsedRealtime()
        val next = prefs.getLong("next", 0)
        if (!reset && next > now && next <= now + INTERVAL) return
        context.getSystemService(AlarmManager::class.java).setAndAllowWhileIdle(
            AlarmManager.ELAPSED_REALTIME_WAKEUP, now + INTERVAL, operation(context))
        prefs.edit().putLong("next", now + INTERVAL).apply()
        SyncDiagnostics.record(SyncDiagnostics.Phase.HEARTBEAT_SCHEDULED)
    }
    @Synchronized fun cancel(context: Context) {
        context.getSystemService(AlarmManager::class.java).cancel(operation(context))
        context.getSharedPreferences("heartbeat_alarm", Context.MODE_PRIVATE).edit().remove("next").apply()
    }
}

class HeartbeatReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action !in setOf(HeartbeatAlarm.ACTION, Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED)) return
        val app = context.applicationContext
        // Rearm before any queued/network work, so a timeout cannot break the alarm chain.
        HeartbeatAlarm.ensure(app, reset = true)
        val pending = goAsync()
        val cancellation = RequestCancellation()
        val finished = AtomicBoolean(false)
        val wake = app.getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SIMLink:heartbeat")
        wake.setReferenceCounted(false)
        wake.acquire(9000)
        fun finish() { if (finished.compareAndSet(false, true)) { if (wake.isHeld) wake.release(); pending.finish() } }
        // Complete within the broadcast window even if DNS, TLS or a queued task stalls.
        val deadline = NetworkIo.deadlines.schedule({
            SyncDiagnostics.record(SyncDiagnostics.Phase.HEARTBEAT_TIMEOUT)
            cancellation.stopped.set(true)
            finish(); cancellation.cancel()
        }, 8, TimeUnit.SECONDS)
        HeartbeatAlarm.executor.execute {
            try {
                val store = ConnectionStore(app)
                val connection = store.current()
                if (connection == null || !connection.enabled) { HeartbeatAlarm.cancel(app); return@execute }
                if (cancellation.stopped.get()) return@execute
                SyncDiagnostics.record(SyncDiagnostics.Phase.HEARTBEAT_WAKE)
                if (!BuildConfig.DEBUG && connection.server.startsWith("http:")) return@execute
                val token = connection.token()
                if (store.current()?.generation != connection.generation || cancellation.stopped.get()) return@execute
                dev.simlink.gateway.calls.CallCaptureScheduler.wake(app)
                // First establish contact, then use the remaining wake window for full sync.
                GatewayApi(connection.server, cancellation, allowHttp = BuildConfig.DEBUG).heartbeat(token)
                SyncDiagnostics.record(SyncDiagnostics.Phase.HEARTBEAT_OK)
                if (!cancellation.stopped.get()) {
                    SyncDiagnostics.record(SyncDiagnostics.Phase.ALARM_SYNC_STARTED)
                    val retry = SyncRunner(app).run(cancellation, heartbeatAlreadySent = true)
                    SyncDiagnostics.record(if (retry) SyncDiagnostics.Phase.ALARM_SYNC_PENDING else SyncDiagnostics.Phase.ALARM_SYNC_FINISHED)
                    if (retry) SyncScheduler.schedule(app)
                }
            } catch (error: Exception) {
                SyncDiagnostics.failure(error)
            } finally { deadline.cancel(false); finish() }
        }
    }
}
