package id.basecamp.pendaki

import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.google.firebase.auth.FirebaseAuth
import java.util.concurrent.Executors

class AdminDashboardActivity : AppCompatActivity() {
    companion object {
        const val EXTRA_ROLE = "role"
        const val EXTRA_FORCE_SESSION = "force_web_session"
    }

    private val executor = Executors.newSingleThreadExecutor()
    private val role: String by lazy { intent.getStringExtra(EXTRA_ROLE).orEmpty() }
    private val apiBaseUrl by lazy { BuildConfig.API_BASE_URL.trimEnd('/') }
    private val sessionPreferences by lazy {
        getSharedPreferences("basecamp_web_session", MODE_PRIVATE)
    }
    private lateinit var webView: WebView
    private lateinit var overlay: LinearLayout
    private lateinit var menuButton: TextView
    private var redirectingToLogin = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val user = FirebaseAuth.getInstance().currentUser
        if (
            user == null ||
            role !in setOf(
                "admin", "superadmin", "basecamp_admin", "registration_operator",
                "treasurer", "field_officer", "information_manager",
            )
        ) {
            FirebaseAuth.getInstance().signOut()
            finish()
            return
        }

        renderWebView()
        val previousUid = sessionPreferences.getString("uid", null)
        val hasWebCookie = CookieManager.getInstance()
            .getCookie(apiBaseUrl)
            .orEmpty()
            .split(";")
            .any { it.trim().startsWith("__session=") }
        val forceSession = intent.getBooleanExtra(EXTRA_FORCE_SESSION, false)
        if (forceSession || !hasWebCookie || previousUid != user.uid) {
            createWebSession(user.uid)
        } else {
            openDashboard()
        }
    }

    override fun onDestroy() {
        executor.shutdown()
        webView.stopLoading()
        webView.destroy()
        super.onDestroy()
    }

    private fun renderWebView() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (::webView.isInitialized && webView.canGoBack()) {
                    webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })
        CookieManager.getInstance().setAcceptCookie(true)
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.setSupportMultipleWindows(false)
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest,
                ): Boolean {
                    val destination = request.url
                    if (!request.isForMainFrame) return false
                    val appHost = Uri.parse(apiBaseUrl).host
                    if (destination.host == appHost && destination.path == "/api/auth/logout") {
                        returnToNativeLogin()
                        return true
                    }
                    if (destination.host != appHost) {
                        startActivity(Intent(Intent.ACTION_VIEW, destination))
                        return true
                    }
                    if (destination.path == "/login") {
                        returnToNativeLogin()
                        return true
                    }
                    return false
                }

                override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
                    super.doUpdateVisitedHistory(view, url, isReload)
                    if (Uri.parse(url).path == "/login") returnToNativeLogin()
                }

                override fun onReceivedError(
                    view: WebView,
                    request: WebResourceRequest,
                    error: android.webkit.WebResourceError,
                ) {
                    super.onReceivedError(view, request, error)
                    if (request.isForMainFrame) {
                        showMessage(
                            error.description?.toString()
                                ?: "Dashboard tidak dapat dimuat. Periksa koneksi lalu coba lagi.",
                            retry = true,
                        )
                    }
                }
            }
        }

        overlay = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(28), dp(28), dp(28), dp(28))
            setBackgroundColor(Color.rgb(247, 249, 246))
        }
        menuButton = TextView(this).apply {
            text = "\u2630"
            textSize = 22f
            gravity = Gravity.CENTER
            setTextColor(Color.rgb(40, 90, 70))
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = dp(11).toFloat()
                setColor(Color.WHITE)
                setStroke(dp(1), Color.rgb(220, 230, 221))
            }
            elevation = dp(6).toFloat()
            contentDescription = "Buka atau tutup navigasi"
            setOnClickListener { toggleWebDrawer() }
        }
        val root = FrameLayout(this).apply {
            addView(webView, FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ))
            addView(this@AdminDashboardActivity.overlay)
            this@AdminDashboardActivity.overlay.layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            addView(menuButton, FrameLayout.LayoutParams(dp(46), dp(46)).apply {
                gravity = Gravity.TOP or Gravity.START
                leftMargin = dp(12)
                topMargin = dp(12)
            })
        }
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        setContentView(root)
        ViewCompat.requestApplyInsets(root)
        showMessage("Menyiapkan dashboard…")
    }

    private fun toggleWebDrawer() {
        if (!::webView.isInitialized) return
        webView.evaluateJavascript(
            """(() => {
                const input = document.querySelector('.sidebar-drawer-state');
                const drawer = document.querySelector('#dashboard-sidebar-drawer');
                const backdrop = document.querySelector('.sidebar-drawer-backdrop');
                if (!drawer) return 'missing';
                const updateDrawer = (open) => {
                    drawer.style.transform = open ? 'translateX(0)' : 'translateX(-105%)';
                    drawer.style.visibility = open ? 'visible' : 'hidden';
                    drawer.style.transitionDelay = '0s';
                    if (backdrop) backdrop.style.display = open ? 'block' : 'none';
                };
                if (input && !input.dataset.nativeDrawerSync) {
                    input.addEventListener('change', () => updateDrawer(input.checked));
                    input.dataset.nativeDrawerSync = 'true';
                }
                const open = input ? !input.checked : !drawer.classList.contains('is-open');
                if (input) {
                    input.checked = open;
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                } else {
                    updateDrawer(open);
                }
                return open ? 'open' : 'closed';
            })()""",
        ) { }
    }

    private fun createWebSession(uid: String) {
        showMessage("Mengamankan sesi dashboard…")
        executor.execute {
            try {
                val cookie = ApiClient.createWebSessionCookie()
                runOnUiThread {
                    if (isFinishing || isDestroyed) return@runOnUiThread
                    CookieManager.getInstance().setCookie(apiBaseUrl, cookie) { accepted ->
                        if (isFinishing || isDestroyed) return@setCookie
                        if (!accepted) {
                            showMessage("Sesi web tidak dapat disimpan di perangkat.")
                            return@setCookie
                        }
                        CookieManager.getInstance().flush()
                        sessionPreferences.edit().putString("uid", uid).apply()
                        openDashboard()
                    }
                }
            } catch (error: Exception) {
                runOnUiThread {
                    if (!isFinishing && !isDestroyed) {
                        if (error is WebSessionAuthenticationException) {
                            returnToNativeLogin()
                        } else {
                            showMessage(
                                error.localizedMessage
                                    ?: "Sesi dashboard belum dapat disiapkan. Silakan masuk kembali.",
                                retry = true,
                            )
                        }
                    }
                }
            }
        }
    }

    private fun openDashboard() {
        val path = if (role == "superadmin") "/dashboard/superadmin" else "/dashboard/admin"
        overlay.visibility = android.view.View.GONE
        webView.loadUrl("$apiBaseUrl$path")
    }

    private fun showMessage(message: String, retry: Boolean = false) {
        overlay.removeAllViews()
        overlay.addView(TextView(this).apply {
            text = message
            textSize = 15f
            gravity = Gravity.CENTER
            setTextColor(Color.rgb(55, 73, 59))
        }, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        ))
        if (retry) {
            overlay.addView(Button(this).apply {
                text = "Coba lagi"
                setOnClickListener {
                    val uid = FirebaseAuth.getInstance().currentUser?.uid
                    if (uid == null) returnToNativeLogin() else createWebSession(uid)
                }
            }, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply {
                gravity = Gravity.CENTER
                topMargin = dp(18)
            })
            overlay.addView(Button(this).apply {
                text = "Masuk kembali"
                setOnClickListener { returnToNativeLogin() }
            }, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply {
                gravity = Gravity.CENTER
                topMargin = dp(8)
            })
        }
        overlay.visibility = android.view.View.VISIBLE
    }

    private fun returnToNativeLogin() {
        if (redirectingToLogin) return
        redirectingToLogin = true
        FirebaseAuth.getInstance().signOut()
        sessionPreferences.edit().remove("uid").apply()
        CookieManager.getInstance().removeAllCookies {
            CookieManager.getInstance().flush()
            runOnUiThread {
                startActivity(
                    Intent(this, MainActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK),
                )
                finish()
            }
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
