/**
 * Localized display copy for built-in plugins.
 *
 * Built-in plugin `title`/`description` are product copy shown in the UI, so we
 * translate them via the `Config` message namespace. They are matched by the
 * plugin `id` (a stable identifier), never by the displayed text. Everything
 * else stays as-is: `category` is an identifier used for filtering/matching, and
 * `functions[].description` plus parameter schemas are sent to the model as tool
 * declarations and must remain in English to keep tool-calling behavior stable.
 */

import { DEFAULT_MCP_SERVER_LOGO_URL } from "../mcp/defaults";

export type ConfigPluginKey =
  | "pluginJinaTitle"
  | "pluginJinaDescription"
  | "pluginDeepResearchTitle"
  | "pluginDeepResearchDescription"
  | "pluginWeatherTitle"
  | "pluginWeatherDescription"
  | "pluginUnsplashTitle"
  | "pluginUnsplashDescription"
  | "pluginAgnesImageTitle"
  | "pluginAgnesImageDescription"
  | "pluginGeminiImageTitle"
  | "pluginGeminiImageDescription"
  | "pluginOpenAIImageTitle"
  | "pluginOpenAIImageDescription"
  | "pluginOpenAIResponsesImageTitle"
  | "pluginOpenAIResponsesImageDescription"
  | "pluginAgnesVideoTitle"
  | "pluginAgnesVideoDescription";

const BUILT_IN_PLUGIN_I18N: Record<
  string,
  { titleKey: ConfigPluginKey; descriptionKey: ConfigPluginKey }
> = {
  "deep-research": {
    titleKey: "pluginDeepResearchTitle",
    descriptionKey: "pluginDeepResearchDescription",
  },
  "jina-web-reader": {
    titleKey: "pluginJinaTitle",
    descriptionKey: "pluginJinaDescription",
  },
  "weather-gpt": {
    titleKey: "pluginWeatherTitle",
    descriptionKey: "pluginWeatherDescription",
  },
  unsplash: {
    titleKey: "pluginUnsplashTitle",
    descriptionKey: "pluginUnsplashDescription",
  },
  "agnes-image-generation": {
    titleKey: "pluginAgnesImageTitle",
    descriptionKey: "pluginAgnesImageDescription",
  },
  "gemini-image-generation": {
    titleKey: "pluginGeminiImageTitle",
    descriptionKey: "pluginGeminiImageDescription",
  },
  "openai-image-generation": {
    titleKey: "pluginOpenAIImageTitle",
    descriptionKey: "pluginOpenAIImageDescription",
  },
  "openai-responses-image-processing": {
    titleKey: "pluginOpenAIResponsesImageTitle",
    descriptionKey: "pluginOpenAIResponsesImageDescription",
  },
  "agnes-video-generation": {
    titleKey: "pluginAgnesVideoTitle",
    descriptionKey: "pluginAgnesVideoDescription",
  },
};

/**
 * Returns a display-ready plugin copy. Built-in plugins get localized
 * `title`/`description` strings from the `Config` namespace; MCP plugins with
 * no logo get the local default MCP logo.
 */
type PluginDisplayMeta = {
  id: string;
  title: string;
  description: string;
  logoUrl?: string;
  source?: string;
};

function getDisplayLogoUrl(plugin: PluginDisplayMeta): string | undefined {
  if (plugin.logoUrl?.trim()) return plugin.logoUrl;
  return plugin.source === "mcp" ? DEFAULT_MCP_SERVER_LOGO_URL : plugin.logoUrl;
}

export function localizePluginMeta<T extends PluginDisplayMeta>(
  plugin: T,
  t: (key: ConfigPluginKey) => string,
): T {
  const mapping = BUILT_IN_PLUGIN_I18N[plugin.id];
  const logoUrl = getDisplayLogoUrl(plugin);
  const hasLogoChange = logoUrl !== plugin.logoUrl;
  if (!mapping && !hasLogoChange) return plugin;

  return {
    ...plugin,
    ...(hasLogoChange ? { logoUrl } : {}),
    ...(mapping
      ? {
          title: t(mapping.titleKey),
          description: t(mapping.descriptionKey),
        }
      : {}),
  };
}
