package dev.simlink.gateway.sync

enum class UploadAction { RETRY, PAUSE_CONNECTION, BLOCK_EVENT }
fun uploadAction(status: Int): UploadAction = when {
    status == 401 || status == 403 -> UploadAction.PAUSE_CONNECTION
    status == 408 || status == 429 || status >= 500 -> UploadAction.RETRY
    else -> UploadAction.BLOCK_EVENT
}
fun matchesAck(eventId: String, ackId: String, sequence: Long, syncedAt: Long): Boolean =
    eventId == ackId && sequence > 0 && syncedAt >= 0
