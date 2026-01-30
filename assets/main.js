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


// --- YTM Heatmap (Plotly treemap) ---
// Works only if #ytmTreemap exists on the page.
(function () {
  function $(id){ return document.getElementById(id); }

  const chartDiv = $("ytmTreemap");
  if (!chartDiv) return; // not on activities page

  const updatedDiv = $("ytmUpdated");
  const toast = $("toast");

  function showToast(msg){
    if (!toast) return;
    toast.textContent = msg;
    toast.style.display = "block";
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(()=> toast.style.display="none", 1600);
  }

  async function loadYtmJson(){
    // cache-bust to avoid GitHub Pages caching
    const url = "./data/ytm_top20.json?v=" + Date.now();
    const res = await fetch(url, { cache: "no-store" });
    if(!res.ok) throw new Error("Cannot load " + url + " (HTTP " + res.status + ")");
    return await res.json();
  }

  function renderTreemap(payload){
    const rows = payload?.rows || [];
    const cols = payload?.cols || [];
    const updated_at = payload?.updated_at || "";

    if (updatedDiv) updatedDiv.textContent = updated_at ? ("Updated: " + updated_at) : "Updated: —";

    if(!rows.length){
      chartDiv.innerHTML = "<div style='padding:14px;color:rgba(255,255,255,.85)'>No data in data/ytm_top20.json</div>";
      return;
    }

    // Plotly must exist
    if (typeof Plotly === "undefined") {
      chartDiv.innerHTML = "<div style='padding:14px;color:rgba(255,255,255,.85)'>Plotly is not loaded. Add Plotly CDN in &lt;head&gt;.</div>";
      return;
    }

    const labels = rows.map(r => String(r.SECID));
    const values = rows.map(r => Number(r.SIZE || 1));
    const customdata = rows.map(r => cols.map(c => r[c]));

    // ---- Robust color normalization (ignore outliers like 62% dominating) ----
    const ytmRaw = rows.map(r => {
      const v = r.YTM;
      if (v === null || v === undefined) return NaN;
      // handle "17,45" -> "17.45" just in case
      const s = String(v).replace(",", ".");
      const num = Number(s);
      return Number.isFinite(num) ? num : NaN;
    });

    const ytmArr = ytmRaw.filter(v => Number.isFinite(v)).sort((a,b)=>a-b);

    const quantile = (p) => {
      if (!ytmArr.length) return 0;
      const i = (ytmArr.length - 1) * p;
      const lo = Math.floor(i), hi = Math.ceil(i);
      const w = i - lo;
      const vlo = (ytmArr[lo] ?? 0);
      const vhi = (ytmArr[hi] ?? 0);
      return vlo * (1 - w) + vhi * w;
    };

    // KEY: use smaller upper percentile so huge values don't flatten the palette
    const P_LOW  = 0.05;
    const P_HIGH = 0.85;   // try 0.80–0.90; 0.85 is a good default
    const pLo = quantile(P_LOW);
    const pHi = quantile(P_HIGH);

    const clamp = (x,a,b)=> Math.min(b, Math.max(a, x));

    // gamma < 1 increases contrast among mid values
    const GAMMA = 0.65;

    const color = ytmRaw.map(v => {
      if (!Number.isFinite(v)) return 0.5;
      const vv = clamp(v, pLo, pHi);
      const t = (pHi - pLo) > 1e-9 ? (vv - pLo) / (pHi - pLo) : 0.5;
      return Math.pow(t, GAMMA);
    });

    // Hovertemplate based on cols
    const fmtLine = (c, i) => {
      if (c === "YTM" || c === "COUPONPERCENT") return `${c}: %{customdata[${i}]:.2f}%`;
      if (c === "YEARS") return `${c}: %{customdata[${i}]:.2f}`;
      return `${c}: %{customdata[${i}]}`;
    };

    const hoverLines = ["<b>%{label}</b>"].concat(cols.map((c,i)=>fmtLine(c,i)));
    const hovertemplate = hoverLines.join("<br>") + "<extra></extra>";

    const ytmIdx = cols.indexOf("YTM");
    const texttemplate = (ytmIdx >= 0)
      ? `<b>%{label}</b><br>%{customdata[${ytmIdx}]:.2f}%`
      : "<b>%{label}</b>";

    const data = [{
      type: "treemap",
      labels,
      parents: labels.map(()=>""), // one level
      values,
      customdata,
      hovertemplate,
      texttemplate,
      textfont: { color: "white" },
      marker: {
        colors: color,
        cmin: 0,
        cmax: 1,
        // vivid scale (high -> green)
        colorscale: [
          [0.00, "#5a0000"],
          [0.30, "#ff2d2d"],
          [0.50, "#ffd166"],
          [0.70, "#22c55e"],
          [1.00, "#00ff6a"]
        ],
        reversescale: false,
        line: { color: "#000000", width: 3 }
      },
      root: { color: "#0b0f14" }
    }];

    const layout = {
      paper_bgcolor: "#0b0f14",
      plot_bgcolor: "#0b0f14",
      margin: { t: 10, l: 10, r: 10, b: 10 },
      uniformtext: { minsize: 11, mode: "hide" }
    };

    Plotly.newPlot(chartDiv, data, layout, { displayModeBar: false, responsive: true });

    // click-to-copy SECID
    chartDiv.on("plotly_click", async (evt) => {
      const secid = evt?.points?.[0]?.label;
      if(!secid) return;

      try{
        await navigator.clipboard.writeText(String(secid));
        showToast(`Copied: ${secid}`);
      }catch(e){
        showToast(`SECID: ${secid} (copy manually)`);
      }
    });
  }

  // init
  (async function init(){
    try{
      const payload = await loadYtmJson();
      renderTreemap(payload);
    }catch(err){
      chartDiv.innerHTML =
        "<div style='padding:14px;color:rgba(255,255,255,.85)'>" +
        "<b>Treemap error:</b> " + (err?.message || String(err)) +
        "<br><br>Check that <code>data/ytm_top20.json</code> exists in the repo root and is accessible via GitHub Pages." +
        "</div>";
    }
  })();
})();
