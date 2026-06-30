const API_BASE =
  window.location.protocol === "file:" ||
  (window.location.hostname === "localhost" && window.location.port !== "3000") ||
  (window.location.hostname === "127.0.0.1" && window.location.port !== "3000")
    ? "http://localhost:3000"
    : "";

const languages = [
  { name: "English", zh: "英语", speechCode: "en-US", translateCode: "en" },
  { name: "Arabic", zh: "阿拉伯语", speechCode: "ar-SA", translateCode: "ar" },
  { name: "Russian", zh: "俄语", speechCode: "ru-RU", translateCode: "ru" },
  { name: "Spanish", zh: "西班牙语", speechCode: "es-ES", translateCode: "es" },
  { name: "French", zh: "法语", speechCode: "fr-FR", translateCode: "fr" },
  { name: "Portuguese", zh: "葡萄牙语", speechCode: "pt-BR", translateCode: "pt" },
  { name: "Korean", zh: "韩语", speechCode: "ko-KR", translateCode: "ko" },
  { name: "Japanese", zh: "日语", speechCode: "ja-JP", translateCode: "ja" }
];

let selectedLanguage = languages[0];
let mediaRecorder = null;
let audioChunks = [];
let activeButton = null;
let lastMerchantSpeech = null;

const els = {
  body: document.body,
  languagePage: document.getElementById("languagePage"),
  translatorPage: document.getElementById("translatorPage"),
  languageGrid: document.getElementById("languageGrid"),
  currentLanguage: document.getElementById("currentLanguage"),
  statusBar: document.getElementById("statusBar"),
  backButton: document.getElementById("backButton"),
  merchantRecordButton: document.getElementById("merchantRecordButton"),
  customerRecordButton: document.getElementById("customerRecordButton"),
  merchantSource: document.getElementById("merchantSource"),
  merchantTranslation: document.getElementById("merchantTranslation"),
  customerSource: document.getElementById("customerSource"),
  customerTranslation: document.getElementById("customerTranslation"),
  replayButton: document.getElementById("replayButton"),
  clearButton: document.getElementById("clearButton")
};

function setStatus(message, isError = false) {
  els.statusBar.textContent = message;
  els.statusBar.style.color = isError ? "#be123c" : "";
}

function showPage(pageName) {
  els.languagePage.classList.toggle("page-active", pageName === "language");
  els.translatorPage.classList.toggle("page-active", pageName === "translator");
}

function renderLanguages() {
  els.languageGrid.innerHTML = languages
    .map(
      (language, index) => `
        <button class="language-card" type="button" data-index="${index}">
          <strong>${language.name}</strong>
          <span>${language.zh}</span>
        </button>
      `
    )
    .join("");
}

function selectLanguage(language) {
  selectedLanguage = language;
  els.currentLanguage.textContent = `${language.name} / ${language.zh}`;
  els.customerRecordButton.textContent = `Customer Speak ${language.name}`;
  setStatus("按住按钮开始录音");
  showPage("translator");
}

function setBusy(isBusy) {
  els.body.classList.toggle("is-busy", isBusy);
}

function getAudioMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/wav"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

async function startRecording(button, listeningText) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    setStatus("当前浏览器不支持录音，请换用最新版 Chrome、Edge 或 Safari。", true);
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    activeButton = button;
    button.dataset.idleText = button.textContent;
    button.textContent = listeningText;
    button.classList.add("recording");

    const mimeType = getAudioMimeType();
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunks.push(event.data);
    };
    mediaRecorder.start();
    setStatus("正在听，请说话...");
  } catch (error) {
    setStatus("录音失败，请检查麦克风权限后重试。", true);
  }
}

function stopRecording() {
  return new Promise((resolve) => {
    if (!mediaRecorder || mediaRecorder.state === "inactive") {
      resolve(null);
      return;
    }

    mediaRecorder.onstop = () => {
      mediaRecorder.stream.getTracks().forEach((track) => track.stop());
      const type = mediaRecorder.mimeType || "audio/webm";
      const blob = new Blob(audioChunks, { type });
      if (activeButton) {
        activeButton.textContent = activeButton.dataset.idleText;
        activeButton.classList.remove("recording");
      }
      mediaRecorder = null;
      activeButton = null;
      resolve(blob);
    };

    mediaRecorder.stop();
  });
}

async function speechToText(audioBlob, language) {
  const formData = new FormData();
  formData.append("audio", audioBlob, "recording.webm");
  formData.append("language", language);

  const response = await fetch(`${API_BASE}/api/speech-to-text`, {
    method: "POST",
    body: formData
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "语音识别失败");
  return data.text;
}

async function translateText(text, from, to) {
  const response = await fetch(`${API_BASE}/api/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, from, to })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "翻译失败");
  return data.translatedText;
}

async function textToSpeech(text, language) {
  const response = await fetch(`${API_BASE}/api/text-to-speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, language })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "语音合成失败");
  return data.audioUrl;
}

