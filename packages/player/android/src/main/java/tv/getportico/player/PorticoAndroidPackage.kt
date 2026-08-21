package tv.getportico.player

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.ModuleSpec
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

internal class PorticoAndroidPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
    return when (name) {
      PorticoPlayerViewModule.NAME -> PorticoPlayerViewModule(reactContext)
      PorticoRuntimeModule.NAME -> PorticoRuntimeModule(reactContext)
      PorticoNearbyDevicesModule.NAME -> PorticoNearbyDevicesModule(reactContext)
      PorticoCleanupQuarantineModule.NAME -> PorticoCleanupQuarantineModule(reactContext)
      else -> null
    }
  }

  override fun getViewManagers(reactContext: ReactApplicationContext): List<ModuleSpec> {
    return listOf(ModuleSpec.viewManagerSpec { PorticoPlayerViewManager() })
  }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
    val modules = listOf(
      PorticoPlayerViewModule::class.java to PorticoPlayerViewModule.NAME,
      PorticoRuntimeModule::class.java to PorticoRuntimeModule.NAME,
      PorticoNearbyDevicesModule::class.java to PorticoNearbyDevicesModule.NAME,
      PorticoCleanupQuarantineModule::class.java to PorticoCleanupQuarantineModule.NAME,
    ).associate { (type, name) ->
      name to ReactModuleInfo(name, type.name, false, false, false, false)
    }
    return ReactModuleInfoProvider { modules }
  }
}
