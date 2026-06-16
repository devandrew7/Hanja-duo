// ==========================================================================
// APPLICATION STATE & CONSTANTS
// ==========================================================================
const LEVELS = ["8급", "7급", "6급", "준5급", "5급", "준4급", "4급", "준3급", "3급", "준2급", "2급", "준1급", "1급"];

let wordsDb = {};
let questionsDb = {};
let vocabularyDb = [];

let userState = {
  streak: 0,
  xp: 0,
  completedLevels: [],
  wrongQuestions: [], // List of Hanja chars user got wrong
  unmemorizedCards: [], // Hanja chars user marked as unmemorized in flashcards
  lastActiveDate: "",
  todayXp: 0
};

// Active Session state (Study or Exam)
let activeSession = null;
let currentReviewFilter = "all"; // Filter for wrong words notebook ("all", "quiz", "card")
let currentModalLevelId = null; // Store currently active level ID in modal
let selectedCardSetRange = null; // Store active range { start: X, end: Y } for card sets

// ==========================================================================
// INITIALIZATION
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
  initUserState();
  bindNavigationEvents();
  loadData();
});

// Load words, exams, and vocabulary databases
async function loadData() {
  try {
    const [wordsRes, questionsRes, vocabRes] = await Promise.all([
      fetch("words.json"),
      fetch("questions.json"),
      fetch("vocabulary.json")
    ]);
    
    wordsDb = await wordsRes.json();
    questionsDb = await questionsRes.json();
    vocabularyDb = await vocabRes.json();
    
    console.log("Data loaded successfully.");
    
    // Render the initial dashboard map
    renderRoadmap();
    
    // Render resume session banner if exists
    showResumeBannerIfExists();
    
    // Bind global buttons
    document.getElementById("logo-btn").addEventListener("click", () => {
      switchView("dashboard");
      showResumeBannerIfExists();
    });
    
    document.getElementById("close-session-btn").addEventListener("click", () => {
      if (confirm("학습을 중단하시겠습니까? 지금까지의 진행 상황이 저장됩니다.")) {
        quitStudySession();
      }
    });
    document.getElementById("level-modal-close").addEventListener("click", hideLevelModal);
    
    // Bind study mode radio change to update card sets dynamically
    document.querySelectorAll('input[name="study-mode"]').forEach(radio => {
      radio.addEventListener("change", () => {
        if (currentModalLevelId) {
          updateCardSetSelector(currentModalLevelId);
        }
      });
    });
    
    // Bind resume banner buttons for wrong reviews

    document.getElementById("resume-review-btn").addEventListener("click", () => resumeSavedSession("review"));
    document.getElementById("dismiss-review-resume-btn").addEventListener("click", () => dismissSavedSession("review"));
    
    // Bind review filter tabs
    document.querySelectorAll(".filter-tab").forEach(tab => {
      tab.addEventListener("click", (e) => {
        document.querySelectorAll(".filter-tab").forEach(t => t.classList.remove("active"));
        e.currentTarget.classList.add("active");
        currentReviewFilter = e.currentTarget.getAttribute("data-filter");
        renderReviewTab();
      });
    });
    
    // Bind exam selector buttons
    document.querySelectorAll(".start-exam-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const examId = e.target.getAttribute("data-exam");
        startMockExam(examId);
      });
    });
    
    document.getElementById("submit-exam-btn").addEventListener("click", submitExam);
    document.getElementById("exam-prev-btn").addEventListener("click", () => navigateExam(-1));
    document.getElementById("exam-next-btn").addEventListener("click", () => navigateExam(1));
    document.getElementById("report-back-btn").addEventListener("click", () => {
      switchView("exams");
      document.getElementById("exam-selector-screen").classList.remove("hidden");
      document.getElementById("exam-report-screen").classList.add("hidden");
    });
    document.getElementById("report-review-wrong-btn").addEventListener("click", () => {
      document.querySelector(".exam-review-container").scrollIntoView({ behavior: "smooth" });
    });
    
    // Bind review buttons
    document.getElementById("start-quiz-review-btn").addEventListener("click", () => startWrongReviewSession("quiz"));
    document.getElementById("start-card-review-btn").addEventListener("click", () => startWrongReviewSession("card"));
    
    // Bind review selection and delete actions
    document.getElementById("review-select-all-cb").addEventListener("change", (e) => {
      const checked = e.currentTarget.checked;
      document.querySelectorAll(".card-select-cb").forEach(cb => {
        cb.checked = checked;
      });
      updateSelectionState();
    });
    document.getElementById("delete-selected-btn").addEventListener("click", deleteSelectedWrongCharacters);
    document.getElementById("delete-all-btn").addEventListener("click", deleteAllWrongCharacters);
    
  } catch (error) {
    console.error("Error loading data files:", error);
    alert("데이터 파일을 읽어오는 도중 오류가 발생했습니다. 로컬 서버(HTTP Server)를 실행 중인지 확인하세요.");
  }
}

// Initialize user stats from localStorage
function initUserState() {
  const savedState = localStorage.getItem("hanja_study_state");
  if (savedState) {
    try {
      userState = JSON.parse(savedState);
      
      // Ensure all keys exist
      if (!userState.wrongQuestions) userState.wrongQuestions = [];
      if (!userState.unmemorizedCards) userState.unmemorizedCards = [];
      if (!userState.completedLevels) userState.completedLevels = [];
      if (userState.todayXp === undefined) userState.todayXp = 0;
      
      // Check streak validity
      checkStreakReset();
    } catch (e) {
      console.error("Error parsing user state:", e);
    }
  } else {
    // Default state
    userState = {
      streak: 0,
      xp: 0,
      completedLevels: [],
      wrongQuestions: [],
      unmemorizedCards: [],
      lastActiveDate: "",
      todayXp: 0
    };
    saveUserState();
  }
  updateStatsHeader();
  
  // Migrate old singular study session to plural array format
  migrateOldSession();
}

function migrateOldSession() {
  const oldSaved = localStorage.getItem("hanja_saved_study_session");
  if (oldSaved) {
    try {
      const parsed = JSON.parse(oldSaved);
      localStorage.setItem("hanja_saved_study_sessions", JSON.stringify([parsed]));
    } catch (e) {
      console.error("Migration error:", e);
    }
    localStorage.removeItem("hanja_saved_study_session");
  }
}


function saveUserState() {
  localStorage.setItem("hanja_study_state", JSON.stringify(userState));
}

// Calculate streak reset if user missed a day
function checkStreakReset() {
  if (!userState.lastActiveDate) return;
  
  const today = new Date().toDateString();
  const lastActive = new Date(userState.lastActiveDate).toDateString();
  
  if (today === lastActive) {
    // Active today
    return;
  }
  
  const timeDiff = new Date(today).getTime() - new Date(lastActive).getTime();
  const dayDiff = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
  
  if (dayDiff > 1) {
    // Missed more than 1 day, reset streak
    userState.streak = 0;
    userState.todayXp = 0;
    saveUserState();
  } else if (dayDiff === 1) {
    // Reset today's XP for the new day
    userState.todayXp = 0;
    saveUserState();
  }
}

// Update streak/XP stats indicators in the header
function updateStatsHeader() {
  document.getElementById("nav-streak").textContent = userState.streak;
  document.getElementById("nav-xp").textContent = userState.xp;
  document.getElementById("today-xp-val").textContent = userState.todayXp;
}

// Handle tab switching
function bindNavigationEvents() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      // Don't switch if in active study session (warn user)
      if (activeSession && activeSession.type === "study") {
        if (!confirm("현재 학습 세션이 진행 중입니다. 진행 상황이 저장되며 나중에 이어서 학습할 수 있습니다. 나가시겠습니까?")) {
          return;
        }
        quitStudySession();
      }
      if (activeSession && activeSession.type === "exam") {
        if (!confirm("현재 시험이 진행 중입니다. 시험을 나가시겠습니까? 마킹 내용이 유실됩니다.")) {
          return;
        }
        clearInterval(activeSession.timerInterval);
        activeSession = null;
        document.getElementById("exam-active-screen").classList.add("hidden");
        document.getElementById("exam-selector-screen").classList.remove("hidden");
      }
      
      const targetTab = e.currentTarget.getAttribute("data-tab");
      
      // Update UI active states
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      e.currentTarget.classList.add("active");
      
      // Toggle screens
      if (targetTab === "dashboard") {
        switchView("dashboard");
        renderRoadmap();
      } else if (targetTab === "exams") {
        switchView("exams");
        document.getElementById("exam-selector-screen").classList.remove("hidden");
        document.getElementById("exam-active-screen").classList.add("hidden");
        document.getElementById("exam-report-screen").classList.add("hidden");
      } else if (targetTab === "review") {
        switchView("review");
        renderReviewTab();
      }
    });
  });
}

function switchView(viewName) {
  document.querySelectorAll(".view-section").forEach(view => {
    view.classList.add("hidden");
    view.classList.remove("active");
  });
  
  const activeView = document.getElementById(`${viewName}-view`);
  activeView.classList.remove("hidden");
  activeView.classList.add("active");
}

