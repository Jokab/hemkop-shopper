import { chromium, Page } from 'playwright';
import { config } from './config';
import { selectBestProduct, processIngredientDescription } from './llm';
import { Product } from './types';
import { logger } from './logger';
import { extractIngredientsFromUrl } from './recipeParser';
import { extractIngredientsFromJsonLd } from './jsonldRecipeParser';

// No longer need to define Product interface here since we're importing it

async function shopForGroceries(): Promise<void> {
  logger.info('Starting shopping process');
  
  try {
    // Process recipe URL if provided
    const recipeUrl = getRecipeUrlFromCommandLine();
    let shoppingList: string[] = [];
    
    if (recipeUrl) {
      logger.info(`Recipe URL provided: ${recipeUrl}`);
      
      // First try the JSON-LD parser
      const ingredients = await extractIngredientsFromJsonLd(recipeUrl);
      
      if (ingredients.length === 0) {
        logger.info('JSON-LD parser failed to extract ingredients, falling back to old parser');
        // Fall back to the old parser if JSON-LD parser fails
        const fallbackIngredients = await extractIngredientsFromUrl(recipeUrl);
        
        if (fallbackIngredients.length === 0) {
          logger.error('Both parsers failed to extract ingredients from the recipe URL');
          logger.info('Falling back to default shopping list');
          shoppingList = config.shoppingList;
        } else {
          // Process ingredients from fallback parser
          for (const ingredient of fallbackIngredients) {
            logger.info(`Processing ingredient: "${ingredient}"`);
            const searchTerm = await processIngredientDescription(ingredient);
            logger.info(`Normalized to search term: "${searchTerm}"`);
            shoppingList.push(searchTerm);
          }
        }
      } else {
        // Process ingredients from JSON-LD parser
        for (const ingredient of ingredients) {
          logger.info(`Processing ingredient: "${ingredient}"`);
          const searchTerm = await processIngredientDescription(ingredient);
          logger.info(`Normalized to search term: "${searchTerm}"`);
          shoppingList.push(searchTerm);
        }
      }
    } else {
      logger.info('Using default shopping list');
      shoppingList = config.shoppingList;
    }
    
    logger.info(`Shopping list contains ${shoppingList.length} items`);
    
    // Launch the browser
    const browser = await chromium.launch({
      headless: false,
      slowMo: config.browser.slowMo
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    logger.debug(`Navigating to ${config.baseUrl}...`);
    
    // Navigate to Hemköp's website
    await page.goto(config.baseUrl);
    
    // Wait for the page content to stabilize a bit
    await page.waitForLoadState('domcontentloaded');
    logger.debug('Page loaded. Waiting for cookie dialog...');
    
    // Handle cookie dialog with more patience
    await handleCookieDialog(page);
    
    // Array to store cart items
    const cartItems: Product[] = [];
    
    // Process each item in the shopping list sequentially
    for (let itemIndex = 0; itemIndex < shoppingList.length; itemIndex++) {
      const shoppingListItem = shoppingList[itemIndex];
      logger.info(`Processing item ${itemIndex + 1}/${shoppingList.length}: ${shoppingListItem}`);
      
      // Extract search term from shopping list item
      const searchTerm = await extractSearchTerm(shoppingListItem);
      
      // Search for the current item using normalized term
      await searchForProduct(page, searchTerm);
      
      // Process search results and add to cart using the original description
      const addedProduct = await processSearchResults(page, shoppingListItem);
      
      // If a product was added to cart, store it
      if (addedProduct) {
        cartItems.push(addedProduct);
      }
      
      // Short pause between items
      await page.waitForTimeout(2000);
    }
    
    // Log the final shopping cart contents
    logFinalCart(cartItems);
    
    // Keep the browser open for the configured amount of time
    logger.info(`All shopping list items processed! Keeping browser open for ${config.timeouts.browserDisplay / 1000} seconds...`);
    await new Promise(resolve => setTimeout(resolve, config.timeouts.browserDisplay));
    
    // Close the browser
    await browser.close();
    logger.debug('Browser closed.');
    
  } catch (error) {
    logger.error(`Error during shopping: ${error}`);
  }
}

/**
 * Get recipe URL from command line arguments
 * @returns Recipe URL if provided, otherwise undefined
 */
function getRecipeUrlFromCommandLine(): string | undefined {
  const args = process.argv.slice(2);
  
  // Look for a URL in the command line arguments
  const urlArg = args.find(arg => arg.startsWith('http'));
  
  if (urlArg) {
    try {
      const url = new URL(urlArg);
      return url.toString();
    } catch (error) {
      logger.error(`Invalid URL provided: ${urlArg}`);
    }
  }
  
  // Check for --recipe flag
  const recipeIndex = args.findIndex(arg => arg === '--recipe' || arg === '-r');
  if (recipeIndex !== -1 && recipeIndex < args.length - 1) {
    try {
      const url = new URL(args[recipeIndex + 1]);
      return url.toString();
    } catch (error) {
      logger.error(`Invalid URL provided after --recipe flag: ${args[recipeIndex + 1]}`);
    }
  }
  
  return undefined;
}

/**
 * Extract search term from shopping list item
 * @param shoppingListItem The item from the shopping list
 * @returns The search term to use
 */
async function extractSearchTerm(shoppingListItem: string): Promise<string> {
  try {
    // Use LLM to process the ingredient description
    const searchTerm = await processIngredientDescription(shoppingListItem);
    logger.info(`LLM processing: "${shoppingListItem}" → "${searchTerm}"`);
    return searchTerm;
  } catch (error) {
    logger.error(`Error extracting search term: ${error}`);
    // Fallback to using the original item
    return shoppingListItem;
  }
}

/**
 * Search for a product on the Hemköp website
 * @param page Playwright page
 * @param searchTerm The term to search for
 */
async function searchForProduct(page: Page, searchTerm: string): Promise<void> {
  logger.debug(`Finding search bar...`);
  
  // Locate and click the search bar
  const searchBarLocator = page.locator(config.selectors.searchBar);
  await searchBarLocator.waitFor({ timeout: config.timeouts.element });
  
  // Clear the search bar properly
  await searchBarLocator.click();
  // Triple click to select all text
  await searchBarLocator.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  
  // Additional check - verify the search bar is empty
  const searchBarValue = await searchBarLocator.inputValue();
  if (searchBarValue !== '') {
    logger.debug(`Search bar not empty, contains: "${searchBarValue}". Clearing again...`);
    await searchBarLocator.fill('');
  }
  
  logger.debug(`Typing search query: ${searchTerm}...`);
  
  // Type the search term in the search field
  await page.keyboard.type(searchTerm);
  
  logger.debug('Submitting search...');
  
  // Press Enter to submit the search
  await page.keyboard.press('Enter');
  
  // Wait for URL to change to search results
  await page.waitForURL(/.*sok.*/);
  
  // Wait a bit more for the results to fully load
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
  
  logger.debug(`Search complete! Found results for "${searchTerm}".`);
  
  // Take a screenshot of the search results
  const screenshotPath = `${searchTerm.replace(/\s+/g, '-')}-search-results.png`;
  await page.screenshot({ path: screenshotPath });
  logger.debug(`Screenshot saved as ${screenshotPath}`);
}

/**
 * Process search results for a shopping list item
 * @param page Playwright page
 * @param shoppingListItem The shopping list item being processed
 * @returns The product that was added to the cart, or undefined if none was added
 */
async function processSearchResults(page: Page, shoppingListItem: string): Promise<Product | undefined> {
  const products = await findProductsOnPage(page);
  if (products.length === 0) {
    logger.error('No products found on the page');
    return undefined;
  }
  
  // Log found products for debugging
  logFoundProducts(products);
  
  // Use LLM to select the best product
  const selectedProduct = await selectBestProduct(products, shoppingListItem);
  if (!selectedProduct) {
    logger.error('LLM could not select a product');
    return undefined;
  }
  
  logger.info(`Selected: ${selectedProduct.title}`);
  logger.debug(`Selected product price: ${selectedProduct.price || 'N/A'}`);
  logger.debug(`Selected product compare price: ${selectedProduct.comparePrice || 'N/A'}`);
  
  // Add product to cart
  if (!await addProductToCart(page, selectedProduct)) {
    return undefined;
  }
  
  // Adjust quantity based on weight if needed
  await adjustProductQuantity(page, selectedProduct, shoppingListItem);
  
  // Display the final quantity information
  logFinalQuantityInfo(selectedProduct);
  
  // Wait a moment to see the result
  await page.waitForTimeout(2000);
  
  return selectedProduct;
}

/**
 * Find all products on the current page
 * @param page Playwright page
 * @returns Array of Product objects
 */
async function findProductsOnPage(page: Page): Promise<Product[]> {
  logger.debug('Checking page content for product titles...');
  const pageContent = await page.content();
  const productTitleMatches = pageContent.match(/data-testid="product-title"/g);
  logger.debug(`Found ${productTitleMatches ? productTitleMatches.length : 0} product-title attributes in HTML`);
  
  // Try locator with class name specifically from the HTML
  logger.debug('Trying to find products with specific class name...');
  const productTitleLocator = page.locator('p.sc-6f5e6e55-0.gUKaNh');
  let productTitleCount = await productTitleLocator.count();
  
  // If the specific class doesn't work, try a more general selector
  if (productTitleCount === 0) {
    logger.debug('Trying fallback selector for product titles...');
    const fallbackTitleLocator = page.locator('[data-testid="product-title"]');
    productTitleCount = await fallbackTitleLocator.count();
    
    if (productTitleCount > 0) {
      logger.debug(`Found ${productTitleCount} products with fallback selector`);
    }
  } else {
    logger.debug(`Found ${productTitleCount} products with the specific class name`);
  }
  
  if (productTitleCount === 0) {
    return [];
  }
  
  // Extract product information including prices
  const products: Product[] = [];
  for (let i = 0; i < productTitleCount; i++) {
    const titleElement = productTitleLocator.nth(i);
    const title = await titleElement.textContent() || 'Unknown product';
    
    const productInfo = await extractProductInfo(titleElement);
    
    products.push({ 
      title, 
      element: titleElement,
      price: productInfo.price, 
      comparePrice: productInfo.comparePrice,
      displayVolume: productInfo.displayVolume,
      quantity: 0 // Initialize quantity to 0
    });
  }
  
  return products;
}

/**
 * Extract product info from a product element
 * @param titleElement The title element locator
 * @returns Object containing price, comparePrice and displayVolume
 */
async function extractProductInfo(titleElement: any): Promise<{price: string, comparePrice: string, displayVolume: string}> {
  // Find the product container for this title
  const productContainer = titleElement.locator('xpath=./ancestor::div[@data-testid="product-container"]');
  
  let price = '';
  let comparePrice = '';
  let displayVolume = '';
  
  if (await productContainer.count() > 0) {
    // Extract the price
    const priceElement = productContainer.locator('[data-testid="price-text"]');
    if (await priceElement.count() > 0) {
      price = await priceElement.textContent() || '';
      price = price.trim();
    }
    
    // Extract the compare price (jmf pris)
    const comparePriceElement = productContainer.locator('[data-testid="compare-price"]');
    if (await comparePriceElement.count() > 0) {
      comparePrice = await comparePriceElement.textContent() || '';
      comparePrice = comparePrice.trim();
    }
    
    // Extract the display volume/weight (ca: 170g)
    const displayVolumeElement = productContainer.locator('[data-testid="display-volume"]');
    if (await displayVolumeElement.count() > 0) {
      displayVolume = await displayVolumeElement.textContent() || '';
      displayVolume = displayVolume.trim();
    }
  }
  
  return { price, comparePrice, displayVolume };
}

/**
 * Log details of found products for debugging
 * @param products Array of found products
 */
function logFoundProducts(products: Product[]): void {
  logger.debug(`Found ${products.length} products:`);
  if (logger.isDebugEnabled()) {
    products.forEach((product, index) => {
      logger.debug(`${index + 1}. ${product.title}`);
      logger.debug(`   Price: ${product.price || 'N/A'}`);
      logger.debug(`   Compare Price: ${product.comparePrice || 'N/A'}`);
      logger.debug(`   Display Volume: ${product.displayVolume || 'N/A'}`);
    });
  }
}

/**
 * Add a product to the cart
 * @param page Playwright page
 * @param product The product to add
 * @returns Whether the product was successfully added
 */
async function addProductToCart(page: Page, product: Product): Promise<boolean> {
  // Find the product container - go up the DOM tree
  const productContainerLocator = product.element.locator('xpath=./ancestor::div[@data-testid="product-container"]');
  logger.debug('Looking for product container...');
  
  if (await productContainerLocator.count() === 0) {
    // Try alternative approach
    return await addProductToCartAlternativeMethod(page, product);
  }
  
  logger.debug('Product container found!');
  
  // Find the buy button within the product container with text "Köp"
  const buyButtonLocator = productContainerLocator.locator('button[data-testid="button"]:has-text("Köp")');
  
  if (await buyButtonLocator.count() === 0) {
    logger.error('Buy button not found for the selected product');
    logAllButtonsInContainer(productContainerLocator);
    return false;
  }
  
  logger.debug(`Clicking 'Buy' button for: ${product.title}`);
  await buyButtonLocator.click();
  logger.info('Added product to cart');
  
  // Initialize product quantity
  product.quantity = 1;
  
  // Wait a moment for the UI to update after clicking buy
  await page.waitForTimeout(1000);
  
  return true;
}

/**
 * Alternative method to add product to cart when primary method fails
 * @param page Playwright page
 * @param product The product to add
 * @returns Whether the product was successfully added
 */
async function addProductToCartAlternativeMethod(page: Page, product: Product): Promise<boolean> {
  logger.error('Product container not found for the selected product');
  logger.debug('Trying alternative approach to find container');
  
  // Go up to common parent
  const parentDivLocator = product.element.locator('xpath=./ancestor::div[contains(@class, "sc-56f3097b")]');
  logger.debug(`Found ${await parentDivLocator.count()} potential parent divs`);
  
  if (await parentDivLocator.count() === 0) {
    logger.error('Could not find parent container with alternative method');
    return false;
  }
  
  // Find the nearest button that says "Köp"
  const buyButtonLocator = parentDivLocator.locator('button:has-text("Köp")');
  
  if (await buyButtonLocator.count() === 0) {
    logger.error('Buy button not found with alternative method');
    return false;
  }
  
  logger.debug(`Clicking 'Buy' button using alternative method for: ${product.title}`);
  await buyButtonLocator.click();
  logger.info('Added product to cart using alternative method');
  
  // Initialize product quantity
  product.quantity = 1;
  
  // Wait a moment to see the result
  await page.waitForTimeout(2000);
  return true;
}

/**
 * Log all buttons in a container for debugging
 * @param containerLocator The container locator
 */
async function logAllButtonsInContainer(containerLocator: any): Promise<void> {
  if (!logger.isDebugEnabled()) {
    return;
  }
  
  const allButtons = await containerLocator.locator('button').count();
  logger.debug(`Found ${allButtons} buttons in the container`);
  
  for (let i = 0; i < allButtons; i++) {
    const button = containerLocator.locator('button').nth(i);
    const text = await button.textContent();
    const testId = await button.getAttribute('data-testid');
    logger.debug(`Button ${i}: Text="${text}", data-testid="${testId}"`);
  }
}

/**
 * Adjust the quantity of a product based on weight information
 * @param page Playwright page
 * @param product The product to adjust
 * @param shoppingListItem The original shopping list item
 */
async function adjustProductQuantity(page: Page, product: Product, shoppingListItem: string): Promise<void> {
  // Debug: Check all buttons in the container
  const productContainerLocator = product.element.locator('xpath=./ancestor::div[@data-testid="product-container"]');
  logger.debug("Checking all buttons in the product container after clicking 'Köp':");
  debugProductButtons(productContainerLocator);
  
  // Use the exact selectors from our debug output
  const plusButtonLocator = productContainerLocator.locator('button[data-testid="plus-button"], button[aria-label="Öka antal"]');
  
  // Check if the plus button is visible
  if (await plusButtonLocator.count() === 0) {
    logger.debug("Plus button not found after buying - may need to adjust selectors");
    return;
  }
  
  logger.debug("Found plus button for quantity adjustment");
  
  // Extract weight information
  const { unitWeight, requiredWeight } = extractWeightInformation(product, shoppingListItem);
  
  // If we don't have enough information, don't adjust quantity
  if (unitWeight === 0 || requiredWeight === 0) {
    logger.info(`Added 1 of ${product.title}`);
    return;
  }
  
  // Calculate and adjust quantity based on weight
  const optimalQuantity = Math.ceil(requiredWeight / unitWeight);
  const clicksNeeded = optimalQuantity - 1; // Already have one from the initial buy click
  
  logger.debug(`Optimal quantity to reach ${requiredWeight}g is ${optimalQuantity} (${optimalQuantity * unitWeight}g)`);
  
  // Click the plus button to increase quantity to optimal amount
  for (let i = 0; i < clicksNeeded; i++) {
    logger.debug(`Clicking plus button (${i+1}/${clicksNeeded})`);
    await plusButtonLocator.click();
    product.quantity += 1;
    await page.waitForTimeout(500); // Wait between clicks
  }
  
  logger.info(`Added ${optimalQuantity} of ${product.title} (${optimalQuantity * unitWeight}g total)`);
}

/**
 * Extract unit weight and required weight from product and shopping list
 * @param product The product to extract weight from
 * @param shoppingListItem The shopping list item to extract required weight from
 * @returns Object containing unitWeight and requiredWeight in grams
 */
function extractWeightInformation(product: Product, shoppingListItem: string): {unitWeight: number, requiredWeight: number} {
  let unitWeight = 0;
  let requiredWeight = 0;
  
  // Extract weight from display volume
  const weightMatch = product.displayVolume?.match(/(\d+)\s*(g|kg)/i);
  if (weightMatch) {
    let weight = parseInt(weightMatch[1], 10);
    const unit = weightMatch[2].toLowerCase();
    
    // Convert to grams for calculations
    if (unit === 'kg') {
      weight *= 1000;
    }
    unitWeight = weight;
    logger.debug(`Each ${product.title} weighs approximately ${unitWeight}g`);
  }
  
  // Get the required weight from shopping list
  const requiredWeightMatch = shoppingListItem.match(/(\d+\.?\d*)\s*(g|gram|kg|kilo)/i);
  if (requiredWeightMatch) {
    requiredWeight = parseFloat(requiredWeightMatch[1]);
    const unit = requiredWeightMatch[2].toLowerCase();
    
    // Convert to grams for comparison
    if (unit === 'kg' || unit === 'kilo') {
      requiredWeight *= 1000;
    }
    logger.debug(`Shopping list requires approximately ${requiredWeight}g`);
  }
  
  return { unitWeight, requiredWeight };
}

/**
 * Debug helper to log info about all buttons in a product container
 * @param containerLocator The container locator
 */
async function debugProductButtons(containerLocator: any): Promise<void> {
  if (!logger.isDebugEnabled()) {
    return;
  }
  
  const allButtons = await containerLocator.locator('button').count();
  logger.debug(`Found ${allButtons} buttons in the container`);
  
  for (let i = 0; i < allButtons; i++) {
    const button = containerLocator.locator('button').nth(i);
    const text = await button.textContent();
    const ariaLabel = await button.getAttribute('aria-label');
    const testId = await button.getAttribute('data-testid');
    const isVisible = await button.isVisible();
    logger.debug(`Button ${i}: Text="${text}", aria-label="${ariaLabel}", data-testid="${testId}", visible=${isVisible}`);
  }
}

/**
 * Log final quantity information for a product
 * @param product The product to log quantity for
 */
function logFinalQuantityInfo(product: Product): void {
  logger.info(`Final quantity: ${product.quantity} of ${product.title}`);
  
  if (!product.displayVolume) {
    return;
  }
  
  const weightMatch = product.displayVolume?.match(/(\d+)\s*(g|kg)/i);
  if (!weightMatch) {
    return;
  }
  
  let weight = parseInt(weightMatch[1], 10);
  const unit = weightMatch[2].toLowerCase();
  
  // Convert to grams for calculations
  if (unit === 'kg') {
    weight *= 1000;
  }
  
  const totalWeight = weight * product.quantity;
  
  // Format the total weight nicely
  let formattedWeight = '';
  if (totalWeight >= 1000) {
    formattedWeight = `${(totalWeight / 1000).toFixed(2)}kg`;
  } else {
    formattedWeight = `${totalWeight}g`;
  }
  
  logger.info(`Total weight: ${formattedWeight}`);
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
  
  logger.debug(`Waiting up to ${cookieTimeout/1000} seconds for cookie dialog...`);
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Try to find the reject button
    const rejectButtonLocator = page.locator(config.selectors.rejectCookies);
    
    try {
      // Check if the button is visible with a short timeout
      const isVisible = await rejectButtonLocator.isVisible({ timeout: pollingInterval });
      
      if (isVisible) {
        logger.debug(`Cookie dialog found on attempt ${attempt + 1}. Rejecting cookies...`);
        
        // Add a small delay to ensure the dialog is fully loaded and clickable
        await page.waitForTimeout(500);
        
        // Click the reject button
        await rejectButtonLocator.click();
        logger.debug('Clicked reject button, continuing...');
        
        // Don't wait for dialog to disappear, just move on
        return true;
      }
    } catch (error) {
      // Ignore timeouts and continue polling
    }
    
    if (attempt < maxAttempts - 1) {
      logger.debug(`Cookie dialog not found on attempt ${attempt + 1}. Waiting...`);
      await page.waitForTimeout(pollingInterval);
    }
  }
  
  logger.debug('Cookie dialog not found after multiple attempts. Continuing anyway...');
  return false;
}

/**
 * Log the final cart contents in a nicely formatted table
 * @param cartItems Array of products in the cart
 */
function logFinalCart(cartItems: Product[]): void {
  if (cartItems.length === 0) {
    logger.info('Final shopping cart is empty.');
    return;
  }

  logger.info('=== FINAL SHOPPING CART ===');
  logger.info('Name | Quantity | Price | Compare Price');
  logger.info('-----|----------|-------|-------------');
  
  let totalPrice = 0;
  
  cartItems.forEach(item => {
    // Extract price as number for total calculation
    const priceText = item.price || '';
    const priceMatch = priceText.match(/(\d+)[,.](\d+)/);
    let itemPrice = 0;
    
    if (priceMatch) {
      itemPrice = parseFloat(`${priceMatch[1]}.${priceMatch[2]}`);
      // Calculate total price for this item
      const itemTotal = itemPrice * item.quantity;
      totalPrice += itemTotal;
    }
    
    logger.info(
      `${item.title} | ${item.quantity} | ${item.price || 'N/A'} | ${item.comparePrice || 'N/A'}`
    );
  });
  
  logger.info('-----|----------|-------|-------------');
  logger.info(`TOTAL: ${totalPrice.toFixed(2)} kr (${cartItems.length} unique items)`);
  logger.info('=============================');
}

// Run the main function
shopForGroceries().catch(error => {
  logger.error(`Unhandled error: ${error}`);
  process.exit(1);
}); 