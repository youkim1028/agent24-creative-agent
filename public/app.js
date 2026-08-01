const form = document.querySelector("#brief-form");
const textarea = document.querySelector("#brief");
const result = document.querySelector("#result");
const runButton = document.querySelector("#run-button");
const openaiBadge = document.querySelector("#openai-badge");
const xaiBadge = document.querySelector("#xai-badge");
const youtubeBadge = document.querySelector("#youtube-badge");
const hackerNewsBadge = document.querySelector("#hacker-news-badge");
const pexelsBadge = document.querySelector("#pexels-badge");
const unsplashBadge = document.querySelector("#unsplash-badge");
const imageUploads = document.querySelector("#image-uploads");
const pptxUpload = document.querySelector("#pptx-upload");
const uploadStatus = document.querySelector("#upload-status");

// 첨부한 PPTX의 기존 슬라이드 내용을 브리프로 불러와, 같은 파이프라인이
// "새 생성"이 아니라 "재설계·수정"으로 동작하게 한다.
pptxUpload?.addEventListener("change", async () => {
  const file = pptxUpload.files?.[0];
  if (!file) return;
  uploadStatus.textContent = `${file.name} 내용을 불러오는 중…`;
  try {
    const response = await fetch("/api/uploads/pptx", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name),
      },
      body: file,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "PPTX를 해석하지 못했습니다.");
    const existing = textarea.value.trim();
    textarea.value = existing ? `${existing}\n\n${data.brief}` : data.brief;
    textarea.dispatchEvent(new Event("input"));
    uploadStatus.textContent = `${file.name} — 슬라이드 ${data.slideCount}장 내용을 브리프에 불러왔습니다. 수정 방향을 브리프 상단에 적고 실행하세요.`;
  } catch (error) {
    uploadStatus.textContent = error instanceof Error ? error.message : "PPTX 업로드에 실패했습니다.";
  } finally {
    pptxUpload.value = "";
  }
});
const characterCount = document.querySelector("#character-count");
const exampleButton = document.querySelector("#example-button");
const copyButton = document.querySelector("#copy-button");
const runMeta = document.querySelector("#run-meta");
const artifactActions = document.querySelector("#artifact-actions");
const pptxDownload = document.querySelector("#pptx-download");
const jsonDownload = document.querySelector("#json-download");

let latestOutput = "";

// Mirrors THEMES in src/deck/render.ts so the preview shows the same design
// system the PPTX will use — same surfaces, same accent, same cover/body arc.
const PREVIEW_THEMES = {
  ink_acid: {
    accent: "#D9FF54", accentInk: "#10140D",
    body: { bg: "#141712", text: "#F2F4EE", soft: "#C9CFC2", muted: "#7E8678", line: "#272C24", panel: "#1B201A" },
    cover: { bg: "#0E120C", text: "#F5F7F0", soft: "#B9C1B1", muted: "#77816F", line: "#232921", panel: "#161B14" },
  },
  editorial_light: {
    accent: "#C14B35", accentInk: "#FFFFFF",
    body: { bg: "#F6F4ED", text: "#1D1F1A", soft: "#4C5047", muted: "#8E9288", line: "#DDD9CC", panel: "#FFFFFF" },
    cover: { bg: "#17352E", text: "#F7F5EF", soft: "#CFD8CF", muted: "#8FA398", line: "#2A473F", panel: "#1E403A" },
  },
  warm_documentary: {
    accent: "#E8A24A", accentInk: "#2A1D10",
    body: { bg: "#2A211B", text: "#F6EDDF", soft: "#D8C9B4", muted: "#9A8871", line: "#3C3128", panel: "#332822" },
    cover: { bg: "#1F1812", text: "#F8F0E2", soft: "#CDBBA2", muted: "#8F7E67", line: "#342A20", panel: "#281F17" },
  },
  mono_evidence: {
    accent: "#161616", accentInk: "#F4F4F2",
    body: { bg: "#F1F1EF", text: "#161616", soft: "#3E3E3E", muted: "#8C8C8C", line: "#D8D8D4", panel: "#FFFFFF" },
    cover: { bg: "#141414", text: "#F5F5F3", soft: "#C9C9C5", muted: "#858581", line: "#2B2B2B", panel: "#1D1D1D" },
  },
};

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Same guard as the renderer: a near-black accent (mono_evidence) is invisible
// on its own black covers, so flip to accentInk when luminance is too close.
function accentOn(theme, surface) {
  const luminance = (hex) => {
    const value = hex.replace("#", "");
    return parseInt(value.slice(0, 2), 16) * 0.299 + parseInt(value.slice(2, 4), 16) * 0.587 + parseInt(value.slice(4, 6), 16) * 0.114;
  };
  return Math.abs(luminance(theme.accent) - luminance(surface.bg)) < 60 ? theme.accentInk : theme.accent;
}

