/**
 * Shared interface for product information
 */
export interface Product {
  title: string;
  element: any; // Playwright element
  price?: string;
  comparePrice?: string;
  displayVolume?: string;
  quantity: number; // Track the quantity of the product
} 