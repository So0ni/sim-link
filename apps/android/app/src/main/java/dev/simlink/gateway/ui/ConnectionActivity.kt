package dev.simlink.gateway.ui

import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.text.InputType
import android.view.View
import android.view.WindowInsets
import android.widget.*
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import dev.simlink.gateway.BuildConfig
import dev.simlink.gateway.connection.*
import dev.simlink.gateway.sync.NetworkIo
import dev.simlink.gateway.sync.SyncQueue
import dev.simlink.gateway.sync.SyncScheduler

/** Onboarding and maintenance are separate states; credentials never enter saved UI state. */
class ConnectionActivity : ComponentActivity() {
    private lateinit var style: GatewayStyle
    private lateinit var content: LinearLayout
    private lateinit var status: TextView
    private lateinit var progress: ProgressBar
    private val actions = mutableListOf<View>()
    private var cancellation: RequestCancellation? = null
    private var busy = false
    private var connection: Connection? = null
    private var route = "loading"
    private val scanner = registerForActivityResult(ScanContract()) { result ->
        result.contents?.let { raw ->
            try {
                val code = PairingQr.parse(raw)
                val insecure = code.server.startsWith("http:")
                if (insecure && !BuildConfig.DEBUG) {
                    showError("此安装版本仅支持 HTTPS，请在 Web 配置 HTTPS 地址后重新生成二维码。")
                } else if (insecure) {
                    AlertDialog.Builder(this).setTitle("允许本次内网 HTTP 调试？")
                        .setMessage("${code.server}\n\n此连接不加密凭证与短信，仅用于可信内网。确认后自动检查服务器，随后核对配对信息。")
                        .setNegativeButton("取消", null)
                        .setPositiveButton("允许并检查") { _, _ -> checkAndReview(code.server, code.token, code.expiresAt, true, "留守手机") }.show()
                } else checkAndReview(code.server, code.token, code.expiresAt, false, "留守手机")
            } catch (_: Exception) { showError("二维码无效、已过期或版本不兼容。请在 Web 设备页重新生成，再次扫描。") }
        }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        style = GatewayStyle(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.WHITE)
            setOnApplyWindowInsetsListener { view, insets ->
                val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom); insets
            }
        }
        root.addView(LinearLayout(this).apply {
            gravity = android.view.Gravity.CENTER_VERTICAL
            setPadding(style.dp(8),style.dp(4),style.dp(20),style.dp(4))
            addView(ImageButton(this@ConnectionActivity).apply {
                setImageResource(dev.simlink.gateway.R.drawable.ic_arrow_back)
                imageTintList = android.content.res.ColorStateList.valueOf(style.muted)
                contentDescription = "返回"; setBackgroundColor(Color.TRANSPARENT)
                setOnClickListener { onBackPressedDispatcher.onBackPressed() }
            },LinearLayout.LayoutParams(style.dp(48),style.dp(48)))
            addView(style.label("SIMLink Gateway",16f,style.muted))
        })
        content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(style.dp(20),0,style.dp(20),style.dp(24)) }
        root.addView(ScrollView(this).apply { isFillViewport = true; addView(content) }, LinearLayout.LayoutParams(-1,0,1f))
        setContentView(root); root.requestApplyInsets()
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (busy) Toast.makeText(this@ConnectionActivity,"正在处理，请稍候",Toast.LENGTH_SHORT).show()
                else when(route) { "manual", "review" -> chooser(); "address" -> load(); "chooser" -> if (connection != null) load() else finish(); else -> finish() }
            }
        })
        startPage("服务器与同步", "正在读取本机连接状态…")
        load()
    }
    private fun startPage(title: String, subtitle: String) {
        actions.clear(); content.removeAllViews()
        content.addView(style.label(title,30f,bold=true))
        content.addView(style.label(subtitle,14f,style.muted))
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { isIndeterminate = true; visibility = View.GONE }
        content.addView(progress, LinearLayout.LayoutParams(-1,style.dp(4)))
        status = style.label("",14f).apply { accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE; visibility = View.GONE }
        content.addView(status)
    }
    private fun action(title: String, primary: Boolean = false, destructive: Boolean = false, block: () -> Unit) {
        val view = style.action(title,primary,destructive) { if (!busy) block() }
        actions.add(view); content.addView(view)
    }
    private fun field(parent: LinearLayout, title: String, value: String = "", hintText: String = "", secret: Boolean = false): EditText {
        parent.addView(style.label(title,14f,bold=true))
        return EditText(this).apply {
            setText(value); hint = hintText; contentDescription = title; textSize = 16f
            style.decorateField(this)
            isSingleLine = true; minHeight = style.dp(48); isSaveEnabled = false
            inputType = InputType.TYPE_CLASS_TEXT or if (secret) InputType.TYPE_TEXT_VARIATION_PASSWORD else InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
            parent.addView(this); actions.add(this)
        }
    }
    private fun showError(message: String) { status.text = message; status.setTextColor(style.danger); status.visibility = View.VISIBLE }
    private fun load() {
        route = "loading"
        work("正在读取连接状态…", { ConnectionStore(applicationContext).current().let { it to (it?.let { c -> SyncQueue(applicationContext).summary(c.generation) } ?: "") } }) { (current, summary) ->
            connection = current
            if (current == null) chooser() else dashboard(current,summary)
        }
    }
    private fun chooser() {
        route = "chooser"
        startPage(if (connection == null) "连接服务器" else "更换服务器", "用 SIMLink Web 的配对二维码连接这部留守手机。")
        action("扫描配对二维码",true) {
            scanner.launch(ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE).setPrompt("扫描 SIMLink Web 设备页的配对二维码").setBeepEnabled(false).setBarcodeImageEnabled(false))
        }
        content.addView(style.label("或使用一次性配对码",14f,style.muted).apply { gravity = android.view.Gravity.CENTER; setPadding(0,style.dp(24),0,style.dp(8)) })
        action("手动输入连接信息") { manual() }
        content.addView(style.label("恢复已验证的同一设备时保留待同步队列；连接其他后端时旧队列留在本机，不自动迁移。",14f,style.muted))
        action(if (connection == null) "暂不连接" else "保留当前连接") { finish() }
    }
    private fun manual() {
        route = "manual"
        startPage("手动连接", "输入 Web 设备页显示的地址和一次性配对码。")
        val server = field(content,"服务器地址",hintText="https://sim.example.com").apply { inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI }
        val name = field(content,"设备名称","留守手机")
        val token = field(content,"一次性配对码",secret=true)
        val http = CheckBox(this).apply { text = "允许内网 HTTP 调试（连接未加密）"; setTextColor(style.muted); minHeight = style.dp(48); visibility = if (BuildConfig.DEBUG) View.VISIBLE else View.GONE }
        content.addView(http); actions.add(http)
        action("验证并继续",true) {
            val origin = try { serverOrigin(server.text.toString(), BuildConfig.DEBUG && http.isChecked) }
            catch (_: Exception) { server.error = "请输入有效的服务器根地址；HTTP 仅用于明确允许的内网调试"; return@action }
            val secret = token.text.toString().trim(); val deviceName = name.text.toString().trim()
            if (!Regex("[A-Za-z0-9_-]{43}").matches(secret)) { token.error = "请输入完整的一次性配对码"; return@action }
            if (deviceName.isBlank() || deviceName.length > 80) { name.error = "设备名称应为 1–80 个字符"; return@action }
            checkAndReview(origin,secret,null,BuildConfig.DEBUG && http.isChecked,deviceName)
        }
        action("返回扫码") { chooser() }
    }
    private fun checkAndReview(origin: String, token: String, expiry: Long?, insecure: Boolean, deviceName: String) {
        if (expiry != null && expiry <= System.currentTimeMillis()) { showError("配对码已过期，请在 Web 重新生成。"); return }
        work("正在验证服务器…", { GatewayApi(origin,cancellation!!,insecure).checkServer() }) {
            route = "review"
            startPage("确认连接", "服务器可达，兼容 SIMLink API。配对码将在连接时由服务器验证。")
            val panel = style.panel()
            panel.addView(style.label(origin,20f,bold=true))
            panel.addView(style.label(if (insecure) "内网 HTTP 调试 · 传输未加密" else "HTTPS · 系统证书验证通过",14f,style.muted))
            panel.addView(style.label("恢复已验证的同一设备可继续同步原队列；连接其他后端仅同步后续新短信。",14f,style.muted))
            content.addView(panel)
            val name = field(content,"设备名称",deviceName)
            action("连接并返回运行页",true) {
                val displayName = name.text.toString().trim()
                if (displayName.isBlank() || displayName.length > 80) { name.error = "设备名称应为 1–80 个字符"; return@action }
                if (expiry != null && expiry <= System.currentTimeMillis()) { showError("配对码已过期，请返回并重新扫描。"); return@action }
                completePairing(origin,token,displayName,insecure)
            }
            action("取消，重新选择") { chooser() }
        }
    }
    private fun completePairing(origin: String, token: String, name: String, insecure: Boolean) {
        work("正在配对并保存设备凭证…", {
            val result = GatewayApi(origin,cancellation!!,insecure).pair(token,name,InstallationStore(applicationContext).id)
            // Successful pairing is not reported until durable credential storage succeeds.
            ConnectionStore(applicationContext).save(origin,result.deviceId,result.token,result.serverId)
            runCatching { SyncScheduler.schedule(applicationContext) }.getOrDefault(false)
        }) { scheduled ->
            val notice = if (scheduled) "配对成功，等待新短信" else "配对成功；系统暂未接受同步调度，请稍后重试"
            startActivity(Intent(this,dev.simlink.gateway.MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra("connection_notice",notice))
            finish()
        }
    }
    private fun address(current: Connection) {
        route = "address"
        startPage("修改服务器地址", "仅用于同一后端更换 IP 或域名；验证成功后保留设备、SIM 设置和待同步队列。")
        val server = field(content,"新服务器地址",current.server).apply { inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI }
        val http = CheckBox(this).apply { text = "允许内网 HTTP 调试（连接未加密）"; visibility = if (BuildConfig.DEBUG) View.VISIBLE else View.GONE }
        content.addView(http); actions.add(http)
        action("验证并保存",true) {
            val origin = try { serverOrigin(server.text.toString(), BuildConfig.DEBUG && http.isChecked) }
            catch (_: Exception) { server.error = "请输入有效地址；内网 HTTP 需明确允许"; return@action }
            AlertDialog.Builder(this).setTitle("确认这仍是你的服务器？")
                .setMessage("$origin\n\n将向此地址提交现有设备凭证进行验证。确认是同一后端后继续；验证失败会保留原连接。")
                .setNegativeButton("取消",null).setPositiveButton("验证地址") { _, _ ->
                    work("正在验证原设备身份…", {
                        val identity = GatewayApi(origin,cancellation!!,BuildConfig.DEBUG && http.isChecked)
                            .identity(current.token(),current.deviceId,InstallationStore(applicationContext).id,current.serverId)
                        ConnectionStore(applicationContext).relocate(current,origin,identity)
                        runCatching { SyncScheduler.schedule(applicationContext) }
                    }) { load() }
                }.show()
        }
        action("取消") { load() }
    }
    private fun dashboard(current: Connection, summary: String) {
        route = "dashboard"
        startPage("服务器与同步", "设备凭证已保存，无需重复配对。")
        val panel = style.panel()
        panel.addView(style.label(if (current.enabled) "已配对" else "同步已暂停",20f,bold=true))
        panel.addView(style.label(current.server))
        panel.addView(style.label(summary,14f,style.muted))
        if (current.notice.isNotBlank()) panel.addView(style.label(current.notice,14f,style.muted))
        content.addView(panel)
        content.addView(style.label("已配对不代表当前在线；同步结果以服务器确认记录为准。",14f,style.muted))
        action("请求同步",true) { work("正在请求系统调度…", { SyncScheduler.schedule(applicationContext) }) { accepted ->
            status.text = if (accepted) "已请求同步，请稍后刷新状态。" else "系统暂未接受调度，请稍后重试。"; status.visibility = View.VISIBLE
        } }
        action("修改服务器地址（保留配对）") { address(current) }
        action("刷新状态") { load() }
        action("更多连接选项") {
            AlertDialog.Builder(this).setTitle("连接选项").setItems(arrayOf("重试需处理的事件","更换服务器 / 重新配对","解除配对")) { _, index -> when(index) {
                0 -> work("正在重试…", { SyncQueue(applicationContext).retryBlocked(current.generation); SyncScheduler.schedule(applicationContext) }) { load() }
                1 -> chooser()
                2 -> AlertDialog.Builder(this).setTitle("解除配对？").setMessage("将通知服务器使设备凭证失效，并从设备列表移除。已保存短信和本机旧队列保留。需要网络连接；失败时保留本机配置以便重试。")
                    .setNegativeButton("取消",null).setPositiveButton("解除配对") { _, _ ->
                        work("正在通知服务器解除配对…", {
                            GatewayApi(current.server,cancellation!!,BuildConfig.DEBUG).unpair(current.token())
                            SyncScheduler.cancel(applicationContext)
                            ConnectionStore(applicationContext).disconnect()
                        }) { connection = null; chooser() }
                    }.show()
            } }.show()
        }
        action("返回") { finish() }
    }
    private fun <T> work(message: String, task: () -> T, success: (T) -> Unit) {
        if (busy) return
        busy = true; actions.forEach { it.isEnabled = false }
        progress.visibility = View.VISIBLE; status.visibility = View.VISIBLE; status.setTextColor(style.muted); status.text = message
        val cancel = RequestCancellation(); cancellation = cancel
        NetworkIo.executor.execute {
            val result = runCatching(task)
            runOnUiThread {
                if (!isDestroyed && !isFinishing) {
                    busy = false; actions.forEach { it.isEnabled = true }; progress.visibility = View.GONE
                    result.fold(success) { error -> showError(when(error) {
                        is ApiFailure -> when(error.status) { 400 -> "配对码已使用、无效或过期。请返回并在 Web 重新生成。"; 409 -> "设备已存在或身份不匹配。请在 Web 为原设备生成恢复绑定二维码；不要创建新设备。"; 401 -> "原设备凭证已失效，请在 Web 为原设备生成恢复绑定二维码。"; 429 -> "请求较多，请一分钟后重试。"; else -> "服务器请求失败（HTTP ${error.status}），请重试。" }
                        else -> "操作未完成，请检查地址、网络、证书和本机存储。若配对请求已发出，请在 Web 检查设备；响应丢失时需撤销遗留设备并生成新码。"
                    }) }
                }
            }
        }
    }
    override fun onDestroy() { cancellation?.cancel(); super.onDestroy() }
}
