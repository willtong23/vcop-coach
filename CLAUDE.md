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
- **VERIFY BEFORE DEPLOY**: Every code change must be self-verified before committing:
  - API changes: run `curl` to test the endpoint locally, confirm JSON response format is valid
  - Frontend changes: run `npm run build` to confirm no errors
  - Prompt changes: test with a sample student text and verify the AI response matches expected format
  - Never deploy code you haven't tested yourself
- **CONTEXT MANAGEMENT**: After completing each major feature or task, remind the user to run /compact or start a new session. If you notice your own responses becoming inconsistent or you're forgetting earlier instructions, say "Context is getting heavy — recommend /compact or new session."
- **LAYOUT RULE**: Student writing page must always use max-width: 800px with width: 100%. Never add extra padding, margin, or container constraints that shrink the content area. Any CSS change must be visually verified to not reduce the writing area width.

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

studentProfiles/{studentId}
  ├── lastUpdated (timestamp), totalSubmissions (number)
  ├── vcop
  │     ├── vocabulary: { level, strengths[], weaknesses[], recentWowWords[] }
  │     ├── connectives: { level, highestUsed, pattern }
  │     ├── openers: { ispacedUsed[], ispacedNeverUsed[], pattern }
  │     └── punctuation: { level, mastered[], emerging[], notYet[] }
  ├── spellingPatterns[], grammarPatterns[]
  ├── personalInstructions (string)
  ├── teacherNotes[] — { date, comment, sessionTopic }（老師評語同步，最多保留 last 3 在 prompt 中）
  └── growthNotes[] — AI 自動記錄的成長里程碑（如 "First semicolon used"）
