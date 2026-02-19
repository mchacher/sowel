import { create } from "zustand";
import type { Device, DeviceData, DeviceStatus } from "../types";
import { getDevices, updateDevice, type DeviceWithData } from "../api";

interface DevicesState {
  /** All devices indexed by id */
  devices: Record<string, Device>;
  /** Device data arrays indexed by deviceId */
  deviceData: Record<string, DeviceData[]>;
  /** Loading state for initial fetch */
  loading: boolean;
  /** Error message if fetch failed */
  error: string | null;

  // Actions
  fetchDevices: () => Promise<void>;
  addDevice: (device: Device) => void;
  removeDevice: (deviceId: string) => void;
  updateDeviceStatus: (deviceId: string, status: DeviceStatus) => void;
  updateDeviceDataValue: (
    deviceId: string,
    key: string,
    value: unknown,
    timestamp: string
  ) => void;
  updateDeviceName: (deviceId: string, name: string) => Promise<void>;
}

export const useDevices = create<DevicesState>((set, get) => ({
  devices: {},
  deviceData: {},
  loading: false,
  error: null,

  fetchDevices: async () => {
    set({ loading: true, error: null });
    try {
      const result: DeviceWithData[] = await getDevices();
      const devices: Record<string, Device> = {};
      const deviceData: Record<string, DeviceData[]> = {};

      for (const d of result) {
        const { data, ...device } = d;
        devices[device.id] = device;
        deviceData[device.id] = data;
      }

      set({ devices, deviceData, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch devices",
      });
    }
  },

  addDevice: (device) => {
    set((state) => ({
      devices: { ...state.devices, [device.id]: device },
      deviceData: { ...state.deviceData, [device.id]: state.deviceData[device.id] ?? [] },
    }));
  },

  removeDevice: (deviceId) => {
    set((state) => {
      const { [deviceId]: _removed, ...devices } = state.devices;
      const { [deviceId]: _removedData, ...deviceData } = state.deviceData;
      return { devices, deviceData };
    });
  },

  updateDeviceStatus: (deviceId, status) => {
    set((state) => {
      const device = state.devices[deviceId];
      if (!device) return state;
      const now = new Date().toISOString();
      return {
        devices: {
          ...state.devices,
          [deviceId]: { ...device, status, lastSeen: now, updatedAt: now },
        },
      };
    });
  },

  updateDeviceDataValue: (deviceId, key, value, timestamp) => {
    set((state) => {
      const dataArr = state.deviceData[deviceId];
      if (!dataArr) return state;

      const updated = dataArr.map((d) =>
        d.key === key ? { ...d, value, lastUpdated: timestamp } : d
      );

      // Also update device lastSeen
      const device = state.devices[deviceId];
      const devices = device
        ? { ...state.devices, [deviceId]: { ...device, lastSeen: timestamp } }
        : state.devices;

      return { devices, deviceData: { ...state.deviceData, [deviceId]: updated } };
    });
  },

  updateDeviceName: async (deviceId, name) => {
    const state = get();
    const device = state.devices[deviceId];
    if (!device) return;

    // Optimistic update
    set({
      devices: { ...state.devices, [deviceId]: { ...device, name } },
    });

    try {
      await updateDevice(deviceId, { name });
    } catch {
      // Revert on failure
      set((s) => ({
        devices: { ...s.devices, [deviceId]: device },
      }));
      throw new Error("Failed to update device name");
    }
  },
}));
