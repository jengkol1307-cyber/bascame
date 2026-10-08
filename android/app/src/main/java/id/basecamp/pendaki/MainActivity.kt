package id.basecamp.pendaki

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.android.gms.location.Priority
import com.google.android.gms.location.LocationServices
import com.google.android.gms.tasks.CancellationTokenSource
import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

private data class HikerTrip(
    val id: String,
    val mountainName: String,
    val startDate: String,
    val endDate: String,
    val status: String,
    val latitude: Double?,
    val longitude: Double?,
)

private data class PendingPasswordChange(
    val identifier: String,
    val currentPassword: String,
)

class MainActivity : AppCompatActivity() {
    private val executor = Executors.newSingleThreadExecutor()
    private val auth by lazy { FirebaseAuth.getInstance() }
    private val trips = mutableListOf<HikerTrip>()
    private var pendingPasswordChange: PendingPasswordChange? = null
    private var dashboardStatus: TextView? = null
    private var pendingTrackingStart = false
    private var returningFromLocationSettings = false

    private val foregroundPermissionRequest =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            if (hasForegroundLocationPermission()) {
                requestBackgroundLocationOrStart()
            } else {
                pendingTrackingStart = false
                showMessage("Izin lokasi diperlukan untuk merekam perjalanan.")
            }
        }

    private val backgroundPermissionRequest =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) startTrackingService()
            else {
                pendingTrackingStart = false
                showMessage("Pelacakan latar belakang tidak aktif karena izinnya belum diberikan.")
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        render()
    }

    override fun onResume() {
        super.onResume()
        if (returningFromLocationSettings) {
            returningFromLocationSettings = false
            if (pendingTrackingStart && hasRequiredLocationPermissions()) {
                startTrackingService()
            } else if (pendingTrackingStart) {
                pendingTrackingStart = false
                showMessage("Izin lokasi latar belakang belum diberikan.")
            }
        }
    }

    override fun onDestroy() {
        executor.shutdown()
        super.onDestroy()
    }

    private fun render() {
        if (auth.currentUser == null) renderSignIn() else renderHikerDashboard()
    }

    private fun renderSignIn() {
        val card = authCard()
        card.addView(brand())
        card.addView(authEyebrow("AKUN BASECAMP"))
        card.addView(authHeading("Selamat datang"))
        card.addView(authDescription("Masuk menggunakan username atau email."))

        val identifier = input("Username atau email", android.text.InputType.TYPE_CLASS_TEXT)
        identifier.setSingleLine(true)
        identifier.imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_NEXT
        val password = input(
            "Kata sandi",
            android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD,
        ).apply {
            setSingleLine(true)
            imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_DONE
        }
        card.addView(fieldLabel("Username atau email"))
        card.addView(identifier)
        card.addView(fieldLabel("Kata sandi"))
        card.addView(password)

        val status = authStatus()
        card.addView(status)
        val loginButton = button("Masuk") {}
        loginButton.setOnClickListener {
            val usernameOrEmail = identifier.text.toString().trim()
            val passwordValue = password.text.toString()
            if (usernameOrEmail.isBlank() || passwordValue.isBlank()) {
                status.text = "Masukkan username/email dan kata sandi."
                return@setOnClickListener
            }
            loginButton.isEnabled = false
            setAuthBusy(status, "Memproses…")
            executor.execute {
                try {
                    val response = ApiClient.requestPublic(
                        "/api/auth/login",
                        method = "POST",
                        body = JSONObject()
                            .put("identifier", usernameOrEmail)
                            .put("password", passwordValue)
                            .put("nativeClient", true),
                        readTimeoutMs = 90_000,
                    )
                    ApiClient.requireSuccess(response)
                    if (response.body.optBoolean("mustChangePassword")) {
                        pendingPasswordChange = PendingPasswordChange(usernameOrEmail, passwordValue)
                        runOnUiThread { renderTemporaryPasswordChange() }
                    } else {
                        val email = response.body.optString("email")
                        if (email.isBlank()) {
                            throw IllegalStateException("Server tidak mengirim identitas akun untuk sesi aplikasi.")
                        }
                        runOnUiThread { status.text = "Login berhasil. Menyiapkan aplikasi…" }
                        signInFirebase(email, passwordValue, status) {
                            loginButton.isEnabled = true
                        }
                    }
                } catch (error: Exception) {
                    runOnUiThread {
                        loginButton.isEnabled = true
                        status.isEnabled = true
                        status.text = when (error) {
                            is java.net.SocketTimeoutException ->
                                "Server terlalu lama merespons. Periksa koneksi USB/server lokal, lalu coba lagi."
                            is java.net.ConnectException ->
                                "Server tidak terjangkau. Pastikan server berjalan dan USB reverse aktif."
                            else -> error.localizedMessage ?: "Tidak dapat masuk. Coba lagi."
                        }
                    }
                }
            }
        }
        card.addView(loginButton)
        card.addView(authSwitch("Belum punya akun? ", "Daftar sebagai pendaki") {
            openWebPage("/register")
        })
        card.addView(backHomeLink())
        setContentView(authScreen(card))
    }

    private fun renderTemporaryPasswordChange() {
        val pending = pendingPasswordChange
        if (pending == null) {
            renderSignIn()
            return
        }
        val card = authCard()
        card.addView(brand())
        card.addView(authEyebrow("AKUN BASECAMP"))
        card.addView(authHeading("Buat sandi baru"))
        card.addView(authDescription("Demi keamanan, ganti sandi sementara sebelum melanjutkan."))
        val newPassword = input(
            "Sandi baru",
            android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD,
        ).apply {
            setSingleLine(true)
            imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_NEXT
        }
        val confirmation = input(
            "Ulangi sandi baru",
            android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD,
        ).apply {
            setSingleLine(true)
            imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_DONE
        }
        card.addView(fieldLabel("Sandi baru"))
        card.addView(newPassword)
        card.addView(fieldLabel("Ulangi sandi baru"))
        card.addView(confirmation)
        val status = authStatus()
        card.addView(status)
        card.addView(button("Simpan sandi dan lanjutkan") {
            val value = newPassword.text.toString()
            if (value.length < 8 || value.length > 128) {
                status.text = "Sandi baru harus terdiri dari 8 sampai 128 karakter."
                return@button
            }
            if (value != confirmation.text.toString()) {
                status.text = "Konfirmasi sandi tidak sama."
                return@button
            }
            setAuthBusy(status, "Memperbarui sandi…")
            executor.execute {
                try {
                    val response = ApiClient.requestPublic(
                        "/api/auth/change-temporary-password",
                        method = "POST",
                        body = JSONObject()
                            .put("identifier", pending.identifier)
                            .put("currentPassword", pending.currentPassword)
                            .put("newPassword", value)
                            .put("nativeClient", true),
                    )
                    ApiClient.requireSuccess(response)
                    val email = response.body.optString("email")
                    if (email.isBlank()) {
                        throw IllegalStateException("Server tidak mengirim identitas akun untuk sesi aplikasi.")
                    }
                    pendingPasswordChange = null
                    signInFirebase(email, value, status)
                } catch (error: Exception) {
                    runOnUiThread {
                        status.isEnabled = true
                        status.text = error.localizedMessage ?: "Sandi belum dapat diperbarui."
                    }
                }
            }
        })
        card.addView(authSwitch("Salah akun? ", "Kembali masuk") {
            pendingPasswordChange = null
            renderSignIn()
        })
        setContentView(authScreen(card))
    }

    private fun signInFirebase(
        email: String,
        password: String,
        status: TextView,
        onFailure: (() -> Unit)? = null,
    ) {
        runOnUiThread { setAuthBusy(status, "Memulai sesi aplikasi…") }
        auth.signInWithEmailAndPassword(email, password)
            .addOnCompleteListener { task ->
                if (task.isSuccessful) {
                    pendingPasswordChange = null
                    render()
                } else {
                    onFailure?.invoke()
                    status.isEnabled = true
                    status.text = task.exception?.localizedMessage
                        ?: "Sesi aplikasi belum dapat dimulai. Silakan coba masuk kembali."
                }
            }
    }

    private fun setAuthBusy(status: TextView, message: String) {
        status.isEnabled = false
        status.setTextColor(Color.rgb(91, 105, 95))
        status.text = message
    }

    private fun openWebPage(path: String) {
        val baseUrl = BuildConfig.API_BASE_URL.trimEnd('/')
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("$baseUrl$path")))
    }

    private fun authScreen(card: LinearLayout): ScrollView =
        ScrollView(this).apply {
            setBackgroundColor(Color.rgb(245, 247, 243))
            isFillViewport = true
            addView(
                LinearLayout(this@MainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    gravity = Gravity.CENTER
                    setPadding(dp(20), dp(20), dp(20), dp(20))
                    addView(
                        card,
                        LinearLayout.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.WRAP_CONTENT,
                        ),
                    )
                },
            )
        }

    private fun authCard() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(24), dp(24), dp(24), dp(22))
        background = roundedBackground(Color.WHITE, Color.rgb(228, 235, 228), dp(15))
        elevation = dp(5).toFloat()
    }

    private fun brand(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        val mark = TextView(this@MainActivity).apply {
            text = "B"
            gravity = Gravity.CENTER
            textSize = 19f
            typeface = Typeface.create("serif", Typeface.NORMAL)
            setTextColor(Color.WHITE)
            background = roundedBackground(Color.rgb(39, 99, 71), null, dp(9))
        }
        addView(mark, LinearLayout.LayoutParams(dp(30), dp(30)))
        val wordmark = android.text.SpannableString("basecamp.")
        wordmark.setSpan(
            android.text.style.ForegroundColorSpan(Color.rgb(210, 138, 84)),
            wordmark.length - 1,
            wordmark.length,
            android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
        )
        addView(TextView(this@MainActivity).apply {
            text = wordmark
            textSize = 20f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(Color.rgb(35, 49, 40))
            letterSpacing = -0.04f
            setPadding(dp(10), 0, 0, 0)
        })
        setPadding(0, 0, 0, dp(24))
    }

    private fun authEyebrow(value: String) = TextView(this).apply {
        text = value
        textSize = 11f
        letterSpacing = 0.12f
        setTypeface(typeface, Typeface.BOLD)
        setTextColor(Color.rgb(39, 99, 71))
        setPadding(0, 0, 0, dp(8))
    }

    private fun authHeading(value: String) = TextView(this).apply {
        text = value
        textSize = 29f
        setTypeface(typeface, Typeface.BOLD)
        setTextColor(Color.rgb(31, 45, 35))
        setPadding(0, 0, 0, dp(5))
    }

    private fun authDescription(value: String) = TextView(this).apply {
        text = value
        textSize = 14f
        setTextColor(Color.rgb(91, 101, 93))
        setPadding(0, 0, 0, dp(19))
    }

    private fun fieldLabel(value: String) = TextView(this).apply {
        text = value
        textSize = 13f
        setTypeface(typeface, Typeface.BOLD)
        setTextColor(Color.rgb(52, 65, 56))
        setPadding(0, 0, 0, dp(6))
    }

    private fun authStatus() = TextView(this).apply {
        textSize = 13f
        setTextColor(Color.rgb(176, 45, 45))
        setPadding(0, dp(1), 0, dp(7))
    }

    private fun authSwitch(prefix: String, actionLabel: String, action: () -> Unit): TextView {
        val styledText = android.text.SpannableString("$prefix$actionLabel").apply {
            val start = prefix.length
            setSpan(
                android.text.style.ForegroundColorSpan(Color.rgb(39, 99, 71)),
                start,
                length,
                android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
            )
            setSpan(
                android.text.style.StyleSpan(Typeface.BOLD),
                start,
                length,
                android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
            )
        }
        return TextView(this).apply {
            text = styledText
            textSize = 13f
            gravity = Gravity.CENTER
            setTextColor(Color.rgb(92, 102, 94))
            setPadding(0, dp(17), 0, dp(12))
            setOnClickListener { action() }
        }
    }

    private fun backHomeLink() = TextView(this).apply {
        text = "← Kembali ke halaman utama"
        textSize = 13f
        gravity = Gravity.CENTER
        setTextColor(Color.rgb(92, 102, 94))
        setPadding(0, dp(8), 0, 0)
        setOnClickListener { openWebPage("/") }
    }

    private fun renderHikerDashboard() {
        schedulePendingUploads()
        val content = column()
        val user = auth.currentUser
        content.addView(title("Keselamatan Pendakian"))
        content.addView(text(user?.email.orEmpty()))
        content.addView(button("Keluar") {
            stopTracking()
            auth.signOut()
            trips.clear()
            render()
        })
        val status = text("Muat pendakian aktif untuk mulai.")
        dashboardStatus = status
        content.addView(status)
        content.addView(button("Muat pendakian") { loadTrips(status) })

        val activeTrips = trips.filter { it.status == "checked_in" }
        if (trips.isNotEmpty() && activeTrips.isEmpty()) {
            content.addView(text("Belum ada perjalanan berstatus check-in. Pelacakan dan SOS tersedia saat pendakian aktif."))
        }
        if (activeTrips.isNotEmpty()) {
            val tripPicker = Spinner(this)
            tripPicker.adapter = ArrayAdapter(
                this,
                android.R.layout.simple_spinner_dropdown_item,
                activeTrips.map { "${it.mountainName} • ${it.startDate} – ${it.endDate}" },
            )
            content.addView(text("Pendakian aktif"))
            content.addView(tripPicker)

            val queueStatus = text("")
            content.addView(queueStatus)
            updateQueueStatus(queueStatus)

            content.addView(button("Mulai pelacakan lokasi") {
                val trip = activeTrips.getOrNull(tripPicker.selectedItemPosition) ?: return@button
                beginTracking(trip, status)
            })
            content.addView(button("Hentikan pelacakan") {
                stopTracking()
                status.text = "Pelacakan dihentikan. Sinyal yang sudah antre tetap tersimpan."
            })
            content.addView(button("Unduh / buka peta offline") {
                val trip = activeTrips.getOrNull(tripPicker.selectedItemPosition) ?: return@button
                val intent = Intent(this, OfflineMapActivity::class.java)
                    .putExtra(OfflineMapActivity.EXTRA_MOUNTAIN_NAME, trip.mountainName)
                    .putExtra(OfflineMapActivity.EXTRA_LATITUDE, trip.latitude ?: Double.NaN)
                    .putExtra(OfflineMapActivity.EXTRA_LONGITUDE, trip.longitude ?: Double.NaN)
                startActivity(intent)
            })

            val categoryPicker = Spinner(this)
            val categoryLabels = listOf("Medis", "Cedera", "Tersesat", "Lainnya")
            categoryPicker.adapter = ArrayAdapter(
                this,
                android.R.layout.simple_spinner_dropdown_item,
                categoryLabels,
            )
            content.addView(text("Jenis keadaan darurat"))
            content.addView(categoryPicker)
            val description = input("Pesan singkat untuk petugas (opsional)", android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE)
            description.minLines = 2
            content.addView(description)
            content.addView(button("KIRIM SOS") {
                val trip = activeTrips.getOrNull(tripPicker.selectedItemPosition) ?: return@button
                AlertDialog.Builder(this)
                    .setTitle("Kirim sinyal SOS?")
                    .setMessage("Petugas akan menerima identitas perjalanan dan lokasi terakhir yang tersedia.")
                    .setNegativeButton("Batal", null)
                    .setPositiveButton("Kirim SOS") { _, _ ->
                        sendSos(
                            trip,
                            listOf("medical", "injury", "lost", "other")[categoryPicker.selectedItemPosition],
                            description.text.toString(),
                            status,
                            queueStatus,
                        )
                    }
                    .show()
            }.apply {
                setTextColor(Color.WHITE)
                setBackgroundColor(Color.rgb(176, 45, 45))
            })
        }
        setContentView(scroll(content))
    }

    private fun loadTrips(status: TextView) {
        status.text = "Memuat data pendakian…"
        executor.execute {
            try {
                val response = ApiClient.request("/api/registrations")
                ApiClient.requireSuccess(response)
                val registrations = response.body.optJSONArray("registrations")
                    ?: throw IllegalStateException("Respons pendakian tidak valid.")
                val loaded = (0 until registrations.length()).mapNotNull { index ->
                    val item = registrations.optJSONObject(index) ?: return@mapNotNull null
                    HikerTrip(
                        id = item.optString("id"),
                        mountainName = item.optString("mountainName", "Gunung"),
                        startDate = item.optString("startDate"),
                        endDate = item.optString("endDate"),
                        status = item.optString("status"),
                        latitude = item.takeIf { it.has("mountainLatitude") && !it.isNull("mountainLatitude") }
                            ?.optDouble("mountainLatitude"),
                        longitude = item.takeIf { it.has("mountainLongitude") && !it.isNull("mountainLongitude") }
                            ?.optDouble("mountainLongitude"),
                    )
                }
                runOnUiThread {
                    trips.clear()
                    trips.addAll(loaded)
                    renderHikerDashboard()
                    dashboardStatus?.text = if (loaded.any { it.status == "checked_in" }) {
                        "Pendakian check-in siap digunakan."
                    } else {
                        "Tidak ada pendakian yang sedang check-in."
                    }
                }
            } catch (error: Exception) {
                runOnUiThread { dashboardStatus?.text = error.localizedMessage ?: "Data pendakian gagal dimuat." }
            }
        }
    }

    private fun beginTracking(trip: HikerTrip, status: TextView) {
        pendingTrackingStart = true
        if (!hasForegroundLocationPermission()) {
            val permissions = mutableListOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
            )
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                permissions.add(Manifest.permission.POST_NOTIFICATIONS)
            }
            foregroundPermissionRequest.launch(permissions.toTypedArray())
        } else {
            requestBackgroundLocationOrStart()
        }
        status.text = "Pelacakan hanya berjalan setelah izin lokasi diberikan."
        getSharedPreferences(LocationTrackingService.PREFERENCES, MODE_PRIVATE)
            .edit()
            .putString(LocationTrackingService.PREFERENCE_REGISTRATION_ID, trip.id)
            .apply()
    }

    private fun requestBackgroundLocationOrStart() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || hasBackgroundLocationPermission()) {
            startTrackingService()
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            AlertDialog.Builder(this)
                .setTitle("Izinkan lokasi sepanjang waktu")
                .setMessage("Agar sinyal GPS tetap direkam saat layar mati atau aplikasi di latar belakang, pilih izin lokasi \"Izinkan sepanjang waktu\" pada pengaturan aplikasi.")
                .setNegativeButton("Batal") { _, _ -> pendingTrackingStart = false }
                .setPositiveButton("Buka pengaturan") { _, _ ->
                    returningFromLocationSettings = true
                    startActivity(
                        Intent(
                            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            Uri.parse("package:$packageName"),
                        ),
                    )
                }
                .show()
        } else {
            backgroundPermissionRequest.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        }
    }

    private fun startTrackingService() {
        val tripId = getSharedPreferences(LocationTrackingService.PREFERENCES, MODE_PRIVATE)
            .getString(LocationTrackingService.PREFERENCE_REGISTRATION_ID, null)
        if (tripId.isNullOrBlank() || !hasRequiredLocationPermissions()) {
            pendingTrackingStart = false
            showMessage("Pilih pendakian check-in dan berikan izin lokasi foreground serta background.")
            return
        }
        val intent = Intent(this, LocationTrackingService::class.java)
            .putExtra(LocationTrackingService.EXTRA_REGISTRATION_ID, tripId)
        ContextCompat.startForegroundService(this, intent)
        pendingTrackingStart = false
        showMessage("Pelacakan aktif. Interval sekitar 30 menit; Android dapat menundanya demi baterai.")
    }

    private fun stopTracking() {
        startService(Intent(this, LocationTrackingService::class.java).setAction(LocationTrackingService.ACTION_STOP))
    }

    private fun sendSos(
        trip: HikerTrip,
        category: String,
        message: String,
        status: TextView,
        queueStatus: TextView,
    ) {
        status.text = "Menyimpan SOS ke antrean perangkat…"
        executor.execute {
            try {
                val requestId = UUID.randomUUID().toString()
                val body = JSONObject()
                    .put("registrationId", trip.id)
                    .put("clientRequestId", requestId)
                    .put("category", category)
                    .put("description", message.trim().take(1000))
                val saved = TrackingDatabase.get(this).saveSos(
                    QueuedSos(requestId, trip.id, body.toString()),
                )
                if (!saved) throw IllegalStateException("SOS tidak dapat disimpan ke antrean perangkat.")

                val location = try {
                    if (!hasForegroundLocationPermission()) {
                        null
                    } else {
                        val client = LocationServices.getFusedLocationProviderClient(this)
                        val cancellation = CancellationTokenSource()
                        Tasks.await(
                            client.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cancellation.token),
                            8,
                            TimeUnit.SECONDS,
                        )
                    }
                } catch (error: Exception) {
                    Log.w(TAG, "Lokasi high accuracy tidak tersedia; SOS tetap akan diantrekan tanpa koordinat.", error)
                    null
                }
                if (location != null) {
                    body.put(
                        "location",
                        JSONObject()
                            .put("latitude", location.latitude)
                            .put("longitude", location.longitude)
                            .put("accuracy", location.accuracy.toDouble()),
                    )
                    if (!TrackingDatabase.get(this).updateSosBody(requestId, body.toString())) {
                        Log.w(TAG, "SOS sudah diproses sebelum lokasi terbaru dapat ditambahkan ke antrean.")
                    }
                }
                LocationUploadWorker.enqueueNow(this)
                runOnUiThread {
                    status.text = if (location == null) {
                        "SOS tersimpan dan sedang diupayakan, tetapi lokasi terbaru tidak tersedia. Hubungi Basecamp lewat telepon bila memungkinkan."
                    } else {
                        "SOS tersimpan dan sedang diupayakan. Pengiriman ke petugas belum terkonfirmasi."
                    }
                    updateQueueStatus(queueStatus)
                }
            } catch (error: Exception) {
                runOnUiThread { status.text = error.localizedMessage ?: "SOS gagal disimpan." }
            }
        }
    }

    private fun updateQueueStatus(view: TextView) {
        executor.execute {
            val database = TrackingDatabase.get(this)
            val points = database.queuedPointCount()
            val sos = database.queuedSosCount()
            if (points > 0 || sos > 0) LocationUploadWorker.enqueueNow(this)
            runOnUiThread {
                view.text = "Antrean perangkat: $points titik GPS, $sos SOS. SOS baru terkonfirmasi setelah berhasil diterima server."
            }
        }
    }

    private fun schedulePendingUploads() {
        executor.execute {
            val database = TrackingDatabase.get(this)
            if (database.queuedPointCount() > 0 || database.queuedSosCount() > 0) {
                LocationUploadWorker.enqueueNow(this)
            }
        }
    }

    private fun hasForegroundLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun hasBackgroundLocationPermission(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun hasRequiredLocationPermissions(): Boolean =
        hasForegroundLocationPermission() && hasBackgroundLocationPermission()

    private fun showMessage(message: String) {
        AlertDialog.Builder(this)
            .setMessage(message)
            .setPositiveButton("OK", null)
            .show()
    }

    private fun column() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(20), dp(16), dp(20), dp(24))
    }

    private fun scroll(content: LinearLayout) = ScrollView(this).apply {
        setBackgroundColor(Color.rgb(247, 249, 246))
        addView(content)
    }

    private fun title(value: String) = TextView(this).apply {
        text = value
        textSize = 25f
        setTextColor(Color.rgb(31, 63, 48))
        setPadding(0, dp(8), 0, dp(12))
    }

    private fun text(value: String) = TextView(this).apply {
        text = value
        textSize = 15f
        setTextColor(Color.rgb(62, 73, 65))
        setPadding(0, dp(8), 0, dp(8))
    }

    private fun input(hintText: String, inputType: Int) = EditText(this).apply {
        hint = hintText
        this.inputType = inputType
        typeface = Typeface.DEFAULT
        textSize = 16f
        setTextColor(Color.rgb(32, 43, 36))
        setHintTextColor(Color.rgb(122, 132, 125))
        setPadding(dp(14), dp(13), dp(14), dp(13))
        background = roundedBackground(Color.WHITE, Color.rgb(218, 226, 219), dp(12))
        val params = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        params.bottomMargin = dp(12)
        layoutParams = params
    }

    private fun button(label: String, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 16f
        setTypeface(typeface, Typeface.BOLD)
        setTextColor(Color.WHITE)
        minHeight = dp(52)
        backgroundTintList = null
        background = roundedBackground(Color.rgb(39, 99, 71), null, dp(14))
        setOnClickListener { action() }
        val params = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        params.topMargin = dp(5)
        params.bottomMargin = dp(5)
        layoutParams = params
    }

    private fun roundedBackground(fillColor: Int, strokeColor: Int?, radius: Int) =
        GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            setColor(fillColor)
            cornerRadius = radius.toFloat()
            if (strokeColor != null) setStroke(dp(1), strokeColor)
        }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    companion object {
        private const val TAG = "MainActivity"
    }
}
