import { encodeToken } from './signature'

type Options = {
  apiKey: string
  apiProxy: string
  password: string
}

export async function fetchModels(options: Options) {
  if (options.apiKey === '') {
    const token = encodeToken(options.password)
    const response = await fetch(`/api/models?token=${token}`)
    return response.json()
  } else {
    const response = await fetch(`${options.apiProxy}/v1beta/models?key=${options.apiKey}`)
    return response.json()
  }
}
