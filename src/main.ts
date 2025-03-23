import { chromium, Page } from 'playwright';
import { config } from './config';
import { selectBestProduct } from './llm';

// Define a more comprehensive product interface
interface Product {
  title: string;
  element: any;
  price?: string;
  comparePrice?: string;
  displayVolume?: string;
}

async function shopForGroceries() {
  console.log('Starting browser...');
  
  try {
    // Launch the browser
    const browser = await chromium.launch({
      headless: false,
      slowMo: config.browser.slowMo
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    console.log(`Navigating to ${config.baseUrl}...`);
    
    // Navigate to Hemköp's website
    await page.goto(config.baseUrl);
    
    // Wait for the page content to stabilize a bit
    await page.waitForLoadState('domcontentloaded');
    console.log('Page loaded. Waiting for cookie dialog...');
    
    // Handle cookie dialog with more patience
    await handleCookieDialog(page);
    
    console.log('Finding search bar...');
    
    // Locate and click the search bar
    const searchBarLocator = page.locator(config.selectors.searchBar);
    await searchBarLocator.waitFor({ timeout: config.timeouts.element });
    await searchBarLocator.click();
    
    console.log(`Typing search query: ${config.search.term}...`);
    
    // Type "bananer" in the search field
    await page.keyboard.type(config.search.term);
    
    console.log('Submitting search...');
    
    // Press Enter to submit the search
    await page.keyboard.press('Enter');
    
    // Wait for URL to change to search results
    await page.waitForURL(/.*sok.*bananer.*/);
    
    // Wait a bit more for the results to fully load
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    
    console.log(`Search complete! Found results for "${config.search.term}".`);
    
    // Take a screenshot of the search results
    await page.screenshot({ path: config.search.screenshotPath });
    console.log(`Screenshot saved as ${config.search.screenshotPath}`);
    
    // Add debugging - check page HTML content
    console.log('Checking page content for product titles...');
    const pageContent = await page.content();
    const productTitleMatches = pageContent.match(/data-testid="product-title"/g);
    console.log(`Found ${productTitleMatches ? productTitleMatches.length : 0} product-title attributes in HTML`);
    
    // Check all p tags with banana in the text
    const pTagsContent = await page.evaluate(() => {
      const pTags = document.querySelectorAll('p');
      return Array.from(pTags).map(p => ({
        text: p.textContent,
        className: p.className,
        dataTestId: p.getAttribute('data-testid')
      }));
    });
    
    console.log('Found p tags on the page with "banan" in text:');
    const bananPTags = pTagsContent.filter(p => p.text && p.text.toLowerCase().includes('banan'));
    bananPTags.forEach((p, i) => {
      console.log(`P tag ${i}: ${p.text} (class: ${p.className}, data-testid: ${p.dataTestId})`);
    });
    
    // Try locator with class name specifically from the HTML
    console.log('Trying to find products with specific class name...');
    const productTitleLocator = page.locator('p.sc-6f5e6e55-0.gUKaNh');
    const productTitleCount = await productTitleLocator.count();
    console.log(`Found ${productTitleCount} products with the specific class name`);
    
    if (productTitleCount === 0) {
      throw new Error('No products found on the page with any method');
    }
    
    // Extract product information including prices
    const products: Product[] = [];
    for (let i = 0; i < productTitleCount; i++) {
      const titleElement = productTitleLocator.nth(i);
      const title = await titleElement.textContent() || 'Unknown product';
      
      // Find the product container for this title
      const productContainer = titleElement.locator('xpath=./ancestor::div[@data-testid="product-container"]');
      
      // Extract price and compare price if container found
      let price = '';
      let comparePrice = '';
      let displayVolume = '';
      
      if (await productContainer.count() > 0) {
        // Extract the price
        const priceElement = productContainer.locator('[data-testid="price-text"]');
        if (await priceElement.count() > 0) {
          price = await priceElement.textContent() || '';
          // Clean up the price
          price = price.trim();
        }
        
        // Extract the compare price (jmf pris)
        const comparePriceElement = productContainer.locator('[data-testid="compare-price"]');
        if (await comparePriceElement.count() > 0) {
          comparePrice = await comparePriceElement.textContent() || '';
          // Clean up the compare price
          comparePrice = comparePrice.trim();
        }
        
        // Extract the display volume/weight (ca: 170g)
        const displayVolumeElement = productContainer.locator('[data-testid="display-volume"]');
        if (await displayVolumeElement.count() > 0) {
          displayVolume = await displayVolumeElement.textContent() || '';
          // Clean up the display volume
          displayVolume = displayVolume.trim();
        }
      }
      
      products.push({ 
        title, 
        element: titleElement,
        price, 
        comparePrice,
        displayVolume
      });
    }
    
    console.log(`Found ${products.length} products:`);
    products.forEach((product, index) => {
      console.log(`${index + 1}. ${product.title}`);
      console.log(`   Price: ${product.price || 'N/A'}`);
      console.log(`   Compare Price: ${product.comparePrice || 'N/A'}`);
      console.log(`   Display Volume: ${product.displayVolume || 'N/A'}`);
    });
    
    // Use the first shopping list item
    const shoppingListItem = config.shoppingList[0];
    console.log(`Shopping for: ${shoppingListItem}`);
    
    // Use LLM to select the best product based on the shopping list and price information
    const selectedProduct = await selectBestProduct(products, shoppingListItem);
    
    if (selectedProduct) {
      console.log(`LLM selected: ${selectedProduct.title}`);
      if (selectedProduct.price) console.log(`Selected product price: ${selectedProduct.price}`);
      if (selectedProduct.comparePrice) console.log(`Selected product compare price: ${selectedProduct.comparePrice}`);
      
      // Find the product container - go up the DOM tree to the nearest article element
      const productContainerLocator = selectedProduct.element.locator('xpath=./ancestor::div[@data-testid="product-container"]');
      console.log('Looking for product container...');
      
      if (await productContainerLocator.count() > 0) {
        console.log('Product container found!');
        
        // Find the buy button within the product container with text "Köp"
        const buyButtonLocator = productContainerLocator.locator('button[data-testid="button"]:has-text("Köp")');
        
        if (await buyButtonLocator.count() > 0) {
          console.log(`Clicking 'Buy' button for: ${selectedProduct.title}`);
          await buyButtonLocator.click();
          console.log('Successfully added product to cart!');
          
          // Wait a moment to see the result
          await page.waitForTimeout(3000);
        } else {
          console.error('Buy button not found for the selected product');
          
          // Debug: List all buttons in the container
          const allButtons = await productContainerLocator.locator('button').count();
          console.log(`Found ${allButtons} buttons in the container`);
          
          for (let i = 0; i < allButtons; i++) {
            const button = productContainerLocator.locator('button').nth(i);
            const text = await button.textContent();
            const testId = await button.getAttribute('data-testid');
            console.log(`Button ${i}: Text="${text}", data-testid="${testId}"`);
          }
        }
      } else {
        console.error('Product container not found for the selected product');
        // Try an alternative approach to locate the container
        console.log('Trying alternative approach to find container');
        
        // Go up to common parent
        const parentDivLocator = selectedProduct.element.locator('xpath=./ancestor::div[contains(@class, "sc-56f3097b")]');
        console.log(`Found ${await parentDivLocator.count()} potential parent divs`);
        
        if (await parentDivLocator.count() > 0) {
          // Find the nearest button that says "Köp"
          const buyButtonLocator = parentDivLocator.locator('button:has-text("Köp")');
          
          if (await buyButtonLocator.count() > 0) {
            console.log(`Clicking 'Buy' button using alternative method for: ${selectedProduct.title}`);
            await buyButtonLocator.click();
            console.log('Successfully added product to cart using alternative method!');
            
            // Wait a moment to see the result
            await page.waitForTimeout(3000);
          } else {
            console.error('Buy button not found with alternative method');
          }
        } else {
          console.error('Could not find parent container with alternative method');
        }
      }
    } else {
      console.error('LLM could not select a product');
    }
    
    // Keep the browser open for the configured amount of time
    console.log(`Keeping browser open for ${config.timeouts.browserDisplay / 1000} seconds...`);
    await new Promise(resolve => setTimeout(resolve, config.timeouts.browserDisplay));
    
    // Close the browser
    await browser.close();
    console.log('Browser closed.');
    
  } catch (error) {
    console.error('Error during shopping:', error);
  }
}

/**
 * Handle the cookie dialog with multiple attempts
 * @param page Playwright page
 * @returns true if cookie dialog was handled, false otherwise
 */
async function handleCookieDialog(page: Page): Promise<boolean> {
  // More patient timeout for cookie dialog
  const cookieTimeout = 15000; // 15 seconds total timeout
  const pollingInterval = 1000; // Check every second
  const maxAttempts = cookieTimeout / pollingInterval;
  
  console.log(`Waiting up to ${cookieTimeout/1000} seconds for cookie dialog...`);
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Try to find the reject button
    const rejectButtonLocator = page.locator(config.selectors.rejectCookies);
    
    try {
      // Check if the button is visible with a short timeout
      const isVisible = await rejectButtonLocator.isVisible({ timeout: pollingInterval });
      
      if (isVisible) {
        console.log(`Cookie dialog found on attempt ${attempt + 1}. Rejecting cookies...`);
        
        // Add a small delay to ensure the dialog is fully loaded and clickable
        await page.waitForTimeout(500);
        
        // Click the reject button
        await rejectButtonLocator.click();
        console.log('Clicked reject button, continuing...');
        
        // Don't wait for dialog to disappear, just move on
        return true;
      }
    } catch (error) {
      // Ignore timeouts and continue polling
    }
    
    if (attempt < maxAttempts - 1) {
      console.log(`Cookie dialog not found on attempt ${attempt + 1}. Waiting...`);
      await page.waitForTimeout(pollingInterval);
    }
  }
  
  console.log('Cookie dialog not found after multiple attempts. Continuing anyway...');
  return false;
}

// Run the main function
shopForGroceries().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
}); 