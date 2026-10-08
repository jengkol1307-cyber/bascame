package id.basecamp.pendaki

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.app.DatePickerDialog
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.provider.Settings
import android.provider.OpenableColumns
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.google.android.gms.location.Priority
import com.google.android.gms.location.LocationServices
import com.google.android.gms.tasks.CancellationTokenSource
import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import org.json.JSONObject
import java.util.UUID
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.io.ByteArrayOutputStream
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
    val mountainId: String = "",
    val groupSize: Int = 1,
    val emergencyContactName: String = "",
    val emergencyContactPhone: String = "",
    val notes: String = "",
)

private data class HikerMountain(
    val id: String,
    val name: String,
    val location: String,
    val elevation: String,
    val status: String,
    val quota: Int?,
    val description: String,
)

private data class HikerChecklistItem(
    val id: String,
    val title: String,
    val category: String,
    val done: Boolean,
)

private data class HikerDocument(
    val id: String,
    val fileName: String,
    val mimeType: String,
    val status: String,
    val createdAt: String?,
)

private data class HikerAnnouncement(
    val id: String,
    val title: String,
    val body: String,
    val basecampName: String,
    val category: String,
)

private data class HikerProfile(
    val email: String,
    val fullName: String,
    val username: String,
    val phone: String,
    val emergencyContactName: String,
    val emergencyContactPhone: String,
)

private data class DashboardMenuItem(
    val icon: String,
    val title: String,
    val description: String,
    val tab: DashboardTab,
)

private data class PendingPasswordChange(
    val identifier: String,
    val currentPassword: String,
)

private enum class DashboardTab {
    HOME,
    TRIPS,
    SAFETY,
    MORE,
    MOUNTAINS,
    CHECKLIST,
    DOCUMENTS,
    ANNOUNCEMENTS,
    ACCOUNT,
}

class MainActivity : AppCompatActivity() {
    private val executor = Executors.newSingleThreadExecutor()
    private val auth by lazy { FirebaseAuth.getInstance() }
    private val trips = mutableListOf<HikerTrip>()
    private val mountains = mutableListOf<HikerMountain>()
    private val checklistItems = mutableListOf<HikerChecklistItem>()
    private val documents = mutableListOf<HikerDocument>()
    private val announcements = mutableListOf<HikerAnnouncement>()
    private var hikerProfile: HikerProfile? = null
    private var pendingPasswordChange: PendingPasswordChange? = null
    private var dashboardStatus: TextView? = null
    private var selectedTripId: String? = null
    private var selectedDashboardTab = DashboardTab.HOME
    private var tripsLoaded = false
    private var tripsLoading = false
    private var tripsError: String? = null
    private var initialTripLoadAttempted = false
    private var mountainsLoaded = false
    private var mountainsLoading = false
    private var checklistLoaded = false
    private var checklistLoading = false
    private var documentsLoaded = false
    private var documentsLoading = false
    private var announcementsLoaded = false
    private var announcementsLoading = false
    private var profileLoaded = false
    private var profileLoading = false
    private var pendingDownload: HikerDocument? = null
    private var pageError: String? = null
    private var pageMessage: String? = null
    private var pendingTrackingStart = false
    private var returningFromLocationSettings = false

