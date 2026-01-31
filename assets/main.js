// assets/main.js

// Tiny helper: highlight active nav link + copy-to-clipboard button
(function () {
  const path = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  document.querySelectorAll(".nav a").forEach(a => {
    const href = (a.getAttribute("href") || "").toLowerCase();
    if (href === path || (path === "" && href === "index.html")) a.classList.add("active");
  });

  // Copy email button (optional)
  document.querySelectorAll("[data-copy]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const value = btn.getAttribute("data-copy") || "";
      try{
        await navigator.clipboard.writeText(value);
        const old = btn.textContent;
        btn.textContent = "Copied!";
        setTimeout(()=>btn.textContent = old, 900);
      }catch(e){
        alert("Copy failed. Email: " + value);
      }
    });
  });

  // Keep "last updated" current for local edits
  const el = document.querySelector("[data-last-updated]");
  if (el) el.textContent = new Date(document.lastModified).toLocaleDateString();
})();

// Typing effect for header taglines
(function () {
  document.addEventListener("DOMContentLoaded", () => {
    const container = document.querySelector(".taglines");
    if (!container) return;

    const lines = Array.from(container.querySelectorAll("div"));
    if (!lines.length) return;

    // Save original text, then clear
    const texts = lines.map(el => (el.textContent || "").trim());
    lines.forEach(el => (el.textContent = ""));

    const cursor = document.createElement("span");
    cursor.className = "typing-cursor";
    cursor.textContent = "▍";

    let lineIdx = 0;
    let charIdx = 0;

    const charSpeed = 26;   // скорость печати
    const lineDelay = 220;  // пауза между строками
    const startDelay = 120; // пауза перед стартом

    // put cursor into first line
    lines[0].appendChild(cursor);

    function tick() {
      if (lineIdx >= lines.length) {
        cursor.remove();
        return;
      }

      const lineEl = lines[lineIdx];
      const text = texts[lineIdx];

      if (charIdx < text.length) {
        lineEl.insertBefore(document.createTextNode(text[charIdx]), cursor);
        charIdx++;
        setTimeout(tick, charSpeed);
      } else {
        // finish line
        charIdx = 0;
        lineIdx++;

        if (lineIdx < lines.length) {
          lines[lineIdx].appendChild(cursor);
          setTimeout(tick, lineDelay);
        } else {
          cursor.remove();
        }
      }
    }

    setTimeout(tick, startDelay);
  });
})();
