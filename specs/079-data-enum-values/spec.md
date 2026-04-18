# Spec 079 — Device Data Enum Values

## Summary

Store enum values for device data entries (read-only properties like `action`), the same way they are already stored for device orders (writable properties). This allows the UI to display the actual possible values instead of hardcoding them.

## Problem

The `device_orders` table stores `enum_values` (e.g., `["ON","OFF"]`), and this is exposed through `OrderBindingWithDetails`. But `device_data` does not store enum values. For button/remote equipment, the `action` property is read-only (data, not order), so its possible values (`1_single`, `2_double`, etc.) are lost after discovery. The button action UI hardcodes `["single", "double", "hold"]` which doesn't work for multi-button remotes.

## Requirements

### R1 — Store enum values in device_data

When a plugin discovers a device with enum-type data properties, store the possible values in the `device_data` table.

### R2 — Expose enum values in DataBindingWithValue

The equipment data binding response includes `enumValues` so the UI can use them.

### R3 — Dynamic action values in button action UI

The button action configuration form uses the equipment's `action` data binding enum values instead of a hardcoded list. Fallback to `["single", "double", "hold"]` if no enum values are available.

## Acceptance Criteria

- [x] AC1: `device_data` table has an `enum_values` column (JSON)
- [x] AC2: `DiscoveredDevice.data` entries support optional `enumValues`
- [x] AC3: Device manager stores and reads enum values for data entries
- [x] AC4: `DataBindingWithValue` includes `enumValues?: string[]`
- [x] AC5: Equipment manager SQL query joins enum values from device_data
- [x] AC6: Z2M plugin sends enum values for enum-type data properties
- [x] AC7: Button action UI shows dynamic action values from equipment data
- [x] AC8: Fallback to `["single", "double", "hold"]` when no enum values

## Scope

### In scope

- Migration to add `enum_values` to `device_data`
- Backend types, device manager, equipment manager
- Z2M plugin: include `enumValues` in data entries
- UI: dynamic action values in ButtonActionsSection

### Out of scope

- Other plugins (they can adopt `enumValues` in data later)
- Grouping action values by button number (UI shows flat list)
- New equipment types
