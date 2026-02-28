# VCOP Coach

## Project
Silvermine Bay School VCOP Coach — English writing feedback tool for primary students using VCOP framework (Vocabulary, Connectives, Openers, Punctuation) + Spelling + Grammar.
Full classroom tool: teacher sets up sessions, students log in to write, AI gives real-time feedback, teacher monitors and comments.

- App title: "Silvermine Bay School VCOP Coach"
- No Chinese text anywhere in the app (all English)
- Student page: no welcome message, no session topic/focus display — only broadcast messages shown if any

## 設計原則
- 小學生友善：大字體、溫暖配色、鼓勵性語氣
- **絕對不使用分數、等級、排名標籤來評價學生寫作**（不要 "Great"、"Good"、"Keep trying" 等）。回饋只包含兩部分：具體的好例子 + 一個具體的下一步建議。
- **成就感驅動**：學生可以無限次修改，每次修改都會看到進步總結和里程碑鼓勵，讓學生自己想繼續改，不是被強迫改。

## 技術選擇
- Vite + React + React Router（多頁路由）
- Firebase Firestore（即時資料庫）
- 純 CSS（CSS 變數管理配色）
- Claude API (Haiku 4.5) via Vercel Serverless Function
- Web Speech API（語音輸入）
- API key 透過環境變數 `ANTHROPIC_API_KEY` 管理，絕不 commit

## 路由
| 路由 | 頁面 | 說明 |
|------|------|------|
| `/` | LoginPage | 選擇老師/學生，輸入密碼 |
| `/teacher/setup` | TeacherSetupPage | Set topic, 6 focus dimensions (V/C/O/P/Spelling/Grammar) |
| `/teacher/dashboard` | TeacherDashboardPage | 即時看板 + 老師評語 + AI grading + 原文複製 |
| `/student/write` | StudentWritePage | 學生寫作 + AI 回饋 + 無限修改 + 進步追蹤 + 歷史作品 |

## 認證
- 老師：env var `TEACHER_PASSWORD` 硬編碼密碼
- 學生：Firestore `students` collection，密碼用 bcrypt hash
- AuthContext + sessionStorage 管理登入狀態

## 學生帳號（2026-02-26 建立）
- 統一密碼：`vcop2026`
- 不存名字，只存學號（name 欄位 = 學號）
- 學號前兩位對應實際年級：19→Y6, 20→Y5, 21→Y4
- 帳號列表：

| 學號 | 年級 | 備註 |
|------|------|------|
| 19-00 | Y6 | sample 測試用 |
| 19-01 ~ 19-04 | Y6 | |
| 20-01 ~ 20-09 | Y5 | |
| 21-01 ~ 21-15 | Y4 | 2026-02-27 建立（原 18-xx 改為 21-xx）|

## Firestore 資料結構
```
sessions/{sessionId}
  ├── topic, vcopFocus, extraInstructions, active, createdAt

students/{studentId}
  ├── name, password (bcrypt), yearGroup

submissions/{submissionId}
  ├── sessionId, studentId, sessionTopic, feedbackMode, teacherComment, teacherCommentOriginal, createdAt
  ├── iterations[] — 每次提交/修改的版本記錄
  │     ├── version (1, 2, 3...)
  │     ├── text (學生寫的原文)
  │     ├── annotations[] (AI 回饋標記)
  │     └── createdAt

broadcasts/{broadcastId}
  ├── sessionId, message, messageOriginal, targetStudentIds (string[]), dismissedBy (string[]), createdAt

feedback/{feedbackId}
  ├── studentId, sessionId, mood (1-5), helpedMost[], difficult[], comment, createdAt
```

## API Endpoints
- `POST /api/analyze` — 分析學生寫作，支援多版本修改比對，根據學生年級調整 VCOP 期望值
- `POST /api/auth` — 登入驗證（老師比對 env var，學生比對 Firestore）
- `POST/GET/DELETE /api/student` — 管理學生帳號（需老師密碼）
- `POST /api/grammar-check` — 老師點評文法修正（Claude Haiku，回傳 `{ corrected, hasChanges }`）
- `POST /api/grade` — AI 寫作水平評級（英國 National Curriculum 標準，不封頂）

