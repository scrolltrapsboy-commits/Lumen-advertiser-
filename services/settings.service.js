const db = require('../config/db');

async function get() {
  return db.read('settings.json');
}

async function updatePricing({ photo, video, defaultVideoDuration, maxVideoSeconds }) {
  const settings = await get();
  if (photo !== undefined) settings.pricing.photo = Number(photo);
  if (video !== undefined) settings.pricing.video = Number(video);
  if (defaultVideoDuration !== undefined) settings.defaultVideoDuration = Number(defaultVideoDuration);
  if (maxVideoSeconds !== undefined) settings.maxVideoSeconds = Number(maxVideoSeconds);
  await db.write('settings.json', settings);
  return settings;
}

module.exports = { get, updatePricing };
