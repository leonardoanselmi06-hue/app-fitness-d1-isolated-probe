package app.fitness.collector

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Impostazioni nel solo spazio privato dell'app. Il client secret si digita qui sul telefono: non passa mai da chat o repo. */
class Config(ctx: Context) {
    private val p = ctx.applicationContext.getSharedPreferences("collector", Context.MODE_PRIVATE)
    var baseUrl: String
        get() = p.getString("url", "https://app-fitness.leonardo-anselmi06.workers.dev")!!
        set(v) = p.edit().putString("url", v.trim().trimEnd('/')).apply()
    var clientId: String
        get() = p.getString("cid", "")!!
        set(v) = p.edit().putString("cid", v.trim()).apply()
    /** Cifrato con una chiave AES-GCM dell'Android Keystore (non esportabile). Un eventuale valore in chiaro di versioni precedenti viene migrato alla prima lettura. */
    var clientSecret: String
        get() {
            p.getString("cse", null)?.let { return open(it) ?: "" }
            val old = p.getString("cs", null) ?: return ""
            p.edit().putString("cse", seal(old)).remove("cs").apply()
            return old
        }
        set(v) = p.edit().putString("cse", seal(v.trim())).remove("cs").apply()
    val deviceId: String
        get() = p.getString("did", null) ?: ("phone-" + UUID.randomUUID().toString().take(8)).also { p.edit().putString("did", it).apply() }
    var lastResult: String
        get() = p.getString("last", "Nessuna sincronizzazione ancora.")!!
        set(v) = p.edit().putString("last", v).apply()
    val ready get() = baseUrl.startsWith("https://") && clientId.isNotEmpty() && clientSecret.isNotEmpty()

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        g.init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
        return g.generateKey()
    }

    private fun seal(plain: String): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.ENCRYPT_MODE, key())
        return Base64.encodeToString(c.iv + c.doFinal(plain.toByteArray()), Base64.NO_WRAP)
    }

    private fun open(sealed: String): String? = try {
        val b = Base64.decode(sealed, Base64.NO_WRAP)
        val c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, b.copyOfRange(0, 12)))
        String(c.doFinal(b, 12, b.size - 12))
    } catch (e: Exception) { null }

    private companion object { const val ALIAS = "collector_secret_v1" }
}
