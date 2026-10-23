package tv.getportico.portico.native

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/** One app/device EQ. No account, profile, output selector, presets or serialized settings. */
internal class PorticoEqualizerStore(context: Context) : SQLiteOpenHelper(context, "portico-equalizer.db", null, 1) {
  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL("CREATE TABLE equalizer_state (id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), preamp_db REAL NOT NULL CHECK(preamp_db BETWEEN -24 AND 12))")
    db.execSQL("CREATE TABLE equalizer_band (band INTEGER PRIMARY KEY CHECK(band BETWEEN 0 AND 9), gain_db REAL NOT NULL CHECK(gain_db BETWEEN -12 AND 12))")
    save(db, PorticoPcmDsp.Eq())
  }
  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) { error("Unsupported equalizer settings version") }

  @Synchronized fun read(): PorticoPcmDsp.Eq {
    val db = readableDatabase
    db.rawQuery("SELECT enabled,preamp_db FROM equalizer_state WHERE id=1", null).use { state ->
      check(state.moveToFirst())
      val bands = MutableList(10) { 0.0 }
      db.rawQuery("SELECT band,gain_db FROM equalizer_band ORDER BY band", null).use { rows ->
        check(rows.count == bands.size)
        while (rows.moveToNext()) bands[rows.getInt(0)] = rows.getDouble(1)
      }
      return PorticoPcmDsp.Eq(state.getInt(0) == 1, state.getDouble(1), bands.toList())
    }
  }

  @Synchronized fun write(eq: PorticoPcmDsp.Eq) {
    val value = PorticoPcmDsp.Eq(eq.enabled, eq.preampDb, eq.bands.toList())
    val db = writableDatabase
    db.beginTransaction()
    try { save(db, value); db.setTransactionSuccessful() } finally { db.endTransaction() }
  }

  /** Reset gains and preamp, retaining the switch's current state. */
  @Synchronized fun resetToFlat(): PorticoPcmDsp.Eq = read().copy(preampDb = 0.0, bands = List(10) { 0.0 }).also(::write)

  private fun save(db: SQLiteDatabase, eq: PorticoPcmDsp.Eq) {
    db.insertWithOnConflict("equalizer_state", null, ContentValues().apply { put("id", 1); put("enabled", if (eq.enabled) 1 else 0); put("preamp_db", eq.preampDb) }, SQLiteDatabase.CONFLICT_REPLACE)
    db.delete("equalizer_band", null, null)
    eq.bands.forEachIndexed { band, gain -> db.insertOrThrow("equalizer_band", null, ContentValues().apply { put("band", band); put("gain_db", gain) }) }
  }
}
