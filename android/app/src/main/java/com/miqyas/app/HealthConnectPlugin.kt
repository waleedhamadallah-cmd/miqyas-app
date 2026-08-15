package com.miqyas.app

import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.HydrationRecord
import androidx.health.connect.client.records.NutritionRecord
import androidx.health.connect.client.records.metadata.Device
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.units.grams
import androidx.health.connect.client.units.kilocalories
import androidx.health.connect.client.units.milliliters
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
import java.time.ZoneId

/**
 * Write-only bridge from the web app to Android's Health Connect, so other
 * apps on the phone (Samsung Health, etc.) can see مِقياس's nutrition and
 * hydration logging. Deliberately one-directional per the user's choice —
 * مِقياس never reads anything back from Health Connect, so there's no risk
 * of another app's data overwriting what the user logged here.
 *
 * Called from docs/js/core.js's syncHealthConnectNutrition()/
 * syncHealthConnectHydration(), themselves invoked from the exact spots a
 * meal or a water amount is actually added (not from persist() in general —
 * Health Connect's own guidance is to write one narrow-time-window record
 * per real event, not a recomputed whole-day total on every edit).
 */
@CapacitorPlugin(name = "MiqyasHealth")
class HealthConnectPlugin : Plugin() {

    private val writePermissions = setOf(
        HealthPermission.getWritePermission(NutritionRecord::class),
        HealthPermission.getWritePermission(HydrationRecord::class)
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
                ret.put("granted", granted.containsAll(writePermissions))
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("hasPermissions failed: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun requestPermissions(call: PluginCall) {
        if (getClientOrNull() == null) {
            call.reject("Health Connect غير متوفر على هذا الجهاز")
            return
        }
        val contract = PermissionController.createRequestPermissionResultContract()
        val intent = contract.createIntent(activity, writePermissions)
        startActivityForResult(call, intent, "onPermissionsResult")
    }

    @ActivityCallback
    private fun onPermissionsResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val contract = PermissionController.createRequestPermissionResultContract()
        val granted = contract.parseResult(result.resultCode, result.data)
        val ret = JSObject()
        ret.put("granted", granted.containsAll(writePermissions))
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
                client.insertRecords(listOf(record))
                val ret = JSObject()
                ret.put("ok", true)
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("writeNutrition failed: ${e.message}")
            }
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
}
