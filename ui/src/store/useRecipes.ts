import { create } from "zustand";
import type { RecipeInfo, RecipeInstance, RecipeLogEntry } from "../types";
import {
  getRecipes,
  getRecipeInstances,
  createRecipeInstance,
  updateRecipeInstance,
  deleteRecipeInstance,
  enableRecipeInstance,
  disableRecipeInstance,
  getRecipeInstanceLog,
} from "../api";

interface RecipesState {
  recipes: RecipeInfo[];
  instances: RecipeInstance[];
  loading: boolean;
  error: string | null;
  fetchRecipes: () => Promise<void>;
  fetchInstances: () => Promise<void>;
  createInstance: (recipeId: string, params: Record<string, unknown>) => Promise<RecipeInstance>;
  updateInstance: (instanceId: string, params: Record<string, unknown>) => Promise<void>;
  deleteInstance: (instanceId: string) => Promise<void>;
  enableInstance: (instanceId: string) => Promise<void>;
  disableInstance: (instanceId: string) => Promise<void>;
  getLog: (instanceId: string) => Promise<RecipeLogEntry[]>;
  handleInstanceChanged: () => void;
}

export const useRecipes = create<RecipesState>((set, get) => ({
  recipes: [],
  instances: [],
  loading: false,
  error: null,

  fetchRecipes: async () => {
    try {
      const recipes = await getRecipes();
      set({ recipes });
    } catch {
      // Ignore — API may not be ready yet (recipes are static metadata)
    }
  },

  fetchInstances: async () => {
    set({ loading: true, error: null });
    try {
      const instances = await getRecipeInstances();
      set({ instances, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to fetch recipe instances",
      });
    }
  },

  createInstance: async (recipeId, params) => {
    const instance = await createRecipeInstance(recipeId, params);
    await get().fetchInstances();
    return instance;
  },

  updateInstance: async (instanceId, params) => {
    await updateRecipeInstance(instanceId, params);
    await get().fetchInstances();
  },

  deleteInstance: async (instanceId) => {
    await deleteRecipeInstance(instanceId);
    await get().fetchInstances();
  },

  enableInstance: async (instanceId) => {
    await enableRecipeInstance(instanceId);
    await get().fetchInstances();
  },

  disableInstance: async (instanceId) => {
    await disableRecipeInstance(instanceId);
    await get().fetchInstances();
  },

  getLog: async (instanceId) => {
    return getRecipeInstanceLog(instanceId);
  },

  handleInstanceChanged: () => {
    get().fetchInstances();
  },
}));
