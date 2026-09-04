/**
 * 内置插件配置
 * 定义系统预设的插件和工具
 */

import { Plugin } from "@/types";
import { RESEARCH_SOURCE_PLUGINS } from "@/lib/plugin/researchSources/catalog";

// ============================================================================
// Schema 定义
// ============================================================================

const ImageCountSchema = {
  type: "integer",
  minimum: 1,
  maximum: 10,
  description:
    "Optional number of images to generate when supported by the selected model.",
};

/**
 * Jina Reader 参数 Schema
 */
const JinaReaderSchema = {
  type: "object",
  properties: {
    url: {
      type: "string",
      description:
        "The full URL of the webpage to read (e.g., https://example.com)",
    },
  },
  required: ["url"],
};

/**
 * 天气查询参数 Schema
 */
const WeatherSchema = {
  type: "object",
  properties: {
    location: {
      type: "string",
      description:
        'The city name to get weather for (e.g. "New York", "Shanghai"). Only English place names are allowed.',
    },
  },
  required: ["location"],
};

/**
 * Unsplash 搜索参数 Schema
 */
const UnsplashSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: 'The search terms (English only, e.g. "nature", "cats").',
    },
    page: {
      type: "integer",
      description: "Page number to retrieve. Default is 1.",
    },
    per_page: {
      type: "integer",
      description: "Number of items per page. Default is 10.",
    },
  },
  required: ["query"],
};

/**
 * Agnes 图片处理参数 Schema
 */
const AgnesImageSchema = {
  type: "object",
  properties: {
    prompt: {
      type: "string",
      description: "Text instruction for image generation or image editing.",
    },
    size: {
      type: "string",
      description: 'Output image size, such as "1024x768".',
    },
    model: {
      type: "string",
      description:
        'Optional Agnes image model. Defaults to "agnes-image-2.1-flash".',
    },
    n: ImageCountSchema,
    image: {
      type: "array",
      items: { type: "string" },
      description:
        "Optional input image URLs or Data URI Base64 values for image-to-image generation.",
    },
    return_base64: {
      type: "boolean",
      description: "Return text-to-image output as Base64 data.",
    },
    response_format: {
      type: "string",
      enum: ["url", "b64_json"],
      description: "Output format. This is sent as extra_body.response_format.",
    },
  },
  required: ["prompt", "size"],
};

/**
 * Gemini 图片处理参数 Schema
 */
const GeminiImageSchema = {
  type: "object",
  properties: {
    prompt: {
      type: "string",
      description: "Text instruction for Gemini image generation or editing.",
    },
    model: {
      type: "string",
      description:
        'Optional Gemini image model. Defaults to "gemini-3.1-flash-image".',
    },
    aspect_ratio: {
      type: "string",
      enum: [
        "1:1",
        "2:3",
        "3:2",
        "3:4",
        "4:3",
        "4:5",
        "5:4",
        "9:16",
        "16:9",
        "21:9",
      ],
      description: 'Optional output aspect ratio, such as "1:1" or "16:9".',
    },
    image_size: {
      type: "string",
      enum: ["1K", "2K", "4K", "512"],
      description: 'Optional output size tier, such as "1K" or "2K".',
    },
    n: ImageCountSchema,
    image: {
      type: "array",
      items: { type: "string" },
      description:
        "Optional input image URLs or data URLs for image-to-image editing.",
    },
  },
  required: ["prompt"],
};

/**
 * OpenAI Responses 图片生成参数 Schema
 */
const OpenAIResponsesImageSchema = {
  type: "object",
  properties: {
    prompt: {
      type: "string",
      description: "Text instruction for image generation or image editing.",
    },
    model: {
      type: "string",
      description: 'Main Responses model. Defaults to "gpt-5.5".',
    },
    image_model: {
      type: "string",
      description: 'Optional GPT image tool model, such as "gpt-image-1.5".',
    },
    action: {
      type: "string",
      enum: ["auto", "generate", "edit"],
      description:
        "Whether the image tool should generate, edit, or let the model decide.",
    },
    size: {
      type: "string",
      description: 'Optional output size, such as "1024x1024".',
    },
    quality: {
      type: "string",
      enum: ["auto", "low", "medium", "high"],
      description: "Optional image generation quality.",
    },
    background: {
      type: "string",
      enum: ["auto", "transparent", "opaque"],
      description: "Optional generated image background.",
    },
    image: {
      type: "array",
      items: { type: "string" },
      description:
        "Optional input image URLs or data URLs for image-to-image editing.",
    },
  },
  required: ["prompt"],
};