// ==========================================================================
// ROADMAP RENDERING (Dashboard Map)
// ==========================================================================
function renderRoadmap() {
  const roadmapPath = document.getElementById("roadmap-path");
  roadmapPath.innerHTML = "";
  
  // Group levels as requested:
  // Row 1: 8급~6급
  // Row 2: 준5급~4급
  // Row 3: 준3급~2급
  // Row 4: 준1급~1급
  const rows = [
    ["8급", "7급", "6급"],
    ["준5급", "5급", "준4급", "4급"],
    ["준3급", "3급", "준2급", "2급"],
    ["준1급", "1급"]
  ];
  
  rows.forEach((rowLevels, rowIndex) => {
    const rowDiv = document.createElement("div");
    rowDiv.className = `roadmap-row row-${rowIndex + 1}`;
    
    rowLevels.forEach((lvl) => {
      const idx = LEVELS.indexOf(lvl);
      const isCompleted = userState.completedLevels.includes(lvl);
      
      // Unlock all levels so the user can study any level directly
      let isUnlocked = true;
      let isCurrent = false;
      
      // Highlight the lowest uncompleted level as current
      const lowestUncompletedIdx = LEVELS.findIndex(lvl => !userState.completedLevels.includes(lvl));
      if (idx === lowestUncompletedIdx) {
        isCurrent = true;
      }
      
      const nodeWrapper = document.createElement("div");
      nodeWrapper.className = "level-node-wrapper";
      if (isCompleted) nodeWrapper.classList.add("completed");
      else if (isCurrent) nodeWrapper.classList.add("current");
      else if (isUnlocked) nodeWrapper.classList.add("unlocked");
      
      // Bind click event to the entire card instead of just the inner button for better UX
      nodeWrapper.addEventListener("click", () => showLevelModal(lvl, isCompleted, isCurrent || isUnlocked));
      
      const button = document.createElement("button");
      button.className = "level-node-button";
      button.innerHTML = `<span class="node-label">${lvl}</span>`;
      
      const bubble = document.createElement("div");
      bubble.className = "level-details-bubble";
      
      let statusText = "잠김";
      if (isCompleted) statusText = "학습 완료";
      else if (isCurrent) statusText = "학습 중 ⚡";
      else if (isUnlocked) statusText = "도전 가능";
      
      const count = wordsDb[lvl] ? wordsDb[lvl].length : 0;
      bubble.textContent = `${count}자 학습 · ${statusText}`;
      
      nodeWrapper.appendChild(button);
      nodeWrapper.appendChild(bubble);
      rowDiv.appendChild(nodeWrapper);
    });
    
    roadmapPath.appendChild(rowDiv);
  });
}

// ==========================================================================
// LEVEL DETAILS MODAL
// ==========================================================================
function showLevelModal(levelId, isCompleted, isUnlocked) {
  currentModalLevelId = levelId; // Store active level
  
  const modal = document.getElementById("level-modal");
  const title = document.getElementById("modal-level-title");
  const countBadge = document.getElementById("modal-level-count");
  const statusBadge = document.getElementById("modal-level-status");
  const desc = document.getElementById("modal-level-desc");
  const charsGrid = document.getElementById("modal-chars-grid");
  const studyBtn = document.getElementById("modal-start-study-btn");
  const quizBtn = document.getElementById("modal-start-quiz-btn");
  
  title.textContent = `${levelId} 선정한자`;
  
  const chars = wordsDb[levelId] || [];
  countBadge.textContent = `신출 ${chars.length}자`;
  
  if (isCompleted) {
    statusBadge.textContent = "학습 완료";
    statusBadge.className = "level-meta-badge success";
  } else if (isUnlocked) {
    statusBadge.textContent = "도전 중";
    statusBadge.className = "level-meta-badge";
  } else {
    statusBadge.textContent = "잠겨있음";
    statusBadge.className = "level-meta-badge";
  }
  
  // Custom level descriptions
  const descriptions = {
    "8급": "기초 필수 한자 30자로 구성되어 있으며 한자의 기초 획과 간단한 상형 문자를 다룹니다.",
    "7급": "일상 어휘에 자주 쓰이는 기초 한자 20자가 추가됩니다. (8급 포함 총 50자)",
    "6급": "지형, 자연, 숫자 및 대조 관계에 관련한 20자가 추가됩니다. (누적 총 70자)",
    "준5급": "단어가 조금 더 구조화되며 힘, 서류, 방향을 나타내는 30자가 추가됩니다. (누적 총 100자)",
    "5급": "본격적인 실용 한자어가 시작되는 단계로 150자가 추가됩니다. (누적 총 250자)",
    "준4급": "문장 및 전문 분야에서 사용되는 한자 150자가 추가됩니다. (누적 총 400자)",
    "4급": "대한검정회 4급 자격 기준 한자로 200자가 새롭게 추가됩니다. (누적 총 600자)",
    "준3급": "대한검정회 준3급 자격 기준 한자로 200자가 새롭게 추가됩니다. (누적 총 800자)",
    "3급": "대한검정회 3급 자격 기준 한자로 200자가 새롭게 추가됩니다. (누적 총 1,000자)",
    "준2급": "대한검정회 준2급 자격 기준 한자로 500자가 새롭게 추가됩니다. (누적 총 1,500자)",
    "2급": "대한검정회 2급 자격 기준 한자로 500자가 새롭게 추가됩니다. (누적 총 2,000자)",
    "준1급": "대한검정회 준1급 자격 기준 한자로 500자가 새롭게 추가됩니다. (누적 총 2,500자)",
    "1급": "대한검정회 1급 자격 기준 한자로 1,000자가 새롭게 추가됩니다. (누적 총 3,500자)"
  };
  desc.textContent = descriptions[levelId] || "등급별 한자를 반복 학습할 수 있습니다.";
  
  // Render character grid with tooltip meanings
  charsGrid.innerHTML = "";
  chars.forEach(c => {
    const charDiv = document.createElement("div");
    charDiv.className = "modal-char-item";
    charDiv.textContent = c.char;
    charDiv.setAttribute("data-tooltip", c.full_hunum);
    charsGrid.appendChild(charDiv);
  });
  
  document.getElementById("modal-chars-count").textContent = chars.length;
  
  // Update card sets UI based on the initial mode
  updateCardSetSelector(levelId);
  
  // Clone buttons to remove previous event listeners
  const newStudyBtn = studyBtn.cloneNode(true);
  studyBtn.parentNode.replaceChild(newStudyBtn, studyBtn);
  newStudyBtn.addEventListener("click", () => {
    const studyModeVal = document.querySelector('input[name="study-mode"]:checked').value;
    startStudySession(levelId, studyModeVal, "flashcard");
    hideLevelModal();
  });
  
  const newQuizBtn = quizBtn.cloneNode(true);
  quizBtn.parentNode.replaceChild(newQuizBtn, quizBtn);
  newQuizBtn.addEventListener("click", () => {
    const studyModeVal = document.querySelector('input[name="study-mode"]:checked').value;
    startStudySession(levelId, studyModeVal, "quiz");
    hideLevelModal();
  });
  
  modal.classList.remove("hidden");
}

function hideLevelModal() {
  document.getElementById("level-modal").classList.add("hidden");
  currentModalLevelId = null;
  selectedCardSetRange = null; // Reset selection
}

function updateCardSetSelector(levelId) {
  const selectorSection = document.getElementById("card-set-selector-section");
  const dropdown = document.getElementById("modal-set-dropdown");
  
  // Reset selected set range
  selectedCardSetRange = null;
  
  const lvlIdx = LEVELS.indexOf(levelId);
  const isSetSelectionApplicable = lvlIdx >= LEVELS.indexOf("5급");
  
  if (!isSetSelectionApplicable) {
    selectorSection.classList.add("hidden");
    if (dropdown) dropdown.innerHTML = "";
    return;
  }
  
  // Determine character pool size based on mode
  const studyModeVal = document.querySelector('input[name="study-mode"]:checked').value;
  let poolSize = 0;
  if (studyModeVal === "new-only") {
    poolSize = wordsDb[levelId] ? wordsDb[levelId].length : 0;
  } else {
    // Cumulative count
    for (let i = 0; i <= lvlIdx; i++) {
      const lvlName = LEVELS[i];
      if (wordsDb[lvlName]) {
        poolSize += wordsDb[lvlName].length;
      }
    }
  }
  
  const setSize = getCardSetSizeForLevel(levelId);
  if (poolSize <= setSize) {
    selectorSection.classList.add("hidden");
    if (dropdown) dropdown.innerHTML = "";
    return;
  }
  
  selectorSection.classList.remove("hidden");
  if (dropdown) {
    dropdown.innerHTML = "";
    
    // Update header text dynamically
    const header = selectorSection.querySelector("h3");
    if (header) {
      header.textContent = `카드 학습 세트 선택 (${setSize}자 단위)`;
    }
    
    // Render "전체" option
    const allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = `전체 (${poolSize}자)`;
    dropdown.appendChild(allOpt);
    
    // Render sets based on setSize
    const setNum = Math.ceil(poolSize / setSize);
    for (let s = 0; s < setNum; s++) {
      const startIdx = s * setSize;
      const endIdx = Math.min((s + 1) * setSize, poolSize);
      
      const setOpt = document.createElement("option");
      setOpt.value = `${startIdx},${endIdx}`;
      setOpt.textContent = `세트 ${s + 1} (${startIdx + 1}~${endIdx})`;
      dropdown.appendChild(setOpt);
    }
    
    // Re-bind change listener by replacing dropdown with its clone to clean up old listeners
    const newDropdown = dropdown.cloneNode(true);
    dropdown.parentNode.replaceChild(newDropdown, dropdown);
    
    newDropdown.addEventListener("change", () => {
      const val = newDropdown.value;
      if (val === "all") {
        selectedCardSetRange = null;
      } else {
        const [start, end] = val.split(",").map(Number);
        selectedCardSetRange = { start, end };
      }
    });
  }
}