## AI 回饋機制（2026-02-28 重寫，2026-02-28 顏色系統重設計，2026-02-28 spelling/grammar 拆分，2026-02-28 British English 標準）

### 語言標準：British English
- AI 拼寫檢查以**英式拼法**為標準（colour, favourite, organise, travelled, centre）
- **美式拼法不是錯誤**：如果學生用了美式拼法（color, favorite, organize），不標記為 `spelling` 錯誤
- 改為用獨立的 `american_spelling` 類型（紫色虛線底線），顯示提示訊息：「'color' is American spelling — in British English we write 'colour'」
- 最多 3 個 `american_spelling` annotations
- 受 Spelling toggle 控制（與 spelling 共用同一個 toggle）

### 瀏覽器拼字檢查已禁用
- 所有 textarea 和文字輸入框都加了 `spellCheck={false} autoCorrect="off" autoCapitalize="off"`
- 禁止瀏覽器自帶的紅色波浪線拼字檢查，避免與 AI 回饋混淆
- 涵蓋：學生寫作框、修改編輯器、回饋留言、老師評語、廣播訊息、登入表單、Session 設定

### 第一版回饋（v1）
- **一次列出所有建議**，不分批
- 五種標記類型：
  - 🔴 `spelling`（拼寫錯誤）：只限拼錯的字（becuase, climp, freind），最多 3 個。紅色字+底線，下方紅色邊框框顯示「原文 → 修正」
  - 🟠 `grammar`（文法錯誤）：文法、大寫、時態、主詞動詞一致、冠詞等，最多 3 個。橘色字 `#D97706` +底線，下方黃色邊框框顯示「原文 → 修正」
  - 🟣 `american_spelling`（美式拼法提示）：美式拼法的字（color, favorite），最多 3 個。紫色字 `#7C3AED` + 虛線底線，下方紫色邊框框顯示「'color' is American spelling — in British English we write 'colour'」
  - 💡 `suggestion`：VCOP 建議，原文保持黑色，下方獨立灰色圓角框顯示建議，前面加 💡，附 VCOP 維度 pill badge
  - 🟢 `praise`：讚美，綠色字顯示做得好的文字，附 VCOP 維度 pill badge
- **Spelling vs Grammar 區別**：
  - `spelling`：字拼錯了，不是真正的英文字（becuase→because, climp→climb, ther→their）
  - `grammar`：字本身拼對了但用法錯（keep→keeps, i→I, london→London, goed→went, 句首沒大寫）
  - `american_spelling`：美式拼法，不是錯誤，只是提示英式寫法（color→colour, favorite→favourite）
- **Capital letter 檢查**（歸類為 `grammar`）：句首大寫、I/I'm/I'll/I've 大寫、專有名詞大寫、星期/月份大寫
- **Openers 維度特殊邏輯**（當 O 維度開啟時）：
  - 六種 Opener 類型：
    1. Adverb opener (-ly words)：Silently, Nervously, Suddenly
    2. -ing opener (action words)：Running through the forest, Gazing at the stars
    3. Question opener：Have you ever wondered...? What would you do if...?
    4. Prepositional phrase opener (where/when)：Under the bridge, At midnight, During the storm
    5. -ed opener (past participle)：Exhausted from the journey, Convinced she was right
    6. Short punchy statement：It was over. She knew. Nothing moved.
  - **Praise（✅）**：學生用了某種 opener → 標記為 praise 並指出類型名稱
  - **Suggestion（💡）**：如果學生句子開頭重複（全部 I/The 開頭）→ 具體建議用哪種 opener，給出用學生原句改寫的例子
  - 統計學生用了幾種不同的 opener 類型，少於 3 種就建議嘗試新類型
  - **逗號規則**：-ly、-ing、prepositional、-ed opener 後面要加逗號，漏加的歸類為 `grammar` annotation
