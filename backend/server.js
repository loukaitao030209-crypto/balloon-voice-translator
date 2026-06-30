const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const rootDir = path.resolve(__dirname, "..");
const frontendDir = path.join(rootDir, "frontend");
const uploadDir = path.join(__dirname, "uploads");
const audioDir = path.join(__dirname, "audio");

fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(audioDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 25 * 1024 * 1024
  }
});

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(frontendDir));
app.use("/audio", express.static(audioDir));

function envValue(...keys) {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value && !value.startsWith("your_")) return value;
  }
  return "";
}

function hasRealKey(...keys) {
  return Boolean(envValue(...keys));
}

function isMockStt() {
  return !hasRealKey("STT_API_KEY", "AI_API_KEY", "OPENAI_API_KEY");
}

function isMockTranslate() {
  return !hasRealKey("TRANSLATE_API_KEY", "AI_API_KEY", "OPENAI_API_KEY");
}

function isMockTts() {
  return !hasRealKey("TTS_API_KEY", "AI_API_KEY", "OPENAI_API_KEY");
}

function allowApiFallback() {
  return process.env.ALLOW_API_FALLBACK === "true";
}

function runPowerShell(script, env = {}) {
  const utf8Prelude = [
    "[Console]::InputEncoding = [System.Text.Encoding]::UTF8",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "$OutputEncoding = [System.Text.Encoding]::UTF8"
  ].join("; ");

  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `${utf8Prelude}; ${script}`],
      {
        env: { ...process.env, ...env },
        encoding: "utf8",
        timeout: Number(process.env.OPENAI_TIMEOUT_MS || 60000) + 10000,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error((stderr || stdout || error.message).trim()));
          return;
        }
        resolve(stdout.trim());
      }
    );
  });
}

function decodeBase64Utf8(text) {
  return Buffer.from(text.trim(), "base64").toString("utf8");
}

function encodeBase64Utf8(text) {
  return Buffer.from(text, "utf8").toString("base64");
}

async function openaiJsonViaPowerShell(url, body, ...keys) {
  const apiKey = envValue(...keys);
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Net.Http",
    "$client = [System.Net.Http.HttpClient]::new()",
    "$client.Timeout = [TimeSpan]::FromSeconds([int]$env:OPENAI_TIMEOUT_SEC)",
    "$client.DefaultRequestHeaders.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $env:OPENAI_REQUEST_KEY)",
    "$requestBody = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:OPENAI_REQUEST_BODY_B64))",
    "$content = [System.Net.Http.StringContent]::new($requestBody, [System.Text.Encoding]::UTF8, 'application/json')",
    "$response = $client.PostAsync($env:OPENAI_REQUEST_URL, $content).GetAwaiter().GetResult()",
    "$bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()",
    "$json = [System.Text.Encoding]::UTF8.GetString($bytes)",
    "if (-not $response.IsSuccessStatusCode) { throw $json }",
    "[Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json))",
    "$client.Dispose()"
  ].join("; ");
  const stdout = await runPowerShell(script, {
    OPENAI_REQUEST_KEY: apiKey,
    OPENAI_REQUEST_URL: url,
    OPENAI_REQUEST_BODY_B64: encodeBase64Utf8(JSON.stringify(body)),
    OPENAI_TIMEOUT_SEC: String(Math.ceil(Number(process.env.OPENAI_TIMEOUT_MS || 60000) / 1000))
  });
  return JSON.parse(decodeBase64Utf8(stdout));
}