/**
 * OpenAI 兼容 Images API 图片生成参数 Schema
 */
const OpenAICompatibleImageSchema = {
  type: "object",
  properties: {
    prompt: {
      type: "string",
      description: "Text instruction for image generation or image editing.",
    },
    model: {
      type: "string",
      description: 'Image model name. Defaults to "gpt-image-1".',
    },
    size: {
      type: "string",
      description: 'Optional output image size, such as "1024x1024".',
    },
    n: {
      ...ImageCountSchema,
    },
    image: {
      type: "array",
      items: { type: "string" },
      description:
        "Optional input images as data URLs. When present, the plugin calls /images/edits.",
    },
    response_format: {
      type: "string",
      enum: ["url", "b64_json"],
      description:
        "Optional Images API response format for compatible providers that support it.",
    },
  },
  required: ["prompt"],
};

/**
 * Agnes 视频创建参数 Schema
 */
const AgnesVideoCreateSchema = {
  type: "object",
  properties: {
    prompt: {
      type: "string",
      description: "Text description of the video content.",
    },
    model: {
      type: "string",
      description:
        'Optional Agnes video model. Defaults to "agnes-video-v2.0".',
    },
    image: {
      type: "string",
      description:
        "Optional publicly accessible HTTPS image URL for image-to-video workflows.",
    },
    mode: {
      type: "string",
      description: 'Optional generation mode, such as "ti2vid".',
    },
    height: {
      type: "integer",
      description: "Video height. Default is 768.",
    },
    width: {
      type: "integer",
      description: "Video width. Default is 1152.",
    },
    num_frames: {
      type: "integer",
      description:
        "Number of frames. Must be <= 441 and follow the 8n + 1 rule.",
    },
    frame_rate: {
      type: "number",
      description: "Frame rate from 1 to 60.",
    },
    num_inference_steps: {
      type: "integer",
      description: "Number of inference steps.",
    },
    seed: {
      type: "integer",
      description: "Random seed for reproducible results.",
    },
    negative_prompt: {
      type: "string",
      description: "Negative prompt describing content to avoid.",
    },
    extra_body: {
      type: "object",
      description:
        "Optional advanced parameters, including image arrays and keyframe mode.",
    },
  },
  required: ["prompt"],
};

/**
 * Agnes 视频查询参数 Schema
 */
const AgnesVideoResultSchema = {
  type: "object",
  properties: {
    video_id: {
      type: "string",
      description:
        "Recommended video ID returned by create_video. Use this to retrieve the current generation status or final video URL.",
    },
    task_id: {
      type: "string",
      description:
        "Legacy task ID returned by create_video. Use only when video_id is not available.",
    },
    model_name: {
      type: "string",
      description:
        "Optional Agnes video model name for video_id result lookups, especially when using a custom video model.",
    },
  },
  anyOf: [{ required: ["video_id"] }, { required: ["task_id"] }],
};

// ============================================================================
// 内置插件定义
// ============================================================================

/**
 * Jina Web Reader 插件
 * 将任何 URL 转换为 LLM 友好的 Markdown 内容
 */
export const JINA_READER_PLUGIN: Plugin = {
  id: "jina-web-reader",
  title: "Web Reader (Jina AI)",
  description:
    "Converts any URL into LLM-friendly markdown content. Useful for reading documentation, articles, or any webpage context.",
  logoUrl: "https://jina.ai/icons/favicon-128x128.png",
  manifestUrl: "",
  baseUrl: "https://r.jina.ai",
  category: "Utilities",
  builtIn: true,
  added: new Date().toISOString(),
  functions: [
    {
      name: "read_webpage",
      description:
        "Reads the content of a specific webpage URL and returns it as clean markdown.",
      method: "GET",
      path: "/{url}",
      parameters: JinaReaderSchema,
    },
  ],
  auth: { type: "bearer", required: false },
};

