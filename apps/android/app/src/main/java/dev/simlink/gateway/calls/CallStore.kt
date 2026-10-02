package dev.simlink.gateway.calls

import android.content.Context
import dev.simlink.gateway.connection.ConnectionStore
import dev.simlink.gateway.platform.GatewayDatabase
import org.json.JSONObject
import java.util.UUID

data class CallSettings(val generation: String, val enabled: Boolean, val since: Long, val cursor: Long, val checked: Long?, val notice: String, val repairCursor: Long = 0)
data class CapturedCall(val source: Long, val number: String?, val outcome: String, val started: Long, val duration: Long, val simKey: String? = null)
class CallStore(context: Context) {
    private val db = GatewayDatabase.get(context).writableDatabase
    private val connections = ConnectionStore(context)
    fun settings(): CallSettings? {
        val generation = connections.current()?.generation ?: return null
        return db.rawQuery("SELECT enabled,since_at,cursor,checked_at,notice,repair_cursor FROM call_settings WHERE generation=?", arrayOf(generation)).use { c ->
            if (!c.moveToFirst()) CallSettings(generation,false,0,0,null,"") else CallSettings(generation,c.getInt(0)==1,c.getLong(1),c.getLong(2),if(c.isNull(3)) null else c.getLong(3),c.getString(4),c.getLong(5))
        }
    }
    fun enable(enabled: Boolean) {
        val config = settings() ?: return
        db.execSQL("INSERT INTO call_settings(generation,enabled,since_at,cursor) VALUES(?,?,?,0) ON CONFLICT(generation) DO UPDATE SET enabled=excluded.enabled,since_at=excluded.since_at,cursor=0,checked_at=NULL,notice=''",
            arrayOf<Any>(config.generation,if(enabled) 1 else 0,System.currentTimeMillis()))
    }
    fun notice(config: CallSettings, value: String) { db.execSQL("UPDATE call_settings SET notice=? WHERE generation=?",arrayOf(value,config.generation)) }
    /** Source progress and durable events commit together; server ACK is a separate checkpoint. */
    fun save(config: CallSettings, calls: List<CapturedCall>, cursor: Long, checked: Long, repairCursor: Long = config.repairCursor): Boolean {
        var added = false
        db.beginTransaction()
        try {
            val current = settings()
            if(current?.generation != config.generation || !current.enabled || current.since != config.since) return false
            calls.forEach { call ->
                db.execSQL("INSERT OR IGNORE INTO call_events(event_id,generation,source_id,number,outcome,started_at,duration_seconds,sim_key) VALUES(?,?,?,?,?,?,?,?)",
                    arrayOf<Any?>(UUID.randomUUID().toString(),config.generation,call.source,call.number,call.outcome,call.started,call.duration,call.simKey))
                db.rawQuery("SELECT changes()",null).use { it.moveToFirst(); added = added || it.getInt(0)>0 }
                if (call.simKey != null) {
                    db.execSQL("UPDATE call_events SET sim_key=?,state='pending' WHERE generation=? AND source_id=? AND started_at=? AND number IS ? AND outcome=? AND duration_seconds=? AND sim_key IS NULL",
                        arrayOf<Any?>(call.simKey,config.generation,call.source,call.started,call.number,call.outcome,call.duration))
                    db.rawQuery("SELECT changes()",null).use { it.moveToFirst(); added = added || it.getInt(0)>0 }
                }
            }
            db.execSQL("UPDATE call_settings SET cursor=?,checked_at=?,notice='',repair_cursor=? WHERE generation=?",arrayOf<Any>(cursor,checked,repairCursor,config.generation))
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
        return added
    }
    fun pending(generation: String): Int = db.rawQuery("SELECT COUNT(*) FROM call_events WHERE generation=? AND state='pending'",arrayOf(generation)).use { it.moveToFirst();it.getInt(0) }
    fun next(generation: String): JSONObject? = db.rawQuery("SELECT event_id,number,outcome,started_at,duration_seconds,sim_key FROM call_events WHERE generation=? AND state='pending' ORDER BY rowid LIMIT 1",arrayOf(generation)).use { c ->
        if(!c.moveToFirst()) null else JSONObject().put("eventId",c.getString(0)).put("number",if(c.isNull(1)) JSONObject.NULL else c.getString(1))
            .put("outcome",c.getString(2)).put("startedAt",c.getLong(3)).put("durationSeconds",c.getLong(4)).put("simKey",if(c.isNull(5)) JSONObject.NULL else c.getString(5))
    }
    fun complete(generation: String,event: JSONObject,state: String) {
        // A null-SIM upload may finish after collection has enriched the queued event.
        val key = if(event.isNull("simKey")) null else event.getString("simKey")
        db.execSQL("UPDATE call_events SET state=? WHERE generation=? AND event_id=? AND sim_key IS ?",arrayOf<Any?>(state,generation,event.getString("eventId"),key))
    }
    fun unresolved(config: CallSettings): List<Pair<Long,CapturedCall>> = db.rawQuery(
        "SELECT rowid,source_id,number,outcome,started_at,duration_seconds FROM call_events WHERE generation=? AND sim_key IS NULL AND rowid>? ORDER BY rowid LIMIT 100",
        arrayOf(config.generation,config.repairCursor.toString())).use { c -> buildList {
            while(c.moveToNext()) add(c.getLong(0) to CapturedCall(c.getLong(1),if(c.isNull(2)) null else c.getString(2),c.getString(3),c.getLong(4),c.getLong(5)))
        } }

    fun blocked(generation: String): Int = db.rawQuery("SELECT COUNT(*) FROM call_events WHERE generation=? AND state='blocked'",arrayOf(generation)).use { it.moveToFirst();it.getInt(0) }
    fun retryBlocked() {
        val config=settings() ?: return
        db.execSQL("UPDATE call_events SET state='pending' WHERE generation=? AND state='blocked'",arrayOf(config.generation))
    }
    fun summary(): String {
        val s=settings() ?: return "请先连接服务器"
        if(!s.enabled)return "未启用"
        val checked=s.checked?.let { java.text.DateFormat.getDateTimeInstance().format(java.util.Date(it)) } ?: "尚未检查"
        val blocked=blocked(s.generation)
        return "最近检查：$checked\n待同步 ${pending(s.generation)} · 需处理 $blocked" + if(s.notice.isNotEmpty()) "\n${s.notice}" else ""
    }
}
