const list = document.querySelector("#event-list");
const waiting = document.querySelector("#waiting");
const streamState = document.querySelector("#stream-state");
const clearButton = document.querySelector("#clear-events");
const fullscreenButton = document.querySelector("#fullscreen");

const source = new EventSource("/api/events");

source.onopen = () => {
  streamState.querySelector("span").textContent = "실시간 연결";
  streamState.classList.add("live");
};

source.onerror = () => {
  streamState.querySelector("span").textContent = "재연결 중";
  streamState.classList.remove("live");
};

source.onmessage = (message) => {
  let event;
  try {
    event = JSON.parse(message.data);
  } catch {
    return;
  }
  waiting?.remove();

  const article = document.createElement("article");
  article.className = `event-card ${event.type}`;

  const header = document.createElement("header");
  const type = document.createElement("strong");
  type.textContent = event.type;
  const metadata = document.createElement("span");
  metadata.textContent = `${new Date(event.timestamp).toLocaleTimeString("ko-KR", { hour12: false })} · run ${event.runId.slice(0, 8)}`;
  header.append(type, metadata);

  const payload = document.createElement("pre");
  payload.textContent = JSON.stringify(event.payload, null, 2);
  article.append(header, payload);
  list.append(article);
  window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
};

clearButton.addEventListener("click", async () => {
  const response = await fetch("/api/events", { method: "DELETE" });
  if (!response.ok) return;
  list.replaceChildren();
  const message = document.createElement("div");
  message.className = "trace-waiting";
  message.textContent = "화면을 비웠습니다. 새 이벤트를 기다리는 중…";
  list.append(message);
});

fullscreenButton.addEventListener("click", async () => {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await document.documentElement.requestFullscreen();
});

