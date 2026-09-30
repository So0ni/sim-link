package dev.simlink.gateway.sync

import android.os.SystemClock
import android.util.Log

/** Fixed phase names only: no message IDs, hashes, addresses, bodies, URLs or credentials. */
internal object SyncDiagnostics {
    enum class Phase { SMS_RECEIVED, SMS_STORED, SMS_SCHEDULE_REJECTED, SMS_EXPEDITED_REJECTED,
        JOB_STARTED, JOB_EXPEDITED_STARTED, SYNC_STARTED, UPLOAD_RETRY, SERVER_ACK, JOB_STOPPED }

    fun record(phase: Phase) {
        Log.i("SIMLinkSync", "phase=$phase wallMs=${System.currentTimeMillis()} elapsedMs=${SystemClock.elapsedRealtime()}")
    }
}
