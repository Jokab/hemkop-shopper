import { chromium } from 'playwright';
import { logger } from './logger';
import { config } from './config';

interface RecipeJsonLd {
  '@type': string;
  name?: string;
  recipeIngredient?: string[];
  [key: string]: any;
}

/**
 * Extract ingredients from a recipe URL using JSON-LD schema
 * @param url The recipe URL to extract ingredients from
 * @returns Array of ingredient strings
 */
export async function extractIngredientsFromJsonLd(url: string): Promise<string[]> {
  logger.info(`Extracting ingredients using JSON-LD from URL: ${url}`);
  
  let browser = null;
  
  try {
    // Launch a new browser instance
    logger.debug('Launching browser for JSON-LD extraction...');
    browser = await chromium.launch({
      headless: true // Use headless for recipe parsing
    });
    
    const context = await browser.newContext();
    const page = await context.newPage();
    
    try {
      // Navigate to the recipe page with longer timeout
      logger.debug(`Navigating to ${url}...`);
      await page.goto(url, { 
        timeout: config.recipeParser.timeout,
        waitUntil: 'networkidle' // Wait until network is idle
      });
      
      // Extract all JSON-LD data from the page
      logger.debug('Looking for JSON-LD recipe data...');
      const jsonLdData = await extractJsonLdData(page);
      
      if (jsonLdData.length === 0) {
        logger.error('No JSON-LD data found on the page');
        return [];
      }
      
      logger.debug(`Found ${jsonLdData.length} JSON-LD data blocks`);
      
      // Find recipe data in the JSON-LD blocks
      const recipeData = findRecipeData(jsonLdData);
      
      if (!recipeData) {
        logger.error('No Recipe type found in JSON-LD data');
        return [];
      }
      
      // Extract ingredients from recipe data
      const ingredients = extractIngredients(recipeData);
      
      if (ingredients.length === 0) {
        logger.error('No ingredients found in recipe JSON-LD data');
        return [];
      }
      
      // Filter out empty ingredients and common exclusions
      logger.debug('Filtering ingredients...');
      const filteredIngredients = ingredients
        .filter(i => i && i.length > 0)
        .filter(i => !shouldExcludeIngredient(i));
      
      // Log the extracted ingredients
      logger.info(`Extracted ${filteredIngredients.length} ingredients from JSON-LD data:`);
      filteredIngredients.forEach(ingredient => logger.info(`  - ${ingredient}`));
      
      return filteredIngredients;
    } finally {
      // Always close the browser
      logger.debug('Closing browser...');
      if (browser) await browser.close();
      logger.debug('Browser closed');
    }
  } catch (error) {
    logger.error(`Error extracting ingredients from URL: ${error}`);
    if (browser) {
      try {
        await browser.close();
        logger.debug('Browser closed after error');
      } catch (closeError) {
        logger.error(`Error closing browser: ${closeError}`);
      }
    }
    return [];
  }
}

/**
 * Extract all JSON-LD data from the page
 */
async function extractJsonLdData(page: any): Promise<any[]> {
  return page.evaluate(() => {
    const jsonLdBlocks: any[] = [];
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    
    scripts.forEach(script => {
      try {
        const content = script.textContent || '{}';
        // Handle both single objects and arrays of objects
        const data = JSON.parse(content);
        if (Array.isArray(data)) {
          jsonLdBlocks.push(...data);
        } else {
          jsonLdBlocks.push(data);
        }
      } catch (e) {
        // Ignore parsing errors
      }
    });
    
    return jsonLdBlocks;
  });
}

/**
 * Find Recipe data in JSON-LD blocks
 */
function findRecipeData(jsonLdBlocks: any[]): RecipeJsonLd | null {
  // First, look for a direct Recipe type
  let recipeData = jsonLdBlocks.find(block => 
    block['@type'] === 'Recipe' || 
    (Array.isArray(block['@type']) && block['@type'].includes('Recipe'))
  );
  
  // If not found, check for nested Recipe objects
  if (!recipeData) {
    for (const block of jsonLdBlocks) {
      // Check if there are any nested objects that might contain a Recipe
      for (const key in block) {
        if (typeof block[key] === 'object' && block[key] !== null) {
          if (block[key]['@type'] === 'Recipe') {
            recipeData = block[key];
            break;
          }
        }
      }
      if (recipeData) break;
    }
  }
  
  return recipeData as RecipeJsonLd | null;
}

/**
 * Extract ingredients from Recipe data
 */
function extractIngredients(recipeData: RecipeJsonLd): string[] {
  if (!recipeData.recipeIngredient || !Array.isArray(recipeData.recipeIngredient)) {
    // Some sites might use 'ingredients' instead of 'recipeIngredient'
    if (recipeData.ingredients && Array.isArray(recipeData.ingredients)) {
      return recipeData.ingredients;
    }
    return [];
  }
  
  return recipeData.recipeIngredient;
}

/**
 * Determine if an ingredient should be excluded
 */
function shouldExcludeIngredient(ingredient: string): boolean {
  // Convert to lowercase for case-insensitive comparison
  const lowerIngredient = ingredient.toLowerCase();
  
  // Check if the ingredient is in the exclusion list
  return config.recipeParser.excludeIngredients.some((excluded: string) => 
    lowerIngredient.includes(excluded.toLowerCase())
  );
} 