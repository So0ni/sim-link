package dev.simlink.gateway

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.util.concurrent.Executors

/** One serialized executor for DB operations; receivers finish only after durable writes. */
object LocalIo { val executor = Executors.newSingleThreadExecutor() }

data class LocalMessage(
    val id: String, val address: String, val body: String, val subId: Int,
    val time: Long, val outgoing: Boolean, val interrupted: Boolean, val results: List<Int?>
) {
    fun status(now: Long) = if (!outgoing) "已在手机接收 · 尚未同步" else
        summarizeSend(results, interrupted, now - time).label
}

class MessageStore private constructor(context: Context) : SQLiteOpenHelper(context, "gateway.db", null, 1) {
    init { setWriteAheadLoggingEnabled(true) }
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE messages (id TEXT PRIMARY KEY, address TEXT NOT NULL, body TEXT NOT NULL, sub_id INTEGER NOT NULL, time INTEGER NOT NULL, outgoing INTEGER NOT NULL, interrupted INTEGER NOT NULL DEFAULT 0)")
        db.execSQL("CREATE TABLE parts (message_id TEXT NOT NULL, part_index INTEGER NOT NULL, result INTEGER, PRIMARY KEY(message_id, part_index))")
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = error("Migration required")
    fun insert(id: String, address: String, body: String, subId: Int, time: Long, outgoing: Boolean, count: Int = 0) {
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
            db.setTransactionSuccessful()
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
        return db.rawQuery("SELECT * FROM messages ORDER BY time DESC LIMIT 100", null).use { c ->
            buildList {
                while (c.moveToNext()) {
                    val id = c.getString(0)
                    val parts = db.rawQuery("SELECT result FROM parts WHERE message_id = ? ORDER BY part_index", arrayOf(id)).use { p ->
                        buildList<Int?> { while (p.moveToNext()) add(if (p.isNull(0)) null else p.getInt(0)) }
                    }
                    add(LocalMessage(id, c.getString(1), c.getString(2), c.getInt(3), c.getLong(4), c.getInt(5) == 1, c.getInt(6) == 1, parts))
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
