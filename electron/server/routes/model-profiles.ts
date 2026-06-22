import type { Application } from "express";
import type { ModelProfile } from "../../../src/shared/types";
import { normalizeProviderId } from "../../../src/shared/providers";
import { deleteModelProfile, discoverModels, getStoredModelProfileApiKey, listModelProfiles, refreshModelProfileContext, saveModelProfile } from "../model-profiles";
import { getWebSettings } from "../settings";
import { toErrorMessage } from "../utils";

export function registerModelProfileRoutes(app: Application) {
  app.get("/api/model-profiles", async (_req, res) => {
    res.json(await listModelProfiles());
  });

  app.post("/api/model-profiles/discover", async (req, res) => {
    const { apiBase, apiKey, providerId, profileId } = req.body as {
      apiBase?: string;
      apiKey?: string;
      providerId?: string;
      profileId?: string;
    };
    try {
      const savedApiKey = profileId ? await getStoredModelProfileApiKey(profileId) : "";
      const fallbackApiKey = getWebSettings().apiKey ?? "";
      res.json(await discoverModels(
        apiBase ?? "",
        apiKey?.trim() || savedApiKey || fallbackApiKey,
        normalizeProviderId(providerId)
      ));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error) });
    }
  });

  app.post("/api/model-profiles", async (req, res) => {
    const profile = req.body as Partial<ModelProfile> & Pick<ModelProfile, "name" | "model">;
    if (!profile.name?.trim()) return res.status(400).json({ error: "name required" });
    if (!profile.model?.trim()) return res.status(400).json({ error: "model required" });
    const fallbackApiKey = getWebSettings().apiKey ?? "";
    const incomingApiKey = profile.apiKey?.trim() ?? "";
    const saved = await saveModelProfile({
      ...profile,
      apiKey: incomingApiKey || (!profile.id ? fallbackApiKey : ""),
    } as Partial<ModelProfile> & Pick<ModelProfile, "name" | "apiBase" | "model">);
    res.json(saved);
  });

  app.post("/api/model-profiles/:id/refresh-context", async (req, res) => {
    try {
      res.json(await refreshModelProfileContext(req.params.id));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error) });
    }
  });

  app.delete("/api/model-profiles/:id", async (req, res) => {
    await deleteModelProfile(req.params.id);
    res.json({ ok: true });
  });
}
