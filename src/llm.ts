import { Ollama } from 'ollama';
import { config } from './config';
import { Product } from './types';
import { logger } from './logger';

/**
 * Sends a request to Ollama LLM to select the best product match
 * based on the shopping list item
 */
export async function selectBestProduct(products: Product[], shoppingListItem: string): Promise<Product | null> {
  try {
    logger.info(`Shopping for: ${shoppingListItem}`);
    logger.debug(`Asking LLM to select the best match from ${products.length} products`);
    
    // Check if the shopping list item mentions weight requirements
    const weightMatch = shoppingListItem.match(/(\d+\.?\d*)\s*(g|gram|kg|kilo)/i);
    let requestedWeight = 0;
    let requestedUnit = '';
    
    if (weightMatch) {
      requestedWeight = parseFloat(weightMatch[1]);
      requestedUnit = weightMatch[2].toLowerCase();
      logger.debug(`Detected weight requirement: ${requestedWeight}${requestedUnit}`);
      
      // Convert to grams for easier comparison
      if (requestedUnit === 'kg' || requestedUnit === 'kilo') {
        requestedWeight *= 1000;
        logger.debug(`Converted to ${requestedWeight}g for comparison`);
      }
      
      // Try to find the best match based on weight without using LLM
      const productWeights = products.map(product => {
        // Extract weight from display volume
        const weightText = product.displayVolume || '';
        const productWeightMatch = weightText.match(/(\d+)\s*(g|kg)/i);
        
        if (productWeightMatch) {
          let weight = parseInt(productWeightMatch[1], 10);
          const unit = productWeightMatch[2].toLowerCase();
          
          // Convert to grams for comparison
          if (unit === 'kg') {
            weight *= 1000;
          }
          
          return { product, weight };
        }
        
        return { product, weight: 0 };
      });
      
      // Find product with weight closest to requested weight but not less than it
      // If all are less, pick the largest
      const validProducts = productWeights.filter(p => p.weight >= requestedWeight);
      
      if (validProducts.length > 0) {
        // Sort by closest to requested weight
        validProducts.sort((a, b) => a.weight - b.weight);
        const bestMatch = validProducts[0].product;
        logger.decision(`Selected ${bestMatch.title} (${validProducts[0].weight}g) to meet weight requirement of ${requestedWeight}g`);
        return bestMatch;
      } else {
        // If no product >= requested weight, get the largest one
        productWeights.sort((a, b) => b.weight - a.weight);
        const bestMatch = productWeights[0].product;
        logger.decision(`No product meets the weight requirement of ${requestedWeight}g. Using largest available: ${bestMatch.title} (${productWeights[0].weight}g)`);
        return bestMatch;
      }
    }
    
    // If no weight-based selection was made, continue with LLM
    // Create product list text including price information
    const productListText = products.map((p, index) => {
      const priceInfo = p.price ? `Price: ${p.price}` : 'Price: Not available';
      const comparePriceInfo = p.comparePrice ? `Compare Price: ${p.comparePrice}` : 'Compare Price: Not available';
      const volumeInfo = p.displayVolume ? `Volume/Weight: ${p.displayVolume}` : 'Volume/Weight: Not available';
      return `${index + 1}. ${p.title} - ${priceInfo} - ${comparePriceInfo} - ${volumeInfo}`;
    }).join('\n');
    
    // Create the Ollama client
    const ollama = new Ollama({
      host: config.ollama.url
    });
    
    // Prepare the prompt with the shopping list item and product options
    const prompt = `
Shopping list item: ${shoppingListItem}

Available products:
${productListText}

Based on the shopping list item, which product number is the best match? 
Pick the product with weight closest to but not less than what's needed.
Also consider type, quality requirements, and price in your decision.
If weight matches, then prefer products with the lowest comparison price (jmf pris).

First, explain your reasoning in detail. Consider the following factors, in order of importance:
1. Product type match
2. Compare price
3. Weight/volume match with the requirement
4. Product quality
5. Any other relevant factors

Then, in the final line, provide ONLY a single digit number representing your choice. For example: 2
`;

    logger.debug('Sending request to LLM...');
    
    // Make the API call to Ollama
    const response = await ollama.chat({
      model: config.ollama.model,
      messages: [
        {
          role: 'system',
          content: config.ollama.systemPrompt
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      options: {
        temperature: config.ollama.temperature
      }
    });
    
    const responseText = response.message.content.trim();
    logger.llm(`LLM reasoning:\n${responseText}`);
    
    // Extract the numeric choice from the end of the response
    const lines = responseText.trim().split('\n');
    const lastLine = lines[lines.length - 1].trim();
    
    // Try to find a single number on the last line (which is the direct selection)
    let choiceMatch = lastLine.match(/^(\d+)$/);
    
    // If not found, try to find "Final choice: X" pattern
    if (!choiceMatch) {
      const finalChoiceMatch = responseText.match(/Final choice:\s*(\d+)/i);
      if (finalChoiceMatch) {
        choiceMatch = finalChoiceMatch;
      }
    }
    
    if (choiceMatch) {
      const selectedIndex = parseInt(choiceMatch[1], 10) - 1; // Convert to 0-indexed
      
      // Validate the selected index
      if (selectedIndex < 0 || selectedIndex >= products.length) {
        logger.error(`LLM returned invalid product index: ${selectedIndex + 1} (out of range 1-${products.length})`);
        return null;
      }
      
      // Check for discrepancies in reasoning
      const reasoningText = responseText.toLowerCase();
      if (reasoningText.includes('recommend product')) {
        const recommendMatch = reasoningText.match(/recommend product (\d+)/i);
        if (recommendMatch) {
          const recommendedIndex = parseInt(recommendMatch[1], 10) - 1;
          if (recommendedIndex !== selectedIndex) {
            logger.error(`LLM reasoning inconsistency: Recommended product ${recommendedIndex + 1} but selected product ${selectedIndex + 1}`);
          }
        }
      }
      
      logger.info(`LLM selected product index: ${selectedIndex + 1}`);
      return products[selectedIndex];
    }
    
    logger.error('Failed to extract product choice from LLM response');
    
    // As a fallback, use the first product
    if (products.length > 0) {
      logger.info(`Falling back to first product: ${products[0].title}`);
      return products[0];
    }
    
    return null;
  } catch (error) {
    logger.error(`Error with LLM selection: ${error}`);
    return null;
  }
}

/**
 * Process an ingredient description to extract the search term
 * @param ingredient The ingredient description (e.g. "4 äggulor")
 * @returns The normalized search term (e.g. "ägg")
 */
export async function processIngredientDescription(ingredient: string): Promise<string> {
  try {
    const ollama = new Ollama({
      host: config.ollama.url
    });

    const prompt = `
I need to search for products in a grocery store. 
Convert this ingredient description to the simplest, most basic search term:

Ingredient: "${ingredient}"

For example:
- "4 äggulor" should be "ägg"
- "500g vetemjöl" should be "vetemjöl"
- "en burk krossade tomater" should be "krossade tomater"
- "2.5 kg bananer" should be "banan"

Return ONLY the normalized search term as plain text, with no explanation, formatting, or additional text.
`;

    const response = await ollama.chat({
      model: config.ollama.model,
      messages: [{ role: 'user', content: prompt }],
      stream: false
    });

    const searchTerm = response.message.content.trim();
    logger.debug(`Processed ingredient "${ingredient}" -> "${searchTerm}"`);
    return searchTerm;
  } catch (error) {
    logger.error(`Error processing ingredient description: ${error}`);
    // Fallback to using the original ingredient as search term
    return ingredient;
  }
} 