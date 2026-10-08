package id.basecamp.pendaki

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority

class LocationTrackingService : Service() {
    private lateinit var locationClient: FusedLocationProviderClient
    private lateinit var locationCallback: LocationCallback
    private var registrationId: String = ""

    override fun onCreate() {
        super.onCreate()
        locationClient = LocationServices.getFusedLocationProviderClient(this)
        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                val tripId = registrationId
                if (tripId.isBlank()) return
                val database = TrackingDatabase.get(this@LocationTrackingService)
                result.locations.forEach { location ->
                    database.savePoint(
                        QueuedPoint(
                            registrationId = tripId,
                            latitude = location.latitude,
                            longitude = location.longitude,
                            accuracy = location.accuracy,
                            capturedAt = location.time,
                        ),
                    )
                }
                LocationUploadWorker.ensurePeriodic(this@LocationTrackingService)
                refreshNotification()
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopTracking()
            return START_NOT_STICKY
        }
        registrationId = intent?.getStringExtra(EXTRA_REGISTRATION_ID)
            ?: getSharedPreferences(PREFERENCES, MODE_PRIVATE)
                .getString(PREFERENCE_REGISTRATION_ID, "")
                .orEmpty()
        if (registrationId.isBlank()) {
            stopSelf()
            return START_NOT_STICKY
        }
        getSharedPreferences(PREFERENCES, MODE_PRIVATE).edit()
            .putString(PREFERENCE_REGISTRATION_ID, registrationId)
            .apply()
        startForeground(NOTIFICATION_ID, notification())
        beginTracking()
        LocationUploadWorker.ensurePeriodic(this)
        return START_STICKY
    }

    private fun beginTracking() {
        val hasFineLocation = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
        val hasCoarseLocation = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
        if (!hasFineLocation && !hasCoarseLocation) {
            Log.e(TAG, "Pelacakan dihentikan karena izin lokasi foreground tidak tersedia.")
            stopTracking()
            return
        }
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.ACCESS_BACKGROUND_LOCATION,
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            Log.e(TAG, "Pelacakan dihentikan karena izin lokasi latar belakang tidak tersedia.")
            stopTracking()
            return
        }
        val request = LocationRequest.Builder(
            Priority.PRIORITY_BALANCED_POWER_ACCURACY,
            LOCATION_INTERVAL_MS,
        )
            .setMinUpdateIntervalMillis(LOCATION_INTERVAL_MS)
            .setMaxUpdateDelayMillis(LOCATION_INTERVAL_MS)
            .setWaitForAccurateLocation(false)
            .build()
        try {
            locationClient.requestLocationUpdates(request, locationCallback, mainLooper)
        } catch (error: SecurityException) {
            Log.e(TAG, "Tidak dapat memulai pembaruan lokasi.", error)
            stopTracking()
        }
    }

    private fun notification(): Notification {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Keselamatan pendakian",
            NotificationManager.IMPORTANCE_LOW,
        )
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        val stopIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, LocationTrackingService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("Pelacakan pendakian aktif")
            .setContentText("Sinyal GPS disimpan dan dikirim saat jaringan tersedia.")
            .setOngoing(true)
            .addAction(0, "Hentikan", stopIntent)
            .build()
    }

    private fun refreshNotification() {
        val queued = TrackingDatabase.get(this).queuedPointCount()
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(
            NOTIFICATION_ID,
            NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setContentTitle("Pelacakan pendakian aktif")
                .setContentText(if (queued == 0) "Lokasi terekam." else "$queued sinyal menunggu jaringan.")
                .setOngoing(true)
                .build(),
        )
    }

    private fun stopTracking() {
        if (::locationClient.isInitialized && ::locationCallback.isInitialized) {
            locationClient.removeLocationUpdates(locationCallback)
        }
        getSharedPreferences(PREFERENCES, MODE_PRIVATE).edit()
            .remove(PREFERENCE_REGISTRATION_ID)
            .apply()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val TAG = "LocationTrackingService"
        const val ACTION_STOP = "id.basecamp.pendaki.STOP_TRACKING"
        const val EXTRA_REGISTRATION_ID = "registrationId"
        const val UPLOAD_WORK = "basecamp-location-upload"
        const val LOCATION_INTERVAL_MS = 30L * 60L * 1000L
        const val NOTIFICATION_ID = 4301
        const val CHANNEL_ID = "hiker-location-tracking"
        const val PREFERENCES = "tracking-state"
        const val PREFERENCE_REGISTRATION_ID = "registration-id"
    }
}
