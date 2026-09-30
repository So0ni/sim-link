package dev.simlink.gateway.sync

import java.io.IOException

/** Retry only the idempotent upload, never the whole sync or a cellular send. */
internal fun <T> retryUpload(cancelled: () -> Boolean, pause: (Long) -> Boolean, upload: () -> T): T {
    val delays = longArrayOf(2000, 5000)
    var attempt = 0
    while (true) {
        try { return upload() } catch (error: Exception) {
            val transient = error is IOException || error is UploadFailure && !error.hasRetryAfter && (error.status == 408 || error.status in 500..599)
            // 429 is left to durable backoff rather than hammering a rate-limited server.
            if (!transient || cancelled() || attempt == delays.size || !pause(delays[attempt++])) throw error
        }
    }
}
