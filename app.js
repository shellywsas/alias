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

// שמירת מאגר מילים גלובלי מסודר כך שלא יהיו כפילויות
let globalWordOrder = [];
let globalWordPointer = 0;

// פונקציה ליצירת מערך מילים מעורבב 
function generateShuffledWords() {
    let arr = [...window.allWords];
    for(let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// פונקציה לשליפת המילה הבאה ועדכון המצביע
function getNextWordAndUpdatePointer() {
    if (!globalWordOrder || globalWordOrder.length === 0) {
        globalWordOrder = generateShuffledWords();
    }
    
    let word = globalWordOrder[globalWordPointer];
    globalWordPointer++;
    
    // אם נגמרו כל המילים, מערבבים מחדש
    if (globalWordPointer >= globalWordOrder.length) {
        globalWordOrder = generateShuffledWords();
        globalWordPointer = 0;
        if (gameMode === 'network') {
            db.ref('rooms/' + myRoomCode).update({ wordOrder: globalWordOrder });
        }
    }
    return word;
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

function playVictoryMusic() {
    if (isMuted) return;
    unlockAudio();
    const notes = [523.25, 659.25, 783.99, 1046.50]; 
    const durationSeconds = 10;
    const notesToPlay = durationSeconds * 4; 
    const startTime = audioCtx.currentTime;

    for (let i = 0; i < notesToPlay; i++) {
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        osc.type = 'triangle';
        const octaveMult = (Math.floor(i / 8) % 2 === 0) ? 1 : 0.5;
        osc.frequency.value = notes[i % 4] * octaveMult;
        
        const noteTime = startTime + (i * 0.25);
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
    const myTurn = (gameMode === 'local') || (document.getElementById('actionButtons').style.display !== 'none');
    
    if (playScreenActive && !isPaused && myTurn) {
        if (event.code === 'Space') { 
            event.preventDefault(); 
            correctWord();
        } else if (event.key === 'Enter') { 
            event.preventDefault();
            skipWord();
        }
    }
});

// ================= GAME DATA =================
let teams = []; 
let currentTeamIndex = 0;
let targetScore = 30;
let turnDuration = 60;

let turnScore = 0;
let timeLeft = 0;
let timerInterval = null;
let isPaused = false;

const teamColors = [
    "linear-gradient(90deg, #e63946, #ba1826)",
    "linear-gradient(90deg, #2b2d42, #1d3557)",
    "linear-gradient(90deg, #2a9d8f, #21867a)",
    "linear-gradient(90deg, #6a4c93, #4a3466)"
];

const screens = {
    mode: document.getElementById('modeScreen'),
    setup: document.getElementById('setupScreen'),
    chooseTeam: document.getElementById('chooseTeamScreen'),
    lobby: document.getElementById('lobbyScreen'),
    board: document.getElementById('boardScreen'),
    play: document.getElementById('playScreen'),
    turnSummary: document.getElementById('turnSummaryScreen'),
    winner: document.getElementById('winnerScreen')
};

function showScreen(screenName) {
    Object.values(screens).forEach(s => {
        if (s) s.classList.add('hidden');
    });
    if (screens[screenName]) screens[screenName].classList.remove('hidden');
}

// פונקציית חזרה להגדרות ללא רענון
function goBackToMode() {
    showScreen('mode');
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
        document.getElementById('setupTitle').innerText = "אליאס ברשת";
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
    let initialOrder = generateShuffledWords();
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
        
        updateBoard();
        showScreen('board');
    } else {
        myPlayerName = document.getElementById('hostNameInput').value.trim();
        if(!myPlayerName) return alert("חובה להכניס את שם המנהל!");

        for (let i = 0; i < inputNames.length; i++) {
            newTeams.push({ 
                name: inputNames[i], 
                score: 0, 
                color: teamColors[i],
                players: i === 0 ? [myPlayerName] : [],
                currentDescriberIndex: 0
            });
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
            wordOrder: initialOrder,
            wordPointer: 0
        }).then(() => {
            btn.innerText = "צור חדר (כמנהל)";
            listenToRoom();
        }).catch(err => {
            btn.innerText = "צור חדר (כמנהל)";
            alert("שגיאה! נראה שפיירבייס חוסם אותך.\nהשגיאה: " + err.message);
        });
    }
}

let pendingRoomCode = "";

function joinRoom() {
    unlockAudio();
    myPlayerName = document.getElementById('joinPlayerName').value.trim();
    pendingRoomCode = document.getElementById('joinCodeInput').value.trim();

    if (!myPlayerName || !pendingRoomCode) return alert("אנא הכנס קוד חדר ואת השם שלך!");

    const btn = document.getElementById('joinBtn');
    btn.innerText = "מחפש חדר...";

    db.ref('rooms/' + pendingRoomCode).once('value').then(snap => {
        btn.innerText = "חפש חדר";
        if (!snap.exists()) return alert("חדר זה לא קיים או שהקוד שגוי!");
        
        const data = snap.val();
        if (data.screen !== 'lobby') return alert("המשחק בחדר זה כבר התחיל!");
        
        document.getElementById('welcomeMsg').innerText = `היי ${myPlayerName},`;
        const select = document.getElementById('teamSelectDropdown');
        select.innerHTML = '';
        
        (data.teams || []).forEach((t, i) => {
            const count = t.players ? t.players.length : 0;
            select.innerHTML += `<option value="${i}">${t.name} (${count} שחקנים)</option>`;
        });

        showScreen('chooseTeam');
    }).catch(err => {
        btn.innerText = "חפש חדר";
        alert("שגיאה בהתחברות: " + err.message);
    });
}

function confirmTeamJoin() {
    const teamIdx = document.getElementById('teamSelectDropdown').value;
    myRoomCode = pendingRoomCode;
    
    const btn = document.getElementById('confirmJoinBtn');
    btn.innerText = "מצטרף...";

    db.ref('rooms/' + myRoomCode).once('value').then(snap => {
        let data = snap.val();
        let teams = data.teams;
        
        if (!teams[teamIdx].players) teams[teamIdx].players = [];
        teams[teamIdx].players.push(myPlayerName);
        myTeamName = teams[teamIdx].name;
        
        return db.ref('rooms/' + myRoomCode).update({ teams: teams });
    }).then(() => {
        btn.innerText = "הצטרף לקבוצה!";
        listenToRoom();
    }).catch(err => {
        btn.innerText = "הצטרף לקבוצה!";
        alert("שגיאה בהצטרפות: " + err.message);
    });
}

function listenToRoom() {
    if (!isHost) {
        document.getElementById('btnStartFromLobby').classList.add('hidden');
        document.getElementById('waitHostLobbyMsg').classList.remove('hidden');
    } else {
        document.getElementById('btnStartFromLobby').classList.remove('hidden');
    }

    db.ref('rooms/' + myRoomCode).on('value', snap => {
        if (!snap.exists()) return;
        const data = snap.val();

        teams = data.teams || [];
        targetScore = data.targetScore;
        turnDuration = data.turnDuration;
        currentTeamIndex = data.currentTeamIndex;
        turnScore = data.turnScore;
        timeLeft = data.timeLeft;
        isPaused = data.isPaused;
        lastActionData = data.lastAction || null; 
        
        if (data.wordOrder) globalWordOrder = data.wordOrder;
        if (data.wordPointer !== undefined) globalWordPointer = data.wordPointer;

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
            if (gameMode === 'local') {
                document.getElementById('btnStartTurn').classList.remove('hidden');
                document.getElementById('waitHostMsg').classList.add('hidden');
            } else {
                if (myPlayerName === activePlayerName) {
                    document.getElementById('btnStartTurn').classList.remove('hidden');
                    document.getElementById('waitHostMsg').classList.add('hidden');
                } else {
                    document.getElementById('btnStartTurn').classList.add('hidden');
                    document.getElementById('waitHostMsg').innerText = "ממתינים ש-" + activePlayerName + " יתחיל את התור...";
                    document.getElementById('waitHostMsg').classList.remove('hidden');
                }
            }
        }
        
        // עדכון מסך סיכום נקודות
        if (data.screen === 'turnSummary') {
            document.getElementById('summaryPointsSpan').innerText = turnScore;
            document.getElementById('summaryTeamSpan').innerText = activeTeam ? "כל הכבוד לקבוצת " + activeTeam.name + "!" : "";
        }

        if (isMyTurnToDescribe) {
            document.getElementById('wordDisplay').style.display = 'flex';
            document.getElementById('actionButtons').style.display = 'flex';
            document.getElementById('notMyTurnMsg').classList.add('hidden');
            document.getElementById('hostControls').classList.remove('hidden');
            
            if(lastActionData && data.screen === 'play') {
                document.getElementById('undoBtn').classList.remove('hidden');
            } else {
                document.getElementById('undoBtn').classList.add('hidden');
            }
        } else {
            document.getElementById('wordDisplay').style.display = 'none';
            document.getElementById('actionButtons').style.display = 'none';
            document.getElementById('undoBtn').classList.add('hidden');
            document.getElementById('notMyTurnMsg').classList.remove('hidden');
            document.getElementById('hostControls').classList.add('hidden');
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

function startGameFromLobby() {
    const emptyTeam = teams.find(t => !t.players || t.players.length === 0);
    if (emptyTeam) {
        if (!confirm(`לקבוצה '${emptyTeam.name}' אין שחקנים עדיין! האם להתחיל את המשחק בכל זאת?`)) return;
    }
    db.ref('rooms/' + myRoomCode).update({ screen: 'board' });
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
    document.getElementById('undoBtn').classList.add('hidden');
    
    let firstWord = getNextWordAndUpdatePointer();
    
    if (gameMode === 'local') {
        turnScore = 0;
        timeLeft = turnDuration;
        isPaused = false;
        
        const btnPause = document.getElementById('btnPause');
        btnPause.innerText = "השהה משחק";
        btnPause.classList.remove('btn-success');
        btnPause.classList.add('btn-warning');
        document.getElementById('pausedMessage').classList.add('hidden');
        
        document.getElementById('actionButtons').style.display = 'flex';
        document.getElementById('wordDisplay').style.display = 'flex';
        document.getElementById('notMyTurnMsg').classList.add('hidden');

        showScreen('play');
        document.getElementById('wordDisplay').innerText = firstWord;
        
        clearInterval(timerInterval);
        timerInterval = setInterval(localTimerTick, 1000);
    } else {
        db.ref('rooms/' + myRoomCode).update({
            turnScore: 0,
            timeLeft: turnDuration,
            isPaused: false,
            screen: 'play',
            currentWord: firstWord,
            wordPointer: globalWordPointer,
            lastAction: null
        });

        // רק המנהל יריץ את הטיימר ברשת כדי שלא יהיו התנגשויות
        if (isHost) {
            clearInterval(timerInterval);
            timerInterval = setInterval(networkTimerTick, 1000);
        }
    }
}

function networkTimerTick() {
    if (isPaused) return;
    let newTime = timeLeft - 1;
    
    if (newTime <= 0) {
        clearInterval(timerInterval);
        showTurnSummaryCloud();
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
        showTurnSummaryLocal();
    }
}

function showTurnSummaryCloud() {
    db.ref('rooms/' + myRoomCode).update({ screen: 'turnSummary', isPaused: true, timeLeft: 0 });
    setTimeout(() => {
        if (isHost) endTurnCloud(); 
    }, 3500);
}

function showTurnSummaryLocal() {
    document.getElementById('summaryPointsSpan').innerText = turnScore;
    document.getElementById('summaryTeamSpan').innerText = "כל הכבוד לקבוצת " + teams[currentTeamIndex].name + "!";
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
    } else {
        db.ref('rooms/' + myRoomCode).once('value').then(s => {
            const data = s.val();
            db.ref('rooms/' + myRoomCode).update({ 
                turnScore: data.turnScore + 1, 
                currentWord: nextWord,
                wordPointer: globalWordPointer,
                lastAction: { word: data.currentWord, scoreChange: 1 }
            });
        });
    }
}

function skipWord() {
    if(isPaused) return;
    const currentWordText = document.getElementById('wordDisplay').innerText;
    let nextWord = getNextWordAndUpdatePointer();
    
    if (gameMode === 'local') {
        lastActionData = { word: currentWordText, scoreChange: -1 };
        document.getElementById('undoBtn').classList.remove('hidden');
        turnScore--;
        document.getElementById('scoreDisplay').innerText = turnScore;
        document.getElementById('wordDisplay').innerText = nextWord;
        triggerWordAnimation();
    } else {
        db.ref('rooms/' + myRoomCode).once('value').then(s => {
            const data = s.val();
            db.ref('rooms/' + myRoomCode).update({ 
                turnScore: data.turnScore - 1, 
                currentWord: nextWord,
                wordPointer: globalWordPointer,
                lastAction: { word: data.currentWord, scoreChange: -1 }
            });
        });
    }
}

function passWord() {
    if(isPaused) return;
    const currentWordText = document.getElementById('wordDisplay').innerText;
    let nextWord = getNextWordAndUpdatePointer();
    
    if (gameMode === 'local') {
        lastActionData = { word: currentWordText, scoreChange: 0 };
        document.getElementById('undoBtn').classList.remove('hidden');
        document.getElementById('wordDisplay').innerText = nextWord;
        triggerWordAnimation();
    } else {
        db.ref('rooms/' + myRoomCode).once('value').then(s => {
            const data = s.val();
            db.ref('rooms/' + myRoomCode).update({ 
                currentWord: nextWord,
                wordPointer: globalWordPointer,
                lastAction: { word: data.currentWord, scoreChange: 0 }
            });
        });
    }
}

function undoWord() {
    if(isPaused || !lastActionData) return;
    
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
        } else {
            timerInterval = setInterval(localTimerTick, 1000);
            btn.innerText = "השהה משחק";
            btn.classList.remove('btn-success');
            btn.classList.add('btn-warning');
            pausedMsg.classList.add('hidden');
            actionBtns.style.display = 'flex';
            wordDisp.style.display = 'flex';
            if(lastActionData) document.getElementById('undoBtn').classList.remove('hidden');
        }
    } else {
        db.ref('rooms/' + myRoomCode).update({ isPaused: !isPaused });
    }
}

function endTurnEarly() {
    if(confirm("האם אתה בטוח שאתה רוצה לסיים את התור עכשיו? הנקודות שנצברו עד כה יישמרו.")) {
        if (gameMode === 'local') {
            clearInterval(timerInterval);
            showTurnSummaryLocal();
        } else {
            if (isHost) {
                clearInterval(timerInterval);
                showTurnSummaryCloud();
            } else {
                db.ref('rooms/' + myRoomCode).update({ timeLeft: 0 });
            }
        }
    }
}

function endTurnLocal() {
    let activeTeam = teams[currentTeamIndex];
    activeTeam.score += turnScore;
    if(activeTeam.score < 0) activeTeam.score = 0;

    if (activeTeam.score >= targetScore) {
        document.getElementById('winnerText').innerText = activeTeam.name;
        playVictoryMusic(); 
        showScreen('winner');
    } else {
        currentTeamIndex = (currentTeamIndex + 1) % teams.length;
        updateBoard();
        showScreen('board');
    }
}

function endTurnCloud() {
    let activeTeam = teams[currentTeamIndex];
    activeTeam.score += turnScore;
    if(activeTeam.score < 0) activeTeam.score = 0;

    // מעבר לשחקן הבא בקבוצה שמסביר (רוטציה פנימית)
    if (activeTeam.players && activeTeam.players.length > 0) {
        activeTeam.currentDescriberIndex = (activeTeam.currentDescriberIndex + 1) % activeTeam.players.length;
    }

    let isWinner = activeTeam.score >= targetScore;
    let nextIndex = (currentTeamIndex + 1) % teams.length;

    db.ref('rooms/' + myRoomCode).update({
        teams: teams,
        screen: isWinner ? 'winner' : 'board',
        winnerName: isWinner ? activeTeam.name : '',
        currentTeamIndex: nextIndex
    });
}