/**
 * 实时天气插件
 * 获取任何城市的实时天气信息
 */
export const WEATHER_PLUGIN: Plugin = {
  id: "weather-gpt",
  title: "Real-time Weather",
  description:
    "Get real-time weather information including temperature, conditions, and humidity for any city.",
  logoUrl: "https://cdn.weatherapi.com/v4/images/weatherapi_logo.png",
  manifestUrl:
    "https://openai-collections.chat-plugin.lobehub.com/weather-gpt/openapi.json",
  baseUrl: "https://weathergpt.vercel.app",
  category: "Utilities",
  builtIn: true,
  added: new Date().toISOString(),
  functions: [
    {
      name: "getCurrentWeather",
      description: "Get the current weather for a specific city.",
      method: "GET",
      path: "/api/weather",
      parameters: WeatherSchema,
    },
  ],
  auth: { type: "none" },
};

/**
 * Unsplash 图片搜索插件
 * 在 Unsplash 上搜索高质量照片
 */
export const UNSPLASH_PLUGIN: Plugin = {
  id: "unsplash",
  title: "Unsplash",
  description: "Search for high-quality photos on Unsplash.",
  logoUrl: "https://unsplash.com/apple-touch-icon.png",
  manifestUrl: "",
  baseUrl: "https://api.unsplash.com",
  category: "Image Search",
  builtIn: true,
  added: new Date().toISOString(),
  functions: [
    {
      name: "search_photos",
      description: "Search photos on Unsplash.",
      method: "GET",
      path: "/search/photos",
      parameters: UnsplashSchema,
    },
  ],
  auth: {
    type: "apiKey",
    name: "client_id",
    in: "query",
  },
};

/**
 * Agnes 图片处理插件
 */
export const AGNES_IMAGE_PLUGIN: Plugin = {
  id: "agnes-image-generation",
  title: "Agnes Image Processing",
  description:
    "Generate or edit images with Agnes Image 2.1 Flash from text prompts or input images.",
  logoUrl: "https://agnes-ai.com/images/logo.png",
  manifestUrl: "",
  externalDocsUrl: "https://agnes-ai.com/en/docs/agnes-image-21-flash",
  baseUrl: "https://apihub.agnes-ai.com",
  category: "Image Processing",
  builtIn: true,
  added: new Date().toISOString(),
  functions: [
    {
      name: "generate_image",
      description:
        "Generate or edit an image with Agnes Image 2.1 Flash. Requires an Agnes AI API key.",
      method: "POST",
      path: "/v1/images/generations",
      parameters: AgnesImageSchema,
    },
  ],
  auth: {
    type: "bearer",
    required: true,
  },
};

/**
 * Gemini 图片处理插件
 */
export const GEMINI_IMAGE_PLUGIN: Plugin = {
  id: "gemini-image-generation",
  title: "Gemini Image Processing",
  description: "Generate or edit images with Gemini Nano Banana image models.",
  logoUrl:
    "https://www.gstatic.com/lamda/images/gemini_sparkle_aurora_33f86dc0c0257da337c63.svg",
  manifestUrl: "",
  externalDocsUrl: "https://ai.google.dev/gemini-api/docs/image-generation",
  baseUrl: "https://generativelanguage.googleapis.com",
  category: "Image Processing",
  builtIn: true,
  added: new Date().toISOString(),
  functions: [
    {
      name: "generate_gemini_image",
      description:
        "Generate or edit an image with Gemini Nano Banana. Requires a Gemini API key.",
      method: "POST",
      path: "/v1beta/interactions",
      parameters: GeminiImageSchema,
    },
  ],
  auth: {
    type: "apiKey",
    name: "x-goog-api-key",
    in: "header",
    required: true,
  },
};

/**
 * OpenAI 兼容 Images API 图片处理插件
 */
