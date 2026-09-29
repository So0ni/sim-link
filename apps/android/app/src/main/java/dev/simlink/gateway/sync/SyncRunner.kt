package dev.simlink.gateway.sync

import android.content.Context
import dev.simlink.gateway.BuildConfig
import dev.simlink.gateway.connection.ApiFailure
import dev.simlink.gateway.connection.ConnectionStore
import dev.simlink.gateway.connection.GatewayApi
import dev.simlink.gateway.connection.RequestCancellation
import org.json.JSONObject
import java.util.concurrent.Executors

/** Network tasks never use the SMS receiver's DB executor. */
object NetworkIo { val executor = Executors.newSingleThreadExecutor() }
class SyncRunner(context: Context) {
    private val connections = ConnectionStore(context)
    private val queue = SyncQueue(context)
    fun run(cancellation: RequestCancellation): Boolean {
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
            override fun ack(generation: String, event: UploadEvent, time: Long) = queue.ack(generation, event, time)
            override fun block(generation: String, event: UploadEvent, reason: String) = queue.block(generation, event, reason)
            override fun pause(generation: String, notice: String) = connections.pause(generation, notice)
            override fun notice(generation: String, notice: String) = connections.notice(generation, notice)
        }
        return SyncEngine(storage, { event, token ->
            val body = JSONObject().put("eventId", event.id).put("sender", event.address).put("body", event.body)
                .put("subscriptionId", if (event.subId >= 0) event.subId else JSONObject.NULL).put("receivedAt", event.time)
            try {
                val result = api.upload(body, token)
                UploadAck(result.getString("eventId"), result.getLong("sequence"), result.getLong("syncedAt"))
            } catch (error: ApiFailure) { throw UploadFailure(error.status) }
        }, { cancellation.stopped.get() }, { token ->
            try { api.heartbeat(token) } catch (error: ApiFailure) { throw UploadFailure(error.status) }
        }).run()
    }
}
