package dev.simlink.gateway.sync

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import dev.simlink.gateway.platform.GatewayDatabase

class SyncQueue(context: Context) {
    private val db = GatewayDatabase.get(context).writableDatabase
    fun next(generation: String): UploadEvent? = db.rawQuery("SELECT m.id,m.address,m.body,m.sub_id,m.time FROM outbox o JOIN messages m ON m.id=o.event_id WHERE o.generation=? AND o.state='pending' AND m.outgoing=0 ORDER BY m.rowid LIMIT 1", arrayOf(generation)).use { c ->
        if (!c.moveToFirst()) null else UploadEvent(c.getString(0),c.getString(1),c.getString(2),c.getInt(3),c.getLong(4))
    }
    fun ack(generation: String, event: UploadEvent, syncedAt: Long) {
        db.execSQL("UPDATE outbox SET state='done',synced_at=?,error=NULL WHERE generation=? AND event_id=? AND state='pending'", arrayOf<Any>(syncedAt, generation, event.id))
    }
    fun block(generation: String, event: UploadEvent, reason: String) {
        db.execSQL("UPDATE outbox SET state='blocked',error=? WHERE generation=? AND event_id=?", arrayOf(reason, generation, event.id))
    }
    fun retryBlocked(generation: String) { db.execSQL("UPDATE outbox SET state='pending',error=NULL WHERE generation=? AND state='blocked'", arrayOf(generation)) }
    fun summary(generation: String): String = db.rawQuery("SELECT state,COUNT(*) FROM outbox WHERE generation=? GROUP BY state", arrayOf(generation)).use { c ->
        val counts = mutableMapOf<String, Int>(); while (c.moveToNext()) counts[c.getString(0)] = c.getInt(1)
        "待同步 ${counts["pending"] ?: 0} · 需处理 ${counts["blocked"] ?: 0} · 已同步 ${counts["done"] ?: 0}"
    }
    companion object {
        /** Called inside the same transaction that inserts a NEW incoming message. No historical enrollment. */
        fun enqueueReceived(db: SQLiteDatabase, id: String) {
            db.execSQL("INSERT OR IGNORE INTO outbox(event_id,generation) SELECT ?,generation FROM connection WHERE singleton=1", arrayOf(id))
        }
    }
}