- **VCOP 維度強制覆蓋**：每個開啟的維度至少一條回饋（praise 或 suggestion）
- **伺服器端驗證**：AI 回傳的 annotations 會被過濾 — phrase 必須在原文中找到精確匹配，否則丟棄；spelling/grammar 的 suggestion 不能和 phrase 相同

### 顏色系統（視覺分離原則）
- **學生原文**：永遠黑色字，正常字體
- **做得好**（praise）：綠色字 `#16A34A`
- **拼寫錯誤**（spelling）：紅色字 `#DC2626` + 底線，下方紅色邊框框 `#fef2f2` 顯示 🔴「原文 → 修正」
- **文法錯誤**（grammar）：橘色字 `#D97706` + 底線，下方黃色邊框框 `#fffbeb` 顯示 🟠「原文 → 修正」
- **美式拼法提示**（american_spelling）：紫色字 `#7C3AED` + 虛線底線，下方紫色邊框框 `#f5f3ff` 顯示 🟣 提示訊息
- **VCOP 建議文字**：藍色字 `#2563EB`（在 legend 中說明為「Blue text = VCOP suggestion (could be better)」）
- **AI 建議詳情**（suggestion note）：獨立一行，左縮排 24px，灰色背景 `#f1f5f9` 圓角框，左邊框 3px，深灰色字 `#475569`，字體 14px（比原文小），前面加 💡 圖示
- **VCOP 維度 pill**：小彩色圓角標籤（11px），放在建議框左邊
  - V = 紫色 `#8B5CF6` / `#ede9fe`
  - C = 藍色 `#3B82F6` / `#dbeafe`
  - O = 綠色 `#10B981` / `#d1fae5`
  - P = 橘色 `#F59E0B` / `#fef3c7`

### FeedbackLegend 圖例
- 預設隱藏，點「Legend」按鈕展開
- 項目：
  - 🟢 Green text = Well done!
  - 🔴 Red underlined = Spelling error
  - 🟠 Orange underlined = Grammar error
  - 🟣 Purple dotted = American spelling (not an error)
  - 💡 Blue text = VCOP suggestion (could be better)
  - 💡 Grey box = AI suggestion detail
  - ✅ Green text ✅ = You fixed this!（僅修改版顯示）
  - 📚V 🔗C ✨O 🎯P 維度說明

### 修改版回饋（v2+）
- **不找新問題**，只比對上一版的原始回饋（spelling、grammar、suggestion 三種）
- 改對的 → `revision_good`（綠色 ✅）
- 沒改的 → 保持原始 annotation 樣式（spelling 紅色、grammar 橘色、suggestion 灰框）
- 傳入 `previousAnnotations` 讓 AI 精確比對

### Feedback Level Slider（難度級別，非數量）
- Slider 在提交按鈕上方（提交前顯示，提交後隱藏），標籤「Feedback level」
- 1-3 檔，預設 1
- **不是回饋數量多少，而是期望標準高低**，根據學號判斷學生年級（19=Y6, 20=Y5, 21=Y4）：
  - Level 1：按學生實際年級標準（如 20-05 → Y5 標準）
  - Level 2：比實際年級高 2 年（如 20-05 → Y7 標準，要求修辭技巧、段落銜接、語域轉換）
  - Level 3：比實際年級高 4 年（如 20-05 → Y9 標準，要求語氣掌控、高級修辭、多層從句、風格化標點）
- 計算公式：`targetYear = baseYear + (level - 1) * 2`
- AI prompt 明確包含：學生實際年級 + 目標評估標準 + 各年級期望值描述
- Level 2-3 額外指示 AI push for more ambitious suggestions
- 值透過 `feedbackLevel` 參數傳入 `/api/analyze`
- 各年級期望值：
  - Y4：基本句子結構、句號大寫、簡單連接詞
  - Y5：段落組織、多樣化句首、擴展詞彙
  - Y6：語氣控制、複雜句式、精準用詞、進階標點
  - Y7-8：精緻詞彙、修辭技巧（反問、排比、比喻）、段落銜接語、句式長短變化、語域轉換、分號冒號
  - Y9+：語氣語域精準掌控、字詞言外之意、複雜多層從句、高級修辭（對比、反覆、首語重複）、論證結構、風格化標點