```

## API Endpoints
- `POST /api/analyze` — 分析學生寫作，支援多版本修改比對，根據學生年級調整 VCOP 期望值
- `POST /api/auth` — 登入驗證（老師比對 env var，學生比對 Firestore）
- `POST/GET/DELETE /api/student` — 管理學生帳號（需老師密碼）
- `POST /api/grammar-check` — 老師點評文法修正（Claude Haiku，回傳 `{ corrected, hasChanges }`）
- `POST /api/grade` — AI 寫作水平評級（英國 National Curriculum 標準，不封頂）
- `POST /api/update-profile` — 學生 Profile 更新（Claude Haiku 分析 annotations → 更新 `studentProfiles/{studentId}`，輸入 `{ studentId, annotations, sessionTopic }`）

## AI 回饋機制（2026-02-28 重寫，2026-02-28 顏色系統重設計，2026-02-28 spelling/grammar 拆分，2026-02-28 British English 標準，2026-02-28 過去寫作 context，2026-02-28 分組顯示，2026-02-28 2-step pipeline 重構）

### 2-Step Pipeline 架構（2026-02-28 重構）
- **舊架構**：單一 `buildSystemPrompt()` ~25,000 chars (~6,000 tokens)，所有邏輯（spelling, grammar, VCOP, profile, level/amount）塞在一個 prompt 裡，Haiku 無法同時遵守所有規則
- **新架構**：拆成 2 個獨立 API 呼叫，各自專注一件事
  - **Step 1 — Spelling & Grammar**（`buildSpellingGrammarPrompt()`，~1,200 chars）
    - 只管拼寫錯誤、文法錯誤（含 homophones）、美式拼法
    - 明確的 homophone checklist（there/their/they're, your/you're 等）
    - 首字大寫規則 + 具體範例
    - max_tokens: 1024
  - **Step 2 — VCOP Analysis**（`buildVcopPrompt()`，~3,000 chars）
    - 只管 V/C/O/P 的 praise + suggestion
    - 接收 Step 1 的 `errorPhrases[]` → 知道哪些句子有錯，**不會拿有錯的句子來讚美**
    - 根據 feedbackLevel/feedbackAmount 動態調整期望值
    - 注入 studentProfile 做個人化回饋
  - **Merge**：Step 1 annotations + Step 2 annotations 合併返回
- **效果**：prompt 總長度從 ~25,000 chars 降到 ~4,200 chars（**83% 減少**），回饋品質大幅提升
- **Revision flow**（v2+）不受影響，仍是單一呼叫 `buildRevisionPrompt()`
- `VCOP_KNOWLEDGE` 不再注入 analyze.js prompt（只在 `grade.js` 使用）

### VCOP 教學方法論知識庫
- 檔案：`/api/vcop-knowledge.js`，匯出 `VCOP_KNOWLEDGE`（回饋用）和 `VCOP_GRADING_KNOWLEDGE`（評分用）
- 基於 **Big Writing & VCOP methodology** 和 **Oxford Writing Criterion Scale**
- 核心規則：**Socratic Rule** — AI 嚴禁改寫學生原文，只能問引導性問題、給具體例子，認知負擔留給學生
- 內容包含：
  - **GHaSP 基本功**：Grammar, Handwriting, Spelling, Punctuation + Posh Talk 範例
  - **Vocabulary**：WOW Word Progression Table（10 組常見詞 × 3 級替換：Level 1-2 Basic → Level 3-4 WOW → Level 5+ Sophisticated），sensory language、figurative language、show not tell
  - **Connectives** 5 級進階表：Level 1 (and/but/so) → Level 2 (because/when/if) → Level 3 (while/until/besides) → Level 4 (although/however/nevertheless) → Level 5+ (despite/consequently/owing to)
  - **Openers — ISPACED 框架**（7 種 opener 類型）：I=-Ing, S=Simile, P=Preposition, A=Adverb, C=Connective, E=-Ed, D=Dialogue + 5 級 Opener Progression
  - **Punctuation Pyramid** 三層：Level 1 Base (. A) → Level 2 Middle (, ! ? ' " ") → Level 3+ Peak (; : () — ...)
  - **Up-levelling Protocol** 5 種技巧：Vocabulary Swap → Opener Shift (ISPACED) → Two Comma Trick → Connective Extension → Punctuation Upgrade，每種含學生原句改寫範例
  - **Exemplar Progression**：同一題目（my dog）在 Standard 1/3/5/7 的範文對比
  - **My Target Record 回饋框架**：2-3 specific strengths（引用原文 + VCOP 術語解釋）+ 1-2 precise targets（正面可行動的小步驟）
  - **Oxford Writing Criterion Scale** Standard 1-7：每個 Standard 含 6 strand 詳細評估標準 + Year Level Mapping
- 注入到 `analyze.js` 的 system prompt 和 `grade.js` 的 grading prompt

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

### Student Profile 系統（個人化回饋，取代過去寫作 Context）
- **取代舊的 `buildPastContext()` 方式**：不再查詢 last 5 submissions，改用結構化 `studentProfiles` document
- **只在 v1（首次提交）時啟用** — 修改版已有 previousText/previousAnnotations
- 從 Firestore 讀取 `studentProfiles/{studentId}`，單一 document read（~200 words vs 舊方式 ~1500 chars）
- 注入 system prompt 的 `STUDENT PROFILE` section，包含 VCOP levels、strengths/weaknesses、recentWowWords、ispacedNeverUsed、teacherNotes（last 3）、growthNotes
- **Profile 更新流程**：學生每次提交後，前端 fire-and-forget 呼叫 `POST /api/update-profile`，Claude Haiku 分析 annotations 更新 profile
- **teacherNotes 同步**：老師在 Dashboard 存評語時，同時 `arrayUnion` 到 `studentProfiles/{studentId}.teacherNotes`
- **正面框架**：AI 引用 profile 資料時只用鼓勵語氣（如 "You used 'trembling' last time — try another sensory word!"），禁止負面比較
- **只影響 suggestion/praise**，不影響 spelling/grammar 判斷
- **查詢失敗不阻斷**：try/catch 包裹，失敗時繼續正常回饋
- 相關函數：`buildProfileContext()`（格式化 profile JSON）、`buildSystemPrompt()` 第 10 個參數 `studentProfile`

### Class Overview Tab（老師 Dashboard）
- 第三個 tab「Class Overview」，讀取 `studentProfiles` collection（一次性 `getDocs`，非即時）
- **Class VCOP Level Averages**：4 個水平條，顯示 V/C/O/P 全班平均 level（1-5），VCOP 配色
- **Common Weaknesses**：聚合所有學生的 weaknesses、ispacedNeverUsed、punctuation.notYet，按頻率排序前 5
- **Student VCOP Heatmap**：表格 rows=學生 cols=V/C/O/P，每格顯示 level 數字 + 顏色（1=紅 2=橘 3=黃 4=綠 5=深綠），按學號排序

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
- **Openers 維度特殊邏輯**（當 O 維度開啟時，使用 ISPACED 框架）：
  - 七種 Opener 類型（ISPACED）：
    1. **I** = -Ing opener：Running towards the sea, Trembling with fear
    2. **S** = Simile opener：Like a bottle-nose dolphin, As quiet as a mouse
    3. **P** = Preposition opener (where/when)：Underneath the water, At midnight, Across the road
    4. **A** = Adverb opener (-ly words)：Silently, she waited, Carefully, he crept
    5. **C** = Connective opener：Despite it being warm, Although the rain had stopped
    6. **E** = -Ed opener (past participle)：Exhausted from the journey, Convinced she was right
    7. **D** = Dialogue opener：'Wake up!' cried mum, 'Run!' he screamed
  - **Praise（✅）**：學生用了某種 opener → 標記為 praise 並指出類型名稱
  - **Suggestion（💡）**：如果學生句子開頭重複（全部 I/The 開頭）→ 具體建議用哪種 opener，給出用學生原句改寫的例子
  - 統計學生用了幾種不同的 opener 類型，少於 3 種就建議嘗試新類型
  - **逗號規則**：-ly、-ing、prepositional、-ed opener 後面要加逗號，漏加的歸類為 `grammar` annotation
- **VCOP 維度強制覆蓋**：
  - **Prompt 層**：「⚠️ MANDATORY — NON-NEGOTIABLE DIMENSION COVERAGE ⚠️」+ pre-output checklist，缺少任何維度的回饋會被 REJECTED
  - **回饋品質規則**：每條回饋必須包含三部分：(a) 引用學生具體文字 (b) 指出具體技巧名稱 (c) 解釋為什麼好或怎麼改。空泛回饋（如「Keep practising!」「Good job!」）會被 REJECTED
  - **Per-dimension 分析檢查清單**：AI 必須在寫 annotation 前逐項檢查：
    - **P**: 句號大寫一致性 → run-on sentences → 逗號用法 → 問號感嘆號 → 高級標點
    - **V**: dead words 掃描 → 重複詞 → WOW words → sensory language
    - **C**: 連接詞種類和 level → and 鏈 → 最高級連接詞 → 缺少的 level
    - **O**: 每句開頭詞列表 → 連續相同 opener → ISPACED 類型計數 → 逗號規則
  - **前端只 log 不補**：`logDimensionCoverage()` 在 console.error 記錄缺失維度，不注入 fallback 訊息
- **伺服器端驗證**：AI 回傳的 annotations 會被過濾 — phrase 必須在原文中找到精確匹配，否則丟棄；spelling/grammar 的 suggestion 不能和 phrase 相同

### 回饋顯示架構（分組顯示 + 信心優先 + 互動跳轉）
- **分兩層顯示**：
  1. **Inline 文字**：學生原文 + 彩色標記（只有顏色，沒有 note box 打斷文字流）
  2. **分組卡片**（在原文下方）：按類型分組，順序為：
     - 🟢 **What you did well**（praise）：V → C → O → P 順序，綠色背景 `#f0fdf4`
     - 💡 **What to try next**（suggestion）：V → C → O → P 順序，淺灰背景 `#f8fafc`
     - ✏️ **Spelling & Grammar**（spelling + grammar + american_spelling）：放最後
     - ✅ **You improved these!**（revision_good）：修改版時顯示在最前，含 AI 讚美訊息
     - 🔄 **Good try — almost there!**（revision_attempted）：學生嘗試但未明顯進步，含 AI 鼓勵 + 指引