// ==========================================================================
// STUDY SESSION ENGINE (Duolingo Style)
// ==========================================================================
function startStudySession(levelId, studyMode = "cumulative", sessionType = "quiz") {
  // Determine active set range first
  let activeRange = selectedCardSetRange;
  if (!activeRange) {
    const dropdown = document.getElementById("modal-set-dropdown");
    if (dropdown && dropdown.value && dropdown.value !== "all") {
      const [start, end] = dropdown.value.split(",").map(Number);
      activeRange = { start, end };
    }
  }

  let savedSessions = [];
  try {
    savedSessions = JSON.parse(localStorage.getItem("hanja_saved_study_sessions") || "[]");
  } catch (e) {}

  // Check if this specific level + type + range is already saved
  const existingIndex = savedSessions.findIndex(s => {
    const sRange = s.selectedSetRange;
    const sameRange = (!sRange && !activeRange) || 
                     (sRange && activeRange && sRange.start === activeRange.start && sRange.end === activeRange.end);
    return s.levelId === levelId && s.sessionType === sessionType && sameRange;
  });

  if (existingIndex !== -1) {
    const session = savedSessions[existingIndex];
    const typeText = session.sessionType === "flashcard" ? "카드 학습" : "퀴즈 풀기";
    let setText = "";
    if (session.selectedSetRange) {
      const setSize = getCardSetSizeForLevel(session.levelId);
      const setIdx = Math.floor(session.selectedSetRange.start / setSize) + 1;
      setText = ` (세트 ${setIdx})`;
    }
    if (confirm(`이전에 진행하던 ${levelId} ${typeText}${setText} 기록이 있습니다. 이어서 하시겠습니까?\n(아니오를 누르면 해당 기록을 지우고 새로 시작합니다)`)) {
      resumeSavedSessionByLevelTypeAndRange(levelId, sessionType, activeRange);
      return;
    } else {
      // Remove this specific one from the array
      savedSessions.splice(existingIndex, 1);
      localStorage.setItem("hanja_saved_study_sessions", JSON.stringify(savedSessions));
    }
  } else {
    // Starting a new session. Check if we already have 3 sessions saved.
    if (savedSessions.length >= 3) {
      const oldest = savedSessions[0];
      const oldestTypeText = oldest.sessionType === "flashcard" ? "카드 학습" : "퀴즈 풀기";
      let oldestSetText = "";
      if (oldest.selectedSetRange) {
        const setSize = getCardSetSizeForLevel(oldest.levelId);
        const setIdx = Math.floor(oldest.selectedSetRange.start / setSize) + 1;
        oldestSetText = ` (세트 ${setIdx})`;
      }
      if (!confirm(`이전 학습 이어하기가 3개로 가득 찼습니다.\n가장 오래된 학습 기록(${oldest.levelId} ${oldestTypeText}${oldestSetText})을 지우고 새로 시작하시겠습니까?`)) {
        return;
      }
      // Remove oldest
      savedSessions.shift();
      localStorage.setItem("hanja_saved_study_sessions", JSON.stringify(savedSessions));
    }
  }

  // 1. Compile character pool
  const cumulativePool = [];
  
  if (studyMode === "new-only") {
    // Only characters from the selected level
    if (wordsDb[levelId]) {
      cumulativePool.push(...wordsDb[levelId]);
    }
  } else {
    // Cumulative: characters from current level and all lower levels
    const levelIdx = LEVELS.indexOf(levelId);
    for (let i = 0; i <= levelIdx; i++) {
      const lvlName = LEVELS[i];
      if (wordsDb[lvlName]) {
        cumulativePool.push(...wordsDb[lvlName]);
      }
    }
  }
  
  if (cumulativePool.length === 0) {
    alert("한자 데이터를 불러올 수 없습니다.");
    return;
  }
  
  let questions = [];

  if (sessionType === "flashcard") {
    // Flashcard mode: Study the character pool. Slice first if set range is chosen, and DO NOT shuffle to keep Hanja order stable.
    let targetPool = [...cumulativePool];
    if (activeRange) {
      targetPool = targetPool.slice(activeRange.start, activeRange.end);
    }
    questions = targetPool.map(c => ({
      char: c.char,
      meaning: c.meaning,
      reading: c.reading,
      full_hunum: c.full_hunum,
      levelId: levelId
    }));
  } else {
    // Quiz mode: Generate 10 multiple-choice questions
    // 2. Compile vocabulary pool (compounds whose characters are fully within cumulativePool)
    const poolCharSet = new Set(cumulativePool.map(c => c.char));
    const vocabularyPool = vocabularyDb.filter(v => {
      for (let char of v.word) {
        if (!poolCharSet.has(char)) return false;
      }
      return true;
    });
    
    for (let qNum = 1; qNum <= 10; qNum++) {
      let type = Math.floor(Math.random() * 2); // default 0 or 1
      if (vocabularyPool.length > 0 && Math.random() > 0.4) {
        type = 2 + Math.floor(Math.random() * 2); // 2 or 3
      }
      
      let question = null;
      if (type === 0) {
        const charObj = getRandomElement(cumulativePool);
        const distractors = getDistractors(charObj.full_hunum, cumulativePool.map(c => c.full_hunum), 3);
        question = {
          type: "char_to_hunum",
          prompt: charObj.char,
          correctAnswer: charObj.full_hunum,
          choices: shuffleArray([charObj.full_hunum, ...distractors]),
          instruction: "다음 한자의 올바른 훈음(뜻과 음)을 고르시오.",
          char: charObj.char,
          meaning: charObj.full_hunum
        };
      } else if (type === 1) {
        const charObj = getRandomElement(cumulativePool);
        const distractors = getDistractors(charObj.char, cumulativePool.map(c => c.char), 3);
        question = {
          type: "hunum_to_char",
          prompt: charObj.full_hunum,
          correctAnswer: charObj.char,
          choices: shuffleArray([charObj.char, ...distractors]),
          instruction: "다음 훈음에 어울리는 올바른 한자를 고르시오.",
          char: charObj.char,
          meaning: charObj.full_hunum
        };
      } else if (type === 2) {
        const wordObj = getRandomElement(vocabularyPool);
        const distractors = getDistractors(wordObj.reading, vocabularyDb.map(v => v.reading), 3);
        question = {
          type: "word_to_reading",
          prompt: wordObj.word,
          correctAnswer: wordObj.reading,
          choices: shuffleArray([wordObj.reading, ...distractors]),
          instruction: "다음 한자어의 올바른 독음(소리)을 고르시오.",
          char: wordObj.word,
          meaning: wordObj.meaning
        };
      } else {
        const wordObj = getRandomElement(vocabularyPool);
        const distractors = getDistractors(wordObj.word, vocabularyDb.map(v => v.word), 3);
        question = {
          type: "meaning_to_word",
          prompt: wordObj.meaning,
          correctAnswer: wordObj.word,
          choices: shuffleArray([wordObj.word, ...distractors]),
          instruction: "다음 사전 정의에 알맞은 한자어를 고르시오.",
          char: wordObj.word,
          meaning: wordObj.meaning
        };
      }
      questions.push(question);
    }
  }
  
  // Initialize Session
  activeSession = {
    type: "study",
    sessionType: sessionType, // "quiz" or "flashcard"
    levelId: levelId,
    questions: questions,
    currentIndex: 0,
    hearts: 5,
    failedQuestions: [],
    selectedChoice: null,
    selectedSetRange: (sessionType === "flashcard") ? activeRange : null
  };
  
  // Show UI changes
  switchView("session");
  
  // Toggle workspace visibilities based on session type
  const quizWorkspace = document.getElementById("quiz-workspace");
  const flashcardWorkspace = document.getElementById("flashcard-workspace");
  const sessionFooter = document.getElementById("session-footer");
  const heartsContainer = document.getElementById("session-hearts-container");
  
  if (sessionType === "flashcard") {
    quizWorkspace.classList.add("hidden");
    flashcardWorkspace.classList.remove("hidden");
    sessionFooter.classList.add("hidden");
    heartsContainer.classList.add("hidden"); // No hearts in flashcard study
  } else {
    quizWorkspace.classList.remove("hidden");
    flashcardWorkspace.classList.add("hidden");
    sessionFooter.classList.remove("hidden");
    heartsContainer.classList.remove("hidden");
    updateHeartsUI();
  }
  
  renderNextStudyQuestion();
}

function updateHeartsUI() {
  const container = document.getElementById("nav-hearts");
  container.innerHTML = "";
  
  // Render ❤️ icons
  for (let i = 0; i < 5; i++) {
    const heart = document.createElement("i");
    if (i < activeSession.hearts) {
      heart.className = "fa-solid fa-heart";
    } else {
      heart.className = "fa-regular fa-heart";
      heart.style.opacity = "0.3";
    }
    container.appendChild(heart);
  }
}

function renderNextStudyQuestion() {
  const session = activeSession;
  
  // Check if we are done with the primary queue
  if (session.currentIndex >= session.questions.length) {
    // Check if there are failed questions to re-ask
    if (session.failedQuestions.length > 0) {
      // Put failed question as next
      const reaskQ = session.failedQuestions.shift();
      session.questions.push(reaskQ); // Append to queue
      // Continue study
    } else {
      // Session Completed Successfully!
      completeStudySession();
      return;
    }
  }
  
  // Reset selected choice
  session.selectedChoice = null;
  
  // Save active study session progress
  saveActiveSessionProgress();
  
  // Update progress bar
  const totalQs = session.questions.length;
  const progressPercent = ((session.currentIndex + 1) / totalQs) * 100;
  document.getElementById("session-progress-fill").style.width = `${progressPercent}%`;
  document.getElementById("session-progress-text").textContent = `${session.currentIndex + 1} / ${totalQs}`;
  
  // Load question object
  const q = session.questions[session.currentIndex];
  
  if (session.sessionType === "flashcard") {
    renderFlashcardQuestion(q);
    return;
  }
  
  const cardBox = document.getElementById("question-card");
  cardBox.innerHTML = "";
  
  // Render instruction
  const instr = document.createElement("div");
  instr.className = "question-title";
  instr.textContent = q.instruction;
  cardBox.appendChild(instr);
  
  // Render prompt
  const prompt = document.createElement("div");
  prompt.className = "question-prompt";
  if (q.prompt.length > 4) {
    prompt.classList.add("phrase");
  }
  prompt.textContent = q.prompt;
  cardBox.appendChild(prompt);
  
  // Render choices grid
  const grid = document.createElement("div");
  grid.className = "choices-grid";
  
  const indexSyms = ["①", "②", "③", "④"];
  q.choices.forEach((choice, idx) => {
    const btn = document.createElement("button");
    btn.className = "choice-btn";
    btn.innerHTML = `<span class="choice-index">${indexSyms[idx]}</span> ${choice}`;
    
    btn.addEventListener("click", () => {
      // Toggle selected class
      document.querySelectorAll(".choice-btn").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      session.selectedChoice = choice;
      
      // Activate bottom "정답 확인" button
      document.getElementById("session-action-btn").removeAttribute("disabled");
    });
    
    grid.appendChild(btn);
  });
  cardBox.appendChild(grid);
  
  // Reset bottom session footer action bar
  const footer = document.getElementById("session-footer");
  footer.className = "session-footer"; // reset classes (remove .correct, .wrong)
  
  const feedbackMsg = document.getElementById("feedback-message");
  feedbackMsg.classList.remove("show");
  feedbackMsg.innerHTML = "";
  
  const actionBtn = document.getElementById("session-action-btn");
  actionBtn.textContent = "정답 확인";
  actionBtn.setAttribute("disabled", "true");
  
  // Clone button to remove previous event listeners
  const newActionBtn = actionBtn.cloneNode(true);
  actionBtn.parentNode.replaceChild(newActionBtn, actionBtn);
  
  // Click handler for check/continue
  newActionBtn.addEventListener("click", () => {
    if (newActionBtn.textContent === "정답 확인") {
      checkStudyAnswer();
    } else {
      // Move to next question
      session.currentIndex++;
      renderNextStudyQuestion();
    }
  });
}