### 學生回饋維度 Toggle（10 個按鈕，全部預設關閉）
- 每個 VCOP 維度拆成**兩個獨立 toggle**（praise ✅ 和 suggestion 💡）：
  - 「Vocabulary ✅」顯示做得好的地方（綠色 praise 標記）
  - 「Vocabulary 💡」顯示要改進的地方（藍色 suggestion 標記 + 建議框）
  - 同理：Connectives ✅/💡、Openers ✅/💡、Punctuation ✅/💡
- Spelling 和 Grammar 各只有**一個 toggle**（因為是對錯問題，沒有「做得好」版本）
  - Spelling 同時控制 `type: "spelling"` + `type: "american_spelling"`
- 學生可以選擇：只看做得好的地方建立信心，或只看要改的地方專注修改，或兩個都開
- 全部預設 OFF（學生先看乾淨原文）
- Compact 模式下 VCOP 維度顯示縮寫（V ✅、V 💡）
- 按鈕用 `vcop-toggle-pair` 包裝，✅ 和 💡 成對排列
- `hiddenDimensions` state 初始值 = `new Set(["V_praise", "V_suggestion", "C_praise", "C_suggestion", "O_praise", "O_suggestion", "P_praise", "P_suggestion", "spelling", "grammar"])`
- 圖例（FeedbackLegend）預設隱藏，點「Legend」按鈕展開

### 學生回饋表單
- 預設隱藏，底部只顯示一個小按鈕「Give feedback 📝」
- 點擊後展開完整表單（心情、什麼最有幫助、什麼最困難、自由評論）

### 無限修改 + 進步追蹤
- 學生可以無限次修改，沒有版本上限
- 每次修改後顯示**進步總結面板**：
  - 標題：「Version 3 — You've made 7 improvements so far! 🎉」
  - 本輪修正數量
  - 進度條：已修正 / 總建議數
  - 第一版對比分項：「Since your first draft: +3 vocabulary upgrades, +1 spelling fix, +2 grammar fixes」
- **進度計數邏輯**（重要）：
  - **分母** = v1 的 spelling + grammar + suggestion 總數（固定不變）
  - **分子** = 最新版中 `revision_good` 匹配到的 v1 issue 數量（去重，用 index 追蹤）
  - **分子永遠 ≤ 分母**：`Math.min(fixedCount, totalIssues)`
  - 不累加多版：只看最新版的 `revision_good` 對照 v1 issues
  - 新版 AI 發現的新問題不計入分母
- **里程碑成就**：
  - 3 個改進 → 💪「Nice start!」
  - 5 個改進 → 🔥「On fire!」
  - 10 個改進 → ⭐「Writing superstar!」
- 「Show my teacher 👀」按鈕隨時可用

### 左右並排修改模式（Side-by-side Revision）
- 學生按「Revise my writing」後，畫面分為左右兩欄（各 50%）
- **左欄**（AI Feedback）：帶標記的原文（可滾動），toggle 按鈕繼續控制顯示
- **右欄**（Your revision）：HighlightedEditor — 帶高亮背景的編輯框
- 容器自動加寬到 1100px（`app-revising`）
- **左右滾動同步**：用 scroll ratio 比例同步（非絕對 pixel），`scrollingRef` 防迴圈
- 手機 (≤640px)：改為上下堆疊

### HighlightedEditor 高亮編輯器
- 元件：`src/components/HighlightedEditor.jsx`
- **技術**：backdrop overlay — 透明 textarea 疊在隱形文字 + 彩色 `<mark>` 的 backdrop div 上
- **高亮顏色**：
  - 淡紅色 `#fee2e2`：spelling / grammar 錯誤位置
  - 淡藍色 `#dbeafe`：VCOP suggestion 位置
- **自動消失**：用 exact case-sensitive 匹配（`text.indexOf(a.phrase)`），學生修改任何字元（包括大小寫）後精確匹配失敗 → 高亮即時消失
- **Props**：`scrollRef` + `onSyncScroll` 供父元件控制左右滾動同步