- **設計原則**：學生先看到全部讚美建立信心，再看全部建議專注改進，最後看拼寫文法
- **Click-to-jump 互動**：
  - 每個 inline 標記和對應的下方卡片都有唯一 ID（`inline-ann-{type}-{i}` / `card-ann-{type}-{i}`）
  - 點擊 inline 彩色標記 → 滾動到對應 feedback 卡片 + 黃色閃爍高亮（`@keyframes annFlash` 1.5s）
  - 每個 feedback 卡片有「↑」按鈕 → 滾動回原文中的 inline 標記
  - `scrollToAndFlash(targetId)` 函數：`scrollIntoView({ behavior: "smooth", block: "center" })` + 添加 `ann-flash` class
  - `.ann-clickable` class 加上 cursor pointer + hover 淺藍背景
- **Inline 顏色**：
  - 做得好 praise：綠色字 `#16A34A`
  - 拼寫錯誤 spelling：紅色字 `#DC2626` + 底線
  - 文法錯誤 grammar：橘色字 `#D97706` + 底線
  - 美式拼法 american_spelling：紫色字 `#7C3AED` + 虛線底線
  - VCOP 建議 suggestion：藍色字 `#2563EB` + 淺藍底線
- **VCOP 維度 pill**：小彩色圓角標籤（11px），在卡片內顯示
  - V = 紫色 `#8B5CF6` / `#ede9fe`
  - C = 藍色 `#3B82F6` / `#dbeafe`
  - O = 綠色 `#10B981` / `#d1fae5`
  - P = 橘色 `#F59E0B` / `#fef3c7`

