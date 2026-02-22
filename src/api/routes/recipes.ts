import type { FastifyInstance } from "fastify";
import type { RecipeManager } from "../../recipes/engine/recipe-manager.js";
import { RecipeError } from "../../recipes/engine/recipe-manager.js";
import type { Logger } from "../../core/logger.js";

interface RecipesDeps {
  recipeManager: RecipeManager;
  logger: Logger;
}

export function registerRecipeRoutes(app: FastifyInstance, deps: RecipesDeps): void {
  const { recipeManager } = deps;

  // GET /api/v1/recipes — List available recipe definitions
  app.get("/api/v1/recipes", async () => {
    return recipeManager.getRecipes();
  });

  // GET /api/v1/recipes/:recipeId — Get recipe definition with slots
  app.get<{ Params: { recipeId: string } }>("/api/v1/recipes/:recipeId", async (request, reply) => {
    const recipe = recipeManager.getRecipeById(request.params.recipeId);
    if (!recipe) {
      return reply.code(404).send({ error: "Recipe not found" });
    }
    return recipe;
  });

  // GET /api/v1/recipe-instances — List all active instances
  app.get("/api/v1/recipe-instances", async () => {
    return recipeManager.getInstances();
  });

  // POST /api/v1/recipe-instances — Create instance { recipeId, params }
  app.post<{
    Body: {
      recipeId: string;
      params: Record<string, unknown>;
    };
  }>("/api/v1/recipe-instances", async (request, reply) => {
    const { recipeId, params } = request.body ?? {};

    if (!recipeId) {
      return reply.code(400).send({ error: "recipeId is required" });
    }
    if (!params || typeof params !== "object") {
      return reply.code(400).send({ error: "params object is required" });
    }

    try {
      const instance = recipeManager.createInstance(recipeId, params);
      return reply.code(201).send(instance);
    } catch (err) {
      if (err instanceof RecipeError) {
        return reply.code(err.status).send({ error: err.message });
      }
      throw err;
    }
  });

  // PUT /api/v1/recipe-instances/:id — Update instance params
  app.put<{
    Params: { id: string };
    Body: { params: Record<string, unknown> };
  }>("/api/v1/recipe-instances/:id", async (request, reply) => {
    const { params } = request.body ?? {};
    if (!params || typeof params !== "object") {
      return reply.code(400).send({ error: "params object is required" });
    }
    try {
      const instance = recipeManager.updateInstance(request.params.id, params);
      return instance;
    } catch (err) {
      if (err instanceof RecipeError) {
        return reply.code(err.status).send({ error: err.message });
      }
      throw err;
    }
  });

  // DELETE /api/v1/recipe-instances/:id — Stop and delete instance
  app.delete<{ Params: { id: string } }>("/api/v1/recipe-instances/:id", async (request, reply) => {
    try {
      recipeManager.deleteInstance(request.params.id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof RecipeError) {
        return reply.code(err.status).send({ error: err.message });
      }
      throw err;
    }
  });

  // POST /api/v1/recipe-instances/:id/enable — Enable instance
  app.post<{ Params: { id: string } }>(
    "/api/v1/recipe-instances/:id/enable",
    async (request, reply) => {
      try {
        recipeManager.enableInstance(request.params.id);
        return { success: true };
      } catch (err) {
        if (err instanceof RecipeError) {
          return reply.code(err.status).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  // POST /api/v1/recipe-instances/:id/disable — Disable instance
  app.post<{ Params: { id: string } }>(
    "/api/v1/recipe-instances/:id/disable",
    async (request, reply) => {
      try {
        recipeManager.disableInstance(request.params.id);
        return { success: true };
      } catch (err) {
        if (err instanceof RecipeError) {
          return reply.code(err.status).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  // GET /api/v1/recipe-instances/:id/log — Get execution log
  app.get<{
    Params: { id: string };
    Querystring: { limit?: string };
  }>("/api/v1/recipe-instances/:id/log", async (request) => {
    const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
    return recipeManager.getLog(request.params.id, limit);
  });
}
