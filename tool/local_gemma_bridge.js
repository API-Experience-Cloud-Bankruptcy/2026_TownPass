// Inject only into the isolated Playwright test page. Never import in the app.
(() => {
  if (!['http://127.0.0.1:5175', 'http://localhost:5175'].includes(location.origin)) throw new Error('Test origin only');
  const listeners = new Set();
  window.flutterObject = {
    addEventListener(name, listener) { if (name === 'message') listeners.add(listener); },
    removeEventListener(name, listener) { if (name === 'message') listeners.delete(listener); },
    async postMessage(raw) {
      const { name, data } = JSON.parse(raw);
      if (!['llm_status', 'llm_prepare', 'llm_interpret'].includes(name)) return;
      try {
        const response = await fetch(`http://127.0.0.1:8766/${name}`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) });
        const reply = await response.json();
        for (const listener of [...listeners]) listener({data: JSON.stringify({name, data: reply})});
      } catch {
        for (const listener of [...listeners]) listener({data: JSON.stringify({name, data: {requestId:data.requestId, error:{code:'MODEL_UNAVAILABLE'}}})});
      }
    },
  };
})();
