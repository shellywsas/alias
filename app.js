// ================= FIREBASE SETUP =================
const firebaseConfig = {
    apiKey: "AIzaSyAF6l8XxWGylg2Bo66U73CeUn2BgUhtZ88",
    authDomain: "aliasgame-92030.firebaseapp.com",
    databaseURL: "https://aliasgame-92030-default-rtdb.firebaseio.com",
    projectId: "aliasgame-92030",
    storageBucket: "aliasgame-92030.firebasestorage.app",
    messagingSenderId: "249837720587",
    appId: "1:249837720587:web:4d4248871131b0efdba30e"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

let gameMode = ""; 
let myRoomCode = "";
let myTeamName = "";
let myPlayerName = "";
let isHost = false; 
let lastWordShown = "";
let lastActionData = null;

let currentDifficultyLevel = "medium";
let globalWordOrder = [];
let globalWordPointer = 0;

let currentRoundEvent = { type: 'none', teamIndex: -1 }; 
let wordsPlayedThisTurn = 0;
let specialTurnScores = []; // מעקב נקודות בתור גניבה

function showToast(msg) {
    const container = document.getElementById('toastContainer');
    if(!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerText = msg;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}

function generateShuffledWords(difficulty) {
    let baseWords = window.allWords[difficulty] || window.allWords.medium;
    let arr = [...baseWords];
    for(let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function getNextWordAndUpdatePointer() {
    if (!globalWordOrder || globalWordOrder.length === 0) {
        globalWordOrder = generateShuffledWords(currentDifficultyLevel);
    }
    let word = globalWordOrder[globalWordPointer];
    globalWordPointer++;
    if (globalWordPointer >= globalWordOrder.length) {
        globalWordOrder = generateShuffledWords(currentDifficultyLevel);
        globalWordPointer = 0;
        if (gameMode === 'network') {
            db.ref('rooms/' + myRoomCode).update({ wordOrder: globalWordOrder });
        }
    }
    return word;
}

function generateRaffleEvent() {
    const rand = Math.random();
    let type = 'none';
    let teamIndex = -1;
    
    if (rand > 0.6 && rand <= 0.8) {
        type = 'steal_turn';
    } else if (rand > 0.8) {
        type = 'five_words';
    }

    if (type !== 'none') {
        teamIndex = Math.floor(Math.random() * teams.length);
    }
    return { type, teamIndex };
}

// ================= AUDIO SYSTEM =================
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let isMuted = false;

function toggleMute() {
    isMuted = !isMuted;
    document.getElementById('muteToggleBtn').innerText = isMuted ? "🔇" : "🔊";
}
function unlockAudio() {
    if (audioCtx.state === 'suspended') { audioCtx.resume(); }
}
function playSuccessSound() {
    if (isMuted) return;
    unlockAudio();
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime); 
    osc.frequency.exponentialRampToValueAtTime(1108.73, audioCtx.currentTime + 0.1); 
    gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
}
function playTimesUpSound() {
    if (isMuted) return;
    unlockAudio();
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, audioCtx.currentTime); 
    osc.frequency.exponentialRampToValueAtTime(150, audioCtx.currentTime + 0.5); 
    gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.5);
}
function playVictoryMusic() {
    if (isMuted) return;
    unlockAudio();
    const notes = [523.25, 659.25, 783.99, 1046.50]; 
    for (let i = 0; i < 40; i++) {
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        osc.type = 'triangle';
        const octaveMult = (Math.floor(i / 8) % 2 === 0) ? 1 : 0.5;
        osc.frequency.value = notes[i % 4] * octaveMult;
        const noteTime = audioCtx.currentTime + (i * 0.25);
        gainNode.gain.setValueAtTime(0.05, noteTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.2);
        osc.start(noteTime);
        osc.stop(noteTime + 0.2);
    }
}

// ================= KEYBOARD SHORTCUTS =================
document.addEventListener('keydown', function(event) {
    const playScreen = document.getElementById('playScreen');
    if (!playScreen) return;
    const playScreenActive = !playScreen.classList.contains('hidden');
    const myTurn = (gameMode === 'local') || (document.getElementById('actionButtons').style.display !== 'none' || document.getElementById('stealTurnButtons').style.display !== 'none');
    
    if (playScreenActive && !isPaused && myTurn) {
        if (event.code === 'Space') { 
            event.preventDefault(); 
            if(isSpecialTurnModifierActive()) return;
            correctWord();
        } else if (event.key === 'Enter') { 
            event.preventDefault();
            skipWord();
        }
    }
});

function isSpecialTurnModifierActive() {
    return (currentRoundEvent.teamIndex === currentTeamIndex && currentRoundEvent.type !== 'none');
}

// ================= GAME DATA =================
let teams = []; 
let currentTeamIndex = 0;
let targetScore = 30;
let turnDuration = 60;

let turnScore = 0;
let timeLeft = 0;
let timerInterval = null;
let isPaused = false;

const teamColors = ["linear-gradient(90deg, #e63946, #ba1826)", "linear-gradient(90deg, #2b2d42, #1d3557)", "linear-gradient(90deg, #2a9d8f, #21867a)", "linear-gradient(90deg, #6a4c93, #4a3466)"];

const screens = {
    mode: document.getElementById('modeScreen'),
    setup: document.getElementById('setupScreen'),
    chooseTeam: document.getElementById('chooseTeamScreen'),
    lobby: document.getElementById('lobbyScreen'),
    difficulty: document.getElementById('difficultyScreen'),
    raffle: document.getElementById('raffleScreen'),
    board: document.getElementById('boardScreen'),
    play: document.getElementById('playScreen'),
    lastWord: document.getElementById('lastWordScreen'),
    turnSummary: document.getElementById('turnSummaryScreen'),
    winner: document.getElementById('winnerScreen')
};

function showScreen(screenName) {
    Object.values(screens).forEach(s => { if (s) s.classList.add('hidden'); });
    if (screens[screenName]) screens[screenName].classList.remove('hidden');
}

function confirmExit() {
    if(confirm("האם אתה בטוח שאתה רוצה לצאת למסך הראשי? (זה ינתק אותך מהמשחק)")) {
        location.reload();
    }
}

// ================= GAME LOGIC =================
function setMode(mode) {
    gameMode = mode;
    unlockAudio();
    showScreen('setup');

    if (gameMode === 'local') {
        document.getElementById('setupTitle').innerText = "הגדרות משחק (מכשיר אחד)";
        document.getElementById('networkJoinBox').classList.add('hidden');
        document.getElementById('networkDivider').classList.add('hidden');
        document.getElementById('hostCreateTitle').classList.add('hidden');
        document.getElementById('hostNameRow').classList.add('hidden');
        document.getElementById('btnCreateGame').innerText = "צור משחק והתחל";
    } else {
        document.getElementById('setupTitle').innerText = "נחש את המילה ברשת";
        document.getElementById('networkJoinBox').classList.remove('hidden');
        document.getElementById('networkDivider').classList.remove('hidden');
        document.getElementById('hostCreateTitle').classList.remove('hidden');
        document.getElementById('hostNameRow').classList.remove('hidden');
        document.getElementById('btnCreateGame').innerText = "צור חדר (כמנהל)";
    }
}

function initGame() {
    unlockAudio(); 
    const t1 = document.getElementById('team1Input').value.trim();
    const t2 = document.getElementById('team2Input').value.trim();
    const t3 = document.getElementById('team3Input').value.trim();
    const t4 = document.getElementById('team4Input').value.trim();

    if (!t1 || !t2) return alert("חייבים למלא לפחות את קבוצה 1 וקבוצה 2!");

    const inputNames = [t1, t2];
    if (t3) inputNames.push(t3);
    if (t4) inputNames.push(t4);

    let newTeams = [];
    let initialOrder = generateShuffledWords('medium');
    globalWordOrder = initialOrder;
    globalWordPointer = 0;
    
    if (gameMode === 'local') {
        for (let i = 0; i < inputNames.length; i++) {
            newTeams.push({ name: inputNames[i], score: 0, color: teamColors[i], players: [], currentDescriberIndex: 0 });
        }
        teams = newTeams;
        turnDuration = parseInt(document.getElementById('turnTimeInput').value) || 60;
        targetScore = parseInt(document.getElementById('winScoreInput').value) || 30;
        document.getElementById('goalDisplay').innerText = targetScore;
        showScreen('difficulty'); 
    } else {
        myPlayerName = document.getElementById('hostNameInput').value.trim();
        if(!myPlayerName) return alert("חובה להכניס את שם המנהל!");

        for (let i = 0; i < inputNames.length; i++) {
            newTeams.push({ name: inputNames[i], score: 0, color: teamColors[i], players: i === 0 ? [myPlayerName] : [], currentDescriberIndex: 0 });
        }
        myTeamName = newTeams[0].name; 
        isHost = true;
        myRoomCode = Math.floor(1000 + Math.random() * 9000).toString();

        const btn = document.getElementById('btnCreateGame');
        btn.innerText = "טוען...";

        db.ref('rooms/' + myRoomCode).set({
            teams: newTeams,
            targetScore: parseInt(document.getElementById('winScoreInput').value) || 30,
            turnDuration: parseInt(document.getElementById('turnTimeInput').value) || 60,
            currentTeamIndex: 0,
            turnScore: 0,
            timeLeft: parseInt(document.getElementById('turnTimeInput').value) || 60,
            currentWord: 'מוכנים?',
            screen: 'lobby',
            isPaused: false,
            winnerName: '',
            difficulty: 'medium',
            wordPointer: 0,
            roundEvent: { type: 'none', teamIndex: -1 },
            specialTurnScores: new Array(newTeams.length).fill(0)
        }).then(() => {
            btn.innerText = "צור חדר (כמנהל)";
            listenToRoom();
        }).catch(err => {
            btn.innerText = "צור חדר (כמנהל)";
            alert("שגיאה! נראה שפיירבייס חוסם אותך.\nהשגיאה: " + err.message);
        });
    }
}

function joinRoom() {
    unlockAudio();
    myPlayerName = document.getElementById('joinPlayerName').value.trim();
    const pendingCode = document.getElementById('joinCodeInput').value.trim();

    if (!myPlayerName || !pendingCode) return alert("אנא הכנס קוד חדר ואת השם שלך!");
    document.getElementById('joinBtn').innerText = "מחפש חדר...";

    db.ref('rooms/' + pendingCode).once('value').then(snap => {
        document.getElementById('joinBtn').innerText = "חפש חדר";
        if (!snap.exists()) return alert("חדר זה לא קיים או שהקוד שגוי!");
        
        const data = snap.val();
        pendingRoomCode = pendingCode;
        
        document.getElementById('welcomeMsg').innerText = `היי ${myPlayerName},`;
        const select = document.getElementById('teamSelectDropdown');
        select.innerHTML = '';
        
        (data.teams || []).forEach((t, i) => {
            const count = t.players ? t.players.length : 0;
            select.innerHTML += `<option value="${i}">${t.name} (${count} שחקנים)</option>`;
        });
        showScreen('chooseTeam');
    }).catch(err => {
        document.getElementById('joinBtn').innerText = "חפש חדר";
        alert("שגיאה בהתחברות: " + err.message);
    });
}

function confirmTeamJoin() {
    const teamIdx = document.getElementById('teamSelectDropdown').value;
    myRoomCode = pendingRoomCode;
    
    document.getElementById('confirmJoinBtn').innerText = "מצטרף...";

    db.ref('rooms/' + myRoomCode).once('value').then(snap => {
        let data = snap.val();
        let teams = data.teams;
        
        if (!teams[teamIdx].players) teams[teamIdx].players = [];
        teams[teamIdx].players.push(myPlayerName);
        myTeamName = teams[teamIdx].name;
        
        return db.ref('rooms/' + myRoomCode).update({ teams: teams });
    }).then(() => {
        document.getElementById('confirmJoinBtn').innerText = "הצטרף לקבוצה!";
        listenToRoom();
    }).catch(err => {
        document.getElementById('confirmJoinBtn').innerText = "הצטרף לקבוצה!";
        alert("שגיאה בהצטרפות: " + err.message);
    });
}

function setDifficulty(diff) {
    currentDifficultyLevel = diff;
    const evt = generateRaffleEvent();
    currentRoundEvent = evt;

    if (gameMode === 'local') {
        globalWordOrder = generateShuffledWords(diff);
        globalWordPointer = 0;
        updateRaffleScreenUI();
        document.getElementById('btnContinueFromRaffle').classList.remove('hidden');
        document.getElementById('waitHostRaffleMsg').classList.add('hidden');
        showScreen('raffle');
    } else {
        const newOrder = generateShuffledWords(diff);
        db.ref('rooms/' + myRoomCode).update({
            difficulty: diff,
            wordOrder: newOrder,
            wordPointer: 0,
            roundEvent: evt,
            screen: 'raffle'
        });
    }
}

function updateRaffleScreenUI() {
    const title = document.getElementById('raffleTitle');
    const desc = document.getElementById('raffleDesc');
    
    if (currentRoundEvent.type === 'none') {
        title.innerText = "הכל רגיל!";
        title.style.color = "var(--success)";
        desc.innerText = "אין אירועים מיוחדים בסיבוב הזה. שחקו כרגיל!";
    } else if (currentRoundEvent.type === 'steal_turn') {
        const tName = teams[currentRoundEvent.teamIndex].name;
        title.innerText = "🚨 תור גניבה! 🚨";
        title.style.color = "var(--danger)";
        desc.innerText = `בתור הבא של קבוצת '${tName}', כולם יכולים לנחש את המילים!`;
    } else if (currentRoundEvent.type === 'five_words') {
        const tName = teams[currentRoundEvent.teamIndex].name;
        title.innerText = "✋ 5 מילים (ללא זמן) ✋";
        title.style.color = "var(--warning)";
        desc.innerText = `בתור הבא של קבוצת '${tName}', הטיימר מבוטל ויש להם רק 5 מילים (שכולם מנחשים)!`;
    }
}

function continueToBoard() {
    if (gameMode === 'local') {
        updateBoard();
        showScreen('board');
    } else {
        db.ref('rooms/' + myRoomCode).update({ screen: 'board' });
    }
}

function updateSpecialScoresUI() {
    const container = document.getElementById('specialTurnScoresContainer');
    if (!isSpecialTurnModifierActive()) {
        container.classList.add('hidden');
        return;
    }
    container.classList.remove('hidden');
    let html = 'חלוקת נקודות בתור זה: ';
    let hasPoints = false;
    teams.forEach((t, i) => {
        if (specialTurnScores && specialTurnScores[i] > 0) {
            html += `<span style="color: ${t.color !== 'transparent' ? 'var(--primary)' : 'inherit'}; margin: 0 8px;">${t.name} (${specialTurnScores[i]})</span>`;
            hasPoints = true;
        }
    });
    if (!hasPoints) html += "<span style='font-weight:normal;'>עדיין אין ניחושים...</span>";
    container.innerHTML = html;
}

function listenToRoom() {
    if (!isHost) {
        document.getElementById('btnStartFromLobby').classList.add('hidden');
        document.getElementById('waitHostLobbyMsg').classList.remove('hidden');
        document.getElementById('btnContinueFromRaffle').classList.add('hidden');
        document.getElementById('waitHostRaffleMsg').classList.remove('hidden');
    } else {
        document.getElementById('btnStartFromLobby').classList.remove('hidden');
        document.getElementById('btnContinueFromRaffle').classList.remove('hidden');
        document.getElementById('waitHostRaffleMsg').classList.add('hidden');
    }

    db.ref('rooms/' + myRoomCode).on('value', snap => {
        if (!snap.exists()) return;
        const data = snap.val();

        const currentPlayersCount = (data.teams || []).reduce((sum, t) => sum + (t.players ? t.players.length : 0), 0);
        if (window.lastPlayersCount !== undefined && currentPlayersCount > window.lastPlayersCount && data.screen !== 'chooseTeam') {
            showToast("שחקן חדש הצטרף למשחק! 👋");
        }
        window.lastPlayersCount = currentPlayersCount;

        teams = data.teams || [];
        targetScore = data.targetScore;
        turnDuration = data.turnDuration;
        currentTeamIndex = data.currentTeamIndex;
        turnScore = data.turnScore;
        timeLeft = data.timeLeft;
        isPaused = data.isPaused;
        lastActionData = data.lastAction || null; 
        
        if (data.specialTurnScores) specialTurnScores = data.specialTurnScores;
        else specialTurnScores = new Array(teams.length).fill(0);

        if (data.difficulty) currentDifficultyLevel = data.difficulty;
        if (data.wordOrder) globalWordOrder = data.wordOrder;
        if (data.wordPointer !== undefined) globalWordPointer = data.wordPointer;
        if (data.roundEvent) currentRoundEvent = data.roundEvent;

        document.getElementById('lobbyRoomCode').innerText = myRoomCode;
        document.getElementById('roomCodeDisplay').innerText = myRoomCode;
        document.getElementById('boardRoomCodeContainer').classList.remove('hidden');
        document.getElementById('goalDisplay').innerText = targetScore;
        document.getElementById('scoreDisplay').innerText = turnScore;
        document.getElementById('timeDisplay').innerText = timeLeft;
        
        if (data.screen === 'lobby') {
            const ul = document.getElementById('lobbyTeamsList');
            ul.innerHTML = '';
            teams.forEach(t => {
                const playersStr = t.players && t.players.length > 0 ? t.players.join(', ') : "אין שחקנים עדיין";
                ul.innerHTML += `<li>${t.name} <span style="font-size:0.8em; color:#666; font-weight:normal; display:block;">(${playersStr})</span></li>`;
            });
        }

        if (data.screen === 'difficulty') {
            if (isHost) {
                document.getElementById('difficultyControls').classList.remove('hidden');
                document.getElementById('difficultyWaitMsg').classList.add('hidden');
            } else {
                document.getElementById('difficultyControls').classList.add('hidden');
                document.getElementById('difficultyWaitMsg').classList.remove('hidden');
            }
        }

        if (data.screen === 'raffle') {
            updateRaffleScreenUI();
        }
        
        const activeTeam = teams[currentTeamIndex];
        let activePlayerName = "";
        if (activeTeam && activeTeam.players && activeTeam.players.length > 0) {
            const describerIdx = activeTeam.currentDescriberIndex || 0;
            activePlayerName = activeTeam.players[describerIdx];
        }

        let turnAnnounceText = activeTeam ? activeTeam.name : "";
        if (gameMode === 'network' && activePlayerName) {
            turnAnnounceText += " (מסביר/ה: " + activePlayerName + ")";
        }
        document.getElementById('nextTeamDisplay').innerText = turnAnnounceText;
        
        if (activeTeam) {
            document.getElementById('playingTeamName').innerText = "משחקים עכשיו: " + activeTeam.name + (activePlayerName && gameMode === 'network' ? " (מסביר: " + activePlayerName + ")" : "");
        }

        const isMyTurnToDescribe = (gameMode === 'local') || (myTeamName === activeTeam?.name && myPlayerName === activePlayerName);

        if (data.screen === 'board') {
            if (isMyTurnToDescribe) {
                document.getElementById('btnStartTurn').classList.remove('hidden');
                document.getElementById('waitHostMsg').classList.add('hidden');
            } else {
                document.getElementById('btnStartTurn').classList.add('hidden');
                document.getElementById('waitHostMsg').innerText = "ממתינים ש-" + activePlayerName + " יתחיל את התור...";
                document.getElementById('waitHostMsg').classList.remove('hidden');
            }
        }

        if (data.screen === 'lastWord') {
            if (isMyTurnToDescribe) {
                document.getElementById('lastWordDisplay').innerText = data.currentWord;
                document.getElementById('lastWordDisplay').style.display = 'flex'; 
                document.getElementById('lastWordDescriberControls').classList.remove('hidden');
                document.getElementById('lastWordObserverMsg').classList.add('hidden');
                
                const container = document.getElementById('lastWordTeamButtons');
                container.innerHTML = '';
                teams.forEach((t, i) => {
                    container.innerHTML += `<button class="btn-primary" style="background:${t.color}; padding: 15px;" onclick="endLastWordLocalOrCloud(${i})">${t.name}</button>`;
                });
            } else {
                document.getElementById('lastWordDisplay').style.display = 'none'; 
                document.getElementById('lastWordDescriberControls').classList.add('hidden');
                document.getElementById('lastWordObserverMsg').classList.remove('hidden');
            }
        }
        
        if (data.screen === 'turnSummary') {
            updateTurnSummaryUI(turnScore, data.lastWordWinner || "");
        }

        if (data.screen === 'play') {
            const isSpecial = isSpecialTurnModifierActive();
            updateSpecialScoresUI();

            if (isSpecial) {
                document.getElementById('specialTurnAlert').classList.remove('hidden');
            } else {
                document.getElementById('specialTurnAlert').classList.add('hidden');
            }

            if (isSpecial && currentRoundEvent.type === 'five_words') {
                document.getElementById('timerContainer').classList.add('hidden');
                document.getElementById('wordsCounterContainer').classList.remove('hidden');
            } else {
                document.getElementById('timerContainer').classList.remove('hidden');
                document.getElementById('wordsCounterContainer').classList.add('hidden');
            }

            if (isMyTurnToDescribe) {
                document.getElementById('wordDisplay').style.display = 'flex';
                document.getElementById('notMyTurnMsg').classList.add('hidden');
                document.getElementById('hostControls').classList.remove('hidden');
                
                if (isSpecial) {
                    document.getElementById('actionButtons').classList.add('hidden');
                    document.getElementById('stealTurnButtons').classList.remove('hidden');
                    
                    const stealGrid = document.getElementById('stealTeamsGrid');
                    stealGrid.innerHTML = '';
                    teams.forEach((t, i) => {
                        stealGrid.innerHTML += `<button class="btn-primary" style="background:${t.color}; padding: 12px;" onclick="scoreToTeam(${i})">${t.name} צדקו (+1)</button>`;
                    });
                } else {
                    document.getElementById('actionButtons').classList.remove('hidden');
                    document.getElementById('stealTurnButtons').classList.add('hidden');
                }

                if(lastActionData && !isSpecial) {
                    document.getElementById('undoBtn').classList.remove('hidden');
                } else {
                    document.getElementById('undoBtn').classList.add('hidden');
                }
            } else {
                document.getElementById('wordDisplay').style.display = 'none';
                document.getElementById('actionButtons').classList.add('hidden');
                document.getElementById('stealTurnButtons').classList.add('hidden');
                document.getElementById('undoBtn').classList.add('hidden');
                document.getElementById('notMyTurnMsg').classList.remove('hidden');
                document.getElementById('hostControls').classList.add('hidden');
            }
        }

        if (data.currentWord !== lastWordShown) {
            document.getElementById('wordDisplay').innerText = data.currentWord;
            triggerWordAnimation();
            lastWordShown = data.currentWord;
        }

        showScreen(data.screen);
        updateBoard();

        const btnPause = document.getElementById('btnPause');
        const pausedMsg = document.getElementById('pausedMessage');
        const btnEndTurnEarly = document.getElementById('btnEndTurnEarly');
        
        if (isSpecialTurnModifierActive() && currentRoundEvent.type === 'five_words') {
            btnPause.classList.add('hidden'); 
            btnEndTurnEarly.innerText = "סיים תור מוקדם"; 
        } else {
            btnPause.classList.remove('hidden');
            btnEndTurnEarly.innerText = "סיים תור מוקדם ודלג לאתגר המילה האחרונה";
        }

        if (isPaused) {
            btnPause.innerText = "המשך משחק";
            btnPause.classList.replace('btn-warning', 'btn-success');
            pausedMsg.classList.remove('hidden');
        } else {
            btnPause.innerText = "השהה משחק";
            btnPause.classList.replace('btn-success', 'btn-warning');
            pausedMsg.classList.add('hidden');
        }

        if (data.screen === 'winner' && data.winnerName) {
            document.getElementById('winnerText').innerText = data.winnerName;
            playVictoryMusic();
        }
    });
}

function updateTurnSummaryUI(score, lastWordWinnerName) {
    const h2 = document.getElementById('summaryTitleH2');
    let msg = "";
    
    if (isSpecialTurnModifierActive()) {
        h2.innerHTML = `סך הכל נוחשו <span style="color: var(--success); font-weight:900; font-size: 1.5em;">${score}</span> מילים!`;
        msg = "חלוקת הנקודות בתור המיוחד:<br>";
        let hasPoints = false;
        teams.forEach((t, i) => {
            if (specialTurnScores[i] > 0) {
                msg += `<span style="font-size:0.9em; display:block;">קבוצת ${t.name} שדדה ${specialTurnScores[i]} נק' 🥷</span>`;
                hasPoints = true;
            }
        });
        if (!hasPoints) msg += "<span style='font-size:0.9em;'>אף קבוצה לא הצליחה לנחש 😕</span>";
    } else {
        h2.innerHTML = `הצלחתם ב-<span style="color: var(--success); font-weight:900; font-size: 1.5em;">${score}</span> מילים!`;
        if (score <= 2) msg = "באסה... מבאס קצת 😕";
        else if (score <= 5) msg = "לא רע בכלל! 🙂";
        else msg = "כל הכבוד! אלופים! 🔥";
    }
    
    let bonusMsg = "";
    if (lastWordWinnerName) {
        bonusMsg = `<br><span style="font-size:0.8em; color:var(--primary); display:block; margin-top:15px;">נקודת בונוס באתגר המילה האחרונה: <b>${lastWordWinnerName}</b></span>`;
    }
    document.getElementById('summaryMessageSpan').innerHTML = msg + bonusMsg;
}

function startGameFromLobby() {
    const emptyTeam = teams.find(t => !t.players || t.players.length === 0);
    if (emptyTeam) {
        if (!confirm(`לקבוצה '${emptyTeam.name}' אין שחקנים עדיין! האם להתחיל את המשחק בכל זאת?`)) return;
    }
    db.ref('rooms/' + myRoomCode).update({ screen: 'difficulty' });
}

function updateBoard() {
    const container = document.getElementById('tracksContainer');
    const miniContainer = document.getElementById('miniTracksContainer');
    let html = ''; 
    
    teams.forEach((team) => {
        const progressPercentage = Math.min((team.score / targetScore) * 100, 100);
        const playersStr = team.players && gameMode === 'network' ? team.players.join(', ') : '';
        
        html += `
            <div class="track" style="height: auto; min-height: 45px;">
                <div class="track-bg">${team.score} נק'</div>
                <div class="track-name">
                    <span style="display:block; margin-bottom: 2px;">${team.name}</span>
                    ${gameMode === 'network' ? `<span style="font-size: 0.6em; opacity: 0.8; font-weight: normal; line-height:1;">${playersStr}</span>` : ''}
                </div>
                <div class="track-fill" style="width: ${progressPercentage}%; background: ${team.color};"></div>
            </div>
        `;
    });

    if (container) container.innerHTML = html;
    if (miniContainer) miniContainer.innerHTML = html;

    if (gameMode === 'local') {
        document.getElementById('nextTeamDisplay').innerText = teams[currentTeamIndex].name;
    }
}

function triggerWordAnimation() {
    const wordEl = document.getElementById('wordDisplay');
    if (!wordEl) return;
    wordEl.style.animation = 'none';
    wordEl.offsetHeight; 
    wordEl.style.animation = 'popIn 0.3s ease-out';
}

function startTurn() {
    unlockAudio();
    lastActionData = null; 
    wordsPlayedThisTurn = 0;
    document.getElementById('wordsCountDisplay').innerText = "0";
    document.getElementById('undoBtn').classList.add('hidden');
    specialTurnScores = new Array(teams.length).fill(0);
    
    let firstWord = getNextWordAndUpdatePointer();
    
    const activeTeam = teams[currentTeamIndex];
    const activePlayerName = activeTeam.players[activeTeam.currentDescriberIndex || 0];
    const isMyTurnToDescribe = (gameMode === 'local') || (myPlayerName === activePlayerName);

    if (gameMode === 'local') {
        turnScore = 0;
        timeLeft = turnDuration;
        isPaused = false;
        
        const btnPause = document.getElementById('btnPause');
        btnPause.innerText = "השהה משחק";
        btnPause.classList.remove('btn-success');
        btnPause.classList.add('btn-warning');
        document.getElementById('pausedMessage').classList.add('hidden');
        
        const isSpecial = isSpecialTurnModifierActive();
        updateSpecialScoresUI();

        if (isSpecial) {
            document.getElementById('specialTurnAlert').classList.remove('hidden');
            document.getElementById('actionButtons').classList.add('hidden');
            document.getElementById('stealTurnButtons').classList.remove('hidden');
            const stealGrid = document.getElementById('stealTeamsGrid');
            stealGrid.innerHTML = '';
            teams.forEach((t, i) => {
                stealGrid.innerHTML += `<button class="btn-primary" style="background:${t.color}; padding: 12px;" onclick="scoreToTeam(${i})">${t.name} צדקו (+1)</button>`;
            });

            if (currentRoundEvent.type === 'five_words') {
                document.getElementById('timerContainer').classList.add('hidden');
                document.getElementById('wordsCounterContainer').classList.remove('hidden');
                btnPause.classList.add('hidden');
            } else {
                document.getElementById('timerContainer').classList.remove('hidden');
                document.getElementById('wordsCounterContainer').classList.add('hidden');
            }
        } else {
            document.getElementById('specialTurnAlert').classList.add('hidden');
            document.getElementById('actionButtons').classList.remove('hidden');
            document.getElementById('stealTurnButtons').classList.add('hidden');
            document.getElementById('timerContainer').classList.remove('hidden');
            document.getElementById('wordsCounterContainer').classList.add('hidden');
        }

        document.getElementById('wordDisplay').style.display = 'flex';
        document.getElementById('notMyTurnMsg').classList.add('hidden');

        showScreen('play');
        document.getElementById('wordDisplay').innerText = firstWord;
        
        clearInterval(timerInterval);
        if (!isSpecial || currentRoundEvent.type !== 'five_words') {
            timerInterval = setInterval(localTimerTick, 1000);
        }
    } else {
        db.ref('rooms/' + myRoomCode).update({
            turnScore: 0,
            timeLeft: turnDuration,
            isPaused: false,
            screen: 'play',
            currentWord: firstWord,
            wordPointer: globalWordPointer,
            lastAction: null,
            lastWordWinner: "",
            specialTurnScores: new Array(teams.length).fill(0)
        });

        if (isMyTurnToDescribe) {
            clearInterval(timerInterval);
            if (!isSpecialTurnModifierActive() || currentRoundEvent.type !== 'five_words') {
                timerInterval = setInterval(networkTimerTick, 1000);
            }
        }
    }
}

function networkTimerTick() {
    if (isPaused) return;
    let newTime = timeLeft - 1;
    
    if (newTime <= 0) {
        clearInterval(timerInterval);
        playTimesUpSound();
        db.ref('rooms/' + myRoomCode).update({ screen: 'lastWord', isPaused: true, timeLeft: 0 });
    } else {
        db.ref('rooms/' + myRoomCode).update({ timeLeft: newTime });
    }
}

function localTimerTick() {
    if (isPaused) return;
    timeLeft--;
    document.getElementById('timeDisplay').innerText = timeLeft;
    if (timeLeft <= 0) {
        clearInterval(timerInterval);
        playTimesUpSound();
        showLastWordChallengeLocal();
    }
}

function checkFiveWordsEndLocal() {
    if (isSpecialTurnModifierActive() && currentRoundEvent.type === 'five_words') {
        wordsPlayedThisTurn++;
        document.getElementById('wordsCountDisplay').innerText = wordsPlayedThisTurn;
        if (wordsPlayedThisTurn >= 5) {
            showTurnSummaryLocal("");
        }
    }
}

function checkFiveWordsEndCloud() {
    if (isSpecialTurnModifierActive() && currentRoundEvent.type === 'five_words') {
        wordsPlayedThisTurn++;
        document.getElementById('wordsCountDisplay').innerText = wordsPlayedThisTurn;
        if (wordsPlayedThisTurn >= 5) {
            db.ref('rooms/' + myRoomCode).update({ screen: 'turnSummary' });
            setTimeout(() => { endTurnCloud(); }, 3500);
        }
    }
}

function scoreToTeam(teamIndex) {
    if(isPaused) return;
    playSuccessSound(); 
    
    if (gameMode === 'local') {
        teams[teamIndex].score++;
        specialTurnScores[teamIndex]++;
        turnScore++; // מעלה את מספר הניחושים הכלליים לתצוגה
        document.getElementById('scoreDisplay').innerText = turnScore;
        document.getElementById('wordDisplay').innerText = getNextWordAndUpdatePointer();
        updateSpecialScoresUI();
        triggerWordAnimation();
        checkFiveWordsEndLocal();
    } else {
        db.ref('rooms/' + myRoomCode).once('value').then(s => {
            const data = s.val();
            let dTeams = data.teams;
            dTeams[teamIndex].score++;
            let dSpecial = data.specialTurnScores || new Array(dTeams.length).fill(0);
            dSpecial[teamIndex]++;
            db.ref('rooms/' + myRoomCode).update({ 
                teams: dTeams,
                turnScore: data.turnScore + 1,
                specialTurnScores: dSpecial,
                currentWord: getNextWordAndUpdatePointer(),
                wordPointer: globalWordPointer
            });
            checkFiveWordsEndCloud();
        });
    }
}

function showLastWordChallengeLocal() {
    showScreen('lastWord');
    document.getElementById('lastWordDisplay').innerText = document.getElementById('wordDisplay').innerText;
    document.getElementById('lastWordDisplay').style.display = 'flex'; 
    document.getElementById('lastWordDescriberControls').classList.remove('hidden');
    document.getElementById('lastWordObserverMsg').classList.add('hidden');

    const container = document.getElementById('lastWordTeamButtons');
    container.innerHTML = '';
    teams.forEach((t, i) => {
        container.innerHTML += `<button class="btn-primary" style="background:${t.color}; padding: 15px;" onclick="endLastWordLocalOrCloud(${i})">${t.name}</button>`;
    });
}

function endLastWordLocalOrCloud(teamIndex) {
    let winnerName = teamIndex !== null ? teams[teamIndex].name : "";
    
    if (gameMode === 'local') {
        if (teamIndex !== null) {
            teams[teamIndex].score += 1; 
        }
        showTurnSummaryLocal(winnerName);
    } else {
        db.ref('rooms/' + myRoomCode).once('value').then(s => {
            let d = s.val();
            let dTeams = d.teams;
            if (teamIndex !== null) {
                dTeams[teamIndex].score += 1;
            }
            db.ref('rooms/' + myRoomCode).update({ 
                teams: dTeams, 
                lastWordWinner: winnerName,
                screen: 'turnSummary'
            });
            setTimeout(() => { endTurnCloud(); }, 3500);
        });
    }
}

function showTurnSummaryLocal(lastWordWinnerName = "") {
    updateTurnSummaryUI(turnScore, lastWordWinnerName);
    showScreen('turnSummary');
    setTimeout(() => {
        endTurnLocal();
    }, 3500);
}


function correctWord() {
    if(isPaused) return;
    playSuccessSound(); 
    const currentWordText = document.getElementById('wordDisplay').innerText;
    let nextWord = getNextWordAndUpdatePointer();
    
    if (gameMode === 'local') {
        lastActionData = { word: currentWordText, scoreChange: 1 };
        document.getElementById('undoBtn').classList.remove('hidden');
        turnScore++;
        document.getElementById('scoreDisplay').innerText = turnScore;
        document.getElementById('wordDisplay').innerText = nextWord;
        triggerWordAnimation();
        checkFiveWordsEndLocal();
    } else {
        db.ref('rooms/' + myRoomCode).once('value').then(s => {
            const data = s.val();
            db.ref('rooms/' + myRoomCode).update({ 
                turnScore: data.turnScore + 1, 
                currentWord: nextWord,
                wordPointer: globalWordPointer,
                lastAction: { word: data.currentWord, scoreChange: 1 }
            });
            checkFiveWordsEndCloud();
        });
    }
}

function skipWord() {
    if(isPaused) return;
    const currentWordText = document.getElementById('wordDisplay').innerText;
    let nextWord = getNextWordAndUpdatePointer();
    
    if (gameMode === 'local') {
        if (!isSpecialTurnModifierActive()) {
            lastActionData = { word: currentWordText, scoreChange: -1 };
            document.getElementById('undoBtn').classList.remove('hidden');
            turnScore--;
            document.getElementById('scoreDisplay').innerText = turnScore;
        }
        document.getElementById('wordDisplay').innerText = nextWord;
        triggerWordAnimation();
        checkFiveWordsEndLocal();
    } else {
        db.ref('rooms/' + myRoomCode).once('value').then(s => {
            const data = s.val();
            let updates = { 
                currentWord: nextWord,
                wordPointer: globalWordPointer
            };
            if (!isSpecialTurnModifierActive()) {
                updates.turnScore = data.turnScore - 1;
                updates.lastAction = { word: data.currentWord, scoreChange: -1 };
            }
            db.ref('rooms/' + myRoomCode).update(updates);
            checkFiveWordsEndCloud();
        });
    }
}

function passWord() {
    if(isPaused) return;
    const currentWordText = document.getElementById('wordDisplay').innerText;
    let nextWord = getNextWordAndUpdatePointer();
    
    if (gameMode === 'local') {
        if (!isSpecialTurnModifierActive()) {
            lastActionData = { word: currentWordText, scoreChange: 0 };
            document.getElementById('undoBtn').classList.remove('hidden');
        }
        document.getElementById('wordDisplay').innerText = nextWord;
        triggerWordAnimation();
        checkFiveWordsEndLocal();
    } else {
        db.ref('rooms/' + myRoomCode).once('value').then(s => {
            const data = s.val();
            let updates = { 
                currentWord: nextWord,
                wordPointer: globalWordPointer
            };
            if (!isSpecialTurnModifierActive()) {
                updates.lastAction = { word: data.currentWord, scoreChange: 0 };
            }
            db.ref('rooms/' + myRoomCode).update(updates);
            checkFiveWordsEndCloud();
        });
    }
}

function undoWord() {
    if(isPaused || !lastActionData || isSpecialTurnModifierActive()) return;
    
    if (gameMode === 'local') {
        turnScore -= lastActionData.scoreChange; 
        document.getElementById('scoreDisplay').innerText = turnScore;
        document.getElementById('wordDisplay').innerText = lastActionData.word; 
        lastActionData = null; 
        document.getElementById('undoBtn').classList.add('hidden');
        triggerWordAnimation();
    } else {
        db.ref('rooms/' + myRoomCode).once('value').then(s => {
            const data = s.val();
            const undoData = data.lastAction;
            if(!undoData) return;
            db.ref('rooms/' + myRoomCode).update({ 
                turnScore: data.turnScore - undoData.scoreChange, 
                currentWord: undoData.word,
                lastAction: null 
            });
        });
    }
}

function togglePause() {
    if (gameMode === 'local') {
        isPaused = !isPaused;
        const btn = document.getElementById('btnPause');
        const pausedMsg = document.getElementById('pausedMessage');
        const actionBtns = document.getElementById('actionButtons');
        const wordDisp = document.getElementById('wordDisplay');

        if (isPaused) {
            clearInterval(timerInterval);
            btn.innerText = "המשך משחק";
            btn.classList.remove('btn-warning');
            btn.classList.add('btn-success');
            pausedMsg.classList.remove('hidden');
            actionBtns.style.display = 'none';
            wordDisp.style.display = 'none'; 
            document.getElementById('undoBtn').classList.add('hidden');
            document.getElementById('stealTurnButtons').classList.add('hidden');
        } else {
            if (!isSpecialTurnModifierActive() || currentRoundEvent.type !== 'five_words') {
                timerInterval = setInterval(localTimerTick, 1000);
            }
            btn.innerText = "השהה משחק";
            btn.classList.remove('btn-success');
            btn.classList.add('btn-warning');
            pausedMsg.classList.add('hidden');
            
            if (isSpecialTurnModifierActive()) {
                document.getElementById('stealTurnButtons').classList.remove('hidden');
            } else {
                actionBtns.style.display = 'flex';
                if(lastActionData) document.getElementById('undoBtn').classList.remove('hidden');
            }
            wordDisp.style.display = 'flex';
        }
    } else {
        db.ref('rooms/' + myRoomCode).update({ isPaused: !isPaused });
    }
}

function endTurnEarly() {
    if(confirm("האם אתה בטוח שאתה רוצה לסיים את התור עכשיו?")) {
        clearInterval(timerInterval);
        
        if (isSpecialTurnModifierActive() && currentRoundEvent.type === 'five_words') {
            if (gameMode === 'local') {
                showTurnSummaryLocal("");
            } else {
                db.ref('rooms/' + myRoomCode).update({ screen: 'turnSummary', lastWordWinner: "" });
                setTimeout(() => { endTurnCloud(); }, 3500);
            }
        } else {
            playTimesUpSound();
            if (gameMode === 'local') {
                showLastWordChallengeLocal();
            } else {
                db.ref('rooms/' + myRoomCode).update({ screen: 'lastWord', isPaused: true, timeLeft: 0 });
            }
        }
    }
}

function endTurnLocal() {
    let activeTeam = teams[currentTeamIndex];
    if (!isSpecialTurnModifierActive()) {
        activeTeam.score += turnScore;
    }
    if(activeTeam.score < 0) activeTeam.score = 0;

    let isWinner = activeTeam.score >= targetScore;
    let nextIndex = (currentTeamIndex + 1) % teams.length;
    let isNewRound = (nextIndex === 0);

    if (isWinner) {
        document.getElementById('winnerText').innerText = activeTeam.name;
        playVictoryMusic(); 
        showScreen('winner');
    } else {
        currentTeamIndex = nextIndex;
        updateBoard();
        if (isNewRound) {
            showScreen('difficulty');
        } else {
            showScreen('board');
        }
    }
}

function endTurnCloud() {
    db.ref('rooms/' + myRoomCode).once('value').then(snap => {
        let data = snap.val();
        let currentTeams = data.teams;
        let activeTeam = currentTeams[data.currentTeamIndex];
        
        if (!isSpecialTurnModifierActive()) {
            activeTeam.score += data.turnScore;
        }
        if(activeTeam.score < 0) activeTeam.score = 0;

        if (activeTeam.players && activeTeam.players.length > 0) {
            activeTeam.currentDescriberIndex = (activeTeam.currentDescriberIndex + 1) % activeTeam.players.length;
        }

        let isWinner = activeTeam.score >= data.targetScore;
        let nextIndex = (data.currentTeamIndex + 1) % currentTeams.length;
        let isNewRound = (nextIndex === 0);

        db.ref('rooms/' + myRoomCode).update({
            teams: currentTeams,
            screen: isWinner ? 'winner' : (isNewRound ? 'difficulty' : 'board'),
            winnerName: isWinner ? activeTeam.name : '',
            currentTeamIndex: nextIndex
        });
    });
}
