package id.basecamp.pendaki

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONObject

data class QueuedPoint(
    val registrationId: String,
    val latitude: Double,
    val longitude: Double,
    val accuracy: Float,
    val capturedAt: Long,
)

data class QueuedSos(
    val id: String,
    val registrationId: String,
    val body: String,
)

class TrackingDatabase private constructor(context: Context) :
    SQLiteOpenHelper(context.applicationContext, "tracking-outbox.db", null, 1) {

    override fun onCreate(database: SQLiteDatabase) {
        database.execSQL(
            """CREATE TABLE queued_points (
                registration_id TEXT NOT NULL,
                captured_at INTEGER NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                accuracy REAL NOT NULL,
                PRIMARY KEY (registration_id, captured_at)
            )""".trimIndent(),
        )
        database.execSQL(
            """CREATE TABLE queued_sos (
                id TEXT PRIMARY KEY NOT NULL,
                registration_id TEXT NOT NULL,
                body TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )""".trimIndent(),
        )
    }

    override fun onUpgrade(database: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    @Synchronized
    fun savePoint(point: QueuedPoint) {
        val values = ContentValues().apply {
            put("registration_id", point.registrationId)
            put("captured_at", point.capturedAt)
            put("latitude", point.latitude)
            put("longitude", point.longitude)
            put("accuracy", point.accuracy)
        }
        writableDatabase.insertWithOnConflict(
            "queued_points",
            null,
            values,
            SQLiteDatabase.CONFLICT_IGNORE,
        )
    }

    @Synchronized
    fun nextPointBatch(): List<QueuedPoint> {
        val result = ArrayList<QueuedPoint>(100)
        readableDatabase.rawQuery(
            """SELECT registration_id, captured_at, latitude, longitude, accuracy
                FROM queued_points
                WHERE registration_id = (
                    SELECT registration_id FROM queued_points ORDER BY captured_at ASC LIMIT 1
                )
                ORDER BY captured_at ASC
                LIMIT 100""".trimIndent(),
            null,
        ).use { cursor ->
            while (cursor.moveToNext()) {
                result.add(
                    QueuedPoint(
                        registrationId = cursor.getString(0),
                        capturedAt = cursor.getLong(1),
                        latitude = cursor.getDouble(2),
                        longitude = cursor.getDouble(3),
                        accuracy = cursor.getFloat(4),
                    ),
                )
            }
        }
        return result
    }

    @Synchronized
    fun deletePoints(points: List<QueuedPoint>) {
        val database = writableDatabase
        database.beginTransaction()
        try {
            points.forEach { point ->
                database.delete(
                    "queued_points",
                    "registration_id = ? AND captured_at = ?",
                    arrayOf(point.registrationId, point.capturedAt.toString()),
                )
            }
            database.setTransactionSuccessful()
        } finally {
            database.endTransaction()
        }
    }

    @Synchronized
    fun queuedPointCount(): Int =
        readableDatabase.rawQuery("SELECT COUNT(*) FROM queued_points", null).use { cursor ->
            if (cursor.moveToFirst()) cursor.getInt(0) else 0
        }

    @Synchronized
    fun saveSos(sos: QueuedSos): Boolean {
        val values = ContentValues().apply {
            put("id", sos.id)
            put("registration_id", sos.registrationId)
            put("body", sos.body)
            put("created_at", System.currentTimeMillis())
        }
        val insertedRow = writableDatabase.insertWithOnConflict(
            "queued_sos",
            null,
            values,
            SQLiteDatabase.CONFLICT_IGNORE,
        )
        return insertedRow != -1L
    }

    @Synchronized
    fun updateSosBody(id: String, body: String): Boolean {
        val values = ContentValues().apply { put("body", body) }
        return writableDatabase.update(
            "queued_sos",
            values,
            "id = ?",
            arrayOf(id),
        ) > 0
    }

    @Synchronized
    fun nextSos(): QueuedSos? =
        readableDatabase.rawQuery(
            "SELECT id, registration_id, body FROM queued_sos ORDER BY created_at ASC LIMIT 1",
            null,
        ).use { cursor ->
            if (!cursor.moveToFirst()) null
            else QueuedSos(cursor.getString(0), cursor.getString(1), cursor.getString(2))
        }

    @Synchronized
    fun deleteSos(id: String) {
        writableDatabase.delete("queued_sos", "id = ?", arrayOf(id))
    }

    @Synchronized
    fun queuedSosCount(): Int =
        readableDatabase.rawQuery("SELECT COUNT(*) FROM queued_sos", null).use { cursor ->
            if (cursor.moveToFirst()) cursor.getInt(0) else 0
        }

    companion object {
        @Volatile
        private var instance: TrackingDatabase? = null

        fun get(context: Context): TrackingDatabase =
            instance ?: synchronized(this) {
                instance ?: TrackingDatabase(context).also { instance = it }
            }
    }
}
