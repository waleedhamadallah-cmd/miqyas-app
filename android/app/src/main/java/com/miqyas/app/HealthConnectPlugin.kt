package com.miqyas.app

import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.HydrationRecord
import androidx.health.connect.client.records.NutritionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.records.metadata.Device
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.health.connect.client.units.grams
import androidx.health.connect.client.units.kilocalories
import androidx.health.connect.client.units.kilograms
import androidx.health.connect.client.units.milliliters
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.Period
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Bridge between the web app and Android's Health Connect.
 *
 * WRITE side (nutrition + hydration): so other apps on the phone (Samsung
 * Health, etc.) can see مِقياس's own logging. Called from docs/js/core.js's
 * syncHealthConnectNutrition()/syncHealthConnectHydration(), themselves
 * invoked from the exact spots a meal or a water amount is actually added
 * (not from persist() in general — Health Connect's own guidance is to
 * write one narrow-time-window record per real event, not a recomputed
 * whole-day total on every edit).
 *
 * READ side (steps only): مِقياس has no step sensor or step-logging UI of
 * its own — a wearable's companion app (e.g. Zepp) is the one writing
 * StepsRecord entries to Health Connect, and this plugin only ever reads
 * that back to display it. Deliberately narrow: no other record type is
 * ever read, and only the last 7 days are ever requested (foreground,
 * on-demand), which needs nothing beyond the base READ_STEPS permission —
 * no history or background-read permission is requested. Step totals are
 * read via aggregate()/aggregateGroupByPeriod() rather than summing raw
 * records, so Health Connect's own priority-based dedupe applies
 * automatically when more than one source (e.g. phone + watch) reports
 * steps for the same period — see readTodaySteps()/readStepsHistory() below.
 */
@CapacitorPlugin(name = "MiqyasHealth")
class HealthConnectPlugin : Plugin() {

    private val healthPermissions = setOf(
        HealthPermission.getWritePermission(NutritionRecord::class),
        HealthPermission.getWritePermission(HydrationRecord::class),
        HealthPermission.getWritePermission(WeightRecord::class),
        HealthPermission.getReadPermission(StepsRecord::class)
    )

    private fun getClientOrNull(): HealthConnectClient? {
        return try {
            if (HealthConnectClient.getSdkStatus(context) != HealthConnectClient.SDK_AVAILABLE) null
            else HealthConnectClient.getOrCreate(context)
        } catch (e: Exception) {
            null
        }
    }

    @PluginMethod
    fun checkAvailability(call: PluginCall) {
        val status = HealthConnectClient.getSdkStatus(context)
        val ret = JSObject()
        ret.put("available", status == HealthConnectClient.SDK_AVAILABLE)
        ret.put("needsProviderUpdate", status == HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED)
        call.resolve(ret)
    }

