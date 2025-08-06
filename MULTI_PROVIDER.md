# Multi-Provider AI Chat Setup Guide

Vortex AI Chat now supports multiple AI providers, allowing you to use different AI models in the same application. This guide will help you set up and configure multiple AI providers.

## Supported Providers

- **Google Gemini** - Google's advanced AI models (Gemini 2.5, 2.0, 1.5 series)
- **OpenAI ChatGPT** - OpenAI's GPT models (GPT-4o, GPT-4, GPT-3.5-turbo, o1 series)
- **Anthropic Claude** - Anthropic's Claude models (Claude 3.5 Sonnet, Claude 3 Opus, Haiku)
- **xAI Grok** - xAI's Grok models (Grok Beta, Grok Vision Beta)

## Environment Variables Setup

### 1. Copy the Environment Template

```bash
cp .env.example .env.local
```

### 2. Configure API Keys

Add your API keys for the providers you want to use:

```bash
# Google Gemini API Configuration
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_API_BASE_URL=https://generativelanguage.googleapis.com

# OpenAI ChatGPT API Configuration  
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_API_BASE_URL=https://api.openai.com/v1

# Anthropic Claude API Configuration
ANTHROPIC_API_KEY=your_anthropic_api_key_here
ANTHROPIC_API_BASE_URL=https://api.anthropic.com

# xAI Grok API Configuration
XAI_API_KEY=your_xai_api_key_here
XAI_API_BASE_URL=https://api.x.ai/v1

# Access password (optional)
ACCESS_PASSWORD=your_password_here
```

## Getting API Keys

### Google Gemini
1. Visit [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Sign in with your Google account
3. Click "Create API Key" 
4. Copy the generated key

### OpenAI ChatGPT
1. Visit [OpenAI Platform](https://platform.openai.com/api-keys)
2. Sign in to your OpenAI account
3. Click "Create new secret key"
4. Copy the generated key

### Anthropic Claude
1. Visit [Anthropic Console](https://console.anthropic.com/account/keys)
2. Sign in to your Anthropic account
3. Click "Create Key"
4. Copy the generated key

### xAI Grok
1. Visit [xAI Console](https://console.x.ai/)
2. Sign in to your xAI account  
3. Navigate to API Keys section
4. Create a new API key
5. Copy the generated key

## Available Models

### Google Gemini Models
- `gemini-2.5-flash` - Latest and fastest model
- `gemini-2.5-pro` - Most capable model  
- `gemini-2.0-flash` - Fast multimodal model
- `gemini-1.5-pro` - High-quality model
- `gemini-1.5-flash` - Balanced model

### OpenAI Models
- `gpt-4o` - Latest multimodal model
- `gpt-4o-mini` - Fast and cost-effective
- `gpt-4` - High-quality text model
- `gpt-4-turbo` - Enhanced GPT-4
- `o1-preview` - Reasoning model
- `o1-mini` - Faster reasoning model

### Anthropic Claude Models
- `claude-3-5-sonnet-20241022` - Latest Claude 3.5 Sonnet
- `claude-3-5-sonnet-20240620` - Previous Claude 3.5 Sonnet
- `claude-3-5-haiku-20241022` - Fast and efficient
- `claude-3-opus-20240229` - Most capable Claude 3
- `claude-3-sonnet-20240229` - Balanced Claude 3
- `claude-3-haiku-20240307` - Fast Claude 3

### xAI Grok Models
- `grok-beta` - Grok conversational model
- `grok-vision-beta` - Grok with vision capabilities

## Model Selection

Models will only appear in the dropdown if you have configured the corresponding API key. For example:
- If you only set `OPENAI_API_KEY`, only OpenAI models will be available
- If you set both `GEMINI_API_KEY` and `ANTHROPIC_API_KEY`, both Gemini and Claude models will be available
- If you don't set any API keys, the app will show an error

## Features by Provider

### Multi-modal Support
- **Google Gemini**: ✅ Text, Images, Audio, Video
- **OpenAI**: ✅ Text, Images (GPT-4o models)
- **Anthropic**: ✅ Text, Images (Claude 3 models)
- **xAI**: ✅ Text, Images (Grok Vision models)

### Streaming Support
All providers support real-time streaming responses for a smooth chat experience.

### Function Calling
Plugin support varies by provider:
- **Google Gemini**: ✅ Full plugin support
- **OpenAI**: ✅ Function calling support
- **Anthropic**: ✅ Tool use support  
- **xAI**: ⚠️ Limited support

## Deployment

### Vercel
When deploying to Vercel, add your environment variables in the project settings:

1. Go to your Vercel project dashboard
2. Navigate to Settings → Environment Variables
3. Add each API key as a separate environment variable
4. Redeploy your application

### Docker
For Docker deployment, create a `.env` file with your API keys and use it with docker-compose:

```bash
docker run -p 3000:3000 --env-file .env your-image-name
```

### Other Platforms
For other platforms (Railway, Render, etc.), add the environment variables through their respective dashboards or CLI tools.

## Security Notes

- Never commit API keys to version control
- Use strong access passwords for public deployments  
- Regularly rotate your API keys
- Monitor your API usage and costs
- Consider using environment-specific keys for development/production

## Troubleshooting

### Models Not Appearing
- Check that the corresponding API key is set correctly
- Verify the API key is valid and has sufficient credits
- Check the browser console for any error messages

### API Errors
- Verify your API keys are correct and active
- Check your account has sufficient credits/quota
- Ensure the API base URLs are correct
- Check network connectivity

### Rate Limits
Different providers have different rate limits:
- Implement proper error handling
- Consider upgrading your API plan if needed
- Use multiple API keys for higher throughput

## Cost Management

- Monitor usage across all providers
- Set up billing alerts where available
- Choose appropriate models for your use case (faster models are usually cheaper)
- Consider using multiple providers to distribute costs

## Support

If you encounter issues:
1. Check this documentation
2. Review the [main README](../README.md)
3. Check existing [GitHub issues](https://github.com/u14app/gemini-next-chat/issues)
4. Create a new issue if needed
