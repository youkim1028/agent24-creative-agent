const form = document.querySelector("#brief-form");
const textarea = document.querySelector("#brief");
const result = document.querySelector("#result");
const runButton = document.querySelector("#run-button");
const openaiBadge = document.querySelector("#openai-badge");
const xaiBadge = document.querySelector("#xai-badge");
const redditBadge = document.querySelector("#reddit-badge");
const characterCount = document.querySelector("#character-count");
const exampleButton = document.querySelector("#example-button");
const copyButton = document.querySelector("#copy-button");
const runMeta = document.querySelector("#run-meta");
const artifactActions = document.querySelector("#artifact-actions");
const pptxDownload = document.querySelector("#pptx-download");
const jsonDownload = document.querySelector("#json-download");

let latestOutput = "";

function setProviderBadge(element, provider, model) {
  const status = element.querySelector("em");
  status.textContent = provider.mode === "live" ? model : provider.mode.toUpperCase();
  element.classList.toggle("warning", provider.mode === "mock");
  element.title = `${provider.mode.toUpperCase()} · ${model}`;
}

async function loadHealth() {
  try {
    const response = await fetch("/api/health");
    const health = await response.json();
    setProviderBadge(openaiBadge, health.openai, health.openai.model);
    setProviderBadge(xaiBadge, health.xai, health.xai.model);
    redditBadge.querySelector("em").textContent = health.reddit.mode.toUpperCase();
    redditBadge.classList.toggle("warning", health.reddit.mode === "disabled");
  } catch {
    [openaiBadge, xaiBadge, redditBadge].forEach((badge) => {
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

  deck.slides.forEach((slide, index) => {
    const card = document.createElement("article");
    card.className = `slide-card ${slide.archetype}`;
    addText(card, "span", "slide-number", String(index + 1).padStart(2, "0"));
    addText(card, "p", "slide-eyebrow", slide.eyebrow || slide.archetype);
    addText(card, "h3", "slide-title", slide.title);
    if (slide.takeaway) addText(card, "p", "slide-takeaway", slide.takeaway);
    if (slide.stats?.length) {
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
    purpose: document.querySelector("#purpose").value.trim(),
    audience: document.querySelector("#audience").value.trim(),
    presentationContext: document.querySelector("#presentation-context").value.trim(),
    userVoice: document.querySelector("#user-voice").value.trim(),
    visualPreference: document.querySelector("#visual-preference").value.trim(),
    targetMarkets,
    fromDate: document.querySelector("#from-date").value || null,
    toDate: document.querySelector("#to-date").value || null,
    allowedHandles: handles,
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
    copyButton.disabled = false;
    runMeta.hidden = false;
    const score = data.evaluation ? ` · quality ${data.evaluation.score}` : "";
    const tokens = data.usage ? ` · ${data.usage.combinedTotalTokens.toLocaleString()} / ${data.usage.budgetTokens.toLocaleString()} tokens` : "";
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
