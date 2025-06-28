class AssistantMarketUrl {
  private readonly baseUrl: string
  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || ''
  }
  getIndexUrl(lang: string = 'en') {
    if (lang === 'zh-TW') return this.baseUrl + '/index.zh-TW.json'
    if (lang.startsWith('zh')) return this.baseUrl + '/index.zh-CN.json'
    return this.baseUrl
  }
  getAssistantUrl(identifier: string, lang: string = 'en') {
    if (lang === 'zh-TW') return this.baseUrl + `/${identifier}.zh-TW.json`
    if (lang.startsWith('zh')) return this.baseUrl + `/${identifier}.zh-CN.json`
    return this.baseUrl + `/${identifier}.json`
  }
}

export default AssistantMarketUrl
