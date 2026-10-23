package tv.getportico.portico.native

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/** Local engine settings only. No access to account/auth storage, no serialized object graph. */
internal class PorticoEqualizerStore(context: Context) : SQLiteOpenHelper(context, "portico-audio-output.db", null, 1) {
  override fun onConfigure(db: SQLiteDatabase) { db.setForeignKeyConstraintsEnabled(true) }
  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL("CREATE TABLE output_eq (output_key TEXT PRIMARY KEY, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), preamp_db REAL NOT NULL CHECK(preamp_db BETWEEN -24 AND 12), preset TEXT NOT NULL)")
    db.execSQL("CREATE TABLE output_eq_band (output_key TEXT NOT NULL REFERENCES output_eq(output_key) ON DELETE CASCADE, band INTEGER NOT NULL CHECK(band BETWEEN 0 AND 9), gain_db REAL NOT NULL CHECK(gain_db BETWEEN -12 AND 12), PRIMARY KEY(output_key,band))")
  }
  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) { error("Unsupported audio settings version") }
  @Synchronized fun read(key: String): PorticoPcmDsp.Eq {
    readableDatabase.rawQuery("SELECT enabled,preamp_db FROM output_eq WHERE output_key=?", arrayOf(key)).use { c ->
      if (!c.moveToFirst()) return PorticoPcmDsp.Eq()
      val bands = MutableList(10) { 0.0 }
      readableDatabase.rawQuery("SELECT band,gain_db FROM output_eq_band WHERE output_key=? ORDER BY band", arrayOf(key)).use { b -> while (b.moveToNext()) bands[b.getInt(0)] = b.getDouble(1) }
      return PorticoPcmDsp.Eq(c.getInt(0) == 1, c.getDouble(1), bands)
    }
  }
  @Synchronized fun write(key: String, eq: PorticoPcmDsp.Eq, preset: String = "custom") {
    require(key.length in 1..128 && preset.length in 1..128)
    val db = writableDatabase; db.beginTransaction()
    try {
      db.insertWithOnConflict("output_eq", null, ContentValues().apply { put("output_key",key); put("enabled",if(eq.enabled)1 else 0); put("preamp_db",eq.preampDb); put("preset",preset) }, SQLiteDatabase.CONFLICT_REPLACE)
      eq.bands.forEachIndexed { band, gain -> db.insertOrThrow("output_eq_band",null,ContentValues().apply { put("output_key",key); put("band",band); put("gain_db",gain) }) }
      db.setTransactionSuccessful()
    } finally { db.endTransaction() }
  }
  companion object {
    // Original Portico presets, no third-party headphone measurements are redistributed.
    val presets = mapOf("flat" to PorticoPcmDsp.Eq(true), "headphones-gentle-bass" to PorticoPcmDsp.Eq(true, -3.0, listOf(3.0,3.0,2.0,1.0,0.0,0.0,0.0,0.0,0.0,0.0)),
      "headphones-softer-treble" to PorticoPcmDsp.Eq(true, 0.0, listOf(0.0,0.0,0.0,0.0,0.0,0.0,-1.0,-2.0,-3.0,-3.0)))
  }
}