// Same emblem geometries the renderer draws with native shapes, as inline SVG.
function emblemSvg(kind, accent, soft, muted) {
  const svgs = {
    concentric_rings: `<circle cx="16" cy="16" r="14" fill="none" stroke="${accent}" stroke-width="1.8"/><circle cx="16" cy="16" r="9" fill="none" stroke="${soft}" stroke-width="1.2"/><circle cx="16" cy="16" r="2.6" fill="${accent}"/>`,
    orbit_dot: `<circle cx="15" cy="17" r="13" fill="none" stroke="${soft}" stroke-width="1.2"/><circle cx="26" cy="6" r="4" fill="${accent}"/>`,
    dot_grid: [0, 1, 2].flatMap((row) => [0, 1, 2].map((col) =>
      `<circle cx="${5 + col * 11}" cy="${5 + row * 11}" r="2.8" fill="${row === 2 && col === 2 ? accent : muted}"/>`)).join(""),
    line_stack: [[32, 0, accent, 2.6], [23, 1, soft, 1.4], [16, 2, soft, 1.4], [10, 3, soft, 1.4]].map(([w, row, color, width]) =>
      `<line x1="0" y1="${5 + row * 8}" x2="${w}" y2="${5 + row * 8}" stroke="${color}" stroke-width="${width}"/>`).join(""),
    triangle_peak: `<polygon points="16,3 30,25 2,25" fill="none" stroke="${accent}" stroke-width="1.8"/><line x1="0" y1="30" x2="32" y2="30" stroke="${soft}" stroke-width="1.2"/>`,
  };
  const shapes = svgs[kind];
  return shapes ? `<svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">${shapes}</svg>` : "";
}

function setProviderBadge(element, provider, model) {
  const status = element.querySelector("em");
  const isLive = !["mock", "disabled"].includes(provider.mode);
  status.textContent = isLive ? (model || provider.mode.toUpperCase()) : provider.mode.toUpperCase();
  element.classList.toggle("warning", !isLive);
  element.title = `${provider.mode.toUpperCase()} · ${model}`;
}

async function loadHealth() {
  try {
    const response = await fetch("/api/health");
    const health = await response.json();
    setProviderBadge(openaiBadge, health.openai, health.openai.model);
    setProviderBadge(xaiBadge, health.xai, health.xai.model);
    setProviderBadge(youtubeBadge, health.youtube, "DATA API");
    setProviderBadge(hackerNewsBadge, health.hackerNews, "SEARCH API");
    setProviderBadge(pexelsBadge, health.images.providers.pexels, "SEARCH");
    setProviderBadge(unsplashBadge, health.images.providers.unsplash, "SEARCH");
  } catch {
    [openaiBadge, xaiBadge, youtubeBadge, hackerNewsBadge, pexelsBadge, unsplashBadge].forEach((badge) => {
      badge.querySelector("em").textContent = "연결 실패";
      badge.classList.add("error");
    });
  }
}

function addText(parent, tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  parent.append(node);
  return node;
}

