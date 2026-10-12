package app.voxstage.player

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.webkit.JavascriptInterface
import android.webkit.WebView

object VoxStageMediaControls {
  private const val CHANNEL_ID = "voxstage-playback"
  private const val NOTIFICATION_ID = 4201
  private const val JOB_CHANNEL_ID = "voxstage-processing"
  private const val JOB_NOTIFICATION_ID = 4202
  private const val ACTION_PREFIX = "app.voxstage.player.MEDIA_"
  @Volatile private var activity: MainActivity? = null
  @Volatile private var webView: WebView? = null
  private var session: MediaSession? = null
  private var lastTitle = ""
  private var lastArtist = ""
  private var lastPosition = 0L
  private var lastDuration = 0L
  private var lastJobNotification = ""
  internal var isPlaying = false
  fun isTelevision(context: Context): Boolean =
    context.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK) ||
    (context.resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK) == Configuration.UI_MODE_TYPE_TELEVISION

  fun tvKey(key: String) {
    activity?.runOnUiThread { webView?.evaluateJavascript("window.voxstageTvKey && window.voxstageTvKey('$key')", null) }
  }

  fun attach(host: MainActivity, view: WebView) {
    activity = host
    webView = view
    view.addJavascriptInterface(Bridge(), "VoxStageMedia")
    ensureSession(host)
  }

  fun detach(host: MainActivity) {
    if (activity !== host) return
    webView = null
    activity = null
  }

  private fun ensureSession(context: Context) {
    if (session != null) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Reprodução VoxStage", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Controles da música reproduzida pelo VoxStage"
        setShowBadge(false)
      },
    )
    session = MediaSession(context, "VoxStage").apply {
      setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS or MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS)
      setCallback(object : MediaSession.Callback() {
        override fun onPlay() = dispatch("play")
        override fun onPause() = dispatch("pause")
        override fun onSkipToNext() = dispatch("next")
        override fun onSkipToPrevious() = dispatch("previous")
        override fun onSeekTo(position: Long) = dispatch("seek", position)
      })
      isActive = true
    }
  }

  private fun setOrientation(mode: String) {
    val host = activity ?: return
    host.runOnUiThread {
      host.requestedOrientation = when (mode.lowercase()) {
        "landscape", "tv" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        "portrait", "vertical" -> if (isTelevision(host)) ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE else ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        else -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
      }
    }
  }

  private fun update(title: String, artist: String, playing: Boolean, duration: Long, position: Long) {
    val host = activity ?: return
    lastTitle = title.take(200)
    lastArtist = artist.take(200)
    lastPosition = position.coerceAtLeast(0)
    lastDuration = duration.coerceAtLeast(0)
    isPlaying = playing
    ensureSession(host)
    val current = session ?: return
    current.setMetadata(MediaMetadata.Builder()
      .putString(MediaMetadata.METADATA_KEY_TITLE, lastTitle)
      .putString(MediaMetadata.METADATA_KEY_ARTIST, lastArtist)
      .putLong(MediaMetadata.METADATA_KEY_DURATION, lastDuration)
      .build())
    val actions = PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or
      PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS or PlaybackState.ACTION_SEEK_TO
    current.setPlaybackState(PlaybackState.Builder()
      .setActions(actions)
      .setState(if (isPlaying) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED, lastPosition, 1f)
      .build())
    if (lastTitle.isBlank()) {
      (host.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(NOTIFICATION_ID)
      return
    }
    showNotification(host)
  }

  private fun actionIntent(context: Context, action: String): PendingIntent {
    val intent = Intent(context, MediaActionReceiver::class.java).setAction(ACTION_PREFIX + action.uppercase())
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0
    return PendingIntent.getBroadcast(context, action.hashCode(), intent, flags)
  }

  private fun showNotification(context: Context) {
    val openIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
    val openPending = openIntent?.let {
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0
      PendingIntent.getActivity(context, 0, it, flags)
    }
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, CHANNEL_ID) else Notification.Builder(context)
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val notification = builder
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setContentTitle(lastTitle)
      .setContentText(lastArtist.ifBlank { "VoxStage" })
      .setContentIntent(openPending)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setOngoing(isPlaying)
      .setOnlyAlertOnce(true)
      .addAction(Notification.Action.Builder(android.R.drawable.ic_media_previous, "Anterior", actionIntent(context, "previous")).build())
      .addAction(Notification.Action.Builder(if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play, if (isPlaying) "Pausar" else "Reproduzir", actionIntent(context, "toggle")).build())
      .addAction(Notification.Action.Builder(android.R.drawable.ic_media_next, "Próxima", actionIntent(context, "next")).build())
      .setStyle(Notification.MediaStyle().setMediaSession(session?.sessionToken).setShowActionsInCompactView(0, 1, 2))
      .build()
    manager.notify(NOTIFICATION_ID, notification)
  }

  internal fun updateJobNotification(title: String, message: String, finished: Boolean) {
    val host = activity ?: return
    host.runOnUiThread {
      val safeTitle = title.take(100).ifBlank { "Música" }
      val safeMessage = message.take(180).ifBlank { "Separando música…" }
      val fingerprint = "$safeTitle|$safeMessage|$finished"
      if (lastJobNotification == fingerprint) return@runOnUiThread
      val intent = Intent(host, MvsepProcessingService::class.java)
        .setAction(if (finished) MvsepProcessingService.ACTION_FINISH else MvsepProcessingService.ACTION_UPDATE)
        .putExtra(MvsepProcessingService.EXTRA_TITLE, safeTitle)
        .putExtra(MvsepProcessingService.EXTRA_MESSAGE, safeMessage)
      try {
        if (finished) host.startService(intent)
        else if (Build.VERSION.SDK_INT >= 26) host.startForegroundService(intent) else host.startService(intent)
        lastJobNotification = fingerprint
      } catch (_: IllegalStateException) {
        // Android may reject starting a service once the activity is backgrounded.
      } catch (_: SecurityException) {
        // Keep the job available in the app if notifications are restricted.
      }
    }
  }

  internal fun dispatch(action: String, position: Long? = null) {
    val script = when (action) {
      "seek" -> "window.dispatchEvent(new CustomEvent('voxstage-media-control',{detail:{action:'seek',position:${position ?: 0}}}))"
      else -> "window.dispatchEvent(new CustomEvent('voxstage-media-control',{detail:{action:'$action'}}))"
    }
    activity?.runOnUiThread { webView?.evaluateJavascript(script, null) }
  }

  private class Bridge {
    @JavascriptInterface fun openMvsepApi() {
      val host = activity ?: return
      host.runOnUiThread {
        try { host.startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://mvsep.com/pt/full_api"))) }
        catch (_: android.content.ActivityNotFoundException) { }
      }
    }
    @JavascriptInterface fun isTelevision(): Boolean = activity?.let { VoxStageMediaControls.isTelevision(it) } ?: false
    @JavascriptInterface fun exitToLauncher() = activity?.runOnUiThread { activity?.finish() }
    @JavascriptInterface fun update(title: String, artist: String, playing: Boolean, duration: Long, position: Long) =
      activity?.runOnUiThread { VoxStageMediaControls.update(title, artist, playing, duration, position) }
    @JavascriptInterface fun clear() = activity?.runOnUiThread { VoxStageMediaControls.update("", "", false, 0, 0) }
    @JavascriptInterface fun updateJobNotification(title: String, message: String, finished: Boolean) = VoxStageMediaControls.updateJobNotification(title, message, finished)
    @JavascriptInterface fun setOrientation(mode: String) = VoxStageMediaControls.setOrientation(mode)
  }
}

