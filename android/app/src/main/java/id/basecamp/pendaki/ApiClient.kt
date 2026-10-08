package id.basecamp.pendaki

import com.google.firebase.auth.FirebaseAuth
import com.google.android.gms.tasks.Tasks
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class ApiResponse(val status: Int, val body: JSONObject)
class WebSessionAuthenticationException(message: String) : IllegalStateException(message)

data class RawApiResponse(
    val status: Int,
    val body: ByteArray,
    val contentType: String?,
)

object ApiClient {
    fun createWebSessionCookie(): String {
        val user = FirebaseAuth.getInstance().currentUser
            ?: throw IllegalStateException("Silakan masuk kembali ke aplikasi.")
        val idToken = Tasks.await(user.getIdToken(false)).token
            ?: throw IllegalStateException("Token login belum tersedia.")
        val connection = URL("${BuildConfig.API_BASE_URL}/api/auth/session")
            .openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.connectTimeout = 20_000
        connection.readTimeout = 60_000
        connection.setRequestProperty("Accept", "application/json")
        connection.setRequestProperty("Cache-Control", "no-store")
        connection.setRequestProperty("Content-Type", "application/json")
        connection.doOutput = true
        connection.outputStream.bufferedWriter(Charsets.UTF_8).use { writer ->
            writer.write(JSONObject().put("idToken", idToken).toString())
        }
        return try {
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val responseText = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (status !in 200..299) {
                val message = if (responseText.isBlank()) {
                    "Sesi web belum dapat dibuat (${status})."
                } else {
                    JSONObject(responseText).optString("error")
                        .ifBlank { "Sesi web belum dapat dibuat (${status})." }
                }
                if (status == HttpURLConnection.HTTP_UNAUTHORIZED) {
                    throw WebSessionAuthenticationException(message)
                }
                throw IllegalStateException(message)
            }
            val cookie = connection.getHeaderField("Set-Cookie")
                ?: throw IllegalStateException("Server tidak mengirim cookie sesi web.")
            if (!cookie.startsWith("__session=")) {
                throw IllegalStateException("Cookie sesi web dari server tidak valid.")
            }
            cookie
        } finally {
            connection.disconnect()
        }
    }

    fun request(path: String, method: String = "GET", body: JSONObject? = null): ApiResponse {
        val user = FirebaseAuth.getInstance().currentUser
            ?: throw IllegalStateException("Silakan masuk kembali ke aplikasi.")
        val idToken = Tasks.await(user.getIdToken(false)).token
            ?: throw IllegalStateException("Token login belum tersedia.")
        val connection = URL("${BuildConfig.API_BASE_URL}$path").openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 12_000
        connection.readTimeout = 60_000
        connection.setRequestProperty("Authorization", "Bearer $idToken")
        connection.setRequestProperty("Accept", "application/json")
        connection.setRequestProperty("Cache-Control", "no-store")
        if (body != null) {
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.bufferedWriter(Charsets.UTF_8).use { writer ->
                writer.write(body.toString())
            }
        }
        return try {
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val responseText = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            val responseBody = if (responseText.isBlank()) JSONObject() else JSONObject(responseText)
            ApiResponse(status, responseBody)
        } finally {
            connection.disconnect()
        }
    }

    fun requestRaw(path: String, method: String = "GET"): RawApiResponse {
        val user = FirebaseAuth.getInstance().currentUser
            ?: throw IllegalStateException("Silakan masuk kembali ke aplikasi.")
        val idToken = Tasks.await(user.getIdToken(false)).token
            ?: throw IllegalStateException("Token login belum tersedia.")
        val connection = URL("${BuildConfig.API_BASE_URL}$path").openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 12_000
        connection.readTimeout = 60_000
        connection.setRequestProperty("Authorization", "Bearer $idToken")
        connection.setRequestProperty("Accept", "*/*")
        connection.setRequestProperty("Cache-Control", "no-store")
        return try {
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val bytes = stream?.use { it.readBytes() } ?: byteArrayOf()
            RawApiResponse(status, bytes, connection.contentType)
        } finally {
            connection.disconnect()
        }
    }

    fun requestPublic(
        path: String,
        method: String = "GET",
        body: JSONObject? = null,
        readTimeoutMs: Int = 90_000,
    ): ApiResponse {
        val connection = URL("${BuildConfig.API_BASE_URL}$path").openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 20_000
        connection.readTimeout = readTimeoutMs
        connection.setRequestProperty("Accept", "application/json")
        connection.setRequestProperty("Cache-Control", "no-store")
        if (body != null) {
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.bufferedWriter(Charsets.UTF_8).use { writer ->
                writer.write(body.toString())
            }
        }
        return try {
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val responseText = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            val responseBody = if (responseText.isBlank()) JSONObject() else JSONObject(responseText)
            ApiResponse(status, responseBody)
        } finally {
            connection.disconnect()
        }
    }

    fun requireSuccess(response: ApiResponse) {
        if (response.status !in 200..299) {
            throw IllegalStateException(
                response.body.optString("error").ifBlank { "Permintaan gagal (${response.status})." },
            )
        }
    }
}

fun queuedSosBody(body: String): JSONObject = JSONObject(body)

fun locationPointBody(points: List<QueuedPoint>): JSONObject {
    require(points.isNotEmpty()) { "Batch lokasi tidak boleh kosong." }
    val first = points.first()
    require(points.all { it.registrationId == first.registrationId }) {
        "Batch lokasi hanya boleh berisi satu pendakian."
    }
    val jsonPoints = org.json.JSONArray()
    points.forEach { point ->
        jsonPoints.put(
            JSONObject()
                .put("latitude", point.latitude)
                .put("longitude", point.longitude)
                .put("accuracy", point.accuracy.toDouble())
                .put("capturedAt", point.capturedAt),
        )
    }
    return JSONObject()
        .put("registrationId", first.registrationId)
        .put("points", jsonPoints)
}
