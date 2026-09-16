export const APP_PROVIDER_NAME = "OpenAI";
export const APP_BASE_URL = "https://api.example.com";
export const APP_API_PROXY_PREFIX = "/provider-api";
export const APP_TEXT_MODEL = "gpt-5.5";
export const APP_REVIEW_MODEL = "gpt-5.5";
export const APP_IMAGE_MODEL = "gpt-image-2";
export const APP_IMAGE_MODELS = [APP_IMAGE_MODEL, "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"];
export const APP_VIDEO_MODEL = "grok-imagine-video";
export const APP_AUDIO_MODEL = "gpt-4o-mini-tts";
export const APP_REASONING_EFFORT = "medium";
export const APP_DISABLE_RESPONSE_STORAGE = true;
export const APP_CACHE_ROOT = "santu-canvas-cache";

export const APP_DEFAULT_MODELS = [...APP_IMAGE_MODELS, APP_VIDEO_MODEL, APP_TEXT_MODEL, APP_AUDIO_MODEL];
