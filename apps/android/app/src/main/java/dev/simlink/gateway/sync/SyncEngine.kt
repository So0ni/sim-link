package dev.simlink.gateway.sync

class UploadEvent(val id: String, val address: String, val body: String, val subId: Int, val time: Long)
class SyncTarget(val generation: String, val enabled: Boolean, val token: () -> String)
data class UploadAck(val eventId: String, val sequence: Long, val syncedAt: Long)
class UploadFailure(val status: Int) : Exception()

/** Narrow persistence boundary for the upload use case; implementations own SQLite/Keystore. */
interface SyncStorage {
    fun target(): SyncTarget?
    fun currentGeneration(): String?
    fun next(generation: String): UploadEvent?
    fun ack(generation: String, event: UploadEvent, time: Long)
    fun block(generation: String, event: UploadEvent, reason: String)
    fun pause(generation: String, notice: String)
    fun notice(generation: String, notice: String)
}

/** Pure coordination: no Android, HTTP, JSON or scheduler dependency. */
class SyncEngine(private val storage: SyncStorage,
                 private val upload: (UploadEvent, String) -> UploadAck,
                 private val cancelled: () -> Boolean,
                 private val heartbeat: (String) -> Unit = {}) {
    fun run(): Boolean {
        val config = storage.target() ?: return false
        if (!config.enabled) return false
        val token = try { config.token() } catch (_: Exception) {
            storage.pause(config.generation, "凭证无法读取，请重新配对"); return false
        }
        if (cancelled()) return true
        if (storage.currentGeneration() != config.generation) return false
        var heartbeatRetry = false
        try { heartbeat(token) } catch (error: UploadFailure) {
            if (error.status == 401 || error.status == 403) {
                storage.pause(config.generation, "服务器拒绝设备凭证，请重新配对"); return false
            }
            // Older API v1 servers have no heartbeat route; SMS upload remains compatible.
            heartbeatRetry = error.status != 404
        } catch (_: Exception) { heartbeatRetry = true }
        repeat(40) {
            if (cancelled()) return true
            if (storage.currentGeneration() != config.generation) return false
            val event = storage.next(config.generation) ?: return heartbeatRetry
            try {
                val ack = upload(event, token)
                check(matchesAck(event.id, ack.eventId, ack.sequence, ack.syncedAt))
                if (cancelled()) return true
                storage.ack(config.generation, event, ack.syncedAt)
                storage.notice(config.generation, "最近一次上传已获服务器确认")
            } catch (error: UploadFailure) {
                if (cancelled()) return true
                when(uploadAction(error.status)) {
                    UploadAction.PAUSE_CONNECTION -> { storage.pause(config.generation, "服务器拒绝设备凭证，请重新配对"); return false }
                    UploadAction.BLOCK_EVENT -> {
                        storage.block(config.generation, event, "HTTP ${error.status}")
                        storage.notice(config.generation, "存在无法同步的事件（HTTP ${error.status}），请检查服务器或手机时间")
                    }
                    UploadAction.RETRY -> { storage.notice(config.generation, "服务器暂时不可用，等待重试"); return true }
                }
            } catch (_: Exception) {
                if (!cancelled()) storage.notice(config.generation, "连接或回执未确认，保留队列等待重试")
                return true
            }
        }
        return heartbeatRetry || storage.next(config.generation) != null
    }
}