export const OPENAI_IMAGE_PLUGIN: Plugin = {
  id: "openai-image-generation",
  title: "OpenAI-compatible Image Processing",
  description:
    "Generate or edit images with OpenAI-compatible Images API providers.",
  logoUrl: "https://openai.com/favicon.ico",
  manifestUrl: "",
  externalDocsUrl:
    "https://developers.openai.com/api/docs/guides/image-generation",
  baseUrl: "https://api.openai.com/v1",
  category: "Image Processing",
  builtIn: true,
  added: new Date().toISOString(),
  functions: [
    {
      name: "generate_image_with_images_api",
      description:
        "Generate or edit an image using an OpenAI-compatible Images API endpoint configured in plugin settings. Requires an API key.",
      method: "POST",
      path: "/images/generations",
      parameters: OpenAICompatibleImageSchema,
    },
  ],
  auth: {
    type: "bearer",
    required: true,
  },
};

/**
 * OpenAI Responses API 图片处理插件
 */
export const OPENAI_RESPONSES_IMAGE_PLUGIN: Plugin = {
  id: "openai-responses-image-processing",
  title: "OpenAI Responses Image Processing",
  description:
    "Generate or edit images with the OpenAI Responses API image_generation tool.",
  logoUrl: "https://openai.com/favicon.ico",
  manifestUrl: "",
  externalDocsUrl:
    "https://developers.openai.com/api/docs/guides/image-generation",
  baseUrl: "https://api.openai.com/v1",
  category: "Image Processing",
  builtIn: true,
  added: new Date().toISOString(),
  functions: [
    {
      name: "generate_image_with_responses",
      description:
        "Generate or edit an image using the OpenAI Responses API image_generation tool. Requires an OpenAI API key.",
      method: "POST",
      path: "/responses",
      parameters: OpenAIResponsesImageSchema,
    },
  ],
  auth: {
    type: "bearer",
    required: true,
  },
};

/**
 * Agnes 视频生成插件
 */
export const AGNES_VIDEO_PLUGIN: Plugin = {
  id: "agnes-video-generation",
  title: "Agnes Video Generation",
  description:
    "Create text-to-video or image-to-video tasks with Agnes Video V2.0, then retrieve generated results.",
  logoUrl: "https://agnes-ai.com/images/logo.png",
  manifestUrl: "",
  externalDocsUrl: "https://agnes-ai.com/en/docs/agnes-video-v20",
  baseUrl: "https://apihub.agnes-ai.com",
  category: "Video Generation",
  builtIn: true,
  added: new Date().toISOString(),
  functions: [
    {
      name: "create_video",
      description:
        "Create an asynchronous Agnes Video V2.0 text-to-video or image-to-video generation task. Requires an Agnes AI API key.",
      method: "POST",
      path: "/v1/videos",
      parameters: AgnesVideoCreateSchema,
    },
    {
      name: "get_video_result",
      description:
        "Retrieve an Agnes Video V2.0 generation status or result by video_id, or by legacy task_id when video_id is unavailable.",
      method: "GET",
      path: "/agnesapi",
      parameters: AgnesVideoResultSchema,
    },
  ],
  auth: {
    type: "bearer",
    required: true,
  },
};

// ============================================================================
// 插件集合
// ============================================================================

/**
 * 所有内置插件
 */
export const BUILT_IN_PLUGINS: Plugin[] = [
  ...RESEARCH_SOURCE_PLUGINS,
  JINA_READER_PLUGIN,
  WEATHER_PLUGIN,
  UNSPLASH_PLUGIN,
  AGNES_IMAGE_PLUGIN,
  GEMINI_IMAGE_PLUGIN,
  OPENAI_IMAGE_PLUGIN,
  OPENAI_RESPONSES_IMAGE_PLUGIN,
  AGNES_VIDEO_PLUGIN,
];

/**
 * 插件分类
 */
export const PLUGIN_CATEGORIES = {
  research: "Research",
  utilities: "Utilities",
  imageSearch: "Image Search",
  imageProcessing: "Image Processing",
  videoGeneration: "Video Generation",
  dataRetrieval: "Data Retrieval",
  productivity: "Productivity",
  entertainment: "Entertainment",
} as const;

/**
 * 根据 ID 获取插件
 */
export function getPluginById(id: string): Plugin | undefined {
  return BUILT_IN_PLUGINS.find((plugin) => plugin.id === id);
}

/**
 * 根据分类获取插件
 */
export function getPluginsByCategory(category: string): Plugin[] {
  return BUILT_IN_PLUGINS.filter((plugin) => plugin.category === category);
}
