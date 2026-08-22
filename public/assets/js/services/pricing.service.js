import { getSettings } from '../core/settings.js';

let cachedPricing = null;

export async function getPricingConfig() {
  if (cachedPricing) return cachedPricing;
  const settings = await getSettings();
  cachedPricing = settings.pricingTiers || {
    image: [
      { minDuration: 1, maxDuration: 5, pricePerDay: 100 },
      { minDuration: 6, maxDuration: 10, pricePerDay: 150 }
    ],
    video: [
      { minDuration: 1, maxDuration: 15, pricePerDay: 200 },
      { minDuration: 16, maxDuration: 30, pricePerDay: 300 },
      { minDuration: 31, maxDuration: 45, pricePerDay: 400 },
      { minDuration: 46, maxDuration: 60, pricePerDay: 500 }
    ]
  };
  return cachedPricing;
}

export function calculatePrice(mediaType, duration, days, pricingTiers) {
  const tiers = pricingTiers?.[mediaType] || [];
  let pricePerDay = 0;

  for (const tier of tiers) {
    if (duration >= tier.minDuration && duration <= tier.maxDuration) {
      pricePerDay = tier.pricePerDay;
      break;
    }
  }

  if (pricePerDay === 0 && tiers.length > 0) {
    const lastTier = tiers[tiers.length - 1];
    pricePerDay = lastTier.pricePerDay;
  }

  return {
    pricePerDay,
    totalPrice: pricePerDay * days,
    currency: '₹'
  };
}

export function getPricePerDay(mediaType, duration, pricingTiers) {
  const result = calculatePrice(mediaType, duration, 1, pricingTiers);
  return result.pricePerDay;
}

export function getAllTiers(pricingTiers) {
  return pricingTiers;
}

export function invalidateCache() {
  cachedPricing = null;
}