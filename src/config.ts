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
    searchBar: '[data-testid="product-search"]'
  },
  
  // Search parameters
  search: {
    term: 'bananer',
    screenshotPath: 'bananas-search-results.png'
  },
  
  // Timeout settings (in milliseconds)
  timeouts: {
    navigation: 30000,
    element: 5000,
    browserDisplay: 10000
  }
}; 