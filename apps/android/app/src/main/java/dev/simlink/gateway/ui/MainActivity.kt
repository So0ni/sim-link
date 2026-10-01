package dev.simlink.gateway.ui

import dev.simlink.gateway.R
import dev.simlink.gateway.BuildConfig
import dev.simlink.gateway.data.*
import dev.simlink.gateway.telephony.*

import android.Manifest
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.os.PowerManager
import android.os.BatteryManager
import android.telephony.SubscriptionInfo
import android.telephony.SubscriptionManager
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.widget.*
import java.text.DateFormat
import java.util.Date
import java.util.concurrent.atomic.AtomicBoolean

/** Local gateway UI; connection and sync own networking and credentials. */
open class MainActivity : ComponentActivity() {
    private val gatewayStyle by lazy { GatewayStyle(this) }
    private val blue get() = gatewayStyle.blue
    private val ink get() = gatewayStyle.ink
    private val muted get() = gatewayStyle.muted
    private lateinit var root: LinearLayout
    private lateinit var content: LinearLayout
    private var renderedPage = ""
    private var scrollView: ScrollView? = null
    private var page = "运行"
    private var draftAddress = ""
    private var draftBody = ""
    private var selectedSub = -1
    private var selectedSlot = -1
    private var availableSims: List<SubscriptionInfo> = emptyList()
    private val handler = Handler(Looper.getMainLooper())
    private var records: List<LocalMessage> = emptyList()
    private var loadError: String? = null
    private var statusNotice: String? = null
    private var paired = false
    private var syncEnabled = false
    private var serverAddress = "尚未连接"
    private var callsOverview = ""
    private var connectionOverview = "正在读取服务器状态…"
    private val refresh = object : Runnable {
        override fun run() { loadRecords(); handler.postDelayed(this, 2000) }
    }

