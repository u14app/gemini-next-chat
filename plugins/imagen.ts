export const openapi: OpenAPIDocument = {
  info: {
    title: 'Imagen',
    description: 'A plugin for generating images using Imagen3.',
    version: 'v1',
  },
  openapi: '3.0.1',
  paths: {
    '/': {
      get: {
        operationId: 'Imagen',
        description: 'Generate images from text descriptions using imagen3.',
        parameters: [
          {
            name: 'prompt',
            in: 'query',
            required: true,
            description: 'Text prompt for the image. Only English descriptions are allowed.',
            example: 'a cute cat',
            schema: {
              type: 'string',
            },
          },
          {
            name: 'negativePrompt',
            in: 'query',
            description:
              'A description of what you want to omit in the generated images. Only English descriptions are allowed.',
            schema: {
              type: 'string',
            },
          },
          {
            name: 'numberOfImages',
            in: 'query',
            description: 'Number of images to generate. Range: 1..4.',
            schema: {
              type: 'number',
            },
          },
          {
            name: 'width',
            in: 'query',
            description: 'Width of the image. One of the Width/Height sizes must be 256 or 1024.',
            schema: {
              type: 'number',
            },
          },
          {
            name: 'height',
            in: 'query',
            description: 'Height of the image. One of the Width/Height sizes must be 256 or 1024.',
            schema: {
              type: 'number',
            },
          },
          {
            name: 'aspectRatio',
            in: 'query',
            description:
              'Changes the aspect ratio of the generated image. Supported values are: `1:1`, `9:16`, `16:9`, `4:3` and `3:4`',
            example: '16:9',
            schema: {
              type: 'string',
            },
          },
          {
            name: 'guidanceScale',
            in: 'query',
            description:
              'Controls the strength of the prompt. Suggested values are: 0-9 (low strength), 10-20 (medium strength), 21+ (high strength)',
            example: '12',
            schema: {
              type: 'number',
            },
          },
          {
            name: 'outputMimeType',
            in: 'query',
            description:
              'Which image format should the output be saved as. Supported values: `image/png`: Save as a PNG image, `image/jpeg`: Save as a JPEG image',
            example: 'image/jpeg',
            schema: {
              type: 'string',
            },
          },
          {
            name: 'compressionQuality',
            in: 'query',
            description:
              'Level of compression if the output mime type is selected to be image/jpeg. Float between 0 to 100',
            example: '85',
            schema: {
              type: 'number',
            },
          },
          {
            name: 'language',
            in: 'query',
            description:
              'Language of the text prompt for the image. Default: None. Supported values are `en` for English, `hi` for Hindi, `ja` for Japanese, `ko` for Korean, and `auto` for automatic language detection.',
            example: 'auto',
            schema: {
              type: 'string',
            },
          },
          {
            name: 'safetyFilterLevel',
            in: 'query',
            description:
              'Adds a filter level to Safety filtering. Supported values are: `block_most`: Strongest filtering level, most strict blocking, `block_some`: Block some problematic prompts and responses, `block_few`: Block fewer problematic prompts and responses.',
            schema: {
              type: 'string',
            },
          },
          {
            name: 'personGeneration',
            in: 'query',
            description:
              'Allow generation of people by the model Supported values are: `dont_allow`: Block generation of people, `allow_adult`: Generate adults, but not children.',
            schema: {
              type: 'string',
            },
          },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    images: {
                      type: 'array',
                      description: 'Response message for generating images.',
                      items: {
                        type: 'object',
                        properties: {
                          imageBytes: {
                            type: 'string',
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  servers: [
    {
      url: '@plugins/imagen',
    },
  ],
}