### AI 分析動畫
- 學生提交後顯示全屏覆蓋動畫面板（`analyzing-overlay`）
- 漸層藍色背景 + 藍色邊框，包含：
  - ✏️ 鉛筆搖擺動畫（`pencilWrite` 1.2s loop）
  - 「Reading your writing...」脈動文字（`analyzePulse` 2s loop）
  - 三個彈跳圓點（`dotBounce` 1.4s staggered）
- 淡入動畫 0.4s（`analyzeIn`）

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

### 修改版回饋（v2+）— 三狀態評估
- **不找新問題**，只比對 v1 的原始回饋（spelling、grammar、suggestion 三種）
- 傳入三項資訊：v1 原文、v1 AI 回饋、學生新版本
- AI 對每個原始問題判斷三種狀態：
  - ✅ `revision_good`（綠色）：學生改了且有進步。**不要求完全匹配 AI 建議**，只要比原來好就算。AI 回饋讚美學生的改法，可選擇性建議更好的用詞。
  - 🔄 `revision_attempted`（琥珀色）：學生嘗試改了但沒有明顯進步（如拼錯新字、替換詞不合語境）。AI 先肯定努力，再解釋問題並給指引。
  - ⬜ 未改（保持原始 annotation）：原始問題文字仍在，保持 spelling/grammar/suggestion 原始類型。
- `revision_good` 和 `revision_attempted` 都包含 `originalPhrase`（v1 中被標記的原文）和 `suggestion`（AI 的評語）
- **核心原則**：先肯定學生的努力和改動，再看是否可以更好。永遠不忽略學生的嘗試。
- 傳入 `previousAnnotations` = `iterations[0].annotations`（永遠與 v1 比對）

### Planning Mode（寫作前計畫）
- **兩種模式切換**：學生頁面提交前有兩個 tab — "Planning" 和 "Writing"，預設為 Planning
- **Planning 頁面**：
  - **Brainstorm 區塊**（黃色背景）：大文字框 + 語音輸入，提示「Tell me about your writing. Who is in it? Where does it happen? What goes wrong?」
  - **Plan 區塊**（白色卡片）：Beginning / Middle / End 三個 textarea
  - **VCOP Challenge 區塊**（紫色背景，optional）：
    - 2 個 WOW word 輸入框
    - Opener type 下拉選單（-ly, -ing, question, prepositional, -ed, short punchy）
    - 1 個 connective 輸入框
  - 「Ready to write →」按鈕切換到 Writing 模式
- **Writing 模式**：如果學生有填寫計畫，右側顯示可折疊的 Plan sidebar（桌面端 260px 寬，手機端上方）
- **提交後**：Plan sidebar 仍可展開查看（在 feedback 下方），修改模式也能看到
- **Firestore 儲存**：v1 提交時 plan 物件存入 `submissions/{id}.plan`
  ```json
  { "brainstorm": "...", "beginning": "...", "middle": "...", "end": "...", "wowWords": ["magnificent"], "openerType": "-ly", "connective": "although" }
  ```
- **AI Plan vs Writing 比較**：
  - 在 `buildVcopPrompt()` 中注入 `PLAN VS WRITING CHECK` section
  - 檢查 wowWords、openerType、connective 是否出現在寫作中
  - 輸出 `type: "plan_check"` annotations（`status: "achieved"` 或 `"not_yet"`）
  - 顯示在 AnnotatedText 的分組卡片中（在 praise 之前），標題「📋 Your Plan Goals」
- **不填計畫也能寫**：學生可以直接切換到 Writing tab 開始寫作，plan 相關功能不會影響