    private val documentPicker =
        registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            if (uri != null) uploadDocument(uri)
        }

    private val documentSavePicker =
        registerForActivityResult(ActivityResultContracts.CreateDocument("*/*")) { uri ->
            val document = pendingDownload
            pendingDownload = null
            if (uri != null && document != null) downloadDocument(document, uri)
        }

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
        setContentViewWithSystemBars(authScreen(card))
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
        setContentViewWithSystemBars(authScreen(card))
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

    private fun setContentViewWithSystemBars(view: View) {
        setContentView(view)
        if (Build.VERSION.SDK_INT < 35) return
        val initialLeft = view.paddingLeft
        val initialTop = view.paddingTop
        val initialRight = view.paddingRight
        val initialBottom = view.paddingBottom
        ViewCompat.setOnApplyWindowInsetsListener(view) { target, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            target.setPadding(
                initialLeft + bars.left,
                initialTop + bars.top,
                initialRight + bars.right,
                initialBottom + bars.bottom,
            )
            insets
        }
        ViewCompat.requestApplyInsets(view)
    }

    private fun renderHikerDashboard() {
        schedulePendingUploads()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(247, 249, 246))
        }
        root.addView(dashboardHeader())

        val content = column()
        dashboardStatus = null
        when (selectedDashboardTab) {
            DashboardTab.HOME -> renderHomeTab(content)
            DashboardTab.TRIPS -> renderTripsTab(content)
            DashboardTab.SAFETY -> renderSafetyTab(content)
            DashboardTab.MORE -> renderMoreTab(content)
            DashboardTab.MOUNTAINS -> renderMountainsTab(content)
            DashboardTab.CHECKLIST -> renderChecklistTab(content)
            DashboardTab.DOCUMENTS -> renderDocumentsTab(content)
            DashboardTab.ANNOUNCEMENTS -> renderAnnouncementsTab(content)
            DashboardTab.ACCOUNT -> renderAccountTab(content)
        }
        root.addView(
            scroll(content),
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f,
            ),
        )
        root.addView(dashboardNavigation())
        setContentViewWithSystemBars(root)

        if (!initialTripLoadAttempted && !tripsLoaded && !tripsLoading) {
            initialTripLoadAttempted = true
            val status = dashboardStatus ?: text("Memuat pendakianmu…")
            loadTrips(status)
        }
        when (selectedDashboardTab) {
            DashboardTab.MOUNTAINS -> if (!mountainsLoaded && !mountainsLoading) loadMountains()
            DashboardTab.CHECKLIST -> if (!checklistLoaded && !checklistLoading) loadChecklist()
            DashboardTab.DOCUMENTS -> if (!documentsLoaded && !documentsLoading) loadDocuments()
            DashboardTab.ANNOUNCEMENTS -> if (!announcementsLoaded && !announcementsLoading) loadAnnouncements()
            DashboardTab.ACCOUNT -> if (!profileLoaded && !profileLoading) loadProfile()
            else -> Unit
        }
    }

    private fun dashboardHeader() = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(22), dp(14), dp(18), dp(12))
        addView(TextView(this@MainActivity).apply {
            text = android.text.SpannableString("basecamp.").apply {
                setSpan(
                    android.text.style.ForegroundColorSpan(Color.rgb(210, 138, 84)),
                    length - 1,
                    length,
                    android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
                )
            }
            textSize = 23f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(Color.rgb(35, 49, 40))
            letterSpacing = -0.04f
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        addView(TextView(this@MainActivity).apply {
            text = "PENDAKI"
            textSize = 10f
            letterSpacing = 0.12f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(Color.rgb(39, 99, 71))
            setPadding(dp(12), dp(8), dp(12), dp(8))
            background = roundedBackground(Color.rgb(231, 240, 233), null, dp(18))
        })
    }

    private fun dashboardNavigation() = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER
        setPadding(dp(8), dp(8), dp(8), dp(8))
        background = roundedBackground(Color.WHITE, Color.rgb(228, 235, 228), dp(18))
        val tabs = listOf(
            Triple(DashboardTab.HOME, "⌂", "Beranda"),
            Triple(DashboardTab.TRIPS, "↟", "Pendakian"),
            Triple(DashboardTab.SAFETY, "!", "Keselamatan"),
            Triple(DashboardTab.MORE, "☰", "Menu"),
        )
        tabs.forEach { (tab, icon, label) ->
            val selected = if (tab == DashboardTab.MORE) {
                selectedDashboardTab in setOf(
                    DashboardTab.MORE,
                    DashboardTab.MOUNTAINS,
                    DashboardTab.CHECKLIST,
                    DashboardTab.DOCUMENTS,
                    DashboardTab.ANNOUNCEMENTS,
                    DashboardTab.ACCOUNT,
                )
            } else {
                selectedDashboardTab == tab
            }
            addView(TextView(this@MainActivity).apply {
                text = "$icon\n$label"
                textSize = 11f
                gravity = Gravity.CENTER
                setLineSpacing(dp(2).toFloat(), 1f)
                setTypeface(typeface, if (selected) Typeface.BOLD else Typeface.NORMAL)
                setTextColor(if (selected) Color.rgb(39, 99, 71) else Color.rgb(99, 109, 101))
                if (selected) {
                    background = roundedBackground(Color.rgb(231, 240, 233), null, dp(14))
                }
                setPadding(dp(4), dp(8), dp(4), dp(8))
                setOnClickListener {
                    selectedDashboardTab = tab
                    renderHikerDashboard()
                }
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        }
        val params = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        params.setMargins(dp(14), dp(8), dp(14), dp(14))
        layoutParams = params
    }

    private fun renderHomeTab(content: LinearLayout) {
        val name = hikerProfile?.fullName?.takeIf { it.isNotBlank() }
            ?: auth.currentUser?.displayName
            ?.takeIf { it.isNotBlank() }
            ?: auth.currentUser?.email?.substringBefore("@")
            ?: "Pendaki"
        content.addView(authEyebrow("RUANG PERSIAPAN PERJALANANMU"))
        content.addView(authHeading("Halo, $name!"))
        content.addView(authDescription("Rencanakan perjalanan dan pantau keselamatanmu dari satu tempat."))

        val hero = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(20), dp(20), dp(20))
            background = roundedBackground(Color.rgb(39, 99, 71), null, dp(20))
        }
        hero.addView(TextView(this).apply {
            text = "BASECAMP  •  TEMAN PERJALANANMU"
            textSize = 10f
            letterSpacing = 0.09f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(Color.rgb(208, 226, 212))
        })
        hero.addView(TextView(this).apply {
            text = "Persiapan lebih tenang, perjalanan lebih aman."
            textSize = 22f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(Color.WHITE)
            setPadding(0, dp(12), 0, dp(8))
        })
        hero.addView(TextView(this).apply {
            text = "Sinyal lokasi, bantuan darurat, dan peta offline siap menemanimu saat pendakian aktif."
            textSize = 14f
            setTextColor(Color.rgb(231, 239, 232))
            setLineSpacing(dp(3).toFloat(), 1f)
        })
        hero.addView(TextView(this).apply {
            text = if (tripsLoaded) {
                "${trips.size} pendakian tercatat  ·  ${trips.count { it.status == "checked_in" }} sedang aktif"
            } else if (tripsLoading) {
                "Memuat ringkasan pendakian…"
            } else {
                tripsError ?: "Ringkasan pendakian belum tersedia."
            }
            textSize = 12f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(Color.WHITE)
            setPadding(0, dp(17), 0, 0)
        })
        content.addView(hero, cardParams(bottom = 18))

        content.addView(sectionHeading("Akses cepat", "Fitur utama"))
        val firstRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        firstRow.addView(menuTile("⌁", "Jelajahi gunung", "Cari jalur yang tersedia", Color.rgb(239, 244, 237)) {
            selectedDashboardTab = DashboardTab.MOUNTAINS
            renderHikerDashboard()
        }, weightedTileParams(endMargin = 6))
        firstRow.addView(menuTile("↟", "Pendakian saya", "Status dan jadwal", Color.rgb(239, 244, 237)) {
            selectedDashboardTab = DashboardTab.TRIPS
            renderHikerDashboard()
        }, weightedTileParams(startMargin = 6))
        content.addView(firstRow)

        val secondRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        secondRow.addView(menuTile("!", "SOS & keselamatan", "Bantuan saat di jalur", Color.rgb(251, 239, 235)) {
            selectedDashboardTab = DashboardTab.SAFETY
            renderHikerDashboard()
        }, weightedTileParams(endMargin = 6))
        secondRow.addView(menuTile("⌖", "Lokasi GPS", "Pelacakan perjalanan", Color.rgb(235, 242, 249)) {
            selectedDashboardTab = DashboardTab.SAFETY
            renderHikerDashboard()
        }, weightedTileParams(startMargin = 6))
        secondRow.setPadding(0, dp(12), 0, 0)
        content.addView(secondRow)
        content.addView(button("Lihat menu pendaki lainnya") {
            selectedDashboardTab = DashboardTab.MORE
            renderHikerDashboard()
        })

        if (!tripsLoaded && !tripsLoading) {
            val error = text(tripsError ?: "Pendakian belum berhasil dimuat. Periksa koneksi lalu coba lagi.")
            error.setTextColor(Color.rgb(155, 63, 49))
            content.addView(error, cardParams(top = 10))
            content.addView(button("Coba muat ulang") {
                loadTrips(dashboardStatus ?: error)
            })
        }
    }

    private fun renderTripsTab(content: LinearLayout) {
        content.addView(authEyebrow("PERJALANANMU"))
        content.addView(authHeading("Pendakian saya"))
        content.addView(authDescription("Lihat jadwal dan status perjalanan yang terhubung dengan akunmu."))
        val status = text(
            when {
                tripsLoading -> "Memuat pendakian…"
                tripsError != null -> tripsError.orEmpty()
                !tripsLoaded -> "Belum ada data pendakian."
                trips.isEmpty() -> "Belum ada pendakian yang tercatat."
                else -> "${trips.size} pendakian ditemukan."
            },
        )
        dashboardStatus = status
        content.addView(status)
        content.addView(button(if (tripsLoaded) "Segarkan pendakian" else "Muat pendakian") {
            loadTrips(status)
        })
        content.addView(button("Jelajahi gunung") {
            selectedDashboardTab = DashboardTab.MOUNTAINS
            renderHikerDashboard()
        })

        trips.forEach { trip ->
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(17), dp(15), dp(17), dp(15))
                background = roundedBackground(Color.WHITE, Color.rgb(228, 235, 228), dp(16))
            }
            card.addView(TextView(this).apply {
                text = trip.mountainName
                textSize = 18f
                setTypeface(typeface, Typeface.BOLD)
                setTextColor(Color.rgb(35, 49, 40))
            })
            card.addView(text("${trip.startDate} – ${trip.endDate}"))
            val badge = text(tripStatusLabel(trip.status))
            badge.textSize = 12f
            badge.setTypeface(badge.typeface, Typeface.BOLD)
            badge.setTextColor(if (trip.status == "checked_in") Color.rgb(39, 99, 71) else Color.rgb(91, 101, 93))
            card.addView(badge)
            if (trip.notes.isNotBlank()) card.addView(text("Catatan: ${trip.notes}"))
            if (trip.status in setOf("needs_revision", "revision_requested") && trip.notes.isNotBlank()) {
                card.addView(text("Periksa catatan dari petugas sebelum mengajukan kembali."))
            }
            if (trip.status == "checked_in") {
                card.addView(button("Buka fitur keselamatan") {
                    selectedTripId = trip.id
                    selectedDashboardTab = DashboardTab.SAFETY
                    renderHikerDashboard()
                })
            }
            if (trip.status in setOf("pending", "needs_revision", "revision_requested")) {
                card.addView(button("Ubah pengajuan") {
                    val mountain = mountains.firstOrNull { it.id == trip.mountainId }
                    if (mountain == null) {
                        selectedDashboardTab = DashboardTab.MOUNTAINS
                        renderHikerDashboard()
                    } else {
                        showRegistrationDialog(mountain, trip)
                    }
                })
                card.addView(textButton("Batalkan pengajuan") { confirmCancelTrip(trip) })
            }
            content.addView(card, cardParams(bottom = 12))
        }
        if (tripsLoaded && trips.isEmpty()) {
            content.addView(text("Perjalanan yang sudah diajukan akan muncul di sini."))
        }
    }

    private fun renderSafetyTab(content: LinearLayout) {
        val activeTrips = trips.filter { it.status == "checked_in" }
        content.addView(authEyebrow("FITUR SAAT DI JALUR"))
        content.addView(authHeading("Keselamatan"))
        content.addView(authDescription("SOS, pelacakan lokasi, dan peta offline untuk pendakian yang sedang check-in."))
        val status = text(
            if (tripsLoading) "Memuat status pendakian…"
            else if (tripsError != null) tripsError.orEmpty()
            else if (!tripsLoaded) "Memuat status pendakian…"
            else "Pilih pendakian aktif untuk mengakses fitur keselamatan.",
        )
        dashboardStatus = status
        content.addView(status)
        if (activeTrips.isEmpty()) {
            val empty = menuTile(
                "✓",
                "Belum ada pendakian aktif",
                "SOS dan pelacakan tersedia setelah petugas melakukan check-in.",
                Color.rgb(239, 244, 237),
            ) {
                selectedDashboardTab = DashboardTab.TRIPS
                renderHikerDashboard()
            }
            content.addView(empty, cardParams(top = 10))
            if (!tripsLoaded && !tripsLoading) {
                content.addView(button("Muat ulang pendakian") { loadTrips(status) })
            }
            return
        }

        val tripPicker = Spinner(this)
        tripPicker.adapter = ArrayAdapter(
            this,
            android.R.layout.simple_spinner_dropdown_item,
            activeTrips.map { "${it.mountainName} • ${it.startDate} – ${it.endDate}" },
        )
        val selectedIndex = activeTrips.indexOfFirst { it.id == selectedTripId }
        if (selectedIndex >= 0) tripPicker.setSelection(selectedIndex)
        selectedTripId = activeTrips.getOrNull(tripPicker.selectedItemPosition)?.id
        content.addView(text("Pendakian aktif"))
        content.addView(tripPicker, cardParams(bottom = 14))

        val queueStatus = text("")
        val queueCard = LinearLayout(this).apply {
            setPadding(dp(14), dp(5), dp(14), dp(5))
            background = roundedBackground(Color.WHITE, Color.rgb(228, 235, 228), dp(14))
            addView(queueStatus)
        }
        content.addView(queueCard, cardParams(bottom = 10))
        updateQueueStatus(queueStatus)

        content.addView(sectionHeading("PELACAKAN GPS", "Lokasi perjalanan"))
        content.addView(button("Mulai pelacakan lokasi") {
            val trip = activeTrips.getOrNull(tripPicker.selectedItemPosition) ?: return@button
            selectedTripId = trip.id
            beginTracking(trip, status)
        })
        content.addView(button("Hentikan pelacakan") {
            stopTracking()
            status.text = "Pelacakan dihentikan. Sinyal yang sudah antre tetap tersimpan."
        })
        content.addView(button("Unduh / buka peta offline") {
            val trip = activeTrips.getOrNull(tripPicker.selectedItemPosition) ?: return@button
            selectedTripId = trip.id
            val intent = Intent(this, OfflineMapActivity::class.java)
                .putExtra(OfflineMapActivity.EXTRA_MOUNTAIN_NAME, trip.mountainName)
                .putExtra(OfflineMapActivity.EXTRA_LATITUDE, trip.latitude ?: Double.NaN)
                .putExtra(OfflineMapActivity.EXTRA_LONGITUDE, trip.longitude ?: Double.NaN)
            startActivity(intent)
        })

        content.addView(sectionHeading("Butuh bantuan?", "Kirim sinyal SOS"))
        val categoryPicker = Spinner(this)
        val categoryLabels = listOf("Medis", "Cedera", "Tersesat", "Lainnya")
        categoryPicker.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, categoryLabels)
        content.addView(text("Jenis keadaan darurat"))
        content.addView(categoryPicker)
        val description = input(
            "Pesan singkat untuk petugas (opsional)",
            android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE,
        ).apply { minLines = 2 }
        content.addView(description)
        content.addView(button("Kirim SOS") {
            val trip = activeTrips.getOrNull(tripPicker.selectedItemPosition) ?: return@button
            AlertDialog.Builder(this)
                .setTitle("Kirim sinyal SOS?")
                .setMessage("Petugas akan menerima identitas perjalanan dan lokasi terakhir yang tersedia.")
                .setNegativeButton("Batal", null)
                .setPositiveButton("Kirim SOS") { _, _ ->
                    selectedTripId = trip.id
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
            background = roundedBackground(Color.rgb(176, 45, 45), null, dp(14))
        })
    }

    private fun renderMoreTab(content: LinearLayout) {
        content.addView(authEyebrow("DASHBOARD PENDAKI"))
        content.addView(authHeading("Semua menu"))
        content.addView(authDescription("Kelola persiapan dan informasi perjalananmu."))
        listOf(
            DashboardMenuItem("⌁", "Jelajahi gunung", "Lihat status jalur, lokasi, dan kuota.", DashboardTab.MOUNTAINS),
            DashboardMenuItem("☑", "Checklist pendakian", "Atur perlengkapan dan persiapan.", DashboardTab.CHECKLIST),
            DashboardMenuItem("▤", "Dokumen saya", "Unggah, unduh, dan kelola dokumen.", DashboardTab.DOCUMENTS),
            DashboardMenuItem("◉", "Informasi & notifikasi", "Baca pengumuman resmi basecamp.", DashboardTab.ANNOUNCEMENTS),
            DashboardMenuItem("○", "Profil & keamanan", "Perbarui kontak dan pengaturan akun.", DashboardTab.ACCOUNT),
        ).forEach { (icon, heading, description, tab) ->
            content.addView(menuTile(
                icon,
                heading,
                description,
                Color.rgb(239, 244, 237),
            ) {
                selectedDashboardTab = tab
                renderHikerDashboard()
            }, cardParams(bottom = 10))
        }
    }

    private fun moreBackButton() = TextView(this).apply {
        text = "←  Semua menu"
        textSize = 14f
        setTypeface(typeface, Typeface.BOLD)
        setTextColor(Color.rgb(39, 99, 71))
        setPadding(0, 0, 0, dp(15))
        setOnClickListener {
            selectedDashboardTab = DashboardTab.MORE
            renderHikerDashboard()
        }
    }

    private fun renderMountainsTab(content: LinearLayout) {
        content.addView(moreBackButton())
        content.addView(authEyebrow("INFORMASI BASECAMP"))
        content.addView(authHeading("Jelajahi gunung"))
        content.addView(authDescription("Periksa status jalur dan informasi dari pengelola sebelum merencanakan perjalanan."))
        content.addView(button(
            when {
                mountainsLoading -> "Memuat informasi…"
                mountainsLoaded -> "Segarkan informasi"
                else -> "Muat informasi gunung"
            },
        ) {
            if (!mountainsLoading) loadMountains()
        }.apply { isEnabled = !mountainsLoading })
        addPageNotice(content)
        if (mountainsLoading && mountains.isEmpty()) {
            content.addView(text("Mengambil informasi gunung…"))
        } else if (mountains.isEmpty()) {
            content.addView(menuTile(
                "⌁",
                "Belum ada gunung dipublikasikan",
                "Informasi akan muncul setelah pengelola basecamp memublikasikannya.",
                Color.rgb(239, 244, 237),
            ) {})
        }
        mountains.forEach { mountain ->
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(17), dp(16), dp(17), dp(16))
                background = roundedBackground(Color.WHITE, Color.rgb(228, 235, 228), dp(16))
            }
            val badge = text(mountain.status)
            badge.textSize = 12f
            badge.setTypeface(badge.typeface, Typeface.BOLD)
            badge.setTextColor(if (isMountainOpen(mountain.status)) Color.rgb(39, 99, 71) else Color.rgb(155, 63, 49))
            card.addView(badge)
            card.addView(TextView(this).apply {
                text = mountain.name
                textSize = 19f
                setTypeface(typeface, Typeface.BOLD)
                setTextColor(Color.rgb(35, 49, 40))
                setPadding(0, dp(5), 0, dp(2))
            })
            val details = listOfNotNull(
                mountain.location.takeIf { it.isNotBlank() },
                mountain.elevation.takeIf { it.isNotBlank() },
            ).joinToString(" · ")
            if (details.isNotBlank()) card.addView(text(details))
            if (mountain.quota != null) card.addView(text("Kuota harian: ${mountain.quota} pendaki"))
            if (mountain.description.isNotBlank()) card.addView(text(mountain.description))
            if (isMountainOpen(mountain.status)) {
                card.addView(button("Ajukan pendakian") { showRegistrationDialog(mountain) })
            }
            content.addView(card, cardParams(bottom = 12))
        }
    }

    private fun renderChecklistTab(content: LinearLayout) {
        content.addView(moreBackButton())
        content.addView(authEyebrow("PERLENGKAPAN & PERSIAPAN"))
        content.addView(authHeading("Checklist pendakian"))
        val completed = checklistItems.count { it.done }
        content.addView(authDescription(
            if (checklistLoaded) "$completed dari ${checklistItems.size} persiapan selesai."
            else if (checklistLoading) "Memuat checklist…"
            else "Siapkan kebutuhan untuk perjalananmu.",
        ))
        content.addView(button("Tambah persiapan") { showAddChecklistDialog() })
        addPageNotice(content)
        if (checklistLoading && checklistItems.isEmpty()) content.addView(text("Mengambil checklist…"))
        val categories = listOf("Perlengkapan", "Dokumen", "Kesehatan", "Perjalanan")
        categories.forEach { category ->
            val groupItems = checklistItems.filter { it.category == category }
            if (groupItems.isEmpty()) return@forEach
            content.addView(sectionHeading("CHECKLIST", category))
            groupItems.forEach { item ->
                val row = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(dp(11), dp(7), dp(11), dp(7))
                    background = roundedBackground(Color.WHITE, Color.rgb(228, 235, 228), dp(12))
                }
                val check = CheckBox(this).apply {
                    text = item.title
                    isChecked = item.done
                    textSize = 14f
                    setTextColor(Color.rgb(52, 65, 56))
                    buttonTintList = android.content.res.ColorStateList.valueOf(Color.rgb(39, 99, 71))
                    setOnCheckedChangeListener { _, checked ->
                        if (checked != item.done) setChecklistDone(item, checked)
                    }
                }
                row.addView(check, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                row.addView(TextView(this).apply {
                    text = "Hapus"
                    textSize = 12f
                    setTypeface(typeface, Typeface.BOLD)
                    setTextColor(Color.rgb(155, 63, 49))
                    setPadding(dp(10), dp(12), dp(5), dp(12))
                    setOnClickListener { confirmDeleteChecklist(item) }
                })
                content.addView(row, cardParams(bottom = 7))
            }
        }
        if (checklistLoaded && checklistItems.isEmpty()) {
            content.addView(menuTile(
                "☑",
                "Checklist masih kosong",
                "Tambahkan kebutuhan khusus atau perlengkapanmu.",
                Color.rgb(239, 244, 237),
            ) {})
        }
        if (!checklistLoaded && !checklistLoading) content.addView(button("Coba lagi") { loadChecklist() })
    }

    private fun renderDocumentsTab(content: LinearLayout) {
        content.addView(moreBackButton())
        content.addView(authEyebrow("ARSIP PRIBADI"))
        content.addView(authHeading("Dokumen saya"))
        content.addView(authDescription("Simpan PDF atau gambar secara privat untuk persiapan perjalanan. Maksimal 3 MB per file."))
        content.addView(button(if (documentsLoading) "Memuat dokumen…" else "Unggah dokumen") {
            if (!documentsLoading) documentPicker.launch(arrayOf("application/pdf", "image/jpeg", "image/png"))
        }.apply { isEnabled = !documentsLoading })
        addPageNotice(content)
        if (documentsLoading && documents.isEmpty()) content.addView(text("Mengambil dokumen…"))
        if (documentsLoaded && documents.isEmpty()) {
            content.addView(menuTile(
                "▤",
                "Belum ada dokumen",
                "Unggah dokumen PDF atau gambar untuk mulai mengarsipkan.",
                Color.rgb(239, 244, 237),
            ) {})
        }
        documents.forEach { document ->
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(15), dp(14), dp(15), dp(13))
                background = roundedBackground(Color.WHITE, Color.rgb(228, 235, 228), dp(14))
            }
            card.addView(TextView(this).apply {
                text = document.fileName
                textSize = 15f
                setTypeface(typeface, Typeface.BOLD)
                setTextColor(Color.rgb(35, 49, 40))
            })
            card.addView(text("${document.mimeType} · ${if (document.status == "stored") "Tersimpan" else document.status}"))
            val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            actions.addView(textButton("Unduh") {
                pendingDownload = document
                documentSavePicker.launch(document.fileName)
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            actions.addView(textButton("Hapus") { confirmDeleteDocument(document) }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            card.addView(actions)
            content.addView(card, cardParams(bottom = 9))
        }
        if (!documentsLoaded && !documentsLoading) content.addView(button("Coba muat ulang") { loadDocuments() })
    }

    private fun renderAnnouncementsTab(content: LinearLayout) {
        content.addView(moreBackButton())
        content.addView(authEyebrow("INFORMASI RESMI"))
        content.addView(authHeading("Informasi & notifikasi"))
        content.addView(authDescription("Pengumuman publik dari pengelola basecamp."))
        content.addView(button(if (announcementsLoading) "Memuat informasi…" else "Segarkan informasi") {
            if (!announcementsLoading) loadAnnouncements()
        }.apply { isEnabled = !announcementsLoading })
        addPageNotice(content)
        if (announcementsLoading && announcements.isEmpty()) content.addView(text("Mengambil pengumuman…"))
        if (announcementsLoaded && announcements.isEmpty()) {
            content.addView(menuTile(
                "◉",
                "Belum ada pengumuman",
                "Pengumuman publik akan muncul di sini.",
                Color.rgb(239, 244, 237),
            ) {})
        }
        announcements.forEach { announcement ->
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(16), dp(15), dp(16), dp(15))
                background = roundedBackground(Color.WHITE, Color.rgb(228, 235, 228), dp(15))
            }
            if (!announcementsLoaded && !announcementsLoading) {
                content.addView(button("Coba muat informasi") { loadAnnouncements() })
            }
            val badge = text(announcement.category.uppercase())
            badge.textSize = 10f
            badge.setTypeface(badge.typeface, Typeface.BOLD)
            badge.setTextColor(Color.rgb(39, 99, 71))
            card.addView(badge)
            card.addView(TextView(this).apply {
                text = announcement.title
                textSize = 18f
                setTypeface(typeface, Typeface.BOLD)
                setTextColor(Color.rgb(35, 49, 40))
                setPadding(0, dp(6), 0, dp(4))
            })
            card.addView(text(announcement.body))
            card.addView(text(announcement.basecampName))
            content.addView(card, cardParams(bottom = 10))
        }
    }

    private fun renderAccountTab(content: LinearLayout) {
        content.addView(moreBackButton())
        content.addView(authEyebrow("AKUN BASECAMP"))
        content.addView(authHeading("Profil & keamanan"))
        content.addView(authDescription("Perbarui identitas dan kontak darurat yang digunakan petugas."))
        addPageNotice(content)
        if (profileLoading && hikerProfile == null) content.addView(text("Memuat profil…"))
        val profile = hikerProfile
        if (profile != null) {
            val fullName = input("Nama lengkap", android.text.InputType.TYPE_CLASS_TEXT).apply {
                setText(profile.fullName)
                setSingleLine(true)
            }
            val phone = input("Nomor telepon", android.text.InputType.TYPE_CLASS_PHONE).apply {
                setText(profile.phone)
                setSingleLine(true)
            }
            val emergencyName = input("Nama kontak darurat", android.text.InputType.TYPE_CLASS_TEXT).apply {
                setText(profile.emergencyContactName)
                setSingleLine(true)
            }
            val emergencyPhone = input("Nomor kontak darurat", android.text.InputType.TYPE_CLASS_PHONE).apply {
                setText(profile.emergencyContactPhone)
                setSingleLine(true)
            }
            content.addView(fieldLabel("Nama lengkap"))
            content.addView(fullName)
            content.addView(fieldLabel("Username dan email"))
            content.addView(text("${profile.username} · ${profile.email}"))
            content.addView(fieldLabel("Nomor telepon"))
            content.addView(phone)
            content.addView(sectionHeading("OPSIONAL", "Kontak darurat"))
            content.addView(fieldLabel("Nama kontak"))
            content.addView(emergencyName)
            content.addView(fieldLabel("Nomor telepon"))
            content.addView(emergencyPhone)
            content.addView(button("Simpan profil") {
                val values = listOf(
                    fullName.text.toString().trim(),
                    phone.text.toString().trim(),
                    emergencyName.text.toString().trim(),
                    emergencyPhone.text.toString().trim(),
                )
                if (values[0].length < 2 || values[0].length > 80 ||
                    values[1].length > 32 || values[2].length > 80 || values[3].length > 32 ||
                    ((values[2].isBlank()) != (values[3].isBlank()))
                ) {
                    showMessage("Periksa kembali nama, nomor telepon, dan pasangan kontak darurat.")
                    return@button
                }
                saveProfile(values)
            })
            content.addView(sectionHeading("KEAMANAN AKUN", "Kata sandi"))
            content.addView(text("Tautan pengaturan ulang akan dikirim ke ${profile.email}."))
            content.addView(button("Kirim tautan atur ulang sandi") { requestPasswordReset() })
        } else if (!profileLoading) {
            content.addView(text("Profil belum dapat dimuat. Periksa koneksi lalu coba lagi."))
            content.addView(button("Coba muat profil") { loadProfile() })
        }
        content.addView(sectionHeading("PENGATURAN APLIKASI", "Izin perangkat"))
        content.addView(menuTile(
            "⌖",
            "Izin lokasi",
            "Diperlukan agar pelacakan GPS dan SOS dapat menyertakan lokasi.",
            Color.rgb(235, 242, 249),
        ) {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.fromParts("package", packageName, null)
            })
        })
        content.addView(button("Keluar dari akun") {
            stopTracking()
            auth.signOut()
            clearHikerData()
            render()
        })
    }

    private fun clearHikerData() {
        trips.clear()
        mountains.clear()
        checklistItems.clear()
        documents.clear()
        announcements.clear()
        hikerProfile = null
        tripsLoaded = false
        tripsLoading = false
        tripsError = null
        initialTripLoadAttempted = false
        mountainsLoaded = false
        mountainsLoading = false
        checklistLoaded = false
        checklistLoading = false
        documentsLoaded = false
        documentsLoading = false
        announcementsLoaded = false
        announcementsLoading = false
        profileLoaded = false
        profileLoading = false
        selectedTripId = null
        pageError = null
        pageMessage = null
        selectedDashboardTab = DashboardTab.HOME
    }

    private fun menuTile(
        icon: String,
        heading: String,
        description: String,
        iconBackground: Int,
        action: () -> Unit,
    ) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(13), dp(14), dp(13), dp(14))
        background = roundedBackground(Color.WHITE, Color.rgb(228, 235, 228), dp(16))
        val iconView = TextView(this@MainActivity).apply {
            text = icon
            textSize = 19f
            gravity = Gravity.CENTER
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(Color.rgb(39, 99, 71))
            background = roundedBackground(iconBackground, null, dp(13))
        }
        addView(iconView, LinearLayout.LayoutParams(dp(42), dp(42)))
        val copy = LinearLayout(this@MainActivity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(11), 0, 0, 0)
            addView(TextView(this@MainActivity).apply {
                text = heading
                textSize = 14f
                setTypeface(typeface, Typeface.BOLD)
                setTextColor(Color.rgb(35, 49, 40))
            })
            addView(TextView(this@MainActivity).apply {
                text = description
                textSize = 11f
                setTextColor(Color.rgb(99, 109, 101))
                setPadding(0, dp(3), 0, 0)
            })
        }
        addView(copy, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        setOnClickListener { action() }
    }

    private fun sectionHeading(kicker: String, heading: String) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(0, dp(22), 0, dp(11))
        addView(authEyebrow(kicker))
        addView(TextView(this@MainActivity).apply {
            text = heading
            textSize = 19f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(Color.rgb(35, 49, 40))
        })
    }

    private fun cardParams(top: Int = 0, bottom: Int = 0) =
        LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        ).apply {
            if (top > 0) topMargin = dp(top)
            if (bottom > 0) bottomMargin = dp(bottom)
        }

    private fun addPageNotice(content: LinearLayout) {
        pageMessage?.let { message ->
            val notice = text(message)
            notice.setTextColor(Color.rgb(39, 99, 71))
            content.addView(notice, cardParams(bottom = 8))
            pageMessage = null
        }
        pageError?.let { error ->
            val message = text(error)
            message.setTextColor(Color.rgb(155, 63, 49))
            content.addView(message, cardParams(bottom = 8))
        }
    }

    private fun weightedTileParams(startMargin: Int = 0, endMargin: Int = 0) =
        LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f).apply {
            if (startMargin > 0) marginStart = dp(startMargin)
            if (endMargin > 0) marginEnd = dp(endMargin)
        }

    private fun tripStatusLabel(status: String): String = when (status) {
        "checked_in" -> "Sedang mendaki"
        "checked_out" -> "Selesai"
        "approved" -> "Disetujui"
        "needs_revision", "revision_requested" -> "Perlu revisi"
        "rejected" -> "Ditolak"
        "cancelled" -> "Dibatalkan"
        else -> "Menunggu verifikasi"
    }

    private fun isMountainOpen(status: String): Boolean =
        status.trim().lowercase() in setOf("buka", "dibuka", "open")

    private fun loadMountains() {
        mountainsLoading = true
        pageError = null
        renderHikerDashboard()
        executor.execute {
            try {
                val response = ApiClient.request("/api/mountains")
                ApiClient.requireSuccess(response)
                val rows = response.body.optJSONArray("mountains")
                    ?: throw IllegalStateException("Respons daftar gunung tidak valid.")
                val loaded = (0 until rows.length()).mapNotNull { index ->
                    val item = rows.optJSONObject(index) ?: return@mapNotNull null
                    HikerMountain(
                        id = item.optString("id"),
                        name = item.optString("name", "Gunung"),
                        location = item.optString("location"),
                        elevation = item.optString("elevation"),
                        status = item.optString("status", "Belum dikonfirmasi"),
                        quota = item.takeIf { it.has("quota") && !it.isNull("quota") }?.optInt("quota"),
                        description = item.optString("description"),
                    )
                }
                runOnUiThread {
                    mountains.clear()
                    mountains.addAll(loaded)
                    mountainsLoaded = true
                    mountainsLoading = false
                    pageError = null
                    if (selectedDashboardTab == DashboardTab.MOUNTAINS) renderHikerDashboard()
                }
            } catch (error: Exception) {
                runOnUiThread {
                    mountainsLoading = false
                    pageError = error.localizedMessage ?: "Daftar gunung belum dapat dimuat."
                    if (selectedDashboardTab == DashboardTab.MOUNTAINS) renderHikerDashboard()
                }
            }
        }
    }

    private fun loadChecklist() {
        checklistLoading = true
        pageError = null
        renderHikerDashboard()
        executor.execute {
            try {
                val response = ApiClient.request("/api/checklist")
                ApiClient.requireSuccess(response)
                val rows = response.body.optJSONArray("items")
                    ?: throw IllegalStateException("Respons checklist tidak valid.")
                val loaded = (0 until rows.length()).mapNotNull { index ->
                    val item = rows.optJSONObject(index) ?: return@mapNotNull null
                    HikerChecklistItem(
                        id = item.optString("id"),
                        title = item.optString("title"),
                        category = item.optString("category", "Perlengkapan"),
                        done = item.optBoolean("done"),
                    )
                }
                runOnUiThread {
                    checklistItems.clear()
                    checklistItems.addAll(loaded)
                    checklistLoaded = true
                    checklistLoading = false
                    pageError = null
                    if (selectedDashboardTab == DashboardTab.CHECKLIST) renderHikerDashboard()
                }
            } catch (error: Exception) {
                runOnUiThread {
                    checklistLoading = false
                    pageError = error.localizedMessage ?: "Checklist belum dapat dimuat."
                    if (selectedDashboardTab == DashboardTab.CHECKLIST) renderHikerDashboard()
                }
            }
        }
    }

    private fun loadDocuments() {
        documentsLoading = true
        pageError = null
        renderHikerDashboard()
        executor.execute {
            try {
                val response = ApiClient.request("/api/documents/mine")
                ApiClient.requireSuccess(response)
                val rows = response.body.optJSONArray("documents")
                    ?: throw IllegalStateException("Respons dokumen tidak valid.")
                val loaded = (0 until rows.length()).mapNotNull { index ->
                    val item = rows.optJSONObject(index) ?: return@mapNotNull null
                    HikerDocument(
                        id = item.optString("id"),
                        fileName = item.optString("fileName", "Dokumen"),
                        mimeType = item.optString("mimeType"),
                        status = item.optString("status"),
                        createdAt = item.takeIf { it.has("createdAt") && !it.isNull("createdAt") }
                            ?.optString("createdAt"),
                    )
                }
                runOnUiThread {
                    documents.clear()
                    documents.addAll(loaded)
                    documentsLoaded = true
                    documentsLoading = false
                    pageError = null
                    if (selectedDashboardTab == DashboardTab.DOCUMENTS) renderHikerDashboard()
                }
            } catch (error: Exception) {
                runOnUiThread {
                    documentsLoading = false
                    pageError = error.localizedMessage ?: "Dokumen belum dapat dimuat."
                    if (selectedDashboardTab == DashboardTab.DOCUMENTS) renderHikerDashboard()
                }
            }
        }
    }

    private fun loadAnnouncements() {
        announcementsLoading = true
        pageError = null
        renderHikerDashboard()
        executor.execute {
            try {
                val response = ApiClient.request("/api/announcements")
                ApiClient.requireSuccess(response)
                val rows = response.body.optJSONArray("announcements")
                    ?: throw IllegalStateException("Respons informasi tidak valid.")
                val loaded = (0 until rows.length()).mapNotNull { index ->
                    val item = rows.optJSONObject(index) ?: return@mapNotNull null
                    HikerAnnouncement(
                        id = item.optString("id"),
                        title = item.optString("title", "Informasi basecamp"),
                        body = item.optString("body"),
                        basecampName = item.optString("basecampName", "Pengumuman resmi"),
                        category = item.optString("category", "Informasi"),
                    )
                }
                runOnUiThread {
                    announcements.clear()
                    announcements.addAll(loaded)
                    announcementsLoaded = true
                    announcementsLoading = false
                    pageError = null
                    if (selectedDashboardTab == DashboardTab.ANNOUNCEMENTS) renderHikerDashboard()
                }
            } catch (error: Exception) {
                runOnUiThread {
                    announcementsLoading = false
                    pageError = error.localizedMessage ?: "Pengumuman belum dapat dimuat."
                    if (selectedDashboardTab == DashboardTab.ANNOUNCEMENTS) renderHikerDashboard()
                }
            }
        }
    }

    private fun loadProfile() {
        profileLoading = true
        pageError = null
        renderHikerDashboard()
        executor.execute {
            try {
                val response = ApiClient.request("/api/profile")
                ApiClient.requireSuccess(response)
                val profile = response.body.optJSONObject("profile")
                    ?: throw IllegalStateException("Respons profil tidak valid.")
                val loaded = HikerProfile(
                    email = profile.optString("email"),
                    fullName = profile.optString("fullName"),
                    username = profile.optString("username"),
                    phone = profile.optString("phone"),
                    emergencyContactName = profile.optString("emergencyContactName"),
                    emergencyContactPhone = profile.optString("emergencyContactPhone"),
                )
                runOnUiThread {
                    hikerProfile = loaded
                    profileLoaded = true
                    profileLoading = false
                    pageError = null
                    if (selectedDashboardTab == DashboardTab.ACCOUNT) renderHikerDashboard()
                }
            } catch (error: Exception) {
                runOnUiThread {
                    profileLoading = false
                    pageError = error.localizedMessage ?: "Profil belum dapat dimuat."
                    if (selectedDashboardTab == DashboardTab.ACCOUNT) renderHikerDashboard()
                }
            }
        }
    }

    private fun showAddChecklistDialog() {
        val form = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), dp(10), dp(22), 0)
        }
        val titleInput = input("Contoh: Bawa jas hujan", android.text.InputType.TYPE_CLASS_TEXT).apply {
            setSingleLine(true)
        }
        val categoryPicker = Spinner(this).apply {
            adapter = ArrayAdapter(
                this@MainActivity,
                android.R.layout.simple_spinner_dropdown_item,
                listOf("Perlengkapan", "Dokumen", "Kesehatan", "Perjalanan"),
            )
        }
        form.addView(fieldLabel("Persiapan baru"))
        form.addView(titleInput)
        form.addView(fieldLabel("Kategori"))
        form.addView(categoryPicker)
        val dialog = AlertDialog.Builder(this)
            .setTitle("Tambah checklist")
            .setView(form)
            .setNegativeButton("Batal", null)
            .setPositiveButton("Tambah", null)
            .create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val title = titleInput.text.toString().trim()
                if (title.length !in 2..100) {
                    titleInput.error = "Isi 2 sampai 100 karakter."
                    return@setOnClickListener
                }
                val category = categoryPicker.selectedItem?.toString() ?: "Perlengkapan"
                executor.execute {
                    try {
                        val response = ApiClient.request(
                            "/api/checklist",
                            "POST",
                            JSONObject().put("title", title).put("category", category),
                        )
                        ApiClient.requireSuccess(response)
                        runOnUiThread {
                            checklistLoaded = false
                            dialog.dismiss()
                            loadChecklist()
                        }
                    } catch (error: Exception) {
                        runOnUiThread { titleInput.error = error.localizedMessage ?: "Belum dapat disimpan." }
                    }
                }
            }
        }
        dialog.show()
    }

    private fun setChecklistDone(item: HikerChecklistItem, done: Boolean) {
        executor.execute {
            try {
                val response = ApiClient.request(
                    "/api/checklist",
                    "PATCH",
                    JSONObject().put("id", item.id).put("done", done),
                )
                ApiClient.requireSuccess(response)
                runOnUiThread {
                    val index = checklistItems.indexOfFirst { it.id == item.id }
                    if (index >= 0) checklistItems[index] = item.copy(done = done)
                    if (selectedDashboardTab == DashboardTab.CHECKLIST) renderHikerDashboard()
                }
            } catch (error: Exception) {
                runOnUiThread {
                    showMessage(error.localizedMessage ?: "Status checklist belum dapat disimpan.")
                    if (selectedDashboardTab == DashboardTab.CHECKLIST) renderHikerDashboard()
                }
            }
        }
    }

    private fun confirmDeleteChecklist(item: HikerChecklistItem) {
        AlertDialog.Builder(this)
            .setTitle("Hapus persiapan?")
            .setMessage(item.title)
            .setNegativeButton("Batal", null)
            .setPositiveButton("Hapus") { _, _ ->
                executor.execute {
                    try {
                        val response = ApiClient.request(
                            "/api/checklist",
                            "DELETE",
                            JSONObject().put("id", item.id),
                        )
                        ApiClient.requireSuccess(response)
                        runOnUiThread {
                            checklistItems.removeAll { it.id == item.id }
                            renderHikerDashboard()
                        }
                    } catch (error: Exception) {
                        runOnUiThread {
                            showMessage(error.localizedMessage ?: "Item checklist belum dapat dihapus.")
                        }
                    }
                }
            }
            .show()
    }

    private fun uploadDocument(uri: Uri) {
        executor.execute {
            try {
                val mimeType = contentResolver.getType(uri)
                    ?: throw IllegalStateException("Jenis dokumen tidak dapat dikenali.")
                if (mimeType !in setOf("application/pdf", "image/jpeg", "image/png")) {
                    throw IllegalArgumentException("Pilih file PDF, JPG, atau PNG.")
                }
                val fileName = contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                    val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (cursor.moveToFirst() && nameIndex >= 0) cursor.getString(nameIndex) else null
                }?.takeIf { it.isNotBlank() } ?: "dokumen"
                val input = contentResolver.openInputStream(uri)
                    ?: throw IllegalStateException("File tidak dapat dibaca.")
                val bytes = input.use { source ->
                    val output = ByteArrayOutputStream()
                    val buffer = ByteArray(8192)
                    var total = 0
                    while (true) {
                        val count = source.read(buffer)
                        if (count < 0) break
                        total += count
                        if (total > 3 * 1024 * 1024) {
                            throw IllegalArgumentException("Ukuran dokumen maksimal 3 MB.")
                        }
                        output.write(buffer, 0, count)
                    }
                    output.toByteArray()
                }
                if (bytes.isEmpty()) {
                    throw IllegalArgumentException("Ukuran dokumen harus antara 1 byte sampai 3 MB.")
                }
                val response = ApiClient.request(
                    "/api/documents",
                    "POST",
                    JSONObject()
                        .put("name", fileName.take(180))
                        .put("mimeType", mimeType)
                        .put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP)),
                )
                ApiClient.requireSuccess(response)
                runOnUiThread {
                    pageMessage = "Dokumen berhasil diunggah."
                    documentsLoaded = false
                    selectedDashboardTab = DashboardTab.DOCUMENTS
                    loadDocuments()
                    showMessage("Dokumen berhasil diunggah secara privat.")
                }
            } catch (error: Exception) {
                runOnUiThread {
                    showMessage(error.localizedMessage ?: "Dokumen belum dapat diunggah.")
                }
            }
        }
    }

    private fun downloadDocument(document: HikerDocument, destination: Uri) {
        executor.execute {
            try {
                val response = ApiClient.requestRaw(
                    "/api/documents/${Uri.encode(document.id)}",
                )
                if (response.status !in 200..299) {
                    val detail = runCatching { JSONObject(response.body.toString(Charsets.UTF_8)).optString("error") }
                        .getOrNull()
                        .orEmpty()
                    throw IllegalStateException(detail.ifBlank { "Dokumen belum dapat diunduh (${response.status})." })
                }
                if (response.body.isEmpty()) throw IllegalStateException("File yang diunduh kosong.")
                contentResolver.openOutputStream(destination, "w")?.use { it.write(response.body) }
                    ?: throw IllegalStateException("Lokasi penyimpanan tidak dapat dibuka.")
                runOnUiThread { showMessage("Dokumen ${document.fileName} berhasil disimpan.") }
            } catch (error: Exception) {
                runOnUiThread { showMessage(error.localizedMessage ?: "Dokumen belum dapat diunduh.") }
            }
        }
    }

    private fun confirmDeleteDocument(document: HikerDocument) {
        AlertDialog.Builder(this)
            .setTitle("Hapus dokumen?")
            .setMessage("File ${document.fileName} akan dihapus dari arsip privat.")
            .setNegativeButton("Batal", null)
            .setPositiveButton("Hapus") { _, _ ->
                executor.execute {
                    try {
                        val response = ApiClient.request(
                            "/api/documents/${Uri.encode(document.id)}",
                            "DELETE",
                        )
                        ApiClient.requireSuccess(response)
                        runOnUiThread {
                            documents.removeAll { it.id == document.id }
                            renderHikerDashboard()
                        }
                    } catch (error: Exception) {
                        runOnUiThread {
                            showMessage(error.localizedMessage ?: "Dokumen belum dapat dihapus.")
                        }
                    }
                }
            }
            .show()
    }

    private fun saveProfile(values: List<String>) {
        executor.execute {
            try {
                val response = ApiClient.request(
                    "/api/profile",
                    "PATCH",
                    JSONObject()
                        .put("fullName", values[0])
                        .put("phone", values[1])
                        .put("emergencyContactName", values[2])
                        .put("emergencyContactPhone", values[3]),
                )
                ApiClient.requireSuccess(response)
                val existing = hikerProfile
                runOnUiThread {
                    if (existing != null) {
                        hikerProfile = existing.copy(
                            fullName = values[0],
                            phone = values[1],
                            emergencyContactName = values[2],
                            emergencyContactPhone = values[3],
                        )
                    }
                    showMessage("Profil berhasil disimpan.")
                    renderHikerDashboard()
                }
            } catch (error: Exception) {
                runOnUiThread { showMessage(error.localizedMessage ?: "Profil belum dapat disimpan.") }
            }
        }
    }

    private fun requestPasswordReset() {
        executor.execute {
            try {
                val response = ApiClient.request("/api/profile/password-reset", "POST")
                ApiClient.requireSuccess(response)
                runOnUiThread {
                    showMessage("Tautan atur ulang sandi telah dikirim ke ${hikerProfile?.email.orEmpty()}.")
                }
            } catch (error: Exception) {
                runOnUiThread { showMessage(error.localizedMessage ?: "Tautan atur ulang sandi belum dapat dikirim.") }
            }
        }
    }

    private fun textButton(label: String, action: () -> Unit) = TextView(this).apply {
        text = label
        textSize = 13f
        gravity = Gravity.CENTER
        setTypeface(typeface, Typeface.BOLD)
        setTextColor(Color.rgb(39, 99, 71))
        setPadding(dp(10), dp(12), dp(10), dp(8))
        setOnClickListener { action() }
    }

    private fun showRegistrationDialog(mountain: HikerMountain, existingTrip: HikerTrip? = null) {
        val startDate = input("Tanggal mulai (YYYY-MM-DD)", android.text.InputType.TYPE_CLASS_DATETIME)
            .apply { setText(existingTrip?.startDate ?: LocalDate.now().plusDays(1).toString()) }
        val endDate = input("Tanggal selesai (YYYY-MM-DD)", android.text.InputType.TYPE_CLASS_DATETIME)
            .apply { setText(existingTrip?.endDate ?: LocalDate.now().plusDays(2).toString()) }
        fun attachDatePicker(field: EditText) {
            field.isFocusable = false
            field.isClickable = true
            field.setOnClickListener {
                val date = runCatching { LocalDate.parse(field.text.toString()) }
                    .getOrElse { LocalDate.now().plusDays(1) }
                DatePickerDialog(
                    this,
                    { _, year, month, day ->
                        field.setText(LocalDate.of(year, month + 1, day).format(DateTimeFormatter.ISO_LOCAL_DATE))
                    },
                    date.year,
                    date.monthValue - 1,
                    date.dayOfMonth,
                ).show()
            }
        }
        attachDatePicker(startDate)
        attachDatePicker(endDate)

        val groupSize = input("Jumlah pendaki", android.text.InputType.TYPE_CLASS_NUMBER)
            .apply { setText(existingTrip?.groupSize?.toString() ?: "1"); setSingleLine(true) }
        val emergencyName = input("Nama kontak darurat", android.text.InputType.TYPE_CLASS_TEXT)
            .apply {
                setText(existingTrip?.emergencyContactName ?: hikerProfile?.emergencyContactName.orEmpty())
                setSingleLine(true)
            }
        val emergencyPhone = input("Nomor kontak darurat", android.text.InputType.TYPE_CLASS_PHONE)
            .apply {
                setText(existingTrip?.emergencyContactPhone ?: hikerProfile?.emergencyContactPhone.orEmpty())
                setSingleLine(true)
            }
        val notes = input("Catatan tambahan (opsional)", android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE)
            .apply { minLines = 2; maxLines = 4; setText(existingTrip?.notes.orEmpty()) }
        val form = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), dp(8), dp(22), 0)
            addView(text("${mountain.name} · ${mountain.location}"))
            addView(fieldLabel("Tanggal mulai"))
            addView(startDate)
            addView(fieldLabel("Tanggal selesai"))
            addView(endDate)
            addView(fieldLabel("Jumlah pendaki (maksimal 20)"))
            addView(groupSize)
            addView(fieldLabel("Kontak darurat (wajib)"))
            addView(emergencyName)
            addView(fieldLabel("Nomor telepon kontak darurat"))
            addView(emergencyPhone)
            addView(fieldLabel("Catatan (opsional)"))
            addView(notes)
        }
        val dialog = AlertDialog.Builder(this)
            .setTitle(if (existingTrip == null) "Ajukan pendakian" else "Ubah pengajuan")
            .setView(ScrollView(this).apply { addView(form) })
            .setNegativeButton("Batal", null)
            .setPositiveButton(if (existingTrip == null) "Kirim pengajuan" else "Simpan perubahan", null)
            .create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val size = groupSize.text.toString().toIntOrNull()
                val start = startDate.text.toString()
                val end = endDate.text.toString()
                val contactName = emergencyName.text.toString().trim()
                val contactPhone = emergencyPhone.text.toString().trim()
                val note = notes.text.toString().trim()
                val validDates = runCatching {
                    val first = LocalDate.parse(start)
                    val last = LocalDate.parse(end)
                    !first.isBefore(LocalDate.now()) && !last.isBefore(first) &&
                        java.time.temporal.ChronoUnit.DAYS.between(first, last) <= 14
                }.getOrDefault(false)
                if (!validDates) {
                    showMessage("Tanggal harus valid, tidak lampau, dan rentang perjalanan maksimal 15 hari.")
                    return@setOnClickListener
                }
                if (size == null || size !in 1..20) {
                    groupSize.error = "Jumlah pendaki harus 1 sampai 20."
                    return@setOnClickListener
                }
                if (contactName.length !in 2..80 || contactPhone.length !in 6..32 || note.length > 500) {
                    showMessage("Lengkapi kontak darurat dengan benar. Catatan maksimal 500 karakter.")
                    return@setOnClickListener
                }
                val payload = JSONObject()
                    .put("mountainId", mountain.id)
                    .put("startDate", start)
                    .put("endDate", end)
                    .put("groupSize", size)
                    .put("emergencyContactName", contactName)
                    .put("emergencyContactPhone", contactPhone)
                    .put("notes", note)
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = false
                executor.execute {
                    try {
                        val path = existingTrip?.let {
                            "/api/registrations/${Uri.encode(it.id)}"
                        } ?: "/api/registrations"
                        val method = if (existingTrip == null) "POST" else "PATCH"
                        val response = ApiClient.request(path, method, payload)
                        ApiClient.requireSuccess(response)
                        runOnUiThread {
                            tripsLoaded = false
                            initialTripLoadAttempted = true
                            dialog.dismiss()
                            showMessage(
                                if (existingTrip == null) {
                                    "Pengajuan pendakian berhasil dikirim. Menunggu verifikasi pengelola."
                                } else {
                                    "Perubahan pengajuan berhasil dikirim untuk verifikasi."
                                },
                            )
                            loadTrips(text("Memuat pendakian…"))
                        }
                    } catch (error: Exception) {
                        runOnUiThread {
                            dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = true
                            showMessage(error.localizedMessage ?: "Pengajuan pendakian belum dapat dikirim.")
                        }
                    }
                }
            }
        }
        dialog.show()
    }

    private fun loadTrips(status: TextView) {
        if (tripsLoading) return
        tripsLoading = true
        tripsError = null
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
                        mountainId = item.optString("mountainId"),
                        groupSize = item.optInt("groupSize", 1),
                        emergencyContactName = item.optString("emergencyContactName"),
                        emergencyContactPhone = item.optString("emergencyContactPhone"),
                        notes = item.optString("notes"),
                    )
                }
                runOnUiThread {
                    trips.clear()
                    trips.addAll(loaded)
                    tripsLoaded = true
                    tripsLoading = false
                    tripsError = null
                    if (selectedTripId !in loaded.map { it.id }) {
                        selectedTripId = loaded.firstOrNull { it.status == "checked_in" }?.id
                            ?: loaded.firstOrNull()?.id
                    }
                    renderHikerDashboard()
                }
            } catch (error: Exception) {
                runOnUiThread {
                    tripsLoading = false
                    tripsError = error.localizedMessage ?: "Data pendakian gagal dimuat."
                    dashboardStatus?.text = tripsError
                    renderHikerDashboard()
                }
            }
        }
    }

    private fun confirmCancelTrip(trip: HikerTrip) {
        AlertDialog.Builder(this)
            .setTitle("Batalkan pendakian?")
            .setMessage("Pengajuan ke ${trip.mountainName} akan dibatalkan.")
            .setNegativeButton("Kembali", null)
            .setPositiveButton("Batalkan") { _, _ ->
                executor.execute {
                    try {
                        val response = ApiClient.request(
                            "/api/registrations/${Uri.encode(trip.id)}",
                            "DELETE",
                        )
                        ApiClient.requireSuccess(response)
                        runOnUiThread {
                            tripsLoaded = false
                            initialTripLoadAttempted = true
                            loadTrips(text("Memuat pendakian…"))
                        }
                    } catch (error: Exception) {
                        runOnUiThread {
                            showMessage(error.localizedMessage ?: "Pengajuan belum dapat dibatalkan.")
                        }
                    }
                }
            }
            .show()
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
