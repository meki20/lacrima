package app.lacrima.android.data

import app.lacrima.android.model.ApiResult
import org.json.JSONObject
import org.json.JSONTokener
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

class ApiClient(private val baseUrl: String, private val profileId: Int?) {
    fun get(path: String): ApiResult<Any> = request("GET", path)
    fun put(path: String, body: JSONObject): ApiResult<Any> = request("PUT", path, body)
    fun patch(path: String, body: JSONObject): ApiResult<Any> = request("PATCH", path, body)
    fun post(path: String, body: JSONObject): ApiResult<Any> = request("POST", path, body)
    fun delete(path: String, body: JSONObject? = null): ApiResult<Any> = request("DELETE", path, body)
    /** Fetches a server-returned legacy/API URL without forcing it under /api/v1. */
    fun getAbsoluteJson(pathOrUrl: String): ApiResult<Any> = request("GET", absolute(pathOrUrl), allowRaw = true)

    /** Reads a server-proxied subtitle file without wrapping it in the JSON API envelope. */
    fun getTextAbsolute(pathOrUrl: String): ApiResult<String> {
        val connection = URL(absolute(pathOrUrl)).openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "GET"
            connection.connectTimeout = 8_000
            connection.readTimeout = 30_000
            connection.setRequestProperty("Accept", "text/vtt,application/x-subrip,text/x-ssa,text/plain")
            profileId?.let { connection.setRequestProperty(PROFILE_HEADER, it.toString()) }
            val status = connection.responseCode
            val text = (if (status in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (status in 200..299) ApiResult.Success(text)
            else ApiResult.Failure("http_$status", text.ifBlank { "The subtitle file could not be loaded." })
        } catch (e: IOException) {
            ApiResult.Failure("network_error", e.message ?: "Could not reach the Lacrima server.")
        } finally {
            connection.disconnect()
        }
    }

    fun absolute(pathOrUrl: String): String {
        if (pathOrUrl.startsWith("https://") || pathOrUrl.startsWith("http://")) return pathOrUrl
        return "${baseUrl.trimEnd('/')}/${pathOrUrl.trimStart('/')}"
    }

    private fun request(method: String, path: String, body: JSONObject? = null, allowRaw: Boolean = false): ApiResult<Any> {
        val target = if (path.startsWith("https://") || path.startsWith("http://")) path else "$baseUrl/api/v1/${path.trimStart('/')}"
        val connection = URL(target).openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = method
            connection.connectTimeout = 8_000
            connection.readTimeout = 120_000
            connection.setRequestProperty("Accept", "application/json")
            profileId?.let { connection.setRequestProperty(PROFILE_HEADER, it.toString()) }
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toString().toByteArray(StandardCharsets.UTF_8)) }
            }
            val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            parseEnvelope(text, connection.responseCode, allowRaw)
        } catch (e: IOException) {
            ApiResult.Failure("network_error", e.message ?: "Could not reach the Lacrima server.")
        } catch (e: Exception) {
            ApiResult.Failure("invalid_response", e.message ?: "The server returned an unreadable response.")
        } finally {
            connection.disconnect()
        }
    }

    private fun parseEnvelope(text: String, status: Int, allowRaw: Boolean): ApiResult<Any> {
        val parsed = runCatching { JSONTokener(text).nextValue() }.getOrElse {
            return ApiResult.Failure("http_$status", "The server returned an unreadable response.")
        }
        val root = parsed as? JSONObject
        if (root == null) return if (allowRaw) ApiResult.Success(parsed) else ApiResult.Failure("http_$status", "The server returned an unreadable response.")
        if (!root.has("ok") && allowRaw) return ApiResult.Success(root)
        if (root.optBoolean("ok", false)) {
            return ApiResult.Success(root.opt("data") ?: JSONObject.NULL)
        }
        val error = root.optJSONObject("error")
        return ApiResult.Failure(
            code = error?.optString("code")?.takeIf(String::isNotBlank) ?: "http_$status",
            message = error?.optString("message")?.takeIf(String::isNotBlank)
                ?: root.optString("reason", "Request failed."),
            lastSuccess = error?.optLong("lastSuccess")?.takeIf { it > 0 },
        )
    }

    companion object {
        const val PROFILE_HEADER = "X-Lacrima-Profile"
        fun encode(value: String): String = URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20")
    }
}
