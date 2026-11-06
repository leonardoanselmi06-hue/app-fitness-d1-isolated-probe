package app.fitness.collector

import android.content.Context
import android.content.pm.PackageManager
import android.database.Cursor
import android.net.Uri
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.BodyFatRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.records.metadata.DataOrigin
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.Period
import java.time.ZoneId
import java.time.temporal.ChronoUnit

object Collector {
    @Volatile private var lastBody: String = ""
    @Volatile private var missingSleepCols: List<String> = emptyList()
    // Sola lettura: passi e peso (obbligatori), grasso corporeo e fasi del sonno (facoltativi: senza, si inviano gli altri dati),
    // + lettura in background e storico, se il telefono li supporta.
    val permissions = setOf(
        HealthPermission.getReadPermission(StepsRecord::class),
        HealthPermission.getReadPermission(WeightRecord::class),
        HealthPermission.getReadPermission(BodyFatRecord::class),
        HealthPermission.getReadPermission(SleepSessionRecord::class),
        "android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND",
        "android.permission.health.READ_HEALTH_DATA_HISTORY",
    )
    // Passi: SOLO Samsung Health (authority del Register); Health Connect altrimenti somma anche Google Fit.
    const val STEPS_ORIGIN = "com.sec.android.app.shealth"
    // Fasi del sonno: SOLO sessioni scritte da Sleep as Android (Sleep Cycle scrive sessioni senza fasi o a zero).
    const val STAGES_ORIGIN = "com.urbandroid.sleep"
    const val MAX_SEGMENTS = 1500
    const val SLEEP_PERMISSION = "com.urbandroid.sleep.READ"
    const val SLEEP_DAYS = 200L
    const val STEPS_DAYS = 35L
    const val WEIGHT_DAYS = 400L

    suspend fun hasCorePermissions(ctx: Context): Boolean {
        val granted = HealthConnectClient.getOrCreate(ctx).permissionController.getGrantedPermissions()
        return granted.containsAll(setOf(HealthPermission.getReadPermission(StepsRecord::class), HealthPermission.getReadPermission(WeightRecord::class)))
    }

