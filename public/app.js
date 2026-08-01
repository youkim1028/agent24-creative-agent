const form = document.querySelector("#brief-form");
const textarea = document.querySelector("#brief");
const result = document.querySelector("#result");
const runButton = document.querySelector("#run-button");
const runtimeBadge = document.querySelector("#runtime-badge");
const characterCount = document.querySelector("#character-count");
const exampleButton = document.querySelector("#example-button");
const copyButton = document.querySelector("#copy-button");
const runMeta = document.querySelector("#run-meta");

let latestOutput = "";

async function loadHealth() {
  try {
    const response = await fetch("/api/health");
    const health = await response.json();
    runtimeBadge.textContent = `${health.mode.toUpperCase()} · ${health.model}`;
    runtimeBadge.classList.toggle("warning", health.mode === "mock");
  } catch {
    runtimeBadge.textContent = "서버 연결 실패";
    runtimeBadge.classList.add("error");
  }
}

textarea.addEventListener("input", () => {
  characterCount.textContent = `${textarea.value.length.toLocaleString()} / 8,000`;
});

exampleButton.addEventListener("click", () => {
  textarea.value =
    "시각장애가 있는 대학 신입생을 위한 45초 오디오 캠퍼스 안내 대본을 만들어줘. 따뜻하지만 과장되지 않은 한국어로 쓰고, 도서관·학생식당·도움 요청 방법을 반드시 포함해. 장면별 효과음도 표시하고, 완성본을 Markdown 파일로 저장해줘.";
  textarea.dispatchEvent(new Event("input"));
  textarea.focus();
});

copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(latestOutput);
  copyButton.textContent = "복사됨";
  setTimeout(() => (copyButton.textContent = "복사"), 1200);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const brief = textarea.value.trim();
  if (!brief) return;

  runButton.disabled = true;
  runButton.classList.add("loading");
  runButton.querySelector("span:first-child").textContent = "실행 중";
  result.className = "result";
  result.textContent = "에이전트가 요청을 분석하고 있습니다…";
  runMeta.hidden = true;
  copyButton.disabled = true;

  try {
    const response = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "실행에 실패했습니다.");

    latestOutput = data.output;
    result.textContent = data.output;
    copyButton.disabled = false;
    runMeta.hidden = false;
    runMeta.textContent = `${data.mode.toUpperCase()} · ${data.model} · ${data.rounds} round · run ${data.runId.slice(0, 8)}`;
  } catch (error) {
    result.classList.add("error-result");
    result.textContent = `오류: ${error.message}`;
  } finally {
    runButton.disabled = false;
    runButton.classList.remove("loading");
    runButton.querySelector("span:first-child").textContent = "에이전트 실행";
  }
});

void loadHealth();

