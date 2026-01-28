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
