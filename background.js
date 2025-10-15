// background.js

// ✅ 1. Insert your Gemini API key here (DO NOT share this publicly)
const GEMINI_API_KEY = ""; // <---- INSERT YOUR API KEY HERE

// ✅ 2. Gemini API endpoint
const GEMINI_API_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent";

// ✅ 3. Main message listener
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (!msg || !msg.type) return sendResponse({ ok: false, error: "no-type" });

      // 🔹 When content script requests Gemini API call
      if (msg.type === "CALL_GEMINI") {
        const { prompt } = msg.payload;

        try {
          const response = await fetch(`${GEMINI_API_ENDPOINT}?key=${GEMINI_API_KEY}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }]
            })
          }).catch((err)=>{
            console.log("error",err)
          });

          const data = await response.json();
          return sendResponse({ ok: true, data });
        } catch (err) {
          console.error("Gemini fetch error:", err);
          return sendResponse({ ok: false, error: err.message });
        }
      }

      // 🔹 When popup requests extraction & summarization
      if (msg.type === "EXTRACT_AND_SUMMARIZE") {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs || tabs.length === 0)
          return sendResponse({ ok: false, error: "no active tab" });

        chrome.tabs.sendMessage(
          tabs[0].id,
          { type: "DO_EXTRACT_AND_SUMMARIZE", payload: msg.payload },
          (resp) => {
            sendResponse(resp || { ok: false, error: "no-response-from-content" });
          }
        );
        return; // keep async open
      }

      sendResponse({ ok: false, error: "unknown type" });
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();

  return true; // keep async channel open
});