function checkStudyAnswer() {
  const session = activeSession;
  const q = session.questions[session.currentIndex];
  const selected = session.selectedChoice;
  const isCorrect = (selected === q.correctAnswer);
  
  const footer = document.getElementById("session-footer");
  const msgDiv = document.getElementById("feedback-message");
  const btn = document.getElementById("session-action-btn");
  
  if (isCorrect) {
    footer.classList.add("correct");
    msgDiv.innerHTML = `
      <div class="icon-box"><i class="fa-solid fa-check"></i></div>
      <div>
        <div class="msg-title">정답입니다! 참 잘했어요! 🎉</div>
        <div class="msg-desc">훈음: ${q.meaning || ""}</div>
      </div>
    `;
    
    // Play correct answer sound effect
    const correctAudio = new Audio('sfx/Retro - Chip Power.wav');
    correctAudio.play().catch(err => {
      console.warn("Audio play failed or was blocked by browser autoplay policy:", err);
    });
    
    // Play celebratory confetti spark on correct answer occasionally
    confetti({
      particleCount: 20,
      angle: 60,
      spread: 55,
      origin: { x: 0 }
    });
    confetti({
      particleCount: 20,
      angle: 120,
      spread: 55,
      origin: { x: 1 }
    });
    
  } else {
    footer.classList.add("wrong");
    msgDiv.innerHTML = `
      <div class="icon-box"><i class="fa-solid fa-xmark"></i></div>
      <div>
        <div class="msg-title">아쉬워요, 정답이 아닙니다.</div>
        <div class="msg-desc"><strong>정답: ${q.correctAnswer}</strong><br>설명: ${q.meaning || ""}</div>
      </div>
    `;
    
    // Lose a heart
    session.hearts--;
    updateHeartsUI();
    
    // Save incorrect character to wrong list (for Review tab)
    if (q.char) {
      for (let char of q.char) {
        if (isHanjaCode(char.charCodeAt(0)) && !userState.wrongQuestions.includes(char)) {
          userState.wrongQuestions.push(char);
        }
      }
      saveUserState();
    }
    
    // Add back to session failedQuestions queue to re-ask at the end
    session.failedQuestions.push(q);
    
    // Check if dead
    if (session.hearts <= 0) {
      footer.className = "session-footer";
      msgDiv.classList.remove("show");
      alert("하트를 모두 소모하였습니다! 학습 세션이 실패로 종료됩니다. 대시보드로 이동합니다.");
      if (session.levelId.includes("오답")) {
        clearActiveSessionProgress("review");
      } else {
        clearActiveSessionProgress("study");
      }
      activeSession = null;
      quitStudySession();
      return;
    }
  }
  
  msgDiv.classList.add("show");
  btn.textContent = "계속하기";
}

function completeStudySession() {
  const session = activeSession;
  
  // Save progress
  if (!userState.completedLevels.includes(session.levelId)) {
    userState.completedLevels.push(session.levelId);
  }
  
  // Award XP
  const isFlashcard = session.sessionType === "flashcard";
  const xpEarned = isFlashcard ? 5 : 10;
  userState.xp += xpEarned;
  userState.todayXp += xpEarned;
  
  // Update last active date and increment streak
  const today = new Date().toDateString();
  const lastActive = userState.lastActiveDate ? new Date(userState.lastActiveDate).toDateString() : "";
  
  if (today !== lastActive) {
    // Increment streak
    userState.streak++;
  }
  userState.lastActiveDate = new Date().toISOString();
  
  saveUserState();
  updateStatsHeader();
  
  // Celebrate!
  const duration = 2 * 1000;
  const end = Date.now() + duration;

  (function frame() {
    confetti({
      particleCount: 5,
      angle: 60,
      spread: 55,
      origin: { x: 0 }
    });
    confetti({
      particleCount: 5,
      angle: 120,
      spread: 55,
      origin: { x: 1 }
    });

    if (Date.now() < end) {
      requestAnimationFrame(frame);
    }
  }());
  
  if (isFlashcard) {
    alert(`축하합니다! ${session.levelId} 카드 학습을 완료하였습니다! (+5 XP 획득)`);
  } else {
    alert(`축하합니다! ${session.levelId} 퀴즈를 통과하였습니다! (+10 XP 획득)`);
  }
  
  // Clear saved progress
  if (session.levelId.includes("오답")) {
    clearActiveSessionProgress("review");
  } else {
    clearActiveSessionProgress("study");
  }
  
  activeSession = null; // Set to null so quitStudySession does not save it again
  
  // Quit session safely
  quitStudySession();
}

// Render flat flashcard for study sessions
function renderFlashcardQuestion(q) {
  const card = document.getElementById("flashcard-card");
  
  // Hide details initially
  const info = document.getElementById("flashcard-info");
  info.classList.remove("show");
  
  // Populate Card Face
  let setText = "";
  if (activeSession && activeSession.selectedSetRange) {
    const setSize = getCardSetSizeForLevel(activeSession.levelId);
    const setIdx = Math.floor(activeSession.selectedSetRange.start / setSize) + 1;
    setText = ` (세트 ${setIdx})`;
  }
  document.getElementById("flashcard-back-level").textContent = `${q.levelId} 카드 학습${setText}`;
  document.getElementById("flashcard-char").textContent = q.char;
  document.getElementById("flashcard-back-hunum").textContent = q.full_hunum;
  
  // Update check button state
  const checkBtn = document.getElementById("flashcard-check-btn");
  if (!userState.unmemorizedCards) userState.unmemorizedCards = [];
  const isUnmemorized = userState.unmemorizedCards.includes(q.char);
  if (isUnmemorized) {
    checkBtn.classList.add("checked");
    checkBtn.innerHTML = `<i class="fa-solid fa-bookmark"></i> 못 외움 체크됨`;
  } else {
    checkBtn.classList.remove("checked");
    checkBtn.innerHTML = `<i class="fa-regular fa-bookmark"></i> 못 외웠어요`;
  }
  
  // Reset tip text
  const tip = document.getElementById("flashcard-tip");
  tip.innerHTML = `<i class="fa-solid fa-hand-pointer"></i> 카드를 클릭하면 뜻과 음이 보입니다`;
  
  // Clone card to remove old event listeners
  const newCard = card.cloneNode(true);
  card.parentNode.replaceChild(newCard, card);
  
  // Re-fetch button reference from cloned node
  const clonedCheckBtn = newCard.querySelector("#flashcard-check-btn");
  clonedCheckBtn.addEventListener("click", (e) => {
    e.stopPropagation(); // Prevent card body click event (which advances card)
    
    if (!userState.unmemorizedCards) userState.unmemorizedCards = [];
    const isCurrentlyUnmemorized = userState.unmemorizedCards.includes(q.char);
    if (isCurrentlyUnmemorized) {
      userState.unmemorizedCards = userState.unmemorizedCards.filter(c => c !== q.char);
      clonedCheckBtn.classList.remove("checked");
      clonedCheckBtn.innerHTML = `<i class="fa-regular fa-bookmark"></i> 못 외웠어요`;
    } else {
      userState.unmemorizedCards.push(q.char);
      clonedCheckBtn.classList.add("checked");
      clonedCheckBtn.innerHTML = `<i class="fa-solid fa-bookmark"></i> 못 외움 체크됨`;
    }
    saveUserState();
    saveActiveSessionProgress(); // Save progress to save checked state in session
  });
  
  // Click handler: first click reveals details below character, second click moves to next
  newCard.addEventListener("click", () => {
    const activeInfo = document.getElementById("flashcard-info");
    const activeTip = document.getElementById("flashcard-tip");
    
    if (!activeInfo.classList.contains("show")) {
      activeInfo.classList.add("show");
      activeTip.innerHTML = `<i class="fa-solid fa-arrow-right-to-bracket"></i> 한 번 더 클릭하면 다음으로 넘어갑니다`;
    } else {
      activeSession.currentIndex++;
      saveActiveSessionProgress(); // Save progress
      renderNextStudyQuestion();
    }
  });
}

