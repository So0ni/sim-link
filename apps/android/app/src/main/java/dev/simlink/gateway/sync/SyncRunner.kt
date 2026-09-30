package dev.simlink.gateway.sync

import android.content.Context
import dev.simlink.gateway.BuildConfig
import dev.simlink.gateway.connection.ApiFailure
import dev.simlink.gateway.connection.ConnectionStore
import dev.simlink.gateway.connection.GatewayApi
import dev.simlink.gateway.connection.RequestCancellation
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import android.os.SystemClock

/** Network tasks never use the SMS receiver's DB executor. */
object NetworkIo {
    val executor = Executors.newSingleThreadExecutor()
    val deadlines = Executors.newSingleThreadScheduledExecutor()
}
class SyncRunner(private val context: Context) {
    private val connections = ConnectionStore(context)
    private val queue = SyncQueue(context)
    fun run(cancellation: RequestCancellation): Boolean {
        SyncDiagnostics.record(SyncDiagnostics.Phase.SYNC_STARTED)
        val connection = connections.current() ?: return false
        if (!BuildConfig.DEBUG && connection.server.startsWith("http:")) {
            connections.pause(connection.generation, "发布版只允许 HTTPS，请重新配对")
            return false
        }
        val api = GatewayApi(connection.server, cancellation, allowHttp = BuildConfig.DEBUG)
        val storage = object : SyncStorage {
            override fun target() = SyncTarget(connection.generation, connection.enabled) { connection.token() }
            override fun currentGeneration() = connections.current()?.generation
            override fun next(generation: String) = queue.next(generation)
            override fun ack(generation: String, event: UploadEvent, time: Long) {
                queue.ack(generation, event, time)
                SyncDiagnostics.record(SyncDiagnostics.Phase.SERVER_ACK)
            }
            override fun block(generation: String, event: UploadEvent, reason: String) = queue.block(generation, event, reason)
            override fun pause(generation: String, notice: String) = connections.pause(generation, notice)
            override fun notice(generation: String, notice: String) = connections.notice(generation, notice)
        }
        var inventorySupported = false
        return SyncEngine(storage, { event, token ->
            val body = JSONObject().put("eventId", event.id).put("sender", event.address).put("body", event.body)
                .put("subscriptionId", if (event.subId >= 0) event.subId else JSONObject.NULL).put("receivedAt", event.time)
            if (event.simKey != null) {
                if (!inventorySupported) throw UploadFailure(503) // Keep the immutable mapping until the server is upgraded/reachable.
                body.put("simKey", event.simKey)
            }
            // The upload/retry group has a 30s watchdog, including socket waits and delays.
            // Cancellation preserves the outbox and lets the system schedule another run.
            val deadline = NetworkIo.deadlines.schedule({ cancellation.cancel() }, 30, TimeUnit.SECONDS)
            try {
                retryUpload({ cancellation.stopped.get() }, { delay ->
                    SyncDiagnostics.record(SyncDiagnostics.Phase.UPLOAD_RETRY)
                    val end = SystemClock.elapsedRealtime() + delay
                    while (!cancellation.stopped.get() && SystemClock.elapsedRealtime() < end) Thread.sleep(100)
                    !cancellation.stopped.get() && connections.current()?.generation == connection.generation
                }) {
                    if (cancellation.stopped.get() || connections.current()?.generation != connection.generation) throw dev.simlink.gateway.connection.Cancelled()
                    try {
                        val result = api.upload(body, token)
                        UploadAck(result.getString("eventId"), result.getLong("sequence"), result.getLong("syncedAt"))
                    } catch (error: ApiFailure) { throw UploadFailure(error.status, error.hasRetryAfter) }
                }
            } finally { deadline.cancel(false) }
        }, { cancellation.stopped.get() }, { token ->
            try {
                if (connection.serverId == null) {
                    // Legacy bindings are claimed only by proving possession of their existing token.
                    try {
                        val serverId = api.identity(token,connection.deviceId,dev.simlink.gateway.connection.InstallationStore(context).id,null)
                        connections.rememberIdentity(connection.generation,serverId)
                    } catch (error: ApiFailure) { if (error.status != 404) throw error }
                    catch (_: org.json.JSONException) { /* Older server without identity capability. */ }
                }
                api.heartbeat(token)
                api.inventory(dev.simlink.gateway.telephony.SimInventory(context).refresh().json(), token)
                inventorySupported = true
                dev.simlink.gateway.commands.RemoteCommands(context,api,cancellation).run(connection,token)
            } catch (error: ApiFailure) { throw UploadFailure(error.status, error.hasRetryAfter) }
        }).run()
    }
}
