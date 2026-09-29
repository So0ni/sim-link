package dev.simlink.gateway.ui

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.graphics.drawable.StateListDrawable
import android.view.Gravity
import android.view.View
import android.widget.*
import dev.simlink.gateway.R

/** Shared native components. Colors are generated from design/tokens/tokens.json. */
class GatewayStyle(private val context: Context) {
    val blue = context.getColor(R.color.design_primary)
    val ink = context.getColor(R.color.design_textPrimary)
    val muted = context.getColor(R.color.design_textSecondary)
    val danger = context.getColor(R.color.design_dangerText)
    val border = context.getColor(R.color.design_borderSubtle)
    val selected = context.getColor(R.color.design_surfaceSelected)
    val subtle = context.getColor(R.color.design_surfaceSubtle)
    val warning = context.getColor(R.color.design_warningSurface)
    fun dp(value: Int) = (value * context.resources.displayMetrics.density).toInt()
    fun shape(color: Int, radius: Int = 12, stroke: Int? = null) = GradientDrawable().apply {
        setColor(color); cornerRadius = dp(radius).toFloat(); stroke?.let { setStroke(dp(1), it) }
    }
    fun label(value: String, size: Float = 16f, color: Int = ink, bold: Boolean = false) = TextView(context).apply {
        text = value; textSize = size; setTextColor(color)
        setPadding(0, dp(4), 0, dp(4)); setLineSpacing(dp(4).toFloat(), 1f)
        if (bold) typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    }
    fun action(value: String, primary: Boolean = false, destructive: Boolean = false, block: () -> Unit) = Button(context).apply {
        text = value; textSize = 16f; isAllCaps = false; minHeight = dp(48)
        setPadding(dp(16),dp(12),dp(16),dp(12)); stateListAnimator = null
        setTextColor(ColorStateList(arrayOf(intArrayOf(-android.R.attr.state_enabled), intArrayOf()), intArrayOf(muted, if (primary) Color.WHITE else if (destructive) danger else blue)))
        background = RippleDrawable(ColorStateList.valueOf(0x220866E6), shape(if (primary) blue else Color.WHITE,12,if (primary) null else context.getColor(R.color.design_borderControl)),null)
        layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12); bottomMargin = dp(4) }
        setOnClickListener { block() }
    }
    fun panel(color: Int = subtle) = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(16), dp(20), dp(16))
        background = shape(color,16)
        layoutParams = LinearLayout.LayoutParams(-1,-2).apply { topMargin = dp(16); bottomMargin = dp(8) }
    }
    fun divider() = View(context).apply { setBackgroundColor(border); layoutParams = LinearLayout.LayoutParams(-1,dp(1)) }
    fun icon(resource: Int, color: Int = muted) = ImageView(context).apply {
        setImageResource(resource); imageTintList = ColorStateList.valueOf(color)
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }
    fun section(title: String) = label(title,20f,bold=true).apply { setPadding(0,dp(28),0,dp(8)) }
    fun row(resource: Int, title: String, detail: String, block: (() -> Unit)? = null) = LinearLayout(context).apply {
        gravity = Gravity.CENTER_VERTICAL; minimumHeight = dp(72); setPadding(0,dp(12),0,dp(12))
        addView(icon(resource),LinearLayout.LayoutParams(dp(24),dp(24)).apply { rightMargin = dp(16) })
        addView(LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            addView(label(title,16f,bold=true).apply { setPadding(0,0,0,0) }); if (detail.isNotEmpty()) addView(label(detail,14f,muted).apply { setPadding(0,dp(4),0,0) })
        },LinearLayout.LayoutParams(0,-2,1f))
        if (block != null) {
            addView(icon(R.drawable.ic_chevron_right),LinearLayout.LayoutParams(dp(24),dp(24)))
            background = RippleDrawable(ColorStateList.valueOf(selected),null,shape(Color.WHITE,0))
            isFocusable = true; setOnClickListener { block() }
        }
    }
    fun decorateField(field: EditText) = field.apply {
        background = StateListDrawable().apply {
            addState(intArrayOf(android.R.attr.state_focused),shape(Color.WHITE,12,blue).apply { setStroke(dp(2),blue) })
            addState(intArrayOf(),shape(Color.WHITE,12,context.getColor(R.color.design_borderControl)))
        }
        setPadding(dp(14),dp(12),dp(14),dp(12)); minHeight = dp(52)
        setTextColor(ink); setHintTextColor(muted)
        layoutParams = LinearLayout.LayoutParams(-1,-2).apply { bottomMargin = dp(16) }
    }
    fun navigation(name: String, resource: Int, active: Boolean, block: () -> Unit) = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; minimumHeight = dp(64)
        setPadding(dp(4),dp(8),dp(4),dp(8)); isFocusable = true; isSelected = active
        contentDescription = name; importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
        addView(icon(resource,if(active) blue else muted),LinearLayout.LayoutParams(dp(24),dp(24)))
        addView(label(name,13f,if(active) blue else muted).apply { gravity = Gravity.CENTER; importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO })
        background = RippleDrawable(ColorStateList.valueOf(selected),null,shape(Color.WHITE,0)); setOnClickListener { block() }
    }
}
