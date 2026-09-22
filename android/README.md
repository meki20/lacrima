# Lacrima for Android

Native Android client for a self-hosted Lacrima server. The app is Kotlin + Jetpack Compose and
uses Media3 for playback; it does not embed the React site or contact metadata/source providers
directly.

## Build

Requirements: JDK 17 and an Android SDK containing platform 36.

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
.\gradlew.bat testDebugUnitTest assembleDebug
```

On macOS or Linux, set `ANDROID_HOME` to the installed SDK and run
`./gradlew testDebugUnitTest assembleDebug`. The debug APK is written beneath
`app/build/outputs/apk/debug/`.

## Connect

Run the Lacrima server normally, open the app, and enter either its HTTPS origin, for example
`https://lacrima.example.ts.net`, or a private LAN HTTP IP such as `http://192.168.1.224:7345`.
HTTP is deliberately limited to private IPv4 addresses and should never be used on a shared or
untrusted network. The client stores only the server address, selected profile, and
device-local reader choices. Library, progress, bindings, settings, sources, and stickers remain on
the server and are shared with the desktop client.

HTTPS remains the recommended route, including for a Tailscale deployment. The LAN HTTP route is
for trusted local networks only.

The client API is documented in `../app/api/v1/README.md`.
