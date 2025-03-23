import { Ollama } from 'ollama';
import { config } from './config';

/**
 * Interface for product information
 */
interface Product {
  title: string;
  element: any; // Playwright element
  price?: string;
  comparePrice?: string;
  displayVolume?: string;
}

/**
 * Sends a request to Ollama LLM to select the best product match
 * based on the shopping list item
 */
export async function selectBestProduct(products: Product[], shoppingListItem: string): Promise<Product | null> {
  try {
    console.log(`Asking LLM to select the best match for: ${shoppingListItem}`);
    console.log(`Found ${products.length} products to choose from.`);
    
    // Check if the shopping list item mentions weight requirements
    const weightMatch = shoppingListItem.match(/(\d+)\s*(g|gram|kg|kilo)/i);
    let requestedWeight = 0;
    let requestedUnit = '';
    
    if (weightMatch) {
      requestedWeight = parseInt(weightMatch[1], 10);
      requestedUnit = weightMatch[2].toLowerCase();
      console.log(`Detected weight requirement: ${requestedWeight}${requestedUnit}`);
      
      // Convert to grams for easier comparison
      if (requestedUnit === 'kg' || requestedUnit === 'kilo') {
        requestedWeight *= 1000;
        console.log(`Converted to ${requestedWeight}g for comparison`);
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
        console.log(`Automatic weight-based selection: ${bestMatch.title} (${validProducts[0].weight}g)`);
        return bestMatch;
      } else {
        // If no product >= requested weight, get the largest one
        productWeights.sort((a, b) => b.weight - a.weight);
        const bestMatch = productWeights[0].product;
        console.log(`No product meets weight requirement. Using largest: ${bestMatch.title} (${productWeights[0].weight}g)`);
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
WEIGHT IS THE MOST IMPORTANT FACTOR. Pick the product with weight closest to but not less than what's needed.
Also consider type, quality requirements, and price in your decision.
If weight matches, then prefer products with the lowest comparison price (jmf pris).

Reply with ONLY a single digit number representing your choice, nothing else. For example: 2
`;

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
    
    console.log("LLM response: ", response.message.content);
    
    // Extract the product number from the response, looking for a single digit
    const responseText = response.message.content.trim();
    
    // Check for "Product 2" pattern first, as this is often more reliable
    const productPhraseMatch = /Product\s+(\d+)/i.exec(responseText);
    if (productPhraseMatch) {
      const selectedIndex = parseInt(productPhraseMatch[1], 10) - 1;
      if (selectedIndex >= 0 && selectedIndex < products.length) {
        console.log(`LLM mentioned product ${selectedIndex + 1} in explanation: ${products[selectedIndex].title}`);
        return products[selectedIndex];
      }
    }
    
    // Then try a clean single digit answer (1-9)
    const singleDigitMatch = /^[1-9]$/.exec(responseText);
    if (singleDigitMatch) {
      const selectedIndex = parseInt(singleDigitMatch[0], 10) - 1;
      if (selectedIndex >= 0 && selectedIndex < products.length) {
        console.log(`LLM selected product ${selectedIndex + 1}: ${products[selectedIndex].title}`);
        return products[selectedIndex];
      }
    }
    
    // If still not found, try looking for any number
    const anyNumberMatch = /\b(\d+)\b/.exec(responseText);
    if (anyNumberMatch) {
      const selectedIndex = parseInt(anyNumberMatch[1], 10) - 1;
      if (selectedIndex >= 0 && selectedIndex < products.length) {
        console.log(`Found number ${anyNumberMatch[1]} in response, selecting product: ${products[selectedIndex].title}`);
        return products[selectedIndex];
      }
    }
    
    // If we still haven't found a valid product, use the first one as fallback
    console.error("Could not determine product selection from LLM response");
    if (products.length > 0) {
      console.log(`Falling back to first product: ${products[0].title}`);
      return products[0];
    }
    
    return null;
  } catch (error) {
    console.error("Error with LLM selection:", error);
    return null;
  }
} 