    @PluginMethod
    fun hasPermissions(call: PluginCall) {
        val client = getClientOrNull()
        if (client == null) {
            val ret = JSObject()
            ret.put("granted", false)
            call.resolve(ret)
            return
        }
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val granted = client.permissionController.getGrantedPermissions()
                val ret = JSObject()
                ret.put("granted", granted.containsAll(healthPermissions))
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("hasPermissions failed: ${e.message}")
            }
        }
    }

    // NOTE: deliberately NOT named "requestPermissions" — Capacitor's own
    // Plugin base class already declares an open member with that exact
    // name (part of its standard @Permission-annotation permission system),
    // so a same-named Kotlin function here silently overrides it and fails
    // to compile ("hides member of supertype ... needs an 'override' modifier").
    // This plugin doesn't use Capacitor's standard permission system at all
    // (Health Connect has its own permission model), hence the distinct name.
    @PluginMethod
    fun requestHealthPermissions(call: PluginCall) {
        if (getClientOrNull() == null) {
            call.reject("Health Connect غير متوفر على هذا الجهاز")
            return
        }
        val contract = PermissionController.createRequestPermissionResultContract()
        val intent = contract.createIntent(activity, healthPermissions)
        startActivityForResult(call, intent, "onHealthPermissionsResult")
    }

    @ActivityCallback
    private fun onHealthPermissionsResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val contract = PermissionController.createRequestPermissionResultContract()
        val granted = contract.parseResult(result.resultCode, result.data)
        val ret = JSObject()
        ret.put("granted", granted.containsAll(healthPermissions))
        call.resolve(ret)
    }

    @PluginMethod
    fun writeNutrition(call: PluginCall) {
        val client = getClientOrNull()
        if (client == null) {
            call.reject("Health Connect غير متوفر")
            return
        }
        val name = call.getString("name", "وجبة") ?: "وجبة"
        val calories = call.getDouble("calories") ?: 0.0
        val protein = call.getDouble("protein") ?: 0.0
        val carbs = call.getDouble("carbs") ?: 0.0
        val fat = call.getDouble("fat") ?: 0.0

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val end = Instant.now()
                val start = end.minusSeconds(60)
                val zone = ZoneId.systemDefault().rules
                val record = NutritionRecord(
                    name = name,
                    energy = calories.kilocalories,
                    protein = protein.grams,
                    totalCarbohydrate = carbs.grams,
                    totalFat = fat.grams,
                    startTime = start,
                    endTime = end,
                    startZoneOffset = zone.getOffset(start),
                    endZoneOffset = zone.getOffset(end),
                    metadata = Metadata.activelyRecorded(device = Device(type = Device.TYPE_PHONE))
                )
                val insertResponse = client.insertRecords(listOf(record))
                val ret = JSObject()
                ret.put("ok", true)
                // Returned so the JS side (syncHealthConnectNutrition() in
                // docs/js/core.js) can stash this specific record's ID on the
                // meal entry — needed to find and remove/replace the exact
                // right record later if that meal gets edited or deleted
                // (see deleteNutrition below), instead of Health Connect
                // silently accumulating an orphaned record per edit/delete.
                ret.put("recordId", insertResponse.recordIdsList.firstOrNull())
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("writeNutrition failed: ${e.message}")
            }
        }
    }

    // Removes a single previously-written NutritionRecord by its Health
    // Connect record ID (see writeNutrition's returned "recordId" above).
    // Called from docs/js/core.js's syncHealthConnectDeleteNutrition()
    // whenever a synced meal is edited (delete-old + write-new) or deleted
    // outright, so Health Connect (and anything reading from it, e.g.
    // Samsung Health) stays in sync with مِقياس's own log instead of
    // permanently keeping a record for a meal the user no longer has.
    // Best-effort like every other call here: a recordId that's already
    // gone (double-delete, older data from before this existed) is not
    // treated as an error — there's nothing meaningful to surface to the
    // user for a background sync's stale/missing record.
    @PluginMethod
    fun deleteNutrition(call: PluginCall) {
        val client = getClientOrNull()
        if (client == null) {
            call.reject("Health Connect غير متوفر")
            return
        }
        val recordId = call.getString("recordId")
        if (recordId.isNullOrEmpty()) {
            val ret = JSObject()
            ret.put("ok", true)
            call.resolve(ret)
            return
        }
        CoroutineScope(Dispatchers.IO).launch {
            try {
                client.deleteRecords(
                    recordType = NutritionRecord::class,
                    recordIdsList = listOf(recordId),
                    clientRecordIdsList = emptyList()
                )
            } catch (e: Exception) {
                // Swallowed on purpose — see method doc comment above.
            }
            val ret = JSObject()
            ret.put("ok", true)
            call.resolve(ret)
        }
    }

    @PluginMethod
    fun writeHydration(call: PluginCall) {
        val client = getClientOrNull()
        if (client == null) {
            call.reject("Health Connect غير متوفر")
            return
        }
        val volumeMl = call.getDouble("volumeMl") ?: 0.0
        if (volumeMl <= 0.0) {
            call.reject("volumeMl must be positive")
            return
        }

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val end = Instant.now()
                val start = end.minusSeconds(60)
                val zone = ZoneId.systemDefault().rules
                val record = HydrationRecord(
                    volume = volumeMl.milliliters,
                    startTime = start,
                    endTime = end,
                    startZoneOffset = zone.getOffset(start),
                    endZoneOffset = zone.getOffset(end),
                    metadata = Metadata.activelyRecorded(device = Device(type = Device.TYPE_PHONE))
                )
                client.insertRecords(listOf(record))
                val ret = JSObject()
                ret.put("ok", true)
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("writeHydration failed: ${e.message}")
            }
        }
    }

    // Body weight — called from docs/js/progress.js's syncHealthConnectWeight(),
    // itself invoked from the Progress-tab weight sheet's save handler and
    // from onboarding's first-weight step, same as nutrition/hydration are
    // called from the exact spots the user actually logs something.
    //
    // Unlike nutrition/hydration (always "just now"), a weight entry can be
    // for a past date (the weight sheet lets you edit an earlier day) — an
    // optional "dateKey" ("yyyy-MM-dd") lets the JS side say which day this
    // measurement is actually for. Today's own entry still uses the real
    // current instant (so same-day edits keep updating "now"); a past date
    // is recorded at local noon that day — an arbitrary but reasonable
    // placeholder time, since مِقياس only ever captures a date for body
    // weight, never a time of day.
    @PluginMethod
    fun writeWeight(call: PluginCall) {
        val client = getClientOrNull()
        if (client == null) {
            call.reject("Health Connect غير متوفر")
            return
        }
        val weightKg = call.getDouble("weightKg") ?: 0.0
        if (weightKg <= 0.0) {
            call.reject("weightKg must be positive")
            return
        }
        val dateKey = call.getString("dateKey")

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val zone = ZoneId.systemDefault()
                val today = LocalDate.now(zone)
                val time = if (dateKey.isNullOrEmpty()) {
                    Instant.now()
                } else {
                    try {
                        val date = LocalDate.parse(dateKey, DateTimeFormatter.ISO_LOCAL_DATE)
                        if (date == today) Instant.now() else date.atTime(12, 0).atZone(zone).toInstant()
                    } catch (e: Exception) {
                        Instant.now()
                    }
                }
                val record = WeightRecord(
                    weight = weightKg.kilograms,
                    time = time,
                    zoneOffset = zone.rules.getOffset(time),
                    metadata = Metadata.activelyRecorded(device = Device(type = Device.TYPE_PHONE))
                )
                val insertResponse = client.insertRecords(listOf(record))
                val ret = JSObject()
                ret.put("ok", true)
                ret.put("recordId", insertResponse.recordIdsList.firstOrNull())
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("writeWeight failed: ${e.message}")
            }
        }
    }

    // Delete-side counterpart to writeWeight, mirroring deleteNutrition
    // above — a weight entry logged for a given day can be overwritten
    // (re-saving that same day with a new number), which needs the old
    // Health Connect record removed first or it'd leave a stale duplicate
    // behind forever. Same best-effort semantics as deleteNutrition.
    @PluginMethod
    fun deleteWeight(call: PluginCall) {
        val client = getClientOrNull()
        if (client == null) {
            call.reject("Health Connect غير متوفر")
            return
        }
        val recordId = call.getString("recordId")
        if (recordId.isNullOrEmpty()) {
            val ret = JSObject()
            ret.put("ok", true)
            call.resolve(ret)
            return
        }
        CoroutineScope(Dispatchers.IO).launch {
            try {
                client.deleteRecords(
                    recordType = WeightRecord::class,
                    recordIdsList = listOf(recordId),
                    clientRecordIdsList = emptyList()
                )
            } catch (e: Exception) {
                // Swallowed on purpose — see deleteNutrition's doc comment above.
            }
            val ret = JSObject()
            ret.put("ok", true)
            call.resolve(ret)
        }
    }

    // Today's total, local-midnight to now. Uses aggregate() rather than
    // reading+summing raw StepsRecord entries — per Health Connect's own
    // guidance this is both the recommended API for a single-range total
    // AND the one that gets Health Connect's built-in priority-based
    // dedupe for free when more than one app (phone sensor + a paired
    // wearable's companion app) writes overlapping step data.
    @PluginMethod
    fun readTodaySteps(call: PluginCall) {
        val client = getClientOrNull()
        if (client == null) {
            call.reject("Health Connect غير متوفر")
            return
        }
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val zone = ZoneId.systemDefault()
                val start = LocalDate.now(zone).atStartOfDay(zone).toInstant()
                val end = Instant.now()
                val response = client.aggregate(
                    AggregateRequest(
                        metrics = setOf(StepsRecord.COUNT_TOTAL),
                        timeRangeFilter = TimeRangeFilter.between(start, end)
                    )
                )
                val ret = JSObject()
                ret.put("steps", response[StepsRecord.COUNT_TOTAL] ?: 0L)
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("readTodaySteps failed: ${e.message}")
            }
        }
    }

    // Trailing N calendar days (today inclusive) in ONE call via
    // aggregateGroupByPeriod() — the Health-Connect-recommended way to get
    // a multi-day trend, instead of looping aggregate() N times. `days`
    // comes from the JS caller (defaults to 7 for the Home card's weekly
    // preview, 30 for the Progress-tab monthly view) — capped at 30, which
    // is the window Health Connect grants by default; anything older would
    // need the extra READ_HEALTH_DATA_HISTORY permission, which this app
    // deliberately doesn't request (see class doc).
    // aggregateGroupByPeriod requires LocalDateTime (not Instant) bounds —
    // Period.ofDays(1) is a calendar concept, so it can't be expressed as a
    // fixed Instant duration. Its result is sparse (a day with zero
    // matching records is omitted entirely, not returned as a 0), so every
    // day is pre-seeded at 0 below before filling in whatever the API did
    // return, guaranteeing the caller always gets exactly `days` entries.
    @PluginMethod
    fun readStepsHistory(call: PluginCall) {
        val client = getClientOrNull()
        if (client == null) {
            call.reject("Health Connect غير متوفر")
            return
        }
        val days = (call.getInt("days") ?: 7).coerceIn(1, 30)
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val zone = ZoneId.systemDefault()
                val todayLocal = LocalDate.now(zone)
                val rangeStart = todayLocal.minusDays((days - 1).toLong()).atStartOfDay()
                val rangeEnd = todayLocal.plusDays(1).atStartOfDay()
                val buckets = client.aggregateGroupByPeriod(
                    AggregateGroupByPeriodRequest(
                        metrics = setOf(StepsRecord.COUNT_TOTAL),
                        timeRangeFilter = TimeRangeFilter.between(rangeStart, rangeEnd),
                        timeRangeSlicer = Period.ofDays(1)
                    )
                )
                val fmt = DateTimeFormatter.ISO_LOCAL_DATE
                val byDate = HashMap<String, Long>()
                for (i in 0 until days) {
                    byDate[todayLocal.minusDays((days - 1 - i).toLong()).format(fmt)] = 0L
                }
                for (bucket in buckets) {
                    val dateKey = bucket.startTime.toLocalDate().format(fmt)
                    if (byDate.containsKey(dateKey)) {
                        byDate[dateKey] = bucket.result[StepsRecord.COUNT_TOTAL] ?: 0L
                    }
                }
                val arr = JSArray()
                for (i in 0 until days) {
                    val dateKey = todayLocal.minusDays((days - 1 - i).toLong()).format(fmt)
                    val entry = JSObject()
                    entry.put("date", dateKey)
                    entry.put("steps", byDate[dateKey] ?: 0L)
                    arr.put(entry)
                }
                val ret = JSObject()
                ret.put("days", arr)
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("readStepsHistory failed: ${e.message}")
            }
        }
    }
}