## 老師 Dashboard 功能

### AI Grading（英國課程標準）
- 新 API endpoint `POST /api/grade`
- 根據學號前兩位自動識別學生實際年級（19→Y6, 20→Y5, 21→Y4）
- 評級不封頂：Y4 學生可以被評為 Y7-8，Y6 可以被評為 Y3
- 格式：`"Y5 level — Uses varied sentence openers and expanding vocabulary"`
- Dashboard 顯示：
  - 提交列表 header：`[Y5]`（實際年級灰色）+ `[Y6]`（AI 評級藍色）
  - 展開詳情：完整 grading 面板，含差距指示（`+1 above` 綠色 / `2 below` 紅色）
  - 展開時自動觸發 grading API

### 原文檢視 + 複製
- 每篇提交有「Show/Hide Clean Text」按鈕：顯示無 AI 標記的乾淨原文
- 「Copy Text」按鈕：一鍵複製當前版本原文到剪貼簿

## Annotation 類型一覽
| type | 用途 | 範例 | 顯示方式 |
|------|------|------|----------|
| `spelling` | 拼寫錯誤（字拼錯了） | becuase→because, climp→climb | 紅色字 `#DC2626` +底線，下方 🔴 原文→修正 |
| `grammar` | 文法錯誤（用法錯） | i→I, keep→keeps, london→London | 橘色字 `#D97706` +底線，下方 🟠 原文→修正 |
| `american_spelling` | 美式拼法提示（非錯誤） | color→colour, favorite→favourite | 紫色字 `#7C3AED` + 虛線底線，下方 🟣 提示 |
| `suggestion` | VCOP 改進建議 | | 原文黑色，下方灰色圓角框 💡 建議 + VCOP pill |
| `praise` | 做得好的地方 | | 綠色字 + VCOP pill badge |
| `revision_good` | 修改後改對了 | | 綠色字 + ✅ |
| `revision_retry` | 修改後仍有問題 | | 保持原始標記樣式（spelling/grammar/suggestion）|

## 環境變數
### 前端（.env.local，VITE_ prefix）
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

### 後端（Vercel env vars）
- `ANTHROPIC_API_KEY`
- `TEACHER_PASSWORD`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

## VCOP 維度配色
- Vocabulary → 紫色 #8B5CF6 📚
- Connectives → 藍色 #3B82F6 🔗
- Openers → 綠色 #10B981 ✨
- Punctuation → 橘色 #F59E0B 🎯

## 元件結構
```
src/
  ├── components/
  │     ├── AnnotatedText.jsx — 回饋顯示核心（inline diff + VCOP 標籤 + revision 狀態）
  │     │     ├── renderInlineDiff() — 最小差異字元比對
  │     │     ├── cleanSuggestion() — 向後兼容 "wrong → right" 格式
  │     │     ├── FeedbackLegend — 圖例組件
  │     │     └── VcopFilterBar — VCOP 維度 toggle 按鈕列
  │     ├── HighlightedEditor.jsx — 高亮編輯器（backdrop overlay + 精確匹配自動消失）
  │     ├── SpeechInput.jsx — 語音輸入
  │     └── WritingInput.jsx — 寫作輸入框
  ├── pages/
  │     ├── LoginPage.jsx
  │     ├── TeacherSetupPage.jsx
  │     ├── TeacherDashboardPage.jsx — 含 AI grading + 原文複製 + 回饋統計
  │     └── StudentWritePage.jsx — 含無限修改 + 進步追蹤 + 里程碑
  ├── contexts/
  │     └── AuthContext.jsx
  ├── utils/
  │     └── wordDiff.js — 版本間文字差異比對
  ├── firebase.js
  └── App.css — 所有樣式（純 CSS，CSS 變數）

api/
  ├── _firebase.js — Firebase Admin SDK 初始化
  ├── analyze.js — AI 寫作分析（年級差異化 + 修改比對）
  ├── auth.js — 登入驗證
  ├── grade.js — AI 寫作水平評級（英國 National Curriculum）
  ├── grammar-check.js — 文法修正
  └── student.js — 學生帳號管理
```

