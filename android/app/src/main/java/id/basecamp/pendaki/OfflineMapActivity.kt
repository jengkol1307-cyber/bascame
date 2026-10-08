package id.basecamp.pendaki

import android.graphics.Color
import android.os.Bundle
import android.util.Log
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapView
import org.maplibre.android.offline.OfflineManager
import org.maplibre.android.offline.OfflineRegion
import org.maplibre.android.offline.OfflineRegionError
import org.maplibre.android.offline.OfflineRegionStatus
import org.maplibre.android.offline.OfflineTilePyramidRegionDefinition

class OfflineMapActivity : AppCompatActivity() {
    private lateinit var mapView: MapView
    private lateinit var status: TextView
    private var latitude = Double.NaN
    private var longitude = Double.NaN
    private val styleUrl: String
        get() = "https://api.maptiler.com/maps/outdoor-v2/style.json?key=${BuildConfig.MAPTILER_API_KEY}"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        latitude = intent.getDoubleExtra(EXTRA_LATITUDE, Double.NaN)
        longitude = intent.getDoubleExtra(EXTRA_LONGITUDE, Double.NaN)
        val mountainName = intent.getStringExtra(EXTRA_MOUNTAIN_NAME).orEmpty()

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(247, 249, 246))
            setPadding(dp(16), dp(12), dp(16), dp(12))
        }
        content.addView(TextView(this).apply {
            text = "Peta offline — $mountainName"
            textSize = 21f
            setTextColor(Color.rgb(31, 63, 48))
        })
        status = TextView(this).apply {
            textSize = 14f
            setTextColor(Color.rgb(62, 73, 65))
            text = "Unduh area beradius 500 m, zoom 9–13. Kebutuhan jaringan dan penyimpanan bergantung pada gaya peta."
            setPadding(0, dp(8), 0, dp(8))
        }
        content.addView(status)
        content.addView(Button(this).apply {
            text = "Unduh area sekitar gunung"
            isAllCaps = false
            setOnClickListener { downloadArea(mountainName) }
        })
        content.addView(Button(this).apply {
            text = "Periksa paket offline"
            isAllCaps = false
            setOnClickListener { listOfflineRegions() }
        })

        mapView = MapView(this)
        content.addView(
            mapView,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f,
            ),
        )
        setContentView(content)
        mapView.onCreate(savedInstanceState)
        if (isValidCenter()) {
            mapView.getMapAsync { map ->
                map.cameraPosition = CameraPosition.Builder()
                    .target(LatLng(latitude, longitude))
                    .zoom(11.0)
                    .build()
                if (BuildConfig.MAPTILER_API_KEY.isNotBlank()) {
                    map.setStyle(styleUrl)
                }
            }
        } else {
            status.text = "Koordinat pusat gunung belum diisi. Pengelola perlu melengkapi latitude dan longitude di informasi gunung."
        }
        if (BuildConfig.MAPTILER_API_KEY.isBlank()) {
            status.text = "MAPTILER_API_KEY belum dikonfigurasi. Atur kunci lokal sebelum membuka atau mengunduh peta."
        }
    }

    private fun downloadArea(mountainName: String) {
        if (!isValidCenter()) {
            status.text = "Koordinat pusat gunung tidak tersedia."
            return
        }
        if (BuildConfig.MAPTILER_API_KEY.isBlank()) {
            status.text = "Peta belum dikonfigurasi: isi MAPTILER_API_KEY di android/local.properties."
            return
        }
        status.text = "Menyiapkan unduhan peta…"
        val radiusMeters = 500.0
        val latitudeDelta = radiusMeters / 111_320.0
        val longitudeDelta = radiusMeters / (111_320.0 * kotlin.math.cos(Math.toRadians(latitude)).coerceAtLeast(0.1))
        val bounds = LatLngBounds.from(
            (latitude + latitudeDelta).coerceAtMost(85.0),
            (longitude + longitudeDelta).coerceIn(-180.0, 180.0),
            (latitude - latitudeDelta).coerceAtLeast(-85.0),
            (longitude - longitudeDelta).coerceIn(-180.0, 180.0),
        )
        val definition = OfflineTilePyramidRegionDefinition(
            styleUrl,
            bounds,
            MIN_ZOOM,
            MAX_ZOOM,
            resources.displayMetrics.density,
        )
        val metadata = JSONObject()
            .put("name", mountainName)
            .put("createdAt", System.currentTimeMillis())
            .toString()
            .toByteArray(Charsets.UTF_8)

        OfflineManager.getInstance(this).createOfflineRegion(
            definition,
            metadata,
            object : OfflineManager.CreateOfflineRegionCallback {
                override fun onCreate(region: OfflineRegion) {
                    region.setObserver(object : OfflineRegion.OfflineRegionObserver {
                        override fun onStatusChanged(regionStatus: OfflineRegionStatus) {
                            runOnUiThread {
                                val required = regionStatus.requiredResourceCount
                                val completed = regionStatus.completedResourceCount
                                status.text = if (required > 0) {
                                    "Unduhan peta: $completed dari $required sumber daya."
                                } else {
                                    "Mengunduh sumber daya peta offline…"
                                }
                            }
                        }

                        override fun onError(error: OfflineRegionError) {
                            runOnUiThread {
                                status.text = "Unduhan peta gagal: ${error.message}"
                            }
                        }

                        override fun mapboxTileCountLimitExceeded(limit: Long) {
                            runOnUiThread {
                                status.text = "Batas unduhan provider tercapai ($limit tile). Periksa paket dan lisensi MapTiler."
                            }
                        }
                    })
                    runOnUiThread {
                        status.text = "Unduhan dimulai. Biarkan aplikasi terbuka sampai peta selesai disimpan."
                    }
                    region.setDownloadState(OfflineRegion.STATE_ACTIVE)
                }

                override fun onError(error: String) {
                    runOnUiThread { status.text = "Tidak dapat membuat paket offline: $error" }
                }
            },
        )
    }

    private fun listOfflineRegions() {
        OfflineManager.getInstance(this)
            .listOfflineRegions(object : OfflineManager.ListOfflineRegionsCallback {
                override fun onList(regions: Array<OfflineRegion>?) {
                    val packageNames = regions.orEmpty().map { region ->
                        try {
                            JSONObject(String(region.metadata, Charsets.UTF_8))
                                .optString("name")
                                .ifBlank { "Paket offline tanpa nama" }
                        } catch (error: Exception) {
                            Log.w(TAG, "Metadata paket offline tidak dapat dibaca.", error)
                            "Paket offline tidak dikenal"
                        }
                    }
                    runOnUiThread {
                        status.text = if (packageNames.isEmpty()) {
                            "Belum ada paket peta offline di perangkat."
                        } else {
                            "Paket offline (${packageNames.size}): ${packageNames.joinToString()}"
                        }
                    }
                }

                override fun onError(error: String) {
                    runOnUiThread { status.text = "Daftar paket offline gagal dimuat: $error" }
                }
            })
    }

    private fun isValidCenter(): Boolean =
        latitude.isFinite() && longitude.isFinite() &&
            latitude in -85.0..85.0 && longitude in -180.0..180.0

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    override fun onStart() {
        super.onStart()
        mapView.onStart()
    }

    override fun onResume() {
        super.onResume()
        mapView.onResume()
    }

    override fun onPause() {
        mapView.onPause()
        super.onPause()
    }

    override fun onStop() {
        mapView.onStop()
        super.onStop()
    }

    override fun onLowMemory() {
        super.onLowMemory()
        mapView.onLowMemory()
    }

    override fun onDestroy() {
        mapView.onDestroy()
        super.onDestroy()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        mapView.onSaveInstanceState(outState)
        super.onSaveInstanceState(outState)
    }

    companion object {
        private const val TAG = "OfflineMapActivity"
        const val EXTRA_MOUNTAIN_NAME = "mountainName"
        const val EXTRA_LATITUDE = "mountainLatitude"
        const val EXTRA_LONGITUDE = "mountainLongitude"
        private const val MIN_ZOOM = 9.0
        private const val MAX_ZOOM = 13.0
    }
}