function quitStudySession() {
  if (activeSession) {
    saveActiveSessionProgress();
  }
  activeSession = null;
  document.getElementById("session-hearts-container").classList.add("hidden");
  
  const card = document.getElementById("flashcard-card");
  if (card) card.classList.remove("flipped");
  
  const footer = document.getElementById("session-footer");
  if (footer) footer.className = "session-footer";
  
  const feedbackMsg = document.getElementById("feedback-message");
  if (feedbackMsg) {
    feedbackMsg.classList.remove("show");
    feedbackMsg.innerHTML = "";
  }
  
  switchView("dashboard");
  renderRoadmap();
  showResumeBannerIfExists();
}

// ==========================================================================
// MOCK EXAMS ENGINE
// ==========================================================================
// Get total exam questions based on level
function getExamLengthForLevel(level) {
  if (["8급", "7급", "6급"].includes(level)) return 30;
  if (["준5급", "5급"].includes(level)) return 40;
  return 50;
}

function startMockExam(examId) {
  let questions = [];
  let title = "";
  
  if (examId === "110" || examId === "111") {
    questions = questionsDb[examId];
    title = `제 ${examId}회 기출문제 (4급 가형)`;
  } else if (examId === "random") {
    let selectedLevel = "4급";
    const levelSelect = document.getElementById("exam-random-level");
    if (levelSelect) {
      selectedLevel = levelSelect.value;
    }
    
    const totalQuestions = getExamLengthForLevel(selectedLevel);
    title = `AI 랜덤 모의고사 (${selectedLevel})`;
    
    // Compile cumulative character pool
    const cumulativePool = [];
    const levelIdx = LEVELS.indexOf(selectedLevel);
    for (let i = 0; i <= levelIdx; i++) {
      const lvlName = LEVELS[i];
      if (wordsDb[lvlName]) {
        cumulativePool.push(...wordsDb[lvlName]);
      }
    }
    
    if (cumulativePool.length === 0) {
      alert("한자 데이터를 불러올 수 없습니다.");
      return;
    }
    
    // Compile vocabulary pool
    const poolCharSet = new Set(cumulativePool.map(c => c.char));
    const vocabularyPool = vocabularyDb.filter(v => {
      for (let char of v.word) {
        if (!poolCharSet.has(char)) return false;
      }
      return true;
    });
    
    // Generate questions dynamically
    for (let qNum = 1; qNum <= totalQuestions; qNum++) {
      let type = Math.floor(Math.random() * 2); // 0 or 1
      if (vocabularyPool.length > 0 && Math.random() > 0.4) {
        type = 2 + Math.floor(Math.random() * 2); // 2 or 3
      }
      
      let question = null;
      if (type === 0) {
        // Hanja -> Hunum
        const charObj = getRandomElement(cumulativePool);
        const correctHunum = charObj.full_hunum;
        const allHunumPool = cumulativePool.map(c => c.full_hunum);
        const distractors = getDistractors(correctHunum, allHunumPool, 3);
        const choices = shuffleArray([correctHunum, ...distractors]);
        const answerIndex = choices.indexOf(correctHunum);
        
        const explanationParts = [];
        distractors.forEach(dh => {
          const found = cumulativePool.find(c => c.full_hunum === dh);
          if (found) {
            explanationParts.push(`${found.char}(${dh})`);
          }
        });
        const explanation = explanationParts.length > 0 ? `◎${explanationParts.join(", ")}.` : "";
        
        question = {
          number: qNum,
          stem: charObj.char,
          answer_index: answerIndex,
          choices: choices,
          explanation: explanation
        };
      } else if (type === 1) {
        // Hunum -> Hanja
        const charObj = getRandomElement(cumulativePool);
        const correctChar = charObj.char;
        const allCharPool = cumulativePool.map(c => c.char);
        const distractors = getDistractors(correctChar, allCharPool, 3);
        const choices = shuffleArray([correctChar, ...distractors]);
        const answerIndex = choices.indexOf(correctChar);
        
        const explanationParts = [];
        choices.forEach(ch => {
          const found = cumulativePool.find(c => c.char === ch);
          if (found) {
            explanationParts.push(`${found.char}(${found.full_hunum})`);
          }
        });
        const explanation = explanationParts.length > 0 ? `◎${explanationParts.join(", ")}.` : "";
        
        question = {
          number: qNum,
          stem: charObj.full_hunum,
          answer_index: answerIndex,
          choices: choices,
          explanation: explanation
        };
      } else if (type === 2) {
        // Word -> Reading
        const wordObj = getRandomElement(vocabularyPool);
        const correctReading = wordObj.reading;
        const allReadings = vocabularyDb.map(v => v.reading);
        const distractors = getDistractors(correctReading, allReadings, 3);
        const choices = shuffleArray([correctReading, ...distractors]);
        const answerIndex = choices.indexOf(correctReading);
        
        question = {
          number: qNum,
          stem: wordObj.word,
          answer_index: answerIndex,
          choices: choices,
          explanation: `◎${wordObj.word}: ${wordObj.reading} (${wordObj.meaning})`
        };
      } else {
        // Meaning -> Word
        const wordObj = getRandomElement(vocabularyPool);
        const correctWord = wordObj.word;
        const allWords = vocabularyDb.map(v => v.word);
        const distractors = getDistractors(correctWord, allWords, 3);
        const choices = shuffleArray([correctWord, ...distractors]);
        const answerIndex = choices.indexOf(correctWord);
        
        question = {
          number: qNum,
          stem: wordObj.meaning,
          answer_index: answerIndex,
          choices: choices,
          explanation: `◎${wordObj.word}: ${wordObj.reading} (${wordObj.meaning})`
        };
      }
      questions.push(question);
    }
  }
  
  if (!questions || questions.length === 0) {
    alert("기출문제를 로드하지 못했습니다.");
    return;
  }
  
  // Initialize Active Exam
  activeSession = {
    type: "exam",
    examId: examId,
    examTitle: title,
    questions: questions,
    userAnswers: Array(questions.length).fill(null),
    currentQIndex: 0,
    timeRemaining: 60 * 60, // 60 minutes
    timerInterval: null
  };
  
  // Hide main tabs view and show testing workspace
  document.getElementById("exam-selector-screen").classList.add("hidden");
  document.getElementById("exam-active-screen").classList.remove("hidden");
  document.getElementById("exam-report-screen").classList.add("hidden");
  
  // Update header text
  document.getElementById("active-exam-title").textContent = title;
  
  // Render OMR Sheet panel
  renderOMRSheet();
  
  // Render first question
  renderExamQuestion(0);
  
  // Start countdown timer
  startExamTimer();
}

