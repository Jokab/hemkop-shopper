import { chromium } from 'playwright';
import { config } from './config';

async function searchForBananas() {
  console.log('Starting browser...');
  
  try {
    // Launch the browser
    const browser = await chromium.launch({
      headless: config.browser.headless,
      slowMo: config.browser.slowMo
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    console.log(`Navigating to ${config.baseUrl}...`);
    
    // Navigate to Hemköp's website
    await page.goto(config.baseUrl);
    
    // Reject cookies if the dialog appears
    try {
      const rejectCookiesButton = await page.waitForSelector(config.selectors.rejectCookies, { 
        timeout: config.timeouts.element 
      });
      if (rejectCookiesButton) {
        await rejectCookiesButton.click();
        console.log('Rejected cookies...');
      }
    } catch (error) {
      // Cookie dialog might not appear, that's fine
      console.log('No cookie dialog or timed out waiting for it');
    }
    
    console.log('Finding search bar...');
    
    // Locate and click the search bar
    await page.waitForSelector(config.selectors.searchBar, { 
      timeout: config.timeouts.element 
    });
    await page.click(config.selectors.searchBar);
    
    console.log(`Typing search query: ${config.search.term}...`);
    
    // Type "bananer" in the search field
    await page.keyboard.type(config.search.term);
    
    console.log('Submitting search...');
    
    // Press Enter to submit the search
    await page.keyboard.press('Enter');
    
    // Wait for search results to load
    await page.waitForNavigation({ 
      waitUntil: 'networkidle',
      timeout: config.timeouts.navigation
    });
    
    console.log(`Search complete! Found results for "${config.search.term}".`);
    
    // Take a screenshot of the search results
    await page.screenshot({ path: config.search.screenshotPath });
    console.log(`Screenshot saved as ${config.search.screenshotPath}`);
    
    // Keep the browser open for the configured amount of time
    console.log(`Keeping browser open for ${config.timeouts.browserDisplay / 1000} seconds...`);
    await new Promise(resolve => setTimeout(resolve, config.timeouts.browserDisplay));
    
    // Close the browser
    await browser.close();
    console.log('Browser closed.');
    
  } catch (error) {
    console.error('Error during search:', error);
  }
}

// Run the main function
searchForBananas().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
}); 