### Feedback Level Slider（難度級別，非數量）
- Slider 在提交按鈕上方（提交前顯示，提交後隱藏），標籤「Feedback level」
- 1-3 檔，預設 1
- **不是回饋數量多少，而是期望標準高低**，根據學號判斷學生年級（19=Y6, 20=Y5, 21=Y4）：
  - Level 1：按學生實際年級標準（如 20-05 → Y5 標準）
  - Level 2：比實際年級高 2 年（如 20-05 → Y7 標準，要求修辭技巧、段落銜接、語域轉換）
  - Level 3：比實際年級高 4 年（如 20-05 → Y9 標準，要求語氣掌控、高級修辭、多層從句、風格化標點）
- 計算公式：`targetYear = baseYear + (level - 1) * 2`
- AI prompt 明確包含：學生實際年級 + 目標評估標準 + 各年級期望值描述 + 每個 level 的具體建議範例
- Prompt 裡每個 level 有具體指引：Level 1 = 簡單可達成的建議，Level 2 = 修辭技巧/語域轉換，Level 3 = tricolon/antithesis/subordinate clause 等進階技巧
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
  - **修改版永遠與 v1 比對**：`handleSubmitRevision` 傳入 `iterations[0].text` 和 `iterations[0].annotations`（而非上一版），確保 v3+ 仍能正確追蹤進步
  - **0 改進時的鼓勵訊息**：totalFixed === 0 時標題顯示「Keep going! Try clicking on the suggestions to see what to change.」而非 🎉
  - **嘗試修改計數**：`totalAttempted` 追蹤 `revision_attempted` 的數量，進度條用琥珀色段顯示，標籤顯示「· X almost there」
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

