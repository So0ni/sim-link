package dev.simlink.gateway.data

import dev.simlink.gateway.telephony.summarizeSend

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import dev.simlink.gateway.platform.GatewayDatabase
import dev.simlink.gateway.sync.SyncQueue
import java.util.concurrent.Executors

/** One serialized executor for DB operations; receivers finish only after durable writes. */
object LocalIo { val executor = Executors.newSingleThreadExecutor() }

data class LocalMessage(
    val id: String, val address: String, val body: String, val subId: Int,
    val time: Long, val outgoing: Boolean, val interrupted: Boolean, val results: List<Int?>, val syncState: String? = null
) {
    fun status(now: Long) = if (!outgoing) when(syncState) {
        "done" -> "已在手机接收 · 已同步"
        "pending" -> "已在手机接收 · 等待同步"
        "blocked" -> "已在手机接收 · 同步需处理"
        "detached" -> "已在手机接收 · 原配对队列已暂停"
        else -> "已在手机接收 · 仅本地保存"
    } else
        summarizeSend(results, interrupted, now - time).label
}

class MessageStore private constructor(private val context: Context) {
    private val database = GatewayDatabase.get(context)
    private val writableDatabase get() = database.writableDatabase
    private val readableDatabase get() = database.readableDatabase
    fun insert(id: String, address: String, body: String, subId: Int, time: Long, outgoing: Boolean, count: Int = 0): Boolean {
        val simKey = if (outgoing) null else runCatching { dev.simlink.gateway.telephony.SimInventory(context).refresh().sims.find { it.observation.subscriptionId == subId }?.key }.getOrNull()
        val db = writableDatabase
        db.beginTransaction()
        try {
            val inserted = db.insertWithOnConflict("messages", null, ContentValues().apply {
                put("id", id); put("address", address); put("body", body); put("sub_id", subId)
                put("time", time); put("outgoing", if (outgoing) 1 else 0)
            }, SQLiteDatabase.CONFLICT_IGNORE)
            if (inserted != -1L) repeat(count) { i ->
                db.execSQL("INSERT INTO parts(message_id, part_index) VALUES (?, ?)", arrayOf<Any>(id, i))
            }
            if (inserted != -1L && !outgoing) SyncQueue.enqueueReceived(db, id, simKey)
            db.setTransactionSuccessful()
            return inserted != -1L
        } finally { db.endTransaction() }
    }
    fun result(id: String, index: Int, code: Int) {
        writableDatabase.update("parts", ContentValues().apply { put("result", code) },
            "message_id = ? AND part_index = ? AND result IS NULL", arrayOf(id, index.toString()))
    }
    fun interrupted(id: String) {
        writableDatabase.update("messages", ContentValues().apply { put("interrupted", 1) }, "id = ?", arrayOf(id))
    }
    fun recent(): List<LocalMessage> {
        val db = readableDatabase
        return db.rawQuery("SELECT m.*, CASE WHEN o.state='done' THEN 'done' WHEN o.generation != COALESCE(c.generation,'') THEN 'detached' ELSE o.state END FROM messages m LEFT JOIN outbox o ON o.event_id=m.id LEFT JOIN connection c ON c.singleton=1 ORDER BY m.time DESC LIMIT 100", null).use { c ->
            buildList {
                while (c.moveToNext()) {
                    val id = c.getString(0)
                    val parts = db.rawQuery("SELECT result FROM parts WHERE message_id = ? ORDER BY part_index", arrayOf(id)).use { p ->
                        buildList<Int?> { while (p.moveToNext()) add(if (p.isNull(0)) null else p.getInt(0)) }
                    }
                    add(LocalMessage(id, c.getString(1), c.getString(2), c.getInt(3), c.getLong(4), c.getInt(5) == 1, c.getInt(6) == 1, parts, if(c.isNull(7)) null else c.getString(7)))
                }
            }
        }
    }
    companion object {
        @Volatile private var instance: MessageStore? = null
        fun get(context: Context): MessageStore = instance ?: synchronized(this) {
            instance ?: MessageStore(context.applicationContext).also { instance = it }
        }
    }
}
