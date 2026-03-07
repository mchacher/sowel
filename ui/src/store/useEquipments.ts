import { create } from "zustand";
import type { Equipment, EquipmentType, EquipmentWithDetails } from "../types";
import {
  getEquipments,
  createEquipment as apiCreateEquipment,
  updateEquipment as apiUpdateEquipment,
  deleteEquipment as apiDeleteEquipment,
  executeEquipmentOrder as apiExecuteOrder,
  addDataBinding as apiAddDataBinding,
  removeDataBinding as apiRemoveDataBinding,
  addOrderBinding as apiAddOrderBinding,
  removeOrderBinding as apiRemoveOrderBinding,
} from "../api";
import { useOrderTiming } from "./useOrderTiming";

interface EquipmentsState {
  equipments: EquipmentWithDetails[];
  loading: boolean;
  error: string | null;

  // Actions
  fetchEquipments: () => Promise<void>;
  createEquipment: (data: {
    name: string;
    type: EquipmentType;
    zoneId: string;
    icon?: string;
    description?: string;
  }) => Promise<Equipment>;
  updateEquipment: (
    id: string,
    updates: {
      name?: string;
      type?: EquipmentType;
      zoneId?: string;
      icon?: string | null;
      description?: string | null;
      enabled?: boolean;
    }
  ) => Promise<void>;
  deleteEquipment: (id: string) => Promise<void>;
  executeOrder: (equipmentId: string, alias: string, value: unknown) => Promise<void>;
  addDataBinding: (equipmentId: string, deviceDataId: string, alias: string) => Promise<void>;
  removeDataBinding: (equipmentId: string, bindingId: string) => Promise<void>;
  addOrderBinding: (equipmentId: string, deviceOrderId: string, alias: string) => Promise<void>;
  removeOrderBinding: (equipmentId: string, bindingId: string) => Promise<void>;

  // WebSocket handlers
  handleEquipmentCreated: () => void;
  handleEquipmentUpdated: () => void;
  handleEquipmentRemoved: () => void;
  handleEquipmentDataChanged: (equipmentId: string, alias: string, value: unknown) => void;
}

export const useEquipments = create<EquipmentsState>((set, get) => ({
  equipments: [],
  loading: false,
  error: null,

  fetchEquipments: async () => {
    set({ loading: true, error: null });
    try {
      const equipments = await getEquipments();
      set({ equipments, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch equipments",
      });
    }
  },

  createEquipment: async (data) => {
    const equipment = await apiCreateEquipment(data);
    await get().fetchEquipments();
    return equipment;
  },

  updateEquipment: async (id, updates) => {
    await apiUpdateEquipment(id, updates);
    await get().fetchEquipments();
  },

  deleteEquipment: async (id) => {
    await apiDeleteEquipment(id);
    await get().fetchEquipments();
  },

  executeOrder: async (equipmentId, alias, value) => {
    useOrderTiming.getState().markSent(equipmentId, alias);
    await apiExecuteOrder(equipmentId, alias, value);
  },

  addDataBinding: async (equipmentId, deviceDataId, alias) => {
    await apiAddDataBinding(equipmentId, { deviceDataId, alias });
    await get().fetchEquipments();
  },

  removeDataBinding: async (equipmentId, bindingId) => {
    await apiRemoveDataBinding(equipmentId, bindingId);
    await get().fetchEquipments();
  },

  addOrderBinding: async (equipmentId, deviceOrderId, alias) => {
    await apiAddOrderBinding(equipmentId, { deviceOrderId, alias });
    await get().fetchEquipments();
  },

  removeOrderBinding: async (equipmentId, bindingId) => {
    await apiRemoveOrderBinding(equipmentId, bindingId);
    await get().fetchEquipments();
  },

  // WebSocket handlers
  handleEquipmentCreated: () => { get().fetchEquipments(); },
  handleEquipmentUpdated: () => { get().fetchEquipments(); },
  handleEquipmentRemoved: () => { get().fetchEquipments(); },
  handleEquipmentDataChanged: (equipmentId, alias, value) => {
    useOrderTiming.getState().markReceived(equipmentId, alias);
    const now = new Date().toISOString();
    set((state) => ({
      equipments: state.equipments.map((eq) => {
        if (eq.id !== equipmentId) return eq;
        return {
          ...eq,
          dataBindings: eq.dataBindings.map((db) => {
            if (db.alias !== alias) return db;
            const valueChanged = JSON.stringify(db.value) !== JSON.stringify(value);
            return { ...db, value, lastUpdated: now, lastChanged: valueChanged ? now : db.lastChanged };
          }),
        };
      }),
    }));
  },
}));