class MvsepProcessingService : android.app.Service() {
  companion object {
    const val ACTION_UPDATE = "app.voxstage.player.MVSEP_UPDATE"
    const val ACTION_FINISH = "app.voxstage.player.MVSEP_FINISH"
    const val EXTRA_TITLE = "title"
    const val EXTRA_MESSAGE = "message"
    private const val CHANNEL_ID = "voxstage-processing"
    private const val NOTIFICATION_ID = 4202
  }

  override fun onBind(intent: Intent?): android.os.IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(CHANNEL_ID) == null) {
      manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Envios MVSep", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Progresso das separações em andamento no VoxStage"
        setShowBadge(false)
      })
    }
    val finished = intent?.action == ACTION_FINISH
    val title = intent?.getStringExtra(EXTRA_TITLE)?.take(100).orEmpty().ifBlank { "Música" }
    val message = intent?.getStringExtra(EXTRA_MESSAGE)?.take(180).orEmpty().ifBlank { "Separando música…" }
    val openIntent = packageManager.getLaunchIntentForPackage(packageName)
    val flagsValue = PendingIntent.FLAG_UPDATE_CURRENT or if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0
    val openPending = openIntent?.let { PendingIntent.getActivity(this, 2, it, flagsValue) }
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL_ID) else Notification.Builder(this)
    val notification = builder.setSmallIcon(android.R.drawable.ic_media_play)
      .setContentTitle(if (finished) "Envio encerrado · $title" else "Separando · $title")
      .setContentText(message).setContentIntent(openPending)
      .setVisibility(Notification.VISIBILITY_PRIVATE).setOngoing(!finished).setAutoCancel(finished)
      .setOnlyAlertOnce(true).build()
    if (finished) {
      stopForeground(STOP_FOREGROUND_REMOVE)
      manager.notify(NOTIFICATION_ID, notification)
      stopSelf(startId)
    } else startForeground(NOTIFICATION_ID, notification)
    return START_NOT_STICKY
  }
}

class MediaActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action?.removePrefix("app.voxstage.player.MEDIA_")?.lowercase() ?: return
    when (action) {
      "previous", "next" -> VoxStageMediaControls.dispatch(action)
      "toggle" -> VoxStageMediaControls.dispatch(if (VoxStageMediaControls.isPlaying) "pause" else "play")
    }
  }
}
