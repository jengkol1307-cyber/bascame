# Basecamp Pendaki Android

The Android app is a Kotlin native companion to the Basecamp web dashboard. Its native hiker workspace includes trip summaries and applications, public mountain information, a personal checklist, private document upload/download, public announcements, profile and emergency-contact editing, Firebase password-reset requests, and checked-in trip selection. It also provides background location tracking with a local upload queue, SOS submission with a stable retry ID, and a MapLibre offline-area download screen.

Authenticated Android API calls use the Firebase ID token. The corresponding API routes accept either that bearer token or the existing web session cookie, so the native app does not need to persist a web session cookie.

## Local setup

1. Install Android Studio with Android SDK Platform 35 and a Java 17 JDK.
2. Register an Android app with package name `id.basecamp.pendaki` in the same Firebase project used by the web application. Enable the Firebase Authentication sign-in method used by pendaki accounts and download its `google-services.json` into `android/app/`. Do not commit this file.
3. Create `android/local.properties` and set local values. Keep this file out of version control:

   ```properties
   sdk.dir=C:\\Users\\you\\AppData\\Local\\Android\\Sdk
   API_BASE_URL=http://10.0.2.2:3000
   MAPTILER_API_KEY=your-public-restricted-map-key
   ```

   `10.0.2.2` is the Android emulator alias for the host computer. For a device or release build, set `API_BASE_URL` to the deployed Basecamp HTTPS origin. Release builds disable cleartext HTTP; debug builds allow it for the local emulator.
4. Open the `android` folder in Android Studio and allow Gradle to sync. Build and run the `app` debug configuration.

Do not put service-account credentials or private server keys in the Android app. `MAPTILER_API_KEY` is necessarily shipped in the client; restrict it in the MapTiler account to the intended application and usage.

## Location and SOS behavior

Location tracking is only available for a trip whose server status is `checked_in`. Android requires foreground location permission and, for background updates, the user must grant background location access. On Android 11 and newer the app opens system settings so the user can explicitly choose “Allow all the time.” A persistent foreground-service notification provides a stop action.

The app requests automatic location updates at an approximate 30-minute interval. Android may defer or batch updates due to battery, device, and operating-system policies; this is not a guaranteed schedule. On the Safety tab, the hiker can also tap “Kirim titik lokasi sekarang” to capture and queue a fresh GPS point without waiting for the automatic interval. Captured points and SOS requests are persisted locally before upload and remain in the outbox when upload fails. SOS is prioritized, and the UI does not report server confirmation until the request leaves the local queue. Active SOS updates are published to Firebase Realtime Database for fast Basecamp visibility; Firestore retains the permanent incident history.

## Offline maps

The current download UI creates a MapLibre tile-pyramid region centered on the configured mountain coordinates, with a 500 m radius and zoom levels 9–13. Map downloads require network access, device storage, and a MapTiler plan/license that explicitly permits offline caching and the intended volume of tile downloads. Confirm those terms and quotas before distributing the app; the app cannot override provider limits. Offline coverage is limited to that downloaded area and is not a substitute for an official trail map or navigation safety plan.

Mountain latitude and longitude must be configured in the web Basecamp mountain information for the app to center the map. The map key must be configured locally and must be restricted; never commit real keys.
