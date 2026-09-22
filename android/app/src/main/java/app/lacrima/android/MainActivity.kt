package app.lacrima.android

import android.app.PictureInPictureParams
import android.os.Bundle
import android.util.Rational
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import app.lacrima.android.ui.LacrimaApp

class MainActivity : ComponentActivity() {
    private val model by lazy { AppModel(applicationContext) }
    private var immersive = false

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        /* Compose screens do not reliably hit the deprecated onBackPressed(). */
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (!model.back()) {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                        isEnabled = true
                    }
                }
            },
        )
        setContent {
            LacrimaApp(
                model = model,
                onFullscreenChanged = ::setFullscreen,
                onPictureInPictureRequested = ::enterVideoPictureInPicture,
            )
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus && immersive) applySystemBars(true)
    }

    private fun setFullscreen(fullscreen: Boolean) {
        immersive = fullscreen
        applySystemBars(fullscreen)
    }

    private fun applySystemBars(hide: Boolean) {
        WindowCompat.getInsetsController(window, window.decorView).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            if (hide) hide(WindowInsetsCompat.Type.systemBars())
            else show(WindowInsetsCompat.Type.systemBars())
        }
    }

    private fun enterVideoPictureInPicture() {
        enterPictureInPictureMode(
            PictureInPictureParams.Builder().setAspectRatio(Rational(16, 9)).build(),
        )
    }

    override fun onDestroy() {
        model.close()
        super.onDestroy()
    }
}
