package dev.simlink.gateway.calls

import android.content.Context
import dev.simlink.gateway.connection.*
import dev.simlink.gateway.sync.matchesAck
import org.json.JSONObject

/** Runs under the existing full-sync gate, after the SMS upload budget. */
class CallSync(private val context: Context) {
    fun run(connection: Connection, api: GatewayApi, cancellation: RequestCancellation): Boolean {
        val store=CallStore(context)
        val config=store.settings() ?: return false
        fun active()= !cancellation.stopped.get() && ConnectionStore(context).current()?.let {it.generation==connection.generation && it.enabled}==true
        if(config.generation!=connection.generation || !active())return false
        try {
            api.callStatus(JSONObject().put("enabled",config.enabled).put("permission",CallCollector.hasPermission(context))
                .put("checkedAt",config.checked ?: JSONObject.NULL).put("pending",store.pending(config.generation)),connection.token())
            if(!config.enabled)return false
            repeat(10) {
                if(!active())return true
                if(store.settings()?.enabled!=true)return false
                val event=store.next(config.generation) ?: return false
                try {
                    val ack=api.uploadCall(event,connection.token())
                    check(matchesAck(event.getString("eventId"),ack.getString("eventId"),ack.getLong("sequence"),ack.getLong("syncedAt")))
                    if(!active())return true
                    store.complete(config.generation,event,"done")
                } catch(e: ApiFailure) {
                    if(e.status==400 || e.status==409)store.complete(config.generation,event,"blocked") else throw e
                }
            }
            return store.pending(config.generation)>0
        } catch(e: ApiFailure) {
            if(e.status==401 || e.status==403)ConnectionStore(context).pause(config.generation,"服务器拒绝设备凭证，请重新配对")
            if(e.status==404)store.notice(config,"服务器尚不支持来电同步，请先升级服务器")
            return e.status !in listOf(401,403,404)
        } catch(_: Exception) { return true }
    }
}
