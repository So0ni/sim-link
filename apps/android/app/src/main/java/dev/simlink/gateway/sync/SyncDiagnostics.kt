package dev.simlink.gateway.sync

import android.os.SystemClock
import android.util.Log

/** Fixed phase names only: no message IDs, hashes, addresses, bodies, URLs or credentials. */
internal object SyncDiagnostics {
    enum class Phase { SMS_RECEIVED, SMS_STORED, SMS_SCHEDULE_REJECTED, INCOMING_SCHEDULE_REJECTED, INCOMING_EXPEDITED_REJECTED,
        JOB_STARTED, JOB_EXPEDITED_STARTED, SYNC_STARTED, UPLOAD_RETRY, SERVER_ACK, JOB_STOPPED,
        HEARTBEAT_SCHEDULED, HEARTBEAT_WAKE, HEARTBEAT_OK, HEARTBEAT_TIMEOUT,
        ALARM_SYNC_STARTED, ALARM_SYNC_PENDING, ALARM_SYNC_FINISHED }

    fun failure(error: Exception) {
        val result = when (error) {
            is dev.simlink.gateway.connection.ApiFailure -> "http_${error.status}"
            is dev.simlink.gateway.connection.Cancelled -> "cancelled"
            is java.net.SocketTimeoutException -> "timeout"
            is java.io.IOException -> "network"
            else -> "local"
        }
        Log.i("SIMLinkSync", "phase=HEARTBEAT_FAILED result=$result wallMs=${System.currentTimeMillis()}")
    }
    fun job(id: Int, stopReason: Int? = null) {
        Log.i("SIMLinkSync", "phase=JOB_DETAIL jobId=$id stopReason=${stopReason ?: -1} wallMs=${System.currentTimeMillis()}")
    }
    fun record(phase: Phase) {
        Log.i("SIMLinkSync", "phase=$phase wallMs=${System.currentTimeMillis()} elapsedMs=${SystemClock.elapsedRealtime()}")
    }
}
