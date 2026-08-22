const settingsService = require('./settings.service');

let cachedPricing = null;

async function getPricingConfig() {
  if (cachedPricing) return cachedPricing;
  const settings = await settingsService.get();
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

function calculatePrice(mediaType, duration, days, pricingTiers) {
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

async function getPrice(mediaType, duration, days) {
  const pricingTiers = await getPricingConfig();
  return calculatePrice(mediaType, duration, days, pricingTiers);
}

function invalidateCache() {
  cachedPricing = null;
}

module.exports = {
  getPricingConfig,
  calculatePrice,
  getPrice,
  invalidateCache
};