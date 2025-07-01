class AssistantMarketUrl {
  private readonly baseUrl: string
  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || ''
  }
  getIndexUrl(lang: string = 'en-US') {
    if (lang === 'en-US') return this.baseUrl + '/index.json'
    if (lang === 'ar-SA') return this.baseUrl + '/index.ar.json'
    return this.baseUrl + '/index.' + lang + '.json'
  }
  getAssistantUrl(identifier: string, lang: string = 'en-US') {
    if (lang === 'en-US') return this.baseUrl + '/' + identifier + '.json'
    if (lang === 'ar-SA') return this.baseUrl + '/' + identifier + '.ar.json'
    return this.baseUrl + '/' + identifier + '.' + lang + '.json'
  }
}

export default AssistantMarketUrl
