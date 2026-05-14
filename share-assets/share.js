(function() {
  'use strict';

  const DEVICE_ORDERS = {
    ios: ['apple', 'overcast', 'spotify', 'youtube', 'pocketCasts', 'rss', 'website', 'antennaPod'],
    android: ['spotify', 'youtube', 'pocketCasts', 'antennaPod', 'apple', 'overcast', 'rss', 'website'],
    desktop: ['apple', 'spotify', 'youtube', 'overcast', 'pocketCasts', 'rss', 'website', 'antennaPod']
  };

  function detectDevice() {
    const ua = navigator.userAgent || '';
    if (/android/i.test(ua)) return 'android';
    if (/iphone|ipad|ipod|macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return 'ios';
    return 'desktop';
  }

  function reorderPlatformLinks() {
    const list = document.querySelector('[data-platform-list]');
    if (!list) return;
    const order = DEVICE_ORDERS[detectDevice()] || DEVICE_ORDERS.desktop;
    for (const link of list.querySelectorAll('[data-platform]')) {
      const platform = link.getAttribute('data-platform');
      const index = order.indexOf(platform);
      link.style.order = String(index === -1 ? 99 : index);
    }
  }

  async function copyText(value) {
    if (!value) return false;
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      return false;
    }
  }

  function initCopyButtons() {
    for (const button of document.querySelectorAll('[data-copy]')) {
      button.addEventListener('click', async () => {
        const original = button.textContent;
        const copied = await copyText(button.getAttribute('data-copy'));
        button.textContent = copied ? 'Copied' : 'Copy unavailable';
        setTimeout(() => {
          button.textContent = original;
        }, 1600);
      });
    }
  }

  function initShareForm() {
    const form = document.getElementById('share-form');
    if (!form) return;
    const input = document.getElementById('share-url');
    const status = document.getElementById('form-status');

    const incomingUrl = new URLSearchParams(location.search).get('url');
    if (incomingUrl && input) input.value = incomingUrl;

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const url = input.value.trim();
      if (!url) return;

      status.textContent = 'Resolving link...';
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;

      try {
        const response = await fetch('/api/share', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url })
        });
        const body = await response.json();
        if (!response.ok || !body.ok) {
          throw new Error(body.error || 'Unable to create share link');
        }
        await copyText(body.shareUrl);
        status.textContent = 'Share link created and copied.';
        location.href = body.shareUrl;
      } catch (error) {
        status.textContent = error.message || 'Unable to create share link.';
      } finally {
        submit.disabled = false;
      }
    });
  }

  function setLoadingStep(index, state) {
    const step = document.querySelector(`[data-loading-step="${index}"]`);
    if (!step) return;
    step.classList.toggle('is-active', state === 'active');
    step.classList.toggle('is-complete', state === 'complete');
  }

  function advanceLoadingSteps(targetIndex) {
    for (let index = 0; index <= 4; index += 1) {
      if (index < targetIndex) setLoadingStep(index, 'complete');
      if (index === targetIndex) setLoadingStep(index, 'active');
    }
  }

  function initShareLoader() {
    const loader = document.querySelector('[data-share-loader]');
    if (!loader) return;

    const sourceUrl = loader.getAttribute('data-source-url') || '';
    const status = loader.querySelector('[data-loading-status]');
    const messages = [
      'Reading the shared URL.',
      'Looking for the podcast feed.',
      'Matching the exact episode.',
      'Searching for video and app links.',
      'Opening your share page.'
    ];
    let syntheticStep = 0;
    let done = false;

    const timer = setInterval(() => {
      if (done) return;
      syntheticStep = Math.min(syntheticStep + 1, 3);
      advanceLoadingSteps(syntheticStep);
      if (status) status.textContent = messages[syntheticStep];
    }, 1100);

    async function createShare() {
      try {
        const response = await fetch('/api/share', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: sourceUrl })
        });
        const body = await response.json();
        if (!response.ok || !body.ok) {
          throw new Error(body.error || 'Unable to create share link');
        }

        done = true;
        clearInterval(timer);
        for (let index = 0; index < 4; index += 1) setLoadingStep(index, 'complete');
        advanceLoadingSteps(4);
        if (status) status.textContent = messages[4];
        await copyText(body.shareUrl);
        location.replace(body.shareUrl);
      } catch (error) {
        done = true;
        clearInterval(timer);
        loader.classList.add('is-error');
        if (status) status.textContent = error.message || 'Unable to create share link.';
      }
    }

    createShare();
  }

  reorderPlatformLinks();
  initCopyButtons();
  initShareForm();
  initShareLoader();
})();