function numericPreviewValue(value) {
  const match = String(value).replaceAll(",", "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function renderChartPreview(card, stats) {
  const chart = document.createElement("div");
  chart.className = "preview-chart";
  const max = Math.max(...stats.map((stat) => numericPreviewValue(stat.value)), 1);
  stats.slice(0, 3).forEach((stat) => {
    const row = document.createElement("div");
    row.className = "preview-chart-row";
    addText(row, "span", "preview-chart-label", stat.label);
    const track = document.createElement("span");
    track.className = "preview-chart-track";
    const bar = document.createElement("span");
    bar.className = "preview-chart-bar";
    bar.style.width = `${Math.max(3, (numericPreviewValue(stat.value) / max) * 100)}%`;
    track.append(bar);
    row.append(track);
    addText(row, "strong", "preview-chart-value", stat.value);
    chart.append(row);
  });
  card.append(chart);
}

function renderDiagramPreview(card, bullets) {
  const flow = document.createElement("div");
  flow.className = "preview-flow";
  bullets.slice(0, 5).forEach((bullet, index) => {
    const node = document.createElement("div");
    node.className = "preview-flow-node";
    addText(node, "span", "preview-flow-index", String(index + 1).padStart(2, "0"));
    addText(node, "strong", "preview-flow-label", bullet.split(/\s*(?:—|–|:)\s*/)[0]);
    flow.append(node);
  });
  card.append(flow);
}

function renderDeck(deck, evaluation = null) {
  result.replaceChildren();
  result.className = "result deck-result";
  addText(result, "p", "deck-thesis", deck.thesis);

  const summary = document.createElement("div");
  summary.className = "deck-summary";
  if (deck.aestheticIntent) {
    const intent = document.createElement("div");
    intent.className = "aesthetic-summary";
    addText(intent, "span", "aesthetic-theme", deck.aestheticIntent.theme.replaceAll("_", " "));
    addText(intent, "span", "aesthetic-mood", deck.aestheticIntent.mood);
    addText(intent, "p", "aesthetic-rationale", deck.aestheticIntent.rationale);
    summary.append(intent);
  }
  if (evaluation) {
    const review = document.createElement("div");
    review.className = "evaluation-summary";
    addText(review, "span", "evaluation-score", `QUALITY ${evaluation.score}`);
    addText(review, "span", "evaluation-status", evaluation.ready ? "READY TO REVIEW" : "NEEDS REVISION");
    if (evaluation.issues?.length) addText(review, "p", "evaluation-issues", evaluation.issues.map((issue) => issue.message).join(" · "));
    summary.append(review);
  }
  if (summary.childElementCount) result.append(summary);
  const grid = document.createElement("div");
  grid.className = "slide-grid";

  const theme = PREVIEW_THEMES[deck.aestheticIntent?.theme] || PREVIEW_THEMES.ink_acid;

  deck.slides.forEach((slide, index) => {
    const isCover = slide.archetype === "title" || slide.archetype === "closing";
    const surface = isCover ? theme.cover : theme.body;
    const layout = slide.visualDirective?.layout || "";
    const card = document.createElement("article");
    card.className = `slide-card ${slide.archetype}${slide.image ? " has-image" : ""}${isCover ? " cover" : ""}`;
    const accent = accentOn(theme, surface);
    Object.entries({
      "--pv-bg": surface.bg, "--pv-text": surface.text, "--pv-soft": surface.soft,
      "--pv-muted": surface.muted, "--pv-line": surface.line, "--pv-panel": surface.panel,
      "--pv-accent": accent, "--pv-accent-ink": theme.accentInk,
    }).forEach(([name, value]) => card.style.setProperty(name, value));

    // Covers render a bound image full-bleed under a scrim — same as the PPTX.
    const fullBleed = isCover && slide.image;
    if (fullBleed) {
      card.classList.add("cover-bleed");
      const scrim = hexToRgba(surface.bg, 0.66);
      card.style.backgroundImage = `linear-gradient(${scrim}, ${scrim}), url("${slide.image.previewUrl.replace(/"/g, "%22")}")`;
    }
    if (isCover && deck.aestheticIntent?.emblem) {
      const mark = document.createElement("div");
      mark.className = "slide-emblem";
      mark.innerHTML = emblemSvg(deck.aestheticIntent.emblem.kind, accent, surface.soft, surface.muted);
      card.append(mark);
    }
    addText(card, "span", "slide-number", String(index + 1).padStart(2, "0"));
    addText(card, "p", "slide-eyebrow", slide.eyebrow || slide.archetype);
    addText(card, "h3", "slide-title", slide.title);
    if (slide.image && !fullBleed) {
      const figure = document.createElement("figure");
      figure.className = "slide-preview-image";
      if (layout === "image_left") figure.classList.add("left");
      const image = document.createElement("img");
      image.src = slide.image.previewUrl;
      image.alt = slide.visualDirective?.imageIntent?.purpose || "선택된 슬라이드 이미지";
      image.loading = "lazy";
      const caption = document.createElement("figcaption");
      caption.textContent = slide.image.attributionText;
      figure.append(image, caption);
      card.append(figure);
    } else if (fullBleed) {
      addText(card, "p", "slide-bleed-attribution", slide.image.attributionText);
    }
    if (slide.takeaway) addText(card, "p", "slide-takeaway", slide.takeaway);
    const visualAssetType = slide.visualDirective?.visualAssetType || "none";
    if (visualAssetType === "chart" && slide.stats?.length) {
      renderChartPreview(card, slide.stats);
    } else if (slide.bullets?.length && (visualAssetType === "diagram" || ["steps", "diagram_flow", "timeline"].includes(layout))) {
      renderDiagramPreview(card, slide.bullets);
    } else if (layout === "split" && slide.bullets?.length) {
      const midpoint = Math.ceil(slide.bullets.length / 2);
      const panels = document.createElement("div");
      panels.className = "preview-split";
      [slide.bullets.slice(0, midpoint), slide.bullets.slice(midpoint)].forEach((items) => {
        if (items.length === 0) return;
        const panel = document.createElement("ul");
        panel.className = "preview-split-panel";
        items.forEach((bullet) => addText(panel, "li", "", bullet));
        panels.append(panel);
      });
      card.append(panels);
    } else if (layout === "evidence_focus" && slide.bullets?.length) {
      const list = document.createElement("ul");
      list.className = "evidence-list";
      slide.bullets.forEach((bullet) => addText(list, "li", "", bullet));
      card.append(list);
    } else if (slide.stats?.length) {
      const stats = document.createElement("div");
      stats.className = "preview-stats";
      slide.stats.forEach((stat) => {
        const item = document.createElement("div");
        addText(item, "strong", "", stat.value);
        addText(item, "span", "", stat.label);
        stats.append(item);
      });
      card.append(stats);
    } else if (slide.bullets?.length) {
      const list = document.createElement("ul");
      slide.bullets.forEach((bullet) => addText(list, "li", "", bullet));
      card.append(list);
    }
    if (slide.citations?.length) {
      addText(card, "p", "slide-sources", slide.citations.map((citation) => citation.handle || citation.title).join(" · "));
    }
    grid.append(card);
  });
  result.append(grid);
}

textarea.addEventListener("input", () => {
  characterCount.textContent = `${textarea.value.length.toLocaleString()} / 8,000`;
});

exampleButton.addEventListener("click", () => {
  textarea.value =
    "생성형 AI 영상 도구에 대한 한국 크리에이터들의 최근 X 반응을 조사하고, 서비스 기획팀이 다음 기능 우선순위를 결정할 수 있는 5장 발표 자료를 만들어줘. 반응과 사실을 구분하고, 서로 충돌하는 의견도 보여줘.";
  textarea.dispatchEvent(new Event("input"));
  textarea.focus();
});

copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(latestOutput);
    const label = copyButton.querySelector("span");
    label.textContent = "복사됨";
    setTimeout(() => (label.textContent = "요약 복사"), 1200);
  } catch {
    copyButton.title = "브라우저에서 클립보드 권한을 허용해 주세요.";
  }
});

