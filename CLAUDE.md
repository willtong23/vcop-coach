# VCOP Coach

## 專案目標
面向小學生的英文寫作回饋工具，基於 VCOP 框架（Vocabulary, Connectives, Openers, Punctuation）。

## 設計原則
- 小學生友善：大字體、溫暖配色、鼓勵性語氣
- **絕對不使用分數、等級、排名標籤來評價學生寫作**（不要 "Great"、"Good"、"Keep trying" 等）。回饋只包含兩部分：具體的好例子 + 一個具體的下一步建議。
- 單頁面應用，無路由

## 技術選擇
- Vite + React
- 純 CSS（CSS 變數管理配色）
- Claude API (Haiku 4.5) via Vercel Serverless Function (`api/analyze.js`)
- API key 透過環境變數 `ANTHROPIC_API_KEY` 管理，絕不 commit

## VCOP 維度配色
- Vocabulary → 紫色 #8B5CF6 📚
- Connectives → 藍色 #3B82F6 🔗
- Openers → 綠色 #10B981 ✨
- Punctuation → 橘色 #F59E0B 🎯

## 開發指令
- `npm run dev` — 啟動開發伺服器
- `npm run build` — 打包
- `vercel dev` — 本地開發（含 serverless function）
- `vercel --prod` — 部署到 Vercel

## 部署
- 平台：Vercel
- 環境變數：在 Vercel dashboard 設定 `ANTHROPIC_API_KEY`
- Serverless function：`api/analyze.js` → POST `/api/analyze`
