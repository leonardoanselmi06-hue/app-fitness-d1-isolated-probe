package app.fitness.collector

import android.content.Context
import java.util.UUID

/** Impostazioni nel solo spazio privato dell'app. Il client secret si digita qui sul telefono: non passa mai da chat o repo. */
class Config(ctx: Context) {
    private val p = ctx.applicationContext.getSharedPreferences("collector", Context.MODE_PRIVATE)
    var baseUrl: String
        get() = p.getString("url", "https://app-fitness.leonardo-anselmi06.workers.dev")!!
        set(v) = p.edit().putString("url", v.trim().trimEnd('/')).apply()
    var clientId: String
        get() = p.getString("cid", "")!!
        set(v) = p.edit().putString("cid", v.trim()).apply()
    var clientSecret: String
        get() = p.getString("cs", "")!!
        set(v) = p.edit().putString("cs", v.trim()).apply()
    val deviceId: String
        get() = p.getString("did", null) ?: ("phone-" + UUID.randomUUID().toString().take(8)).also { p.edit().putString("did", it).apply() }
    var lastResult: String
        get() = p.getString("last", "Nessuna sincronizzazione ancora.")!!
        set(v) = p.edit().putString("last", v).apply()
    val ready get() = baseUrl.startsWith("https://") && clientId.isNotEmpty() && clientSecret.isNotEmpty()
}
