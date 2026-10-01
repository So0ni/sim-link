package dev.simlink.gateway.ui

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.widget.LinearLayout
import dev.simlink.gateway.calls.*
import dev.simlink.gateway.sync.SyncScheduler

/** Uses the existing native gateway components; permission and opt-in remain separate. */
class CallSettingsPage(private val activity: Activity,private val content: LinearLayout,private val style: GatewayStyle) {
    fun draw() {
        val store=CallStore(activity)
        val config=store.settings()
        val permission=CallCollector.hasPermission(activity)
        content.addView(style.label("来电同步",30f,bold=true))
        content.addView(style.label("记录启用后打进来的电话，方便在其他手机回拨。已开启网页通知时，会提醒新未接来电。",14f,style.muted))
        content.addView(style.section("访问权限"))
        content.addView(style.label(if(permission) "通话记录权限已授予" else "需要通话记录和电话状态权限",18f,bold=true))
        content.addView(style.label("系统权限允许读取通话记录；SIMLink 只采集本次启用后的来电，不导入此前历史，不接听或拨打电话。",14f,style.muted))
        if(!permission)content.addView(style.action("授权来电访问",primary=true) {
            activity.requestPermissions(arrayOf(Manifest.permission.READ_CALL_LOG,Manifest.permission.READ_PHONE_STATE),10)
        })
        content.addView(style.section("同步状态"))
        val panel=style.panel(style.selected)
        panel.addView(style.label(if(config?.enabled==true) "来电同步已启用" else "来电同步未启用",20f,bold=true))
        panel.addView(style.label(store.summary(),14f,style.muted))
        content.addView(panel)
        if(config!=null)content.addView(style.action(if(config.enabled) "关闭来电同步" else "启用来电同步",primary=permission&&!config.enabled) {
            if(!config.enabled&&!permission) {
                activity.requestPermissions(arrayOf(Manifest.permission.READ_CALL_LOG,Manifest.permission.READ_PHONE_STATE),10)
            } else {
                store.enable(!config.enabled)
                CallCaptureScheduler.request(activity)
                SyncScheduler.schedule(activity)
                activity.recreate()
            }
        })
        if(config?.enabled==true)content.addView(style.action("检查并同步") {
            CallCaptureScheduler.request(activity)
            SyncScheduler.schedule(activity)
            android.widget.Toast.makeText(activity,"已安排检查，稍后刷新状态",android.widget.Toast.LENGTH_SHORT).show()
        })
        if(config?.enabled==true && store.blocked(config.generation)>0)content.addView(style.action("重试需处理记录") {
            store.retryBlocked()
            SyncScheduler.scheduleIncoming(activity)
            activity.recreate()
        })
        content.addView(style.label("电话结束后检查记录，断网时先保存在本机；心跳和周期任务补查遗漏。关闭后停止采集与上传，已有记录保留。重新启用从当时开始采集，并继续上传原有待同步记录。",14f,style.muted))
        content.addView(style.label("无法确认接收卡时显示“SIM 未知”。心跳成功不代表来电已同步。",14f,style.muted))
        content.addView(style.action("打开应用权限设置") { activity.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:${activity.packageName}"))) })
    }
}