    /** Legge da Health Connect e invia al backend. Restituisce un messaggio breve (mai dati personali). */
    suspend fun syncNow(ctx: Context): String = withContext(Dispatchers.IO) {
        val cfg = Config(ctx)
        if (!cfg.ready) return@withContext "Impostazioni incomplete (URL, Client ID e Secret)."
        if (HealthConnectClient.getSdkStatus(ctx) != HealthConnectClient.SDK_AVAILABLE) return@withContext "Health Connect non disponibile."
        if (!hasCorePermissions(ctx)) return@withContext "Permessi Health Connect mancanti."
        val hc = HealthConnectClient.getOrCreate(ctx)
        val zone = ZoneId.systemDefault()
        val today = LocalDate.now(zone)

        val steps = JSONArray()
        val from = today.minusDays(STEPS_DAYS).atStartOfDay()
        val res = hc.aggregateGroupByPeriod(AggregateGroupByPeriodRequest(
            metrics = setOf(StepsRecord.COUNT_TOTAL),
            dataOriginFilter = setOf(DataOrigin(STEPS_ORIGIN)),
            timeRangeFilter = TimeRangeFilter.between(from, LocalDateTime.of(today.plusDays(1), java.time.LocalTime.MIDNIGHT)),
            timeRangeSlicer = Period.ofDays(1)))
        for (r in res) {
            val count = r.result[StepsRecord.COUNT_TOTAL] ?: continue // giorno senza dati: omesso (mai zero inventato)
            val origins = JSONArray(r.result.dataOrigins.map { it.packageName })
            steps.put(JSONObject().put("date", r.startTime.toLocalDate().toString()).put("count", count).put("origins", origins))
        }

        val weights = JSONArray()
        val since = Instant.now().minus(WEIGHT_DAYS, ChronoUnit.DAYS)
        // Le 400 misurazioni più recenti (limite del server per invio)
        val page = hc.readRecords(ReadRecordsRequest(WeightRecord::class, TimeRangeFilter.between(since, Instant.now()), ascendingOrder = false, pageSize = 400))
        for (w in page.records) {
            weights.put(JSONObject().put("id", w.metadata.id).put("time", w.time.toString()).put("kg", w.weight.inKilograms).put("origin", w.metadata.dataOrigin.packageName))
        }

        val granted = hc.permissionController.getGrantedPermissions()
        val fatPerm = granted.contains(HealthPermission.getReadPermission(BodyFatRecord::class))
        val stagesPerm = granted.contains(HealthPermission.getReadPermission(SleepSessionRecord::class))
        val bodyFat = JSONArray()
        if (fatPerm) {
            val fp = hc.readRecords(ReadRecordsRequest(BodyFatRecord::class, TimeRangeFilter.between(since, Instant.now()), ascendingOrder = false, pageSize = 400))
            for (f in fp.records) bodyFat.put(JSONObject().put("id", f.metadata.id).put("time", f.time.toString()).put("pct", f.percentage.value).put("origin", f.metadata.dataOrigin.packageName))
        }
        val stages = if (stagesPerm) readStages(hc) else JSONArray()

        val sleepPerm = ctx.checkSelfPermission(SLEEP_PERMISSION) == PackageManager.PERMISSION_GRANTED
        val sleep = if (sleepPerm) readSleep(ctx) else JSONArray()

        if (steps.length() + weights.length() + sleep.length() + bodyFat.length() + stages.length() == 0) return@withContext "Nessun dato da inviare."
        val body = JSONObject().put("device_id", cfg.deviceId).put("steps", steps).put("weights", weights).put("sleep", sleep).put("body_fat", bodyFat).put("sleep_stages", stages).toString()
        val code = post(cfg, body)
        when (code) {
            200 -> "OK: ${steps.length()} giorni di passi, ${weights.length()} pesi, ${sleep.length()} notti di sonno, ${bodyFat.length()} misure di grasso corporeo, ${stages.length()} notti con fasi inviati." + (if (fatPerm && stagesPerm) "" else " (Permessi grasso corporeo/fasi del sonno non concessi: premi il pulsante 1)") + (if (sleepPerm) "" else " (Sonno: accesso a Sleep as Android non concesso)") + (if (missingSleepCols.isNotEmpty()) " Colonne sonno non disponibili: ${missingSleepCols.joinToString(",")}." else "")
            401, 403 -> "Accesso rifiutato ($code): controlla Client ID/Secret e la policy in Cloudflare. Dettaglio: ${lastBody.take(160)}"
            503 -> "Il server non accetta ancora i dati (ricezione spenta)."
            else -> "Errore del server ($code). Dettaglio: ${lastBody.take(160)}"
        }
    }

    /** Sessioni di sonno con fasi da Health Connect (solo Sleep as Android). Segmenti compatti [tipo, offset_min, durata_min]; sessioni senza fasi non inviate. */
    private suspend fun readStages(hc: HealthConnectClient): JSONArray {
        val out = JSONArray()
        val range = TimeRangeFilter.between(Instant.now().minus(SLEEP_DAYS, ChronoUnit.DAYS), Instant.now())
        val page = hc.readRecords(ReadRecordsRequest(SleepSessionRecord::class, range, dataOriginFilter = setOf(DataOrigin(STAGES_ORIGIN)), ascendingOrder = false, pageSize = 400))
        for (rec in page.records) {
            if (rec.stages.isEmpty() || rec.stages.size > MAX_SEGMENTS) continue
            val segs = JSONArray()
            for (st in rec.stages) {
                val off = ChronoUnit.MINUTES.between(rec.startTime, st.startTime)
                val dur = (ChronoUnit.SECONDS.between(st.startTime, st.endTime) + 30) / 60
                if (off < 0 || dur <= 0) continue
                segs.put(JSONArray().put(st.stage).put(off).put(dur))
            }
            if (segs.length() == 0) continue
            out.put(JSONObject().put("id", rec.metadata.id).put("start_ms", rec.startTime.toEpochMilli()).put("end_ms", rec.endTime.toEpochMilli())
                .put("origin", rec.metadata.dataOrigin.packageName).put("segments", segs))
        }
        return out
    }

