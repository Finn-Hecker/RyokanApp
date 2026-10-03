package io.ryokan.app

import android.net.Uri
import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
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
