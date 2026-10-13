package app.voxstage.player

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.SystemClock
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicInteger

/** Foreground-only microphone capture. No recording, speaker output, or network. */
object VoxStageMicrophone {
  private const val PERMISSION = 4203
  private val generation = AtomicInteger()
  @Volatile private var activity: MainActivity? = null
  @Volatile private var webView: WebView? = null
  @Volatile private var recorder: AudioRecord? = null
  @Volatile private var pending: String? = null
  fun attach(host: MainActivity, view: WebView) { activity=host;webView=view;view.addJavascriptInterface(Bridge(),"VoxStageNativeMic") }
  private fun emit(id: String, type: String, extra: JSONObject = JSONObject(), captured: Long? = null, token: Int = generation.get()) {
    activity?.runOnUiThread {
      if(token!=generation.get())return@runOnUiThread
      extra.put("id",id).put("type",type)
      if(captured!=null)extra.put("ageMs",(SystemClock.elapsedRealtimeNanos()-captured)/1000000.0)
      webView?.evaluateJavascript("window.dispatchEvent(new CustomEvent('voxstage-native-microphone',{detail:$extra}))",null)
    }
  }
  fun permissionResult(requestCode: Int, granted: Boolean) {
    if(requestCode!=PERMISSION)return
    val id=pending ?: return
    pending=null
    if(granted)capture(id) else emit(id,"error",JSONObject().put("message","Permissão de microfone negada. Libere-a nas configurações do Android."))
  }
  private fun start(id: String) {
    val host=activity ?: return
    stop()
    if(host.checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED) {
      pending=id
      host.runOnUiThread { if(pending==id)ActivityCompat.requestPermissions(host,arrayOf(Manifest.permission.RECORD_AUDIO),PERMISSION) }
    } else capture(id)
  }
  private fun capture(id: String) {
    val token=generation.get()
    Thread({
      var input: AudioRecord? = null
      try {
        val rate=16000
        val minimum=AudioRecord.getMinBufferSize(rate,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT)
        require(minimum>0) { "Microfone indisponível neste aparelho." }
        val current=AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION,rate,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,maxOf(minimum*2,8192))
        input=current
        require(current.state==AudioRecord.STATE_INITIALIZED) { "Não consegui abrir o microfone." }
        synchronized(this) { if(token!=generation.get())return@Thread;recorder=current;current.startRecording() }
        emit(id,"ready",JSONObject().put("sampleRate",rate),token=token)
        val samples=ShortArray(1024)
        while(token==generation.get()) {
          var filled=0
          while(filled<samples.size && token==generation.get()) {
            val read=current.read(samples,filled,samples.size-filled,AudioRecord.READ_BLOCKING)
            check(read>0) { "Microfone interrompido." };filled+=read
          }
          if(filled!=samples.size)break
          val captured=SystemClock.elapsedRealtimeNanos()-32000000L
          val bytes=ByteArray(samples.size*2)
          samples.forEachIndexed { index,value -> bytes[index*2]=value.toByte();bytes[index*2+1]=(value.toInt() shr 8).toByte() }
          emit(id,"frame",JSONObject().put("sampleRate",rate).put("pcm",Base64.encodeToString(bytes,Base64.NO_WRAP)),captured,token)
        }
      } catch(error: Exception) { emit(id,"error",JSONObject().put("message",error.message ?: "Microfone indisponível."),token=token) }
      finally { synchronized(this) { if(recorder===input)recorder=null };try { input?.stop() } catch(_:Exception) {};input?.release() }
    },"voxstage-microphone").start()
  }
  @Synchronized fun stop() { generation.incrementAndGet();pending=null;try { recorder?.stop() } catch(_:Exception) {} }
  fun background() { if(recorder!=null){webView?.evaluateJavascript("window.dispatchEvent(new Event('voxstage-microphone-background'))",null);stop()} }
  fun detach() { stop();activity=null;webView=null }
  private class Bridge {
    @JavascriptInterface fun start(id: String) { if(id.matches(Regex("[a-zA-Z0-9-]{1,80}")))VoxStageMicrophone.start(id) }
    @JavascriptInterface fun stop() = VoxStageMicrophone.stop()
  }
}