async function openaiTranscriptionViaPowerShell(file, language) {
  const apiKey = envValue("STT_API_KEY", "AI_API_KEY", "OPENAI_API_KEY");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Net.Http",
    "$client = [System.Net.Http.HttpClient]::new()",
    "$client.Timeout = [TimeSpan]::FromSeconds([int]$env:OPENAI_TIMEOUT_SEC)",
    "$client.DefaultRequestHeaders.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $env:OPENAI_REQUEST_KEY)",
    "$form = [System.Net.Http.MultipartFormDataContent]::new()",
    "$bytes = [System.IO.File]::ReadAllBytes($env:OPENAI_AUDIO_FILE)",
    "$fileContent = [System.Net.Http.ByteArrayContent]::new($bytes)",
    "$fileContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse('application/octet-stream')",
    "$form.Add($fileContent, 'file', $env:OPENAI_AUDIO_NAME)",
    "$form.Add([System.Net.Http.StringContent]::new($env:OPENAI_STT_MODEL), 'model')",
    "$form.Add([System.Net.Http.StringContent]::new('json'), 'response_format')",
    "if ($env:OPENAI_AUDIO_LANGUAGE) { $form.Add([System.Net.Http.StringContent]::new($env:OPENAI_AUDIO_LANGUAGE), 'language') }",
    "$response = $client.PostAsync($env:OPENAI_REQUEST_URL, $form).GetAwaiter().GetResult()",
    "$bytesOut = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()",
    "$result = [System.Text.Encoding]::UTF8.GetString($bytesOut)",
    "if (-not $response.IsSuccessStatusCode) { throw $result }",
    "[Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($result))",
    "$client.Dispose()"
  ].join("; ");
  const stdout = await runPowerShell(script, {
    OPENAI_REQUEST_KEY: apiKey,
    OPENAI_REQUEST_URL: "https://api.openai.com/v1/audio/transcriptions",
    OPENAI_AUDIO_FILE: file.path,
    OPENAI_AUDIO_NAME: file.originalname || "recording.webm",
    OPENAI_STT_MODEL: process.env.OPENAI_STT_MODEL || "gpt-4o-mini-transcribe",
    OPENAI_AUDIO_LANGUAGE: toOpenAiLanguage(language) || "",
    OPENAI_TIMEOUT_SEC: String(Math.ceil(Number(process.env.OPENAI_TIMEOUT_MS || 60000) / 1000))
  });
  return JSON.parse(decodeBase64Utf8(stdout));
}

async function openaiSpeechViaPowerShell(body, outputFile, ...keys) {
  const apiKey = envValue(...keys);
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$headers = @{ Authorization = \"Bearer $env:OPENAI_REQUEST_KEY\" }",
    "$requestBody = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:OPENAI_REQUEST_BODY_B64))",
    "Invoke-WebRequest -Uri $env:OPENAI_REQUEST_URL -Headers $headers -Method Post -ContentType 'application/json; charset=utf-8' -Body $requestBody -OutFile $env:OPENAI_OUTPUT_FILE -TimeoutSec $env:OPENAI_TIMEOUT_SEC | Out-Null"
  ].join("; ");
  await runPowerShell(script, {
    OPENAI_REQUEST_KEY: apiKey,
    OPENAI_REQUEST_URL: "https://api.openai.com/v1/audio/speech",
    OPENAI_REQUEST_BODY_B64: encodeBase64Utf8(JSON.stringify(body)),
    OPENAI_OUTPUT_FILE: outputFile,
    OPENAI_TIMEOUT_SEC: String(Math.ceil(Number(process.env.OPENAI_TIMEOUT_MS || 60000) / 1000))
  });
}

function toOpenAiLanguage(language) {
  if (!language) return undefined;
  return language.split("-")[0].toLowerCase();
}

function mockSpeechToText(language) {
  if (language === "zh-CN") return "你想要什么类型的气球？";
  if (language?.startsWith("en")) return "I need balloons for a wedding party.";
  return "I need balloons for a wedding party.";
}

function mockTranslate(text, from, to) {
  const normalized = String(text || "").trim().toLowerCase();

  if (from === "zh" && to === "en") {
    return "What kind of balloons do you need?";
  }

  if (from === "en" && to === "zh") {
    return "客户需要婚礼派对用的气球。";
  }

  if (to === "zh") {
    return `客户说：${text}`;
  }

  if (normalized.includes("balloon") || normalized.includes("气球")) {
    return "What kind of balloons do you need?";
  }

  return `[Mock ${from} -> ${to}] ${text}`;
}

function languageName(code) {
  const names = {
    zh: "Chinese",
    en: "English",
    ar: "Arabic",
    ru: "Russian",
    es: "Spanish",
    fr: "French",
    pt: "Portuguese",
    ko: "Korean",
    ja: "Japanese"
  };

  return names[code] || code;
}

async function speechToTextService(file, language) {
  if (isMockStt()) {
    return mockSpeechToText(language);
  }

  try {
    const transcription = await openaiTranscriptionViaPowerShell(file, language);
    return transcription.text || "";
  } catch (error) {
    if (allowApiFallback()) return mockSpeechToText(language);
    throw new Error(`OpenAI 语音识别失败：${error.message}`);
  }
}

