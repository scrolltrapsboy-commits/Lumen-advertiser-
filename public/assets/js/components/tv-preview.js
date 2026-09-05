export function renderPreview(container, { url, type }) {
  container.innerHTML = '';
  if (!url) {
    container.innerHTML = '<span class="tv-preview-empty">Select a file to preview</span>';
    return;
  }

  const isVideo = type === 'video';

  const backdrop = document.createElement('div');
  backdrop.className = 'player-backdrop';

  const overlay = document.createElement('div');
  overlay.className = 'player-backdrop-overlay';

  const content = document.createElement('div');
  content.className = 'player-media-content';

  if (isVideo) {
    const bgVideo = document.createElement('video');
    bgVideo.src = url;
    bgVideo.autoplay = true;
    bgVideo.muted = true;
    bgVideo.loop = true;
    bgVideo.playsInline = true;
    bgVideo.className = 'player-backdrop-media';

    const fgVideo = document.createElement('video');
    fgVideo.src = url;
    fgVideo.autoplay = true;
    fgVideo.muted = true;
    fgVideo.loop = true;
    fgVideo.playsInline = true;
    fgVideo.className = 'player-foreground-media';

    backdrop.appendChild(bgVideo);
    backdrop.appendChild(overlay);
    content.appendChild(fgVideo);
  } else {
    const bgImg = document.createElement('img');
    bgImg.src = url;
    bgImg.className = 'player-backdrop-media';

    const fgImg = document.createElement('img');
    fgImg.src = url;
    fgImg.alt = 'Advertisement preview';
    fgImg.className = 'player-foreground-media';

    backdrop.appendChild(bgImg);
    backdrop.appendChild(overlay);
    content.appendChild(fgImg);
  }

  container.appendChild(backdrop);
  container.appendChild(content);
}
