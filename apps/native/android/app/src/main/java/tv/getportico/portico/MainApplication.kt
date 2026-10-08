package tv.getportico.portico

import android.app.Application
import android.content.Context
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import tv.getportico.portico.native.PorticoPackage

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList = PackageList(this).packages.apply { add(PorticoPackage()) },
    )
  }

  override fun attachBaseContext(base: Context) {
    super.attachBaseContext(TelevisionDisplay.context(base))
  }

  override fun onCreate() {
    super.onCreate()
    TelevisionDisplay.install(this)
    loadReactNative(this)
    TelevisionDisplay.keep(this)
  }
}
