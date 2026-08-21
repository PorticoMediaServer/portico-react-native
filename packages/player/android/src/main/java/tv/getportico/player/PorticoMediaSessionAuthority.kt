package tv.getportico.player

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.session.MediaSession

/** One Android player and MediaSession authority shared by the RN presenter and background service. */
internal object PorticoMediaSessionAuthority {
  private var owner: Player? = null
  private var session: MediaSession? = null

  @Synchronized
  fun attach(context: Context, player: Player, contentMode: String): MediaSession {
    if (owner !== player) {
      session?.release()
      owner = player
      session = MediaSession.Builder(context.applicationContext, player).build()
    }
    val audioContent = contentMode == "music" || contentMode == "audiobook"
    player.setAudioAttributes(
      AudioAttributes.Builder()
        .setUsage(C.USAGE_MEDIA)
        .setContentType(if (contentMode == "audiobook") C.AUDIO_CONTENT_TYPE_SPEECH else if (audioContent) C.AUDIO_CONTENT_TYPE_MUSIC else C.AUDIO_CONTENT_TYPE_MOVIE)
        .build(),
      true,
    )
    ContextCompat.startForegroundService(
      context.applicationContext,
      Intent(context.applicationContext, PorticoMediaSessionService::class.java),
    )
    return session!!
  }

  @Synchronized
  fun currentSession(): MediaSession? = session

  @Synchronized
  fun detach(context: Context, player: Player) {
    if (owner !== player) return
    session?.release()
    session = null
    owner = null
    context.applicationContext.stopService(Intent(context.applicationContext, PorticoMediaSessionService::class.java))
  }
}
