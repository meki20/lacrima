package app.lacrima.android.data

import android.content.Context

class LacrimaStore(context: Context) {
    private val prefs = context.getSharedPreferences("lacrima", Context.MODE_PRIVATE)

    var serverUrl: String?
        get() = prefs.getString("server_url", null)
        set(value) { prefs.edit().putString("server_url", value).apply() }

    var profileId: Int?
        get() = prefs.getInt("profile_id", -1).takeIf { it >= 0 }
        set(value) {
            val edit = prefs.edit()
            if (value == null) edit.remove("profile_id") else edit.putInt("profile_id", value)
            edit.apply()
        }

    fun disconnect() {
        prefs.edit().remove("server_url").remove("profile_id").apply()
    }
}
