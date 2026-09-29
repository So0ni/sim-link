package dev.simlink.gateway.ui

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import android.telephony.SubscriptionInfo
import android.telephony.SubscriptionManager
import android.widget.LinearLayout
import dev.simlink.gateway.R

/** Configuration pages have no networking or message-store access. */
class GatewaySetupPages(
    private val activity: Activity,
    private val content: LinearLayout,
    private val gatewayStyle: GatewayStyle,
    private val onBack: () -> Unit,
) {
    private fun title(value: String) { content.addView(gatewayStyle.label(value,30f,bold=true)) }
    private fun text(value: String, muted: Boolean = false) { content.addView(gatewayStyle.label(value,if(muted) 14f else 16f,if(muted) gatewayStyle.muted else gatewayStyle.ink)) }
    private fun section(value: String) { content.addView(gatewayStyle.section(value)) }
    private fun action(value: String, block: () -> Unit) = gatewayStyle.action(value,block=block)
    private fun row(icon: Int, title: String, detail: String, block: (() -> Unit)? = null) {
        content.addView(gatewayStyle.row(icon,title,detail,block)); content.addView(gatewayStyle.divider())
    }
    private fun granted(permission: String) = activity.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
    private fun permissionRow(name: String, permission: String, explanation: String) {
        row(R.drawable.ic_verified_user,name,if(granted(permission)) "已授予" else "未授予")
        text(explanation,true)
        if (!granted(permission)) content.addView(action("授权$name") { activity.requestPermissions(arrayOf(permission),10) })
    }
    private fun openSettings() { activity.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:${activity.packageName}"))) }
    private fun readSims(): List<SubscriptionInfo> = if (!granted(Manifest.permission.READ_PHONE_STATE)) emptyList() else
        try { activity.getSystemService(SubscriptionManager::class.java).activeSubscriptionInfoList.orEmpty().sortedBy { it.simSlotIndex } }
        catch (_: SecurityException) { emptyList() }
    private fun batterySummary() = if (activity.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(activity.packageName)) "系统电池优化已豁免" else "系统电池优化已启用"
    private fun back() { content.addView(action("返回设置",onBack)) }
    fun permissionsPage() {
        title("启用短信能力")
        text("只申请网关实际需要的权限。短信会先保存到这部手机。",true)
        section("必要权限")
        permissionRow("接收短信",Manifest.permission.RECEIVE_SMS,"接收授权后到达的新短信，不读取系统历史。")
        content.addView(gatewayStyle.divider())
        permissionRow("读取 SIM",Manifest.permission.READ_PHONE_STATE,"识别卡槽，将收到的短信与对应 SIM 关联。")
        section("系统设置")
        row(R.drawable.ic_settings,"应用权限","权限被拒绝时，可在系统设置中调整") { openSettings() }
        text("已授权不等于收件验证完成。可从另一部手机发送普通短信，并在网页核对。",true)
        back()
    }
    fun backgroundPage() {
        title("后台运行")
        text("让手机在锁屏后仍有机会接收并同步短信。",true)
        section("系统状态")
        row(R.drawable.ic_battery_full,"电池优化",batterySummary()) {
            activity.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
        section("厂商设置")
        text("在应用设置中检查自启动和后台耗电限制。不同手机选项不同，需要你手动确认。")
        content.addView(action("打开应用设置") { openSettings() })
        text("应用无法自动确认厂商设置。重启后先解锁一次；强行停止应用会中断后台工作。",true)
        back()
    }
    fun simsPage() {
        title("SIM 卡")
        text("当前手机识别到的 SIM。名称和电话号码在网页的设备设置中管理。",true)
        val sims = readSims()
        if (sims.isEmpty()) text("暂无可读取的 SIM，请检查权限和手机卡槽。")
        sims.forEach { row(R.drawable.ic_sim_card,"SIM ${it.simSlotIndex + 1}",it.displayName.toString()) }
        text("卡槽与系统订阅可能在换卡后变化，不能作为永久卡身份。",true)
        back()
    }
}
