package dev.simlink.gateway.ui

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/** Native widgets using design/tokens/tokens.json; shared across gateway screens. */
class GatewayStyle(private val context: Context) {
    val blue = Color.rgb(8, 102, 230)
    val ink = Color.rgb(23, 32, 51)
    val muted = Color.rgb(88, 101, 121)
    val danger = Color.rgb(188, 36, 54)
    fun dp(value: Int) = (value * context.resources.displayMetrics.density).toInt()
    fun label(value: String, size: Float = 16f, color: Int = ink, bold: Boolean = false) = TextView(context).apply {
        text = value; textSize = size; setTextColor(color)
        setPadding(0, dp(8), 0, dp(8)); setLineSpacing(dp(3).toFloat(), 1f)
        if (bold) setTypeface(typeface, Typeface.BOLD)
        setTextIsSelectable(true)
    }
    fun action(value: String, primary: Boolean = false, destructive: Boolean = false, block: () -> Unit) = Button(context).apply {
        text = value; textSize = 16f; isAllCaps = false; minHeight = dp(48)
        setTextColor(ColorStateList(arrayOf(intArrayOf(-android.R.attr.state_enabled), intArrayOf()), intArrayOf(muted, if (primary) Color.WHITE else if (destructive) danger else blue)))
        backgroundTintList = ColorStateList(arrayOf(intArrayOf(-android.R.attr.state_enabled), intArrayOf()), intArrayOf(Color.rgb(237,240,244), if (primary) blue else if (destructive) Color.rgb(255,240,242) else Color.rgb(235,243,255)))
        layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8); bottomMargin = dp(4) }
        setOnClickListener { block() }
    }
    fun panel() = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(8), dp(16), dp(12))
        background = GradientDrawable().apply { setColor(Color.rgb(245,247,250)); cornerRadius = dp(16).toFloat() }
        layoutParams = LinearLayout.LayoutParams(-1,-2).apply { topMargin = dp(12); bottomMargin = dp(16) }
    }
}
