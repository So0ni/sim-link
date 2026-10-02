package dev.simlink.gateway.calls

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CallLog
import dev.simlink.gateway.telephony.CallSimResolver

/** Reads system facts only. No network, credentials, or UI work here. */
class CallCollector(private val context: Context) {
    fun collect(): Boolean {
        val store = CallStore(context)
        val config = store.settings() ?: return false
        if (!config.enabled) return false
        if (!hasPermission(context)) {
            store.notice(config, "需要通话记录和电话状态权限")
            return false
        }
        return try {
            val resolver = CallSimResolver(context)
            val rows = mutableListOf<CapturedCall>()
            // Providers may be reset. Retain source identity + start time for deduplication.
            val newest = query(config, "${CallLog.Calls._ID} DESC", null, 100)
            val observedMax = newest.maxOfOrNull { it.id } ?: 0
            val initialCursor = scanCursor(config.cursor, observedMax)
            val inserted = query(config, "${CallLog.Calls._ID} ASC", initialCursor, 100)
            (inserted + newest).forEach { row ->
                val outcome = callOutcome(row.type) ?: return@forEach
                rows.add(CapturedCall(row.id,row.number,outcome,row.started,row.duration,resolver.resolve(row.component,row.account)))
            }
            // Insertion order covers late-written long calls; bounded recent recheck covers ID reuse.
            val cursor = inserted.maxOfOrNull { it.id } ?: initialCursor
            // Revisit only previously captured events, including records before a later re-enable.
            // The rotating bounded cursor avoids starving old unknowns without importing history.
            val unresolved = store.unresolved(config)
            unresolved.forEach { (_,old) ->
                val original = queryRows("${CallLog.Calls._ID}=?",arrayOf(old.source.toString()),"${CallLog.Calls._ID} ASC",1).singleOrNull()
                if(original != null && matchesCapturedCall(old,original.id,original.number,callOutcome(original.type),original.started,original.duration)) {
                    val key=resolver.resolve(original.component,original.account)
                    if(key != null) rows.add(old.copy(simKey=key))
                }
            }
            val repairCursor = unresolved.lastOrNull()?.first ?: 0L
            val added = store.save(config, rows, cursor, System.currentTimeMillis(),repairCursor)
            if (added) dev.simlink.gateway.sync.SyncScheduler.scheduleIncoming(context)
            inserted.size == 100
        } catch (_: SecurityException) {
            store.notice(config, "通话记录权限已失效")
            false
        } catch (_: Exception) {
            store.notice(config, "读取通话记录失败，将在下次唤醒重试")
            true
        }
    }

    private data class Row(val id:Long,val number:String?,val type:Int,val started:Long,val duration:Long,val component:String?,val account:String?)
    private fun query(config:CallSettings,order:String,after:Long?,limit:Int): List<Row> {
        val selection="${CallLog.Calls.DATE}>=?" + if(after==null) "" else " AND ${CallLog.Calls._ID}>?"
        val args=if(after==null) arrayOf(config.since.toString()) else arrayOf(config.since.toString(),after.toString())
        return queryRows(selection,args,order,limit)
    }
    private fun queryRows(selection:String,args:Array<String>,order:String,limit:Int): List<Row> {
        val uri=CallLog.Calls.CONTENT_URI.buildUpon().appendQueryParameter(CallLog.Calls.LIMIT_PARAM_KEY,limit.toString()).build()
        val projection=arrayOf(CallLog.Calls._ID,CallLog.Calls.NUMBER,CallLog.Calls.NUMBER_PRESENTATION,
            CallLog.Calls.TYPE,CallLog.Calls.DATE,CallLog.Calls.DURATION,
            CallLog.Calls.PHONE_ACCOUNT_COMPONENT_NAME,CallLog.Calls.PHONE_ACCOUNT_ID)
        return context.contentResolver.query(uri,projection,selection,args,order)?.use { c ->
            buildList {
                while(size<limit && c.moveToNext()) {
                    val number=if(c.getInt(2)==CallLog.Calls.PRESENTATION_ALLOWED) c.getString(1)?.takeIf { it.isNotBlank() } else null
                    add(Row(c.getLong(0),number,c.getInt(3),c.getLong(4),c.getLong(5).coerceAtLeast(0),c.getString(6),c.getString(7)))
                }
            }
        } ?: error("Call provider unavailable")
    }
    companion object {
        fun hasPermission(context: Context) = listOf(Manifest.permission.READ_CALL_LOG,Manifest.permission.READ_PHONE_STATE)
            .all { context.checkSelfPermission(it)==PackageManager.PERMISSION_GRANTED }
    }
}
