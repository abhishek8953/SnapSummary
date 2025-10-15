// popup.js
document.addEventListener('DOMContentLoaded', async () => {
  const modeEl = document.getElementById('mode');
  const proxyUrlEl = document.getElementById('proxyUrl');
  const apiEndpointEl = document.getElementById('apiEndpoint');
  const apiKeyEl = document.getElementById('apiKey');
  const msgEl = document.getElementById('msg');

  const conf = await chrome.storage.local.get(['mode','proxyUrl','apiEndpoint','apiKey']);
  if (conf.mode) modeEl.value = conf.mode;
  proxyUrlEl.value = conf.proxyUrl || '';
  apiEndpointEl.value = conf.apiEndpoint || '';
  apiKeyEl.value = conf.apiKey || '';

  document.getElementById('save').addEventListener('click', async () => {
    const mode = modeEl.value;
    const proxyUrl = proxyUrlEl.value.trim();
    const apiEndpoint = apiEndpointEl.value.trim();
    const apiKey = apiKeyEl.value.trim();
    await chrome.storage.local.set({ mode, proxyUrl, apiEndpoint, apiKey });
    msgEl.textContent = 'Saved.';
    setTimeout(()=> msgEl.textContent = '', 2000);
  });

  document.getElementById('summarizeNow').addEventListener('click', async () => {
    const conf = await chrome.storage.local.get(['mode','proxyUrl','apiEndpoint','apiKey']);
    const useProxy = (conf.mode || 'proxy') === 'proxy';
    const payload = {
      // pass proxyUrl so background can forward
      useProxy,
      proxyUrl: conf.proxyUrl
    };
    // Ask background to start extraction+summary flow
    chrome.runtime.sendMessage({ type:'EXTRACT_AND_SUMMARIZE', payload }, (resp) => {
      if (chrome.runtime.lastError) {
        alert('Error: ' + chrome.runtime.lastError.message);
      } else {
        alert('Summarize request sent. Check right-side panel in Gmail.');
      }
    });
  });
});