### AI Grading（Oxford Writing Criterion Scale）— 只在老師 Dashboard 顯示
- API endpoint `POST /api/grade`，使用 Oxford Writing Criterion Scale (Standard 1-7) 評級
- 根據學號前兩位自動識別學生實際年級（19→Y6, 20→Y5, 21→Y4）
- 評級不封頂：Standard 1 到 Standard 7，基於學生寫作中一致展現的能力
- 格式：`"Standard 4 — Develops ideas logically with paragraphs, uses adjectives and speech marks"`
- 知識庫：`/api/vcop-knowledge.js` 提供 VCOP_GRADING_KNOWLEDGE，含 6 strand holistic assessment（GHaSP, VCOP, Structure, Writer's Voice）
- **Per-version grading**：展開 submission 時對所有版本並行 grading（`Promise.all`），存為 `{ versions: [{ version, level, reason }] }`
- **學生頁面完全不顯示 grading** — 已移除所有 grade API 呼叫和 grading UI
- Dashboard 顯示：
  - 提交列表 header：`[Y5]`（實際年級灰色）+ `[Y6]`（AI 評級藍色，取最新版）
  - 版本間若有進步顯示 `.grade-improved`（綠色）或 `.grade-declined`（紅色）
  - 展開詳情：grading progression 顯示 `v1: Y4 → v2: Y5 → v3: Y5`
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
| `revision_good` | 修改後有進步（不要求完全匹配 AI 建議） | | 綠色字 + ✅ + AI 讚美訊息 |
| `revision_attempted` | 嘗試修改但未明顯進步 | | 琥珀色字 + 🔄 + AI 鼓勵 + 指引 |
| `plan_check` | 計畫目標達成檢查 | status: "achieved" / "not_yet" | 達成=綠色卡 ✅，未達=紫色卡 💡 |

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
  │     ├── AnnotatedText.jsx — 回饋顯示核心（inline diff + VCOP 標籤 + revision 狀態 + click-to-jump）
  │     │     ├── renderInlineDiff() — 最小差異字元比對
  │     │     ├── cleanSuggestion() — 向後兼容 "wrong → right" 格式
  │     │     ├── scrollToAndFlash() — 點擊互動跳轉 + 黃色閃爍動畫
  │     │     ├── BackToTextBtn — 「↑」按鈕滾回原文標記
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
  ├── analyze.js — AI 寫作分析（VCOP methodology + 年級差異化 + 修改比對 + Student Profile 注入）
  ├── update-profile.js — Student Profile 更新（Claude Haiku 分析 annotations → 更新 studentProfiles）
  ├── vcop-knowledge.js — Big Writing & VCOP 教學方法論知識庫（VCOP_KNOWLEDGE + VCOP_GRADING_KNOWLEDGE）
  ├── auth.js — 登入驗證
  ├── grade.js — AI 寫作水平評級（Oxford Writing Criterion Scale, Standard 1-7）
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
- **Claude 回傳 JSON 會包 markdown code fence 或尾部文字**：即使 prompt 要求「只回 JSON」，Claude 仍可能回 ` ```json ... ``` ` 或在 JSON `}` 後面附加評論文字（特別是 Level 3/Amount 3 長回應時）。`api/analyze.js` 裡先 regex strip code fence，再用 brace-depth 追蹤器提取第一個完整 `{...}` JSON 物件，忽略尾部任何附加文字
- **Feedback level/amount slider 沒有實際增加回饋數量**：Prompt 規則文字有根據 level/amount 改變（如 "2-3 per dimension"），但 AI 遵循的是 prompt 最後的 JSON 範例模板和 pre-output checklist，這兩處硬寫了「at least 1」且範例只展示每維度各一條。修正：JSON 範例模板和 pre-output checklist 改為動態生成，根據 effectiveAmount 展示對應數量的範例行；effectiveAmount >= 2 時加入紅色警告「giving only 1 per dimension is NOT ENOUGH」
- **AI spelling suggestion 格式**：prompt 要求只返回修正後文字（如 `"keeps"`），但 AI 偶爾仍返回 `"keep → keeps"` 格式。`AnnotatedText.jsx` 的 `cleanSuggestion()` 函數會自動提取 `→` 後面的部分，確保向後兼容。
- **Spelling 和 Grammar 必須拆開**：早期版本兩者共用 `type: "spelling"`，導致兩個 toggle 控制同一批 annotations，學生無法分別查看。2026-02-28 拆為獨立的 `type: "spelling"` 和 `type: "grammar"`，各自最多 3 個，前端各自獨立過濾。
- **進步面板分子>分母 bug**：早期版本累加所有修改版的 `revision_good` 數量作為分子，但同一個 v1 issue 在 v2、v3 都會被標為 `revision_good`，導致重複計算。修正：只看最新版的 `revision_good`，用 v1 issue index 去重，分子 cap 在分母以下。
- **高亮編輯器用 case-sensitive 匹配**：case-insensitive 匹配會導致學生改了大小寫（如 `i`→`I`）後高亮不消失。改用 exact match `text.indexOf(a.phrase)` 解決。
- **Feedback level slider 沒有實際效果**：原本 prompt 只有一句「match the TARGET year standard」太模糊，AI 行為幾乎不變。修正：每個 level 加入具體建議範例（Level 1: 簡單詞彙替換；Level 3: tricolon、antithesis、semicolon），並在 prompt 末尾重複當前 level 的期望。
- **VCOP 維度只有 praise 沒有 suggestion（或反之）**：原本規則只要求「at least one annotation (either suggestion or praise)」，AI 常常只給其中一種。修正：明確要求 BOTH praise AND suggestion，加上 pre-output checklist 讓 AI 自我檢查每個維度的覆蓋。第二次修正：prompt 改用最強制語言（NON-NEGOTIABLE + REJECTED）仍不夠，加上前端 `ensureDimensionCoverage()` fallback 自動注入預設 annotation。
- **進步追蹤 v4/v5 顯示 0 improvements**：`handleSubmitRevision` 原本傳 `prevIteration.annotations`（上一版），但 v3+ 的上一版 annotations 已是 `revision_good` 類型，AI 無法與原始 spelling/grammar/suggestion 比對。修正：永遠傳 `iterations[0].text` 和 `iterations[0].annotations`（第一版）。
- **版面偏左**：`margin: 0 auto` 不夠，需要 `margin-left: auto; margin-right: auto` + `#root { width: 100% }` + `body { min-height: 100vh }`。

## Debug 日誌
- **前端** `console.log`：`[SUBMIT] feedbackLevel=X, feedbackAmount=Y` + `[SUBMIT] Got N annotations`
- **API** `console.log`：`[ANALYZE] studentId, feedbackLevel, feedbackAmount, iteration, promptLength` + `[ANALYZE] Raw annotations: N, breakdown: {...}` + `stop_reason, output_tokens`
- **前端** `console.error`：`[VCOP COVERAGE GAP] Missing PRAISE/SUGGESTION for dimension X` — 當 AI 未覆蓋某維度時記錄
