package dev.simlink.gateway

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
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
import android.provider.Telephony
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

/** P0 native validation UI. No server, role replacement, mock SMS, or implicit sends. */
class MainActivity : Activity() {
    private val blue = Color.rgb(8, 102, 230)
    private val ink = Color.rgb(23, 32, 51)
    private val muted = Color.rgb(88, 101, 121)
    private lateinit var root: LinearLayout
    private lateinit var content: LinearLayout
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
    private val refresh = object : Runnable {
        override fun run() { loadRecords(); handler.postDelayed(this, 2000) }
    }

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        page = state?.getString("page") ?: "运行"
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
        setContentView(root)
        root.requestApplyInsets()
        draw()
    }

    override fun onResume() {
        super.onResume()
        handler.removeCallbacks(refresh)
        handler.post(refresh)
        // Permission/role settings may have changed while away. Re-read instead of assuming success.
        draw()
    }
    override fun onPause() { captureDraft(); handler.removeCallbacks(refresh); super.onPause() }
    override fun onSaveInstanceState(out: Bundle) {
        captureDraft()
        out.putString("page", page); out.putString("address", draftAddress); out.putString("body", draftBody)
        out.putInt("sub", selectedSub); out.putInt("slot", selectedSlot)
        super.onSaveInstanceState(out)
    }
    override fun onRequestPermissionsResult(code: Int, permissions: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(code, permissions, results)
        draw()
    }
    private fun granted(permission: String) = checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
    private fun dp(n: Int) = (n * resources.displayMetrics.density).toInt()
    private fun label(text: String, size: Float = 16f, color: Int = ink) = TextView(this).apply {
        this.text = text; textSize = size; setTextColor(color)
        setPadding(0, dp(8), 0, dp(8)); setTextIsSelectable(true)
    }
    private fun action(title: String, primary: Boolean = false, block: () -> Unit) = Button(this).apply {
        text = title; isAllCaps = false; minHeight = dp(48)
        setTextColor(if (primary) Color.WHITE else blue)
        backgroundTintList = android.content.res.ColorStateList.valueOf(if (primary) blue else Color.rgb(235, 243, 255))
        setOnClickListener { block() }
        layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8); bottomMargin = dp(4) }
    }
    private fun title(text: String) { content.addView(label(text, 28f).apply { setTypeface(typeface, Typeface.BOLD) }) }
    private fun text(value: String, mutedText: Boolean = false) { content.addView(label(value, if (mutedText) 14f else 16f, if (mutedText) muted else ink)) }
    private fun navigate(next: String) { captureDraft(); page = next; draw() }
    private fun captureDraft() {
        root.findViewWithTag<EditText>("address")?.let { draftAddress = it.text.toString() }
        root.findViewWithTag<EditText>("body")?.let { draftBody = it.text.toString() }
    }
    private fun loadRecords() {
        LocalIo.executor.execute {
            val result = runCatching { MessageStore.get(this).recent() }
            handler.post {
                if (isDestroyed || isFinishing) return@post
                val changed = result.getOrNull() != records || (result.isFailure != (loadError != null))
                records = result.getOrDefault(records)
                loadError = if (result.isFailure) "无法读取本地记录，请检查手机存储空间。" else null
                if (page == "短信" && (changed || records.any { it.outgoing && it.results.any { r -> r == null } })) draw()
            }
        }
    }
    private fun draw() {
        if (!::root.isInitialized) return
        captureDraft()
        root.removeAllViews()
        val header = label("SIMLink Gateway", 18f).apply { setPadding(dp(20), dp(12), dp(20), dp(8)) }
        root.addView(header)
        val scroll = ScrollView(this).apply { isFillViewport = true }
        content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), 0, dp(20), dp(24)) }
        scroll.addView(content)
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        when (page) { "运行" -> statusPage(); "短信" -> messagesPage(); "发送" -> composePage(); else -> settingsPage() }
        val nav = LinearLayout(this).apply { gravity = Gravity.CENTER; setPadding(dp(12), dp(4), dp(12), dp(4)) }
        listOf("运行", "短信", "设置").forEach { name ->
            nav.addView(Button(this).apply {
                text = name; isAllCaps = false; minHeight = dp(48)
                setTextColor(if (page == name || (name == "短信" && page == "发送")) blue else muted)
                setBackgroundColor(Color.WHITE)
                setOnClickListener { navigate(name) }
            }, LinearLayout.LayoutParams(0, -2, 1f))
        }
        root.addView(nav)
    }
    private fun permissionRow(name: String, permission: String, explanation: String) {
        text("$name · ${if (granted(permission)) "已授予" else "未授予"}")
        text(explanation, true)
        if (!granted(permission)) content.addView(action("授权$name") { requestPermissions(arrayOf(permission), 10) })
    }
    private fun readSims(): List<SubscriptionInfo> = if (!granted(Manifest.permission.READ_PHONE_STATE)) emptyList() else
        try { getSystemService(SubscriptionManager::class.java).activeSubscriptionInfoList.orEmpty().sortedBy { it.simSlotIndex } }
        catch (_: SecurityException) { emptyList() }

    private fun statusPage() {
        title("短信能力验证")
        text("P0 本地实验 · 尚未连接后端", true)
        text("先授权接收和 SIM 读取，再从另一部手机发一条普通测试短信。这里只保存授权后收到的新短信。")
        permissionRow("接收短信", Manifest.permission.RECEIVE_SMS, "在本机记录新短信，以验证锁屏时的接收。不会上传内容。")
        permissionRow("读取 SIM", Manifest.permission.READ_PHONE_STATE, "识别当前可用的卡槽与订阅，发送时由你明确选卡。")
        content.addView(action("打开应用系统设置") { openSettings() })
        text("若系统不允许授权，请在系统设置检查；权限成功也不代表已经实测收件。", true)
        text("SIM 卡", false)
        availableSims = readSims()
        if (availableSims.isEmpty()) text("暂无可读取的 SIM。请先授权并检查手机中的 SIM。", true)
        availableSims.forEach { text("卡槽 ${it.simSlotIndex + 1} · ${it.displayName}\n当前订阅 ${it.subscriptionId} · 号码未读取") }
        text("默认短信应用：${Telephony.Sms.getDefaultSmsPackage(this) ?: "未知"}", true)
        text("本实验不替换默认短信应用。验证码覆盖、双卡映射和后台稳定性仍待真机确认。", true)
        content.addView(action("查看收到的短信", true) { navigate("短信") })
    }
    private fun messagesPage() {
        title("短信")
        text("本机最近 100 条 · 不读取系统历史短信", true)
        statusNotice?.let { text(it) }
        loadError?.let { text(it) }
        content.addView(action("新建测试短信", true) { navigate("发送") })
        if (records.isEmpty()) text("还没有本地记录。授权接收后，从另一部手机发送一条测试短信。")
        records.forEach { m ->
            val box = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL; setPadding(dp(14), dp(8), dp(14), dp(12))
                setBackgroundColor(if (m.outgoing) Color.rgb(235, 243, 255) else Color.rgb(245, 247, 250))
                layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(16) }
            }
            box.addView(label("${if (m.outgoing) "发给" else "来自"} ${m.address}").apply { setTypeface(typeface, Typeface.BOLD) })
            box.addView(label(m.body))
            box.addView(label("${DateFormat.getDateTimeInstance().format(Date(m.time))}\n${if (m.subId >= 0) "接收/发送时订阅 ${m.subId}" else "SIM 归属未知"}\n${m.status(System.currentTimeMillis())}", 13f, muted))
            if (m.outgoing) {
                box.addView(label(m.results.mapIndexed { i, r -> "分段 ${i + 1}：${when(r) { null -> "尚无回调"; -1 -> "系统报告已发送"; else -> "系统错误码 $r" }}" }.joinToString("\n"), 13f, muted))
            }
            content.addView(box)
        }
        text("没有自动重发。结果未确认或部分成功时，请先核对收件方。", true)
    }
    private fun composePage() {
        title("发送测试短信")
        text("将通过实体 SIM 发送，可能产生运营商费用。只向你自己的测试号码发送。", true)
        permissionRow("发送短信", Manifest.permission.SEND_SMS, "只在你点击发送时使用，不接受远程命令。")
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
        val address = EditText(this).apply {
            tag = "address"; hint = "+65 8123 4567"; contentDescription = "收件号码（含国家区号）"
            inputType = InputType.TYPE_CLASS_PHONE; minHeight = dp(48); setText(draftAddress)
        }
        text("收件号码（含国家区号）"); content.addView(address)
        val body = EditText(this).apply {
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
        text("SIMLink Gateway · ${BuildConfig.VERSION_NAME}")
        text("${Build.MANUFACTURER} ${Build.MODEL}\nAndroid ${Build.VERSION.RELEASE} / API ${Build.VERSION.SDK_INT}")
        text("服务器：尚未接入\n默认短信角色：本实验不申请\n自动重发：关闭且不可开启\n送达报告：本实验未请求", true)
        text("数据仅保存在此应用的私有存储，备份已关闭。卸载或通过系统设置清除应用存储将删除这些本地记录。", true)
        text("重启后需先解锁。强行停止、厂商省电或权限撤销可能阻止收件；不承诺后台常驻。", true)
        content.addView(action("打开应用系统设置") { openSettings() })
        content.addView(action("查看验证步骤") {
            AlertDialog.Builder(this).setTitle("真机验证")
                .setMessage("1. 授予接收和 SIM 权限\n2. 测试普通短信与长短信\n3. 双卡逐张接收并核对订阅\n4. 手动选择 SIM 发送给测试号码\n5. 锁屏、重启解锁后重复收件\n6. 飞行模式测试发送失败\n\n请在验证表记录结果；不要提交真实号码和短信正文。")
                .setPositiveButton("知道了", null).show()
        })
    }
    private fun openSettings() { startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))) }
    companion object { private val sendInProgress = AtomicBoolean(false) }
}