function startExamTimer() {
  const session = activeSession;
  const timerDiv = document.getElementById("exam-timer");
  
  session.timerInterval = setInterval(() => {
    session.timeRemaining--;
    
    // Formatting time
    const mins = Math.floor(session.timeRemaining / 60);
    const secs = session.timeRemaining % 60;
    timerDiv.innerHTML = `<i class="fa-regular fa-clock"></i> ${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    
    // Warn when time is low
    if (session.timeRemaining <= 5 * 60) {
      timerDiv.style.backgroundColor = "var(--color-danger-light)";
      timerDiv.style.color = "var(--color-danger)";
    }
    
    // Time expired
    if (session.timeRemaining <= 0) {
      clearInterval(session.timerInterval);
      alert("시험 시간이 종료되었습니다! 답안을 자동으로 제출합니다.");
      submitExam();
    }
  }, 1000);
}

function renderOMRSheet() {
  const grid = document.getElementById("omr-grid");
  grid.innerHTML = "";
  
  const total = activeSession.questions.length;
  for (let i = 0; i < total; i++) {
    const cell = document.createElement("div");
    cell.className = "omr-cell";
    cell.textContent = i + 1;
    cell.setAttribute("data-q-idx", i);
    
    cell.addEventListener("click", () => {
      navigateExam(i - activeSession.currentQIndex);
    });
    
    grid.appendChild(cell);
  }
}

function updateOMRHighlight() {
  const session = activeSession;
  const cells = document.querySelectorAll(".omr-cell");
  
  cells.forEach((cell, idx) => {
    cell.classList.remove("current");
    cell.classList.remove("marked");
    
    if (idx === session.currentQIndex) {
      cell.classList.add("current");
    }
    if (session.userAnswers[idx] !== null) {
      cell.classList.add("marked");
    }
  });
}

function renderExamQuestion(idx) {
  const session = activeSession;
  session.currentQIndex = idx;
  
  const q = session.questions[idx];
  const container = document.getElementById("exam-question-card");
  container.innerHTML = "";
  
  // Render OMR highlights
  updateOMRHighlight();
  
  // Title / Instruction
  const title = document.createElement("span");
  title.className = "exam-q-index-tag";
  title.textContent = `문항 ${idx + 1}`;
  container.appendChild(title);
  
  const instruction = document.createElement("div");
  instruction.className = "exam-q-instruction";
  instruction.textContent = getSectionInstruction(q.number);
  container.appendChild(instruction);
  
  // Stem
  const stem = document.createElement("div");
  stem.className = "exam-q-stem";
  stem.innerHTML = parseStemFormatting(q.stem);
  container.appendChild(stem);
  
  // Choices
  const choicesGrid = document.createElement("div");
  choicesGrid.className = "exam-q-choices";
  
  const indexSyms = ["①", "②", "③", "④"];
  q.choices.forEach((choice, choiceIdx) => {
    const btn = document.createElement("button");
    btn.className = "exam-choice-btn";
    btn.innerHTML = `<span class="choice-index">${indexSyms[choiceIdx]}</span> ${choice}`;
    
    if (session.userAnswers[idx] === choiceIdx) {
      btn.classList.add("marked");
    }
    
    btn.addEventListener("click", () => {
      session.userAnswers[idx] = choiceIdx;
      
      // Update styling
      document.querySelectorAll(".exam-choice-btn").forEach(b => b.classList.remove("marked"));
      btn.classList.add("marked");
      
      updateOMRHighlight();
    });
    
    choicesGrid.appendChild(btn);
  });
  container.appendChild(choicesGrid);
  
  // Update pagination text
  document.getElementById("exam-pagination-text").textContent = `문항 ${idx + 1} / ${session.questions.length}`;
}

function navigateExam(direction) {
  const session = activeSession;
  const newIndex = session.currentQIndex + direction;
  
  if (newIndex >= 0 && newIndex < session.questions.length) {
    renderExamQuestion(newIndex);
  }
}

// Get Korean instruction text based on question number for 4급 가형
function getSectionInstruction(num) {
  if (1 <= num && num <= 8) {
    return "※ 한자의 훈음(뜻과 소리)으로 가장 알맞은 것을 고르시오.";
  } else if (9 <= num && num <= 15) {
    return "※ 훈음에 알맞은 올바른 한자를 고르시오.";
  } else if (16 <= num && num <= 22) {
    return "※ 질문을 읽고 물음에 가장 알맞은 답을 고르시오.";
  } else if (23 <= num && num <= 31) {
    return "※ 한자어 어휘의 독음(읽기)이 올바른 것을 고르시오.";
  } else if (32 <= num && num <= 34) {
    return "※ 한자어 어휘의 올바른 한국어 정의(뜻)를 고르시오.";
  } else if (35 <= num && num <= 37) {
    return "※ 어휘 설명에 해당하는 낱말을 한자로 바르게 쓴 것을 고르시오.";
  } else if (38 <= num && num <= 41) {
    return "※ 밑줄 친 한자어 어휘의 문맥상 알맞은 독음을 고르시오.";
  } else if (42 <= num && num <= 44) {
    return "※ 문장에서 밑줄 친 부분의 한국어 어휘를 한자로 바르게 쓴 것을 고르시오.";
  } else {
    return "※ 한자 성어 및 어휘 지식과 관련하여 질문에 가장 알맞은 것을 고르시오.";
  }
}

// If stem has underlines or bold marks, format it
function parseStemFormatting(stem) {
  // Check for capitalized word or underlined word or letters enclosed in single quotes
  // e.g. '惡' or 週末
  let formatted = stem;
  
  // Replace words in single quotes like '惡' with underline spans
  formatted = formatted.replace(/‘([^’]+)’/g, `<span class="underline">$1</span>`);
  
  return formatted;
}

// Submit and grade exam
function submitExam() {
  const session = activeSession;
  
  // Count unanswered
  const unansweredCount = session.userAnswers.filter(ans => ans === null).length;
  if (unansweredCount > 0) {
    if (!confirm(`아직 풀지 않은 문제가 ${unansweredCount}개 있습니다. 그래도 제출하시겠습니까?`)) {
      return;
    }
  }
  
  // Stop timer
  clearInterval(session.timerInterval);
  
  let score = 0;
  const timeTakenSec = (60 * 60) - session.timeRemaining;
  
  // Review grid container
  const reviewList = document.getElementById("exam-review-list");
  reviewList.innerHTML = "";
  
  const indexSyms = ["①", "②", "③", "④"];
  
  session.questions.forEach((q, idx) => {
    const userChoiceIdx = session.userAnswers[idx];
    const isCorrect = (userChoiceIdx === q.answer_index);
    
    if (isCorrect) score++;
    
    // Add wrong character to review state if incorrect
    if (!isCorrect) {
      // Find Hanja character in the question stem
      for (let char of q.stem) {
        if (isHanjaCode(char.charCodeAt(0)) && !userState.wrongQuestions.includes(char)) {
          userState.wrongQuestions.push(char);
        }
      }
    }
    
    // Create card element for report review
    const card = document.createElement("div");
    card.className = `review-item-card ${isCorrect ? 'correct' : 'wrong'}`;
    
    const header = document.createElement("div");
    header.className = "review-item-header";
    header.innerHTML = `
      <span>문항 ${idx + 1}</span>
      <span class="review-status-tag ${isCorrect ? 'correct' : 'wrong'}">
        <i class="fa-solid ${isCorrect ? 'fa-circle-check' : 'fa-circle-xmark'}"></i>
        ${isCorrect ? '정답' : '오답'}
      </span>
    `;
    card.appendChild(header);
    
    const qStem = document.createElement("div");
    qStem.className = "review-q-stem";
    qStem.innerHTML = `${parseStemFormatting(q.stem)}`;
    card.appendChild(qStem);
    
    // Choices block
    const choicesBlock = document.createElement("div");
    choicesBlock.className = "review-choices-summary";
    
    q.choices.forEach((choice, choiceIdx) => {
      const item = document.createElement("div");
      item.className = "review-choice-item";
      item.textContent = `${indexSyms[choiceIdx]} ${choice}`;
      
      // Styling correct/user choice
      if (choiceIdx === q.answer_index) {
        item.classList.add("correct");
      }
      if (choiceIdx === userChoiceIdx && !isCorrect) {
        item.classList.add("user-wrong");
      }
      
      choicesBlock.appendChild(item);
    });
    card.appendChild(choicesBlock);
    
    // Explanation
    if (q.explanation) {
      const exp = document.createElement("div");
      exp.className = "review-explanation";
      exp.innerHTML = `<strong>정답 해설:</strong> ${q.explanation}`;
      card.appendChild(exp);
    }
    
    reviewList.appendChild(card);
  });
  
  // Award XP for taking exam: 25 XP for taking, plus bonus 25 XP if pass
  const percentage = Math.round((score / session.questions.length) * 100);
  const isPassed = percentage >= 70; // 70% is pass
  let xpReward = 20;
  if (isPassed) xpReward += 20;
  
  userState.xp += xpReward;
  userState.todayXp += xpReward;
  
  // Update last active date & streak
  const today = new Date().toDateString();
  const lastActive = userState.lastActiveDate ? new Date(userState.lastActiveDate).toDateString() : "";
  if (today !== lastActive) {
    userState.streak++;
  }
  userState.lastActiveDate = new Date().toISOString();
  
  saveUserState();
  updateStatsHeader();
  
  // Hide active screen & show report screen
  document.getElementById("exam-active-screen").classList.add("hidden");
  document.getElementById("exam-report-screen").classList.remove("hidden");
  
  // Populate score info
  document.getElementById("report-title").textContent = session.examTitle;
  document.getElementById("report-score-val").textContent = `${score} / ${session.questions.length}`;
  
  document.getElementById("report-score-percent").textContent = `${percentage}%`;
  
  const passBadge = document.getElementById("report-pass-badge");
  if (isPassed) {
    passBadge.textContent = "합격 (기준 70% 통과)";
    passBadge.className = "report-badge pass";
    confetti({ particleCount: 150, spread: 80, origin: { y: 0.6 } });
  } else {
    passBadge.textContent = "불합격 (기준 70% 미달)";
    passBadge.className = "report-badge fail";
  }
  
  // Format elapsed time
  const elapsedMins = Math.floor(timeTakenSec / 60);
  const elapsedSecs = timeTakenSec % 60;
  document.getElementById("report-time-taken").textContent = `${elapsedMins}분 ${elapsedSecs}초`;
  document.getElementById("report-correct-count").textContent = score;
  document.getElementById("report-wrong-count").textContent = session.questions.length - score;
  
  // Clear session
  activeSession = null;
}

function renderReviewTab() {
  const grid = document.getElementById("wrong-words-grid");
  const emptyState = document.getElementById("wrong-words-empty");
  const managementBar = document.getElementById("review-management-bar");
  
  grid.innerHTML = "";
  
  const quizWrong = userState.wrongQuestions || [];
  const cardWrong = userState.unmemorizedCards || [];
  const allUnique = [...new Set([...quizWrong, ...cardWrong])];
  
  // Reset management bar selection elements
  const selectAllCb = document.getElementById("review-select-all-cb");
  selectAllCb.checked = false;
  selectAllCb.indeterminate = false;
  
  const deleteSelectedBtn = document.getElementById("delete-selected-btn");
  deleteSelectedBtn.setAttribute("disabled", "true");
  deleteSelectedBtn.innerHTML = `<i class="fa-solid fa-trash"></i> 선택 삭제`;
  
  // Disable/enable respective review buttons based on count
  const quizBtn = document.getElementById("start-quiz-review-btn");
  const cardBtn = document.getElementById("start-card-review-btn");
  
  if (quizWrong.length === 0) {
    quizBtn.setAttribute("disabled", "true");
  } else {
    quizBtn.removeAttribute("disabled");
  }
  
  if (cardWrong.length === 0) {
    cardBtn.setAttribute("disabled", "true");
  } else {
    cardBtn.removeAttribute("disabled");
  }
  
  // Update filter count numbers
  document.getElementById("count-all").textContent = allUnique.length;
  document.getElementById("count-quiz").textContent = quizWrong.length;
  document.getElementById("count-card").textContent = cardWrong.length;
  
  let displayChars = [];
  if (currentReviewFilter === "quiz") {
    displayChars = quizWrong;
  } else if (currentReviewFilter === "card") {
    displayChars = cardWrong;
  } else {
    displayChars = allUnique;
  }
  
  // Show review resume banner if it exists
  showResumeBannerIfExists();
  
  if (displayChars.length === 0) {
    grid.classList.add("hidden");
    emptyState.classList.remove("hidden");
    managementBar.classList.add("hidden");
    return;
  }
  
  grid.classList.remove("hidden");
  emptyState.classList.add("hidden");
  managementBar.classList.remove("hidden");
  
  // Reconstruct characters 훈음 details
  const flatHanjaMap = {};
  LEVELS.forEach(lvl => {
    if (wordsDb[lvl]) {
      wordsDb[lvl].forEach(c => {
        flatHanjaMap[c.char] = c;
      });
    }
  });
  
  displayChars.forEach(char => {
    const cObj = flatHanjaMap[char] || { char: char, full_hunum: "미상 훈음", meaning: "미상" };
    
    const card = document.createElement("div");
    card.className = "wrong-card";
    card.setAttribute("data-char", char);
    
    // Add badges to show where the mistake came from if in "all" view
    let badgeHtml = "";
    if (currentReviewFilter === "all") {
      const isQuiz = quizWrong.includes(char);
      const isCard = cardWrong.includes(char);
      if (isQuiz && isCard) {
        badgeHtml = `<div class="card-origin-badges"><span class="origin-badge quiz">퀴즈</span><span class="origin-badge card-study">카드</span></div>`;
      } else if (isQuiz) {
        badgeHtml = `<div class="card-origin-badges"><span class="origin-badge quiz">퀴즈</span></div>`;
      } else if (isCard) {
        badgeHtml = `<div class="card-origin-badges"><span class="origin-badge card-study">카드</span></div>`;
      }
    }
    
    card.innerHTML = `
      <input type="checkbox" class="card-select-cb" data-char="${char}">
      ${badgeHtml}
      <div class="char">${cObj.char}</div>
      <div class="hunum">${cObj.full_hunum}</div>
      <button class="remove-btn" title="완벽히 암기함 (삭제)"><i class="fa-solid fa-trash-can"></i></button>
    `;
    
    // Bind select checkbox action
    card.querySelector(".card-select-cb").addEventListener("change", updateSelectionState);
    
    // Remove from wrong list click
    card.querySelector(".remove-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      removeWrongCharacter(char);
    });
    
    grid.appendChild(card);
  });
}

function removeWrongCharacter(char) {
  userState.wrongQuestions = (userState.wrongQuestions || []).filter(c => c !== char);
  userState.unmemorizedCards = (userState.unmemorizedCards || []).filter(c => c !== char);
  saveUserState();
  renderReviewTab();
}

function startWrongReviewSession(type) {
  const quizWrong = userState.wrongQuestions || [];
  const cardWrong = userState.unmemorizedCards || [];
  
  let targetChars = [];
  if (type === "quiz") {
    targetChars = quizWrong;
  } else if (type === "card") {
    targetChars = cardWrong;
  }
  
  if (targetChars.length === 0) return;
  
  // check if there's already a saved review session
  const saved = localStorage.getItem("hanja_saved_review_session");
  if (saved) {
    try {
      const session = JSON.parse(saved);
      const typeText = session.sessionType === "flashcard" ? "카드 복습" : "퀴즈 복습";
      if (session.sessionType === (type === "card" ? "flashcard" : "quiz")) {
        if (confirm(`이전에 진행하던 오답 복습 (${typeText}) 기록이 있습니다. 이어서 하시겠습니까?\n(아니오를 누르면 새로 시작합니다)`)) {
          resumeSavedSession("review");
          return;
        }
      } else {
        if (!confirm(`이전에 진행 중이던 오답 복습 (${typeText}) 학습 기록이 지워집니다. 계속하시겠습니까?`)) {
          return;
        }
        clearActiveSessionProgress("review");
      }
    } catch (e) {
      console.error("Error checking saved review session:", e);
    }
  }

  // Flat map for looking up character readings
  const flatHanjaMap = {};
  LEVELS.forEach(lvl => {
    if (wordsDb[lvl]) {
      wordsDb[lvl].forEach(c => {
        flatHanjaMap[c.char] = c;
      });
    }
  });
  
  // Build session questions
  let sessionQuestions = [];
  
  if (type === "card") {
    // Flashcard review studies all unmemorized cards
    const shuffled = shuffleArray([...targetChars]);
    sessionQuestions = shuffled.map(char => {
      const c = flatHanjaMap[char] || { char: char, meaning: "미상", reading: "미상", full_hunum: "미상 훈음" };
      return {
        char: c.char,
        meaning: c.meaning,
        reading: c.reading,
        full_hunum: c.full_hunum,
        levelId: "오답 카드 복습"
      };
    });
  } else {
    // Quiz review: Limit to maximum 10 questions
    const countToAsk = Math.min(targetChars.length, 10);
    const selectedChars = shuffleArray([...targetChars]).slice(0, countToAsk);
    
    selectedChars.forEach(char => {
      const charObj = flatHanjaMap[char] || { char: char, full_hunum: "미상", meaning: "미상" };
      const qType = Math.random() > 0.5 ? 0 : 1;
      let question = null;
      
      if (qType === 0) {
        const allHunumPool = Object.values(flatHanjaMap).map(c => c.full_hunum);
        const distractors = getDistractors(charObj.full_hunum, allHunumPool, 3);
        question = {
          type: "char_to_hunum",
          prompt: charObj.char,
          correctAnswer: charObj.full_hunum,
          choices: shuffleArray([charObj.full_hunum, ...distractors]),
          instruction: "오답 집중 학습: 다음 한자의 올바른 훈음(뜻과 음)을 고르시오.",
          char: charObj.char,
          meaning: charObj.full_hunum
        };
      } else {
        const allCharPool = Object.values(flatHanjaMap).map(c => c.char);
        const distractors = getDistractors(charObj.char, allCharPool, 3);
        question = {
          type: "hunum_to_char",
          prompt: charObj.full_hunum,
          correctAnswer: charObj.char,
          choices: shuffleArray([charObj.char, ...distractors]),
          instruction: "오답 집중 학습: 다음 훈음에 알맞은 올바른 한자를 고르시오.",
          char: charObj.char,
          meaning: charObj.full_hunum
        };
      }
      
      sessionQuestions.push(question);
    });
  }
  
  activeSession = {
    type: "study",
    sessionType: type === "card" ? "flashcard" : "quiz",
    levelId: type === "card" ? "오답 카드 복습" : "오답 퀴즈 복습",
    questions: sessionQuestions,
    currentIndex: 0,
    hearts: 5,
    failedQuestions: [],
    selectedChoice: null
  };
  
  switchView("session");
  
  const quizWorkspace = document.getElementById("quiz-workspace");
  const flashcardWorkspace = document.getElementById("flashcard-workspace");
  const sessionFooter = document.getElementById("session-footer");
  const heartsContainer = document.getElementById("session-hearts-container");
  
  if (activeSession.sessionType === "flashcard") {
    quizWorkspace.classList.add("hidden");
    flashcardWorkspace.classList.remove("hidden");
    sessionFooter.classList.add("hidden");
    heartsContainer.classList.add("hidden");
  } else {
    quizWorkspace.classList.remove("hidden");
    flashcardWorkspace.classList.add("hidden");
    sessionFooter.classList.remove("hidden");
    heartsContainer.classList.remove("hidden");
    updateHeartsUI();
  }
  
  renderNextStudyQuestion();
}

// ==========================================================================
// SESSION RESUME ENGINE
// ==========================================================================
function saveActiveSessionProgress() {
  if (activeSession && activeSession.type === "study") {
    if (activeSession.levelId.includes("오답")) {
      localStorage.setItem("hanja_saved_review_session", JSON.stringify(activeSession));
    } else {
      let savedSessions = [];
      try {
        savedSessions = JSON.parse(localStorage.getItem("hanja_saved_study_sessions") || "[]");
      } catch (e) {}
      
      const existingIdx = savedSessions.findIndex(s => {
        const sRange = s.selectedSetRange;
        const activeRange = activeSession.selectedSetRange;
        const sameRange = (!sRange && !activeRange) || 
                         (sRange && activeRange && sRange.start === activeRange.start && sRange.end === activeRange.end);
        return s.levelId === activeSession.levelId && s.sessionType === activeSession.sessionType && sameRange;
      });
      if (existingIdx !== -1) {
        savedSessions[existingIdx] = activeSession;
      } else {
        savedSessions.push(activeSession);
        if (savedSessions.length > 3) {
          savedSessions.shift();
        }
      }
      localStorage.setItem("hanja_saved_study_sessions", JSON.stringify(savedSessions));
    }
  }
}

function clearActiveSessionProgress(type) {
  if (type === "review") {
    localStorage.removeItem("hanja_saved_review_session");
  } else if (type === "study") {
    if (activeSession && activeSession.type === "study") {
      let savedSessions = [];
      try {
        savedSessions = JSON.parse(localStorage.getItem("hanja_saved_study_sessions") || "[]");
      } catch (e) {}
      
      savedSessions = savedSessions.filter(s => {
        const sRange = s.selectedSetRange;
        const activeRange = activeSession.selectedSetRange;
        const sameRange = (!sRange && !activeRange) || 
                         (sRange && activeRange && sRange.start === activeRange.start && sRange.end === activeRange.end);
        return !(s.levelId === activeSession.levelId && s.sessionType === activeSession.sessionType && sameRange);
      });
      localStorage.setItem("hanja_saved_study_sessions", JSON.stringify(savedSessions));
    }
  } else {
    localStorage.removeItem("hanja_saved_study_sessions");
    localStorage.removeItem("hanja_saved_review_session");
  }
}

function showResumeBannerIfExists() {
  // 1. Study sessions resume banners
  const bannersContainer = document.getElementById("resume-banners-container");
  if (bannersContainer) {
    bannersContainer.innerHTML = "";
    let savedSessions = [];
    try {
      savedSessions = JSON.parse(localStorage.getItem("hanja_saved_study_sessions") || "[]");
    } catch (e) {}
    
    savedSessions.forEach((session, sIdx) => {
      const banner = document.createElement("div");
      banner.className = "resume-banner";
      
      const levelId = session.levelId;
      const typeText = session.sessionType === "flashcard" ? "카드 학습" : "퀴즈 풀기";
      const progressText = `${session.currentIndex + 1} / ${session.questions.length}`;
      
      let setText = "";
      if (session.selectedSetRange) {
        const setSize = getCardSetSizeForLevel(session.levelId);
        const setIdx = Math.floor(session.selectedSetRange.start / setSize) + 1;
        setText = ` (세트 ${setIdx})`;
      }
      
      banner.innerHTML = `
        <div class="resume-info">
          <i class="fa-solid fa-clock-rotate-left"></i>
          <span>이전 학습 이어하기: <strong>${levelId} ${typeText}${setText} (${progressText})</strong></span>
        </div>
        <div class="resume-actions">
          <button class="btn btn-primary btn-sm resume-study-btn" data-index="${sIdx}">이어서 하기</button>
          <button class="btn btn-secondary btn-sm dismiss-study-btn" data-index="${sIdx}">새로 시작</button>
        </div>
      `;
      
      banner.querySelector(".resume-study-btn").addEventListener("click", () => {
        resumeSavedSessionByIndex(sIdx);
      });
      banner.querySelector(".dismiss-study-btn").addEventListener("click", () => {
        dismissSavedSessionByIndex(sIdx);
      });
      
      bannersContainer.appendChild(banner);
    });
  }
  
  // 2. Review session resume banner
  const reviewSaved = localStorage.getItem("hanja_saved_review_session");
  const reviewBanner = document.getElementById("resume-review-banner");
  if (reviewBanner) {
    if (reviewSaved) {
      try {
        const session = JSON.parse(reviewSaved);
        const levelId = session.levelId;
        const progressText = `${session.currentIndex + 1} / ${session.questions.length}`;
        
        document.getElementById("resume-review-session-info").innerHTML = `
          <i class="fa-solid fa-clock-rotate-left"></i>
          <span>이전 오답 복습 이어하기: <strong>${levelId} (${progressText})</strong></span>
        `;
        reviewBanner.classList.remove("hidden");
      } catch (e) {
        console.error("Error parsing saved review session:", e);
        reviewBanner.classList.add("hidden");
      }
    } else {
      reviewBanner.classList.add("hidden");
    }
  }
}

function resumeSavedSessionByIndex(index) {
  let savedSessions = [];
  try {
    savedSessions = JSON.parse(localStorage.getItem("hanja_saved_study_sessions") || "[]");
  } catch (e) {}
  
  const session = savedSessions[index];
  if (!session) return;
  
  activeSession = session;
  
  // Resume session view
  switchView("session");
  
  const quizWorkspace = document.getElementById("quiz-workspace");
  const flashcardWorkspace = document.getElementById("flashcard-workspace");
  const sessionFooter = document.getElementById("session-footer");
  const heartsContainer = document.getElementById("session-hearts-container");
  
  if (activeSession.sessionType === "flashcard") {
    quizWorkspace.classList.add("hidden");
    flashcardWorkspace.classList.remove("hidden");
    sessionFooter.classList.add("hidden");
    heartsContainer.classList.add("hidden");
  } else {
    quizWorkspace.classList.remove("hidden");
    flashcardWorkspace.classList.add("hidden");
    sessionFooter.classList.remove("hidden");
    heartsContainer.classList.remove("hidden");
    updateHeartsUI();
  }
  
  const actionBtn = document.getElementById("session-action-btn");
  if (actionBtn) {
    actionBtn.setAttribute("disabled", "true");
    actionBtn.textContent = "정답 확인";
  }
  
  renderNextStudyQuestion();
}

function resumeSavedSessionByLevelTypeAndRange(levelId, sessionType, range) {
  let savedSessions = [];
  try {
    savedSessions = JSON.parse(localStorage.getItem("hanja_saved_study_sessions") || "[]");
  } catch (e) {}
  
  const sIdx = savedSessions.findIndex(s => {
    const sRange = s.selectedSetRange;
    const sameRange = (!sRange && !range) || 
                     (sRange && range && sRange.start === range.start && sRange.end === range.end);
    return s.levelId === levelId && s.sessionType === sessionType && sameRange;
  });
  if (sIdx !== -1) {
    resumeSavedSessionByIndex(sIdx);
  }
}

function dismissSavedSessionByIndex(index) {
  let savedSessions = [];
  try {
    savedSessions = JSON.parse(localStorage.getItem("hanja_saved_study_sessions") || "[]");
  } catch (e) {}
  
  const session = savedSessions[index];
  if (!session) return;
  
  const typeText = session.sessionType === "flashcard" ? "카드 학습" : "퀴즈 풀기";
  if (confirm(`${session.levelId} ${typeText} 진행 기록을 삭제하고 새로 시작하시겠습니까?`)) {
    savedSessions.splice(index, 1);
    localStorage.setItem("hanja_saved_study_sessions", JSON.stringify(savedSessions));
    showResumeBannerIfExists();
  }
}

function resumeSavedSession(type) {
  if (type === "review") {
    const saved = localStorage.getItem("hanja_saved_review_session");
    if (!saved) return;
    
    try {
      activeSession = JSON.parse(saved);
      
      switchView("session");
      
      const quizWorkspace = document.getElementById("quiz-workspace");
      const flashcardWorkspace = document.getElementById("flashcard-workspace");
      const sessionFooter = document.getElementById("session-footer");
      const heartsContainer = document.getElementById("session-hearts-container");
      
      if (activeSession.sessionType === "flashcard") {
        quizWorkspace.classList.add("hidden");
        flashcardWorkspace.classList.remove("hidden");
        sessionFooter.classList.add("hidden");
        heartsContainer.classList.add("hidden");
      } else {
        quizWorkspace.classList.remove("hidden");
        flashcardWorkspace.classList.add("hidden");
        sessionFooter.classList.remove("hidden");
        heartsContainer.classList.remove("hidden");
        updateHeartsUI();
      }
      
      const actionBtn = document.getElementById("session-action-btn");
      if (actionBtn) {
        actionBtn.setAttribute("disabled", "true");
        actionBtn.textContent = "정답 확인";
      }
      
      renderNextStudyQuestion();
    } catch (e) {
      console.error("Error resuming review session:", e);
      alert("복습을 재개하는 도중 오류가 발생했습니다.");
      clearActiveSessionProgress("review");
      showResumeBannerIfExists();
    }
  }
}

function dismissSavedSession(type) {
  if (type === "review") {
    if (confirm("진행 중이던 오답 복습 기록을 삭제하고 새로 시작하시겠습니까?")) {
      clearActiveSessionProgress("review");
      showResumeBannerIfExists();
    }
  }
}

// ==========================================================================
// SELECTION & WRONG CARD MANAGEMENT
// ==========================================================================
function updateSelectionState() {
  const checkboxes = document.querySelectorAll(".card-select-cb");
  const selectAllCb = document.getElementById("review-select-all-cb");
  const deleteSelectedBtn = document.getElementById("delete-selected-btn");
  
  const checkedCount = Array.from(checkboxes).filter(cb => cb.checked).length;
  
  if (checkboxes.length === 0) {
    selectAllCb.checked = false;
    deleteSelectedBtn.setAttribute("disabled", "true");
    return;
  }
  
  selectAllCb.checked = (checkedCount === checkboxes.length);
  selectAllCb.indeterminate = (checkedCount > 0 && checkedCount < checkboxes.length);
  
  if (checkedCount > 0) {
    deleteSelectedBtn.removeAttribute("disabled");
    deleteSelectedBtn.innerHTML = `<i class="fa-solid fa-trash"></i> 선택 삭제 (${checkedCount})`;
  } else {
    deleteSelectedBtn.setAttribute("disabled", "true");
    deleteSelectedBtn.innerHTML = `<i class="fa-solid fa-trash"></i> 선택 삭제`;
  }
}

function deleteSelectedWrongCharacters() {
  const checkedCbs = document.querySelectorAll(".card-select-cb:checked");
  if (checkedCbs.length === 0) return;
  
  if (confirm(`선택한 ${checkedCbs.length}개의 한자를 오답노트에서 삭제하시겠습니까?`)) {
    const charsToRemove = Array.from(checkedCbs).map(cb => cb.getAttribute("data-char"));
    
    userState.wrongQuestions = (userState.wrongQuestions || []).filter(c => !charsToRemove.includes(c));
    userState.unmemorizedCards = (userState.unmemorizedCards || []).filter(c => !charsToRemove.includes(c));
    
    saveUserState();
    renderReviewTab();
  }
}

function deleteAllWrongCharacters() {
  let filterText = "오답노트의 모든";
  if (currentReviewFilter === "quiz") {
    filterText = "퀴즈/시험 오답";
  } else if (currentReviewFilter === "card") {
    filterText = "카드학습 못 외운";
  }
  
  if (confirm(`현재 필터의 모든 한자(${filterText})를 오답노트에서 삭제하시겠습니까?`)) {
    if (currentReviewFilter === "quiz") {
      userState.wrongQuestions = [];
    } else if (currentReviewFilter === "card") {
      userState.unmemorizedCards = [];
    } else {
      userState.wrongQuestions = [];
      userState.unmemorizedCards = [];
    }
    
    saveUserState();
    renderReviewTab();
  }
}

// ==========================================================================
// UTILITY HELPERS
// ==========================================================================
function getRandomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffleArray(arr) {
  const newArr = [...arr];
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
}

// Get unique list of distractors
function getDistractors(correctItem, pool, count) {
  const uniquePool = [...new Set(pool.filter(item => item !== correctItem))];
  const shuffled = shuffleArray(uniquePool);
  return shuffled.slice(0, count);
}

// Check if a codepoint is a standard CJK Hanja character
function isHanjaCode(code) {
  return (0x4e00 <= code && code <= 0x9fff) || (0xf900 <= code && code <= 0xfaff) || (0x3400 <= code && code <= 0x4dbf);
}

// Get card set size for a level (e.g. 30 for 준4급~5급, 100 for 준2급~1급, 50 default)
function getCardSetSizeForLevel(levelId) {
  if (levelId === "5급" || levelId === "준4급") {
    return 30;
  }
  if (levelId === "준2급" || levelId === "2급" || levelId === "준1급" || levelId === "1급") {
    return 100;
  }
  return 50; // Default for 4급, 준3급, 3급
}
