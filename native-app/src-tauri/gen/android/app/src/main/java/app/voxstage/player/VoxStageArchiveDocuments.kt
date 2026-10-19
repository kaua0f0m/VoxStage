package app.voxstage.player

import android.app.Activity
import android.content.Intent
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/** Save through Android's document picker, without broad storage permissions. */
object VoxStageArchiveDocuments {
  private const val REQUEST = 4250
  @Volatile private var activity: MainActivity? = null
  private data class Pending(val token: String, val file: File)
  @Volatile private var pending: Pending? = null
  private val states = ConcurrentHashMap<String, String>()

  fun attach(host: MainActivity) { activity = host }
  fun detach(host: MainActivity) {
    if (activity === host) {
      activity = null
      pending?.let { states[it.token] = JSONObject().put("state", "cancelled").toString() }
      pending = null
    }
  }
  @Synchronized fun save(request: JSONObject): String {
    val host = activity ?: error("Reabra o VoxStage para salvar a exportação.")
    check(pending == null) { "Conclua o salvamento anterior primeiro." }
    val file = File(request.getString("path")).canonicalFile
    val privateRoot = File(host.applicationInfo.dataDir).canonicalPath + File.separator
    check(file.path.startsWith(privateRoot) && file.parentFile?.name == ".archives" && file.isFile) { "Arquivo de exportação inválido." }
    val token = UUID.randomUUID().toString()
    val filename = request.optString("filename", "VoxStage.voxstage.zip").replace(Regex("[/\\\\\\r\\n]"), "_").take(140)
    if (states.size > 32) states.clear()
    states[token] = JSONObject().put("state", "waiting").toString()
    pending = Pending(token, file)
    host.runOnUiThread {
      try {
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
          .setType("application/zip").putExtra(Intent.EXTRA_TITLE, filename)
        host.startActivityForResult(intent, REQUEST)
      } catch (error: Exception) {
        states[token] = JSONObject().put("error", "Este aparelho não tem um seletor de arquivos disponível para salvar o pacote.").toString()
        pending = null
      }
    }
    return JSONObject().put("token", token).toString()
  }
  fun status(token: String): String = states[token] ?: JSONObject().put("error", "Salvamento não encontrado. Tente exportar novamente.").toString()

  fun activityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != REQUEST) return
    val task = pending ?: return
    val host = activity ?: return
    val uri = data?.data
    if (resultCode != Activity.RESULT_OK || uri == null) {
      states[task.token] = JSONObject().put("state", "cancelled").toString()
      pending = null
      return
    }
    states[task.token] = JSONObject().put("state", "saving").toString()
    Thread {
      try {
        val target = host.contentResolver.openOutputStream(uri, "w") ?: error("Não consegui abrir o destino.")
        target.use { output -> task.file.inputStream().use { input -> input.copyTo(output, 1024 * 1024) } }
        states[task.token] = JSONObject().put("state", "done").toString()
      } catch (error: Exception) {
        states[task.token] = JSONObject().put("error", error.message ?: "Não consegui salvar o pacote.").toString()
      } finally { pending = null }
    }.start()
  }
}
