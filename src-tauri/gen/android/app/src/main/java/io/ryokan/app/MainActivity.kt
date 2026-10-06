package io.ryokan.app

import android.net.Uri
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.annotation.Keep

// Rust/Tauri resolves Activity bridge methods by name through JNI.
// Keep the class and its members, including future custom bridge methods.
@Keep
class MainActivity : TauriActivity() {
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    // Keep the Android app at its intended scale, including during pinch gestures.
    webView.settings.apply {
      setSupportZoom(false)
      builtInZoomControls = false
      displayZoomControls = false
    }
  }

  // The document picker grants access through a content URI, not a filesystem path.
  fun writeExportDocument(uri: String, bytes: ByteArray) {
    val output = contentResolver.openOutputStream(Uri.parse(uri), "wt")
      ?: throw java.io.IOException("Unable to open export document")
    output.use { it.write(bytes) }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }
}
