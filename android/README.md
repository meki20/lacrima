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

## Cast to TV

Open a video and tap the Cast icon in the top bar. The TV fetches the video and selected subtitles
from the Lacrima server, so the TV must be on the same network and able to reach the server's LAN
HTTP address. Connect the Android app using that LAN address when casting; an Android-only
`localhost` address or a Tailscale-only hostname will not be reachable from a typical Chromecast.
Cast requires a Google Cast-compatible TV or Chromecast and Google Play services on the phone.

The web player also has a Cast icon. Chrome's one-click Cast sender requires the web page itself
to be opened over HTTPS, but the TV-reachable media address entered in the Cast menu may still be
the server's LAN HTTP origin. On a plain HTTP web page, use Chrome's Cast tab command to mirror
the player and its subtitles instead.

The client API is documented in `../app/api/v1/README.md`.
