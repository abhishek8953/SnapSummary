// content-script.js
(function(){
  if (window.__gmailGeminiInjected) return;
  window.__gmailGeminiInjected = true;

  // Utility: safeText - get trimmed plain text
  function safeText(node) {
    if (!node) return '';
    return (node.innerText || node.textContent || '').trim();
  }

  // Build the sidebar UI
  function createSidebar() {
    const container = document.createElement('div');
    container.id = 'ggs-sidebar';
    const css = `
      #ggs-sidebar {
        position: fixed;
        right: 12px;
        top: 80px;
        width: 360px;
        max-height: 70vh;
        background: #fff;
        border: 1px solid rgba(0,0,0,0.12);
        box-shadow: 0 6px 18px rgba(0,0,0,0.12);
        z-index: 2147483647;
        font-family: Arial, sans-serif;
        padding: 12px;
        overflow: auto;
        border-radius: 8px;
      }
      #ggs-sidebar h3 { margin: 0 0 8px 0; font-size: 15px; }
      #ggs-sidebar .ggs-actions { display:flex; gap:8px; margin-bottom:8px; }
      #ggs-sidebar button { padding:6px 8px; cursor:pointer; }
      #ggs-sidebar .ggs-output { font-size:13px; line-height:1.4; }
      #ggs-sidebar .ggs-loading { opacity: 0.7; font-style: italic; }
      #ggs-sidebar .ggs-close { position:absolute; right:8px; top:6px; cursor:pointer; }
    `;
    const style = document.createElement('style');
    style.id = 'ggs-style';
    style.textContent = css;
    container.innerHTML = `
      <span class="ggs-close" title="Close">✕</span>
      <h3>Gmail Quick Summary</h3>
      <div class="ggs-actions">
        <button id="ggs-refresh">Summarize</button>
        <button id="ggs-config">Settings</button>
      </div>
      <div id="ggs-status"></div>
      <div class="ggs-output" id="ggs-output"></div>
    `;
    document.head.appendChild(style);
    document.body.appendChild(container);
    return container;
  }

  const sidebar = createSidebar();
  const statusEl = sidebar.querySelector('#ggs-status');
  const outputEl = sidebar.querySelector('#ggs-output');

  sidebar.querySelector('.ggs-close').addEventListener('click', () => {
    sidebar.remove();
    const st = document.getElementById('ggs-style'); if (st) st.remove();
  });

  sidebar.querySelector('#ggs-refresh').addEventListener('click', doSummarize);
  sidebar.querySelector('#ggs-config').addEventListener('click', () => {
    // Open extension popup (best-effort) - triggers extension action
    try { chrome.runtime.openOptionsPage?.(); } catch(e){ console.warn(e); }
    alert('Open extension popup to change settings (API endpoint / proxy / key).');
  });

  // Extract page content: header info, subject, thread text, meta tags; fallback to entire body text
  function extractPageContent() {
    const doc = document;
    let subject = '';
    // Try common Gmail subject selectors (subject visible when thread open)
    const subjSelectors = [
      'h2[role="heading"][data-legacy-thread-id]', // sometimes
      'h2.hP', // Gmail subject class in some versions
      'h2 span.bog' // fallback
    ];
    for (const s of subjSelectors) {
      const el = doc.querySelector(s);
      if (el && safeText(el)) { subject = safeText(el); break; }
    }

    // Try to get sender/from/time from opened thread header
    let headerText = '';
    const headerSelectors = [
      'div.ii.gt', // message container (older)
      'div[role="main"] .hA', // fallback
      'div[data-message-id]' // any message container
    ];
    // As a safer fallback, take first visible header-like area:
    const possibleHeader = [...doc.querySelectorAll('div')].find(d => /from|to|subject|sent/i.test(safeText(d).slice(0,100)));
    if (possibleHeader) headerText = safeText(possibleHeader);

    // Collect message bodies (all visible text nodes in thread)
    let bodies = [];
    // Gmail message body containers often have class 'a3s' or role='listitem' occurrences
    const bodyCandidates = doc.querySelectorAll('div.a3s, div[role="listitem"], div[role="article"], div[role="textbox"], div[aria-label="Message Body"]');
    if (bodyCandidates && bodyCandidates.length) {
      bodyCandidates.forEach(el => {
        const t = safeText(el);
        if (t && t.length > 10) bodies.push(t);
      });
    }

    // If none, fallback to selecting the main content area text
    if (bodies.length === 0) {
      const main = doc.querySelector('div[role="main"]') || doc.body;
      const textMain = safeText(main);
      if (textMain && textMain.length > 20) bodies.push(textMain.slice(0, 20000)); // limit size
    }

    // Meta tags
    const metas = {};
    doc.querySelectorAll('meta').forEach(m => {
      if (m.name) metas[m.name] = m.content;
      else if (m.getAttribute('property')) metas[m.getAttribute('property')] = m.content;
    });

    // Page URL and title
    const url = location.href;
    const title = document.title;

    // Compose final payload (trim large content)
    let combinedBody = bodies.join('\n\n---\n\n');
    if (combinedBody.length > 150000) combinedBody = combinedBody.slice(0,150000) + '\n\n[TRUNCATED]';

    return {
      subject,
      headerText,
      combinedBody,
      metas,
      url,
      title
    };
  }

  // Show status
  function setStatus(text, isLoading=false) {
    statusEl.textContent = text || '';
    statusEl.className = isLoading ? 'ggs-loading' : '';
  }

  // Render bullets (simple safe parsing)
  function renderBullets(text) {
    // If response is an array of bullets, render them; else split by newlines and bullets
    outputEl.innerHTML = '';
    if (!text) { outputEl.innerText = 'No summary.'; return; }

    // If it's JSON with 'bullets' or 'summary', try to parse
    try {
      const parsed = typeof text === 'object' ? text : JSON.parse(text);
      if (parsed && parsed.bullets && Array.isArray(parsed.bullets)) {
        const ul = document.createElement('ul');
        parsed.bullets.forEach(b => {
          const li = document.createElement('li'); li.textContent = b; ul.appendChild(li);
        });
        outputEl.appendChild(ul);
        return;
      }
      if (parsed && parsed.summary) {
        const ul = document.createElement('ul');
        (parsed.summary.split(/\n+/)).forEach(line => {
          const trimmed = line.trim();
          if (trimmed) {
            const li = document.createElement('li'); li.textContent = trimmed; ul.appendChild(li);
          }
        });
        outputEl.appendChild(ul);
        return;
      }
    } catch(e) {
      // not JSON - continue
    }

    // fallback: split lines that look like bullets
    const lines = ('' + text).split(/\n+/).map(l => l.trim()).filter(l => l);
    const ul = document.createElement('ul');
    lines.forEach(l => {
      // Remove leading numbering or bullet characters
      const clean = l.replace(/^[-*\d\.\)\s]+/, '').trim();
      const li = document.createElement('li'); li.textContent = clean; ul.appendChild(li);
    });
    outputEl.appendChild(ul);
  }

  // Main: extract, send, display
  async function doSummarize() {
    try {
      setStatus('Extracting page content...', true);
      const payload = extractPageContent();
      setStatus('Sending to Gemini...', true);

      // Ask background to call Gemini. Background will check chrome.storage settings
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type:'CALL_GEMINI', payload: { prompt: generatePrompt(payload), useProxy: false } }, (resp) => {
          if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
          resolve(resp);
        });
      });

      setStatus('');
      if (!response || !response.ok) {
        outputEl.innerText = 'Error: ' + (response && response.error ? response.error : 'no response');
        return;
      }

      // Pick text from response depending on provider shape
      let resultText = '';
      if (response.data) {
        // try common patterns (Responses API-like or generic)
        if (response.data.output) resultText = JSON.stringify(response.data.output); // fallback
        else if (response.data.choices && response.data.choices[0]) resultText = response.data.choices[0].message?.content?.[0]?.text || response.data.choices[0].text || JSON.stringify(response.data.choices[0]);
        else resultText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
      } else if (response.data === undefined && response.ok && response.message) {
        resultText = response.message;
      } else {
        resultText = JSON.stringify(response);
      }

      renderBullets(resultText);
    } catch (err) {
      setStatus('');
      outputEl.innerText = 'Error while summarizing: ' + (err.message || err);
      console.error(err);
    }
  }

  // Compose a robust prompt for the LLM: ask for bullets and summarization of subject/header/body
  function generatePrompt(payload) {
    // keep it short but informative. You can adjust temperature/params on server or endpoint.
    const prompt = `
You are an assistant that reads an email page and returns a concise bullet-point summary for the user.
Return only a JSON object like: {"bullets": ["...","...","..."], "summary":"one-line summary"}.

Page title: ${payload.title}
Page URL: ${payload.url}
Subject: ${payload.subject || '[not found]'}
Header snippet: ${payload.headerText ? payload.headerText.slice(0,1000) : '[none]'}
Email/body content (trimmed): ${payload.combinedBody.slice(0,3000)}

Please produce 6–10 short bullet points that capture the key facts, actions required, names, dates, numbers, and a one-line summary. Keep bullets short (max 30 words each).
`;
    return prompt;
  }

  // Listen to messages from background/popup to trigger summarization
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'DO_EXTRACT_AND_SUMMARIZE') {
      (async () => {
        await doSummarize();
        sendResponse({ ok:true });
      })();
      return true;
    }
  });

  // Auto-place a "Summarize" button in the panel for convenience
  // Optionally auto-summarize on load - commented by default
  // setTimeout(doSummarize, 2000);
})();