## 開發指令
- `npm run dev` — 啟動前端開發伺服器
- `npm run build` — 打包
- `vercel dev` — 本地開發（含 serverless function）
- `vercel --prod --yes` — 部署到 Vercel

## 部署
- 平台：Vercel
- 公開網址：https://vcop-coach.vercel.app
- GitHub：https://github.com/willtong23/vcop-coach
- 改完程式後：`vercel --prod --yes` 重新部署

## 廣播功能（Broadcast）
- **老師端**（TeacherDashboardPage）：在 student grid 和 submissions list 之間。勾選學生 → 輸入訊息 → 發送前自動 grammar check（複用 `/api/grammar-check`）→ 寫入 `broadcasts` collection。下方顯示已發送訊息列表（即時 `onSnapshot`），每條可刪除（`deleteDoc`）。
- **學生端**（StudentWritePage）：`onSnapshot` 查詢 `broadcasts`（`sessionId` + `targetStudentIds` array-contains），客戶端過濾 `dismissedBy`。黃色橫幅顯示在 session-info 和 writing area 之間，點 ✕ 關閉（`arrayUnion` 加入 `dismissedBy`）。老師刪除後學生端即時消失。
- **不需新 API endpoint**，全部用前端 Firebase SDK。
- **Firestore index**：`broadcasts` collection 可能需要 composite index（`sessionId` + `targetStudentIds`），首次查詢時 console 會給建立連結。

## 學生端功能
- **My Past Work**：學生寫作頁面下方有可折疊的歷史作品區塊，用 `onSnapshot` 即時監聽該學生所有 submissions（單欄位查詢 `studentId`，不需 composite index），客戶端按 `createdAt` desc 排序。展開單筆可看原文 + AI feedback（複用 `AnnotatedText`）+ 老師評語。不管有沒有 active session 都會顯示。
- **Student Feedback Survey**：session 期間學生可以填寫回饋問卷（心情 1-5、什麼最有幫助、什麼最困難、自由評論），資料存入 `feedback` collection，老師在 Dashboard 的 Feedback tab 可以看到統計。

## 踩過的坑
- **Vercel 環境變數要重新部署才生效**：在 dashboard 加完 env var 後必須再跑一次 `vercel --prod`，舊的 deployment 不會自動拿到新變數
- **Firestore composite index**：Dashboard 的 `onSnapshot` 查詢需要 `submissions` collection 上的 composite index（`sessionId` asc + `createdAt` desc）。首次執行時 console 會報錯並給出建立連結，點擊即可建立。
- **Claude 回傳 JSON 會包 markdown code fence**：即使 prompt 要求「只回 JSON」，Claude 仍可能回 ` ```json ... ``` `。`api/analyze.js` 裡用 regex strip 掉 code fence 再 `JSON.parse`
- **AI spelling suggestion 格式**：prompt 要求只返回修正後文字（如 `"keeps"`），但 AI 偶爾仍返回 `"keep → keeps"` 格式。`AnnotatedText.jsx` 的 `cleanSuggestion()` 函數會自動提取 `→` 後面的部分，確保向後兼容。
- **Spelling 和 Grammar 必須拆開**：早期版本兩者共用 `type: "spelling"`，導致兩個 toggle 控制同一批 annotations，學生無法分別查看。2026-02-28 拆為獨立的 `type: "spelling"` 和 `type: "grammar"`，各自最多 3 個，前端各自獨立過濾。
- **進步面板分子>分母 bug**：早期版本累加所有修改版的 `revision_good` 數量作為分子，但同一個 v1 issue 在 v2、v3 都會被標為 `revision_good`，導致重複計算。修正：只看最新版的 `revision_good`，用 v1 issue index 去重，分子 cap 在分母以下。
- **高亮編輯器用 case-sensitive 匹配**：case-insensitive 匹配會導致學生改了大小寫（如 `i`→`I`）後高亮不消失。改用 exact match `text.indexOf(a.phrase)` 解決。
