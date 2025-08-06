import { GEMINI_API_BASE_URL } from '@/constant/urls'

export interface ImageGenerationRequest {
  /**
   * Text prompt for the image.
   */
  prompt: string
  /**
   * A description of what you want to omit in the generated images.
   */
  negativePrompt?: string
  /**
   * Number of images to generate. Range: 1..4.
   */
  numberOfImages?: number
  /**
   * Width of the image. One of the Width/Height sizes must be 256 or 1024.
   */
  width?: 256 | 1024
  /**
   * Height of the image. One of the Width/Height sizes must be 256 or 1024.
   */
  height?: 256 | 1024
  /**
   * Changes the aspect ratio of the generated image.
   *  Supported values are:
   * * "1:1" : 1:1 aspect ratio
   * * "9:16" : 9:16 aspect ratio
   * * "16:9" : 16:9 aspect ratio
   * * "4:3" : 4:3 aspect ratio
   * * "3:4" : 3:4 aspect_ratio
   */
  aspectRatio?: '1:1' | '9:16' | '16:9' | '4:3' | '3:4'
  /**
   * Controls the strength of the prompt. Suggested values are:
   * * 0-9 (low strength)
   * * 10-20 (medium strength)
   * * 21+ (high strength)
   */
  guidanceScale?: number
  /**
   * Which image format should the output be saved as.
   * Supported values:
   * * image/png: Save as a PNG image
   * * image/jpeg: Save as a JPEG image
   */
  outputMimeType?: 'image/png' | 'image/jpeg'
  /**
   * Level of compression if the output mime type is selected to be image/jpeg.
   * Float between 0 to 100
   */
  compressionQuality?: number
  /**
   * Language of the text prompt for the image. Default: None. Supported values
   * are `"en"` for English, `"hi"` for Hindi, `"ja"` for Japanese, `"ko"`
   * for Korean, and `"auto"` for automatic language detection.
   */
  language?: string
  /**
   * Adds a filter level to Safety filtering. Supported values are:
   * * "block_most" : Strongest filtering level, most strict blocking
   * * "block_some" : Block some problematic prompts and responses
   * * "block_few" : Block fewer problematic prompts and responses
   */
  safetyFilterLevel?: 'block_low_and_above' | 'block_medium_and_above' | 'block_only_high'
  /**
   * Allow generation of people by the model Supported values are:
   * * "dont_allow" : Block generation of people
   * * "allow_adult" : Generate adults, but not children
   */
  personGeneration?: 'dont_allow' | 'allow_adult'
}

/**
 * Generated images. It will be returned in response.
 */
export interface GeneratedImage {
  /**
   * Image bytes.
   */
  imageBytes?: string
}

/**
 * Response message for generating image.
 */
export interface ImageGenerationResponse {
  images: GeneratedImage[]
}

/**
 * Each image data for response of [PredictionService.Predict].
 * This is an internal class. Please do not depend on it.
 */
export interface ImageGenerationPredictResponseImageData {
  bytesBase64Encoded: string
  mimeType: string
}

/**
 * Response message for [PredictionService.Predict].
 * This is an internal class. Please do not depend on it.
 */
export interface ImageGenerationPredictResponse {
  /**
   * The outputs of the prediction call.
   */
  predictions?: ImageGenerationPredictResponseImageData[]
}

export type PredictServiceBasicValueType = string | number | boolean | undefined

export type PredictServiceValueType = PredictServiceBasicValueType | Record<string, PredictServiceBasicValueType>

/**
 * Request message for [PredictionService.Predict][].
 * This is an internal class. Please do not depend on it.
 */
export interface PredictRequest {
  /**
   * The name of the model for prediction.
   */
  model?: string
  /**
   * The instances that are the input to the prediction call.
   */
  instances?: PredictServiceValueType[]
  /**
   * The parameters that govern the prediction call.
   */
  parameters?: PredictServiceValueType
}

export function convertFromImageGenerationRequest(model: string, request: ImageGenerationRequest): PredictRequest {
  const instances = [{ prompt: request.prompt }]
  const sampleImageSize = Math.max(request.width || 1024, request.height || 1024)
  const parameters = {
    negativePrompt: request.negativePrompt,
    sampleCount: request.numberOfImages || 1,
    guidanceScale: request.guidanceScale || 12,
    outputMimeType: request.outputMimeType || 'image/jpeg',
    compressionQuality: request.compressionQuality || 90,
    language: request.language,
    safetyFilterLevel: request.safetyFilterLevel || 'block_only_high',
    personGeneration: request.personGeneration || 'allow_adult',
    aspectRatio: request.aspectRatio || '1:1',
    sampleImageSize: sampleImageSize === 0 ? undefined : sampleImageSize,
  }
  return {
    model,
    instances,
    parameters,
  }
}

export function convertToImageGenerationResponse(response: ImageGenerationPredictResponse): ImageGenerationResponse {
  const images: GeneratedImage[] = []
  if (response.predictions) {
    for (const prediction of response.predictions) {
      images.push({
        imageBytes: prediction.bytesBase64Encoded,
      })
    }
  }
  return { images }
}

interface Options {
  apiKey?: string
  token?: string
  baseUrl?: string
  model: string
  params: ImageGenerationRequest
}

export async function generateImages({
  apiKey,
  token = '',
  baseUrl = GEMINI_API_BASE_URL,
  model,
  params,
}: Options): Promise<ImageGenerationResponse> {
  const predictRequest = convertFromImageGenerationRequest(model, params)
  const response = await fetch(`${baseUrl}/v1beta/models/${model}:predict`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey ?? token,
    },
    body: JSON.stringify(predictRequest),
  })
  const responseJson: ImageGenerationPredictResponse = await response.json()
  return convertToImageGenerationResponse(responseJson)
}
