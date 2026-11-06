package app.fitness.collector

import android.os.Bundle
import android.text.InputType
import android.widget.*
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.lifecycleScope
import androidx.health.connect.client.PermissionController
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private lateinit var status: TextView
    private val askPermissions = registerForActivityResult(PermissionController.createRequestPermissionResultContract()) {
        lifecycleScope.launch { status.text = if (Collector.hasCorePermissions(this@MainActivity)) "Permessi concessi." else "Permessi non concessi." }
    }

    private val askSleep = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        status.text = if (ok) "Accesso a Sleep as Android concesso." else "Accesso a Sleep as Android non concesso."
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val cfg = Config(this)
        fun field(hint: String, value: String, secret: Boolean = false) = EditText(this).apply {
            this.hint = hint; setText(value); isSingleLine = true
            inputType = if (secret) InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD else InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
        }
        val url = field("URL del server", cfg.baseUrl)
        val cid = field("Client ID (Cloudflare Access)", cfg.clientId)
        val cs = field("Client Secret (Cloudflare Access)", cfg.clientSecret, secret = true)
        status = TextView(this).apply { text = cfg.lastResult; setPadding(0, 24, 0, 24) }
        fun save() { cfg.baseUrl = url.text.toString(); cfg.clientId = cid.text.toString(); cfg.clientSecret = cs.text.toString() }

        val grant = Button(this).apply { text = "1. Concedi i permessi Health Connect"; setOnClickListener { askPermissions.launch(Collector.permissions) } }
        val sleepBtn = Button(this).apply { text = "1b. Concedi accesso a Sleep as Android"; setOnClickListener { askSleep.launch(Collector.SLEEP_PERMISSION) } }
        val sync = Button(this).apply {
            text = "2. Sincronizza ora"
            setOnClickListener {
                save(); isEnabled = false; status.text = "Sincronizzazione in corso…"
                lifecycleScope.launch {
                    val msg = try { Collector.syncNow(this@MainActivity) } catch (e: Exception) { "Errore: ${e.javaClass.simpleName}" }
                    cfg.lastResult = "${java.time.LocalDateTime.now().withNano(0)} $msg"; status.text = cfg.lastResult
                    if (msg.startsWith("OK")) SyncWorker.schedule(this@MainActivity) // dopo il primo invio riuscito, sync automatica ogni 6 ore
                    isEnabled = true
                }
            }
        }
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(48, 96, 48, 48)
            addView(TextView(context).apply { text = "App Fitness Collector"; textSize = 22f })
            addView(TextView(context).apply { text = "Legge passi (Samsung Health), peso, grasso corporeo e fasi del sonno da Health Connect e il sonno da Sleep as Android, e li invia al tuo server privato."; setPadding(0, 12, 0, 24) })
            addView(url); addView(cid); addView(cs); addView(grant); addView(sleepBtn); addView(sync); addView(status)
        }
        setContentView(ScrollView(this).apply { addView(col) })
    }
}
