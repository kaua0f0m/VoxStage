package app.voxstage.player

import android.os.Bundle
import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.webkit.WebView
import android.view.KeyEvent
import android.content.pm.ActivityInfo
import androidx.core.app.ActivityCompat
import androidx.activity.enableEdgeToEdge
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    if (VoxStageMediaControls.isTelevision(this)) {
      requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
      onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() { VoxStageMediaControls.tvKey("Back") }
      })
    }
    YtDlpBridge.attachContext(applicationContext)
    if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
      ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4201)
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    VoxStageMediaControls.attach(this, webView)
    if (VoxStageMediaControls.isTelevision(this)) { webView.isFocusableInTouchMode = true; webView.requestFocus() }
  }

  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (VoxStageMediaControls.isTelevision(this)) {
      val key = when (event.keyCode) {
        KeyEvent.KEYCODE_DPAD_UP -> "ArrowUp"
        KeyEvent.KEYCODE_DPAD_DOWN -> "ArrowDown"
        KeyEvent.KEYCODE_DPAD_LEFT -> "ArrowLeft"
        KeyEvent.KEYCODE_DPAD_RIGHT -> "ArrowRight"
        KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> "Enter"
        KeyEvent.KEYCODE_BACK -> "Back"
        else -> null
      }
      // Text input and the on-screen keyboard keep Android's own key handling.
      val keyboardShown = ViewCompat.getRootWindowInsets(window.decorView)?.isVisible(WindowInsetsCompat.Type.ime()) == true
      if (key != null && !keyboardShown) {
        if (event.action == KeyEvent.ACTION_DOWN && (event.repeatCount == 0 || key.startsWith("Arrow"))) VoxStageMediaControls.tvKey(key)
        return true
      }
    }
    return super.dispatchKeyEvent(event)
  }

  override fun onDestroy() {
    VoxStageMediaControls.detach(this)
    super.onDestroy()
  }
}
