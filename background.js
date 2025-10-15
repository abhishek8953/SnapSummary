// background.js

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (!msg || !msg.type) return sendResponse({ ok:false, error:'no-type' });

      if (msg.type === 'CALL_GEMINI') {
        // msg.payload: {prompt, useProxy, proxyUrl}
        const { prompt, useProxy, proxyUrl } = msg.payload;

        if (useProxy) {
          if (!proxyUrl) return sendResponse({ ok:false, error:'proxyUrl required' });
          // forward to user-provided proxy
          const resp = await fetch(proxyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt })
          });
          const data = await resp.json();
          return sendResponse({ ok:true, data });
        } else {
          // Direct call: read apiKey and endpoint from chrome.storage
          const conf = await chrome.storage.local.get(['apiKey','apiEndpoint','apiProvider']);
          const apiKey = conf.apiKey;
          const apiEndpoint = conf.apiEndpoint;
          if (!apiKey || !apiEndpoint) return sendResponse({ ok:false, error:'apiKey or apiEndpoint not set. Use popup to set them.' });

          // Example: send request to endpoint (you must set apiEndpoint appropriate to Gemini docs)
          const body = {
            // The body shape depends on API. Here is a basic OpenAI/Responses-like example;
            // adjust to the exact Gemini/endpoint schema you use.
            input: prompt
          };

          const resp = await fetch(apiEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(body)
          });
          const data = await resp.json();
          return sendResponse({ ok:true, data });
        }
      }

      if (msg.type === 'EXTRACT_AND_SUMMARIZE') {
        // Forward to the content script in the active tab (in case popup requested extraction)
        const tabs = await chrome.tabs.query({active:true, currentWindow:true});
        if (!tabs || tabs.length === 0) return sendResponse({ ok:false, error:'no active tab' });
        chrome.tabs.sendMessage(tabs[0].id, { type:'DO_EXTRACT_AND_SUMMARIZE', payload: msg.payload }, (resp) => {
          // resp will come from content script
          sendResponse(resp || { ok:false, error:'no-response-from-content' });
        });
        return; // keep channel open
      }

      sendResponse({ ok:false, error:'unknown type' });
    } catch (e) {
      sendResponse({ ok:false, error: e.message });
    }
  })();
  return true; // async
});
