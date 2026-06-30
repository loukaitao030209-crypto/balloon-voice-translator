# 气球语音翻译助手 MVP

这是一个最小可运行的前后端联调项目，只做「选择客户语言 + 双向语音翻译」核心流程。商户按住按钮说中文，页面识别、翻译成客户语言并优先播放后端 TTS；客户按住按钮说外语，页面识别、翻译成中文并展示给商户。

当前版本不包含登录、数据库、商品库、报价、订单、支付、CRM、复杂后台或客户自助点选。

## 功能说明

- 8 种客户语言选择：英语、阿拉伯语、俄语、西班牙语、法语、葡萄牙语、韩语、日语。
- 浏览器 `MediaRecorder` 按住录音，松开上传。
- 后端提供 STT、翻译、TTS 三个接口。
- 没有真实 API Key 时自动使用 mock 模式，本地也能跑通主流程。
- 后端 TTS 不可用时，前端降级使用浏览器 `speechSynthesis` 播放外语。

## 本地启动

```bash
cd balloon-voice-translator/backend
npm install
npm run dev
```

启动后访问：

```text
http://localhost:3000
```

后端会静态托管 `frontend/`，因此不需要单独启动前端服务。

如果只想独立预览前端，也可以：

```bash
cd balloon-voice-translator/frontend
npx serve .
```

独立前端默认调用 `http://localhost:3000` 的后端接口。

## 环境变量

复制示例文件：

```bash
cd balloon-voice-translator/backend
copy .env.example .env
```

变量说明：

```env
PORT=3000
STT_API_KEY=your_stt_api_key_here
TRANSLATE_API_KEY=your_translate_api_key_here
TTS_API_KEY=your_tts_api_key_here
AI_API_KEY=your_api_key_here
```

如果没有填写真实 Key，后端会自动进入 mock 模式。代码不会写死任何 API Key。

## API 接口

### POST `/api/speech-to-text`

请求：`multipart/form-data`

- `audio`：录音文件
- `language`：语言代码，例如 `zh-CN`、`en-US`

返回：

```json
{
  "text": "你想要什么类型的气球？"
}
```

### POST `/api/translate`

请求：

```json
{
  "text": "你想要什么类型的气球？",
  "from": "zh",
  "to": "en"
}
```

返回：

```json
{
  "translatedText": "What kind of balloons do you need?"
}
```

### POST `/api/text-to-speech`

请求：

```json
{
  "text": "What kind of balloons do you need?",
  "language": "en-US"
}
```

返回：

```json
{
  "audioUrl": "/audio/xxxx.mp3"
}
```

mock 模式下 `audioUrl` 为空字符串，前端会自动降级到浏览器语音播放。

## 接入真实服务

在 `backend/server.js` 中替换三个函数即可：

- `speechToTextService(file, language)`：读取 `file.path`，调用真实语音识别服务。
- `translateService(text, from, to)`：调用真实翻译服务。提示词应强调只翻译，不代替商户承诺价格、库存、交期。
- `textToSpeechService(text, language)`：调用真实 TTS 服务，把生成音频保存到 `backend/audio/`，返回 `/audio/文件名`。

真实服务的 Key 必须从 `process.env.STT_API_KEY`、`process.env.TRANSLATE_API_KEY`、`process.env.TTS_API_KEY` 或 `process.env.AI_API_KEY` 读取。

## 当前 MVP 不包含

- 登录注册
- 数据库
- 商品库
- 报价和订单
- 支付
- CRM
- 复杂后台
- 客户自助点选
- 聊天机器人
- 任何与语音翻译无关的功能
