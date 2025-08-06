import * as arxiv from './arxiv'
import * as reader from './reader'
import * as unsplash from './unsplash'
import * as time from './time'
import * as weather from './weather'
import * as search from './search'
import * as imagen from './imagen'

export const officialPlugins: Record<string, OpenAPIDocument> = {
  OfficialReader: reader.openapi,
  OfficialArxiv: arxiv.openapi,
  OfficialUnsplash: unsplash.openapi,
  OfficialTime: time.openapi,
  OfficialWeather: weather.openapi,
  OfficialSearch: search.openapi,
  OfficialImagen: imagen.openapi,
}

export const OFFICAL_PLUGINS = {
  SEARCH: 'OfficialSearch',
  IMAGEN: 'OfficialImagen',
  READER: 'OfficialReader',
  WEATHER: 'OfficialWeather',
  TIME: 'OfficialTime',
  UNSPLASH: 'OfficialUnsplash',
  ARXIV: 'OfficialArxiv',
}

export function pluginHandle(name: string, payload: any) {
  switch (name) {
    case 'OfficialArxiv':
      return arxiv.handle(payload.query)
    case 'OfficialReader':
      return reader.handle(payload.query)
    case 'OfficialUnsplash':
      return unsplash.handle(payload.query)
    case 'OfficialTime':
      return time.handle(payload.query)
    case 'OfficialWeather':
      return weather.handle(payload.query)
    case 'OfficialSearch':
      return search.handle(payload.query)
    default:
      throw new Error('Unable to find plugin')
  }
}