    private var commandPollRunning = false
    private val commandPoll = object : Runnable {
        override fun run() {
            if (!commandPollRunning) {
                commandPollRunning = true
                dev.simlink.gateway.sync.NetworkIo.executor.execute {
                    try { dev.simlink.gateway.sync.SyncRunner(applicationContext).run(dev.simlink.gateway.connection.RequestCancellation()) }
                    catch (_: Exception) { /* Durable queues retry on the next poll. */ }
                    finally { runOnUiThread { commandPollRunning = false } }
                }
            }
            handler.postDelayed(this,15000)
        }
    }
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        page = state?.getString("page") ?: "运行"
        intent.getStringExtra("connection_notice")?.let { Toast.makeText(this,it,Toast.LENGTH_LONG).show() }
        draftAddress = state?.getString("address").orEmpty()
        draftBody = state?.getString("body").orEmpty()
        selectedSub = state?.getInt("sub", -1) ?: -1
        selectedSlot = state?.getInt("slot", -1) ?: -1
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
            setOnApplyWindowInsetsListener { v, insets ->
                val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
                insets
            }
        }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (page !in listOf("运行", "短信", "设置")) navigate("设置")
                else if (page != "运行") navigate("运行") else finish()
            }
        })
        setContentView(root)
        root.requestApplyInsets()
        draw()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra("connection_notice")?.let { Toast.makeText(this,it,Toast.LENGTH_LONG).show(); page = "运行" }
        draw()
    }
    override fun onResume() {
        super.onResume()
        dev.simlink.gateway.calls.CallCaptureScheduler.wake(applicationContext)
        handler.removeCallbacks(refresh)
        handler.post(refresh)
        handler.removeCallbacks(commandPoll)
        handler.post(commandPoll)
        // Permission/role settings may have changed while away. Re-read instead of assuming success.
        dev.simlink.gateway.sync.SyncScheduler.schedule(applicationContext)
        draw()
    }
    override fun onPause() { captureDraft(); handler.removeCallbacks(refresh); handler.removeCallbacks(commandPoll); super.onPause() }
    override fun onSaveInstanceState(out: Bundle) {
        captureDraft()
        out.putString("page", page); out.putString("address", draftAddress); out.putString("body", draftBody)
        out.putInt("sub", selectedSub); out.putInt("slot", selectedSlot)
        super.onSaveInstanceState(out)
    }
    override fun onRequestPermissionsResult(code: Int, permissions: Array<String>, results: IntArray) {
        super.onRequestPermissionsResult(code, permissions, results)
        draw()
    }
    private fun granted(permission: String) = checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
    private fun dp(n: Int) = (n * resources.displayMetrics.density).toInt()
    private fun label(text: String, size: Float = 16f, color: Int = ink) = gatewayStyle.label(text,size,color)
    private fun action(title: String, primary: Boolean = false, block: () -> Unit) = gatewayStyle.action(title,primary,block=block)
    private fun title(text: String) { content.addView(label(text, 30f).apply { setTypeface(typeface, Typeface.BOLD) }) }
    private fun text(value: String, mutedText: Boolean = false) { content.addView(label(value, if (mutedText) 14f else 16f, if (mutedText) muted else ink)) }
    private fun navigate(next: String) { captureDraft(); page = next; draw() }
    private fun captureDraft() {
        root.findViewWithTag<EditText>("address")?.let { draftAddress = it.text.toString() }
        root.findViewWithTag<EditText>("body")?.let { draftBody = it.text.toString() }
    }
    private fun loadRecords() {
        LocalIo.executor.execute {
            val result = runCatching { MessageStore.get(this).recent() }
            var currentConnection: dev.simlink.gateway.connection.Connection? = null
            val overview = runCatching {
                val c = dev.simlink.gateway.connection.ConnectionStore(applicationContext).current()
                currentConnection = c
                if (c == null) "尚未配对 · 短信仅保存在本机" else
                    "${if (c.enabled) "已配对" else "同步已暂停"} · ${c.server}\n${dev.simlink.gateway.sync.SyncQueue(applicationContext).summary(c.generation)}\n${c.notice}"
            }.getOrDefault("无法读取连接状态，请检查本机存储")
            val callSummary = runCatching { dev.simlink.gateway.calls.CallStore(applicationContext).summary() }.getOrDefault("无法读取来电状态")
            handler.post {
                if (isDestroyed || isFinishing) return@post
                val callChanged = callsOverview != callSummary
                callsOverview = callSummary
                val connectionChanged = overview != connectionOverview
                connectionOverview = overview
                paired = currentConnection != null
                syncEnabled = currentConnection?.enabled == true
                serverAddress = currentConnection?.server ?: "尚未连接"
                val changed = result.getOrNull() != records || (result.isFailure != (loadError != null))
                records = result.getOrDefault(records)
                loadError = if (result.isFailure) "无法读取本地记录，请检查手机存储空间。" else null
                if (page in listOf("运行", "诊断") && (connectionChanged || callChanged)) draw()
                if (page == "来电" && callChanged) draw()
                if (page == "短信" && (changed || records.any { it.outgoing && it.results.any { r -> r == null } })) draw()
            }
        }
    }
    private fun draw() {
        if (!::root.isInitialized) return
        captureDraft()
        val previousScroll = if (renderedPage == page) scrollView?.scrollY ?: 0 else 0
        renderedPage = page
        root.removeAllViews()
        val header = label("SIMLink Gateway", 16f, muted).apply { setPadding(dp(20), dp(12), dp(20), dp(8)) }
        val subpage = page !in listOf("运行","短信","设置")
        if (subpage) {
            root.addView(LinearLayout(this).apply {
                gravity = Gravity.CENTER_VERTICAL; setPadding(dp(8),dp(4),dp(20),dp(4))
                addView(ImageButton(this@MainActivity).apply {
                    setImageResource(R.drawable.ic_arrow_back); imageTintList = android.content.res.ColorStateList.valueOf(muted)
                    contentDescription = "返回设置"; setBackgroundColor(Color.TRANSPARENT)
                    setOnClickListener { navigate("设置") }
                },LinearLayout.LayoutParams(dp(48),dp(48)))
                addView(label("SIMLink Gateway",16f,muted))
            })
        } else root.addView(header)
        val scroll = ScrollView(this).apply { isFillViewport = true }
        content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), 0, dp(20), dp(24)) }
        scrollView = scroll
        scroll.addView(content)
        scroll.post { scroll.scrollTo(0, previousScroll) }
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        when (page) {
            "运行" -> statusPage(); "短信" -> messagesPage()
            "发送" -> if (BuildConfig.DEBUG) composePage() else settingsPage()
            "权限" -> setupPages().permissionsPage(); "后台" -> setupPages().backgroundPage(); "SIM" -> setupPages().simsPage()
            "来电" -> CallSettingsPage(this,content,gatewayStyle).draw()
            "诊断" -> diagnosticsPage(); else -> settingsPage()
        }
        if (subpage) return
        root.addView(gatewayStyle.divider())
        val nav = LinearLayout(this).apply { gravity = Gravity.CENTER }
        listOf("运行" to R.drawable.ic_home, "短信" to R.drawable.ic_mail, "设置" to R.drawable.ic_settings).forEach { (name, icon) ->
            val selected = if (page in listOf("运行","短信","设置")) page else "设置"
            nav.addView(gatewayStyle.navigation(name,icon,selected == name) { navigate(name) },LinearLayout.LayoutParams(0,-2,1f))
        }
        root.addView(nav)
    }
    private fun setupPages() = GatewaySetupPages(this,content,gatewayStyle)
    private fun section(name: String) { content.addView(gatewayStyle.section(name)) }
    private fun row(icon: Int, title: String, detail: String, block: (() -> Unit)? = null) {
        content.addView(gatewayStyle.row(icon,title,detail,block)); content.addView(gatewayStyle.divider())
    }
    private fun connection() { startActivity(Intent(this, ConnectionActivity::class.java)) }
    private fun permissionRow(name: String, permission: String, explanation: String) {
        text("$name · ${if (granted(permission)) "已授予" else "未授予"}")
        text(explanation, true)
        if (!granted(permission)) content.addView(action("授权$name") { requestPermissions(arrayOf(permission), 10) })
    }
    private fun readSims(): List<SubscriptionInfo> = if (!granted(Manifest.permission.READ_PHONE_STATE)) emptyList() else
        try { getSystemService(SubscriptionManager::class.java).activeSubscriptionInfoList.orEmpty().sortedBy { it.simSlotIndex } }
        catch (_: SecurityException) { emptyList() }

    private fun statusPage() {
        title("运行状态")
        val needsPermission = !granted(Manifest.permission.RECEIVE_SMS) || !granted(Manifest.permission.READ_PHONE_STATE)
        val panel = gatewayStyle.panel(if (paired && !syncEnabled) gatewayStyle.warning else gatewayStyle.selected)
        panel.addView(gatewayStyle.label(when {
            !paired -> "连接你的服务器"
            !syncEnabled -> "同步需要处理"
            needsPermission -> "完成运行配置"
            else -> "已配对，自动同步已启用"
        },20f,bold=true))
        panel.addView(label(when {
            !paired -> "连接后，新收到的短信会同步到你的 SIMLink。"
            !syncEnabled -> "短信仍保存在本机，请检查服务器连接。"
            needsPermission -> "授予接收短信和读取 SIM 权限，让这部手机开始工作。"
            else -> "新短信先保存在本机，再由系统安排同步。"
        },14f,muted))
        if (paired) panel.addView(label(connectionOverview.substringAfter('\n', ""),13f,muted))
        panel.addView(action(if (!paired) "连接服务器" else if (needsPermission) "完成权限设置" else "查看同步状态", !paired || needsPermission) {
            if (paired && needsPermission) navigate("权限") else connection()
        })
        content.addView(panel)
        section("此设备")
        row(R.drawable.ic_smartphone,"手机",Build.MODEL)
        row(R.drawable.ic_dns,"服务器",serverAddress) { connection() }
        val battery = getSystemService(BatteryManager::class.java).getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        row(R.drawable.ic_battery_full,"电量",if (battery in 0..100) "$battery%" else "暂时无法读取")
        section("SIM 卡")
        availableSims = readSims()
        if (availableSims.isEmpty()) row(R.drawable.ic_sim_card,"尚未识别 SIM",if (granted(Manifest.permission.READ_PHONE_STATE)) "请检查手机中的 SIM 卡" else "需要读取 SIM 权限") { navigate("权限") }
        availableSims.forEach { row(R.drawable.ic_sim_card,"SIM ${it.simSlotIndex + 1}",it.displayName.toString()) { navigate("SIM") } }
        section("运行条件")
        row(R.drawable.ic_verified_user,"短信与 SIM 权限",if (needsPermission) "需要设置" else "已授予") { navigate("权限") }
        row(R.drawable.ic_sync,"来电同步",dev.simlink.gateway.calls.CallStore(this).summary()) { navigate("来电") }
        row(R.drawable.ic_battery_full,"后台运行",batterySummary()) { navigate("后台") }
    }
    private fun batterySummary() = if (getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName)) "系统电池优化已豁免" else "系统电池优化已启用"
    private fun messagesPage() {
        title("短信")
        text("本机最近 100 条 · 不读取系统历史短信", true)
        statusNotice?.let { text(it) }
        loadError?.let { text(it) }

        if (records.isEmpty()) text("还没有短信。授权后收到的新短信会出现在这里。")
        records.forEach { m ->
            val box = gatewayStyle.panel(if (m.outgoing) gatewayStyle.selected else gatewayStyle.subtle)
            box.addView(label("${if (m.outgoing) "发给" else "来自"} ${m.address}").apply { setTypeface(typeface, Typeface.BOLD) })
            box.addView(label(m.body).apply { setTextIsSelectable(true) })
            box.addView(label("${DateFormat.getDateTimeInstance().format(Date(m.time))}\n${if (m.subId >= 0) "接收/发送时订阅 ${m.subId}" else "SIM 归属未知"}\n${m.status(System.currentTimeMillis())}", 13f, muted))
            content.addView(box)
        }
        if (records.any { it.outgoing }) text("没有自动重发。结果未确认或部分成功时，请先核对收件方。", true)
    }
    private fun composePage() {
        title("发送测试短信")
        text("将通过实体 SIM 发送，可能产生运营商费用。只向你自己的测试号码发送。", true)
        permissionRow("发送短信", Manifest.permission.SEND_SMS, "本机测试会真实发送；远程发送需在权限页单独启用。")
        availableSims = readSims()
        text("发送 SIM")
        val spinner = Spinner(this).apply { minimumHeight = dp(48); contentDescription = "选择发送 SIM" }
        val labels = listOf("请选择 SIM") + availableSims.map { "卡槽 ${it.simSlotIndex + 1} · ${it.displayName} · 订阅 ${it.subscriptionId}" }
        spinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, labels)
        val previous = availableSims.indexOfFirst { it.subscriptionId == selectedSub && it.simSlotIndex == selectedSlot }
        if (previous < 0) { selectedSub = -1; selectedSlot = -1 }
        spinner.setSelection(previous + 1)
        spinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onNothingSelected(parent: AdapterView<*>?) { selectedSub = -1; selectedSlot = -1 }
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                selectedSub = availableSims.getOrNull(position - 1)?.subscriptionId ?: -1
                selectedSlot = availableSims.getOrNull(position - 1)?.simSlotIndex ?: -1
            }
        }
        content.addView(spinner)
        if (availableSims.isEmpty()) text("请先在运行页授予读取 SIM 权限，并检查 SIM。", true)
        val address = gatewayStyle.decorateField(EditText(this)).apply {
            tag = "address"; hint = "+65 8123 4567"; contentDescription = "收件号码（含国家区号）"
            inputType = InputType.TYPE_CLASS_PHONE; minHeight = dp(48); setText(draftAddress)
        }
        text("收件号码（含国家区号）"); content.addView(address)
        val body = gatewayStyle.decorateField(EditText(this)).apply {
            tag = "body"; hint = "输入测试短信"; contentDescription = "短信正文"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
            minLines = 4; gravity = Gravity.TOP; setText(draftBody)
        }
        text("短信正文"); content.addView(body)
        content.addView(action("使用所选 SIM 发送", true) {
            captureDraft()
            val number = normalizedRecipient(draftAddress)
            when {
                number == null -> { address.error = "请输入带国家区号的完整号码"; address.requestFocus() }
                draftBody.isBlank() -> { body.error = "请输入短信正文"; body.requestFocus() }
                selectedSub < 0 -> Toast.makeText(this, "请先选择发送 SIM", Toast.LENGTH_LONG).show()
                !granted(Manifest.permission.SEND_SMS) -> Toast.makeText(this, "请先授予发送权限", Toast.LENGTH_LONG).show()
                else -> dispatch(number, draftBody, selectedSub, selectedSlot)
            }
        })
        content.addView(action("返回短信") { navigate("短信") })
    }
    private fun dispatch(number: String, body: String, sub: Int, slot: Int) {
        if (!sendInProgress.compareAndSet(false, true)) return
        val app = applicationContext
        // Leave the form immediately to guard double taps; retain input if preflight fails.
        statusNotice = "正在提交本机发送…"
        page = "短信"; draw()
        draftAddress = ""; draftBody = ""
        LocalIo.executor.execute {
            val result = runCatching { SmsSender.send(app, sub, slot, number, body) }
            sendInProgress.set(false)
            handler.post {
                if (isDestroyed || isFinishing) return@post
                if (result.isSuccess) {
                    statusNotice = "已记录发送请求。以下状态以系统回调为准。"
                } else {
                    if (draftAddress.isEmpty() && draftBody.isEmpty()) { draftAddress = number; draftBody = body }
                    statusNotice = "未提交发送。请检查权限、SIM 和本地存储，草稿已保留。"
                }
                loadRecords()
                if (page == "短信") draw()
            }
        }
    }
    private fun settingsPage() {
        title("设置")
        section("网关")
        row(R.drawable.ic_dns,"服务器与同步","连接、修改地址与解除配对") { connection() }
        row(R.drawable.ic_sync,"来电同步","权限、新来电采集与同步状态") { navigate("来电") }
        row(R.drawable.ic_sim_card,"SIM 卡","查看此设备中的卡片") { navigate("SIM") }
        section("运行条件")
        row(R.drawable.ic_verified_user,"短信与 SIM 权限","管理网关需要的访问权限") { navigate("权限") }
        row(R.drawable.ic_battery_full,"后台运行","电池优化与厂商设置") { navigate("后台") }
        section("关于")
        row(R.drawable.ic_info,"诊断与帮助","查看设备信息与本机数据说明") { navigate("诊断") }
        text("SIMLink Gateway · ${BuildConfig.VERSION_NAME}",true)
    }
    private fun diagnosticsPage() {
        title("诊断与帮助")
        row(R.drawable.ic_smartphone,"设备","${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE}")
        row(R.drawable.ic_sync,"同步",connectionOverview)
        section("本机数据")
        text("本机记录保存在应用私有存储中，备份已关闭。卸载或清除存储会删除本地记录，服务端副本不受影响。",true)
        text("发送结果以系统回调为准，不自动重发实体短信。当前未请求送达报告。",true)
        if (BuildConfig.DEBUG) {
            section("开发调试")
            content.addView(action("本机测试发送") { navigate("发送") })
        }
    }
    private fun openSettings() { startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))) }
    companion object { private val sendInProgress = AtomicBoolean(false) }
}
