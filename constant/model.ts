export const Model: Record<string, string> = {
  // Gemini models
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'gemini-2.5-pro': "Gemini 2.5 Pro",
  'gemini-2.0-flash': 'Gemini 2.0 Flash',
  'gemini-2.0-flash-lite': 'Gemini 2.0 Flash Lite',
  'gemini-1.5-pro': 'Gemini 1.5 Pro',
  'gemini-1.5-pro-latest': 'Gemini 1.5 Pro Latest',
  'gemini-1.5-flash': 'Gemini 1.5 Flash',
  'gemini-1.5-flash-latest': 'Gemini 1.5 Flash Latest',
  'gemini-1.5-flash-8b': 'Gemini 1.5 Flash-8B',
  'gemini-1.5-flash-8b-latest': 'Gemini 1.5 Flash-8B Latest',
  
  // OpenAI ChatGPT models
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o Mini',
  'gpt-4': 'GPT-4',
  'gpt-4-turbo': 'GPT-4 Turbo',
  'gpt-3.5-turbo': 'GPT-3.5 Turbo',
  'o1-preview': 'o1 Preview',
  'o1-mini': 'o1 Mini',
  
  // xAI Grok models
  'grok-beta': 'Grok Beta',
  'grok-vision-beta': 'Grok Vision Beta',
  
  // Anthropic Claude models
  'claude-3-5-sonnet-20241022': 'Claude 3.5 Sonnet (New)',
  'claude-3-5-sonnet-20240620': 'Claude 3.5 Sonnet',
  'claude-3-5-haiku-20241022': 'Claude 3.5 Haiku',
  'claude-3-opus-20240229': 'Claude 3 Opus',
  'claude-3-sonnet-20240229': 'Claude 3 Sonnet',
  'claude-3-haiku-20240307': 'Claude 3 Haiku',
}

// Provider mapping
export const ModelProviders: Record<string, string> = {
  // Gemini models
  'gemini-2.5-flash': 'google',
  'gemini-2.5-pro': 'google',
  'gemini-2.0-flash': 'google',
  'gemini-2.0-flash-lite': 'google',
  'gemini-1.5-pro': 'google',
  'gemini-1.5-pro-latest': 'google',
  'gemini-1.5-flash': 'google',
  'gemini-1.5-flash-latest': 'google',
  'gemini-1.5-flash-8b': 'google',
  'gemini-1.5-flash-8b-latest': 'google',
  
  // OpenAI models
  'gpt-4o': 'openai',
  'gpt-4o-mini': 'openai',
  'gpt-4': 'openai',
  'gpt-4-turbo': 'openai',
  'gpt-3.5-turbo': 'openai',
  'o1-preview': 'openai',
  'o1-mini': 'openai',
  
  // xAI models
  'grok-beta': 'xai',
  'grok-vision-beta': 'xai',
  
  // Anthropic models
  'claude-3-5-sonnet-20241022': 'anthropic',
  'claude-3-5-sonnet-20240620': 'anthropic',
  'claude-3-5-haiku-20241022': 'anthropic',
  'claude-3-opus-20240229': 'anthropic',
  'claude-3-sonnet-20240229': 'anthropic',
  'claude-3-haiku-20240307': 'anthropic',
}

export const OldVisionModel = ['gemini-pro-vision', 'gemini-1.0-pro-vision-latest']

export const OldTextModel = ['gemini-1.0-pro', 'gemini-1.0-pro-latest', 'gemini-pro']

export const DefaultModel = 'gemini-2.5-flash'