async function translateService(text, from, to) {
  if (isMockTranslate()) {
    return mockTranslate(text, from, to);
  }

  try {
    const completion = await openaiJsonViaPowerShell(
      "https://api.openai.com/v1/chat/completions",
      {
        model: process.env.OPENAI_TRANSLATE_MODEL || "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: [
              "You are a professional in-store interpreter for a balloon shop.",
              "Translate only the user's text from the source language to the target language.",
              "Keep numbers, prices, quantities, dates, sizes, colors, and measurements unchanged.",
              "Use concise, natural wording for face-to-face shop communication.",
              "If the source text is a question, translate the question exactly; do not answer it.",
              "Do not add promises about prices, inventory, delivery dates, discounts, or availability.",
              "Return only the translated text. No quotes. No notes."
            ].join(" ")
          },
          {
            role: "user",
            content: `Translate this shop conversation text.
Source language: ${languageName(from)} (${from})
Target language: ${languageName(to)} (${to})
Text to translate:
<text>${text}</text>`
          }
        ]
      },
      "TRANSLATE_API_KEY",
      "AI_API_KEY",
      "OPENAI_API_KEY"
    );

    return completion.choices?.[0]?.message?.content?.trim() || "";
  } catch (error) {
    if (allowApiFallback()) return mockTranslate(text, from, to);
    throw new Error(`OpenAI 翻译失败：${error.message}`);
  }
}

async function textToSpeechService(text, language) {
  if (isMockTts()) {
    return "";
  }

  const fileName = `speech-${Date.now()}-${Math.random().toString(16).slice(2)}.mp3`;
  const filePath = path.join(audioDir, fileName);

  try {
    await openaiSpeechViaPowerShell(
      {
        model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
        voice: process.env.OPENAI_TTS_VOICE || "coral",
        input: text,
        instructions: `Speak clearly and naturally in ${language}. Keep a friendly shop assistant tone.`
      },
      filePath,
      "TTS_API_KEY",
      "AI_API_KEY",
      "OPENAI_API_KEY"
    );
  } catch (error) {
    if (allowApiFallback()) return "";
    throw new Error(`OpenAI 语音合成失败：${error.message}`);
  }

  return `/audio/${fileName}`;
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

async function removeUpload(file) {
  if (!file?.path) return;
  await fs.promises.unlink(file.path).catch(() => {});
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    mock: {
      speechToText: isMockStt(),
      translate: isMockTranslate(),
      textToSpeech: isMockTts()
    },
    models: {
      speechToText: process.env.OPENAI_STT_MODEL || "gpt-4o-mini-transcribe",
      translate: process.env.OPENAI_TRANSLATE_MODEL || "gpt-4o-mini",
      textToSpeech: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
      voice: process.env.OPENAI_TTS_VOICE || "coral"
    },
    openai: {
      timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS || 60000),
      maxRetries: Number(process.env.OPENAI_MAX_RETRIES || 1),
      allowApiFallback: allowApiFallback()
    }
  });
});

app.post(
  "/api/speech-to-text",
  upload.single("audio"),
  asyncRoute(async (req, res) => {
    const language = req.body.language;

    if (!req.file) {
      res.status(400).json({ error: "缺少 audio 录音文件。" });
      return;
    }

    if (!language) {
      await removeUpload(req.file);
      res.status(400).json({ error: "缺少 language 语言代码。" });
      return;
    }

    try {
      const text = await speechToTextService(req.file, language);
      res.json({ text });
    } finally {
      await removeUpload(req.file);
    }
  })
);

app.post(
  "/api/translate",
  asyncRoute(async (req, res) => {
    const { text, from, to } = req.body;

    if (!text || !from || !to) {
      res.status(400).json({ error: "缺少 text、from 或 to 参数。" });
      return;
    }

    const translatedText = await translateService(text, from, to);
    res.json({ translatedText });
  })
);

app.post(
  "/api/text-to-speech",
  asyncRoute(async (req, res) => {
    const { text, language } = req.body;

    if (!text || !language) {
      res.status(400).json({ error: "缺少 text 或 language 参数。" });
      return;
    }

    const audioUrl = await textToSpeechService(text, language);
    res.json({
      audioUrl,
      mock: isMockTts()
    });
  })
);

app.get("*", (req, res) => {
  res.sendFile(path.join(frontendDir, "index.html"));
});

app.use((err, req, res, next) => {
  if (req.file?.path) {
    fs.unlink(req.file.path, () => {});
  }

  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: `音频上传失败：${err.message}` });
    return;
  }

  const status = err.status || err.statusCode || 500;
  const message = err.response?.data?.error?.message || err.message || "服务器内部错误。";
  res.status(status >= 400 && status < 600 ? status : 500).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`Balloon voice translator is running at http://localhost:${PORT}`);
});
