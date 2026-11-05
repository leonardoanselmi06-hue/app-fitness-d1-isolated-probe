package app.fitness.collector

import android.content.Context
import androidx.work.*
import java.util.concurrent.TimeUnit

class SyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val msg = try { Collector.syncNow(applicationContext) } catch (e: Exception) { "Errore: ${e.javaClass.simpleName}" }
        Config(applicationContext).lastResult = "${java.time.LocalDateTime.now().withNano(0)} (automatica) $msg"
        return Result.success()
    }
    companion object {
        fun schedule(ctx: Context) {
            val req = PeriodicWorkRequestBuilder<SyncWorker>(6, TimeUnit.HOURS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("collector-sync", ExistingPeriodicWorkPolicy.UPDATE, req)
        }
    }
}
