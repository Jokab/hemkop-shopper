export const config = {
  // URL to the Hemköp website
  baseUrl: 'https://www.hemkop.se/',
  
  // Browser settings
  browser: {
    headless: false,
    slowMo: 50 // Add a small delay between actions for visibility
  },
  
  // Selectors for elements on the page
  selectors: {
    cookieConsent: '[data-testid="consent-accept-cookies"]',
    rejectCookies: '#onetrust-reject-all-handler',
    searchBar: '[data-testid="product-search"]',
    productTitle: '[data-testid="product-title"]',
    productContainer: '[data-testid="product-container"]',
    buyButton: '[data-testid="button"]'
  },
  
  // Search parameters
  search: {
    term: 'bananer',
    screenshotPath: 'bananas-search-results.png'
  },
  
  // Shopping list
  shoppingList: [
    "2.5 kg bananer",
    "en burk jordnötssmör"
  ],
  
  // Ollama settings
  ollama: {
    url: 'http://localhost:11434',
    model: 'llama3.2',
    temperature: 0,
    systemPrompt: 'You are a shopping assistant.'
  },
  
  // Timeout settings (in milliseconds)
  timeouts: {
    navigation: 30000,
    element: 5000,
    browserDisplay: 10000
  }
}; 