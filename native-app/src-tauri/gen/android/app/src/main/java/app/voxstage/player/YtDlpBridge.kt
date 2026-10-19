package app.voxstage.player

import android.content.Context
import com.chaquo.python.Python
import dev.ffmpegkit_maintained.ytdlp.YtDlp
import org.json.JSONObject
import java.io.File

/** Runs on Rust workers. The dependency's CLI adapter discards extraction results;
 * call our Python module and exchange structured JSON instead of stdout. */
object YtDlpBridge {
  @Volatile private var appContext: Context? = null
  @Volatile private var initialized = false
  @JvmStatic fun attachContext(context: Context) { appContext = context.applicationContext }
  @JvmStatic fun notifyJob(payload: String): String {
    val job = JSONObject(payload)
    val finished = job.optString("stage") in listOf("done", "error", "missing")
    VoxStageMediaControls.updateJobNotification(job.optString("title"), job.optString("message"), finished)
    return "{}"
  }
  @Synchronized private fun ensureInitialized() {
    if (initialized) return
    val context = appContext ?: error("O motor de downloads ainda não foi iniciado.")
    YtDlp.init(context)
    val directory = File(context.filesDir, "voxstage-python")
    check(directory.isDirectory || directory.mkdirs()) { "Não consegui preparar o motor de downloads." }
    val ytDlpBundle = File(directory, "yt-dlp-runtime.zip")
    // Replace on upgrade as the archive also contains the challenge solver.
    context.assets.open(ytDlpBundle.name).use { source ->
      ytDlpBundle.outputStream().use { source.copyTo(it) }
    }
    context.assets.open("voxstage_youtube.py").use { source ->
      File(directory, "voxstage_youtube.py").outputStream().use { source.copyTo(it) }
    }
    context.assets.open("youtube_support.py").use { source ->
      File(directory, "youtube_support.py").outputStream().use { source.copyTo(it) }
    }
    context.assets.open("cover_art.py").use { source ->
      File(directory, "cover_art.py").outputStream().use { source.copyTo(it) }
    }
    val pythonPath = Python.getInstance().getModule("sys").get("path")!!
    pythonPath.callAttr("insert", 0, directory.absolutePath)
    pythonPath.callAttr("insert", 0, ytDlpBundle.absolutePath)
    Python.getInstance().getModule("voxstage_youtube").callAttr(
      "configure_runtime", File(context.applicationInfo.nativeLibraryDir, "libvoxstage_qjs.so").absolutePath)
    initialized = true
  }
  private fun call(method: String, vararg args: String): String = try {
    ensureInitialized()
    Python.getInstance().getModule("voxstage_youtube").callAttr(method, *args).toString()
  } catch (error: Exception) {
    JSONObject().put("__voxstage_error", (error.message ?: "Falha no motor do YouTube.").take(1200)).toString()
  }
  @JvmStatic fun archiveJson(action: String, payload: String): String = try {
    if (action == "save") VoxStageArchiveDocuments.save(JSONObject(payload))
    else if (action == "save-status") VoxStageArchiveDocuments.status(JSONObject(payload).optString("token"))
    else {
      ensureInitialized()
      val context = appContext ?: error("A biblioteca ainda não foi iniciada.")
      val directory = File(context.filesDir, "voxstage-python")
      check(directory.isDirectory || directory.mkdirs())
      context.assets.open("library_archive.py").use { input -> File(directory, "library_archive.py").outputStream().use { input.copyTo(it) } }
      val runtime = Python.getInstance()
      runtime.getModule("sys").get("path")!!.callAttr("insert", 0, directory.absolutePath)
      runtime.getModule("library_archive").callAttr("bridge_json", action, payload).toString()
    }
  } catch (error: Exception) {
    JSONObject().put("error", error.message ?: "Não consegui processar o pacote.").toString()
  }
  @JvmStatic fun searchJson(query: String, includeYoutube: String): String = call("search_json", query, includeYoutube)
  @JvmStatic fun metadataJson(url: String): String = call("metadata_json", url)
  @JvmStatic fun downloadAudio(url: String, directory: String): String = call("download_json", url, directory, "audio")
  @JvmStatic fun downloadVideo(url: String, directory: String): String = call("download_json", url, directory, "video")
  private fun coverCall(method: String, first: String, second: String): String = try {
    ensureInitialized()
    Python.getInstance().getModule("cover_art").callAttr(method, first, second).toString()
  } catch (error: Exception) {
    JSONObject().put("error", (error.message ?: "Falha no provedor de capas.").take(1200)).toString()
  }
  @JvmStatic fun coverSearchJson(query: String, settings: String): String = coverCall("search_json", query, settings)
  @JvmStatic fun coverDownloadJson(url: String, directory: String): String = coverCall("download_json", url, directory)
}
