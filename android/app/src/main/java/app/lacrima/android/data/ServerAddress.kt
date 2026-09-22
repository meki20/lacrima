package app.lacrima.android.data

import java.net.URI

object ServerAddress {
    fun normalize(input: String): String? {
        val raw = input.trim().trimEnd('/')
        val uri = runCatching { URI(raw) }.getOrNull() ?: return null
        if (uri.scheme !in setOf("https", "http") || uri.host.isNullOrBlank() || uri.userInfo != null) return null
        if (uri.path?.let { it.isNotBlank() && it != "/" } == true || uri.query != null || uri.fragment != null) return null
        if (uri.scheme == "http" && !isPrivateIpv4(uri.host)) return null
        return raw
    }

    private fun isPrivateIpv4(host: String): Boolean {
        val octets = host.split('.').map { it.toIntOrNull() ?: return false }
        if (octets.size != 4 || octets.any { it !in 0..255 }) return false
        return octets[0] == 10 ||
            (octets[0] == 172 && octets[1] in 16..31) ||
            (octets[0] == 192 && octets[1] == 168)
    }
}
