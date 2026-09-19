const screenService = require('./screen.service');
const adService = require('./ad.service');
const { todayISO } = require('./date.util');
const { slotAvailability } = require('./slots.service');

async function summary() {
  const screens = await screenService.list();
  const ads = await adService.listAll();

  const active = ads.filter(a => a.status === 'active');
  const expired = ads.filter(a => a.status === 'expired');
  const photos = ads.filter(a => a.mediaType === 'image');
  const videos = ads.filter(a => a.mediaType === 'video');

  const revenue = ads.reduce((sum, a) => sum + Number(a.price || 0), 0);

  const today = todayISO();
  const todaysAds = ads.filter(a => a.startDate === today);
  const todaysRevenue = todaysAds.reduce((sum, a) => sum + Number(a.price || 0), 0);

  const onlineScreens = screens.filter(s => s.status === 'online').length;
  const offlineScreens = screens.filter(s => s.status === 'offline').length;

  let maxSlots = 0;
  let usedSlotsTotal = 0;
  screens.forEach(screen => {
    const avail = slotAvailability(screen, ads, 10);
    maxSlots += avail.max;
    usedSlotsTotal += avail.used;
  });

  return {
    screens: screens.length,
    onlineScreens,
    offlineScreens,
    ads: ads.length,
    runningAds: active.length,
    revenue,
    todaysRevenue,
    todaysAds: todaysAds.length,
    photos: photos.length,
    videos: videos.length,
    remainingSlots: Math.max(0, maxSlots - usedSlotsTotal),
    occupiedSlots: usedSlotsTotal,
    maxSlots,
    active: active.length,
    expired: expired.length
  };
}

module.exports = { summary };
