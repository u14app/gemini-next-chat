/** @type {import('next').NextConfig} */
const { PHASE_PRODUCTION_BUILD, PHASE_EXPORT } = require('next/constants')

const mode = process.env.NEXT_PUBLIC_BUILD_MODE
const basePath = process.env.EXPORT_BASE_PATH || ''
const geminiApiKey = process.env.GEMINI_API_KEY || ''
const uploadProxyUrl = process.env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com'

/** @type {(phase: string, defaultConfig: import("next").NextConfig) => Promise<import("next").NextConfig>} */
module.exports = async (phase) => {
  const nextConfig = {
    images: {
      unoptimized: mode === 'export',
    },
    reactStrictMode: false,
  }
  if (mode === 'export') {
    nextConfig.output = 'export'
    // Only used for static deployment, the default deployment directory is the root directory
    nextConfig.basePath = basePath
  } else if (mode === 'standalone') {
    nextConfig.output = 'standalone'
  }

  if (mode !== 'export') {
    nextConfig.rewrites = async () => {
      const apiKey = geminiApiKey.split(',')[0]
      const beforeFilesConfig = geminiApiKey
        ? [
            {
              source: '/api/google/upload/v1beta/files',
              has: [
                {
                  type: 'query',
                  key: 'key',
                  value: '(?<key>.*)',
                },
              ],
              destination: `${uploadProxyUrl}/upload/v1beta/files?key=${apiKey}`,
            },
            {
              source: '/api/google/v1beta/files/:id',
              has: [
                {
                  type: 'query',
                  key: 'key',
                  value: '(?<key>.*)',
                },
              ],
              destination: `${uploadProxyUrl}/v1beta/files/:id?key=${apiKey}`,
            },
          ]
        : [
            {
              source: '/api/google/upload/v1beta/files',
              has: [
                {
                  type: 'query',
                  key: 'key',
                  value: '(?<key>.*)',
                },
              ],
              destination: '/api/upload/files',
            },
            {
              source: '/api/google/v1beta/files/:id',
              has: [
                {
                  type: 'query',
                  key: 'key',
                  value: '(?<key>.*)',
                },
              ],
              destination: '/api/upload/files?id=:id',
            },
          ]
      return {
        beforeFiles: [
          {
            source: '/api/google/v1beta/models/:model',
            destination: '/api/chat?model=:model',
          },
          {
            source: '/api/google/upload/v1beta/files',
            has: [
              {
                type: 'query',
                key: 'uploadType',
                value: 'resumable',
              },
            ],
            missing: [
              {
                type: 'query',
                key: 'upload_id',
              },
            ],
            destination: `/api/upload`,
          },
          ...beforeFilesConfig,
        ],
      }
    }
  }

  if (phase === PHASE_PRODUCTION_BUILD || phase === PHASE_EXPORT) {
    const withSerwist = (await import('@serwist/next')).default({
      // Note: This is only an example. If you use Pages Router,
      // use something else that works, such as "service-worker/index.ts".
      swSrc: 'app/sw.ts',
      swDest: 'public/sw.js',
      register: false,
    })
    return withSerwist(nextConfig)
  }

  return nextConfig
}
