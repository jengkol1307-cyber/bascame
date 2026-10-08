package id.basecamp.pendaki

import android.app.Application
import org.maplibre.android.MapLibre

class BasecampApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        MapLibre.getInstance(this)
    }
}