    private fun numOrNull(v: Any?): Any? = when (v) {
        is Long, is Double, is Int -> v
        is String -> v.trim().toDoubleOrNull() ?: JSONObject.NULL
        else -> JSONObject.NULL
    }

    private fun value(c: Cursor, i: Int): Any? = when (c.getType(i)) {
        Cursor.FIELD_TYPE_INTEGER -> c.getLong(i)
        Cursor.FIELD_TYPE_FLOAT -> c.getDouble(i)
        Cursor.FIELD_TYPE_STRING -> c.getString(i)
        else -> null
    }

    /** Sleep as Android: ContentProvider locale in sola lettura. Identità = startTime (verificata 43/43 sul CSV). Nessun commento/testo libero, nessuna serie. */
    private fun readSleep(ctx: Context): JSONArray {
        val out = JSONArray()
        val uri = Uri.parse("content://com.urbandroid.sleep.history/records")
        val cols = listOf("startTime", "toTime", "latestToTime", "timezone", "rating", "quality", "snore", "cycles", "lenAdjust", "noiseLevel", "length")
        val since = System.currentTimeMillis() - SLEEP_DAYS * 86_400_000L
        // Le colonne disponibili variano: si provano una alla volta e si usano solo quelle che il provider accetta.
        val usable = cols.filter { n -> n == "startTime" || n == "toTime" || try { ctx.contentResolver.query(uri, arrayOf("startTime", n), null, null, "startTime DESC")?.use { true } ?: false } catch (e: Exception) { false } }
        missingSleepCols = cols.filter { it !in usable }
        val c: Cursor = ctx.contentResolver.query(uri, usable.toTypedArray(), null, null, "startTime DESC") ?: return out
        c.use {
            val ix = cols.associateWith { n -> it.getColumnIndex(n) }
            fun get(n: String): Any? = ix[n]?.takeIf { i -> i >= 0 }?.let { i -> value(it, i) }
            while (it.moveToNext() && out.length() < 400) {
                val start = (get("startTime") as? Long) ?: continue
                if (start < since) break // ordinati dal più recente
                val end = (get("toTime") as? Long) ?: continue
                if (end < start) continue
                out.put(JSONObject().put("id", start.toString()).put("start_ms", start).put("end_ms", end)
                    .put("latest_end_ms", (get("latestToTime") as? Long) ?: JSONObject.NULL).put("tz", (get("timezone") as? String) ?: JSONObject.NULL)
                    .put("rating", numOrNull(get("rating"))).put("quality", numOrNull(get("quality"))).put("snore", numOrNull(get("snore")))
                    .put("cycles", numOrNull(get("cycles"))).put("len_adjust", numOrNull(get("lenAdjust")))
                    .put("noise_level", numOrNull(get("noiseLevel"))).put("length_raw", numOrNull(get("length"))))
            }
        }
        return out
    }

    private fun post(cfg: Config, body: String): Int {
        val c = URL("${cfg.baseUrl}/v1/ingest/device").openConnection() as HttpURLConnection
        return try {
            c.requestMethod = "POST"; c.connectTimeout = 20000; c.readTimeout = 40000; c.doOutput = true
            c.setRequestProperty("content-type", "application/json")
            c.setRequestProperty("CF-Access-Client-Id", cfg.clientId)
            c.setRequestProperty("CF-Access-Client-Secret", cfg.clientSecret)
            c.outputStream.use { it.write(body.toByteArray()) }
            val rc = c.responseCode
            lastBody = try { (if (rc >= 400) c.errorStream else c.inputStream)?.bufferedReader()?.readText()?.replace(Regex("\\s+"), " ") ?: "" } catch (e: Exception) { "" }
            rc
        } catch (e: Exception) { -1 } finally { c.disconnect() }
    }
}