async function playAudio(audioUrl) {
  if (!audioUrl) throw new Error("后端没有返回可播放音频");

  const url = audioUrl.startsWith("http") || audioUrl.startsWith("data:")
    ? audioUrl
    : `${API_BASE}${audioUrl}`;
  const audio = new Audio(url);

  await new Promise((resolve, reject) => {
    audio.onended = resolve;
    audio.onerror = () => reject(new Error("音频播放失败"));
    audio.play().catch(reject);
  });
}

function speakWithBrowser(text, language) {
  if (!window.speechSynthesis) {
    setStatus("当前浏览器无法播放语音，请查看翻译文字。", true);
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language;
  window.speechSynthesis.speak(utterance);
}

async function playTranslatedText(text, language) {
  try {
    const audioUrl = await textToSpeech(text, language);
    await playAudio(audioUrl);
    lastMerchantSpeech = { audioUrl, text, language };
  } catch (error) {
    speakWithBrowser(text, language);
    lastMerchantSpeech = { audioUrl: null, text, language };
  }
}

async function handleMerchantAudio(audioBlob) {
  setBusy(true);
  try {
    setStatus("正在识别中文...");
    const sourceText = await speechToText(audioBlob, "zh-CN");
    els.merchantSource.textContent = sourceText;

    setStatus(`正在翻译成${selectedLanguage.zh}...`);
    const translatedText = await translateText(sourceText, "zh", selectedLanguage.translateCode);
    els.merchantTranslation.textContent = translatedText;

    setStatus("正在播放给客户...");
    await playTranslatedText(translatedText, selectedLanguage.speechCode);
    els.replayButton.disabled = false;
    setStatus("完成，可以继续沟通");
  } catch (error) {
    setStatus(error.message || "处理失败，请重试。", true);
  } finally {
    setBusy(false);
  }
}

async function handleCustomerAudio(audioBlob) {
  setBusy(true);
  try {
    setStatus(`正在识别${selectedLanguage.zh}...`);
    const sourceText = await speechToText(audioBlob, selectedLanguage.speechCode);
    els.customerSource.textContent = sourceText;

    setStatus("正在翻译成中文...");
    const translatedText = await translateText(sourceText, selectedLanguage.translateCode, "zh");
    els.customerTranslation.textContent = translatedText;
    setStatus("完成，可以继续沟通");
  } catch (error) {
    setStatus(error.message || "处理失败，请重试。", true);
  } finally {
    setBusy(false);
  }
}

function bindHoldToRecord(button, startText, onAudioReady) {
  const start = (event) => {
    event.preventDefault();
    startRecording(button, startText);
  };

  const stop = async (event) => {
    event.preventDefault();
    const blob = await stopRecording();
    if (!blob || blob.size === 0) {
      setStatus("没有录到声音，请再试一次。", true);
      return;
    }
    await onAudioReady(blob);
  };

  button.addEventListener("pointerdown", start);
  button.addEventListener("pointerup", stop);
  button.addEventListener("pointercancel", stop);
  button.addEventListener("pointerleave", async (event) => {
    if (mediaRecorder?.state === "recording" && activeButton === button) await stop(event);
  });
}

function clearConversation() {
  els.merchantSource.textContent = "等待录音...";
  els.merchantTranslation.textContent = "外语翻译会显示在这里";
  els.customerSource.textContent = "等待录音...";
  els.customerTranslation.textContent = "中文翻译会显示在这里";
  els.replayButton.disabled = true;
  lastMerchantSpeech = null;
  setStatus("按住按钮开始录音");
}

els.languageGrid.addEventListener("click", (event) => {
  const card = event.target.closest(".language-card");
  if (!card) return;
  selectLanguage(languages[Number(card.dataset.index)]);
});

els.backButton.addEventListener("click", () => showPage("language"));
els.clearButton.addEventListener("click", clearConversation);
els.replayButton.addEventListener("click", async () => {
  if (!lastMerchantSpeech) return;
  try {
    if (lastMerchantSpeech.audioUrl) await playAudio(lastMerchantSpeech.audioUrl);
    else speakWithBrowser(lastMerchantSpeech.text, lastMerchantSpeech.language);
  } catch (error) {
    speakWithBrowser(lastMerchantSpeech.text, lastMerchantSpeech.language);
  }
});

bindHoldToRecord(els.merchantRecordButton, "正在听，请说中文...", handleMerchantAudio);
bindHoldToRecord(els.customerRecordButton, "Listening...", handleCustomerAudio);

renderLanguages();
