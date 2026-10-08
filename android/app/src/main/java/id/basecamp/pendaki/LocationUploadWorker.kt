package id.basecamp.pendaki

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkerParameters
import androidx.work.WorkManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

class LocationUploadWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val database = TrackingDatabase.get(applicationContext)
        try {
            val queuedSos = database.nextSos()
            if (queuedSos != null) {
                val response = ApiClient.request(
                    "/api/sos",
                    method = "POST",
                    body = queuedSosBody(queuedSos.body),
                )
                ApiClient.requireSuccess(response)
                database.deleteSos(queuedSos.id)
            }

            val points = database.nextPointBatch()
            if (points.isNotEmpty()) {
                val response = ApiClient.request(
                    "/api/tracking",
                    method = "POST",
                    body = locationPointBody(points),
                )
                ApiClient.requireSuccess(response)
                database.deletePoints(points)
            }
            Result.success()
        } catch (error: Exception) {
            Log.e(TAG, "Upload belum berhasil; data tetap disimpan di antrean lokal.", error)
            Result.retry()
        }
    }

    companion object {
        private const val TAG = "LocationUploadWorker"

        private fun networkConstraints() = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        fun enqueueNow(context: Context) {
            val request = OneTimeWorkRequestBuilder<LocationUploadWorker>()
                .setConstraints(networkConstraints())
                .setBackoffCriteria(
                    androidx.work.BackoffPolicy.EXPONENTIAL,
                    30,
                    TimeUnit.SECONDS,
                )
                .build()
            WorkManager.getInstance(context).enqueue(request)
        }

        fun ensurePeriodic(context: Context) {
            val request = PeriodicWorkRequestBuilder<LocationUploadWorker>(15, TimeUnit.MINUTES)
                .setConstraints(networkConstraints())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                LocationTrackingService.UPLOAD_WORK,
                ExistingPeriodicWorkPolicy.KEEP,
                request,
            )
        }
    }
}
