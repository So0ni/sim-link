package dev.simlink.gateway.platform

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/** Schema owner. Opening a P0 database preserves messages and never enrolls historical SMS. */
class GatewayDatabase private constructor(context: Context) : SQLiteOpenHelper(context, "gateway.db", null, 5) {
    init { setWriteAheadLoggingEnabled(true) }
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE messages (id TEXT PRIMARY KEY, address TEXT NOT NULL, body TEXT NOT NULL, sub_id INTEGER NOT NULL, time INTEGER NOT NULL, outgoing INTEGER NOT NULL, interrupted INTEGER NOT NULL DEFAULT 0)")
        db.execSQL("CREATE TABLE parts (message_id TEXT NOT NULL, part_index INTEGER NOT NULL, result INTEGER, PRIMARY KEY(message_id, part_index))")
        createSyncTables(db)
        createSimTables(db)
        createIdentity(db)
        createCommands(db)
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) createSyncTables(db)
        if (oldVersion < 3) createSimTables(db)
        if (oldVersion < 4) createIdentity(db)
        if (oldVersion < 5) createCommands(db)
    }
    private fun createCommands(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE remote_commands(command_id TEXT PRIMARY KEY,generation TEXT NOT NULL,claim_id TEXT NOT NULL,rejection TEXT,last_report TEXT)")
        db.execSQL("CREATE TABLE command_cursor(generation TEXT PRIMARY KEY,request_id TEXT NOT NULL)")
    }
    private fun createSyncTables(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE connection (singleton INTEGER PRIMARY KEY CHECK(singleton=1), generation TEXT NOT NULL, server TEXT NOT NULL, device_id TEXT NOT NULL, credential TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, notice TEXT NOT NULL DEFAULT '')")
        db.execSQL("CREATE TABLE outbox (event_id TEXT PRIMARY KEY, generation TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', synced_at INTEGER, error TEXT)")
        db.execSQL("CREATE INDEX outbox_pending ON outbox(generation,state)")
    }
    private fun createSimTables(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE sim_mappings (local_key TEXT PRIMARY KEY,sub_id INTEGER NOT NULL,slot_index INTEGER NOT NULL,carrier TEXT NOT NULL)")
        db.execSQL("ALTER TABLE outbox ADD COLUMN sim_key TEXT")
    }
    private fun createIdentity(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE installation (singleton INTEGER PRIMARY KEY CHECK(singleton=1),id TEXT NOT NULL)")
        db.execSQL("INSERT INTO installation VALUES(1,?)", arrayOf(java.util.UUID.randomUUID().toString()))
        db.execSQL("ALTER TABLE connection ADD COLUMN server_id TEXT")
    }
    companion object {
        @Volatile private var instance: GatewayDatabase? = null
        fun get(context: Context): GatewayDatabase = instance ?: synchronized(this) {
            instance ?: GatewayDatabase(context.applicationContext).also { instance = it }
        }
    }
}