function commaSeparatedUrls(selector) {
  return document.querySelector(selector).value
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 8);
}

async function uploadSelectedImages() {
  const files = [...imageUploads.files].slice(0, 8);
  if (files.length === 0) return [];
  const boardLabel = document.querySelector("#board-label").value.trim() || "User reference board";
  const assetIds = [];
  for (const [index, file] of files.entries()) {
    uploadStatus.textContent = `이미지 업로드 ${index + 1} / ${files.length}`;
    const response = await fetch("/api/uploads", {
      method: "POST",
      headers: {
        "Content-Type": file.type,
        "X-File-Name": encodeURIComponent(file.name),
        "X-Board-Label": encodeURIComponent(boardLabel),
      },
      body: file,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `${file.name} 업로드에 실패했습니다.`);
    assetIds.push(data.assetId);
  }
  uploadStatus.textContent = `${assetIds.length}개 이미지가 로컬 보드에 준비되었습니다.`;
  return assetIds;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const brief = textarea.value.trim();
  if (!brief) return;

  const handles = document.querySelector("#allowed-handles").value
    .split(",")
    .map((value) => value.trim().replace(/^@/, ""))
    .filter(Boolean);
  const targetMarkets = document.querySelector("#target-markets").value
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 3);
  const body = {
    brief,
    slideCount: Number(document.querySelector("#slide-count").value),
    language: document.querySelector("#language").value,
    additionalContext: document.querySelector("#additional-context").value.trim(),
    targetMarkets,
    fromDate: document.querySelector("#from-date").value || null,
    toDate: document.querySelector("#to-date").value || null,
    allowedHandles: handles,
    officialImageUrls: commaSeparatedUrls("#official-image-urls"),
    designReferenceUrls: commaSeparatedUrls("#design-reference-urls"),
  };

  runButton.disabled = true;
  runButton.classList.add("loading");
  runButton.querySelector("span:first-child").textContent = "생성 중";
  result.className = "result deck-result";
  result.replaceChildren();
  const loading = document.createElement("div");
  loading.className = "loading-state";
  const spinner = document.createElement("span");
  spinner.className = "loading-spinner";
  spinner.setAttribute("aria-hidden", "true");
  const loadingText = document.createElement("span");
  loadingText.textContent = "커뮤니티 근거를 수집하고 덱을 설계하고 있습니다…";
  loading.append(spinner, loadingText);
  result.append(loading);
  runMeta.hidden = true;
  artifactActions.hidden = true;
  copyButton.disabled = true;

  try {
    body.uploadedAssetIds = await uploadSelectedImages();
    const response = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "실행에 실패했습니다.");

    latestOutput = data.output || data.deck?.thesis || "";
    if (data.deck) renderDeck(data.deck, data.evaluation);
    else result.textContent = data.output;
    if (data.gate && data.gate.passed === false) {
      const blocked = document.createElement("div");
      blocked.className = "gate-blocked";
      blocked.textContent = data.output;
      result.prepend(blocked);
    }
    copyButton.disabled = false;
    runMeta.hidden = false;
    const score = data.evaluation ? ` · quality ${data.evaluation.score}` : "";
    const tokens = data.usage
      ? ` · GPT ${data.usage.openai.totalTokens.toLocaleString()} / ${data.usage.budgetTokens.toLocaleString()} · xAI ${data.usage.xai.totalTokens.toLocaleString()} tokens`
      : "";
    const architecture = data.architecture ? ` · ${data.architecture.toUpperCase()} architecture` : "";
    runMeta.textContent = `${data.mode.toUpperCase()} ${data.model}${architecture} · ${data.xMode.toUpperCase()} ${data.grokModel} · ${data.rounds} rounds${score}${tokens} · run ${data.runId.slice(0, 8)}`;
    if (data.artifact) {
      pptxDownload.href = data.artifact.downloadUrl;
      pptxDownload.download = data.artifact.filename;
      jsonDownload.href = data.artifact.jsonUrl;
      jsonDownload.download = data.artifact.jsonFilename;
      artifactActions.hidden = false;
    }
  } catch (error) {
    result.classList.add("error-result");
    result.textContent = `생성하지 못했습니다. ${error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요."}`;
  } finally {
    runButton.disabled = false;
    runButton.classList.remove("loading");
    runButton.querySelector("span:first-child").textContent = "덱 생성";
  }
});

void loadHealth();
