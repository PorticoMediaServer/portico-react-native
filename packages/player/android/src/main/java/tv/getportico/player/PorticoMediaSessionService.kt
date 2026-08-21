package tv.getportico.player

import android.content.Intent
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

class PorticoMediaSessionService : MediaSessionService() {
  override fun onCreate() {
    super.onCreate()
    PorticoMediaSessionAuthority.currentSession()?.let(::addSession) ?: stopSelf()
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? =
    PorticoMediaSessionAuthority.currentSession()

  override fun onTaskRemoved(rootIntent: Intent?) {
    val session = PorticoMediaSessionAuthority.currentSession()
    if (session == null || !session.player.playWhenReady) stopSelf()
  }
}
