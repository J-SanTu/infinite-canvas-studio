import { listLocalApiSettings } from "./backend-api-config.js";

export async function listModelCatalog(_workspace, filters = {}) {
    const settings = await listLocalApiSettings();
    const capability = String(filters.capability || "")
        .trim()
        .toLowerCase();
    return Object.entries(settings).flatMap(([kind, config]) =>
        kind === "tinify" || (capability && capability !== kind)
            ? []
            : (config.channels || [config]).flatMap((channel) =>
                  channel.models.map((id) => ({
                      id: channel.id === `${kind}-default` ? id : `${channel.id}::${id}`,
                      modelId: id,
                      channelId: channel.id,
                      label: `${channel.name} / ${id}`,
                      capability: kind,
                      supportsReferences: false,
                      tags: [],
                      enabled: true,
                      updatedAt: channel.modelsFetchedAt,
                  })),
              ),
    );
}
